// ============================================================
// Cintelis Workspace — Markdown Toolbar (Sprint 7)
// Small button row that attaches above a <textarea>. Gives
// users the common markdown affordances (bold, italic, lists,
// link, image, codeblock, etc.) without having to remember
// syntax. Loaded as a regular <script> after app.js; uses the
// global esc() helper from app.js at call time.
//
// Public globals:
//   attachMarkdownToolbar(textareaEl, options?)
//   applyMarkdownAction(textareaEl, action)
// ============================================================

// ── Icon constants ──────────────────────────────────────────
// Small inline SVGs at ~14x14 using currentColor so they pick
// up the button text color automatically. Keep paths simple.
// Outlook-style: thin 1.5px outlines, clean geometric shapes
const MD_ICON_HEADING = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M3 3v10M13 3v10M3 8h10"/></svg>';
const MD_ICON_UL = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="3" cy="4" r="1.2" fill="currentColor"/><circle cx="3" cy="8" r="1.2" fill="currentColor"/><circle cx="3" cy="12" r="1.2" fill="currentColor"/><line x1="6.5" y1="4" x2="14" y2="4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="6.5" y1="8" x2="14" y2="8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="6.5" y1="12" x2="14" y2="12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
const MD_ICON_OL = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><text x="1.5" y="5" font-size="5.5" font-weight="600" font-family="sans-serif">1.</text><text x="1.5" y="9" font-size="5.5" font-weight="600" font-family="sans-serif">2.</text><text x="1.5" y="13" font-size="5.5" font-weight="600" font-family="sans-serif">3.</text><line x1="7" y1="4" x2="14" y2="4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="7" y1="8" x2="14" y2="8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="7" y1="12" x2="14" y2="12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
const MD_ICON_CHECK = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="2" y="3" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.3"/><path d="M3.5 5.5l1 1L7 4.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><rect x="2" y="10" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.3"/><line x1="9" y1="5" x2="14" y2="5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="9" y1="12.5" x2="14" y2="12.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
const MD_ICON_CODE = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4.5L1.5 8 5 11.5"/><path d="M11 4.5L14.5 8 11 11.5"/><line x1="9" y1="3" x2="7" y2="13"/></svg>';
const MD_ICON_CODEBLOCK = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="1.5" y="2" width="13" height="12" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M5 7L3.5 8.5 5 10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M11 7l1.5 1.5L11 10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><line x1="9" y1="6" x2="7.5" y2="11" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
const MD_ICON_QUOTE = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M3.5 4C2.7 4 2 4.7 2 5.5V7h2.5V5.5h-1c0-.3.2-.5.5-.5h.5V4H3.5zM9.5 4C8.7 4 8 4.7 8 5.5V7h2.5V5.5h-1c0-.3.2-.5.5-.5h.5V4H9.5z" opacity=".9"/><line x1="2" y1="10" x2="14" y2="10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="2" y1="13" x2="11" y2="13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
const MD_ICON_LINK = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M6.8 9.2a2.5 2.5 0 0 0 3.5 0l2-2a2.5 2.5 0 0 0-3.5-3.5l-1 1"/><path d="M9.2 6.8a2.5 2.5 0 0 0-3.5 0l-2 2a2.5 2.5 0 0 0 3.5 3.5l1-1"/></svg>';
const MD_ICON_IMAGE = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" stroke-width="1.3"/><circle cx="5" cy="6" r="1.3" stroke="currentColor" stroke-width="1.2"/><path d="M1.5 11.5l3-3.5 2.5 3 2-2.5 5 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// Outlook-style toolbar icons: letter-based for text formatting, thin outlines for tools
const MD_ICON_BOLD = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4.5 2H9a3 3 0 0 1 1.9 5.3A3.2 3.2 0 0 1 9.5 14H4.5V2zM7 4v3h2a1.5 1.5 0 0 0 0-3H7zm0 5v3h2.5a1.5 1.5 0 0 0 0-3H7z"/></svg>';
const MD_ICON_ITALIC = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M10 2h-1l-3 12h-1l.4-1.5h1.1L9.3 3.5H8.2L8.6 2H10zM6.5 14h3l-.4-1.5H6.1L6.5 14zM9.5 2H13l-.4 1.5H9.1L9.5 2z"/></svg>';
const MD_ICON_STRIKE = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" stroke-width="1.5"/><path d="M10.5 4.5C10 3.5 9 3 7.8 3 6.2 3 5 3.8 5 5c0 1 .8 1.6 2 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none"/><path d="M5.5 11.5C6 12.5 7 13 8.2 13c1.6 0 2.8-.8 2.8-2 0-1-.8-1.6-2-2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none"/></svg>';

const TOOLBAR_BUTTONS = [
  { id: 'bold',      title: 'Bold (Ctrl+B)',       label: MD_ICON_BOLD },
  { id: 'italic',    title: 'Italic (Ctrl+I)',     label: MD_ICON_ITALIC },
  { id: 'strike',    title: 'Strikethrough',       label: MD_ICON_STRIKE },
  { id: 'heading',   title: 'Heading',             label: MD_ICON_HEADING },
  { id: 'ul',        title: 'Bulleted list',       label: MD_ICON_UL },
  { id: 'ol',        title: 'Numbered list',       label: MD_ICON_OL },
  { id: 'check',     title: 'Task list',           label: MD_ICON_CHECK },
  { id: 'code',      title: 'Inline code',         label: MD_ICON_CODE },
  { id: 'codeblock', title: 'Code block',          label: MD_ICON_CODEBLOCK },
  { id: 'quote',     title: 'Quote',               label: MD_ICON_QUOTE },
  { id: 'link',      title: 'Link',                label: MD_ICON_LINK },
  { id: 'image',     title: 'Add image, video, or file',  label: MD_ICON_IMAGE }
];

// Groups with dividers for visual rhythm.
const TOOLBAR_DIVIDER_AFTER = { strike: true, check: true, quote: true };

// ── Public: attach ──────────────────────────────────────────
function attachMarkdownToolbar(textareaEl, options) {
  if (!textareaEl || textareaEl.tagName !== 'TEXTAREA') return;
  if (textareaEl.dataset.mdToolbarAttached === '1') return;
  textareaEl.dataset.mdToolbarAttached = '1';

  const opts = options || {};
  let buttons = TOOLBAR_BUTTONS;
  if (Array.isArray(opts.buttons) && opts.buttons.length) {
    const allowed = new Set(opts.buttons);
    buttons = TOOLBAR_BUTTONS.filter(b => allowed.has(b.id));
  } else if (opts.compact) {
    const keep = new Set(['bold','italic','heading','ul','ol','check','code','link']);
    buttons = TOOLBAR_BUTTONS.filter(b => keep.has(b.id));
  }

  const bar = document.createElement('div');
  bar.className = 'md-toolbar';

  buttons.forEach(btn => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'md-toolbar-btn';
    el.title = btn.title;
    el.setAttribute('aria-label', btn.title);
    el.dataset.mdAction = btn.id;
    el.innerHTML = btn.label;
    el.addEventListener('mousedown', (ev) => {
      // mousedown + preventDefault so the textarea keeps focus/selection.
      ev.preventDefault();
    });
    el.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      applyMarkdownAction(textareaEl, btn.id, el);
    });
    bar.appendChild(el);

    if (TOOLBAR_DIVIDER_AFTER[btn.id]) {
      const sep = document.createElement('span');
      sep.className = 'md-toolbar-divider';
      sep.setAttribute('aria-hidden', 'true');
      bar.appendChild(sep);
    }
  });

  // Insert before the textarea so it renders above it visually.
  if (textareaEl.parentNode) {
    textareaEl.parentNode.insertBefore(bar, textareaEl);
  }
}
window.attachMarkdownToolbar = attachMarkdownToolbar;

// ── Text manipulation helpers ───────────────────────────────
function getCurrentLineRange(textarea) {
  const value = textarea.value || '';
  const start = textarea.selectionStart || 0;
  const end = textarea.selectionEnd || 0;
  let lineStart = value.lastIndexOf('\n', start - 1) + 1;
  let lineEnd = value.indexOf('\n', end);
  if (lineEnd === -1) lineEnd = value.length;
  return { start: lineStart, end: lineEnd };
}

function wrapSelection(textarea, before, after, placeholder) {
  const value = textarea.value || '';
  const ss = textarea.selectionStart || 0;
  const se = textarea.selectionEnd || 0;
  const selected = value.slice(ss, se);
  let insert;
  let cursorStart;
  let cursorEnd;
  if (selected.length) {
    insert = before + selected + after;
    cursorStart = ss + before.length;
    cursorEnd = cursorStart + selected.length;
  } else {
    insert = before + placeholder + after;
    cursorStart = ss + before.length;
    cursorEnd = cursorStart + placeholder.length;
  }
  textarea.value = value.slice(0, ss) + insert + value.slice(se);
  try { textarea.setSelectionRange(cursorStart, cursorEnd); } catch (e) { /* ignore */ }
  fireInput(textarea);
}

function prefixLines(textarea, prefixOrFn) {
  const value = textarea.value || '';
  const ss = textarea.selectionStart || 0;
  const se = textarea.selectionEnd || 0;
  const range = getCurrentLineRange(textarea);
  // Expand to cover all lines inside the selection.
  const lineStart = Math.min(ss, range.start);
  let lineEnd = range.end;
  if (se > range.end) {
    let e = value.indexOf('\n', se);
    if (e === -1) e = value.length;
    lineEnd = e;
  }
  const block = value.slice(lineStart, lineEnd);
  const lines = block.split('\n');
  const newLines = lines.map((line, idx) => {
    const prefix = typeof prefixOrFn === 'function' ? prefixOrFn(line, idx) : prefixOrFn;
    return prefix + line;
  });
  const rebuilt = newLines.join('\n');
  textarea.value = value.slice(0, lineStart) + rebuilt + value.slice(lineEnd);
  const newEnd = lineStart + rebuilt.length;
  try { textarea.setSelectionRange(lineStart, newEnd); } catch (e) { /* ignore */ }
  fireInput(textarea);
}

function fireInput(textarea) {
  try { textarea.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) { /* ignore */ }
  try { textarea.focus(); } catch (e) { /* ignore */ }
}

// ── Public: apply action ────────────────────────────────────
function applyMarkdownAction(textarea, action, anchorEl) {
  if (!textarea) return;
  try { textarea.focus(); } catch (e) { /* ignore */ }
  switch (action) {
    case 'bold':
      wrapSelection(textarea, '**', '**', 'bold text');
      return;
    case 'italic':
      wrapSelection(textarea, '*', '*', 'italic');
      return;
    case 'strike':
      wrapSelection(textarea, '~~', '~~', 'strikethrough');
      return;
    case 'heading': {
      const value = textarea.value || '';
      const range = getCurrentLineRange(textarea);
      const line = value.slice(range.start, range.end);
      // Upgrade existing heading: # → ##, ## → ###, ### → (plain)
      let newLine;
      const m = line.match(/^(#{1,6})\s+/);
      if (m) {
        const level = m[1].length;
        if (level >= 3) {
          newLine = line.slice(m[0].length);
        } else {
          newLine = '#'.repeat(level + 1) + ' ' + line.slice(m[0].length);
        }
      } else {
        newLine = '## ' + line;
      }
      textarea.value = value.slice(0, range.start) + newLine + value.slice(range.end);
      const pos = range.start + newLine.length;
      try { textarea.setSelectionRange(pos, pos); } catch (e) { /* ignore */ }
      fireInput(textarea);
      return;
    }
    case 'ul':
      prefixLines(textarea, '- ');
      return;
    case 'ol':
      prefixLines(textarea, (_line, idx) => (idx + 1) + '. ');
      return;
    case 'check':
      prefixLines(textarea, '- [ ] ');
      return;
    case 'code':
      wrapSelection(textarea, '`', '`', 'code');
      return;
    case 'codeblock': {
      const value = textarea.value || '';
      const ss = textarea.selectionStart || 0;
      const se = textarea.selectionEnd || 0;
      const selected = value.slice(ss, se) || 'code here';
      // Ensure fences are on their own lines.
      const leading = (ss > 0 && value.charAt(ss - 1) !== '\n') ? '\n' : '';
      const trailing = (se < value.length && value.charAt(se) !== '\n') ? '\n' : '';
      const insert = leading + '```\n' + selected + '\n```' + trailing;
      textarea.value = value.slice(0, ss) + insert + value.slice(se);
      const innerStart = ss + leading.length + 4; // after "```\n"
      const innerEnd = innerStart + selected.length;
      try { textarea.setSelectionRange(innerStart, innerEnd); } catch (e) { /* ignore */ }
      fireInput(textarea);
      return;
    }
    case 'quote':
      prefixLines(textarea, '> ');
      return;
    case 'link':
      openMdLinkPopup(textarea, anchorEl, false);
      return;
    case 'image':
      openMdLinkPopup(textarea, anchorEl, true);
      return;
    default:
      return;
  }
}
window.applyMarkdownAction = applyMarkdownAction;

// ── Link / image popup ──────────────────────────────────────
let __mdLinkPopupEl = null;
let __mdLinkOutsideHandler = null;
let __mdLinkKeyHandler = null;

function closeMdLinkPopup() {
  if (__mdLinkPopupEl && __mdLinkPopupEl.parentNode) {
    __mdLinkPopupEl.parentNode.removeChild(__mdLinkPopupEl);
  }
  __mdLinkPopupEl = null;
  if (__mdLinkOutsideHandler) {
    document.removeEventListener('mousedown', __mdLinkOutsideHandler, true);
    __mdLinkOutsideHandler = null;
  }
  if (__mdLinkKeyHandler) {
    document.removeEventListener('keydown', __mdLinkKeyHandler, true);
    __mdLinkKeyHandler = null;
  }
}

function openMdLinkPopup(textarea, anchorEl, isImage) {
  closeMdLinkPopup();

  const value = textarea.value || '';
  const ss = textarea.selectionStart || 0;
  const se = textarea.selectionEnd || 0;
  const selected = value.slice(ss, se);

  const popup = document.createElement('div');
  popup.className = 'md-link-popup';
  const uploadSection = isImage ? `
    <div class="md-upload-zone" id="md-upload-zone">
      <input type="file" id="md-upload-file" style="display:none" accept="image/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip">
      <div style="cursor:pointer;text-align:center;padding:12px;border:1.5px dashed var(--border2);border-radius:6px;color:var(--muted);font-size:13px" onclick="document.getElementById('md-upload-file').click()">
        Drop file here or <span style="color:#6E5CCC;font-weight:600">browse</span>
        <div class="text-muted text-sm" style="margin-top:4px">Images, videos, or files (max 25 MB)</div>
      </div>
      <div id="md-upload-status" class="text-sm" style="margin-top:6px;min-height:1em"></div>
    </div>
    <div style="text-align:center;color:var(--muted2);font-size:11px;margin:10px 0;text-transform:uppercase;letter-spacing:1px">or paste a URL</div>
  ` : '';
  popup.innerHTML = `
    ${uploadSection}
    <label>${isImage ? 'Alt text' : 'Text'}
      <input type="text" class="md-link-text" value="" />
    </label>
    <label>URL
      <input type="text" class="md-link-url" placeholder="https://" value="" />
    </label>
    <div class="actions">
      <button type="button" class="btn btn-ghost btn-sm md-link-cancel">Cancel</button>
      <button type="button" class="btn btn-primary btn-sm md-link-insert">Insert</button>
    </div>
  `;

  // Anchor near the toolbar button (or the textarea as a fallback).
  const anchor = anchorEl || textarea;
  const r = anchor.getBoundingClientRect();
  popup.style.position = 'fixed';
  popup.style.top = (r.bottom + 6) + 'px';
  popup.style.left = Math.max(8, Math.min(window.innerWidth - 280, r.left)) + 'px';

  document.body.appendChild(popup);
  __mdLinkPopupEl = popup;

  const textInput = popup.querySelector('.md-link-text');
  const urlInput = popup.querySelector('.md-link-url');
  if (textInput) textInput.value = selected || '';
  try { (selected ? urlInput : textInput).focus(); } catch (e) { /* ignore */ }

  const doInsert = () => {
    const text = (textInput && textInput.value) || (isImage ? 'image' : 'link');
    const url = (urlInput && urlInput.value) || '';
    const md = isImage ? `![${text}](${url})` : `[${text}](${url})`;
    const v = textarea.value || '';
    textarea.value = v.slice(0, ss) + md + v.slice(se);
    const pos = ss + md.length;
    try { textarea.setSelectionRange(pos, pos); } catch (e) { /* ignore */ }
    closeMdLinkPopup();
    fireInput(textarea);
  };

  popup.querySelector('.md-link-insert').addEventListener('click', (ev) => {
    ev.preventDefault();
    doInsert();
  });
  popup.querySelector('.md-link-cancel').addEventListener('click', (ev) => {
    ev.preventDefault();
    closeMdLinkPopup();
  });
  [textInput, urlInput].forEach(inp => {
    if (!inp) return;
    inp.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        doInsert();
      }
    });
  });

  __mdLinkOutsideHandler = function (ev) {
    if (!__mdLinkPopupEl) return;
    if (__mdLinkPopupEl.contains(ev.target)) return;
    closeMdLinkPopup();
  };
  __mdLinkKeyHandler = function (ev) {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      closeMdLinkPopup();
      try { textarea.focus(); } catch (e) { /* ignore */ }
    }
  };
  // Defer so the click that opened the popup doesn't immediately close it.
  setTimeout(() => {
    document.addEventListener('mousedown', __mdLinkOutsideHandler, true);
    document.addEventListener('keydown', __mdLinkKeyHandler, true);
  }, 0);

  // File upload handler (image popup only)
  if (isImage) {
    const fileInput = popup.querySelector('#md-upload-file');
    const uploadZone = popup.querySelector('#md-upload-zone');
    const statusEl = popup.querySelector('#md-upload-status');
    if (fileInput) {
      fileInput.addEventListener('change', async () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        await handleMdFileUpload(file, textarea, ss, se, statusEl);
      });
    }
    if (uploadZone) {
      uploadZone.addEventListener('dragover', ev => { ev.preventDefault(); uploadZone.style.borderColor = '#6E5CCC'; });
      uploadZone.addEventListener('dragleave', () => { uploadZone.style.borderColor = ''; });
      uploadZone.addEventListener('drop', async ev => {
        ev.preventDefault();
        uploadZone.style.borderColor = '';
        const file = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
        if (!file) return;
        await handleMdFileUpload(file, textarea, ss, se, statusEl);
      });
    }
  }
}

async function handleMdFileUpload(file, textarea, ss, se, statusEl) {
  // Determine entity context from current state
  let entityType = '';
  let entityId = '';
  if (typeof currentIssue !== 'undefined' && currentIssue && currentIssue.id) {
    entityType = 'issue';
    entityId = currentIssue.id;
  } else if (state.docs && state.docs.page && state.docs.page.id) {
    entityType = 'doc_page';
    entityId = state.docs.page.id;
  }
  if (!entityType) {
    if (statusEl) { statusEl.textContent = 'Save the page first, then add files'; statusEl.style.color = 'var(--red)'; }
    return;
  }
  if (statusEl) { statusEl.textContent = 'Uploading ' + file.name + '...'; statusEl.style.color = 'var(--muted)'; }
  try {
    if (typeof uploadOneFile !== 'function') throw new Error('Upload not available');
    const att = await uploadOneFile(file, entityType, entityId);
    if (!att || !att.id) throw new Error('Upload returned no data');
    const mime = String(att.mime_type || '').toLowerCase();
    const isImg = mime.startsWith('image/');
    // Browser-native inline-previewable types open in-tab via /preview;
    // anything else falls back to /download. Store URLs without a session
    // token — renderMarkdown() injects a fresh one at display time.
    const inlinePreviewable = isImg
      || mime === 'application/pdf'
      || mime.startsWith('text/')
      || mime.startsWith('video/')
      || mime.startsWith('audio/')
      || mime === 'application/json';
    const endpoint = inlinePreviewable ? '/preview' : '/download';
    const url = '/api/attachments/' + encodeURIComponent(att.id) + endpoint;
    const md = isImg
      ? '![' + (att.filename || 'image') + '](' + url + ')'
      : '[' + (att.filename || 'file') + '](' + url + ')';
    const v = textarea.value || '';
    textarea.value = v.slice(0, ss) + md + v.slice(se);
    const pos = ss + md.length;
    try { textarea.setSelectionRange(pos, pos); } catch {}
    closeMdLinkPopup();
    fireInput(textarea);
    if (typeof toastSuccess === 'function') toastSuccess('File uploaded and inserted');
  } catch (e) {
    if (statusEl) { statusEl.textContent = 'Upload failed: ' + (e.message || e); statusEl.style.color = 'var(--red)'; }
  }
}
window.closeMdLinkPopup = closeMdLinkPopup;
