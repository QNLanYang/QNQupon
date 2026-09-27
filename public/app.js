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

// 日期输入：留空时降级为文本框显示“留空表示不限”，聚焦时再唤起原生日历。
document.querySelectorAll('input.date-input').forEach((input) => {
  const placeholder = input.dataset.placeholder || '留空表示不限';
  const sync = () => {
    if (input.value) {
      input.type = 'date';
      input.placeholder = '';
    } else {
      input.type = 'text';
      input.placeholder = placeholder;
    }
  };
  input.addEventListener('focus', () => { input.type = 'date'; });
  input.addEventListener('blur', sync);
  sync();
});

const preset = document.querySelector('#preset-select');
if (preset) preset.addEventListener('change', () => {
  const option = preset.options[preset.selectedIndex];
  if (option?.dataset.instructions) document.querySelector('#instructions').value = option.dataset.instructions;
  if (option?.dataset.store) document.querySelector('#store-text').value = option.dataset.store;
});

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
