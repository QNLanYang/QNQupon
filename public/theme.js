// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 QNLanYang (全能岚漾)
// 主题三态：跟随系统（默认，html 无 data-theme）/ 浅色 / 深色。localStorage 持久化。
// 同步加载于 <head>，在首次渲染前把 data-theme 落到 html 上，避免主题闪烁。
(function () {
  var KEY = 'qnqupon-theme';
  var VALID = { system: 1, light: 1, dark: 1 };

  function read() {
    try {
      var v = localStorage.getItem(KEY);
      return VALID[v] ? v : 'system';
    } catch (e) { return 'system'; }
  }

  function apply(v) {
    var el = document.documentElement;
    if (v === 'system') el.removeAttribute('data-theme');
    else el.setAttribute('data-theme', v);
    var bs = document.querySelectorAll('[data-theme-set]');
    for (var i = 0; i < bs.length; i++) {
      bs[i].setAttribute('aria-pressed', bs[i].getAttribute('data-theme-set') === v ? 'true' : 'false');
    }
  }

  // head 时点：html 属性立即生效（防闪烁）；按钮态等 DOM 就绪后再刷。
  apply(read());
  document.addEventListener('DOMContentLoaded', function () { apply(read()); });
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.getAttribute) return;
    var v = t.getAttribute('data-theme-set');
    if (!v || !VALID[v]) return;
    try { localStorage.setItem(KEY, v); } catch (err) { /* 隐私模式下内存态仍生效 */ }
    apply(v);
  });
})();
