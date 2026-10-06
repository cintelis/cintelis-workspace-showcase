// ============================================================
// Cintelis Workspace — Xero (Cintelis's organisation, read-only)
// ------------------------------------------------------------
// - Settings › Integrations card (internal admins): connect, pick the
//   organisation, sync now, disconnect.
// - Customer page card (internal admins): link the customer to a Xero
//   contact and list every invoice Xero holds for it.
// - Shared invoice helpers used by billing-ui.js for the customer's own
//   Invoices card.
// Loaded after billing-ui.js; uses state, api(), esc() from app.js,
// fmtDay() from customers-ui.js, toast*/appConfirm.
// ============================================================

function xeroInvoiceUrl(invoiceId, kind) {
  const tk = localStorage.getItem('token') || '';
  return '/api/xero/invoices/' + encodeURIComponent(invoiceId) + '/' + (kind || 'download') + '?token=' + encodeURIComponent(tk);
}
window.xeroInvoiceUrl = xeroInvoiceUrl;

function xeroMoney(amount, currency) {
  const n = Number(amount || 0);
  try { return new Intl.NumberFormat('en-AU', { style: 'currency', currency: currency || 'AUD' }).format(n); }
  catch { return (currency || '') + ' ' + n.toFixed(2); }
}
window.xeroMoney = xeroMoney;

function xeroIsOverdue(inv) {
  if (inv.status !== 'AUTHORISED' || !(Number(inv.amount_due) > 0) || !inv.due_date) return false;
  return inv.due_date < new Date().toISOString().slice(0, 10);
}

function xeroStatusBadge(inv) {
  switch (inv.status) {
    case 'PAID':       return '<span class="badge badge-completed">Paid</span>';
    case 'AUTHORISED': return xeroIsOverdue(inv)
      ? '<span class="badge badge-failed">Overdue</span>'
      : '<span class="badge badge-active">Awaiting payment</span>';
    case 'DRAFT':      return '<span class="badge badge-draft">Draft</span>';
    case 'SUBMITTED':  return '<span class="badge badge-draft">Awaiting approval</span>';
    case 'VOIDED':     return '<span class="badge badge-paused">Voided</span>';
    case 'DELETED':    return '<span class="badge badge-paused">Deleted</span>';
    default:           return `<span class="badge badge-draft">${esc(inv.status || '')}</span>`;
  }
}
window.xeroStatusBadge = xeroStatusBadge;

// One line of an invoice: number, dates, total / due, status.
function xeroInvoiceSummary(inv) {
  const due = inv.status === 'PAID'
    ? (inv.fully_paid_on ? 'Paid ' + fmtDay(inv.fully_paid_on) : 'Paid')
    : (inv.due_date ? 'Due ' + fmtDay(inv.due_date) : '');
  const owing = inv.status === 'AUTHORISED' && Number(inv.amount_due) > 0 && Number(inv.amount_due) !== Number(inv.total)
    ? ` · ${esc(xeroMoney(inv.amount_due, inv.currency))} owing` : '';
  return `${esc(inv.date ? fmtDay(inv.date) : '')}${due ? ' · ' + esc(due) : ''} · ${esc(xeroMoney(inv.total, inv.currency))}${owing}`;
}
window.xeroInvoiceSummary = xeroInvoiceSummary;

// ── Settings › Integrations card (internal admins) ───────────
async function renderXeroIntegrationCard(el) {
  if (!el) return;
  el.innerHTML = '<div class="text-muted text-sm">Loading Xero…</div>';
  const s = await api('GET', '/api/xero/status');
  if (!s || s.error) { el.innerHTML = `<div style="color:var(--danger)">${esc((s && s.error) || 'Could not load Xero status')}</div>`; return; }

  const head = `
    <div style="display:flex;align-items:center;gap:12px;min-width:0">
      <div style="font-size:22px;line-height:1">🧾</div>
      <div style="min-width:0">
        <div style="font-weight:600">Xero</div>
        <div class="text-muted text-sm">Invoices raised in Cintelis's Xero appear on each linked customer's Contract &amp; Billing page. Read-only: nothing is ever changed in Xero.</div>
      </div>
    </div>`;

  if (!s.configured) {
    el.innerHTML = `<div style="display:flex;justify-content:space-between;gap:12px;align-items:center">${head}<span class="badge badge-draft">Not configured</span></div>
      <p class="text-muted text-sm" style="margin:10px 0 0">Set the <span class="mono">XERO_CLIENT_ID</span> and <span class="mono">XERO_CLIENT_SECRET</span> Worker secrets from the Xero developer app, with redirect URI <span class="mono">${esc(location.origin)}/api/xero/callback</span>.</p>`;
    return;
  }
  if (!s.connected) {
    el.innerHTML = `<div style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap">${head}
      <button class="btn btn-primary" type="button" onclick="xeroConnect()">Connect Xero</button></div>`;
    return;
  }

  const tenantPicker = (s.tenants || []).length > 1
    ? `<select onchange="xeroSwitchTenant(this.value)" style="max-width:260px">${s.tenants.map(t =>
        `<option value="${esc(t.tenant_id)}"${t.tenant_id === s.tenant_id ? ' selected' : ''}>${esc(t.tenant_name)}</option>`).join('')}</select>`
    : `<strong>${esc(s.tenant_name || '')}</strong>`;
  const synced = s.last_sync_at
    ? `Last sync ${esc(typeof relTime === 'function' ? relTime(s.last_sync_at) : s.last_sync_at)}`
    : 'Not synced yet';
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap">${head}
      <span class="badge badge-active">Connected</span></div>
    <div style="margin-top:12px;display:grid;gap:6px" class="text-sm">
      <div>Organisation: ${tenantPicker}</div>
      <div class="text-muted">Connected by ${esc(s.connected_by_email || 'an admin')} · ${esc(fmtDay(s.connected_at || ''))} · ${esc(String(s.linked_customers || 0))} customer${s.linked_customers === 1 ? '' : 's'} linked</div>
      <div class="text-muted">${synced} · syncs every ${esc(String(s.sync_minutes || 30))} minutes</div>
      ${s.last_sync_error ? `<div style="color:var(--danger)">Last sync failed: ${esc(s.last_sync_error)}</div>` : ''}
    </div>
    <div class="flex gap" style="justify-content:flex-end;margin-top:12px">
      <button class="btn btn-ghost btn-sm" type="button" onclick="xeroDisconnect()">Disconnect</button>
      <button class="btn btn-ghost btn-sm" type="button" onclick="xeroConnect()">Reconnect</button>
      <button class="btn btn-primary btn-sm" type="button" id="xero-sync-btn" onclick="xeroSyncNow()">Sync now</button>
    </div>`;
}
window.renderXeroIntegrationCard = renderXeroIntegrationCard;

async function xeroConnect() {
  const r = await api('GET', '/api/xero/connect');
  if (!r || r.error || !r.authorizeUrl) { toastError((r && r.error) || 'Could not start the Xero connection'); return; }
  window.open(r.authorizeUrl, 'xero_oauth', 'width=640,height=760');
}
window.xeroConnect = xeroConnect;

async function xeroSwitchTenant(tenantId) {
  const ok = await appConfirm('Switch Xero organisation? Every customer\'s Xero link and synced invoices are cleared, because contacts belong to one organisation.', { danger: true, confirmText: 'Switch' });
  if (!ok) { renderIntegrationsSection(); return; }
  const r = await api('PUT', '/api/xero/tenant', { tenant_id: tenantId });
  if (!r || r.error) toastError((r && r.error) || 'Switch failed'); else toastSuccess('Organisation switched');
  renderIntegrationsSection();
}
window.xeroSwitchTenant = xeroSwitchTenant;

async function xeroDisconnect() {
  const ok = await appConfirm('Disconnect Xero? Invoices stop syncing; customers keep seeing the ones already synced, but invoice PDFs stop opening until you reconnect.', { danger: true, confirmText: 'Disconnect' });
  if (!ok) return;
  const r = await api('POST', '/api/xero/disconnect');
  if (!r || r.error) toastError((r && r.error) || 'Disconnect failed'); else toastSuccess('Xero disconnected');
  renderIntegrationsSection();
}
window.xeroDisconnect = xeroDisconnect;

async function xeroSyncNow() {
  const btn = document.getElementById('xero-sync-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Syncing…'; }
  const r = await api('POST', '/api/xero/sync');
  if (!r || r.error) toastError((r && r.error) || 'Sync failed');
  else toastSuccess(`Synced ${r.invoices || 0} invoice${r.invoices === 1 ? '' : 's'}`);
  renderIntegrationsSection();
}
window.xeroSyncNow = xeroSyncNow;

// ── Customer page card (internal admins) ─────────────────────
async function renderCustomerXero(customerIdValue) {
  const box = document.getElementById('cust-xero-' + customerIdValue);
  if (!box) return;
  const [status, cust, inv] = await Promise.all([
    api('GET', '/api/xero/status'),
    api('GET', '/api/customers/' + encodeURIComponent(customerIdValue)),
    api('GET', '/api/customers/' + encodeURIComponent(customerIdValue) + '/invoices'),
  ]);
  if (!status || status.error) { box.innerHTML = `<span style="color:var(--danger)">${esc((status && status.error) || 'Could not load Xero')}</span>`; return; }
  if (!status.connected) {
    box.innerHTML = '<span class="text-muted">Xero is not connected. Connect it under Settings › Integrations, then link this customer to a Xero contact.</span>';
    return;
  }
  const c = (cust && cust.customer) || {};
  const invoices = (inv && inv.invoices) || [];
  const p = 'cx-' + customerIdValue;
  const linked = c.xero_contact_id
    ? `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
         <div><span class="badge badge-active">Linked</span> &nbsp;<strong>${esc(c.xero_contact_name || c.xero_contact_id)}</strong>
           <span class="text-muted text-sm">in ${esc(status.tenant_name || 'Xero')}</span></div>
         <button class="btn btn-ghost btn-sm" type="button" onclick="xeroUnlinkCustomer('${esc(customerIdValue)}')">Unlink</button>
       </div>`
    : `<div class="text-muted text-sm" style="margin-bottom:8px">Link this customer to their contact in ${esc(status.tenant_name || 'Xero')}. Their issued invoices then show on their Contract &amp; Billing page.</div>`;
  const search = `
    <div class="flex gap" style="margin-top:10px;align-items:flex-end">
      <div class="form-group" style="flex:1;margin:0"><label>${c.xero_contact_id ? 'Change contact' : 'Find Xero contact'}</label>
        <input id="${p}-q" type="text" placeholder="Name or email" value="${esc(c.xero_contact_id ? '' : (c.name || ''))}"
               onkeydown="if(event.key==='Enter'){event.preventDefault();xeroSearchForCustomer('${esc(customerIdValue)}')}"></div>
      <button class="btn btn-ghost" type="button" onclick="xeroSearchForCustomer('${esc(customerIdValue)}')">Search</button>
    </div>
    <div id="${p}-results"></div>`;
  const rows = invoices.length
    ? `<table class="data-table" style="margin-top:14px"><thead><tr><th>Invoice</th><th>Date</th><th>Due</th><th style="text-align:right">Total</th><th style="text-align:right">Owing</th><th>Status</th><th></th></tr></thead><tbody>
        ${invoices.map(i => `<tr>
          <td class="mono">${esc(i.invoice_number || '—')}${i.reference ? `<div class="text-muted text-sm">${esc(i.reference)}</div>` : ''}</td>
          <td>${esc(i.date ? fmtDay(i.date) : '')}</td>
          <td>${esc(i.due_date ? fmtDay(i.due_date) : '')}</td>
          <td style="text-align:right">${esc(xeroMoney(i.total, i.currency))}</td>
          <td style="text-align:right">${esc(xeroMoney(i.amount_due, i.currency))}</td>
          <td>${xeroStatusBadge(i)}</td>
          <td style="text-align:right;white-space:nowrap"><a class="btn btn-ghost btn-sm" href="${esc(xeroInvoiceUrl(i.id, 'preview'))}" target="_blank" rel="noopener">PDF</a></td>
        </tr>`).join('')}
      </tbody></table>
      <div class="text-muted text-sm" style="margin-top:6px">Drafts, voided and deleted invoices are shown here only; the customer sees awaiting-payment and paid invoices.</div>`
    : (c.xero_contact_id ? '<div class="text-muted text-sm" style="margin-top:12px">No sales invoices for this contact yet.</div>' : '');
  box.innerHTML = linked + search + rows;
}
window.renderCustomerXero = renderCustomerXero;

async function xeroSearchForCustomer(customerIdValue) {
  const p = 'cx-' + customerIdValue;
  const out = document.getElementById(p + '-results');
  const q = (document.getElementById(p + '-q') || {}).value || '';
  if (out) out.innerHTML = '<div class="text-muted text-sm" style="margin-top:8px">Searching Xero…</div>';
  const r = await api('GET', '/api/xero/contacts?q=' + encodeURIComponent(q.trim()));
  if (!out) return;
  if (!r || r.error) { out.innerHTML = `<div style="color:var(--danger);margin-top:8px">${esc((r && r.error) || 'Search failed')}</div>`; return; }
  const list = r.contacts || [];
  if (!list.length) { out.innerHTML = '<div class="text-muted text-sm" style="margin-top:8px">No matching contacts.</div>'; return; }
  window._xeroContacts = Object.fromEntries(list.map(c => [c.id, c]));
  out.innerHTML = `<div style="margin-top:8px;border:1px solid var(--border);border-radius:8px">${list.map(ct => `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid var(--border)">
      <div style="min-width:0"><div style="font-weight:600">${esc(ct.name)}</div>
        <div class="text-muted text-sm">${esc(ct.email || '')}${ct.is_customer ? ' · has sales' : ''}</div></div>
      <button class="btn btn-primary btn-sm" type="button" onclick="xeroLinkCustomer('${esc(customerIdValue)}','${esc(ct.id)}')">Link</button>
    </div>`).join('')}</div>`;
}
window.xeroSearchForCustomer = xeroSearchForCustomer;

async function xeroLinkCustomer(customerIdValue, contactId) {
  const ct = (window._xeroContacts || {})[contactId] || {};
  const r = await api('PUT', '/api/customers/' + encodeURIComponent(customerIdValue) + '/xero-contact',
    { contact_id: contactId, contact_name: ct.name || '' });
  if (!r || r.error) { toastError((r && r.error) || 'Link failed'); return; }
  if (r.sync && r.sync.error) toastError('Linked, but the first sync failed: ' + r.sync.error);
  else toastSuccess(`Linked to ${ct.name || 'Xero contact'} · ${(r.sync && r.sync.invoices) || 0} invoices synced`);
  renderCustomerXero(customerIdValue);
}
window.xeroLinkCustomer = xeroLinkCustomer;

async function xeroUnlinkCustomer(customerIdValue) {
  const ok = await appConfirm('Unlink this customer from Xero? Their synced invoices are removed here (nothing changes in Xero).', { danger: true, confirmText: 'Unlink' });
  if (!ok) return;
  const r = await api('DELETE', '/api/customers/' + encodeURIComponent(customerIdValue) + '/xero-contact');
  if (!r || r.error) { toastError((r && r.error) || 'Unlink failed'); return; }
  toastSuccess('Unlinked from Xero');
  renderCustomerXero(customerIdValue);
}
window.xeroUnlinkCustomer = xeroUnlinkCustomer;
