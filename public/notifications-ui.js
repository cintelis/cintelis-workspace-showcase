// ============================================================
// Cintelis Workspace — Notifications UI (Sprint 5)
// Bell icon + inbox dropdown + @mention autocomplete.
// Loaded as a regular <script> tag after app.js, so everything
// here lives on the global scope and freely uses helpers from
// app.js: state, api(), esc(), nav(), currentSection, etc.
// Main thread wires the #inbox-bell and #inbox-badge markup in
// index.html and the script tag; this file exposes all the
// globals needed by that markup.
// ============================================================

(function () {
  state.inbox = state.inbox || {};
  if (!('items' in state.inbox)) state.inbox.items = [];
  if (!('unread_count' in state.inbox)) state.inbox.unread_count = 0;
  if (!('open' in state.inbox)) state.inbox.open = false;
  if (!('loading' in state.inbox)) state.inbox.loading = false;
  state.mentionAutocomplete = state.mentionAutocomplete || { open: false, items: [], active: 0, target: null };
})();

// ── Icons / constants ────────────────────────────────────────
const INBOX_ICONS = {
  contract_upload: '📝',
  mention: '@',
  assignment: '\u{1F464}',
  comment: '\u{1F4AC}',
  status_change: '\u21BB',
  doc_update: '\u{1F4C4}'
};

function inboxIconHtml(kind) {
  const ch = INBOX_ICONS[kind] || '\u2022';
  return `<span class="inbox-row-icon">${esc(ch)}</span>`;
}

// ── Inbox: loaders ───────────────────────────────────────────
async function loadInbox() {
  state.inbox.loading = true;
  const r = await api('GET', '/api/me/notifications?limit=20');
  state.inbox.loading = false;
  if (r && Array.isArray(r.notifications)) {
    state.inbox.items = r.notifications;
    // Prefer the canonical unread count if the endpoint returned it;
    // otherwise compute from the items list as a fallback.
    if (typeof r.unread_count === 'number') {
      state.inbox.unread_count = r.unread_count;
    } else {
      state.inbox.unread_count = r.notifications.filter(n => !n.read_at).length;
    }
  } else {
    state.inbox.items = [];
  }
  renderInboxBadge();
  if (state.inbox.open) renderInboxDropdown();
}
window.loadInbox = loadInbox;

async function refreshUnreadCount() {
  const r = await api('GET', '/api/me/notifications/unread-count');
  if (r && typeof r.unread_count === 'number') {
    state.inbox.unread_count = r.unread_count;
    renderInboxBadge();
  }
}
window.refreshUnreadCount = refreshUnreadCount;

function renderInboxBadge() {
  const badge = document.getElementById('inbox-badge');
  if (!badge) return;
  const n = Number(state.inbox.unread_count || 0);
  if (n <= 0) {
    badge.textContent = '';
    badge.style.display = 'none';
    return;
  }
  badge.textContent = n > 9 ? '9+' : String(n);
  badge.style.display = 'inline-flex';
}
window.renderInboxBadge = renderInboxBadge;

// ── Inbox: dropdown open/close ───────────────────────────────
function toggleInbox(ev) {
  if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
  if (state.inbox.open) {
    closeInbox();
    return;
  }
  state.inbox.open = true;
  // Render an empty shell immediately, then load fresh items.
  renderInboxDropdown();
  loadInbox();
  setupInboxClickOutside();
}
window.toggleInbox = toggleInbox;

function closeInbox() {
  state.inbox.open = false;
  const dd = document.getElementById('inbox-dropdown');
  if (dd && dd.parentNode) dd.parentNode.removeChild(dd);
  if (__inboxClickOutsideHandler) {
    document.removeEventListener('click', __inboxClickOutsideHandler, true);
    __inboxClickOutsideHandler = null;
  }
}
window.closeInbox = closeInbox;

let __inboxClickOutsideHandler = null;
function setupInboxClickOutside() {
  if (__inboxClickOutsideHandler) {
    document.removeEventListener('click', __inboxClickOutsideHandler, true);
  }
  __inboxClickOutsideHandler = function (ev) {
    const dd = document.getElementById('inbox-dropdown');
    const bell = document.getElementById('inbox-bell');
    const t = ev.target;
    if (dd && dd.contains(t)) return;
    if (bell && bell.contains(t)) return;
    closeInbox();
  };
  document.addEventListener('click', __inboxClickOutsideHandler, true);
}

// ── Inbox: dropdown render ───────────────────────────────────
function renderInboxDropdown() {
  let dd = document.getElementById('inbox-dropdown');
  if (!dd) {
    dd = document.createElement('div');
    dd.id = 'inbox-dropdown';
    dd.className = 'inbox-dropdown';
    // Anchor: append to body; CSS positions it fixed near the bell.
    document.body.appendChild(dd);
    // Position relative to the bell icon at render time.
    const bell = document.getElementById('inbox-bell');
    if (bell) {
      const r = bell.getBoundingClientRect();
      dd.style.position = 'fixed';
      dd.style.top = (r.bottom + 6) + 'px';
      // Right-align the dropdown to the bell (typical topbar menu).
      dd.style.right = (Math.max(8, window.innerWidth - r.right)) + 'px';
    }
  }
  dd.classList.add('open');

  const items = Array.isArray(state.inbox.items) ? state.inbox.items : [];
  const unread = items.filter(n => !n.read_at);
  const earlier = items.filter(n => !!n.read_at);
  const unreadCount = Number(state.inbox.unread_count || 0);

  const head = `
    <div class="inbox-head">
      <div class="inbox-head-title">Notifications</div>
      ${unreadCount > 0
        ? '<button class="btn btn-ghost btn-sm" type="button" onclick="markAllNotificationsRead()">Mark all read</button>'
        : ''}
    </div>
  `;

  let body;
  if (state.inbox.loading && !items.length) {
    body = '<div class="inbox-empty">Loading\u2026</div>';
  } else if (!items.length) {
    body = '<div class="inbox-empty">You\u2019re all caught up. \u2728</div>';
  } else {
    const renderSection = (label, rows) => {
      if (!rows.length) return '';
      return `
        <div class="inbox-section-label">${esc(label)}</div>
        ${rows.map(renderInboxRow).join('')}
      `;
    };
    body = renderSection('Unread', unread) + renderSection('Earlier', earlier);
  }

  const foot = `
    <div class="inbox-foot">
      <a href="javascript:void(0)" onclick="closeInbox()">Close</a>
    </div>
  `;

  dd.innerHTML = head + '<div class="inbox-body">' + body + '</div>' + foot;
}
window.renderInboxDropdown = renderInboxDropdown;

function renderInboxRow(n) {
  const unreadCls = n.read_at ? '' : ' unread';
  const actor = n.actor || null;
  const who = actor ? (actor.display_name || actor.email || 'Someone') : 'System';
  const when = relTime(n.created_at);
  const title = n.title || '';
  const bodyText = n.body || '';
  const link = n.link || '';
  return `
    <div class="inbox-row${unreadCls}" onclick="markNotificationRead('${esc(n.id)}', '${esc(link)}')">
      ${inboxIconHtml(n.kind)}
      <div class="inbox-row-text">
        <div class="inbox-row-title">${esc(title)}</div>
        ${bodyText ? `<div class="inbox-row-body">${esc(bodyText)}</div>` : ''}
        <div class="inbox-row-meta">
          <span>${esc(who)}</span>
          <span class="inbox-row-time">${esc(when)}</span>
        </div>
      </div>
    </div>
  `;
}

// ── Inbox: mark read ─────────────────────────────────────────
async function markNotificationRead(id, link) {
  // Optimistic local update.
  const row = (state.inbox.items || []).find(n => n.id === id);
  if (row && !row.read_at) {
    row.read_at = new Date().toISOString();
    state.inbox.unread_count = Math.max(0, Number(state.inbox.unread_count || 0) - 1);
    renderInboxBadge();
  }
  // Fire-and-forget server write. Idempotent.
  api('POST', `/api/me/notifications/${encodeURIComponent(id)}/read`).catch(() => {});
  closeInbox();
  // Parse the link for entity references and navigate directly.
  if (link) {
    const params = new URLSearchParams(String(link).replace(/^[^?]*\??/, ''));
    const issueId = params.get('issue');
    const pageId = params.get('page');
    const spaceId = params.get('space');
    if (issueId && typeof openIssueDetail === 'function') {
      openIssueDetail(issueId);
      return;
    }
    if (pageId) {
      if (typeof state !== 'undefined') {
        state.ui.docsPageId = pageId;
        if (spaceId) state.ui.docsSpaceId = spaceId;
      }
      if (typeof nav === 'function') nav('docs');
      return;
    }
    const customerId = params.get('customer');
    if (customerId && typeof openCustomer === 'function') { openCustomer(customerId); return; }
    const navTarget = params.get('nav');
    if (navTarget && typeof nav === 'function') { nav(navTarget); return; }
  }
  if (typeof nav === 'function') nav('overview');
}
window.markNotificationRead = markNotificationRead;

async function markAllNotificationsRead() {
  // Optimistic local update.
  (state.inbox.items || []).forEach(n => { if (!n.read_at) n.read_at = new Date().toISOString(); });
  state.inbox.unread_count = 0;
  renderInboxBadge();
  if (state.inbox.open) renderInboxDropdown();
  const r = await api('POST', '/api/me/notifications/read-all');
  if (!r || r.error) {
    // Resync on failure.
    loadInbox();
  }
}
window.markAllNotificationsRead = markAllNotificationsRead;

// ============================================================
// Mention autocomplete — attaches to a <textarea>
// ============================================================

let __mentionDebounceTimer = null;
let __mentionLastQuery = '';

function attachMentionAutocomplete(textarea) {
  if (!textarea || textarea.tagName !== 'TEXTAREA') return;
  if (textarea.dataset.mentionAttached === '1') return;
  textarea.dataset.mentionAttached = '1';

  textarea.addEventListener('input', () => onMentionInput(textarea));
  textarea.addEventListener('keyup', (ev) => {
    // Arrow / Enter / Tab / Escape are handled in keydown; keyup is only
    // used to refresh the autocomplete on cursor movement (arrows/home/end).
    if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight' || ev.key === 'Home' || ev.key === 'End') {
      onMentionInput(textarea);
    }
  });
  textarea.addEventListener('keydown', (ev) => onMentionKeyDown(textarea, ev));
  textarea.addEventListener('blur', () => {
    // Delay so that a click on an autocomplete item can register first.
    setTimeout(() => {
      if (state.mentionAutocomplete.target === textarea) hideMentionAutocomplete();
    }, 150);
  });
  textarea.addEventListener('click', () => onMentionInput(textarea));
}
window.attachMentionAutocomplete = attachMentionAutocomplete;

function getMentionPrefix(textarea) {
  const pos = textarea.selectionStart || 0;
  const value = textarea.value || '';
  // Look backwards from the cursor for an @ within the current word.
  let i = pos - 1;
  while (i >= 0) {
    const ch = value.charAt(i);
    if (ch === '@') {
      // Must be at start of string or preceded by whitespace.
      if (i === 0 || /\s/.test(value.charAt(i - 1))) {
        const prefix = value.slice(i + 1, pos);
        if (prefix.length <= 40 && /^[a-zA-Z0-9._-]*$/.test(prefix)) {
          return { start: i, prefix };
        }
      }
      return null;
    }
    if (/\s/.test(ch)) return null;
    i--;
  }
  return null;
}

function onMentionInput(textarea) {
  const hit = getMentionPrefix(textarea);
  if (!hit) {
    hideMentionAutocomplete();
    return;
  }
  const { prefix } = hit;
  state.mentionAutocomplete.target = textarea;
  if (prefix === __mentionLastQuery && state.mentionAutocomplete.open && state.mentionAutocomplete.items.length) {
    // Reposition in case the textarea moved.
    renderMentionAutocomplete(textarea, state.mentionAutocomplete.items);
    return;
  }
  if (__mentionDebounceTimer) clearTimeout(__mentionDebounceTimer);
  __mentionDebounceTimer = setTimeout(async () => {
    __mentionLastQuery = prefix;
    const r = await api('GET', `/api/users/mention-search?q=${encodeURIComponent(prefix)}`);
    const items = (r && Array.isArray(r.users)) ? r.users : [];
    if (state.mentionAutocomplete.target !== textarea) return;
    const current = getMentionPrefix(textarea);
    if (!current) { hideMentionAutocomplete(); return; }
    state.mentionAutocomplete.items = items;
    state.mentionAutocomplete.active = 0;
    if (!items.length) { hideMentionAutocomplete(); return; }
    state.mentionAutocomplete.open = true;
    renderMentionAutocomplete(textarea, items);
  }, 200);
}

function onMentionKeyDown(textarea, ev) {
  const ac = state.mentionAutocomplete;
  if (!ac.open || ac.target !== textarea) return;
  const items = ac.items || [];
  if (!items.length) return;
  if (ev.key === 'ArrowDown') {
    ev.preventDefault();
    ev.stopPropagation();
    ac.active = (ac.active + 1) % items.length;
    renderMentionAutocomplete(textarea, items);
  } else if (ev.key === 'ArrowUp') {
    ev.preventDefault();
    ev.stopPropagation();
    ac.active = (ac.active - 1 + items.length) % items.length;
    renderMentionAutocomplete(textarea, items);
  } else if (ev.key === 'Enter' || ev.key === 'Tab') {
    ev.preventDefault();
    ev.stopPropagation();
    const sel = items[ac.active] || items[0];
    if (sel) insertMentionAtCursor(textarea, sel);
  } else if (ev.key === 'Escape') {
    ev.preventDefault();
    ev.stopPropagation();
    hideMentionAutocomplete();
  }
}

function renderMentionAutocomplete(textarea, items) {
  let dd = document.getElementById('mention-autocomplete');
  if (!dd) {
    dd = document.createElement('div');
    dd.id = 'mention-autocomplete';
    dd.className = 'mention-autocomplete';
    document.body.appendChild(dd);
  }
  // Position below the textarea, left-aligned. Exact caret positioning in a
  // <textarea> isn't trivial without a mirror element; this is good enough.
  const r = textarea.getBoundingClientRect();
  dd.style.position = 'fixed';
  dd.style.left = r.left + 'px';
  dd.style.top = (r.bottom + 4) + 'px';
  dd.style.minWidth = Math.min(320, Math.max(220, r.width)) + 'px';
  const active = Number(state.mentionAutocomplete.active || 0);
  dd.innerHTML = items.map((u, idx) => {
    const name = u.display_name || (u.email ? u.email.split('@')[0] : '');
    const email = u.email || '';
    const cls = 'mention-autocomplete-item' + (idx === active ? ' active' : '');
    // Use mousedown (not click) so we fire before the textarea's blur.
    return `<div class="${cls}" data-idx="${idx}" onmousedown="__mentionPick(event, ${idx})">
      <div class="mention-autocomplete-name">${esc(name)}</div>
      <div class="mention-autocomplete-email">${esc(email)}</div>
    </div>`;
  }).join('');
}
window.renderMentionAutocomplete = renderMentionAutocomplete;

function __mentionPick(ev, idx) {
  if (ev) { ev.preventDefault(); ev.stopPropagation(); }
  const ac = state.mentionAutocomplete;
  const items = ac.items || [];
  const user = items[idx];
  const target = ac.target;
  if (!user || !target) return;
  insertMentionAtCursor(target, user);
}
window.__mentionPick = __mentionPick;

function insertMentionAtCursor(textarea, user) {
  const hit = getMentionPrefix(textarea);
  if (!hit) { hideMentionAutocomplete(); return; }
  const value = textarea.value || '';
  const username = (user.email || '').split('@')[0] || (user.display_name || '').toLowerCase().replace(/\s+/g, '');
  if (!username) { hideMentionAutocomplete(); return; }
  const before = value.slice(0, hit.start);
  const after = value.slice(textarea.selectionStart || 0);
  const insert = '@' + username + ' ';
  textarea.value = before + insert + after;
  const newPos = (before + insert).length;
  try { textarea.setSelectionRange(newPos, newPos); } catch (e) { /* ignore */ }
  // Fire an input event so consumers (e.g. docs editor draft tracking) pick
  // up the programmatic change.
  try { textarea.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) { /* ignore */ }
  hideMentionAutocomplete();
  try { textarea.focus(); } catch (e) { /* ignore */ }
}
window.insertMentionAtCursor = insertMentionAtCursor;

function hideMentionAutocomplete() {
  state.mentionAutocomplete.open = false;
  state.mentionAutocomplete.items = [];
  state.mentionAutocomplete.active = 0;
  state.mentionAutocomplete.target = null;
  __mentionLastQuery = '';
  const dd = document.getElementById('mention-autocomplete');
  if (dd && dd.parentNode) dd.parentNode.removeChild(dd);
}
window.hideMentionAutocomplete = hideMentionAutocomplete;

// ============================================================
// Wiki-link autocomplete: triggered by [[ in any textarea.
// Searches doc pages via /api/entity-search?type=doc_page&q=...
// On select, inserts [[SPACE_KEY/Page Title]] into the textarea.
// ============================================================

let __wikiDebounceTimer = null;
let __wikiLastQuery = '';

function attachWikiLinkAutocomplete(textarea) {
  if (!textarea || textarea.tagName !== 'TEXTAREA') return;
  if (textarea.dataset.wikiAttached === '1') return;
  textarea.dataset.wikiAttached = '1';

  textarea.addEventListener('input', () => onWikiInput(textarea));
  textarea.addEventListener('keydown', (ev) => onWikiKeyDown(textarea, ev));
  textarea.addEventListener('blur', () => {
    setTimeout(() => {
      if (state.wikiAutocomplete && state.wikiAutocomplete.target === textarea) hideWikiAutocomplete();
    }, 150);
  });
}
window.attachWikiLinkAutocomplete = attachWikiLinkAutocomplete;

function getWikiPrefix(textarea) {
  const pos = textarea.selectionStart || 0;
  const value = textarea.value || '';
  // Look backwards for [[
  let i = pos - 1;
  let text = '';
  while (i >= 0) {
    if (i >= 1 && value.charAt(i - 1) === '[' && value.charAt(i) === '[') {
      // Found [[ at position i-1
      text = value.slice(i + 1, pos);
      // Don't match if there's a closing ]] already
      if (text.includes(']]')) return null;
      if (text.length > 120) return null;
      return { start: i - 1, prefix: text };
    }
    // Stop at newlines — wiki-links don't span lines
    if (value.charAt(i) === '\n') return null;
    i--;
  }
  return null;
}

function onWikiInput(textarea) {
  if (!state.wikiAutocomplete) state.wikiAutocomplete = { open: false, items: [], active: 0, target: null };
  const hit = getWikiPrefix(textarea);
  if (!hit) {
    hideWikiAutocomplete();
    return;
  }
  const { prefix } = hit;
  state.wikiAutocomplete.target = textarea;
  if (prefix === __wikiLastQuery && state.wikiAutocomplete.open && state.wikiAutocomplete.items.length) {
    renderWikiAutocomplete(textarea, state.wikiAutocomplete.items);
    return;
  }
  if (__wikiDebounceTimer) clearTimeout(__wikiDebounceTimer);
  __wikiDebounceTimer = setTimeout(async () => {
    __wikiLastQuery = prefix;
    // Search for pages; if prefix contains / treat left part as space filter
    const q = prefix.includes('/') ? prefix.split('/').slice(1).join('/') : prefix;
    const r = await api('GET', '/api/entity-search?type=doc_page&q=' + encodeURIComponent(q || ''));
    const items = (r && Array.isArray(r.results)) ? r.results : [];
    if (!state.wikiAutocomplete || state.wikiAutocomplete.target !== textarea) return;
    const current = getWikiPrefix(textarea);
    if (!current) { hideWikiAutocomplete(); return; }
    state.wikiAutocomplete.items = items;
    state.wikiAutocomplete.active = 0;
    if (!items.length) { hideWikiAutocomplete(); return; }
    state.wikiAutocomplete.open = true;
    renderWikiAutocomplete(textarea, items);
  }, 200);
}

function onWikiKeyDown(textarea, ev) {
  if (!state.wikiAutocomplete || !state.wikiAutocomplete.open || state.wikiAutocomplete.target !== textarea) return;
  const items = state.wikiAutocomplete.items || [];
  if (!items.length) return;
  if (ev.key === 'ArrowDown') {
    ev.preventDefault(); ev.stopPropagation();
    state.wikiAutocomplete.active = (state.wikiAutocomplete.active + 1) % items.length;
    renderWikiAutocomplete(textarea, items);
  } else if (ev.key === 'ArrowUp') {
    ev.preventDefault(); ev.stopPropagation();
    state.wikiAutocomplete.active = (state.wikiAutocomplete.active - 1 + items.length) % items.length;
    renderWikiAutocomplete(textarea, items);
  } else if (ev.key === 'Enter' || ev.key === 'Tab') {
    ev.preventDefault(); ev.stopPropagation();
    const sel = items[state.wikiAutocomplete.active] || items[0];
    if (sel) insertWikiLinkAtCursor(textarea, sel);
  } else if (ev.key === 'Escape') {
    ev.preventDefault(); ev.stopPropagation();
    hideWikiAutocomplete();
  }
}

function renderWikiAutocomplete(textarea, items) {
  let dd = document.getElementById('wiki-autocomplete');
  if (!dd) {
    dd = document.createElement('div');
    dd.id = 'wiki-autocomplete';
    dd.className = 'mention-autocomplete';
    document.body.appendChild(dd);
  }
  const r = textarea.getBoundingClientRect();
  dd.style.position = 'fixed';
  dd.style.left = r.left + 'px';
  dd.style.top = (r.bottom + 4) + 'px';
  dd.style.minWidth = Math.min(380, Math.max(260, r.width)) + 'px';
  const active = Number(state.wikiAutocomplete.active || 0);
  dd.innerHTML = items.map((p, idx) => {
    const spaceLabel = p.subtitle || '';
    const cls = 'mention-autocomplete-item' + (idx === active ? ' active' : '');
    return `<div class="${cls}" onmousedown="__wikiPick(event, ${idx})">
      <div class="mention-autocomplete-name">${esc(p.title || '')}</div>
      <div class="mention-autocomplete-email">${spaceLabel ? esc(spaceLabel) : '<span class=text-muted>doc page</span>'}</div>
    </div>`;
  }).join('');
}

function __wikiPick(ev, idx) {
  if (ev) { ev.preventDefault(); ev.stopPropagation(); }
  const items = (state.wikiAutocomplete && state.wikiAutocomplete.items) || [];
  const page = items[idx];
  const target = state.wikiAutocomplete && state.wikiAutocomplete.target;
  if (!page || !target) return;
  insertWikiLinkAtCursor(target, page);
}
window.__wikiPick = __wikiPick;

function insertWikiLinkAtCursor(textarea, page) {
  const hit = getWikiPrefix(textarea);
  if (!hit) { hideWikiAutocomplete(); return; }
  const value = textarea.value || '';
  const before = value.slice(0, hit.start);
  const after = value.slice(textarea.selectionStart || 0);
  // Build the wiki-link with space prefix for disambiguation
  const spaceKey = page.subtitle || '';
  const linkText = spaceKey ? spaceKey + '/' + (page.title || '') : (page.title || '');
  const insert = '[[' + linkText + ']]';
  textarea.value = before + insert + after;
  const newPos = (before + insert).length;
  try { textarea.setSelectionRange(newPos, newPos); } catch {}
  try { textarea.dispatchEvent(new Event('input', { bubbles: true })); } catch {}
  hideWikiAutocomplete();
  try { textarea.focus(); } catch {}
}

function hideWikiAutocomplete() {
  if (state.wikiAutocomplete) {
    state.wikiAutocomplete.open = false;
    state.wikiAutocomplete.items = [];
    state.wikiAutocomplete.active = 0;
    state.wikiAutocomplete.target = null;
  }
  __wikiLastQuery = '';
  const dd = document.getElementById('wiki-autocomplete');
  if (dd && dd.parentNode) dd.parentNode.removeChild(dd);
}
window.hideWikiAutocomplete = hideWikiAutocomplete;
