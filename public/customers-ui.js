// ============================================================
// Cintelis — Customers admin UI (internal admins only)
// Onboard client companies ("customers"), manage their users,
// contracts (+ PDF attachments), and see their projects/spaces.
// Loaded as a regular <script> tag after app.js; uses state,
// api(), esc(), nav(), setModal(), toast*(), relTime() and the
// attachments helpers (uploadOneFile / loadAttachments /
// confirmDeleteAttachment) from attachments-ui.js.
// ============================================================

(function () {
  state.customers = state.customers || { items: [], detail: null };
  if (!('customerId' in state.ui)) state.ui.customerId = '';
})();

// ── Constants ────────────────────────────────────────────────
const CUSTOMER_FEATURE_DEFS = [
  { key: 'tasks',        label: 'Projects & issues' },
  { key: 'docs',         label: 'Docs / wiki' },
  { key: 'roadmap',      label: 'Roadmap' },
  { key: 'billing',      label: 'Contract & Billing' },
  { key: 'integrations', label: 'Integrations' },
  { key: 'api_tokens',   label: 'API tokens' },
  { key: 'crm',          label: 'CRM (contacts & pipeline)' },
  { key: 'outreach',     label: 'Outreach (templates & campaigns)' }
];
const CUSTOMER_STATUSES = ['active', 'suspended', 'archived'];
const CUSTOMER_STATUS_LOZENGE = {
  active:    'lozenge-status-done',
  suspended: 'lozenge-status-in_progress',
  archived:  'lozenge-status-backlog'
};
const CONTRACT_STATUSES = ['draft', 'active', 'expired', 'terminated'];
const CONTRACT_STATUS_LOZENGE = {
  draft:      'lozenge-status-backlog',
  active:     'lozenge-status-done',
  expired:    'lozenge-status-in_progress',
  terminated: 'lozenge-priority-highest'
};
const CONTRACT_RATE_UNITS = ['hour', 'day', 'month', 'fixed'];

// ── Shared helpers (also used by billing-ui.js) ──────────────
function customerStatusBadge(status) {
  const s = String(status || 'active');
  return `<span class="lozenge ${CUSTOMER_STATUS_LOZENGE[s] || 'lozenge-status-backlog'}">${esc(s)}</span>`;
}
window.customerStatusBadge = customerStatusBadge;

function contractStatusBadge(status) {
  const s = String(status || 'draft');
  return `<span class="lozenge ${CONTRACT_STATUS_LOZENGE[s] || 'lozenge-status-backlog'}">${esc(s)}</span>`;
}
window.contractStatusBadge = contractStatusBadge;

// "AUD $90.00 / hour ex GST"
function formatContractRate(c) {
  if (!c || c.rate_amount === null || c.rate_amount === undefined || c.rate_amount === '') return '';
  const amt = Number(c.rate_amount);
  if (!isFinite(amt)) return '';
  const cur = c.currency || 'AUD';
  const unit = c.rate_unit || 'hour';
  const per = unit === 'fixed' ? ' fixed' : ' / ' + unit;
  return cur + ' $' + amt.toFixed(2) + per + ' ex GST';
}
window.formatContractRate = formatContractRate;

// YYYY-MM-DD → "01 Jul 2026"
function fmtDay(s) {
  if (!s) return '';
  try {
    const d = new Date(String(s).length === 10 ? s + 'T00:00:00' : s);
    if (isNaN(d.getTime())) return String(s);
    return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch (e) { return String(s); }
}
window.fmtDay = fmtDay;

function slugifyCustomerName(name) {
  return String(name || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function customerFeaturesOn(features) {
  const f = (features && typeof features === 'object') ? features : {};
  return CUSTOMER_FEATURE_DEFS.filter(d => f[d.key] !== false).map(d => d.label);
}

// /download answers Content-Disposition: attachment (always saves);
// /preview answers inline, so "open in new tab" shows PDFs and images.
function contractDownloadUrl(attId) {
  const tk = localStorage.getItem('token') || '';
  return '/api/attachments/' + encodeURIComponent(attId) + '/download?token=' + encodeURIComponent(tk);
}
function contractPreviewUrl(attId) {
  const tk = localStorage.getItem('token') || '';
  return '/api/attachments/' + encodeURIComponent(attId) + '/preview?token=' + encodeURIComponent(tk);
}
window.contractDownloadUrl = contractDownloadUrl;
window.contractPreviewUrl = contractPreviewUrl;

// Populate a "Customer" <select> in the create-project / create-space modals
// (tasks-ui.js / docs-ui.js) for internal admins. No-op for everyone else.
async function injectCustomerSelect(wrapId, selectId) {
  if (typeof isInternalAdmin !== 'function' || !isInternalAdmin()) return;
  const wrap = document.getElementById(wrapId);
  const sel = document.getElementById(selectId);
  if (!wrap || !sel) return;
  let items = state.customers.items || [];
  if (!items.length) {
    const r = await api('GET', '/api/customers');
    items = (r && Array.isArray(r.customers)) ? r.customers : [];
    state.customers.items = items;
  }
  if (!items.length) return;
  sel.innerHTML = '<option value="">Internal (Cintelis)</option>'
    + items.filter(c => c.status !== 'archived')
        .map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  wrap.style.display = '';
}
window.injectCustomerSelect = injectCustomerSelect;

// ── Loaders ──────────────────────────────────────────────────
async function loadCustomers() {
  const r = await api('GET', '/api/customers');
  state.customers.items = (r && Array.isArray(r.customers)) ? r.customers : [];
  return r;
}
window.loadCustomers = loadCustomers;

async function loadCustomerDetail(id) {
  const r = await api('GET', '/api/customers/' + encodeURIComponent(id));
  if (!r || r.error || !r.customer) {
    state.customers.detail = null;
    return r;
  }
  r.users = Array.isArray(r.users) ? r.users : [];
  r.contracts = Array.isArray(r.contracts) ? r.contracts : [];
  r.projects = Array.isArray(r.projects) ? r.projects : [];
  r.spaces = Array.isArray(r.spaces) ? r.spaces : [];
  state.customers.detail = r;
  return r;
}

// ── Section entry point ──────────────────────────────────────
async function renderCustomersSection() {
  const c = document.getElementById('content');
  if (!c) return;
  if (typeof isInternalAdmin !== 'function' || !isInternalAdmin()) {
    c.innerHTML = '<div class="page-section"><div class="empty"><p>Customer management is restricted to internal admins.</p></div></div>';
    return;
  }
  if (state.ui.customerId) {
    await renderCustomerDetail(state.ui.customerId);
    return;
  }
  c.innerHTML = '<div class="page-section"><div class="empty"><p>Loading customers…</p></div></div>';
  const r = await loadCustomers();
  if (r && r.error) {
    c.innerHTML = `<div class="page-section"><div class="empty"><p>${esc(r.error)}</p></div></div>`;
    return;
  }
  renderCustomersList();
}
window.renderCustomersSection = renderCustomersSection;

// Suggested values for the free-text contract fields. They appear as a
// dropdown on the input (datalist) and the first one is pre-filled on a new
// contract; anything else can still be typed.
const CONTRACT_TERM_OPTIONS = [
  '3 months', '6 months', '12 months', '24 months',
  '3 months, then rolling by agreement',
  '12 months, then rolling by agreement',
  'Ongoing, no fixed term',
];
const CONTRACT_INVOICING_OPTIONS = [
  'Weekly or fortnightly', 'Weekly', 'Fortnightly',
  'Monthly in arrears', 'Monthly in advance',
  'On completion of milestones',
];
const CONTRACT_PAYMENT_OPTIONS = [
  '7 days from a correctly rendered tax invoice',
  '14 days from invoice', '30 days from invoice',
  'Due on receipt', 'End of month following invoice',
];

const CONTRACT_DOC_ACCEPT ='application/pdf,.pdf,image/png,image/jpeg,image/webp,image/heic,.heic,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// ── Customer-level documents (no contract record needed) ─────
async function renderCustomerDocuments(customerIdValue) {
  const el = document.getElementById('cust-docs-' + customerIdValue);
  if (!el) return;
  let list = [];
  try {
    if (state.attachments) delete state.attachments['customer:' + customerIdValue];
    list = await loadAttachments('customer', customerIdValue);
  } catch (e) { list = []; }
  const rows = list.map(att => `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid var(--border)">
      <div style="min-width:0">
        <a href="${esc(contractPreviewUrl(att.id))}" target="_blank" rel="noopener" style="font-weight:600">${typeof mimeIcon === 'function' ? mimeIcon(att.mime_type) : ''} ${esc(att.filename || '(unnamed)')}</a>
        <span class="text-muted text-sm"> · ${esc(typeof formatBytes === 'function' ? formatBytes(att.size_bytes) : (att.size_bytes || ''))}${att.created_at && typeof relTime === 'function' ? ' · ' + esc(relTime(att.created_at)) : ''}</span>
        ${att.uploaded_by_customer_id
          ? `<div style="margin-top:2px"><span class="badge badge-sent">Uploaded by customer</span> <span class="text-muted text-sm">${esc(att.uploaded_by_name || '')}</span></div>`
          : (att.uploaded_by_name ? `<div class="text-muted text-sm" style="margin-top:2px">Uploaded by ${esc(att.uploaded_by_name)}</div>` : '')}
      </div>
      <div style="white-space:nowrap">
        <a class="btn btn-ghost btn-sm" href="${esc(contractDownloadUrl(att.id))}" download="${esc(att.filename || '')}">Download</a>
        <button class="btn btn-ghost btn-sm" type="button" style="color:var(--red)" onclick="deleteCustomerDocument('${esc(att.id)}','${esc(customerIdValue)}')">Delete</button>
      </div>
    </div>
  `).join('');
  el.innerHTML = rows || '<div class="text-muted text-sm">No documents yet — upload the signed agreement here.</div>';
}
window.renderCustomerDocuments = renderCustomerDocuments;

async function uploadCustomerDocuments(customerIdValue, input) {
  const files = input && input.files ? Array.from(input.files) : [];
  if (!files.length) return;
  const msg = document.getElementById('cust-doc-msg-' + customerIdValue);
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (msg) msg.textContent = 'Uploading ' + (i + 1) + '/' + files.length + ': ' + f.name + '…';
    try {
      await uploadOneFile(f, 'customer', customerIdValue);
    } catch (e) {
      toastError('Upload failed for ' + f.name + ': ' + (e && e.message ? e.message : String(e)));
    }
  }
  try { input.value = ''; } catch (e) { /* ignore */ }
  if (msg) msg.textContent = '';
  await renderCustomerDocuments(customerIdValue);
}
window.uploadCustomerDocuments = uploadCustomerDocuments;

function deleteCustomerDocument(attId, customerIdValue) {
  confirmDeleteAttachment(attId, 'customer', customerIdValue, () => renderCustomerDocuments(customerIdValue));
}
window.deleteCustomerDocument = deleteCustomerDocument;

function openCustomer(id) {
  state.ui.customerId = id;
  nav('customers');
}
window.openCustomer = openCustomer;

function backToCustomers() {
  state.ui.customerId = '';
  state.customers.detail = null;
  nav('customers');
}
window.backToCustomers = backToCustomers;

// ── List view ────────────────────────────────────────────────
function renderCustomersList() {
  const c = document.getElementById('content');
  if (!c) return;
  const items = state.customers.items || [];
  const rows = items.map(cu => `
    <tr style="cursor:pointer" onclick="openCustomer('${esc(cu.id)}')">
      <td>
        <div style="font-weight:600">${esc(cu.name)}</div>
        ${cu.abn ? `<div class="text-muted text-sm">ABN ${esc(cu.abn)}</div>` : ''}
      </td>
      <td><span class="mono text-sm">${esc(cu.slug || '')}</span></td>
      <td>${customerStatusBadge(cu.status)}</td>
      <td>
        <div>${esc(cu.contact_name || '')}</div>
        ${cu.contact_email ? `<div class="text-muted text-sm">${esc(cu.contact_email)}</div>` : ''}
      </td>
      <td style="text-align:center">${Number(cu.user_count || 0)}</td>
      <td style="text-align:center">${Number(cu.project_count || 0)}</td>
      <td style="text-align:center">${Number(cu.space_count || 0)}</td>
      <td style="text-align:center">${Number(cu.contract_count || 0)}</td>
      <td class="text-muted text-sm">${cu.created_at ? esc(typeof relTime === 'function' ? relTime(cu.created_at) : cu.created_at) : ''}</td>
    </tr>
  `).join('');

  const empty = items.length ? '' : `
    <tr><td colspan="9" style="text-align:center;padding:32px;color:var(--muted)">
      No customers yet. Click <strong>Onboard customer</strong> to set up your first client company.
    </td></tr>
  `;

  c.innerHTML = `
    <div class="page-section page-section-wide">
      <div class="page-section-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
        <div>
          <h2 style="margin:0">Customers</h2>
          <div class="text-muted text-sm" style="margin-top:4px">
            Each customer is an isolated tenant: its users only see their own projects, docs, users, integrations and contract.
          </div>
        </div>
        <button class="btn btn-primary" type="button" onclick="openOnboardCustomerModal()">+ Onboard customer</button>
      </div>
      <div class="card" style="padding:0;overflow:auto">
        <table class="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Slug</th>
              <th>Status</th>
              <th>Contact</th>
              <th style="text-align:center">Users</th>
              <th style="text-align:center">Projects</th>
              <th style="text-align:center">Spaces</th>
              <th style="text-align:center">Contracts</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>${rows}${empty}</tbody>
        </table>
      </div>
    </div>
  `;
}
window.renderCustomersList = renderCustomersList;

// ── Onboard modal ────────────────────────────────────────────
function customerFeatureCheckboxes(prefix, features) {
  const f = (features && typeof features === 'object') ? features : {};
  return `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:6px 14px">
      ${CUSTOMER_FEATURE_DEFS.map(d => `
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;text-transform:none;letter-spacing:0;color:var(--text)">
          <input type="checkbox" id="${esc(prefix)}-feat-${esc(d.key)}" ${f[d.key] !== false ? 'checked' : ''} style="width:auto"> ${esc(d.label)}
        </label>
      `).join('')}
    </div>
  `;
}

function readCustomerFeatures(prefix) {
  const out = {};
  for (const d of CUSTOMER_FEATURE_DEFS) {
    const el = document.getElementById(prefix + '-feat-' + d.key);
    out[d.key] = el ? !!el.checked : true;
  }
  return out;
}

function openOnboardCustomerModal() {
  if (typeof isInternalAdmin !== 'function' || !isInternalAdmin()) return;
  setModal(`
    <div class="modal-head"><div class="modal-title">Onboard customer</div>
      <button class="modal-close" type="button" onclick="closeModal()">x</button></div>
    <div class="modal-body">
      <div class="form-row">
        <div>
          <label>Company name *</label>
          <input id="oc-name" type="text" placeholder="Acme Pty Ltd" autofocus oninput="onboardNameChanged(this.value)">
        </div>
        <div>
          <label>Slug</label>
          <input id="oc-slug" type="text" placeholder="ad-close-group" class="mono" oninput="this.dataset.touched='1'">
        </div>
      </div>
      <div class="form-row" style="margin-top:10px">
        <div>
          <label>ABN</label>
          <input id="oc-abn" type="text" placeholder="12 345 678 901">
        </div>
        <div>
          <label>Address</label>
          <input id="oc-address" type="text" placeholder="Level 1, 123 Example St, Sydney NSW 2000">
        </div>
      </div>
      <div class="form-row" style="margin-top:10px">
        <div>
          <label>Contact name</label>
          <input id="oc-contact-name" type="text" placeholder="Jane Doe">
        </div>
        <div>
          <label>Contact / notices email</label>
          <input id="oc-contact-email" type="email" placeholder="jane@example.com">
        </div>
      </div>
      <label style="margin-top:10px">Notes (internal)</label>
      <textarea id="oc-notes" rows="3" placeholder="Anything the team should know about this account"></textarea>

      <label style="margin-top:14px">Enabled features</label>
      ${customerFeatureCheckboxes('oc', null)}

      <div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--border)">
        <div style="font-weight:600;margin-bottom:4px">Create first admin login</div>
        <div class="text-muted text-sm" style="margin-bottom:10px">Optional. Leave the email blank to add users later.</div>
        <div class="form-row">
          <div>
            <label>Admin email</label>
            <input id="oc-admin-email" type="email" placeholder="admin@customer.com" autocomplete="off">
          </div>
          <div>
            <label>Display name</label>
            <input id="oc-admin-name" type="text" placeholder="Jane Doe">
          </div>
        </div>
        <label style="margin-top:10px">Password (optional)</label>
        <input id="oc-admin-password" type="password" autocomplete="new-password" placeholder="min 8 characters">
        <div class="text-muted text-sm" style="margin-top:4px">Leave blank to auto-generate; a welcome email with a temporary password is sent.</div>
      </div>
      <div class="form-msg" id="oc-msg" style="margin-top:10px"></div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" type="button" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" type="button" id="oc-submit" onclick="submitOnboardCustomer()">Onboard customer</button>
    </div>
  `);
}
window.openOnboardCustomerModal = openOnboardCustomerModal;

function onboardNameChanged(value) {
  const slug = document.getElementById('oc-slug');
  if (!slug || slug.dataset.touched === '1') return;
  slug.value = slugifyCustomerName(value);
}
window.onboardNameChanged = onboardNameChanged;

function val(id) {
  const el = document.getElementById(id);
  return el ? String(el.value || '').trim() : '';
}

async function submitOnboardCustomer() {
  const msg = document.getElementById('oc-msg');
  const btn = document.getElementById('oc-submit');
  const setErr = (t) => { if (msg) { msg.className = 'form-msg form-msg-err'; msg.textContent = t; } };
  if (msg) { msg.className = 'form-msg'; msg.textContent = ''; }

  const name = val('oc-name');
  if (!name) { setErr('Company name is required'); return; }
  const body = {
    name,
    slug: val('oc-slug') || undefined,
    abn: val('oc-abn') || undefined,
    address: val('oc-address') || undefined,
    contact_name: val('oc-contact-name') || undefined,
    contact_email: val('oc-contact-email') || undefined,
    notes: val('oc-notes') || undefined,
    features: readCustomerFeatures('oc')
  };
  const adminEmail = val('oc-admin-email');
  const adminPassword = (document.getElementById('oc-admin-password') || {}).value || '';
  if (adminEmail) {
    if (adminPassword && adminPassword.length < 8) { setErr('Admin password must be at least 8 characters'); return; }
    body.admin_user = { email: adminEmail, display_name: val('oc-admin-name') || undefined };
    if (adminPassword) body.admin_user.password = adminPassword;
  } else if (adminPassword || val('oc-admin-name')) {
    setErr('Enter the admin email to create the first login (or clear the admin fields)');
    return;
  }

  if (btn) btn.disabled = true;
  if (msg) { msg.textContent = 'Creating…'; }
  const r = await api('POST', '/api/customers', body);
  if (btn) btn.disabled = false;
  if (!r || r.error || !r.customer) { setErr((r && r.error) || 'Failed to onboard customer'); return; }

  closeModal();
  if (r.admin_user) {
    if (r.admin_user.welcome_email_sent) {
      toastSuccess(`${r.customer.name} onboarded — welcome email sent to ${r.admin_user.email}`);
    } else if (adminPassword) {
      toastSuccess(`${r.customer.name} onboarded — admin login ${r.admin_user.email} created`);
    } else {
      toastError(`${r.customer.name} onboarded, but the welcome email to ${r.admin_user.email} could not be sent. Set a password from the Users card.`, 8000);
    }
  } else {
    toastSuccess(`${r.customer.name} onboarded`);
  }
  openCustomer(r.customer.id);
}
window.submitOnboardCustomer = submitOnboardCustomer;

// ── Detail view ──────────────────────────────────────────────
function detailField(label, value, mono) {
  const v = (value === null || value === undefined || value === '') ? '<span class="text-muted">—</span>' : esc(value);
  return `
    <div>
      <div class="text-muted text-sm" style="text-transform:uppercase;letter-spacing:.06em;font-size:11px">${esc(label)}</div>
      <div style="margin-top:2px${mono ? ';font-family:var(--font-mono)' : ''}">${v}</div>
    </div>
  `;
}

async function renderCustomerDetail(id) {
  const c = document.getElementById('content');
  if (!c) return;
  if (typeof isInternalAdmin !== 'function' || !isInternalAdmin()) {
    c.innerHTML = '<div class="page-section"><div class="empty"><p>Customer management is restricted to internal admins.</p></div></div>';
    return;
  }
  state.ui.customerId = id;
  c.innerHTML = '<div class="page-section"><div class="empty"><p>Loading customer…</p></div></div>';
  const r = await loadCustomerDetail(id);
  if (!r || r.error || !r.customer) {
    c.innerHTML = `
      <div class="page-section">
        <a onclick="backToCustomers()" style="cursor:pointer;color:var(--muted2)">&larr; Back to customers</a>
        <div class="empty"><p>${esc((r && r.error) || 'Customer not found')}</p></div>
      </div>`;
    return;
  }
  const cu = r.customer;
  const features = customerFeaturesOn(cu.features);

  // Users
  const userRows = r.users.map(u => `
    <tr>
      <td>${esc(u.email)}</td>
      <td>${esc(u.display_name || '')}</td>
      <td><span class="role-badge role-${esc(u.role)}">${esc(u.role)}</span></td>
      <td>${Number(u.active) === 1 || u.active === true ? 'Active' : '<span style="color:var(--muted2)">Disabled</span>'}</td>
      <td class="text-muted text-sm">${esc(u.last_login_at ? (typeof relTime === 'function' ? relTime(u.last_login_at) : u.last_login_at) : 'never')}</td>
      <td style="text-align:right;white-space:nowrap">
        ${typeof openResetUserPassword === 'function' ? `<button class="btn btn-ghost btn-sm" type="button" onclick="openResetUserPassword('${esc(u.id)}','${esc(u.email)}')">Reset PW</button>` : ''}
        ${(Number(u.active) === 1 || u.active === true) ? `<button class="btn btn-ghost btn-sm" type="button" onclick="deactivateCustomerUser('${esc(u.id)}','${esc(u.email)}')">Deactivate</button>` : ''}
      </td>
    </tr>
  `).join('');

  // Contracts
  const contractBlocks = r.contracts.map(ct => renderContractBlock(ct)).join('');

  // Projects / spaces
  const projectItems = r.projects.map(p => `
    <li style="padding:6px 0;border-bottom:1px solid var(--border)">
      <a onclick="openCustomerProject('${esc(p.id)}')" style="cursor:pointer"><span class="mono text-sm">${esc(p.key || '')}</span> &nbsp;${esc(p.name || '')}</a>
    </li>`).join('');
  const spaceItems = r.spaces.map(s => `
    <li style="padding:6px 0;border-bottom:1px solid var(--border)">
      <a onclick="openCustomerSpace('${esc(s.id)}')" style="cursor:pointer"><span class="mono text-sm">${esc(s.key || '')}</span> &nbsp;${esc(s.name || '')}</a>
    </li>`).join('');

  c.innerHTML = `
    <div class="page-section page-section-wide">
      <div>
        <a onclick="backToCustomers()" style="cursor:pointer;color:var(--muted2);font-size:13px">&larr; Back to customers</a>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
        <div>
          <h2 style="margin:0;display:flex;align-items:center;gap:10px">${esc(cu.name)} ${customerStatusBadge(cu.status)}</h2>
          <div class="text-muted text-sm" style="margin-top:4px"><span class="mono">${esc(cu.slug || '')}</span> · <span class="mono">${esc(cu.id)}</span></div>
        </div>
        <button class="btn btn-ghost" type="button" id="customer-edit-btn" onclick="toggleEditCustomer()">Edit</button>
      </div>

      <div class="card" id="customer-edit-card" style="display:none">
        <div class="card-head"><div class="card-title">Edit customer</div></div>
        <div class="card-body">
          <div class="form-row">
            <div class="form-group"><label>Company name</label><input id="ec-name" type="text" value="${esc(cu.name || '')}"></div>
            <div class="form-group"><label>Status</label>
              <select id="ec-status">${CUSTOMER_STATUSES.map(s => `<option value="${s}" ${cu.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>ABN</label><input id="ec-abn" type="text" value="${esc(cu.abn || '')}"></div>
            <div class="form-group"><label>Address</label><input id="ec-address" type="text" value="${esc(cu.address || '')}"></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Contact name</label><input id="ec-contact-name" type="text" value="${esc(cu.contact_name || '')}"></div>
            <div class="form-group"><label>Contact / notices email</label><input id="ec-contact-email" type="email" value="${esc(cu.contact_email || '')}"></div>
          </div>
          <div class="form-group"><label>Notes (internal)</label><textarea id="ec-notes" rows="3" style="font-family:var(--font-body);font-size:14px;min-height:80px">${esc(cu.notes || '')}</textarea></div>
          <div class="form-group"><label>Enabled features</label>${customerFeatureCheckboxes('ec', cu.features)}</div>
          <div class="form-msg" id="ec-msg"></div>
          <div class="flex gap" style="justify-content:flex-end">
            <button class="btn btn-ghost" type="button" onclick="toggleEditCustomer(false)">Cancel</button>
            <button class="btn btn-primary" type="button" onclick="submitEditCustomer('${esc(cu.id)}')">Save changes</button>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div class="card-title">Company details</div></div>
        <div class="card-body" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px 24px">
          ${detailField('ABN', cu.abn)}
          ${detailField('Address', cu.address)}
          ${detailField('Contact', cu.contact_name)}
          ${detailField('Notices email', cu.contact_email)}
          ${detailField('Features', features.length ? features.join(', ') : 'none')}
          ${detailField('Created', cu.created_at ? fmtDay(cu.created_at) : '')}
          ${cu.notes ? `<div style="grid-column:1/-1">${detailField('Notes', cu.notes)}</div>` : ''}
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div class="card-title">Email sending identity</div></div>
        <div class="card-body">
          <div class="text-muted text-sm" style="margin-bottom:10px">Outreach campaigns for this customer go out under this address, through the customer's own Cloudflare Access service token on the email gateway. There is no fallback: with nothing set here, their campaigns fail to send rather than going out as Cintelis.</div>
          <div id="cust-sender-${esc(cu.id)}" class="text-muted text-sm">Loading…</div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div class="card-title">Xero invoices</div></div>
        <div class="card-body">
          <div id="cust-xero-${esc(cu.id)}" class="text-muted text-sm">Loading…</div>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <div class="card-title">Users <span class="text-muted text-sm">(${r.users.length})</span></div>
          <button class="btn btn-ghost btn-sm" type="button" onclick="openAddCustomerUser('${esc(cu.id)}')">+ Add user</button>
        </div>
        <div class="card-body" style="padding:0;overflow:auto">
          <table class="data-table">
            <thead><tr><th>Email</th><th>Name</th><th>Role</th><th>Status</th><th>Last login</th><th></th></tr></thead>
            <tbody>${userRows || '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--muted)">No users yet.</td></tr>'}</tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <div class="card-title">Contract documents <span class="text-muted text-sm">(${(r.documents || []).length})</span></div>
          <div>
            <input type="file" id="cust-doc-file-${esc(cu.id)}" accept="${CONTRACT_DOC_ACCEPT}" multiple style="display:none" onchange="uploadCustomerDocuments('${esc(cu.id)}', this)">
            <button class="btn btn-ghost btn-sm" type="button" onclick="document.getElementById('cust-doc-file-${esc(cu.id)}').click()">Upload document</button>
          </div>
        </div>
        <div class="card-body">
          <div class="text-muted text-sm" style="margin-bottom:6px">Signed agreements and other paperwork for this customer. Visible to the customer under Contract &amp; Billing, with or without a contract record.</div>
          <div id="cust-doc-msg-${esc(cu.id)}" class="text-muted text-sm"></div>
          <div id="cust-docs-${esc(cu.id)}"></div>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <div class="card-title">Contracts <span class="text-muted text-sm">(${r.contracts.length})</span></div>
          <button class="btn btn-ghost btn-sm" type="button" onclick="openContractModal('${esc(cu.id)}')">+ Add contract</button>
        </div>
        <div class="card-body" style="display:flex;flex-direction:column;gap:16px">
          ${contractBlocks || '<div class="text-muted">No contracts yet. Add the signed agreement so the customer can see it under Contract &amp; Billing.</div>'}
        </div>
      </div>

      <div class="form-row" style="align-items:start">
        <div class="card">
          <div class="card-head"><div class="card-title">Projects <span class="text-muted text-sm">(${r.projects.length})</span></div></div>
          <div class="card-body">
            ${projectItems ? `<ul style="list-style:none;margin:0;padding:0">${projectItems}</ul>` : '<div class="text-muted">No projects yet. Create one under Projects and assign it to this customer.</div>'}
          </div>
        </div>
        <div class="card">
          <div class="card-head"><div class="card-title">Doc spaces <span class="text-muted text-sm">(${r.spaces.length})</span></div></div>
          <div class="card-body">
            ${spaceItems ? `<ul style="list-style:none;margin:0;padding:0">${spaceItems}</ul>` : '<div class="text-muted">No doc spaces yet. Create one under Docs and assign it to this customer.</div>'}
          </div>
        </div>
      </div>
    </div>
  `;

  // Load contract documents (attachments) and the sender after the DOM exists.
  renderCustomerDocuments(cu.id);
  renderCustomerSender(cu.id);
  if (typeof renderCustomerXero === 'function') renderCustomerXero(cu.id);
  for (const ct of r.contracts) renderContractAttachments(ct.id);
}
window.renderCustomerDetail = renderCustomerDetail;

// ── Email sending identity (sprint 9) ────────────────────────
async function renderCustomerSender(customerIdValue) {
  const box = document.getElementById('cust-sender-' + customerIdValue);
  if (!box) return;
  const r = await api('GET', '/api/customers/' + encodeURIComponent(customerIdValue) + '/sender');
  if (!r || r.error) { box.innerHTML = `<span style="color:var(--danger)">${esc((r && r.error) || 'Could not load sender')}</span>`; return; }
  const s = r.sender || null;
  const p = 'cs-' + customerIdValue;
  box.innerHTML = `
    ${s ? `<div style="margin-bottom:10px"><span class="badge badge-active">Configured</span> &nbsp;<span class="mono text-sm">${esc(s.from_name ? `${s.from_name} <${s.from_email}>` : s.from_email)}</span> <span class="text-muted text-sm">· updated ${esc(fmtDay(s.updated_at || ''))}</span></div>`
        : '<div style="margin-bottom:10px"><span class="badge badge-draft">Not configured</span> &nbsp;<span class="text-muted text-sm">Campaigns for this customer cannot send yet.</span></div>'}
    <div class="form-row">
      <div class="form-group"><label>From email</label><input id="${p}-from-email" type="email" value="${esc(s ? s.from_email : '')}" placeholder="hello@customer.com.au"></div>
      <div class="form-group"><label>From name</label><input id="${p}-from-name" type="text" value="${esc(s ? s.from_name : '')}" placeholder="Customer Pty Ltd"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>CF Access client id</label><input id="${p}-cid" type="text" value="${esc(s ? s.cf_client_id : '')}" class="mono"></div>
      <div class="form-group"><label>CF Access client secret ${s && s.has_secret ? '<span class="text-muted">(stored — leave blank to keep)</span>' : ''}</label><input id="${p}-secret" type="password" autocomplete="new-password"></div>
    </div>
    <div class="form-group"><label>Gateway URL <span class="text-muted">(optional — only when the customer sends through their own email worker)</span></label><input id="${p}-api-url" type="url" value="${esc(s ? s.api_url : '')}" placeholder="https://email.365softlabs.com/api/send"></div>
    <div class="form-msg" id="${p}-msg"></div>
    <div class="flex gap" style="justify-content:flex-end">
      ${s ? `<button class="btn btn-ghost" type="button" onclick="removeCustomerSender('${esc(customerIdValue)}')">Remove</button>` : ''}
      <button class="btn btn-primary" type="button" onclick="saveCustomerSender('${esc(customerIdValue)}')">${s ? 'Update sender' : 'Save sender'}</button>
    </div>`;
}

async function saveCustomerSender(customerIdValue) {
  const p = 'cs-' + customerIdValue;
  const msg = document.getElementById(p + '-msg');
  const body = {
    from_email: val(p + '-from-email'),
    from_name: val(p + '-from-name'),
    cf_client_id: val(p + '-cid'),
    cf_client_secret: val(p + '-secret'),
    api_url: val(p + '-api-url'),
  };
  if (msg) msg.textContent = 'Saving…';
  const r = await api('PUT', '/api/customers/' + encodeURIComponent(customerIdValue) + '/sender', body);
  if (!r || r.error) { if (msg) msg.textContent = (r && r.error) || 'Save failed'; return; }
  if (typeof toast === 'function') toast('Sending identity saved');
  renderCustomerSender(customerIdValue);
}

async function removeCustomerSender(customerIdValue) {
  const r = await api('DELETE', '/api/customers/' + encodeURIComponent(customerIdValue) + '/sender');
  if (!r || r.error) { if (typeof toast === 'function') toast((r && r.error) || 'Remove failed'); return; }
  renderCustomerSender(customerIdValue);
}
window.renderCustomerSender = renderCustomerSender;
window.saveCustomerSender = saveCustomerSender;
window.removeCustomerSender = removeCustomerSender;

function toggleEditCustomer(force) {
  const card = document.getElementById('customer-edit-card');
  if (!card) return;
  const open = typeof force === 'boolean' ? force : card.style.display === 'none';
  card.style.display = open ? '' : 'none';
  if (open) { const n = document.getElementById('ec-name'); if (n) n.focus(); }
}
window.toggleEditCustomer = toggleEditCustomer;

async function submitEditCustomer(id) {
  const msg = document.getElementById('ec-msg');
  if (msg) { msg.className = 'form-msg'; msg.textContent = ''; }
  const name = val('ec-name');
  if (!name) { if (msg) { msg.className = 'form-msg form-msg-err'; msg.textContent = 'Company name is required'; } return; }
  const body = {
    name,
    status: val('ec-status') || 'active',
    abn: val('ec-abn'),
    address: val('ec-address'),
    contact_name: val('ec-contact-name'),
    contact_email: val('ec-contact-email'),
    notes: val('ec-notes'),
    features: readCustomerFeatures('ec')
  };
  const r = await api('PATCH', '/api/customers/' + encodeURIComponent(id), body);
  if (!r || r.error || !r.customer) {
    if (msg) { msg.className = 'form-msg form-msg-err'; msg.textContent = (r && r.error) || 'Failed to save'; }
    return;
  }
  toastSuccess('Customer updated');
  state.customers.items = [];
  await renderCustomerDetail(id);
}
window.submitEditCustomer = submitEditCustomer;

// ── Users ────────────────────────────────────────────────────
function openAddCustomerUser(customerId) {
  setModal(`
    <div class="modal-head"><div class="modal-title">Add user</div>
      <button class="modal-close" type="button" onclick="closeModal()">x</button></div>
    <div class="modal-body">
      <label>Email</label>
      <input id="cu-email" type="email" placeholder="person@customer.com" autofocus>
      <label style="margin-top:10px">Display name</label>
      <input id="cu-name" type="text" placeholder="Jane Doe">
      <label style="margin-top:10px">Role</label>
      <select id="cu-role">
        <option value="member" selected>Member — read &amp; write</option>
        <option value="admin">Admin — can manage this customer's users, integrations and tokens</option>
        <option value="viewer">Viewer — read only</option>
      </select>
      <label style="margin-top:10px">Initial password (min 8 chars)</label>
      <input id="cu-password" type="password" autocomplete="new-password">
      <div class="form-msg" id="cu-msg" style="margin-top:10px"></div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" type="button" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" type="button" onclick="submitAddCustomerUser('${esc(customerId)}')">Create user</button>
    </div>
  `);
}
window.openAddCustomerUser = openAddCustomerUser;

async function submitAddCustomerUser(customerId) {
  const email = val('cu-email');
  const display_name = val('cu-name');
  const role = val('cu-role') || 'member';
  const password = (document.getElementById('cu-password') || {}).value || '';
  const msg = document.getElementById('cu-msg');
  msg.className = 'form-msg';
  if (!email) { msg.textContent = 'Email is required'; msg.classList.add('form-msg-err'); return; }
  if (!password || password.length < 8) { msg.textContent = 'Password must be at least 8 characters'; msg.classList.add('form-msg-err'); return; }
  const r = await api('POST', '/api/users', { email, display_name, role, password, customer_id: customerId });
  if (r && (r.id || r.user) && !r.error) {
    closeModal();
    toastSuccess('User created');
    await renderCustomerDetail(customerId);
  } else {
    msg.textContent = (r && r.error) || 'Failed to create user';
    msg.classList.add('form-msg-err');
  }
}
window.submitAddCustomerUser = submitAddCustomerUser;

async function deactivateCustomerUser(id, email) {
  if (!(await appConfirm(`Deactivate ${email}? Their existing sessions will be revoked immediately.`))) return;
  const r = await api('DELETE', `/api/users/${encodeURIComponent(id)}`);
  if (r && r.ok) {
    toastSuccess('User deactivated');
    await renderCustomerDetail(state.ui.customerId);
  } else {
    toastError((r && r.error) || 'Failed to deactivate');
  }
}
window.deactivateCustomerUser = deactivateCustomerUser;

// ── Contracts ────────────────────────────────────────────────
function renderContractBlock(ct) {
  const customerId = state.ui.customerId;
  const rate = formatContractRate(ct);
  return `
    <div style="border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
        <div style="font-weight:700;display:flex;align-items:center;gap:8px">${esc(ct.title || 'Contract')} ${contractStatusBadge(ct.status)}</div>
        <div style="white-space:nowrap">
          <button class="btn btn-ghost btn-sm" type="button" onclick="openContractModal('${esc(customerId)}','${esc(ct.id)}')">Edit</button>
          <button class="btn btn-ghost btn-sm" type="button" style="color:var(--red)" onclick="deleteContract('${esc(customerId)}','${esc(ct.id)}','${esc(ct.title || '')}')">Delete</button>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px 20px;margin-top:12px">
        ${detailField('Commencement', ct.commencement_date ? fmtDay(ct.commencement_date) : '')}
        ${detailField('Initial term', ct.initial_term)}
        ${detailField('Hours / week', ct.hours_per_week)}
        ${detailField('Rate', rate)}
        ${detailField('Invoicing', ct.invoicing)}
        ${detailField('Payment terms', ct.payment_terms)}
        ${detailField('Key person', ct.key_person)}
      </div>
      ${ct.notes ? `<div style="margin-top:12px">${detailField('Notes', ct.notes)}</div>` : ''}
      <div id="contract-atts-${esc(ct.id)}" style="margin-top:14px;padding-top:12px;border-top:1px dashed var(--border)">
        <div class="text-muted text-sm">Loading documents…</div>
      </div>
    </div>
  `;
}

function openContractModal(customerId, contractId) {
  const detail = state.customers.detail;
  const ct = (contractId && detail && detail.contracts.find(x => x.id === contractId)) || {};
  const isEdit = !!contractId;
  const v = (k) => esc(ct[k] === null || ct[k] === undefined ? '' : ct[k]);
  setModal(`
    <div class="modal-head"><div class="modal-title">${isEdit ? 'Edit contract' : 'Add contract'}</div>
      <button class="modal-close" type="button" onclick="closeModal()">x</button></div>
    <div class="modal-body">
      <div class="form-row">
        <div>
          <label>Title *</label>
          <input id="ct-title" type="text" placeholder="Services Agreement — 2026" value="${v('title')}" autofocus>
        </div>
        <div>
          <label>Status</label>
          <select id="ct-status">${CONTRACT_STATUSES.map(s => `<option value="${s}" ${(ct.status || 'draft') === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
        </div>
      </div>
      <div class="form-row" style="margin-top:10px">
        <div>
          <label>Commencement date</label>
          <input id="ct-commencement" type="date" value="${v('commencement_date')}">
        </div>
        <div>
          <label>Initial term</label>
          <input id="ct-term" type="text" list="ct-term-options" placeholder="12 months" value="${esc(ct.initial_term === undefined ? '3 months' : (ct.initial_term || ''))}">
          <datalist id="ct-term-options">${CONTRACT_TERM_OPTIONS.map(o => `<option value="${esc(o)}"></option>`).join('')}</datalist>
        </div>
      </div>
      <div class="form-row" style="margin-top:10px">
        <div>
          <label>Hours per week</label>
          <input id="ct-hours" type="text" placeholder="20" value="${v('hours_per_week')}">
        </div>
        <div>
          <label>Key person</label>
          <input id="ct-key-person" type="text" placeholder="Nick Forshteyn" value="${v('key_person')}">
        </div>
      </div>
      <div class="form-row" style="margin-top:10px">
        <div>
          <label>Rate amount (ex GST)</label>
          <input id="ct-rate" type="number" step="0.01" min="0" placeholder="90.00" value="${v('rate_amount')}">
        </div>
        <div>
          <label>Rate unit</label>
          <select id="ct-rate-unit">${CONTRACT_RATE_UNITS.map(u => `<option value="${u}" ${(ct.rate_unit || 'hour') === u ? 'selected' : ''}>per ${u}</option>`).join('')}</select>
        </div>
      </div>
      <div class="form-row" style="margin-top:10px">
        <div>
          <label>Currency</label>
          <input id="ct-currency" type="text" maxlength="3" placeholder="AUD" value="${esc(ct.currency || 'AUD')}">
        </div>
        <div>
          <label>Invoicing</label>
          <input id="ct-invoicing" type="text" list="ct-invoicing-options" placeholder="Monthly in arrears" value="${esc(ct.invoicing === undefined ? 'Weekly or fortnightly' : (ct.invoicing || ''))}">
          <datalist id="ct-invoicing-options">${CONTRACT_INVOICING_OPTIONS.map(o => `<option value="${esc(o)}"></option>`).join('')}</datalist>
        </div>
      </div>
      <label style="margin-top:10px">Payment terms</label>
      <input id="ct-payment-terms" type="text" list="ct-payment-options" placeholder="14 days from invoice" value="${esc(ct.payment_terms === undefined ? '7 days from a correctly rendered tax invoice' : (ct.payment_terms || ''))}">
      <datalist id="ct-payment-options">${CONTRACT_PAYMENT_OPTIONS.map(o => `<option value="${esc(o)}"></option>`).join('')}</datalist>
      <label style="margin-top:10px">Notes</label>
      <textarea id="ct-notes" rows="3" placeholder="Visible to the customer under Contract &amp; Billing">${v('notes')}</textarea>
      <div class="form-msg" id="ct-msg" style="margin-top:10px"></div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" type="button" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" type="button" onclick="submitContract('${esc(customerId)}','${esc(contractId || '')}')">${isEdit ? 'Save changes' : 'Add contract'}</button>
    </div>
  `);
}
window.openContractModal = openContractModal;

async function submitContract(customerId, contractId) {
  const msg = document.getElementById('ct-msg');
  msg.className = 'form-msg';
  const title = val('ct-title');
  if (!title) { msg.textContent = 'Title is required'; msg.classList.add('form-msg-err'); return; }
  const rateRaw = val('ct-rate');
  const rate_amount = rateRaw === '' ? null : Number(rateRaw);
  if (rate_amount !== null && !isFinite(rate_amount)) { msg.textContent = 'Rate amount must be a number'; msg.classList.add('form-msg-err'); return; }
  const body = {
    title,
    status: val('ct-status') || 'draft',
    commencement_date: val('ct-commencement') || null,
    initial_term: val('ct-term'),
    hours_per_week: val('ct-hours'),
    rate_amount,
    rate_unit: val('ct-rate-unit') || 'hour',
    currency: (val('ct-currency') || 'AUD').toUpperCase(),
    invoicing: val('ct-invoicing'),
    payment_terms: val('ct-payment-terms'),
    key_person: val('ct-key-person'),
    notes: val('ct-notes')
  };
  const base = '/api/customers/' + encodeURIComponent(customerId) + '/contracts';
  const r = contractId
    ? await api('PATCH', base + '/' + encodeURIComponent(contractId), body)
    : await api('POST', base, body);
  if (!r || r.error || !r.contract) {
    msg.textContent = (r && r.error) || 'Failed to save contract';
    msg.classList.add('form-msg-err');
    return;
  }
  closeModal();
  toastSuccess(contractId ? 'Contract updated' : 'Contract added');
  await renderCustomerDetail(customerId);
}
window.submitContract = submitContract;

async function deleteContract(customerId, contractId, title) {
  if (!(await appConfirm(`Delete contract "${title || contractId}"? Its uploaded documents will no longer be visible to the customer.`))) return;
  const r = await api('DELETE', '/api/customers/' + encodeURIComponent(customerId) + '/contracts/' + encodeURIComponent(contractId));
  if (r && r.ok) {
    toastSuccess('Contract deleted');
    await renderCustomerDetail(customerId);
  } else {
    toastError((r && r.error) || 'Failed to delete contract');
  }
}
window.deleteContract = deleteContract;

// ── Contract documents (attachments, entity_type = customer_contract) ──
async function renderContractAttachments(contractId) {
  const el = document.getElementById('contract-atts-' + contractId);
  if (!el) return;
  let list = [];
  try {
    if (state.attachments) delete state.attachments['customer_contract:' + contractId];
    list = await loadAttachments('customer_contract', contractId);
  } catch (e) { list = []; }
  const rows = list.map(att => `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid var(--border)">
      <div style="min-width:0">
        <a href="${esc(contractPreviewUrl(att.id))}" target="_blank" rel="noopener" style="font-weight:600">${typeof mimeIcon === 'function' ? mimeIcon(att.mime_type) : ''} ${esc(att.filename || '(unnamed)')}</a>
        <span class="text-muted text-sm"> · ${esc(typeof formatBytes === 'function' ? formatBytes(att.size_bytes) : (att.size_bytes || ''))}${att.created_at && typeof relTime === 'function' ? ' · ' + esc(relTime(att.created_at)) : ''}</span>
        ${att.uploaded_by_customer_id
          ? `<div style="margin-top:2px"><span class="badge badge-sent">Uploaded by customer</span> <span class="text-muted text-sm">${esc(att.uploaded_by_name || '')}</span></div>`
          : (att.uploaded_by_name ? `<div class="text-muted text-sm" style="margin-top:2px">Uploaded by ${esc(att.uploaded_by_name)}</div>` : '')}
      </div>
      <div style="white-space:nowrap">
        <a class="btn btn-ghost btn-sm" href="${esc(contractDownloadUrl(att.id))}" download="${esc(att.filename || '')}">Download</a>
        <button class="btn btn-ghost btn-sm" type="button" style="color:var(--red)" onclick="deleteContractAttachment('${esc(att.id)}','${esc(contractId)}')">Delete</button>
      </div>
    </div>
  `).join('');
  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
      <div class="text-muted text-sm" style="font-weight:600">Documents (${list.length})</div>
      <div>
        <input type="file" id="contract-file-${esc(contractId)}" accept="application/pdf,.pdf,image/*,.doc,.docx" multiple style="display:none" onchange="uploadContractFiles('${esc(contractId)}', this)">
        <button class="btn btn-ghost btn-sm" type="button" onclick="document.getElementById('contract-file-${esc(contractId)}').click()">Upload document</button>
      </div>
    </div>
    <div id="contract-upload-msg-${esc(contractId)}" class="text-muted text-sm"></div>
    ${rows || '<div class="text-muted text-sm" style="margin-top:6px">No documents yet — upload the signed PDF.</div>'}
  `;
}
window.renderContractAttachments = renderContractAttachments;

async function uploadContractFiles(contractId, input) {
  const files = input && input.files ? Array.from(input.files) : [];
  if (!files.length) return;
  const msg = document.getElementById('contract-upload-msg-' + contractId);
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (msg) msg.textContent = 'Uploading ' + (i + 1) + '/' + files.length + ': ' + f.name + '…';
    try {
      await uploadOneFile(f, 'customer_contract', contractId);
    } catch (e) {
      toastError('Upload failed for ' + f.name + ': ' + (e && e.message ? e.message : String(e)));
    }
  }
  try { input.value = ''; } catch (e) { /* ignore */ }
  if (msg) msg.textContent = '';
  await renderContractAttachments(contractId);
}
window.uploadContractFiles = uploadContractFiles;

function deleteContractAttachment(attId, contractId) {
  confirmDeleteAttachment(attId, 'customer_contract', contractId, () => renderContractAttachments(contractId));
}
window.deleteContractAttachment = deleteContractAttachment;

// ── Cross-links into Projects / Docs ─────────────────────────
function openCustomerProject(projectId) {
  state.ui.tasksProjectId = projectId;
  state.ui.tasksTab = 'issues';
  state.ui.tasksFilters = { status: '', assignee_id: '', type: '', priority: '', q: '' };
  nav('projects');
}
window.openCustomerProject = openCustomerProject;

function openCustomerSpace(spaceId) {
  if (typeof openSpace === 'function') { openSpace(spaceId); return; }
  state.ui.docsSpaceId = spaceId;
  state.ui.docsPageId = '';
  nav('docs');
}
window.openCustomerSpace = openCustomerSpace;
