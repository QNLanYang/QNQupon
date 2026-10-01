// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 QNLanYang (全能岚漾)

import brandLogo from './brand-logo.js';

const esc = (value = '') => String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const attr = esc;
export const stateName = { valid: '可核销', not_started: '未启用', expired: '已过期', exhausted: '已用尽', disabled: '已禁用', recycled: '已移入回收站', not_found: '无效券码' };
const emailState = { pending: '待发送', sent: '已发送', failed: '发送失败', skipped: '未启用邮件' };
// 邮件状态：桌面显示文字，手机档在核销记录卡片里只显示图标
// （绿=送达、红=失败、黄=待发送、灰+斜线=未启用）；文字保留给读屏与悬浮提示。
const mailIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.7 6.7 12 12.9l8.3-6.2"/></svg>';
const mailBadge = (status) => {
  const key = Object.prototype.hasOwnProperty.call(emailState, status) ? status : 'skipped';
  const text = emailState[key];
  const icon = key === 'skipped' ? mailIcon.replace('</svg>', '<path d="M4 4l16 16"/></svg>') : mailIcon;
  return `<span class="mail ${key}" title="${attr(text)}" aria-label="${attr(text)}">${icon}<span class="mail-text">${esc(text)}</span></span>`;
};
// 记录类时间戳的年份规则：距今 9 个月以内省略年份（「09-26」），更早的写全（「2025-12-31」）。
// 只适用于「记录发生过的、独立的、过去的时间戳」——核销记录、审计、创建时间这类。
// 券面/券码的有效期属于有效期类，必须带年份；范围日期同理，两者都不走这个规则。
// now 可注入，便于测试。
const DATE_WINDOW_MONTHS = 9;
function withinRecentMonths(value, now = Date.now()) {
  const at = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(at)) return false;
  if (at > now) return false; // 未来时间不适用（那属于有效期那类，必须写年份）
  const floor = new Date(now); floor.setMonth(floor.getMonth() - DATE_WINDOW_MONTHS);
  return at >= floor.getTime();
}
const dateText = (value) => value || '未限制';
// 数据库里存的是 UTC 时间戳，所有展示统一转成北京时间（Asia/Shanghai）。
export const beijingTime = (value, length = 19) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, length);
  const text = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).format(date).slice(0, length);
  return withinRecentMonths(date) ? text.slice(5) : text;
};

// 登录/初始化页顶部品牌：Qupon 字标用 brand-logo.js 的 SVG 轮廓（零字体依赖），
// u 是独立 path，悬停翻转 180°（transform-box:fill-box 按字形外框居中，任意设备一致）。
const quponPaths = brandLogo.qupon.parts
  .map((part) => `<path${part.ch === 'u' ? ' class="flip"' : ''} d="${part.d}"/>`)
  .join('');
const authBrand = `<div class="auth-brand"><span class="wm" role="img" aria-label="Qupon"><svg viewBox="${(brandLogo.qupon.ink[0] - 2).toFixed(3)} ${(brandLogo.qupon.ink[1] - 2).toFixed(3)} ${(brandLogo.qupon.ink[2] - brandLogo.qupon.ink[0] + 4).toFixed(3)} ${(brandLogo.qupon.ink[3] - brandLogo.qupon.ink[1] + 4).toFixed(3)}" xmlns="http://www.w3.org/2000/svg">${quponPaths}</svg></span><span class="cn">券能行</span></div>`;

// 源码仓库地址：首页与全站页脚共用，兼作 AGPL 第 13 条「网络服务须提供对应源码」的入口。
const REPO_URL = 'https://github.com/QNLanYang/QNQupon';
// 页脚：版权 + 源码入口（兼作 AGPL 第 13 条要求）。主题开关在后台顶栏与主页首屏，页面这里不再放。
const siteFooter = `<footer class="site-footer">© 2026 QNLanYang · QNQupon · AGPL-3.0-only · <a href="${REPO_URL}" target="_blank" rel="noopener noreferrer">源码仓库</a></footer>`;

// 主题切换：一个线条图标在「浅色 / 深色」间切换（点击与文案由 theme.js 管）。
// 只有太阳与月亮两个图标：未主动选择过时等于跟随系统，按系统当前主题显形，不出现第三种图标。
const themeIcons = {
  light: '<svg class="ico ico-light" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/></svg>',
  dark: '<svg class="ico ico-dark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.6 6.6 0 0 0 9.8 9.8z"/></svg>'
};
const themeToggle = `<button type="button" class="icon-button theme-toggle" data-theme-cycle aria-label="切换主题" title="切换主题">${themeIcons.light}${themeIcons.dark}</button>`;
// 退出：门 + 右向箭头图标；桌面只显示图标，手机在折叠菜单里带「退出」文字
const logoutButton = `<button class="icon-button logout" aria-label="退出登录" title="退出登录"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H5v18h9"/><path d="M12 12h9"/><path d="M17.5 8.5 21 12l-3.5 3.5"/></svg><span class="side-text">退出</span></button>`;
// 手机档的折叠菜单入口（桌面隐藏）
const menuIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';

// 面板外跳/入口链接尾部的「外链」小图标（方形 + 右上箭头）
const openIcon = '<svg class="ico-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>';
// 券面列表页右上角标题行里的回收站入口
const recycleLink = `<a class="title-link" href="/admin/recycle">回收站${openIcon}</a>`;

function shell(title, content, { admin = false, user = null, flash = null, description = '', exactTitle = false, wide = false, turnstile = false } = {}) {
  const fullTitle = exactTitle ? title : `${title} · QNQupon · 券能行`;
  const metaDescription = description ? `<meta name="description" content="${attr(description)}">` : '';
  // Turnstile 组件脚本只随登录页（且配置了密钥）加载；对应 CSP 放行仅在登录页由 server.js 下发。
  const turnstileScript = turnstile ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>' : '';
  // PWA：manifest 只挂在后台页面——装出来的 App 只管后台，公开页（/、/verify、/r/:token）继续归浏览器。
  // 刻意不注册 Service Worker：后台要看实时数据，任何缓存都是风险（Chrome 108+/112+ 起从菜单安装已不要求 SW）。
  // theme-color 由 theme.js 按当前主题改写（未选择过时跟随系统）。
  const pwaHead = admin ? '<link rel="manifest" href="/assets/manifest.webmanifest"><link rel="apple-touch-icon" sizes="180x180" href="/assets/apple-touch-icon.png"><meta name="theme-color" content="#172033"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="券能行"><meta name="apple-mobile-web-app-status-bar-style" content="default">' : '';
  const nav = admin ? `<header class="topbar"><a class="brand" href="/admin"><svg class="brand-mark" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="20"/><line x1="45" y1="45" x2="53" y2="53"/><path d="M23 40V33a9 9 0 0 1 18 0v7"/></svg><span class="brand-text"><span>QNQupon</span><span class="brand-cn">券能行</span></span></a><div class="topbar-nav"><nav><a href="/admin/coupons">优惠券</a><a href="/admin/redemptions">核销记录</a><a href="/admin/presets">预设</a>${user?.role === 'super_admin' ? '<a href="/admin/users">账号</a><a href="/admin/settings">设置</a><a href="/admin/audit">审计</a>' : ''}</nav><button type="button" class="nav-hint nav-hint-left" aria-label="向左滚动导航"><svg viewBox="0 0 8 8" fill="currentColor" aria-hidden="true"><path d="M8 0 0 4l8 4z"/></svg></button><button type="button" class="nav-hint nav-hint-right" aria-label="向右滚动导航"><svg viewBox="0 0 8 8" fill="currentColor" aria-hidden="true"><path d="M0 0l8 4-8 4z"/></svg></button></div><div class="topbar-side" data-side><button class="icon-button menu-toggle" type="button" data-menu-toggle aria-label="菜单" aria-expanded="false">${menuIcon}</button><div class="side-panel"><div class="side-row"><span class="side-text">界面主题</span>${themeToggle}</div><a class="side-row" href="/admin/profile"><span class="side-text">个人账号</span><span class="who">${esc(user?.username || '')}</span></a><form method="post" action="/admin/logout" class="side-row"><input type="hidden" name="_csrf" value="${attr(user?.csrf || '')}">${logoutButton}</form></div></div></header>` : '';
  // 操作反馈：默认由 HTML 输出卡片（无 JS 也可见），app.js 接管滑入、超时淡出、关闭与堆叠。
  // 放在 <main> 之外：固定定位、不参与容器内的模块间距。
  const toastHost = `<div class="toast-host" data-toast-host>${flash ? `<div class="toast ${flash.type || 'info'}" role="status"><p class="toast-message">${esc(flash.message)}</p><button type="button" class="toast-close" aria-label="关闭">&times;</button></div>` : ''}</div>`;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${esc(fullTitle)}</title>${metaDescription}<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">${pwaHead}<link rel="stylesheet" href="/assets/app.css"><script src="/assets/theme.js"></script>${turnstileScript}</head><body class="${admin ? 'admin-body' : wide ? 'public-body landing-body' : 'public-body'}">${nav}${toastHost}<main class="container">${content}${siteFooter}</main><script src="/assets/app.js" defer></script></body></html>`;
}

// 公开页面向普通消费者：失败原因用直白说法，不出现状态机术语。
const plainReason = {
  exhausted: '这张券的可用次数已用完。',
  expired: '这张券已过有效期。',
  not_started: '这张券未到生效日期。',
  disabled: '这张券已被发券人停用，请联系发券人。',
  recycled: '这张券已被删除。'
};
const codeSpans = (code) => Array.from(String(code || '')).map((ch) => `<span>${esc(ch)}</span>`).join('');
// 券码名显示覆写值 → 表单值（''=跟随全局 / '1' / '0'）与文案。
const showNameValue = (value) => (value == null ? '' : (Number(value) === 1 ? '1' : '0'));
const showNameText = (value) => (value == null ? '跟随全局设置' : (Number(value) === 1 ? '始终显示' : '始终隐藏'));

// 面板说明入口：右上角 ❓ + 纯 CSS 气泡（悬浮或触屏点按显示、点别处失焦收起，零 JS）。
// 只放「不看会做错」的规则与联动；面板里的常驻文案保持 0～1 行。
const panelHelp = (...lines) => `<span class="tip"><button type="button" aria-label="本面板说明">?</button><span class="tip-body" role="note">${lines.map((line) => `<p>${line}</p>`).join('')}</span></span>`;

// 标题左侧的返回箭头：比整块「返回××」按钮省空间，悬浮变深、按下变红；文字标签只给读屏与悬浮提示。
const backArrow = (href, label = '返回') => `<a class="back-arrow" href="${attr(href)}" aria-label="${attr(label)}" title="${attr(label)}"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></a>`;

/** 首页（公开）：纯静态产品介绍页，供搜索引擎收录与访客了解项目；源码入口在首屏按钮与页脚。 */
export function home() {
  const features = [
    ['两级券码模型', '一张券面下可发多张券码，各自独立链接、二维码、次数与备注。'],
    ['6 位确认码防伪', '核销即生成确认码，公开查询页当场验真，结果来自官方服务器。'],
    ['核销邮件通知', '核销成功自动发信提醒，SMTP 密码经 AES-256-GCM 加密存储。'],
    ['券面 PNG 导出', '1080×1920 高清券面与二维码，随开随下，可直接印刷或转发。'],
    ['权限与审计', '两级管理员、回收站、操作审计，敏感入口分级限流。'],
    ['数据留在自己手里', 'SQLite 单文件加每日自动备份，跑在你自己的服务器上。']
  ];
  const steps = [
    ['建券发码', '后台建券面、发券码，每码独立链接与二维码。'],
    ['分享核销', '链接或二维码发给客人，点一下即完成核销。'],
    ['凭码验真', '核销生成 6 位确认码，查询页当场验明真伪。']
  ];
  const cards = features.map(([name, text]) => `<section class="feature"><h3>${esc(name)}</h3><p>${esc(text)}</p></section>`).join('');
  const stepItems = steps.map(([name, text], index) => `<section class="step"><span class="step-no">${index + 1}</span><h3>${esc(name)}</h3><p>${esc(text)}</p></section>`).join('');
  const hero = `<section class="hero">${authBrand}<p class="ticket-kicker">面向个体商家与小团队</p><h1>自托管不记名优惠券系统</h1><p class="lead">扫码核销、确认码防伪、邮件通知，数据全部留在自己的服务器上。</p><p class="actions hero-actions">${themeToggle}<a class="primary button" href="${REPO_URL}" target="_blank" rel="noopener noreferrer">GitHub 源码仓库</a><a class="secondary button" href="/verify">防伪查询</a></p><p class="hero-note">Node.js 22+ · SQLite 单文件 · 中文管理后台</p></section>`;
  const flow = `<section class="steps"><h2 class="section-title">三步就能用起来</h2><div class="step-grid">${stepItems}</div></section>`;
  const core = `<section class="features"><h2 class="section-title">核心能力</h2><div class="feature-grid">${cards}</div></section>`;
  const closing = `<section class="closing"><h2>代码完全开源</h2><p>AGPL-3.0-only 开源，源码与文档都在 GitHub，欢迎使用、提出建议。</p><p class="actions"><a class="primary button" href="${REPO_URL}" target="_blank" rel="noopener noreferrer">GitHub 源码仓库</a></p></section>`;
  return shell('QNQupon · 券能行 — 自托管不记名优惠券系统', `${hero}${flow}${core}${closing}`, {
    exactTitle: true,
    wide: true,
    description: 'QNQupon · 券能行——自托管不记名优惠券系统：券码扫码核销、6 位确认码防伪查询、核销邮件通知与券面 PNG 导出，数据留在你自己的服务器上。开源 AGPL-3.0-only。'
  });
}

export function publicCoupon(coupon, csrf, message = null) {
  const kind = message?.kind || '';
  if (!coupon) {
    return shell('无效券码', `<section class="public-card"><div class="ticket-kicker">电子优惠券</div><section class="result unknown"><h2>查不到这张优惠券</h2><p>二维码可能未扫全，或这张券码已被删除。</p><p>请与发券人核对链接后重试。</p></section><p class="muted center"><a href="/verify">核销凭证查询</a> · 凭 6 位确认码核验真伪。</p></section>`);
  }
  const state = coupon.current_state;
  const usable = state === 'valid';
  // 第一行“券面名 - 券码名”（displayCodeName === false 时只显示券面名），第二行是券面的优惠内容；券码备注是后台信息，永远不出现在这里。
  const title = coupon.displayCodeName === false ? String(coupon.face_name || '') : [coupon.face_name, coupon.name].filter(Boolean).join(' - ');
  const head = `<div class="ticket-kicker">电子优惠券</div><h1>${esc(title)}</h1><div class="offer">${esc(coupon.offer_text)}</div>`;
  const foot = `<p class="muted center"><a href="/verify">核销凭证查询</a> · 凭 6 位确认码核验真伪。</p>`;

  // 核销结果页：只留名称和优惠内容，其余空间全部让给结果提示。
  if (kind === 'redeemed') {
    return shell(title, `<section class="public-card">${head}<section class="result success"><h2>核销成功</h2><p class="result-lead">已扣除一次可用次数，不可退回。</p><div class="verify-code" data-code="${attr(message.code)}">${codeSpans(message.code)}</div><p class="result-meta">该码为核销凭证，请记录或截图保存。</p><p class="result-meta">核销时间：${esc(beijingTime(message.redeemedAt))}</p></section>${foot}</section>`);
  }
  if (kind === 'failed') {
    const reason = message.reason || plainReason[message.state] || '这张券暂时无法核销。';
    return shell(title, `<section class="public-card">${head}<section class="result failed"><h2>核销失败</h2><p>${esc(reason)}</p><p class="result-meta">若店员已确认交付，请刷新页面后重试。</p></section>${foot}</section>`);
  }

  const meta = `<dl class="coupon-meta"><div><dt>可用次数</dt><dd>${coupon.max_uses} 次</dd></div><div><dt>剩余次数</dt><dd>${Math.max(0, coupon.max_uses - coupon.used_count)} 次</dd></div><div><dt>生效日期</dt><dd>${esc(dateText(coupon.starts_on))}</dd></div><div><dt>截止日期</dt><dd>${esc(dateText(coupon.expires_on))}</dd></div></dl>`;
  const notice = coupon.instructions ? `<div class="notice"><b>使用说明</b><br>${esc(coupon.instructions)}</div>` : '';
  const store = coupon.store_text ? `<p class="store">${esc(coupon.store_text)}</p>` : '';
  const body = usable
    ? `<form method="post" action="/r/${encodeURIComponent(message?.token || '')}/redeem" data-confirm-title="确认核销吗？" data-confirm="核销将扣除一次可用次数，且无法撤销。&#10;请由店员点击“确认核销”，本券才算核销成功。"><input type="hidden" name="_csrf" value="${attr(csrf)}"><button class="primary big" type="submit">确认核销（请让店员点击）</button></form>`
    : `<section class="result blocked"><h2>此券当前不能核销</h2><p>${esc(plainReason[state] || '这张券的状态异常，请联系发券人确认。')}</p><p class="result-meta">若店员确认可用，请刷新页面后重试。</p></section>`;
  return shell(title, `<section class="public-card">${head}${coupon.description ? `<p class="description">${esc(coupon.description)}</p>` : ''}${meta}${notice}${store}${body}${foot}</section>`);
}

/**
 * 核销凭证查询页（公开、无需登录）：任何人拿 6 位确认码来查真实核销记录。
 * 这是本项目最直接的防伪手段——前端页面人人能仿造，但查询结果来自官方服务器，
 * 再配合核销后自动发信，收到的“核销成功”基本不可能是假的。
 */
export function verifyPage({ code = '', result = null, verifyHours = 72 } = {}) {
  const intro = `<div class="ticket-kicker">官方核销记录</div><h1>核销凭证查询</h1><p class="description">核销成功后会生成 6 位确认码（形如 <code>K7M-2QD</code>）。输入确认码可查询对应核销记录：查得到即为真实核销，查不到则该记录不存在。</p>`;
  const form = `<form method="get" action="/verify" class="verify-form"><label>6 位确认码<input name="code" value="${attr(code)}" required maxlength="20" placeholder="例如：K7M-2QD" autocomplete="off" autocapitalize="characters" spellcheck="false"></label><button class="primary" type="submit">查询真伪</button></form>`;
  const note = `<p class="muted">查询不区分大小写，“-” 可省略；核销记录保留 ${verifyHours} 小时可查，超期不再显示。</p>`;
  let panel = '';
  if (result?.kind === 'ok') {
    const row = result.row;
    const title = [row.face_name, row.code_name].filter(Boolean).join(' - ');
    const mail = emailState[row.email_status] || row.email_status || '—';
    // 层级：确认码缩为顶部小标题；真伪结论 + 券面/券码/核销时间/邮件状态放大为视觉重心。
    panel = `<section class="result success"><div class="verify-code sm" data-code="${attr(row.confirmation_code)}">${codeSpans(row.confirmation_code)}</div><h2>这是真实的核销记录</h2><p class="result-lead big">${esc(title)}</p><p class="result-time">核销时间：${esc(beijingTime(row.redeemed_at))}</p><p class="result-time">邮件通知：${esc(mail)}</p><p class="result-meta">本结果由官方服务器直接返回，无法由页面伪造。</p></section>`;
  } else if (result?.kind === 'unknown') {
    panel = `<section class="result unknown"><h2>查不到这个确认码</h2><p>确认码不存在、已超过 ${verifyHours} 小时保留期，或号码输入有误。</p><p class="result-meta">请核对 6 位字符后重试，或向店员重新索取核销页面。</p></section>`;
  } else if (result?.kind === 'invalid') {
    panel = `<section class="result failed"><h2>确认码格式不对</h2><p>确认码是 6 位字母和数字（形如 K7M-2QD），不含 0、1、I、O。请检查输入后重新查询。</p></section>`;
  }
  // 有结果时不再重复放输入框，改为底部居中的「查询下一个」长条返回输入页；查询提示只留表单页。
  const tail = result ? `<p class="verify-actions"><a class="verify-next" href="/verify">查询下一个</a></p>` : `${form}${note}`;
  return shell('核销凭证查询', `<section class="public-card">${intro}${panel}${tail}</section>`);
}

/** 限流提示页（429）：给人话原因和等待时间，不用 JSON 砸普通用户。 */
export function rateLimited(message = '请求太频繁了，请过一会儿再试。', isAdmin = false) {
  const back = isAdmin ? '<p class="actions"><a class="secondary button" href="/admin">返回管理概览</a></p>' : '';
  return shell('请求太频繁', `<section class="public-card"><div class="ticket-kicker">访问频率限制</div><h1>请求太频繁</h1><p class="description">${esc(message)}</p><p class="muted">为防止机器反复刷接口，短时间内设有访问频率上限。请稍候刷新页面重试。</p>${back}</section>`);
}

export function login(csrf, error = null, turnstileSiteKey = null) {
  // 配置了 sitekey 才渲染人机验证组件（隐式渲染，位于密码框与登录按钮之间）；关闭时输出与原先逐字节一致。
  // theme=auto：组件跟随系统偏好（与全站「跟随系统」默认态一致；页脚强制浅/深时组件仍随系统，属 Cloudflare 组件限制）。
  const widget = turnstileSiteKey ? `<div class="cf-turnstile" data-sitekey="${attr(turnstileSiteKey)}" data-theme="auto" data-language="zh-CN" data-action="admin-login"></div>` : '';
  return shell('管理登录', `<section class="auth-card">${authBrand}<div class="auth-head"><h1>管理后台</h1><p>仅限经授权的管理人员访问。</p></div>${error ? `<p class="form-error">${esc(error)}</p>` : ''}<form method="post" action="/admin/login"><input type="hidden" name="_csrf" value="${attr(csrf)}"><label>用户名<input name="username" autocomplete="username" required maxlength="50"></label><label>密码<input name="password" type="password" autocomplete="current-password" required></label>${widget}<button class="primary" type="submit">登录</button></form></section>`, { turnstile: Boolean(turnstileSiteKey) });
}

export function setup(csrf, error = null, passwordMin = 12) {
  return shell('初始化', `<section class="auth-card">${authBrand}<div class="auth-head"><h1>创建超级管理员</h1><p>请输入服务终端显示的一次性初始化口令。</p></div>${error ? `<p class="form-error">${esc(error)}</p>` : ''}<form method="post" action="/admin/setup"><input type="hidden" name="_csrf" value="${attr(csrf)}"><label>初始化口令<input name="bootstrapToken" required autocomplete="off"></label><label>超级管理员用户名<input name="username" required minlength="3" maxlength="50" autocomplete="username"></label><label>密码<input name="password" type="password" required minlength="${passwordMin}" autocomplete="new-password"></label><label>确认密码<input name="confirmPassword" type="password" required minlength="${passwordMin}" autocomplete="new-password"></label><button class="primary" type="submit">完成初始化</button></form></section>`);
}

export function forbidden(user = null) {
  return shell('权限不足', `<section class="auth-card"><h1>权限不足</h1><p>${user ? `${esc(user.username)} 当前角色为“${user.role === 'super_admin' ? '超级管理员' : '业务管理员'}”，无法访问该页面。` : '当前账号无权访问该页面。'}</p><p><a class="button secondary" href="/admin">返回概览</a></p></section>`, { admin: true, user });
}

// 列表/概览用的合并日期列：起~止 / 即日起~止 / 起~永久 / 永久
function dateRangeText(coupon) {
  const start = coupon.starts_on;
  const end = coupon.expires_on;
  if (start && end) return `${start} ~ ${end}`;
  if (end) return `即日起 ~ ${end}`;
  if (start) return `${start} ~ 永久`;
  return '永久';
}

function couponRows(coupons) {
  return coupons.map((coupon) => `<tr><td data-label="优惠券"><a href="/admin/coupons/${coupon.id}">${esc(coupon.name)}<small>${esc(coupon.offer_text)} · ${coupon.max_uses || 1} 次/张</small></a></td><td data-label="状态"><span class="badge ${coupon.current_state}">${stateName[coupon.current_state]}</span></td><td data-label="券码">已发 ${coupon.code_total || 0} 张 · 可用 ${coupon.code_available || 0} 张<small>累计核销 ${coupon.used_total || 0} 次</small></td><td data-label="日期">${esc(dateRangeText(coupon))}</td></tr>`).join('') || '<tr class="empty-row"><td colspan="4" class="empty">暂无优惠券</td></tr>';
}
const listHead = '<thead><tr><th>优惠券</th><th>状态</th><th>券码</th><th>日期</th></tr></thead>';

// 确认码超过「可查时长」后：字变灰、外框描红——表示它已经查不到了（不代表核销本身无效）。
function confirmationExpired(redeemedAt, verifyHours) {
  const hours = Number(verifyHours);
  const at = Date.parse(redeemedAt);
  if (!Number.isFinite(hours) || hours <= 0 || !Number.isFinite(at)) return false;
  return Date.now() - at > hours * 3600 * 1000;
}
const codePill = (code, redeemedAt, verifyHours) => `<code${confirmationExpired(redeemedAt, verifyHours) ? ' class="expired"' : ''}>${esc(code || '—')}</code>`;

export function dashboard({ user, coupons, stats, csrf, flash, redemptions = [], verifyHours = 72 }) {
  const redemptionRows = redemptions.map((r) => `<tr class="record-row"><td data-label="时间">${esc(beijingTime(r.redeemed_at))}</td><td data-label="优惠券"><a href="/admin/coupons/${r.coupon_id}">${esc(r.face_name || '—')}</a><small>${esc(r.code_name || '')}</small></td><td data-label="确认码">${codePill(r.confirmation_code, r.redeemed_at, verifyHours)}</td><td data-label="邮件">${mailBadge(r.email_status)}</td></tr>`).join('') || '<tr class="empty-row"><td colspan="4" class="empty">还没有核销记录</td></tr>';
  return shell('概览', `<section class="page-head"><div class="page-title"><h1>概览</h1><p>时间均为北京时间</p></div><div class="actions"><a class="primary button" href="/admin/coupons/new">创建优惠券</a></div></section><section class="stats"><div><b>${stats.valid}</b><span>可用券码</span></div><div><b>${stats.used}</b><span>已核销次数</span></div><div><b>${stats.expiring}</b><span>${stats.expiringDays ?? 30} 天内到期</span></div><div><a class="stat-link" href="/admin/recycle"><b>${stats.recycled}</b><span>回收站</span></a></div></section><section class="panel"><h2>最近更新</h2><table>${listHead}<tbody>${couponRows(coupons)}</tbody></table></section><section class="panel"><div class="panel-head"><h2>最近核销</h2>${panelHelp('最近 12 条流水；每条一行：左侧是券面与券码。', '确认码超过可查时长后变灰、描红。')}<div class="head-actions"><a class="secondary button" href="/admin/redemptions">全部核销记录 →</a></div></div><table><thead><tr><th>时间</th><th>优惠券</th><th>确认码</th><th>邮件</th></tr></thead><tbody>${redemptionRows}</tbody></table></section>`, { admin: true, user: { ...user, csrf }, flash });
}

/**
 * 核销记录总页（管理端）：全部券码的核销流水。
 * 筛选口径：券面下拉 + 日期范围（提交北京时间自然日，由服务端转 UTC 比较）；分页 20 条/页。
 */
export function redemptionsPage({ user, csrf, rows = [], coupons = [], filters = {}, page = 1, pages = 1, total = 0, flash, verifyHours = 72 }) {
  const active = { coupon: String(filters.coupon ?? ''), from: String(filters.from ?? ''), to: String(filters.to ?? '') };
  // 分页链接保留当前筛选条件；第 1 页不带 page 参数。
  const search = (pageNo) => {
    const params = new URLSearchParams();
    if (active.coupon) params.set('coupon', active.coupon);
    if (active.from) params.set('from', active.from);
    if (active.to) params.set('to', active.to);
    if (pageNo > 1) params.set('page', String(pageNo));
    const text = params.toString();
    return text ? `/admin/redemptions?${text}` : '/admin/redemptions';
  };
  const options = coupons.map((c) => `<option value="${c.id}"${active.coupon === String(c.id) ? ' selected' : ''}>${esc(c.name)}${c.status === 'disabled' ? '（已停用）' : ''}${c.status === 'recycled' ? '（回收站）' : ''}</option>`).join('');
  const filterForm = `<form method="get" action="/admin/redemptions" class="popover-form"><label>券面<select name="coupon"><option value="">全部券面</option>${options}</select></label><label>开始日期<input type="date" name="from" value="${attr(active.from)}"></label><label>截止日期<input type="date" name="to" value="${attr(active.to)}"></label><div class="actions"><button class="primary" type="submit">查询</button><a class="secondary button" href="/admin/redemptions">重置</a></div></form>`;
  // 筛选平时收起：标题行右侧一个按钮，点开才是浮窗；已选条件用角标提示，免得把筛选结果当成全量
  const filterCount = [active.coupon, active.from, active.to].filter(Boolean).length;
  const filterButton = `<div class="popover-wrap"><button type="button" class="secondary" data-popover-toggle aria-expanded="false" aria-controls="redemption-filter">筛选${filterCount ? `<span class="popover-count">${filterCount}</span>` : ''}</button><div class="popover" id="redemption-filter" hidden>${filterForm}</div></div>`;
  const rowHtml = rows.map((r) => `<tr class="record-row"><td data-label="时间">${esc(beijingTime(r.redeemed_at))}</td><td data-label="券面"><a href="/admin/coupons/${r.coupon_id}">${esc(r.face_name || '—')}</a>${r.offer_text ? `<small>${esc(r.offer_text)}</small>` : ''}</td><td data-label="券码">${r.code_id ? `<a href="/admin/codes/${attr(r.code_id)}">${esc(r.code_name || r.code_id)}</a>` : '—'}${r.code_note ? `<small>${esc(r.code_note)}</small>` : ''}</td><td data-label="确认码">${codePill(r.confirmation_code, r.redeemed_at, verifyHours)}</td><td data-priority="low" data-label="来源 IP">${esc(r.source_ip || '—')}</td><td data-label="邮件">${mailBadge(r.email_status)}</td></tr>`).join('') || '<tr class="empty-row"><td colspan="6" class="empty">没有符合条件的核销记录</td></tr>';
  const pager = total > 0 ? `<div class="actions"><span class="muted">共 ${total} 条 · 第 ${page} / ${pages} 页</span>${page > 1 ? `<a class="button secondary" href="${search(page - 1)}">上一页</a>` : ''}${page < pages ? `<a class="button secondary" href="${search(page + 1)}">下一页</a>` : ''}</div>` : '';
  return shell('核销记录', `<section class="page-head"><div class="page-title">${backArrow('/admin', '返回概览')}<h1>核销记录</h1><p>按核销时间倒序；日期筛选按北京时间自然日</p></div><div class="actions">${filterButton}</div></section><section class="panel"><h2>记录（${total} 条）</h2>${panelHelp('每条一行：左侧是券面与券码，右侧是优惠内容与备注。', '确认码超过可查时长后变灰、描红，表示已经查不到了（不代表核销本身无效）。')}<table><thead><tr><th>时间</th><th>券面</th><th>券码</th><th>确认码</th><th>来源 IP</th><th>邮件</th></tr></thead><tbody>${rowHtml}</tbody></table>${pager}</section>`, { admin: true, user: { ...user, csrf }, flash });
}

export function couponsPage({ user, coupons, csrf, flash }) {
  return shell('优惠券', `<section class="page-head has-title-link"><div class="page-title"><h1>优惠券</h1>${recycleLink}<span class="title-gap" aria-hidden="true"></span><p>券面定义优惠与次数，券码在详情页创建。</p></div><div class="actions"><a class="secondary button" href="/admin/coupons" data-refresh>刷新</a><a class="primary button" href="/admin/coupons/new">新建</a></div></section><section class="panel"><table>${listHead}<tbody>${couponRows(coupons)}</tbody></table></section>`, { admin: true, user: { ...user, csrf }, flash });
}

export function recyclePage({ user, faces, codes, csrf, flash, purgeDays = 30 }) {
  const faceRows = faces.map((coupon) => `<tr class="ops-top"><td data-label="优惠券"><a href="/admin/coupons/${coupon.id}">${esc(coupon.name)}<small>${esc(coupon.offer_text)}</small></a></td><td data-priority="low" data-label="日期">${esc(dateRangeText(coupon))}</td><td data-priority="low" data-label="移入时间">${esc(beijingTime(coupon.recycled_at, 16))}</td><td class="row-ops"><form method="post" action="/admin/coupons/${coupon.id}/status" class="inline-form" data-confirm="恢复后该券面及其下未单独回收的券码将重新可用。"><input type="hidden" name="_csrf" value="${attr(csrf)}"><input type="hidden" name="return" value="/admin/recycle"><button name="status" value="active" class="secondary">恢复</button></form></td></tr>`).join('') || '<tr class="empty-row"><td colspan="4" class="empty">没有回收的优惠券</td></tr>';
  const codeRows = codes.map((code) => `<tr class="ops-top"><td data-label="券码"><a href="/admin/codes/${code.id}">${esc(code.name || code.id)}<small>${esc(code.face_name || '')} · ${esc(code.note || '未填写备注')} · 累计核销 ${code.used_count}/${code.max_uses} 次</small></a></td><td data-priority="low" data-label="日期">${esc(dateRangeText(code))}</td><td data-priority="low" data-label="移入时间">${esc(beijingTime(code.recycled_at, 16))}</td><td class="row-ops"><form method="post" action="/admin/codes/${code.id}/status" class="inline-form" data-confirm="恢复后该券码可重新核销（仍需满足券面日期与状态）。"><input type="hidden" name="_csrf" value="${attr(csrf)}"><input type="hidden" name="return" value="/admin/recycle"><button name="status" value="active" class="secondary">恢复</button></form></td></tr>`).join('') || '<tr class="empty-row"><td colspan="4" class="empty">没有回收的券码</td></tr>';
  return shell('回收站', `<section class="page-head"><div class="page-title">${backArrow('/admin/coupons', '返回优惠券列表')}<h1>回收站</h1><p>移入满 ${purgeDays} 天自动永久删除，可随时恢复。</p></div><div class="actions"><a class="secondary button" href="/admin/recycle" data-refresh>刷新</a></div></section><section class="panel"><h2>优惠券（券面）</h2><table><thead><tr><th>优惠券</th><th>日期</th><th>移入时间</th><th>操作</th></tr></thead><tbody>${faceRows}</tbody></table></section><section class="panel"><h2>券码</h2><table><thead><tr><th>券码 / 备注</th><th>日期</th><th>移入时间</th><th>操作</th></tr></thead><tbody>${codeRows}</tbody></table></section>`, { admin: true, user: { ...user, csrf }, flash });
}

function couponFields(coupon = {}, presets = []) {
  const options = `<option value="">不套用预设</option>${presets.map((p) => `<option value="${p.id}" data-instructions="${attr(p.instructions || '')}" data-store="${attr(p.store_text || '')}">${esc(p.name)}</option>`).join('')}`;
  return `<label>名称<input name="name" required maxlength="80" value="${attr(coupon.name || '')}" placeholder="例如：朋友专用券"></label><label>优惠内容<input name="offerText" required maxlength="120" value="${attr(coupon.offer_text || '')}" placeholder="例如：立减 5 元"></label><label>描述<textarea name="description" maxlength="500">${esc(coupon.description || '')}</textarea></label><div class="form-grid"><label>每张券码可用次数<input name="maxUses" type="number" min="1" max="10000" required value="${attr(coupon.max_uses || 1)}"></label><label>套用说明/门店预设<select id="preset-select">${options}</select></label><label>开始日期<small>（留空 = 即刻生效）</small><input name="startsOn" type="date" value="${attr(coupon.starts_on || '')}"></label><label>截止日期<small>（留空 = 长期有效）</small><input name="expiresOn" type="date" value="${attr(coupon.expires_on || '')}"></label></div><label>使用说明<textarea id="instructions" name="instructions" maxlength="1000">${esc(coupon.instructions || '')}</textarea></label><label>门店信息<textarea id="store-text" name="storeText" maxlength="500">${esc(coupon.store_text || '')}</textarea></label>`;
}

export function couponForm({ user, csrf, coupon, presets, flash }) {
  const editing = Boolean(coupon);
  const back = editing ? backArrow(`/admin/coupons/${coupon.id}`, '返回详情') : backArrow('/admin/coupons', '返回优惠券列表');
  return shell(editing ? '编辑优惠券' : '创建优惠券', `<section class="page-head"><div class="page-title">${back}<h1>${editing ? '编辑优惠券' : '创建优惠券'}</h1>${editing ? '<p>改动同步到该券面全部券码；已发出的链接不变。</p>' : ''}</div></section><form class="panel form-panel" method="post" action="${editing ? `/admin/coupons/${coupon.id}` : '/admin/coupons'}"><input type="hidden" name="_csrf" value="${attr(csrf)}">${couponFields(coupon || {}, presets)}<button class="primary" type="submit">${editing ? '保存修改' : '创建优惠券'}</button></form>`, { admin: true, user: { ...user, csrf }, flash });
}

export function couponDetail({ user, coupon, codes, redemptions, csrf, flash, verifyHours = 72 }) {
  const canEdit = coupon.status !== 'recycled';
  const back = coupon.status === 'recycled' ? backArrow('/admin/recycle', '返回回收站') : backArrow('/admin/coupons', '返回优惠券列表');
  const here = `/admin/coupons/${coupon.id}`;
  const statusActions = coupon.status === 'active' ? '<button name="status" value="disabled" class="secondary">停用整张券</button>' : coupon.status === 'disabled' ? '<button name="status" value="active" class="secondary">恢复整张券</button>' : '';
  const purge = coupon.status === 'recycled' && user.role === 'super_admin' ? `<form method="post" action="/admin/coupons/${coupon.id}/purge" data-confirm="将永久删除该券面及其全部券码与核销记录，且无法恢复。是否继续？"><input type="hidden" name="_csrf" value="${attr(csrf)}"><label class="check"><input type="checkbox" required> 我已确认永久删除</label><button class="danger">立即永久删除</button></form>` : '';
  const restore = coupon.status === 'recycled' ? `<form method="post" action="/admin/coupons/${coupon.id}/status" data-confirm="确认从回收站恢复？如果该券已过期，下一次自动维护可能会再次把它移入回收站。"><input type="hidden" name="_csrf" value="${attr(csrf)}"><input type="hidden" name="return" value="${here}"><button name="status" value="active" class="secondary">从回收站恢复</button></form>` : '';
  const manageBlock = canEdit
    ? `<div class="danger-row"><form method="post" action="/admin/coupons/${coupon.id}/status"><input type="hidden" name="_csrf" value="${attr(csrf)}"><input type="hidden" name="return" value="${here}">${statusActions}</form><form method="post" action="/admin/coupons/${coupon.id}/status" data-confirm="将该券面及其下全部券码移入回收站？之后所有券码都无法核销。"><input type="hidden" name="_csrf" value="${attr(csrf)}"><input type="hidden" name="return" value="${here}"><button name="status" value="recycled" class="danger">删除</button></form></div>`
    : `<div class="danger-row">${restore}${purge}</div>`;

  // 创建券码做成「券码」卡片标题行右侧的「新建」：平时不占版面，点开才是浮窗里的表单
  const createHelp = canEdit ? panelHelp('每张券码有独立链接与二维码，次数与有效期跟随券面。', '数量 &gt; 1 为批量：名称自动加编号（位数与数量同宽，如 25 张 → <code>#01</code>…#25），券码名默认不显示。', '名称留空则以券面名作基名，编号同样按数量补零；名称仅作展示，可重复。') : '';
  const createButton = canEdit ? `<div class="popover-wrap"><button type="button" class="primary" data-popover-toggle aria-expanded="false" aria-controls="code-create">新建</button><div class="popover" id="code-create" hidden><form id="code-create-form" method="post" action="/admin/coupons/${coupon.id}/codes" class="popover-form"><input type="hidden" name="_csrf" value="${attr(csrf)}"><label>券码名称<input name="name" maxlength="80" placeholder="例如：张三的券；留空自动命名"></label><label>备注<input name="note" maxlength="100" placeholder="发给谁，仅后台可见"></label><label>券码名显示<select name="show_name" id="code-show-name"><option value="">跟随全局设置</option><option value="1">始终显示</option><option value="0">始终隐藏</option></select></label><label>生成数量<input name="count" id="code-count" type="number" min="1" max="100" step="1" value="1"></label><div class="actions"><button class="primary" id="code-submit" type="submit">创建券码</button></div></form></div></div>` : '';

  const codeRows = codes.map((code) => {
    const ops = `<a class="secondary button" href="/admin/codes/${code.id}/open" target="_blank" rel="noreferrer">核销页</a>`
      + (code.status === 'recycled'
        ? `<form method="post" action="/admin/codes/${code.id}/status" class="inline-form"><input type="hidden" name="_csrf" value="${attr(csrf)}"><input type="hidden" name="return" value="${here}"><button name="status" value="active" class="secondary">恢复</button></form>`
        : `<form method="post" action="/admin/codes/${code.id}/status" class="inline-form"><input type="hidden" name="_csrf" value="${attr(csrf)}"><input type="hidden" name="return" value="${here}"><button name="status" value="${code.status === 'disabled' ? 'active' : 'disabled'}" class="secondary">${code.status === 'disabled' ? '启用' : '停用'}</button></form><form method="post" action="/admin/codes/${code.id}/status" class="inline-form" data-confirm="将该券码移入回收站？该券码将无法再核销，其他券码不受影响。"><input type="hidden" name="_csrf" value="${attr(csrf)}"><input type="hidden" name="return" value="${here}"><button name="status" value="recycled" class="danger">删除</button></form>`);
    // 「已发放」是运营标记（两个角色都能改）；手机档把它挪到卡片左下角，见 app.css 的 640 块
    const issued = canEdit
      ? `<form method="post" action="/admin/codes/${code.id}/issued" class="issued-form"><input type="hidden" name="_csrf" value="${attr(csrf)}"><input type="hidden" name="return" value="${here}"><label class="check issued-toggle"><input type="checkbox" name="issued" value="1" data-autosubmit${code.issued ? ' checked' : ''}>已发</label></form>`
      : `<span class="issued-at">${code.issued ? '已发' : '未发'}</span>`;
    return `<tr class="code-card"><td data-label="券码"><a href="/admin/codes/${code.id}">${esc(code.name || code.id)}<small><code>${esc(code.id)}</code>${code.note ? ` · ${esc(code.note)}` : ''}</small></a></td><td data-label="状态"><span class="badge ${code.current_state}">${stateName[code.current_state]}</span></td><td data-label="已用">${code.used_count} / ${coupon.max_uses} 次</td><td data-label="已发放" class="issued-cell">${issued}</td><td class="row-ops">${ops}</td></tr>`;
  }).join('') || '<tr class="empty-row"><td colspan="5" class="empty">还没有券码；创建后才能把链接或二维码发给客人。</td></tr>';

  const recordRows = redemptions.map((r) => `<tr class="record-row"><td data-label="时间">${esc(beijingTime(r.redeemed_at))}</td><td data-label="券码"><a href="/admin/codes/${r.code_id}">${esc(r.code_name || (r.code_id ? `券码 ${r.code_id}` : '—'))}</a>${r.code_note ? `<small>${esc(r.code_note)}</small>` : ''}</td><td data-label="确认码">${codePill(r.confirmation_code, r.redeemed_at, verifyHours)}</td><td data-priority="low" data-label="来源 IP">${esc(r.source_ip || '—')}</td><td data-label="邮件">${mailBadge(r.email_status)}</td></tr>`).join('') || '<tr class="empty-row"><td colspan="5" class="empty">尚未核销</td></tr>';

  return shell(coupon.name, `<section class="page-head"><div class="page-title">${back}<h1>${esc(coupon.name)}</h1><p>${esc(coupon.offer_text)} · ${coupon.max_uses} 次/张 · <span class="badge ${coupon.current_state}">${stateName[coupon.current_state]}</span></p></div><div class="actions"><a class="secondary button" href="/admin/coupons/${coupon.id}" data-refresh>刷新</a></div></section><section class="detail-grid"><article class="panel"><div class="panel-head"><h2>券面信息</h2>${panelHelp('一张券面下可创建多张券码，券码共用这里的次数与有效期。', '停用或移入回收站会让该券面下全部券码立即失效。')}<div class="head-actions">${canEdit ? `<a class="secondary button" href="/admin/coupons/${coupon.id}/edit">编辑券面</a>` : ''}</div></div><dl class="details"><dt>生效</dt><dd>${esc(dateText(coupon.starts_on))}</dd><dt>截止</dt><dd>${esc(dateText(coupon.expires_on))}</dd><dt>数量</dt><dd>共 ${codes.filter((c) => c.status !== 'recycled').length} / 可用 ${codes.filter((c) => c.current_state === 'valid').length}</dd><dt>核销</dt><dd>${codes.reduce((sum, c) => sum + c.used_count, 0)} 次</dd><dt class="wide">描述</dt><dd class="wide">${esc(coupon.description || '—')}</dd><dt class="wide">说明</dt><dd class="wide">${esc(coupon.instructions || '—')}</dd><dt class="wide">门店</dt><dd class="wide">${esc(coupon.store_text || '—')}</dd></dl>${manageBlock}</article><article class="panel"><div class="panel-head"><h2>券码（${codes.length}）</h2>${createHelp}<div class="head-actions">${createButton}</div></div><div class="table-scroll"><table><thead><tr><th>券码</th><th>状态</th><th>已用</th><th>已发放</th><th>操作</th></tr></thead><tbody>${codeRows}</tbody></table></div></article></section><section class="panel"><h2>核销记录（${redemptions.length}）</h2>${panelHelp('每条一行：左侧券码，右侧备注（发给谁）。', '确认码超过可查时长后变灰、描红。')}<table><thead><tr><th>时间</th><th>券码</th><th>确认码</th><th>来源 IP</th><th>邮件</th></tr></thead><tbody>${recordRows}</tbody></table></section>`, { admin: true, user: { ...user, csrf }, flash });
}

export function codeDetail({ user, code, redemptions, csrf, flash, verifyHours = 72, share = null }) {
  const recycled = code.status === 'recycled';
  const faceDisabled = code.face_status === 'disabled';
  const here = `/admin/codes/${code.id}`;
  const back = backArrow(`/admin/coupons/${code.face_id}`, '返回所属优惠券');
  const manage = recycled
    ? `<div class="danger-row"><form method="post" action="/admin/codes/${code.id}/status" data-confirm="恢复后该券码可重新核销（仍需满足券面日期与状态）。"><input type="hidden" name="_csrf" value="${attr(csrf)}"><input type="hidden" name="return" value="${here}"><button name="status" value="active" class="secondary">从回收站恢复</button></form>${user.role === 'super_admin' ? `<form method="post" action="/admin/codes/${code.id}/purge" data-confirm="将永久删除该券码及其核销记录，且无法恢复。是否继续？"><input type="hidden" name="_csrf" value="${attr(csrf)}"><label class="check"><input type="checkbox" required> 我已确认永久删除</label><button class="danger">立即永久删除</button></form>` : ''}</div>`
    : `<div class="danger-row"><form method="post" action="/admin/codes/${code.id}/status"><input type="hidden" name="_csrf" value="${attr(csrf)}"><input type="hidden" name="return" value="${here}"><button name="status" value="${code.status === 'disabled' ? 'active' : 'disabled'}" class="secondary">${code.status === 'disabled' ? '启用' : '停用'}</button></form><form method="post" action="/admin/codes/${code.id}/status" class="inline-form" data-confirm="将该券码移入回收站？该券码将无法再核销，其他券码不受影响。"><input type="hidden" name="_csrf" value="${attr(csrf)}"><input type="hidden" name="return" value="${here}"><button name="status" value="recycled" class="danger">删除</button></form></div>`;
  const rows = redemptions.map((r) => `<tr class="record-row"><td data-label="时间">${esc(beijingTime(r.redeemed_at))}</td><td data-label="确认码">${codePill(r.confirmation_code, r.redeemed_at, verifyHours)}</td><td data-priority="low" data-label="来源 IP">${esc(r.source_ip || '—')}</td><td data-priority="low" data-label="设备">${esc(r.user_agent ? String(r.user_agent).slice(0, 40) : '—')}</td><td data-label="邮件">${mailBadge(r.email_status)}</td></tr>`).join('') || '<tr class="empty-row"><td colspan="5" class="empty">这张券码尚未核销</td></tr>';

  return shell(code.name || code.id, `<section class="page-head"><div class="page-title">${back}<h1>${esc(code.name || code.id)}</h1><p>属于「${esc(code.face_name || '')}」· ${esc(code.offer_text)} · <span class="badge ${code.current_state}">${stateName[code.current_state]}</span></p></div><div class="actions"><a class="secondary button" href="/admin/codes/${code.id}" data-refresh>刷新</a></div></section>${code.current_state === 'disabled' && faceDisabled ? '<div class="flash error">所属券面已被停用，恢复券面后这张券码才会重新可用。</div>' : ''}<section class="detail-grid"><article class="panel"><div class="panel-head"><h2>把这张券发出去</h2>${panelHelp('每个券码有独立链接与二维码；客人到店后由店员扫码核销。', '「分享」生成的是一次性链接：被打开一次即失效，或 24 小时后过期；手机扫码就能把券图存下来，方便发给没有联系方式的顾客。同一张券若已有未使用、未过期的分享，再点一次会复用并刷新 24 小时；券面内容改过则作废旧链接、换新。')}<div class="head-actions"><div class="popover-wrap"><button type="button" class="secondary" data-popover-toggle aria-expanded="false" aria-controls="code-share">分享优惠券</button><div class="popover" id="code-share" data-keep-open hidden>${share ? `<figure class="qr-box"><span class="qr-frame"><img src="/admin/codes/${code.id}/share/qrcode" width="150" height="150" alt="分享二维码"></span><figcaption class="qr-label">分享优惠券二维码</figcaption></figure><p class="share-expire">打开一次即失效 · 有效期至 ${esc(beijingTime(share.expiresAt, 16))}</p><form method="post" action="/admin/codes/${code.id}/share" class="inline-form"><input type="hidden" name="_csrf" value="${attr(csrf)}"><button class="secondary" type="submit">刷新有效期</button></form>` : `<p class="share-expire">生成一条一次性链接与临时二维码，发给没有联系方式的顾客。</p><form method="post" action="/admin/codes/${code.id}/share" class="inline-form"><input type="hidden" name="_csrf" value="${attr(csrf)}"><button class="primary" type="submit">生成分享链接</button></form>`}</div></div></div></div><div class="qr-preview"><figure class="qr-box"><span class="qr-frame"><img src="/admin/codes/${code.id}/qrcode" width="150" height="150" alt="核销二维码"></span><figcaption class="qr-label">专属核销二维码</figcaption></figure><div class="qr-links"><div class="actions"><a class="secondary button" href="/admin/codes/${code.id}/open" target="_blank" rel="noreferrer">打开核销页</a><a class="secondary button" href="/admin/codes/${code.id}/image" target="_blank" rel="noreferrer">下载优惠券</a><a class="secondary button" href="/admin/codes/${code.id}/image?inline=1" target="_blank" rel="noreferrer">预览优惠券</a></div></div></div>${manage}</article><article class="panel"><div class="panel-head"><h2>券码信息</h2>${panelHelp('「券码名显示」控制客人核销页与优惠券图片的标题是否带这张券的名字；此处设置优先于全局开关。')}<div class="head-actions">${recycled ? `<span class="issued-at">${code.issued ? '已发' : '未发'}</span>` : `<form method="post" action="/admin/codes/${code.id}/issued" class="issued-form"><input type="hidden" name="_csrf" value="${attr(csrf)}"><label class="check issued-toggle"><input type="checkbox" name="issued" value="1" data-autosubmit${code.issued ? ' checked' : ''}>已发</label>${code.issued_at ? `<small class="issued-at">${esc(beijingTime(code.issued_at, 16))}</small>` : ''}</form>`}</div></div><dl class="details"><dt class="wide">ID</dt><dd class="wide"><code>${esc(code.id)}</code></dd><dt class="wide">名称</dt><dd class="wide">${esc(code.name)}</dd><dt>券码名显示</dt><dd><form method="post" action="/admin/codes/${code.id}/name" class="details-form"><input type="hidden" name="_csrf" value="${attr(csrf)}"><input type="hidden" name="name" value="${attr(code.name || '')}"><select name="show_name" aria-label="券码名显示" data-autosubmit><option value=""${showNameValue(code.show_name) === '' ? ' selected' : ''}>跟随全局设置</option><option value="1"${showNameValue(code.show_name) === '1' ? ' selected' : ''}>始终显示</option><option value="0"${showNameValue(code.show_name) === '0' ? ' selected' : ''}>始终隐藏</option></select></form></dd><dt class="wide">已核销</dt><dd class="wide">${code.used_count} / ${code.max_uses} 次（剩余 ${Math.max(0, code.max_uses - code.used_count)} 次）</dd><dt class="wide">备注</dt><dd class="wide">${esc(code.note || '—')}</dd><dt>生效</dt><dd>${esc(dateText(code.starts_on))}</dd><dt>截止</dt><dd>${esc(dateText(code.expires_on))}</dd><dt>创建时间</dt><dd>${esc(beijingTime(code.created_at))}</dd><dt>创建人</dt><dd>${esc(code.creator_name || '—')}</dd></dl><form method="post" action="/admin/codes/${code.id}/name" class="inline-form note-form"><input type="hidden" name="_csrf" value="${attr(csrf)}"><label>券码名称<input name="name" required maxlength="80" value="${attr(code.name || '')}" placeholder="例如：张三的券"></label><button class="secondary" type="submit">保存名称</button></form><form method="post" action="/admin/codes/${code.id}/note" class="inline-form note-form"><input type="hidden" name="_csrf" value="${attr(csrf)}"><label>备注<input name="note" maxlength="100" value="${attr(code.note || '')}" placeholder="发给谁，仅后台可见"></label><button class="secondary" type="submit">保存备注</button></form></article><article class="panel wide"><h2>核销记录（${redemptions.length}）</h2>${panelHelp('每条一行：核销时间、确认码与邮件状态。', '确认码超过可查时长后变灰、描红。')}<table><thead><tr><th>时间</th><th>确认码</th><th>来源 IP</th><th>设备</th><th>邮件</th></tr></thead><tbody>${rows}</tbody></table></article></section>`, { admin: true, user: { ...user, csrf }, flash });
}

export function shareGone({ message }) {
  return shell('分享链接失效', `<section class="panel public-card"><h1>分享链接失效</h1><p class="muted">${esc(message)}</p><p class="muted">请让发券的人重新分享一次。</p></section>`);
}

/** 分享链接打开后的页面：链接只出现一次，所以把券图直接内联进页面（data:），并催用户先保存。 */
export function shareDownload({ imageBase64, fileName, codeName }) {
  const data = `data:image/png;base64,${imageBase64}`;
  return shell('你的优惠券', `<section class="panel public-card"><h1>你的优惠券</h1><p class="muted">${esc(codeName || '')}</p><p class="share-warn">请先长按图片保存到手机（或点下面的按钮）。这个页面只会出现一次——关闭或刷新之后链接就失效了。</p><img class="share-image" src="${data}" alt="优惠券图片"><p><a class="primary button" download="${attr(fileName)}" href="${data}">保存图片</a></p></section>`);
}

export function presetsPage({ user, presets, csrf, flash }) {
  const items = presets.map((p) => `<form class="panel form-panel" method="post" action="/admin/presets/${p.id}"><input type="hidden" name="_csrf" value="${attr(csrf)}"><div class="preset-head"><h2>${esc(p.name)}</h2><label class="check switch"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}> 启用</label></div><label>预设名称<input name="name" required maxlength="80" value="${attr(p.name)}"></label><label>使用说明<textarea name="instructions" maxlength="1000">${esc(p.instructions || '')}</textarea></label><label>门店信息<textarea name="storeText" maxlength="500">${esc(p.store_text || '')}</textarea></label><div class="danger-row"><button class="primary" type="submit">保存修改</button><button class="danger" type="submit" formaction="/admin/presets/${p.id}/delete" data-confirm="确认删除该预设？已套用该预设的优惠券不受影响。">删除预设</button></div></form>`).join('') || '<section class="panel"><p class="empty">暂无预设</p></section>';
  return shell('预设', `<section class="page-head"><div class="page-title"><h1>预设</h1><p>创建或编辑优惠券时可一键带入。</p></div></section><section class="detail-grid"><form class="panel form-panel" method="post" action="/admin/presets"><div class="panel-head"><h2>新增预设</h2><div class="head-actions"><button class="primary">保存预设</button></div></div><input type="hidden" name="_csrf" value="${attr(csrf)}"><label>预设名称<input name="name" required maxlength="80" placeholder="例如：示例总店"></label><label>使用说明<textarea name="instructions" maxlength="1000" placeholder="例如：出示本券给店员，确认后由店员点击核销。"></textarea></label><label>门店信息<textarea name="storeText" maxlength="500" placeholder="例如：示例总店 · 营业时间 10:00-22:00"></textarea></label></form><section class="preset-list">${items}</section></section>`, { admin: true, user: { ...user, csrf }, flash });
}

export function usersPage({ user, users, csrf, flash, passwordMin = 12 }) {
  const rows = users.map((account) => {
    const isSelf = account.id === user.id;
    const superAdmin = account.role === 'super_admin';
    const ops = isSelf
      ? '<span class="muted">当前账号</span>'
      : `<form method="post" action="/admin/users/${account.id}/active" class="inline-form"><input type="hidden" name="_csrf" value="${attr(csrf)}"><input type="hidden" name="active" value="${account.active ? '0' : '1'}"><button class="${account.active ? 'secondary' : 'primary'}" ${account.active ? `data-confirm="停用后 ${esc(account.username)} 会立即退出登录，确认停用？"` : ''}>${account.active ? '停用' : '启用'}</button></form>`
        + (superAdmin ? '' : `<form method="post" action="/admin/users/${account.id}/password" class="inline-form"><input type="hidden" name="_csrf" value="${attr(csrf)}"><input type="password" name="newPassword" class="field-hidden" minlength="${passwordMin}" aria-hidden="true" tabindex="-1"><button type="button" class="danger" data-password-reset data-minlength="${passwordMin}" data-user="${attr(account.username)}">重置密码</button></form>`);
    return `<tr><td data-label="用户名">${esc(account.username)}</td><td data-label="角色">${superAdmin ? '超级管理员' : '业务管理员'}</td><td data-label="状态">${account.active ? '启用' : '已停用'}</td><td data-priority="low" data-label="上次登录">${account.last_login_at ? esc(beijingTime(account.last_login_at, 16)) : '从未登录'}</td><td class="row-ops">${ops}</td></tr>`;
  }).join('');
  return shell('账号管理', `<section class="page-head"><div class="page-title"><h1>账号管理</h1><p>仅超级管理员可见。</p></div></section><section class="detail-grid"><form class="panel form-panel" method="post" action="/admin/users"><div class="panel-head"><h2>创建业务管理员</h2><div class="head-actions"><button class="primary">创建账号</button></div></div><input type="hidden" name="_csrf" value="${attr(csrf)}"><label>用户名<input name="username" required minlength="3" maxlength="50"></label><label>初始密码<input name="password" type="password" required minlength="${passwordMin}"></label></form><section class="panel"><h2>现有账号</h2><table class="users-table"><thead><tr><th>用户名</th><th>角色</th><th>状态</th><th>上次登录</th><th>操作</th></tr></thead><tbody>${rows || '<tr class="empty-row"><td colspan="5" class="empty">暂无账号</td></tr>'}</tbody></table></section></section>`, { admin: true, user: { ...user, csrf }, flash });
}

export function settingsPage({ user, csrf, settings, flash }) {
  // 保留参数展示：已存值为界内整数才采用，否则回退默认（口径与 db.retention 一致）。
  const num = (key, fallback, max) => { const n = Number(settings[key]); return Number.isInteger(n) && n >= 1 && n <= max ? n : fallback; };
  const recycleDays = num('recycleDays', 30, 365);
  const purgeDays = num('purgeDays', 30, 365);
  const verifyHours = num('verifyHours', 72, 720);
  const expiringDays = num('expiringDays', 30, 365);
  return shell('服务设置', `<section class="page-head"><div class="page-title"><h1>服务设置</h1></div></section><section class="detail-grid"><form class="panel form-panel" method="post" action="/admin/settings"><h2>邮件通知</h2>${panelHelp('SMTP 专用密码以应用加密密钥加密存储。')}<input type="hidden" name="_csrf" value="${attr(csrf)}"><label class="check switch"><input type="checkbox" name="mailEnabled" ${settings.mailEnabled === 'true' ? 'checked' : ''}> 成功核销后发送邮件通知</label><label>SMTP 主机<input name="smtpHost" value="${attr(settings.smtpHost || '')}" placeholder="smtp.example.com"></label><div class="form-grid"><label>端口<input name="smtpPort" type="number" value="${attr(settings.smtpPort || '465')}"></label><label>加密方式<select name="smtpSecure"><option value="true" ${settings.smtpSecure === 'true' ? 'selected' : ''}>SSL/TLS</option><option value="false" ${settings.smtpSecure === 'false' ? 'selected' : ''}>STARTTLS</option></select></label></div><label>SMTP 用户名<input name="smtpUser" value="${attr(settings.smtpUser || '')}"></label><label>SMTP 专用密码<input name="smtpPassword" type="password" placeholder="留空则保持当前密码"></label><label>发件人<input name="mailFrom" value="${attr(settings.mailFrom || '')}" placeholder="QNQupon <no-reply@example.com>"></label><label>通知收件人（每行一个）<textarea name="mailRecipients">${esc(settings.mailRecipients || '')}</textarea></label><div class="actions"><button class="primary">保存邮件设置</button><button class="secondary" type="submit" form="settings-test-mail" data-confirm="将向「通知收件人」发送一封测试邮件（内容已注明可忽略），确认发送？">发送测试邮件</button></div></form><form id="settings-test-mail" method="post" action="/admin/settings/test-email"><input type="hidden" name="_csrf" value="${attr(csrf)}"></form><section class="panel"><h2>数据维护与备份</h2>${panelHelp(`到期或用尽满 ${recycleDays} 天的券自动移入回收站，保留 ${purgeDays} 天后永久删除。`, `确认码保留 ${verifyHours} 小时可查；概览的临期提醒为 ${expiringDays} 天。`, '保存后立即生效。')}<form class="form-panel" method="post" action="/admin/settings/retention"><input type="hidden" name="_csrf" value="${attr(csrf)}"><div class="form-grid"><label>回收站静置天数<input name="recycleDays" type="number" min="1" max="365" value="${recycleDays}"></label><label>回收站保留天数<input name="purgeDays" type="number" min="1" max="365" value="${purgeDays}"></label><label>确认码可查小时数<input name="verifyHours" type="number" min="1" max="720" value="${verifyHours}"></label><label>概览临期提醒天数<input name="expiringDays" type="number" min="1" max="365" value="${expiringDays}"></label></div><button class="secondary">保存保留策略</button></form><form id="settings-backup" class="form-panel" method="post" action="/admin/settings/backup"><input type="hidden" name="_csrf" value="${attr(csrf)}"><label>本地备份保留份数<input name="backupKeep" type="number" min="1" max="365" value="${attr(settings.backupKeep || '30')}"></label></form><form id="settings-maintenance" method="post" action="/admin/maintenance/run"><input type="hidden" name="_csrf" value="${attr(csrf)}"></form><div class="actions"><button class="secondary" type="submit" form="settings-backup">保存备份策略</button><button class="danger" type="submit" form="settings-maintenance">立即执行清理与备份</button></div></section><section class="panel"><h2>券面展示</h2>${panelHelp('控制客人核销页与券面 PNG 标题是否带「券码名」（如“张三的券”）；单张券码可在其详情页覆写。', '字体按名称引用，渲染机未安装则回退系统无衬线体；品牌行 QNQupon · 券能行 为固定字标，不随后台字体变化。')}<form class="form-panel" method="post" action="/admin/settings/display"><input type="hidden" name="_csrf" value="${attr(csrf)}"><label class="check switch"><input type="checkbox" name="showCodeName" ${settings.showCodeName === 'false' ? '' : 'checked'}> 在 PNG 与核销页显示券码名</label><div class="form-grid"><label>券面 PNG 正文字体<select name="pngFont"><option value="source" ${settings.pngFont === 'misans' || settings.pngFont === 'harmonyos' ? '' : 'selected'}>思源黑体（默认）</option><option value="misans" ${settings.pngFont === 'misans' ? 'selected' : ''}>MiSans</option><option value="harmonyos" ${settings.pngFont === 'harmonyos' ? 'selected' : ''}>HarmonyOS Sans SC</option></select></label></div><label class="check switch"><input type="checkbox" name="pngDark" ${settings.pngDark === 'true' ? 'checked' : ''}> 券面 PNG 使用深色版面（默认浅色）</label><button class="primary">保存展示设置</button></form></section>`, { admin: true, user: { ...user, csrf }, flash });
}

/**
 * 操作审计页（仅超管）：只记状态变更与安全事件；读取类行为由反向代理访问日志负责。
 * 筛选：类别（action 第一段前缀）+ 操作人 + 北京时间日期范围；20 条/页，翻页保留筛选。
 */
export function auditPage({ user, logs = [], prefixes = [], users = [], filters = {}, page = 1, pages = 1, total = 0, csrf, flash }) {
  const active = { action: String(filters.action ?? ''), actor: String(filters.actor ?? ''), from: String(filters.from ?? ''), to: String(filters.to ?? '') };
  const search = (pageNo) => {
    const params = new URLSearchParams();
    if (active.action) params.set('action', active.action);
    if (active.actor) params.set('actor', active.actor);
    if (active.from) params.set('from', active.from);
    if (active.to) params.set('to', active.to);
    if (pageNo > 1) params.set('page', String(pageNo));
    const text = params.toString();
    return text ? `/admin/audit?${text}` : '/admin/audit';
  };
  const actionLabels = { auth: '登录认证', user: '账号管理', coupon: '券面', code: '券码', preset: '预设', settings: '系统设置', system: '系统', maintenance: '维护' };
  const actionOptions = prefixes.map((p) => `<option value="${attr(p)}"${active.action === p ? ' selected' : ''}>${esc(actionLabels[p] || p)}</option>`).join('');
  const actorOptions = users.map((u) => `<option value="${u.id}"${active.actor === String(u.id) ? ' selected' : ''}>${esc(u.username)}${u.role === 'super_admin' ? '（超管）' : ''}${u.active ? '' : '（已停用）'}</option>`).join('');
  const filterForm = `<form method="get" action="/admin/audit" class="popover-form"><label>类别<select name="action"><option value="">全部类别</option>${actionOptions}</select></label><label>账号<select name="actor"><option value="">全部账号</option>${actorOptions}</select></label><label>开始日期<input type="date" name="from" value="${attr(active.from)}"></label><label>截止日期<input type="date" name="to" value="${attr(active.to)}"></label><div class="actions"><button class="primary" type="submit">查询</button><a class="secondary button" href="/admin/audit">重置</a></div></form>`;
  // 与核销记录统一：筛选平时收起不占版面，标题行右侧一个按钮点开；已选条件数用角标提示
  const filterCount = [active.action, active.actor, active.from, active.to].filter(Boolean).length;
  const filterButton = `<div class="popover-wrap"><button type="button" class="secondary" data-popover-toggle aria-expanded="false" aria-controls="audit-filter">筛选${filterCount ? `<span class="popover-count">${filterCount}</span>` : ''}</button><div class="popover" id="audit-filter" hidden>${filterForm}</div></div>`;
  // 来源 IP 挪到时间那一行右侧：IPv4 本来就短，原样显示；IPv6 这类长地址中段省略，
  // 完整值放 data-full，悬浮或点按（focus）时用纯 CSS 气泡弹出。
  const shortIp = (value) => {
    const raw = value || '—';
    if (raw.length <= 18) return esc(raw);
    return `<button type="button" class="audit-ip" data-full="${attr(raw)}">${esc(`${raw.slice(0, 10)}…${raw.slice(-6)}`)}</button>`;
  };
  const rowHtml = logs.map((entry) => `<tr class="audit-row"><td data-label="">${esc(beijingTime(entry.created_at))}</td><td data-label="">${esc(entry.username || '系统')}</td><td data-label="做了">${esc(entry.action)}</td><td data-label="对">${esc(`${entry.target_type} ${entry.target_id || ''}`)}</td><td data-priority="low" data-label="来源 IP">${shortIp(entry.source_ip)}</td></tr>`).join('') || '<tr class="empty-row"><td colspan="5" class="empty">没有符合条件的记录</td></tr>';
  const pager = total > 0 ? `<div class="actions"><span class="muted">共 ${total} 条 · 第 ${page} / ${pages} 页</span>${page > 1 ? `<a class="button secondary" href="${search(page - 1)}">上一页</a>` : ''}${page < pages ? `<a class="button secondary" href="${search(page + 1)}">下一页</a>` : ''}</div>` : '';
  return shell('操作审计', `<section class="page-head"><div class="page-title"><h1>操作审计</h1><p>只记状态变更与安全事件，不记 Token。</p></div><div class="actions">${filterButton}</div></section><section class="panel"><h2>记录（${total} 条）</h2>${panelHelp('页面访问等读取行为由反向代理的访问日志记录。')}<table><thead><tr><th>时间</th><th>账号</th><th>操作</th><th>对象</th><th>来源 IP</th></tr></thead><tbody>${rowHtml}</tbody></table>${pager}</section>`, { admin: true, user: { ...user, csrf }, flash });
}

export function profilePage({ user, csrf, flash, passwordMin = 12 }) {
  return shell('个人账号', `<section class="page-head"><div class="page-title">${backArrow('/admin', '返回概览')}<h1>个人账号</h1><p>修改后将退出当前会话，请使用新凭据重新登录。</p></div></section><section class="detail-grid"><form class="panel form-panel" method="post" action="/admin/profile/username"><h2>修改用户名</h2><input type="hidden" name="_csrf" value="${attr(csrf)}"><label>新用户名<input name="username" required minlength="3" maxlength="50" value="${attr(user.username)}"></label><label>当前密码<input name="password" type="password" required></label><button class="secondary">保存用户名</button></form><form class="panel form-panel" method="post" action="/admin/profile/password"><h2>修改密码</h2><input type="hidden" name="_csrf" value="${attr(csrf)}"><label>当前密码<input name="currentPassword" type="password" required></label><label>新密码<input name="newPassword" type="password" minlength="${passwordMin}" required></label><label>确认新密码<input name="confirmPassword" type="password" minlength="${passwordMin}" required></label><button class="primary">修改密码</button></form></section>`, { admin: true, user: { ...user, csrf }, flash });
}
