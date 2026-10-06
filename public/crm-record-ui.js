// ============================================================
// Contact record page (sprint 11) — #/contact/:id
// The HubSpot-shaped view of one contact: a left rail with the identity,
// action buttons and inline-editable properties; a centre timeline of every
// interaction with a composer on top; a right rail of associations.
// Uses the shared globals from app.js (state, api, esc, nav, STAGE_LABELS,
// renderContactAvatar, openContactModal …). Loaded before router.js.
// ============================================================

const REC_KIND_META = {
  note:       { icon: '📝', label: 'Note' },
  call:       { icon: '📞', label: 'Call' },
  meeting:    { icon: '📅', label: 'Meeting' },
  email:      { icon: '✉️', label: 'Email logged' },
  sent_email: { icon: '📤', label: 'Email sent' },
  stage:      { icon: '🔀', label: 'Stage changed' },
  deal:       { icon: '🤝', label: 'Deal' },
  created:    { icon: '✨', label: 'Contact created' },
};

function openContactRecord(id) {
  if (!id) return;
  state.ui.crmContactId = id;
  if (typeof closeDrawer === 'function') closeDrawer();
  return nav('contact');
}
window.openContactRecord = openContactRecord;

async function loadContactRecord(id) {
  const r = await api('GET', `/api/crm/contact/${encodeURIComponent(id)}/record`);
  if (!r || r.error) { state.crmRecord = null; return r; }
  state.crmRecord = r;
  return r;
}

async function renderContactRecord(id) {
  const c = document.getElementById('content');
  if (!c) return;
  if (!id) { return nav('contacts'); }
  c.innerHTML = '<div class="page-section"><div class="empty"><p>Loading contact…</p></div></div>';
  const [r] = await Promise.all([loadContactRecord(id), typeof crmUsers === 'function' ? crmUsers() : Promise.resolve([])]);
  if (!r || r.error) {
    c.innerHTML = `<div class="page-section">
      <a onclick="nav('contacts')" class="rec-back">&larr; Contacts</a>
      <div class="empty"><p>${esc((r && r.error) || 'Contact not found')}</p></div></div>`;
    return;
  }
  const contact = r.contact;
  const title = document.getElementById('page-title');
  if (title) title.textContent = getContactDisplayName(contact);

  c.innerHTML = `
    <div class="rec-page">
      <div class="rec-topbar">
        <a onclick="nav('contacts')" class="rec-back">&larr; Contacts</a>
        <div class="rec-topbar-actions">
          <button class="btn btn-ghost btn-sm" type="button" onclick="recEditContact('${esc(contact.id)}')">Edit</button>
          <button class="btn btn-ghost btn-sm" type="button" style="color:var(--red)" onclick="recDeleteContact('${esc(contact.id)}')">Delete</button>
        </div>
      </div>
      <div class="rec">
        <aside class="rec-left">${renderRecordLeft(contact)}</aside>
        <section class="rec-main">${renderRecordMain(r)}</section>
        <aside class="rec-right">${renderRecordRight(r)}</aside>
      </div>
    </div>`;

  const attBox = document.getElementById('rec-attachments');
  if (attBox && typeof renderAttachmentsPanel === 'function') renderAttachmentsPanel(attBox, 'contact', contact.id);
}
window.renderContactRecord = renderContactRecord;

// ── Left rail ─────────────────────────────────────────────────
function renderRecordLeft(contact) {
  const name = getContactDisplayName(contact);
  const sub = [contact.title, contact.company].filter(Boolean).join(' · ');
  const tel = String(contact.phone || '').replace(/\s+/g, '');
  return `
    <div class="card rec-identity">
      <div class="rec-identity-head">
        ${renderContactAvatar(contact, true)}
        <div class="rec-identity-copy">
          <div class="rec-name">${esc(name)}</div>
          ${sub ? `<div class="rec-sub">${esc(sub)}</div>` : ''}
          <a class="rec-email" href="mailto:${esc(contact.email)}">${esc(contact.email)}</a>
        </div>
      </div>
      <div class="rec-actions">
        ${recActionButton('Note', '📝', `recFocusComposer('note')`)}
        ${recActionButton('Email', '✉️', `recEmail('${esc(contact.id)}')`)}
        ${recActionButton('Call', '📞', tel ? `recCall('${esc(tel)}')` : `recFocusComposer('call')`)}
        ${recActionButton('Meeting', '📅', `recFocusComposer('meeting')`)}
        ${recActionButton('Task', '⏰', `openTaskModal('', {contact_id:'${esc(contact.id)}', contact_name:'${esc(name).replace(/'/g, '&#39;')}'})`)}
      </div>
    </div>

    <div class="card rec-props">
      <button class="rec-section-toggle" type="button" onclick="this.parentElement.classList.toggle('collapsed')">
        <span class="rec-caret">▾</span> About this contact
      </button>
      <div class="rec-section-body">
        ${recProp(contact, 'name', 'Name', contact.name)}
        ${recProp(contact, 'email', 'Email', contact.email, { readonly: true })}
        ${recProp(contact, 'phone', 'Phone', contact.phone)}
        ${recProp(contact, 'company', 'Company', contact.company)}
        ${recProp(contact, 'title', 'Job title', contact.title, { readonly: true, hint: 'Edit via the Edit button' })}
        ${recProp(contact, 'stage', 'Lifecycle stage', STAGE_LABELS[contact.stage] || contact.stage || 'Lead', { select: STAGE_ORDER.map(s => ({ value: s, label: STAGE_LABELS[s] })), raw: contact.stage || 'lead' })}
        ${recProp(contact, 'follow_up_at', 'Follow-up', contact.follow_up_at ? fmtDay(contact.follow_up_at) : '', { type: 'date', raw: (contact.follow_up_at || '').split('T')[0] })}
        ${recProp(contact, 'owner_user_id', 'Owner', contact.owner_name || '', { select: [{ value: '', label: 'Unassigned' }, ...((state.crmUsersCache || []).map(u => ({ value: u.id, label: u.display_name || u.email })))], raw: contact.owner_user_id || '' })}
        ${recProp(contact, 'linkedin', 'LinkedIn', contact.linkedin, { link: true })}
        ${recProp(contact, 'tags', 'Tags', (contact.tags || []).join(', '), { raw: (contact.tags || []).join(', '), chips: contact.tags || [] })}
        <div class="hs-prop"><div class="hs-prop-label">Last contacted</div><div class="hs-prop-val">${contact.last_contacted_at ? esc(fmtDate(contact.last_contacted_at)) : 'Never'}</div></div>
        <div class="hs-prop"><div class="hs-prop-label">Created</div><div class="hs-prop-val">${esc(fmtDate(contact.created_at))}</div></div>
      </div>
    </div>`;
}

function recActionButton(label, glyph, onclick) {
  return `<button class="rec-action" type="button" onclick="${onclick}" title="${esc(label)}">
    <span class="rec-action-glyph">${glyph}</span><span class="rec-action-label">${esc(label)}</span></button>`;
}

function fmtMoney(v) {
  const n = Number(v || 0);
  try { return n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }); } catch { return '$' + n; }
}

// One property row. Click the value to edit in place; Enter or blur saves,
// Escape cancels. `raw` is the value the input starts with when it differs
// from the display text (dates, money, the stage key).
function recProp(contact, field, label, display, opts = {}) {
  const val = display == null ? '' : String(display);
  const raw = opts.raw !== undefined ? opts.raw : val;
  const editable = !opts.readonly;
  const attrs = editable
    ? `data-field="${esc(field)}" data-raw="${esc(String(raw))}" data-type="${esc(opts.type || 'text')}" ${opts.select ? `data-select='${esc(JSON.stringify(opts.select))}'` : ''} onclick="recStartEdit(this,'${esc(contact.id)}')" title="Click to edit"`
    : (opts.hint ? `title="${esc(opts.hint)}"` : '');
  let shown;
  if (opts.chips && opts.chips.length) shown = opts.chips.map(t => `<span class="tag">${esc(t)}</span>`).join(' ');
  else if (opts.link && val) shown = `<a href="${esc(val)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${esc(val.replace(/^https?:\/\//, ''))}</a>`;
  else shown = esc(val);
  return `<div class="hs-prop ${editable ? 'rec-editable' : ''}" ${attrs}>
    <div class="hs-prop-label">${esc(label)}</div>
    <div class="hs-prop-val">${shown}</div>
  </div>`;
}

function recEditTarget(el) {
  const t = (el.closest('[data-target]') || {}).dataset ? el.closest('[data-target]').dataset.target : 'contact';
  if (t === 'company') return { path: '/api/crm/companies', render: (id) => renderCompanyRecord(id) };
  if (t === 'deal') return { path: '/api/crm/deals', render: (id) => renderDealRecord(id) };
  return { path: '/api/crm/contact', render: (id) => renderContactRecord(id) };
}

function recStartEdit(el, contactId) {
  if (el.classList.contains('editing')) return;
  const field = el.dataset.field;
  const raw = el.dataset.raw || '';
  const type = el.dataset.type || 'text';
  const valEl = el.querySelector('.hs-prop-val');
  el.classList.add('editing');
  let input;
  if (el.dataset.select) {
    const options = JSON.parse(el.dataset.select);
    input = document.createElement('select');
    for (const o of options) {
      const opt = document.createElement('option');
      opt.value = o.value; opt.textContent = o.label; opt.selected = o.value === raw;
      input.appendChild(opt);
    }
  } else {
    input = document.createElement('input');
    input.type = type;
    input.value = raw;
    if (type === 'number') { input.min = '0'; input.step = '100'; }
    if (field === 'tags') input.placeholder = 'comma, separated, tags';
  }
  input.className = 'rec-inline-input';
  const finish = async (save) => {
    if (!el.classList.contains('editing')) return;
    el.classList.remove('editing');
    if (!save) { recEditTarget(el).render(contactId); return; }
    let value = input.value;
    if (field === 'deal_value') value = parseFloat(value) || 0;
    else if (field === 'follow_up_at') value = value ? value + 'T00:00:00Z' : null;
    else if (field === 'tags') value = String(value).split(',').map(t => t.trim()).filter(Boolean);
    else value = String(value).trim();
    if (String(value) === String(raw) || (field === 'tags' && value.join(', ') === raw)) { recEditTarget(el).render(contactId); return; }
    if (field === 'amount') value = parseFloat(value) || 0;
    if (field === 'close_date') value = value || null;
    // The same inline editor serves the company and deal pages: their section
    // is marked data-target and PATCHes that object instead.
    const target = recEditTarget(el);
    const r = await api('PATCH', `${target.path}/${encodeURIComponent(contactId)}`, { [field]: value });
    if (r && r.error) { if (typeof toast === 'function') toast(r.error, 'error'); }
    else if (typeof toast === 'function') toast('Saved', 'success', 1200);
    if (typeof loadCrmStats === 'function') loadCrmStats().catch(() => {});
    target.render(contactId);
  };
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); finish(true); }
    if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
  if (input.tagName === 'SELECT') input.addEventListener('change', () => finish(true));
  valEl.innerHTML = '';
  valEl.appendChild(input);
  input.focus();
  if (input.select) try { input.select(); } catch {}
}
window.recStartEdit = recStartEdit;

function recFocusProp(field) {
  const el = document.querySelector(`.rec-editable[data-field="${field}"]`);
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.click();
}
window.recFocusProp = recFocusProp;

// Email from the record: sent through the tenant's sending identity and
// logged on the timeline. The mail-client fallback stays one click away.
function recEmail(contactId) {
  const c = state.crmRecord && state.crmRecord.contact;
  if (!c) return;
  const first = getContactDisplayName(c).split(' ')[0];
  setModal(`<div class="modal-head"><h3>Email ${esc(getContactDisplayName(c))}</h3><button class="modal-close" onclick="closeModal()">x</button></div>
  <div class="modal-body">
    <div class="form-group"><label>To</label><input value="${esc(c.email)}" readonly style="color:var(--muted2)"></div>
    <div class="form-group"><label>Subject</label><input id="em-subject" placeholder="Subject" onkeydown="if(event.key==='Enter'){document.getElementById('em-body').focus()}"></div>
    <div class="form-group"><label>Message</label><textarea id="em-body" rows="9" style="font-family:var(--font-body);font-size:14px;min-height:180px" placeholder="Hi ${esc(first)},&#10;&#10;"></textarea>
      <div class="text-muted text-sm" style="margin-top:4px">Plain text — blank lines start new paragraphs. {{first_name}} and {{company}} are filled in.</div></div>
    <div class="form-msg" id="em-msg"></div>
    <div class="flex gap" style="justify-content:space-between;align-items:center">
      <a class="text-sm" style="cursor:pointer;color:var(--muted2)" onclick="window.open('mailto:${esc(encodeURIComponent(c.email))}','_blank')">Open in my mail client instead</a>
      <div class="flex gap">
        <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" id="em-send" onclick="recSendEmail('${esc(c.id)}')">Send</button>
      </div>
    </div>
  </div>`);
  setTimeout(() => document.getElementById('em-subject')?.focus(), 0);
}
window.recEmail = recEmail;

async function recSendEmail(contactId) {
  const msg = document.getElementById('em-msg');
  const btn = document.getElementById('em-send');
  const subject = document.getElementById('em-subject').value.trim();
  const body = document.getElementById('em-body').value.trim();
  if (!subject) { if (msg) msg.textContent = 'Subject required'; return; }
  if (!body) { if (msg) msg.textContent = 'Message required'; return; }
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  const r = await api('POST', `/api/crm/contact/${encodeURIComponent(contactId)}/email`, { subject, body });
  if (r && r.error) { if (msg) msg.textContent = r.error; if (btn) { btn.disabled = false; btn.textContent = 'Send'; } return; }
  closeModal();
  if (typeof toast === 'function') toast('Email sent', 'success', 1500);
  renderContactRecord(contactId);
}
window.recSendEmail = recSendEmail;

function recCall(tel) {
  window.location.href = 'tel:' + tel;
  recFocusComposer('call');
}
window.recCall = recCall;

async function recEditContact(id) {
  const detail = await api('GET', `/api/crm/contact/${encodeURIComponent(id)}`);
  if (!detail || detail.error) return;
  openContactModal(normalizeContactRecord(detail.contact), { returnToDrawer: id });
}
window.recEditContact = recEditContact;

async function recDeleteContact(id) {
  if (!(await appConfirm('Delete this contact? This cannot be undone.'))) return;
  const r = await api('DELETE', `/api/contacts/${encodeURIComponent(id)}`);
  if (r && r.error) { if (typeof toast === 'function') toast(r.error, 'error'); return; }
  state.ui.crmContactId = '';
  await loadContacts(state.ui.contactsQuery);
  nav('contacts');
}
window.recDeleteContact = recDeleteContact;

// ── Centre: composer + timeline ───────────────────────────────
function renderRecordMain(r) {
  const contact = r.contact;
  const tasks = r.tasks || [];
  // Open tasks pin above the timeline; a follow-up date with no task of its own
  // (older data) still shows as the legacy card.
  const upcoming = tasks.length
    ? `<div class="card rec-tasks">${tasks.map(t => `<div class="rec-task-row ${typeof taskDueClass === 'function' ? taskDueClass(t) : ''}">
        <input type="checkbox" class="task-check" title="Mark done" onchange="toggleTaskDone('${esc(t.id)}', this.checked)">
        <div class="rec-task-copy">
          <a class="rec-task-title" onclick="openTaskModal('${esc(t.id)}')">${(typeof TASK_TYPE_META !== 'undefined' && TASK_TYPE_META[t.type] || { icon: '☑️' }).icon} ${esc(t.title)}</a>
          <div class="text-muted text-sm">${esc(typeof taskDueText === 'function' ? taskDueText(t) : (t.due_at ? fmtDay(t.due_at) : 'No due date'))}${t.owner_name ? ' · ' + esc(t.owner_name) : ''}<span class="badge prio-${esc(t.priority)}" style="margin-left:6px">${esc(t.priority)}</span></div>
        </div>
        <button class="btn btn-ghost btn-sm" type="button" onclick="openTaskModal('${esc(t.id)}')">Edit</button>
      </div>`).join('')}</div>`
    : (contact.follow_up_at ? renderUpcomingTask(contact) : '');
  return `
    <div class="card rec-composer">
      <div class="rec-composer-tabs" role="tablist">
        ${['note', 'call', 'meeting', 'email'].map((k, i) => `<button type="button" role="tab" class="rec-composer-tab ${i === 0 ? 'active' : ''}" data-kind="${k}" onclick="recPickKind('${k}')">${REC_KIND_META[k].icon} ${esc(REC_KIND_META[k].label.replace(' logged', ''))}</button>`).join('')}
      </div>
      <textarea id="rec-composer-text" class="rec-composer-text" rows="3" placeholder="Start typing to leave a note…" onkeydown="if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){recSubmitComposer('${esc(contact.id)}')}"></textarea>
      <div class="rec-composer-foot">
        <span class="text-muted text-sm">Ctrl+Enter to log</span>
        <button class="btn btn-primary btn-sm" type="button" onclick="recSubmitComposer('${esc(contact.id)}')">Log note</button>
      </div>
    </div>
    ${upcoming}
    <div class="rec-timeline">${renderTimeline(r.timeline, contact.id)}</div>`;
}

function renderUpcomingTask(contact) {
  const due = new Date(contact.follow_up_at);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const overdue = due < today;
  return `<div class="card rec-task ${overdue ? 'rec-task-overdue' : ''}">
    <div class="rec-task-head">
      <span class="rec-task-icon">⏰</span>
      <div class="rec-task-copy">
        <div class="rec-task-title">Follow up with ${esc(getContactDisplayName(contact))}</div>
        <div class="text-muted text-sm">${overdue ? 'Overdue — was due' : 'Due'} ${esc(fmtDay(contact.follow_up_at))}</div>
      </div>
      <div class="rec-task-actions">
        <button class="btn btn-ghost btn-sm" type="button" onclick="recFocusProp('follow_up_at')">Reschedule</button>
        <button class="btn btn-ghost btn-sm" type="button" onclick="recCompleteTask('${esc(contact.id)}')">Mark done</button>
      </div>
    </div>
  </div>`;
}

async function recCompleteTask(contactId) {
  const c = state.crmRecord && state.crmRecord.contact;
  await api('POST', `/api/crm/contact/${encodeURIComponent(contactId)}/notes`, { content: `Follow-up completed${c && c.follow_up_at ? ' (was due ' + fmtDay(c.follow_up_at) + ')' : ''}`, type: 'note' });
  await api('PATCH', `/api/crm/contact/${encodeURIComponent(contactId)}`, { follow_up_at: null });
  if (typeof loadCrmStats === 'function') loadCrmStats().catch(() => {});
  renderContactRecord(contactId);
}
window.recCompleteTask = recCompleteTask;

function recPickKind(kind) {
  document.querySelectorAll('.rec-composer-tab').forEach(b => b.classList.toggle('active', b.dataset.kind === kind));
  const ta = document.getElementById('rec-composer-text');
  const btn = document.querySelector('.rec-composer-foot .btn-primary');
  const labels = { note: ['Start typing to leave a note…', 'Log note'], call: ['What was discussed on the call?', 'Log call'], meeting: ['What happened in the meeting?', 'Log meeting'], email: ['Summarise the email you sent or received', 'Log email'] };
  if (ta) { ta.placeholder = labels[kind][0]; ta.focus(); }
  if (btn) btn.textContent = labels[kind][1];
}
window.recPickKind = recPickKind;

function recFocusComposer(kind) {
  recPickKind(kind);
  const ta = document.getElementById('rec-composer-text');
  if (ta) { ta.scrollIntoView({ block: 'center', behavior: 'smooth' }); ta.focus(); }
}
window.recFocusComposer = recFocusComposer;

async function recSubmitComposer(contactId) {
  const ta = document.getElementById('rec-composer-text');
  const kind = document.querySelector('.rec-composer-tab.active')?.dataset.kind || 'note';
  const content = (ta && ta.value || '').trim();
  if (!content) { if (ta) ta.focus(); return; }
  const r = await api('POST', `/api/crm/contact/${encodeURIComponent(contactId)}/notes`, { content, type: kind });
  if (r && r.error) { if (typeof toast === 'function') toast(r.error, 'error'); return; }
  if (ta) ta.value = '';
  renderContactRecord(contactId);
}
window.recSubmitComposer = recSubmitComposer;

async function recDeleteItem(contactId, itemId) {
  if (!(await appConfirm('Delete this entry?'))) return;
  await api('DELETE', `/api/crm/contact/${encodeURIComponent(contactId)}/notes/${encodeURIComponent(itemId)}`);
  renderContactRecord(contactId);
}
window.recDeleteItem = recDeleteItem;

function renderTimeline(items, contactId) {
  if (!items || !items.length) return '<div class="empty"><p>No activity yet. Log a note, call or meeting above.</p></div>';
  const groups = [];
  let current = null;
  for (const it of items) {
    const d = it.at ? new Date(it.at) : null;
    const key = d && !isNaN(d) ? d.toLocaleString('en-AU', { month: 'long', year: 'numeric' }) : 'Undated';
    if (!current || current.key !== key) { current = { key, items: [] }; groups.push(current); }
    current.items.push(it);
  }
  return groups.map(g => `
    <div class="tl-month">${esc(g.key)}</div>
    ${g.items.map(it => renderTimelineItem(it, contactId)).join('')}`).join('');
}

function renderTimelineItem(it, contactId) {
  const meta = REC_KIND_META[it.kind] || { icon: '•', label: it.kind };
  const when = it.at ? fmtDate(it.at) : '';
  let head, body = '';
  if (it.kind === 'sent_email') {
    head = `<strong>Email sent</strong>${it.campaign ? ` from campaign <em>${esc(it.campaign)}</em>` : ''}`;
    body = `<div class="tl-subject">${esc(it.subject || '(no subject)')}</div>
      <div class="tl-status"><span class="badge badge-${esc(it.status)}">${esc(it.status)}</span>${it.error ? ` <span class="text-muted text-sm">${esc(it.error)}</span>` : ''}${it.template ? ` <span class="text-muted text-sm">· ${esc(it.template)}</span>` : ''}</div>`;
  } else if (it.kind === 'stage') {
    head = `<strong>Stage changed</strong> <span class="text-muted">${esc(it.body)}</span>`;
  } else if (it.kind === 'deal') {
    head = `<strong>Deal</strong> <span class="text-muted">${esc(it.body)}</span>${it.by ? ` <span class="text-muted">· ${esc(it.by)}</span>` : ''}`;
  } else if (it.kind === 'created') {
    head = `<strong>Contact created</strong>`;
  } else {
    head = `<strong>${esc(meta.label)}</strong>${it.by ? ` <span class="text-muted">by ${esc(it.by)}</span>` : ''}`;
    body = `<div class="tl-body">${esc(it.body || '')}</div>`;
  }
  return `<div class="card tl-item tl-${esc(it.kind)}">
    <div class="tl-icon">${meta.icon}</div>
    <div class="tl-copy">
      <div class="tl-head"><div>${head}</div><div class="tl-when">${esc(when)}${it.deletable ? ` <button class="tl-delete" type="button" title="Delete" onclick="recDeleteItem('${esc(contactId)}','${esc(it.id)}')">×</button>` : ''}</div></div>
      ${body}
    </div>
  </div>`;
}

// ── Right rail: associations ──────────────────────────────────
function renderRecordRight(r) {
  const c = r.contact;
  const rel = r.related || {};
  const others = rel.company_contacts || [];
  const lists = rel.lists || [];
  const member = lists.filter(l => l.member);
  const campaigns = rel.campaigns || [];
  return `
    ${typeof renderDealsAssoc === 'function' ? renderDealsAssoc(r.deals || [], { contact_id: c.id, contact_name: getContactDisplayName(c), company_id: c.company_id || '' }) : ''}
    <div class="card rec-assoc">
      <div class="rec-assoc-head"><span>Company</span>${rel.company ? `<a onclick="openCompanyRecord('${esc(rel.company.id)}')">Open</a>` : ''}</div>
      ${c.company ? `
        <div class="rec-assoc-title">${rel.company ? `<a onclick="openCompanyRecord('${esc(rel.company.id)}')" style="cursor:pointer;color:var(--cyan)">${esc(c.company)}</a>` : esc(c.company)}</div>
        ${rel.company && (rel.company.domain || rel.company.phone) ? `<div class="text-muted text-sm">${[rel.company.domain, rel.company.phone].filter(Boolean).map(esc).join(' · ')}</div>` : ''}
        ${others.length ? `<div class="text-muted text-sm" style="margin:6px 0 4px">${others.length} other contact${others.length === 1 ? '' : 's'} here</div>
          <ul class="rec-assoc-list">${others.map(o => `<li><a onclick="openContactRecord('${esc(o.id)}')">${esc(o.name || o.email)}</a> <span class="badge badge-${esc(o.stage || 'lead')}">${esc(STAGE_LABELS[o.stage] || o.stage || 'Lead')}</span></li>`).join('')}</ul>` : '<div class="text-muted text-sm">No other contacts at this company.</div>'}`
        : `<div class="text-muted text-sm">No company set. <a onclick="recFocusProp('company')">Add one</a></div>`}
    </div>

    <div class="card rec-assoc">
      <div class="rec-assoc-head"><span>Lists (${member.length})</span>${lists.length ? `<a onclick="recToggleListPicker()">${member.length ? 'Manage' : '+ Add'}</a>` : ''}</div>
      ${member.length ? `<div class="rec-chips">${member.map(l => `<span class="badge badge-active">${esc(l.name)}</span>`).join('')}</div>` : `<div class="text-muted text-sm">${lists.length ? 'Not on any list yet.' : 'No lists exist yet.'}</div>`}
      ${lists.length ? `<div id="rec-list-picker" class="rec-list-picker" style="display:none">
        ${lists.map(l => `<label class="rec-list-row"><input type="checkbox" ${l.member ? 'checked' : ''} onchange="recToggleList('${esc(c.id)}','${esc(l.id)}',this.checked)"> ${esc(l.name)}</label>`).join('')}
      </div>` : ''}
    </div>

    <div class="card rec-assoc">
      <div class="rec-assoc-head"><span>Campaigns (${campaigns.length})</span></div>
      ${campaigns.length ? `<ul class="rec-assoc-list">${campaigns.map(k => `<li><span>${esc(k.name || k.id)}</span><span class="text-muted text-sm">${esc(fmtDay(k.last_sent_at))}</span></li>`).join('')}</ul>` : '<div class="text-muted text-sm">No campaign emails yet.</div>'}
    </div>

    <div class="card rec-assoc" id="rec-attachments"><div class="rec-assoc-head"><span>Attachments (${Number(rel.attachment_count || 0)})</span></div></div>`;
}

function recToggleListPicker() {
  const p = document.getElementById('rec-list-picker');
  if (p) p.style.display = p.style.display === 'none' ? '' : 'none';
}
window.recToggleListPicker = recToggleListPicker;

async function recToggleList(contactId, listId, on) {
  const r = on
    ? await api('POST', `/api/lists/${encodeURIComponent(listId)}/contacts`, { contact_ids: [contactId] })
    : await api('DELETE', `/api/lists/${encodeURIComponent(listId)}/contacts/${encodeURIComponent(contactId)}`);
  if (r && r.error) { if (typeof toast === 'function') toast(r.error, 'error'); }
  await renderContactRecord(contactId);
  recToggleListPicker();
}
window.recToggleList = recToggleList;
