// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 QNLanYang (全能岚漾)
//
// 这个 Service Worker 只有一个目的：让浏览器认可「可安装」。
// 实测部分手机浏览器（鸿蒙 4.x 的 Edge、华为浏览器）仍要求「注册了一个带 fetch 的 Service Worker」
// 才给安装，光有 manifest 只能建快捷方式；桌面 Chrome/Edge 则早已放宽到只认 manifest。
//
// 它刻意什么都不缓存，理由：
//   1. 后台必须看实时数据，任何缓存都可能让人看到过期页面，或在公用设备上串号；
//   2. 静态资源继续走 max-age=0 + ETag 每次回源校验，交给 HTTP 缓存即可，不需要 SW 插手；
//   3. 所以 fetch 一律透传，绝不调用 caches.*。测试里有断言守着「不许出现 caches」。
// 若将来真要离线能力：先想清楚「哪些请求绝不许命中缓存」，再改这里，并同步改那条断言。
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  // 非 GET、跨域、以及只读缓存的请求都交回浏览器默认行为，免得凭空造出错误响应
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.cache === 'only-if-cached' && event.request.mode !== 'same-origin') return;
  event.respondWith(fetch(event.request));
});
