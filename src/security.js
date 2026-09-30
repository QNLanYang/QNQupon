// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 QNLanYang (全能岚漾)

import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { Agent, request } from 'node:https';
import { lookup as dnsLookup } from 'node:dns';
import { resolve4 } from 'node:dns/promises';
import { kv, logDebug, logWarn } from './log.js';

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

// ---- Turnstile 回源的出网优化：进程内解析缓存 + keepAlive 连接池 ----
// 动机：出网解析偶发很慢（同一时刻实测 c-ares 0.5s、getaddrinfo 7s），而登录回源等不起；
// 且域名 TTL 只有 66 秒，缓存挡不住。做法：
//   ① 解析走 c-ares（dns.resolve4）并把结果缓存在进程内，绕开 getaddrinfo 的多网卡/后缀流程；
//   ② 回源用 keepAlive 的 https.Agent 复用 TCP+TLS，常态下既不查 DNS 也不握手；
//   ③ 传输失败即作废缓存并后台重解析（应对 Cloudflare 换 IP），本次重试回落系统解析。
const TURNSTILE_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TURNSTILE_HOST = 'challenges.cloudflare.com';

/** 进程内 IPv4 解析缓存：TTL 内直接用；失败沿用旧值（没有旧值则留给回落解析）。 */
export function createIpCache({ host, resolve = resolve4, ttlMs = 10 * 60 * 1000, warnMs = 2000 } = {}) {
  const state = { ips: [], at: 0, inflight: null };
  const refresh = async ({ force = false } = {}) => {
    if (!force && state.ips.length && Date.now() - state.at < ttlMs) return state.ips;
    if (state.inflight) return state.inflight;
    const startedAt = Date.now();
    state.inflight = (async () => {
      try {
        const ips = (await resolve(host)).filter(Boolean);
        const ms = Date.now() - startedAt;
        if (ips.length) { state.ips = ips; state.at = Date.now(); }
        if (ms >= warnMs) logWarn('turnstile.resolve.slow', kv({ host, ms, ip: ips[0] }));
        else logDebug('turnstile.resolve', kv({ host, ms, ip: ips[0] }));
        return state.ips;
      } catch (error) {
        logWarn('turnstile.resolve.failed', kv({ host, message: error?.message }));
        return state.ips;
      } finally {
        state.inflight = null;
      }
    })();
    return state.inflight;
  };
  return {
    refresh,
    get: () => state.ips,
    invalidate: () => { state.ips = []; state.at = 0; }
  };
}

const turnstileIps = createIpCache({ host: TURNSTILE_HOST });

// net 的 lookup：命中缓存立刻返回 IPv4；未命中回落系统解析（只取 IPv4，避免 IPv6 优先的额外等待）。
// Node 18+ 的 Agent 会带 all:true 调 lookup（autoSelectFamily / happy eyeballs），这时必须回「数组」；
// 只回 (err, address, family) 的三参形态会被 Node 当成数组去取 .address，直接报 Invalid IP address: undefined，
// 回源整条断掉（缓存预热后每个新连接都会触发）。
export function createIpLookup({ cache, host, lookup = dnsLookup }) {
  return (hostname, options, callback) => {
    const ips = cache.get();
    if (hostname === host && ips.length) {
      return options && options.all
        ? callback(null, ips.map((address) => ({ address, family: 4 })))
        : callback(null, ips[0], 4);
    }
    return lookup(hostname, { ...options, family: 4 }, callback);
  };
}

const turnstileLookup = createIpLookup({ cache: turnstileIps, host: TURNSTILE_HOST });

const turnstileAgent = new Agent({ keepAlive: true, keepAliveMsecs: 30000, maxSockets: 2, lookup: turnstileLookup });

/** 启动时与定时保温：把解析结果提前放进缓存（只在启用人机验证时由 server.js 调用）。 */
export const warmTurnstileDns = () => turnstileIps.refresh({ force: true });
export function startTurnstileDnsWarmup(intervalMs = 5 * 60 * 1000) {
  void warmTurnstileDns();
  const timer = setInterval(() => { void warmTurnstileDns(); }, intervalMs);
  timer.unref?.();
  return timer;
}

/** fetch 形态的最小实现（只需 ok / status / json）：走 keepAlive agent，传输失败即作废解析缓存。 */
function httpsFetch(url, init) {
  return new Promise((resolve, reject) => {
    const body = String(init?.body ?? '');
    const req = request(url, {
      method: init?.method || 'GET',
      agent: turnstileAgent,
      headers: { ...(init?.headers || {}), 'content-length': Buffer.byteLength(body) },
      signal: init?.signal
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        ok: res.statusCode >= 200 && res.statusCode < 300,
        status: res.statusCode,
        json: async () => JSON.parse(Buffer.concat(chunks).toString('utf8'))
      }));
    });
    req.on('error', (error) => {
      turnstileIps.invalidate();
      void turnstileIps.refresh({ force: true });
      if (error?.name === 'AbortError' || error?.code === 'ABORT_ERR') return reject(new Error('timeout'));
      reject(error);
    });
    req.end(body);
  });
}

// Turnstile 服务端校验：把表单回传的 token 回源 Cloudflare siteverify（token 5 分钟有效、一次性）。
// reason：missing = 页面没带 token；invalid = 回源明确未通过；hostname = 成功但来源域名不在预期集；
// network = 请求没完成（超时/非 2xx/非 JSON，带 detail 供调用方写日志）。expectedHostnames 非空时校验返回的 hostname。
// 回源是出网请求，偶发变慢会被超时掐断：network 结果会隔 retryDelayMs 自动再试一次（其余 reason 是确定性结论，不重试）。
// 两次请求共享同一个 idempotency_key（Cloudflare 为可重试校验提供的幂等键）：若第一次实际已被 CF 处理、
// 只是响应在网络中丢失，重试会回放同一结果，不会因 token 已消费而误判；每次调用各自生成新键，
// 跨请求的 token 一次性语义不放宽。
// fetchImpl 可注入（默认实现见上面的 httpsFetch），供单测在无真实网络时覆盖各分支。
export async function verifyTurnstile({ secret, response, remoteip = '', expectedHostnames = [], fetchImpl = httpsFetch, timeoutMs = 5000, retryDelayMs = 250 }) {
  const startedAt = Date.now();
  const token = String(response || '');
  if (!token) return { success: false, reason: 'missing', codes: [], attempts: 0, ms: 0 };
  const idempotencyKey = randomUUID();
  const attempt = async () => {
    let res;
    try {
      res = await fetchImpl(TURNSTILE_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ secret, response: token, ...(remoteip ? { remoteip } : {}), idempotency_key: idempotencyKey }),
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      return { success: false, reason: 'network', codes: [], detail: String(error?.message || 'fetch failed').slice(0, 120) };
    }
    if (!res || !res.ok) {
      // 4xx 通常是配置或请求问题（如 invalid-input-secret / invalid-input-response），带上服务端返回的
      // error-codes 便于排查；解析不出 error-codes 才按网络故障处理（并保留 http:状态码）。
      let codes = [];
      try {
        const data = await res.json();
        codes = Array.isArray(data && data['error-codes']) ? data['error-codes'].slice(0, 8).map(String) : [];
      } catch { codes = []; }
      if (codes.length) return { success: false, reason: 'invalid', codes };
      return { success: false, reason: 'network', codes: [], detail: `http:${res?.status ?? 'unknown'}` };
    }
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
      return { success: false, reason: 'network', codes: [], detail: 'bad-json' };
    }
  };
  let verdict = await attempt();
  let attempts = 1;
  if (verdict.reason === 'network') {
    if (retryDelayMs > 0) await new Promise((resolve) => { setTimeout(resolve, retryDelayMs); });
    verdict = await attempt();
    attempts = 2;
  }
  // attempts / ms 只用于日志与排查（回源了几次、总共多久），不改变判定语义
  return { ...verdict, attempts, ms: Date.now() - startedAt };
}
