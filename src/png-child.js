// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 QNLanYang (全能岚漾)

// PNG 渲染子进程：从 stdin 读一行 JSON {id, coupon, url, options}，渲染后向 stdout 写一行 JSON {id, ok, data|error}。
// 只干一件事，干完由主进程在 60 秒空闲后退出——渲染占用的内存（sharp/libvips 线程与缓冲区）随之全部归还系统。
import readline from 'node:readline';
import { renderCouponPng } from './coupon-image.js';

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let job = null;
  try { job = JSON.parse(line); } catch { return; }
  renderCouponPng(job.coupon, job.url, job.options || {})
    .then((png) => process.stdout.write(`${JSON.stringify({ id: job.id, ok: true, data: png.toString('base64') })}\n`))
    .catch((error) => process.stdout.write(`${JSON.stringify({ id: job.id, ok: false, error: String(error?.message || error) })}\n`));
});
// stdin 关闭即退出（stdout 由 Node 在事件循环排空后自动 flush）
rl.on('close', () => { process.exitCode = 0; });
