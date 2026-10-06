// Public v1 doc-pages API — designed for cron jobs and integrations.
// Authenticated by API token (Authorization: Bearer pat_...).
// Upsert by (space_key, parent_slug, slug): existing pages have their
// current state snapshotted to doc_page_versions, then are overwritten.

import { scopedFirst } from './scope.js';

function jres(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function isoNow() { return new Date().toISOString(); }
function pageIdGen() { return 'dpg_' + crypto.randomUUID().replace(/-/g, '').slice(0, 24); }
function versionIdGen() { return 'dpv_' + crypto.randomUUID().replace(/-/g, '').slice(0, 24); }

function slugify(s) {
  return String(s || '').toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60) || 'untitled';
}

async function snapshot(env, page, authorId) {
  await env.DB.prepare(
    `INSERT INTO doc_page_versions (id, page_id, title, content_md, author_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(versionIdGen(), page.id, page.title, page.content_md || '', authorId || null, isoNow()).run();
}

// Scoped by the token's tenant: a customer token reaches only its own spaces,
// an internal (Cintelis) token any space, like a staff session.
async function getSpaceByKey(env, ctx, key) {
  if (!key) return null;
  return scopedFirst(env, ctx, { sql: 'SELECT s.id, s.key, s.name FROM doc_spaces s WHERE s.key=? AND s.active=1 AND /*SCOPE*/', binds: [String(key).toUpperCase()], alias: 's' });
}

async function findPageBySlug(env, spaceId, parentId, slug) {
  if (parentId) {
    return env.DB.prepare(
      'SELECT * FROM doc_pages WHERE space_id=? AND parent_id=? AND slug=? AND active=1'
    ).bind(spaceId, parentId, slug).first();
  }
  return env.DB.prepare(
    'SELECT * FROM doc_pages WHERE space_id=? AND parent_id IS NULL AND slug=? AND active=1'
  ).bind(spaceId, slug).first();
}

// POST /api/v1/docs/pages — create or upsert a page
//   Body: { space_key, title, content_md, slug?, parent_slug? }
//   Behaviour: if a page with the same (space, parent, slug) exists, snapshot
//   the current state to history, then overwrite. Otherwise insert a new page.
export async function apiV1UpsertPage(req, env, ctx) {
  const body = await req.json().catch(() => ({}));
  const spaceKey = String(body.space_key || '').trim();
  const title = String(body.title || '').trim();
  const contentMd = String(body.content_md || '');
  if (!spaceKey) return jres({ error: 'space_key required' }, 400);
  if (!title) return jres({ error: 'title required' }, 400);

  const space = await getSpaceByKey(env, ctx, spaceKey);
  if (!space) return jres({ error: 'Space not found: ' + spaceKey }, 404);

  // Resolve parent (top-level if not provided)
  let parentId = null;
  if (body.parent_slug) {
    const parentSlug = slugify(body.parent_slug);
    const parent = await env.DB.prepare(
      'SELECT id FROM doc_pages WHERE space_id=? AND parent_id IS NULL AND slug=? AND active=1'
    ).bind(space.id, parentSlug).first();
    if (!parent) return jres({ error: 'parent_slug not found at top level: ' + body.parent_slug }, 400);
    parentId = parent.id;
  }

  const slug = body.slug ? slugify(body.slug) : slugify(title);
  const existing = await findPageBySlug(env, space.id, parentId, slug);
  const ts = isoNow();

  if (existing) {
    // Upsert: snapshot current state, then overwrite.
    await snapshot(env, existing, ctx.user.id);
    await env.DB.prepare(
      `UPDATE doc_pages
       SET title=?, content_md=?, updated_by=?, updated_at=?
       WHERE id=?`
    ).bind(title, contentMd, ctx.user.id, ts, existing.id).run();
    const refreshed = await env.DB.prepare(
      'SELECT id, space_id, parent_id, title, slug, content_md, created_at, updated_at FROM doc_pages WHERE id=?'
    ).bind(existing.id).first();
    return jres({ page: refreshed, action: 'updated' });
  }

  // New page — append to end of its sibling group.
  const posRow = parentId
    ? await env.DB.prepare('SELECT MAX(position) AS maxp FROM doc_pages WHERE space_id=? AND parent_id=? AND active=1').bind(space.id, parentId).first()
    : await env.DB.prepare('SELECT MAX(position) AS maxp FROM doc_pages WHERE space_id=? AND parent_id IS NULL AND active=1').bind(space.id).first();
  const position = (posRow && posRow.maxp != null) ? (posRow.maxp + 1) : 0;
  const id = pageIdGen();
  await env.DB.prepare(
    `INSERT INTO doc_pages (id, space_id, parent_id, title, slug, content_md, position, active,
                             created_by, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`
  ).bind(id, space.id, parentId, title, slug, contentMd, position, ctx.user.id, ctx.user.id, ts, ts).run();
  await snapshot(env, { id, title, content_md: contentMd }, ctx.user.id);
  const created = await env.DB.prepare(
    'SELECT id, space_id, parent_id, title, slug, content_md, created_at, updated_at FROM doc_pages WHERE id=?'
  ).bind(id).first();
  return jres({ page: created, action: 'created' }, 201);
}

// GET /api/v1/docs/pages?space=BSM&slug=foo[&parent_slug=bar]
export async function apiV1GetPage(env, ctx, url) {
  const spaceKey = url.searchParams.get('space');
  const slug = url.searchParams.get('slug');
  if (!spaceKey || !slug) return jres({ error: 'space and slug query params required' }, 400);
  const space = await getSpaceByKey(env, ctx, spaceKey);
  if (!space) return jres({ error: 'Space not found' }, 404);
  let parentId = null;
  const parentSlug = url.searchParams.get('parent_slug');
  if (parentSlug) {
    const parent = await env.DB.prepare(
      'SELECT id FROM doc_pages WHERE space_id=? AND parent_id IS NULL AND slug=? AND active=1'
    ).bind(space.id, slugify(parentSlug)).first();
    if (!parent) return jres({ error: 'parent_slug not found' }, 404);
    parentId = parent.id;
  }
  const page = await findPageBySlug(env, space.id, parentId, slugify(slug));
  if (!page) return jres({ error: 'Page not found' }, 404);
  return jres({
    page: {
      id: page.id, space_id: page.space_id, parent_id: page.parent_id,
      title: page.title, slug: page.slug, content_md: page.content_md,
      created_at: page.created_at, updated_at: page.updated_at,
    },
  });
}

// DELETE /api/v1/docs/pages?space=BSM&slug=foo[&parent_slug=bar]
export async function apiV1DeletePage(env, ctx, url) {
  const spaceKey = url.searchParams.get('space');
  const slug = url.searchParams.get('slug');
  if (!spaceKey || !slug) return jres({ error: 'space and slug query params required' }, 400);
  const space = await getSpaceByKey(env, ctx, spaceKey);
  if (!space) return jres({ error: 'Space not found' }, 404);
  let parentId = null;
  const parentSlug = url.searchParams.get('parent_slug');
  if (parentSlug) {
    const parent = await env.DB.prepare(
      'SELECT id FROM doc_pages WHERE space_id=? AND parent_id IS NULL AND slug=? AND active=1'
    ).bind(space.id, slugify(parentSlug)).first();
    if (!parent) return jres({ error: 'parent_slug not found' }, 404);
    parentId = parent.id;
  }
  const page = await findPageBySlug(env, space.id, parentId, slugify(slug));
  if (!page) return jres({ error: 'Page not found' }, 404);
  // Soft-delete (matches existing deletePage in worker/docs.js): preserves
  // version history and avoids breaking links from elsewhere.
  await env.DB.prepare(
    `UPDATE doc_pages SET active=0, updated_by=?, updated_at=? WHERE id=?`
  ).bind(ctx.user.id, isoNow(), page.id).run();
  return jres({ ok: true, deleted_id: page.id });
}
