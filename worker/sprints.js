// ============================================================
// Cintelis Workspace — Sprints (Sprint 3)
// Sprint CRUD + start/complete transitions, issue↔sprint moves,
// and server-side burndown computation. All handlers return Response.
// Self-contained: no imports from worker.js (circular). Role gating
// is enforced in worker.js's route() before these are called.
// ============================================================

import { emit, EVENT_TYPES } from './events.js';

// ── Local helpers (mirror worker/tasks.js) ───────────────────
function jres(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
function now() { return new Date().toISOString(); }
function uid() { return crypto.randomUUID(); }
function sprintId() { return `spr_${uid().replace(/-/g, '').slice(0, 24)}`; }
function activityId() { return `act_${uid().replace(/-/g, '').slice(0, 24)}`; }

const DAY_MS = 24 * 60 * 60 * 1000;

// Insert a system/comment row into the polymorphic activity table.
async function insertActivity(env, { entityType, entityId, userId, kind, body }) {
  const id = activityId();
  const ts = now();
  await env.DB.prepare(
    `INSERT INTO activity (id, entity_type, entity_id, user_id, kind, body_md, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, entityType, entityId, userId || null, kind, body || '', ts).run();
  return { id, entity_type: entityType, entity_id: entityId, user_id: userId || null, kind, body_md: body || '', created_at: ts };
}

// Batched sprint lookup → { id: {id, name, state} }
async function joinSprintsByIds(env, ids) {
  const unique = Array.from(new Set((ids || []).filter(Boolean)));
  if (!unique.length) return {};
  const placeholders = unique.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `SELECT id, name, state FROM sprints WHERE id IN (${placeholders})`
  ).bind(...unique).all();
  const map = {};
  for (const r of (results || [])) {
    map[r.id] = { id: r.id, name: r.name || '', state: r.state || 'planned' };
  }
  return map;
}

// Days remaining helper (nullable planned_end_at → null)
function daysRemainingFrom(plannedEndAt) {
  if (!plannedEndAt) return null;
  const target = Date.parse(plannedEndAt);
  if (isNaN(target)) return null;
  return Math.max(0, Math.ceil((target - Date.now()) / DAY_MS));
}

// Assert that no other sprint in the project is already active.
// Returns the conflicting sprint row or null.
async function findActiveSprint(env, projectId, excludeId) {
  const row = await env.DB.prepare(
    `SELECT id, name FROM sprints WHERE project_id=? AND state='active' AND id <> ? LIMIT 1`
  ).bind(projectId, excludeId || '').first();
  return row || null;
}

// ── List ─────────────────────────────────────────────────────
export async function listProjectSprints(env, projectId) {
  const { results: sprints } = await env.DB.prepare(
    `SELECT * FROM sprints
     WHERE project_id = ?
     ORDER BY CASE state WHEN 'active' THEN 0 WHEN 'planned' THEN 1 ELSE 2 END,
              created_at ASC`
  ).bind(projectId).all();

  // Batched counts by sprint_id for this project
  const { results: counts } = await env.DB.prepare(
    `SELECT sprint_id, status, COUNT(*) AS n
     FROM issues
     WHERE active = 1 AND project_id = ? AND sprint_id IS NOT NULL
     GROUP BY sprint_id, status`
  ).bind(projectId).all();

  const countsBySprint = {};
  for (const row of (counts || [])) {
    if (!countsBySprint[row.sprint_id]) countsBySprint[row.sprint_id] = { total: 0, done: 0 };
    countsBySprint[row.sprint_id].total += row.n;
    if (row.status === 'done') countsBySprint[row.sprint_id].done += row.n;
  }

  const out = (sprints || []).map(s => {
    const c = countsBySprint[s.id] || { total: 0, done: 0 };
    const row = { ...s };
    row.issue_count = c.total;
    row.done_count = c.done;
    row.days_remaining = s.state === 'active' ? daysRemainingFrom(s.planned_end_at) : null;
    return row;
  });
  return jres({ sprints: out });
}

// ── Create ───────────────────────────────────────────────────
export async function createSprint(req, env, ctx, projectId) {
  const body = await req.json().catch(() => ({}));
  const name = String(body.name || '').trim();
  if (!name) return jres({ error: 'name required' }, 400);
  const goal = String(body.goal || '');
  const plannedEndAt = body.planned_end_at || null;

  const proj = await scopedFirst(env, ctx, { sql: 'SELECT p.id FROM projects p WHERE p.id=? AND p.active=1 AND /*SCOPE*/', binds: [projectId], alias: 'p' });
  if (!proj) return jres({ error: 'Project not found' }, 404);

  const id = sprintId();
  const ts = now();
  await env.DB.prepare(
    `INSERT INTO sprints (id, project_id, name, goal, state, start_at, end_at, planned_end_at, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'planned', NULL, NULL, ?, ?, ?, ?)`
  ).bind(id, projectId, name, goal, plannedEndAt, ctx.user.id, ts, ts).run();

  await insertActivity(env, {
    entityType: 'sprint', entityId: id, userId: ctx.user.id, kind: 'system',
    body: `Sprint created: ${name}`,
  });

  const row = {
    id, project_id: projectId, name, goal,
    state: 'planned', start_at: null, end_at: null,
    planned_end_at: plannedEndAt,
    created_by: ctx.user.id, created_at: ts, updated_at: ts,
    issue_count: 0, done_count: 0, days_remaining: null,
  };
  return jres(row);
}

// ── Get (detail + issues grouped by status) ──────────────────
export async function getSprint(env, sprId) {
  const sprint = await env.DB.prepare('SELECT * FROM sprints WHERE id=?').bind(sprId).first();
  if (!sprint) return jres({ error: 'Sprint not found' }, 404);

  const { results: issues } = await env.DB.prepare(
    `SELECT i.*,
            a.display_name AS assignee_display_name, a.email AS assignee_email,
            r.display_name AS reporter_display_name, r.email AS reporter_email
     FROM issues i
     LEFT JOIN users a ON a.id = i.assignee_id
     LEFT JOIN users r ON r.id = i.reporter_id
     WHERE i.sprint_id = ? AND i.active = 1
     ORDER BY i.updated_at DESC`
  ).bind(sprId).all();

  const issues_by_status = { backlog: [], todo: [], in_progress: [], in_review: [], done: [] };
  let doneCount = 0;
  for (const r of (issues || [])) {
    const out = { ...r };
    out.assignee = r.assignee_id
      ? { id: r.assignee_id, display_name: r.assignee_display_name || '', email: r.assignee_email || '' }
      : null;
    out.reporter = r.reporter_id
      ? { id: r.reporter_id, display_name: r.reporter_display_name || '', email: r.reporter_email || '' }
      : null;
    delete out.assignee_display_name;
    delete out.assignee_email;
    delete out.reporter_display_name;
    delete out.reporter_email;
    const key = issues_by_status[out.status] ? out.status : 'todo';
    issues_by_status[key].push(out);
    if (out.status === 'done') doneCount += 1;
  }

  const sprintOut = { ...sprint };
  sprintOut.issue_count = (issues || []).length;
  sprintOut.done_count = doneCount;
  sprintOut.days_remaining = sprint.state === 'active' ? daysRemainingFrom(sprint.planned_end_at) : null;

  return jres({
    sprint: sprintOut,
    issues_by_status,
    total_issues: (issues || []).length,
    done_count: doneCount,
  });
}

// ── Patch (name / goal / planned_end_at only) ────────────────
export async function patchSprint(req, env, sprId) {
  const body = await req.json().catch(() => ({}));
  const existing = await env.DB.prepare('SELECT * FROM sprints WHERE id=?').bind(sprId).first();
  if (!existing) return jres({ error: 'Sprint not found' }, 404);

  const fields = [];
  const params = [];
  if (typeof body.name === 'string') {
    const name = body.name.trim();
    if (!name) return jres({ error: 'name cannot be empty' }, 400);
    if (name !== existing.name) { fields.push('name=?'); params.push(name); }
  }
  if (typeof body.goal === 'string' && body.goal !== existing.goal) {
    fields.push('goal=?'); params.push(body.goal);
  }
  if ('planned_end_at' in body) {
    const v = body.planned_end_at || null;
    if (v !== existing.planned_end_at) { fields.push('planned_end_at=?'); params.push(v); }
  }

  if (!fields.length) return jres({ ok: true, unchanged: true });
  const ts = now();
  fields.push('updated_at=?'); params.push(ts);
  params.push(sprId);
  await env.DB.prepare(`UPDATE sprints SET ${fields.join(', ')} WHERE id=?`).bind(...params).run();
  return jres({ ok: true, updated_at: ts });
}

// ── Delete (planned + empty only) ────────────────────────────
export async function deleteSprint(env, sprId) {
  const existing = await env.DB.prepare('SELECT id, state FROM sprints WHERE id=?').bind(sprId).first();
  if (!existing) return jres({ error: 'Sprint not found' }, 404);
  if (existing.state !== 'planned') {
    return jres({ error: 'Only planned sprints can be deleted' }, 400);
  }
  const hasIssues = await env.DB.prepare(
    'SELECT 1 AS x FROM issues WHERE sprint_id=? LIMIT 1'
  ).bind(sprId).first();
  if (hasIssues) {
    return jres({ error: 'Cannot delete a sprint that still contains issues' }, 400);
  }
  await env.DB.prepare("DELETE FROM activity WHERE entity_type='sprint' AND entity_id=?").bind(sprId).run();
  await env.DB.prepare('DELETE FROM sprints WHERE id=?').bind(sprId).run();
  return jres({ ok: true });
}

// ── Start (planned → active) ─────────────────────────────────
export async function startSprint(env, ctx, sprId) {
  const sprint = await env.DB.prepare('SELECT * FROM sprints WHERE id=?').bind(sprId).first();
  if (!sprint) return jres({ error: 'Sprint not found' }, 404);
  if (sprint.state !== 'planned') {
    return jres({ error: `Cannot start a sprint in state '${sprint.state}'` }, 400);
  }
  const conflict = await findActiveSprint(env, sprint.project_id, sprId);
  if (conflict) {
    return jres({ error: 'Another sprint is already active in this project' }, 409);
  }
  const ts = now();
  await env.DB.prepare(
    "UPDATE sprints SET state='active', start_at=?, updated_at=? WHERE id=?"
  ).bind(ts, ts, sprId).run();

  await insertActivity(env, {
    entityType: 'sprint', entityId: sprId, userId: ctx.user.id, kind: 'system',
    body: 'Sprint started',
  });
  await emit(env, EVENT_TYPES.SPRINT_STARTED, {
    sprint: { ...sprint, state: 'active', start_at: ts, updated_at: ts },
    actor: ctx.user,
  });
  return getSprint(env, sprId);
}

// ── Complete (active → completed) ────────────────────────────
export async function completeSprint(req, env, ctx, sprId) {
  const body = await req.json().catch(() => ({}));
  const action = body.incomplete_action === 'next_sprint' ? 'next_sprint' : 'backlog';
  const nextSprintId = body.next_sprint_id || null;

  const sprint = await env.DB.prepare('SELECT * FROM sprints WHERE id=?').bind(sprId).first();
  if (!sprint) return jres({ error: 'Sprint not found' }, 404);
  if (sprint.state !== 'active') {
    return jres({ error: `Cannot complete a sprint in state '${sprint.state}'` }, 400);
  }

  const { results: incomplete } = await env.DB.prepare(
    "SELECT id FROM issues WHERE sprint_id=? AND active=1 AND status<>'done'"
  ).bind(sprId).all();
  const incompleteIds = (incomplete || []).map(r => r.id);

  let nextSprint = null;
  if (action === 'next_sprint') {
    if (!nextSprintId) return jres({ error: 'next_sprint_id required when incomplete_action=next_sprint' }, 400);
    nextSprint = await env.DB.prepare(
      "SELECT id, name, project_id, state FROM sprints WHERE id=?"
    ).bind(nextSprintId).first();
    if (!nextSprint || nextSprint.project_id !== sprint.project_id || nextSprint.state !== 'planned') {
      return jres({ error: 'next_sprint_id invalid (must be a planned sprint in the same project)' }, 400);
    }
  }

  // Move incomplete issues
  if (incompleteIds.length) {
    const placeholders = incompleteIds.map(() => '?').join(',');
    if (action === 'next_sprint') {
      await env.DB.prepare(
        `UPDATE issues SET sprint_id=?, updated_at=? WHERE id IN (${placeholders})`
      ).bind(nextSprint.id, now(), ...incompleteIds).run();
      for (const iid of incompleteIds) {
        await insertActivity(env, {
          entityType: 'issue', entityId: iid, userId: ctx.user.id, kind: 'system',
          body: `Moved to sprint ${nextSprint.name} on completion of ${sprint.name}`,
        });
      }
    } else {
      await env.DB.prepare(
        `UPDATE issues SET sprint_id=NULL, updated_at=? WHERE id IN (${placeholders})`
      ).bind(now(), ...incompleteIds).run();
      for (const iid of incompleteIds) {
        await insertActivity(env, {
          entityType: 'issue', entityId: iid, userId: ctx.user.id, kind: 'system',
          body: `Returned to backlog on completion of ${sprint.name}`,
        });
      }
    }
  }

  const ts = now();
  await env.DB.prepare(
    "UPDATE sprints SET state='completed', end_at=?, updated_at=? WHERE id=?"
  ).bind(ts, ts, sprId).run();

  const destLabel = action === 'next_sprint' ? `next sprint (${nextSprint.name})` : 'backlog';
  await insertActivity(env, {
    entityType: 'sprint', entityId: sprId, userId: ctx.user.id, kind: 'system',
    body: `Sprint completed. ${incompleteIds.length} issue(s) moved to ${destLabel}.`,
  });

  await emit(env, EVENT_TYPES.SPRINT_COMPLETED, {
    sprint: { ...sprint, state: 'completed', end_at: ts, updated_at: ts },
    completed_at: ts,
    moved_count: incompleteIds.length,
    action,
    actor: ctx.user,
  });

  return getSprint(env, sprId);
}

// ── Add issues to sprint ─────────────────────────────────────
export async function addIssuesToSprint(req, env, ctx, sprId) {
  const body = await req.json().catch(() => ({}));
  const ids = Array.isArray(body.issue_ids) ? body.issue_ids.filter(Boolean) : [];
  if (!ids.length) return jres({ error: 'issue_ids required' }, 400);

  const sprint = await env.DB.prepare('SELECT * FROM sprints WHERE id=?').bind(sprId).first();
  if (!sprint) return jres({ error: 'Sprint not found' }, 404);
  if (sprint.state !== 'planned' && sprint.state !== 'active') {
    return jres({ error: `Cannot add issues to a ${sprint.state} sprint` }, 400);
  }

  const placeholders = ids.map(() => '?').join(',');
  const { results: issueRows } = await env.DB.prepare(
    `SELECT id, sprint_id, project_id FROM issues
     WHERE id IN (${placeholders}) AND active = 1`
  ).bind(...ids).all();

  if ((issueRows || []).length !== ids.length) {
    return jres({ error: 'One or more issues not found or inactive' }, 400);
  }
  for (const r of issueRows) {
    if (r.project_id !== sprint.project_id) {
      return jres({ error: 'All issues must belong to the same project as the sprint' }, 400);
    }
  }

  // Batch-lookup old sprint names for the activity rows
  const oldSprintIds = issueRows.map(r => r.sprint_id).filter(Boolean);
  const sprintMap = await joinSprintsByIds(env, oldSprintIds);

  const ts = now();
  await env.DB.prepare(
    `UPDATE issues SET sprint_id=?, updated_at=? WHERE id IN (${placeholders})`
  ).bind(sprId, ts, ...ids).run();

  let moved = 0;
  for (const r of issueRows) {
    if (r.sprint_id === sprId) continue; // no-op
    const oldName = r.sprint_id ? (sprintMap[r.sprint_id]?.name || 'Unknown sprint') : 'Backlog';
    await insertActivity(env, {
      entityType: 'issue', entityId: r.id, userId: ctx.user.id, kind: 'system',
      body: `Sprint: ${oldName} → ${sprint.name}`,
    });
    moved += 1;
  }

  return jres({ ok: true, moved });
}

// ── Remove single issue from sprint ──────────────────────────
export async function removeIssueFromSprint(env, ctx, sprId, issueId) {
  const sprint = await env.DB.prepare('SELECT id, name FROM sprints WHERE id=?').bind(sprId).first();
  if (!sprint) return jres({ error: 'Sprint not found' }, 404);
  const issue = await env.DB.prepare(
    'SELECT id, sprint_id FROM issues WHERE id=? AND active=1'
  ).bind(issueId).first();
  if (!issue) return jres({ error: 'Issue not found' }, 404);
  if (issue.sprint_id !== sprId) {
    return jres({ error: 'Issue is not in this sprint' }, 400);
  }
  const ts = now();
  await env.DB.prepare(
    'UPDATE issues SET sprint_id=NULL, updated_at=? WHERE id=?'
  ).bind(ts, issueId).run();
  await insertActivity(env, {
    entityType: 'issue', entityId: issueId, userId: ctx.user.id, kind: 'system',
    body: `Sprint: ${sprint.name} → Backlog`,
  });
  return jres({ ok: true });
}

// ── Burndown ─────────────────────────────────────────────────
// Walk daily from start_at to min(end_at, today). remaining = total - cumulative
// count of Status: X → done rows whose created_at <= end of day.
export async function getBurndown(env, sprId) {
  const sprint = await env.DB.prepare('SELECT * FROM sprints WHERE id=?').bind(sprId).first();
  if (!sprint) return jres({ error: 'Sprint not found' }, 404);
  if (!sprint.start_at) {
    return jres({ error: 'Sprint has no start_at; burndown not available' }, 400);
  }

  const totalRow = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM issues WHERE sprint_id=? AND active=1'
  ).bind(sprId).first();
  const total = totalRow ? (totalRow.n || 0) : 0;

  // Find all "Status: X → done" system rows for issues currently in this sprint.
  // (We use the current scope to keep things simple; see handoff edge cases.)
  const { results: doneEvents } = await env.DB.prepare(
    `SELECT created_at FROM activity
     WHERE entity_type='issue'
       AND kind='system'
       AND body_md LIKE 'Status: % → done'
       AND entity_id IN (SELECT id FROM issues WHERE sprint_id=? AND active=1)
     ORDER BY created_at ASC`
  ).bind(sprId).all();

  const startMs = Date.parse(sprint.start_at);
  const endCapMs = sprint.state === 'completed' && sprint.end_at
    ? Date.parse(sprint.end_at)
    : Date.now();
  const plannedEndMs = sprint.planned_end_at ? Date.parse(sprint.planned_end_at) : null;

  // Day series: UTC-date granularity.
  function dayStr(ms) {
    return new Date(ms).toISOString().slice(0, 10);
  }
  function toUtcMidnight(ms) {
    const d = new Date(ms);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }

  const startDay = toUtcMidnight(startMs);
  const endDay = toUtcMidnight(Math.max(endCapMs, startMs));
  const actualDays = [];
  for (let d = startDay; d <= endDay; d += DAY_MS) actualDays.push(d);

  // Cumulative done counts per actual day
  const doneByDay = new Array(actualDays.length).fill(0);
  for (const ev of (doneEvents || [])) {
    const evDay = toUtcMidnight(Date.parse(ev.created_at));
    for (let i = 0; i < actualDays.length; i += 1) {
      if (actualDays[i] >= evDay) {
        doneByDay[i] += 1;
      }
    }
  }
  const actual = actualDays.map((d, i) => ({
    date: dayStr(d),
    remaining: Math.max(0, total - doneByDay[i]),
  }));

  // Ideal line: straight slope from total → 0 over [startDay, plannedEnd||endDay]
  const idealEndMs = plannedEndMs ? toUtcMidnight(plannedEndMs) : endDay;
  const idealDays = [];
  for (let d = startDay; d <= Math.max(idealEndMs, startDay); d += DAY_MS) idealDays.push(d);
  const span = Math.max(1, idealDays.length - 1);
  const ideal = idealDays.map((d, i) => ({
    date: dayStr(d),
    remaining: Math.max(0, Math.round((total * (span - i) / span) * 100) / 100),
  }));

  const daysTotal = plannedEndMs
    ? Math.max(1, Math.round((toUtcMidnight(plannedEndMs) - startDay) / DAY_MS) + 1)
    : idealDays.length;

  return jres({
    sprint: {
      id: sprint.id,
      name: sprint.name,
      state: sprint.state,
      start_at: sprint.start_at,
      end_at: sprint.end_at,
      planned_end_at: sprint.planned_end_at,
      days_total: daysTotal,
      days_remaining: sprint.state === 'active' ? daysRemainingFrom(sprint.planned_end_at) : null,
    },
    total_issues: total,
    actual,
    ideal,
  });
}
