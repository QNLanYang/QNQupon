// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 QNLanYang (全能岚漾)

import QRCode from 'qrcode';
import sharp from 'sharp';
import brandLogo from './brand-logo.js';

const escapeXml = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));

// 正文字体栈（服务设置可选，仅引用字体名、不打包字体文件）；缺字体时回退系统 sans-serif。
// 品牌行不在此列——它是 brand-logo.js 的 SVG 轮廓，任何机器渲染一致。
const FONT_STACKS = {
  source: '"Source Han Sans SC","Source Han Sans SC VF","Noto Sans CJK SC","Noto Sans SC",sans-serif',
  misans: '"MiSans","MiSans VF","MiSans CN",sans-serif',
  harmonyos: '"HarmonyOS Sans SC","HarmonyOS Sans SC VF","HarmonyOS Sans",sans-serif'
};
const fontStack = (key) => (FONT_STACKS[key] || FONT_STACKS.source).replace(/"/g, '&quot;');

// 按可用宽度换行（CJK 按 1 个字宽、ASCII 按半个字宽估算），并限制行数。
function wrap(value, width, maxRows = Infinity) {
  const rows = [];
  let row = '';
  let used = 0;
  for (const char of Array.from(String(value || ''))) {
    const cost = /[\x00-\xff]/.test(char) ? 0.5 : 1;
    if (used + cost > width) {
      rows.push(row);
      row = '';
      used = 0;
      if (rows.length >= maxRows) break;
    }
    row += char;
    used += cost;
  }
  if (row && rows.length < maxRows) rows.push(row);
  if (rows.length === maxRows && Array.from(String(value || '')).length > rows.join('').length) {
    rows[rows.length - 1] = rows[rows.length - 1].replace(/.$/, '') + '…';
  }
  return rows;
}

const text = (content, x, y, size, color, extra = '') => `<text x="${x}" y="${y}" font-size="${size}" fill="${color}"${extra}>${escapeXml(content)}</text>`;

// 浅色（默认导出）与深色（服务设置开关，非默认）两套配色。
const THEMES = {
  light: {
    bg: 'url(#bgLight)',
    deco: '<circle cx="1000" cy="60" r="240" fill="#ff6b5a" opacity=".19"/><circle cx="80" cy="1840" r="220" fill="#ff6b5a" opacity=".15"/>',
    card: '#fffdf9', cardFx: 'url(#shadow)',
    band: '#f2604f', bandText: '#ffffff', bandCode: 'rgba(255,255,255,.82)',
    title: '#172033', codename: '#8a94a6', offer: '#ef554f', meta: '#5c6678', note: '#697386',
    divider: '#f0ded4', hint: '#3f4a5c', qrBorder: '#f0ded4', brand: '#ffffff', brandOpacity: '.92'
  },
  dark: {
    bg: '#0d0d0f',
    deco: '<circle cx="1000" cy="60" r="240" fill="#ff6b5a" opacity=".10"/><circle cx="80" cy="1840" r="220" fill="#ff6b5a" opacity=".08"/>',
    // 深色卡片：无描边，改用与浅色阴影对应的白色辉光
    card: '#16171c', cardFx: 'url(#glow)',
    band: '#c2453e', bandText: '#ffffff', bandCode: 'rgba(255,255,255,.8)',
    title: '#f5f5f7', codename: '#7b8494', offer: '#ff6b5a', meta: '#a7b0bf', note: '#7d8798',
    divider: '#2a2c33', hint: '#aab3c2', qrBorder: '#2a2c33', brand: '#ffffff', brandOpacity: '.55'
  }
};

// 版面常量（1080×1920，9:16；数值经 temp/preview-png-layout-tuner.mjs 逐项目视标定）
const CARD = { x: 56, y: 56, w: 968, h: 1724, rx: 52 };
const CARD_BOTTOM = CARD.y + CARD.h; // 1780
const LEFT = 130;
const RIGHT = 950;
const CENTER = 540;
const AVAIL = RIGHT - LEFT; // 820
const BAND_H = 220; // 顶部色带：卡片顶 → 276，券面名与券码名写在带内
const NAME_FACE = 70; // 券面名字号（原 56 的 125%）
const NAME_CODE = 50;
const NAME_FACE_MIN = 40;
const NAME_CODE_MIN = 32;
const NAME_GAP = 30; // 券面名与券码名同行的间距
const NAME_LINE_GAP = 18; // 名称分两行时的行距
// 文字按 em 盒估算上下缘（上缘 -0.82em、下缘 +0.18em），用于把名称整块在色带内垂直居中
const TEXT_TOP = 0.82;
const TEXT_BOTTOM = 0.18;
const OFFER_SIZE = 76;
const OFFER_LINE = 76;
const OFFER_Y = 420; // 优惠内容首行基线
const QR_SIZE = 500;
const QR_TOP_FLOOR = 516;
const QR_GAP = 60; // 优惠末行与二维码上边的最小间距
const QR_PAD = 16; // 二维码白卡内边距
const QR_RX = 36;
const QR_LABEL_GAP = 40; // 「扫码打开核销页」距二维码下边
const QR_LABEL_SIZE = 26;
const DIVIDER_GAP = 130; // 分割线距二维码下边
const META_GAP = 60; // 首行信息距分割线
const META_SIZE = 34;
const META_LINE = 50;
const NOTES_GAP = 60; // 说明区距最后一行信息
const NOTES_SIZE = 28;
const NOTES_LINE = 36;
const NOTES_MAX_Y = 1680; // 说明区下限，超出截断，避免压到底部提示
const HINT_Y = 1740;
const HINT_SIZE = 31;
const BRAND_Y = 1866;
const BRAND_SIZE = 50;

/**
 * 版面（1080×1920，9:16）：
 *   卡片 x56 y56 w968 h1724（顶边与侧边同距 56，底 1780，下方留给品牌标识）
 *   内容 LEFT=130 / RIGHT=950 / CENTER=540
 *   券面名+券码名写在顶部色带内（默认同行放大，放不下分两行，单独仍放不下缩小字号），
 *   整块按 em 盒中线在色带内垂直居中——单行与双行的中线落在同一位置
 *   优惠 76px 居中、首行基线 420；二维码 500×500，top = clamp(516, 优惠末行+60)
 *   分割线 = 二维码底+130，信息 34px/50；说明 28px/36、止于 1680
 *   底部固定提示基线 1740；品牌基线 1866（SVG 轮廓）
 */
export async function renderCouponPng(coupon, publicUrl, options = {}) {
  const theme = options.dark ? THEMES.dark : THEMES.light;
  const FONT = fontStack(options.font);
  // 中心叠 favicon（白底圆衬垫），与后台页面上的二维码观感一致；纠错级别用 H，
  // 遮住中间约 20% 也不影响识别。favicon 按模块路径读取，不依赖进程的工作目录。
  const qrRaw = await QRCode.toBuffer(publicUrl, { errorCorrectionLevel: 'H', margin: 1, width: 480, color: { dark: '#101828', light: '#FFFFFFFF' } });
  const { readFileSync } = await import('node:fs');
  const mark = 96;
  const ring = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${mark + 28}" height="${mark + 28}"><circle cx="${(mark + 28) / 2}" cy="${(mark + 28) / 2}" r="${(mark + 28) / 2}" fill="#ffffff"/></svg>`);
  const logo = await sharp(readFileSync(new URL('../public/favicon.svg', import.meta.url))).resize(mark, mark, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const qr = await sharp(qrRaw).composite([{ input: ring, gravity: 'center' }, { input: logo, gravity: 'center' }]).png().toBuffer();
  const body = [];

  // 估宽（与 wrap 同口径：CJK 1 字宽、ASCII 半字宽）
  const estW = (value, size) => Array.from(String(value || '')).reduce((w, ch) => w + (/[\x00-\xff]/.test(ch) ? 0.5 : 1) * size, 0);

  // 券面名 + 券码名自适应：默认一行（放大字号），放不下则两行分开，
  // 单独一行仍放不下则缩小字号（到下限后仍超宽则换行省略）。
  const face = String(coupon.face_name || '');
  const code = coupon.displayCodeName === false || !coupon.name ? '' : String(coupon.name);
  const rows = [];

  if (face && code && estW(face, NAME_FACE) + NAME_GAP + estW(code, NAME_CODE) <= AVAIL) {
    rows.push({ size: NAME_FACE, spans: [
      { text: face, size: NAME_FACE, weight: '700', fill: theme.bandText },
      { text: code, size: NAME_CODE, weight: '400', fill: theme.bandCode, dx: NAME_GAP }
    ] });
  } else {
    const put = (value, size, min, weight, fill) => {
      let s = size;
      while (s > min && estW(value, s) > AVAIL) s -= 2;
      if (estW(value, s) <= AVAIL) {
        rows.push({ size: s, spans: [{ text: value, size: s, weight, fill }] });
      } else {
        for (const row of wrap(value, Math.floor(AVAIL / s), 2)) {
          rows.push({ size: s, spans: [{ text: row, size: s, weight, fill }] });
        }
      }
    };
    if (face) put(face, NAME_FACE, NAME_FACE_MIN, '700', theme.bandText);
    if (code) put(code, NAME_CODE, NAME_CODE_MIN, '400', theme.bandCode);
  }

  // 顶部色带（先画色块，再画名称）+ 名称整块垂直居中于色带
  if (rows.length) {
    body.push(`<g clip-path="url(#cardClip)"><rect x="${CARD.x}" y="${CARD.y}" width="${CARD.w}" height="${BAND_H}" fill="${theme.band}"/></g>`);
    let advance = 0;
    for (let i = 0; i < rows.length - 1; i += 1) advance += rows[i].size + NAME_LINE_GAP;
    let y = CARD.y + BAND_H / 2 - (advance + TEXT_BOTTOM * rows[rows.length - 1].size - TEXT_TOP * rows[0].size) / 2;
    for (const row of rows) {
      const spans = row.spans.map((s) => `<tspan font-size="${s.size}" font-weight="${s.weight}" fill="${s.fill}"${s.dx ? ` dx="${s.dx}"` : ''}>${escapeXml(s.text)}</tspan>`).join('');
      body.push(`<text x="${LEFT}" y="${y}">${spans}</text>`);
      y += row.size + NAME_LINE_GAP;
    }
  }

  // 优惠内容居中大字（最多 3 行）
  let y = OFFER_Y;
  let offerEnd = y;
  for (const row of wrap(coupon.offer_text, Math.floor(AVAIL / OFFER_SIZE), 3)) {
    body.push(text(row, CENTER, y, OFFER_SIZE, theme.offer, ' text-anchor="middle" font-weight="800"'));
    y += OFFER_LINE;
    offerEnd = y - OFFER_LINE;
  }

  // 二维码：上方内容变长时顺延避让
  const qrTop = Math.max(offerEnd + QR_GAP, QR_TOP_FLOOR);
  const qrX = CENTER - QR_SIZE / 2;
  body.push(`<rect x="${qrX}" y="${qrTop}" width="${QR_SIZE}" height="${QR_SIZE}" rx="${QR_RX}" fill="white" stroke="${theme.qrBorder}" stroke-width="2"/>`);
  body.push(`<image href="data:image/png;base64,${qr.toString('base64')}" x="${qrX + QR_PAD}" y="${qrTop + QR_PAD}" width="${QR_SIZE - QR_PAD * 2}" height="${QR_SIZE - QR_PAD * 2}"/>`);
  body.push(text('扫码打开核销页', CENTER, qrTop + QR_SIZE + QR_LABEL_GAP, QR_LABEL_SIZE, theme.note, ' text-anchor="middle"'));

  // 分隔线 + 次数/日期（左对齐全宽；标签统一 4 字）
  let y2 = qrTop + QR_SIZE + DIVIDER_GAP;
  body.push(`<line x1="${LEFT}" x2="${RIGHT}" y1="${y2}" y2="${y2}" stroke="${theme.divider}" stroke-width="3"/>`);
  y2 += META_GAP;
  const meta = [`可用次数：${coupon.max_uses} 次`];
  if (coupon.starts_on) meta.push(`生效日期：${coupon.starts_on}`); // 起始日期留空时不显示、也不写“即日起”
  meta.push(coupon.expires_on ? `有效期至：${coupon.expires_on} 24:00` : '有效期：长期有效');
  for (const row of meta) { body.push(text(row, LEFT, y2, META_SIZE, theme.meta)); y2 += META_LINE; }

  // 说明区（左对齐全宽换行，止于 NOTES_MAX_Y，超出截断）
  y2 += NOTES_GAP;
  const notes = [];
  if (coupon.instructions) notes.push(`使用说明：${coupon.instructions}`);
  if (coupon.store_text) notes.push(coupon.store_text);
  let clipped = false;
  for (const value of notes) {
    for (const row of wrap(value, Math.floor(AVAIL / NOTES_SIZE), 12)) {
      if (y2 > NOTES_MAX_Y) { clipped = true; break; }
      body.push(text(row, LEFT, y2, NOTES_SIZE, theme.note));
      y2 += NOTES_LINE;
    }
    if (clipped) break;
    y2 += 8;
  }
  if (clipped) {
    const last = body.pop();
    body.push(last.replace(/<\/text>$/, '…</text>'));
  }

  // 底部单行固定提示：居中，贴近卡片底边（卡片底 1780，基线 1740 留 40px）
  body.push(text('请向店员出示此券与二维码　由店员扫码亲自核销视为有效', CENTER, HINT_Y, HINT_SIZE, theme.hint, ' text-anchor="middle" font-weight="600"'));

  // 卡片外、图片最底部的品牌标识：SVG 轮廓路径（零字体依赖）
  const brandScale = BRAND_SIZE / 100;
  const brandPaths = brandLogo.brand.parts.map((part) => `<path d="${part.d}"/>`).join('');
  body.push(`<g transform="translate(${CENTER - (brandLogo.brand.width * brandScale) / 2} ${BRAND_Y}) scale(${brandScale})" fill="${theme.brand}" opacity="${theme.brandOpacity}">${brandPaths}</g>`);

  const defs = `<defs><linearGradient id="bgLight" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff4df"/><stop offset=".42" stop-color="#ffe0a3"/><stop offset="1" stop-color="#ffad74"/></linearGradient><filter id="shadow" x="-10%" y="-10%" width="120%" height="120%"><feDropShadow dx="0" dy="20" stdDeviation="24" flood-opacity=".16"/></filter><filter id="glow" x="-10%" y="-10%" width="120%" height="120%"><feDropShadow dx="0" dy="0" stdDeviation="30" flood-color="#ffffff" flood-opacity=".14"/></filter><clipPath id="cardClip"><rect x="${CARD.x}" y="${CARD.y}" width="${CARD.w}" height="${CARD.h}" rx="${CARD.rx}"/></clipPath></defs>`;

  const svg = `<svg width="1080" height="1920" viewBox="0 0 1080 1920" xmlns="http://www.w3.org/2000/svg">${defs}<rect width="1080" height="1920" fill="${theme.bg}"/>${theme.deco}<rect x="${CARD.x}" y="${CARD.y}" width="${CARD.w}" height="${CARD.h}" rx="${CARD.rx}" fill="${theme.card}" filter="${theme.cardFx}"/><g font-family="${FONT}">${body.join('')}</g></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
