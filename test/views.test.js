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
  const selfRow = html.match(/<tr><td data-label="用户名">superadmin[\s\S]*?<\/tr>/)[0];
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

test('券面详情：可编辑时有停用/删除，回收站只有恢复+永久删除', () => {
  const active = couponDetail({ user, coupon: faceOf(), codes: [codeOf(), codeOf({ id: 'cd-Zz9Yy8Xx7Ww6', name: '停用的码', note: null, status: 'disabled', current_state: 'disabled' })], redemptions: [], csrf: 'csrf-token', flash: null });
  assert.match(active, /class="danger">删除<\/button>/);
  assert.match(active, />停用整张券</);
  assert.match(active, /name="return" value="\/admin\/coupons\/7"/, '状态操作送回原页，不再跳转');
  assert.match(active, /券码（2）/, '要列出该券面下的券码');
  assert.match(active, /停用<\/button>/, '单张券码可单独停用');
  assert.ok(!active.includes('从回收站恢复'));
  assert.ok(!active.includes('>详情</a>'), '券码名可点进详情，行内不再重复放「详情」按钮');
  assert.match(active, /href="\/admin\/codes\/cd-AbCdEfGh1234\/open"[^>]*>核销页<\/a>/, '券码行点「核销页」直接跳客人核销页');

  const recycled = couponDetail({ user, coupon: faceOf({ status: 'recycled', current_state: 'recycled' }), codes: [], redemptions: [], csrf: 'csrf-token', flash: null });
  assert.match(recycled, /从回收站恢复/);
  assert.match(recycled, /action="\/admin\/coupons\/7\/purge"/);
  assert.ok(!recycled.includes('>删除<'), '回收站内不应再显示删除按钮');
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
  assert.match(html, /留空自动命名/, '要写清楚留空的默认行为');
  assert.match(html, /名称仅作展示，可重复/, '名称可重复');
  assert.ok(!html.includes('不与已有券码重名'), '不再宣称券码名唯一');
  assert.match(html, /name="show_name"[\s\S]{0,160}跟随全局设置[\s\S]{0,120}始终显示[\s\S]{0,120}始终隐藏/, '创建时可选券码名显示覆写');
  assert.match(html, /name="note"/, '创建时可填发给谁的备注');
  assert.match(html, /name="count" id="code-count" type="number" min="1" max="100"/, '创建表单带生成数量（数量 1 = 单张，>1 = 批量）');
  assert.match(html, /class="head-actions"><button class="primary" id="code-submit" type="submit" form="code-create-form">创建券码<\/button><\/div><\/div><form id="code-create-form"/, '创建按钮移到面板标题行右侧，用 form 属性关联表单');
  assert.match(html, /位数与数量同宽，如 25 张 → <code>#01<\/code>…#25/, '批量编号规则收进 ❓ 说明');
  assert.match(html, /券码名默认不显示/, '批量生成的券码名默认隐藏');
  assert.match(html, /class="tip"><button type="button" aria-label="本面板说明">\?<\/button>/, '面板说明收进右上角 ❓（纯 CSS 气泡）');
  assert.ok(!html.includes('class="muted">每张券码有独立'), '面板里不再铺平整段说明');
  assert.ok(!html.includes('/codes/batch'), '批量与单张是同一个表单，不另设独立入口');
  assert.match(html, /class="table-scroll"><table>/, '券码列表要限高、超出滚动');
  assert.match(html, /还没有券码/, '空状态要解释“没有券码不能发出去”');
  assert.match(html, /x · 3 次\/张 · <span class="badge/, '次数口径移到标题副标题：优惠内容 · 次数/张 · 状态');
  assert.match(html, /<dt>数量<\/dt><dd>共 \d+ \/ 可用 \d+<\/dd>/, '数量/可用省略单位，便于双列并排');
  assert.match(html, /<dt>核销<\/dt><dd>\d+ 次<\/dd>/, '核销次数');
  assert.ok(!html.includes('/admin/coupons/7/qrcode'), '券码的二维码在券码详情里，不在券面');

  const appJs = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(appJs, /#code-count[\s\S]{0,200}#code-show-name[\s\S]{0,600}批量生成/, '数量 > 1 时前端把「券码名显示」锁为隐藏、按钮切换为批量文案');

  const recycled = couponDetail({ user, coupon: faceOf({ status: 'recycled' }), codes: [], redemptions: [], csrf: 'csrf-token', flash: null });
  assert.ok(!recycled.includes('action="/admin/coupons/7/codes"'), '回收站中的券面不能创建券码');
});

test('券码详情：二维码、复制链接、PNG 与单独状态操作', () => {
  const html = codeDetail({ user, code: codeOf(), redemptions: [
    { redeemed_at: '2026-09-24T12:00:00.000Z', confirmation_code: 'ABC-DEF', source_ip: '1.1.1.1', user_agent: 'agent/1.0', email_status: 'sent' }
  ], csrf: 'csrf-token', flash: null });
  assert.match(html, /class="back-arrow" href="\/admin\/coupons\/7"/, '要能返回所属券面');
  assert.match(html, /<h1>张三的券<\/h1>/, '标题用券码名称');
  assert.match(html, /<code>cd-AbCdEfGh1234<\/code>/, '页面要显示券码 ID');
  assert.match(html, /<dt>券码名显示<\/dt><dd>跟随全局设置<\/dd>/, '默认展示跟随全局');
  assert.match(html, /name="show_name"[\s\S]{0,160}value="" selected/, '改名表单带显示覆写下拉，默认跟随全局');
  const hiddenCode = codeDetail({ user, code: codeOf({ show_name: 0 }), redemptions: [], csrf: 'csrf-token', flash: null });
  assert.match(hiddenCode, /<dt>券码名显示<\/dt><dd>始终隐藏<\/dd>/);
  assert.match(hiddenCode, /value="0" selected>始终隐藏/);
  assert.match(html, /src="\/admin\/codes\/cd-AbCdEfGh1234\/qrcode"/, '二维码按券码生成');
  assert.ok(!html.includes('data-copy-link'), '券码详情已移除「复制核销链接」按钮，且不把 Token 写进 HTML');
  assert.match(html, /href="\/admin\/codes\/cd-AbCdEfGh1234\/open"/);
  assert.match(html, /href="\/admin\/codes\/cd-AbCdEfGh1234\/image"[^>]*>下载优惠券/);
  assert.match(html, /href="\/admin\/codes\/cd-AbCdEfGh1234\/image\?inline=1"[^>]*>预览优惠券/, '预览按钮新标签页内联打开');
  assert.match(html, />停用<\/button>/, '可单独停用（文案精简）');
  assert.match(html, /class="danger">删除<\/button>/);
  assert.match(html, /name="return" value="\/admin\/codes\/cd-AbCdEfGh1234"/, '状态操作送回原页，不再跳转');
  assert.match(html, /action="\/admin\/codes\/cd-AbCdEfGh1234\/name"/, '可改券码名称');
  assert.match(html, /action="\/admin\/codes\/cd-AbCdEfGh1234\/note"/, '可单独改备注');
  assert.match(html, /已核销<\/dt><dd class="wide">1 \/ 3 次（剩余 2 次）/, '已核销在手机档独占一行（.wide）');
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
  assert.match(html, /class="back-arrow" href="\/admin\/coupons" aria-label="返回优惠券列表"/, '返回是标题左侧的箭头');
  assert.match(html, /href="\/admin\/coupons\/7" data-refresh>刷新</);
  assert.match(html, /<div class="panel-head"><h2>券面信息<\/h2>[\s\S]*?<a class="secondary button" href="\/admin\/coupons\/7\/edit">编辑券面<\/a>/, '「编辑券面」放在券面信息卡片标题行');
  assert.ok(!html.includes('/r/'), '后台页面不应直接暴露 Token 链接');

  const recycled = couponDetail({ user, csrf: 'csrf-token', flash: null, redemptions: [], codes: [], coupon: faceOf({ status: 'recycled', current_state: 'recycled' }) });
  assert.match(recycled, /class="back-arrow" href="\/admin\/recycle" aria-label="返回回收站"/, '回收站内的券返回回收站');
});

test('回收站页：券面与券码两栏、恢复入口与导航', () => {
  const html = recyclePage({ user, csrf: 'csrf-token', flash: null, faces: [
    { id: 3, name: '旧券', offer_text: 'x', starts_on: null, expires_on: null, recycled_at: '2026-09-24T12:00:00.000Z', current_state: 'recycled' }
  ], codes: [
    { id: 'cd-Qq1Ww2Ee3Rr4', face_id: 3, name: '李四的码', face_name: '旧券', offer_text: 'x', note: '李四', used_count: 1, max_uses: 2, starts_on: null, expires_on: null, recycled_at: '2026-09-24T12:00:00.000Z', current_state: 'recycled' }
  ] });
  assert.match(html, /class="back-arrow" href="\/admin\/coupons"/);
  assert.match(html, /优惠券（券面）/);
  assert.match(html, /<h2>券码<\/h2>/, '券码单独一栏');
  assert.match(html, /action="\/admin\/coupons\/3\/status"/);
  assert.match(html, /action="\/admin\/codes\/cd-Qq1Ww2Ee3Rr4\/status"/, '券码也要能恢复');
  assert.match(html, /name="status" value="active"/);
  assert.ok(!html.includes('>详情</a>'), '券面/券码名可点进详情，行内不再重复放「详情」按钮');
  assert.match(html, /2026-09-24 20:00/, '移入时间按北京时间显示（UTC+8）');
  assert.match(html, /李四/, '券码要显示备注便于认领');
  assert.ok(!html.includes('/purge'), '永久删除不放在回收站列表，保留在详情页勾选确认');
  assert.match(html, /移入满 30 天自动永久删除/, '默认保留天数写进说明');

  const tuned = recyclePage({ user, csrf: 'csrf-token', flash: null, faces: [], codes: [], purgeDays: 7 });
  assert.match(tuned, /移入满 7 天自动永久删除/, '保留天数可由后台配置传入');

  const empty = recyclePage({ user, csrf: 'csrf-token', flash: null, faces: [], codes: [] });
  assert.match(empty, /没有回收的优惠券/);
  assert.match(empty, /没有回收的券码/);

  // 导航：顶栏不再有回收站入口（改由优惠券页与概览进入），业务管理员看不到账号/设置
  const biz = recyclePage({ user: { ...user, role: 'business_admin' }, csrf: 'csrf-token', flash: null, faces: [], codes: [] });
  assert.ok(!biz.includes('href="/admin/recycle">回收站<'), '顶栏不再放回收站入口');
  assert.match(biz, /href="\/admin\/recycle" data-refresh>刷新</, '回收站页自己的刷新按钮仍在');
  assert.match(biz, /href="\/admin\/redemptions">核销记录/, '核销记录入口对业务管理员也开放');
  assert.ok(!biz.includes('href="/admin/users"'), '业务管理员不应看到账号入口');
});

test('优惠券列表与概览带回收站入口', () => {
  const list = couponsPage({ user, csrf: 'csrf-token', flash: null, coupons: [] });
  assert.match(list, /href="\/admin\/recycle">回收站 →</, '保留回收站入口');
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

test('创建/编辑页有返回按钮与日期留空提示', () => {
  const create = couponForm({ user, csrf: 'csrf-token', coupon: null, presets: [], flash: null });
  assert.match(create, /class="back-arrow" href="\/admin\/coupons"/);
  assert.match(create, /name="startsOn" type="date"/, '日期交还原生 date 控件');
  assert.match(create, /开始日期<small>（留空 = 即刻生效）<\/small>/);
  assert.match(create, /截止日期<small>（留空 = 长期有效）<\/small>/);
  assert.ok(!create.includes('data-placeholder'), '日期提示改为可见文案，date 控件不支持 placeholder');
  assert.match(create, /每张券码可用次数/, '次数口径要写清是每张券码');
  assert.ok(!create.includes('先建'), '创建页不再铺开“先建券面再建券码”的流程说明');
  const edit = couponForm({ user, csrf: 'csrf-token', presets: [], flash: null, coupon: {
    id: 9, name: '券', offer_text: 'x', max_uses: 1, used_count: 0, starts_on: '2026-09-01', expires_on: ''
  } });
  assert.match(edit, /class="back-arrow" href="\/admin\/coupons\/9"/);
  assert.match(edit, /value="2026-09-01"/);
});

test('日期输入：脚本零接管，全平台原生 date', () => {
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /input\.type\s*=/, '脚本不碰输入框 type');
  assert.doesNotMatch(app, /navigator\.userAgent/, '不做 UA 分支');
  assert.doesNotMatch(app, /normalizeDate|querySelectorAll\('input\.date-input'\)/, '日期处理与降级代码已整体移除');
});

test('个人账号页有返回概览', () => {
  const html = profilePage({ user, csrf: 'csrf-token', flash: null });
  assert.match(html, /class="back-arrow" href="\/admin"/);
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
  assert.match(css, /\.admin-body \.container\{row-gap:22px\}/, '后台页顶层模块之间 22px 纵向间距（由容器 row-gap 承担）');
});

test('面板说明入口：纯 CSS 气泡，零脚本', () => {
  const css = readFileSync(new URL('../public/app.css', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(css, /\.tip\{position:absolute;right:16px;top:14px;z-index:5\}/, '说明入口固定在面板右上角');
  assert.match(css, /\.tip:hover \.tip-body,\.tip:focus-within \.tip-body\{opacity:1;visibility:visible/, '悬浮或获得焦点（触屏点按）即显示、失焦收起');
  assert.ok(!app.includes('tip-body') && !app.includes('.tip'), '气泡不靠脚本：app.js 里没有任何气泡相关代码');
});

test('操作反馈：服务端直接渲染右上角卡片（无 JS 也可见），消息不再进链接', () => {
  const html = dashboard({ user, csrf: 'csrf-token', flash: { type: 'success', message: '券面已移入回收站。' }, coupons: [], stats: { valid: 0, used: 0, expiring: 0, recycled: 0 } });
  assert.match(html, /<div class="toast-host" data-toast-host><div class="toast success" role="status">/, '默认输出卡片，无脚本也看得到');
  assert.match(html, /<p class="toast-message">券面已移入回收站。<\/p>/);
  assert.match(html, /<button type="button" class="toast-close" aria-label="关闭">/, '有手动关闭按钮');
  assert.ok(!html.includes('notice='), '消息不再拼进链接');
  assert.ok(!html.includes('class="flash'), '不再用旧的顶部提示条');

  const empty = dashboard({ user, csrf: 'csrf-token', flash: null, coupons: [], stats: { valid: 0, used: 0, expiring: 0, recycled: 0 } });
  assert.match(empty, /<div class="toast-host" data-toast-host><\/div>/, '没有反馈时容器留空（前端反馈仍可用）');
});

test('表单提交升级为局部刷新：不整页跳转，出错回退', () => {
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /document\.body\.classList\.contains\('admin-body'\)/, '只接管后台表单，客人页面保持整页跳转');
  assert.match(app, /URLSearchParams\(\)/, '请求体用 application/x-www-form-urlencoded（FormData 会发 multipart，服务端回 415）');
  assert.match(app, /new DOMParser\(\)\.parseFromString/, '服务端照旧渲染整页，前端只取 main 换上去');
  assert.match(app, /window\.scrollTo\(0, scrollY\)/, '换页后保持滚动位置（不跳回顶端）');
  assert.match(app, /restoreFields\(snapshot, action\)/, '其他表单里已输入的内容不被冲掉');
  assert.match(app, /history\.replaceState\(\{\}, '', response\.url\)/, '地址栏同步到重定向目标，且不新增历史条目');
  assert.match(app, /form\.dataset\.ajaxFallback/, '出错回退成普通提交，行为不倒退');
  assert.match(app, /form\.hasAttribute\('data-no-ajax'\)/, '个别表单可用 data-no-ajax 退出局部刷新');
  assert.match(app, /for \(const button of buttons\) button\.disabled = true/, '请求期间禁用按钮，防重复提交');
});

test('操作反馈卡片：样式与前端接管（纯 CSS 动画 + 统一样式入口）', () => {
  const css = readFileSync(new URL('../public/app.css', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(css, /\.toast-host\{position:fixed;top:var\(--toast-top,72px\);right:16px/, '桌面固定在右上角、贴顶栏下沿');
  assert.match(css, /@media \(max-width:720px\)\{\.toast-host\{left:12px;right:12px;width:auto\}\}/, '窄屏改为顶部通栏，避免被状态栏遮挡');
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{\.toast\.in,\.toast\.out\{animation:none\}\}/, '尊重系统"减少动效"');
  assert.match(app, /function showToast\(/, '前端反馈与卡片共用同一套样式与行为');
  assert.match(app, /--toast-top/, '贴顶栏下沿：按顶栏实际高度定位，窄屏换行也不会被压住');
  assert.match(app, /topbar\.getBoundingClientRect\(\)\.height \+ 10/, '用顶栏高度而不是视口坐标——后者在页面滚动后会算出负值，把卡片顶到屏幕外');
  assert.match(app, /while \(toastHost\.children\.length > 4\)/, '同时最多 4 条，超出先收最旧的');
});

test('三态主题：浅色变量中枢 + 深色双入口', () => {
  const css = readFileSync(new URL('../public/app.css', import.meta.url), 'utf8');
  // 浅色中枢：规则只从 var() 取色，浅色字面值集中在 :root
  assert.match(css, /:root\{color-scheme:light;--ink:#172033/, '浅色值与 color-scheme:light 定义于 :root');
  assert.match(css, /body\{margin:0;min-height:100vh;display:flex;flex-direction:column;background:var\(--page-bg\)/, '页面底走变量，且为整屏弹性列');
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

test('主题开关：单图标浅色/深色切换、页脚贴底与 theme.js 前置加载', () => {
  // 后台顶栏：主题图标在用户名左边，退出也改成图标
  const adminHtml = dashboard({ user, csrf: 'csrf-token', flash: null, coupons: [], stats: { valid: 0, used: 0, expiring: 0, recycled: 0 } });
  assert.match(adminHtml, /data-theme-cycle/, '顶栏有切换按钮');
  assert.match(adminHtml, /class="ico ico-light"/, '太阳=浅色');
  assert.match(adminHtml, /class="ico ico-dark"/, '月亮=深色');
  assert.ok(!adminHtml.includes('ico-system'), '不存在「跟随系统」的第三种图标');
  assert.ok(adminHtml.indexOf('data-theme-cycle') < adminHtml.indexOf('class="who"'), '主题图标在用户名左边');
  assert.match(adminHtml, /<button class="icon-button logout" aria-label="退出登录" title="退出登录">/, '退出改为图标 + 无障碍文案');
  assert.ok(!adminHtml.includes('link-button'), '不再有「退出」文字按钮');
  assert.ok(!adminHtml.includes('data-theme-set') && !adminHtml.includes('theme-switch'), '不再摆多个主题按钮');

  // 主页：首屏「GitHub 源码仓库」左边有切换按钮
  const landing = home();
  assert.match(landing, /<p class="actions hero-actions"><button type="button" class="icon-button theme-toggle" data-theme-cycle[\s\S]*?<a class="primary button"/, '主页首屏源码按钮左边是主题切换');
  assert.ok(!landing.includes('theme-switch'), '页脚按钮组已移除');

  // 登录页/查询页/客人页不再提供切换，默认跟随系统
  for (const [name, html] of [['登录页', login('csrf-token')], ['查询页', verifyPage({})], ['客人页', publicCoupon(null, '')]]) {
    assert.ok(!html.includes('data-theme-cycle') && !html.includes('data-theme-set'), `${name}不提供主题切换`);
  }

  const html = login('csrf-token');
  assert.match(html, /<script src="\/assets\/theme\.js"><\/script>/, 'theme.js 同步加载');
  assert.ok(html.indexOf('/assets/theme.js') < html.indexOf('</head>'), '位于 head 内，渲染前落 data-theme 防闪烁');

  const js = readFileSync(new URL('../public/theme.js', import.meta.url), 'utf8');
  assert.match(js, /qnqupon-theme/, 'localStorage 键');
  assert.match(js, /removeAttribute\('data-theme'\)/, '未选择过即移除属性，交回媒体查询（跟随系统）');
  assert.ok(js.includes("localStorage.setItem(KEY, next)"), '选择写入 localStorage 持久化');
  assert.ok(js.includes("CHOSEN[v] ? v : null"), '只认主动选过的浅色/深色，其余（含旧的 system）按未选择处理');
  assert.match(js, /effective\(\) === 'light' \? 'dark' : 'light'/, '点击在浅色/深色之间切换');
  assert.match(js, /prefers-color-scheme: dark/, '未选择时按系统主题决定图标与文案');

  const css = readFileSync(new URL('../public/app.css', import.meta.url), 'utf8');
  assert.match(css, /\.icon-button:hover\{opacity:1;background:rgba\(127,127,127,\.22\)\}/, '图标按钮有悬浮反馈');
  assert.match(css, /\.icon-button\.logout:hover\{color:var\(--accent\)/, '退出悬浮变红');
  assert.match(css, /\.icon-button \.ico-dark\{display:none\}/, '默认（系统浅色）显示太阳');
  assert.match(css, /:root\[data-theme="dark"\] \.icon-button \.ico-dark\{display:block\}/, '深色显示月亮');
  assert.match(css, /:root:not\(\[data-theme="light"\]\) \.icon-button \.ico-dark\{display:block\}/, '未选择且系统深色时显示月亮');
  assert.match(css, /\.hero-actions \.icon-button::after\{content:"";position:absolute;right:-11px/, '首屏图标右侧用细竖线与按钮分隔');
  assert.ok(!css.includes('theme-switch') && !css.includes('ico-system'), '页脚按钮组与第三种图标已移除');

  // 页脚贴底：内容不足一屏贴到窗口底部，超出时落在内容末尾（滚动可见）
  assert.match(css, /body\{margin:0;min-height:100vh;display:flex;flex-direction:column/, '页面为 100vh 弹性列，页脚 y 上限＝窗口高－页脚高');
  assert.match(css, /\.container\{width:100%;max-width:1180px;margin:0 auto;padding:34px 22px 0;flex:1 0 auto;display:flex;flex-direction:column;row-gap:34px\}/, '主容器撑满剩余高度，模块间距交给 row-gap');
  assert.match(css, /\.site-footer\{margin-top:auto;padding:16px 4px 22px;border-top:1px solid var\(--line\);text-align:center;font-size:12px/, '页脚靠 auto 上边距贴底；字号 12px 以便单行');
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
  assert.match(list, /<div class="actions"><a class="secondary button" href="\/admin\/coupons" data-refresh>刷新<\/a>/);
  assert.match(list, /href="\/admin\/coupons\/new">创建优惠券</);

  const recycle = recyclePage({ user, csrf: 'csrf-token', flash: null, faces: [], codes: [] });
  assert.match(recycle, /<div class="actions"><a class="secondary button" href="\/admin\/recycle" data-refresh>刷新<\/a><\/div>/);

  const dash = dashboard({ user, csrf: 'csrf-token', flash: null, coupons: [], stats: { valid: 1, used: 2, expiring: 3, recycled: 0 } });
  assert.match(dash, /时间均为北京时间/, '概览要说明时间口径');
  assert.ok(!dash.includes('北京时间 ·'), '不再用容易被当成时间的旧文案');
  assert.match(dash, /30 天内到期/, '临期天数缺省回退 30');
  assert.match(dashboard({ user, csrf: 'csrf-token', flash: null, coupons: [], stats: { valid: 1, used: 2, expiring: 3, recycled: 0, expiringDays: 14 } }), /14 天内到期/, '临期天数由后台配置传入');

  const tuned = recyclePage({ user, csrf: 'csrf-token', flash: null, faces: [], codes: [], purgeDays: 7 });
  assert.match(tuned, /移入满 7 天自动永久删除/, '回收站保留天数可由后台配置传入');
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
  assert.match(html, /单张券码可在其详情页覆写/, '要说明覆写入口');

  const off = settingsPage({ user, csrf: 'csrf-token', flash: null, settings: { showCodeName: 'false' } });
  assert.ok(!/name="showCodeName"[^>]*checked/.test(off), '关闭后不勾选');
});

test('服务设置页：PNG 字体三选一（默认思源）与深色版面开关', () => {
  const html = settingsPage({ user, csrf: 'csrf-token', flash: null, settings: {} });
  assert.match(html, /name="pngFont"[\s\S]{0,200}?value="source"[\s\S]{0,80}?selected/, '未配置时默认思源黑体');
  assert.ok(!/name="pngDark"[^>]*checked/.test(html), '深色版面默认关闭');
  assert.match(html, /渲染机未安装则回退系统无衬线体/, '字体依赖要写明');
  assert.match(html, /品牌行 QNQupon · 券能行 为固定字标/, '品牌行不随后台字体');

  const tuned = settingsPage({ user, csrf: 'csrf-token', flash: null, settings: { pngFont: 'harmonyos', pngDark: 'true' } });
  assert.match(tuned, /value="harmonyos" selected/, '记住所选字体');
  assert.match(tuned, /name="pngDark"[^>]*checked/, '记住深色开关');
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
  assert.match(html, /<div class="panel-head"><h2>筛选<\/h2>[\s\S]*?<div class="head-actions"><button class="primary" type="submit">查询<\/button><a class="secondary button" href="\/admin\/audit">重置<\/a><\/div><\/div>/, '筛选的查询/重置进标题行');
  assert.match(html, /method="get"/);
  assert.match(html, /value="coupon" selected/, '类别回显选中');  assert.match(html, /value="2" selected/, '操作人回显选中');
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
    assert.ok(html.includes('© 2026 QNLanYang ·'), `${name} 含版权行`);
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

test('后台 UI：标题区、面板头部、局部刷新与文案统一', () => {
  const dash = dashboard({ user, csrf: 'csrf-token', flash: null, coupons: [], stats: { valid: 0, used: 0, expiring: 0, recycled: 0 } });
  assert.match(dash, /<div class="panel-head"><h2>最近核销<\/h2><div class="head-actions"><a class="secondary button" href="\/admin\/redemptions">全部核销记录 →<\/a><\/div><\/div>/, '面板动作统一放标题行右侧');
  assert.match(dash, /<div class="page-title"><h1>概览<\/h1><p>时间均为北京时间<\/p><\/div>/, '标题与小字同行（同一行结构）');

  const redemptions = redemptionsPage({ user, csrf: 'csrf-token', flash: null, coupons: [], rows: [], total: 0, page: 1, pages: 1, filters: {} });
  assert.match(redemptions, /<div class="panel-head"><h2>筛选<\/h2><div class="head-actions"><button class="primary" type="submit">查询<\/button><a class="secondary button" href="\/admin\/redemptions">重置<\/a><\/div><\/div>/, '筛选的查询/重置进标题行');
  assert.match(redemptions, /class="back-arrow" href="\/admin"/, '核销记录用标题左侧箭头返回概览');
  assert.ok(!dash.includes('back-arrow'), '概览是顶级页，没有返回箭头');

  const presets = presetsPage({ user, csrf: 'csrf-token', flash: null, presets: [] });
  assert.match(presets, /<div class="panel-head"><h2>新增预设<\/h2><div class="head-actions"><button class="primary">保存预设<\/button><\/div><\/div>/, '新增预设按钮进标题行');
  assert.ok(!presets.includes('href="/admin/recycle">回收站<'), '顶栏移除回收站入口');

  const recycle = recyclePage({ user, csrf: 'csrf-token', flash: null, faces: [{ id: 3, name: '旧券', offer_text: 'x', recycled_at: '2026-09-24T12:00:00.000Z' }], codes: [] });
  assert.match(recycle, /name="return" value="\/admin\/recycle"/, '恢复后留在回收站');

  const css = readFileSync(new URL('../public/app.css', import.meta.url), 'utf8');
  assert.match(css, /\.page-head>\.page-title\{display:flex;align-items:baseline/, '标题与小字基线对齐、同行显示');
  assert.match(css, /\.back-arrow\{display:inline-flex/, '返回是标题左侧的箭头，取代整块返回按钮');
  assert.match(css, /\.back-arrow:hover\{color:var\(--ink\)/, '悬浮时颜色变深');
  assert.match(css, /\.code-create label\.count-field\{flex:0 0 120px\}/, '生成数量输入框收窄，不再占满整行');
  assert.match(css, /\.panel-head\{display:flex;align-items:center/, '面板头部为一行布局');
  assert.match(css, /\.panel-head \.tip\{position:static\}/, '面板头部的 ❓ 随标题排布，避让右侧按钮');
  assert.match(css, /\.is-busy\{opacity:\.6;pointer-events:none\}/, '刷新请求期间给按钮忙碌态');

  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /closest\('\[data-refresh\]'\)/, '刷新按钮走局部更新');
  assert.match(app, /restoreFields\(snapshot, '\\u0000refresh'\)/, '刷新保留未提交的输入');
  assert.match(app, /nextMain\.querySelector\('\.site-footer'\)\?\.remove\(\)/, '局部替换时保留当前页脚，主题开关的高亮不被重置成默认');
});

test('状态操作回到来源页：服务端只接受同源后台 return', () => {
  const server = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  assert.match(server, /const returnPath = \(request, fallback\) =>/, '有 return 目标解析');
  assert.match(server, /A-Za-z0-9\/_-\]\*\$\//, '只接受同源后台路径，防开放重定向');
  assert.match(server, /returnPath\(request, status === 'recycled'/, '移入回收站等状态操作回原页');
});

test('手机档：顶栏折叠菜单、表格卡片化与单列表单', () => {
  // 顶栏结构：图标品牌 + 折叠菜单（主题/个人账号/退出）
  const admin = dashboard({ user, csrf: 'csrf-token', flash: null, coupons: [], stats: { valid: 0, used: 0, expiring: 0, recycled: 0 } });
  assert.match(admin, /<span class="brand-text">/, '品牌文字包起来，手机档只留图标');
  assert.match(admin, /<div class="topbar-side" data-side><button class="icon-button menu-toggle" type="button" data-menu-toggle aria-label="菜单" aria-expanded="false">/, '折叠菜单入口');
  assert.match(admin, /<div class="side-panel">/, '菜单面板容器');
  assert.match(admin, /<span class="side-text">界面主题<\/span>/, '菜单里有主题行');
  assert.match(admin, /<span class="side-text">个人账号<\/span>/, '菜单里有个人账号行');
  assert.match(admin, /<span class="side-text">退出<\/span>/, '菜单里退出带文字');
  assert.ok(admin.indexOf('data-theme-cycle') < admin.indexOf('class="who"'), '主题仍在用户名之前（桌面顺序不变）');

  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /document\.querySelector\('\[data-menu-toggle\]'\)/, 'app.js 接管折叠菜单');
  assert.match(app, /sideWrap\.contains\(event\.target\)\) setMenu\(false\)/, '点菜单外部收起');
  assert.match(app, /if \(event\.key === 'Escape'\) setMenu\(false\)/, 'Esc 收起菜单');

  const css = readFileSync(new URL('../public/app.css', import.meta.url), 'utf8');
  assert.match(css, /@media\(max-width:640px\)\{/, '新增手机档断点');
  assert.match(css, /\.topbar\{flex-wrap:nowrap;gap:10px;min-height:52px;padding:8px 12px\}/, '手机档顶栏压成一行');
  assert.match(css, /\.brand-text\{display:none\}/, '手机档品牌只留图标');
  assert.match(css, /\.topbar nav\{order:0;flex:1 1 auto;flex-basis:auto;min-width:0;gap:14px;flex-wrap:nowrap;white-space:nowrap;overflow-x:auto/, '手机档导航单行横向滑动');
  assert.match(css, /\.topbar-side \.side-panel\{display:none;position:absolute;right:0;top:calc\(100% \+ 8px\)/, '菜单面板在手机上浮层展开');
  assert.match(css, /\.stats\{grid-template-columns:1fr 1fr\}/, '统计卡手机档 2 列');
  assert.match(css, /\.details\{grid-template-columns:auto minmax\(0,1fr\) auto minmax\(0,1fr\);gap:8px 14px\}/, '券面/券码信息手机档双列（长字段用 .wide 独占一行）');
  assert.match(css, /\.admin-body \.panel thead\{display:none\}/, '表格手机档隐藏表头');
  assert.match(css, /\.admin-body \.panel td\[data-priority="low"\]\{display:none\}/, '次要列手机档隐藏');
  assert.match(css, /\.admin-body \.panel tr:not\(\.record-row\):not\(\.code-card\)>td:not\(:first-child\):not\(\.row-ops\):not\(\[data-priority="low"\]\):not\(\[data-label="状态"\]\)::before\{content:attr\(data-label\)/, '非首列（状态、核销记录、券码卡片除外）显示「标签」');
  assert.match(css, /\.admin-body \.panel tr\.code-card\{display:grid;grid-template-columns:1fr auto/, '券码卡片：名称 + 状态徽章一行、ID + 已用一行');
  assert.match(css, /\.admin-body \.panel tr\.code-card>td\[data-label="已用"\]\{grid-row:2\/3;grid-column:2\/3/, '已用次数排到 ID 行右侧');
  const codeRowsHtml = couponDetail({ user, csrf: 'csrf-token', flash: null, coupon: faceOf(), codes: [codeOf()], redemptions: [] });
  assert.match(codeRowsHtml, /<tr class="code-card">/, '券码行标记 code-card');
  assert.match(css, /\.mail>svg\{width:18px;height:18px;display:none\}/, '邮件状态图标默认隐藏（桌面看文字）');
  assert.match(css, /\.mail\.sent>svg\{color:var\(--good\)\}/, '送达=绿色信封');
  assert.match(css, /\.mail\.failed>svg\{color:var\(--bad\)\}/, '失败=红色信封');
  assert.match(css, /\.mail\.skipped>svg\{color:var\(--muted\)\}/, '未启用=灰色信封（带斜线）');
  assert.match(css, /\.admin-body \.panel tr\.record-row\{display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px\}/, '核销记录卡片两行布局');
  assert.match(css, /\.admin-body \.panel \.mail-text\{display:none\}/, '手机档邮件状态只留图标');
  const records = couponDetail({ user, csrf: 'csrf-token', flash: null, coupon: faceOf(), codes: [], redemptions: [{ redeemed_at: '2026-09-24T12:00:00.000Z', code_id: 'cd-AbCdEfGh1234', code_name: '张三的券', code_note: '张三', confirmation_code: 'HLZ-B7T', source_ip: '1.1.1.1', email_status: 'sent' }] });
  assert.match(records, /<tr class="record-row">/, '核销记录行标记 record-row（手机档走两行布局）');
  assert.match(records, /<span class="mail sent" title="已发送" aria-label="已发送"><svg/, '邮件状态渲染成图标，文字留给读屏与悬浮');
  assert.match(records, /<span class="mail-text">已发送<\/span>/, '桌面仍显示中文邮件状态');
  assert.match(css, /\.admin-body \.panel td\.row-ops\{display:flex;flex-wrap:wrap/, '操作按钮在卡片底部一行');
  assert.match(css, /\.admin-body \.panel tr\.empty-row\{border:0/, '空状态不画卡片边框');
  assert.match(css, /\.admin-body \.panel td\[data-label="状态"\]\{position:absolute;right:10px;top:9px;padding:0\}/, '手机档状态徽章移到卡片右上角');
  assert.match(css, /\.panel-head \.tip \.tip-body\{left:10px;right:auto;top:32px;width:min\(88%,420px\)\}/, '面板头部的 ❓ 气泡贴着面板展开，不再跑到卡片外');
  assert.match(css, /\.page-head h1\{font-size:22px;line-height:1.25\}/, '手机档标题字号与行高收紧');
  assert.match(css, /\.container\{padding-top:12px\}/, '手机档内容上边距收紧');
  assert.match(css, /\.details dt\.wide\{grid-column:1\/2\}/, '长字段标 wide 后标签与值同行铺满');
  assert.match(css, /\.admin-body \.table-scroll\{max-height:none;overflow:visible\}/, '手机档取消券码表限高');
  assert.match(css, /\.admin-body button,\.admin-body \.button\{padding:5px 8px/, '手机档按钮收紧（外框略高于标题字）');

  // 各表的单元格都带「标签」，次要列标了 low
  const recycle = recyclePage({ user, csrf: 'csrf-token', flash: null, faces: [{ id: 3, name: '旧券', offer_text: 'x', recycled_at: '2026-09-24T12:00:00.000Z' }], codes: [] });
  assert.match(recycle, /<td data-label="优惠券">/, '回收站首列带标签');
  assert.match(recycle, /<td data-priority="low" data-label="日期">/, '回收站日期标为次要列');
  assert.equal((recycle.match(/<td>/g) || []).length, 0, '回收站表里不再有裸的 <td>');
  const audit = auditPage({ user, csrf: 'csrf-token', flash: null, prefixes: [], users: [], logs: [{ created_at: '2026-09-24T12:00:00.000Z', username: 'x', action: 'a', target_type: 't', target_id: 1, source_ip: '1.1.1.1' }], total: 1, page: 1, pages: 1, filters: {} });
  assert.match(audit, /data-priority="low" data-label="来源 IP"/, '审计页来源 IP 标为次要列');
  const users = usersPage({ user, csrf: 'csrf-token', flash: null, users: [{ id: 2, username: 'biz', role: 'business_admin', active: 1, last_login_at: null }] });
  assert.match(users, /data-priority="low" data-label="上次登录"/, '账号页上次登录标为次要列');
  assert.match(users, /data-label="用户名">biz</, '账号页首列带标签');
});

test('细节修正：登录卡片宽度、页脚单行、面板不出内部滚动、可点范围与导航淡出', () => {
  const css = readFileSync(new URL('../public/app.css', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

  assert.match(css, /\.auth-card\{width:100%;max-width:520px/, '登录/初始化卡片补足宽度，电脑上不再过窄');
  assert.ok(!/\.panel\{padding:14px;overflow-x:auto\}/.test(css), '面板不再设 overflow-x（auto 会连带纵向出现内部滚动）');
  assert.match(css, /\.admin-body \.panel\{overflow:visible\}/, '手机档面板不产生内部滚动');
  assert.match(css, /\.page-head>\.page-title\{[^}]*flex:1 1 auto;min-width:0\}/, '标题块可收缩，按钮尽量留在标题行');
  assert.ok(!css.includes('.page-head{flex-direction:column}'), '不再强制标题与按钮分成两行');
  assert.match(css, /\.page-head>\.page-title\{display:contents\}/, '手机档把标题块拆开，副标题可单独占行');
  assert.match(css, /\.page-head>\.actions\{order:2;margin-left:auto\}/, '手机档按钮留在标题行右侧');
  assert.match(css, /\.page-head>\.page-title>p\{order:3;flex:1 1 100%;margin:0\}/, '副标题整行排在最后；原来手机上标题/副标题/按钮占三行');
  assert.match(css, /td a small\{font-weight:400;color:var\(--muted\)\}/, '链接内的次要信息保持灰字不加粗');
  assert.match(css, /\.admin-body \.panel td:first-child a\{display:block\}/, '首列链接占满单元格，点击范围含次要信息');
  assert.match(css, /\.topbar nav\[data-fade-right\]\{-webkit-mask-image:linear-gradient\(to left,transparent,#000 20px\)/, '导航右侧未显示全时淡出');
  assert.match(css, /\.topbar nav\[data-fade-left\]\{-webkit-mask-image:linear-gradient\(to right,transparent,#000 20px\)/, '导航左侧未显示全时淡出');
  assert.match(app, /setFlag\(topNav, 'data-fade-right', scrollable && topNav\.scrollLeft \+ topNav\.clientWidth < topNav\.scrollWidth - 1\)/, 'app.js 按滚动位置切换淡出');

  // 名称与次要信息同在一个链接里
  const list = couponsPage({ user, csrf: 'csrf-token', flash: null, coupons: [{ id: 1, name: 'A', offer_text: 'x', max_uses: 1, code_total: 1, code_available: 1, used_total: 0, current_state: 'valid' }] });
  assert.match(list, /<a href="\/admin\/coupons\/1">A<small>x · 1 次\/张<\/small><\/a>/, '券面列表：优惠内容在可点范围内，并带次数');
  const detail = couponDetail({ user, csrf: 'csrf-token', flash: null, coupon: faceOf(), codes: [codeOf()], redemptions: [] });
  assert.match(detail, /<a href="\/admin\/codes\/cd-AbCdEfGh1234">张三的券<small>/, '券码列表：券码 ID 在可点范围内');
});

test('手机按钮收紧、设置页双列与开关、账号页与测试邮件', () => {
  const css = readFileSync(new URL('../public/app.css', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

  assert.match(css, /\.admin-body button,\.admin-body \.button\{padding:5px 8px;font-size:13\.5px;line-height:1\.45;border-radius:9px;min-height:0\}/, '手机档按钮收紧到略高于标题字，左右各约半个字');
  assert.match(css, /\.form-grid\{grid-template-columns:1fr 1fr\}/, '手机档表单改双列（短输入框不再独占一行）');
  assert.match(css, /\.form-panel \.check\.switch input\{appearance:none;-webkit-appearance:none;width:44px;height:26px/, '布尔开关用现代开关 UI');
  assert.match(css, /\.form-panel \.check\.switch input:checked\{background:var\(--accent\)/, '开关打开时用强调色');
  assert.match(css, /\.modal-input\{width:100%;margin-top:12px/, '弹窗内嵌输入框样式');
  assert.match(css, /\.qr-preview img\{display:block;width:150px;height:150px;padding:11px;border:1px solid var\(--line\);border-radius:7px;background:#fff\}/, '二维码外框不变、圆角减半、二维码略缩');
  assert.match(css, /\.qr-preview \.actions\{display:flex;flex-direction:column;gap:8px;align-items:stretch/, '打开/下载/预览按钮竖排在二维码右边');
  assert.match(css, /code\{font-family:ui-monospace,"Cascadia Mono",Consolas,"Courier New",monospace;font-size:\.92em;letter-spacing:\.08em;background:var\(--code-bg\);border:1px solid var\(--code-border-sm\);border-radius:999px/, '确认码/券码 ID 用等宽胶囊包裹、字距略放宽');
  assert.match(css, /\.admin-body \.panel td\.row-ops\{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end/, '手机档操作按钮靠右');
  assert.match(css, /\.admin-body \.qr-preview\{gap:12px\}/, '手机档二维码与按钮列间距收紧（不换行）');
  assert.match(css, /\.admin-body \.qr-links\{min-width:0;flex:1 1 auto\}/, '手机档按钮列留在二维码右边');
  assert.match(css, /\.danger-row\{justify-content:flex-end\}/, '手机档停用/删除靠右');
  assert.match(app, /closest\('button\[data-password-reset\]'\)/, 'app.js 接管重置密码弹窗');
  assert.match(app, /prompt\.target\.value = modalInput\.value/, '确认后把输入值写进隐藏字段再提交');

  const list = couponsPage({ user, csrf: 'csrf-token', flash: null, coupons: [{ id: 1, name: 'A', offer_text: 'x', max_uses: 1, code_total: 1, code_available: 1, used_total: 0, current_state: 'valid' }] });
  assert.match(list, /<small>x · 1 次\/张<\/small>/, '券面列表在优惠内容后加次数');

  const users = usersPage({ user, csrf: 'csrf-token', flash: null, users: [{ id: 2, username: 'biz', role: 'business_admin', active: 1, last_login_at: null }] });
  assert.match(users, /<div class="panel-head"><h2>创建业务管理员<\/h2><div class="head-actions"><button class="primary">创建账号<\/button><\/div><\/div>/, '创建账号按钮移到卡片标题行（桌面同步）');
  assert.match(users, /<input type="password" name="newPassword" class="field-hidden"/, '重置密码的输入框改为隐藏，由弹窗输入');
  assert.match(users, /<button type="button" class="danger" data-password-reset data-minlength="12" data-user="biz">重置密码<\/button>/, '重置密码按钮带弹窗参数');
  assert.ok(!users.includes('placeholder="新密码'), '表格里不再摊开密码输入框');

  const settings = settingsPage({ user, csrf: 'csrf-token', flash: null, settings: {} });
  assert.match(settings, /class="check switch"><input type="checkbox" name="mailEnabled"/, '邮件通知开关用开关 UI');
  assert.match(settings, /class="check switch"><input type="checkbox" name="showCodeName"/, '券码名开关用开关 UI');
  assert.match(settings, /class="check switch"><input type="checkbox" name="pngDark"/, '深色版面开关用开关 UI');
  assert.match(settings, /<button class="secondary" type="submit" form="settings-test-mail" data-confirm="将向「通知收件人」发送一封测试邮件（内容已注明可忽略），确认发送？">发送测试邮件<\/button>/, '测试邮件按钮移到保存按钮旁并二次确认');
  assert.match(settings, /<form id="settings-test-mail" method="post" action="\/admin\/settings\/test-email">/, '测试邮件走独立表单（不嵌套）');
  assert.ok(!settings.includes('placeholder="临时收件地址"'), '不再手填测试收件地址');
  assert.ok(!settings.includes('<h2>发送测试邮件</h2>'), '独立的测试邮件面板已移除');

  const server = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  assert.match(server, /const recipients = String\(db\.getSetting\('mailRecipients', ''\) \|\| ''\)\.split/, '测试邮件发给已保存的通知收件人');
  assert.match(server, /请先填写「通知收件人」并保存邮件设置。/, '收件人为空时给出提示');
  const mailer = readFileSync(new URL('../src/mailer.js', import.meta.url), 'utf8');
  assert.match(mailer, /可忽略/, '测试邮件文案注明可忽略');
  assert.match(mailer, /【测试】/, '测试邮件标题带【测试】');
});

