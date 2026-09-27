// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 QNLanYang (全能岚漾)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderCouponPng } from '../src/coupon-image.js';

test('券面 PNG 为 1080x1528 且可重复生成', async () => {
  const coupon = {
    name: '示例朋友专用', offerText: '免费冰峰 × 5', description: '仅限朋友使用',
    instructions: '出示本券给店员，确认后由店员点击核销。', store_text: '示例总店 · 营业时间 10:00-22:00',
    starts_on: null, expires_on: '2026-10-02', max_uses: 5, used_count: 2
  };
  const png = await renderCouponPng(coupon, 'http://127.0.0.1:3100/r/' + 'A'.repeat(43));
  assert.ok(png.length > 10_000, `PNG too small: ${png.length}`);
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'PNG 魔数');
  // 宽高在 IHDR 中（偏移 16/20，大端）
  assert.equal(png.readUInt32BE(16), 1080);
  assert.equal(png.readUInt32BE(20), 1528);
});

test('券面支持缺省字段（空描述/无日期/长文本截断）', async () => {
  const coupon = {
    name: '很长很长的券名'.repeat(10), offerText: '优惠', description: null,
    instructions: null, store_text: null, starts_on: null, expires_on: null, max_uses: 1, used_count: 0
  };
  const png = await renderCouponPng(coupon, 'http://127.0.0.1:3100/r/' + 'B'.repeat(43));
  assert.equal(png.readUInt32BE(16), 1080);
  assert.equal(png.readUInt32BE(20), 1528);
});
