// ============================================================
// CRM tasks + the sales Workspace (sprint 13)
// Tasks: queues (Due today · Overdue · Upcoming · All open · Completed), a
// create/edit modal, one-click complete. Workspace: the HubSpot-style home —
// "Your tasks" counters, guided actions, today's list and a recent feed.
// Uses the shared globals from app.js. Loaded before crm-record-ui.js.
// ============================================================

const TASK_TYPE_META = {
  todo: { icon: '☑️', label: 'To-do' },
  call: { icon: '📞', label: 'Call' },
  email: { icon: '✉️', label: 'Email' },
  meeting: { icon: '📅', label: 'Meeting' },
};
const TASK_QUEUES = [
  { key: 'today', label: 'Due today' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'upcoming', label: 'Next 7 days' },
  { key: 'open', label: 'All open' },
  { key: 'done', label: 'Completed' },
];

function taskDueClass(t) {
  if (!t.due_at || t.done_at) return '';
  const d = new Date(t.due_at); const today = new Date(); today.setHours(0, 0, 0, 0);
  if (d < today) return 'task-overdue';
  if (d.getTime() < today.getTime() + 86400000) return 'task-today';
  return '';
}
function taskDueText(t) {
  if (!t.due_at) return 'No due date';
  const cls = taskDueClass(t);
  return (cls === 'task-overdue' ? 'Overdue · ' : cls === 'task-today' ? 'Today · ' : '') + fmtDay(t.due_at);
}

// ── Tasks page ────────────────────────────────────────────────
async function loadCrmTasks() {
  const q = state.ui.crmTaskQueue || 'today';
  const mine = state.ui.crmTasksMine ? '&mine=1' : '';
  const r = await api('GET', `/api/crm/tasks?queue=${encodeURIComponent(q)}${mine}`);
  state.crmTasks = (r && r.tasks) || [];
  state.crmTaskCounts = null;
  const ws = await api('GET', '/api/crm/workspace');
  if (ws && ws.counts) state.crmTaskCounts = ws.counts;
}

function renderCrmTasks() {
  const q = state.ui.crmTaskQueue || 'today';
  const counts = state.crmTaskCounts || {};
  const countFor = { today: counts.today, overdue: counts.overdue, open: counts.open };
  const tasks = state.crmTasks || [];
  document.getElementById('content').innerHTML = `
    <div class="toolbar">
      <div class="task-queues">
        ${TASK_QUEUES.map(qq => `<button type="button" class="task-queue ${q === qq.key ? 'active' : ''}" onclick="setCrmTaskQueue('${qq.key}')">${esc(qq.label)}${countFor[qq.key] != null ? ` <span class="task-queue-count">${countFor[qq.key]}</span>` : ''}</button>`).join('')}
      </div>
      <label class="text-muted text-sm task-mine"><input type="checkbox" ${state.ui.crmTasksMine ? 'checked' : ''} onchange="toggleCrmTasksMine(this.checked)"> Only mine</label>
      <span style="flex:1"></span>
      <button class="btn btn-primary" type="button" onclick="openTaskModal()">+ Create task</button>
    </div>
    ${tasks.length ? `<div class="card"><div class="table-wrap stack-on-mobile"><table class="data-table task-table">
      <thead><tr><th style="width:36px"></th><th>Task</th><th>Contact</th><th>Type</th><th>Priority</th><th>Due</th><th>Owner</th><th style="width:60px"></th></tr></thead>
      <tbody>${tasks.map(renderTaskRow).join('')}</tbody></table></div></div>`
      : `<div class="empty"><div class="empty-icon">✓</div><p>${q === 'done' ? 'Nothing completed yet.' : q === 'open' ? 'No open tasks. Create one, or set a follow-up on a contact.' : 'Nothing here — you are caught up.'}</p></div>`}`;
}

function renderTaskRow(t) {
  const meta = TASK_TYPE_META[t.type] || TASK_TYPE_META.todo;
  const done = !!t.done_at;
  return `<tr class="task-row ${done ? 'task-done' : ''}">
    <td><input type="checkbox" class="task-check" ${done ? 'checked' : ''} title="${done ? 'Reopen' : 'Mark done'}" onchange="toggleTaskDone('${esc(t.id)}', this.checked)"></td>
    <td data-label="Task"><a class="task-title" onclick="openTaskModal('${esc(t.id)}')">${esc(t.title)}</a>${t.notes ? `<div class="text-muted text-sm task-notes">${esc(t.notes)}</div>` : ''}</td>
    <td data-label="Contact">${t.contact_id ? `<a onclick="openContactRecord('${esc(t.contact_id)}')" style="cursor:pointer;color:var(--cyan)">${esc(t.contact_name || t.contact_email || '')}</a>${t.contact_company ? `<div class="text-muted text-sm">${esc(t.contact_company)}</div>` : ''}` : '<span class="text-muted">—</span>'}</td>
    <td data-label="Type">${meta.icon} ${esc(meta.label)}</td>
    <td data-label="Priority"><span class="badge prio-${esc(t.priority)}">${esc(t.priority)}</span></td>
    <td data-label="Due" class="${taskDueClass(t)}">${esc(taskDueText(t))}</td>
    <td data-label="Owner" class="text-muted text-sm">${esc(t.owner_name || '—')}</td>
    <td><button class="icon-btn icon-btn-danger" type="button" title="Delete" onclick="deleteCrmTask('${esc(t.id)}')">×</button></td>
  </tr>`;
}

function setCrmTaskQueue(q) { state.ui.crmTaskQueue = q; nav('crm_tasks'); }
function toggleCrmTasksMine(on) { state.ui.crmTasksMine = !!on; nav('crm_tasks'); }
Object.assign(window, { loadCrmTasks, renderCrmTasks, setCrmTaskQueue, toggleCrmTasksMine });

async function toggleTaskDone(id, done) {
  const r = await api('PATCH', `/api/crm/tasks/${encodeURIComponent(id)}`, { done: !!done });
  if (r && r.error) { if (typeof toast === 'function') toast(r.error, 'error'); return; }
  if (typeof toast === 'function') toast(done ? 'Task completed' : 'Task reopened', 'success', 1200);
  refreshAfterTaskChange();
}
async function deleteCrmTask(id) {
  if (!(await appConfirm('Delete this task?'))) return;
  const r = await api('DELETE', `/api/crm/tasks/${encodeURIComponent(id)}`);
  if (r && r.error) { if (typeof toast === 'function') toast(r.error, 'error'); return; }
  refreshAfterTaskChange();
}
function refreshAfterTaskChange() {
  if (typeof loadCrmStats === 'function') loadCrmStats().catch(() => {});
  if (currentSection === 'crm_tasks' || currentSection === 'workspace') nav(currentSection);
  else if (currentSection === 'contact' && typeof renderContactRecord === 'function') renderContactRecord(state.ui.crmContactId);
  else if (currentSection === 'deal' && typeof renderDealRecord === 'function') renderDealRecord(state.ui.crmDealId);
}
Object.assign(window, { toggleTaskDone, deleteCrmTask, refreshAfterTaskChange });

// ── Task modal (create / edit) ────────────────────────────────
async function openTaskModal(taskId, preset = {}) {
  let t = null;
  if (taskId) {
    t = (state.crmTasks || []).find(x => x.id === taskId) || null;
    if (!t) {
      const r = await api('GET', `/api/crm/tasks?queue=open`);
      t = ((r && r.tasks) || []).find(x => x.id === taskId) || null;
      if (!t) { const d = await api('GET', `/api/crm/tasks?queue=done`); t = ((d && d.tasks) || []).find(x => x.id === taskId) || null; }
    }
  }
  const users = await api('GET', '/api/users');
  const userList = (users && users.users) ? users.users.filter(u => Number(u.active) === 1 || u.active === true) : [];
  const me = state.me || {};
  const v = t || { title: preset.title || '', type: preset.type || 'todo', priority: 'medium', due_at: preset.due_at || '', owner_user_id: me.id, notes: '', contact_id: preset.contact_id || '' };
  const contactLabel = t ? (t.contact_name || t.contact_email || '') : (preset.contact_name || '');
  const dueDate = v.due_at ? String(v.due_at).slice(0, 10) : '';
  setModal(`<div class="modal-head"><h3>${t ? 'Edit task' : 'Create task'}</h3><button class="modal-close" onclick="closeModal()">x</button></div>
  <div class="modal-body">
    <div class="form-group"><label>Title</label><input id="tk-title" value="${esc(v.title)}" placeholder="e.g. Call to confirm the site visit" onkeydown="if(event.key==='Enter'){saveTaskModal('${esc(t ? t.id : '')}')}"></div>
    <div class="form-row">
      <div class="form-group"><label>Type</label><select id="tk-type">${Object.entries(TASK_TYPE_META).map(([k, m]) => `<option value="${k}" ${v.type === k ? 'selected' : ''}>${m.label}</option>`).join('')}</select></div>
      <div class="form-group"><label>Priority</label><select id="tk-priority">${['low', 'medium', 'high'].map(p => `<option value="${p}" ${v.priority === p ? 'selected' : ''}>${p[0].toUpperCase() + p.slice(1)}</option>`).join('')}</select></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Due</label><input id="tk-due" type="date" value="${esc(dueDate)}"></div>
      <div class="form-group"><label>Owner</label><select id="tk-owner"><option value="">Unassigned</option>${userList.map(u => `<option value="${esc(u.id)}" ${v.owner_user_id === u.id ? 'selected' : ''}>${esc(u.display_name || u.email)}</option>`).join('')}</select></div>
    </div>
    <div class="form-group"><label>Contact</label>
      <input id="tk-contact" list="tk-contact-list" value="${esc(contactLabel)}" placeholder="Start typing a name or email" oninput="taskContactLookup(this.value)" autocomplete="off">
      <datalist id="tk-contact-list"></datalist>
      <input type="hidden" id="tk-contact-id" value="${esc(v.contact_id || '')}">
    </div>
    <div class="form-group"><label>Notes</label><textarea id="tk-notes" rows="3" style="font-family:var(--font-body);font-size:14px;min-height:70px">${esc(v.notes || '')}</textarea></div>
    <div class="form-msg" id="tk-msg"></div>
    <div class="flex gap" style="justify-content:flex-end">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveTaskModal('${esc(t ? t.id : '')}')">${t ? 'Save changes' : 'Create task'}</button>
    </div>
  </div>`);
  setTimeout(() => document.getElementById('tk-title')?.focus(), 0);
}

let taskContactLookupTimer = null;
function taskContactLookup(q) {
  clearTimeout(taskContactLookupTimer);
  const hidden = document.getElementById('tk-contact-id');
  const list = document.getElementById('tk-contact-list');
  if (!list) return;
  // A picked datalist option carries "Name <email>"; resolve it to an id.
  const picked = (state.taskContactOptions || []).find(c => `${c.name || ''} <${c.email}>`.trim() === q.trim());
  if (picked) { hidden.value = picked.id; return; }
  hidden.value = '';
  if (String(q || '').trim().length < 2) return;
  taskContactLookupTimer = setTimeout(async () => {
    const rows = await api('GET', `/api/contacts?q=${encodeURIComponent(q.trim())}`);
    state.taskContactOptions = Array.isArray(rows) ? rows.slice(0, 20) : [];
    list.innerHTML = state.taskContactOptions.map(c => `<option value="${esc(`${c.name || ''} <${c.email}>`.trim())}"></option>`).join('');
  }, 220);
}

async function saveTaskModal(taskId) {
  const msg = document.getElementById('tk-msg');
  const body = {
    title: document.getElementById('tk-title').value.trim(),
    type: document.getElementById('tk-type').value,
    priority: document.getElementById('tk-priority').value,
    due_at: document.getElementById('tk-due').value || null,
    owner_user_id: document.getElementById('tk-owner').value || null,
    notes: document.getElementById('tk-notes').value,
  };
  const contactId = document.getElementById('tk-contact-id').value;
  const contactText = document.getElementById('tk-contact').value.trim();
  if (contactId || !contactText) body.contact_id = contactId || null;
  if (!body.title) { if (msg) msg.textContent = 'Title required'; return; }
  const r = taskId
    ? await api('PATCH', `/api/crm/tasks/${encodeURIComponent(taskId)}`, body)
    : await api('POST', '/api/crm/tasks', body);
  if (r && r.error) { if (msg) msg.textContent = r.error; return; }
  closeModal();
  if (typeof toast === 'function') toast(taskId ? 'Task saved' : 'Task created', 'success', 1200);
  refreshAfterTaskChange();
}
Object.assign(window, { openTaskModal, taskContactLookup, saveTaskModal });

// ── Workspace ─────────────────────────────────────────────────
async function loadWorkspace() {
  const [ws] = await Promise.all([api('GET', '/api/crm/workspace'), typeof loadDealStats === 'function' ? loadDealStats() : Promise.resolve()]);
  state.workspace = ws || {};
}

function renderWorkspace() {
  const w = state.workspace || {};
  const c = w.counts || {};
  const me = state.me || {};
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const name = (me.display_name || me.email || '').split(' ')[0];
  const today = (w.today || []);
  const upcoming = (w.upcoming || []);
  document.getElementById('content').innerHTML = `
  <div class="ws">
    <div class="ws-main">
      <div class="ws-head">
        <h2 class="ws-title">${esc(greet)}${name ? ', ' + esc(name) : ''}</h2>
        <button class="btn btn-primary btn-sm" type="button" onclick="openTaskModal()">+ Create task</button>
      </div>
      <div class="ws-grid">
        <div class="card ws-card">
          <div class="ws-card-title">Your tasks</div>
          <div class="ws-tasks">
            <div class="ws-stat-col">
              <div class="ws-stat"><div class="ws-stat-label">High priority</div><div class="ws-stat-val ${c.high ? 'ws-stat-hot' : ''}">${c.high || 0}</div></div>
              <div class="ws-stat"><div class="ws-stat-label">All open</div><div class="ws-stat-val">${c.open || 0}</div></div>
            </div>
            <ul class="ws-links">
              <li><a onclick="setCrmTaskQueue('overdue')">Overdue (${c.overdue || 0})</a></li>
              <li><a onclick="setCrmTaskQueue('today')">Due today (${c.today || 0})</a></li>
              <li><a onclick="setCrmTaskQueue('open')">${TASK_TYPE_META.todo.icon} To-dos (${c.todos || 0})</a></li>
              <li><a onclick="setCrmTaskQueue('open')">${TASK_TYPE_META.call.icon} Calls (${c.calls || 0})</a></li>
              <li><a onclick="setCrmTaskQueue('open')">${TASK_TYPE_META.email.icon} Emails (${c.emails || 0})</a></li>
              <li><a onclick="setCrmTaskQueue('open')">${TASK_TYPE_META.meeting.icon} Meetings (${c.meetings || 0})</a></li>
            </ul>
          </div>
        </div>
        <div class="card ws-card">
          <div class="ws-card-title">Pipeline</div>
          <div id="ws-pipeline">${renderWorkspacePipeline()}</div>
        </div>
      </div>

      <div class="card ws-card">
        <div class="ws-card-title">Guided actions <span class="text-muted text-sm" style="font-weight:400">— what the data suggests doing next</span></div>
        ${(w.actions || []).length ? (w.actions || []).map(renderWorkspaceAction).join('') : '<div class="text-muted" style="padding:6px 0">Nothing suggested right now — every lead has been contacted recently or has a task.</div>'}
      </div>
    </div>

    <aside class="ws-side">
      <div class="card ws-card">
        <div class="ws-card-title">Today <span class="text-muted text-sm" style="font-weight:400">${esc(new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' }))}</span></div>
        ${today.length ? `<ul class="ws-tasklist">${today.map(renderWorkspaceTask).join('')}</ul>` : '<div class="text-muted text-sm" style="padding:4px 0">Nothing due today.</div>'}
        ${upcoming.length ? `<div class="ws-sub">Next 7 days</div><ul class="ws-tasklist">${upcoming.map(renderWorkspaceTask).join('')}</ul>` : ''}
      </div>
      <div class="card ws-card">
        <div class="ws-card-title">Feed</div>
        ${(w.feed || []).length ? `<ul class="ws-feed">${(w.feed || []).map(f => `<li>
          <span class="ws-feed-icon">${feedIcon(f.kind)}</span>
          <div class="ws-feed-copy"><a onclick="openContactRecord('${esc(f.contact_id)}')">${esc(f.contact_name)}</a> <span class="text-muted">· ${esc(feedLabel(f))}</span>${f.body && f.kind !== 'stage' ? `<div class="ws-feed-body">${esc(String(f.body).slice(0, 140))}</div>` : (f.kind === 'stage' ? `<div class="ws-feed-body text-muted">${esc(f.body)}</div>` : '')}<div class="text-muted text-sm">${esc(typeof relTime === 'function' ? relTime(f.at) : fmtDate(f.at))}${f.by ? ' · ' + esc(f.by) : ''}</div></div>
        </li>`).join('')}</ul>` : '<div class="text-muted text-sm">No activity yet.</div>'}
      </div>
    </aside>
  </div>`;
}

function renderWorkspacePipeline() {
  const st = state.dealStats || {};
  const stages = st.stages || {};
  const won = st.won_month || { count: 0, value: 0 };
  return `<div class="ws-stat-row">
      <div class="ws-stat"><div class="ws-stat-label">Open pipeline</div><div class="ws-stat-val">${fmtCurrency(st.open_value || 0)}</div></div>
      <div class="ws-stat"><div class="ws-stat-label">Open deals</div><div class="ws-stat-val">${Number(st.open_count || 0)}</div></div>
      <div class="ws-stat"><div class="ws-stat-label">Won this month</div><div class="ws-stat-val">${fmtCurrency(won.value)}</div></div>
    </div>
    <div class="ws-stages">${(typeof DEAL_STAGE_ORDER !== 'undefined' ? DEAL_STAGE_ORDER : []).map(s => `<a class="ws-stage" onclick="state.ui.dealFilters={stages:['${s}'],owner:'',company:'',close:'any',q:''};nav('pipeline')"><span class="badge deal-badge-${s}">${esc(DEAL_STAGE_LABELS[s])}</span><span>${Number(stages[s]?.count || 0)}</span></a>`).join('')}</div>
    <div style="margin-top:10px"><a class="text-sm" style="cursor:pointer;color:var(--cyan)" onclick="openDealModal()">+ Create deal</a></div>`;
}

function renderWorkspaceAction(a) {
  const icons = { bounced: '⚠️', new_leads: '✨', past_due_deals: '⏰', quiet_deals: '🤝', won_onboarding: '🏆' };
  const openFn = (c) => c.kind === 'deal' ? `openDealRecord('${esc(c.id)}')` : `openContactRecord('${esc(c.id)}')`;
  const first = (a.contacts || [])[0] || {};
  return `<div class="ws-action">
    <div class="ws-action-icon">${icons[a.key] || '📞'}</div>
    <div class="ws-action-copy">
      <div class="ws-action-title">${esc(a.title)}</div>
      <div class="text-muted text-sm">${esc(a.detail)}</div>
      <div class="ws-action-people">${(a.contacts || []).slice(0, 6).map(c => `<a class="ws-person" onclick="${openFn(c)}" title="${esc(c.email || c.contact_name || '')}">${esc(c.name || c.email || '')}${c.company ? ` <span class="text-muted">· ${esc(c.company)}</span>` : ''}${c.deal_value ? ` <span class="text-muted">· ${fmtCurrency(c.deal_value)}</span>` : ''}</a>`).join('')}${(a.contacts || []).length > 6 ? `<span class="text-muted text-sm">+${a.contacts.length - 6} more</span>` : ''}</div>
    </div>
    <div class="ws-action-cta"><button class="btn btn-ghost btn-sm" type="button" onclick="${first.id ? openFn(first) : ''}">${esc(a.cta)}</button></div>
  </div>`;
}

function renderWorkspaceTask(t) {
  const meta = TASK_TYPE_META[t.type] || TASK_TYPE_META.todo;
  return `<li class="ws-task ${taskDueClass(t)}">
    <input type="checkbox" class="task-check" title="Mark done" onchange="toggleTaskDone('${esc(t.id)}', this.checked)">
    <div class="ws-task-copy">
      <a class="ws-task-title" onclick="openTaskModal('${esc(t.id)}')">${meta.icon} ${esc(t.title)}</a>
      <div class="text-muted text-sm">${esc(taskDueText(t))}${t.contact_id ? ` · <a onclick="openContactRecord('${esc(t.contact_id)}')">${esc(t.contact_name || t.contact_email || '')}</a>` : ''}</div>
    </div>
  </li>`;
}

function feedIcon(kind) { return { note: '📝', call: '📞', meeting: '📅', email: '✉️', stage: '🔀' }[kind] || '•'; }
function feedLabel(f) { return { note: 'note', call: 'call logged', meeting: 'meeting logged', email: 'email logged', stage: 'stage changed' }[f.kind] || f.kind; }
Object.assign(window, { loadWorkspace, renderWorkspace });
