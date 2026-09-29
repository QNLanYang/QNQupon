// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 QNLanYang (全能岚漾)
//
// 单行日志：写 stdout/stderr，由外置进程（systemd Journal / nssm）收集与轮转——应用自己不做文件与轮转。
// 未调用 configureLog() 时完全静默（库内使用、测试默认不产生输出）。
// 级别：debug < info < warn < error < off，由 .env 的 LOG_LEVEL 控制，默认 info。
//
// 安全约定：带凭据的路径一律掩码（Token / 确认码不进日志）；查询串不记录；密码类字段由调用方过滤。

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, off: 99 };
const state = {
  enabled: false,
  level: LEVELS.info,
  out: (line) => process.stdout.write(line),
  err: (line) => process.stderr.write(line),
  stamp: () => new Date().toISOString()
};

/** 启动时配置一次：级别、时区（日志时间与页面一致）与输出流（测试可注入收集器）。 */
export function configureLog({ level = 'info', timeZone = 'Asia/Shanghai', out, err } = {}) {
  state.level = LEVELS[String(level).toLowerCase()] ?? LEVELS.info;
  if (out) state.out = out;
  if (err) state.err = err;
  // 时间戳：北京时间（或指定时区）+ 偏移量，形如 2026-09-29 03:41:12+08:00
  const date = new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const zone = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' });
  state.stamp = () => {
    const name = (zone.formatToParts(new Date()).find((part) => part.type === 'timeZoneName') || {}).value || 'GMT';
    return `${date.format(new Date())}${name === 'GMT' ? '+00:00' : name.replace('GMT', '')}`;
  };
  state.enabled = true;
}

/** 字段渲染：k=v 空格分隔；含空白或引号的值加引号，便于肉眼扫读也便于 awk 切分。 */
export const kv = (fields) => Object.entries(fields)
  .filter(([, value]) => value !== undefined && value !== null && value !== '')
  .map(([key, value]) => {
    const text = String(value);
    return `${key}=${/[\s"']/.test(text) ? JSON.stringify(text) : text}`;
  })
  .join(' ');

/** 请求路径脱敏：查询串一律丢弃；带凭据的路径整体掩码（新增此类路由时要在这里补规则）。 */
export function safePath(url) {
  const path = String(url || '/').split('?')[0].slice(0, 200);
  if (/^\/r\/[^/]+$/.test(path)) return '/r/<token>';
  if (/^\/api\/verify\/[^/]+$/.test(path)) return '/api/verify/<code>';
  return path;
}

function write(level, event, fields) {
  if (!state.enabled || state.level > LEVELS[level]) return;
  const line = `${state.stamp()} ${level.toUpperCase().padEnd(5)} ${event}${fields ? ` ${fields}` : ''}\n`;
  if (level === 'error') state.err(line);
  else state.out(line);
}

export const logDebug = (event, fields) => write('debug', event, fields);
export const logInfo = (event, fields) => write('info', event, fields);
export const logWarn = (event, fields) => write('warn', event, fields);
export const logError = (event, fields) => write('error', event, fields);
