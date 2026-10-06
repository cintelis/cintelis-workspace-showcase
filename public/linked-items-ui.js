// ============================================================
// Cintelis Workspace — Linked items UI (Sprint 6)
// Cross-entity links (issue <-> doc_page <-> contact). Panel
// rendered at the bottom of detail surfaces + a link picker
// modal. Loaded as a regular <script> tag after app.js; uses
// state, api(), esc(), setModal(), closeModal(), relTime(), nav()
// from app.js / tasks-ui.js.
// ============================================================

(function () {
  state.entityLinks = state.entityLinks || {};
})();

// ── Constants ────────────────────────────────────────────────
const LINK_ENTITY_TYPES = [
  { value: 'issue',    label: 'Issue' },
  { value: 'doc_page', label: 'Doc page' },
  { value: 'contact',  label: 'Contact' }
];

function linkTypeLabel(type) {
  const hit = LINK_ENTITY_TYPES.find(t => t.value === type);
  return hit ? hit.label : String(type || '');
}

function linksCacheKey(entityType, entityId) {
  return String(entityType) + ':' + String(entityId);
}

function linksCanWrite() {
  const role = state.me && state.me.role;
  return role === 'admin' || role === 'member';
}

// ── Loaders ──────────────────────────────────────────────────
async function loadLinks(entityType, entityId) {
  const key = linksCacheKey(entityType, entityId);
  const r = await api('GET', '/api/entity-links?type=' + encodeURIComponent(entityType) + '&id=' + encodeURIComponent(entityId));
  const list = (r && Array.isArray(r.links)) ? r.links
    : (r && Array.isArray(r.items)) ? r.items
    : (Array.isArray(r) ? r : []);
  state.entityLinks[key] = list;
  return list;
}
window.loadLinks = loadLinks;

async function searchEntities(type, q) {
  const url = '/api/entity-search?type=' + encodeURIComponent(type) + '&q=' + encodeURIComponent(q || '');
  const r = await api('GET', url);
  return (r && Array.isArray(r.results)) ? r.results : [];
}
window.searchEntities = searchEntities;

// ── Render panel ─────────────────────────────────────────────
async function renderLinksPanel(containerEl, entityType, entityId) {
  if (!containerEl) return;
  const key = linksCacheKey(entityType, entityId);
  if (!state.entityLinks[key]) {
    containerEl.innerHTML = '<div class="links-panel"><div class="links-head"><div class="links-title">Linked items</div></div><div class="text-muted text-sm">Loading\u2026</div></div>';
    try {
      await loadLinks(entityType, entityId);
    } catch (e) {
      containerEl.innerHTML = '<div class="links-panel"><div class="text-muted text-sm">Failed to load links.</div></div>';
      return;
    }
  }
  const list = state.entityLinks[key] || [];
  const canWrite = linksCanWrite();
  const reRender = () => renderLinksPanel(containerEl, entityType, entityId);
  const onChanged = async () => {
    await loadLinks(entityType, entityId);
    reRender();
  };

  const rowsHTML = list.length
    ? list.map(link => renderLinkRow(link, canWrite)).join('')
    : '<div class="link-empty text-muted text-sm">No linked items yet.</div>';

  containerEl.innerHTML = `
    <div class="links-panel">
      <div class="links-head">
        <div class="links-title">Linked items <span class="text-muted text-sm">(${list.length})</span></div>
        ${canWrite ? `<button class="btn btn-ghost btn-sm" type="button" id="links-add-btn-${esc(entityType)}-${esc(entityId)}">+ Link</button>` : ''}
      </div>
      <div class="links-list">
        ${rowsHTML}
      </div>
    </div>
  `;

  const addBtn = document.getElementById('links-add-btn-' + entityType + '-' + entityId);
  if (addBtn) {
    addBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      openCreateLinkModal(entityType, entityId, onChanged);
    });
  }

  const delBtns = containerEl.querySelectorAll('[data-link-del]');
  delBtns.forEach(btn => {
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const id = btn.getAttribute('data-link-del');
      deleteLinkConfirm(id, entityType, entityId, onChanged);
    });
  });

  const openBtns = containerEl.querySelectorAll('[data-link-open]');
  openBtns.forEach(el => {
    el.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const type = el.getAttribute('data-link-open-type');
      const id = el.getAttribute('data-link-open');
      openLinkedEntity(type, id);
    });
  });
}
window.renderLinksPanel = renderLinksPanel;

function renderLinkRow(link, canWrite) {
  const otherType = link.other_type || link.to_type || '';
  const otherId = link.other_id || link.to_id || '';
  const title = link.title || '(deleted)';
  const subtitle = link.subtitle || '';
  const direction = link.direction === 'backward' ? '\u2190' : '\u2192';
  const isDeleted = title === '(deleted)';
  const titleHTML = isDeleted
    ? `<span class="link-row-title text-muted">${esc(title)}</span>`
    : `<a href="javascript:void(0)" class="link-row-title" data-link-open="${esc(otherId)}" data-link-open-type="${esc(otherType)}">${esc(title)}</a>`;
  return `
    <div class="link-row">
      <span class="link-row-direction" title="${link.direction === 'backward' ? 'Incoming' : 'Outgoing'}">${direction}</span>
      <span class="link-row-type lozenge">${esc(linkTypeLabel(otherType))}</span>
      ${titleHTML}
      ${subtitle ? `<span class="link-row-sub text-muted text-sm">${esc(subtitle)}</span>` : ''}
      <div class="link-row-actions">
        ${canWrite ? `<button class="btn btn-ghost btn-sm" type="button" style="color:var(--red)" data-link-del="${esc(link.id)}">Remove</button>` : ''}
      </div>
    </div>
  `;
}

function openLinkedEntity(type, id) {
  if (!type || !id) return;
  if (type === 'issue') {
    if (typeof openIssueDetail === 'function') {
      openIssueDetail(id);
      return;
    }
    if (typeof nav === 'function') nav('projects');
    return;
  }
  if (type === 'doc_page') {
    if (typeof openDocsPage === 'function') {
      openDocsPage(id);
      return;
    }
    if (typeof nav === 'function') nav('docs');
    return;
  }
  if (type === 'contact') {
    if (typeof openContactDrawer === 'function') {
      try { openContactDrawer(id); return; } catch (e) { /* fall through */ }
    }
    if (typeof nav === 'function') nav('contacts');
    return;
  }
}
window.openLinkedEntity = openLinkedEntity;

// ── Create link modal ────────────────────────────────────────
let __linkPickerState = {
  fromType: '',
  fromId: '',
  tabType: 'issue',
  query: '',
  results: [],
  selected: null,
  onCreated: null,
  debounceTimer: null,
  loading: false
};

function openCreateLinkModal(entityType, entityId, onCreated) {
  __linkPickerState = {
    fromType: entityType,
    fromId: entityId,
    tabType: 'issue',
    query: '',
    results: [],
    selected: null,
    onCreated: onCreated || null,
    debounceTimer: null,
    loading: false
  };
  setModal(`
    <div class="modal-head">
      <div class="modal-title">Link to an item</div>
      <button class="modal-close" type="button" onclick="closeModal()">x</button>
    </div>
    <div class="modal-body">
      <div class="link-picker-tabs" id="link-picker-tabs">
        ${LINK_ENTITY_TYPES.map(t => `
          <button class="link-picker-tab${t.value === 'issue' ? ' active' : ''}" type="button" data-link-tab="${esc(t.value)}">${esc(t.label)}</button>
        `).join('')}
      </div>
      <input class="link-picker-search" id="link-picker-search" type="text" placeholder="Search\u2026" autofocus>
      <div class="link-picker-results" id="link-picker-results">
        <div class="text-muted text-sm">Loading\u2026</div>
      </div>
      <div class="link-picker-selected" id="link-picker-selected">
        <span class="text-muted text-sm">No item selected.</span>
      </div>
      <div class="form-msg" id="link-picker-msg" style="margin-top:8px"></div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" type="button" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" type="button" id="link-picker-submit" disabled onclick="submitCreateLinkFromPicker()">Add link</button>
    </div>
  `);

  // Wire tabs.
  const tabsEl = document.getElementById('link-picker-tabs');
  if (tabsEl) {
    tabsEl.querySelectorAll('[data-link-tab]').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        const type = btn.getAttribute('data-link-tab');
        __linkPickerState.tabType = type;
        __linkPickerState.query = '';
        __linkPickerState.selected = null;
        const searchEl = document.getElementById('link-picker-search');
        if (searchEl) searchEl.value = '';
        tabsEl.querySelectorAll('[data-link-tab]').forEach(b => {
          b.classList.toggle('active', b.getAttribute('data-link-tab') === type);
        });
        renderLinkPickerSelected();
        updateLinkPickerSubmitState();
        runLinkPickerSearch();
      });
    });
  }

  // Wire search input.
  const searchEl = document.getElementById('link-picker-search');
  if (searchEl) {
    searchEl.addEventListener('input', () => {
      __linkPickerState.query = searchEl.value || '';
      if (__linkPickerState.debounceTimer) clearTimeout(__linkPickerState.debounceTimer);
      __linkPickerState.debounceTimer = setTimeout(runLinkPickerSearch, 250);
    });
  }

  // Initial load (empty query -> 20 most-recent).
  runLinkPickerSearch();
}
window.openCreateLinkModal = openCreateLinkModal;

async function runLinkPickerSearch() {
  const resultsEl = document.getElementById('link-picker-results');
  if (!resultsEl) return;
  __linkPickerState.loading = true;
  resultsEl.innerHTML = '<div class="text-muted text-sm">Loading\u2026</div>';
  let results = [];
  try {
    results = await searchEntities(__linkPickerState.tabType, __linkPickerState.query);
  } catch (e) {
    resultsEl.innerHTML = '<div class="text-muted text-sm">Search failed.</div>';
    __linkPickerState.loading = false;
    return;
  }
  __linkPickerState.loading = false;
  __linkPickerState.results = results;

  // Filter out self-link (same type + same id as fromType/fromId).
  const filtered = results.filter(r =>
    !(r.type === __linkPickerState.fromType && r.id === __linkPickerState.fromId)
  );

  if (!filtered.length) {
    resultsEl.innerHTML = '<div class="text-muted text-sm">No results.</div>';
    return;
  }
  const selectedId = __linkPickerState.selected ? __linkPickerState.selected.id : '';
  resultsEl.innerHTML = filtered.map(r => {
    const cls = 'link-picker-result' + (r.id === selectedId ? ' selected' : '');
    const title = r.title || '(untitled)';
    const subtitle = r.subtitle || '';
    return `
      <div class="${cls}" data-link-pick="${esc(r.id)}">
        <div class="link-picker-result-title">${esc(title)}</div>
        ${subtitle ? `<div class="link-picker-result-sub text-muted text-sm">${esc(subtitle)}</div>` : ''}
      </div>
    `;
  }).join('');

  resultsEl.querySelectorAll('[data-link-pick]').forEach(el => {
    el.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const id = el.getAttribute('data-link-pick');
      const hit = filtered.find(x => x.id === id);
      if (!hit) return;
      __linkPickerState.selected = hit;
      resultsEl.querySelectorAll('.link-picker-result').forEach(x => x.classList.remove('selected'));
      el.classList.add('selected');
      renderLinkPickerSelected();
      updateLinkPickerSubmitState();
    });
  });
}

function renderLinkPickerSelected() {
  const el = document.getElementById('link-picker-selected');
  if (!el) return;
  const sel = __linkPickerState.selected;
  if (!sel) {
    el.innerHTML = '<span class="text-muted text-sm">No item selected.</span>';
    return;
  }
  el.innerHTML = `
    <span class="text-muted text-sm">Selected:</span>
    <span class="lozenge" style="margin-left:6px">${esc(linkTypeLabel(sel.type || __linkPickerState.tabType))}</span>
    <strong style="margin-left:6px">${esc(sel.title || '(untitled)')}</strong>
    ${sel.subtitle ? `<span class="text-muted text-sm" style="margin-left:6px">${esc(sel.subtitle)}</span>` : ''}
  `;
}

function updateLinkPickerSubmitState() {
  const btn = document.getElementById('link-picker-submit');
  if (!btn) return;
  btn.disabled = !__linkPickerState.selected;
}

async function submitCreateLinkFromPicker() {
  const sel = __linkPickerState.selected;
  if (!sel) return;
  const msg = document.getElementById('link-picker-msg');
  if (msg) { msg.className = 'form-msg'; msg.textContent = ''; }
  const body = {
    from_type: __linkPickerState.fromType,
    from_id: __linkPickerState.fromId,
    to_type: sel.type || __linkPickerState.tabType,
    to_id: sel.id
  };
  const r = await api('POST', '/api/entity-links', body);
  // Idempotent: POST returns the existing row on duplicates (HTTP 200).
  if (r && (r.id || r.ok || r.link)) {
    const onCreated = __linkPickerState.onCreated;
    closeModal();
    if (typeof onCreated === 'function') onCreated();
  } else {
    if (msg) {
      msg.textContent = (r && r.error) || 'Failed to create link';
      msg.classList.add('form-msg-err');
    }
  }
}
window.submitCreateLinkFromPicker = submitCreateLinkFromPicker;

async function submitCreateLink(fromType, fromId, toType, toId, onCreated) {
  const r = await api('POST', '/api/entity-links', {
    from_type: fromType, from_id: fromId, to_type: toType, to_id: toId
  });
  if (r && (r.id || r.ok || r.link)) {
    if (typeof onCreated === 'function') onCreated();
    return r;
  }
  throw new Error((r && r.error) || 'Failed to create link');
}
window.submitCreateLink = submitCreateLink;

async function deleteLinkConfirm(linkId, fromType, fromId, onDeleted) {
  if (!(await appConfirm('Remove this link?'))) return;
  const r = await api('DELETE', '/api/entity-links/' + encodeURIComponent(linkId));
  if (r && (r.ok || r.deleted)) {
    if (typeof onDeleted === 'function') onDeleted();
  } else {
    toastError((r && r.error) || 'Failed to remove link');
  }
}
window.deleteLinkConfirm = deleteLinkConfirm;
