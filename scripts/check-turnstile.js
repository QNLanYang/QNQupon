// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 QNLanYang (全能岚漾)
//
// 人机验证（Cloudflare Turnstile）连通性自检：真实跑一次 siteverify 回源，验证 DNS / TLS / HTTP / JSON
// 全链路是否通、各自耗时多少（第一次为冷启动，之后应明显更快——回源内置解析缓存与 keepAlive 复用）。
// 只读检查：不写库、不改配置、不消耗任何额度。
//
// 用法：
//   node scripts/check-turnstile.js                 官方测试密钥，只验连通性
//   node scripts/check-turnstile.js --secret=xxxx   额外验证自己的密钥是否被 Cloudflare 接受
//                                                   （也可先在 .env 配好 TURNSTILE_SECRET，脚本会自动带上）
// 退出码：0 = 连通且（如提供密钥）密钥有效；1 = 异常，可挂到监控里。

import 'dotenv/config';
import { configureLog } from '../src/log.js';
import { verifyTurnstile, warmTurnstileDns } from '../src/security.js';

// Cloudflare 官方测试密钥：恒过 / 恒失败（仅用于联调与自检）
const PASS_SECRET = '1x0000000000000000000000000000000AA';
const FAIL_SECRET = '2x0000000000000000000000000000000AA';
const FAKE_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

const arg = process.argv.slice(2).find((value) => value.startsWith('--secret='));
const ownSecret = (arg ? arg.slice('--secret='.length) : process.env.TURNSTILE_SECRET || '').trim();

configureLog({ level: process.env.LOG_LEVEL || 'debug', timeZone: 'Asia/Shanghai' });

// 先预热解析缓存（服务器启动就会做这件事），让第 1 次回源就命中「缓存 + 新建连接」这条真实路径：
// 不预热的话首次请求走的是系统解析回落，加上 keepAlive 复用，反而测不到生产里的分支。
await warmTurnstileDns();

async function check(label, secret) {
  const startedAt = Date.now();
  const verdict = await verifyTurnstile({ secret, response: FAKE_TOKEN, timeoutMs: Number(process.env.TURNSTILE_TIMEOUT_MS) || 15000 });
  console.log(`${label} → ${JSON.stringify(verdict)}  耗时=${Date.now() - startedAt}ms`);
  return verdict;
}

console.log('— 官方测试密钥：验证连通性与耗时（第 1 次冷启动，第 2/3 次走缓存与长连接）—');
let first = null;
for (const round of [1, 2, 3]) {
  const verdict = await check(`恒过密钥 第 ${round} 次`, PASS_SECRET);
  if (round === 1) first = verdict;
}
const blocked = await check('恒失败密钥', FAIL_SECRET);

let failed = first?.success !== true;
if (blocked.reason !== 'invalid') {
  console.log('✗ 恒失败密钥应回 invalid（带 error-codes），实际不是：回源行为异常');
  failed = true;
}

if (ownSecret) {
  console.log('— 你的密钥：期望 invalid-input-response（说明密钥有效，只是 token 是伪造的）—');
  const verdict = await check('你的密钥', ownSecret);
  const codes = verdict.codes || [];
  if (codes.includes('invalid-input-secret')) {
    console.log('✗ Cloudflare 认为密钥无效（invalid-input-secret）：请核对 TURNSTILE_SECRET');
    failed = true;
  } else if (verdict.success) {
    console.log('✓ 密钥有效（亦可通行）');
  } else if (codes.includes('invalid-input-response')) {
    console.log('✓ 密钥有效');
  } else if (verdict.reason === 'network') {
    console.log(`✗ 回源未完成（detail=${verdict.detail}）：网络或超时问题，可调大 TURNSTILE_TIMEOUT_MS`);
    failed = true;
  }
} else {
  console.log('（未提供自己的密钥：加 --secret=… 可顺带验证密钥有效性）');
}

console.log(failed ? '结果：异常' : '结果：正常');
process.exit(failed ? 1 : 0);
