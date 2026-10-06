// ============================================================
// Cintelis Workspace — Issue Dependencies
// Manages blocker/blocked-by relationships between issues.
// Self-contained: no imports from worker.js to avoid circular deps.
// ============================================================

// ── Local helpers (mirror worker.js) ─────────────────────────
function jres(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
function now() { return new Date().toISOString(); }
function uid() { return crypto.randomUUID(); }
function depId() { return `dep_${uid().replace(/-/g, '').slice(0, 24)}`; }

// ── listDependencies ────────────────────────────────────────
// Returns { blocks: [...], blocked_by: [...] } for a given issue.
export async function listDependencies(env, issueId) {
  const { results: blocksRows } = await env.DB.prepare(
    `SELECT d.id AS dep_id, i.id, i.issue_key, i.title, i.status
     FROM issue_dependencies d
     JOIN issues i ON i.id = d.blocked_issue_id
     WHERE d.blocker_issue_id = ?
     ORDER BY d.created_at ASC`
  ).bind(issueId).all();

  const { results: blockedByRows } = await env.DB.prepare(
    `SELECT d.id AS dep_id, i.id, i.issue_key, i.title, i.status
     FROM issue_dependencies d
     JOIN issues i ON i.id = d.blocker_issue_id
     WHERE d.blocked_issue_id = ?
     ORDER BY d.created_at ASC`
  ).bind(issueId).all();

  return jres({
    blocks: blocksRows || [],
    blocked_by: blockedByRows || [],
  });
}

// ── addDependency ───────────────────────────────────────────
// Body: { blocker_issue_id, blocked_issue_id }
export async function addDependency(req, env, ctx) {
  const body = await req.json().catch(() => ({}));
  const blockerId = String(body.blocker_issue_id || '').trim();
  const blockedId = String(body.blocked_issue_id || '').trim();

  if (!blockerId || !blockedId) {
    return jres({ error: 'blocker_issue_id and blocked_issue_id are required' }, 400);
  }
  if (blockerId === blockedId) {
    return jres({ error: 'An issue cannot block itself' }, 400);
  }

  // Validate both issues exist and are active
  const blocker = await env.DB.prepare('SELECT id FROM issues WHERE id = ? AND active = 1').bind(blockerId).first();
  if (!blocker) return jres({ error: 'Blocker issue not found or inactive' }, 404);

  const blocked = await env.DB.prepare('SELECT id FROM issues WHERE id = ? AND active = 1').bind(blockedId).first();
  if (!blocked) return jres({ error: 'Blocked issue not found or inactive' }, 404);

  // Check for reverse dependency (would create circular A blocks B and B blocks A)
  const reverse = await env.DB.prepare(
    'SELECT id FROM issue_dependencies WHERE blocker_issue_id = ? AND blocked_issue_id = ?'
  ).bind(blockedId, blockerId).first();
  if (reverse) {
    return jres({ error: 'Reverse dependency already exists — this would create a circular dependency' }, 409);
  }

  // Check for duplicate
  const existing = await env.DB.prepare(
    'SELECT id FROM issue_dependencies WHERE blocker_issue_id = ? AND blocked_issue_id = ?'
  ).bind(blockerId, blockedId).first();
  if (existing) {
    return jres({ error: 'This dependency already exists' }, 409);
  }

  const id = depId();
  const ts = now();
  await env.DB.prepare(
    `INSERT INTO issue_dependencies (id, blocker_issue_id, blocked_issue_id, created_by, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(id, blockerId, blockedId, ctx.user.id, ts).run();

  return jres({ id, blocker_issue_id: blockerId, blocked_issue_id: blockedId, created_by: ctx.user.id, created_at: ts });
}

// ── removeDependency ────────────────────────────────────────
// DELETE by dependency id.
export async function removeDependency(env, depIdParam) {
  const existing = await env.DB.prepare('SELECT id FROM issue_dependencies WHERE id = ?').bind(depIdParam).first();
  if (!existing) return jres({ error: 'Dependency not found' }, 404);
  await env.DB.prepare('DELETE FROM issue_dependencies WHERE id = ?').bind(depIdParam).run();
  return jres({ ok: true });
}

// ── deleteDepsForIssue (internal helper) ────────────────────
// Delete all dependency rows where issue is blocker OR blocked.
// Used when deleting an issue. No Response wrapper.
export async function deleteDepsForIssue(env, issueId) {
  await env.DB.prepare(
    'DELETE FROM issue_dependencies WHERE blocker_issue_id = ? OR blocked_issue_id = ?'
  ).bind(issueId, issueId).run();
}

// ── getBlockerStatus (internal helper) ──────────────────────
// Returns { has_unresolved_blockers, blocker_count }.
// Counts dependencies where this issue is blocked and the blocker's status != 'done'.
export async function getBlockerStatus(env, issueId) {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS cnt
     FROM issue_dependencies d
     JOIN issues i ON i.id = d.blocker_issue_id
     WHERE d.blocked_issue_id = ? AND i.status != 'done'`
  ).bind(issueId).first();
  const count = row?.cnt || 0;
  return { has_unresolved_blockers: count > 0, blocker_count: count };
}
