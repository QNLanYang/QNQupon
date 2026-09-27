// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 QNLanYang (全能岚漾)

import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
/** 6 位确认码，形如 ABC-123。字符集 32 个：24 个字母（去掉 I、O）+ 8 个数字（去掉 0、1）。 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function randomCode(length = 6) {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    if (i === Math.ceil(length / 2)) out += '-';
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}
/** 券码 ID：cd- + 12 位随机字母数字（base62 ≈ 71 bit 熵，不可枚举、不暴露数量）。 */
const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
export function randomId(prefix = 'cd-', length = 12) {
  const limit = Math.floor(256 / ID_ALPHABET.length) * ID_ALPHABET.length; // 248：丢弃越界字节，消除取模偏差
  let out = '';
  while (out.length < length) {
    for (const byte of randomBytes(length)) {
      if (byte >= limit) continue;
      out += ID_ALPHABET[byte % ID_ALPHABET.length];
      if (out.length === length) break;
    }
  }
  return `${prefix}${out}`;
}

/**
 * 规范化用户输入的确认码为 ABC-DEF 形式；格式非法返回 null。
 * 容忍大小写、多余空格与连字符（"k7m2qd" / "K7M-2QD" / "K7M 2QD" 等价）。
 * 字符集与 randomCode 一致：A-Z 去掉 I/O、2-9 去掉 0/1。
 */
export function normalizeCode(input) {
  const raw = String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(raw)) return null;
  return `${raw.slice(0, 3)}-${raw.slice(3)}`;
}

export const safeEqual = (left, right) => {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
};

export function hashPassword(password) {
  const salt = randomBytes(16).toString('base64url');
  const hash = scryptSync(password, salt, 64).toString('base64url');
  return `${salt}.${hash}`;
}

export function verifyPassword(password, encoded) {
  const [salt, hash] = String(encoded).split('.');
  if (!salt || !hash) return false;
  return safeEqual(scryptSync(password, salt, 64).toString('base64url'), hash);
}

function keyFrom(secret) { return createHash('sha256').update(secret).digest(); }

export function encrypt(plain, secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(secret), iv);
  const encrypted = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return [iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}

export function decrypt(payload, secret) {
  const [iv, tag, value] = String(payload).split('.');
  if (!iv || !tag || !value) throw new Error('密文格式无效');
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(secret), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(value, 'base64url')), decipher.final()]).toString('utf8');
}

// 归一化域名：去端口、去方括号、小写——与 server.js 的后台 Host 白名单同一套口径。
const normalizeHostname = (value) => { try { return new URL(`http://${String(value ?? '').trim()}`).hostname.toLowerCase().replace(/^\[|\]$/g, ''); } catch { return ''; } };

// Turnstile 服务端校验：把表单回传的 token 回源 Cloudflare siteverify（token 5 分钟有效、一次性）。
// reason：missing = 页面没带 token；invalid = 回源明确未通过；hostname = 成功但来源域名不在预期集；
// network = 请求没完成（超时/非 2xx/非 JSON）。expectedHostnames 非空时校验返回的 hostname。
// fetchImpl 可注入，供单测在无真实网络时覆盖各分支。
export async function verifyTurnstile({ secret, response, remoteip = '', expectedHostnames = [], fetchImpl = globalThis.fetch, timeoutMs = 5000 }) {
  const token = String(response || '');
  if (!token) return { success: false, reason: 'missing', codes: [] };
  let res;
  try {
    res = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token, ...(remoteip ? { remoteip } : {}) }),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch {
    return { success: false, reason: 'network', codes: [] };
  }
  if (!res || !res.ok) return { success: false, reason: 'network', codes: [] };
  try {
    const data = await res.json();
    if (data && data.success === true) {
      // 成功时比对 hostname（token 在哪个域名上跑出来的）：不在预期集 = 在别处跑的 token，拒绝。
      // CF 未返回该字段时无可比对，放行——该字段由 CF 经 HTTPS 返回，攻击者无法剥离或伪造。
      // 测试密钥的 hostname 固定为占位值 example.com（CF 以 metadata.result_with_testing_key 标记），跳过核对。
      const testing = Boolean(data.metadata && data.metadata.result_with_testing_key === true);
      const seen = testing ? '' : normalizeHostname(data.hostname);
      if (seen && expectedHostnames.length && !expectedHostnames.some((name) => normalizeHostname(name) === seen)) {
        return { success: false, reason: 'hostname', codes: ['hostname-mismatch'] };
      }
      return { success: true, reason: null, codes: [] };
    }
    return { success: false, reason: 'invalid', codes: Array.isArray(data && data['error-codes']) ? data['error-codes'].slice(0, 8).map(String) : [] };
  } catch {
    return { success: false, reason: 'network', codes: [] };
  }
}
