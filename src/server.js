// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 QNLanYang (全能岚漾)

import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import QRCode from 'qrcode';
import { config } from './config.js';
import { createDb } from './db.js';
import { setFlash, takeFlash } from './flash.js';
import { hashPassword, normalizeCode, randomToken, safeEqual, sha256, startTurnstileDnsWarmup, verifyPassword, verifyTurnstile } from './security.js';
import { renderCouponPng } from './png-render.js';
import { sendRedemptionMail, sendTestMail } from './mailer.js';
import { configureLog, kv, logError, logInfo, logWarn, safePath } from './log.js';
import * as view from './views.js';

// 日志：单行写 stdout/stderr，外置进程（systemd Journal / nssm）收集轮转；时间与页面一致用北京时间。
configureLog({ level: config.logLevel, timeZone: config.timezone });

const db = createDb(config);
const bootstrapToken = db.hasSuperAdmin() ? null : randomToken(24);
if (bootstrapToken) {
  // 拼出可直接点开的链接：监听 0.0.0.0 / :: 时用回环地址（localhost 恒在后台白名单内），IPv6 字面量补方括号
  const linkHost = config.host === '0.0.0.0' || config.host === '::' ? '127.0.0.1' : config.host;
  const origin = `http://${linkHost.includes(':') && !linkHost.startsWith('[') ? `[${linkHost}]` : linkHost}:${config.port}`;
  console.log('\n=== QNQupon 首次初始化 ===');
  console.log(`打开 ${origin}/admin/setup 并输入一次性初始化口令：${bootstrapToken}`);
  console.log('该口令只保存在当前进程内；创建超级管理员后立即失效。\n');
}

// 反向代理信任：生产在 .env 设 TRUST_PROXY=127.0.0.1（只信任本机反向代理传来的真实 IP）。
// 只有信任链正确，限流分桶和核销记录里的 IP 才是真实客户端 IP，否则反代后全部退化成 127.0.0.1
// 共用一个桶；不设则取 TCP 对端 IP（开发直连场景）。不要用 "true"=全信任，XFF 可被伪造。
const trustProxy = (() => {
  const raw = String(process.env.TRUST_PROXY || '').trim();
  if (!raw || raw.toLowerCase() === 'false') return false;
  if (raw.toLowerCase() === 'true') return true;
  return raw;
})();
const app = Fastify({
  logger: false,
  trustProxy,
  bodyLimit: 32 * 1024
});
await app.register(cookie);
await app.register(formbody);
await app.register(rateLimit, {
  global: false,
  keyGenerator: (request) => request.ip,
  // 触发限流时抛出的错误会进入 setErrorHandler，这里直接给人话 message
  errorResponseBuilder: (request, context) => Object.assign(
    new Error(`请求太频繁了，请约 ${Math.max(1, Math.ceil(Number(context.ttl || 60000) / 60000))} 分钟后再试。`),
    { statusCode: context.statusCode || 429 }
  )
});
await app.register(fastifyStatic, { root: join(process.cwd(), 'public'), prefix: '/assets/' });

// Service Worker：必须由根路径提供，才能拿到 /admin 这个 scope（/assets/ 下的脚本默认只能控 /assets/）。
// 响应 no-store：改了这个文件要尽快生效，别被中间层或浏览器拖 24 小时。
// 它只做透传、不缓存任何东西，理由见 public/sw.js 顶部说明——后台要看实时数据。
app.get('/sw.js', async (request, reply) => reply
  .type('application/javascript; charset=utf-8')
  .header('Cache-Control', 'no-store')
  .header('Service-Worker-Allowed', '/')
  .send(readFileSync(join(process.cwd(), 'public', 'sw.js'), 'utf8')));

// 安全响应头：应用层统一下发，无论从哪个入口访问都走同一条代码路径，可进测试断言。
// 严格 CSP：脚本/样式/图片/接口只准来自本站，禁止内联脚本与外站资源。
// 某处即使漏了 HTML 转义，注入的脚本也会被浏览器拒绝执行（防 XSS 造成后果的保险丝）。
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
// 仅登录页启用人机验证时放行 Turnstile 的组件脚本与 iframe（由 onSend 按路由替换），全站其余页面零第三方源。
const CSP_TURNSTILE = CSP.replace("script-src 'self';", "script-src 'self' https://challenges.cloudflare.com; frame-src 'self' https://challenges.cloudflare.com;");
const SECURE_HEADERS = [
  ['X-Content-Type-Options', 'nosniff'], // 禁止浏览器对响应类型嗅探猜测
  ['X-Frame-Options', 'DENY'], // 防点击劫持：任何站点不得内嵌核销页/后台页骗人点核销
  ['Referrer-Policy', 'no-referrer'], // 券页 URL 即 Token，绝不随跳转/图片请求外发
  ['Permissions-Policy', 'camera=(), microphone=(), geolocation=()'], // 本站不需要这些能力，直接关死
  ['Content-Security-Policy', CSP]
];
app.addHook('onSend', async (request, reply, payload) => {
  for (const [name, value] of SECURE_HEADERS) reply.header(name, value);
  if (config.turnstileEnabled && request.routeOptions?.url === '/admin/login') reply.header('Content-Security-Policy', CSP_TURNSTILE);
  // 后台页、核销页、查询结果禁止任何缓存：防公用电脑回看，防代理把 /verify 结果串号缓存过期
  const type = String(reply.getHeader('content-type') || '');
  if (/text\/html|application\/json/.test(type)) reply.header('Cache-Control', 'no-store');
  return payload;
});

// 后台 Host 白名单：本机访问（localhost / 127.0.0.1 / [::1]）恒放行，无需配置；
// 其余 Host 走 ADMIN_HOSTS——既决定后台从哪些域名/IP 可达，也顺带防 DNS rebinding。
const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1']);
const hostName = (request) => { try { return new URL(`http://${request.headers.host || ''}`).hostname.toLowerCase().replace(/^\[|\]$/g, ''); } catch { return ''; } };
const adminHostAllowed = (request) => { const name = hostName(request); return Boolean(name) && (loopbackHosts.has(name) || config.adminHosts.has(name)); };
const clientIp = (request) => String(request.ip || '').slice(0, 64);
const flashFrom = (request, reply) => takeFlash(request, reply, { secure: config.cookieSecure });
// 操作反馈随重定向下发（一次性 Cookie），不再把消息拼进查询串：链接干净、刷新不重复、客户端伪造不了
const redirectNotice = (reply, path, message, type = 'success') => {
  setFlash(reply, message, type, { secure: config.cookieSecure });
  return reply.redirect(path);
};
// 状态类操作回到来源页：表单带 return（仅接受同源后台路径）时以它为准，否则回落到兜底页
const returnPath = (request, fallback) => {
  const value = String(request.body?.return || '');
  return /^\/admin\/[A-Za-z0-9/_-]*$/.test(value) ? value : fallback;
};
const isDate = (value) => !value || /^\d{4}-\d{2}-\d{2}$/.test(value);
// 日期筛选参数 → UTC ISO 边界：按北京时间自然日换算（起始 00:00、截止 23:59:59.999）；
// 非法日期返回 null，不参与筛选。
const dayBoundaryIso = (raw, endOfDay = false) => {
  const text = String(raw || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T${endOfDay ? '23:59:59.999' : '00:00:00'}+08:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};
const readText = (body, key, max = 1000) => String(body?.[key] || '').trim().slice(0, max);
// 券码名显示覆写：表单值 1=始终显示、0=始终隐藏、空=跟随全局；字段缺省保持原值。
const parseShow = (value) => (value === undefined ? undefined : (value === '1' ? 1 : (value === '0' ? 0 : null)));
// 公开核销页与券面 PNG 是否带券码名：单张 show_name 覆写优先，否则用全局设置（在行对象上就地挂结果）。
const decorateDisplay = (row) => { if (row) row.displayCodeName = row.show_name == null ? db.voucherDisplay().showCodeName : Number(row.show_name) === 1; return row; };
// 券码 ID 固定为 cd- + 12 位随机字母数字；格式不对直接 404，不给探测机会。
const codeIdParam = (request) => {
  const id = String(request.params.id || '');
  return /^cd-[A-Za-z0-9]{12}$/.test(id) ? id : null;
};
const friendlyError = (error) => {
  const message = String(error?.message || '');
  if (/UNIQUE constraint failed: presets\.name/i.test(message)) return '预设名称已存在，请换一个名称。';
  if (/UNIQUE constraint failed: users\.username/i.test(message)) return '该用户名已被占用。';
  if (/^SQLITE_CONSTRAINT/i.test(message)) return '数据校验未通过，请检查输入内容。';
  return message;
};

function publicCsrf(request, reply) {
  let token = request.cookies.public_csrf;
  if (!token) {
    token = randomToken(24);
    reply.setCookie('public_csrf', token, { httpOnly: true, sameSite: 'strict', secure: config.cookieSecure, path: '/r/' });
  }
  return token;
}

function loginCsrf(request, reply) {
  let token = request.cookies.login_csrf;
  if (!token) {
    token = randomToken(24);
    reply.setCookie('login_csrf', token, { httpOnly: true, sameSite: 'strict', secure: config.cookieSecure, path: '/admin' });
  }
  return token;
}

function assertCsrf(request, token) {
  if (!safeEqual(request.body?._csrf || '', token || '')) throw Object.assign(new Error('请求校验失败，请刷新页面后重试。'), { statusCode: 403 });
}

async function auth(request, reply, roles = ['super_admin', 'business_admin']) {
  const token = request.cookies.admin_session;
  const session = token && db.getSession(token);
  if (!session || !session.active) {
    reply.clearCookie('admin_session', { path: '/admin' });
    reply.redirect('/admin/login');
    return null;
  }
  const admin = { id: session.user_id, username: session.username, role: session.role, csrf: request.cookies.admin_csrf || '' };
  if (!admin.csrf) {
    admin.csrf = randomToken(24);
    reply.setCookie('admin_csrf', admin.csrf, { httpOnly: true, sameSite: 'strict', secure: config.cookieSecure, path: '/admin' });
    db.raw.prepare('UPDATE sessions SET csrf_hash=? WHERE token_hash=?').run(sha256(admin.csrf), sha256(token));
  }
  request.admin = admin;
  if (!roles.includes(session.role)) {
    reply.code(403).type('text/html').send(view.forbidden(admin));
    return null;
  }
  return request.admin;
}

function requireCsrf(request) {
  const session = db.getSession(request.cookies.admin_session);
  if (!session || !safeEqual(sha256(request.body?._csrf || ''), session.csrf_hash)) throw Object.assign(new Error('请求校验失败，请刷新页面后重试。'), { statusCode: 403 });
}

async function needsAdmin(request, reply, role) {
  if (!adminHostAllowed(request)) return reply.code(404).send('Not found');
  const user = await auth(request, reply, role ? [role] : undefined);
  return user;
}

function validateCoupon(body) {
  const data = {
    name: readText(body, 'name', 80), offerText: readText(body, 'offerText', 120), description: readText(body, 'description', 500),
    instructions: readText(body, 'instructions', 1000), storeText: readText(body, 'storeText', 500),
    startsOn: readText(body, 'startsOn', 10), expiresOn: readText(body, 'expiresOn', 10), maxUses: Number(body?.maxUses)
  };
  if (!data.name || !data.offerText || !Number.isInteger(data.maxUses) || data.maxUses < 1 || data.maxUses > 10000) throw new Error('请完整填写名称、优惠内容和 1–10000 的使用次数。');
  if (!isDate(data.startsOn) || !isDate(data.expiresOn)) throw new Error('日期格式无效。');
  if (data.startsOn && data.expiresOn && data.startsOn > data.expiresOn) throw new Error('开始日期不能晚于截止日期。');
  return data;
}

// 请求日志：一行一个请求（方法、脱敏路径、状态、耗时、客户端 IP）；静态资源不记。
app.addHook('onResponse', async (request, reply) => {
  const path = safePath(request.raw?.url || request.url);
  // 静态资源与 Service Worker 不记：它们随每次页面加载出现，记了只会淹没真正的请求
  if (path.startsWith('/assets/') || path === '/favicon.ico' || path === '/sw.js') return;
  logInfo('request', kv({
    method: request.method,
    path,
    status: reply.statusCode,
    ms: Math.round(reply.elapsedTime),
    ip: clientIp(request)
  }));
});

app.setErrorHandler((error, request, reply) => {
  const status = error.statusCode || 500;
  const path = safePath(request.raw?.url || request.url);
  // 5xx 记堆栈前几行（排查用）；4xx 只记一行，避免预期内的拒绝刷屏
  if (status >= 500) logError('error', kv({ method: request.method, path, status, message: error.message, stack: String(error.stack || '').split('\n').slice(1, 3).join(' <- ').trim() }));
  else logWarn('error', kv({ method: request.method, path, status, message: error.message }));
  // 限流：给人话页面（原先会误显示成"查不到优惠券"/登录页）
  if (status === 429) {
    const raw = String(error.message || '');
    const message = /Rate limit exceeded/i.test(raw) ? '请求太频繁了，请过一会儿再试。' : (raw || '请求太频繁了，请过一会儿再试。');
    return reply.code(429).type('text/html').send(view.rateLimited(message, request.url.startsWith('/admin/')));
  }
  if (request.url.startsWith('/admin/')) return reply.code(status).type('text/html').send(view.login(loginCsrf(request, reply), status < 500 ? error.message : '操作未完成，请稍后再试。'));
  return reply.code(status).type('text/html').send(view.publicCoupon(null, '', null));
});

// 首页：静态产品介绍页（搜索引擎收录入口）；对外反代需放行 /（见 docs/nginx/public.conf.example）
app.get('/', async (request, reply) => reply.type('text/html').send(view.home()));

app.get('/healthz', async () => ({ ok: true }));

app.get('/r/:token', { config: { rateLimit: config.rateLimits.redeemPage } }, async (request, reply) => {
  const token = String(request.params.token || '');
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return reply.code(404).send(view.publicCoupon(null, ''));
  const coupon = decorateDisplay(db.getCouponByToken(token));
  return reply.type('text/html').send(view.publicCoupon(coupon, publicCsrf(request, reply), { token }));
});

app.post('/r/:token/redeem', { config: { rateLimit: config.rateLimits.redeem } }, async (request, reply) => {
  const token = String(request.params.token || '');
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return reply.code(404).send(view.publicCoupon(null, ''));
  try { assertCsrf(request, request.cookies.public_csrf); } catch { return reply.code(403).type('text/html').send(view.publicCoupon(decorateDisplay(db.getCouponByToken(token)), publicCsrf(request, reply), { kind: 'failed', reason: '页面停留太久，校验已失效。请刷新页面后再试一次。' })); }
  const result = db.redeem(token, clientIp(request), String(request.headers['user-agent'] || '').slice(0, 500));
  if (!result.ok) return reply.code(409).type('text/html').send(view.publicCoupon(decorateDisplay(result.coupon), publicCsrf(request, reply), { kind: 'failed', state: result.state, token }));
  setImmediate(() => {
    sendRedemptionMail(db, result.coupon, result.redemption)
      .then((status) => db.raw.prepare('UPDATE redemptions SET email_status=? WHERE id=?').run(status, result.redemption.id))
      .catch(() => db.raw.prepare("UPDATE redemptions SET email_status='failed' WHERE id=?").run(result.redemption.id));
  });
  return reply.type('text/html').send(view.publicCoupon(decorateDisplay(result.coupon), publicCsrf(request, reply), { kind: 'redeemed', token, redeemedAt: result.redemption.redeemedAt, code: result.redemption.confirmationCode }));
});

// ---- 核销凭证查询（公开）----
// 为什么重要：核销页人人可以仿造一个假前端，但这里的查询结果来自官方服务器，
// 凭 6 位确认码就能当场验真；再配合核销后自动发信，伪造“核销成功”基本没有意义。
const VERIFY_WINDOW_HOURS = () => db.retention().verifyHours; // 确认码可查询时长（小时），后台可调，默认 72，改完即生效
const verifyAt = (code) => db.lookupConfirmation(code, new Date(Date.now() - VERIFY_WINDOW_HOURS() * 3600 * 1000).toISOString());

app.get('/verify', { config: { rateLimit: config.rateLimits.verify } }, async (request, reply) => {
  const raw = String(request.query?.code || '').trim();
  const verifyHours = db.retention().verifyHours;
  if (!raw) return reply.type('text/html').send(view.verifyPage({ verifyHours }));
  const code = normalizeCode(raw);
  if (!code) return reply.type('text/html').send(view.verifyPage({ code: raw.slice(0, 20), result: { kind: 'invalid' }, verifyHours }));
  const row = verifyAt(code);
  return reply.type('text/html').send(view.verifyPage({ code, result: row ? { kind: 'ok', row } : { kind: 'unknown' }, verifyHours }));
});

// 机器可读入口，方便店员脚本/第三方核对；不带 CORS 头，浏览器里别的域名读不到。
app.get('/api/verify/:code', { config: { rateLimit: config.rateLimits.verify } }, async (request, reply) => {
  const code = normalizeCode(request.params.code);
  if (!code) return reply.code(400).type('application/json').send({ error: '确认码格式不对，应为 6 位字母数字（形如 K7M-2QD）。' });
  const row = verifyAt(code);
  if (!row) return reply.type('application/json').send({ found: false, confirmationCode: code });
  return reply.type('application/json').send({
    found: true,
    confirmationCode: row.confirmation_code,
    faceName: row.face_name,
    codeName: row.code_name,
    redeemedAt: row.redeemed_at,
    redeemedAtBeijing: view.beijingTime(row.redeemed_at)
  });
});

app.get('/admin/setup', async (request, reply) => {
  if (!adminHostAllowed(request)) return reply.code(404).send('Not found');
  if (db.hasSuperAdmin()) return reply.redirect('/admin/login');
  return reply.type('text/html').send(view.setup(loginCsrf(request, reply), null, config.passwordMinLength));
});
app.post('/admin/setup', { config: { rateLimit: config.rateLimits.setup } }, async (request, reply) => {
  if (!adminHostAllowed(request)) return reply.code(404).send('Not found');
  try {
    assertCsrf(request, request.cookies.login_csrf);
    if (db.hasSuperAdmin() || !bootstrapToken || !safeEqual(readText(request.body, 'bootstrapToken', 100), bootstrapToken)) throw new Error('初始化口令无效或已过期。');
    const username = readText(request.body, 'username', 50);
    const password = String(request.body?.password || '');
    if (!/^[\w.-]{3,50}$/.test(username) || password.length < config.passwordMinLength || password !== String(request.body?.confirmPassword || '')) throw new Error(`用户名应为 3–50 位字母、数字、点或连字符，密码至少 ${config.passwordMinLength} 位且两次输入一致。`);
    const user = db.createUser(username, hashPassword(password), 'super_admin');
    db.audit(user.lastInsertRowid, 'system.setup', 'system', null, clientIp(request));
    return redirectNotice(reply, '/admin/login', '超级管理员已创建，请登录。');
  } catch (error) { return reply.code(400).type('text/html').send(view.setup(loginCsrf(request, reply), friendlyError(error), config.passwordMinLength)); }
});

app.get('/admin/login', async (request, reply) => {
  if (!adminHostAllowed(request)) return reply.code(404).send('Not found');
  if (!db.hasSuperAdmin()) return reply.redirect('/admin/setup');
  return reply.type('text/html').send(view.login(loginCsrf(request, reply), null, config.turnstileSiteKey));
});
// 人机验证闸门：回源 Cloudflare 校验表单里的 token，通过后才放行到限流与密码校验（fail-closed）。
const turnstileGate = async (request, reply) => {
  if (!config.turnstileEnabled) return;
  // 与 handler 同一道 Host 白名单：陌生 Host 直接 404，不出网、不进限流。
  if (!adminHostAllowed(request)) return reply.code(404).send('Not found');
  // 预期域名 = 当前请求 Host（已过白名单）+ ADMIN_HOSTS 各项 + PUBLIC_BASE_URL 域名，即本站任一合法后台入口；
  // 公网域名、内网自建 DNS 域名等多入口部署都能对上，token 必须是在这些入口之一跑出来的。
  const expectedHostnames = [hostName(request), ...config.adminHosts];
  try { expectedHostnames.push(new URL(config.publicBaseUrl).hostname.toLowerCase().replace(/^\[|\]$/g, '')); } catch { /* PUBLIC_BASE_URL 异常时只信白名单内的 Host */ }
  const verdict = await verifyTurnstile({ secret: config.turnstileSecret, response: String(request.body?.['cf-turnstile-response'] || ''), remoteip: clientIp(request), expectedHostnames: expectedHostnames.filter(Boolean), timeoutMs: config.turnstileTimeoutMs });
  if (verdict.success) { logInfo('turnstile.ok', kv({ attempts: verdict.attempts, ms: verdict.ms, ip: clientIp(request) })); return; }
  const message = verdict.reason === 'missing'
    ? '人机验证未完成：请等待人机验证通过后再登录；若页面未显示人机验证组件，请刷新页面重试。'
    : verdict.reason === 'network'
      ? '人机验证服务暂时不可用，请稍后重试。'
      : verdict.reason === 'hostname'
        ? '人机验证来源域名不符：请通过本系统的官方地址访问登录页。'
        : '人机验证未通过或已过期，请刷新页面后重试。';
  // 未过的原因（reason / codes / detail / 回源次数与耗时）就靠这一行排查；失败同样入审计，reason 带 turnstile 前缀
  logWarn('turnstile.rejected', kv({ reason: verdict.reason, codes: (verdict.codes || []).join('|'), attempts: verdict.attempts, ms: verdict.ms, detail: verdict.detail, ip: clientIp(request) }));
  db.audit(null, 'auth.login_failed', 'user', null, clientIp(request), { username: readText(request.body, 'username', 50), reason: `turnstile:${verdict.reason}` });
  return reply.code(403).type('text/html').send(view.login(loginCsrf(request, reply), message, config.turnstileSiteKey));
};
// 启用人机验证时把登录限流挪到 preValidation：闸门先验、限流后计（路由自带钩子排在限流处理器之前），
// 没过人机验证的请求不消耗登录限流额度，垃圾 POST 无法借此把管理员顶进 429；关闭时维持原样（限流在 onRequest 最早拒绝）。
app.post('/admin/login', {
  // 关掉登录限流时（off）保持 false 原样传给插件；开启人机验证时把限流挪到 preValidation
  config: { rateLimit: config.rateLimits.login && config.turnstileEnabled ? { ...config.rateLimits.login, hook: 'preValidation' } : config.rateLimits.login },
  preValidation: turnstileGate
}, async (request, reply) => {
  if (!adminHostAllowed(request)) return reply.code(404).send('Not found');
  try {
    assertCsrf(request, request.cookies.login_csrf);
    const user = db.userByName(readText(request.body, 'username', 50));
    if (!user || !user.active || !verifyPassword(String(request.body?.password || ''), user.password_hash)) throw new Error('用户名或密码错误。');
    const token = randomToken(32); const csrf = randomToken(24); const sessionMs = config.sessionHours * 3600 * 1000; const expires = new Date(Date.now() + sessionMs).toISOString();
    db.createSession(token, user.id, csrf, expires); db.updateLastLogin(user.id); db.audit(user.id, 'auth.login', 'user', user.id, clientIp(request));
    reply.setCookie('admin_session', token, { httpOnly: true, sameSite: 'strict', secure: config.cookieSecure, path: '/admin', maxAge: config.sessionHours * 3600 });
    reply.setCookie('admin_csrf', csrf, { httpOnly: true, sameSite: 'strict', secure: config.cookieSecure, path: '/admin', maxAge: config.sessionHours * 3600 });
    return reply.redirect('/admin');
  } catch (error) {
    // 失败登录也记账：这是检测后台密码爆破/撞库的第一现场（含 CSRF 异常探测）
    db.audit(null, 'auth.login_failed', 'user', null, clientIp(request), { username: readText(request.body, 'username', 50), reason: String(error.message || '').slice(0, 120) });
    return reply.code(400).type('text/html').send(view.login(loginCsrf(request, reply), error.message, config.turnstileSiteKey));
  }
});
app.post('/admin/logout', async (request, reply) => {
  if (!adminHostAllowed(request)) return reply.code(404).send('Not found');
  const user = await auth(request, reply); if (!user) return;
  requireCsrf(request); db.deleteSession(request.cookies.admin_session);
  reply.clearCookie('admin_session', { path: '/admin' }); reply.clearCookie('admin_csrf', { path: '/admin' }); return reply.redirect('/admin/login');
});
app.get('/admin/profile', async (request, reply) => { const user = await needsAdmin(request, reply); if (!user) return; return reply.type('text/html').send(view.profilePage({ user, csrf: user.csrf, flash: flashFrom(request, reply), passwordMin: config.passwordMinLength })); });
app.post('/admin/profile/username', { config: { rateLimit: config.rateLimits.profile } }, async (request, reply) => { const user = await needsAdmin(request, reply); if (!user) return; try { requireCsrf(request); const account = db.userById(user.id); const username = readText(request.body, 'username', 50); if (!/^[\w.-]{3,50}$/.test(username) || !verifyPassword(String(request.body?.password || ''), account.password_hash)) throw new Error('用户名格式无效或当前密码错误。'); db.setUsername(user.id, username); db.deleteSession(request.cookies.admin_session); db.audit(user.id, 'user.rename_self', 'user', user.id, clientIp(request)); reply.clearCookie('admin_session', { path: '/admin' }); return redirectNotice(reply, '/admin/login', '用户名已修改，请重新登录。'); } catch (error) { return redirectNotice(reply, '/admin/profile', error.message, 'error'); } });
app.post('/admin/profile/password', { config: { rateLimit: config.rateLimits.profile } }, async (request, reply) => { const user = await needsAdmin(request, reply); if (!user) return; try { requireCsrf(request); const account = db.userById(user.id); const current = String(request.body?.currentPassword || ''); const next = String(request.body?.newPassword || ''); if (!verifyPassword(current, account.password_hash) || next.length < config.passwordMinLength || next !== String(request.body?.confirmPassword || '')) throw new Error(`当前密码错误，或新密码少于 ${config.passwordMinLength} 位、两次输入不一致。`); db.setUserPassword(user.id, hashPassword(next)); db.deleteSession(request.cookies.admin_session); db.audit(user.id, 'user.password_self', 'user', user.id, clientIp(request)); reply.clearCookie('admin_session', { path: '/admin' }); return redirectNotice(reply, '/admin/login', '密码已修改，请重新登录。'); } catch (error) { return redirectNotice(reply, '/admin/profile', error.message, 'error'); } });

app.get('/admin', async (request, reply) => {
  const user = await needsAdmin(request, reply); if (!user) return;
  const coupons = db.couponsWithStats().slice(0, 12);
  const stats = db.stats();
  return reply.type('text/html').send(view.dashboard({ user, coupons, stats, redemptions: db.recentRedemptions(12), csrf: user.csrf, flash: flashFrom(request, reply) }));
});

app.get('/admin/redemptions', async (request, reply) => {
  const user = await needsAdmin(request, reply); if (!user) return;
  const query = request.query || {};
  const coupon = /^\d+$/.test(String(query.coupon || '')) ? Number(query.coupon) : null;
  const from = dayBoundaryIso(query.from);
  const to = dayBoundaryIso(query.to, true);
  const pageSize = 20;
  const requested = Number.parseInt(String(query.page || '1'), 10);
  let page = Number.isInteger(requested) && requested > 0 ? requested : 1;
  const criteria = { couponId: coupon, from, to };
  let result = db.redemptionsPaged({ ...criteria, limit: pageSize, offset: (page - 1) * pageSize });
  const pages = Math.max(1, Math.ceil(result.total / pageSize));
  if (page > pages) { page = pages; result = db.redemptionsPaged({ ...criteria, limit: pageSize, offset: (page - 1) * pageSize }); }
  const coupons = [...db.couponsWithStats(), ...db.recycleLists().faces];
  return reply.type('text/html').send(view.redemptionsPage({
    user, csrf: user.csrf, flash: flashFrom(request, reply), rows: result.rows, total: result.total, page, pages, coupons,
    filters: { coupon: coupon ?? '', from: String(query.from || '').slice(0, 10), to: String(query.to || '').slice(0, 10) }
  }));
});

app.get('/admin/coupons', async (request, reply) => { const user = await needsAdmin(request, reply); if (!user) return; return reply.type('text/html').send(view.couponsPage({ user, coupons: db.couponsWithStats(), csrf: user.csrf, flash: flashFrom(request, reply) })); });
app.get('/admin/recycle', async (request, reply) => { const user = await needsAdmin(request, reply); if (!user) return; return reply.type('text/html').send(view.recyclePage({ user, ...db.recycleLists(), csrf: user.csrf, flash: flashFrom(request, reply), purgeDays: db.retention().purgeDays })); });
app.get('/admin/coupons/new', async (request, reply) => { const user = await needsAdmin(request, reply); if (!user) return; return reply.type('text/html').send(view.couponForm({ user, csrf: user.csrf, presets: db.activePresets(), flash: flashFrom(request, reply) })); });
app.post('/admin/coupons', { config: { rateLimit: config.rateLimits.adminWrite } }, async (request, reply) => { const user = await needsAdmin(request, reply); if (!user) return; try { requireCsrf(request); const created = db.createCoupon(validateCoupon(request.body), user.id, clientIp(request)); return redirectNotice(reply, `/admin/coupons/${created.id}`, '优惠券已创建。'); } catch (error) { return redirectNotice(reply, '/admin/coupons/new', error.message, 'error'); } });
app.get('/admin/coupons/:id/edit', async (request, reply) => { const user = await needsAdmin(request, reply); if (!user) return; const coupon = db.getCoupon(Number(request.params.id)); if (!coupon || coupon.status === 'recycled') return reply.code(404).send('Not found'); return reply.type('text/html').send(view.couponForm({ user, csrf: user.csrf, coupon, presets: db.activePresets(), flash: flashFrom(request, reply) })); });
app.post('/admin/coupons/:id', async (request, reply) => { const user = await needsAdmin(request, reply); if (!user) return; const id = Number(request.params.id); try { requireCsrf(request); if (!db.updateCoupon(id, validateCoupon(request.body), user.id, clientIp(request))) throw new Error('优惠券不存在。'); return redirectNotice(reply, `/admin/coupons/${id}`, '优惠券已更新。'); } catch (error) { return redirectNotice(reply, `/admin/coupons/${id}/edit`, error.message, 'error'); } });
app.get('/admin/coupons/:id', async (request, reply) => { const user = await needsAdmin(request, reply); if (!user) return; const coupon = db.getCoupon(Number(request.params.id)); if (!coupon) return reply.code(404).send('Not found'); coupon.current_state = db.couponState(coupon); return reply.type('text/html').send(view.couponDetail({ user, coupon, codes: db.codesOf(coupon.id), redemptions: db.redemptions(coupon.id), csrf: user.csrf, flash: flashFrom(request, reply) })); });
app.post('/admin/coupons/:id/status', async (request, reply) => { const user = await needsAdmin(request, reply); if (!user) return; const id = Number(request.params.id); try { requireCsrf(request); const status = readText(request.body, 'status', 20); if (!db.setCouponStatus(id, status, user.id, clientIp(request))) throw new Error('优惠券不存在。'); return redirectNotice(reply, returnPath(request, status === 'recycled' ? '/admin/recycle' : `/admin/coupons/${id}`), status === 'recycled' ? '优惠券已移入回收站，其下券码同时失效。' : '状态已更新，其下券码同步生效。'); } catch (error) { return redirectNotice(reply, `/admin/coupons/${id}`, error.message, 'error'); } });
app.post('/admin/coupons/:id/codes', { config: { rateLimit: config.rateLimits.adminWrite } }, async (request, reply) => { const user = await needsAdmin(request, reply); if (!user) return; const id = Number(request.params.id); const name = readText(request.body, 'name', 80); const note = readText(request.body, 'note', 100); try { requireCsrf(request); const count = readText(request.body, 'count', 4); const total = count === '' ? 1 : Number(count); if (total > 1) { const created = db.createCodes(id, total, name, note, user.id, clientIp(request)); const first = created[0].name; const last = created[created.length - 1].name; return redirectNotice(reply, `/admin/coupons/${id}`, `已生成 ${created.length} 张券码（${first}…${last}），券码名默认隐藏。`); } const created = db.createCode(id, name, note, user.id, clientIp(request), parseShow(request.body?.show_name)); return redirectNotice(reply, `/admin/coupons/${id}`, `已创建券码「${created.name}」。`); } catch (error) { return redirectNotice(reply, `/admin/coupons/${id}`, friendlyError(error), 'error'); } });
app.post('/admin/coupons/:id/purge', async (request, reply) => { const user = await needsAdmin(request, reply, 'super_admin'); if (!user) return; const id = Number(request.params.id); try { requireCsrf(request); const coupon = db.getCoupon(id); if (!coupon || coupon.status !== 'recycled') throw new Error('仅回收站中的优惠券可永久删除。'); db.raw.prepare('DELETE FROM coupons WHERE id=?').run(id); db.audit(user.id, 'coupon.purge', 'coupon', id, clientIp(request)); return redirectNotice(reply, '/admin/recycle', '优惠券及其全部券码、核销记录已永久删除。'); } catch (error) { return redirectNotice(reply, `/admin/coupons/${id}`, error.message, 'error'); } });

// ---- 券码：真正发给客人的那一个码（ID 形如 cd-3Kd9xWm2QaP7） ----
app.get('/admin/codes/:id', async (request, reply) => { const user = await needsAdmin(request, reply); if (!user) return; const id = codeIdParam(request); const code = id && db.codeDetail(id); if (!code) return reply.code(404).send('Not found'); return reply.type('text/html').send(view.codeDetail({ user, code, redemptions: db.redemptionsForCode(code.id), csrf: user.csrf, flash: flashFrom(request, reply) })); });
// 复制链接：Token 只在这个需要登录的接口里出现，不写进任何后台 HTML。
app.get('/admin/codes/:id/link', async (request, reply) => { const user = await needsAdmin(request, reply); if (!user) return; const id = codeIdParam(request); const code = id && db.codeDetail(id); if (!code) return reply.code(404).send({ error: '券码不存在' }); return reply.type('application/json').send({ url: `${config.publicBaseUrl}/r/${db.getCodeToken(code.id)}` }); });
app.post('/admin/codes/:id/name', async (request, reply) => { const user = await needsAdmin(request, reply); if (!user) return; const id = codeIdParam(request); if (!id) return reply.code(404).send('Not found'); try { requireCsrf(request); if (!db.setCodeName(id, readText(request.body, 'name', 80), user.id, clientIp(request), parseShow(request.body?.show_name))) throw new Error('券码不存在。'); return redirectNotice(reply, `/admin/codes/${id}`, '券码名称与显示设置已保存。'); } catch (error) { return redirectNotice(reply, `/admin/codes/${id}`, error.message, 'error'); } });
app.post('/admin/codes/:id/note', async (request, reply) => { const user = await needsAdmin(request, reply); if (!user) return; const id = codeIdParam(request); if (!id) return reply.code(404).send('Not found'); try { requireCsrf(request); if (!db.setCodeNote(id, readText(request.body, 'note', 100), user.id, clientIp(request))) throw new Error('券码不存在。'); return redirectNotice(reply, `/admin/codes/${id}`, '备注已保存（仅后台可见）。'); } catch (error) { return redirectNotice(reply, `/admin/codes/${id}`, error.message, 'error'); } });
app.post('/admin/codes/:id/status', async (request, reply) => { const user = await needsAdmin(request, reply); if (!user) return; const id = codeIdParam(request); if (!id) return reply.code(404).send('Not found'); try { requireCsrf(request); const status = readText(request.body, 'status', 20); if (!db.setCodeStatus(id, status, user.id, clientIp(request))) throw new Error('券码不存在。'); return redirectNotice(reply, returnPath(request, status === 'recycled' ? '/admin/recycle' : `/admin/codes/${id}`), status === 'recycled' ? '券码已移入回收站，不能再被核销。' : '状态已更新。'); } catch (error) { return redirectNotice(reply, `/admin/codes/${id}`, error.message, 'error'); } });
app.post('/admin/codes/:id/purge', async (request, reply) => { const user = await needsAdmin(request, reply, 'super_admin'); if (!user) return; const id = codeIdParam(request); if (!id) return reply.code(404).send('Not found'); try { requireCsrf(request); const code = db.codeDetail(id); if (!code || code.status !== 'recycled') throw new Error('仅回收站中的券码可永久删除。'); db.raw.prepare('DELETE FROM voucher_codes WHERE id=?').run(id); db.audit(user.id, 'code.purge', 'code', id, clientIp(request)); return redirectNotice(reply, '/admin/recycle', '券码及其核销记录已永久删除。'); } catch (error) { return redirectNotice(reply, `/admin/codes/${id}`, error.message, 'error'); } });

// 券码的券面 PNG / 二维码 / 核销页入口（Token 不写进后台 HTML）
const pngFileName = (code) => {
  const clean = (value) => String(value || '').replace(/[\\/:*?"<>|]/g, '·').replace(/\s+/g, ' ').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 40);
  const parts = ['优惠券', clean(code.face_name), code.displayCodeName === false ? '' : clean(code.name)].filter(Boolean);
  return `${parts.join('-') || '券面'}.png`;
};

app.get('/admin/codes/:id/image', { config: { rateLimit: config.rateLimits.adminWrite } }, async (request, reply) => { const user = await needsAdmin(request, reply); if (!user) return; const id = codeIdParam(request); const code = id && db.codeDetail(id); if (!code) return reply.code(404).send('Not found'); decorateDisplay(code); const token = db.getCodeToken(code.id); const image = await renderCouponPng(code, `${config.publicBaseUrl}/r/${token}`, { font: db.getSetting('pngFont', '') || 'source', dark: db.getSetting('pngDark', 'false') === 'true' }); const fileName = pngFileName(code);
  // inline=1：预览按钮新标签页内联打开（不触发下载），否则按附件下载；中文名走 RFC 5987 filename*
  const disposition = request.query?.inline === '1' ? 'inline' : 'attachment';
  return reply.header('Content-Type', 'image/png').header('Cache-Control', 'no-store').header('Content-Disposition', `${disposition}; filename="coupon.png"; filename*=UTF-8''${encodeURIComponent(fileName)}`).send(image); });
app.get('/admin/codes/:id/qrcode', async (request, reply) => { const user = await needsAdmin(request, reply); if (!user) return; const id = codeIdParam(request); const code = id && db.codeDetail(id); if (!code) return reply.code(404).send('Not found'); const image = await QRCode.toBuffer(`${config.publicBaseUrl}/r/${db.getCodeToken(code.id)}`, { errorCorrectionLevel: 'M', margin: 1, width: 480, color: { dark: '#101828', light: '#FFFFFFFF' } }); return reply.header('Content-Type', 'image/png').header('Cache-Control', 'no-store').send(image); });
app.get('/admin/codes/:id/open', async (request, reply) => { const user = await needsAdmin(request, reply); if (!user) return; const id = codeIdParam(request); const code = id && db.codeDetail(id); if (!code) return reply.code(404).send('Not found'); return reply.redirect(`${config.publicBaseUrl}/r/${db.getCodeToken(code.id)}`); });

app.get('/admin/presets', async (request, reply) => { const user = await needsAdmin(request, reply); if (!user) return; return reply.type('text/html').send(view.presetsPage({ user, presets: db.allPresets(), csrf: user.csrf, flash: flashFrom(request, reply) })); });
app.post('/admin/presets', { config: { rateLimit: config.rateLimits.adminWrite } }, async (request, reply) => { const user = await needsAdmin(request, reply); if (!user) return; try { requireCsrf(request); const name = readText(request.body, 'name', 80); if (!name) throw new Error('请填写预设名称。'); const created = db.createPreset({ name, instructions: readText(request.body, 'instructions', 1000), storeText: readText(request.body, 'storeText', 500) }); db.audit(user.id, 'preset.create', 'preset', created.lastInsertRowid, clientIp(request)); return redirectNotice(reply, '/admin/presets', '预设已保存。'); } catch (error) { return redirectNotice(reply, '/admin/presets', friendlyError(error), 'error'); } });

app.post('/admin/presets/:id', { config: { rateLimit: config.rateLimits.adminWrite } }, async (request, reply) => { const user = await needsAdmin(request, reply); if (!user) return; const id = Number(request.params.id); try { requireCsrf(request); const name = readText(request.body, 'name', 80); if (!name) throw new Error('请填写预设名称。'); const existing = db.raw.prepare('SELECT id FROM presets WHERE id=?').get(id); if (!existing) throw new Error('预设不存在。'); db.raw.prepare('UPDATE presets SET name=?,instructions=?,store_text=?,active=?,updated_at=? WHERE id=?').run(name, readText(request.body, 'instructions', 1000), readText(request.body, 'storeText', 500), request.body?.active ? 1 : 0, new Date().toISOString(), id); db.audit(user.id, 'preset.update', 'preset', id, clientIp(request)); return redirectNotice(reply, '/admin/presets', '预设已更新。'); } catch (error) { return redirectNotice(reply, '/admin/presets', friendlyError(error), 'error'); } });

app.post('/admin/presets/:id/delete', { config: { rateLimit: config.rateLimits.adminWrite } }, async (request, reply) => { const user = await needsAdmin(request, reply); if (!user) return; const id = Number(request.params.id); try { requireCsrf(request); db.raw.prepare('DELETE FROM presets WHERE id=?').run(id); db.audit(user.id, 'preset.delete', 'preset', id, clientIp(request)); return redirectNotice(reply, '/admin/presets', '预设已删除。'); } catch (error) { return redirectNotice(reply, '/admin/presets', error.message, 'error'); } });

app.get('/admin/users', async (request, reply) => { const user = await needsAdmin(request, reply, 'super_admin'); if (!user) return; return reply.type('text/html').send(view.usersPage({ user, users: db.users(), csrf: user.csrf, flash: flashFrom(request, reply), passwordMin: config.passwordMinLength })); });
app.post('/admin/users', { config: { rateLimit: config.rateLimits.adminManage } }, async (request, reply) => { const user = await needsAdmin(request, reply, 'super_admin'); if (!user) return; try { requireCsrf(request); const username = readText(request.body, 'username', 50); const password = String(request.body?.password || ''); if (!/^[\w.-]{3,50}$/.test(username) || password.length < config.passwordMinLength) throw new Error(`用户名格式无效或密码少于 ${config.passwordMinLength} 位。`); const created = db.createUser(username, hashPassword(password), 'business_admin'); db.audit(user.id, 'user.create', 'user', created.lastInsertRowid, clientIp(request)); return redirectNotice(reply, '/admin/users', '业务管理员已创建。'); } catch (error) { return redirectNotice(reply, '/admin/users', friendlyError(error), 'error'); } });

app.post('/admin/users/:id/active', async (request, reply) => { const user = await needsAdmin(request, reply, 'super_admin'); if (!user) return; const id = Number(request.params.id); try { requireCsrf(request); const target = db.userById(id); if (!target) throw new Error('账号不存在。'); if (target.id === user.id) throw new Error('不能停用或启用当前登录的超级管理员账号。'); if (target.role === 'super_admin') throw new Error('唯一超级管理员账号不可停用。'); const active = readText(request.body, 'active', 2) !== '0'; db.setUserActive(target.id, active); if (!active) db.deleteUserSessions(target.id); db.audit(user.id, active ? 'user.enable' : 'user.disable', 'user', target.id, clientIp(request)); return redirectNotice(reply, '/admin/users', active ? `已启用 ${target.username}。` : `已停用 ${target.username}，其全部会话已失效。`); } catch (error) { return redirectNotice(reply, '/admin/users', error.message, 'error'); } });

app.post('/admin/users/:id/password', { config: { rateLimit: config.rateLimits.adminManage } }, async (request, reply) => { const user = await needsAdmin(request, reply, 'super_admin'); if (!user) return; const id = Number(request.params.id); try { requireCsrf(request); const target = db.userById(id); if (!target) throw new Error('账号不存在。'); if (target.id === user.id) throw new Error('请在“个人账号”页修改自己的密码。'); if (target.role === 'super_admin') throw new Error('超级管理员密码请在“个人账号”页修改。'); const next = String(request.body?.newPassword || ''); if (next.length < config.passwordMinLength) throw new Error(`新密码至少 ${config.passwordMinLength} 位。`); db.setUserPassword(target.id, hashPassword(next)); db.deleteUserSessions(target.id); db.audit(user.id, 'user.password_reset', 'user', target.id, clientIp(request)); return redirectNotice(reply, '/admin/users', `已重置 ${target.username} 的密码，其全部会话已失效。`); } catch (error) { return redirectNotice(reply, '/admin/users', error.message, 'error'); } });

app.get('/admin/settings', async (request, reply) => { const user = await needsAdmin(request, reply, 'super_admin'); if (!user) return; const settings = Object.fromEntries(['mailEnabled','smtpHost','smtpPort','smtpSecure','smtpUser','mailFrom','mailRecipients','backupKeep','recycleDays','purgeDays','verifyHours','expiringDays','showCodeName','pngFont','pngDark'].map((key) => [key, db.getSetting(key, '')])); return reply.type('text/html').send(view.settingsPage({ user, csrf: user.csrf, settings, flash: flashFrom(request, reply) })); });
app.post('/admin/settings', { config: { rateLimit: config.rateLimits.adminManage } }, async (request, reply) => { const user = await needsAdmin(request, reply, 'super_admin'); if (!user) return; try { requireCsrf(request); const plain = ['smtpHost','smtpPort','smtpSecure','smtpUser','mailFrom','mailRecipients']; for (const key of plain) db.setSetting(key, readText(request.body, key, key === 'mailRecipients' ? 2000 : 300)); db.setSetting('mailEnabled', request.body?.mailEnabled ? 'true' : 'false'); const password = String(request.body?.smtpPassword || ''); if (password) db.setSetting('smtpPassword', password, true); db.audit(user.id, 'settings.smtp_update', 'settings', 'smtp', clientIp(request)); return redirectNotice(reply, '/admin/settings', '邮件设置已保存。'); } catch (error) { return redirectNotice(reply, '/admin/settings', error.message, 'error'); } });
app.post('/admin/settings/test-email', { config: { rateLimit: config.rateLimits.adminSensitive } }, async (request, reply) => { const user = await needsAdmin(request, reply, 'super_admin'); if (!user) return; try { requireCsrf(request); const recipients = String(db.getSetting('mailRecipients', '') || '').split(/[\s,;，；]+/).filter(Boolean); if (!recipients.length) throw new Error('请先填写「通知收件人」并保存邮件设置。'); await sendTestMail(db, recipients); db.audit(user.id, 'settings.smtp_test', 'settings', 'smtp', clientIp(request)); return redirectNotice(reply, '/admin/settings', `测试邮件已发送（${recipients.length} 个收件人）。`); } catch (error) { return redirectNotice(reply, '/admin/settings', error.message, 'error'); } });
app.post('/admin/settings/backup', { config: { rateLimit: config.rateLimits.adminManage } }, async (request, reply) => { const user = await needsAdmin(request, reply, 'super_admin'); if (!user) return; try { requireCsrf(request); const keep = Number(request.body?.backupKeep); if (!Number.isInteger(keep) || keep < 1 || keep > 365) throw new Error('备份份数应在 1–365 之间。'); db.setSetting('backupKeep', String(keep)); db.audit(user.id, 'settings.backup_update', 'settings', 'backup', clientIp(request)); return redirectNotice(reply, '/admin/settings', '备份策略已保存。'); } catch (error) { return redirectNotice(reply, '/admin/settings', error.message, 'error'); } });
app.post('/admin/settings/retention', { config: { rateLimit: config.rateLimits.adminManage } }, async (request, reply) => { const user = await needsAdmin(request, reply, 'super_admin'); if (!user) return; try { requireCsrf(request); const fields = [['recycleDays', '回收站静置天数', 1, 365], ['purgeDays', '回收站保留天数', 1, 365], ['verifyHours', '确认码可查小时数', 1, 720], ['expiringDays', '临期提醒天数', 1, 365]]; for (const [key, label, min, max] of fields) { const n = Number(request.body?.[key]); if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${label}应为 ${min}–${max} 之间的整数。`); db.setSetting(key, String(n)); } db.audit(user.id, 'settings.retention_update', 'settings', 'retention', clientIp(request)); return redirectNotice(reply, '/admin/settings', '数据保留策略已保存，立即生效。'); } catch (error) { return redirectNotice(reply, '/admin/settings', error.message, 'error'); } });

// 券码名全局展示开关（单张券码可在详情页覆写）：影响导出的券面 PNG 与客人扫码核销页标题。
app.post('/admin/settings/display', { config: { rateLimit: config.rateLimits.adminManage } }, async (request, reply) => { const user = await needsAdmin(request, reply, 'super_admin'); if (!user) return; try { requireCsrf(request); db.setSetting('showCodeName', request.body?.showCodeName ? 'true' : 'false'); const font = String(request.body?.pngFont || ''); db.setSetting('pngFont', ['source', 'misans', 'harmonyos'].includes(font) ? font : 'source'); db.setSetting('pngDark', request.body?.pngDark ? 'true' : 'false'); db.audit(user.id, 'settings.display_update', 'settings', 'display', clientIp(request)); return redirectNotice(reply, '/admin/settings', '展示设置已保存，立即生效。'); } catch (error) { return redirectNotice(reply, '/admin/settings', error.message, 'error'); } });

app.get('/admin/audit', async (request, reply) => {
  const user = await needsAdmin(request, reply, 'super_admin'); if (!user) return;
  const query = request.query || {};
  const action = /^[a-z_]+$/.test(String(query.action || '')) ? String(query.action) : null;
  const actor = /^\d+$/.test(String(query.actor || '')) ? Number(query.actor) : null;
  const from = dayBoundaryIso(query.from);
  const to = dayBoundaryIso(query.to, true);
  const pageSize = 20;
  const requested = Number.parseInt(String(query.page || '1'), 10);
  let page = Number.isInteger(requested) && requested > 0 ? requested : 1;
  const criteria = { action, actorId: actor, from, to };
  let result = db.auditPaged({ ...criteria, limit: pageSize, offset: (page - 1) * pageSize });
  const pages = Math.max(1, Math.ceil(result.total / pageSize));
  if (page > pages) { page = pages; result = db.auditPaged({ ...criteria, limit: pageSize, offset: (page - 1) * pageSize }); }
  return reply.type('text/html').send(view.auditPage({
    user, csrf: user.csrf, flash: flashFrom(request, reply), logs: result.rows, total: result.total, page, pages,
    prefixes: db.auditPrefixes(), users: db.users(),
    filters: { action: action ?? '', actor: actor ?? '', from: String(query.from || '').slice(0, 10), to: String(query.to || '').slice(0, 10) }
  }));
});
app.post('/admin/maintenance/run', { config: { rateLimit: config.rateLimits.adminSensitive } }, async (request, reply) => { const user = await needsAdmin(request, reply, 'super_admin'); if (!user) return; try { requireCsrf(request); const recycled = db.recycleEligible(); const purged = db.purgeRecycled(); db.audit(user.id, 'maintenance.run', 'system', null, clientIp(request), { recycled, purged }); return redirectNotice(reply, '/admin/settings', `清理完成：移入回收站 ${recycled} 项（券面/券码），永久清除 ${purged} 项。`); } catch (error) { return redirectNotice(reply, '/admin/settings', error.message, 'error'); } });

async function runMaintenance() {
  try {
    const recycled = db.recycleEligible();
    const purged = db.purgeRecycled();
    const backup = await backupIfDue();
    logInfo('maintenance', kv({ recycled, purged, backup }));
  } catch (error) {
    logError('maintenance.failed', kv({ message: error.message }));
  }
}
async function backupIfDue() {
  const stamp = new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format();
  if (db.getSetting('lastBackupDate', '') === stamp) return 'skip';
  mkdirSync(config.backupDir, { recursive: true });
  const target = join(config.backupDir, `qnqupon-${stamp}.db`);
  await db.raw.backup(target); db.setSetting('lastBackupDate', stamp);
  const files = readdirSync(config.backupDir).filter((f) => f.endsWith('.db')).sort().reverse();
  for (const file of files.slice(Number(db.getSetting('backupKeep', '30')) || 30)) unlinkSync(join(config.backupDir, file));
  return `qnqupon-${stamp}.db`;
}
setInterval(runMaintenance, 60 * 60 * 1000).unref();
setTimeout(runMaintenance, 5000).unref();

await app.listen({ host: config.host, port: config.port });
logInfo('listen', kv({
  url: `http://${config.host}:${config.port}`,
  version: createRequire(import.meta.url)('../package.json').version,
  data: config.databasePath,
  tz: config.timezone,
  level: config.logLevel
}));
// 启用人机验证时：提前解析并把结果缓存起来，之后每 5 分钟保温一次（登录回源不必再等出网解析）
if (config.turnstileEnabled) startTurnstileDnsWarmup();
