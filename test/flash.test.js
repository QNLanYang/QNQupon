// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 QNLanYang (全能岚漾)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FLASH_COOKIE, parseFlash, serializeFlash, setFlash, takeFlash } from '../src/flash.js';

const fakeReply = () => ({
  cookies: [],
  setCookie(name, value, options) { this.cookies.push({ name, value, options }); },
  clearCookie(name, options) { this.cookies.push({ name, value: null, options }); }
});

test('操作反馈：序列化与解析往返，非法类型回退 info', () => {
  assert.deepEqual(parseFlash(serializeFlash('券码已创建。', 'success')), { message: '券码已创建。', type: 'success' });
  assert.equal(parseFlash(serializeFlash('券面已移入回收站。', 'weird')).type, 'info', '非法类型回退 info');
});

test('操作反馈：坏 JSON、空消息与超长消息', () => {
  assert.equal(parseFlash('not-json'), null);
  assert.equal(parseFlash(JSON.stringify({})), null);
  assert.equal(parseFlash(serializeFlash('')), null, '空消息视为没有反馈');
  assert.equal(parseFlash(serializeFlash('好'.repeat(500))).message.length, 300, '超长消息截断，避免塞满 Cookie');
});

test('操作反馈：随重定向写入一次性 Cookie（HttpOnly + SameSite=Strict + 60 秒）', () => {
  const reply = fakeReply();
  setFlash(reply, '券面已移入回收站。', 'success', { secure: true });
  const [cookie] = reply.cookies;
  assert.equal(cookie.name, FLASH_COOKIE);
  assert.equal(cookie.options.httpOnly, true, '客户端读不到，也伪造不了');
  assert.equal(cookie.options.sameSite, 'strict');
  assert.equal(cookie.options.secure, true);
  assert.equal(cookie.options.maxAge, 60, '一分钟内没被消费就自行过期');
  assert.deepEqual(parseFlash(cookie.value), { message: '券面已移入回收站。', type: 'success' });
});

test('操作反馈：读出即清除（一次性），没有 Cookie 就没有反馈', () => {
  const reply = fakeReply();
  setFlash(reply, '已创建券码「张三」。', 'success', { secure: true });
  const request = { cookies: { [FLASH_COOKIE]: reply.cookies[0].value } };
  assert.equal(takeFlash(request, reply, { secure: true }).message, '已创建券码「张三」。');
  const cleared = reply.cookies.at(-1);
  assert.equal(cleared.name, FLASH_COOKIE);
  assert.equal(cleared.value, null, '读完即清，刷新不会重复弹');
  assert.equal(takeFlash({ cookies: {} }, reply), null);
});
