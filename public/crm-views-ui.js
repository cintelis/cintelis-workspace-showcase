// ============================================================
// CRM list views (sprint 12)
// One filter model shared by the Contacts table and the Pipeline board
// (HubSpot's "Table | Board" over the same view): filter chips, saved views
// stored in the user's preferences, column sorting, and the board itself —
// one card per contact, drag between stages, running totals per column.
// Uses the shared globals from app.js. Loaded before crm-record-ui.js.
// ============================================================

const CRM_LAST_CONTACTED = [
  { key: 'any', label: 'Any time' },
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: '90d', label: 'Last 90 days' },
  { key: 'stale30', label: 'Not in 30+ days' },
  { key: 'never', label: 'Never' },
];
const CRM_FOLLOW_UP = [
  { key: 'any', label: 'Any' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Due today' },
  { key: 'week', label: 'Due this week' },
  { key: 'set', label: 'Has a follow-up' },
  { key: 'none', label: 'No follow-up' },
];
const CRM_SORT_KEYS = {
  contact: 'name', email: 'email', title: 'title', company: 'company', phone: 'phone',
  stage: 'stage', added: 'created_at', deal_value: 'deal_value', last_contacted: 'last_contacted_at', follow_up: 'follow_up_at',
};

function crmDefaultFilters() { return { stages: [], company: '', tags: [], lastContacted: 'any', followUp: 'any', owner: '' }; }
function crmFilters() {
  if (!state.ui.crmFilters) state.ui.crmFilters = crmDefaultFilters();
  return state.ui.crmFilters;
}
function crmSortState() {
  if (!state.ui.crmSort) state.ui.crmSort = { key: 'created_at', dir: 'desc' };
  return state.ui.crmSort;
}
function crmFiltersActive() {
  const f = crmFilters();
  return f.stages.length || f.company || f.tags.length || f.lastContacted !== 'any' || f.followUp !== 'any' || !!f.owner;
}

// ── Applying the model ────────────────────────────────────────
function crmDaysAgo(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (isNaN(t)) return null;
  return (Date.now() - t) / 86400000;
}

function applyCrmFilters(rows) {
  const f = crmFilters();
  const company = String(f.company || '').trim().toLowerCase();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const endOfToday = today.getTime() + 86400000 - 1;
  const endOfWeek = today.getTime() + 7 * 86400000;
  return (rows || []).filter(c => {
    if (f.stages.length && !f.stages.includes(c.stage || 'lead')) return false;
    if (company && String(c.company || '').toLowerCase() !== company) return false;
    if (f.tags.length && !f.tags.every(t => (c.tags || []).includes(t))) return false;
    if (f.lastContacted !== 'any') {
      const d = crmDaysAgo(c.last_contacted_at);
      if (f.lastContacted === 'never' && d !== null) return false;
      if (f.lastContacted === '7d' && !(d !== null && d <= 7)) return false;
      if (f.lastContacted === '30d' && !(d !== null && d <= 30)) return false;
      if (f.lastContacted === '90d' && !(d !== null && d <= 90)) return false;
      if (f.lastContacted === 'stale30' && !(d === null || d > 30)) return false;
    }
    if (f.owner) {
      if (f.owner === 'me' && c.owner_user_id !== (state.me || {}).id) return false;
      if (f.owner === 'none' && c.owner_user_id) return false;
      if (f.owner !== 'me' && f.owner !== 'none' && c.owner_user_id !== f.owner) return false;
    }
    if (f.followUp !== 'any') {
      const t = c.follow_up_at ? new Date(c.follow_up_at).getTime() : NaN;
      const has = !isNaN(t);
      if (f.followUp === 'none' && has) return false;
      if (f.followUp === 'set' && !has) return false;
      if (f.followUp === 'overdue' && !(has && t < today.getTime())) return false;
      if (f.followUp === 'today' && !(has && t >= today.getTime() && t <= endOfToday)) return false;
      if (f.followUp === 'week' && !(has && t >= today.getTime() && t <= endOfWeek)) return false;
    }
    return true;
  });
}

function sortCrmRows(rows) {
  const s = crmSortState();
  const key = s.key || 'created_at';
  const dir = s.dir === 'asc' ? 1 : -1;
  const stageRank = Object.fromEntries(STAGE_ORDER.map((st, i) => [st, i]));
  const val = (c) => {
    if (key === 'name') return getContactDisplayName(c).toLowerCase();
    if (key === 'stage') return stageRank[c.stage] ?? 0;
    if (key === 'deal_value') return Number(c.open_deal_value || 0);
    const v = c[key];
    if (v == null || v === '') return null;
    return typeof v === 'number' ? v : String(v).toLowerCase();
  };
  return [...(rows || [])].sort((a, b) => {
    const va = val(a), vb = val(b);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;          // empties last whatever the direction
    if (vb === null) return -1;
    if (va < vb) return -1 * dir;
    if (va > vb) return 1 * dir;
    return 0;
  });
}
window.applyCrmFilters = applyCrmFilters;
window.sortCrmRows = sortCrmRows;

function crmSort(colKey) {
  const key = CRM_SORT_KEYS[colKey] || colKey;
  const s = crmSortState();
  if (s.key === key) s.dir = s.dir === 'asc' ? 'desc' : 'asc';
  else { s.key = key; s.dir = (key === 'name' || key === 'email' || key === 'company' || key === 'title') ? 'asc' : 'desc'; }
  state.ui.contactsPage = 1;
  crmRerender();
}
window.crmSort = crmSort;

function crmSortIndicator(colKey) {
  const key = CRM_SORT_KEYS[colKey] || colKey;
  const s = crmSortState();
  if (s.key !== key) return '<span class="th-sort-mark">↕</span>';
  return `<span class="th-sort-mark active">${s.dir === 'asc' ? '▲' : '▼'}</span>`;
}
window.crmSortIndicator = crmSortIndicator;

function crmRerender() {
  if (currentSection === 'contacts') renderContacts(state.ui.contactsQuery);
  else if (currentSection === 'pipeline') renderPipeline();
}

// ── Filter bar ────────────────────────────────────────────────
function crmRowsForOptions() {
  if (currentSection === 'pipeline') return Object.values(state.pipeline || {}).flat();
  return state.contacts || [];
}

function crmChip(key, label, valueText, body) {
  const open = state.ui.crmOpenChip === key;
  const active = !!valueText;
  return `<div class="filter-chip-wrap">
    <button type="button" class="filter-chip ${active ? 'active' : ''}" onclick="crmToggleChip('${key}')">
      ${esc(label)}${active ? `: <span class="filter-chip-val">${esc(valueText)}</span>` : ''} <span class="filter-chip-caret">▾</span>
    </button>
    ${open ? `<div class="filter-pop" onclick="event.stopPropagation()">${body}</div>` : ''}
  </div>`;
}

function renderCrmFilterBar() {
  const f = crmFilters();
  const rows = crmRowsForOptions();
  const companies = Array.from(new Set(rows.map(c => String(c.company || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  const tags = Array.from(new Set(rows.flatMap(c => Array.isArray(c.tags) ? c.tags : []).map(t => String(t || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  for (const t of f.tags) if (!tags.includes(t)) tags.unshift(t);
  if (f.company && !companies.includes(f.company)) companies.unshift(f.company);

  const stageBody = STAGE_ORDER.map(s => `<label class="filter-opt"><input type="checkbox" ${f.stages.includes(s) ? 'checked' : ''} onchange="crmSetStage('${s}', this.checked)"> ${esc(STAGE_LABELS[s])}</label>`).join('');
  const companyBody = `<input class="filter-pop-search" placeholder="Type a company…" value="${esc(f.company)}" oninput="crmFilterCompanyOptions(this.value)" onkeydown="if(event.key==='Enter'){crmSetCompany(this.value)}">
    <div class="filter-pop-list" id="crm-company-options">${companies.slice(0, 60).map(co => `<button type="button" class="filter-opt-btn ${f.company === co ? 'active' : ''}" onclick="crmSetCompany('${esc(co).replace(/'/g, '&#39;')}')">${esc(co)}</button>`).join('') || '<div class="text-muted text-sm">No companies yet.</div>'}</div>
    ${f.company ? `<button type="button" class="btn btn-ghost btn-sm" style="margin-top:8px" onclick="crmSetCompany('')">Clear</button>` : ''}`;
  const tagBody = tags.length ? tags.map(t => `<label class="filter-opt"><input type="checkbox" ${f.tags.includes(t) ? 'checked' : ''} onchange="crmSetTag('${esc(t).replace(/'/g, '&#39;')}', this.checked)"> ${esc(t)}</label>`).join('') : '<div class="text-muted text-sm">No tags yet.</div>';
  const lcBody = CRM_LAST_CONTACTED.map(o => `<label class="filter-opt"><input type="radio" name="crm-lc" ${f.lastContacted === o.key ? 'checked' : ''} onchange="crmSetLastContacted('${o.key}')"> ${esc(o.label)}</label>`).join('');
  const fuBody = CRM_FOLLOW_UP.map(o => `<label class="filter-opt"><input type="radio" name="crm-fu" ${f.followUp === o.key ? 'checked' : ''} onchange="crmSetFollowUp('${o.key}')"> ${esc(o.label)}</label>`).join('');

  const stageText = f.stages.length ? (f.stages.length === 1 ? STAGE_LABELS[f.stages[0]] : `${f.stages.length} stages`) : '';
  const tagText = f.tags.length ? (f.tags.length === 1 ? f.tags[0] : `${f.tags.length} tags`) : '';
  const lcText = f.lastContacted !== 'any' ? (CRM_LAST_CONTACTED.find(o => o.key === f.lastContacted)?.label || '') : '';
  const fuText = f.followUp !== 'any' ? (CRM_FOLLOW_UP.find(o => o.key === f.followUp)?.label || '') : '';
  const users = state.crmUsersCache || [];
  const ownerOptions = [{ key: 'me', label: 'Me' }, { key: 'none', label: 'Unassigned' }, ...users.map(u => ({ key: u.id, label: u.display_name || u.email }))];
  const ownerBody = ownerOptions.map(o => `<label class="filter-opt"><input type="radio" name="crm-owner" ${f.owner === o.key ? 'checked' : ''} onchange="crmSetOwner('${esc(o.key)}')"> ${esc(o.label)}</label>`).join('') + (f.owner ? `<button type="button" class="btn btn-ghost btn-sm" style="margin-top:6px" onclick="crmSetOwner('')">Clear</button>` : '');
  const ownerText = f.owner ? (ownerOptions.find(o => o.key === f.owner)?.label || '') : '';
  if (!state.crmUsersCache && typeof crmUsers === 'function') crmUsers().then(() => { if (state.ui.crmOpenChip === 'owner') crmRerender(); });

  return `<div class="filter-bar crm-filter-bar">
    ${crmChip('stage', 'Stage', stageText, stageBody)}
    ${crmChip('company', 'Company', f.company, companyBody)}
    ${crmChip('tags', 'Tags', tagText, tagBody)}
    ${crmChip('lc', 'Last contacted', lcText, lcBody)}
    ${crmChip('fu', 'Follow-up', fuText, fuBody)}
    ${crmChip('owner', 'Owner', ownerText, ownerBody)}
    ${crmFiltersActive() ? `<a class="crm-clear" onclick="crmClearFilters()">Clear all</a>` : ''}
  </div>`;
}

function crmToggleChip(key) {
  state.ui.crmOpenChip = state.ui.crmOpenChip === key ? '' : key;
  crmRerender();
  if (state.ui.crmOpenChip) {
    setTimeout(() => {
      const inp = document.querySelector('.filter-pop .filter-pop-search');
      if (inp) inp.focus();
    }, 0);
  }
}
window.crmToggleChip = crmToggleChip;
document.addEventListener('click', (ev) => {
  if (!state.ui.crmOpenChip) return;
  if (ev.target.closest('.filter-chip-wrap')) return;
  state.ui.crmOpenChip = '';
  crmRerender();
});

function crmSetStage(stage, on) {
  const f = crmFilters();
  f.stages = on ? Array.from(new Set([...f.stages, stage])) : f.stages.filter(s => s !== stage);
  state.ui.contactsPage = 1; crmRerender();
}
function crmSetCompany(v) {
  crmFilters().company = String(v || '').trim();
  state.ui.crmOpenChip = '';
  state.ui.contactsPage = 1; crmRerender();
}
function crmFilterCompanyOptions(q) {
  const list = document.getElementById('crm-company-options');
  if (!list) return;
  const needle = String(q || '').toLowerCase();
  list.querySelectorAll('.filter-opt-btn').forEach(b => { b.style.display = b.textContent.toLowerCase().includes(needle) ? '' : 'none'; });
}
function crmSetTag(tag, on) {
  const f = crmFilters();
  f.tags = on ? Array.from(new Set([...f.tags, tag])) : f.tags.filter(t => t !== tag);
  state.ui.contactTagFilter = f.tags;
  state.ui.contactsPage = 1; crmRerender();
}
function crmSetOwner(k) { crmFilters().owner = k; state.ui.crmOpenChip = ''; state.ui.contactsPage = 1; crmRerender(); }
window.crmSetOwner = crmSetOwner;
function crmSetLastContacted(k) { crmFilters().lastContacted = k; state.ui.crmOpenChip = ''; state.ui.contactsPage = 1; crmRerender(); }
function crmSetFollowUp(k) { crmFilters().followUp = k; state.ui.crmOpenChip = ''; state.ui.contactsPage = 1; crmRerender(); }
function crmClearFilters() {
  state.ui.crmFilters = crmDefaultFilters();
  state.ui.contactTagFilter = [];
  state.ui.crmViewId = '';
  state.ui.contactsPage = 1; crmRerender();
}
Object.assign(window, { crmSetStage, crmSetCompany, crmFilterCompanyOptions, crmSetTag, crmSetLastContacted, crmSetFollowUp, crmClearFilters });

// ── Saved views ───────────────────────────────────────────────
function crmViews() {
  const v = state.me && state.me.preferences && state.me.preferences.crm_views;
  return Array.isArray(v) ? v : [];
}

function renderCrmViewControls(mode) {
  const views = crmViews();
  const current = state.ui.crmViewId || '';
  const options = [`<option value="">All contacts</option>`, ...views.map(v => `<option value="${esc(v.id)}" ${v.id === current ? 'selected' : ''}>${esc(v.name)}</option>`)].join('');
  return `<div class="crm-view-controls">
    <label class="crm-view-label">View
      <select class="crm-view-select" onchange="crmApplyView(this.value)">${options}</select>
    </label>
    <button type="button" class="btn btn-ghost btn-sm" onclick="crmSaveView()" title="Save the current filters and sort as a view">${current ? 'Update view' : 'Save view'}</button>
    ${current ? `<button type="button" class="btn btn-ghost btn-sm" onclick="crmSaveViewAs()">Save as…</button><button type="button" class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="crmDeleteView()">Delete</button>` : ''}
    <span class="crm-view-spacer"></span>
  </div>`;
}

function crmApplyView(id) {
  state.ui.crmViewId = id || '';
  const v = crmViews().find(x => x.id === id);
  state.ui.crmFilters = v ? { ...crmDefaultFilters(), ...(v.filters || {}) } : crmDefaultFilters();
  state.ui.contactTagFilter = crmFilters().tags;
  if (v && v.sort) state.ui.crmSort = { ...v.sort };
  state.ui.contactsPage = 1;
  crmRerender();
}
window.crmApplyView = crmApplyView;

async function crmPersistViews(views) {
  const r = await api('PATCH', '/api/me/preferences', { crm_views: views });
  if (r && r.error) { if (typeof toast === 'function') toast(r.error, 'error'); return false; }
  state.me.preferences = r.preferences || { ...(state.me.preferences || {}), crm_views: views };
  return true;
}

async function crmSaveView() {
  const views = crmViews().map(v => ({ ...v }));
  const current = views.find(v => v.id === state.ui.crmViewId);
  if (current) {
    current.filters = { ...crmFilters() };
    current.sort = { ...crmSortState() };
    if (await crmPersistViews(views) && typeof toast === 'function') toast(`View "${current.name}" updated`, 'success', 1500);
    crmRerender();
    return;
  }
  return crmSaveViewAs();
}
async function crmSaveViewAs() {
  const name = ((await appPrompt('Name this view', { title: 'Save view', placeholder: 'View name' })) || '').trim();
  if (!name) return;
  const views = crmViews().map(v => ({ ...v }));
  const id = 'v_' + Math.random().toString(36).slice(2, 10);
  views.push({ id, name, filters: { ...crmFilters() }, sort: { ...crmSortState() } });
  if (await crmPersistViews(views)) {
    state.ui.crmViewId = id;
    if (typeof toast === 'function') toast(`View "${name}" saved`, 'success', 1500);
  }
  crmRerender();
}
async function crmDeleteView() {
  const v = crmViews().find(x => x.id === state.ui.crmViewId);
  if (!v || !(await appConfirm(`Delete the view "${v.name}"?`))) return;
  const views = crmViews().filter(x => x.id !== v.id);
  if (await crmPersistViews(views)) state.ui.crmViewId = '';
  crmRerender();
}
Object.assign(window, { crmSaveView, crmSaveViewAs, crmDeleteView });

// The toolbar both pages render: view controls + Table|Board + filter chips.
function renderCrmToolbar(mode) {
  return renderCrmViewControls(mode) + renderCrmFilterBar();
}
window.renderCrmToolbar = renderCrmToolbar;


// The deals board (sprint 15) lives in crm-deals-ui.js; the contact-based
// board this file used to render was retired with it.
