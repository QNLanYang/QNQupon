// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 QNLanYang (全能岚漾)

import 'dotenv/config';
import { resolve } from 'node:path';

const required = ['APP_ENCRYPTION_KEY', 'SESSION_SECRET'];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  throw new Error(`缺少 ${missing.join(', ')}。请复制 .env.example 为 .env，并填入足够随机、足够长的字符串（可运行 scripts/generate-secrets.js 生成）。`);
}

// 登录页 Cloudflare Turnstile 人机验证（可选防护）：两把密钥必须同时填写，皆空 = 关闭。
const turnstileSiteKey = String(process.env.TURNSTILE_SITEKEY || '').trim();
const turnstileSecret = String(process.env.TURNSTILE_SECRET || '').trim();
if (Boolean(turnstileSiteKey) !== Boolean(turnstileSecret)) {
  throw new Error('TURNSTILE_SITEKEY 与 TURNSTILE_SECRET 必须同时设置；不启用人机验证请两项都留空。');
}

// 整数环境变量：空值或越界一律回退默认，避免 .env 里写错直接把服务打挂。
const intEnv = (value, fallback, min, max) => {
  const n = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};

// 限流规格环境变量，格式「次数/窗口」（如 10/10m = 10 分钟内最多 10 次），
// 窗口单位支持 s/m/h/d；格式非法回退该条目的默认值。
const rateEnv = (value, fallback) => {
  const match = /^(\d+)\/(\d+)([smhd])$/.exec(String(value || '').trim());
  if (!match) return Object.freeze({ ...fallback });
  const unitMs = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[match[3]];
  return Object.freeze({ max: Number(match[1]), timeWindow: Number(match[2]) * unitMs });
};

export const config = Object.freeze({
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT || 3100),
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || 'https://coupon.example.com').replace(/\/$/, ''),
  // 后台 Host 白名单：localhost / 127.0.0.1 / [::1] 由 server.js 恒放行，这里只收其余访问方式（内网域名或 IP）。
  adminHosts: new Set((process.env.ADMIN_HOSTS || '').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean)),
  databasePath: resolve(process.cwd(), process.env.DATABASE_PATH || './data/qnqupon.db'),
  encryptionKey: process.env.APP_ENCRYPTION_KEY,
  sessionSecret: process.env.SESSION_SECRET,
  cookieSecure: process.env.COOKIE_SECURE !== 'false',
  // 防护参数（改 .env 后重启生效）：会话有效期、密码最少位数、各入口限流、登录人机验证。
  turnstileSiteKey,
  turnstileSecret,
  turnstileEnabled: Boolean(turnstileSiteKey),
  sessionHours: intEnv(process.env.SESSION_HOURS, 12, 1, 720),
  passwordMinLength: intEnv(process.env.PASSWORD_MIN_LENGTH, 12, 8, 128),
  rateLimits: Object.freeze({
    redeemPage: rateEnv(process.env.RATE_LIMIT_REDEEM_PAGE, { max: 90, timeWindow: 60000 }),
    redeem: rateEnv(process.env.RATE_LIMIT_REDEEM, { max: 12, timeWindow: 60000 }),
    verify: rateEnv(process.env.RATE_LIMIT_VERIFY, { max: 30, timeWindow: 60000 }),
    setup: rateEnv(process.env.RATE_LIMIT_SETUP, { max: 5, timeWindow: 600000 }),
    login: rateEnv(process.env.RATE_LIMIT_LOGIN, { max: 10, timeWindow: 600000 }),
    profile: rateEnv(process.env.RATE_LIMIT_PROFILE, { max: 5, timeWindow: 600000 }),
    adminWrite: rateEnv(process.env.RATE_LIMIT_ADMIN_WRITE, { max: 30, timeWindow: 600000 }),
    adminManage: rateEnv(process.env.RATE_LIMIT_ADMIN_MANAGE, { max: 10, timeWindow: 600000 }),
    adminSensitive: rateEnv(process.env.RATE_LIMIT_ADMIN_SENSITIVE, { max: 5, timeWindow: 600000 })
  }),
  timezone: 'Asia/Shanghai',
  backupDir: resolve(process.cwd(), './data/backups')
});
