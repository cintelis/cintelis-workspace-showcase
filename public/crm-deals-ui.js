// ============================================================
// CRM deals (sprint 15)
// The Deals board (#/pipeline — one card per deal, drag between stages,
// totals per column, Board | Table toggle, filter chips), the create/edit
// modal, and the deal record page (#/deal/:id) with inline properties, a
// notes composer and timeline, and the linked contact/company/tasks.
// Uses the shared globals from app.js and recProp/recStartEdit from
// crm-record-ui.js (data-target="deal"). Loaded before crm-record-ui.js.
// ============================================================

const DEAL_STAGE_ORDER = ['new', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];
const DEAL_STAGE_LABELS = { new: 'New', qualified: 'Qualified', proposal: 'Proposal sent', negotiation: 'Negotiation', won: 'Closed won', lost: 'Closed lost' };
const DEAL_OPEN_STAGES = ['new', 'qualified', 'proposal', 'negotiation'];
const DEAL_CLOSE_FILTERS = [
  { key: 'any', label: 'Any' }, { key: 'overdue', label: 'Past due' }, { key: 'month', label: 'This month' },
  { key: 'quarter', label: 'This quarter' }, { key: 'none', label: 'No close date' },
];

function dealFilters() {
  if (!state.ui.dealFilters) state.ui.dealFilters = { stages: [], owner: '', company: '', close: 'any', q: '' };
  return state.ui.dealFilters;
}
function dealFiltersActive() { const f = dealFilters(); return f.stages.length || f.owner || f.company || f.close !== 'any'; }

async function loadDeals() {
  const r = await api('GET', '/api/crm/deals');
  state.deals = (r && r.deals) || [];
}
async function loadDealStats() {
  state.dealStats = await api('GET', '/api/crm/deals/stats') || {};
}
Object.assign(window, { loadDeals, loadDealStats });

function dealCloseInfo(d) {
  if (!d.close_date) return { text: 'No close date', cls: '' };
  const due = new Date(d.close_date + 'T00:00:00'); const today = new Date(); today.setHours(0, 0, 0, 0);
  const closed = d.stage === 'won' || d.stage === 'lost';
  if (!closed && due < today) return { text: 'Past due · ' + fmtDay(d.close_date), cls: 'board-overdue' };
  return { text: (closed ? 'Closed ' : 'Close ') + fmtDay(d.close_date), cls: '' };
}

function applyDealFilters(rows) {
  const f = dealFilters();
  const q = String(f.q || '').trim().toLowerCase();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const ym = today.toISOString().slice(0, 7);
  const qStart = new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3, 1);
  const qEnd = new Date(qStart.getFullYear(), qStart.getMonth() + 3, 0);
  return (rows || []).filter(d => {
    if (f.stages.length && !f.stages.includes(d.stage)) return false;
    if (f.owner === 'me' && d.owner_user_id !== (state.me || {}).id) return false;
    if (f.owner === 'none' && d.owner_user_id) return false;
    if (f.owner && f.owner !== 'me' && f.owner !== 'none' && d.owner_user_id !== f.owner) return false;
    if (f.company && String(d.company_name || '').toLowerCase() !== f.company.toLowerCase()) return false;
    if (f.close !== 'any') {
      const cd = d.close_date || '';
      if (f.close === 'none' && cd) return false;
      if (f.close === 'overdue' && !(cd && new Date(cd + 'T00:00:00') < today && DEAL_OPEN_STAGES.includes(d.stage))) return false;
      if (f.close === 'month' && !cd.startsWith(ym)) return false;
      if (f.close === 'quarter' && !(cd && new Date(cd + 'T00:00:00') >= qStart && new Date(cd + 'T00:00:00') <= qEnd)) return false;
    }
    if (q && ![d.name, d.contact_name, d.contact_email, d.company_name, d.owner_name].map(v => String(v || '').toLowerCase()).join(' ').includes(q)) return false;
    return true;
  });
}

// ── Filter chips (same components as the contacts views) ──────
function dealChip(key, label, valueText, body) {
  const open = state.ui.crmOpenChip === 'deal_' + key;
  return `<div class="filter-chip-wrap">
    <button type="button" class="filter-chip ${valueText ? 'active' : ''}" onclick="dealToggleChip('${key}')">${esc(label)}${valueText ? `: <span class="filter-chip-val">${esc(valueText)}</span>` : ''} <span class="filter-chip-caret">▾</span></button>
    ${open ? `<div class="filter-pop" onclick="event.stopPropagation()">${body}</div>` : ''}
  </div>`;
}
function dealToggleChip(key) { state.ui.crmOpenChip = state.ui.crmOpenChip === 'deal_' + key ? '' : 'deal_' + key; renderDealsBoard(); }
function renderDealFilterBar() {
  const f = dealFilters();
  const rows = state.deals || [];
  const companies = Array.from(new Set(rows.map(d => String(d.company_name || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  const users = state.crmUsersCache || [];
  const ownerOptions = [{ key: 'me', label: 'Me' }, { key: 'none', label: 'Unassigned' }, ...users.map(u => ({ key: u.id, label: u.display_name || u.email }))];
  if (!state.crmUsersCache && typeof crmUsers === 'function') crmUsers().then(() => { if (state.ui.crmOpenChip === 'deal_owner') renderDealsBoard(); });
  const stageBody = DEAL_STAGE_ORDER.map(s => `<label class="filter-opt"><input type="checkbox" ${f.stages.includes(s) ? 'checked' : ''} onchange="dealSetStageFilter('${s}', this.checked)"> ${esc(DEAL_STAGE_LABELS[s])}</label>`).join('');
  const ownerBody = ownerOptions.map(o => `<label class="filter-opt"><input type="radio" name="deal-owner" ${f.owner === o.key ? 'checked' : ''} onchange="dealSetFilter('owner','${esc(o.key)}')"> ${esc(o.label)}</label>`).join('') + (f.owner ? `<button type="button" class="btn btn-ghost btn-sm" style="margin-top:6px" onclick="dealSetFilter('owner','')">Clear</button>` : '');
  const companyBody = `<div class="filter-pop-list">${companies.map(co => `<button type="button" class="filter-opt-btn ${f.company === co ? 'active' : ''}" onclick="dealSetFilter('company','${esc(co).replace(/'/g, '&#39;')}')">${esc(co)}</button>`).join('') || '<div class="text-muted text-sm">No companies on deals yet.</div>'}</div>${f.company ? `<button type="button" class="btn btn-ghost btn-sm" style="margin-top:8px" onclick="dealSetFilter('company','')">Clear</button>` : ''}`;
  const closeBody = DEAL_CLOSE_FILTERS.map(o => `<label class="filter-opt"><input type="radio" name="deal-close" ${f.close === o.key ? 'checked' : ''} onchange="dealSetFilter('close','${o.key}')"> ${esc(o.label)}</label>`).join('');
  const stageText = f.stages.length ? (f.stages.length === 1 ? DEAL_STAGE_LABELS[f.stages[0]] : `${f.stages.length} stages`) : '';
  const ownerText = f.owner ? (ownerOptions.find(o => o.key === f.owner)?.label || '') : '';
  const closeText = f.close !== 'any' ? (DEAL_CLOSE_FILTERS.find(o => o.key === f.close)?.label || '') : '';
  return `<div class="filter-bar crm-filter-bar">
    ${dealChip('stage', 'Stage', stageText, stageBody)}
    ${dealChip('owner', 'Owner', ownerText, ownerBody)}
    ${dealChip('company', 'Company', f.company, companyBody)}
    ${dealChip('close', 'Close date', closeText, closeBody)}
    ${dealFiltersActive() ? `<a class="crm-clear" onclick="dealClearFilters()">Clear all</a>` : ''}
  </div>`;
}
function dealSetStageFilter(s, on) { const f = dealFilters(); f.stages = on ? Array.from(new Set([...f.stages, s])) : f.stages.filter(x => x !== s); renderDealsBoard(); }
function dealSetFilter(k, v) { dealFilters()[k] = v; state.ui.crmOpenChip = ''; renderDealsBoard(); }
function dealClearFilters() { state.ui.dealFilters = null; renderDealsBoard(); }
function dealSetSearch(v) { dealFilters().q = String(v || ''); renderDealsBoard(); }
function dealSetView(v) { state.ui.dealsView = v === 'table' ? 'table' : 'board'; try { localStorage.setItem('crm_deals_view', state.ui.dealsView); } catch {} renderDealsBoard(); }
Object.assign(window, { dealToggleChip, dealSetStageFilter, dealSetFilter, dealClearFilters, dealSetSearch, dealSetView });
document.addEventListener('click', (ev) => {
  if (!String(state.ui.crmOpenChip || '').startsWith('deal_')) return;
  if (ev.target.closest('.filter-chip-wrap')) return;
  state.ui.crmOpenChip = '';
  if (currentSection === 'pipeline') renderDealsBoard();
});

// ── Board / table ─────────────────────────────────────────────
function dealOwnerBadge(d) {
  if (!d.owner_name) return '';
  const ini = d.owner_name.split(/\s+/).map(p => p.replace(/[^A-Za-z0-9]/g, '')).filter(Boolean).map(p => p[0]).join('').slice(0, 2).toUpperCase();
  return `<span class="board-owner" title="Owner: ${esc(d.owner_name)}">${esc(ini)}</span>`;
}

function renderDealCard(d) {
  const close = dealCloseInfo(d);
  return `<div class="board-card" draggable="true" data-id="${esc(d.id)}" ondragstart="dealDragStart(event,'${esc(d.id)}')" ondragend="dealDragEnd(event)" onclick="openDealRecord('${esc(d.id)}')">
    <div class="board-card-strip deal-strip-${esc(d.stage)}"></div>
    <div class="board-card-top">
      <div class="board-card-name">${esc(d.name)}</div>
      <div class="board-card-value">${d.amount > 0 ? fmtCurrency(d.amount) : '—'}</div>
    </div>
    <div class="board-card-company">${esc([d.company_name, d.contact_name || d.contact_email].filter(Boolean).join(' · ') || 'No contact')}</div>
    <div class="board-card-foot">
      <div class="board-card-meta"><span class="${close.cls}">${esc(close.text)}</span></div>
      ${dealOwnerBadge(d)}
    </div>
    <button type="button" class="board-card-peek" title="Edit" onclick="event.stopPropagation();openDealModal('${esc(d.id)}')">⋯</button>
  </div>`;
}

function renderDealColumn(stage, rows) {
  const total = rows.reduce((s, d) => s + Number(d.amount || 0), 0);
  return `<div class="board-col stage-${esc(stage)}" data-stage="${esc(stage)}" ondragover="dealDragOver(event)" ondragleave="dealDragLeave(event)" ondrop="dealDrop(event,'${esc(stage)}')">
    <div class="board-col-head"><span class="board-col-title">${esc(DEAL_STAGE_LABELS[stage])}</span><span class="board-col-count">${rows.length}</span></div>
    <div class="board-col-cards">${rows.length ? rows.map(renderDealCard).join('') : '<div class="board-empty">Drop a deal here</div>'}</div>
    <div class="board-col-foot">Total: <strong>${fmtCurrency(total)}</strong></div>
  </div>`;
}

function renderDealsBoard() {
  if (!state.ui.dealsView) { try { state.ui.dealsView = localStorage.getItem('crm_deals_view') || 'board'; } catch { state.ui.dealsView = 'board'; } }
  const st = state.dealStats || {};
  const rows = applyDealFilters(state.deals || []);
  const byStage = {}; for (const s of DEAL_STAGE_ORDER) byStage[s] = [];
  for (const d of rows) (byStage[d.stage] || byStage.new).push(d);
  const activeStage = state.ui.dealMobileStage || 'new';
  const wonMonth = st.won_month || { count: 0, value: 0 };
  const view = state.ui.dealsView;
  document.getElementById('content').innerHTML = `
  <div class="pipeline-toolbar">
    <div class="pipeline-summary">
      <div class="pipeline-summary-label">Open pipeline</div>
      <div class="pipeline-summary-value">${fmtCurrency(st.open_value || 0)}</div>
      <div class="pipeline-summary-note">${st.open_count || 0} open deal${st.open_count === 1 ? '' : 's'} · won this month ${fmtCurrency(wonMonth.value)} (${wonMonth.count})</div>
    </div>
    <div class="pipeline-actions">
      <input class="search-box pipeline-search" placeholder="Search deals, contacts, companies…" value="${esc(dealFilters().q || '')}" oninput="dealSetSearch(this.value)">
      <button class="btn btn-primary" onclick="openDealModal()">+ Create deal</button>
    </div>
  </div>
  <div class="crm-view-controls">
    <span class="text-muted text-sm">${rows.length} of ${(state.deals || []).length} deals</span>
    <span class="crm-view-spacer"></span>
    ${renderSegmented([{ key: 'board', label: 'Board' }, { key: 'table', label: 'Table' }], view, 'dealSetView')}
  </div>
  ${renderDealFilterBar()}
  ${view === 'table' ? renderDealTable(rows) : `
  <div class="pipeline-mobile">
    <div class="pipeline-stage-tabs">${DEAL_STAGE_ORDER.map(s => `<button class="pipeline-stage-tab ${activeStage === s ? 'active' : ''}" type="button" onclick="state.ui.dealMobileStage='${s}';renderDealsBoard()">${esc(DEAL_STAGE_LABELS[s])} (${byStage[s].length})</button>`).join('')}</div>
    ${renderDealColumn(activeStage, byStage[activeStage])}
  </div>
  <div class="board pipeline-desktop">${DEAL_STAGE_ORDER.map(s => renderDealColumn(s, byStage[s])).join('')}</div>`}`;
}
window.renderDealsBoard = renderDealsBoard;

function renderDealTable(rows) {
  if (!rows.length) return '<div class="empty"><div class="empty-icon">🤝</div><p>No deals match.</p></div>';
  return `<div class="card"><div class="table-wrap stack-on-mobile"><table class="data-table">
    <thead><tr><th>Deal</th><th>Stage</th><th>Amount</th><th>Contact</th><th>Company</th><th>Close date</th><th>Owner</th></tr></thead>
    <tbody>${rows.map(d => { const close = dealCloseInfo(d); return `<tr class="contact-row" onclick="openDealRecord('${esc(d.id)}')">
      <td data-label="Deal"><div class="contact-primary">${esc(d.name)}</div></td>
      <td data-label="Stage"><span class="badge deal-badge-${esc(d.stage)}">${esc(DEAL_STAGE_LABELS[d.stage] || d.stage)}</span></td>
      <td data-label="Amount">${d.amount > 0 ? fmtCurrency(d.amount) : '<span class="text-muted">—</span>'}</td>
      <td data-label="Contact">${d.contact_id ? `<a onclick="event.stopPropagation();openContactRecord('${esc(d.contact_id)}')" style="cursor:pointer;color:var(--cyan)">${esc(d.contact_name || d.contact_email)}</a>` : '<span class="text-muted">—</span>'}</td>
      <td data-label="Company">${d.company_id ? `<a onclick="event.stopPropagation();openCompanyRecord('${esc(d.company_id)}')" style="cursor:pointer;color:var(--cyan)">${esc(d.company_name)}</a>` : '<span class="text-muted">—</span>'}</td>
      <td data-label="Close date" class="${close.cls}">${esc(close.text)}</td>
      <td data-label="Owner" class="text-muted text-sm">${esc(d.owner_name || '—')}</td>
    </tr>`; }).join('')}</tbody></table></div></div>`;
}

// Drag between stages — optimistic, rolled back on error.
let dealDragId = null;
function dealDragStart(ev, id) { dealDragId = id; ev.dataTransfer.effectAllowed = 'move'; try { ev.dataTransfer.setData('text/plain', id); } catch {} ev.currentTarget.classList.add('dragging'); document.body.classList.add('board-dragging'); }
function dealDragEnd(ev) { ev.currentTarget.classList.remove('dragging'); document.body.classList.remove('board-dragging'); document.querySelectorAll('.board-col.drop-target').forEach(el => el.classList.remove('drop-target')); }
function dealDragOver(ev) { if (!dealDragId) return; ev.preventDefault(); ev.dataTransfer.dropEffect = 'move'; ev.currentTarget.classList.add('drop-target'); }
function dealDragLeave(ev) { if (!ev.currentTarget.contains(ev.relatedTarget)) ev.currentTarget.classList.remove('drop-target'); }
async function dealDrop(ev, stage) {
  ev.preventDefault();
  const id = dealDragId || (ev.dataTransfer && ev.dataTransfer.getData('text/plain'));
  dealDragId = null;
  document.body.classList.remove('board-dragging');
  const d = (state.deals || []).find(x => x.id === id);
  if (!d || d.stage === stage) { renderDealsBoard(); return; }
  const from = d.stage; d.stage = stage; renderDealsBoard();
  const r = await api('PATCH', `/api/crm/deals/${encodeURIComponent(id)}`, { stage });
  if (r && r.error) { d.stage = from; renderDealsBoard(); if (typeof toast === 'function') toast(r.error, 'error'); return; }
  if (r && r.deal) Object.assign(d, r.deal);
  if (typeof toast === 'function') toast(`${d.name} → ${DEAL_STAGE_LABELS[stage]}`, 'success', 1400);
  await loadDealStats(); renderDealsBoard();
}
Object.assign(window, { dealDragStart, dealDragEnd, dealDragOver, dealDragLeave, dealDrop });

// ── Create / edit modal ───────────────────────────────────────
async function openDealModal(id, preset = {}) {
  let d = id ? ((state.deals || []).find(x => x.id === id) || (state.crmDeal && state.crmDeal.deal && state.crmDeal.deal.id === id ? state.crmDeal.deal : null)) : null;
  if (id && !d) { const r = await api('GET', `/api/crm/deals/${encodeURIComponent(id)}`); d = r && r.deal; }
  const users = typeof crmUsers === 'function' ? await crmUsers() : [];
  const v = d || { name: preset.name || '', stage: 'new', amount: preset.amount || '', close_date: '', owner_user_id: (state.me || {}).id, contact_id: preset.contact_id || '', company_id: preset.company_id || '', notes: '' };
  const contactLabel = d ? (d.contact_name || d.contact_email || '') : (preset.contact_name || '');
  setModal(`<div class="modal-head"><h3>${d ? 'Edit deal' : 'Create deal'}</h3><button class="modal-close" onclick="closeModal()">x</button></div>
  <div class="modal-body">
    <div class="form-group"><label>Deal name</label><input id="dl-name" value="${esc(v.name)}" placeholder="e.g. 12 Smith St — full render" onkeydown="if(event.key==='Enter'){saveDealModal('${esc(id || '')}')}"></div>
    <div class="form-row">
      <div class="form-group"><label>Stage</label><select id="dl-stage">${DEAL_STAGE_ORDER.map(s => `<option value="${s}" ${v.stage === s ? 'selected' : ''}>${esc(DEAL_STAGE_LABELS[s])}</option>`).join('')}</select></div>
      <div class="form-group"><label>Amount ($)</label><input id="dl-amount" type="number" min="0" step="100" value="${esc(v.amount || '')}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Expected close</label><input id="dl-close" type="date" value="${esc(v.close_date || '')}"></div>
      <div class="form-group"><label>Owner</label><select id="dl-owner"><option value="">Unassigned</option>${users.map(u => `<option value="${esc(u.id)}" ${v.owner_user_id === u.id ? 'selected' : ''}>${esc(u.display_name || u.email)}</option>`).join('')}</select></div>
    </div>
    <div class="form-group"><label>Contact</label>
      <input id="dl-contact" list="dl-contact-list" value="${esc(contactLabel)}" placeholder="Start typing a name or email" oninput="dealContactLookup(this.value)" autocomplete="off">
      <datalist id="dl-contact-list"></datalist>
      <input type="hidden" id="dl-contact-id" value="${esc(v.contact_id || '')}">
      <input type="hidden" id="dl-company-id" value="${esc(v.company_id || '')}">
      <div class="text-muted text-sm" style="margin-top:4px">The company follows the contact.</div>
    </div>
    <div class="form-group"><label>Notes</label><textarea id="dl-notes" rows="3" style="font-family:var(--font-body);font-size:14px;min-height:70px">${esc(v.notes || '')}</textarea></div>
    <div class="form-msg" id="dl-msg"></div>
    <div class="flex gap" style="justify-content:flex-end">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveDealModal('${esc(id || '')}')">${d ? 'Save changes' : 'Create deal'}</button>
    </div>
  </div>`);
  setTimeout(() => document.getElementById('dl-name')?.focus(), 0);
}
let dealContactLookupTimer = null;
function dealContactLookup(q) {
  clearTimeout(dealContactLookupTimer);
  const hidden = document.getElementById('dl-contact-id'); const co = document.getElementById('dl-company-id'); const list = document.getElementById('dl-contact-list');
  if (!list) return;
  const picked = (state.dealContactOptions || []).find(c => `${c.name || ''} <${c.email}>`.trim() === q.trim());
  if (picked) { hidden.value = picked.id; co.value = picked.company_id || ''; return; }
  hidden.value = '';
  if (String(q || '').trim().length < 2) return;
  dealContactLookupTimer = setTimeout(async () => {
    const rows = await api('GET', `/api/contacts?q=${encodeURIComponent(q.trim())}`);
    state.dealContactOptions = Array.isArray(rows) ? rows.slice(0, 20) : [];
    list.innerHTML = state.dealContactOptions.map(c => `<option value="${esc(`${c.name || ''} <${c.email}>`.trim())}"></option>`).join('');
  }, 220);
}
async function saveDealModal(id) {
  const msg = document.getElementById('dl-msg');
  const body = {
    name: document.getElementById('dl-name').value.trim(),
    stage: document.getElementById('dl-stage').value,
    amount: parseFloat(document.getElementById('dl-amount').value) || 0,
    close_date: document.getElementById('dl-close').value || null,
    owner_user_id: document.getElementById('dl-owner').value || null,
    notes: document.getElementById('dl-notes').value,
  };
  const cid = document.getElementById('dl-contact-id').value; const ctext = document.getElementById('dl-contact').value.trim();
  if (cid || !ctext) { body.contact_id = cid || null; body.company_id = cid ? (document.getElementById('dl-company-id').value || null) : null; }
  const r = id ? await api('PATCH', `/api/crm/deals/${encodeURIComponent(id)}`, body) : await api('POST', '/api/crm/deals', body);
  if (r && r.error) { if (msg) msg.textContent = r.error; return; }
  closeModal();
  if (typeof toast === 'function') toast(id ? 'Deal saved' : 'Deal created', 'success', 1200);
  refreshAfterDealChange(id || (r.deal && r.deal.id));
}
async function deleteDealRecord(id) {
  if (!(await appConfirm('Delete this deal? Notes on it are removed too.'))) return;
  const r = await api('DELETE', `/api/crm/deals/${encodeURIComponent(id)}`);
  if (r && r.error) { if (typeof toast === 'function') toast(r.error, 'error'); return; }
  state.ui.crmDealId = '';
  if (currentSection === 'deal') nav('pipeline'); else refreshAfterDealChange();
}
function refreshAfterDealChange(id) {
  if (currentSection === 'pipeline') nav('pipeline');
  else if (currentSection === 'deal') renderDealRecord(id || state.ui.crmDealId);
  else if (currentSection === 'contact' && typeof renderContactRecord === 'function') renderContactRecord(state.ui.crmContactId);
  else if (currentSection === 'company' && typeof renderCompanyRecord === 'function') renderCompanyRecord(state.ui.crmCompanyId);
  else if (currentSection === 'workspace') nav('workspace');
}
Object.assign(window, { openDealModal, dealContactLookup, saveDealModal, deleteDealRecord, refreshAfterDealChange });

// ── Deal record page ──────────────────────────────────────────
function openDealRecord(id) { if (!id) return; state.ui.crmDealId = id; return nav('deal'); }
window.openDealRecord = openDealRecord;

async function renderDealRecord(id) {
  const c = document.getElementById('content');
  if (!id) return nav('pipeline');
  c.innerHTML = '<div class="page-section"><div class="empty"><p>Loading deal…</p></div></div>';
  const [r, users] = await Promise.all([api('GET', `/api/crm/deals/${encodeURIComponent(id)}`), typeof crmUsers === 'function' ? crmUsers() : Promise.resolve([])]);
  if (!r || r.error) { c.innerHTML = `<div class="page-section"><a onclick="nav('pipeline')" class="rec-back">&larr; Deals</a><div class="empty"><p>${esc((r && r.error) || 'Deal not found')}</p></div></div>`; return; }
  state.crmDeal = r;
  const d = r.deal;
  const title = document.getElementById('page-title'); if (title) title.textContent = d.name;
  const ownerOpts = [{ value: '', label: 'Unassigned' }, ...users.map(u => ({ value: u.id, label: u.display_name || u.email }))];
  const close = dealCloseInfo(d);
  c.innerHTML = `
    <div class="rec-page">
      <div class="rec-topbar">
        <a onclick="nav('pipeline')" class="rec-back">&larr; Deals</a>
        <div class="rec-topbar-actions">
          ${DEAL_OPEN_STAGES.includes(d.stage) ? `<button class="btn btn-ghost btn-sm" type="button" onclick="dealQuickStage('${esc(d.id)}','won')">Mark won</button><button class="btn btn-ghost btn-sm" type="button" onclick="dealQuickStage('${esc(d.id)}','lost')">Mark lost</button>` : `<button class="btn btn-ghost btn-sm" type="button" onclick="dealQuickStage('${esc(d.id)}','negotiation')">Reopen</button>`}
          <button class="btn btn-ghost btn-sm" type="button" onclick="openDealModal('${esc(d.id)}')">Edit</button>
          <button class="btn btn-ghost btn-sm" type="button" style="color:var(--red)" onclick="deleteDealRecord('${esc(d.id)}')">Delete</button>
        </div>
      </div>
      <div class="deal-stages">${DEAL_STAGE_ORDER.filter(s => s !== 'lost' || d.stage === 'lost').map((s, i, arr) => { const idx = arr.indexOf(d.stage); return `<button type="button" class="deal-stage-step ${i < idx ? 'done' : ''} ${s === d.stage ? 'current' : ''} deal-step-${s}" onclick="dealQuickStage('${esc(d.id)}','${s}')" title="Move to ${esc(DEAL_STAGE_LABELS[s])}">${esc(DEAL_STAGE_LABELS[s])}</button>`; }).join('')}</div>
      <div class="rec">
        <aside class="rec-left">
          <div class="card rec-identity">
            <div class="rec-name">${esc(d.name)}</div>
            <div class="deal-amount">${d.amount > 0 ? fmtCurrency(d.amount) : '<span class="text-muted">No amount</span>'}</div>
            <div class="text-muted text-sm ${close.cls}">${esc(close.text)}</div>
          </div>
          <div class="card rec-props">
            <button class="rec-section-toggle" type="button" onclick="this.parentElement.classList.toggle('collapsed')"><span class="rec-caret">▾</span> About this deal</button>
            <div class="rec-section-body" data-target="deal">
              ${recProp(d, 'name', 'Deal name', d.name)}
              ${recProp(d, 'stage', 'Stage', DEAL_STAGE_LABELS[d.stage] || d.stage, { select: DEAL_STAGE_ORDER.map(s => ({ value: s, label: DEAL_STAGE_LABELS[s] })), raw: d.stage })}
              ${recProp(d, 'amount', 'Amount', d.amount ? fmtCurrency(d.amount) : '', { type: 'number', raw: d.amount || 0 })}
              ${recProp(d, 'close_date', 'Expected close', d.close_date ? fmtDay(d.close_date) : '', { type: 'date', raw: d.close_date || '' })}
              ${recProp(d, 'owner_user_id', 'Owner', d.owner_name || '', { select: ownerOpts, raw: d.owner_user_id || '' })}
              ${recProp(d, 'source', 'Source', d.source)}
              ${recProp(d, 'notes', 'Notes', d.notes)}
              <div class="hs-prop"><div class="hs-prop-label">Created</div><div class="hs-prop-val">${esc(fmtDate(d.created_at))}</div></div>
              ${d.closed_at ? `<div class="hs-prop"><div class="hs-prop-label">Closed</div><div class="hs-prop-val">${esc(fmtDate(d.closed_at))}</div></div>` : ''}
            </div>
          </div>
        </aside>
        <section class="rec-main">
          <div class="card rec-composer">
            <div class="rec-composer-tabs" role="tablist">${['note', 'call', 'meeting', 'email'].map((k, i) => `<button type="button" role="tab" class="rec-composer-tab ${i === 0 ? 'active' : ''}" data-kind="${k}" onclick="recPickKind('${k}')">${REC_KIND_META[k].icon} ${esc(REC_KIND_META[k].label.replace(' logged', ''))}</button>`).join('')}</div>
            <textarea id="rec-composer-text" class="rec-composer-text" rows="3" placeholder="Leave a note on this deal…" onkeydown="if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){dealSubmitNote('${esc(d.id)}')}"></textarea>
            <div class="rec-composer-foot"><span class="text-muted text-sm">Ctrl+Enter to log</span><button class="btn btn-primary btn-sm" type="button" onclick="dealSubmitNote('${esc(d.id)}')">Log note</button></div>
          </div>
          <div class="rec-timeline">${renderDealTimeline(r.timeline, d.id)}</div>
        </section>
        <aside class="rec-right">
          <div class="card rec-assoc">
            <div class="rec-assoc-head"><span>Contact</span>${d.contact_id ? `<a onclick="openContactRecord('${esc(d.contact_id)}')">Open</a>` : ''}</div>
            ${d.contact_id ? `<div class="rec-assoc-title"><a onclick="openContactRecord('${esc(d.contact_id)}')" style="cursor:pointer;color:var(--cyan)">${esc(d.contact_name || d.contact_email)}</a></div><div class="text-muted text-sm">${esc([d.contact_email, d.contact_phone].filter(Boolean).join(' · '))}</div>` : `<div class="text-muted text-sm">No contact linked. <a onclick="openDealModal('${esc(d.id)}')">Link one</a></div>`}
          </div>
          <div class="card rec-assoc">
            <div class="rec-assoc-head"><span>Company</span>${d.company_id ? `<a onclick="openCompanyRecord('${esc(d.company_id)}')">Open</a>` : ''}</div>
            ${d.company_id ? `<div class="rec-assoc-title"><a onclick="openCompanyRecord('${esc(d.company_id)}')" style="cursor:pointer;color:var(--cyan)">${esc(d.company_name)}</a></div>` : '<div class="text-muted text-sm">No company.</div>'}
          </div>
          <div class="card rec-assoc">
            <div class="rec-assoc-head"><span>Open tasks (${(r.tasks || []).length})</span>${d.contact_id ? `<a onclick="openTaskModal('', {contact_id:'${esc(d.contact_id)}', contact_name:'${esc(d.contact_name || d.contact_email || '').replace(/'/g, '&#39;')}', title:'${esc(d.name).replace(/'/g, '&#39;')}: '})">+ Add</a>` : ''}</div>
            ${(r.tasks || []).length ? `<ul class="rec-assoc-list">${r.tasks.map(t => `<li><a onclick="openTaskModal('${esc(t.id)}')">${esc(t.title)}</a><span class="text-muted text-sm ${typeof taskDueClass === 'function' ? taskDueClass(t) : ''}">${t.due_at ? esc(fmtDay(t.due_at)) : ''}</span></li>`).join('')}</ul>` : '<div class="text-muted text-sm">None on the linked contact.</div>'}
          </div>
        </aside>
      </div>
    </div>`;
}
window.renderDealRecord = renderDealRecord;

function renderDealTimeline(items, dealId) {
  if (!items || !items.length) return '<div class="empty"><p>No activity yet.</p></div>';
  return items.map(it => {
    const meta = REC_KIND_META[it.kind] || { icon: '•', label: it.kind };
    const head = it.kind === 'stage' ? `<strong>Stage changed</strong> <span class="text-muted">${esc(it.body)}</span>` : it.kind === 'created' ? '<strong>Deal created</strong>' : `<strong>${esc(meta.label)}</strong>${it.by ? ` <span class="text-muted">by ${esc(it.by)}</span>` : ''}`;
    const body = (it.kind === 'stage' || it.kind === 'created') ? '' : `<div class="tl-body">${esc(it.body || '')}</div>`;
    return `<div class="card tl-item tl-${esc(it.kind)}"><div class="tl-icon">${meta.icon}</div><div class="tl-copy"><div class="tl-head"><div>${head}</div><div class="tl-when">${esc(it.at ? fmtDate(it.at) : '')}${it.deletable ? ` <button class="tl-delete" type="button" title="Delete" onclick="dealDeleteNote('${esc(dealId)}','${esc(it.id)}')">×</button>` : ''}</div></div>${body}</div></div>`;
  }).join('');
}
async function dealSubmitNote(id) {
  const ta = document.getElementById('rec-composer-text'); const kind = document.querySelector('.rec-composer-tab.active')?.dataset.kind || 'note';
  const content = (ta && ta.value || '').trim(); if (!content) { if (ta) ta.focus(); return; }
  const r = await api('POST', `/api/crm/deals/${encodeURIComponent(id)}/notes`, { content, type: kind });
  if (r && r.error) { if (typeof toast === 'function') toast(r.error, 'error'); return; }
  renderDealRecord(id);
}
async function dealDeleteNote(id, noteId) { if (!(await appConfirm('Delete this entry?'))) return; await api('DELETE', `/api/crm/deals/${encodeURIComponent(id)}/notes/${encodeURIComponent(noteId)}`); renderDealRecord(id); }
async function dealQuickStage(id, stage) {
  const r = await api('PATCH', `/api/crm/deals/${encodeURIComponent(id)}`, { stage });
  if (r && r.error) { if (typeof toast === 'function') toast(r.error, 'error'); return; }
  if (typeof toast === 'function') toast(`Moved to ${DEAL_STAGE_LABELS[stage]}`, 'success', 1200);
  refreshAfterDealChange(id);
}
Object.assign(window, { dealSubmitNote, dealDeleteNote, dealQuickStage, DEAL_STAGE_LABELS, DEAL_STAGE_ORDER });

// Deals list for the contact / company record right rail.
function renderDealsAssoc(deals, preset) {
  const rows = deals || [];
  const open = rows.filter(d => DEAL_OPEN_STAGES.includes(d.stage));
  const total = open.reduce((s, d) => s + Number(d.amount || 0), 0);
  const presetJson = esc(JSON.stringify(preset || {})).replace(/'/g, '&#39;');
  return `<div class="card rec-assoc">
    <div class="rec-assoc-head"><span>Deals (${rows.length})</span><a onclick='openDealModal("", JSON.parse("${presetJson.replace(/"/g, '\\"')}"))'>+ Add</a></div>
    ${open.length ? `<div class="text-muted text-sm" style="margin-bottom:6px">Open: <strong>${fmtCurrency(total)}</strong></div>` : ''}
    ${rows.length ? `<ul class="rec-assoc-list">${rows.map(d => `<li><a onclick="openDealRecord('${esc(d.id)}')">${esc(d.name)}</a><span><span class="badge deal-badge-${esc(d.stage)}">${esc(DEAL_STAGE_LABELS[d.stage] || d.stage)}</span> ${d.amount > 0 ? `<span class="text-sm">${fmtCurrency(d.amount)}</span>` : ''}</span></li>`).join('')}</ul>` : '<div class="text-muted text-sm">No deals yet.</div>'}
  </div>`;
}
window.renderDealsAssoc = renderDealsAssoc;
