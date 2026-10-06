// ============================================================
// Cintelis — branded dialogs replacing the browser's confirm(),
// prompt() and alert(). Centered on screen, themed with the app's
// tokens, keyboard friendly (Enter confirms, Escape cancels).
//
// Public globals, all returning Promises:
//   appConfirm(message, { title, confirmText, cancelText, danger }) → boolean
//   appPrompt(message, { title, value, placeholder, confirmText, danger }) → string | null
//   appAlert(message, { title }) → undefined
//
// Loaded before app.js so every script can use them.
// ============================================================

const APP_DIALOG_MARK = '<svg width="28" height="28" viewBox="0 0 120 120" aria-hidden="true"><g fill="none"><path d="M93.71 31.72 A44 44 0 1 0 93.71 88.28" stroke="currentColor" stroke-width="14"/><path d="M93.71 31.72 A44 44 0 0 0 66.12 16.43" stroke="#5B7CFA" stroke-width="14"/></g></svg>';

// Destructive wording gets the red button without every caller saying so.
const APP_DIALOG_DANGER = /\b(delete|remove|deactivate|revoke|disconnect|reset|discard|regenerate)\b/i;

function appDialog(kind, message, opts) {
  opts = opts || {};
  return new Promise((resolve) => {
    const previousFocus = document.activeElement;
    const text = String(message == null ? '' : message);
    // A dialog's first line is its question; anything after a blank line is detail.
    const [lead, ...rest] = text.split(/\n\s*\n/);
    const danger = opts.danger != null ? !!opts.danger : (kind !== 'alert' && APP_DIALOG_DANGER.test(lead));

    const bg = document.createElement('div');
    bg.className = 'app-dialog-bg';
    const box = document.createElement('div');
    box.className = 'app-dialog' + (danger ? ' app-dialog-danger' : '');
    box.setAttribute('role', kind === 'alert' ? 'alertdialog' : 'dialog');
    box.setAttribute('aria-modal', 'true');

    const head = document.createElement('div');
    head.className = 'app-dialog-head';
    head.innerHTML = APP_DIALOG_MARK;
    const title = document.createElement('div');
    title.className = 'app-dialog-title';
    title.textContent = opts.title || (kind === 'alert' ? 'Cintelis' : danger ? 'Please confirm' : 'Confirm');
    head.appendChild(title);
    box.appendChild(head);

    const msg = document.createElement('p');
    msg.className = 'app-dialog-message';
    msg.textContent = lead;
    box.appendChild(msg);
    if (rest.length) {
      const detail = document.createElement('p');
      detail.className = 'app-dialog-detail';
      detail.textContent = rest.join('\n\n');
      box.appendChild(detail);
    }

    let input = null;
    if (kind === 'prompt') {
      input = document.createElement('input');
      input.type = 'text';
      input.className = 'app-dialog-input';
      input.value = opts.value || '';
      if (opts.placeholder) input.placeholder = opts.placeholder;
      box.appendChild(input);
    }

    const foot = document.createElement('div');
    foot.className = 'app-dialog-foot';
    let cancel = null;
    if (kind !== 'alert') {
      cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'btn btn-ghost';
      cancel.textContent = opts.cancelText || 'Cancel';
      foot.appendChild(cancel);
    }
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'btn ' + (danger ? 'btn-danger' : 'btn-primary');
    ok.textContent = opts.confirmText || (kind === 'alert' ? 'OK' : kind === 'prompt' ? 'Save' : 'Confirm');
    foot.appendChild(ok);
    box.appendChild(foot);
    bg.appendChild(box);

    function finish(result) {
      document.removeEventListener('keydown', onKey, true);
      bg.classList.add('app-dialog-leaving');
      setTimeout(() => bg.remove(), 150);
      if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
      resolve(result);
    }
    const accept = () => finish(kind === 'prompt' ? input.value : kind === 'confirm' ? true : undefined);
    const dismiss = () => finish(kind === 'prompt' ? null : kind === 'confirm' ? false : undefined);

    // Capture phase, so Escape closes this dialog and not the modal underneath it.
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); dismiss(); }
      else if (e.key === 'Enter' && (document.activeElement === input || !box.contains(document.activeElement) || document.activeElement === ok)) {
        e.preventDefault(); e.stopImmediatePropagation(); accept();
      } else if (e.key === 'Tab') {
        const items = [input, cancel, ok].filter(Boolean);
        const i = items.indexOf(document.activeElement);
        e.preventDefault();
        items[(i + (e.shiftKey ? items.length - 1 : 1)) % items.length].focus();
      }
    }
    document.addEventListener('keydown', onKey, true);
    ok.addEventListener('click', accept);
    if (cancel) cancel.addEventListener('click', dismiss);
    let pressOnBg = false;
    bg.addEventListener('mousedown', (e) => { pressOnBg = e.target === bg; });
    bg.addEventListener('click', (e) => { if (e.target === bg && pressOnBg && kind !== 'prompt') dismiss(); pressOnBg = false; });

    document.body.appendChild(bg);
    // Destructive actions start on Cancel, so a stray Enter cannot delete anything.
    (input || (danger && cancel) || ok).focus();
    if (input) input.select();
  });
}

function appConfirm(message, opts) { return appDialog('confirm', message, opts); }
function appPrompt(message, opts) { return appDialog('prompt', message, opts); }
function appAlert(message, opts) { return appDialog('alert', message, opts); }
window.appConfirm = appConfirm;
window.appPrompt = appPrompt;
window.appAlert = appAlert;
