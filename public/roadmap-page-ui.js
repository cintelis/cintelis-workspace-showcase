// ============================================================
// Cintelis — top-level Roadmap page (customer users)
// Project selector + the Gantt-style roadmap from roadmap-ui.js
// (renderRoadmapInto). Internal users use the per-project
// Roadmap tab instead. Loaded as a regular <script> tag after
// roadmap-ui.js; uses state, api(), esc(), nav() from app.js.
// ============================================================

(function () {
  if (!('roadmapProjectId' in state.ui)) state.ui.roadmapProjectId = '';
  state.roadmapPage = state.roadmapPage || { projects: [] };
})();

async function renderRoadmapPageSection() {
  const c = document.getElementById('content');
  if (!c) return;
  c.innerHTML = '<div class="page-section"><div class="empty"><p>Loading roadmap…</p></div></div>';

  const r = await api('GET', '/api/projects');
  const projects = (r && Array.isArray(r.projects)) ? r.projects : (Array.isArray(r) ? r : []);
  state.roadmapPage.projects = projects;

  if (!projects.length) {
    c.innerHTML = `
      <div class="page-section page-section-wide">
        ${typeof renderEmptyState === 'function'
          ? renderEmptyState({
              icon: 'sprint',
              title: 'No roadmap yet',
              body: 'Your delivery plan appears here once Cintelis has set up a project for you.',
            })
          : '<div class="empty"><p>No projects yet.</p></div>'}
      </div>`;
    return;
  }

  let pid = state.ui.roadmapProjectId;
  if (!projects.some(p => p.id === pid)) pid = projects[0].id;
  state.ui.roadmapProjectId = pid;

  const options = projects.map(p =>
    `<option value="${esc(p.id)}" ${p.id === pid ? 'selected' : ''}>${esc(p.key ? p.key + ' — ' : '')}${esc(p.name || '')}</option>`
  ).join('');

  c.innerHTML = `
    <div class="page-section page-section-wide">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
        <div>
          <h2 style="margin:0">Roadmap</h2>
          <div class="text-muted text-sm" style="margin-top:4px">Timeline of scheduled work. Click an item to open it.</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <div class="form-group" style="margin:0;min-width:240px">
            <select id="roadmap-page-project" onchange="setRoadmapPageProject(this.value)">${options}</select>
          </div>
          <button class="btn btn-ghost btn-sm" type="button" onclick="openRoadmapPageProject()">Open project &rarr;</button>
        </div>
      </div>
      <div class="card">
        <div class="card-body" id="roadmap-page-body" style="padding:12px"></div>
      </div>
    </div>
  `;

  await renderRoadmapPageBody();
}
window.renderRoadmapPageSection = renderRoadmapPageSection;

async function renderRoadmapPageBody() {
  const body = document.getElementById('roadmap-page-body');
  if (!body) return;
  if (typeof renderRoadmapInto !== 'function') {
    body.innerHTML = '<div class="empty"><p>Roadmap module failed to load.</p></div>';
    return;
  }
  await renderRoadmapInto(body, state.ui.roadmapProjectId);
}

function setRoadmapPageProject(projectId) {
  state.ui.roadmapProjectId = projectId;
  renderRoadmapPageBody();
}
window.setRoadmapPageProject = setRoadmapPageProject;

function openRoadmapPageProject() {
  const pid = state.ui.roadmapProjectId;
  if (!pid) return;
  state.ui.tasksProjectId = pid;
  state.ui.tasksTab = 'roadmap';
  state.ui.tasksFilters = { status: '', assignee_id: '', type: '', priority: '', q: '' };
  nav('projects');
}
window.openRoadmapPageProject = openRoadmapPageProject;
