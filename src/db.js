// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 QNLanYang (全能岚漾)

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { decrypt, encrypt, randomCode, randomId, randomToken, sha256 } from './security.js';

const now = () => new Date().toISOString();

export function chinaDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date);
}

export function createDb(config) {
  mkdirSync(dirname(config.databasePath), { recursive: true });
  const db = new Database(config.databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('super_admin','business_admin')),
      active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      last_login_at TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      csrf_hash TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS presets (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, instructions TEXT, store_text TEXT,
      active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY, value TEXT NOT NULL, encrypted INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY, actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT, source_ip TEXT, detail TEXT, created_at TEXT NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS coupons (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL, offer_text TEXT NOT NULL, description TEXT, instructions TEXT, store_text TEXT,
      starts_on TEXT, expires_on TEXT, max_uses INTEGER NOT NULL CHECK(max_uses > 0),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled','recycled')),
      recycled_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, created_by INTEGER REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS coupons_status_dates ON coupons(status, expires_on);
    CREATE TABLE IF NOT EXISTS voucher_codes (
      id TEXT PRIMARY KEY,
      coupon_id INTEGER NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE, token_ciphertext TEXT NOT NULL,
      note TEXT,
      show_name INTEGER, -- 券码名显示覆写：NULL=跟随全局设置，1=始终显示，0=始终隐藏
      used_count INTEGER NOT NULL DEFAULT 0 CHECK(used_count >= 0),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled','recycled')),
      exhausted_at TEXT, recycled_at TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, created_by INTEGER REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS voucher_codes_coupon ON voucher_codes(coupon_id, status);
    CREATE INDEX IF NOT EXISTS voucher_codes_status ON voucher_codes(status, exhausted_at);
    CREATE TABLE IF NOT EXISTS redemptions (
      id INTEGER PRIMARY KEY, coupon_id INTEGER NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
      code_id TEXT REFERENCES voucher_codes(id) ON DELETE CASCADE,
      redeemed_at TEXT NOT NULL, source_ip TEXT, user_agent TEXT, confirmation_code TEXT UNIQUE,
      email_status TEXT NOT NULL DEFAULT 'pending'
    );
    CREATE INDEX IF NOT EXISTS redemptions_coupon_date ON redemptions(coupon_id, redeemed_at DESC);
    CREATE INDEX IF NOT EXISTS redemptions_code_date ON redemptions(code_id, redeemed_at DESC);
    CREATE INDEX IF NOT EXISTS redemptions_date ON redemptions(redeemed_at DESC);
  `);

  // 旧库补列（新库建表即带 show_name）。
  if (!db.prepare('PRAGMA table_info(voucher_codes)').all().some((col) => col.name === 'show_name')) {
    db.exec('ALTER TABLE voucher_codes ADD COLUMN show_name INTEGER');
  }

  // 注意：c.name 必须显式取别名，否则会覆盖券码自己的 v.name。
  const codeColumns = `v.*, c.name AS face_name, c.offer_text, c.description, c.instructions, c.store_text,
    c.starts_on, c.expires_on, c.max_uses, c.id AS face_id, c.status AS face_status, c.recycled_at AS face_recycled_at`;

  const statement = {
    hasSuper: db.prepare("SELECT 1 FROM users WHERE role = 'super_admin' LIMIT 1"),
    findCodeHash: db.prepare(`SELECT ${codeColumns} FROM voucher_codes v JOIN coupons c ON c.id = v.coupon_id WHERE v.token_hash = ?`),
    couponById: db.prepare('SELECT * FROM coupons WHERE id = ?'),
    couponWithCreator: db.prepare('SELECT c.*, u.username AS creator_name FROM coupons c LEFT JOIN users u ON u.id = c.created_by WHERE c.id = ?'),
    codeById: db.prepare(`SELECT ${codeColumns}, u.username AS creator_name FROM voucher_codes v JOIN coupons c ON c.id = v.coupon_id LEFT JOIN users u ON u.id = v.created_by WHERE v.id = ?`),
    codesOfCoupon: db.prepare(`SELECT ${codeColumns} FROM voucher_codes v JOIN coupons c ON c.id = v.coupon_id WHERE v.coupon_id = ? ORDER BY v.status = 'recycled', v.created_at DESC, v.rowid DESC`),
    facesWithStats: db.prepare(`SELECT c.*,
        (SELECT COUNT(*) FROM voucher_codes v WHERE v.coupon_id = c.id AND v.status != 'recycled') AS code_total,
        (SELECT COUNT(*) FROM voucher_codes v WHERE v.coupon_id = c.id AND v.status = 'active' AND v.used_count < c.max_uses) AS code_available,
        (SELECT COALESCE(SUM(v.used_count), 0) FROM voucher_codes v WHERE v.coupon_id = c.id) AS used_total
      FROM coupons c WHERE c.status != 'recycled' ORDER BY c.updated_at DESC`),
    recycledFaces: db.prepare('SELECT * FROM coupons WHERE status = \'recycled\' ORDER BY recycled_at DESC'),
    recycledCodes: db.prepare(`SELECT ${codeColumns} FROM voucher_codes v JOIN coupons c ON c.id = v.coupon_id WHERE v.status = 'recycled' ORDER BY v.recycled_at DESC`),
    redemptionsByCoupon: db.prepare(`SELECT r.*, v.name AS code_name, v.note AS code_note FROM redemptions r LEFT JOIN voucher_codes v ON v.id = r.code_id WHERE r.coupon_id = ? ORDER BY r.redeemed_at DESC LIMIT 50`),
    // 全局核销流水（概览「最近核销」与核销记录总页共用），带券面名与券码名。
    recentRedemptions: db.prepare(`SELECT r.id, r.coupon_id, r.code_id, r.redeemed_at, r.confirmation_code, r.email_status, r.source_ip,
      c.name AS face_name, v.name AS code_name, v.note AS code_note
      FROM redemptions r LEFT JOIN coupons c ON c.id = r.coupon_id LEFT JOIN voucher_codes v ON v.id = r.code_id
      ORDER BY r.redeemed_at DESC, r.id DESC LIMIT ?`),
    // 公开核销凭证查询：只挑展示必需的字段，绝不带来源 IP、User-Agent、备注等后台信息。
    verifyByCode: db.prepare(`SELECT r.confirmation_code, r.redeemed_at, r.email_status, c.name AS face_name, v.name AS code_name
      FROM redemptions r JOIN coupons c ON c.id = r.coupon_id
      LEFT JOIN voucher_codes v ON v.id = r.code_id
      WHERE r.confirmation_code = ? AND r.redeemed_at >= ?`),
    redemptionsByCode: db.prepare('SELECT * FROM redemptions WHERE code_id = ? ORDER BY redeemed_at DESC'),
    activePresets: db.prepare('SELECT * FROM presets WHERE active = 1 ORDER BY name'),
    allPresets: db.prepare('SELECT * FROM presets ORDER BY active DESC, name'),
    users: db.prepare('SELECT id, username, role, active, created_at, updated_at, last_login_at FROM users ORDER BY role DESC, username'),
    setting: db.prepare('SELECT value, encrypted FROM app_settings WHERE key=?'),
    saveSetting: db.prepare(`INSERT INTO app_settings(key,value,encrypted,updated_at) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, encrypted=excluded.encrypted, updated_at=excluded.updated_at`),
    audit: db.prepare('INSERT INTO audit_log(actor_id,action,target_type,target_id,source_ip,detail,created_at) VALUES(?,?,?,?,?,?,?)')
  };

  function audit(actorId, action, targetType, targetId, sourceIp, detail = null) {
    statement.audit.run(actorId || null, action, targetType, targetId == null ? null : String(targetId), sourceIp || null, detail ? JSON.stringify(detail) : null, now());
  }

  /** 券面状态：只看券面自己的开关与日期。 */
  function couponState(face, today = chinaDate()) {
    if (!face || face.status === 'recycled') return 'recycled';
    if (face.status === 'disabled') return 'disabled';
    if (face.starts_on && face.starts_on > today) return 'not_started';
    if (face.expires_on && face.expires_on < today) return 'expired';
    return 'valid';
  }

  /** 券码状态：券面被停用/回收时，其下所有券码同步失效。入参为券码+券面的合并行。 */
  function codeState(row, today = chinaDate()) {
    if (!row) return 'not_found';
    if (row.status === 'recycled' || row.face_status === 'recycled') return 'recycled';
    if (row.status === 'disabled' || row.face_status === 'disabled') return 'disabled';
    if (row.starts_on && row.starts_on > today) return 'not_started';
    if (row.expires_on && row.expires_on < today) return 'expired';
    if (row.used_count >= row.max_uses) return 'exhausted';
    return 'valid';
  }

  function getCouponByToken(token) {
    const row = statement.findCodeHash.get(sha256(token));
    return row ? { ...row, current_state: codeState(row) } : null;
  }

  function createCoupon(data, actorId, sourceIp) {
    const created = now();
    const info = db.prepare(`INSERT INTO coupons(name,offer_text,description,instructions,store_text,starts_on,expires_on,max_uses,created_at,updated_at,created_by)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
      data.name, data.offerText, data.description || null,
      data.instructions || null, data.storeText || null, data.startsOn || null, data.expiresOn || null,
      data.maxUses, created, created, actorId
    );
    audit(actorId, 'coupon.create', 'coupon', info.lastInsertRowid, sourceIp, { name: data.name });
    return { id: Number(info.lastInsertRowid) };
  }

  function updateCoupon(id, data, actorId, sourceIp) {
    const face = statement.couponById.get(id);
    if (!face) return false;
    const mostUsed = db.prepare('SELECT COALESCE(MAX(used_count), 0) AS n FROM voucher_codes WHERE coupon_id = ?').get(id).n;
    if (data.maxUses < mostUsed) throw new Error(`每张券码的次数不能小于已核销次数（有券码已用 ${mostUsed} 次）。`);
    db.prepare('UPDATE coupons SET name=?,offer_text=?,description=?,instructions=?,store_text=?,starts_on=?,expires_on=?,max_uses=?,updated_at=? WHERE id=?').run(
      data.name, data.offerText, data.description || null, data.instructions || null, data.storeText || null,
      data.startsOn || null, data.expiresOn || null, data.maxUses, now(), id
    );
    // 次数放宽后，之前用尽的券码恢复可用
    db.prepare('UPDATE voucher_codes SET exhausted_at = NULL WHERE coupon_id = ? AND used_count < ? AND exhausted_at IS NOT NULL').run(id, data.maxUses);
    audit(actorId, 'coupon.update', 'coupon', id, sourceIp, { name: data.name });
    return true;
  }

  function setCouponStatus(id, status, actorId, sourceIp) {
    const face = statement.couponById.get(id);
    if (!face) return false;
    if (!['active', 'disabled', 'recycled'].includes(status)) throw new Error('无效状态');
    db.prepare('UPDATE coupons SET status=?, recycled_at=?, updated_at=? WHERE id=?').run(status, status === 'recycled' ? now() : null, now(), id);
    audit(actorId, `coupon.${status}`, 'coupon', id, sourceIp);
    return true;
  }

  /** 券码名留空时的默认命名：券面名 → 券面名 #1 → #2……按「碰撞查询」取第一个没被本券面已有券码占用的。
   *  不做自增计数：中间的号码被删掉/回收后，下次创建会把它补上（如已有 券面名/#1/#3 → 新建取 #2）。 */
  function nextDefaultCodeName(couponId, faceName) {
    const raw = String(faceName || '').trim() || '券码';
    const base = raw.length > 64 ? raw.slice(0, 64) : raw;
    const used = new Set(db.prepare('SELECT name FROM voucher_codes WHERE coupon_id = ?').all(couponId).map((row) => row.name));
    for (let i = 0; i < 10000; i += 1) {
      const candidate = i === 0 ? base : `${base} #${i}`;
      if (!used.has(candidate)) return candidate;
    }
    return `${base} #${Date.now()}`;
  }

  /** 一次创建一张券码。ID 由随机数生成（cd- + 12 位），撞库时自动换一个。名称留空则自动按「券面名 #序号」取号。
   *  名称仅作展示、允许重复；showName 为单张的显示覆写（null=跟随全局）。返回 {id, token, name}。 */
  function createCode(couponId, name, note, actorId, sourceIp, showName = null) {
    const face = statement.couponById.get(couponId);
    if (!face) throw new Error('优惠券不存在。');
    if (face.status === 'recycled') throw new Error('回收站中的优惠券不能创建券码。');
    const title = String(name || '').trim() || nextDefaultCodeName(couponId, face.name);
    const display = showName === 1 || showName === '1' ? 1 : showName === 0 || showName === '0' ? 0 : null;
    const insert = db.prepare(`INSERT INTO voucher_codes(id,coupon_id,name,note,show_name,token_hash,token_ciphertext,created_at,updated_at,created_by)
      VALUES(?,?,?,?,?,?,?,?,?,?)`);
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const token = randomToken(32);
        const stamp = now();
        const id = randomId();
        insert.run(id, couponId, title, note || null, display, sha256(token), encrypt(token, config.encryptionKey), stamp, stamp, actorId);
        audit(actorId, 'code.create', 'coupon', couponId, sourceIp, { code: id, name: title, note: note || null });
        return { id, token, name: title };
      } catch (error) {
        lastError = error;
        if (!/UNIQUE constraint failed: voucher_codes\.id/i.test(String(error?.message))) throw error; // 只对 ID 撞车重试
      }
    }
    throw lastError || new Error('创建券码失败，请重试。');
  }

  function setCodeName(id, name, actorId, sourceIp, showName) {
    const code = statement.codeById.get(id);
    if (!code) return false;
    const title = String(name || '').trim();
    if (!title) throw new Error('请填写券码名称（客人打开核销页时会看到）。');
    // 显示覆写：0/1 覆盖、空=跟随全局、字段缺省保持原值。
    const display = showName === undefined ? code.show_name
      : (showName === 1 || showName === '1' ? 1 : showName === 0 || showName === '0' ? 0 : null);
    db.prepare('UPDATE voucher_codes SET name=?, show_name=?, updated_at=? WHERE id=?').run(title, display, now(), id);
    audit(actorId, 'code.rename', 'code', id, sourceIp, { name: title, display });
    return true;
  }

  function setCodeStatus(id, status, actorId, sourceIp) {
    const code = statement.codeById.get(id);
    if (!code) return false;
    if (!['active', 'disabled', 'recycled'].includes(status)) throw new Error('无效状态');
    db.prepare('UPDATE voucher_codes SET status=?, recycled_at=?, updated_at=? WHERE id=?').run(status, status === 'recycled' ? now() : null, now(), id);
    audit(actorId, `code.${status}`, 'code', id, sourceIp, { note: code.note });
    return true;
  }

  function setCodeNote(id, note, actorId, sourceIp) {
    const code = statement.codeById.get(id);
    if (!code) return false;
    db.prepare('UPDATE voucher_codes SET note=?, updated_at=? WHERE id=?').run(note || null, now(), id);
    audit(actorId, 'code.note', 'code', id, sourceIp);
    return true;
  }

  function redeem(token, sourceIp, userAgent) {
    const run = db.transaction(() => {
      const row = statement.findCodeHash.get(sha256(token));
      if (!row) return { ok: false, state: 'not_found' };
      const today = chinaDate();
      const state = codeState(row, today);
      if (state !== 'valid') return { ok: false, state, coupon: { ...row, current_state: state } };
      const stamp = now();
      const result = db.prepare(`UPDATE voucher_codes SET used_count = used_count + 1,
        exhausted_at = CASE WHEN used_count + 1 >= ? THEN COALESCE(exhausted_at, ?) ELSE exhausted_at END, updated_at = ?
        WHERE id = ? AND status = 'active' AND used_count < ?`)
        .run(row.max_uses, stamp, stamp, row.id, row.max_uses);
      if (result.changes !== 1) { // 并发下被抢先，重读真实状态
        const latest = statement.findCodeHash.get(sha256(token));
        const latestState = latest ? codeState(latest, today) : 'not_found';
        return { ok: false, state: latestState, coupon: latest ? { ...latest, current_state: latestState } : null };
      }
      const code = randomCode();
      const redeemedAt = now();
      const record = db.prepare('INSERT INTO redemptions(coupon_id,code_id,redeemed_at,source_ip,user_agent,confirmation_code) VALUES(?,?,?,?,?,?)')
        .run(row.face_id, row.id, redeemedAt, sourceIp || null, userAgent || null, code);
      const updated = statement.findCodeHash.get(sha256(token));
      return { ok: true, coupon: { ...updated, current_state: codeState(updated, today) }, redemption: { id: Number(record.lastInsertRowid), redeemedAt, confirmationCode: code } };
    });
    return run();
  }

  /** 到期/用尽满设定天数（后台可调，默认 30）的券面与券码自动移入回收站。 */
  function recycleEligible() {
    const days = retention().recycleDays;
    const cutoffDate = chinaDate(new Date(Date.now() - days * 86400000));
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    const stamp = now();
    const faces = db.prepare(`UPDATE coupons SET status='recycled', recycled_at=?, updated_at=?
      WHERE status IN ('active','disabled') AND expires_on IS NOT NULL AND expires_on < ?`)
      .run(stamp, stamp, cutoffDate).changes;
    const exhausted = db.prepare(`UPDATE voucher_codes SET status='recycled', recycled_at=?, updated_at=?
      WHERE status IN ('active','disabled') AND exhausted_at IS NOT NULL AND exhausted_at < ?`)
      .run(stamp, stamp, cutoff).changes;
    const expired = db.prepare(`UPDATE voucher_codes SET status='recycled', recycled_at=?, updated_at=?
      WHERE status IN ('active','disabled') AND id IN (
        SELECT v.id FROM voucher_codes v JOIN coupons c ON c.id = v.coupon_id
        WHERE c.expires_on IS NOT NULL AND c.expires_on < ?)`)
      .run(stamp, stamp, cutoffDate).changes;
    return faces + exhausted + expired;
  }

  function purgeRecycled() {
    const cutoff = new Date(Date.now() - retention().purgeDays * 86400000).toISOString();
    const codes = db.prepare("DELETE FROM voucher_codes WHERE status='recycled' AND recycled_at < ?").run(cutoff).changes;
    const faces = db.prepare("DELETE FROM coupons WHERE status='recycled' AND recycled_at < ?").run(cutoff).changes;
    return codes + faces;
  }

  function stats() {
    const today = chinaDate();
    const { expiringDays } = retention();
    const inWindow = chinaDate(new Date(Date.now() + expiringDays * 86400000));
    const valid = db.prepare(`SELECT COUNT(*) AS n FROM voucher_codes v JOIN coupons c ON c.id = v.coupon_id
      WHERE v.status='active' AND c.status='active' AND v.used_count < c.max_uses
        AND (c.starts_on IS NULL OR c.starts_on <= ?) AND (c.expires_on IS NULL OR c.expires_on >= ?)`).get(today, today).n;
    const used = db.prepare('SELECT COALESCE(SUM(used_count), 0) AS n FROM voucher_codes').get().n;
    const expiring = db.prepare(`SELECT COUNT(*) AS n FROM coupons WHERE status='active'
      AND expires_on IS NOT NULL AND expires_on >= ? AND expires_on <= ?`).get(today, inWindow).n;
    const recycled = db.prepare(`SELECT ((SELECT COUNT(*) FROM coupons WHERE status='recycled')
      + (SELECT COUNT(*) FROM voucher_codes WHERE status='recycled')) AS n`).get().n;
    return { valid, used, expiring, recycled, expiringDays };
  }

  // 后台可调的保留参数：整数且在界内才生效，否则回退默认，防脏数据影响清理任务。
  function intSetting(key, fallback, min, max) {
    const n = Number.parseInt(String(getSetting(key, '') ?? ''), 10);
    return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
  }
  function retention() {
    return {
      recycleDays: intSetting('recycleDays', 30, 1, 365),
      purgeDays: intSetting('purgeDays', 30, 1, 365),
      verifyHours: intSetting('verifyHours', 72, 1, 720),
      expiringDays: intSetting('expiringDays', 30, 1, 365)
    };
  }

  function getSetting(key, fallback = null) {
    const row = statement.setting.get(key);
    if (!row) return fallback;
    return row.encrypted ? decrypt(row.value, config.encryptionKey) : row.value;
  }
  function setSetting(key, value, encrypted = false) {
    statement.saveSetting.run(key, encrypted ? encrypt(value, config.encryptionKey) : value, encrypted ? 1 : 0, now());
  }

  /** 券面 + 统计（列表/概览用），附带券面状态。 */
  function couponsWithStats() {
    return statement.facesWithStats.all().map((c) => ({ ...c, current_state: couponState(c) }));
  }
  /** 某券面下的全部券码，附带券码状态。 */
  function codesOf(couponId) {
    return statement.codesOfCoupon.all(couponId).map((code) => ({ ...code, current_state: codeState({ ...code }) }));
  }
  function recycleLists() {
    return {
      faces: statement.recycledFaces.all().map((c) => ({ ...c, current_state: 'recycled' })),
      codes: statement.recycledCodes.all().map((code) => ({ ...code, current_state: 'recycled' }))
    };
  }
  function codeDetail(id) {
    const row = statement.codeById.get(id);
    return row ? { ...row, current_state: codeState(row) } : null;
  }

  /** 公开核销凭证查询：确认码在保留期内（调用方给 since）才返回记录，否则 null。 */
  function lookupConfirmation(code, sinceIso) {
    return statement.verifyByCode.get(code, sinceIso) || null;
  }

  // 审计分页：分类（action 第一段前缀）/操作人/日期范围均为可选；片段白名单拼接，值参数绑定。
  function auditPaged({ action = null, actorId = null, from = null, to = null, limit = 20, offset = 0 } = {}) {
    const where = [];
    const params = [];
    if (action) { where.push('a.action LIKE ?'); params.push(`${action}.%`); }
    if (actorId != null) { where.push('a.actor_id = ?'); params.push(actorId); }
    if (from) { where.push('a.created_at >= ?'); params.push(from); }
    if (to) { where.push('a.created_at <= ?'); params.push(to); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const base = 'FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id';
    const rows = db.prepare(`SELECT a.*, u.username ${base} ${clause} ORDER BY a.id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
    const total = db.prepare(`SELECT COUNT(*) AS n ${base} ${clause}`).get(...params).n;
    return { rows, total };
  }

  // 全局核销记录分页：券面/时间范围筛选均为可选；SQL 片段白名单拼接，值一律参数绑定。
  function redemptionsPaged({ couponId = null, from = null, to = null, limit = 20, offset = 0 } = {}) {
    const where = [];
    const params = [];
    if (couponId != null) { where.push('r.coupon_id = ?'); params.push(couponId); }
    if (from) { where.push('r.redeemed_at >= ?'); params.push(from); }
    if (to) { where.push('r.redeemed_at <= ?'); params.push(to); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const base = 'FROM redemptions r LEFT JOIN coupons c ON c.id = r.coupon_id LEFT JOIN voucher_codes v ON v.id = r.code_id';
    const select = `SELECT r.id, r.coupon_id, r.code_id, r.redeemed_at, r.confirmation_code, r.email_status, r.source_ip,
      c.name AS face_name, v.name AS code_name, v.note AS code_note ${base} ${clause}`;
    const rows = db.prepare(`${select} ORDER BY r.redeemed_at DESC, r.id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
    const total = db.prepare(`SELECT COUNT(*) AS n ${base} ${clause}`).get(...params).n;
    return { rows, total };
  }

  return {
    raw: db, hasSuperAdmin: () => Boolean(statement.hasSuper.get()), audit, couponState, codeState, getCouponByToken, createCoupon,
    updateCoupon, setCouponStatus, createCode, setCodeStatus, setCodeName, setCodeNote, redeem, recycleEligible, purgeRecycled, stats, retention,
    // 券码名全局展示开关（PNG 与客人核销页是否带券码名）；单张券码的 show_name 可覆写。
    voucherDisplay: () => ({ showCodeName: getSetting('showCodeName', 'true') !== 'false' }),
    getCoupon: (id) => statement.couponWithCreator.get(id),
    couponsWithStats, codesOf, recycleLists, codeDetail, lookupConfirmation,
    getCodeToken: (id) => decrypt(statement.codeById.get(id)?.token_ciphertext || '', config.encryptionKey),
    redemptions: (couponId) => statement.redemptionsByCoupon.all(couponId),
    redemptionsForCode: (codeId) => statement.redemptionsByCode.all(codeId),
    recentRedemptions: (limit = 12) => statement.recentRedemptions.all(limit),
    redemptionsPaged,
    auditPaged,
    auditPrefixes: () => db.prepare("SELECT DISTINCT substr(action,1,instr(action,'.')-1) AS prefix FROM audit_log WHERE instr(action,'.') > 0 ORDER BY prefix").all().map((row) => row.prefix),
    activePresets: () => statement.activePresets.all(), allPresets: () => statement.allPresets.all(),
    users: () => statement.users.all(), getSetting, setSetting,
    createUser(username, passwordHash, role) { const t = now(); return db.prepare('INSERT INTO users(username,password_hash,role,created_at,updated_at) VALUES(?,?,?,?,?)').run(username, passwordHash, role, t, t); },
    userByName: (username) => db.prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE').get(username),
    userById: (id) => db.prepare('SELECT * FROM users WHERE id=?').get(id),
    updateLastLogin: (id) => db.prepare('UPDATE users SET last_login_at=? WHERE id=?').run(now(), id),
    createSession(token, userId, csrf, expiresAt) { return db.prepare('INSERT INTO sessions(token_hash,user_id,csrf_hash,expires_at,created_at,last_seen_at) VALUES(?,?,?,?,?,?)').run(sha256(token), userId, sha256(csrf), expiresAt, now(), now()); },
    getSession(token) { return db.prepare(`SELECT s.*,u.username,u.role,u.active FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`).get(sha256(token), now()); },
    deleteSession: (token) => db.prepare('DELETE FROM sessions WHERE token_hash=?').run(token ? sha256(token) : ''),
    deleteUserSessions: (userId) => db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId),
    setUserPassword: (id, encoded) => db.prepare('UPDATE users SET password_hash=?,updated_at=? WHERE id=?').run(encoded, now(), id),
    setUsername: (id, value) => db.prepare('UPDATE users SET username=?,updated_at=? WHERE id=?').run(value, now(), id),
    setUserActive: (id, active) => db.prepare('UPDATE users SET active=?,updated_at=? WHERE id=?').run(active ? 1 : 0, now(), id),
    createPreset(data) { const t = now(); return db.prepare('INSERT INTO presets(name,instructions,store_text,created_at,updated_at) VALUES(?,?,?,?,?)').run(data.name, data.instructions || null, data.storeText || null, t, t); },
    recycleEligible, purgeRecycled
  };
}
