// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 QNLanYang (全能岚漾)

// 开发辅助：执行一条只读 SELECT 并输出 JSON。
// 用法：node scripts/sqlite.mjs "SELECT id, name FROM coupons"
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import D from 'better-sqlite3';
import '../src/config.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = process.argv[2];
if (!sql || !/^\s*select/i.test(sql)) {
  console.error('仅允许 SELECT 语句。用法：node scripts/sqlite.mjs "<SELECT ...>"');
  process.exit(1);
}
const db = new D(process.env.DATABASE_PATH || join(root, 'data', 'qnqupon.db'), { readonly: true });
console.log(JSON.stringify(db.prepare(sql).all()));
