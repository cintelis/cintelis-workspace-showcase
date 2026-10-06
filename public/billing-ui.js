// ============================================================
// Cintelis — Contract & Billing (customer users)
// ------------------------------------------------------------
// Company details, contracts, contract documents, and a preview
// pane beside them: click a document and it renders in place
// rather than downloading or opening a tab. The pane is generic
// on purpose — a Xero invoice will be another row in the same
// list once that lands.
//
// Customer admins and members upload signed copies (PDF, image or
// Word); Cintelis admins are notified server-side. Customers can
// delete only documents their own organisation uploaded. Viewers
// are read-only.
//
// Loaded as a regular <script> after customers-ui.js; uses state,
// api(), esc() from app.js, uploadOneFile() from attachments-ui.js,
// renderAttachmentPreviewInto() from attachment-preview.js, and the
// shared contract helpers (contractStatusBadge, formatContractRate,
// fmtDay, contractDownloadUrl) from customers-ui.js.
// ============================================================

(function () {
  state.billing = state.billing || null;
  if (!('billingDocId' in (state.ui || {}))) state.ui.billingDocId = '';
})();

const BILLING_UPLOAD_ACCEPT = 'application/pdf,.pdf,image/png,image/jpeg,image/webp,image/heic,.heic,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function billingCanUpload() {
  return !!(state.me && state.me.role !== 'viewer');
}

function billingField(label, value) {
  const v = (value === null || value === undefined || value === '') ? '<span class="text-muted">—</span>' : esc(value);
  return `
    <div>
      <div class="text-muted text-sm" style="text-transform:uppercase;letter-spacing:.06em;font-size:11px">${esc(label)}</div>
      <div style="margin-top:2px">${v}</div>
    </div>
  `;
}

// Every document on the page, in the order they are listed, so the preview
// pane can resolve an id without caring which card it came from.
function billingAllDocs(r) {
  const out = (Array.isArray(r.documents) ? r.documents : []).map(d => ({ ...d, contract: '' }));
  for (const ct of (Array.isArray(r.contracts) ? r.contracts : [])) {
    for (const a of (Array.isArray(ct.attachments) ? ct.attachments : [])) {
      out.push({ ...a, contract: ct.title || '' });
    }
  }
  return out;
}

function billingDocRow(att, canUpload) {
  const size = typeof formatBytes === 'function' ? formatBytes(att.size_bytes) : (att.size_bytes || '');
  const source = att.from_customer
    ? `<span class="badge badge-sent">Uploaded by you</span> <span class="text-muted text-sm">${esc(att.uploaded_by_name || '')}</span>`
    : `<span class="badge badge-draft">From Cintelis</span>`;
  const del = (att.from_customer && canUpload)
    ? `<button class="btn btn-ghost btn-sm" type="button" style="color:var(--red)" onclick="event.stopPropagation();billingDeleteDocument('${esc(att.id)}')">Delete</button>`
    : '';
  const selected = state.ui.billingDocId === att.id ? ' is-selected' : '';
  return `
    <div class="bill-doc${selected}" role="button" tabindex="0" onclick="billingPreview('${esc(att.id)}')"
         onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();billingPreview('${esc(att.id)}')}">
      <div class="bill-doc-main">
        <div class="bill-doc-name">${typeof mimeIcon === 'function' ? mimeIcon(att.mime_type) : ''} ${esc(att.filename || '(unnamed)')}</div>
        <div class="text-muted text-sm bill-doc-meta">${source} · ${esc(size)}${att.created_at ? ' · ' + esc(fmtDay(att.created_at)) : ''}</div>
      </div>
      <div class="bill-doc-actions">
        <a class="btn btn-ghost btn-sm" href="${esc(contractDownloadUrl(att.id))}"
           onclick="event.stopPropagation()" download="${esc(att.filename || '')}">Download</a>
        ${del}
      </div>
    </div>
  `;
}

// ── Invoices (synced from Cintelis's Xero; see xero-ui.js) ──
// Selected invoices share the preview pane with documents, keyed 'inv:<id>'.
function billingFindInvoice(key) {
  if (!key || !String(key).startsWith('inv:')) return null;
  const id = String(key).slice(4);
  return (state.billingInvoices || []).find(i => i.id === id) || null;
}

function billingInvoiceRow(inv) {
  const key = 'inv:' + inv.id;
  const selected = state.ui.billingDocId === key ? ' is-selected' : '';
  const pay = inv.online_url && inv.status === 'AUTHORISED'
    ? `<a class="btn btn-primary btn-sm" href="${esc(inv.online_url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Pay</a>` : '';
  return `
    <div class="bill-doc${selected}" role="button" tabindex="0" onclick="billingPreview('${esc(key)}')"
         onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();billingPreview('${esc(key)}')}">
      <div class="bill-doc-main">
        <div class="bill-doc-name">🧾 Invoice ${esc(inv.invoice_number || '')} ${xeroStatusBadge(inv)}</div>
        <div class="text-muted text-sm bill-doc-meta">${xeroInvoiceSummary(inv)}${inv.reference ? ' · ' + esc(inv.reference) : ''}</div>
      </div>
      <div class="bill-doc-actions">
        ${pay}
        <a class="btn btn-ghost btn-sm" href="${esc(xeroInvoiceUrl(inv.id, 'download'))}" onclick="event.stopPropagation()" download="${esc('Invoice ' + (inv.invoice_number || '') + '.pdf')}">Download</a>
      </div>
    </div>
  `;
}

async function renderBillingSection() {
  const c = document.getElementById('content');
  if (!c) return;
  if (typeof isCustomerUser !== 'function' || !isCustomerUser()) {
    c.innerHTML = `
      <div class="page-section">
        ${typeof renderEmptyState === 'function' ? renderEmptyState({
          icon: 'document',
          title: 'Contract & Billing is for customer accounts',
          body: 'Internal users manage customer contracts under Settings → Customers.',
        }) : '<div class="empty"><p>Contract &amp; Billing is shown to customer accounts.</p></div>'}
      </div>`;
    return;
  }
  if (!state.billing) c.innerHTML = '<div class="page-section"><div class="empty"><p>Loading contract…</p></div></div>';
  const [r, invR] = await Promise.all([api('GET', '/api/customer'), api('GET', '/api/customer/invoices')]);
  if (!r || r.error || !r.customer) {
    c.innerHTML = `<div class="page-section"><div class="empty"><p>${esc((r && r.error) || 'Could not load your contract details.')}</p></div></div>`;
    return;
  }
  state.billing = r;
  state.billingInvoices = (invR && Array.isArray(invR.invoices)) ? invR.invoices : [];
  const cu = r.customer;
  const contracts = Array.isArray(r.contracts) ? r.contracts : [];
  const canUpload = billingCanUpload();
  const customerDocs = Array.isArray(r.documents) ? r.documents : [];
  const allDocs = billingAllDocs(r);

  // Land on the newest document rather than an empty pane: the contract is
  // what someone opens this page for.
  if (!state.ui.billingDocId || !(allDocs.some(d => d.id === state.ui.billingDocId) || billingFindInvoice(state.ui.billingDocId))) {
    state.ui.billingDocId = allDocs.length ? allDocs[0].id : '';
  }

  const docsCard = `
    <div class="card">
      <div class="card-head">
        <div class="card-title">Contract documents <span class="text-muted text-sm">(${customerDocs.length})</span></div>
        <div>${canUpload ? `
          <input type="file" id="billing-cust-file" accept="${BILLING_UPLOAD_ACCEPT}" multiple style="display:none" onchange="billingUploadCustomerDoc(this)">
          <button class="btn btn-primary btn-sm" id="billing-cust-upload-btn" type="button" onclick="document.getElementById('billing-cust-file').click()">Upload signed contract</button>
        ` : ''}</div>
      </div>
      <div class="card-body">
        ${canUpload ? '<div class="text-muted text-sm" style="margin-bottom:8px">Upload your signed agreement as a PDF, image or Word file, up to 25 MB. The Cintelis team is notified automatically.</div>' : ''}
        <div id="billing-cust-msg" class="text-muted text-sm"></div>
        ${customerDocs.length
          ? customerDocs.map(att => billingDocRow(att, canUpload)).join('')
          : '<div class="text-muted text-sm">No documents yet.</div>'}
      </div>
    </div>`;

  const contractCards = contracts.map(ct => {
    const docs = Array.isArray(ct.attachments) ? ct.attachments : [];
    const signedCount = docs.filter(d => d.from_customer).length;
    const uploadCtl = canUpload ? `
      <input type="file" id="billing-file-${esc(ct.id)}" accept="${BILLING_UPLOAD_ACCEPT}" multiple style="display:none" onchange="billingUploadSigned('${esc(ct.id)}', this)">
      <button class="btn btn-ghost btn-sm" type="button" id="billing-upload-btn-${esc(ct.id)}" onclick="document.getElementById('billing-file-${esc(ct.id)}').click()">Upload signed copy</button>
    ` : '';
    return `
      <div class="card">
        <div class="card-head">
          <div class="card-title" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">${esc(ct.title || 'Contract')} ${contractStatusBadge(ct.status)}${signedCount ? ' <span class="badge badge-sent">Signed copy received</span>' : ''}</div>
        </div>
        <div class="card-body">
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:14px 24px">
            ${billingField('Commencement date', ct.commencement_date ? fmtDay(ct.commencement_date) : '')}
            ${billingField('Initial term', ct.initial_term)}
            ${billingField('Hours per week', ct.hours_per_week)}
            ${billingField('Rate', formatContractRate(ct))}
            ${billingField('Invoicing', ct.invoicing)}
            ${billingField('Payment terms', ct.payment_terms)}
            ${billingField('Key person', ct.key_person)}
          </div>
          ${ct.notes ? `<div style="margin-top:14px">${billingField('Notes', ct.notes)}</div>` : ''}
          <div style="margin-top:18px;padding-top:12px;border-top:1px dashed var(--border)">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:6px">
              <div class="text-muted text-sm" style="font-weight:600">Documents (${docs.length})</div>
              <div>${uploadCtl}</div>
            </div>
            <div id="billing-upload-msg-${esc(ct.id)}" class="text-muted text-sm"></div>
            ${docs.length
              ? docs.map(att => billingDocRow(att, canUpload)).join('')
              : '<div class="text-muted text-sm">No documents attached to this contract yet.</div>'}
          </div>
        </div>
      </div>
    `;
  }).join('');

  c.innerHTML = `
    <div class="page-section page-section-wide">
      <div class="bill-split">
        <div class="bill-col">
          <div class="card">
            <div class="card-head"><div class="card-title">${esc(cu.name || 'Your company')}</div></div>
            <div class="card-body" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px 24px">
              ${billingField('ABN', cu.abn)}
              ${billingField('Address', cu.address)}
              ${billingField('Notices contact', cu.contact_name)}
              ${billingField('Notices email', cu.contact_email)}
            </div>
          </div>

          ${docsCard}
          ${contractCards || `
            <div class="card">
              <div class="card-body">
                ${typeof renderEmptyState === 'function' ? renderEmptyState({
                  icon: 'document',
                  title: 'No contract on file yet',
                  body: 'Your agreement appears here once Cintelis has added it, with its dates, rate and terms. You can still upload a signed copy above.',
                }) : '<div class="empty"><p>No contracts on file yet.</p></div>'}
              </div>
            </div>`}

          <div class="card">
            <div class="card-head"><div class="card-title">Invoices <span class="text-muted text-sm">(${state.billingInvoices.length})</span></div></div>
            <div class="card-body">
              ${state.billingInvoices.length
                ? state.billingInvoices.map(billingInvoiceRow).join('')
                : '<p class="text-muted" style="margin:0">No invoices yet. Invoices from Cintelis appear here once they are issued, with a PDF and a link to pay online.</p>'}
            </div>
          </div>
        </div>

        <aside class="bill-preview" aria-label="Document preview">
          <div class="bill-preview-inner">
            <div class="bill-preview-head">
              <div class="bill-preview-title" id="billing-preview-title">Preview</div>
              <div class="bill-preview-actions" id="billing-preview-actions"></div>
            </div>
            <div class="bill-preview-body" id="billing-preview-body"></div>
          </div>
        </aside>
      </div>
    </div>
  `;

  billingRenderPreview();
}
window.renderBillingSection = renderBillingSection;

// ── Preview pane ────────────────────────────────────────────
function billingPreview(attId) {
  state.ui.billingDocId = attId;
  document.querySelectorAll('.bill-doc').forEach(el => el.classList.remove('is-selected'));
  const row = document.querySelector('.bill-doc[onclick*="' + attId + '"]');
  if (row) row.classList.add('is-selected');
  billingRenderPreview();
  // On a phone the pane sits under the list, so bring it into view.
  if (window.matchMedia('(max-width:900px)').matches) {
    const pane = document.querySelector('.bill-preview');
    if (pane) pane.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
window.billingPreview = billingPreview;

function billingRenderPreview() {
  const body = document.getElementById('billing-preview-body');
  const title = document.getElementById('billing-preview-title');
  const actions = document.getElementById('billing-preview-actions');
  if (!body || !state.billing) return;
  const inv = billingFindInvoice(state.ui.billingDocId);
  if (inv) {
    const name = 'Invoice ' + (inv.invoice_number || '') + '.pdf';
    if (title) title.textContent = 'Invoice ' + (inv.invoice_number || '');
    if (actions) {
      actions.innerHTML = `
        ${inv.online_url && inv.status === 'AUTHORISED' ? `<a class="btn btn-primary btn-sm" href="${esc(inv.online_url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Pay online</a>` : ''}
        <a class="btn btn-ghost btn-sm" href="${esc(xeroInvoiceUrl(inv.id, 'preview'))}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Open in new tab</a>
        <a class="btn btn-ghost btn-sm" href="${esc(xeroInvoiceUrl(inv.id, 'download'))}" download="${esc(name)}" onclick="event.stopPropagation()">Download</a>`;
    }
    if (typeof renderAttachmentPreviewInto === 'function') renderAttachmentPreviewInto(body, xeroInvoiceUrl(inv.id, 'download'), name);
    else body.innerHTML = `<iframe class="attp-iframe" src="${esc(xeroInvoiceUrl(inv.id, 'preview'))}" title="${esc(name)}"></iframe>`;
    return;
  }
  const doc = billingAllDocs(state.billing).find(d => d.id === state.ui.billingDocId);
  if (!doc) {
    if (title) title.textContent = 'Preview';
    if (actions) actions.innerHTML = '';
    body.innerHTML = `
      <div class="bill-preview-empty">
        ${typeof renderEmptyState === 'function' ? renderEmptyState({
          icon: 'document',
          title: 'Nothing to preview yet',
          body: 'Select a document on the left and it opens here. Your signed contract and, later, your invoices.',
        }) : '<p class="text-muted">Select a document to preview it.</p>'}
      </div>`;
    return;
  }
  if (title) title.textContent = doc.filename || 'Preview';
  if (actions) {
    actions.innerHTML = `
      <a class="btn btn-ghost btn-sm" href="${esc(contractPreviewUrl(doc.id))}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Open in new tab</a>
      <a class="btn btn-ghost btn-sm" href="${esc(contractDownloadUrl(doc.id))}" download="${esc(doc.filename || '')}" onclick="event.stopPropagation()">Download</a>`;
  }
  if (typeof renderAttachmentPreviewInto === 'function') {
    renderAttachmentPreviewInto(body, contractDownloadUrl(doc.id), doc.filename || 'document');
  } else {
    body.innerHTML = `<iframe class="attp-iframe" src="${esc(contractDownloadUrl(doc.id).replace('/download', '/preview'))}" title="${esc(doc.filename || '')}"></iframe>`;
  }
}
window.billingRenderPreview = billingRenderPreview;

// ── Uploads ─────────────────────────────────────────────────
async function billingUploadSigned(contractId, input) {
  const files = input && input.files ? Array.from(input.files) : [];
  if (!files.length) return;
  if (typeof uploadOneFile !== 'function') {
    toastError('Upload is unavailable. Please refresh the page.');
    return;
  }
  const msg = document.getElementById('billing-upload-msg-' + contractId);
  const btn = document.getElementById('billing-upload-btn-' + contractId);
  if (btn) btn.disabled = true;
  let ok = 0;
  let lastId = '';
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (msg) msg.textContent = 'Uploading ' + (i + 1) + ' of ' + files.length + ': ' + f.name + '…';
    try {
      const res = await uploadOneFile(f, 'customer_contract', contractId);
      if (res && res.id) lastId = res.id;
      ok++;
    } catch (e) {
      toastError('Upload failed for ' + f.name + ': ' + (e && e.message ? e.message : String(e)));
    }
  }
  try { input.value = ''; } catch (e) { /* ignore */ }
  if (msg) msg.textContent = '';
  if (btn) btn.disabled = false;
  if (ok) {
    toastSuccess(ok === 1 ? 'Document uploaded. Cintelis has been notified.' : ok + ' documents uploaded. Cintelis has been notified.');
    if (lastId) state.ui.billingDocId = lastId;   // preview what was just uploaded
  }
  await renderBillingSection();
}
window.billingUploadSigned = billingUploadSigned;

async function billingDeleteDocument(attId) {
  if (!(await appConfirm('Delete this document? This cannot be undone.'))) return;
  const r = await api('DELETE', '/api/attachments/' + encodeURIComponent(attId));
  if (r && (r.ok || r.deleted)) {
    toastSuccess('Document deleted');
    if (state.ui.billingDocId === attId) state.ui.billingDocId = '';
    await renderBillingSection();
  } else {
    toastError((r && r.error) || 'Failed to delete document');
  }
}
window.billingDeleteDocument = billingDeleteDocument;

// Upload straight to the customer — used when there is no contract record yet.
async function billingUploadCustomerDoc(input) {
  const files = input && input.files ? Array.from(input.files) : [];
  if (!files.length) return;
  if (typeof uploadOneFile !== 'function' || !state.billing || !state.billing.customer) {
    toastError('Upload is unavailable. Please refresh the page.');
    return;
  }
  const customerIdValue = state.billing.customer.id;
  const msg = document.getElementById('billing-cust-msg');
  const btn = document.getElementById('billing-cust-upload-btn');
  if (btn) btn.disabled = true;
  let ok = 0;
  let lastId = '';
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (msg) msg.textContent = 'Uploading ' + (i + 1) + ' of ' + files.length + ': ' + f.name + '…';
    try {
      const res = await uploadOneFile(f, 'customer', customerIdValue);
      if (res && res.id) lastId = res.id;
      ok++;
    } catch (e) {
      toastError('Upload failed for ' + f.name + ': ' + (e && e.message ? e.message : String(e)));
    }
  }
  try { input.value = ''; } catch (e) { /* ignore */ }
  if (msg) msg.textContent = '';
  if (btn) btn.disabled = false;
  if (ok) {
    toastSuccess(ok === 1 ? 'Document uploaded. Cintelis has been notified.' : ok + ' documents uploaded. Cintelis has been notified.');
    if (lastId) state.ui.billingDocId = lastId;
  }
  await renderBillingSection();
}
window.billingUploadCustomerDoc = billingUploadCustomerDoc;
