// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 QNLanYang (全能岚漾)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encrypt, decrypt, hashPassword, verifyPassword, normalizeCode, randomToken, randomCode, randomId, sha256, safeEqual, verifyTurnstile } from '../src/security.js';

const key = 'test-key-0123456789';

test('randomToken 生成 base64url 且长度足够', () => {
  const token = randomToken(32);
  assert.match(token, /^[A-Za-z0-9_-]+$/);
  assert.ok(token.length >= 42, `token too short: ${token.length}`);
  const many = new Set(Array.from({ length: 200 }, () => randomToken(32)));
  assert.equal(many.size, 200, '随机 token 应当不重复');
});

test('券码 ID：cd- 前缀 + 12 位随机字母数字，且互不相同', () => {
  const ids = new Set(Array.from({ length: 500 }, () => randomId()));
  assert.equal(ids.size, 500, '券码 ID 必须唯一');
  for (const id of ids) assert.match(id, /^cd-[A-Za-z0-9]{12}$/, `非法 ID：${id}`);
  assert.equal(randomId('xx-', 8).slice(0, 3), 'xx-', '前缀可自定义');
});

test('确认码规范化：大小写/空格/连字符等价，非法输入返回 null', () => {
  assert.equal(normalizeCode('k7m2qd'), 'K7M-2QD');
  assert.equal(normalizeCode('K7M-2QD'), 'K7M-2QD');
  assert.equal(normalizeCode('  k7m 2qd '), 'K7M-2QD', '容忍空格');
  assert.equal(normalizeCode('AB2CDZ'), 'AB2-CDZ');
  assert.equal(normalizeCode('ABC123'), null, '含 1 非法');
  assert.equal(normalizeCode('ABCO23'), null, '含 O 非法');
  assert.equal(normalizeCode('ABCIO23'), null, '含 I 非法');
  assert.equal(normalizeCode('AB0123'), null, '含 0 非法');
  assert.equal(normalizeCode('abcde'), null, '少于 6 位');
  assert.equal(normalizeCode('abcdefg'), null, '多于 6 位');
  assert.equal(normalizeCode(''), null);
  assert.equal(normalizeCode(null), null);
});

test('sha256 稳定且长度为 64 hex', () => {
  assert.equal(sha256('abc').length, 64);
  assert.equal(sha256('abc'), sha256('abc'));
  assert.notEqual(sha256('abc'), sha256('abd'));
});

test('密码哈希往返 + 错误密码拒绝', () => {
  const encoded = hashPassword('Correct-horse-2026');
  assert.ok(verifyPassword('Correct-horse-2026', encoded));
  assert.ok(!verifyPassword('wrong', encoded));
  assert.ok(!verifyPassword('Correct-horse-2026', 'malformed'));
  const again = hashPassword('Correct-horse-2026');
  assert.notEqual(encoded, again, '同一密码两次哈希应不同（随机盐）');
});

test('AES-256-GCM 加解密往返、错误密钥与篡改均失败', () => {
  const plain = 'token-你好-32字节随机xxxxxxxx';
  const payload = encrypt(plain, key);
  assert.equal(decrypt(payload, key), plain);
  assert.notEqual(payload, plain);
  const [iv, tag, value] = payload.split('.');
  // 错误密钥
  assert.throws(() => decrypt(payload, 'another-key'), /unable to authenticate|bad decrypt|Unsupported state/i);
  // 篡改密文
  const tampered = [iv, tag, Buffer.from(value, 'base64url').map((b, i) => (i === 0 ? b ^ 1 : b)).toString('base64url')].join('.');
  assert.throws(() => decrypt(tampered, key));
  // 篡改认证标签
  assert.throws(() => decrypt([iv, 'AAAA' + tag.slice(4), value].join('.'), key));
  // 格式非法
  assert.throws(() => decrypt('not-a-payload', key), /密文格式无效/);
});

test('safeEqual 长度不同或内容不同都返回 false', () => {
  assert.ok(safeEqual('abc', 'abc'));
  assert.ok(!safeEqual('abc', 'abcd'));
  assert.ok(!safeEqual('abc', 'abd'));
  assert.ok(!safeEqual(undefined, 'abc'));
});

test('确认码为 xxx-xxx 共 6 位，字符集不含易混淆字符', () => {
  const codes = new Set(Array.from({ length: 400 }, () => randomCode()));
  for (const code of codes) {
    assert.match(code, /^[A-Z2-9]{3}-[A-Z2-9]{3}$/, `非法确认码：${code}`);
    assert.ok(!/[01IO]/.test(code), `含易混淆字符：${code}`);
  }
  assert.ok(codes.size > 350, '应有足够的随机性');
});

test('verifyTurnstile：回源成功且域名符合预期才放行，请求带 secret、token 与来源 IP', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => ({ success: true, hostname: 'coupon.example.com' }) };
  };
  const verdict = await verifyTurnstile({ secret: 's3cret', response: 'tok-1', remoteip: '203.0.113.9', expectedHostnames: ['coupon.example.com', 'localhost'], fetchImpl });
  assert.equal(verdict.success, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
  const body = String(calls[0].options.body);
  assert.ok(body.includes('secret=s3cret') && body.includes('response=tok-1') && body.includes('remoteip=203.0.113.9') && body.includes('idempotency_key='), `请求体应含 secret、token、来源 IP 与幂等键：${body}`);
  assert.ok(calls[0].options.signal, '应带超时信号');
});

test('verifyTurnstile：hostname 不在预期集拒绝，未返回放行，端口与大小写可归一比对', async () => {
  const replyWith = (data) => async () => ({ ok: true, json: async () => data });
  const mismatch = await verifyTurnstile({ secret: 's', response: 't', expectedHostnames: ['coupon.example.com'], fetchImpl: replyWith({ success: true, hostname: 'evil.example.net' }) });
  assert.equal(mismatch.success, false);
  assert.equal(mismatch.reason, 'hostname');
  assert.deepEqual(mismatch.codes, ['hostname-mismatch']);
  const absent = await verifyTurnstile({ secret: 's', response: 't', expectedHostnames: ['coupon.example.com'], fetchImpl: replyWith({ success: true }) });
  assert.equal(absent.success, true, 'CF 未返回 hostname 时无可比对，放行');
  const withPort = await verifyTurnstile({ secret: 's', response: 't', expectedHostnames: ['localhost'], fetchImpl: replyWith({ success: true, hostname: 'LOCALHOST:3100' }) });
  assert.equal(withPort.success, true, '端口与大小写差异应归一后匹配');
  const unchecked = await verifyTurnstile({ secret: 's', response: 't', expectedHostnames: [], fetchImpl: replyWith({ success: true, hostname: 'any.example' }) });
  assert.equal(unchecked.success, true, '未给出预期域名时不做该检查');
  const testingKey = await verifyTurnstile({ secret: 's', response: 't', expectedHostnames: ['coupon.example.com'], fetchImpl: replyWith({ success: true, hostname: 'example.com', metadata: { result_with_testing_key: true } }) });
  assert.equal(testingKey.success, true, '测试密钥的占位 hostname（example.com）跳过核对');
});

test('verifyTurnstile：无效 token 拒绝并带回错误码，缺 token 不发请求', async () => {
  let called = 0;
  const fetchImpl = async () => { called += 1; return { ok: true, json: async () => ({ success: false, 'error-codes': ['invalid-input-response'] }) }; };
  const bad = await verifyTurnstile({ secret: 's', response: 'tok-bad', fetchImpl });
  assert.equal(bad.success, false);
  assert.equal(bad.reason, 'invalid');
  assert.deepEqual(bad.codes, ['invalid-input-response']);
  const missing = await verifyTurnstile({ secret: 's', response: '', fetchImpl });
  assert.equal(missing.success, false);
  assert.equal(missing.reason, 'missing');
  assert.equal(called, 1, '缺 token 时不应发起回源请求');
});

test('verifyTurnstile：网络错误、非 2xx 与坏 JSON 一律归为 network（fail-closed，重试后仍失败）', async () => {
  const thrown = await verifyTurnstile({ secret: 's', response: 't', fetchImpl: async () => { throw new Error('ECONNRESET'); }, retryDelayMs: 0 });
  assert.equal(thrown.success, false);
  assert.equal(thrown.reason, 'network');
  assert.equal(thrown.detail, 'ECONNRESET', 'network 结果带失败详情供日志定位');
  const badStatus = await verifyTurnstile({ secret: 's', response: 't', fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }), retryDelayMs: 0 });
  assert.equal(badStatus.reason, 'network');
  assert.equal(badStatus.detail, 'http:503');
  const badJson = await verifyTurnstile({ secret: 's', response: 't', fetchImpl: async () => ({ ok: true, json: async () => { throw new Error('not json'); } }), retryDelayMs: 0 });
  assert.equal(badJson.reason, 'network');
  assert.equal(badJson.detail, 'bad-json');
});

test('verifyTurnstile：回源失败重试一次，重试共享同一幂等键，新调用换新键', async () => {
  const bodies = [];
  const fetchImpl = async (url, options) => { bodies.push(String(options.body)); throw new Error('ETIMEDOUT'); };
  const verdict = await verifyTurnstile({ secret: 's', response: 't', fetchImpl, retryDelayMs: 0 });
  assert.equal(verdict.reason, 'network');
  assert.equal(bodies.length, 2, '网络失败应自动重试一次');
  const key1 = new URLSearchParams(bodies[0]).get('idempotency_key');
  const key2 = new URLSearchParams(bodies[1]).get('idempotency_key');
  assert.ok(key1 && key1 === key2, '两次请求必须共享同一 idempotency_key');
  assert.match(key1, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, '幂等键是 UUID');
  await verifyTurnstile({ secret: 's', response: 't', fetchImpl, retryDelayMs: 0 });
  const key3 = new URLSearchParams(bodies[2]).get('idempotency_key');
  assert.notEqual(key3, key1, '每次校验各自生成新键，token 一次性语义不放宽');
});

test('verifyTurnstile：首次回源网络失败、重试成功则放行', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; if (calls === 1) throw new Error('socket hang up'); return { ok: true, json: async () => ({ success: true }) }; };
  const verdict = await verifyTurnstile({ secret: 's', response: 't', fetchImpl, retryDelayMs: 0 });
  assert.equal(verdict.success, true, '第二次回源成功即放行');
  assert.equal(calls, 2);
});
