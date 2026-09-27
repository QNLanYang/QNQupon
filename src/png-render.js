// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 QNLanYang (全能岚漾)

// 券面 PNG 渲染：放在独立子进程里做，主进程只做转发。
// 为什么：sharp/libvips 一次渲染会让常驻进程多占几十 MB 线程栈与缓冲区，且迟迟不归还系统；
// 这里渲染任务串行执行（不缓存任何结果），最后一次渲染结束 60 秒后子进程自动退出，内存全部回收。
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';

const IDLE_EXIT_MS = 60_000; // 渲染完 60 秒后退出子进程
const JOB_TIMEOUT_MS = 30_000; // 单张渲染超时（正常 0.4 秒以内，留足余量）
const MAX_QUEUE = 20; // 排队上限：配合路由限流 30 次/10 分钟，防止并发下载把队列堆到无限长
const self = dirname(fileURLToPath(import.meta.url));

let child = null;
let idleTimer = null;
let seq = 0;
let active = null; // 当前正在子进程里渲染的任务
const queue = []; // 排队中的任务（串行执行，压低子进程内存峰值）

function killChild() {
  if (!child) return;
  const proc = child;
  child = null;
  proc.kill();
}

function failActive(message) {
  if (!active) return;
  const job = active;
  active = null;
  clearTimeout(job.timer);
  job.reject(new Error(message));
}

function pump() {
  if (active || queue.length === 0) return;
  let proc = child;
  if (!proc) {
    proc = spawn(process.execPath, [join(self, 'png-child.js')], { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
    child = proc;
    readline.createInterface({ input: proc.stdout }).on('line', (line) => {
      let msg = null;
      try { msg = JSON.parse(line); } catch { return; }
      if (!active || msg.id !== active.id) return;
      const job = active;
      active = null;
      clearTimeout(job.timer);
      if (msg.ok) job.resolve(Buffer.from(msg.data, 'base64'));
      else job.reject(new Error(msg.error || '券面 PNG 渲染失败。'));
      pump();
    });
    proc.on('exit', () => {
      if (child === proc) child = null;
      failActive('券面 PNG 渲染进程意外退出，请重试。');
      while (queue.length) { const job = queue.shift(); clearTimeout(job.timer); job.reject(new Error('券面 PNG 渲染进程意外退出，请重试。')); }
    });
  }
  const job = queue.shift();
  active = job;
  job.timer = setTimeout(() => {
    failActive('券面 PNG 渲染超时，请重试。');
    killChild(); // 子进程状态不明，直接结束，下次请求重新拉起
  }, JOB_TIMEOUT_MS);
  proc.stdin.write(`${JSON.stringify({ id: job.id, coupon: job.coupon, url: job.url })}\n`);
}

function scheduleIdleExit() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!active && queue.length === 0) killChild(); // 60 秒没有新任务：退出回收内存
  }, IDLE_EXIT_MS);
  idleTimer.unref?.(); // 不阻止主进程退出
}

/** 渲染一张 1080×1528 券面 PNG，返回 Buffer。不缓存，按需生成。 */
export function renderCouponPng(coupon, url) {
  if (queue.length >= MAX_QUEUE) {
    return Promise.reject(Object.assign(new Error('同时下载券面的人太多了，请稍后再试。'), { statusCode: 429 }));
  }
  const job = { id: ++seq, coupon, url, timer: null };
  const promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
  queue.push(job);
  scheduleIdleExit();
  pump();
  return promise;
}
