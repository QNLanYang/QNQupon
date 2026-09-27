// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 QNLanYang (全能岚漾)

import nodemailer from 'nodemailer';

// 数据库存 UTC，邮件里按北京时间展示。
const beijingTime = (value) => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
}).format(new Date(value));

function mailConfig(db, requireRecipients = true) {
  const enabled = db.getSetting('mailEnabled', 'false') === 'true';
  const host = db.getSetting('smtpHost', '');
  const recipients = db.getSetting('mailRecipients', '').split(/[\n,;]+/).map((v) => v.trim()).filter(Boolean);
  if (!enabled || !host || (requireRecipients && !recipients.length)) return null;
  return {
    host, port: Number(db.getSetting('smtpPort', '465')), secure: db.getSetting('smtpSecure', 'true') === 'true',
    auth: { user: db.getSetting('smtpUser', ''), pass: db.getSetting('smtpPassword', '') },
    from: db.getSetting('mailFrom', ''), to: recipients
  };
}

/**
 * 发送核销通知。返回 'sent' 或 'skipped'；抛出异常表示发送失败。
 * 是否写入数据库由调用方统一处理，核销本身不会被邮件影响。
 */
export async function sendRedemptionMail(db, coupon, redemption) {
  const options = mailConfig(db);
  if (!options?.from) return 'skipped';
  const transport = nodemailer.createTransport(options);
  const title = [coupon.face_name, coupon.name].filter(Boolean).join(' - ');
  await transport.sendMail({
    from: options.from, to: options.to.join(','), subject: `优惠券已核销：${title}`,
    text: `优惠券：${coupon.face_name || coupon.name}\n券码：${coupon.name || '—'}\n优惠内容：${coupon.offer_text}${coupon.note ? `\n券码备注：${coupon.note}` : ''}\n核销时间：${beijingTime(redemption.redeemedAt)}\n确认码：${redemption.confirmationCode}\n本券码剩余次数：${Math.max(0, coupon.max_uses - coupon.used_count)}`
  });
  return 'sent';
}

export async function sendTestMail(db, recipient) {
  const options = mailConfig(db, false);
  if (!options?.from) throw new Error('请先启用并完整配置 SMTP 与发件人。');
  const transport = nodemailer.createTransport(options);
  await transport.sendMail({ from: options.from, to: recipient, subject: 'QNQupon SMTP 测试邮件', text: 'SMTP 配置生效，这是 QNQupon 的测试邮件。' });
}
