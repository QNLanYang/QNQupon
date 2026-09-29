// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 QNLanYang (全能岚漾)

import { test } from 'node:test';
import assert from 'node:assert/strict';

// config.js 在导入时读取环境变量并校验必需项，所以先摆好环境再动态导入
process.env.APP_ENCRYPTION_KEY = 'test-encryption-key-0123456789';
process.env.SESSION_SECRET = 'test-session-secret-0123456789';
process.env.RATE_LIMIT_LOGIN = 'off';
process.env.RATE_LIMIT_ADMIN_WRITE = 'OFF';
process.env.RATE_LIMIT_VERIFY = '0/1m';
process.env.RATE_LIMIT_REDEEM = '12/30s';
process.env.RATE_LIMIT_PROFILE = '写错了';
process.env.LOG_LEVEL = 'Debug';

const { config } = await import('../src/config.js');

test('限流：off 或次数为 0 = 关闭该入口（传给插件 false，路由不再挂限流钩子）', () => {
  assert.equal(config.rateLimits.login, false, 'off 关闭登录限流');
  assert.equal(config.rateLimits.adminWrite, false, '大小写不敏感');
  assert.equal(config.rateLimits.verify, false, '0/1m 也视为关闭');
});

test('限流：正常值按「次数/窗口」解析，非法值回退默认', () => {
  assert.deepEqual(config.rateLimits.redeem, { max: 12, timeWindow: 30000 }, '窗口单位支持 s');
  assert.deepEqual(config.rateLimits.profile, { max: 5, timeWindow: 600000 }, '写法非法回退该条目的默认值');
});

test('日志级别：大小写不敏感，非法值回退 info', () => {
  assert.equal(config.logLevel, 'debug');
});
