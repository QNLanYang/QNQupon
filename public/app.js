// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 QNLanYang (全能岚漾)

// 页面内确认框：替代 window.confirm，避免被部分浏览器/内嵌 WebView 拦截或禁用。
let pending = null; // { form, submitter }
const mask = document.createElement('div');
mask.className = 'modal-mask';
mask.hidden = true;
mask.innerHTML = '<div class="modal-card" role="alertdialog" aria-modal="true" aria-labelledby="modal-title"><h3 id="modal-title"></h3><p class="modal-text"></p><input class="modal-input" type="password" autocomplete="new-password" aria-label="新密码" hidden><div class="modal-actions"><button type="button" class="secondary" data-cancel>取消</button><button type="button" class="primary" data-ok>确认</button></div></div>';
document.body.appendChild(mask);
const modalTitle = mask.querySelector('#modal-title');
const modalText = mask.querySelector('.modal-text');
const modalInput = mask.querySelector('.modal-input');
const okButton = mask.querySelector('[data-ok]');
const cancelButton = mask.querySelector('[data-cancel]');

function closeModal() {
  mask.hidden = true;
  modalInput.hidden = true;
  modalInput.value = '';
  pending = null;
}

function confirmSubmit() {
  const { form, submitter, prompt } = pending || {};
  if (prompt) {
    // 内嵌输入（重置密码）：不足长度就留在弹窗里提示，不提交
    if (modalInput.value.length < prompt.min) {
      modalText.textContent = `${prompt.hint}：至少 ${prompt.min} 位。`;
      modalInput.focus();
      return;
    }
    prompt.target.value = modalInput.value;
  }
  closeModal();
  if (!form) return;
  form._confirmedSubmitter = submitter || null;
  // requestSubmit 会保留浏览器原生校验（如必勾选项）和按钮的 formaction；老浏览器退回普通提交。
  if (typeof form.requestSubmit === 'function') form.requestSubmit(submitter || undefined);
  else form.submit();
}

document.addEventListener('submit', (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  const submitter = event.submitter instanceof HTMLElement ? event.submitter : null;
  if (form._confirmedSubmitter === (submitter || null)) {
    delete form._confirmedSubmitter;
    return;
  }
  const message = form.dataset.confirm || (submitter ? submitter.dataset.confirm : null);
  if (!message) return;
  event.preventDefault();
  pending = { form, submitter };
  modalTitle.textContent = form.dataset.confirmTitle || (submitter ? submitter.dataset.confirmTitle : '') || '请确认';
  modalText.textContent = message;
  modalInput.hidden = true;
  mask.hidden = false;
  okButton.focus();
});

// 重置密码：不在表格里摊开输入框，点按钮弹内嵌输入，确认后再提交
document.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-password-reset]');
  if (!button) return;
  const form = button.closest('form');
  const target = form && form.querySelector('input[name="newPassword"]');
  if (!form || !target) return;
  event.preventDefault();
  const min = Number(button.dataset.minlength) || 12;
  const who = button.dataset.user || '该账号';
  pending = { form, submitter: null, prompt: { target, min, hint: `输入「${who}」的新密码` } };
  modalTitle.textContent = '重置密码';
  modalText.textContent = `输入「${who}」的新密码（至少 ${min} 位）。重置后该账号的全部会话会失效。`;
  modalInput.value = '';
  modalInput.hidden = false;
  mask.hidden = false;
  modalInput.focus();
});

okButton.addEventListener('click', confirmSubmit);
cancelButton.addEventListener('click', closeModal);
mask.addEventListener('click', (event) => { if (event.target === mask) closeModal(); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !mask.hidden) closeModal(); });

// ---- 顶栏折叠菜单（手机档）：点按钮展开，点外部或 Esc 收起 ----
const sideWrap = document.querySelector('[data-side]');
const menuToggle = document.querySelector('[data-menu-toggle]');
if (sideWrap && menuToggle) {
  const setMenu = (open) => {
    if (open) sideWrap.setAttribute('data-open', '');
    else sideWrap.removeAttribute('data-open');
    menuToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  menuToggle.addEventListener('click', (event) => {
    event.stopPropagation();
    setMenu(!sideWrap.hasAttribute('data-open'));
  });
  document.addEventListener('click', (event) => {
    if (sideWrap.hasAttribute('data-open') && !sideWrap.contains(event.target)) setMenu(false);
  });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') setMenu(false); });
}

// ---- 浮窗按钮（核销记录的「筛选」、券面详情的「新建」）：点按钮展开，点外部或 Esc 收起 ----
// 浮窗里就是普通表单，提交行为不变；这里只管开合，同一时间只留一个。
const popoverPanel = (button) => document.getElementById(button.getAttribute('aria-controls') || '');
// 展开时压暗页面其余部分（比确认框的遮罩轻一档）：层次更清楚，点遮罩即收起
const popoverMask = document.createElement('div');
popoverMask.className = 'popover-mask';
popoverMask.hidden = true;
document.body.appendChild(popoverMask);
function syncPopoverMask() {
  popoverMask.hidden = !document.querySelector('[data-popover-toggle][aria-expanded="true"]');
}
// 浮窗挂在按钮下面，卡片靠页面底部时展开后会掉到视口外（手机档尤其明显）：
// 只补竖向滚动，滚最小的距离让浮窗整体可见；横向不插手，免得页面被推歪。
function keepPopoverInView(panel) {
  const rect = panel.getBoundingClientRect();
  const margin = 12;
  const below = rect.bottom - window.innerHeight + margin;
  const above = margin - rect.top;
  if (below > 0) window.scrollBy({ top: below, behavior: 'smooth' });
  else if (above > 0) window.scrollBy({ top: -above, behavior: 'smooth' });
}
function closePopovers(keep) {
  for (const button of document.querySelectorAll('[data-popover-toggle][aria-expanded="true"]')) {
    const panel = popoverPanel(button);
    if (panel === keep) continue;
    if (panel) panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  }
  syncPopoverMask();
}
document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-popover-toggle]');
  if (!button) {
    if (!event.target.closest('.popover')) closePopovers();
    return;
  }
  const panel = popoverPanel(button);
  if (!panel) return;
  const open = panel.hidden;
  closePopovers(panel);
  panel.hidden = !open;
  button.setAttribute('aria-expanded', open ? 'true' : 'false');
  syncPopoverMask();
  if (open) keepPopoverInView(panel);
});
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closePopovers(); });

// ---- 顶栏导航横向滑动：没显示全的那一侧淡出 + 小三角，提示「还有内容」 ----
const topNav = document.querySelector('.topbar nav');
if (topNav) {
  const setFlag = (el, name, on) => { if (on) el.setAttribute(name, ''); else el.removeAttribute(name); };
  // 标记挂在 .topbar-nav 上（提示条是它的子节点），CSS 用后代选择器显示并淡入，好加过渡
  const navShell = topNav.closest('.topbar-nav') || topNav;
  const syncNavFade = () => {
    const scrollable = topNav.scrollWidth > topNav.clientWidth + 1;
    setFlag(navShell, 'data-fade-left', scrollable && topNav.scrollLeft > 1);
    setFlag(navShell, 'data-fade-right', scrollable && topNav.scrollLeft + topNav.clientWidth < topNav.scrollWidth - 1);
  };
  // 点两侧的小三角：往对应方向滚一屏的六成（原来是纯装饰且 pointer-events:none，
  // 点在三角上会落到被遮住的那个导航项上，等于误点链接）
  for (const [selector, direction] of [['.nav-hint-left', -1], ['.nav-hint-right', 1]]) {
    navShell.querySelector(selector)?.addEventListener('click', () => {
      topNav.scrollBy({ left: direction * Math.round(topNav.clientWidth * 0.6), behavior: 'smooth' });
    });
  }
  topNav.addEventListener('scroll', syncNavFade, { passive: true });
  window.addEventListener('resize', syncNavFade);
  syncNavFade();
}

// ---- 装到桌面：注册 Service Worker（只透传、不缓存，见 public/sw.js 顶部说明）----
// 实测鸿蒙 4.x 的 Edge 与华为浏览器仍要求「注册了一个带 fetch 的 SW」才给安装，光有 manifest 只能建快捷方式；
// 桌面 Chrome/Edge 早已放宽到只认 manifest，多这一个 SW 对它们没有副作用（它不缓存任何东西）。
// 非安全上下文（例如 http://192.168.66.66:3100）没有 navigator.serviceWorker，这里自然跳过。
if (document.body.classList.contains('admin-body') && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js', { scope: '/admin', updateViaCache: 'none' })
    .catch(() => { /* 浏览器不支持或被策略拒绝：忽略，页面功能不受影响，最多不出现安装入口 */ });
}

// 日期输入：一律用原生 type="date"，脚本零接管——实测（鸿蒙 ArkWeb）由脚本在聚焦时切换 type
// 会引发首点不弹日历、二次点击框闪烁且值提交不上（本地三组对照页实测；对照组脚本在 temp/ 不入库）。

const preset = document.querySelector('#preset-select');
if (preset) preset.addEventListener('change', () => {
  const option = preset.options[preset.selectedIndex];
  if (option?.dataset.instructions) document.querySelector('#instructions').value = option.dataset.instructions;
  if (option?.dataset.store) document.querySelector('#store-text').value = option.dataset.store;
});

// 创建券码：数量 > 1 即批量——名称自动加编号、券码名固定隐藏（批量默认不给客人看名字），
// 因此批量时把「券码名显示」置为始终隐藏并禁用，回到单张再恢复；按钮文案同步。
const codeCount = document.querySelector('#code-count');
const codeShowName = document.querySelector('#code-show-name');
const codeSubmit = document.querySelector('#code-submit');
if (codeCount && codeShowName && codeSubmit) {
  let singleChoice = codeShowName.value;
  const sync = () => {
    const bulk = Number(codeCount.value) > 1;
    if (bulk && !codeShowName.disabled) singleChoice = codeShowName.value;
    codeShowName.disabled = bulk;
    codeShowName.value = bulk ? '0' : singleChoice;
    codeSubmit.textContent = bulk ? `批量生成 ${codeCount.value} 张` : '创建券码';
  };
  codeCount.addEventListener('input', sync);
  sync();
}

// 复制裁销链接：Token 只在点击时从后台接口取，不写进页面 HTML。
async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.style.cssText = 'position:fixed;opacity:0';
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  area.remove();
  return ok;
}

// 操作反馈卡片：服务端已在 HTML 里输出（无 JS 也可见），这里接管滑入、超时淡出、关闭、悬停暂停与堆叠；
// 前端产生的反馈（如复制链接）也用同一套，保证样式与行为一致。
const toastHost = document.querySelector('[data-toast-host]');
const TOAST_TTL = { success: 5000, info: 5000, error: 8000 };

// 卡片贴着顶栏下沿显示：顶栏在文档顶部不吸顶，所以用它的高度而不是视口坐标
// （用视口坐标的话，页面一滚动就会算出负值，把卡片顶到屏幕外）；窄屏顶栏会换行变高，量高度同样适用。
const topbar = document.querySelector('.topbar');
function placeToasts() {
  if (!topbar || !toastHost) return;
  document.documentElement.style.setProperty('--toast-top', `${Math.round(topbar.getBoundingClientRect().height + 10)}px`);
}
placeToasts();
window.addEventListener('resize', placeToasts);
// 字体加载完成后顶栏高度才最终稳定，再量一次避免卡片差几像素
window.addEventListener('load', placeToasts);

function dismissToast(card) {
  if (!card || card.dataset.closing) return;
  card.dataset.closing = '1';
  card.classList.add('out');
  setTimeout(() => card.remove(), 200);
}

function armToast(card) {
  const ttl = TOAST_TTL[card.classList.contains('error') ? 'error' : 'success'];
  card.classList.add('in');
  card.querySelector('.toast-close')?.addEventListener('click', () => dismissToast(card));
  let timer = setTimeout(() => dismissToast(card), ttl);
  const pause = () => clearTimeout(timer);
  const resume = () => { clearTimeout(timer); timer = setTimeout(() => dismissToast(card), ttl); };
  card.addEventListener('mouseenter', pause);
  card.addEventListener('mouseleave', resume);
  card.addEventListener('focusin', pause);
  card.addEventListener('focusout', resume);
}

function showToast(message, type = 'success') {
  if (!toastHost) return;
  const card = document.createElement('div');
  card.className = `toast ${type}`;
  card.setAttribute('role', 'status');
  const text = document.createElement('p');
  text.className = 'toast-message';
  text.textContent = message;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'toast-close';
  close.setAttribute('aria-label', '关闭');
  close.textContent = '×';
  card.append(text, close);
  toastHost.append(card);
  while (toastHost.children.length > 4) dismissToast(toastHost.firstElementChild); // 最多同时 4 条，超出先收最旧的
  armToast(card);
}

const armAllToasts = () => { for (const card of document.querySelectorAll('.toast')) armToast(card); };
armAllToasts();

// ---- 页脚保持单行：放不下就迭代缩小字号（最小 9px）----
// 注意：页脚有 overflow:hidden 兜底，而 Range 的矩形会被祖先裁剪框裁掉——测量时必须临时放开裁剪，
// 否则永远量到「等于盒子宽」而误判为放得下。
const siteFooter = document.querySelector('.site-footer');
if (siteFooter) {
  const measure = () => {
    const previous = siteFooter.style.overflow;
    siteFooter.style.overflow = 'visible';
    const range = document.createRange();
    range.selectNodeContents(siteFooter);
    const width = range.getBoundingClientRect().width;
    siteFooter.style.overflow = previous;
    return width;
  };
  const fitFooter = () => {
    siteFooter.style.whiteSpace = 'nowrap';
    siteFooter.style.fontSize = '';
    const styles = getComputedStyle(siteFooter);
    const base = parseFloat(styles.fontSize) || 12;
    const pad = (parseFloat(styles.paddingLeft) || 0) + (parseFloat(styles.paddingRight) || 0);
    const target = Math.max(0, siteFooter.clientWidth - pad - 6); // 留 6px 余量，不让文字贴边
    let size = base;
    for (let i = 0; i < 5; i++) {
      const width = measure();
      if (!width || width <= target) break;
      size = Math.max(9, (size * target) / width);
      siteFooter.style.fontSize = `${size.toFixed(2)}px`;
      if (size <= 9) break;
    }
  };
  fitFooter();
  window.addEventListener('resize', fitFooter);
  window.addEventListener('load', fitFooter);      // 字体/布局稳定后再量
  setTimeout(fitFooter, 0);
  setTimeout(fitFooter, 300);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitFooter).catch(() => {});
  if (typeof ResizeObserver === 'function') new ResizeObserver(fitFooter).observe(siteFooter);
}

// ---- 表单提交升级为局部刷新（仅后台页；无脚本或出错时行为与现在完全一致）----
// 服务端照旧渲染整页并重定向，这里只做两件事：把新页面的 <main> 与反馈卡片换上去、恢复滚动位置，
// 于是既拿到服务端渲染的反馈卡片，又不会整页闪一下、跳回顶部、把其他面板里没提交的内容冲掉。
const AJAX_SKIP = ['/admin/logout', '/admin/login', '/admin/setup'];

// 记下屏幕上各字段的值（按 表单action|名称|类型|序号 定位），换页后把"用户改过、而服务端没变"的还原回去
function collectFields() {
  const snapshot = new Map();
  const seen = new Map();
  for (const el of document.querySelectorAll('main.container input, main.container textarea, main.container select')) {
    if (!el.name || el.disabled || el.type === 'hidden' || el.type === 'password') continue;
    const key = `${el.form?.getAttribute('action') || ''}|${el.name}|${el.type}`;
    const index = (seen.get(key) || 0) + 1;
    seen.set(key, index);
    snapshot.set(`${key}|${index}`, { value: el.value, checked: el.checked });
  }
  return snapshot;
}

function restoreFields(snapshot, submittedAction) {
  const seen = new Map();
  for (const el of document.querySelectorAll('main.container input, main.container textarea, main.container select')) {
    if (!el.name || el.disabled || el.type === 'hidden' || el.type === 'password') continue;
    const action = el.form?.getAttribute('action') || '';
    if (action === submittedAction) continue; // 本次提交的表单以服务端渲染为准（数据已经写进去了）
    const key = `${action}|${el.name}|${el.type}`;
    const index = (seen.get(key) || 0) + 1;
    seen.set(key, index);
    const row = snapshot.get(`${key}|${index}`);
    if (!row) continue;
    if (row.value !== el.value) el.value = row.value;
    if (row.checked !== el.checked) el.checked = row.checked;
  }
}

// 局部替换 <main>：页脚（含主题开关）就在 main 内部，服务端每次渲染的都是默认高亮，
// 直接换掉会把用户选好的主题重置成「跟随系统」——所以保留当前页脚节点、只换内容。
// 反馈卡片相反：它是本次操作的新消息，必须换新的。
function swapMain(next) {
  const nextMain = next.querySelector('main.container');
  const currentMain = document.querySelector('main.container');
  if (!nextMain || !currentMain) return false;
  const footer = currentMain.querySelector('.site-footer');
  nextMain.querySelector('.site-footer')?.remove();
  if (footer) nextMain.appendChild(footer);
  const nextHost = next.querySelector('[data-toast-host]');
  if (nextHost) document.querySelector('[data-toast-host]')?.replaceWith(nextHost);
  currentMain.replaceWith(nextMain);
  document.title = next.title;
  syncPopoverMask(); // 局部刷新会连浮窗一起换掉，遮罩要跟着收，否则页面一直发暗
  return true;
}

document.addEventListener('submit', async (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  if (!document.body.classList.contains('admin-body')) return; // 只接管后台；客人页面保持整页跳转
  if (event.defaultPrevented) return;                          // 已被确认框拦下，等它二次提交
  if (form.dataset.ajaxFallback) { delete form.dataset.ajaxFallback; return; }
  if (String(form.method).toLowerCase() !== 'post' || form.hasAttribute('data-no-ajax') || AJAX_SKIP.includes(form.getAttribute('action') || '')) return;

  event.preventDefault();
  const submitter = event.submitter instanceof HTMLElement ? event.submitter : null;
  const action = form.getAttribute('action') || location.pathname;
  const snapshot = collectFields();
  // 用 URLSearchParams 而不是 FormData：后者会发 multipart/form-data，服务端只解析 application/x-www-form-urlencoded
  const body = new URLSearchParams();
  for (const [name, value] of new FormData(form)) body.append(name, typeof value === 'string' ? value : value.name);
  if (submitter?.name && !body.has(submitter.name)) body.append(submitter.name, submitter.value);
  const buttons = form.querySelectorAll('button, input[type=submit]');
  for (const button of buttons) button.disabled = true; // 防重复提交（原先靠整页刷新挡住）

  try {
    const response = await fetch(action, { method: 'POST', body, credentials: 'same-origin', headers: { accept: 'text/html' } });
    const type = response.headers.get('content-type') || '';
    if (!response.ok || !type.includes('text/html')) throw new Error('fallback');
    const next = new DOMParser().parseFromString(await response.text(), 'text/html');
    const scrollY = window.scrollY;
    if (!swapMain(next)) throw new Error('fallback');
    if (response.url && response.url !== location.href) history.replaceState({}, '', response.url);
    placeToasts();
    armAllToasts();
    restoreFields(snapshot, action);
    window.scrollTo(0, scrollY); // 保持原位：不再跳回页面顶端
  } catch {
    for (const button of buttons) button.disabled = false;
    form.dataset.ajaxFallback = '1';
    if (typeof form.requestSubmit === 'function') form.requestSubmit(submitter || undefined);
    else form.submit();
  }
});

document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-copy-link]');
  if (!button) return;
  const original = button.textContent;
  button.disabled = true;
  try {
    const response = await fetch(button.dataset.copyLink, { headers: { accept: 'application/json' }, credentials: 'same-origin' });
    if (!response.ok) throw new Error('接口不可用');
    const data = await response.json();
    if (!data.url || !(await copyText(data.url))) throw new Error('复制失败');
    button.textContent = '已复制 ✓';
    showToast('核销链接已复制，可直接发给客人。');
  } catch {
    button.textContent = '复制失败，请打开详情页';
    showToast('复制失败，请打开详情页手动复制。', 'error');
  }
  button.disabled = false;
  setTimeout(() => { button.textContent = original; }, 2000);
});

// ---- 「刷新」局部更新（仅后台页）：重取当前地址、只换 <main> 与反馈卡片，保持滚动位置与未提交的输入 ----
document.addEventListener('click', async (event) => {
  const link = event.target.closest('[data-refresh]');
  if (!link || event.defaultPrevented) return;
  if (!document.body.classList.contains('admin-body')) return;
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; // 交回浏览器（新标签等）
  const url = link.getAttribute('href');
  if (!url || link.classList.contains('is-busy')) return;
  event.preventDefault();
  link.classList.add('is-busy');
  try {
    const response = await fetch(url, { headers: { accept: 'text/html' }, credentials: 'same-origin' });
    const type = response.headers.get('content-type') || '';
    if (!response.ok || !type.includes('text/html')) throw new Error('fallback');
    const next = new DOMParser().parseFromString(await response.text(), 'text/html');
    const snapshot = collectFields();
    const scrollY = window.scrollY;
    if (!swapMain(next)) throw new Error('fallback');
    placeToasts();
    armAllToasts();
    restoreFields(snapshot, '\u0000refresh'); // 刷新不是提交：页面上已输入但未提交的内容原样保留
    window.scrollTo(0, scrollY);
  } catch {
    location.href = url;
  } finally {
    link.classList.remove('is-busy');
  }
});
