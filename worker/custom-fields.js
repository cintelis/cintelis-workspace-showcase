// ============================================================
// Cintelis Workspace — Custom Fields (definitions + values)
// CRUD for custom field definitions scoped to projects, and
// per-issue custom field values.  Self-contained: no imports
// from worker.js to avoid circular deps.
// ============================================================

// ── Local helpers (mirror worker.js) ─────────────────────────
function jres(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
function now() { return new Date().toISOString(); }
function uid() { return crypto.randomUUID(); }
function cfdId() { return `cfd_${uid().replace(/-/g, '').slice(0, 24)}`; }
function cfvId() { return `cfv_${uid().replace(/-/g, '').slice(0, 24)}`; }

const FIELD_TYPES = ['text', 'number', 'select', 'date', 'checkbox'];

// ── Field Definitions ───────────────────────────────────────

export async function listFieldDefs(env, projectId) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM custom_field_defs
     WHERE project_id = ? AND active = 1
     ORDER BY sort_order ASC`
  ).bind(projectId).all();
  return jres({ field_defs: results || [] });
}

export async function createFieldDef(req, env, projectId) {
  const body = await req.json().catch(() => ({}));
  const name = String(body.name || '').trim();
  if (!name) return jres({ error: 'name required' }, 400);

  const field_type = String(body.field_type || 'text');
  if (!FIELD_TYPES.includes(field_type)) {
    return jres({ error: `field_type must be one of: ${FIELD_TYPES.join(', ')}` }, 400);
  }

  let options = '[]';
  if (field_type === 'select') {
    if (!Array.isArray(body.options) || !body.options.length) {
      return jres({ error: 'options must be a non-empty array of strings for select type' }, 400);
    }
    options = JSON.stringify(body.options.map(o => String(o)));
  }

  // Auto-set sort_order to max+1
  const maxRow = await env.DB.prepare(
    'SELECT MAX(sort_order) AS max_sort FROM custom_field_defs WHERE project_id = ? AND active = 1'
  ).bind(projectId).first();
  const sort_order = (maxRow?.max_sort ?? -1) + 1;

  const id = cfdId();
  const ts = now();
  await env.DB.prepare(
    `INSERT INTO custom_field_defs (id, project_id, name, field_type, options, sort_order, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`
  ).bind(id, projectId, name, field_type, options, sort_order, ts, ts).run();

  return jres({ id, project_id: projectId, name, field_type, options, sort_order, active: 1, created_at: ts, updated_at: ts });
}

export async function patchFieldDef(req, env, fieldId) {
  const body = await req.json().catch(() => ({}));
  const existing = await env.DB.prepare(
    'SELECT * FROM custom_field_defs WHERE id = ? AND active = 1'
  ).bind(fieldId).first();
  if (!existing) return jres({ error: 'Field definition not found' }, 404);

  const fields = [];
  const params = [];

  if (typeof body.name === 'string') {
    const name = body.name.trim();
    if (!name) return jres({ error: 'name cannot be empty' }, 400);
    fields.push('name=?'); params.push(name);
  }
  if (typeof body.field_type === 'string') {
    if (!FIELD_TYPES.includes(body.field_type)) {
      return jres({ error: `field_type must be one of: ${FIELD_TYPES.join(', ')}` }, 400);
    }
    fields.push('field_type=?'); params.push(body.field_type);
  }
  if ('options' in body) {
    if (!Array.isArray(body.options)) {
      return jres({ error: 'options must be an array' }, 400);
    }
    fields.push('options=?'); params.push(JSON.stringify(body.options.map(o => String(o))));
  }
  if (typeof body.sort_order === 'number') {
    fields.push('sort_order=?'); params.push(body.sort_order);
  }

  if (!fields.length) return jres({ ok: true, unchanged: true });

  const ts = now();
  fields.push('updated_at=?'); params.push(ts);
  params.push(fieldId);
  await env.DB.prepare(
    `UPDATE custom_field_defs SET ${fields.join(', ')} WHERE id = ?`
  ).bind(...params).run();

  return jres({ ok: true, updated_at: ts });
}

export async function deleteFieldDef(env, fieldId) {
  const existing = await env.DB.prepare(
    'SELECT id FROM custom_field_defs WHERE id = ? AND active = 1'
  ).bind(fieldId).first();
  if (!existing) return jres({ error: 'Field definition not found' }, 404);

  const ts = now();
  await env.DB.prepare(
    'UPDATE custom_field_defs SET active = 0, updated_at = ? WHERE id = ?'
  ).bind(ts, fieldId).run();

  return jres({ ok: true });
}

// ── Field Values ────────────────────────────────────────────

export async function getCustomValues(env, issueId) {
  const { results } = await env.DB.prepare(
    `SELECT v.field_def_id, d.name, d.field_type, d.options, v.value
     FROM custom_field_values v
     JOIN custom_field_defs d ON d.id = v.field_def_id AND d.active = 1
     WHERE v.issue_id = ?
     ORDER BY d.sort_order ASC`
  ).bind(issueId).all();
  return jres({ values: results || [] });
}

export async function setCustomValues(req, env, issueId) {
  const body = await req.json().catch(() => ({}));
  if (!Array.isArray(body.values)) {
    return jres({ error: 'values must be an array of {field_def_id, value}' }, 400);
  }

  const stmts = [];
  for (const entry of body.values) {
    const fieldDefId = String(entry.field_def_id || '');
    const value = String(entry.value ?? '');
    if (!fieldDefId) continue;
    const id = cfvId();
    stmts.push(
      env.DB.prepare(
        `INSERT OR REPLACE INTO custom_field_values (id, issue_id, field_def_id, value)
         VALUES (
           COALESCE((SELECT id FROM custom_field_values WHERE issue_id = ? AND field_def_id = ?), ?),
           ?, ?, ?
         )`
      ).bind(issueId, fieldDefId, id, issueId, fieldDefId, value)
    );
  }

  if (stmts.length) {
    await env.DB.batch(stmts);
  }

  return getCustomValues(env, issueId);
}

export async function cloneCustomValues(env, sourceIssueId, targetIssueId) {
  const { results } = await env.DB.prepare(
    'SELECT field_def_id, value FROM custom_field_values WHERE issue_id = ?'
  ).bind(sourceIssueId).all();

  if (results && results.length) {
    const stmts = results.map(row =>
      env.DB.prepare(
        `INSERT OR REPLACE INTO custom_field_values (id, issue_id, field_def_id, value)
         VALUES (?, ?, ?, ?)`
      ).bind(cfvId(), targetIssueId, row.field_def_id, row.value)
    );
    await env.DB.batch(stmts);
  }

  return jres({ ok: true, cloned: (results || []).length });
}
