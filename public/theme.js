// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 QNLanYang (全能岚漾)
// 主题：未主动选择过 = 跟随系统（不写 data-theme，交回 prefers-color-scheme）；主动选择过 = 记住浅色/深色。
// 切换入口是单个图标按钮（[data-theme-cycle]）：点一下在浅色/深色之间换，不做下拉、不摆多个按钮。
// 只认「主动选过」的两种值，"system" 是旧实现的遗留写法，按未选择处理。
// 同步加载于 <head>，在首次渲染前把 data-theme 落到 html 上，避免主题闪烁；顺手同步 <meta name="theme-color">
// （浏览器 UI 与 PWA 独立窗口的状态栏颜色），所以这个脚本必须排在 pwaHead 之后。
(function () {
  var KEY = 'qnqupon-theme';
  var CHOSEN = { light: 1, dark: 1 };
  var LABEL = { light: '浅色', dark: '深色' };
  // 浏览器 UI / PWA 独立窗口的状态栏颜色：与顶栏同色（浅 #172033、深 #0e121b）
  var THEME_COLOR = { light: '#172033', dark: '#0e121b' };
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function chosen() {
    try {
      var v = localStorage.getItem(KEY);
      return CHOSEN[v] ? v : null;
    } catch (e) { return null; }
  }

  function systemTheme() { return mq && mq.matches ? 'dark' : 'light'; }
  function effective() { return chosen() || systemTheme(); }

  function apply(v) {
    var el = document.documentElement;
    if (v) el.setAttribute('data-theme', v);
    else el.removeAttribute('data-theme');
    // 状态栏/浏览器 UI 颜色跟着当前主题走（只在有 <meta name="theme-color"> 的后台页存在）
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', THEME_COLOR[effective()] || THEME_COLOR.light);
    // 图标显形由 CSS 按 data-theme + prefers-color-scheme 决定，这里只同步无障碍文案
    var label = (chosen() ? '主题：' + LABEL[effective()] : '主题：跟随系统（' + LABEL[effective()] + '）') + '（点击切换）';
    var bs = document.querySelectorAll('[data-theme-cycle]');
    for (var i = 0; i < bs.length; i++) {
      bs[i].setAttribute('aria-label', label);
      bs[i].setAttribute('title', label);
    }
  }

  // head 时点：html 属性立即生效（防闪烁）；按钮文案等 DOM 就绪后再刷。
  apply(chosen());
  document.addEventListener('DOMContentLoaded', function () { apply(chosen()); });
  // 未主动选择时跟随系统：系统主题变了要同步文案（外观本身由媒体查询负责）
  if (mq) {
    var onSystem = function () { if (!chosen()) apply(null); };
    if (mq.addEventListener) mq.addEventListener('change', onSystem);
    else if (mq.addListener) mq.addListener(onSystem);
  }
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest || !t.closest('[data-theme-cycle]')) return;
    var next = effective() === 'light' ? 'dark' : 'light';
    try { localStorage.setItem(KEY, next); } catch (err) { /* 隐私模式下内存态仍生效 */ }
    apply(next);
  });
})();
