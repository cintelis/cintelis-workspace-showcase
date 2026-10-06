// ============================================================
// Cintelis Workspace — Tasks UI (Sprint 2)
// Frontend for the Projects + Issues module. Loaded as a regular
// <script> tag after app.js, so everything here lives on the
// global scope and freely uses helpers from app.js: state, api(),
// esc(), setModal(), closeModal(), currentSection, nav(), etc.
// Wired into app.js's renderSection() switch by the integration
// step (this file does not touch app.js itself).
// ============================================================

(function () {
  Object.assign(state.ui, {
    tasksProjectId: '',
    tasksFilters: { status: '', assignee_id: '', type: '', priority: '', q: '' },
    tasksOpenIssueId: ''
  });
  state.tasks = { projects: [], project: null, issues: [], users: [] };
})();

// ── Constants ────────────────────────────────────────────────
const TASK_STATUSES = ['backlog','todo','in_progress','in_review','done'];
const TASK_STATUS_LABELS = { backlog:'Backlog', todo:'To Do', in_progress:'In Progress', in_review:'In Review', done:'Done' };
const TASK_TYPES = ['task','bug','story','epic'];
const TASK_TYPE_LABELS = { task:'Task', bug:'Bug', story:'Story', epic:'Epic' };
const TASK_PRIORITIES = ['lowest','low','medium','high','highest'];
const TASK_PRIORITY_LABELS = { lowest:'Lowest', low:'Low', medium:'Medium', high:'High', highest:'Highest' };

// Jira-style colored type icons (16x16 rounded squares with white inner icon)
const ISSUE_TYPE_ICONS = {
  task: '<span class="issue-type-icon" style="background:#4BADE8;border-radius:3px;width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center"><svg viewBox="0 0 12 12" width="10" height="10"><path d="M2 6l3 3 5-5" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></span>',
  bug:  '<span class="issue-type-icon" style="background:#E5493A;border-radius:3px;width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center"><svg viewBox="0 0 12 12" width="10" height="10"><circle cx="6" cy="6" r="3" fill="#fff"/></svg></span>',
  story:'<span class="issue-type-icon" style="background:#63BA3C;border-radius:3px;width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center"><svg viewBox="0 0 12 12" width="10" height="10"><path d="M3 2h6v8l-3-2-3 2V2z" fill="#fff"/></svg></span>',
  epic: '<span class="issue-type-icon" style="background:#904EE2;border-radius:3px;width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center"><svg viewBox="0 0 12 12" width="10" height="10"><path d="M7 1L3 7h2.5l-.5 4 4-6H6.5L7 1z" fill="#fff"/></svg></span>'
};

// ── Markdown helper ───────────────────────────────────────────
// Mermaid integration: initialize once with theme-aware config.
// mermaid.run() is called after every markdown render via renderMarkdownAndDiagrams().
(function initMermaid() {
  if (typeof mermaid === 'undefined') return;
  try {
    const isDark = document.documentElement.dataset.theme !== 'light';
    mermaid.initialize({
      startOnLoad: false,
      theme: isDark ? 'dark' : 'default',
      securityLevel: 'strict',
      fontFamily: 'DM Sans, sans-serif',
    });
  } catch {}
})();

function slugifyHeading(text) {
  // Decode HTML entities first (marked may pass &amp; etc.)
  const decoded = String(text || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return decoded.toLowerCase().replace(/<[^>]*>/g, '').replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function renderMarkdown(text) {
  if (typeof marked === 'undefined' || typeof DOMPurify === 'undefined') {
    return `<pre class="md-fallback">${esc(text || '')}</pre>`;
  }
  try {
    // Custom renderer to add id attributes to headings for anchor links
    const renderer = new marked.Renderer();
    renderer.heading = function (data) {
      const depth = data.depth || 1;
      const text = data.text || '';
      const slug = slugifyHeading(text);
      return `<h${depth} id="${slug}">${text}</h${depth}>`;
    };
    const raw = marked.parse(String(text || ''), { breaks: true, gfm: true, renderer: renderer });
    let html = DOMPurify.sanitize(raw, {
      USE_PROFILES: { html: true },
      ADD_TAGS: ['div'],
      ADD_ATTR: ['class', 'id'],
    });
    // Convert <pre><code class="language-mermaid">...</code></pre> → <div class="mermaid">...</div>
    html = html.replace(
      /<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/gi,
      function (_, content) {
        // Decode HTML entities back to plain text for mermaid parser
        const decoded = content.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
        return '<div class="mermaid">' + decoded + '</div>';
      }
    );
    // Wiki-links: [[Page Title]] or [[SPACE/Page Title]] → clickable link.
    // Works in issue comments, doc pages, descriptions — anywhere renderMarkdown is used.
    html = html.replace(
      /\[\[([^\]]{1,120})\]\]/g,
      function (_, raw) {
        const t = raw.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
        // Display: show "Page Title" for [[SPACE/Page Title]], or the full text for [[Page Title]]
        const displayTitle = t.includes('/') ? t.split('/').slice(1).join('/') : t;
        const spaceHint = t.includes('/') ? '<span class="wiki-link-space">' + t.split('/')[0] + '</span> ' : '';
        const escaped = t.replace(/'/g, "\\'").replace(/"/g, '&quot;');
        return '<a class="wiki-link" href="javascript:void(0)" onclick="openWikiLink(\'' + escaped + '\')">' + spaceHint + displayTitle + '</a>';
      }
    );
    // Convert in-page anchor links (#heading) to scrollIntoView to avoid
    // clobbering the hash-based router URL.
    html = html.replace(
      /<a\s+href="#([^"]+)"([^>]*)>/g,
      function (_, anchor, rest) {
        return '<a href="javascript:void(0)" onclick="var el=document.getElementById(\'' + anchor.replace(/'/g, "\\'") + '\');if(el)el.scrollIntoView({behavior:\'smooth\',block:\'start\'})"' + rest + '>';
      }
    );
    // Refresh attachment URLs with the current session token at render time.
    // Heals stale links saved into markdown bodies before this fix shipped.
    const _attTk = (typeof localStorage !== 'undefined' && localStorage.getItem('token')) || '';
    if (_attTk) {
      html = html.replace(
        /(href|src)="(\/api\/attachments\/[^"\/]+\/(?:download|preview))(?:\?[^"]*)?"/g,
        function (_m, attr, base) {
          return attr + '="' + base + '?token=' + encodeURIComponent(_attTk) + '"';
        }
      );
    }
    return html;
  } catch {
    return `<pre class="md-fallback">${esc(text || '')}</pre>`;
  }
}

// Call this after any innerHTML that may contain mermaid diagrams.
// Safe to call even if no mermaid blocks exist — it just no-ops.
function renderMermaidDiagrams() {
  if (typeof mermaid === 'undefined') return;
  try {
    // Re-initialize with current theme (handles light/dark toggle)
    const isDark = document.documentElement.dataset.theme !== 'light';
    mermaid.initialize({
      startOnLoad: false,
      theme: isDark ? 'dark' : 'default',
      securityLevel: 'strict',
      fontFamily: 'DM Sans, sans-serif',
    });
    // Find unprocessed mermaid divs and render them
    const els = document.querySelectorAll('.mermaid:not([data-processed])');
    if (els.length) mermaid.run({ nodes: els });
  } catch (e) {
    console.warn('Mermaid render error:', e);
  }
}
window.renderMermaidDiagrams = renderMermaidDiagrams;

// Wiki-link navigation: [[Page Title]] or [[SPACE/Page Title]] clicks resolve to the matching doc page.
async function openWikiLink(rawLink) {
  if (!rawLink) return;
  try {
    // Parse optional space prefix: [[ENG/Architecture]] → spaceKey=ENG, title=Architecture
    let spaceKey = '';
    let title = rawLink;
    if (rawLink.includes('/')) {
      spaceKey = rawLink.split('/')[0].trim().toUpperCase();
      title = rawLink.split('/').slice(1).join('/').trim();
    }
    const r = await api('GET', '/api/entity-search?type=doc_page&q=' + encodeURIComponent(title));
    const results = (r && Array.isArray(r.results)) ? r.results : [];
    // If space key given, filter to that space first
    let filtered = results;
    if (spaceKey) {
      filtered = results.filter(p => String(p.subtitle || '').toUpperCase() === spaceKey);
    }
    // Exact title match first, then first partial match
    const pool = filtered.length ? filtered : results;
    const exact = pool.find(p => String(p.title || '').toLowerCase() === title.toLowerCase());
    const match = exact || pool[0];
    if (match) {
      // Fetch the page to get its space_id — renderDocsSection needs both.
      const pageData = await api('GET', '/api/doc-pages/' + encodeURIComponent(match.id));
      const spaceId = (pageData && pageData.space && pageData.space.id) || (pageData && pageData.page && pageData.page.space_id) || '';
      // Close any open modal (e.g. issue detail) before navigating
      if (typeof closeModal === 'function') closeModal();
      if (typeof state !== 'undefined') {
        state.ui.docsPageId = match.id;
        state.ui.docsSpaceId = spaceId;
        // Pre-load the page into state so renderPage has data immediately
        if (pageData && pageData.page) {
          state.docs.page = pageData.page;
          if (pageData.page._children === undefined) {
            state.docs.page._children = pageData.children || [];
            state.docs.page._parent = pageData.parent || null;
            state.docs.page._versionCount = pageData.version_count || 0;
          }
        }
      }
      nav('docs');
    } else {
      if (typeof toastWarn === 'function') toastWarn('Page not found: "' + title + '"');
    }
  } catch (e) {
    if (typeof toastError === 'function') toastError('Failed to find page: ' + (e && e.message || e));
  }
}
window.openWikiLink = openWikiLink;

// ── Relative time ─────────────────────────────────────────────
function relTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 30) return 'just now';
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  if (diff < 172800) return 'yesterday';
  if (diff < 86400 * 14) return `${Math.floor(diff/86400)} days ago`;
  try { return d.toLocaleDateString('en-AU', { day:'2-digit', month:'short', year: (Date.now() - d.getTime() > 86400*1000*300 ? 'numeric' : undefined) }); }
  catch { return iso; }
}

function tasksCanWrite() { return state.me && state.me.role !== 'viewer'; }

// An empty issue list means one of two different things, and the old copy only
// ever said the first: "no issues match your filters" on a project that has
// never had an issue is both wrong and unhelpful.
function tasksIssuesEmptyHtml(f, canWrite) {
  const filtered = !!(f && (f.status || f.type || f.priority || f.assignee_id || f.q));
  if (typeof renderEmptyState !== 'function') {
    return '<div class="empty"><p>' + (filtered ? 'No issues match your filters.' : 'No issues yet.') + '</p></div>';
  }
  return filtered
    ? renderEmptyState({
        icon: 'kanban',
        title: 'No issues match your filters',
        body: 'Nothing in this project matches the filters above. Clear them to see everything.',
        actionLabel: 'Clear filters',
        actionOnClick: 'clearTasksFilters()',
      })
    : renderEmptyState({
        icon: 'kanban',
        title: 'No issues yet',
        body: canWrite ? 'Issues are the work in this project. Create the first one to get started.' : 'Work added to this project will appear here.',
        actionLabel: canWrite ? '+ Create issue' : undefined,
        actionOnClick: canWrite ? 'openCreateIssue()' : undefined,
      });
}

// Used by the filtered empty state above.
function clearTasksFilters() {
  state.ui.tasksFilters = { status: '', assignee_id: '', type: '', priority: '', q: '' };
  if (typeof renderProjectDetail === 'function') renderProjectDetail();
  else if (typeof renderTasksSection === 'function') renderTasksSection();
}
window.clearTasksFilters = clearTasksFilters;
function tasksIsAdmin() { return state.me && state.me.role === 'admin'; }

// ── Section entry point ───────────────────────────────────────
async function renderTasksSection() {
  if (state.ui.tasksProjectId) {
    await loadProject(state.ui.tasksProjectId);
    renderProjectDetail();
  } else {
    await loadProjects();
    renderProjects();
  }
}
window.renderTasksSection = renderTasksSection;

// ── Project list ──────────────────────────────────────────────
async function loadProjects() {
  const r = await api('GET','/api/projects');
  state.tasks.projects = (r && Array.isArray(r.projects)) ? r.projects : [];
}

function projectStatusBar(counts, total) {
  if (!total) return '<div class="proj-bar proj-bar-empty"><span class="proj-bar-empty-label">No issues</span></div>';
  const segs = TASK_STATUSES.map(s => {
    const n = Number(counts && counts[s] || 0);
    if (!n) return '';
    return `<span class="proj-bar-seg lozenge-status-${s}" style="flex:${n}" title="${esc(TASK_STATUS_LABELS[s])}: ${n}">${n}</span>`;
  }).join('');
  return `<div class="proj-bar">${segs}</div>`;
}

function renderProjects() {
  const c = document.getElementById('content');
  const canWrite = tasksCanWrite();
  const cards = state.tasks.projects.map(p => {
    const lead = p.lead || null;
    const total = Number(p.total_issues || 0);
    const initials = lead && lead.display_name ? lead.display_name.trim().split(/\s+/).map(x=>x[0]).slice(0,2).join('').toUpperCase() : '';
    return `
      <div class="card project-card" onclick="openProject('${esc(p.id)}')" style="cursor:pointer">
        <div class="card-body">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
            <div class="project-key">${esc(p.key)}</div>
            <div class="text-muted text-sm">${total} issue${total===1?'':'s'}</div>
          </div>
          <div class="project-name" style="font-size:16px;font-weight:600;margin:8px 0 6px">${esc(p.name)}</div>
          ${lead ? `<div class="project-lead" style="display:flex;align-items:center;gap:8px;margin:6px 0 10px">
            ${lead.id ? `<img class="avatar-sm-img" src="/api/users/${esc(lead.id)}/avatar" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span class="avatar-sm" style="display:none">${esc(initials || '?')}</span>` : `<span class="avatar-sm">${esc(initials || '?')}</span>`}
            <span class="text-muted text-sm">${esc(lead.display_name || lead.email || '')}</span>
          </div>` : '<div class="text-muted text-sm" style="margin:6px 0 10px">No lead</div>'}
          ${projectStatusBar(p.issue_counts || {}, total)}
        </div>
      </div>
    `;
  }).join('');
  c.innerHTML = `
    <div class="page-section page-section-wide">
      <div class="page-actions">
        ${canWrite ? '<button class="btn btn-primary" type="button" onclick="openCreateProject()">+ New project</button>' : ''}
      </div>
      ${cards
        ? `<div class="project-grid">${cards}</div>`
        : (typeof renderEmptyState === 'function'
            ? renderEmptyState({ icon: 'folder', title: 'No projects yet', body: canWrite ? 'A project holds issues, sprints and a roadmap. Create your first to start tracking work.' : 'Projects shared with you will appear here.', actionLabel: canWrite ? '+ New project' : undefined, actionOnClick: canWrite ? 'openCreateProject()' : undefined })
            : '<div class="empty"><p>No projects yet.</p></div>')}
    </div>
  `;
}
window.renderProjects = renderProjects;

function openProject(id) {
  state.ui.tasksProjectId = id;
  state.ui.tasksFilters = { status:'', assignee_id:'', type:'', priority:'', q:'' };
  renderTasksSection();
  if (typeof updateTopbarCreate === 'function') updateTopbarCreate();
}
window.openProject = openProject;

function backToProjects() {
  state.ui.tasksProjectId = '';
  state.tasks.project = null;
  state.tasks.issues = [];
  renderTasksSection();
  if (typeof updateTopbarCreate === 'function') updateTopbarCreate();
}
window.backToProjects = backToProjects;

// ── Project detail ────────────────────────────────────────────
async function loadProject(id) {
  const f = state.ui.tasksFilters || {};
  const qs = new URLSearchParams();
  if (f.status) qs.set('status', f.status);
  if (f.assignee_id) qs.set('assignee_id', f.assignee_id);
  if (f.type) qs.set('type', f.type);
  if (f.priority) qs.set('priority', f.priority);
  if (f.q) qs.set('q', f.q);
  const queryStr = qs.toString();
  const issuesPath = `/api/projects/${encodeURIComponent(id)}/issues${queryStr ? '?' + queryStr : ''}`;
  const calls = [
    api('GET', `/api/projects/${encodeURIComponent(id)}`),
    api('GET', issuesPath)
  ];
  if (!state.tasks.users || !state.tasks.users.length) {
    calls.push(api('GET', '/api/users'));
  }
  const results = await Promise.all(calls);
  const projRes = results[0] || {};
  const issuesRes = results[1] || {};
  state.tasks.project = projRes.project || projRes || null;
  state.tasks.issues = Array.isArray(issuesRes.issues) ? issuesRes.issues : [];
  if (results[2]) {
    state.tasks.users = (results[2] && Array.isArray(results[2].users)) ? results[2].users : [];
  }
}

let tasksSearchTimer = null;

function renderProjectDetail() {
  const c = document.getElementById('content');
  const p = state.tasks.project;
  const f = state.ui.tasksFilters;
  const canWrite = tasksCanWrite();
  if (!p) {
    c.innerHTML = '<div class="empty"><p>Project not found.</p><button class="btn btn-ghost" type="button" onclick="backToProjects()">← All projects</button></div>';
    return;
  }
  const statusOpts = ['<option value="">Status: Any</option>'].concat(TASK_STATUSES.map(s => `<option value="${s}" ${f.status===s?'selected':''}>${esc(TASK_STATUS_LABELS[s])}</option>`)).join('');
  const typeOpts = ['<option value="">Type: Any</option>'].concat(TASK_TYPES.map(s => `<option value="${s}" ${f.type===s?'selected':''}>${esc(TASK_TYPE_LABELS[s])}</option>`)).join('');
  const prioOpts = ['<option value="">Priority: Any</option>'].concat(TASK_PRIORITIES.map(s => `<option value="${s}" ${f.priority===s?'selected':''}>${esc(TASK_PRIORITY_LABELS[s])}</option>`)).join('');
  const userOpts = ['<option value="">Assignee: Any</option>', `<option value="__unassigned__" ${f.assignee_id==='__unassigned__'?'selected':''}>Unassigned</option>`]
    .concat((state.tasks.users||[]).map(u => `<option value="${esc(u.id)}" ${f.assignee_id===u.id?'selected':''}>${esc(u.display_name || u.email)}</option>`)).join('');

  const rows = state.tasks.issues.map(i => {
    const a = i.assignee;
    const assigneeCell = a ? esc(a.display_name || a.email) : '<span class="text-muted">Unassigned</span>';
    return `
      <tr onclick="openIssueDetail('${esc(i.id)}')" style="cursor:pointer">
        <td class="mono">${esc(i.issue_key)}</td>
        <td>${ISSUE_TYPE_ICONS[i.type] || ISSUE_TYPE_ICONS.task}</td>
        <td>${esc(i.title)}</td>
        <td><span class="lozenge lozenge-status-${esc(i.status)}">${esc(TASK_STATUS_LABELS[i.status] || i.status)}</span></td>
        <td><span class="lozenge lozenge-priority-${esc(i.priority)}">${esc(TASK_PRIORITY_LABELS[i.priority] || i.priority)}</span></td>
        <td>${assigneeCell}</td>
        <td class="text-muted text-sm">${esc(relTime(i.updated_at))}</td>
      </tr>
    `;
  }).join('');

  c.innerHTML = `
    <div class="page-section page-section-wide">
      <div class="page-actions" style="justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm" type="button" onclick="backToProjects()">← All projects</button>
          <h2 style="margin:0;font-size:20px"><span class="project-key">${esc(p.key)}</span> <span style="margin-left:8px">${esc(p.name)}</span></h2>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${canWrite ? `<button class="btn btn-ghost btn-sm" type="button" onclick="openEditProject()">Edit project</button>` : ''}
          ${tasksIsAdmin() ? `<button class="btn btn-ghost btn-sm" type="button" onclick="confirmDeleteProject()">Delete project</button>` : ''}
        </div>
      </div>

      <div class="tasks-tabs">
        <button class="tasks-tab ${state.ui.tasksTab==='issues'?'active':''}" type="button" onclick="setTasksTab('issues')">Issues</button>
        <button class="tasks-tab ${state.ui.tasksTab==='board'?'active':''}" type="button" onclick="setTasksTab('board')">Board</button>
        <button class="tasks-tab ${state.ui.tasksTab==='backlog'?'active':''}" type="button" onclick="setTasksTab('backlog')">Backlog</button>
        <button class="tasks-tab ${state.ui.tasksTab==='sprints'?'active':''}" type="button" onclick="setTasksTab('sprints')">Sprints</button>
        <button class="tasks-tab ${state.ui.tasksTab==='roadmap'?'active':''}" type="button" onclick="setTasksTab('roadmap')">Roadmap</button>
      </div>

      <div id="tasks-tab-body">
      ${state.ui.tasksTab === 'issues' ? `
      <div class="card">
        <div class="card-body" style="padding:12px 14px">
          <div class="tasks-filter-bar" style="display:flex;gap:10px;align-items:center">
            <select onchange="onTasksFilterChange('status', this.value)">${statusOpts}</select>
            <select onchange="onTasksFilterChange('type', this.value)">${typeOpts}</select>
            <select onchange="onTasksFilterChange('priority', this.value)">${prioOpts}</select>
            <select onchange="onTasksFilterChange('assignee_id', this.value)">${userOpts}</select>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-body" style="padding:${rows ? '0' : '8px'}">
          ${rows ? `
          <table class="data-table tasks-table">
            <thead><tr>
              <th>Key</th><th>Type</th><th>Title</th><th>Status</th><th>Priority</th><th>Assignee</th><th>Updated</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>` : tasksIssuesEmptyHtml(f, canWrite)}
        </div>
      </div>
      ` : ''}
      </div>
    </div>
  `;
  if (state.ui.tasksTab !== 'issues' && typeof renderTasksTab === 'function') {
    renderTasksTab();
  }
}
window.renderProjectDetail = renderProjectDetail;

async function onTasksFilterChange(key, value) {
  state.ui.tasksFilters[key] = value || '';
  await loadProject(state.ui.tasksProjectId);
  renderProjectDetail();
}
window.onTasksFilterChange = onTasksFilterChange;

function onTasksSearchInput(value) {
  if (tasksSearchTimer) clearTimeout(tasksSearchTimer);
  tasksSearchTimer = setTimeout(async () => {
    state.ui.tasksFilters.q = value || '';
    await loadProject(state.ui.tasksProjectId);
    renderProjectDetail();
    const el = document.getElementById('tasks-q');
    if (el) { el.focus(); const v = el.value; el.value = ''; el.value = v; }
  }, 250);
}
window.onTasksSearchInput = onTasksSearchInput;

// ── Create project modal ──────────────────────────────────────
function openCreateProject() {
  setModal(`
    <div class="modal-head"><div class="modal-title">New project</div>
      <button class="modal-close" type="button" onclick="closeModal()">x</button></div>
    <div class="modal-body">
      <label>Project key (2–10 uppercase letters)</label>
      <input id="np-key" type="text" placeholder="ENG" maxlength="10" autofocus oninput="this.value=this.value.toUpperCase();checkProjectKeyAvail(this.value)" onblur="this.value=this.value.toUpperCase()">
      <div id="np-key-status" class="text-sm" style="margin-top:4px;min-height:1.2em"></div>
      <label style="margin-top:10px">Name</label>
      <input id="np-name" type="text" placeholder="Engineering">
      <label style="margin-top:10px">Description (Markdown)</label>
      <textarea id="np-desc" rows="4" placeholder="What is this project for?"></textarea>
      <div id="np-customer-wrap" style="display:none">
        <label style="margin-top:10px">Customer</label>
        <select id="np-customer"><option value="">Internal (Cintelis)</option></select>
      </div>
      <div class="form-msg" id="np-msg" style="margin-top:10px"></div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" type="button" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" type="button" onclick="submitCreateProject()">Create project</button>
    </div>
  `);
  setTimeout(() => {
    const el = document.getElementById('np-desc');
    if (el && typeof attachMarkdownToolbar === 'function') attachMarkdownToolbar(el);
  }, 0);
  // Internal admins can assign the new project to a customer tenant.
  if (typeof injectCustomerSelect === 'function') injectCustomerSelect('np-customer-wrap', 'np-customer');
}
window.openCreateProject = openCreateProject;

let _projectKeyCheckTimer = null;
async function checkProjectKeyAvail(key) {
  const el = document.getElementById('np-key-status');
  if (!el) return;
  const k = String(key || '').trim().toUpperCase();
  if (k.length < 2 || !/^[A-Z][A-Z0-9]{1,9}$/.test(k)) { el.textContent = ''; el.style.color = ''; return; }
  if (_projectKeyCheckTimer) clearTimeout(_projectKeyCheckTimer);
  _projectKeyCheckTimer = setTimeout(async () => {
    const existing = (state.tasks.projects || []).find(p => p.key === k);
    if (existing) {
      el.textContent = 'Key "' + k + '" is already taken by ' + (existing.name || 'another project');
      el.style.color = 'var(--red)';
    } else {
      el.textContent = 'Key "' + k + '" is available';
      el.style.color = 'var(--green)';
    }
  }, 200);
}
window.checkProjectKeyAvail = checkProjectKeyAvail;

async function submitCreateProject() {
  const key = (document.getElementById('np-key').value || '').trim().toUpperCase();
  const name = (document.getElementById('np-name').value || '').trim();
  const description_md = document.getElementById('np-desc').value || '';
  const msg = document.getElementById('np-msg');
  msg.className = 'form-msg';
  if (!key || key.length < 2) { msg.textContent = 'Key must be at least 2 characters'; msg.classList.add('form-msg-err'); return; }
  if (!/^[A-Z][A-Z0-9]{1,9}$/.test(key)) { msg.textContent = 'Key must be 2–10 uppercase letters/digits'; msg.classList.add('form-msg-err'); return; }
  if (!name) { msg.textContent = 'Name is required'; msg.classList.add('form-msg-err'); return; }
  // Client-side duplicate check (backend also enforces)
  const dup = (state.tasks.projects || []).find(p => p.key === key);
  if (dup) { msg.textContent = 'Key "' + key + '" is already taken by ' + (dup.name || 'another project'); msg.classList.add('form-msg-err'); return; }
  const customerEl = document.getElementById('np-customer');
  const customer_id = (customerEl && customerEl.value) ? customerEl.value : undefined;
  const r = await api('POST','/api/projects',{ key, name, description_md, customer_id });
  if (r && (r.id || r.project)) {
    closeModal();
    await loadProjects();
    renderProjects();
  } else {
    msg.textContent = (r && r.error) || 'Failed to create project';
    msg.classList.add('form-msg-err');
  }
}
window.submitCreateProject = submitCreateProject;

// ── Edit project modal ────────────────────────────────────────
function openEditProject() {
  const p = state.tasks.project;
  if (!p) return;
  const userOpts = '<option value="">No lead</option>' + (state.tasks.users || [])
    .map(u => `<option value="${esc(u.id)}" ${p.lead_user_id === u.id ? 'selected' : ''}>${esc(u.display_name || u.email)}</option>`).join('');
  setModal(`
    <div class="modal-head"><div class="modal-title">Edit project — ${esc(p.key)}</div>
      <button class="modal-close" type="button" onclick="closeModal()">x</button></div>
    <div class="modal-body">
      <label>Project key</label>
      <input type="text" value="${esc(p.key)}" disabled>
      <label style="margin-top:10px">Name</label>
      <input id="ep-name" type="text" value="${esc(p.name)}" autofocus>
      <label style="margin-top:10px">Description (Markdown)</label>
      <textarea id="ep-desc" rows="6">${esc(p.description_md || '')}</textarea>
      <label style="margin-top:10px">Project lead</label>
      <select id="ep-lead">${userOpts}</select>
      <div class="form-msg" id="ep-msg" style="margin-top:10px"></div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" type="button" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" type="button" onclick="submitEditProject()">Save changes</button>
    </div>
  `);
  setTimeout(() => {
    const el = document.getElementById('ep-desc');
    if (el && typeof attachMarkdownToolbar === 'function') attachMarkdownToolbar(el);
  }, 0);
}
window.openEditProject = openEditProject;

async function submitEditProject() {
  const p = state.tasks.project;
  if (!p) return;
  const name = (document.getElementById('ep-name').value || '').trim();
  const description_md = document.getElementById('ep-desc').value || '';
  const lead_user_id = document.getElementById('ep-lead').value || null;
  const msg = document.getElementById('ep-msg');
  msg.className = 'form-msg';
  if (!name) { msg.textContent = 'Name is required'; msg.classList.add('form-msg-err'); return; }
  const r = await api('PATCH', `/api/projects/${encodeURIComponent(p.id)}`, { name, description_md, lead_user_id });
  if (r && r.ok) {
    closeModal();
    await loadProject(p.id);
    renderProjectDetail();
  } else {
    msg.textContent = (r && r.error) || 'Failed to save changes';
    msg.classList.add('form-msg-err');
  }
}
window.submitEditProject = submitEditProject;

async function confirmDeleteProject() {
  const p = state.tasks.project;
  if (!p) return;
  // Typing the key, rather than clicking OK on a dialog: this takes a whole
  // project's issues, sprints and roadmap out of everyone's view at once, and
  // "reversible in the database" is not a reversal anyone here can perform.
  const typed = await appPrompt(`Delete project ${p.key} — ${p.name}?\n\nThis hides the project and all of its issues, sprints and roadmap from everyone. Type the project key ${p.key} to confirm.`, { title: 'Delete project', placeholder: p.key, confirmText: 'Delete project', danger: true });
  if (typed === null) return;
  if (String(typed).trim().toUpperCase() !== String(p.key).toUpperCase()) {
    toastError('Project not deleted: the key did not match.');
    return;
  }
  const r = await api('DELETE', `/api/projects/${encodeURIComponent(p.id)}`);
  if (r && r.ok) {
    state.ui.tasksProjectId = '';
    state.tasks.project = null;
    await loadProjects();
    renderProjects();
  } else {
    toastError((r && r.error) || 'Failed to delete project');
  }
}
window.confirmDeleteProject = confirmDeleteProject;

// ── Create issue modal ────────────────────────────────────────
function openCreateIssue() {
  if (!state.tasks.project) return;
  const typeOpts = TASK_TYPES.map(t => `<option value="${t}">${esc(TASK_TYPE_LABELS[t])}</option>`).join('');
  const prioOpts = TASK_PRIORITIES.map(p => `<option value="${p}" ${p==='medium'?'selected':''}>${esc(TASK_PRIORITY_LABELS[p])}</option>`).join('');
  const userOpts = '<option value="">Unassigned</option>' + (state.tasks.users||[]).map(u => `<option value="${esc(u.id)}">${esc(u.display_name || u.email)}</option>`).join('');
  setModal(`
    <div class="modal-head"><div class="modal-title">New issue in ${esc(state.tasks.project.key)}</div>
      <button class="modal-close" type="button" onclick="closeModal()">x</button></div>
    <div class="modal-body">
      <label>Title</label>
      <input id="ni-title" type="text" autofocus placeholder="Short summary">
      <div class="form-row" style="margin-top:10px">
        <div><label>Type</label><select id="ni-type">${typeOpts}</select></div>
        <div><label>Priority</label><select id="ni-priority">${prioOpts}</select></div>
      </div>
      <label style="margin-top:10px">Assignee</label>
      <select id="ni-assignee">${userOpts}</select>
      <label style="margin-top:10px">Description (Markdown)</label>
      <textarea id="ni-desc" rows="6" placeholder="Details, steps to reproduce, acceptance criteria…"></textarea>
      <label style="margin-top:10px">Parent issue key (optional)</label>
      <input id="ni-parent" type="text" placeholder="${esc(state.tasks.project.key)}-12">
      <div class="form-msg" id="ni-msg" style="margin-top:10px"></div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" type="button" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" type="button" onclick="submitCreateIssue()">Create issue</button>
    </div>
  `);
  setTimeout(() => {
    const el = document.getElementById('ni-desc');
    if (el && typeof attachMarkdownToolbar === 'function') attachMarkdownToolbar(el);
  }, 0);
}
window.openCreateIssue = openCreateIssue;

async function submitCreateIssue() {
  const title = (document.getElementById('ni-title').value || '').trim();
  const type = document.getElementById('ni-type').value;
  const priority = document.getElementById('ni-priority').value;
  const assignee_id = document.getElementById('ni-assignee').value || null;
  const description_md = document.getElementById('ni-desc').value || '';
  const parent_key = (document.getElementById('ni-parent').value || '').trim();
  const msg = document.getElementById('ni-msg');
  msg.className = 'form-msg';
  if (!title) { msg.textContent = 'Title is required'; msg.classList.add('form-msg-err'); return; }
  const body = { title, type, priority, assignee_id, description_md };
  if (parent_key) body.parent_key = parent_key;
  const r = await api('POST', `/api/projects/${encodeURIComponent(state.ui.tasksProjectId)}/issues`, body);
  if (r && (r.id || r.issue)) {
    closeModal();
    await loadProject(state.ui.tasksProjectId);
    renderProjectDetail();
  } else {
    msg.textContent = (r && r.error) || 'Failed to create issue';
    msg.classList.add('form-msg-err');
  }
}
window.submitCreateIssue = submitCreateIssue;

// ── Issue detail (full page view) ─────────────────────────────
let currentIssue = null;
let currentIssueParent = null;
let currentIssueSubtasks = [];
let currentIssueDeps = { blocks: [], blocked_by: [] };
let currentIssueActivity = [];

async function openIssueDetail(id) {
  state.ui.tasksOpenIssueId = id;
  // Show loading state in the content area
  const c = document.getElementById('content');
  if (c) c.innerHTML = '<div class="empty"><p>Loading issue...</p></div>';
  const r = await api('GET', `/api/issues/${encodeURIComponent(id)}`);
  if (!r || r.error || !r.issue) {
    if (c) c.innerHTML = `<div class="empty"><p>${esc((r && r.error) || 'Failed to load issue')}</p><button class="btn btn-ghost" type="button" onclick="closeIssueDetail()">Back</button></div>`;
    return;
  }
  currentIssue = r.issue;
  currentIssueParent = r.parent || null;
  currentIssueSubtasks = Array.isArray(r.subtasks) ? r.subtasks : [];
  currentIssueActivity = Array.isArray(r.activity) ? r.activity : [];
  currentIssueDeps = r.dependencies || { blocks: [], blocked_by: [] };
  if (!state.tasks.users || !state.tasks.users.length) {
    const ur = await api('GET','/api/users');
    state.tasks.users = (ur && Array.isArray(ur.users)) ? ur.users : [];
  }
  // Also ensure the project is loaded (for the breadcrumb back button)
  if (currentIssue.project_id && !state.ui.tasksProjectId) {
    state.ui.tasksProjectId = currentIssue.project_id;
  }
  renderIssueDetailPage();
}
window.openIssueDetail = openIssueDetail;

function renderIssueDetailPage() {
  const i = currentIssue;
  if (!i) return;
  const c = document.getElementById('content');
  if (!c) return;
  const canWrite = tasksCanWrite();
  const a = i.assignee;
  const reporter = i.reporter;
  const assigneeName = a ? (a.display_name || a.email) : 'Unassigned';
  const reporterName = reporter ? (reporter.display_name || reporter.email) : '—';
  const dueVal = i.due_at ? String(i.due_at).slice(0,10) : '';

  // Update page title
  const titleEl = document.getElementById('page-title');
  if (titleEl) titleEl.textContent = i.issue_key;

  // Build breadcrumb: Projects › ProjectKey › ParentIssue › CurrentIssue
  const projectKey = i.issue_key ? i.issue_key.split('-')[0] : '';
  const projectName = (state.tasks.project && state.tasks.project.name) || projectKey;
  const breadcrumbParts = [
    `<a onclick="state.ui.tasksProjectId='';nav('projects')" style="cursor:pointer;color:var(--muted);text-decoration:none">Projects</a>`,
    `<a onclick="closeIssueDetail()" style="cursor:pointer;color:var(--muted);text-decoration:none">${esc(projectKey)}${projectName && projectName !== projectKey ? ' — ' + esc(projectName) : ''}</a>`,
  ];
  if (currentIssueParent) {
    breadcrumbParts.push(`<a onclick="openIssueDetail('${esc(currentIssueParent.id)}')" style="cursor:pointer;color:var(--muted);text-decoration:none"><span class="mono">${esc(currentIssueParent.issue_key)}</span></a>`);
  }
  breadcrumbParts.push(`<span style="color:var(--text)">${esc(i.issue_key)}</span>`);
  const breadcrumbHtml = breadcrumbParts.join(' <span style="color:var(--muted2);margin:0 2px">›</span> ');

  c.innerHTML = `
    <div class="issue-fullpage">
      <div class="issue-fullpage-header">
        <div style="display:flex;flex-direction:column;gap:8px;min-width:0">
          <div class="docs-breadcrumb" style="font-size:13px">${breadcrumbHtml}</div>
          <div style="display:flex;align-items:center;gap:8px">
            ${ISSUE_TYPE_ICONS[i.type] || ISSUE_TYPE_ICONS.task}
            <span class="mono" style="color:var(--cyan);font-size:14px;font-weight:700">${esc(i.issue_key)}</span>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
          ${canWrite ? `<button class="btn btn-ghost btn-sm" type="button" onclick="cloneCurrentIssue()" style="font-size:12px">Clone</button>` : ''}
          <button class="btn btn-ghost btn-sm" type="button" onclick="copyIssueUrl('${esc(i.issue_key)}')" style="font-size:12px">Copy link</button>
          ${canWrite ? `<button class="btn btn-ghost btn-sm" type="button" style="color:var(--red)" onclick="submitDeleteIssue()">Delete</button>` : ''}
        </div>
      </div>
      <div class="issue-fullpage-body">
      <div class="issue-detail-body" style="display:grid;grid-template-columns:minmax(0,2fr) minmax(260px,1fr);gap:24px">
        <div class="issue-detail-main" style="min-width:0">
          <div class="issue-title-wrap" id="issue-title-wrap">
            ${renderIssueTitleView(i.title)}
          </div>
          <div class="issue-section-label" style="margin-top:18px;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted2)">Description</div>
          <div class="issue-desc-wrap" id="issue-desc-wrap" style="margin-top:6px">
            ${renderIssueDescView(i.description_md)}
          </div>
        </div>

        <aside class="issue-detail-side" style="min-width:0">
          <div class="kv-grid" id="issue-meta-grid">
            ${renderIssueMetaRow('type', 'Type', `<span>${ISSUE_TYPE_ICONS[i.type] || ''}${esc(TASK_TYPE_LABELS[i.type] || i.type)}</span>`, canWrite)}
            ${renderIssueMetaRow('status', 'Status', `<span class="lozenge lozenge-status-${esc(i.status)}">${esc(TASK_STATUS_LABELS[i.status] || i.status)}</span>`, canWrite)}
            ${renderIssueMetaRow('priority', 'Priority', `<span class="lozenge lozenge-priority-${esc(i.priority)}">${esc(TASK_PRIORITY_LABELS[i.priority] || i.priority)}</span>`, canWrite)}
            ${renderIssueMetaRow('assignee', 'Assignee', a ? esc(assigneeName) : '<span class="text-muted">Unassigned</span>', canWrite)}
            <div class="kv-row"><div class="kv-k">Reporter</div><div class="kv-v">${esc(reporterName)}</div></div>
            ${renderIssueMetaRow('start', 'Start date', i.start_at ? esc(String(i.start_at).slice(0,10)) : '<span class="text-muted">—</span>', canWrite)}
            ${renderIssueMetaRow('due', 'Due date', dueVal ? esc(dueVal) : '<span class="text-muted">—</span>', canWrite)}
            <div class="kv-row"><div class="kv-k">Parent</div><div class="kv-v">${currentIssueParent ? `<a href="javascript:void(0)" onclick="openIssueDetail('${esc(currentIssueParent.id)}')"><span class="mono">${esc(currentIssueParent.issue_key)}</span> ${esc(currentIssueParent.title)}</a>` : '<span class="text-muted">—</span>'}</div></div>
            <div class="kv-row"><div class="kv-k">Sub-tasks</div><div class="kv-v">${
              currentIssueSubtasks.length
                ? currentIssueSubtasks.map(s => `<div><a href="javascript:void(0)" onclick="openIssueDetail('${esc(s.id)}')"><span class="mono">${esc(s.issue_key)}</span> ${esc(s.title)}</a> <span class="lozenge lozenge-status-${esc(s.status)}" style="margin-left:6px">${esc(TASK_STATUS_LABELS[s.status] || s.status)}</span></div>`).join('')
                : '<span class="text-muted">None</span>'
            }</div></div>
            <div class="kv-row"><div class="kv-k">Blocked by</div><div class="kv-v">${
              currentIssueDeps && currentIssueDeps.blocked_by && currentIssueDeps.blocked_by.length
                ? currentIssueDeps.blocked_by.map(d => `<div style="display:flex;align-items:center;gap:4px"><a href="javascript:void(0)" onclick="openIssueDetail('${esc(d.id)}')"><span class="mono">${esc(d.issue_key)}</span></a> <span class="lozenge lozenge-status-${esc(d.status)}" style="font-size:10px">${esc(d.status)}</span>${canWrite ? ` <button class="btn-icon-xs" onclick="removeDep('${esc(d.dep_id)}')" title="Remove">&times;</button>` : ''}</div>`).join('')
                : '<span class="text-muted">None</span>'
            }${canWrite ? `<button class="btn btn-ghost btn-sm" style="margin-top:4px;font-size:11px" onclick="openAddDependency('blocked_by')">+ Add blocker</button>` : ''}</div></div>
            <div class="kv-row"><div class="kv-k">Blocks</div><div class="kv-v">${
              currentIssueDeps && currentIssueDeps.blocks && currentIssueDeps.blocks.length
                ? currentIssueDeps.blocks.map(d => `<div style="display:flex;align-items:center;gap:4px"><a href="javascript:void(0)" onclick="openIssueDetail('${esc(d.id)}')"><span class="mono">${esc(d.issue_key)}</span></a> <span class="lozenge lozenge-status-${esc(d.status)}" style="font-size:10px">${esc(d.status)}</span>${canWrite ? ` <button class="btn-icon-xs" onclick="removeDep('${esc(d.dep_id)}')" title="Remove">&times;</button>` : ''}</div>`).join('')
                : '<span class="text-muted">None</span>'
            }${canWrite ? `<button class="btn btn-ghost btn-sm" style="margin-top:4px;font-size:11px" onclick="openAddDependency('blocks')">+ Add dependency</button>` : ''}</div></div>
            <div class="kv-row"><div class="kv-k">Created</div><div class="kv-v text-muted text-sm">${esc(relTime(i.created_at))}</div></div>
            <div class="kv-row"><div class="kv-k">Updated</div><div class="kv-v text-muted text-sm">${esc(relTime(i.updated_at))}</div></div>
          </div>
          <div id="issue-custom-fields"></div>
        </aside>
      </div>

      <div class="issue-section-label" style="margin-top:22px;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted2)">Comments (${currentIssueActivity.filter(a => a.kind === 'comment').length})</div>
      <div class="issue-comments" id="issue-comments" style="margin-top:8px">
        ${renderCommentsFeed()}
      </div>

      ${canWrite ? `
      <div class="issue-comment-composer" style="margin-top:14px">
        <textarea id="issue-comment-text" rows="3" placeholder="Add a comment… (for detailed docs, create a page and link it here)"></textarea>
        <div style="margin-top:8px;display:flex;justify-content:flex-end">
          <button class="btn btn-primary btn-sm" type="button" onclick="addComment()">Add comment</button>
        </div>
      </div>` : ''}

      <details class="issue-activity-details" style="margin-top:22px">
        <summary class="issue-section-label" style="font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted2);cursor:pointer;user-select:none;list-style:none;display:flex;align-items:center;gap:8px">
          <span style="font-size:10px;transition:transform .15s">▸</span>
          Activity log (${currentIssueActivity.filter(a => a.kind !== 'comment').length} events)
        </summary>
        <div class="issue-activity" id="issue-activity" style="margin-top:8px">
          ${renderSystemActivityFeed()}
        </div>
      </details>

      <div id="issue-attachments-panel" style="margin-top:18px"></div>
      <div id="issue-links-panel" style="margin-top:18px"></div>
      </div>
    </div>
  `;
  // Wire @mention autocomplete + markdown toolbar on the comment composer.
  // Use a longer delay to ensure notifications-ui.js has loaded and executed.
  setTimeout(() => {
    const ct = document.getElementById('issue-comment-text');
    if (!ct) return;
    if (typeof attachMentionAutocomplete === 'function') attachMentionAutocomplete(ct);
    if (typeof attachWikiLinkAutocomplete === 'function') attachWikiLinkAutocomplete(ct);
    if (typeof attachMarkdownToolbar === 'function') attachMarkdownToolbar(ct);
  }, 100);
  // Sprint 6: render attachments + linked items panels into the modal extras.
  setTimeout(() => {
    const attEl = document.getElementById('issue-attachments-panel');
    if (attEl && typeof renderAttachmentsPanel === 'function' && currentIssue) {
      renderAttachmentsPanel(attEl, 'issue', currentIssue.id);
    }
    const lnEl = document.getElementById('issue-links-panel');
    if (lnEl && typeof renderLinksPanel === 'function' && currentIssue) {
      renderLinksPanel(lnEl, 'issue', currentIssue.id);
    }
    // Render any mermaid diagrams in description or comments.
    if (typeof renderMermaidDiagrams === 'function') renderMermaidDiagrams();
    // Collapse long comments (> 300px rendered height).
    if (typeof collapseOverflowingComments === 'function') collapseOverflowingComments();
    // Load custom fields for issue sidebar.
    if (typeof loadCustomFields === 'function') loadCustomFields();
  }, 0);
}

function closeIssueDetail() {
  // Drop caches so a re-open re-fetches.
  if (currentIssue && currentIssue.id) {
    const k = 'issue:' + currentIssue.id;
    if (state.attachments) delete state.attachments[k];
    if (state.entityLinks) delete state.entityLinks[k];
  }
  state.ui.tasksOpenIssueId = '';
  currentIssue = null;
  currentIssueParent = null;
  currentIssueSubtasks = [];
  currentIssueDeps = { blocks: [], blocked_by: [] };
  currentIssueActivity = [];
  // Navigate back to the project detail page (full page, not a modal close).
  if (state.ui.tasksProjectId) {
    loadProject(state.ui.tasksProjectId).then(renderProjectDetail);
  } else {
    nav('projects');
  }
}
window.closeIssueDetail = closeIssueDetail;

function renderIssueTitleView(title) {
  return `<h2 class="issue-title" ondblclick="editIssueTitle()">${esc(title || '(no title)')}</h2>`;
}

function editIssueTitle() {
  if (!tasksCanWrite()) return;
  const wrap = document.getElementById('issue-title-wrap');
  if (!wrap) return;
  wrap.innerHTML = `<input id="issue-title-input" type="text" value="${esc(currentIssue.title || '')}" style="font-size:20px;width:100%" onblur="commitIssueTitle()" onkeydown="if(event.key==='Enter'){this.blur();}else if(event.key==='Escape'){cancelIssueTitleEdit();}">`;
  setTimeout(() => { const el = document.getElementById('issue-title-input'); if (el) { el.focus(); el.select(); } }, 10);
}
window.editIssueTitle = editIssueTitle;

let titleEditCancelled = false;
function cancelIssueTitleEdit() {
  titleEditCancelled = true;
  const wrap = document.getElementById('issue-title-wrap');
  if (wrap) wrap.innerHTML = renderIssueTitleView(currentIssue.title);
  setTimeout(() => { titleEditCancelled = false; }, 50);
}
window.cancelIssueTitleEdit = cancelIssueTitleEdit;

async function commitIssueTitle() {
  if (titleEditCancelled) return;
  const el = document.getElementById('issue-title-input');
  if (!el) return;
  const next = (el.value || '').trim();
  if (!next || next === currentIssue.title) {
    const wrap = document.getElementById('issue-title-wrap');
    if (wrap) wrap.innerHTML = renderIssueTitleView(currentIssue.title);
    return;
  }
  const r = await api('PATCH', `/api/issues/${encodeURIComponent(currentIssue.id)}`, { title: next });
  if (r && (r.ok || r.issue || r.id)) {
    currentIssue.title = next;
    if (r.issue) currentIssue = r.issue;
    const wrap = document.getElementById('issue-title-wrap');
    if (wrap) wrap.innerHTML = renderIssueTitleView(currentIssue.title);
  } else {
    toastError((r && r.error) || 'Failed to update title');
    const wrap = document.getElementById('issue-title-wrap');
    if (wrap) wrap.innerHTML = renderIssueTitleView(currentIssue.title);
  }
}
window.commitIssueTitle = commitIssueTitle;

function renderIssueDescView(md) {
  const body = (md && String(md).trim()) ? renderMarkdown(md) : '<p class="text-muted">No description. Double-click to add one.</p>';
  return `<div class="issue-desc md-body" style="min-height:200px" ondblclick="editIssueDesc()">${body}</div>`;
}

function editIssueDesc() {
  if (!tasksCanWrite()) return;
  const wrap = document.getElementById('issue-desc-wrap');
  if (!wrap) return;
  wrap.innerHTML = `
    <textarea id="issue-desc-input" rows="8" style="width:100%">${esc(currentIssue.description_md || '')}</textarea>
    <div style="margin-top:8px;display:flex;gap:8px">
      <button class="btn btn-primary btn-sm" type="button" onclick="commitIssueDesc()">Save</button>
      <button class="btn btn-ghost btn-sm" type="button" onclick="cancelIssueDescEdit()">Cancel</button>
    </div>
  `;
  setTimeout(() => {
    const el = document.getElementById('issue-desc-input');
    if (el) el.focus();
    if (el && typeof attachMentionAutocomplete === 'function') attachMentionAutocomplete(el);
    if (el && typeof attachWikiLinkAutocomplete === 'function') attachWikiLinkAutocomplete(el);
    if (el && typeof attachMarkdownToolbar === 'function') attachMarkdownToolbar(el);
  }, 10);
}
window.editIssueDesc = editIssueDesc;

function cancelIssueDescEdit() {
  const wrap = document.getElementById('issue-desc-wrap');
  if (wrap) wrap.innerHTML = renderIssueDescView(currentIssue.description_md);
}
window.cancelIssueDescEdit = cancelIssueDescEdit;

async function commitIssueDesc() {
  const el = document.getElementById('issue-desc-input');
  if (!el) return;
  const next = el.value || '';
  const r = await api('PATCH', `/api/issues/${encodeURIComponent(currentIssue.id)}`, { description_md: next });
  if (r && (r.ok || r.issue || r.id)) {
    currentIssue.description_md = next;
    if (r.issue) currentIssue = r.issue;
    const wrap = document.getElementById('issue-desc-wrap');
    if (wrap) wrap.innerHTML = renderIssueDescView(currentIssue.description_md);
  } else {
    toastError((r && r.error) || 'Failed to update description');
  }
}
window.commitIssueDesc = commitIssueDesc;

// Comments feed (always visible) ──────────────────────────────
function renderCommentsFeed() {
  const comments = currentIssueActivity.filter(a => a.kind === 'comment');
  if (!comments.length) return '<div class="text-muted text-sm" style="padding:8px 0">No comments yet. Be the first to add one.</div>';
  const canWrite = tasksCanWrite();
  return comments.map(act => {
    const u = act.user || null;
    const who = u ? (u.display_name || u.email) : 'system';
    const when = relTime(act.created_at);
    const actions = canWrite ? `
      <div style="display:flex;gap:6px;align-items:center">
        <button class="btn btn-ghost btn-sm" type="button" style="font-size:11px;padding:2px 8px" onclick="editComment('${esc(act.id)}')">Edit</button>
        <button class="activity-del" type="button" title="Delete comment" onclick="deleteActivity('${esc(act.id)}')">×</button>
      </div>` : '';
    const commentId = 'comment-body-' + act.id;
    return `
      <div class="comment-card" id="comment-card-${esc(act.id)}" style="margin:10px 0;padding:14px 16px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <div><strong>${esc(who)}</strong> <span class="text-muted text-sm">${esc(when)}</span></div>
          ${actions}
        </div>
        <div class="comment-body-wrap" id="${esc(commentId)}">
          <div class="md-body comment-body-content">${renderMarkdown(act.body_md || '')}</div>
        </div>
      </div>
    `;
  }).join('');
}

// System activity feed (collapsed) ────────────────────────────
function renderSystemActivityFeed() {
  const events = currentIssueActivity.filter(a => a.kind !== 'comment');
  if (!events.length) return '<div class="text-muted text-sm">No system events yet.</div>';
  const myId = state.me && state.me.id;
  const isAdmin = tasksIsAdmin();
  return events.map(act => {
    const u = act.user || null;
    const who = u ? (u.display_name || u.email) : 'system';
    const when = relTime(act.created_at);
    const canDelete = isAdmin || (myId && act.user_id && myId === act.user_id);
    const delBtn = canDelete ? `<button class="activity-del" type="button" title="Delete" onclick="deleteActivity('${esc(act.id)}')">×</button>` : '';
    return `
      <div class="activity-row activity-system" style="margin:6px 0;font-style:italic;color:var(--muted2);font-size:13px;display:flex;justify-content:space-between;align-items:center;gap:8px">
        <div><strong>${esc(who)}</strong> ${esc(act.body_md || '')} <span class="text-muted">· ${esc(when)}</span></div>
        ${delBtn}
      </div>
    `;
  }).join('');
}

// Collapse long comments after render
function collapseOverflowingComments() {
  document.querySelectorAll('.comment-body-wrap').forEach(wrap => {
    if (wrap.dataset.collapsed) return;
    const content = wrap.querySelector('.comment-body-content');
    if (!content) return;
    if (content.scrollHeight > 300) {
      wrap.style.maxHeight = '300px';
      wrap.style.overflow = 'hidden';
      wrap.style.position = 'relative';
      const btn = document.createElement('button');
      btn.className = 'comment-show-more';
      btn.textContent = 'Show more ▾';
      btn.onclick = function () {
        wrap.style.maxHeight = 'none';
        wrap.style.overflow = 'visible';
        btn.remove();
        wrap.dataset.collapsed = 'expanded';
      };
      wrap.parentNode.appendChild(btn);
      wrap.dataset.collapsed = 'clipped';
    }
  });
}
window.collapseOverflowingComments = collapseOverflowingComments;

// Edit comment inline
function editComment(actId) {
  if (!tasksCanWrite()) return;
  const act = currentIssueActivity.find(a => a.id === actId);
  if (!act) return;
  const wrap = document.getElementById('comment-body-' + actId);
  if (!wrap) return;
  // Remove any "show more" button
  const showMore = wrap.parentNode.querySelector('.comment-show-more');
  if (showMore) showMore.remove();
  // Replace rendered content with a textarea
  wrap.style.maxHeight = 'none';
  wrap.style.overflow = 'visible';
  wrap.innerHTML = `
    <textarea id="edit-comment-text-${esc(actId)}" rows="6" style="width:100%;margin-bottom:8px">${esc(act.body_md || '')}</textarea>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn btn-ghost btn-sm" type="button" onclick="cancelEditComment('${esc(actId)}')">Cancel</button>
      <button class="btn btn-primary btn-sm" type="button" onclick="saveComment('${esc(actId)}')">Save</button>
    </div>
  `;
  const ta = document.getElementById('edit-comment-text-' + actId);
  if (ta) {
    ta.focus();
    if (typeof attachMarkdownToolbar === 'function') attachMarkdownToolbar(ta);
    if (typeof attachMentionAutocomplete === 'function') attachMentionAutocomplete(ta);
    if (typeof attachWikiLinkAutocomplete === 'function') attachWikiLinkAutocomplete(ta);
  }
}
window.editComment = editComment;

function cancelEditComment(actId) {
  const act = currentIssueActivity.find(a => a.id === actId);
  if (!act) return;
  const wrap = document.getElementById('comment-body-' + actId);
  if (!wrap) return;
  wrap.innerHTML = `<div class="md-body comment-body-content">${renderMarkdown(act.body_md || '')}</div>`;
  if (typeof renderMermaidDiagrams === 'function') setTimeout(renderMermaidDiagrams, 0);
  if (typeof collapseOverflowingComments === 'function') setTimeout(collapseOverflowingComments, 0);
}
window.cancelEditComment = cancelEditComment;

async function saveComment(actId) {
  const ta = document.getElementById('edit-comment-text-' + actId);
  if (!ta) return;
  const newBody = ta.value.trim();
  if (!newBody) { toastError('Comment cannot be empty'); return; }
  const r = await api('PATCH', `/api/activity/${encodeURIComponent(actId)}`, { body_md: newBody });
  if (r && !r.error) {
    // Update local state
    const act = currentIssueActivity.find(a => a.id === actId);
    if (act) act.body_md = r.body_md || newBody;
    // Re-render the comment body
    const wrap = document.getElementById('comment-body-' + actId);
    if (wrap) {
      wrap.innerHTML = `<div class="md-body comment-body-content">${renderMarkdown(r.body_md || newBody)}</div>`;
    }
    toastSuccess('Comment updated');
    if (typeof renderMermaidDiagrams === 'function') setTimeout(renderMermaidDiagrams, 0);
    if (typeof collapseOverflowingComments === 'function') setTimeout(collapseOverflowingComments, 0);
  } else {
    toastError((r && r.error) || 'Failed to update comment');
  }
}
window.saveComment = saveComment;

async function addComment() {
  const el = document.getElementById('issue-comment-text');
  if (!el) return;
  const body_md = (el.value || '').trim();
  if (!body_md) return;
  const r = await api('POST', `/api/issues/${encodeURIComponent(currentIssue.id)}/comments`, { body_md });
  if (r && (r.id || r.activity || r.ok)) {
    el.value = '';
    await refreshIssueDetail();
  } else {
    toastError((r && r.error) || 'Failed to add comment');
  }
}
window.addComment = addComment;

async function deleteActivity(id) {
  if (!(await appConfirm('Delete this entry?'))) return;
  const r = await api('DELETE', `/api/activity/${encodeURIComponent(id)}`);
  if (r && (r.ok || r.id)) {
    await refreshIssueDetail();
  } else {
    toastError((r && r.error) || 'Failed to delete');
  }
}
window.deleteActivity = deleteActivity;

async function refreshIssueDetail() {
  if (!currentIssue) return;
  const r = await api('GET', `/api/issues/${encodeURIComponent(currentIssue.id)}`);
  if (r && r.issue) {
    currentIssue = r.issue;
    currentIssueParent = r.parent || null;
    currentIssueSubtasks = Array.isArray(r.subtasks) ? r.subtasks : [];
    currentIssueActivity = Array.isArray(r.activity) ? r.activity : [];
    renderIssueDetailPage();
  }
}

// Metadata sidebar — click-to-edit ───────────────────────────
function renderIssueMetaRow(field, label, valueHtml, canWrite) {
  const onclick = canWrite ? `onclick="editIssueField('${field}')"` : '';
  const cursor = canWrite ? 'cursor:pointer' : '';
  return `<div class="kv-row" id="kv-row-${field}"><div class="kv-k">${esc(label)}</div><div class="kv-v" style="${cursor}" ${onclick}>${valueHtml}</div></div>`;
}

function editIssueField(field) {
  if (!tasksCanWrite()) return;
  const row = document.getElementById('kv-row-' + field);
  if (!row) return;
  const valEl = row.querySelector('.kv-v');
  if (!valEl) return;
  // Guard: if the editor is already rendered (select/input present), skip.
  // Without this, clicks on the <select> bubble up to the parent onclick
  // and re-create the select, which kills the open dropdown.
  if (valEl.querySelector('#ife-input')) return;
  const i = currentIssue;
  let editorHtml = '';
  if (field === 'type') {
    editorHtml = `<select id="ife-input" onchange="commitIssueField('type', this.value)">` +
      TASK_TYPES.map(t => `<option value="${t}" ${i.type===t?'selected':''}>${esc(TASK_TYPE_LABELS[t])}</option>`).join('') + '</select>';
  } else if (field === 'status') {
    editorHtml = `<select id="ife-input" onchange="commitIssueField('status', this.value)">` +
      TASK_STATUSES.map(s => `<option value="${s}" ${i.status===s?'selected':''}>${esc(TASK_STATUS_LABELS[s])}</option>`).join('') + '</select>';
  } else if (field === 'priority') {
    editorHtml = `<select id="ife-input" onchange="commitIssueField('priority', this.value)">` +
      TASK_PRIORITIES.map(p => `<option value="${p}" ${i.priority===p?'selected':''}>${esc(TASK_PRIORITY_LABELS[p])}</option>`).join('') + '</select>';
  } else if (field === 'assignee') {
    const opts = '<option value="">Unassigned</option>' + (state.tasks.users||[]).map(u => `<option value="${esc(u.id)}" ${i.assignee_id===u.id?'selected':''}>${esc(u.display_name || u.email)}</option>`).join('');
    editorHtml = `<select id="ife-input" onchange="commitIssueField('assignee_id', this.value)">${opts}</select>`;
  } else if (field === 'start') {
    const v = i.start_at ? String(i.start_at).slice(0,10) : '';
    editorHtml = `<input id="ife-input" type="date" value="${esc(v)}" onchange="commitIssueField('start_at', this.value)">`;
  } else if (field === 'due') {
    const v = i.due_at ? String(i.due_at).slice(0,10) : '';
    editorHtml = `<input id="ife-input" type="date" value="${esc(v)}" onchange="commitIssueField('due_at', this.value)">`;
  }
  valEl.innerHTML = editorHtml;
  setTimeout(() => { const el = document.getElementById('ife-input'); if (el) el.focus(); }, 10);
}
window.editIssueField = editIssueField;

let fieldCommitting = false;
async function commitIssueField(field, value) {
  if (fieldCommitting) return;
  fieldCommitting = true;
  try {
    const body = {};
    const actualField = field;
    if (field === 'assignee_id') body.assignee_id = value || null;
    else if (field === 'due_at') body.due_at = value ? new Date(value + 'T00:00:00Z').toISOString() : null;
    else if (field === 'start_at') body.start_at = value ? new Date(value + 'T00:00:00Z').toISOString() : null;
    else body[field] = value;
    const r = await api('PATCH', `/api/issues/${encodeURIComponent(currentIssue.id)}`, body);
    if (r && (r.ok || r.issue || r.id)) {
      // Update local issue state without re-rendering the entire modal.
      // This prevents the "jumpy" re-render when picking a value.
      if (r.issue) {
        currentIssue = r.issue;
        if (r.activity) currentIssueActivity = r.activity;
      } else {
        // Patch the local object
        if (actualField === 'assignee_id') {
          currentIssue.assignee_id = value || null;
          const u = (state.tasks.users || []).find(u => u.id === value);
          currentIssue.assignee = u ? { id: u.id, display_name: u.display_name, email: u.email } : null;
        } else if (actualField === 'due_at') {
          currentIssue.due_at = body.due_at;
        } else {
          currentIssue[actualField] = value;
        }
      }
      // Re-render just the metadata sidebar + activity feed, not the whole modal.
      const metaGrid = document.getElementById('issue-meta-grid');
      if (metaGrid) {
        const canWrite = tasksCanWrite();
        const a = currentIssue.assignee;
        const reporter = currentIssue.reporter;
        const assigneeName = a ? (a.display_name || a.email) : 'Unassigned';
        const reporterName = reporter ? (reporter.display_name || reporter.email) : '—';
        const dueVal = currentIssue.due_at ? String(currentIssue.due_at).slice(0,10) : '';
        metaGrid.innerHTML = `
          ${renderIssueMetaRow('type', 'Type', `<span>${ISSUE_TYPE_ICONS[currentIssue.type] || ''}${esc(TASK_TYPE_LABELS[currentIssue.type] || currentIssue.type)}</span>`, canWrite)}
          ${renderIssueMetaRow('status', 'Status', `<span class="lozenge lozenge-status-${esc(currentIssue.status)}">${esc(TASK_STATUS_LABELS[currentIssue.status] || currentIssue.status)}</span>`, canWrite)}
          ${renderIssueMetaRow('priority', 'Priority', `<span class="lozenge lozenge-priority-${esc(currentIssue.priority)}">${esc(TASK_PRIORITY_LABELS[currentIssue.priority] || currentIssue.priority)}</span>`, canWrite)}
          ${renderIssueMetaRow('assignee', 'Assignee', a ? esc(assigneeName) : '<span class="text-muted">Unassigned</span>', canWrite)}
          <div class="kv-row"><div class="kv-k">Reporter</div><div class="kv-v">${esc(reporterName)}</div></div>
          ${renderIssueMetaRow('due', 'Due date', dueVal ? esc(dueVal) : '<span class="text-muted">—</span>', canWrite)}
          <div class="kv-row"><div class="kv-k">Parent</div><div class="kv-v">${currentIssueParent ? `<a href="javascript:void(0)" onclick="openIssueDetail('${esc(currentIssueParent.id)}')"><span class="mono">${esc(currentIssueParent.issue_key)}</span> ${esc(currentIssueParent.title)}</a>` : '<span class="text-muted">—</span>'}</div></div>
          <div class="kv-row"><div class="kv-k">Sub-tasks</div><div class="kv-v">${
            currentIssueSubtasks.length
              ? currentIssueSubtasks.map(s => `<div><a href="javascript:void(0)" onclick="openIssueDetail('${esc(s.id)}')"><span class="mono">${esc(s.issue_key)}</span> ${esc(s.title)}</a> <span class="lozenge lozenge-status-${esc(s.status)}" style="margin-left:6px">${esc(TASK_STATUS_LABELS[s.status] || s.status)}</span></div>`).join('')
              : '<span class="text-muted">None</span>'
          }</div></div>
          <div class="kv-row"><div class="kv-k">Created</div><div class="kv-v text-muted text-sm">${esc(relTime(currentIssue.created_at))}</div></div>
          <div class="kv-row"><div class="kv-k">Updated</div><div class="kv-v text-muted text-sm">${esc(relTime(currentIssue.updated_at))}</div></div>
        `;
      }
      // Refresh both comments + system activity if the response has new data
      if (r.activity) {
        currentIssueActivity = r.activity;
        const commentsEl = document.getElementById('issue-comments');
        if (commentsEl) commentsEl.innerHTML = renderCommentsFeed();
        const actEl = document.getElementById('issue-activity');
        if (actEl) actEl.innerHTML = renderSystemActivityFeed();
        setTimeout(collapseOverflowingComments, 0);
      }
      toastSuccess('Updated');
    } else {
      toastError((r && r.error) || 'Failed to update');
    }
  } finally {
    fieldCommitting = false;
  }
}
window.commitIssueField = commitIssueField;

async function submitDeleteIssue() {
  if (!currentIssue) return;
  if (!(await appConfirm(`Delete ${currentIssue.issue_key}? This cannot be undone.`))) return;
  const id = currentIssue.id;
  const r = await api('DELETE', `/api/issues/${encodeURIComponent(id)}`);
  if (r && (r.ok || r.deleted)) {
    closeIssueDetail();
  } else {
    toastError((r && r.error) || 'Failed to delete issue');
  }
}
window.submitDeleteIssue = submitDeleteIssue;

// ── Clone issue ─────────────────────────────────────────────
async function cloneCurrentIssue() {
  if (!currentIssue) return;
  const r = await api('POST', `/api/issues/${encodeURIComponent(currentIssue.id)}/clone`, {});
  if (r && r.issue) {
    toastSuccess(`Cloned as ${r.issue.issue_key}`);
    openIssueDetail(r.issue.id);
  } else {
    toastError((r && r.error) || 'Failed to clone issue');
  }
}
window.cloneCurrentIssue = cloneCurrentIssue;

// ── Dependencies ────────────────────────────────────────────
function openAddDependency(direction) {
  if (!currentIssue) return;
  const title = direction === 'blocked_by' ? 'Add Blocker' : 'Add Dependency (this blocks)';
  const hint = direction === 'blocked_by' ? 'Enter the issue key that blocks this issue:' : 'Enter the issue key that this issue blocks:';
  setModal(`
    <div class="modal-head"><div class="modal-title">${title}</div><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="modal-body">
      <p class="text-muted text-sm">${hint}</p>
      <input id="dep-key-input" type="text" placeholder="e.g. ENG-42" style="width:100%;margin-top:8px">
      <div id="dep-err" class="form-msg form-msg-err" style="display:none;margin-top:8px"></div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost btn-sm" type="button" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary btn-sm" type="button" onclick="submitAddDependency('${direction}')">Add</button>
    </div>
  `);
  setTimeout(() => { const el = document.getElementById('dep-key-input'); if (el) el.focus(); }, 50);
}
window.openAddDependency = openAddDependency;

async function submitAddDependency(direction) {
  const input = document.getElementById('dep-key-input');
  const errEl = document.getElementById('dep-err');
  if (!input || !currentIssue) return;
  const key = input.value.trim().toUpperCase();
  if (!key) { if (errEl) { errEl.textContent = 'Enter an issue key'; errEl.style.display = ''; } return; }
  // Look up the issue by key
  const searchR = await api('GET', `/api/search?q=${encodeURIComponent(key)}`);
  const found = searchR && searchR.results && searchR.results.issues && searchR.results.issues.find(i => i.issue_key === key);
  if (!found) { if (errEl) { errEl.textContent = `Issue "${key}" not found`; errEl.style.display = ''; } return; }
  const body = direction === 'blocked_by'
    ? { blocker_issue_id: found.id, blocked_issue_id: currentIssue.id }
    : { blocker_issue_id: currentIssue.id, blocked_issue_id: found.id };
  const r = await api('POST', `/api/issues/${encodeURIComponent(currentIssue.id)}/dependencies`, body);
  if (r && r.error) { if (errEl) { errEl.textContent = r.error; errEl.style.display = ''; } return; }
  closeModal();
  toastSuccess('Dependency added');
  openIssueDetail(currentIssue.id);
}
window.submitAddDependency = submitAddDependency;

async function removeDep(depId) {
  const r = await api('DELETE', `/api/dependencies/${encodeURIComponent(depId)}`);
  if (r && r.ok) {
    toastSuccess('Dependency removed');
    openIssueDetail(currentIssue.id);
  } else {
    toastError((r && r.error) || 'Failed to remove dependency');
  }
}
window.removeDep = removeDep;

// ── Custom fields (loaded after render) ─────────────────────
async function loadCustomFields() {
  if (!currentIssue) return;
  const projectId = currentIssue.project_id || (state.tasks.project && state.tasks.project.id);
  if (!projectId) return;
  const [defsR, valsR] = await Promise.all([
    api('GET', `/api/projects/${encodeURIComponent(projectId)}/custom-fields`),
    api('GET', `/api/issues/${encodeURIComponent(currentIssue.id)}/custom-values`),
  ]);
  const defs = (defsR && Array.isArray(defsR.field_defs)) ? defsR.field_defs : [];
  const vals = (valsR && Array.isArray(valsR.values)) ? valsR.values : [];
  if (!defs.length) return;
  const valMap = {};
  vals.forEach(v => { valMap[v.field_def_id] = v.value; });
  const el = document.getElementById('issue-custom-fields');
  if (!el) return;
  const canWrite = tasksCanWrite();
  const rows = defs.map(d => {
    const val = valMap[d.id] || '';
    let display = val || '<span class="text-muted">—</span>';
    if (d.field_type === 'checkbox') display = val === 'true' ? 'Yes' : (val === 'false' ? 'No' : '<span class="text-muted">—</span>');
    return `
      <div class="kv-row">
        <div class="kv-k">${esc(d.name)}</div>
        <div class="kv-v" ${canWrite ? `style="cursor:pointer" onclick="editCustomField('${esc(d.id)}','${esc(d.field_type)}',${esc(JSON.stringify(d.options || '[]'))})"` : ''}>
          ${display}
        </div>
      </div>`;
  }).join('');
  el.innerHTML = `
    <div class="issue-section-label" style="margin-top:14px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted2)">Custom Fields</div>
    <div class="kv-grid">${rows}</div>
  `;
}

function editCustomField(fieldId, fieldType, optionsJson) {
  if (!tasksCanWrite() || !currentIssue) return;
  let options = [];
  try { options = typeof optionsJson === 'string' ? JSON.parse(optionsJson) : optionsJson; } catch {}
  const el = event.target.closest('.kv-v');
  if (!el || el.querySelector('#cf-input')) return;
  const currentVal = el.textContent.trim() === '—' ? '' : el.textContent.trim();
  let html = '';
  if (fieldType === 'select') {
    html = `<select id="cf-input" onchange="commitCustomField('${esc(fieldId)}',this.value)"><option value="">—</option>` +
      options.map(o => `<option value="${esc(o)}" ${currentVal===o?'selected':''}>${esc(o)}</option>`).join('') + '</select>';
  } else if (fieldType === 'checkbox') {
    const checked = currentVal === 'Yes';
    html = `<select id="cf-input" onchange="commitCustomField('${esc(fieldId)}',this.value)">
      <option value="">—</option><option value="true" ${checked?'selected':''}>Yes</option><option value="false" ${!checked&&currentVal?'selected':''}>No</option></select>`;
  } else if (fieldType === 'date') {
    html = `<input id="cf-input" type="date" value="${esc(currentVal)}" onchange="commitCustomField('${esc(fieldId)}',this.value)">`;
  } else if (fieldType === 'number') {
    html = `<input id="cf-input" type="number" value="${esc(currentVal)}" onblur="commitCustomField('${esc(fieldId)}',this.value)" style="width:100px">`;
  } else {
    html = `<input id="cf-input" type="text" value="${esc(currentVal)}" onblur="commitCustomField('${esc(fieldId)}',this.value)" style="width:100%">`;
  }
  el.innerHTML = html;
  setTimeout(() => { const inp = document.getElementById('cf-input'); if (inp) inp.focus(); }, 10);
}
window.editCustomField = editCustomField;

async function commitCustomField(fieldId, value) {
  if (!currentIssue) return;
  await api('PUT', `/api/issues/${encodeURIComponent(currentIssue.id)}/custom-values`, {
    values: [{ field_def_id: fieldId, value: value || '' }]
  });
  loadCustomFields();
}
window.commitCustomField = commitCustomField;
