// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 QNLanYang (全能岚漾)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { renderCouponPng } from '../src/coupon-image.js';

test('券面 PNG 为 1080x1920 且可重复生成', async () => {
  const coupon = {
    face_name: '示例朋友专用', name: '张三', offer_text: '免费冰峰 × 5', description: '仅限朋友使用',
    instructions: '出示本券给店员，确认后由店员点击核销。', store_text: '示例总店 · 营业时间 10:00-22:00',
    starts_on: null, expires_on: '2026-10-02', max_uses: 5, used_count: 2
  };
  const png = await renderCouponPng(coupon, 'http://127.0.0.1:3100/r/' + 'A'.repeat(43));
  assert.ok(png.length > 10_000, `PNG too small: ${png.length}`);
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'PNG 魔数');
  // 宽高在 IHDR 中（偏移 16/20，大端）
  assert.equal(png.readUInt32BE(16), 1080);
  assert.equal(png.readUInt32BE(20), 1920);
});

test('券面支持缺省字段（空券面名/长券码名/无日期截断）', async () => {
  const coupon = {
    face_name: null, name: '很长很长的券名'.repeat(10), offer_text: '优惠', description: null,
    instructions: null, store_text: null, starts_on: null, expires_on: null, max_uses: 1, used_count: 0
  };
  const png = await renderCouponPng(coupon, 'http://127.0.0.1:3100/r/' + 'B'.repeat(43));
  assert.equal(png.readUInt32BE(16), 1080);
  assert.equal(png.readUInt32BE(20), 1920);
});

test('深色版面与字体选项可渲染（服务设置项）', async () => {
  const coupon = { face_name: '夏日冰饮满减券', name: '张三', offer_text: '满 100 减 20', max_uses: 1, expires_on: '2026-12-31' };
  const dark = await renderCouponPng(coupon, 'http://127.0.0.1:3100/r/' + 'C'.repeat(43), { dark: true, font: 'misans' });
  assert.equal(dark.readUInt32BE(16), 1080);
  assert.equal(dark.readUInt32BE(20), 1920);
  const light = await renderCouponPng(coupon, 'http://127.0.0.1:3100/r/' + 'D'.repeat(43), { font: 'not-a-real-font' });
  assert.equal(light.readUInt32BE(20), 1920, '未知字体回退默认栈');
});

test('券面名称在顶部色带内垂直居中：单行与双行的中线一致', async () => {
  const base = { offer_text: '免费冰峰', max_uses: 1, starts_on: null, expires_on: '2026-10-15', instructions: null, store_text: null };
  const one = await renderCouponPng({ ...base, face_name: '开业优惠', name: '开业优惠 #2' }, 'http://127.0.0.1:3100/r/' + 'L'.repeat(43));
  const two = await renderCouponPng({ ...base, face_name: '超级无敌大杯招牌珍珠奶茶第二杯半价', name: '长券码名称测试用例' }, 'http://127.0.0.1:3100/r/' + 'M'.repeat(43));
  // 量色带内文字像素的上下沿中线：色带底色是红，名称是白色/半透明白，按“亮且偏白”筛选
  const bandTextCenter = async (png) => {
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    let top = Infinity;
    let bottom = -1;
    for (let y = 56; y < 276; y += 1) {
      for (let x = 130; x < 950; x += 1) {
        const i = (y * info.width + x) * info.channels;
        if (data[i] > 235 && data[i + 1] > 200 && data[i + 2] > 200) {
          if (y < top) top = y;
          if (y > bottom) bottom = y;
        }
      }
    }
    return (top + bottom) / 2;
  };
  const singleLine = await bandTextCenter(one);
  const twoLines = await bandTextCenter(two);
  assert.ok(Number.isFinite(singleLine) && Number.isFinite(twoLines), '两种名称都应测得色带内文字像素');
  assert.ok(Math.abs(singleLine - twoLines) <= 8, `单行中线 ${singleLine} 与双行中线 ${twoLines} 应基本重合`);
});
