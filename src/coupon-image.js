// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 QNLanYang (全能岚漾)

import QRCode from 'qrcode';
import sharp from 'sharp';

const escapeXml = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));
const FONT = 'Microsoft YaHei, Noto Sans CJK SC, sans-serif';

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

/**
 * 版面规则：文字全部写在左侧/上部，二维码固定在右下角（x≥655），
 * 两块区域互不重叠；文字块超过可用高度时截断，绝不压到二维码上。
 */
export async function renderCouponPng(coupon, publicUrl) {
  const qr = await QRCode.toBuffer(publicUrl, { errorCorrectionLevel: 'M', margin: 1, width: 400, color: { dark: '#101828', light: '#FFFFFFFF' } });
  const body = [];
  let y = 400;

  // 券名：默认第一行“券面名 - 券码名”（最多 3 行）；displayCodeName === false 时只放券面名
  const nameText = coupon.displayCodeName === false ? String(coupon.face_name || '') : [coupon.face_name, coupon.name].filter(Boolean).join(' - ');
  const nameRows = wrap(nameText, 14, 3);
  for (const row of nameRows) { body.push(text(row, 130, y, 58, '#172033', ' font-weight="700"')); y += 76; }

  // 优惠内容（最多 3 行）
  y += 14;
  const offerRows = wrap(coupon.offer_text, 12, 3);
  for (const row of offerRows) { body.push(text(row, 130, y, 72, '#ef554f', ' font-weight="700"')); y += 92; }

  // 分隔线 + 关键信息
  y = Math.min(Math.max(y + 46, 780), 940);
  body.push(`<line x1="130" x2="950" y1="${y}" y2="${y}" stroke="#f0ded4" stroke-width="3"/>`);
  y += 52;
  const meta = [`总使用次数：${coupon.max_uses} 次`];
  if (coupon.starts_on) meta.push(`生效日期：${coupon.starts_on}`); // 起始日期留空时不显示、也不写“即日起”
  meta.push(coupon.expires_on ? `有效期至：${coupon.expires_on} 24:00` : '有效期：长期有效');
  for (const row of meta) { body.push(text(row, 130, y, 30, '#5c6678')); y += 46; }

  // 左下角说明区（x ≤ 620，止于 y = 1400）
  let zy = 1150;
  const GAP = 34;
  const put = (value, size = 23, color = '#697386') => {
    for (const row of wrap(value, 18, 4)) {
      if (zy > 1400) return;
      body.push(text(row, 130, zy, size, color));
      zy += GAP;
    }
  };
  if (coupon.instructions) put(`使用说明：${coupon.instructions}`);
  if (coupon.store_text) put(coupon.store_text);
  if (zy <= 1400 - GAP * 2) {
    put('请向店员出示此二维码', 26, '#172033');
    put('由店员点击“确认核销”后生效', 26, '#172033');
  }

  // 右下角二维码（固定区域，任何文字都不会画进来）
  body.push(`<rect x="655" y="1090" width="300" height="300" rx="22" fill="white" stroke="#f0ded4" stroke-width="2"/>`);
  body.push(`<image href="data:image/png;base64,${qr.toString('base64')}" x="673" y="1108" width="264" height="264"/>`);
  body.push(`<text x="805" y="1432" font-size="26" fill="#697386" text-anchor="middle">扫码打开核销页</text>`);

  const svg = `<svg width="1080" height="1528" viewBox="0 0 1080 1528" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff4df"/><stop offset=".42" stop-color="#ffe0a3"/><stop offset="1" stop-color="#ffad74"/></linearGradient><filter id="shadow"><feDropShadow dx="0" dy="20" stdDeviation="24" flood-opacity=".16"/></filter></defs><rect width="1080" height="1528" fill="url(#bg)"/><circle cx="1000" cy="60" r="240" fill="#ff6b5a" opacity=".19"/><circle cx="80" cy="1470" r="220" fill="#ff6b5a" opacity=".15"/><rect x="70" y="72" width="940" height="1384" rx="52" fill="#fffdf9" filter="url(#shadow)"/><rect x="70" y="72" width="940" height="242" rx="52" fill="#ff6b5a"/><path d="M70 262 H1010 V314 H70z" fill="#ff6b5a"/><text font-family="${FONT}" x="134" y="172" font-size="48" font-weight="700" fill="white">QNQupon · 专属优惠</text><text font-family="${FONT}" x="134" y="235" font-size="27" fill="#fff2eb">请向店员出示此券二维码</text><g font-family="${FONT}">${body.join('')}</g></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
