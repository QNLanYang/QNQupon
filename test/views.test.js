// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 QNLanYang (全能岚漾)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { login, publicCoupon, usersPage, presetsPage, couponDetail, codeDetail, forbidden, couponsPage, recyclePage, dashboard, couponForm, profilePage, verifyPage, rateLimited, settingsPage, redemptionsPage, auditPage, home } from '../src/views.js';

const faceOf = (over = {}) => ({
  id: 7, name: '券', offer_text: 'x', description: null, instructions: null, store_text: null,
  starts_on: null, expires_on: null, max_uses: 3, status: 'active', current_state: 'valid', ...over
});
const codeOf = (over = {}) => ({
  id: 'cd-AbCdEfGh1234', coupon_id: 7, face_id: 7, name: '张三的券', face_name: '券', offer_text: 'x', description: null, instructions: null,
  store_text: null, starts_on: null, expires_on: null, max_uses: 3, used_count: 1, note: '张三',
  status: 'active', face_status: 'active', current_state: 'valid', created_at: '2026-09-20T02:00:00.000Z',
  creator_name: 'superadmin', ...over
});

const user = { id: 1, username: 'superadmin', role: 'super_admin', csrf: 'csrf-token' };

test('登录页包含 CSRF 与表单', () => {
  const html = login('csrf-token');
  assert.match(html, /name="_csrf" value="csrf-token"/);
  assert.match(html, /action="\/admin\/login"/);
  assert.match(html, /autocomplete="current-password"/);
});

test('公开券页：可核销时有按钮，非可核销时没有按钮', () => {
  const base = {
    face_name: '测试券', name: '张三的券', note: '张三 138****', offer_text: '立减 10', description: null, instructions: '说明', store_text: null,
    starts_on: null, expires_on: '2026-10-02', max_uses: 5, used_count: 1
  };
  const valid = publicCoupon({ ...base, current_state: 'valid' }, 'pub-csrf', { token: 'tok' });
  assert.match(valid, /确认核销/);
  assert.match(valid, /name="_csrf" value="pub-csrf"/);
  assert.match(valid, /<dd>4 次<\/dd>/);
  assert.match(valid, /<h1>测试券 - 张三的券<\/h1>/, '第一行是“券面名 - 券码名”');
  assert.match(valid, /<div class="offer">立减 10<\/div>/, '第二行是券面内容');
  assert.ok(!valid.includes('138****'), '券码备注是后台信息，绝不出现在核销页');
  assert.match(valid, /href="\/verify"/, '公开页要有核销凭证查询入口');

  const hidden = publicCoupon({ ...base, current_state: 'valid', displayCodeName: false }, 'pub-csrf', { token: 'tok' });
  assert.match(hidden, /<h1>测试券<\/h1>/, '隐藏券码名时标题只剩券面名');
  assert.ok(!hidden.includes('张三的券'), '隐藏时不出现券码名');

  for (const state of ['expired', 'disabled', 'recycled', 'exhausted', 'not_started']) {
    const html = publicCoupon({ ...base, current_state: state }, 'pub-csrf', { token: 'tok' });
    assert.ok(!html.includes('确认核销'), `${state} 状态不应出现核销按钮`);
    assert.match(html, /此券当前不能核销/);
  }

  const redeemed = publicCoupon({ ...base, current_state: 'exhausted', used_count: 5 }, 'pub-csrf', { kind: 'redeemed', token: 'tok', redeemedAt: '2026-09-24T12:00:00.000Z', code: 'ABC-123' });
  assert.match(redeemed, /核销成功/);
  assert.match(redeemed, /核销时间：2026-09-24 20:00:00/, '核销时间要显示北京时间（UTC 存储 +8）');
  assert.match(redeemed, /data-code="ABC-123"/, '应有可读取的凭证码属性');
  assert.match(redeemed, /<span>A<\/span><span>B<\/span><span>C<\/span>/, '凭证码逐位拆开用于分散对齐');
  assert.ok(!redeemed.includes('剩余次数'), '结果页不显示剩余次数');
  assert.ok(!redeemed.includes('生效日期'), '结果页不显示生效时间');
  assert.ok(!redeemed.includes('coupon-meta'), '结果页不显示次数/日期信息块');
  assert.ok(!redeemed.includes('coupon-state'), '结果页不显示状态徽章');

  const failed = publicCoupon({ ...base, current_state: 'exhausted', used_count: 5 }, 'pub-csrf', { kind: 'failed', state: 'exhausted', token: 'tok' });
  assert.match(failed, /核销失败/);
  assert.match(failed, /result failed/);
  assert.match(failed, /可用次数已用完/);
  assert.ok(!failed.includes('coupon-meta'), '失败页同样只保留名称与优惠内容');

  const csrfFailed = publicCoupon({ ...base, current_state: 'valid' }, 'pub-csrf', { kind: 'failed', reason: '页面停留太久，校验已失效。请刷新页面后再试一次。' });
  assert.match(csrfFailed, /核销失败/);
  assert.match(csrfFailed, /页面停留太久/);

  const missing = publicCoupon(null, 'pub-csrf');
  assert.match(missing, /无效券码/);
  assert.match(missing, /result unknown/, '查不到券应是中性“未知”样式');
});

test('公开券页不可核销时给出直白原因', () => {
  const base = {
    face_name: '测试券', offer_text: '立减 10', description: null, instructions: null, store_text: null,
    starts_on: null, expires_on: null, max_uses: 5, used_count: 5
  };
  const reasons = {
    exhausted: /可用次数已用完/,
    expired: /已过有效期/,
    not_started: /未到生效日期/,
    disabled: /已被发券人停用/,
    recycled: /已被删除/
  };
  for (const [state, pattern] of Object.entries(reasons)) {
    const html = publicCoupon({ ...base, current_state: state }, 'pub-csrf', { token: 'tok' });
    assert.match(html, /result blocked/, `${state} 应为不可核销面板`);
    assert.match(html, pattern, `${state} 需要直白原因`);
  }
});

test('公开券页转义 HTML 注入', () => {
  const html = publicCoupon({
    face_name: '<script>alert(1)</script>', name: null, offer_text: '<b>x</b>', description: null, instructions: null,
    store_text: null, starts_on: null, expires_on: null, max_uses: 1, used_count: 0, current_state: 'valid'
  }, 'pub-csrf', { token: 'tok' });
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.match(html, /&lt;script&gt;/);
});

test('业务管理员看不到账号/设置入口，超管可见', () => {
  const biz = usersPage({ user: { ...user, role: 'business_admin' }, users: [], csrf: 'c', flash: null });
  assert.ok(!biz.includes('href="/admin/users"'), '业务管理员不应看到账号入口');
  assert.ok(!biz.includes('href="/admin/settings"'), '业务管理员不应看到设置入口');
  const superHtml = usersPage({ user, users: [{ id: 2, username: 'biz', role: 'business_admin', active: 1, last_login_at: null }], csrf: 'csrf-token', flash: null });
  assert.match(superHtml, /action="\/admin\/users\/2\/active"/);
  assert.match(superHtml, /action="\/admin\/users\/2\/password"/);
});

test('账号页对当前账号与超管隐藏危险操作', () => {
  const html = usersPage({ user, users: [
    { id: 1, username: 'superadmin', role: 'super_admin', active: 1, last_login_at: null },
    { id: 2, username: 'biz', role: 'business_admin', active: 1, last_login_at: null },
    { id: 3, username: 'biz-off', role: 'business_admin', active: 0, last_login_at: null }
  ], csrf: 'csrf-token', flash: null });
  assert.match(html, /当前账号/);
  const selfRow = html.match(/<tr><td>superadmin[\s\S]*?<\/tr>/)[0];
  assert.ok(!selfRow.includes('/active'), '不能对自己停用');
  assert.ok(!selfRow.includes('/password'), '不能在账号页重置自己密码');
  assert.match(html, />启用<\/button>/, '停用账号应显示“启用”按钮');
});

test('预设页每条都有编辑/删除动作', () => {
  const html = presetsPage({ user, csrf: 'csrf-token', flash: null, presets: [
    { id: 1, name: '示例总店', instructions: '说明', store_text: '门店', active: 1 },
    { id: 2, name: '停用店', instructions: null, store_text: null, active: 0 }
  ] });
  assert.match(html, /action="\/admin\/presets\/1"/);
  assert.match(html, /formaction="\/admin\/presets\/1\/delete"/);
  assert.match(html, /action="\/admin\/presets\/2"/);
  assert.match(html, /停用<\/span>/, '停用预设要有徽章');
  assert.match(html, /name="active"[^>]*>/, '应有启用开关');
  // 停用预设不应出现在券表单的下拉里（由 activePresets 控制）
});

test('券面详情：可编辑时有停用/回收，回收站只有恢复+永久删除', () => {
  const active = couponDetail({ user, coupon: faceOf(), codes: [codeOf(), codeOf({ id: 'cd-Zz9Yy8Xx7Ww6', name: '停用的码', note: null, status: 'disabled', current_state: 'disabled' })], redemptions: [], csrf: 'csrf-token', flash: null });
  assert.match(active, /移入回收站/);
  assert.match(active, />停用整张券</);
  assert.match(active, /券码（2）/, '要列出该券面下的券码');
  assert.match(active, /停用<\/button>/, '单张券码可单独停用');
  assert.ok(!active.includes('从回收站恢复'));

  const recycled = couponDetail({ user, coupon: faceOf({ status: 'recycled', current_state: 'recycled' }), codes: [], redemptions: [], csrf: 'csrf-token', flash: null });
  assert.match(recycled, /从回收站恢复/);
  assert.match(recycled, /action="\/admin\/coupons\/7\/purge"/);
  assert.ok(!recycled.includes('>移入回收站<'), '回收站内不应再显示移入按钮');
  assert.ok(!recycled.includes('编辑券面'), '回收站内不应可编辑');
  assert.ok(!recycled.includes('/codes"'), '回收站内不应再创建券码');

  const bizRecycled = couponDetail({ user: { ...user, role: 'business_admin' }, coupon: faceOf({ status: 'recycled', current_state: 'recycled' }), codes: [], redemptions: [], csrf: 'csrf-token', flash: null });
  assert.match(bizRecycled, /从回收站恢复/, '业务管理员也能恢复');
  assert.ok(!bizRecycled.includes('/purge'), '业务管理员不能永久删除');
});

test('券面详情：创建券码表单与空状态引导', () => {
  const html = couponDetail({ user, coupon: faceOf(), codes: [], redemptions: [], csrf: 'csrf-token', flash: null });
  assert.match(html, /action="\/admin\/coupons\/7\/codes"/, '要有创建券码的表单');
  assert.match(html, /name="name" maxlength="80"/, '保留券码名称输入框');
  assert.ok(!/name="name" required/.test(html), '券码名称可留空，自动命名（不再 required）');
  assert.match(html, /留空 = 自动命名/, '要写清楚留空的默认行为');
  assert.match(html, /名称仅用于展示，可以重复/, '名称可重复');
  assert.ok(!html.includes('不与已有券码重名'), '不再宣称券码名唯一');
  assert.match(html, /name="show_name"[\s\S]{0,160}跟随全局设置[\s\S]{0,120}始终显示[\s\S]{0,120}始终隐藏/, '创建时可选券码名显示覆写');
  assert.match(html, /name="note"/, '创建时可填发给谁的备注');
  assert.ok(!html.includes('name="count"'), '不再一次批量创建多张，一次点击创建一张');
  assert.match(html, /一次创建一张/, '要写清楚创建规则');
  assert.match(html, /class="table-scroll"><table>/, '券码列表要限高、超出滚动');
  assert.match(html, /还没有券码/, '空状态要解释“没有券码不能发出去”');
  assert.match(html, /每张券码次数/, '券面信息要写清次数口径');
  assert.ok(!html.includes('/admin/coupons/7/qrcode'), '券码的二维码在券码详情里，不在券面');

  const recycled = couponDetail({ user, coupon: faceOf({ status: 'recycled' }), codes: [], redemptions: [], csrf: 'csrf-token', flash: null });
  assert.ok(!recycled.includes('action="/admin/coupons/7/codes"'), '回收站中的券面不能创建券码');
});

test('券码详情：二维码、复制链接、PNG 与单独状态操作', () => {
  const html = codeDetail({ user, code: codeOf(), redemptions: [
    { redeemed_at: '2026-09-24T12:00:00.000Z', confirmation_code: 'ABC-DEF', source_ip: '1.1.1.1', user_agent: 'agent/1.0', email_status: 'sent' }
  ], csrf: 'csrf-token', flash: null });
  assert.match(html, /href="\/admin\/coupons\/7">← 返回优惠券/, '要能返回所属券面');
  assert.match(html, /<h1>张三的券<\/h1>/, '标题用券码名称');
  assert.match(html, /<code>cd-AbCdEfGh1234<\/code>/, '页面要显示券码 ID');
  assert.match(html, /<dt>券码名显示<\/dt><dd>跟随全局设置<\/dd>/, '默认展示跟随全局');
  assert.match(html, /name="show_name"[\s\S]{0,160}value="" selected/, '改名表单带显示覆写下拉，默认跟随全局');
  const hiddenCode = codeDetail({ user, code: codeOf({ show_name: 0 }), redemptions: [], csrf: 'csrf-token', flash: null });
  assert.match(hiddenCode, /<dt>券码名显示<\/dt><dd>始终隐藏<\/dd>/);
  assert.match(hiddenCode, /value="0" selected>始终隐藏/);
  assert.match(html, /src="\/admin\/codes\/cd-AbCdEfGh1234\/qrcode"/, '二维码按券码生成');
  assert.match(html, /data-copy-link="\/admin\/codes\/cd-AbCdEfGh1234\/link"/, '复制链接走接口，不把 Token 写进 HTML');
  assert.match(html, /href="\/admin\/codes\/cd-AbCdEfGh1234\/open"/);
  assert.match(html, /href="\/admin\/codes\/cd-AbCdEfGh1234\/image"[^>]*>下载券面 PNG/);
  assert.match(html, />停用这张券码</, '可单独停用');
  assert.match(html, /移入回收站/);
  assert.match(html, /action="\/admin\/codes\/cd-AbCdEfGh1234\/name"/, '可改券码名称');
  assert.match(html, /action="\/admin\/codes\/cd-AbCdEfGh1234\/note"/, '可单独改备注');
  assert.match(html, /已核销<\/dt><dd>1 \/ 3 次（剩余 2 次）/);
  assert.ok(!html.includes('/r/'), '后台页面不应直接暴露 Token 链接');

  const recycled = codeDetail({ user, code: codeOf({ status: 'recycled', current_state: 'recycled' }), redemptions: [], csrf: 'csrf-token', flash: null });
  assert.match(recycled, /从回收站恢复/);
  assert.match(recycled, /action="\/admin\/codes\/cd-AbCdEfGh1234\/purge"/, '超管可永久删除券码');
  const bizRecycled = codeDetail({ user: { ...user, role: 'business_admin' }, code: codeOf({ status: 'recycled', current_state: 'recycled' }), redemptions: [], csrf: 'csrf-token', flash: null });
  assert.ok(!bizRecycled.includes('/purge'), '业务管理员不能永久删除券码');
});

test('券码被券面停用时给出联动提示', () => {
  const html = codeDetail({ user, code: codeOf({ face_status: 'disabled', current_state: 'disabled' }), redemptions: [], csrf: 'csrf-token', flash: null });
  assert.match(html, /所属券面已被停用/, '提示先恢复券面');
});

test('核销记录显示中文邮件状态', () => {
  const html = couponDetail({ user, coupon: faceOf({ id: 1, max_uses: 1 }), codes: [], csrf: 'csrf-token', flash: null, redemptions: [
    { redeemed_at: '2026-09-24T12:00:00.000Z', confirmation_code: 'R1', source_ip: '1.1.1.1', email_status: 'skipped' },
    { redeemed_at: '2026-09-24T12:00:00.000Z', confirmation_code: 'R2', source_ip: '1.1.1.1', email_status: 'failed' }
  ] });
  assert.match(html, /未启用邮件/);
  assert.match(html, /发送失败/);
});

test('核销凭证查询页：表单 + 成功/查不到/格式错三态，且不泄露后台信息', () => {
  const form = verifyPage();
  assert.match(form, /action="\/verify"/, 'GET 表单，结果页可直接分享 URL');
  assert.match(form, /name="code"/);
  assert.match(form, /72 小时/, '要写清保留期');
  assert.match(verifyPage({ verifyHours: 48 }), /48 小时/, '保留小时数由后台配置传入');
  assert.match(form, /核销凭证查询/);

  const ok = verifyPage({ code: 'K7M-2QD', result: { kind: 'ok', row: {
    confirmation_code: 'K7M-2QD', redeemed_at: '2026-09-24T12:00:00.000Z', face_name: '测试券', code_name: '张三的券', email_status: 'sent'
  } } });
  assert.match(ok, /这是真实的核销记录/);
  assert.match(ok, /测试券 - 张三的券/, '显示券面名 - 券码名');
  assert.match(ok, /核销时间：2026-09-24 20:00:00/, '北京时间（UTC 存储 +8）');
  assert.match(ok, /邮件通知：已发送/, '展示邮件通知状态');
  assert.match(ok, /verify-code sm/, '确认码缩为顶部小标题');
  assert.match(ok, /result-lead big/, '券面/券码是视觉重心');
  assert.match(ok, /data-code="K7M-2QD"/);
  assert.ok(!ok.includes('verify-form'), '结果页不再放查询表单');
  assert.match(ok, /class="verify-next" href="\/verify">查询下一个</, '改为底部居中的查询下一个长条按钮');
  assert.ok(!ok.includes('查询不区分大小写'), '结果页不显示查询提示文案');
  assert.match(form, /查询不区分大小写/, '查询表单页保留提示文案');
  assert.ok(!ok.includes('来源 IP'), '不显示来源 IP');
  assert.ok(!ok.includes('备注'), '不显示券码备注');
  assert.ok(!ok.includes('/r/'), '不暴露核销链接');

  const unknown = verifyPage({ code: 'ABC-DEF', result: { kind: 'unknown' } });
  assert.match(unknown, /查不到这个确认码/);
  assert.match(unknown, /result unknown/, '查不到用中性灰色面板，不武断定性');
  assert.ok(!unknown.includes('verify-form'), '查不到结果同样不放输入框');
  assert.match(unknown, /查询下一个/);

  const invalid = verifyPage({ code: 'x', result: { kind: 'invalid' } });
  assert.match(invalid, /确认码格式不对/);
  assert.match(invalid, /result failed/);
  assert.match(invalid, /查询下一个/);
});

test('限流提示页（429）：人话说明，后台变体带返回入口', () => {
  const pub = rateLimited();
  assert.match(pub, /请求太频繁/);
  assert.match(pub, /防止机器反复刷接口/);
  assert.ok(!pub.includes('href="/admin"'), '公开变体不含后台入口');
  const adm = rateLimited('请求太频繁了，请约 10 分钟后再试。', true);
  assert.match(adm, /请约 10 分钟后再试/, '带具体等待时间');
  assert.match(adm, /href="\/admin"/, '后台变体给返回入口');
});

test('权限不足页', () => {
  const html = forbidden({ username: 'biz', role: 'business_admin', csrf: 'csrf-token' });
  assert.match(html, /权限不足/);
  assert.match(html, /业务管理员/);
  assert.match(html, /返回概览/);
});

test('列表与概览：合并日期列、无更新时间列、券码统计列', () => {
  const html = couponsPage({ user, csrf: 'csrf-token', flash: null, coupons: [
    { id: 1, name: 'A', offer_text: 'x', used_count: 0, max_uses: 1, code_total: 3, code_available: 2, used_total: 4, starts_on: '2026-09-01', expires_on: '2026-10-01', updated_at: '2026-09-24T12:00:00.000Z', current_state: 'valid' },
    { id: 2, name: 'B', offer_text: 'x', used_count: 0, max_uses: 1, starts_on: null, expires_on: '2026-10-01', updated_at: '2026-09-24T12:00:00.000Z', current_state: 'valid' },
    { id: 3, name: 'C', offer_text: 'x', used_count: 0, max_uses: 1, starts_on: '2026-09-01', expires_on: null, updated_at: '2026-09-24T12:00:00.000Z', current_state: 'valid' },
    { id: 4, name: 'D', offer_text: 'x', used_count: 0, max_uses: 1, starts_on: null, expires_on: null, updated_at: '2026-09-24T12:00:00.000Z', current_state: 'valid' }
  ] });
  assert.ok(!html.includes('更新时间'), '不应再显示更新时间列');
  assert.ok(!html.includes('2026-09-24T12:00'), '不应出现更新时间数据');
  assert.match(html, /<th>日期<\/th>/);
  assert.match(html, /2026-09-01 ~ 2026-10-01/, '起止都有');
  assert.match(html, /即日起 ~ 2026-10-01/, '只有截止');
  assert.match(html, /2026-09-01 ~ 永久/, '只有起始');
  assert.match(html, /永久/);
  assert.match(html, /已发 3 张 · 可用 2 张/, '券码列显示已发/可用');
  assert.match(html, /累计核销 4 次/);
  const dash = dashboard({ user, csrf: 'csrf-token', flash: null, coupons: [], stats: { valid: 0, used: 0, expiring: 0, recycled: 0 } });
  assert.ok(!dash.includes('更新时间'), '概览也不应有更新时间列');
  assert.match(dash, /<th>日期<\/th>/);
  assert.match(dash, /<th>券码<\/th>/, '概览列名改为券码');
  assert.match(dash, /<span>可用券码<\/span>/, '统计口径改为可用券码');
});

test('券详情有返回、刷新与券码列表', () => {
  const html = couponDetail({ user, csrf: 'csrf-token', flash: null, redemptions: [], codes: [], coupon: faceOf() });
  assert.match(html, /class="back" href="\/admin\/coupons">← 返回优惠券列表/);
  assert.match(html, /href="\/admin\/coupons\/7">刷新</);
  assert.match(html, /href="\/admin\/coupons\/7\/edit"/, '可编辑券面');
  assert.ok(!html.includes('/r/'), '后台页面不应直接暴露 Token 链接');

  const recycled = couponDetail({ user, csrf: 'csrf-token', flash: null, redemptions: [], codes: [], coupon: faceOf({ status: 'recycled', current_state: 'recycled' }) });
  assert.match(recycled, /class="back" href="\/admin\/recycle">← 返回回收站/, '回收站内的券返回回收站');
});

test('回收站页：券面与券码两栏、恢复入口与导航', () => {
  const html = recyclePage({ user, csrf: 'csrf-token', flash: null, faces: [
    { id: 3, name: '旧券', offer_text: 'x', starts_on: null, expires_on: null, recycled_at: '2026-09-24T12:00:00.000Z', current_state: 'recycled' }
  ], codes: [
    { id: 'cd-Qq1Ww2Ee3Rr4', face_id: 3, name: '李四的码', face_name: '旧券', offer_text: 'x', note: '李四', used_count: 1, max_uses: 2, starts_on: null, expires_on: null, recycled_at: '2026-09-24T12:00:00.000Z', current_state: 'recycled' }
  ] });
  assert.match(html, /← 返回优惠券列表/);
  assert.match(html, /优惠券（券面）/);
  assert.match(html, /<h2>券码<\/h2>/, '券码单独一栏');
  assert.match(html, /action="\/admin\/coupons\/3\/status"/);
  assert.match(html, /action="\/admin\/codes\/cd-Qq1Ww2Ee3Rr4\/status"/, '券码也要能恢复');
  assert.match(html, /name="status" value="active"/);
  assert.match(html, /2026-09-24 20:00/, '移入时间按北京时间显示（UTC+8）');
  assert.match(html, /李四/, '券码要显示备注便于认领');
  assert.ok(!html.includes('/purge'), '永久删除不放在回收站列表，保留在详情页勾选确认');
  assert.match(html, /移入满 30 天后自动永久删除/, '默认保留天数写进说明');

  const tuned = recyclePage({ user, csrf: 'csrf-token', flash: null, faces: [], codes: [], purgeDays: 7 });
  assert.match(tuned, /移入满 7 天后自动永久删除/, '保留天数可由后台配置传入');

  const empty = recyclePage({ user, csrf: 'csrf-token', flash: null, faces: [], codes: [] });
  assert.match(empty, /没有回收的优惠券/);
  assert.match(empty, /没有回收的券码/);

  // 导航：两种角色都能看到回收站入口，业务管理员看不到账号/设置
  const biz = recyclePage({ user: { ...user, role: 'business_admin' }, csrf: 'csrf-token', flash: null, faces: [], codes: [] });
  assert.match(biz, /href="\/admin\/recycle"/);
  assert.match(biz, /href="\/admin\/redemptions">核销记录/, '核销记录入口对业务管理员也开放');
  assert.ok(!biz.includes('href="/admin/users"'), '业务管理员不应看到账号入口');
});

test('优惠券列表与概览带回收站入口', () => {
  const list = couponsPage({ user, csrf: 'csrf-token', flash: null, coupons: [] });
  assert.match(list, /href="\/admin\/recycle">前往回收站/);
  const dash = dashboard({ user, csrf: 'csrf-token', flash: null, coupons: [], stats: { valid: 0, used: 0, expiring: 0, recycled: 2 } });
  assert.match(dash, /class="stat-link" href="\/admin\/recycle"/, '回收站统计应可点击');
  assert.match(dash, /最近核销/, '概览要有最近核销面板');
  assert.match(dash, /href="\/admin\/redemptions">全部核销记录/, '面板提供总记录入口');
  assert.match(dash, /还没有核销记录/, '无记录时给空状态');

  const dash2 = dashboard({ user, csrf: 'csrf-token', flash: null, coupons: [], stats: { valid: 0, used: 1, expiring: 0, recycled: 0 },
    redemptions: [{ redeemed_at: '2026-09-24T12:00:00.000Z', coupon_id: 3, face_name: '测试券', code_name: '张三的券', confirmation_code: 'HLZ-B7T', email_status: 'sent' }] });
  assert.match(dash2, /2026-09-24 20:00/, '时间按北京时间');
  assert.match(dash2, /href="\/admin\/coupons\/3"/, '可跳券面详情');
  assert.match(dash2, /测试券/);
  assert.match(dash2, /张三的券/);
  assert.match(dash2, /HLZ-B7T/);
  assert.match(dash2, /已发送/);
});

test('创建/编辑页有返回按钮与日期输入占位', () => {
  const create = couponForm({ user, csrf: 'csrf-token', coupon: null, presets: [], flash: null });
  assert.match(create, /class="back" href="\/admin\/coupons">← 返回优惠券列表/);
  assert.match(create, /class="date-input" name="startsOn"/);
  assert.match(create, /data-placeholder="留空 = 即刻生效"/);
  assert.match(create, /data-placeholder="留空 = 长期有效"/);
  assert.match(create, /每张券码可用次数/, '次数口径要写清是每张券码');
  assert.match(create, /先建“券面”/, '创建页要解释券面与券码的关系');
  const edit = couponForm({ user, csrf: 'csrf-token', presets: [], flash: null, coupon: {
    id: 9, name: '券', offer_text: 'x', max_uses: 1, used_count: 0, starts_on: '2026-09-01', expires_on: ''
  } });
  assert.match(edit, /class="back" href="\/admin\/coupons\/9">← 返回详情/);
  assert.match(edit, /value="2026-09-01"/);
});

test('个人账号页有返回概览', () => {
  const html = profilePage({ user, csrf: 'csrf-token', flash: null });
  assert.match(html, /class="back" href="\/admin">← 返回概览/);
});

test('状态配色：可核销绿 / 用尽与过期黄 / 未启用蓝 / 禁用红 / 回收站灰', () => {
  const css = readFileSync(new URL('../public/app.css', import.meta.url), 'utf8');
  assert.match(css, /--info:#1d4ed8/);
  assert.match(css, /\.coupon-state\.valid,\.badge\.valid\{color:var\(--good\)/);
  assert.match(css, /\.coupon-state\.not_started,\.badge\.not_started\{color:var\(--info\)/);
  assert.match(css, /\.coupon-state\.exhausted,\.coupon-state\.expired,\.badge\.exhausted,\.badge\.expired\{color:var\(--warn\)/);
  assert.match(css, /\.coupon-state\.disabled,\.badge\.disabled\{color:var\(--bad\)/);
  assert.match(css, /\.coupon-state\.recycled,\.badge\.recycled\{color:var\(--muted\)/);
  assert.match(css, /\.table-scroll\{max-height:\d+px;overflow-y:auto;overflow-x:hidden\}/, '券码列表限高滚动，且不出横向滚动条');
  assert.match(css, /\.table-scroll td\.row-ops\{min-width:0;white-space:normal\}/, '操作列可收缩、按钮组可折行');
  assert.match(css, /\.table-scroll td\{overflow-wrap:anywhere\}/, '长文本可换行，表格不被撑宽');
  assert.match(css, /\.table-scroll td:nth-child\(3\)\{white-space:nowrap\}/, '已用列不折行');
  assert.match(css, /\.badge\{white-space:nowrap\}/, '状态徽标不折行');
  assert.match(css, /\.detail-grid\{display:grid;grid-template-columns:minmax\(0,2fr\) minmax\(0,3fr\)/, '券面信息用窄列、券码列表用宽列');
});

test('三态主题：浅色变量中枢 + 深色双入口', () => {
  const css = readFileSync(new URL('../public/app.css', import.meta.url), 'utf8');
  // 浅色中枢：规则只从 var() 取色，浅色字面值集中在 :root
  assert.match(css, /:root\{color-scheme:light;--ink:#172033/, '浅色值与 color-scheme:light 定义于 :root');
  assert.match(css, /body\{margin:0;background:var\(--page-bg\)/, '页面底走变量');
  assert.match(css, /background:var\(--badge-valid-bg\)/, '徽章底走变量');
  assert.match(css, /\.landing-body\{--accent-deep:#c1403c;background:var\(--landing-grad\)/, '落地页渐变走变量');
  // 深色双入口：显式选择 与 系统偏好（未被强制浅色）
  assert.match(css, /:root\[data-theme="dark"\]\{/, '入口①：html[data-theme=dark]');
  assert.match(css, /@media \(prefers-color-scheme:dark\)\{\s*:root:not\(\[data-theme="light"\]\)\{/, '入口②：系统深色且未强制浅色');
  assert.equal((css.match(/--ink:var\(--dk-ink\)/g) || []).length, 2, '映射表恰好两份');
  assert.equal((css.match(/color-scheme:dark;/g) || []).length, 2, '两个入口都声明深色 color-scheme');
  // 深色阴影短行程（消除深底大渐变断层），卡片层次由 1px 边框承担
  assert.match(css, /--dk-shadow-card:0 2px 6px rgba\(0,0,0,\.4\),0 8px 18px rgba\(0,0,0,\.28\)/, '深色卡片阴影为短行程低透明');
  assert.match(css, /border:var\(--card-border,0\) solid var\(--line\)/, '卡片边框：浅色回退 0、深色取 1px');
  assert.match(css, /--dk-card-border:1px/, '深色启用 1px 边框分层');
  assert.match(css, /--dk-good:#35c48f/, '语义色在深色下整体提亮');
});

test('主题开关：页脚三态按钮 + theme.js 前置加载', () => {
  const html = login('csrf-token');
  assert.match(html, /<script src="\/assets\/theme\.js"><\/script>/, 'theme.js 同步加载');
  assert.ok(html.indexOf('/assets/theme.js') < html.indexOf('</head>'), '位于 head 内，渲染前落 data-theme 防闪烁');
  assert.match(html, /data-theme-set="system" aria-pressed="true"/, '默认跟随系统为按下态');
  assert.match(html, /data-theme-set="light"/, '浅色按钮');
  assert.match(html, /data-theme-set="dark"/, '深色按钮');
  assert.ok(html.indexOf('theme-switch') < html.indexOf('</footer>'), '开关在页脚内');
  const js = readFileSync(new URL('../public/theme.js', import.meta.url), 'utf8');
  assert.match(js, /qnqupon-theme/, 'localStorage 键');
  assert.match(js, /removeAttribute\('data-theme'\)/, '跟随系统即移除属性，交回媒体查询');
  assert.ok(js.includes("localStorage.setItem(KEY, v)"), '选择写入 localStorage 持久化');
  assert.ok(js.includes("VALID[v] ? v : 'system'"), '只接受三态合法值，异常回退跟随系统');
});

test('核销二次确认：标题与提示可由页面指定', () => {
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /dataset\.confirmTitle/, '模态框应读取 data-confirm-title');
  assert.match(app, /data-copy-link/, '复制券码链接由 JS 走接口');
  assert.match(app, /execCommand\('copy'\)/, 'http 局域网没有剪贴板 API，要有兜底');
  const html = publicCoupon({
    face_name: '测试券', offer_text: '立减 10', description: null, instructions: null, store_text: null,
    starts_on: null, expires_on: null, max_uses: 5, used_count: 0, current_state: 'valid'
  }, 'pub-csrf', { token: 'tok' });
  assert.match(html, /data-confirm-title="确认核销吗？"/);
  assert.match(html, /扣除一次可用次数，且无法撤销/);
  assert.match(html, /由店员点击/);
});

test('列表刷新按钮与概览时区说明', () => {
  const list = couponsPage({ user, csrf: 'csrf-token', flash: null, coupons: [] });
  assert.match(list, /<div class="actions"><a class="secondary button" href="\/admin\/coupons">刷新<\/a>/);
  assert.match(list, /href="\/admin\/coupons\/new">创建优惠券</);

  const recycle = recyclePage({ user, csrf: 'csrf-token', flash: null, faces: [], codes: [] });
  assert.match(recycle, /<div class="actions"><a class="secondary button" href="\/admin\/recycle">刷新<\/a>/);

  const dash = dashboard({ user, csrf: 'csrf-token', flash: null, coupons: [], stats: { valid: 1, used: 2, expiring: 3, recycled: 0 } });
  assert.match(dash, /北京时间（Asia\/Shanghai）/, '概览要说明时间口径');
  assert.ok(!dash.includes('北京时间 ·'), '不再用容易被当成时间的旧文案');
  assert.match(dash, /30 天内到期/, '临期天数缺省回退 30');
  assert.match(dashboard({ user, csrf: 'csrf-token', flash: null, coupons: [], stats: { valid: 1, used: 2, expiring: 3, recycled: 0, expiringDays: 14 } }), /14 天内到期/, '临期天数由后台配置传入');

  const tuned = couponsPage({ user, csrf: 'csrf-token', flash: null, coupons: [], purgeDays: 7 });
  assert.match(tuned, /回收站保留 7 天/, '列表页保留天数可由后台配置传入');
});

test('服务设置页：数据保留策略表单与默认值回退', () => {
  const html = settingsPage({ user, csrf: 'csrf-token', flash: null, settings: {} });
  assert.match(html, /action="\/admin\/settings\/retention"/);
  assert.match(html, /name="recycleDays"[^>]*value="30"/, '未配置时回退默认 30 天');
  assert.match(html, /name="purgeDays"[^>]*value="30"/);
  assert.match(html, /name="verifyHours"[^>]*value="72"/, '确认码默认 72 小时');
  assert.match(html, /name="expiringDays"[^>]*value="30"/);
  assert.match(html, /min="1" max="720"/, '小时数上限与服务端校验一致');

  const tuned = settingsPage({ user, csrf: 'csrf-token', flash: null, settings: { recycleDays: '7', purgeDays: '14', verifyHours: '48', expiringDays: '3' } });
  assert.match(tuned, /name="recycleDays"[^>]*value="7"/);
  assert.match(tuned, /name="verifyHours"[^>]*value="48"/);

  const dirty = settingsPage({ user, csrf: 'csrf-token', flash: null, settings: { recycleDays: 'abc', purgeDays: '9999' } });
  assert.match(dirty, /name="recycleDays"[^>]*value="30"/, '非法存量值回退默认');
  assert.match(dirty, /name="purgeDays"[^>]*value="30"/, '越界存量值回退默认');
});

test('服务设置页：券面展示开关（默认开启、可关闭）', () => {
  const html = settingsPage({ user, csrf: 'csrf-token', flash: null, settings: {} });
  assert.match(html, /action="\/admin\/settings\/display"/, '展示开关有独立表单');
  assert.match(html, /name="showCodeName"[^>]*checked/, '未配置时默认勾选（显示券码名）');
  assert.match(html, /单张券码可在其详情页单独覆写/, '要说明覆写入口');

  const off = settingsPage({ user, csrf: 'csrf-token', flash: null, settings: { showCodeName: 'false' } });
  assert.ok(!/name="showCodeName"[^>]*checked/.test(off), '关闭后不勾选');
});

test('核销记录总页：筛选表单、分页链接与表格列', () => {
  const html = redemptionsPage({ user, csrf: 'csrf-token', flash: null,
    coupons: [{ id: 3, name: '旧券', status: 'active' }, { id: 5, name: '停用券', status: 'disabled' }],
    rows: [{ redeemed_at: '2026-09-24T12:00:00.000Z', coupon_id: 3, code_id: 'cd-Qq1Ww2Ee3Rr4', code_name: '李四的码', code_note: '李四', confirmation_code: 'HLZ-B7T', source_ip: '1.1.1.1', email_status: 'sent' }],
    total: 41, page: 2, pages: 3,
    filters: { coupon: '3', from: '2026-09-01', to: '' } });
  assert.match(html, /action="\/admin\/redemptions"/, 'GET 表单，结果 URL 可分享');
  assert.match(html, /method="get"/);
  assert.match(html, /name="coupon"[\s\S]{0,400}?value="3" selected/, '券面下拉回显选中');
  assert.match(html, /（已停用）/, '下拉标注停用状态');
  assert.match(html, /name="from" value="2026-09-01"/, '开始日期回显');
  assert.match(html, /41 条/, '总条数可见');
  assert.match(html, /第 2 \/ 3 页/, '页码可见');
  assert.match(html, /2026-09-24 20:00/, '时间按北京时间');
  assert.match(html, /href="\/admin\/coupons\/3"/, '券面可跳详情');
  assert.match(html, /href="\/admin\/codes\/cd-Qq1Ww2Ee3Rr4"/, '券码可跳详情');
  assert.match(html, /HLZ-B7T/);
  assert.match(html, /1\.1\.1\.1/, '后台可见来源 IP');
  assert.match(html, /已发送/);
  assert.match(html, /href="\/admin\/redemptions\?coupon=3&from=2026-09-01">上一页/, '翻页保留筛选条件，第 1 页省略 page 参数');
  assert.match(html, /href="\/admin\/redemptions\?coupon=3&from=2026-09-01&page=3">下一页/);

  const empty = redemptionsPage({ user, csrf: 'csrf-token', flash: null, coupons: [], rows: [], total: 0, page: 1, pages: 1, filters: { coupon: '', from: '', to: '' } });
  assert.match(empty, /没有符合条件的核销记录/);
  assert.ok(!empty.includes('上一页'), '无结果不显示翻页');
  assert.ok(!empty.includes('page='), '第 1 页链接不带 page 参数');
});

test('审计页：筛选表单、分页链接与表格列', () => {
  const html = auditPage({ user, csrf: 'csrf-token', flash: null,
    prefixes: ['auth', 'coupon'],
    users: [{ id: 1, username: 'superadmin', role: 'super_admin', active: 1 }, { id: 2, username: 'biz', role: 'business_admin', active: 0 }],
    logs: [{ created_at: '2026-09-24T12:00:00.000Z', username: 'superadmin', action: 'coupon.create', target_type: 'coupon', target_id: 7, source_ip: '10.0.0.9' }],
    total: 41, page: 2, pages: 3,
    filters: { action: 'coupon', actor: '2', from: '2026-09-01', to: '' } });
  assert.match(html, /action="\/admin\/audit"/, 'GET 表单，结果 URL 可分享');
  assert.match(html, /method="get"/);
  assert.match(html, /value="coupon" selected/, '类别回显选中');
  assert.match(html, /value="2" selected/, '操作人回显选中');
  assert.match(html, /biz（已停用）/, '停用账号在下拉里标注');
  assert.match(html, /superadmin（超管）/);
  assert.match(html, /name="from" value="2026-09-01"/, '日期回显');
  assert.match(html, /41 条/);
  assert.match(html, /第 2 \/ 3 页/);
  assert.match(html, /2026-09-24 20:00/, '时间按北京时间');
  assert.match(html, /coupon 7/, '对象列');
  assert.match(html, /10\.0\.0\.9/, '来源 IP 列');
  assert.match(html, /href="\/admin\/audit\?action=coupon&actor=2&from=2026-09-01">上一页/, '翻页保留筛选，第 1 页省略 page');
  assert.match(html, /href="\/admin\/audit\?action=coupon&actor=2&from=2026-09-01&page=3">下一页/);
  assert.ok(html.includes('反向代理的访问日志'), '说明读取类日志由反代负责');

  const empty = auditPage({ user, csrf: 'csrf-token', flash: null, prefixes: [], users: [], logs: [], total: 0, page: 1, pages: 1, filters: { action: '', actor: '', from: '', to: '' } });
  assert.match(empty, /没有符合条件的记录/);
  assert.ok(!empty.includes('上一页'), '无结果不显示翻页');
});

test('首页：产品介绍、源码链接与 meta description', () => {
  const html = home();
  assert.match(html, /<title>QNQupon · 券能行 — 自托管不记名优惠券系统<\/title>/, '首页标题自带品牌与定位');
  assert.match(html, /<meta name="description" content="/, '供搜索引擎收录的描述');
  assert.ok(html.includes('https://github.com/QNLanYang/QNQupon'), '首屏含源码仓库链接');
  assert.ok(html.includes('自托管不记名优惠券系统'), '产品定位文案');
  assert.ok(html.includes('feature-grid'), '特性卡片区域');
  assert.ok(html.includes('href="/verify"'), '提供防伪查询入口');
  assert.ok(html.includes('landing-body'), '宽版落地容器');
  assert.ok(html.includes('三步就能用起来') && html.includes('class="step-no"'), '三步用法区');
  assert.ok(html.includes('代码完全开源'), '开源收尾区');
});

test('全站页脚：版权与源码链接覆盖公开页、登录页与后台页', () => {
  const pages = [
    ['公开券页', publicCoupon(null, '')],
    ['查询页', verifyPage({})],
    ['登录页', login('csrf-token')],
    ['限流页', rateLimited()],
    ['权限页', forbidden(user)],
    ['后台页', presetsPage({ user, presets: [], csrf: 'csrf-token', flash: null })]
  ];
  for (const [name, html] of pages) {
    assert.ok(html.includes('© 2026 QNLanYang (全能岚漾)'), `${name} 含版权行`);
    assert.ok(html.includes('https://github.com/QNLanYang/QNQupon'), `${name} 含源码链接`);
    assert.ok(html.includes('site-footer'), `${name} 含页脚元素`);
  }
});

test('登录页人机验证：配置密钥才渲染组件与第三方脚本，关闭时零痕迹', () => {
  const off = login('csrf-token');
  assert.ok(!off.includes('cf-turnstile'), '未配置时不应出现组件占位');
  assert.ok(!off.includes('challenges.cloudflare.com'), '未配置时不应引用第三方域名');
  const on = login('csrf-token', null, 'test-sitekey-123');
  assert.ok(on.includes('class="cf-turnstile"'), '应渲染人机验证组件占位');
  assert.ok(on.includes('data-sitekey="test-sitekey-123"'), '组件应携带 sitekey');
  assert.ok(on.includes('data-theme="auto"'), '组件主题跟随系统，与全站默认态一致');
  assert.ok(on.includes('data-language="zh-CN"'), '组件界面用中文');
  assert.ok(on.includes('https://challenges.cloudflare.com/turnstile/v0/api.js'), '应加载官方组件脚本');
  assert.ok(on.includes('data-action="admin-login"'), '组件应带 action 便于审计关联');
});
