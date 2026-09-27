// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 QNLanYang (全能岚漾)

// 开发辅助：删库重建后恢复测试账号与示例数据。仅用于本地开发，生产环境不要运行。
// 用法：node scripts/seed-dev.mjs
import { createDb } from '../src/db.js';
import { hashPassword } from '../src/security.js';
import { config } from '../src/config.js';

const db = createDb(config);

const accounts = [
  ['superadmin', 'Test-password-2026', 'super_admin'],
  ['bizadmin', 'Biz-password-2026', 'business_admin'],
  ['biz2', 'Reset-password-2026', 'business_admin']
];
for (const [username, password, role] of accounts) {
  if (!db.userByName(username)) db.createUser(username, hashPassword(password), role);
}
console.log(`账号：${accounts.map(([name]) => name).join(' / ')}`);

// 只有完全空库才铺示例数据，避免重复执行覆盖手工内容
const faceCount = db.raw.prepare('SELECT COUNT(*) AS n FROM coupons').get().n;
if (faceCount === 0) {
  const actor = db.userByName('superadmin').id;
  const demo = db.createCoupon({
    name: '确认码格式券', offerText: '立减 10 元', maxUses: 3,
    instructions: '出示本券给店员，确认后由店员点击核销。',
    storeText: '示例总店 · 营业时间 10:00-22:00'
  }, actor);
  db.createCode(demo.id, '张三的券', '张三 138****', actor);
  db.createCode(demo.id, '李四的券', '李四 139****', actor);

  const general = db.createCoupon({
    name: '新客立减', offerText: '首单减 5 元', maxUses: 1,
    instructions: '把二维码出示给店员。'
  }, actor);
  db.createCode(general.id, '门店码', null, actor);

  const gone = db.createCoupon({ name: '已下架活动', offerText: '买一送一', maxUses: 1 }, actor);
  db.setCouponStatus(gone.id, 'recycled', actor, null);
  console.log('已创建 3 张示例券面（含 1 张回收站）与 3 张券码');
} else {
  console.log(`已有 ${faceCount} 张券面，跳过示例数据`);
}
