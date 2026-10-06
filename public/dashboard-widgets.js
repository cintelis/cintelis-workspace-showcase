// ============================================================
// Cintelis Workspace — Dashboard overview widgets
// Four widgets rendered into placeholder divs on the Overview page.
// Loaded as a regular <script> tag after app.js; uses api(), esc(),
// relTime() from app.js / tasks-ui.js.
// ============================================================

// ── Active Sprint Progress ──────────────────────────────────
async function renderActiveSprintsWidget() {
  const el = document.getElementById('widget-active-sprints');
  if (!el) return;
  try {
    const r = await api('GET', '/api/overview/active-sprints');
    const sprints = (r && Array.isArray(r.sprints)) ? r.sprints : [];
    if (!sprints.length) {
      el.innerHTML = `
        <div class="card">
          <div class="card-head"><div class="card-title">Active Sprints</div></div>
          <div class="card-body"><p class="text-muted" style="margin:0">No active sprints across any project.</p></div>
        </div>`;
      return;
    }
    const rows = sprints.map(s => {
      const total = Number(s.issue_count || 0);
      const done = Number(s.done_count || 0);
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
      const inProgress = total - done;
      const daysLeft = s.days_remaining != null ? `${s.days_remaining} day${s.days_remaining === 1 ? '' : 's'} left` : '';
      return `
        <div class="widget-sprint-row widget-sprint-clickable" onclick="navigateToSprint('${esc(s.project_id)}','${esc(s.project_key)}')" title="Open ${esc(s.project_key)} board">
          <div class="widget-sprint-head">
            <span class="widget-sprint-label"><span class="mono" style="color:var(--cyan)">${esc(s.project_key)}</span> <span style="margin-left:4px">${esc(s.name)}</span></span>
            <span class="text-muted text-sm">${done}/${total} done</span>
          </div>
          <div class="widget-progress-bar">
            <div class="widget-progress-fill" style="width:${pct}%"></div>
          </div>
          <div class="text-muted text-sm" style="margin-top:4px">${daysLeft}${daysLeft && inProgress > 0 ? ' · ' : ''}${inProgress > 0 ? inProgress + ' in progress' : ''}</div>
        </div>
      `;
    }).join('');
    el.innerHTML = `
      <div class="card">
        <div class="card-head"><div class="card-title">Active Sprints</div></div>
        <div class="card-body" style="display:flex;flex-direction:column;gap:16px">${rows}</div>
      </div>`;
  } catch (e) {
    el.innerHTML = '';
  }
}
window.renderActiveSprintsWidget = renderActiveSprintsWidget;

// ── Due Soon / Overdue ──────────────────────────────────────
async function renderDueSoonWidget() {
  const el = document.getElementById('widget-due-soon');
  if (!el) return;
  try {
    const r = await api('GET', '/api/overview/due-soon');
    const issues = (r && Array.isArray(r.issues)) ? r.issues : [];
    if (!issues.length) {
      el.innerHTML = `
        <div class="card">
          <div class="card-head"><div class="card-title">Due Soon</div></div>
          <div class="card-body"><p class="text-muted" style="margin:0">No issues due in the next 7 days.</p></div>
        </div>`;
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    const rows = issues.map(i => {
      const dueDate = String(i.due_at || '').slice(0, 10);
      const isOverdue = dueDate < today;
      const isToday = dueDate === today;
      const indicator = isOverdue ? '<span class="widget-due-badge widget-due-overdue">overdue</span>'
                      : isToday ? '<span class="widget-due-badge widget-due-today">today</span>'
                      : '';
      const dateLabel = isOverdue ? dueDate : (isToday ? 'today' : (typeof relTime === 'function' ? relTime(i.due_at) : dueDate));
      return `
        <div class="widget-due-row ${isOverdue ? 'widget-due-row-overdue' : ''}">
          <span class="mono" style="color:var(--cyan);font-size:12px;flex-shrink:0">${esc(i.issue_key)}</span>
          <span class="widget-due-title">${esc(i.title)}</span>
          <span class="lozenge lozenge-priority-${esc(i.priority)}" style="flex-shrink:0">${esc(i.priority)}</span>
          <span class="text-muted text-sm" style="flex-shrink:0;min-width:70px;text-align:right">${esc(dateLabel)}</span>
          ${indicator}
        </div>
      `;
    }).join('');
    el.innerHTML = `
      <div class="card">
        <div class="card-head">
          <div class="card-title">Due Soon</div>
          <span class="text-muted text-sm">${issues.length} item${issues.length !== 1 ? 's' : ''}</span>
        </div>
        <div class="card-body" style="padding:0">
          <div class="widget-due-list">${rows}</div>
        </div>
      </div>`;
  } catch (e) {
    el.innerHTML = '';
  }
}
window.renderDueSoonWidget = renderDueSoonWidget;

// ── Recent Activity Feed ────────────────────────────────────
async function renderRecentActivityWidget() {
  const el = document.getElementById('widget-recent-activity');
  if (!el) return;
  try {
    const r = await api('GET', '/api/overview/recent-activity');
    const items = (r && Array.isArray(r.activity)) ? r.activity : [];
    if (!items.length) {
      el.innerHTML = `
        <div class="card">
          <div class="card-head"><div class="card-title">Recent Activity</div></div>
          <div class="card-body"><p class="text-muted" style="margin:0">No recent activity across projects and docs.</p></div>
        </div>`;
      return;
    }
    const ACTIVITY_ICONS = {
      comment: '💬', system: '⚙', note: '📝', stage: '↻', call: '📞',
      meeting: '📅', email: '✉', mention: '@'
    };
    const rows = items.map(a => {
      const icon = ACTIVITY_ICONS[a.kind] || '•';
      const who = a.user_name || (a.user_email ? String(a.user_email).split('@')[0] : 'System');
      const body = String(a.body_md || '').replace(/\s+/g, ' ').trim();
      const excerpt = body.length > 100 ? body.slice(0, 97) + '…' : body;
      const typeLabel = a.entity_type === 'issue' ? 'issue' : a.entity_type === 'doc_page' ? 'page' : a.entity_type === 'contact' ? 'contact' : a.entity_type;
      return `
        <div class="widget-activity-row">
          <span class="widget-activity-icon">${icon}</span>
          <div class="widget-activity-body">
            <div><strong>${esc(who)}</strong> <span class="text-muted text-sm">${a.kind === 'comment' ? 'commented' : a.kind === 'system' ? '' : a.kind} on ${esc(typeLabel)}</span></div>
            ${excerpt ? `<div class="text-muted text-sm" style="margin-top:2px">${esc(excerpt)}</div>` : ''}
          </div>
          <span class="text-muted text-sm" style="flex-shrink:0;white-space:nowrap">${typeof relTime === 'function' ? esc(relTime(a.created_at)) : esc(String(a.created_at).slice(0,10))}</span>
        </div>
      `;
    }).join('');
    el.innerHTML = `
      <div class="card">
        <div class="card-head"><div class="card-title">Recent Activity</div></div>
        <div class="card-body" style="padding:0">
          <div class="widget-activity-list">${rows}</div>
        </div>
      </div>`;
  } catch (e) {
    el.innerHTML = '';
  }
}
window.renderRecentActivityWidget = renderRecentActivityWidget;

// ── Team Workload ───────────────────────────────────────────
async function renderTeamWorkloadWidget() {
  const el = document.getElementById('widget-team-workload');
  if (!el) return;
  try {
    const r = await api('GET', '/api/overview/team-workload');
    const users = (r && Array.isArray(r.users)) ? r.users : [];
    const unassigned = Number(r?.unassigned || 0);
    const allCounts = users.map(u => Number(u.open_count || 0)).concat(unassigned);
    const maxCount = Math.max(...allCounts, 1);
    const totalOpen = allCounts.reduce((a, b) => a + b, 0);
    if (totalOpen === 0 && users.length <= 1) {
      el.innerHTML = `
        <div class="card">
          <div class="card-head"><div class="card-title">Team Workload</div></div>
          <div class="card-body"><p class="text-muted" style="margin:0">No open issues assigned.</p></div>
        </div>`;
      return;
    }
    const rows = users.map(u => {
      const count = Number(u.open_count || 0);
      const pct = Math.round((count / maxCount) * 100);
      const name = u.display_name || String(u.email || '').split('@')[0] || '?';
      return `
        <div class="widget-workload-row">
          <span class="widget-workload-name">${esc(name)}</span>
          <div class="widget-workload-bar-wrap">
            <div class="widget-workload-bar" style="width:${pct}%"></div>
          </div>
          <span class="widget-workload-count">${count}</span>
        </div>
      `;
    }).join('');
    const unassignedRow = unassigned > 0 ? `
      <div class="widget-workload-row">
        <span class="widget-workload-name text-muted">Unassigned</span>
        <div class="widget-workload-bar-wrap">
          <div class="widget-workload-bar widget-workload-bar-muted" style="width:${Math.round((unassigned / maxCount) * 100)}%"></div>
        </div>
        <span class="widget-workload-count text-muted">${unassigned}</span>
      </div>` : '';
    el.innerHTML = `
      <div class="card">
        <div class="card-head">
          <div class="card-title">Team Workload</div>
          <span class="text-muted text-sm">${totalOpen} open</span>
        </div>
        <div class="card-body" style="display:flex;flex-direction:column;gap:10px">${rows}${unassignedRow}</div>
      </div>`;
  } catch (e) {
    el.innerHTML = '';
  }
}
window.renderTeamWorkloadWidget = renderTeamWorkloadWidget;

// ── Master render (called from app.js after renderOverview sets innerHTML) ──
async function renderDashboardWidgets() {
  // Fire all four in parallel — they're independent
  await Promise.allSettled([
    typeof renderActiveSprintsWidget === 'function' ? renderActiveSprintsWidget() : Promise.resolve(),
    typeof renderDueSoonWidget === 'function' ? renderDueSoonWidget() : Promise.resolve(),
    typeof renderRecentActivityWidget === 'function' ? renderRecentActivityWidget() : Promise.resolve(),
    typeof renderTeamWorkloadWidget === 'function' ? renderTeamWorkloadWidget() : Promise.resolve(),
  ]);
}
window.renderDashboardWidgets = renderDashboardWidgets;

// Navigate from an Active Sprint widget row to the project's board tab
function navigateToSprint(projectId, projectKey) {
  if (typeof openProject === 'function') openProject(projectId);
  setTimeout(function () {
    if (typeof setTasksTab === 'function') setTasksTab('board');
  }, 100);
}
window.navigateToSprint = navigateToSprint;
