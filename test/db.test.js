// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 QNLanYang (全能岚漾)

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb, chinaDate } from '../src/db.js';
import { hashPassword, verifyPassword } from '../src/security.js';

const config = {
  databasePath: join(mkdtempSync(join(tmpdir(), 'qnqupon-test-')), 'test.db'),
  encryptionKey: 'test-encryption-key'
};
const db = createDb(config);
let actor = 0;

beforeEach(() => {
  if (!actor) actor = Number(db.createUser('tester', hashPassword('Test-password-2026'), 'super_admin').lastInsertRowid);
});

const newFace = (overrides = {}) => db.createCoupon({
  name: '测试券', offerText: '立减 10 元', maxUses: 3, ...overrides
}, actor);
const newCode = (faceId, name = '测试券码', note = null) => [db.createCode(faceId, name, note, actor)];

test('用户会话与密码', () => {
  const user = db.userByName('tester');
  assert.ok(user);
  assert.ok(verifyPassword('Test-password-2026', user.password_hash));
  const token = 'session-token-x';
  const csrf = 'csrf-token-x';
  db.createSession(token, user.id, csrf, new Date(Date.now() + 3600000).toISOString());
  const session = db.getSession(token);
  assert.equal(session.user_id, user.id);
  assert.equal(session.role, 'super_admin');
  db.deleteUserSessions(user.id);
  assert.equal(db.getSession(token), undefined);
  // 过期会话不可用
  db.createSession(token, user.id, csrf, new Date(Date.now() - 1000).toISOString());
  assert.equal(db.getSession(token), undefined);
});

test('用户停用与重新启用', () => {
  const id = Number(db.createUser('biz', hashPassword('Biz-password-2026'), 'business_admin').lastInsertRowid);
  db.setUserActive(id, false);
  assert.equal(db.userById(id).active, 0);
  db.setUserActive(id, true);
  assert.equal(db.userById(id).active, 1);
});

test('券面本身没有券码，券码 ID 与 Token 可往返', () => {
  const face = newFace({ maxUses: 1 });
  assert.equal(db.codesOf(face.id).length, 0, '刚创建的券面还没有券码');
  assert.equal(db.getCouponByToken('wrong-token'), null);

  const [issued] = newCode(face.id, '张三的券', '发给张三');
  assert.match(issued.id, /^cd-[A-Za-z0-9]{12}$/, '券码 ID 为 cd- + 12 位随机字母数字');
  assert.ok(issued.token.length >= 40);
  assert.equal(db.getCodeToken(issued.id), issued.token, '加密副本应可解密回原始 token');

  const byToken = db.getCouponByToken(issued.token);
  assert.equal(byToken.face_id, face.id);
  assert.equal(byToken.id, issued.id);
  assert.equal(byToken.name, '张三的券');
  assert.equal(byToken.face_name, '测试券', '券码行要带券面名');
  assert.equal(byToken.note, '发给张三');
  assert.equal(byToken.current_state, 'valid');

  // token_hash 是 sha256，不存明文
  const row = db.raw.prepare('SELECT token_hash, token_ciphertext FROM voucher_codes WHERE id=?').get(issued.id);
  assert.notEqual(row.token_hash, issued.token);
  assert.notEqual(row.token_ciphertext, issued.token);
  assert.match(row.token_hash, /^[0-9a-f]{64}$/);
});

test('一次创建一张券码：ID 唯一、备注入库、可改名', () => {
  const face = newFace();
  const created = Array.from({ length: 5 }, (_, i) => db.createCode(face.id, `城南店活动 ${i + 1}`, '城南店客人', actor));
  assert.equal(created.length, 5);
  assert.equal(new Set(created.map((c) => c.token)).size, 5, '每张券码的 token 必须唯一');
  assert.equal(new Set(created.map((c) => c.id)).size, 5, '每张券码的 ID 必须唯一');
  assert.equal(db.codesOf(face.id).length, 5);
  assert.ok(db.codesOf(face.id).every((c) => c.note === '城南店客人'));

  assert.equal(db.createCode(face.id, '   ', null, actor).name, '测试券', '名称留空/全空白 → 自动默认名（此时券面名未被占用）');
  assert.throws(() => db.createCode(999999, 'x', null, actor), /优惠券不存在/);
  const dead = newFace();
  db.setCouponStatus(dead.id, 'recycled', actor, null);
  assert.throws(() => db.createCode(dead.id, 'x', null, actor), /回收站/);

  // 改名只影响这一张券码
  db.setCodeName(created[0].id, '改名后的券码', actor, null);
  assert.equal(db.codeDetail(created[0].id).name, '改名后的券码');
  assert.equal(db.codeDetail(created[1].id).name, '城南店活动 2');
  assert.throws(() => db.setCodeName(created[1].id, '  ', actor, null), /券码名称/);
  assert.equal(db.codeDetail(created[1].id).name, '城南店活动 2', '非法改名不落库');

  const log = db.raw.prepare("SELECT * FROM audit_log WHERE action='code.create' ORDER BY id DESC LIMIT 1").get();
  assert.equal(Number(log.target_id), face.id);
});

test('「已发放」开关：置位/复位、记录时间、幂等、审计可查', () => {
  const face = newFace();
  const code = db.createCode(face.id, '新春券', null, actor);
  assert.equal(db.codeDetail(code.id).issued, 0, '新建券码默认未发放');
  assert.equal(db.codeDetail(code.id).issued_at, null);

  assert.equal(db.setCodeIssued(code.id, 1, actor, '10.0.0.1'), true);
  const on = db.codeDetail(code.id);
  assert.equal(on.issued, 1);
  assert.ok(on.issued_at, '标记时记录时间');
  assert.equal(db.setCodeIssued(code.id, true, actor, null), true, '重复标记同一值不报错');
  assert.equal(db.codeDetail(code.id).issued_at, on.issued_at, '值没变就不重写时间（幂等）');
  const log = db.raw.prepare("SELECT * FROM audit_log WHERE action='code.issued' ORDER BY id DESC LIMIT 1").get();
  assert.equal(log.target_id, code.id, '标记已发放要进审计');
  assert.equal(db.codeDetail(code.id).name, '新春券', '标记不影响券码名');

  assert.equal(db.setCodeIssued(code.id, 0, actor, null), true);
  assert.equal(db.codeDetail(code.id).issued, 0);
  assert.equal(db.codeDetail(code.id).issued_at, null, '取消发放时清掉时间');
  assert.equal(db.raw.prepare("SELECT * FROM audit_log WHERE action='code.unissued' ORDER BY id DESC LIMIT 1").get().target_id, code.id);
  assert.equal(db.setCodeIssued('cd-nope', 1, actor, null), false, '不存在的券码返回 false');
});

test('旧库升级：启动自动补 show_name/issued/issued_at 列并建 code_shares 表，数据不丢、新功能可用', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'qnqupon-upgrade-')), 'old.db');
  // 先按当前结构建库、放点数据，再把它「退回旧版本的样子」
  const old = createDb({ databasePath: path, encryptionKey: 'test-encryption-key' });
  const actorId = Number(old.createUser('old', hashPassword('Test-password-2026'), 'super_admin').lastInsertRowid);
  const face = old.createCoupon({ name: '老券面', offerText: '老优惠', maxUses: 2 }, actorId);
  const code = old.createCode(face.id, '老券码', '老备注', actorId);
  old.raw.exec('ALTER TABLE voucher_codes DROP COLUMN show_name');
  old.raw.exec('ALTER TABLE voucher_codes DROP COLUMN issued');
  old.raw.exec('ALTER TABLE voucher_codes DROP COLUMN issued_at');
  old.raw.exec('DROP TABLE code_shares');
  old.raw.close();

  // 用新版代码重新打开同一个文件：应当自动补列 + 建表
  const up = createDb({ databasePath: path, encryptionKey: 'test-encryption-key' });
  const cols = up.raw.prepare('PRAGMA table_info(voucher_codes)').all().map((c) => c.name);
  assert.ok(cols.includes('show_name'), '补上 show_name');
  assert.ok(cols.includes('issued') && cols.includes('issued_at'), '补上 issued / issued_at');
  assert.equal(up.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='code_shares'").get().name, 'code_shares', '建出 code_shares');
  const kept = up.codeDetail(code.id);
  assert.equal(kept.name, '老券码', '旧数据保留');
  assert.equal(kept.note, '老备注');
  assert.equal(kept.issued, 0, '补列默认未发放');
  assert.equal(up.codesOf(face.id).length, 1, '券码还在');

  // 升级后新功能立即可用
  up.setCodeIssued(code.id, 1, actorId, null);
  assert.equal(up.codeDetail(code.id).issued, 1);
  const share = up.createShare(code.id, actorId, null);
  assert.ok(share.key && up.liveShare(code.id), '升级后的券码能直接生成分享链接');
  assert.equal(up.consumeShare(share.key, null).ok, true);
  assert.equal(up.codeDetail(code.id).issued, 1, '取走后仍为已发放');
  up.raw.close();
});

test('分享链接：生成、复用刷新、券面变了作废重建、一次有效、超时不算已发放', () => {
  const face = newFace();
  const code = db.createCode(face.id, '分享测试券', null, actor);

  const first = db.createShare(code.id, actor, '10.0.0.1');
  assert.equal(first.reused, false);
  assert.ok(first.key && first.key.length >= 20, '生成随机 key');
  assert.ok(db.liveShare(code.id), '能查到有效分享');
  assert.equal(db.codeDetail(code.id).issued, 0, '只是生成链接，不算已发放');

  const again = db.createShare(code.id, actor, null);
  assert.equal(again.reused, true, '未过期又没被用过 → 复用');
  assert.equal(again.key, first.key, '复用同一条链接（key 不变）');
  assert.ok(Date.parse(again.expiresAt) >= Date.parse(first.expiresAt), '有效期被刷新');
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM code_shares WHERE code_id=?").get(code.id).n, 1, '复用不产生新行');

  // 券面内容改了 → 旧链接作废、换新链接
  db.raw.prepare('UPDATE coupons SET offer_text=? WHERE id=?').run('改过的优惠内容', face.id);
  const third = db.createShare(code.id, actor, null);
  assert.equal(third.reused, false, '券面变了不复用');
  assert.notEqual(third.key, first.key);
  assert.equal(db.consumeShare(first.key, '9.9.9.9').reason, 'revoked', '旧链接已作废');
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM code_shares WHERE code_id=?").get(code.id).n, 2, '旧行保留（作废）而不是删除');

  // 取走一次
  const hit = db.consumeShare(third.key, '9.9.9.9');
  assert.equal(hit.ok, true);
  assert.equal(hit.codeId, code.id);
  assert.equal(db.codeDetail(code.id).issued, 1, '券图被取走 → 自动标记已发放');
  assert.ok(db.codeDetail(code.id).issued_at, '同时记下时间');
  assert.equal(db.consumeShare(third.key, '9.9.9.9').reason, 'used', '只能下载一次');
  assert.equal(db.consumeShare('nope', null).reason, 'not_found');

  // 只是超时过期：不算已发放
  const code2 = db.createCode(face.id, '超时券', null, actor);
  const s2 = db.createShare(code2.id, actor, null);
  db.raw.prepare('UPDATE code_shares SET expires_at=? WHERE code_id=?').run('2020-01-01T00:00:00.000Z', code2.id);
  assert.equal(db.consumeShare(s2.key, null).reason, 'expired');
  assert.equal(db.codeDetail(code2.id).issued, 0, '超时过期不算已发放');

  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action='share.create'").get().n >= 2, true, 'share.create 进审计');
  assert.equal(db.raw.prepare("SELECT action FROM audit_log WHERE action='share.use' ORDER BY id DESC LIMIT 1").get().action, 'share.use');
});

test('券码名称留空：按「券面名 #序号」碰撞取号，能补空缺', () => {
  const face = newFace();
  const base = db.getCoupon(face.id).name; // 测试券
  assert.equal(db.createCode(face.id, '', null, actor).name, base, '第一张默认就是券面名本身');
  db.createCode(face.id, `${base} #1`, null, actor);
  db.createCode(face.id, `${base} #3`, null, actor);
  assert.equal(db.createCode(face.id, '   ', null, actor).name, `${base} #2`, '已有 券面名/#1/#3 → 取空缺 #2');
  assert.equal(db.createCode(face.id, null, null, actor).name, `${base} #4`, '空缺补完 → 顺延 #4');
});

test('批量生成券码：编号位数与数量同宽、统一默认隐藏券码名', () => {
  const face = newFace();

  const nine = db.createCodes(face.id, 9, '员工券', '城南店员工', actor);
  assert.equal(nine.length, 9);
  assert.deepEqual(nine.map((c) => c.name), ['员工券 #1', '员工券 #2', '员工券 #3', '员工券 #4', '员工券 #5', '员工券 #6', '员工券 #7', '员工券 #8', '员工券 #9'], '9 张 → 1 位编号');
  assert.equal(db.codesOf(face.id).length, 9);
  assert.equal(new Set(nine.map((c) => c.id)).size, 9, '每张券码 ID 唯一');
  assert.equal(new Set(nine.map((c) => c.token)).size, 9, '每张 token 唯一');
  assert.ok(nine.every((c) => db.codeDetail(c.id).show_name === 0), '批量生成的券码名统一显式设为「始终隐藏」');
  assert.ok(nine.every((c) => db.codeDetail(c.id).note === '城南店员工'), '同一批共用备注');

  const twenty = db.createCodes(face.id, 20, '批量二十', null, actor);
  assert.equal(twenty[0].name, '批量二十 #01', '20 张 → 从 #01 起');
  assert.equal(twenty[19].name, '批量二十 #20', '20 张 → 到 #20 止（2 位编号）');

  const twentyFive = db.createCodes(face.id, 25, '夏季活动', null, actor);
  assert.equal(twentyFive[0].name, '夏季活动 #01');
  assert.equal(twentyFive[24].name, '夏季活动 #25', '25 张 → 2 位编号');

  const hundred = db.createCodes(face.id, 100, '年卡', null, actor);
  assert.equal(hundred[0].name, '年卡 #001');
  assert.equal(hundred[99].name, '年卡 #100', '100 张 → 3 位编号');

  // 未给名称：以券面名作基名，同样带补零编号（首个不再是裸券面名）
  const base = db.getCoupon(face.id).name;
  assert.deepEqual(db.createCodes(face.id, 2, '   ', null, actor).map((c) => c.name), [`${base} #1`, `${base} #2`], '留空名称时以券面名作基名并按数量补零');

  // 数量越界、非法输入与回收站券面：一律不落库
  assert.throws(() => db.createCodes(face.id, 0, 'x', null, actor), /1 到 100/);
  assert.throws(() => db.createCodes(face.id, 101, 'x', null, actor), /1 到 100/);
  assert.throws(() => db.createCodes(face.id, 'abc', 'x', null, actor), /1 到 100/);
  const dead = newFace();
  db.setCouponStatus(dead.id, 'recycled', actor, null);
  assert.throws(() => db.createCodes(dead.id, 3, 'x', null, actor), /回收站/);
  assert.equal(db.codesOf(dead.id).length, 0, '回收站券面不产生券码');

  const log = db.raw.prepare("SELECT * FROM audit_log WHERE action='code.batch' ORDER BY id DESC LIMIT 1").get();
  assert.equal(Number(log.target_id), face.id);
  assert.match(log.detail, /"count":2/, '批量创建只记一条审计，含本次数量');
});

test('状态机：券面状态联动券码，券码可单独停用', () => {
  const dayAfterTomorrow = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);

  // 券面日期决定券码日期
  const futureFace = newFace({ startsOn: dayAfterTomorrow });
  const [futureCode] = newCode(futureFace.id);
  assert.equal(db.couponState(db.getCoupon(futureFace.id)), 'not_started');
  assert.equal(db.codeDetail(futureCode.id).current_state, 'not_started');

  const pastFace = newFace({ expiresOn: twoDaysAgo });
  const [pastCode] = newCode(pastFace.id);
  assert.equal(db.couponState(db.getCoupon(pastFace.id)), 'expired');
  assert.equal(db.codeDetail(pastCode.id).current_state, 'expired');

  // 单张券码用尽
  const doneFace = newFace({ maxUses: 1 });
  const [doneCode] = newCode(doneFace.id);
  assert.equal(db.redeem(doneCode.token, '127.0.0.1', 'ua').ok, true);
  assert.equal(db.codeDetail(doneCode.id).current_state, 'exhausted');
  assert.equal(db.couponState(db.getCoupon(doneFace.id)), 'valid', '券面本身不会因单张用尽而变状态');

  // 券面停用 → 其下券码全部停用
  const pairFace = newFace();
  const [a] = newCode(pairFace.id, 'A 的码');
  const [b] = newCode(pairFace.id, 'B 的码');
  db.setCouponStatus(pairFace.id, 'disabled', actor, null);
  assert.equal(db.couponState(db.getCoupon(pairFace.id)), 'disabled');
  assert.equal(db.codeDetail(a.id).current_state, 'disabled');
  assert.equal(db.codeDetail(b.id).current_state, 'disabled');

  // 券面回收 → 其下券码全部回收；恢复券面后单张停用的仍是停用
  db.setCouponStatus(pairFace.id, 'recycled', actor, null);
  assert.equal(db.codeDetail(a.id).current_state, 'recycled');
  db.setCouponStatus(pairFace.id, 'active', actor, null);
  assert.equal(db.codeDetail(a.id).current_state, 'valid');
  db.setCodeStatus(b.id, 'disabled', actor, null);
  assert.equal(db.codeDetail(b.id).current_state, 'disabled', '单独停用只影响自己');
  assert.equal(db.codeDetail(a.id).current_state, 'valid');

  // 回收单张券码
  db.setCodeStatus(a.id, 'recycled', actor, null);
  assert.equal(db.codeDetail(a.id).current_state, 'recycled');
  assert.ok(db.codeDetail(a.id).recycled_at, '券码入回收站要记录时间');
  db.setCodeStatus(a.id, 'active', actor, null);
  assert.equal(db.codeDetail(a.id).recycled_at, null, '恢复后清空回收时间');

  assert.throws(() => db.setCouponStatus(pairFace.id, 'bogus', actor, null), /无效状态/);
  assert.throws(() => db.setCodeStatus(a.id, 'bogus', actor, null), /无效状态/);
});

test('过期、未生效、停用、回收的券码不可核销', () => {
  const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
  const dayAfterTomorrow = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const expired = newCode(newFace({ expiresOn: twoDaysAgo }).id)[0];
  const future = newCode(newFace({ startsOn: dayAfterTomorrow }).id)[0];
  const disabledFace = newFace();
  const disabledCode = newCode(disabledFace.id)[0];
  db.setCouponStatus(disabledFace.id, 'disabled', actor, null);
  const alone = newCode(newFace().id)[0];
  db.setCodeStatus(alone.id, 'disabled', actor, null);

  for (const [code, expect] of [[expired, 'expired'], [future, 'not_started'], [disabledCode, 'disabled'], [alone, 'disabled']]) {
    const result = db.redeem(code.token, '127.0.0.1', 'ua');
    assert.equal(result.ok, false);
    assert.equal(result.state, expect);
    assert.equal(db.codeDetail(code.id).used_count, 0, `${expect} 状态下不能扣次数`);
  }

  const recycledFace = newFace();
  const recycledCode = newCode(recycledFace.id)[0];
  db.setCouponStatus(recycledFace.id, 'recycled', actor, null);
  const r = db.redeem(recycledCode.token, '127.0.0.1', 'ua');
  assert.equal(r.ok, false);
  assert.equal(r.state, 'recycled');
});

test('原子核销：并发核销不超过每张券码的总次数', async () => {
  const face = newFace({ maxUses: 5 });
  const [{ id, token }] = newCode(face.id);
  const attempts = 12;
  const results = await Promise.all(Array.from({ length: attempts }, () => Promise.resolve().then(() => db.redeem(token, '127.0.0.1', 'ua'))));
  const ok = results.filter((r) => r.ok);
  assert.equal(ok.length, 5, '最多只能成功 5 次');
  assert.equal(db.codeDetail(id).used_count, 5);
  assert.equal(db.redemptionsForCode(id).length, 5, '核销记录数应与成功次数一致');
  const codes = new Set(ok.map((r) => r.redemption.confirmationCode));
  assert.equal(codes.size, 5, '确认码不得重复');
  assert.ok([...codes].every((c) => /^[A-Z2-9]{3}-[A-Z2-9]{3}$/.test(c)), '确认码格式应为 xxx-xxx（6 位、无 0/1/I/O）');
  assert.equal(db.redeem(token, '127.0.0.1', 'ua').ok, false);
  assert.equal(db.codeDetail(id).used_count, 5);
});

test('核销确认码与记录入库（同时记券面与券码）', () => {
  const face = newFace({ maxUses: 2 });
  const [issued] = newCode(face.id, '李四的券', '李四');
  const result = db.redeem(issued.token, '10.0.0.1', 'agent/1.0');
  assert.equal(result.ok, true);
  assert.match(result.redemption.confirmationCode, /^[A-Z2-9]{3}-[A-Z2-9]{3}$/);
  const rows = db.redemptions(face.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source_ip, '10.0.0.1');
  assert.equal(rows[0].user_agent, 'agent/1.0');
  assert.equal(rows[0].email_status, 'pending');
  assert.equal(rows[0].code_id, issued.id);
  assert.equal(rows[0].code_note, '李四', '券面核销记录要带券码备注，便于对账');
  assert.equal(db.redemptionsForCode(issued.id).length, 1);
});

test('券码名可重复；单张显示覆写与全局开关', () => {
  const face = newFace();
  const a = db.createCode(face.id, '同名券码', null, actor);
  const b = db.createCode(face.id, '同名券码', null, actor);
  assert.equal(a.name, b.name, '券码名允许重复，仅作展示');
  assert.equal(db.codesOf(face.id).length, 2);

  const hidden = db.createCode(face.id, '默认隐藏', null, actor, null, 0);
  const shown = db.createCode(face.id, '强制显示', null, actor, null, 1);
  assert.equal(db.codeDetail(hidden.id).show_name, 0);
  assert.equal(db.codeDetail(shown.id).show_name, 1);
  assert.equal(db.codeDetail(a.id).show_name, null, '未指定则跟随全局');

  db.setCodeName(hidden.id, '改名隐藏', actor, null, 0);
  assert.equal(db.codeDetail(hidden.id).name, '改名隐藏');
  assert.equal(db.codeDetail(hidden.id).show_name, 0);
  db.setCodeName(shown.id, '改名不带覆写', actor, null);
  assert.equal(db.codeDetail(shown.id).show_name, 1, '字段缺省保持原覆写值');

  assert.equal(db.voucherDisplay().showCodeName, true, '全局默认显示券码名');
  db.setSetting('showCodeName', 'false');
  assert.equal(db.voucherDisplay().showCodeName, false);
  db.setSetting('showCodeName', 'true');
  assert.equal(db.voucherDisplay().showCodeName, true);
});

test('核销凭证查询：72 小时保留期内可查，只返回展示必需字段', () => {
  const face = newFace({ maxUses: 2 });
  const [issued] = newCode(face.id, '查询用券', '内部备注：发给王五');
  const result = db.redeem(issued.token, '10.0.0.9', 'agent/1.0');
  const code = result.redemption.confirmationCode;
  const since = new Date(Date.now() - 72 * 3600 * 1000).toISOString();

  const row = db.lookupConfirmation(code, since);
  assert.ok(row, '保留期内应查得到');
  assert.equal(row.confirmation_code, code);
  assert.equal(row.face_name, '测试券');
  assert.equal(row.code_name, '查询用券');
  assert.ok(row.redeemed_at);
  assert.equal(row.email_status, 'pending', '查询结果页要展示邮件通知状态');
  for (const hidden of ['note', 'source_ip', 'user_agent', 'token_hash', 'token_ciphertext']) {
    assert.ok(!(hidden in row), `公开查询不得返回 ${hidden}`);
  }

  // 超过保留期
  db.raw.prepare('UPDATE redemptions SET redeemed_at=? WHERE confirmation_code=?')
    .run(new Date(Date.now() - 73 * 3600 * 1000).toISOString(), code);
  assert.equal(db.lookupConfirmation(code, since), null, '超过 72 小时不再可查');
  assert.ok(db.lookupConfirmation(code, new Date(Date.now() - 80 * 3600 * 1000).toISOString()), '放宽窗口后又能查到，证明上面的“查不到”确实是因为超期');

  // 不存在的确认码
  assert.equal(db.lookupConfirmation('ZZZ-ZZZ', since), null);
});

test('更新券面：次数不能低于已核销次数，可修正 exhausted_at', () => {
  const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
  const face = newFace({ maxUses: 2 });
  const [issued] = newCode(face.id);
  db.redeem(issued.token, '127.0.0.1', 'ua');
  assert.equal(db.codeDetail(issued.id).exhausted_at, null, '未用尽时不记录用尽时间');
  db.redeem(issued.token, '127.0.0.1', 'ua');
  assert.ok(db.codeDetail(issued.id).exhausted_at, '用尽应记录时间');

  db.updateCoupon(face.id, { name: '同次数', offerText: 'y', maxUses: 2 }, actor, null);
  assert.throws(() => db.updateCoupon(face.id, { name: 'x', offerText: 'y', maxUses: 1 }, actor, null), /不能小于已核销次数/);
  db.updateCoupon(face.id, { name: '改名', offerText: 'y', maxUses: 5 }, actor, null);
  assert.equal(db.getCoupon(face.id).name, '改名');
  assert.equal(db.codeDetail(issued.id).exhausted_at, null, '放宽次数后应清除用尽时间');
  assert.equal(db.codeDetail(issued.id).current_state, 'valid', '放宽后恢复可核销');

  db.updateCoupon(face.id, { name: '改名', offerText: 'y', maxUses: 5, expiresOn: twoDaysAgo }, actor, null);
  assert.equal(db.couponState(db.getCoupon(face.id)), 'expired');
});

test('统计：可用券码、累计核销、临期券面、回收站合计', () => {
  const before = db.stats();
  const usable = newFace();
  for (let i = 0; i < 3; i += 1) newCode(usable.id, `可用码 ${i + 1}`);
  const burn = newFace({ maxUses: 1 });
  const [burnCode] = newCode(burn.id);
  db.redeem(burnCode.token, '127.0.0.1', 'ua');
  const inTenDays = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  const soon = newFace({ expiresOn: inTenDays });
  newCode(soon.id);
  const gone = newFace();
  db.setCouponStatus(gone.id, 'recycled', actor, null);

  const s = db.stats();
  assert.equal(s.valid - before.valid, 4, '3 张可用 + 1 张临期可用');
  assert.equal(s.used - before.used, 1);
  assert.equal(s.expiring - before.expiring, 1);
  assert.equal(s.recycled - before.recycled, 1);
});

test('回收站自动清理：满 30 天入回收站，再满 30 天永久删除', () => {
  const longAgo = new Date(Date.now() - 40 * 86400000).toISOString().slice(0, 10);
  const veryLongAgo = new Date(Date.now() - 70 * 86400000).toISOString().slice(0, 10);
  const justExpired = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);

  const old = newFace({ expiresOn: longAgo });
  const oldCode = newCode(old.id)[0];
  const veryOld = newFace({ expiresOn: veryLongAgo });
  const veryOldCode = newCode(veryOld.id)[0];
  const recent = newFace({ expiresOn: justExpired });
  newCode(recent.id);
  const disabled = newFace({ expiresOn: longAgo });
  newCode(disabled.id);
  db.setCouponStatus(disabled.id, 'disabled', actor, null);

  const recycled = db.recycleEligible();
  assert.equal(recycled, 6, '过期满 30 天的 3 个券面（含停用）与其下 3 张券码全部入回收站');
  assert.equal(db.couponState(db.getCoupon(old.id)), 'recycled');
  assert.equal(db.codeDetail(oldCode.id).current_state, 'recycled');
  assert.equal(db.couponState(db.getCoupon(recent.id)), 'expired', '刚过期的不能入回收站');
  assert.equal(db.couponState(db.getCoupon(recent.id)) === 'recycled', false);
  assert.equal(db.getCoupon(recent.id).status, 'active');
  assert.equal(db.codeDetail(db.codesOf(recent.id)[0].id).current_state, 'expired');

  // 用尽满 30 天的券码单独进回收站
  const burn = newFace({ maxUses: 1 });
  const [burnCode] = newCode(burn.id);
  db.redeem(burnCode.token, '127.0.0.1', 'ua');
  db.raw.prepare('UPDATE voucher_codes SET exhausted_at=? WHERE id=?').run(new Date(Date.now() - 40 * 86400000).toISOString(), burnCode.id);
  const second = db.recycleEligible();
  assert.equal(second, 1, '只有那张用尽满 30 天的券码');
  assert.equal(db.codeDetail(burnCode.id).current_state, 'recycled');
  assert.equal(db.couponState(db.getCoupon(burn.id)), 'valid', '券面不跟着进回收站');

  // 手动把 veryOld 标成回收站且时间戳是 31 天前 => 永久删除
  const stamp = new Date(Date.now() - 31 * 86400000).toISOString();
  db.raw.prepare("UPDATE coupons SET status='recycled', recycled_at=? WHERE id=?").run(stamp, veryOld.id);
  db.raw.prepare('UPDATE voucher_codes SET recycled_at=? WHERE id=?').run(stamp, veryOldCode.id);
  const purged = db.purgeRecycled();
  assert.equal(purged >= 1, true);
  assert.equal(db.getCoupon(veryOld.id), undefined, '过期 30 天的回收站券面被永久删除');
  assert.equal(db.codeDetail(veryOldCode.id), null, '其券码一并删除');
  assert.ok(db.getCoupon(old.id), '回收站 30 天内的不能删');
});

test('保留参数：后台设置实时生效，非法值回退默认', () => {
  assert.deepEqual(db.retention(), { recycleDays: 30, purgeDays: 30, verifyHours: 72, expiringDays: 30 });

  // 刚过期 5 天：默认 30 天静置期不动它
  const face = newFace({ expiresOn: new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10) });
  db.recycleEligible();
  assert.equal(db.getCoupon(face.id).status, 'active', '未满默认静置期不回收');

  // 静置期改为 3 天后立即生效
  db.setSetting('recycleDays', '3');
  assert.equal(db.retention().recycleDays, 3);
  db.recycleEligible();
  assert.equal(db.getCoupon(face.id).status, 'recycled', '改小静置期后入回收站');

  // 回收时间改到 6 天前、保留期 5 天 => 按新保留期永久删除
  db.raw.prepare("UPDATE coupons SET recycled_at=? WHERE id=?").run(new Date(Date.now() - 6 * 86400000).toISOString(), face.id);
  db.setSetting('purgeDays', '5');
  db.purgeRecycled();
  assert.equal(db.getCoupon(face.id), undefined, '按新保留期永久删除');

  // 越界与脏数据回退默认
  db.setSetting('purgeDays', 'abc');
  db.setSetting('recycleDays', '9999');
  assert.equal(db.retention().purgeDays, 30);
  assert.equal(db.retention().recycleDays, 30);

  // 还原，避免影响后续测试
  db.setSetting('recycleDays', '');
  db.setSetting('purgeDays', '');
});

test('核销记录全局查询：最近列表、分页与券面/日期筛选', () => {
  const face = newFace({ maxUses: 10 });
  const [code] = newCode(face.id);
  const insert = db.raw.prepare('INSERT INTO redemptions(coupon_id,code_id,redeemed_at,source_ip,confirmation_code,email_status) VALUES(?,?,?,?,?,?)');
  insert.run(face.id, code.id, '2026-01-15T04:00:00.000Z', '10.0.0.1', 'RDTESTA', 'sent');
  insert.run(face.id, code.id, '2026-01-20T04:00:00.000Z', '10.0.0.2', 'RDTESTB', 'failed');

  const recent = db.recentRedemptions(3);
  assert.ok(recent.length <= 3, '受 limit 约束');
  assert.ok(recent.every((r) => r.face_name && r.code_name), '最近列表带券面名与券码名');

  const all = db.redemptionsPaged({ couponId: face.id, limit: 20, offset: 0 });
  assert.equal(all.total, 2, '按券面统计总数');
  assert.equal(all.rows[0].confirmation_code, 'RDTESTB', '按核销时间倒序');
  assert.equal(all.rows[0].face_name, db.getCoupon(face.id).name);

  const paged = db.redemptionsPaged({ couponId: face.id, limit: 1, offset: 1 });
  assert.equal(paged.total, 2, '总数不随分页变化');
  assert.equal(paged.rows[0].confirmation_code, 'RDTESTA', '第二页取到较早一条');

  // 日期边界按 UTC ISO 比较（15T04Z = 北京时间 15 日 12:00）
  const inRange = db.redemptionsPaged({ couponId: face.id, from: '2026-01-14T16:00:00.000Z', to: '2026-01-16T15:59:59.999Z' });
  assert.equal(inRange.total, 1, '范围筛选命中一条');
  assert.equal(inRange.rows[0].confirmation_code, 'RDTESTA');
  const after = db.redemptionsPaged({ couponId: face.id, from: '2026-01-16T16:00:00.000Z' });
  assert.equal(after.total, 1, '只留 1 月 20 日那条');
  assert.equal(after.rows[0].confirmation_code, 'RDTESTB');

  const unfiltered = db.redemptionsPaged({ limit: 5, offset: 0 });
  assert.ok(unfiltered.total >= 2, '共享库还有其他核销');
  assert.ok(unfiltered.rows.length <= 5, '无筛选也受分页约束');
});

test('设置加密读写', () => {
  db.setSetting('plainKey', 'plain-value');
  assert.equal(db.getSetting('plainKey'), 'plain-value');
  db.setSetting('secretKey', 'super-secret', true);
  const row = db.raw.prepare('SELECT value, encrypted FROM app_settings WHERE key=?').get('secretKey');
  assert.equal(row.encrypted, 1);
  assert.notEqual(row.value, 'super-secret', '加密设置不应明文入库');
  assert.match(row.value, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, '应为 iv.tag.ciphertext 格式');
  assert.equal(db.getSetting('secretKey'), 'super-secret');
  assert.equal(db.getSetting('missing', 'fallback'), 'fallback');
});

test('预设与审计', () => {
  const created = db.createPreset({ name: '示例总店', instructions: '出示本券', storeText: '营业 10-22' });
  assert.equal(db.allPresets().length, 1);
  assert.equal(db.activePresets()[0].name, '示例总店');
  db.audit(actor, 'test.action', 'coupon', 1, '127.0.0.1');
  const log = db.raw.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 1').get();
  assert.equal(log.action, 'test.action');
  assert.equal(log.actor_id, actor);
  assert.ok(created.lastInsertRowid);
});

test('审计分页：类别/操作人/日期筛选与总数', () => {
  const actor2 = Number(db.createUser('tester2', hashPassword('Test-password-2026'), 'business_admin').lastInsertRowid);
  db.audit(actor, 'coupon.create', 'coupon', 11, '10.0.0.1');
  db.audit(actor2, 'user.create', 'user', 2, '10.0.0.2');
  db.audit(null, 'auth.login_failed', 'user', null, '10.0.0.3');
  // 造一条 2020 年的老记录用于日期上限筛选
  db.raw.prepare("UPDATE audit_log SET created_at='2020-01-01T00:00:00.000Z' WHERE id=(SELECT MAX(id) FROM audit_log)").run();

  const all = db.auditPaged({ limit: 50, offset: 0 });
  assert.ok(all.total >= 3, '无筛选统计全量');

  const byAction = db.auditPaged({ action: 'coupon', limit: 50, offset: 0 });
  assert.ok(byAction.total >= 1);
  assert.ok(byAction.rows.every((r) => r.action.startsWith('coupon.')), '类别按前缀命中');

  const byActor = db.auditPaged({ actorId: actor2, limit: 50, offset: 0 });
  assert.equal(byActor.total, 1, '按操作人唯一定位');
  assert.equal(byActor.rows[0].username, 'tester2', '带上账号名');

  const oldOnly = db.auditPaged({ to: '2021-01-01T00:00:00.000Z', limit: 50, offset: 0 });
  assert.equal(oldOnly.total, 1, '日期上限只命中老记录');
  assert.equal(oldOnly.rows[0].action, 'auth.login_failed');

  const recent = db.auditPaged({ from: '2021-01-02T00:00:00.000Z', limit: 50, offset: 0 });
  assert.ok(recent.rows.every((r) => r.action !== 'auth.login_failed'), '日期下限排除老记录');

  const p1 = db.auditPaged({ limit: 1, offset: 0 });
  const p2 = db.auditPaged({ limit: 1, offset: 1 });
  assert.equal(p1.total, p2.total, '总数不随分页变化');
  assert.notEqual(p1.rows[0].id, p2.rows[0].id, '相邻页取到不同记录');

  const prefixes = db.auditPrefixes();
  assert.ok(prefixes.includes('coupon') && prefixes.includes('auth'), '分类前缀来自实际数据');
});

test('创建券面与券码的审计同样记录来源 IP', () => {
  const face = db.createCoupon({ name: 'IP 审计券', offerText: '立减 5 元', maxUses: 1 }, actor, '10.0.0.9');
  db.createCode(face.id, 'IP 审计码', null, actor, '10.0.0.9');
  const last = (action) => db.raw.prepare('SELECT * FROM audit_log WHERE action = ? ORDER BY id DESC LIMIT 1').get(action);
  assert.equal(last('coupon.create').source_ip, '10.0.0.9', 'coupon.create 不再写死 null');
  assert.equal(last('code.create').source_ip, '10.0.0.9', 'code.create 不再写死 null');
});

test('chinaDate 返回 YYYY-MM-DD（东八区）', () => {
  // 2026-01-01T00:30:00Z 在东八区是 2026-01-01 08:30；16:30Z 是次日 00:30
  assert.equal(chinaDate(new Date('2026-01-01T00:30:00Z')), '2026-01-01');
  assert.equal(chinaDate(new Date('2026-01-01T16:30:00Z')), '2026-01-02');
  assert.match(chinaDate(), /^\d{4}-\d{2}-\d{2}$/);
});
