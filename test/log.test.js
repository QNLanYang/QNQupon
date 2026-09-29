// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 QNLanYang (全能岚漾)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configureLog, kv, logError, logInfo, logWarn, safePath } from '../src/log.js';
import { createDb } from '../src/db.js';
import { hashPassword } from '../src/security.js';

const out = [];
const err = [];
const collect = () => configureLog({ level: 'info', timeZone: 'Asia/Shanghai', out: (line) => out.push(line), err: (line) => err.push(line) });

test('未配置前完全静默（库内使用/测试默认不产生输出）', () => {
  logInfo('silent.check', kv({ a: 1 }));
  logWarn('silent.check');
  logError('silent.check');
  assert.equal(out.length + err.length, 0);
});

test('配置后输出单行日志：北京时间戳 + 级别 + 事件 + k=v 字段', () => {
  collect();
  logInfo('request', kv({ method: 'GET', path: '/admin', status: 200, ms: 12, ip: '127.0.0.1' }));
  assert.equal(out.length, 1);
  assert.match(out[0], /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\+08:00 INFO {2}request method=GET path=\/admin status=200 ms=12 ip=127\.0\.0\.1\n$/, '时间戳用北京时间并带偏移量，级别定宽便于扫读');
});

test('级别过滤：warn 时不输出 info；error 走 stderr', () => {
  out.length = 0;
  err.length = 0;
  configureLog({ level: 'warn', timeZone: 'Asia/Shanghai', out: (line) => out.push(line), err: (line) => err.push(line) });
  logInfo('quiet');
  logWarn('kept');
  logError('to-stderr');
  assert.equal(out.length, 1, 'info 被过滤、warn 保留');
  assert.match(out[0], / WARN {2}kept\n$/);
  assert.equal(err.length, 1, 'error 走 stderr，便于 systemd 分级收集');
  assert.match(err[0], / ERROR to-stderr\n$/);
});

test('字段渲染：空值不出现，含空白或引号的值加引号', () => {
  assert.equal(kv({ a: 1, b: '', c: null, d: undefined, e: 'x y', f: 'a"b' }), 'a=1 e="x y" f="a\\"b"');
});

test('路径脱敏：Token 与确认码掩码，查询串一概丢弃', () => {
  assert.equal(safePath(`/r/${'A'.repeat(43)}`), '/r/<token>');
  assert.equal(safePath('/api/verify/K7M-2QD'), '/api/verify/<code>');
  assert.equal(safePath('/verify?code=K7M-2QD'), '/verify', '确认码在查询串里，同样不进日志');
  assert.equal(safePath('/admin/redemptions?coupon=3&from=2026-09-01'), '/admin/redemptions');
  assert.equal(safePath('/admin/coupons/1'), '/admin/coupons/1', '普通路径原样保留');
});

test('业务操作与安全事件同时进日志（审计水闸一处接入）', () => {
  const lines = [];
  configureLog({ level: 'info', timeZone: 'Asia/Shanghai', out: (line) => lines.push(line), err: () => {} });
  const dir = mkdtempSync(join(tmpdir(), 'qnqupon-log-'));
  const db = createDb({ databasePath: join(dir, 'log.db'), encryptionKey: 'test-encryption-key' });
  const actor = Number(db.createUser('logger', hashPassword('Log-password-2026'), 'super_admin').lastInsertRowid);

  db.createCoupon({ name: '日志测试券', offerText: '立减 1 元', maxUses: 1 }, actor, '10.0.0.1');
  const line = lines.find((item) => item.includes('coupon.create'));
  assert.ok(line, '创建券面要出日志');
  assert.match(line, /actor=logger/, '日志带操作人用户名');
  assert.match(line, /ip=10\.0\.0\.1/, '日志带来源 IP');

  lines.length = 0;
  db.audit(null, 'auth.login_failed', 'user', null, '10.0.0.2', { username: 'someone', reason: '密码错误' });
  assert.match(lines[0], /auth\.login_failed .*actor=- .*ip=10\.0\.0\.2/, '失败登录（无操作人）也要出日志');
});
