// ============================================================
// Cintelis Workspace — Tasks (projects + issues + comments)
// All handlers expect (req, env, ctx) where ctx = {session, user} from
// requireAuth(). They return Response objects via the local jres() helper.
// Self-contained: no imports from worker.js to avoid circular deps.
// ============================================================

import { emit, EVENT_TYPES } from './events.js';
import { parseMentionsAndNotify } from './notifications.js';
import { deleteAttachmentsForEntity } from './attachments.js';
import { deleteLinksForEntity } from './entity-links.js';
import { cloneCustomValues } from './custom-fields.js';
import { deleteDepsForIssue, getBlockerStatus } from './dependencies.js';
import { customerIdForCreate } from './customers.js';
import { scopedAll, scopedFirst, scopedRun, scopedInsert, ALL_SCOPE } from './scope.js';

// ── Local helpers (mirror worker.js) ─────────────────────────
function jres(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
function now() { return new Date().toISOString(); }
function uid() { return crypto.randomUUID(); }
function projectId() { return `prj_${uid().replace(/-/g, '').slice(0, 24)}`; }
function issueId() { return `iss_${uid().replace(/-/g, '').slice(0, 24)}`; }
function activityId() { return `act_${uid().replace(/-/g, '').slice(0, 24)}`; }

const ISSUE_TYPES = ['task', 'bug', 'story', 'epic'];
const ISSUE_STATUSES = ['backlog', 'todo', 'in_progress', 'in_review', 'done'];
const ISSUE_PRIORITIES = ['lowest', 'low', 'medium', 'high', 'highest'];
const PROJECT_KEY_RE = /^[A-Z][A-Z0-9]{1,9}$/;

function validateEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

// Batched user lookup → { id: {id, email, display_name} }
async function joinUsers(env, ids) {
  const unique = Array.from(new Set((ids || []).filter(Boolean)));
  if (!unique.length) return {};
  const placeholders = unique.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `SELECT id, email, display_name FROM users WHERE id IN (${placeholders})`
  ).bind(...unique).all();
  const map = {};
  for (const r of (results || [])) {
    map[r.id] = { id: r.id, email: r.email, display_name: r.display_name || '' };
  }
  return map;
}

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

// Reshape an issue row to nest assignee/reporter objects from joined columns.
function reshapeIssueRow(r) {
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
  out.sprint = r.s_id
    ? { id: r.s_id, name: r.s_name || '', state: r.s_state || 'planned' }
    : null;
  delete out.s_id;
  delete out.s_name;
  delete out.s_state;
  return out;
}

// Batched sprint lookup → { id: {id, name} }. Local to tasks.js so we don't
// pull in worker/sprints.js (which would cause unnecessary coupling).
async function joinSprintsByIds(env, ids) {
  const unique = Array.from(new Set((ids || []).filter(Boolean)));
  if (!unique.length) return {};
  const placeholders = unique.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `SELECT id, name FROM sprints WHERE id IN (${placeholders})`
  ).bind(...unique).all();
  const map = {};
  for (const r of (results || [])) {
    map[r.id] = { id: r.id, name: r.name || '' };
  }
  return map;
}

// ── Projects ─────────────────────────────────────────────────
export async function listProjects(env, ctx, url) {
  // Tenant scoping via worker/scope.js: customer users see only their own
  // projects; staff see all, optionally narrowed with ?customer_id=.
  const projects = await scopedAll(env, ctx, {
    sql: `SELECT p.*, u.display_name AS lead_display_name, u.email AS lead_email, c.name AS customer_name FROM projects p LEFT JOIN users u ON u.id = p.lead_user_id LEFT JOIN customers c ON c.id = p.customer_id WHERE p.active = 1 AND /*SCOPE*/ ORDER BY p.key ASC`,
    alias: 'p', url,
  });
  const { results: counts } = await env.DB.prepare(
    `SELECT project_id, status, COUNT(*) AS n
     FROM issues WHERE active = 1
     GROUP BY project_id, status`
  ).all();
  const countsByProject = {};
  for (const row of (counts || [])) {
    if (!countsByProject[row.project_id]) countsByProject[row.project_id] = {};
    countsByProject[row.project_id][row.status] = row.n;
  }
  return jres({
    projects: (projects || []).map(p => {
      const c = countsByProject[p.id] || {};
      const issue_counts = { backlog: 0, todo: 0, in_progress: 0, in_review: 0, done: 0 };
      for (const k of Object.keys(c)) issue_counts[k] = c[k];
      const out = { ...p };
      out.lead = p.lead_user_id
        ? { id: p.lead_user_id, display_name: p.lead_display_name || '', email: p.lead_email || '' }
        : null;
      delete out.lead_display_name;
      delete out.lead_email;
      out.issue_counts = issue_counts;
      out.total_issues = Object.values(issue_counts).reduce((a, b) => a + b, 0);
      return out;
    }),
  });
}

export async function createProject(req, env, ctx) {
  const body = await req.json().catch(() => ({}));
  const scoped = await customerIdForCreate(env, ctx, body.customer_id);
  if (scoped.error) return scoped.error;
  const key = String(body.key || '').trim().toUpperCase();
  const name = String(body.name || '').trim();
  if (!PROJECT_KEY_RE.test(key)) {
    return jres({ error: 'key must be 2–10 uppercase alphanumerics starting with a letter' }, 400);
  }
  if (!name) return jres({ error: 'name required' }, 400);
  // ALL_SCOPE: project keys are unique across tenants (the schema says so), so
  // the clash check must see every tenant's rows. Only an id leaks, never a name.
  const exists = await scopedFirst(env, ctx, { sql: 'SELECT p.id FROM projects p WHERE p.key=? AND /*SCOPE*/', binds: [key], alias: 'p', scope: ALL_SCOPE });
  if (exists) return jres({ error: 'A project with that key already exists' }, 409);
  const id = projectId();
  const ts = now();
  await scopedInsert(env, ctx, {
    table: 'projects',
    row: {
      id, key, name, description_md: String(body.description_md || ''), lead_user_id: body.lead_user_id || null,
      issue_seq: 0, active: 1, created_by: ctx.user.id, created_at: ts, updated_at: ts,
    },
    requested: scoped.customer_id,
  });
  return jres({ id, key, name, description_md: String(body.description_md || ''), lead_user_id: body.lead_user_id || null, created_at: ts, updated_at: ts });
}

export async function getProject(env, ctx, projId) {
  const row = await scopedFirst(env, ctx, {
    sql: `SELECT p.*, u.display_name AS lead_display_name, u.email AS lead_email FROM projects p LEFT JOIN users u ON u.id = p.lead_user_id WHERE p.id = ? AND p.active = 1 AND /*SCOPE*/`,
    binds: [projId], alias: 'p',
  });
  if (!row) return jres({ error: 'Project not found' }, 404);
  const { results: counts } = await env.DB.prepare(
    `SELECT status, COUNT(*) AS n FROM issues WHERE project_id=? AND active=1 GROUP BY status`
  ).bind(projId).all();
  const issue_counts = { backlog: 0, todo: 0, in_progress: 0, in_review: 0, done: 0 };
  for (const c of (counts || [])) issue_counts[c.status] = c.n;
  const project = { ...row };
  project.lead = row.lead_user_id
    ? { id: row.lead_user_id, display_name: row.lead_display_name || '', email: row.lead_email || '' }
    : null;
  delete project.lead_display_name;
  delete project.lead_email;
  project.issue_counts = issue_counts;
  project.total_issues = Object.values(issue_counts).reduce((a, b) => a + b, 0);
  return jres({ project });
}

export async function patchProject(req, env, ctx, projId) {
  const body = await req.json().catch(() => ({}));
  const existing = await scopedFirst(env, ctx, { sql: 'SELECT p.* FROM projects p WHERE p.id=? AND p.active=1 AND /*SCOPE*/', binds: [projId], alias: 'p' });
  if (!existing) return jres({ error: 'Project not found' }, 404);
  const fields = [];
  const params = [];
  if (typeof body.name === 'string') {
    const name = body.name.trim();
    if (!name) return jres({ error: 'name cannot be empty' }, 400);
    fields.push('name=?'); params.push(name);
  }
  if (typeof body.description_md === 'string') {
    fields.push('description_md=?'); params.push(body.description_md);
  }
  if ('lead_user_id' in body) {
    fields.push('lead_user_id=?'); params.push(body.lead_user_id || null);
  }
  if (!fields.length) return jres({ ok: true, unchanged: true });
  const ts = now();
  fields.push('updated_at=?'); params.push(ts);
  params.push(projId);
  await scopedRun(env, ctx, { sql: `UPDATE projects SET ${fields.join(', ')} WHERE id=? AND /*SCOPE*/`, binds: params, alias: 'projects' });
  return jres({ ok: true, updated_at: ts });
}

// Soft delete + cascade soft-delete the project's issues. Router handles admin gating.
export async function deleteProject(env, ctx, projId) {
  const existing = await scopedFirst(env, ctx, { sql: 'SELECT p.id FROM projects p WHERE p.id=? AND p.active=1 AND /*SCOPE*/', binds: [projId], alias: 'p' });
  if (!existing) return jres({ error: 'Project not found' }, 404);
  const ts = now();
  await scopedRun(env, ctx, { sql: 'UPDATE projects SET active=0, updated_at=? WHERE id=? AND /*SCOPE*/', binds: [ts, projId], alias: 'projects' });
  await env.DB.prepare('UPDATE issues SET active=0, updated_at=? WHERE project_id=?').bind(ts, projId).run();
  return jres({ ok: true });
}

// ── Issues ───────────────────────────────────────────────────
export async function listIssues(req, env, projIdParam) {
  const url = new URL(req.url);
  const where = ['i.active = 1', 'i.project_id = ?'];
  const params = [projIdParam];
  for (const f of ['status', 'type', 'priority', 'parent_id']) {
    const v = url.searchParams.get(f);
    if (v) { where.push(`i.${f} = ?`); params.push(v); }
  }
  // Assignee filter supports an `__unassigned__` sentinel from the frontend
  // dropdown, in addition to a real user_id.
  const assigneeRaw = url.searchParams.get('assignee_id');
  if (assigneeRaw === '__unassigned__') {
    where.push('i.assignee_id IS NULL');
  } else if (assigneeRaw) {
    where.push('i.assignee_id = ?');
    params.push(assigneeRaw);
  }
  // Sprint filter — mirrors the assignee pattern. '__backlog__' sentinel means
  // "no sprint at all" (sprint_id IS NULL), otherwise direct equality.
  const sprintRaw = url.searchParams.get('sprint_id');
  if (sprintRaw === '__backlog__') {
    where.push('i.sprint_id IS NULL');
  } else if (sprintRaw) {
    where.push('i.sprint_id = ?');
    params.push(sprintRaw);
  }
  const q = url.searchParams.get('q');
  if (q) { where.push('(i.title LIKE ? OR i.description_md LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
  const limitRaw = parseInt(url.searchParams.get('limit') || '100', 10);
  const limit = Math.max(1, Math.min(isNaN(limitRaw) ? 100 : limitRaw, 500));
  const sql =
    `SELECT i.*,
            a.display_name AS assignee_display_name, a.email AS assignee_email,
            r.display_name AS reporter_display_name, r.email AS reporter_email,
            s.id AS s_id, s.name AS s_name, s.state AS s_state
     FROM issues i
     LEFT JOIN users a ON a.id = i.assignee_id
     LEFT JOIN users r ON r.id = i.reporter_id
     LEFT JOIN sprints s ON s.id = i.sprint_id
     WHERE ${where.join(' AND ')}
     ORDER BY i.updated_at DESC
     LIMIT ?`;
  params.push(limit);
  const { results } = await env.DB.prepare(sql).bind(...params).all();
  return jres({ issues: (results || []).map(reshapeIssueRow) });
}

// Resolve a parent specifier (`parent_key` like "ENG-12" OR `parent_id`) to an
// actual issue id. Returns { ok: true, parent_id } or { ok: false, error }.
async function resolveParent(env, body) {
  if (body.parent_id) {
    const row = await env.DB.prepare('SELECT id FROM issues WHERE id=? AND active=1').bind(body.parent_id).first();
    if (!row) return { ok: false, error: 'parent_id not found' };
    return { ok: true, parent_id: body.parent_id };
  }
  if (body.parent_key) {
    const key = String(body.parent_key).trim().toUpperCase();
    if (!key) return { ok: true, parent_id: null };
    const row = await env.DB.prepare('SELECT id FROM issues WHERE issue_key=? AND active=1').bind(key).first();
    if (!row) return { ok: false, error: `parent issue ${key} not found` };
    return { ok: true, parent_id: row.id };
  }
  return { ok: true, parent_id: null };
}

export async function createIssue(req, env, ctx, projIdParam) {
  const body = await req.json().catch(() => ({}));
  const title = String(body.title || '').trim();
  if (!title) return jres({ error: 'title required' }, 400);
  // Resolve optional parent (accepts parent_id OR parent_key)
  const parent = await resolveParent(env, body);
  if (!parent.ok) return jres({ error: parent.error }, 400);
  // Atomically bump seq + read project key (D1 supports UPDATE ... RETURNING)
  const ts = now();
  const seqRow = await scopedFirst(env, ctx, {
    sql: 'UPDATE projects SET issue_seq = issue_seq + 1, updated_at = ? WHERE id = ? AND active = 1 AND /*SCOPE*/ RETURNING issue_seq, key',
    binds: [ts, projIdParam], alias: 'projects',
  });
  if (!seqRow) return jres({ error: 'Project not found' }, 404);
  const id = issueId();
  const issueKey = `${seqRow.key}-${seqRow.issue_seq}`;
  const issue = {
    id,
    project_id: projIdParam,
    issue_key: issueKey,
    issue_number: seqRow.issue_seq,
    title,
    description_md: String(body.description_md || ''),
    type: validateEnum(body.type, ISSUE_TYPES, 'task'),
    status: validateEnum(body.status, ISSUE_STATUSES, 'todo'),
    priority: validateEnum(body.priority, ISSUE_PRIORITIES, 'medium'),
    assignee_id: body.assignee_id || null,
    reporter_id: ctx.user.id,
    parent_id: parent.parent_id,
    start_at: body.start_at || null,
    due_at: body.due_at || null,
    active: 1,
    created_at: ts,
    updated_at: ts,
  };
  await env.DB.prepare(
    `INSERT INTO issues (id, project_id, issue_key, issue_number, title, description_md, type, status,
                         priority, assignee_id, reporter_id, parent_id, start_at, due_at, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
  ).bind(
    issue.id, issue.project_id, issue.issue_key, issue.issue_number, issue.title, issue.description_md,
    issue.type, issue.status, issue.priority, issue.assignee_id, issue.reporter_id, issue.parent_id,
    issue.start_at, issue.due_at, issue.created_at, issue.updated_at
  ).run();

  await insertActivity(env, { entityType: 'issue', entityId: id, userId: ctx.user.id, kind: 'system', body: 'Issue created' });
  await emit(env, EVENT_TYPES.ISSUE_CREATED, { issue, actor: ctx.user });
  if (issue.description_md) {
    await parseMentionsAndNotify(env, {
      body_md: issue.description_md,
      entity_type: 'issue',
      entity_id: id,
      actor: ctx.user,
      link: `/?nav=projects&issue=${id}`,
      title: `${ctx.user.display_name || ctx.user.email} mentioned you in ${issue.issue_key}`,
    });
  }
  return jres(issue);
}

export async function getIssue(env, isId) {
  const row = await env.DB.prepare(
    `SELECT i.*,
            a.display_name AS assignee_display_name, a.email AS assignee_email,
            r.display_name AS reporter_display_name, r.email AS reporter_email,
            s.id AS s_id, s.name AS s_name, s.state AS s_state
     FROM issues i
     LEFT JOIN users a ON a.id = i.assignee_id
     LEFT JOIN users r ON r.id = i.reporter_id
     LEFT JOIN sprints s ON s.id = i.sprint_id
     WHERE i.id = ? AND i.active = 1`
  ).bind(isId).first();
  if (!row) return jres({ error: 'Issue not found' }, 404);
  const issue = reshapeIssueRow(row);

  let parent = null;
  if (issue.parent_id) {
    const p = await env.DB.prepare(
      'SELECT id, issue_key, title FROM issues WHERE id=? AND active=1'
    ).bind(issue.parent_id).first();
    if (p) parent = { id: p.id, issue_key: p.issue_key, title: p.title };
  }

  const { results: subRows } = await env.DB.prepare(
    'SELECT id, issue_key, title, status FROM issues WHERE parent_id=? AND active=1 ORDER BY issue_number ASC'
  ).bind(issue.id).all();
  const subtasks = (subRows || []).map(s => ({ id: s.id, issue_key: s.issue_key, title: s.title, status: s.status }));

  const { results: actRows } = await env.DB.prepare(
    `SELECT a.*, u.email AS u_email, u.display_name AS u_display_name
     FROM activity a
     LEFT JOIN users u ON u.id = a.user_id
     WHERE a.entity_type='issue' AND a.entity_id=?
     ORDER BY a.created_at ASC`
  ).bind(issue.id).all();
  const activity = (actRows || []).map(a => {
    const out = { ...a };
    out.user = a.user_id
      ? { id: a.user_id, email: a.u_email || '', display_name: a.u_display_name || '' }
      : null;
    delete out.u_email;
    delete out.u_display_name;
    return out;
  });

  // Dependencies
  const { results: blocksRows } = await env.DB.prepare(
    `SELECT d.id AS dep_id, i.id, i.issue_key, i.title, i.status
     FROM issue_dependencies d
     JOIN issues i ON i.id = d.blocked_issue_id AND i.active = 1
     WHERE d.blocker_issue_id = ?`
  ).bind(issue.id).all();
  const { results: blockedByRows } = await env.DB.prepare(
    `SELECT d.id AS dep_id, i.id, i.issue_key, i.title, i.status
     FROM issue_dependencies d
     JOIN issues i ON i.id = d.blocker_issue_id AND i.active = 1
     WHERE d.blocked_issue_id = ?`
  ).bind(issue.id).all();
  const dependencies = { blocks: blocksRows || [], blocked_by: blockedByRows || [] };

  return jres({ issue, parent, subtasks, activity, dependencies });
}

// Diff old vs new fields, write per-change system rows, emit specific events.
export async function patchIssue(req, env, ctx, isId) {
  const body = await req.json().catch(() => ({}));
  const existing = await env.DB.prepare('SELECT * FROM issues WHERE id=? AND active=1').bind(isId).first();
  if (!existing) return jres({ error: 'Issue not found' }, 404);

  const updates = {};
  if (typeof body.title === 'string') {
    const t = body.title.trim();
    if (!t) return jres({ error: 'title cannot be empty' }, 400);
    if (t !== existing.title) updates.title = t;
  }
  if (typeof body.description_md === 'string' && body.description_md !== existing.description_md) {
    updates.description_md = body.description_md;
  }
  if (typeof body.type === 'string') {
    const v = validateEnum(body.type, ISSUE_TYPES, existing.type);
    if (v !== existing.type) updates.type = v;
  }
  if (typeof body.status === 'string') {
    const v = validateEnum(body.status, ISSUE_STATUSES, existing.status);
    if (v !== existing.status) updates.status = v;
  }
  if (typeof body.priority === 'string') {
    const v = validateEnum(body.priority, ISSUE_PRIORITIES, existing.priority);
    if (v !== existing.priority) updates.priority = v;
  }
  if ('assignee_id' in body) {
    const v = body.assignee_id || null;
    if (v !== existing.assignee_id) updates.assignee_id = v;
  }
  if ('parent_id' in body || 'parent_key' in body) {
    const parent = await resolveParent(env, body);
    if (!parent.ok) return jres({ error: parent.error }, 400);
    if (parent.parent_id !== existing.parent_id) updates.parent_id = parent.parent_id;
  }
  if ('start_at' in body) {
    const v = body.start_at || null;
    if (v !== existing.start_at) updates.start_at = v;
  }
  if ('due_at' in body) {
    const v = body.due_at || null;
    if (v !== existing.due_at) updates.due_at = v;
  }
  if ('sprint_id' in body) {
    const v = body.sprint_id || null;
    if (v !== existing.sprint_id) updates.sprint_id = v;
  }

  if (!Object.keys(updates).length) {
    // Still return the joined row so callers see a stable shape.
    return getIssue(env, isId);
  }

  // Resolve display names for assignee delta (old + new) in one query.
  const userIdsToFetch = [];
  if ('assignee_id' in updates) {
    if (existing.assignee_id) userIdsToFetch.push(existing.assignee_id);
    if (updates.assignee_id) userIdsToFetch.push(updates.assignee_id);
  }
  const userMap = await joinUsers(env, userIdsToFetch);

  // Resolve sprint names for the sprint_id delta (old + new) in one query.
  const sprintIdsToFetch = [];
  if ('sprint_id' in updates) {
    if (existing.sprint_id) sprintIdsToFetch.push(existing.sprint_id);
    if (updates.sprint_id) sprintIdsToFetch.push(updates.sprint_id);
  }
  const sprintMap = await joinSprintsByIds(env, sprintIdsToFetch);

  const ts = now();
  const setFragments = [];
  const params = [];
  for (const [k, v] of Object.entries(updates)) {
    setFragments.push(`${k}=?`);
    params.push(v);
  }
  setFragments.push('updated_at=?');
  params.push(ts);
  params.push(isId);
  await env.DB.prepare(`UPDATE issues SET ${setFragments.join(', ')} WHERE id=?`).bind(...params).run();

  // Activity rows + events
  if ('assignee_id' in updates) {
    const oldName = existing.assignee_id ? (userMap[existing.assignee_id]?.display_name || userMap[existing.assignee_id]?.email || 'Unknown') : 'Unassigned';
    const newName = updates.assignee_id ? (userMap[updates.assignee_id]?.display_name || userMap[updates.assignee_id]?.email || 'Unknown') : 'Unassigned';
    await insertActivity(env, {
      entityType: 'issue', entityId: isId, userId: ctx.user.id, kind: 'system',
      body: `Assignee: ${oldName} → ${newName}`,
    });
    await emit(env, EVENT_TYPES.ISSUE_ASSIGNED, {
      issue_id: isId,
      old_assignee_id: existing.assignee_id,
      new_assignee_id: updates.assignee_id,
      actor: ctx.user,
    });
  }
  if ('status' in updates) {
    await insertActivity(env, {
      entityType: 'issue', entityId: isId, userId: ctx.user.id, kind: 'system',
      body: `Status: ${existing.status} → ${updates.status}`,
    });
    await emit(env, EVENT_TYPES.ISSUE_STATUS_CHANGED, {
      issue_id: isId,
      old_status: existing.status,
      new_status: updates.status,
      actor: ctx.user,
    });
  }

  if ('sprint_id' in updates) {
    const oldName = existing.sprint_id ? (sprintMap[existing.sprint_id]?.name || 'Unknown sprint') : 'Backlog';
    const newName = updates.sprint_id ? (sprintMap[updates.sprint_id]?.name || 'Unknown sprint') : 'Backlog';
    await insertActivity(env, {
      entityType: 'issue', entityId: isId, userId: ctx.user.id, kind: 'system',
      body: `Sprint: ${oldName} → ${newName}`,
    });
    await emit(env, EVENT_TYPES.ISSUE_UPDATED, {
      issue_id: isId,
      changed_fields: ['sprint_id'],
      actor: ctx.user,
    });
  }

  // Other field updates → one combined system row + ISSUE_UPDATED
  const otherFields = Object.keys(updates).filter(k => k !== 'assignee_id' && k !== 'status' && k !== 'sprint_id');
  if (otherFields.length) {
    await insertActivity(env, {
      entityType: 'issue', entityId: isId, userId: ctx.user.id, kind: 'system',
      body: `Updated: ${otherFields.join(', ')}`,
    });
    await emit(env, EVENT_TYPES.ISSUE_UPDATED, {
      issue_id: isId,
      changed_fields: otherFields,
      actor: ctx.user,
    });
  }

  if ('description_md' in updates) {
    await parseMentionsAndNotify(env, {
      body_md: updates.description_md,
      entity_type: 'issue',
      entity_id: isId,
      actor: ctx.user,
      link: `/?nav=projects&issue=${isId}`,
      title: `${ctx.user.display_name || ctx.user.email} mentioned you in an issue update`,
    });
  }

  return getIssue(env, isId);
}

// Hard delete the issue and its activity rows.
export async function deleteIssue(env, isId) {
  const existing = await env.DB.prepare('SELECT id FROM issues WHERE id=?').bind(isId).first();
  if (!existing) return jres({ error: 'Issue not found' }, 404);
  await env.DB.prepare("DELETE FROM activity WHERE entity_type='issue' AND entity_id=?").bind(isId).run();
  await env.DB.prepare('DELETE FROM issues WHERE id=?').bind(isId).run();
  await deleteAttachmentsForEntity(env, 'issue', isId);
  await deleteLinksForEntity(env, 'issue', isId);
  await deleteDepsForIssue(env, isId);
  return jres({ ok: true });
}

// ── Comments ─────────────────────────────────────────────────
export async function addIssueComment(req, env, ctx, isId) {
  const body = await req.json().catch(() => ({}));
  const text = String(body.body_md || '').trim();
  if (!text) return jres({ error: 'body_md required' }, 400);
  const issue = await env.DB.prepare('SELECT id FROM issues WHERE id=? AND active=1').bind(isId).first();
  if (!issue) return jres({ error: 'Issue not found' }, 404);
  const row = await insertActivity(env, {
    entityType: 'issue', entityId: isId, userId: ctx.user.id, kind: 'comment', body: text,
  });
  await emit(env, EVENT_TYPES.ISSUE_COMMENTED, { issue_id: isId, actor: ctx.user, body_md: text });
  await parseMentionsAndNotify(env, {
    body_md: text,
    entity_type: 'issue',
    entity_id: isId,
    actor: ctx.user,
    link: `/?nav=projects&issue=${isId}`,
    title: `${ctx.user.display_name || ctx.user.email} commented on an issue`,
  });
  return jres({
    ...row,
    user: { id: ctx.user.id, email: ctx.user.email, display_name: ctx.user.display_name || '' },
  });
}

// ── Activity ─────────────────────────────────────────────────
export async function deleteActivity(env, ctx, actId) {
  const row = await env.DB.prepare('SELECT id, user_id FROM activity WHERE id=?').bind(actId).first();
  if (!row) return jres({ error: 'Activity not found' }, 404);
  // Small team — any member+ can delete any comment/activity.
  await env.DB.prepare('DELETE FROM activity WHERE id=?').bind(actId).run();
  return jres({ ok: true });
}

export async function patchActivity(req, env, ctx, actId) {
  const row = await env.DB.prepare('SELECT id, user_id, kind FROM activity WHERE id=?').bind(actId).first();
  if (!row) return jres({ error: 'Activity not found' }, 404);
  if (row.kind !== 'comment') return jres({ error: 'Only comments can be edited' }, 400);
  // Any member+ can edit any comment (small team policy).
  const body = await req.json().catch(() => ({}));
  const newBody = String(body.body_md || '').trim();
  if (!newBody) return jres({ error: 'body_md required' }, 400);
  await env.DB.prepare('UPDATE activity SET body_md=? WHERE id=?').bind(newBody, actId).run();
  return jres({ ok: true, body_md: newBody });
}

// ── Clone issue ─────────────────────────────────────────────
export async function cloneIssue(req, env, ctx, sourceId) {
  const source = await env.DB.prepare('SELECT * FROM issues WHERE id=? AND active=1').bind(sourceId).first();
  if (!source) return jres({ error: 'Issue not found' }, 404);
  const body = await req.json().catch(() => ({}));
  const ts = now();
  const seqRow = await scopedFirst(env, ctx, {
    sql: 'UPDATE projects SET issue_seq = issue_seq + 1, updated_at = ? WHERE id = ? AND active = 1 AND /*SCOPE*/ RETURNING issue_seq, key',
    binds: [ts, source.project_id], alias: 'projects',
  });
  if (!seqRow) return jres({ error: 'Project not found' }, 404);
  const id = issueId();
  const issueKey = `${seqRow.key}-${seqRow.issue_seq}`;
  const title = body.title || `Copy of ${source.title}`;
  await env.DB.prepare(
    `INSERT INTO issues (id, project_id, issue_key, issue_number, title, description_md, type, status,
                         priority, assignee_id, reporter_id, parent_id, start_at, due_at, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'todo', ?, NULL, ?, ?, ?, ?, 1, ?, ?)`
  ).bind(
    id, source.project_id, issueKey, seqRow.issue_seq, title, source.description_md || '',
    source.type, source.priority, ctx.user.id, source.parent_id || null,
    source.start_at || null, source.due_at || null, ts, ts
  ).run();
  await insertActivity(env, {
    entityType: 'issue', entityId: id, userId: ctx.user.id, kind: 'system',
    body: `Cloned from ${source.issue_key}`,
  });
  await cloneCustomValues(env, sourceId, id);
  await emit(env, EVENT_TYPES.ISSUE_CREATED, { issue: { id, issue_key: issueKey, title, project_id: source.project_id }, actor: ctx.user });
  return getIssue(env, id);
}

// ── Roadmap issues ──────────────────────────────────────────
export async function listRoadmapIssues(req, env, projId) {
  // The project's "Hours" custom field (number), if it has one, rides along
  // so the WBS can show effort per row and roll it up per phase.
  const hoursDef = await env.DB.prepare(
    "SELECT id FROM custom_field_defs WHERE project_id = ? AND active = 1 AND lower(name) = 'hours' AND field_type = 'number' ORDER BY sort_order LIMIT 1"
  ).bind(projId).first();
  const { results } = await env.DB.prepare(
    `SELECT i.id, i.issue_key, i.title, i.status, i.priority, i.type,
            i.assignee_id, i.start_at, i.due_at,
            i.parent_id, i.issue_number,
            u.display_name AS assignee_display_name, u.email AS assignee_email,
            (SELECT v.value FROM custom_field_values v WHERE v.issue_id = i.id AND v.field_def_id = ?) AS hours
     FROM issues i
     LEFT JOIN users u ON u.id = i.assignee_id
     WHERE i.project_id = ? AND i.active = 1
     ORDER BY COALESCE(i.start_at, i.due_at) ASC NULLS LAST, i.issue_number ASC`
  ).bind(hoursDef ? hoursDef.id : '', projId).all();
  return jres({ issues: results || [], hours_field_id: hoursDef ? hoursDef.id : null });
}
