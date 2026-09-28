// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 QNLanYang (全能岚漾)

// 页面内确认框：替代 window.confirm，避免被部分浏览器/内嵌 WebView 拦截或禁用。
let pending = null; // { form, submitter }
const mask = document.createElement('div');
mask.className = 'modal-mask';
mask.hidden = true;
mask.innerHTML = '<div class="modal-card" role="alertdialog" aria-modal="true" aria-labelledby="modal-title"><h3 id="modal-title"></h3><p class="modal-text"></p><div class="modal-actions"><button type="button" class="secondary" data-cancel>取消</button><button type="button" class="primary" data-ok>确认</button></div></div>';
document.body.appendChild(mask);
const modalTitle = mask.querySelector('#modal-title');
const modalText = mask.querySelector('.modal-text');
const okButton = mask.querySelector('[data-ok]');
const cancelButton = mask.querySelector('[data-cancel]');

function closeModal() {
  mask.hidden = true;
  pending = null;
}

function confirmSubmit() {
  const { form, submitter } = pending || {};
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
  mask.hidden = false;
  okButton.focus();
});

okButton.addEventListener('click', confirmSubmit);
cancelButton.addEventListener('click', closeModal);
mask.addEventListener('click', (event) => { if (event.target === mask) closeModal(); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !mask.hidden) closeModal(); });

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
  } catch {
    button.textContent = '复制失败，请打开详情页';
  }
  button.disabled = false;
  setTimeout(() => { button.textContent = original; }, 2000);
});
