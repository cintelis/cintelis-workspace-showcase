// ============================================================
// Cintelis Workspace — Docs (spaces + pages + version history)
// All handlers expect (req, env, ctx) where ctx = {session, user} from
// requireAuth(). They return Response objects via the local jres() helper.
// Self-contained: no imports from worker.js to avoid circular deps.
// Role gating happens in worker.js; handlers here only enforce validation.
// ============================================================

import { emit, EVENT_TYPES } from './events.js';
import { parseMentionsAndNotify } from './notifications.js';
import { deleteAttachmentsForEntity } from './attachments.js';
import { deleteLinksForEntity } from './entity-links.js';
import { customerIdForCreate } from './customers.js';
import { scopedAll, scopedFirst, scopedRun, scopedInsert, ALL_SCOPE } from './scope.js';

// ── Local helpers (mirror worker.js) ─────────────────────────
function jres(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
function now() { return new Date().toISOString(); }
function uid() { return crypto.randomUUID(); }
function spaceIdGen() { return `dsp_${uid().replace(/-/g, '').slice(0, 24)}`; }
function pageIdGen() { return `dpg_${uid().replace(/-/g, '').slice(0, 24)}`; }
function versionIdGen() { return `dpv_${uid().replace(/-/g, '').slice(0, 24)}`; }

const SPACE_KEY_RE = /^[A-Z][A-Z0-9]{1,9}$/;

// ── Slug helpers ─────────────────────────────────────────────
function slugify(title) {
  return String(title || '').toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60) || 'untitled';
}

// Return a unique slug within (space_id, parent_id). If baseSlug collides,
// append -2, -3, ... Excludes excludePageId (used on rename to avoid self-collision).
async function uniqueSlugInParent(env, sId, parentId, baseSlug, excludePageId) {
  const where = ['space_id = ?', 'active = 1'];
  const params = [sId];
  if (parentId) { where.push('parent_id = ?'); params.push(parentId); }
  else { where.push('parent_id IS NULL'); }
  if (excludePageId) { where.push('id != ?'); params.push(excludePageId); }
  const { results } = await env.DB.prepare(
    `SELECT slug FROM doc_pages WHERE ${where.join(' AND ')}`
  ).bind(...params).all();
  const taken = new Set((results || []).map(r => r.slug));
  if (!taken.has(baseSlug)) return baseSlug;
  let i = 2;
  while (taken.has(`${baseSlug}-${i}`)) i++;
  return `${baseSlug}-${i}`;
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

// Decorate a list of page rows with updated_by_name (and created_by_name if present).
async function joinUsersForPages(env, pages) {
  if (!pages || !pages.length) return pages || [];
  const ids = [];
  for (const p of pages) {
    if (p.updated_by) ids.push(p.updated_by);
    if (p.created_by) ids.push(p.created_by);
  }
  const map = await joinUsers(env, ids);
  for (const p of pages) {
    const u = p.updated_by ? map[p.updated_by] : null;
    p.updated_by_name = u ? (u.display_name || u.email || '') : '';
    if (p.created_by) {
      const c = map[p.created_by];
      p.created_by_name = c ? (c.display_name || c.email || '') : '';
    }
  }
  return pages;
}

// Insert a version row snapshotting a page's current state. Returns the new version id.
async function snapshotPage(env, page, authorId) {
  const id = versionIdGen();
  const ts = now();
  await env.DB.prepare(
    `INSERT INTO doc_page_versions (id, page_id, title, content_md, author_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(id, page.id, page.title, page.content_md || '', authorId || null, ts).run();
  return id;
}

// Collect a page + all descendant page ids via BFS and soft-delete them all in
// one UPDATE. Returns the array of affected ids.
async function cascadeSoftDeletePage(env, rootPageId) {
  const collected = [rootPageId];
  const queue = [rootPageId];
  while (queue.length) {
    const current = queue.shift();
    const { results } = await env.DB.prepare(
      'SELECT id FROM doc_pages WHERE parent_id=? AND active=1'
    ).bind(current).all();
    for (const r of (results || [])) {
      collected.push(r.id);
      queue.push(r.id);
    }
  }
  const ts = now();
  const placeholders = collected.map(() => '?').join(',');
  await env.DB.prepare(
    `UPDATE doc_pages SET active=0, updated_at=? WHERE id IN (${placeholders})`
  ).bind(ts, ...collected).run();
  return collected;
}

// ── Spaces ───────────────────────────────────────────────────
export async function listSpaces(env, ctx, url) {
  // Tenant scoping via worker/scope.js (customer session, or staff ?customer_id=).
  const spaces = await scopedAll(env, ctx, {
    sql: `SELECT s.*, c.name AS customer_name FROM doc_spaces s LEFT JOIN customers c ON c.id = s.customer_id WHERE s.active = 1 AND /*SCOPE*/ ORDER BY s.key ASC`,
    alias: 's', url,
  });
  const { results: counts } = await env.DB.prepare(
    `SELECT space_id, COUNT(*) AS n
     FROM doc_pages WHERE active=1
     GROUP BY space_id`
  ).all();
  const countsBySpace = {};
  for (const row of (counts || [])) {
    countsBySpace[row.space_id] = row.n;
  }
  return jres({
    spaces: (spaces || []).map(s => ({
      ...s,
      page_count: countsBySpace[s.id] || 0,
    })),
  });
}

export async function createSpace(req, env, ctx) {
  const body = await req.json().catch(() => ({}));
  const scoped = await customerIdForCreate(env, ctx, body.customer_id);
  if (scoped.error) return scoped.error;
  const key = String(body.key || '').trim().toUpperCase();
  const name = String(body.name || '').trim();
  if (!SPACE_KEY_RE.test(key)) {
    return jres({ error: 'key must be 2–10 uppercase alphanumerics starting with a letter' }, 400);
  }
  if (!name) return jres({ error: 'name required' }, 400);
  // ALL_SCOPE: space keys are unique across tenants (the schema says so), so the
  // clash check must see every tenant's rows. Only an id leaks, never a name.
  const exists = await scopedFirst(env, ctx, { sql: 'SELECT s.id FROM doc_spaces s WHERE s.key=? AND /*SCOPE*/', binds: [key], alias: 's', scope: ALL_SCOPE });
  if (exists) return jres({ error: 'A space with that key already exists' }, 409);
  const id = spaceIdGen();
  const ts = now();
  const description_md = String(body.description_md || '');
  const icon = String(body.icon || '');
  await scopedInsert(env, ctx, {
    table: 'doc_spaces',
    row: { id, key, name, description_md, icon, active: 1, created_by: ctx.user.id, created_at: ts, updated_at: ts },
    requested: scoped.customer_id,
  });
  return jres({
    id, key, name, description_md, icon, active: 1,
    created_by: ctx.user.id, created_at: ts, updated_at: ts,
  });
}

export async function getSpace(env, ctx, sId) {
  const space = await scopedFirst(env, ctx, { sql: 'SELECT s.* FROM doc_spaces s WHERE s.id=? AND s.active=1 AND /*SCOPE*/', binds: [sId], alias: 's' });
  if (!space) return jres({ error: 'Space not found' }, 404);
  const { results } = await env.DB.prepare(
    `SELECT * FROM doc_pages
     WHERE space_id=? AND active=1
     ORDER BY
       CASE WHEN parent_id IS NULL THEN 0 ELSE 1 END,
       parent_id ASC,
       position ASC,
       title ASC`
  ).bind(sId).all();
  const pages = await joinUsersForPages(env, results || []);
  return jres({ space, pages });
}

export async function listSpacePages(env, ctx, sId) {
  const space = await scopedFirst(env, ctx, { sql: 'SELECT s.id FROM doc_spaces s WHERE s.id=? AND s.active=1 AND /*SCOPE*/', binds: [sId], alias: 's' });
  if (!space) return jres({ error: 'Space not found' }, 404);
  const { results } = await env.DB.prepare(
    `SELECT * FROM doc_pages
     WHERE space_id=? AND active=1
     ORDER BY
       CASE WHEN parent_id IS NULL THEN 0 ELSE 1 END,
       parent_id ASC,
       position ASC,
       title ASC`
  ).bind(sId).all();
  const pages = await joinUsersForPages(env, results || []);
  return jres({ pages });
}

export async function patchSpace(req, env, ctx, sId) {
  const body = await req.json().catch(() => ({}));
  const existing = await scopedFirst(env, ctx, { sql: 'SELECT s.* FROM doc_spaces s WHERE s.id=? AND s.active=1 AND /*SCOPE*/', binds: [sId], alias: 's' });
  if (!existing) return jres({ error: 'Space not found' }, 404);
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
  if (typeof body.icon === 'string') {
    fields.push('icon=?'); params.push(body.icon);
  }
  if (!fields.length) return jres({ ok: true, unchanged: true });
  const ts = now();
  fields.push('updated_at=?'); params.push(ts);
  params.push(sId);
  await scopedRun(env, ctx, { sql: `UPDATE doc_spaces SET ${fields.join(', ')} WHERE id=? AND /*SCOPE*/`, binds: params, alias: 'doc_spaces' });
  return jres({ ok: true, updated_at: ts });
}

// Soft delete + cascade soft-delete all pages in the space.
export async function deleteSpace(env, ctx, sId) {
  const existing = await scopedFirst(env, ctx, { sql: 'SELECT s.id FROM doc_spaces s WHERE s.id=? AND s.active=1 AND /*SCOPE*/', binds: [sId], alias: 's' });
  if (!existing) return jres({ error: 'Space not found' }, 404);
  const ts = now();
  await scopedRun(env, ctx, { sql: 'UPDATE doc_spaces SET active=0, updated_at=? WHERE id=? AND /*SCOPE*/', binds: [ts, sId], alias: 'doc_spaces' });
  await env.DB.prepare('UPDATE doc_pages SET active=0, updated_at=? WHERE space_id=?').bind(ts, sId).run();
  return jres({ ok: true });
}

// ── Pages ────────────────────────────────────────────────────
export async function createPage(req, env, ctx, sId) {
  const body = await req.json().catch(() => ({}));
  const title = String(body.title || '').trim();
  if (!title) return jres({ error: 'title required' }, 400);

  const space = await scopedFirst(env, ctx, { sql: 'SELECT s.id FROM doc_spaces s WHERE s.id=? AND s.active=1 AND /*SCOPE*/', binds: [sId], alias: 's' });
  if (!space) return jres({ error: 'Space not found' }, 404);

  let parentId = body.parent_id || null;
  if (parentId) {
    const parent = await env.DB.prepare(
      'SELECT id FROM doc_pages WHERE id=? AND space_id=? AND active=1'
    ).bind(parentId, sId).first();
    if (!parent) return jres({ error: 'parent_id not found in this space' }, 400);
  }

  const baseSlug = slugify(title);
  const slug = await uniqueSlugInParent(env, sId, parentId, baseSlug);

  let position;
  if (typeof body.position === 'number' && Number.isFinite(body.position)) {
    position = Math.floor(body.position);
  } else {
    const row = parentId
      ? await env.DB.prepare(
          'SELECT MAX(position) AS maxp FROM doc_pages WHERE space_id=? AND parent_id=? AND active=1'
        ).bind(sId, parentId).first()
      : await env.DB.prepare(
          'SELECT MAX(position) AS maxp FROM doc_pages WHERE space_id=? AND parent_id IS NULL AND active=1'
        ).bind(sId).first();
    position = (row && row.maxp != null) ? (row.maxp + 1) : 0;
  }

  const id = pageIdGen();
  const ts = now();
  const content_md = String(body.content_md || '');
  await env.DB.prepare(
    `INSERT INTO doc_pages (id, space_id, parent_id, title, slug, content_md, position, active,
                             created_by, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`
  ).bind(
    id, sId, parentId, title, slug, content_md, position,
    ctx.user.id, ctx.user.id, ts, ts
  ).run();

  // Initial version snapshot
  await snapshotPage(env, { id, title, content_md }, ctx.user.id);

  await emit(env, EVENT_TYPES.DOC_PAGE_CREATED, {
    page_id: id, space_id: sId, title, actor: ctx.user,
  });

  if (content_md && content_md.trim()) {
    await parseMentionsAndNotify(env, {
      body_md: content_md,
      entity_type: 'doc_page',
      entity_id: id,
      actor: ctx.user,
      link: `/?nav=docs&space=${sId}&page=${id}`,
      title: `${ctx.user.display_name || ctx.user.email} mentioned you in a doc page`,
    });
  }

  return jres({
    id, space_id: sId, parent_id: parentId, title, slug, content_md, position,
    active: 1, created_by: ctx.user.id, updated_by: ctx.user.id,
    created_at: ts, updated_at: ts,
  });
}

export async function getPage(env, ctx, pgId) {
  const row = await env.DB.prepare(
    `SELECT p.*,
            cu.display_name AS created_by_display_name, cu.email AS created_by_email,
            uu.display_name AS updated_by_display_name, uu.email AS updated_by_email
     FROM doc_pages p
     LEFT JOIN users cu ON cu.id = p.created_by
     LEFT JOIN users uu ON uu.id = p.updated_by
     WHERE p.id=? AND p.active=1`
  ).bind(pgId).first();
  if (!row) return jres({ error: 'Page not found' }, 404);

  // A page's tenant is its space's; a page in a space this session may not
  // see is answered as not found rather than served with `space: null`.
  const space = await scopedFirst(env, ctx, { sql: 'SELECT s.id, s.key, s.name FROM doc_spaces s WHERE s.id=? AND /*SCOPE*/', binds: [row.space_id], alias: 's' });
  if (!space) return jres({ error: 'Page not found' }, 404);

  let parent = null;
  if (row.parent_id) {
    const p = await env.DB.prepare(
      'SELECT id, title FROM doc_pages WHERE id=? AND active=1'
    ).bind(row.parent_id).first();
    if (p) parent = { id: p.id, title: p.title };
  }

  const { results: childRows } = await env.DB.prepare(
    `SELECT id, title, slug FROM doc_pages
     WHERE parent_id=? AND active=1
     ORDER BY position ASC, title ASC`
  ).bind(pgId).all();
  const children = (childRows || []).map(c => ({ id: c.id, title: c.title, slug: c.slug }));

  const vc = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM doc_page_versions WHERE page_id=?'
  ).bind(pgId).first();
  const version_count = (vc && vc.n) || 0;

  const page = { ...row };
  page.created_by_name = row.created_by_display_name || row.created_by_email || '';
  page.updated_by_name = row.updated_by_display_name || row.updated_by_email || '';
  delete page.created_by_display_name;
  delete page.created_by_email;
  delete page.updated_by_display_name;
  delete page.updated_by_email;

  return jres({
    page,
    space: space ? { id: space.id, key: space.key, name: space.name } : null,
    parent,
    children,
    version_count,
  });
}

export async function getPageBySlug(env, ctx, spaceKey, slug) {
  // Resolve space by key
  const space = await scopedFirst(env, ctx, { sql: 'SELECT s.id, s.key, s.name FROM doc_spaces s WHERE s.key=? AND s.active=1 AND /*SCOPE*/', binds: [spaceKey.toUpperCase()], alias: 's' });
  if (!space) return jres({ error: 'Space not found' }, 404);
  // Find the page by slug within that space
  const row = await env.DB.prepare(
    'SELECT id FROM doc_pages WHERE space_id=? AND slug=? AND active=1'
  ).bind(space.id, slug).first();
  if (!row) return jres({ error: 'Page not found' }, 404);
  // Delegate to getPage for the full response
  return getPage(env, ctx, row.id);
}

export async function patchPage(req, env, ctx, pgId) {
  const body = await req.json().catch(() => ({}));
  const existing = await env.DB.prepare(
    'SELECT * FROM doc_pages WHERE id=? AND active=1'
  ).bind(pgId).first();
  if (!existing) return jres({ error: 'Page not found' }, 404);

  const updates = {};

  if (typeof body.title === 'string') {
    const t = body.title.trim();
    if (!t) return jres({ error: 'title cannot be empty' }, 400);
    if (t !== existing.title) updates.title = t;
  }
  if (typeof body.content_md === 'string' && body.content_md !== existing.content_md) {
    updates.content_md = body.content_md;
  }

  // Parent change: must exist in same space, cannot be self, cannot create cycles.
  let parentChanged = false;
  if ('parent_id' in body) {
    const newParent = body.parent_id || null;
    if (newParent !== existing.parent_id) {
      if (newParent) {
        if (newParent === pgId) return jres({ error: 'A page cannot be its own parent' }, 400);
        const parent = await env.DB.prepare(
          'SELECT id, space_id FROM doc_pages WHERE id=? AND active=1'
        ).bind(newParent).first();
        if (!parent) return jres({ error: 'parent_id not found' }, 400);
        if (parent.space_id !== existing.space_id) {
          return jres({ error: 'parent_id must be in the same space' }, 400);
        }
        // Cycle check: walk up from newParent; if we hit pgId, reject.
        let cursor = newParent;
        const seen = new Set();
        while (cursor) {
          if (cursor === pgId) return jres({ error: 'parent_id would create a cycle' }, 400);
          if (seen.has(cursor)) break;
          seen.add(cursor);
          const up = await env.DB.prepare('SELECT parent_id FROM doc_pages WHERE id=?').bind(cursor).first();
          cursor = up ? up.parent_id : null;
        }
      }
      updates.parent_id = newParent;
      parentChanged = true;
    }
  }

  let explicitPosition = false;
  if ('position' in body && typeof body.position === 'number' && Number.isFinite(body.position)) {
    const p = Math.floor(body.position);
    if (p !== existing.position) {
      updates.position = p;
      explicitPosition = true;
    } else {
      explicitPosition = true;
    }
  }

  if (!Object.keys(updates).length && !parentChanged) {
    return jres({ ok: true, unchanged: true });
  }

  // Determine if this is a content/title change (triggers version snapshot).
  const contentDelta = ('title' in updates) || ('content_md' in updates);

  // Recompute slug if title changed OR parent changed, to keep uniqueness within parent.
  let newSlug = null;
  if ('title' in updates || parentChanged) {
    const baseTitle = updates.title != null ? updates.title : existing.title;
    const effectiveParent = parentChanged ? updates.parent_id : existing.parent_id;
    const base = slugify(baseTitle);
    newSlug = await uniqueSlugInParent(env, existing.space_id, effectiveParent, base, pgId);
    if (newSlug !== existing.slug) {
      updates.slug = newSlug;
    }
  }

  // If parent changed and caller did not pass an explicit position, reset to MAX+1 in new parent.
  if (parentChanged && !explicitPosition) {
    const newParent = updates.parent_id;
    const row = newParent
      ? await env.DB.prepare(
          'SELECT MAX(position) AS maxp FROM doc_pages WHERE space_id=? AND parent_id=? AND active=1 AND id != ?'
        ).bind(existing.space_id, newParent, pgId).first()
      : await env.DB.prepare(
          'SELECT MAX(position) AS maxp FROM doc_pages WHERE space_id=? AND parent_id IS NULL AND active=1 AND id != ?'
        ).bind(existing.space_id, pgId).first();
    updates.position = (row && row.maxp != null) ? (row.maxp + 1) : 0;
  }

  // Snapshot the OLD state before updating (only for content/title changes).
  if (contentDelta) {
    await snapshotPage(env, existing, existing.updated_by);
  }

  const ts = now();
  const setFragments = [];
  const params = [];
  for (const [k, v] of Object.entries(updates)) {
    setFragments.push(`${k}=?`);
    params.push(v);
  }
  setFragments.push('updated_by=?'); params.push(ctx.user.id);
  setFragments.push('updated_at=?'); params.push(ts);
  params.push(pgId);
  await env.DB.prepare(
    `UPDATE doc_pages SET ${setFragments.join(', ')} WHERE id=?`
  ).bind(...params).run();

  await emit(env, EVENT_TYPES.DOC_PAGE_UPDATED, {
    page_id: pgId,
    changed_fields: Object.keys(updates),
    actor: ctx.user,
  });

  if ('content_md' in updates) {
    await parseMentionsAndNotify(env, {
      body_md: updates.content_md,
      entity_type: 'doc_page',
      entity_id: pgId,
      actor: ctx.user,
      link: `/?nav=docs&space=${existing.space_id}&page=${pgId}`,
      title: `${ctx.user.display_name || ctx.user.email} mentioned you in a doc page`,
    });
  }

  return getPage(env, ctx, pgId);
}

export async function deletePage(env, pgId) {
  const existing = await env.DB.prepare(
    'SELECT id, space_id, title FROM doc_pages WHERE id=? AND active=1'
  ).bind(pgId).first();
  if (!existing) return jres({ error: 'Page not found' }, 404);
  const ids = await cascadeSoftDeletePage(env, pgId);
  await deleteAttachmentsForEntity(env, 'doc_page', pgId);
  await deleteLinksForEntity(env, 'doc_page', pgId);
  await emit(env, EVENT_TYPES.DOC_PAGE_DELETED, {
    page_id: pgId, space_id: existing.space_id, deleted_ids: ids,
  });
  return jres({ ok: true, deleted_count: ids.length });
}

// ── Versions ─────────────────────────────────────────────────
function reshapeVersionRow(r) {
  const out = { ...r };
  out.author = r.author_id
    ? { id: r.author_id, display_name: r.author_display_name || '', email: r.author_email || '' }
    : null;
  out.author_name = r.author_display_name || r.author_email || '';
  delete out.author_display_name;
  delete out.author_email;
  return out;
}

export async function listPageVersions(env, pgId) {
  const page = await env.DB.prepare(
    'SELECT id FROM doc_pages WHERE id=? AND active=1'
  ).bind(pgId).first();
  if (!page) return jres({ error: 'Page not found' }, 404);
  const { results } = await env.DB.prepare(
    `SELECT v.*, u.display_name AS author_display_name, u.email AS author_email
     FROM doc_page_versions v
     LEFT JOIN users u ON u.id = v.author_id
     WHERE v.page_id=?
     ORDER BY v.created_at DESC`
  ).bind(pgId).all();
  return jres({ versions: (results || []).map(reshapeVersionRow) });
}

export async function getPageVersion(env, pgId, verId) {
  const row = await env.DB.prepare(
    `SELECT v.*, u.display_name AS author_display_name, u.email AS author_email
     FROM doc_page_versions v
     LEFT JOIN users u ON u.id = v.author_id
     WHERE v.id=?`
  ).bind(verId).first();
  if (!row || row.page_id !== pgId) return jres({ error: 'Version not found' }, 404);
  return jres({ version: reshapeVersionRow(row) });
}

export async function restorePageVersion(req, env, ctx, pgId, verId) {
  const page = await env.DB.prepare(
    'SELECT * FROM doc_pages WHERE id=? AND active=1'
  ).bind(pgId).first();
  if (!page) return jres({ error: 'Page not found' }, 404);
  const version = await env.DB.prepare(
    'SELECT * FROM doc_page_versions WHERE id=?'
  ).bind(verId).first();
  if (!version || version.page_id !== pgId) return jres({ error: 'Version not found' }, 404);

  // Snapshot CURRENT state first (so the restore is itself reversible).
  await snapshotPage(env, page, page.updated_by);

  const ts = now();
  await env.DB.prepare(
    `UPDATE doc_pages SET title=?, content_md=?, updated_by=?, updated_at=? WHERE id=?`
  ).bind(version.title, version.content_md || '', ctx.user.id, ts, pgId).run();

  await emit(env, EVENT_TYPES.DOC_PAGE_UPDATED, {
    page_id: pgId,
    changed_fields: ['title', 'content_md'],
    restored_from: verId,
    actor: ctx.user,
  });

  return getPage(env, ctx, pgId);
}
