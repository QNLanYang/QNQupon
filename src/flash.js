// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 QNLanYang (全能岚漾)
//
// 操作反馈（flash）：服务端在重定向响应里写一个一次性 Cookie，下一页 GET 时读出并立即清除，
// 由页面渲染成右上角卡片（见 views.js 的 toast-host 与 app.js 的接管逻辑）。
// 相比把消息放进查询串：消息由服务端写入且 HttpOnly（客户端伪造不了、链接干净），读出即清（刷新不重复）。
// 只在渲染 HTML 的处理器里调用 takeFlash——JSON 接口不能消费它，否则消息会被吃掉。

export const FLASH_COOKIE = 'qnqupon_flash';
const TYPES = new Set(['success', 'error', 'info']);
const MAX_MESSAGE = 300;

export const serializeFlash = (message, type = 'success') => JSON.stringify({
  message: String(message ?? '').slice(0, MAX_MESSAGE),
  type: TYPES.has(type) ? type : 'info'
});

/** 解析 Cookie 里的反馈；空消息、坏 JSON、非法类型一律按“无反馈”处理（类型回退 info）。 */
export function parseFlash(raw) {
  try {
    const data = JSON.parse(String(raw ?? ''));
    if (!data || typeof data.message !== 'string' || !data.message) return null;
    return { message: data.message.slice(0, MAX_MESSAGE), type: TYPES.has(data.type) ? data.type : 'info' };
  } catch {
    return null;
  }
}

const cookieOptions = (secure) => ({ path: '/', httpOnly: true, sameSite: 'strict', secure, maxAge: 60 });

/** 写反馈（随重定向下发）。 */
export const setFlash = (reply, message, type = 'success', { secure = true } = {}) =>
  reply.setCookie(FLASH_COOKIE, serializeFlash(message, type), cookieOptions(secure));

/** 读反馈并立即清除（一次性）。没有则返回 null。 */
export function takeFlash(request, reply, { secure = true } = {}) {
  const flash = parseFlash(request?.cookies?.[FLASH_COOKIE]);
  if (flash && reply) reply.clearCookie(FLASH_COOKIE, cookieOptions(secure));
  return flash;
}
