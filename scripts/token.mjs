// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 QNLanYang (全能岚漾)

// 开发辅助：打印指定券码的原始 Token（需要 .env 中的 APP_ENCRYPTION_KEY）。
// 用法：node scripts/token.mjs cd-3Kd9xWm2QaP7   （券码 ID，见后台券码详情页）
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import D from 'better-sqlite3';
import { decrypt } from '../src/security.js';
import '../src/config.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const id = String(process.argv[2] || '');
if (!/^cd-[A-Za-z0-9]{12}$/.test(id)) {
  console.error('用法：node scripts/token.mjs <cd-xxxxxxxxxxxx>');
  process.exit(1);
}
const db = new D(process.env.DATABASE_PATH || join(root, 'data', 'qnqupon.db'));
const row = db.prepare('select token_ciphertext from voucher_codes where id=?').get(id);
if (!row) {
  console.error(`未找到券码 ${id}`);
  process.exit(1);
}
console.log(decrypt(row.token_ciphertext, process.env.APP_ENCRYPTION_KEY));
