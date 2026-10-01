// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 QNLanYang (全能岚漾)

// 二维码生成的唯一实现：后台页面上的核销/分享二维码、优惠券 PNG 里自带的二维码，全部走这里。
// 中心叠 favicon：图标 6 个色块宽，白底衬垫每边 0.5 个色块 → 整体恰好 7 个色块宽（奇数），
// 居中后左右边缘正好落在模块边界上，不会压出半格；遮住面积约 4%，纠错 M 余量充足。
// 用法与 QRCode.toBuffer 一致（errorCorrectionLevel / margin / width / color），因此可直接替换导入。
import QRCodeLib from 'qrcode';
import sharp from 'sharp';
import { readFileSync } from 'node:fs';

const ICON_MODULES = 6;   // 图标宽度（色块数）
const PAD_MODULES = 0.5;  // 衬垫：每边这么多个色块
const FAVICON = readFileSync(new URL('../public/favicon.svg', import.meta.url));

async function toBuffer(text, options = {}) {
  const { errorCorrectionLevel = 'M', margin = 1, width = 480, color } = options;
  const png = await QRCodeLib.toBuffer(text, { errorCorrectionLevel, margin, width, color });
  const symbol = QRCodeLib.create(text, { errorCorrectionLevel }).modules.size;
  const unit = width / (symbol + margin * 2); // 单个色块的像素
  const iconPx = Math.max(8, Math.round(unit * ICON_MODULES));
  const platePx = Math.round(unit * (ICON_MODULES + PAD_MODULES * 2));
  const plate = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${platePx}" height="${platePx}"><rect width="${platePx}" height="${platePx}" rx="${Math.round(unit)}" fill="#ffffff"/></svg>`);
  const icon = await sharp(FAVICON).resize(iconPx, iconPx, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  return sharp(png).composite([{ input: plate, gravity: 'center' }, { input: icon, gravity: 'center' }]).png().toBuffer();
}

export default { toBuffer };
export { toBuffer as qrPng };
