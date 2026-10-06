// ============================================================
// Cintelis Workspace — Sprints UI (Sprint 3)
// Frontend for the Board / Backlog / Sprints tabs on top of the
// Sprint 2 tasks module. Loaded as a regular <script> tag after
// tasks-ui.js, so everything here lives on the global scope and
// freely uses helpers from app.js + tasks-ui.js: state, api(),
// esc(), setModal(), closeModal(), tasksCanWrite(), tasksIsAdmin(),
// relTime(), renderMarkdown(), ISSUE_TYPE_ICONS, TASK_STATUS_LABELS,
// TASK_PRIORITY_LABELS, TASK_TYPE_LABELS, openIssueDetail(),
// loadProject(), renderProjectDetail().
// ============================================================

(function () {
  if (!state.ui.tasksTab) state.ui.tasksTab = 'issues';
  if (!('tasksBoardSprintId' in state.ui)) state.ui.tasksBoardSprintId = '';
  if (!('tasksBoardMode' in state.ui)) state.ui.tasksBoardMode = 'sprint';   // 'sprint' | 'kanban'
  if (!('tasksDragIssueId' in state.ui)) state.ui.tasksDragIssueId = '';
  if (!('tasksBacklogSelected' in state.ui)) state.ui.tasksBacklogSelected = [];
  state.tasks = state.tasks || {};
  if (!state.tasks.sprints) state.tasks.sprints = [];
  if (!state.tasks.boardIssues) state.tasks.boardIssues = [];
  if (!state.tasks.boardSprint) state.tasks.boardSprint = null;
  if (!state.tasks.backlogIssues) state.tasks.backlogIssues = [];
  if (!state.tasks.activeSprint) state.tasks.activeSprint = null;
  if (!state.tasks.burndown) state.tasks.burndown = null;
})();

// ── Constants ────────────────────────────────────────────────
const SPRINT_STATE_LABELS = { planned: 'Planned', active: 'Active', completed: 'Completed' };
const BOARD_STATUSES = ['todo', 'in_progress', 'in_review', 'done'];

function isMobileBoard() {
  try { return window.matchMedia('(max-width: 760px)').matches; } catch { return false; }
}

function initialsOf(user) {
  if (!user) return '';
  const name = (user.display_name || user.email || '').trim();
  if (!name) return '';
  return name.split(/\s+/).map(x => x[0]).slice(0, 2).join('').toUpperCase();
}

function formatDateShort(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
    return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short' });
  } catch { return String(iso).slice(0, 10); }
}

// ── Tab dispatch ─────────────────────────────────────────────
async function setTasksTab(tab) {
  const known = ['issues', 'board', 'backlog', 'sprints', 'roadmap'];
  if (!known.includes(tab)) tab = 'issues';
  state.ui.tasksTab = tab;
  if (state.ui.tasksProjectId) {
    await loadProject(state.ui.tasksProjectId);
    renderProjectDetail();
  }
  if (typeof updateTopbarCreate === 'function') updateTopbarCreate();
}
window.setTasksTab = setTasksTab;

async function renderTasksTab() {
  const tab = state.ui.tasksTab || 'issues';
  const projectId = state.ui.tasksProjectId;
  if (!projectId) return;
  if (tab === 'board') {
    await loadBoardTab(projectId);
    renderBoardTab();
  } else if (tab === 'backlog') {
    await loadBacklogTab(projectId);
    renderBacklogTab();
  } else if (tab === 'sprints') {
    await loadSprintsTab(projectId);
    renderSprintsTab();
  } else if (tab === 'roadmap') {
    if (typeof renderRoadmapTab === 'function') renderRoadmapTab();
  }
  // 'issues' tab is rendered by tasks-ui.js itself; nothing to do here.
}
window.renderTasksTab = renderTasksTab;

// Helper: gets the container into which tab body content should render.
// Uses a dedicated element id so we can replace only the tab body area
// without clobbering the header/tab strip.
function getTabBody() {
  return document.getElementById('tasks-tab-body');
}

// ── Board tab ────────────────────────────────────────────────
async function loadBoardTab(projectId) {
  const sr = await api('GET', `/api/projects/${encodeURIComponent(projectId)}/sprints`);
  state.tasks.sprints = (sr && Array.isArray(sr.sprints)) ? sr.sprints : [];

  // Kanban mode: ignore sprints, show all active issues for the project.
  if (state.ui.tasksBoardMode === 'kanban') {
    state.tasks.boardSprint = null;
    const ir = await api('GET', `/api/projects/${encodeURIComponent(projectId)}/issues?limit=500`);
    state.tasks.boardIssues = (ir && Array.isArray(ir.issues)) ? ir.issues : [];
    return;
  }

  // Sprint mode (default): scope to one sprint.
  let chosenId = state.ui.tasksBoardSprintId || '';
  let chosen = null;
  if (chosenId) {
    chosen = state.tasks.sprints.find(s => s.id === chosenId) || null;
    if (!chosen) { chosenId = ''; state.ui.tasksBoardSprintId = ''; }
  }
  if (!chosen) {
    const active = state.tasks.sprints.find(s => s.state === 'active');
    if (active) {
      chosen = active;
      chosenId = active.id;
      state.ui.tasksBoardSprintId = active.id;
    }
  }
  if (!chosen) {
    state.tasks.boardSprint = null;
    state.tasks.boardIssues = [];
    return;
  }
  state.tasks.boardSprint = chosen;
  const ir = await api('GET', `/api/projects/${encodeURIComponent(projectId)}/issues?sprint_id=${encodeURIComponent(chosen.id)}&limit=500`);
  state.tasks.boardIssues = (ir && Array.isArray(ir.issues)) ? ir.issues : [];
}
window.loadBoardTab = loadBoardTab;

async function setBoardMode(mode) {
  state.ui.tasksBoardMode = (mode === 'kanban') ? 'kanban' : 'sprint';
  await loadBoardTab(state.ui.tasksProjectId);
  renderBoardTab();
}
window.setBoardMode = setBoardMode;

function boardModeToggleHtml() {
  const m = state.ui.tasksBoardMode || 'sprint';
  return `
    <div class="board-mode-toggle">
      <button type="button" class="board-mode-btn ${m === 'sprint' ? 'active' : ''}" onclick="setBoardMode('sprint')" title="Show only the active or selected sprint">Sprint</button>
      <button type="button" class="board-mode-btn ${m === 'kanban' ? 'active' : ''}" onclick="setBoardMode('kanban')" title="Show all active issues regardless of sprint">Kanban</button>
    </div>
  `;
}

function sprintSelectorOptions(currentId) {
  const opts = state.tasks.sprints.map(s => {
    const label = `${s.name} — ${SPRINT_STATE_LABELS[s.state] || s.state}`;
    return `<option value="${esc(s.id)}" ${s.id === currentId ? 'selected' : ''}>${esc(label)}</option>`;
  }).join('');
  return opts;
}

function renderBoardTab() {
  const body = getTabBody();
  if (!body) return;
  const canWrite = tasksCanWrite();
  const sprint = state.tasks.boardSprint;
  const mode = state.ui.tasksBoardMode || 'sprint';

  // Sprint mode with no sprint to show: empty state with option to create one
  // OR switch to Kanban mode (which works without any sprints).
  if (mode === 'sprint' && !sprint) {
    const hasAny = state.tasks.sprints.length > 0;
    const selector = hasAny ? `
      <div style="margin-top:16px;display:flex;gap:8px;align-items:center;justify-content:center;flex-wrap:wrap">
        <label class="text-muted text-sm">Or view a sprint:</label>
        <select onchange="onBoardSprintChange(this.value)">
          <option value="">— Select —</option>
          ${sprintSelectorOptions('')}
        </select>
      </div>` : '';
    body.innerHTML = `
      <div class="card" style="margin-bottom:12px">
        <div class="card-body" style="padding:12px 14px;display:flex;justify-content:flex-end">
          ${boardModeToggleHtml()}
        </div>
      </div>
      <div class="card">
        <div class="card-body" style="padding:20px">
          ${typeof renderEmptyState === 'function'
            ? renderEmptyState({ icon: 'sprint', title: 'No active sprint', body: 'Create a sprint to get started — or switch to Kanban mode to see all active issues at once.', actionLabel: canWrite ? '+ New sprint' : undefined, actionOnClick: canWrite ? 'openCreateSprint()' : undefined })
            : `<div class="empty-state-large" style="text-align:center;padding:40px 20px"><h3 style="margin:0 0 8px;font-size:18px">There's no active sprint.</h3><p class="text-muted">Create a sprint to get started — or switch to Kanban mode to see all active issues at once.</p>${canWrite ? '<button class="btn btn-primary" type="button" onclick="openCreateSprint()">+ New sprint</button>' : ''}</div>`}
          ${selector}
        </div>
      </div>
    `;
    return;
  }

  const mobile = isMobileBoard();
  const daysTxt = (sprint && sprint.state === 'active' && sprint.days_remaining != null)
    ? `<span class="text-muted text-sm">${Number(sprint.days_remaining)} day${Number(sprint.days_remaining) === 1 ? '' : 's'} left</span>` : '';

  const grouped = {};
  BOARD_STATUSES.forEach(s => { grouped[s] = []; });
  (state.tasks.boardIssues || []).forEach(i => {
    if (BOARD_STATUSES.includes(i.status)) grouped[i.status].push(i);
  });

  const columns = BOARD_STATUSES.map(status => {
    const cards = grouped[status].map(i => renderIssueCard(i, mobile)).join('');
    return `
      <div class="kanban-col"
           ondragover="onColumnDragOver(event)"
           ondragleave="onColumnDragLeave(event)"
           ondrop="onColumnDrop(event, '${status}')">
        <div class="kanban-col-head kanban-col-head-${status}">
          <span class="kanban-col-dot"></span>
          <span>${esc(TASK_STATUS_LABELS[status] || status)}</span>
          <span class="kanban-col-count">${grouped[status].length}</span>
        </div>
        <div class="kanban-col-body">
          ${cards || '<div class="text-muted text-sm" style="padding:8px;text-align:center">No issues</div>'}
        </div>
      </div>
    `;
  }).join('');

  // Kanban mode header — no sprint metadata, just the toggle + a count.
  const totalShown = (state.tasks.boardIssues || []).length;
  const headerHtml = (mode === 'kanban')
    ? `
      <div class="card" style="margin-bottom:12px">
        <div class="card-body" style="padding:12px 14px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;justify-content:space-between">
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            <strong>Kanban mode</strong>
            <span class="text-muted text-sm">All active issues in this project — sprint boundaries ignored</span>
            <span class="text-muted text-sm">(${totalShown} total)</span>
          </div>
          ${boardModeToggleHtml()}
        </div>
      </div>
    `
    : `
      <div class="card" style="margin-bottom:12px">
        <div class="card-body" style="padding:12px 14px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;justify-content:space-between">
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            <span class="sprint-state-badge sprint-state-${esc(sprint.state)}">${esc(SPRINT_STATE_LABELS[sprint.state] || sprint.state)}</span>
            <strong>${esc(sprint.name)}</strong>
            ${daysTxt}
            <span class="text-muted text-sm">${Number(sprint.done_count || 0)} / ${Number(sprint.issue_count || 0)} done</span>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <select onchange="onBoardSprintChange(this.value)">${sprintSelectorOptions(sprint.id)}</select>
            ${sprint.state === 'active' && canWrite ? `<button class="btn btn-ghost btn-sm" type="button" onclick="openCompleteSprint('${esc(sprint.id)}')">Complete sprint</button>` : ''}
            <button class="btn btn-ghost btn-sm" type="button" onclick="openBurndown('${esc(sprint.id)}')">Burndown</button>
            ${boardModeToggleHtml()}
          </div>
        </div>
      </div>
    `;

  body.innerHTML = `
    ${headerHtml}
    <div class="kanban-board">
      ${columns}
    </div>
  `;
}
window.renderBoardTab = renderBoardTab;

function renderIssueCard(i, mobile) {
  const a = i.assignee;
  const initials = initialsOf(a);
  // Avatar: photo with initials fallback, or a visible "unassigned" placeholder
  let avatarHtml;
  if (a && a.id) {
    const url = '/api/users/' + a.id + '/avatar';
    const name = esc(a.display_name || a.email || '');
    const ini = esc(initials || '?');
    avatarHtml = `<img class="card-avatar" src="${url}" title="${name}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span class="card-avatar-initials" title="${name}" style="display:none">${ini}</span>`;
  } else {
    avatarHtml = '<span class="card-avatar-initials card-avatar-unassigned" title="Unassigned">?</span>';
  }
  const priority = `<span class="lozenge lozenge-priority-${esc(i.priority)}">${esc(TASK_PRIORITY_LABELS[i.priority] || i.priority)}</span>`;
  const draggable = mobile ? '' : 'draggable="true"';
  const dragHandlers = mobile
    ? ``
    : `ondragstart="onCardDragStart(event,'${esc(i.id)}')" ondragend="onCardDragEnd(event)"`;
  const canWrite = tasksCanWrite();
  const doneClass = i.status === 'done' ? ' card-done' : '';
  return `
    <div class="issue-card${doneClass}" ${draggable} ${dragHandlers} onclick="openIssueDetail('${esc(i.id)}')">
      <div class="issue-card-top">
        <div style="flex:1"></div>
        ${canWrite ? `<button class="card-menu-btn" type="button" onclick="event.stopPropagation();toggleCardMenu('${esc(i.id)}')" title="More actions"><svg viewBox="0 0 16 16" width="16" height="16"><circle cx="3" cy="8" r="1.5" fill="currentColor"/><circle cx="8" cy="8" r="1.5" fill="currentColor"/><circle cx="13" cy="8" r="1.5" fill="currentColor"/></svg></button>` : ''}
      </div>
      <div class="issue-card-title-row">
        <span class="issue-card-title" id="card-title-${esc(i.id)}">${esc(i.title)}</span>
        ${canWrite ? `<button class="card-edit-btn" type="button" onclick="event.stopPropagation();editCardTitle('${esc(i.id)}')" title="Edit title"><svg viewBox="0 0 16 16" width="14" height="14" fill="none"><rect x="1" y="1" width="14" height="14" rx="2" stroke="currentColor" stroke-width="1.2"/><path d="M5 11 L5 8.5 L10 3.5 L12.5 6 L7.5 11 Z" stroke="currentColor" stroke-width="1.2" fill="none"/><path d="M9 4.5 L11.5 7" stroke="currentColor" stroke-width="1.2"/></svg></button>` : ''}
        <div class="card-title-tooltip">${esc(i.title)}</div>
      </div>
      <div class="issue-card-foot">
        <div class="card-foot-left">
          ${ISSUE_TYPE_ICONS[i.type] || ISSUE_TYPE_ICONS.task}
          <span class="card-issue-key">${esc(i.issue_key)}</span>
        </div>
        <div class="card-foot-right">
          ${priority}
          ${avatarHtml}
        </div>
      </div>
      <div class="card-menu" id="card-menu-${esc(i.id)}" style="display:none">
        <div class="card-menu-label">Change status</div>
        ${BOARD_STATUSES.map(s => `<button class="card-menu-item${i.status === s ? ' active' : ''}" type="button" onclick="event.stopPropagation();cardChangeStatus('${esc(i.id)}','${s}')">${esc(TASK_STATUS_LABELS[s] || s)}</button>`).join('')}
        <div class="card-menu-divider"></div>
        <button class="card-menu-item" type="button" onclick="event.stopPropagation();copyIssueUrl('${esc(i.issue_key)}');closeAllCardMenus()">Copy link</button>
        <button class="card-menu-item" type="button" onclick="event.stopPropagation();navigator.clipboard.writeText('${esc(i.issue_key)}');if(typeof toastSuccess==='function')toastSuccess('Copied ${esc(i.issue_key)}');closeAllCardMenus()">Copy key</button>
        <div class="card-menu-divider"></div>
        <button class="card-menu-item" type="button" onclick="event.stopPropagation();cardRemoveFromSprint('${esc(i.id)}')">Remove from sprint</button>
      </div>
    </div>
  `;
}

// ── Card inline title edit ──────────────────────────────────
function editCardTitle(issueId) {
  const el = document.getElementById('card-title-' + issueId);
  if (!el) return;
  const issue = (state.tasks.boardIssues || []).find(x => x.id === issueId);
  if (!issue) return;
  const card = el.closest('.issue-card');
  if (card) card.setAttribute('onclick', ''); // disable card click while editing
  el.outerHTML = `<input class="card-title-input" id="card-title-edit-${issueId}" type="text" value="${esc(issue.title)}" onclick="event.stopPropagation()" onkeydown="if(event.key==='Enter'){commitCardTitle('${issueId}');}else if(event.key==='Escape'){cancelCardTitle('${issueId}');}">`;
  const inp = document.getElementById('card-title-edit-' + issueId);
  if (inp) { inp.focus(); inp.select(); }
}
window.editCardTitle = editCardTitle;

async function commitCardTitle(issueId) {
  const inp = document.getElementById('card-title-edit-' + issueId);
  if (!inp) return;
  const newTitle = inp.value.trim();
  const issue = (state.tasks.boardIssues || []).find(x => x.id === issueId);
  if (!newTitle || !issue || newTitle === issue.title) {
    cancelCardTitle(issueId);
    return;
  }
  const r = await api('PATCH', `/api/issues/${encodeURIComponent(issueId)}`, { title: newTitle });
  if (r && !r.error) {
    issue.title = newTitle;
    renderBoardTab();
    toastSuccess('Title updated');
  } else {
    toastError((r && r.error) || 'Failed to update title');
    cancelCardTitle(issueId);
  }
}
window.commitCardTitle = commitCardTitle;

function cancelCardTitle(issueId) {
  // Re-render the board to restore the card
  renderBoardTab();
}
window.cancelCardTitle = cancelCardTitle;

// ── Card context menu ───────────────────────────────────────
function toggleCardMenu(issueId) {
  const menu = document.getElementById('card-menu-' + issueId);
  if (!menu) return;
  const wasOpen = menu.style.display !== 'none';
  closeAllCardMenus();
  if (!wasOpen) {
    menu.style.display = 'block';
    // Close on next click outside
    setTimeout(() => {
      document.addEventListener('click', closeAllCardMenus, { once: true });
    }, 0);
  }
}
window.toggleCardMenu = toggleCardMenu;

function closeAllCardMenus() {
  document.querySelectorAll('.card-menu').forEach(m => { m.style.display = 'none'; });
}
window.closeAllCardMenus = closeAllCardMenus;

async function cardChangeStatus(issueId, newStatus) {
  closeAllCardMenus();
  const issue = (state.tasks.boardIssues || []).find(x => x.id === issueId);
  if (!issue || issue.status === newStatus) return;
  const r = await api('PATCH', `/api/issues/${encodeURIComponent(issueId)}`, { status: newStatus });
  if (r && !r.error) {
    issue.status = newStatus;
    renderBoardTab();
  } else {
    toastError((r && r.error) || 'Failed to change status');
  }
}
window.cardChangeStatus = cardChangeStatus;

async function cardRemoveFromSprint(issueId) {
  closeAllCardMenus();
  if (!(await appConfirm('Remove this issue from the sprint? It will return to the backlog.'))) return;
  const r = await api('PATCH', `/api/issues/${encodeURIComponent(issueId)}`, { sprint_id: null });
  if (r && !r.error) {
    await loadBoardTab(state.ui.tasksProjectId);
    renderBoardTab();
    toastSuccess('Removed from sprint');
  } else {
    toastError((r && r.error) || 'Failed to remove');
  }
}
window.cardRemoveFromSprint = cardRemoveFromSprint;

async function onBoardSprintChange(sprintId) {
  state.ui.tasksBoardSprintId = sprintId || '';
  await loadBoardTab(state.ui.tasksProjectId);
  renderBoardTab();
}
window.onBoardSprintChange = onBoardSprintChange;

function onCardDragStart(ev, issueId) {
  if (!tasksCanWrite()) { ev.preventDefault(); return; }
  state.ui.tasksDragIssueId = issueId;
  try {
    ev.dataTransfer.setData('text/plain', issueId);
    ev.dataTransfer.effectAllowed = 'move';
  } catch {}
  if (ev.target && ev.target.classList) ev.target.classList.add('dragging');
}
window.onCardDragStart = onCardDragStart;

function onCardDragEnd(ev) {
  if (ev.target && ev.target.classList) ev.target.classList.remove('dragging');
  state.ui.tasksDragIssueId = '';
  document.querySelectorAll('.kanban-col.drop-target').forEach(el => el.classList.remove('drop-target'));
}
window.onCardDragEnd = onCardDragEnd;

function onColumnDragOver(ev) {
  ev.preventDefault();
  try { ev.dataTransfer.dropEffect = 'move'; } catch {}
  if (ev.currentTarget && ev.currentTarget.classList) ev.currentTarget.classList.add('drop-target');
}
window.onColumnDragOver = onColumnDragOver;

function onColumnDragLeave(ev) {
  if (ev.currentTarget && ev.currentTarget.classList) ev.currentTarget.classList.remove('drop-target');
}
window.onColumnDragLeave = onColumnDragLeave;

async function onColumnDrop(ev, newStatus) {
  ev.preventDefault();
  if (ev.currentTarget && ev.currentTarget.classList) ev.currentTarget.classList.remove('drop-target');
  if (!tasksCanWrite()) return;
  let id = '';
  try { id = ev.dataTransfer.getData('text/plain') || ''; } catch {}
  if (!id) id = state.ui.tasksDragIssueId || '';
  if (!id) return;
  const issue = (state.tasks.boardIssues || []).find(x => x.id === id);
  if (!issue) return;
  if (issue.status === newStatus) return;
  const r = await api('PATCH', `/api/issues/${encodeURIComponent(id)}`, { status: newStatus });
  if (r && r.error) {
    toastError(r.error);
    await loadBoardTab(state.ui.tasksProjectId);
    renderBoardTab();
  } else {
    issue.status = newStatus;
    renderBoardTab();
  }
}
window.onColumnDrop = onColumnDrop;

function onCardMobileTap(ev, issueId) {
  ev.stopPropagation();
  if (!tasksCanWrite()) { openIssueDetail(issueId); return; }
  const issue = (state.tasks.boardIssues || []).find(x => x.id === issueId);
  if (!issue) return;
  const btns = BOARD_STATUSES.map(s => {
    const cur = issue.status === s ? ' btn-primary' : ' btn-ghost';
    return `<button class="btn${cur}" type="button" style="margin:4px" onclick="mobileMoveCard('${esc(issueId)}','${s}')">${esc(TASK_STATUS_LABELS[s])}</button>`;
  }).join('');
  setModal(`
    <div class="modal-head"><div class="modal-title"><span class="mono">${esc(issue.issue_key)}</span> ${esc(issue.title)}</div>
      <button class="modal-close" type="button" onclick="closeModal()">x</button></div>
    <div class="modal-body">
      <p class="text-muted text-sm">Move to:</p>
      <div style="display:flex;flex-wrap:wrap;gap:4px">${btns}</div>
      <div style="margin-top:14px">
        <button class="btn btn-ghost btn-sm" type="button" onclick="closeModal();openIssueDetail('${esc(issueId)}')">Open issue details</button>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" type="button" onclick="closeModal()">Close</button>
    </div>
  `);
}
window.onCardMobileTap = onCardMobileTap;

async function mobileMoveCard(issueId, newStatus) {
  const issue = (state.tasks.boardIssues || []).find(x => x.id === issueId);
  if (!issue) { closeModal(); return; }
  if (issue.status === newStatus) { closeModal(); return; }
  const r = await api('PATCH', `/api/issues/${encodeURIComponent(issueId)}`, { status: newStatus });
  if (r && r.error) {
    toastError(r.error);
  } else {
    issue.status = newStatus;
    closeModal();
    renderBoardTab();
  }
}
window.mobileMoveCard = mobileMoveCard;

// ── Backlog tab ──────────────────────────────────────────────
async function loadBacklogTab(projectId) {
  const [ir, sr] = await Promise.all([
    api('GET', `/api/projects/${encodeURIComponent(projectId)}/issues?sprint_id=__backlog__&limit=500`),
    api('GET', `/api/projects/${encodeURIComponent(projectId)}/sprints`)
  ]);
  state.tasks.backlogIssues = (ir && Array.isArray(ir.issues)) ? ir.issues : [];
  state.tasks.sprints = (sr && Array.isArray(sr.sprints)) ? sr.sprints : [];
  // Prune stale selections
  const ids = new Set(state.tasks.backlogIssues.map(x => x.id));
  state.ui.tasksBacklogSelected = (state.ui.tasksBacklogSelected || []).filter(id => ids.has(id));
}
window.loadBacklogTab = loadBacklogTab;

function renderBacklogTab() {
  const body = getTabBody();
  if (!body) return;
  const canWrite = tasksCanWrite();
  const selected = state.ui.tasksBacklogSelected || [];
  const selCount = selected.length;
  const selectable = canWrite ? state.tasks.sprints.some(s => s.state === 'planned' || s.state === 'active') : false;

  const rows = (state.tasks.backlogIssues || []).map(i => {
    const a = i.assignee;
    const checked = selected.includes(i.id) ? 'checked' : '';
    return `
      <tr>
        <td style="width:36px">${canWrite ? `<input type="checkbox" ${checked} onclick="event.stopPropagation()" onchange="toggleBacklogSelect('${esc(i.id)}')">` : ''}</td>
        <td class="mono" onclick="openIssueDetail('${esc(i.id)}')" style="cursor:pointer">${esc(i.issue_key)}</td>
        <td onclick="openIssueDetail('${esc(i.id)}')" style="cursor:pointer">${ISSUE_TYPE_ICONS[i.type] || ISSUE_TYPE_ICONS.task}</td>
        <td onclick="openIssueDetail('${esc(i.id)}')" style="cursor:pointer">${esc(i.title)}</td>
        <td><span class="lozenge lozenge-status-${esc(i.status)}">${esc(TASK_STATUS_LABELS[i.status] || i.status)}</span></td>
        <td><span class="lozenge lozenge-priority-${esc(i.priority)}">${esc(TASK_PRIORITY_LABELS[i.priority] || i.priority)}</span></td>
        <td>${a ? esc(a.display_name || a.email) : '<span class="text-muted">Unassigned</span>'}</td>
      </tr>
    `;
  }).join('');

  body.innerHTML = `
    <div class="card" style="margin-bottom:12px">
      <div class="card-body" style="padding:12px 14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;justify-content:space-between">
        <div class="text-muted text-sm">Backlog — ${state.tasks.backlogIssues.length} issue${state.tasks.backlogIssues.length === 1 ? '' : 's'}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${canWrite ? `<button class="btn btn-primary btn-sm" type="button" ${selCount && selectable ? '' : 'disabled'} onclick="openMoveBacklogModal()">Move ${selCount} selected to sprint…</button>` : ''}
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-body" style="padding:0">
        <table class="data-table backlog-table">
          <thead><tr>
            <th></th><th>Key</th><th>Type</th><th>Title</th><th>Status</th><th>Priority</th><th>Assignee</th>
          </tr></thead>
          <tbody>${rows || `<tr><td colspan="7">${typeof renderEmptyState === 'function' ? renderEmptyState({ icon: 'kanban', title: 'Backlog is empty', body: 'All issues are currently in a sprint, or there are no issues yet.' }) : '<div class="empty"><p>Backlog is empty.</p></div>'}</td></tr>`}</tbody>
        </table>
      </div>
    </div>
  `;
}
window.renderBacklogTab = renderBacklogTab;

function toggleBacklogSelect(issueId) {
  const arr = state.ui.tasksBacklogSelected || [];
  const idx = arr.indexOf(issueId);
  if (idx >= 0) arr.splice(idx, 1); else arr.push(issueId);
  state.ui.tasksBacklogSelected = arr;
  renderBacklogTab();
}
window.toggleBacklogSelect = toggleBacklogSelect;

function openMoveBacklogModal() {
  const selected = state.ui.tasksBacklogSelected || [];
  if (!selected.length) return;
  const targets = state.tasks.sprints.filter(s => s.state === 'planned' || s.state === 'active');
  if (!targets.length) {
    setModal(`
      <div class="modal-head"><div class="modal-title">No sprints available</div>
        <button class="modal-close" type="button" onclick="closeModal()">x</button></div>
      <div class="modal-body"><p>Create a planned sprint first from the Sprints tab.</p></div>
      <div class="modal-foot"><button class="btn btn-primary" type="button" onclick="closeModal()">OK</button></div>
    `);
    return;
  }
  const opts = targets.map(s => `<option value="${esc(s.id)}">${esc(s.name)} — ${esc(SPRINT_STATE_LABELS[s.state])}</option>`).join('');
  setModal(`
    <div class="modal-head"><div class="modal-title">Move ${selected.length} issue${selected.length === 1 ? '' : 's'} to sprint</div>
      <button class="modal-close" type="button" onclick="closeModal()">x</button></div>
    <div class="modal-body">
      <label>Target sprint</label>
      <select id="mb-sprint">${opts}</select>
      <div class="form-msg" id="mb-msg" style="margin-top:10px"></div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" type="button" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" type="button" onclick="submitMoveBacklog()">Move</button>
    </div>
  `);
}
window.openMoveBacklogModal = openMoveBacklogModal;

async function submitMoveBacklog() {
  const sel = document.getElementById('mb-sprint');
  const msg = document.getElementById('mb-msg');
  if (msg) msg.className = 'form-msg';
  const sprintId = sel ? sel.value : '';
  const issueIds = (state.ui.tasksBacklogSelected || []).slice();
  if (!sprintId) { if (msg) { msg.textContent = 'Select a sprint'; msg.classList.add('form-msg-err'); } return; }
  if (!issueIds.length) { closeModal(); return; }
  const r = await api('POST', `/api/sprints/${encodeURIComponent(sprintId)}/issues`, { issue_ids: issueIds });
  if (r && r.ok) {
    state.ui.tasksBacklogSelected = [];
    closeModal();
    await loadBacklogTab(state.ui.tasksProjectId);
    renderBacklogTab();
  } else {
    if (msg) { msg.textContent = (r && r.error) || 'Failed to move issues'; msg.classList.add('form-msg-err'); }
  }
}
window.submitMoveBacklog = submitMoveBacklog;

// ── Sprints tab ──────────────────────────────────────────────
async function loadSprintsTab(projectId) {
  const r = await api('GET', `/api/projects/${encodeURIComponent(projectId)}/sprints`);
  state.tasks.sprints = (r && Array.isArray(r.sprints)) ? r.sprints : [];
}
window.loadSprintsTab = loadSprintsTab;

function renderSprintCard(s, canWrite) {
  const cls = `sprint-card sprint-card-${esc(s.state)}`;
  const badge = `<span class="sprint-state-badge sprint-state-${esc(s.state)}">${esc(SPRINT_STATE_LABELS[s.state] || s.state)}</span>`;
  const goal = s.goal ? `<div class="sprint-goal" style="margin-top:8px">${renderMarkdown(s.goal)}</div>` : '';
  const count = Number(s.issue_count || 0);
  const done = Number(s.done_count || 0);
  const meta = [];
  meta.push(`${done}/${count} done`);
  if (s.state === 'active' && s.days_remaining != null) meta.push(`${Number(s.days_remaining)} day${Number(s.days_remaining) === 1 ? '' : 's'} left`);
  if (s.start_at) meta.push(`Started ${formatDateShort(s.start_at)}`);
  if (s.planned_end_at) meta.push(`Planned end ${formatDateShort(s.planned_end_at)}`);
  if (s.end_at) meta.push(`Ended ${formatDateShort(s.end_at)}`);

  let actions = '';
  if (s.state === 'active') {
    actions = `
      <button class="btn btn-ghost btn-sm" type="button" onclick="openBurndown('${esc(s.id)}')">Open burndown</button>
      ${canWrite ? `<button class="btn btn-primary btn-sm" type="button" onclick="openCompleteSprint('${esc(s.id)}')">Complete sprint</button>` : ''}
    `;
  } else if (s.state === 'planned') {
    const canDelete = canWrite && count === 0;
    actions = `
      ${canWrite ? `<button class="btn btn-ghost btn-sm" type="button" onclick="openEditSprint('${esc(s.id)}')">Edit</button>` : ''}
      ${canWrite ? `<button class="btn btn-primary btn-sm" type="button" onclick="confirmStartSprint('${esc(s.id)}')">Start sprint</button>` : ''}
      ${canWrite ? `<button class="btn btn-ghost btn-sm" type="button" ${canDelete ? '' : 'disabled'} title="${canDelete ? 'Delete sprint' : 'Cannot delete a sprint with issues'}" onclick="confirmDeleteSprint('${esc(s.id)}')">Delete</button>` : ''}
    `;
  } else {
    actions = `<button class="btn btn-ghost btn-sm" type="button" onclick="openBurndown('${esc(s.id)}')">Open burndown</button>`;
  }

  return `
    <div class="${cls}">
      <div class="card-body" style="padding:14px 16px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            ${badge}
            <strong style="font-size:16px">${esc(s.name)}</strong>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">${actions}</div>
        </div>
        <div class="text-muted text-sm" style="margin-top:6px">${meta.map(esc).join(' · ')}</div>
        ${goal}
      </div>
    </div>
  `;
}

function renderSprintsTab() {
  const body = getTabBody();
  if (!body) return;
  const canWrite = tasksCanWrite();
  const list = state.tasks.sprints || [];
  const active = list.filter(s => s.state === 'active');
  const planned = list.filter(s => s.state === 'planned');
  const completed = list.filter(s => s.state === 'completed');

  if (!list.length) {
    body.innerHTML = `
      <div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px">
        <h3 style="margin:0">Sprints</h3>
      </div>
      <div class="card"><div class="card-body" style="padding:20px">
        ${typeof renderEmptyState === 'function'
          ? renderEmptyState({ icon: 'sprint', title: 'No sprints yet', body: 'Use the "+ Create Sprint" button in the top bar to create your first sprint.', actionLabel: canWrite ? '+ Create Sprint' : undefined, actionOnClick: canWrite ? 'openCreateSprint()' : undefined })
          : '<p class="text-muted">No sprints yet.</p>'}
      </div></div>
      </div>
    `;
    return;
  }

  const activeHtml = active.length
    ? active.map(s => renderSprintCard(s, canWrite)).join('')
    : `<div class="card"><div class="card-body empty-state-large" style="padding:20px;text-align:center">
         <p class="text-muted" style="margin:0">No active sprint.</p>
       </div></div>`;

  const plannedHtml = planned.length
    ? planned.map(s => renderSprintCard(s, canWrite)).join('')
    : `<div class="text-muted text-sm" style="padding:8px 2px">No planned sprints.</div>`;

  const completedCollapsed = completed.length > 2;
  const completedHtml = completed.length
    ? (completedCollapsed
        ? `<details><summary class="text-muted text-sm" style="cursor:pointer;padding:8px 2px">Show ${completed.length} completed sprint${completed.length === 1 ? '' : 's'}</summary>
           <div style="margin-top:8px;display:flex;flex-direction:column;gap:10px">${completed.map(s => renderSprintCard(s, canWrite)).join('')}</div>
         </details>`
        : completed.map(s => renderSprintCard(s, canWrite)).join(''))
    : `<div class="text-muted text-sm" style="padding:8px 2px">No completed sprints.</div>`;

  body.innerHTML = `
    <div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px">
        <h3 style="margin:0">Sprints</h3>
      </div>

      <div class="tw-section-label">Active</div>
      <div style="display:flex;flex-direction:column;gap:10px">${activeHtml}</div>

      <div class="tw-section-label" style="margin-top:18px">Planned</div>
      <div style="display:flex;flex-direction:column;gap:10px">${plannedHtml}</div>

      <div class="tw-section-label" style="margin-top:18px">Completed</div>
      <div>${completedHtml}</div>
    </div>
  `;
}
window.renderSprintsTab = renderSprintsTab;

// ── Sprint create / edit modals ──────────────────────────────
function openCreateSprint() {
  if (!tasksCanWrite()) return;
  if (!state.ui.tasksProjectId) return;
  setModal(`
    <div class="modal-head"><div class="modal-title">New sprint</div>
      <button class="modal-close" type="button" onclick="closeModal()">x</button></div>
    <div class="modal-body">
      <label>Name</label>
      <input id="ns-name" type="text" autofocus placeholder="Sprint 1">
      <label style="margin-top:10px">Goal (Markdown, one-liner)</label>
      <textarea id="ns-goal" rows="3" placeholder="What outcome does this sprint aim for?"></textarea>
      <label style="margin-top:10px">Planned end date (optional)</label>
      <input id="ns-end" type="date">
      <div class="form-msg" id="ns-msg" style="margin-top:10px"></div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" type="button" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" type="button" onclick="submitCreateSprint()">Create sprint</button>
    </div>
  `);
  setTimeout(() => {
    const el = document.getElementById('ns-goal');
    if (el && typeof attachMarkdownToolbar === 'function') attachMarkdownToolbar(el);
  }, 0);
}
window.openCreateSprint = openCreateSprint;

async function submitCreateSprint() {
  const name = (document.getElementById('ns-name').value || '').trim();
  const goal = document.getElementById('ns-goal').value || '';
  const planned_end_at = document.getElementById('ns-end').value || null;
  const msg = document.getElementById('ns-msg');
  msg.className = 'form-msg';
  if (!name) { msg.textContent = 'Name is required'; msg.classList.add('form-msg-err'); return; }
  const body = { name, goal };
  if (planned_end_at) body.planned_end_at = planned_end_at;
  const r = await api('POST', `/api/projects/${encodeURIComponent(state.ui.tasksProjectId)}/sprints`, body);
  if (r && (r.id || r.sprint || r.name)) {
    closeModal();
    await loadSprintsTab(state.ui.tasksProjectId);
    renderSprintsTab();
  } else {
    msg.textContent = (r && r.error) || 'Failed to create sprint';
    msg.classList.add('form-msg-err');
  }
}
window.submitCreateSprint = submitCreateSprint;

function openEditSprint(sprintId) {
  const s = (state.tasks.sprints || []).find(x => x.id === sprintId);
  if (!s) return;
  const endVal = s.planned_end_at ? String(s.planned_end_at).slice(0, 10) : '';
  setModal(`
    <div class="modal-head"><div class="modal-title">Edit sprint — ${esc(s.name)}</div>
      <button class="modal-close" type="button" onclick="closeModal()">x</button></div>
    <div class="modal-body">
      <label>Name</label>
      <input id="es-name" type="text" value="${esc(s.name)}" autofocus>
      <label style="margin-top:10px">Goal (Markdown)</label>
      <textarea id="es-goal" rows="3">${esc(s.goal || '')}</textarea>
      <label style="margin-top:10px">Planned end date</label>
      <input id="es-end" type="date" value="${esc(endVal)}">
      <div class="form-msg" id="es-msg" style="margin-top:10px"></div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" type="button" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" type="button" onclick="submitEditSprint('${esc(sprintId)}')">Save changes</button>
    </div>
  `);
  setTimeout(() => {
    const el = document.getElementById('es-goal');
    if (el && typeof attachMarkdownToolbar === 'function') attachMarkdownToolbar(el);
  }, 0);
}
window.openEditSprint = openEditSprint;

async function submitEditSprint(sprintId) {
  const name = (document.getElementById('es-name').value || '').trim();
  const goal = document.getElementById('es-goal').value || '';
  const planned_end_at = document.getElementById('es-end').value || null;
  const msg = document.getElementById('es-msg');
  msg.className = 'form-msg';
  if (!name) { msg.textContent = 'Name is required'; msg.classList.add('form-msg-err'); return; }
  const r = await api('PATCH', `/api/sprints/${encodeURIComponent(sprintId)}`, { name, goal, planned_end_at });
  if (r && r.ok) {
    closeModal();
    await loadSprintsTab(state.ui.tasksProjectId);
    renderSprintsTab();
  } else {
    msg.textContent = (r && r.error) || 'Failed to save sprint';
    msg.classList.add('form-msg-err');
  }
}
window.submitEditSprint = submitEditSprint;

async function confirmStartSprint(sprintId) {
  const s = (state.tasks.sprints || []).find(x => x.id === sprintId);
  if (!s) return;
  if (!(await appConfirm(`Start sprint "${s.name}"?\n\nThis will become the active sprint for this project. Only one sprint can be active at a time.`))) return;
  const r = await api('POST', `/api/sprints/${encodeURIComponent(sprintId)}/start`, {});
  if (r && r.sprint) {
    state.ui.tasksBoardSprintId = r.sprint.id || sprintId;
    await setTasksTab('board');
  } else {
    const errMsg = (r && r.error) || 'Failed to start sprint';
    await loadSprintsTab(state.ui.tasksProjectId);
    renderSprintsTab();
    const body = getTabBody();
    if (body) {
      const alertEl = document.createElement('div');
      alertEl.className = 'form-msg form-msg-err';
      alertEl.style.margin = '10px 0';
      alertEl.textContent = errMsg;
      body.insertBefore(alertEl, body.firstChild);
      setTimeout(() => { if (alertEl.parentNode) alertEl.parentNode.removeChild(alertEl); }, 6000);
    }
  }
}
window.confirmStartSprint = confirmStartSprint;

async function openCompleteSprint(sprintId) {
  const detail = await api('GET', `/api/sprints/${encodeURIComponent(sprintId)}`);
  if (!detail || !detail.sprint) { toastError((detail && detail.error) || 'Failed to load sprint'); return; }
  const s = detail.sprint;
  const total = Number(detail.total_issues || 0);
  const done = Number(detail.done_count || 0);
  const incomplete = Math.max(0, total - done);
  const planned = (state.tasks.sprints || []).filter(x => x.state === 'planned' && x.id !== sprintId);
  const plannedOpts = planned.map(x => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('');
  const hasPlanned = planned.length > 0;
  setModal(`
    <div class="modal-head"><div class="modal-title">Complete sprint — ${esc(s.name)}</div>
      <button class="modal-close" type="button" onclick="closeModal()">x</button></div>
    <div class="modal-body">
      <p>${done} of ${total} issue${total === 1 ? '' : 's'} done. <strong>${incomplete}</strong> incomplete.</p>
      <div style="margin-top:10px">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="radio" name="cs-action" value="backlog" checked onchange="onCompleteActionChange()">
          <span>Move ${incomplete} incomplete issue${incomplete === 1 ? '' : 's'} to backlog</span>
        </label>
      </div>
      <div style="margin-top:8px">
        <label style="display:flex;align-items:center;gap:8px;cursor:${hasPlanned ? 'pointer' : 'not-allowed'};opacity:${hasPlanned ? '1' : '.55'}">
          <input type="radio" name="cs-action" value="next_sprint" ${hasPlanned ? '' : 'disabled'} onchange="onCompleteActionChange()">
          <span>Move ${incomplete} incomplete issue${incomplete === 1 ? '' : 's'} to next planned sprint</span>
        </label>
        <div style="margin-left:26px;margin-top:6px">
          <select id="cs-next" ${hasPlanned ? '' : 'disabled'} disabled>${plannedOpts || '<option value="">— No planned sprints —</option>'}</select>
        </div>
      </div>
      <div class="form-msg" id="cs-msg" style="margin-top:10px"></div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" type="button" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" type="button" onclick="submitCompleteSprint('${esc(sprintId)}')">Complete sprint</button>
    </div>
  `);
}
window.openCompleteSprint = openCompleteSprint;

function onCompleteActionChange() {
  const radios = document.getElementsByName('cs-action');
  let val = 'backlog';
  for (const r of radios) { if (r.checked) { val = r.value; break; } }
  const nextSel = document.getElementById('cs-next');
  if (nextSel) nextSel.disabled = (val !== 'next_sprint');
}
window.onCompleteActionChange = onCompleteActionChange;

async function submitCompleteSprint(sprintId) {
  const radios = document.getElementsByName('cs-action');
  let action = 'backlog';
  for (const r of radios) { if (r.checked) { action = r.value; break; } }
  const msg = document.getElementById('cs-msg');
  if (msg) msg.className = 'form-msg';
  const body = { incomplete_action: action };
  if (action === 'next_sprint') {
    const nextSel = document.getElementById('cs-next');
    const nextId = nextSel ? nextSel.value : '';
    if (!nextId) { if (msg) { msg.textContent = 'Select a next sprint'; msg.classList.add('form-msg-err'); } return; }
    body.next_sprint_id = nextId;
  }
  const r = await api('POST', `/api/sprints/${encodeURIComponent(sprintId)}/complete`, body);
  if (r && r.sprint) {
    closeModal();
    if (state.ui.tasksBoardSprintId === sprintId) state.ui.tasksBoardSprintId = '';
    await loadSprintsTab(state.ui.tasksProjectId);
    renderSprintsTab();
  } else {
    if (msg) { msg.textContent = (r && r.error) || 'Failed to complete sprint'; msg.classList.add('form-msg-err'); }
  }
}
window.submitCompleteSprint = submitCompleteSprint;

async function confirmDeleteSprint(sprintId) {
  const s = (state.tasks.sprints || []).find(x => x.id === sprintId);
  if (!s) return;
  if (!(await appConfirm(`Delete sprint "${s.name}"?\n\nThis cannot be undone.`))) return;
  const r = await api('DELETE', `/api/sprints/${encodeURIComponent(sprintId)}`);
  if (r && r.ok) {
    await loadSprintsTab(state.ui.tasksProjectId);
    renderSprintsTab();
  } else {
    toastError((r && r.error) || 'Failed to delete sprint');
  }
}
window.confirmDeleteSprint = confirmDeleteSprint;

// ── Burndown ─────────────────────────────────────────────────
async function openBurndown(sprintId) {
  const r = await api('GET', `/api/sprints/${encodeURIComponent(sprintId)}/burndown`);
  if (!r || !r.sprint) {
    setModal(`
      <div class="modal-head"><div class="modal-title">Burndown</div>
        <button class="modal-close" type="button" onclick="closeModal()">x</button></div>
      <div class="modal-body"><p>${esc((r && r.error) || 'Failed to load burndown')}</p></div>
      <div class="modal-foot"><button class="btn btn-ghost" type="button" onclick="closeModal()">Close</button></div>
    `);
    return;
  }
  state.tasks.burndown = r;
  const s = r.sprint;
  const total = Number(r.total_issues || 0);
  const actual = Array.isArray(r.actual) ? r.actual : [];
  const ideal = Array.isArray(r.ideal) ? r.ideal : [];

  const daysMeta = (s.state === 'active' && s.days_remaining != null)
    ? `${Number(s.days_remaining)} day${Number(s.days_remaining) === 1 ? '' : 's'} left`
    : (s.state === 'completed' ? 'Completed' : (s.state === 'planned' ? 'Planned' : ''));

  const chart = renderBurndownSvg(total, actual, ideal);
  setModal(`
    <div class="modal-head" style="min-width:680px">
      <div class="modal-title">Burndown — ${esc(s.name)}</div>
      <button class="modal-close" type="button" onclick="closeModal()">x</button>
    </div>
    <div class="modal-body" style="min-width:680px">
      <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
        <span class="sprint-state-badge sprint-state-${esc(s.state)}">${esc(SPRINT_STATE_LABELS[s.state] || s.state)}</span>
        <span class="text-muted text-sm">${total} issue${total === 1 ? '' : 's'} total</span>
        ${daysMeta ? `<span class="text-muted text-sm">${esc(daysMeta)}</span>` : ''}
      </div>
      ${chart}
      <div style="display:flex;gap:16px;margin-top:10px;font-size:12px;flex-wrap:wrap">
        <span><span style="display:inline-block;width:14px;height:2px;background:currentColor;vertical-align:middle;margin-right:6px"></span>Actual</span>
        <span class="text-muted"><span style="display:inline-block;width:14px;border-top:2px dashed currentColor;vertical-align:middle;margin-right:6px"></span>Ideal</span>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" type="button" onclick="closeModal()">Close</button>
    </div>
  `);
}
window.openBurndown = openBurndown;

function renderBurndownSvg(total, actual, ideal) {
  const width = 640;
  const height = 320;
  const padL = 40, padR = 20, padT = 20, padB = 40;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  const maxPoints = Math.max(actual.length, ideal.length, 2);
  const maxY = Math.max(total, 1);

  const stepGuess = maxY > 10 ? 2 : 1;
  const yStep = stepGuess;

  // X scale: points indexed by day position; use max(actual.length, ideal.length).
  // Each series plots on its own scaled x.
  function xForIndex(i, seriesLen) {
    if (seriesLen <= 1) return padL;
    // Scale to full width regardless of series length — align series to full timeline
    return padL + (i / (maxPoints - 1)) * innerW;
  }
  function yForValue(v) {
    return padT + innerH - (Number(v) / maxY) * innerH;
  }

  // Y gridlines
  const gridLines = [];
  const yLabels = [];
  for (let v = 0; v <= maxY; v += yStep) {
    const y = yForValue(v);
    gridLines.push(`<line class="burndown-grid" x1="${padL}" y1="${y}" x2="${padL + innerW}" y2="${y}" />`);
    yLabels.push(`<text class="burndown-axis" x="${padL - 6}" y="${y + 4}" text-anchor="end" font-size="11">${v}</text>`);
  }

  // X ticks (daily) — label every nth to avoid clutter
  const xTicks = [];
  const labelEvery = Math.max(1, Math.ceil(maxPoints / 8));
  // Prefer actual for date labels, fallback to ideal
  const dateSource = actual.length >= ideal.length ? actual : ideal;
  for (let i = 0; i < maxPoints; i++) {
    const x = xForIndex(i, maxPoints);
    xTicks.push(`<line class="burndown-grid" x1="${x}" y1="${padT + innerH}" x2="${x}" y2="${padT + innerH + 4}" />`);
    if (i % labelEvery === 0 && dateSource[i]) {
      const label = formatDateShort(dateSource[i].date);
      xTicks.push(`<text class="burndown-axis" x="${x}" y="${padT + innerH + 18}" text-anchor="middle" font-size="10">${esc(label)}</text>`);
    }
  }

  // Axes
  const axes = `
    <line class="burndown-axis" x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + innerH}" />
    <line class="burndown-axis" x1="${padL}" y1="${padT + innerH}" x2="${padL + innerW}" y2="${padT + innerH}" />
  `;

  // Ideal polyline
  const idealPts = ideal.map((p, i) => `${xForIndex(i, ideal.length).toFixed(1)},${yForValue(p.remaining).toFixed(1)}`).join(' ');
  // Actual polyline
  const actualPts = actual.map((p, i) => `${xForIndex(i, actual.length).toFixed(1)},${yForValue(p.remaining).toFixed(1)}`).join(' ');

  return `
    <svg class="burndown-chart" viewBox="0 0 ${width} ${height}" width="100%" height="${height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Burndown chart">
      ${gridLines.join('')}
      ${axes}
      ${yLabels.join('')}
      ${xTicks.join('')}
      ${ideal.length >= 2 ? `<polyline class="burndown-line-ideal" fill="none" stroke-width="2" stroke-dasharray="6 4" points="${idealPts}" />` : ''}
      ${actual.length >= 2 ? `<polyline class="burndown-line-actual" fill="none" stroke-width="2" points="${actualPts}" />` : ''}
      ${actual.length === 1 ? `<circle class="burndown-line-actual" cx="${xForIndex(0, 1).toFixed(1)}" cy="${yForValue(actual[0].remaining).toFixed(1)}" r="3" />` : ''}
    </svg>
  `;
}
