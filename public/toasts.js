// ============================================================
// Cintelis Workspace — Toasts (Sprint 7)
// Small stack of transient notifications replacing alert().
// Loaded as a regular <script> after app.js. No dependencies.
//
// Public globals:
//   toast(message, type?, duration?)
//   toastSuccess / toastError / toastWarn / toastInfo
//   dismissToast(toastEl)
// ============================================================

(function () {
  if (!window.__toasts) window.__toasts = { items: [] };
})();

const TOAST_MAX_STACK = 5;
const TOAST_ICONS = {
  success: '\u2713',
  error:   '\u2715',
  warn:    '!',
  info:    '\u2139'
};

function ensureToastStack() {
  let stack = document.getElementById('toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.id = 'toast-stack';
    stack.className = 'toast-stack';
    stack.setAttribute('role', 'status');
    stack.setAttribute('aria-live', 'polite');
    document.body.appendChild(stack);
  }
  return stack;
}

function toast(message, type, duration) {
  const kind = (type === 'success' || type === 'error' || type === 'warn' || type === 'info') ? type : 'info';
  const dur = Number.isFinite(duration) ? Number(duration) : 3500;
  const stack = ensureToastStack();

  const el = document.createElement('div');
  el.className = 'toast toast-' + kind;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');

  const icon = document.createElement('span');
  icon.className = 'toast-icon';
  icon.textContent = TOAST_ICONS[kind] || '';
  el.appendChild(icon);

  const msg = document.createElement('span');
  msg.className = 'toast-message';
  // Plain text is safe — we never innerHTML the message.
  msg.textContent = String(message == null ? '' : message);
  el.appendChild(msg);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'toast-close';
  close.setAttribute('aria-label', 'Dismiss');
  close.textContent = '\u00D7';
  close.addEventListener('click', (ev) => {
    ev.stopPropagation();
    dismissToast(el);
  });
  el.appendChild(close);

  el.addEventListener('click', () => dismissToast(el));

  // Track timing so we can pause on hover.
  const rec = {
    el: el,
    duration: dur,
    remaining: dur,
    startedAt: Date.now(),
    timer: null
  };

  const scheduleDismiss = (ms) => {
    if (rec.timer) clearTimeout(rec.timer);
    if (!Number.isFinite(ms) || ms <= 0) return;
    rec.timer = setTimeout(() => dismissToast(el), ms);
    rec.startedAt = Date.now();
  };

  el.addEventListener('mouseenter', () => {
    if (rec.timer) {
      clearTimeout(rec.timer);
      rec.timer = null;
      const elapsed = Date.now() - rec.startedAt;
      rec.remaining = Math.max(400, rec.remaining - elapsed);
    }
  });
  el.addEventListener('mouseleave', () => {
    scheduleDismiss(rec.remaining);
  });

  stack.appendChild(el);
  window.__toasts.items.push(rec);

  // Cap the stack.
  while (window.__toasts.items.length > TOAST_MAX_STACK) {
    const old = window.__toasts.items.shift();
    if (old && old.el) {
      if (old.timer) clearTimeout(old.timer);
      if (old.el.parentNode) old.el.parentNode.removeChild(old.el);
    }
  }

  scheduleDismiss(dur);
  return el;
}
window.toast = toast;

function dismissToast(toastEl) {
  if (!toastEl) return;
  const items = window.__toasts.items;
  const idx = items.findIndex(r => r.el === toastEl);
  if (idx >= 0) {
    const rec = items[idx];
    if (rec.timer) clearTimeout(rec.timer);
    items.splice(idx, 1);
  }
  if (toastEl.classList.contains('toast-leaving')) return;
  toastEl.classList.add('toast-leaving');
  setTimeout(() => {
    if (toastEl.parentNode) toastEl.parentNode.removeChild(toastEl);
  }, 200);
}
window.dismissToast = dismissToast;

function toastSuccess(msg, dur) { return toast(msg, 'success', dur); }
function toastError(msg, dur)   { return toast(msg, 'error', dur == null ? 5000 : dur); }
function toastWarn(msg, dur)    { return toast(msg, 'warn', dur); }
function toastInfo(msg, dur)    { return toast(msg, 'info', dur); }
window.toastSuccess = toastSuccess;
window.toastError = toastError;
window.toastWarn = toastWarn;
window.toastInfo = toastInfo;
