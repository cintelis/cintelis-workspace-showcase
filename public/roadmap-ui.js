// ============================================================
// Cintelis — Roadmap (WBS + Gantt)
// ------------------------------------------------------------
// The chart is brainstorm-board's rooms Gantt — its layout, date
// strip, shading, ember treatment and status colours, unchanged.
// The WBS beside it is lintel's: numbered rows, inline title, date
// and status editing, and phases whose dates are derived and
// read-only. Loaded as a regular <script> after sprints-ui.js, so
// it uses the globals from app.js and tasks-ui.js: state, api(),
// esc(), toastError(), TASK_STATUS_LABELS.
//
// Day resolution, 30px a column. The portal's old chart offered
// day/week/month zoom, but week and month cannot express the two
// things this view exists to show — which weekday a deadline
// lands on, and where the weekends are — so the zoom control is
// gone rather than kept as three views of differing quality.
//
// ONE scroller. The WBS is sticky on the left and the date strip
// sticky on top inside a single scrolling box, rather than two
// panes that drift apart the moment the chart scrolls vertically.
// The horizontal scrollbar is always visible: most of the axis is
// off-screen and an overlay scrollbar that fades hides the only
// clue that there is more timeline.
//
// A PHASE BAR CANNOT BE DRAGGED. It is derived from its children
// (min start, max end), so moving it would either lie about the
// rows beneath it or silently rewrite all of them. Its dates are
// read-only text in the WBS for the same reason: an editable
// field the chart then ignores is a field that lies.
//
// Drag follows lintel's implementation, including the two
// decisions that make it survive contact: listeners live on the
// WINDOW, not the bar, so a fast drag that outruns the pointer
// does not drop the gesture; and the dragged dates live in
// `preview`, outside the issue list, so an abandoned drag needs
// no rollback and a click that lands on a bar is not an edit.
//
// Bars are never grey. Weekend columns are grey, and a grey bar
// disappears into them.
// ============================================================

(function () {
  state.tasks = state.tasks || {};
  if (!state.tasks.roadmapIssues) state.tasks.roadmapIssues = [];
  state.roadmap = state.roadmap || {
    projectId: '',
    bodyEl: null,
    preview: null,   // { id, from, to } while a bar is being dragged
    drag: null,      // { id, mode, originX, from, to }
    leftW: 0,
  };
})();

// ── Geometry: brainstorm's numbers, with the row 4px taller than
//    its 30 so lintel's WBS row (inputs + status pill) fits ────
const RM_COL_W = 30;
const RM_ROW_H = 34;
const RM_MONTH_H = 34;
const RM_DAY_H = 40;
const RM_HEAD_H = RM_MONTH_H + RM_DAY_H;
const RM_BODY_GAP = 8;
const RM_BAR_H = 20;
const RM_BAR_TOP = 7;
const RM_LEFT_W = 500;
const RM_LEFT_MIN = 200;
const RM_LEFT_MAX = 680;
const RM_LEFT_KEY = 'cintelis.roadmap.wbsWidth';
const RM_PAD_DAYS = 3;
const RM_MIN_DAYS = 21;
const RM_DAY_MS = 86400000;

const RM_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const RM_WEEKDAY = ['Su','Mo','Tu','We','Th','Fr','Sa'];

// brainstorm-board's own colours, not a recolour: a bar takes the colour of
// its status, and nothing is grey — a grey bar over grey weekend columns
// disappears into them, which is why "not started" is amber and the dark
// option is slate rather than grey.
const RM_BAR_COLORS = {
  done:        { fill: '#16a34a', ink: '#ffffff' },  // green-600, their "ready"
  in_review:   { fill: '#0284c7', ink: '#ffffff' },  // sky-600, a step on from in progress
  in_progress: { fill: '#0ea5e9', ink: '#ffffff' },  // sky-500
  todo:        { fill: '#fbbf24', ink: '#3f2d05' },  // amber-400, their "not started"
  backlog:     { fill: '#64748b', ink: '#ffffff' },  // slate-500, their "waived"
};
// A rollup takes the phase's own status — ready when every task is done,
// otherwise in progress — at reduced opacity, and carries the phase title.
const RM_PHASE_DONE = '#16a34a';
const RM_PHASE_OPEN = '#0ea5e9';
const RM_LATE_RING = '#dc2626';

// ── Date helpers. Days, not instants: every value below is UTC
//    midnight in ms, and everything stored is an ISO string. ──
function rmStartOfDayUtc(ms) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
function rmParseDay(v) {
  if (!v) return null;
  const t = Date.parse(String(v).slice(0, 10) + 'T00:00:00Z');
  return Number.isNaN(t) ? null : t;
}
function rmIsoDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}
// What goes back to D1. tasks-ui.js writes the same shape.
function rmStoredDate(ms) {
  return new Date(ms).toISOString();
}
function rmIsWeekend(ms) {
  const wd = new Date(ms).getUTCDay();
  return wd === 0 || wd === 6;
}
function rmToday() {
  return rmStartOfDayUtc(Date.now());
}

// A lone due date is a one-day bar rather than nothing: a milestone
// is a common shape and drawing nothing hides the rows being watched.
// Inverted dates are bad data, not a range — fall back to the due date.
function rmItemSpan(issue) {
  const a = rmParseDay(issue.start_at);
  const b = rmParseDay(issue.due_at);
  if (a === null && b === null) return null;
  if (a === null) return { from: b, to: b };
  if (b === null) return { from: a, to: a };
  if (b < a) return { from: b, to: b };
  return { from: a, to: b };
}

// ── Rows: one level of hierarchy via issues.parent_id ────────
function rmBuildRows(issues) {
  const byId = new Map(issues.map(i => [i.id, i]));
  // Creation order, not date order: a WBS is a numbered outline, and 1.2
  // must not become 3.1 because someone pulled a date forward.
  const seq = (i) => (typeof i.issue_number === 'number' ? i.issue_number : Number.MAX_SAFE_INTEGER);
  issues = issues.slice().sort((a, b) => seq(a) - seq(b));
  const tops = issues.filter(i => !i.parent_id || !byId.has(i.parent_id));
  const kidsOf = new Map();
  for (const i of issues) {
    if (!i.parent_id || !byId.has(i.parent_id)) continue;
    // Deeper than one level is out of scope: anything whose parent is
    // itself a child is hung off that child's parent instead.
    let pid = i.parent_id;
    const parent = byId.get(pid);
    if (parent && parent.parent_id && byId.has(parent.parent_id)) pid = parent.parent_id;
    const list = kidsOf.get(pid) || [];
    list.push(i);
    kidsOf.set(pid, list);
  }
  const rows = [];
  tops.forEach((top, ti) => {
    const kids = kidsOf.get(top.id) || [];
    const kidSpans = kids.map(rmItemSpan).filter(Boolean);
    // Derived, never the phase's own dates: a phase whose stored dates
    // disagree with its children draws a bar contradicting the rows beneath it.
    const rolled = kidSpans.length
      ? { from: Math.min.apply(null, kidSpans.map(s => s.from)), to: Math.max.apply(null, kidSpans.map(s => s.to)) }
      : rmItemSpan(top);
    rows.push({
      issue: top,
      id: top.id,
      code: String(ti + 1),
      depth: 0,
      isPhase: kids.length > 0,
      span: rolled,
      undated: rolled === null,
    });
    kids.forEach((kid, ki) => {
      const span = rmItemSpan(kid);
      rows.push({
        issue: kid,
        id: kid.id,
        code: (ti + 1) + '.' + (ki + 1),
        depth: 1,
        isPhase: false,
        span: span,
        undated: span === null,
      });
    });
  });
  return rows;
}

// The span to DRAW for a row: the live drag preview wins, and a phase
// re-rolls from its children so a parent never contradicts the child
// being dragged underneath it.
function rmShownSpan(row, rows) {
  const p = state.roadmap.preview;
  if (!p) return row.span;
  if (p.id === row.id) return { from: p.from, to: p.to };
  if (!row.isPhase) return row.span;
  const kids = rows.filter(r => r.depth === 1 && r.issue.parent_id === row.id);
  const spans = kids.map(k => (p.id === k.id ? { from: p.from, to: p.to } : k.span)).filter(Boolean);
  if (!spans.length) return row.span;
  return { from: Math.min.apply(null, spans.map(s => s.from)), to: Math.max.apply(null, spans.map(s => s.to)) };
}

// ── Axis: a calendar, padded so a drag has somewhere to go, and
//    always containing today ─────────────────────────────────
function rmBuildAxis(rows) {
  const spans = rows.map(r => r.span).filter(Boolean);
  const today = rmToday();
  let lo = spans.length ? Math.min.apply(null, spans.map(s => s.from)) : today;
  let hi = spans.length ? Math.max.apply(null, spans.map(s => s.to)) : today + 13 * RM_DAY_MS;
  lo -= RM_PAD_DAYS * RM_DAY_MS;
  hi += RM_PAD_DAYS * RM_DAY_MS;
  lo = Math.min(lo, today);
  hi = Math.max(hi, today);
  if ((hi - lo) / RM_DAY_MS < RM_MIN_DAYS) hi = lo + RM_MIN_DAYS * RM_DAY_MS;
  const days = [];
  for (let d = lo; d <= hi; d += RM_DAY_MS) days.push(d);
  const months = [];
  for (const d of days) {
    const dt = new Date(d);
    const last = months[months.length - 1];
    if (last && last.label === dt.getUTCMonth() && last.year === dt.getUTCFullYear()) last.span += 1;
    else months.push({ label: dt.getUTCMonth(), year: dt.getUTCFullYear(), span: 1 });
  }
  return { days, months, todayIndex: days.indexOf(today) };
}

function rmLeftWidth() {
  if (state.roadmap.leftW) return state.roadmap.leftW;
  let w = RM_LEFT_W;
  try {
    const saved = Number(localStorage.getItem(RM_LEFT_KEY));
    if (saved >= RM_LEFT_MIN && saved <= RM_LEFT_MAX) w = saved;
  } catch (e) { /* blocked storage: the default width is fine */ }
  state.roadmap.leftW = w;
  return w;
}

// ── Entry points ────────────────────────────────────────────
async function renderRoadmapTab() {
  return renderRoadmapInto(document.getElementById('tasks-tab-body'), state.ui.tasksProjectId);
}
window.renderRoadmapTab = renderRoadmapTab;

async function renderRoadmapInto(body, projectId) {
  if (!body) return;
  state.roadmap.bodyEl = body;
  state.roadmap.projectId = projectId || '';
  if (!projectId) {
    body.innerHTML = '<div class="empty" style="padding:24px"><p>No project selected.</p></div>';
    return;
  }
  body.innerHTML = '<div class="empty" style="padding:24px"><p>Loading roadmap…</p></div>';
  try {
    const res = await api('GET', '/api/projects/' + encodeURIComponent(projectId) + '/roadmap');
    if (!res || !res.issues) {
      body.innerHTML = '<div class="empty" style="padding:24px"><p>' + esc((res && res.error) || 'Failed to load roadmap') + '</p></div>';
      return;
    }
    state.tasks.roadmapIssues = res.issues;
    state.roadmap.hoursFieldId = res.hours_field_id || null;
    rmRender();
    rmScrollToToday(false);
  } catch (err) {
    body.innerHTML = '<div class="empty" style="padding:24px"><p>Error loading roadmap.</p></div>';
  }
}
window.renderRoadmapInto = renderRoadmapInto;

// ── Render ──────────────────────────────────────────────────
function rmRender() {
  const body = state.roadmap.bodyEl;
  if (!body) return;
  const issues = state.tasks.roadmapIssues || [];
  const rows = rmBuildRows(issues);
  const axis = rmBuildAxis(rows);
  const leftW = rmLeftWidth();
  const chartW = axis.days.length * RM_COL_W;
  const scroller = document.getElementById('rm-scroll');
  const keepScroll = scroller ? scroller.scrollLeft : null;

  const hoursOn = !!state.roadmap.hoursFieldId;
  const totals = hoursOn ? rmHoursTotals(rows) : null;
  const legend = ['todo', 'in_progress', 'in_review', 'done', 'backlog'].map(k => `
    <span class="rm-legend-item"><i style="background:${RM_BAR_COLORS[k].fill}"></i>${esc(TASK_STATUS_LABELS[k] || k)}</span>
  `).join('')
    + `<span class="rm-legend-item"><i class="rm-legend-late"></i>Late</span>`
    + `<span class="rm-legend-item"><i style="background:${RM_PHASE_OPEN};opacity:.6"></i>Phase</span>`;

  body.innerHTML = `
    <div class="rm">
      <div class="rm-toolbar">
        <span class="rm-hint">Drag a bar to move it, or an edge to change one end. Phase bars roll up their tasks and cannot be dragged.</span>
        <span class="rm-legend">${legend}</span>
        ${totals ? `<span class="rm-hours-total" title="Sum of the Hours field on tasks (phases roll up their tasks)">Hours: <strong>${rmFmtHours(totals.done)}</strong> done · ${rmFmtHours(totals.all)} total</span>` : ''}
        <button class="btn btn-ghost btn-sm" type="button" onclick="rmScrollToToday(true)">Today</button>
      </div>
      <div class="rm-scroll" id="rm-scroll">
        <div class="rm-canvas" style="width:${leftW + chartW}px">
          <div class="rm-head" style="height:${RM_HEAD_H}px">
            <div class="rm-corner" style="width:${leftW}px;height:${RM_HEAD_H}px">
              <div class="rm-corner-labels"><span>WBS</span><span>Dates${hoursOn ? ' · Hours' : ''}</span></div>
              ${rmSplitterHtml()}
            </div>
            <div class="rm-strip" style="width:${chartW}px">
              ${rmMonthsHtml(axis, leftW)}
              ${rmDaysHtml(axis)}
            </div>
          </div>
          <div class="rm-body" style="padding-top:${RM_BODY_GAP}px">
            <div class="rm-labels" style="width:${leftW}px">
              ${rows.map(r => rmLabelRowHtml(r, rows)).join('') || rmEmptyLabelHtml()}
              ${rmSplitterHtml()}
            </div>
            <div class="rm-chart" style="width:${chartW}px">
              ${rmShadingHtml(axis)}
              ${rows.map(r => rmChartRowHtml(r, rows, axis)).join('')}
            </div>
          </div>
        </div>
      </div>
      ${rows.length ? '' : `
        <div class="rm-empty"><div class="rm-empty-card">
          <p style="font-weight:600;margin:0 0 4px">Nothing scheduled yet</p>
          <p class="text-muted text-sm" style="margin:0">Give this project's issues a start and due date and each becomes a bar you can drag. A sub-task becomes a row under its parent.</p>
        </div></div>`}
    </div>
  `;

  const sc = document.getElementById('rm-scroll');
  if (sc && keepScroll !== null) sc.scrollLeft = keepScroll;
}

function rmSplitterHtml() {
  return '<div class="rm-splitter" role="separator" aria-orientation="vertical" aria-label="Resize the task list" onpointerdown="rmBeginSplit(event)"><i></i></div>';
}

function rmMonthsHtml(axis, leftW) {
  // No overflow:hidden on a month cell — it would become its own scroll
  // container and the sticky label would then stick to IT, not the axis.
  return `<div class="rm-months" style="height:${RM_MONTH_H}px">` + axis.months.map(m => `
    <div class="rm-month" style="width:${m.span * RM_COL_W}px;line-height:${RM_MONTH_H}px">
      <span style="left:${leftW}px">${m.span >= 4 ? esc(RM_MONTHS[m.label] + ' ' + m.year) : m.span >= 2 ? esc(RM_MONTHS[m.label]) : ''}</span>
    </div>
  `).join('') + '</div>';
}

function rmDaysHtml(axis) {
  return `<div class="rm-days" style="height:${RM_DAY_H}px">` + axis.days.map((d, i) => {
    const today = i === axis.todayIndex;
    const cls = 'rm-day' + (today ? ' is-today' : rmIsWeekend(d) ? ' is-weekend' : '');
    return `<div class="${cls}" style="width:${RM_COL_W}px">
      <span class="rm-day-num">${new Date(d).getUTCDate()}</span>
      <span class="rm-day-wd">${RM_WEEKDAY[new Date(d).getUTCDay()]}</span>
    </div>`;
  }).join('') + '</div>';
}

// Drawn once for the full height, not per row, so the grid still reads
// as a calendar when there are few rows.
function rmShadingHtml(axis) {
  let html = '<div class="rm-shade">';
  axis.days.forEach((d, i) => {
    if (i === axis.todayIndex) html += `<span class="rm-shade-today" style="left:${i * RM_COL_W}px;width:${RM_COL_W}px"></span>`;
    else if (rmIsWeekend(d)) html += `<span class="rm-shade-weekend" style="left:${i * RM_COL_W}px;width:${RM_COL_W}px"></span>`;
  });
  if (axis.todayIndex >= 0) {
    html += `<span class="rm-today-line" style="left:${axis.todayIndex * RM_COL_W + RM_COL_W / 2}px"></span>`;
  }
  return html + '</div>';
}

function rmLabelRowHtml(row, rows) {
  const span = rmShownSpan(row, rows);
  const i = row.issue;
  const dates = row.isPhase
    ? `<span class="rm-dates rm-dates-derived" title="Rolled up from this phase's tasks">${span ? esc(rmIsoDay(span.from)) + ' → ' + esc(rmIsoDay(span.to)) : '—'}</span>`
    : `<span class="rm-dates">
         <input type="date" value="${span ? esc(rmIsoDay(span.from)) : ''}" aria-label="Start date" onchange="rmSaveDate('${esc(row.id)}','start_at',this.value)">
         <input type="date" value="${span ? esc(rmIsoDay(span.to)) : ''}" aria-label="Due date" onchange="rmSaveDate('${esc(row.id)}','due_at',this.value)">
       </span>`;
  return `
    <div class="rm-row rm-label-row${row.depth ? ' is-child' : ''}${row.isPhase ? ' is-phase' : ''}" style="height:${RM_ROW_H}px" data-id="${esc(row.id)}">
      <span class="rm-code">${esc(row.code)}</span>
      <input class="rm-title" value="${esc(i.title || '')}" spellcheck="false" aria-label="Title" title="${esc(i.issue_key || '')} ${esc(i.title || '')}"
             onblur="rmSaveTitle('${esc(row.id)}', this)">
      ${dates}
      ${rmHoursCellHtml(row, rows)}
      <button class="rm-status" type="button" data-status="${esc(i.status || 'todo')}"
              title="Click to advance the status" onclick="rmCycleStatus('${esc(row.id)}')">${esc(TASK_STATUS_LABELS[i.status] || i.status || 'To Do')}</button>
      ${row.undated ? '<span class="rm-undated">no dates</span>' : ''}
    </div>`;
}

// ── Hours column (the project's "Hours" number field) ───────────
// A task's hours are typed straight into the row; a phase shows the sum
// of its tasks and, like its dates, cannot be edited directly.
function rmHoursOf(issue) {
  const n = parseFloat(issue && issue.hours);
  return Number.isFinite(n) ? n : 0;
}
function rmPhaseHours(row, rows) {
  return rows.filter(r => r.depth === 1 && r.issue.parent_id === row.id).reduce((s, r) => s + rmHoursOf(r.issue), 0);
}
function rmHoursTotals(rows) {
  let all = 0, done = 0;
  for (const r of rows) {
    if (r.isPhase) continue;
    const h = rmHoursOf(r.issue);
    all += h;
    if (r.issue.status === 'done') done += h;
  }
  return { all, done };
}
function rmFmtHours(n) {
  return (Math.round(n * 10) / 10).toString().replace(/\.0$/, '') + ' h';
}
function rmHoursCellHtml(row, rows) {
  if (!state.roadmap.hoursFieldId) return '';
  if (row.isPhase) {
    const h = rmPhaseHours(row, rows);
    return `<span class="rm-hours rm-hours-derived" title="Rolled up from this phase's tasks">${h ? esc(rmFmtHours(h)) : '—'}</span>`;
  }
  const v = row.issue.hours == null || row.issue.hours === '' ? '' : String(row.issue.hours);
  return `<span class="rm-hours"><input type="number" min="0" step="0.5" value="${esc(v)}" placeholder="h" aria-label="Hours" title="Hours spent" onchange="rmSaveHours('${esc(row.id)}', this.value)"></span>`;
}
async function rmSaveHours(id, value) {
  const fieldId = state.roadmap.hoursFieldId;
  const issue = (state.tasks.roadmapIssues || []).find(i => i.id === id);
  if (!fieldId || !issue) return;
  const clean = value === '' ? '' : String(Math.max(0, parseFloat(value) || 0));
  issue.hours = clean;
  rmRender();
  const r = await api('PUT', '/api/issues/' + encodeURIComponent(id) + '/custom-values', { values: [{ field_def_id: fieldId, value: clean }] });
  if (!r || r.error) {
    toastError((r && r.error) || 'Could not save the hours');
    await renderRoadmapInto(state.roadmap.bodyEl, state.roadmap.projectId);
  }
}
window.rmSaveHours = rmSaveHours;

// Lintel's WBS cycles the status from the row rather than opening the issue.
const RM_STATUS_CYCLE = ['backlog', 'todo', 'in_progress', 'in_review', 'done'];
async function rmCycleStatus(id) {
  const issue = (state.tasks.roadmapIssues || []).find(i => i.id === id);
  if (!issue) return;
  const next = RM_STATUS_CYCLE[(RM_STATUS_CYCLE.indexOf(issue.status) + 1) % RM_STATUS_CYCLE.length];
  issue.status = next;
  rmRender();
  const r = await api('PATCH', '/api/issues/' + encodeURIComponent(id), { status: next });
  if (!r || r.error) {
    toastError((r && r.error) || 'Could not save the status');
    await renderRoadmapInto(state.roadmap.bodyEl, state.roadmap.projectId);
  }
}
window.rmCycleStatus = rmCycleStatus;

function rmEmptyLabelHtml() {
  return `<div class="rm-row rm-label-row" style="height:${RM_ROW_H}px"></div>`;
}

function rmChartRowHtml(row, rows, axis) {
  const span = rmShownSpan(row, rows);
  const rowCls = 'rm-row rm-chart-row' + (row.isPhase ? ' is-phase-row' : '');
  if (!span) return `<div class="${rowCls}" style="height:${RM_ROW_H}px"></div>`;
  const origin = axis.days[0];
  const left = ((span.from - origin) / RM_DAY_MS) * RM_COL_W;
  // +1 because both ends are inclusive: a one-day task is one column wide.
  const w = Math.max(RM_COL_W, ((span.to - span.from) / RM_DAY_MS + 1) * RM_COL_W);
  const colour = row.isPhase
    ? `background:${rmPhaseFill(row, rows)};opacity:.6`
    : (() => { const c = RM_BAR_COLORS[row.issue.status] || RM_BAR_COLORS.todo; return `background:${c.fill};color:${c.ink}`; })();
  // A late line keeps its status colour and gains a red outline on top of it.
  const late = rmIsLate(row, span);
  const ring = late ? `box-shadow:inset 0 0 0 2px ${RM_LATE_RING};` : '';
  const grips = row.isPhase ? '' : `
    <span class="rm-grip rm-grip-l" onpointerdown="rmBeginDrag(event,'${esc(row.id)}','start')"></span>
    <span class="rm-grip rm-grip-r" onpointerdown="rmBeginDrag(event,'${esc(row.id)}','end')"></span>`;
  const title = row.isPhase
    ? `${esc(row.issue.title || '')} (rolled up from its tasks)`
    : `${esc(row.issue.title || '')}: ${esc(rmIsoDay(span.from))} → ${esc(rmIsoDay(span.to))} — drag to reschedule`;
  const label = row.isPhase && w >= RM_COL_W * 3
    ? `<span class="rm-bar-label" style="left:${rmLeftWidth()}px">${esc(row.issue.title || '')}</span>`
    : '';
  // The due date rides just past the end of a task bar, the way a deal
  // checklist reads: the date you are being held to, next to the thing.
  const due = new Date(span.to);
  const dueLabel = row.isPhase ? '' : `
    <span class="rm-due${late ? ' is-late' : ''}" style="left:${left + w}px;top:${RM_BAR_TOP}px;height:${RM_BAR_H}px">
      ${late ? 'due ' : ''}${due.getUTCDate()} ${RM_MONTHS[due.getUTCMonth()]}
    </span>`;
  return `
    <div class="${rowCls}" style="height:${RM_ROW_H}px">
      <span class="rm-bar${row.isPhase ? ' is-phase' : ''}" data-id="${esc(row.id)}" title="${title}"
            style="left:${left}px;width:${w}px;top:${RM_BAR_TOP}px;height:${RM_BAR_H}px;${colour};${ring}"
            ${row.isPhase ? '' : `onpointerdown="rmBeginDrag(event,'${esc(row.id)}','move')"`}>
        ${label}${grips}
      </span>${dueLabel}
    </div>`;
}

// Ready when every task under it is done, otherwise in progress.
function rmPhaseFill(row, rows) {
  const kids = rows.filter(r => r.depth === 1 && r.issue.parent_id === row.id);
  return kids.length && kids.every(k => k.issue.status === 'done') ? RM_PHASE_DONE : RM_PHASE_OPEN;
}

function rmIsLate(row, span) {
  if (row.isPhase || !span) return false;
  return row.issue.status !== 'done' && span.to < rmToday();
}

// ── Drag: move the whole bar, or either edge ────────────────
function rmRowById(id) {
  const rows = rmBuildRows(state.tasks.roadmapIssues || []);
  return rows.find(r => r.id === id) || null;
}

function rmBeginDrag(ev, id, mode) {
  if (mode !== 'move') ev.stopPropagation();
  const row = rmRowById(id);
  if (!row || row.isPhase || row.undated) return;
  if (state.me && state.me.role === 'viewer') return;
  ev.preventDefault();
  state.roadmap.drag = { id, mode, originX: ev.clientX, from: row.span.from, to: row.span.to };
  state.roadmap.preview = { id, from: row.span.from, to: row.span.to };
  document.body.classList.add('rm-dragging');
  // On the window, not the bar: a fast drag that outruns the pointer
  // must not drop the gesture.
  window.addEventListener('pointermove', rmOnDragMove);
  window.addEventListener('pointerup', rmOnDragUp);
  window.addEventListener('pointercancel', rmOnDragCancel);
  window.addEventListener('keydown', rmOnDragKey);
}
window.rmBeginDrag = rmBeginDrag;

function rmOnDragMove(ev) {
  const d = state.roadmap.drag;
  if (!d) return;
  const rows = rmBuildRows(state.tasks.roadmapIssues || []);
  const axis = rmBuildAxis(rows);
  // Whole days. A Gantt that reports a half day reports a precision the
  // date column does not have.
  const shift = Math.round((ev.clientX - d.originX) / RM_COL_W) * RM_DAY_MS;
  let from = d.from;
  let to = d.to;
  if (d.mode === 'move') { from = d.from + shift; to = d.to + shift; }
  else if (d.mode === 'start') { from = Math.min(d.from + shift, d.to); }
  else { to = Math.max(d.to + shift, d.from); }
  // Clamped to the axis: a date with no column to draw it in would make
  // the bar vanish mid-gesture.
  if (from < axis.days[0] || to > axis.days[axis.days.length - 1]) return;
  state.roadmap.preview = { id: d.id, from, to };
  rmRender();
}

function rmEndDragListeners() {
  window.removeEventListener('pointermove', rmOnDragMove);
  window.removeEventListener('pointerup', rmOnDragUp);
  window.removeEventListener('pointercancel', rmOnDragCancel);
  window.removeEventListener('keydown', rmOnDragKey);
  document.body.classList.remove('rm-dragging');
}

// Escape abandons the gesture. Dropping the preview is the undo.
function rmOnDragKey(ev) {
  if (ev.key !== 'Escape') return;
  state.roadmap.drag = null;
  state.roadmap.preview = null;
  rmEndDragListeners();
  rmRender();
}

function rmOnDragCancel() {
  state.roadmap.drag = null;
  state.roadmap.preview = null;
  rmEndDragListeners();
  rmRender();
}

// One write, on release. A click that lands on a bar changes nothing,
// so it sends nothing.
async function rmOnDragUp() {
  const d = state.roadmap.drag;
  const p = state.roadmap.preview;
  state.roadmap.drag = null;
  rmEndDragListeners();
  if (!d || !p) { state.roadmap.preview = null; rmRender(); return; }
  const body = {};
  if (p.from !== d.from) body.start_at = rmStoredDate(p.from);
  if (p.to !== d.to) body.due_at = rmStoredDate(p.to);
  if (!Object.keys(body).length) { state.roadmap.preview = null; rmRender(); return; }
  // Optimistic: the preview stays where the bar was dropped until the save
  // settles, so the bar never snaps back while the request is in flight.
  const issue = (state.tasks.roadmapIssues || []).find(i => i.id === d.id);
  if (issue) Object.assign(issue, body);
  state.roadmap.preview = null;
  rmRender();
  const r = await api('PATCH', '/api/issues/' + encodeURIComponent(d.id), body);
  if (!r || r.error) {
    toastError((r && r.error) || 'Could not save the new dates');
    await renderRoadmapInto(state.roadmap.bodyEl, state.roadmap.projectId);
  }
}

// ── Inline editing in the WBS ───────────────────────────────
async function rmSaveTitle(id, input) {
  const issue = (state.tasks.roadmapIssues || []).find(i => i.id === id);
  if (!issue) return;
  const v = String(input.value || '').trim();
  if (!v || v === issue.title) { input.value = issue.title || ''; return; }
  issue.title = v;
  const r = await api('PATCH', '/api/issues/' + encodeURIComponent(id), { title: v });
  if (!r || r.error) {
    toastError((r && r.error) || 'Could not save the title');
    await renderRoadmapInto(state.roadmap.bodyEl, state.roadmap.projectId);
  }
}
window.rmSaveTitle = rmSaveTitle;

async function rmSaveDate(id, field, value) {
  const issue = (state.tasks.roadmapIssues || []).find(i => i.id === id);
  if (!issue) return;
  const ms = rmParseDay(value);
  const body = {};
  body[field] = ms === null ? null : rmStoredDate(ms);
  Object.assign(issue, body);
  rmRender();
  const r = await api('PATCH', '/api/issues/' + encodeURIComponent(id), body);
  if (!r || r.error) {
    toastError((r && r.error) || 'Could not save the date');
    await renderRoadmapInto(state.roadmap.bodyEl, state.roadmap.projectId);
  }
}
window.rmSaveDate = rmSaveDate;

// ── Splitter: the pane border as a drag handle ──────────────
function rmBeginSplit(ev) {
  ev.preventDefault();
  const originX = ev.clientX;
  const start = rmLeftWidth();
  const clamp = (x) => Math.min(RM_LEFT_MAX, Math.max(RM_LEFT_MIN, x));
  document.body.classList.add('rm-splitting');
  const onMove = (e) => {
    state.roadmap.leftW = clamp(start + (e.clientX - originX));
    rmRender();
  };
  const onUp = (e) => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    document.body.classList.remove('rm-splitting');
    const w = clamp(start + (e.clientX - originX));
    state.roadmap.leftW = w;
    try { localStorage.setItem(RM_LEFT_KEY, String(w)); } catch (err) { /* not persisted; still applied */ }
    rmRender();
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}
window.rmBeginSplit = rmBeginSplit;

// ── Today ───────────────────────────────────────────────────
function rmScrollToToday(smooth) {
  const el = document.getElementById('rm-scroll');
  if (!el) return;
  const rows = rmBuildRows(state.tasks.roadmapIssues || []);
  const axis = rmBuildAxis(rows);
  if (axis.todayIndex < 0) return;
  const axisWidth = el.clientWidth - rmLeftWidth();
  const left = Math.max(0, axis.todayIndex * RM_COL_W - axisWidth / 2);
  if (smooth) el.scrollTo({ left, behavior: 'smooth' });
  else el.scrollLeft = left;
}
window.rmScrollToToday = rmScrollToToday;
