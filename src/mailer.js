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
  const text = [
    '这是一封测试邮件，用来验证「服务设置 → 邮件通知」里的 SMTP 配置是否可用。',
    '它由管理员手动触发，与任何优惠券、核销记录无关。',
    '如果你不认识这封邮件，直接忽略即可，不需要做任何处理。'
  ].join('\n');
  await transport.sendMail({ from: options.from, to: recipient, subject: '【测试】QNQupon · 券能行 邮件通知（可忽略）', text });
}
