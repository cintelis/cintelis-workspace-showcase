// ============================================================
// CRM companies (sprint 14)
// A list page (#/companies) and a record page (#/company/:id) with inline
// properties, the company's contacts, open tasks and pipeline totals.
// Uses the shared globals from app.js and the recProp/recStartEdit inline
// editor from crm-record-ui.js (same data-field convention, different
// PATCH target). Loaded before router.js.
// ============================================================

function openCompanyRecord(id) {
  if (!id) return;
  state.ui.crmCompanyId = id;
  return nav('company');
}
window.openCompanyRecord = openCompanyRecord;

async function loadCompanies() {
  const q = state.ui.companiesQuery || '';
  const r = await api('GET', `/api/crm/companies${q ? '?q=' + encodeURIComponent(q) : ''}`);
  state.companies = (r && r.companies) || [];
}

function renderCompanies() {
  const rows = state.companies || [];
  document.getElementById('content').innerHTML = `
    <div class="toolbar">
      <input class="search-box" placeholder="Search companies…" value="${esc(state.ui.companiesQuery || '')}" oninput="queueCompaniesSearch(this.value)" style="max-width:340px">
      <span class="text-muted text-sm" style="flex:1">${rows.length} compan${rows.length === 1 ? 'y' : 'ies'}</span>
      <button class="btn btn-primary" type="button" onclick="openCompanyModal()">+ Add company</button>
    </div>
    ${rows.length ? `<div class="card"><div class="table-wrap stack-on-mobile"><table class="data-table">
      <thead><tr><th>Company</th><th>Domain</th><th>Industry</th><th>Contacts</th><th>Open value</th><th>Won</th><th>Owner</th><th>Last contacted</th></tr></thead>
      <tbody>${rows.map(x => `<tr class="contact-row" onclick="openCompanyRecord('${esc(x.id)}')">
        <td data-label="Company"><div class="co-cell"><div class="co-avatar">${esc(companyInitials(x.name))}</div><div><div class="contact-primary">${esc(x.name)}</div>${x.phone ? `<div class="contact-secondary">${esc(x.phone)}</div>` : ''}</div></div></td>
        <td data-label="Domain">${x.domain ? `<a href="https://${esc(x.domain)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${esc(x.domain)}</a>` : '<span class="text-muted">—</span>'}</td>
        <td data-label="Industry" class="text-muted">${esc(x.industry || '—')}</td>
        <td data-label="Contacts">${Number(x.contact_count || 0)}</td>
        <td data-label="Open value">${x.open_value > 0 ? fmtCurrency(x.open_value) : '<span class="text-muted">—</span>'}</td>
        <td data-label="Won">${x.won_value > 0 ? fmtCurrency(x.won_value) : '<span class="text-muted">—</span>'}</td>
        <td data-label="Owner" class="text-muted text-sm">${esc(x.owner_name || '—')}</td>
        <td data-label="Last contacted" class="text-muted text-sm">${x.last_contacted_at ? esc(fmtDateShort(x.last_contacted_at)) : 'Never'}</td>
      </tr>`).join('')}</tbody></table></div></div>`
      : `<div class="empty"><div class="empty-icon">🏢</div><p>${state.ui.companiesQuery ? 'No companies match.' : 'No companies yet. They appear as contacts get a company name, or add one here.'}</p></div>`}`;
}

let companiesSearchTimer = null;
function queueCompaniesSearch(v) {
  state.ui.companiesQuery = String(v || '');
  clearTimeout(companiesSearchTimer);
  companiesSearchTimer = setTimeout(async () => { await loadCompanies(); if (currentSection === 'companies') renderCompanies(); }, 250);
}
function companyInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : String(name || '?').slice(0, 2)).toUpperCase();
}
Object.assign(window, { loadCompanies, renderCompanies, queueCompaniesSearch, companyInitials });

// ── Create / edit modal ───────────────────────────────────────
async function openCompanyModal(id) {
  const existing = id ? ((state.companies || []).find(x => x.id === id) || (state.crmCompany && state.crmCompany.company && state.crmCompany.company.id === id ? state.crmCompany.company : null)) : null;
  const users = await crmUsers();
  const v = existing || { name: '', domain: '', website: '', phone: '', industry: '', owner_user_id: (state.me || {}).id, notes: '' };
  setModal(`<div class="modal-head"><h3>${existing ? 'Edit company' : 'Add company'}</h3><button class="modal-close" onclick="closeModal()">x</button></div>
  <div class="modal-body">
    <div class="form-group"><label>Name</label><input id="co-name" value="${esc(v.name)}" placeholder="Company name" onkeydown="if(event.key==='Enter'){saveCompanyModal('${esc(id || '')}')}"></div>
    <div class="form-row">
      <div class="form-group"><label>Domain</label><input id="co-domain" value="${esc(v.domain || '')}" placeholder="example.com.au"></div>
      <div class="form-group"><label>Phone</label><input id="co-phone" value="${esc(v.phone || '')}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Website</label><input id="co-website" value="${esc(v.website || '')}" placeholder="https://"></div>
      <div class="form-group"><label>Industry</label><input id="co-industry" value="${esc(v.industry || '')}"></div>
    </div>
    <div class="form-group"><label>Owner</label><select id="co-owner"><option value="">Unassigned</option>${users.map(u => `<option value="${esc(u.id)}" ${v.owner_user_id === u.id ? 'selected' : ''}>${esc(u.display_name || u.email)}</option>`).join('')}</select></div>
    <div class="form-group"><label>Notes</label><textarea id="co-notes" rows="3" style="font-family:var(--font-body);font-size:14px;min-height:70px">${esc(v.notes || '')}</textarea></div>
    <div class="form-msg" id="co-msg"></div>
    <div class="flex gap" style="justify-content:flex-end">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveCompanyModal('${esc(id || '')}')">${existing ? 'Save changes' : 'Add company'}</button>
    </div>
  </div>`);
  setTimeout(() => document.getElementById('co-name')?.focus(), 0);
}

async function saveCompanyModal(id) {
  const msg = document.getElementById('co-msg');
  const body = {
    name: document.getElementById('co-name').value.trim(),
    domain: document.getElementById('co-domain').value.trim(),
    phone: document.getElementById('co-phone').value.trim(),
    website: document.getElementById('co-website').value.trim(),
    industry: document.getElementById('co-industry').value.trim(),
    owner_user_id: document.getElementById('co-owner').value || null,
    notes: document.getElementById('co-notes').value,
  };
  if (!body.name) { if (msg) msg.textContent = 'Name required'; return; }
  const r = id ? await api('PATCH', `/api/crm/companies/${encodeURIComponent(id)}`, body) : await api('POST', '/api/crm/companies', body);
  if (r && r.error) { if (msg) msg.textContent = r.error; return; }
  closeModal();
  if (typeof toast === 'function') toast(id ? 'Company saved' : 'Company added', 'success', 1200);
  if (!id && r.company) return openCompanyRecord(r.company.id);
  nav(currentSection === 'company' ? 'company' : 'companies');
}

async function deleteCompanyRecord(id) {
  if (!(await appConfirm('Delete this company? Contacts keep their company name but lose the link.'))) return;
  const r = await api('DELETE', `/api/crm/companies/${encodeURIComponent(id)}`);
  if (r && r.error) { if (typeof toast === 'function') toast(r.error, 'error'); return; }
  state.ui.crmCompanyId = '';
  nav('companies');
}
Object.assign(window, { openCompanyModal, saveCompanyModal, deleteCompanyRecord });

// Users of this tenant, cached for owner selects.
async function crmUsers() {
  if (!state.crmUsersCache) {
    const r = await api('GET', '/api/users');
    state.crmUsersCache = (r && r.users) ? r.users.filter(u => Number(u.active) === 1 || u.active === true) : [];
  }
  return state.crmUsersCache;
}
window.crmUsers = crmUsers;

// ── Company record page ───────────────────────────────────────
async function renderCompanyRecord(id) {
  const c = document.getElementById('content');
  if (!id) return nav('companies');
  c.innerHTML = '<div class="page-section"><div class="empty"><p>Loading company…</p></div></div>';
  const [r, users] = await Promise.all([api('GET', `/api/crm/companies/${encodeURIComponent(id)}`), crmUsers()]);
  if (!r || r.error) { c.innerHTML = `<div class="page-section"><a onclick="nav('companies')" class="rec-back">&larr; Companies</a><div class="empty"><p>${esc((r && r.error) || 'Company not found')}</p></div></div>`; return; }
  state.crmCompany = r;
  const x = r.company;
  const title = document.getElementById('page-title');
  if (title) title.textContent = x.name;
  const ownerOpts = [{ value: '', label: 'Unassigned' }, ...users.map(u => ({ value: u.id, label: u.display_name || u.email }))];
  const contacts = r.contacts || [];
  const open = contacts.filter(k => !['won', 'lost'].includes(k.stage));
  c.innerHTML = `
    <div class="rec-page">
      <div class="rec-topbar">
        <a onclick="nav('companies')" class="rec-back">&larr; Companies</a>
        <div class="rec-topbar-actions">
          <button class="btn btn-ghost btn-sm" type="button" onclick="openCompanyModal('${esc(x.id)}')">Edit</button>
          <button class="btn btn-ghost btn-sm" type="button" style="color:var(--red)" onclick="deleteCompanyRecord('${esc(x.id)}')">Delete</button>
        </div>
      </div>
      <div class="rec">
        <aside class="rec-left">
          <div class="card rec-identity">
            <div class="rec-identity-head">
              <div class="co-avatar co-avatar-lg">${esc(companyInitials(x.name))}</div>
              <div class="rec-identity-copy">
                <div class="rec-name">${esc(x.name)}</div>
                ${x.industry ? `<div class="rec-sub">${esc(x.industry)}</div>` : ''}
                ${x.domain ? `<a class="rec-email" href="https://${esc(x.domain)}" target="_blank" rel="noopener">${esc(x.domain)}</a>` : ''}
              </div>
            </div>
            <div class="rec-actions">
              ${recActionButton('Contact', '👤', `openContactModal({company:'${esc(x.name).replace(/'/g, '&#39;')}'})`)}
              ${x.phone ? recActionButton('Call', '📞', `window.location.href='tel:${esc(String(x.phone).replace(/\s+/g, ''))}'`) : ''}
              ${x.website ? recActionButton('Website', '🌐', `window.open('${esc(x.website)}','_blank')`) : ''}
            </div>
          </div>
          <div class="card rec-props">
            <button class="rec-section-toggle" type="button" onclick="this.parentElement.classList.toggle('collapsed')"><span class="rec-caret">▾</span> About this company</button>
            <div class="rec-section-body" data-target="company">
              ${recProp(x, 'name', 'Name', x.name)}
              ${recProp(x, 'domain', 'Domain', x.domain)}
              ${recProp(x, 'website', 'Website', x.website, { link: true })}
              ${recProp(x, 'phone', 'Phone', x.phone)}
              ${recProp(x, 'industry', 'Industry', x.industry)}
              ${recProp(x, 'owner_user_id', 'Owner', x.owner_name || '', { select: ownerOpts, raw: x.owner_user_id || '' })}
              ${recProp(x, 'notes', 'Notes', x.notes)}
              <div class="hs-prop"><div class="hs-prop-label">Last contacted</div><div class="hs-prop-val">${x.last_contacted_at ? esc(fmtDate(x.last_contacted_at)) : 'Never'}</div></div>
              <div class="hs-prop"><div class="hs-prop-label">Created</div><div class="hs-prop-val">${esc(fmtDate(x.created_at))}</div></div>
            </div>
          </div>
        </aside>
        <section class="rec-main">
          <div class="card ws-card">
            <div class="ws-stat-row">
              <div class="ws-stat"><div class="ws-stat-label">Contacts</div><div class="ws-stat-val">${contacts.length}</div></div>
              <div class="ws-stat"><div class="ws-stat-label">Open value</div><div class="ws-stat-val">${fmtCurrency(x.open_value || 0)}</div></div>
              <div class="ws-stat"><div class="ws-stat-label">Won</div><div class="ws-stat-val">${fmtCurrency(x.won_value || 0)}</div></div>
              <div class="ws-stat"><div class="ws-stat-label">Open deals</div><div class="ws-stat-val">${Number(x.open_deal_count || 0)}</div></div>
            </div>
          </div>
          <div class="card">
            <div class="card-head"><div class="card-title">Deals <span class="text-muted text-sm">(${(r.deals || []).length})</span></div><button class="btn btn-ghost btn-sm" type="button" onclick='openDealModal("", {company_id:"${esc(x.id)}", name:"${esc(x.name).replace(/"/g, '&quot;')} — deal"})'>+ Add deal</button></div>
            ${(r.deals || []).length ? `<div class="table-wrap stack-on-mobile"><table class="data-table">
              <thead><tr><th>Deal</th><th>Stage</th><th>Amount</th><th>Contact</th><th>Close date</th><th>Owner</th></tr></thead>
              <tbody>${r.deals.map(d => `<tr class="contact-row" onclick="openDealRecord('${esc(d.id)}')">
                <td data-label="Deal"><div class="contact-primary">${esc(d.name)}</div></td>
                <td data-label="Stage"><span class="badge deal-badge-${esc(d.stage)}">${esc(DEAL_STAGE_LABELS[d.stage] || d.stage)}</span></td>
                <td data-label="Amount">${d.amount > 0 ? fmtCurrency(d.amount) : '<span class="text-muted">—</span>'}</td>
                <td data-label="Contact" class="text-muted text-sm">${esc(d.contact_name || d.contact_email || '—')}</td>
                <td data-label="Close date" class="text-muted text-sm">${d.close_date ? esc(fmtDay(d.close_date)) : '—'}</td>
                <td data-label="Owner" class="text-muted text-sm">${esc(d.owner_name || '—')}</td>
              </tr>`).join('')}</tbody></table></div>` : '<div class="card-body text-muted">No deals yet.</div>'}
          </div>
          <div class="card">
            <div class="card-head"><div class="card-title">Contacts <span class="text-muted text-sm">(${contacts.length})</span></div><button class="btn btn-ghost btn-sm" type="button" onclick="openContactModal({company:'${esc(x.name).replace(/'/g, '&#39;')}'})">+ Add contact</button></div>
            ${contacts.length ? `<div class="table-wrap stack-on-mobile"><table class="data-table">
              <thead><tr><th>Name</th><th>Title</th><th>Lifecycle</th><th>Follow-up</th><th>Owner</th></tr></thead>
              <tbody>${contacts.map(k => `<tr class="contact-row" onclick="openContactRecord('${esc(k.id)}')">
                <td data-label="Name"><div class="contact-primary">${esc(k.name || k.email)}</div><div class="contact-secondary">${esc(k.email)}</div></td>
                <td data-label="Title" class="text-muted">${esc(k.title || '—')}</td>
                <td data-label="Lifecycle"><span class="badge badge-${esc(k.stage || 'lead')}">${esc(STAGE_LABELS[k.stage] || k.stage || 'Lead')}</span></td>
                <td data-label="Follow-up" class="${k.follow_up_at && isOverdue(k.follow_up_at) ? 'board-overdue' : ''}">${k.follow_up_at ? esc(fmtDateShort(k.follow_up_at)) : '<span class="text-muted">—</span>'}</td>
                <td data-label="Owner" class="text-muted text-sm">${esc(k.owner_name || '—')}</td>
              </tr>`).join('')}</tbody></table></div>` : '<div class="card-body text-muted">No contacts linked yet.</div>'}
          </div>
        </section>
        <aside class="rec-right">
          <div class="card rec-assoc">
            <div class="rec-assoc-head"><span>Open tasks (${(r.tasks || []).length})</span></div>
            ${(r.tasks || []).length ? `<ul class="rec-assoc-list">${r.tasks.map(t => `<li><a onclick="openTaskModal('${esc(t.id)}')">${esc(t.title)}</a><span class="text-muted text-sm ${typeof taskDueClass === 'function' ? taskDueClass(t) : ''}">${t.due_at ? esc(fmtDay(t.due_at)) : ''}</span></li>`).join('')}</ul>` : '<div class="text-muted text-sm">Nothing open across this company\'s contacts.</div>'}
          </div>
          <div class="card rec-assoc">
            <div class="rec-assoc-head"><span>Stages</span></div>
            <div class="ws-stages">${STAGE_ORDER.map(s => { const n = contacts.filter(k => (k.stage || 'lead') === s).length; return n ? `<span class="ws-stage"><span class="badge badge-${s}">${esc(STAGE_LABELS[s])}</span><span>${n}</span></span>` : ''; }).join('') || '<span class="text-muted text-sm">—</span>'}</div>
          </div>
        </aside>
      </div>
    </div>`;
}
window.renderCompanyRecord = renderCompanyRecord;
