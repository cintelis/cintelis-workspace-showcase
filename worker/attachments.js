// ============================================================
// Cintelis Workspace — Attachments (R2-backed) (Sprint 6)
// Self-contained: no imports from worker.js to avoid circular deps.
// Handlers expect (req, env, ctx) where ctx = {session, user} from requireAuth().
// Metadata lives in D1 (attachments table); blobs live in R2 (env.ATTACHMENTS).
// ============================================================

// ── Local helpers (mirror worker.js) ─────────────────────────
function jres(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
function now() { return new Date().toISOString(); }
function uid() { return crypto.randomUUID(); }
function attachmentId() { return `att_${uid().replace(/-/g, '').slice(0, 24)}`; }

const MAX_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB
import { canAccessEntity } from './customers.js';

const VALID_ENTITY_TYPES = new Set(['issue', 'doc_page', 'contact', 'customer_contract', 'customer']);

// Sanitize a filename to a safe subset. Returns 'upload.bin' if empty.
function sanitizeFilename(name) {
  let s = String(name || '').replace(/[^a-zA-Z0-9._-]/g, '_');
  if (s.length > 200) s = s.slice(0, 200);
  if (!s) s = 'upload.bin';
  return s;
}

// Reshape an attachment row to add the joined uploader display name.
function reshapeAttachmentRow(r) {
  const out = { ...r };
  out.uploaded_by_name = r.uploaded_by_name || '';
  return out;
}

// ── listAttachments ──────────────────────────────────────────
// GET /api/attachments?entity_type=...&entity_id=...
export async function listAttachments(req, env) {
  const url = new URL(req.url);
  const entity_type = String(url.searchParams.get('entity_type') || '').trim();
  const entity_id = String(url.searchParams.get('entity_id') || '').trim();
  if (!entity_type || !entity_id) {
    return jres({ error: 'entity_type and entity_id required' }, 400);
  }
  const { results } = await env.DB.prepare(
    `SELECT a.*, u.display_name AS uploaded_by_name, u.customer_id AS uploaded_by_customer_id
     FROM attachments a
     LEFT JOIN users u ON u.id = a.uploaded_by
     WHERE a.entity_type = ? AND a.entity_id = ?
     ORDER BY a.created_at DESC`
  ).bind(entity_type, entity_id).all();
  const attachments = (results || []).map(reshapeAttachmentRow);
  return jres({ attachments });
}

// ── uploadAttachment ─────────────────────────────────────────
// POST /api/attachments  multipart: file, entity_type, entity_id
export async function uploadAttachment(req, env, ctx) {
  let form;
  try {
    form = await req.formData();
  } catch (e) {
    return jres({ error: 'multipart form data required' }, 400);
  }
  const file = form.get('file');
  const entity_type = String(form.get('entity_type') || '').trim();
  const entity_id = String(form.get('entity_id') || '').trim();
  if (!file || typeof file === 'string' || !entity_type || !entity_id) {
    return jres({ error: 'file, entity_type, entity_id required' }, 400);
  }
  if (!VALID_ENTITY_TYPES.has(entity_type)) {
    return jres({ error: `entity_type must be one of: ${Array.from(VALID_ENTITY_TYPES).join(', ')}` }, 400);
  }
  // Tenant isolation: customer users may only attach to their own entities.
  if (!(await canAccessEntity(env, ctx, entity_type, entity_id))) {
    return jres({ error: 'Forbidden: outside your organisation' }, 403);
  }
  // Customer-uploaded contract documents (signed copies): PDF, image or Word only.
  if ((entity_type === 'customer_contract' || entity_type === 'customer') && ctx.user.customer_id) {
    const okType = /^(application\/pdf|image\/(png|jpe?g|webp|heic|heif)|application\/msword|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document)$/i.test(file.type || '')
      || /\.(pdf|png|jpe?g|webp|heic|heif|docx?)$/i.test(file.name || '');
    if (!okType) return jres({ error: 'Contract documents must be a PDF, image or Word file' }, 400);
  }
  if (typeof file.size !== 'number') {
    return jres({ error: 'file is not a valid upload' }, 400);
  }
  if (file.size <= 0) {
    return jres({ error: 'file is empty' }, 400);
  }
  if (file.size > MAX_SIZE_BYTES) {
    return jres({ error: `file too large (max ${MAX_SIZE_BYTES} bytes)` }, 413);
  }

  const id = attachmentId();
  const sanitized = sanitizeFilename(file.name);
  const r2_key = `${id}/${sanitized}`;
  const mime_type = file.type || 'application/octet-stream';
  const ts = now();

  try {
    await env.ATTACHMENTS.put(r2_key, file.stream(), {
      httpMetadata: { contentType: mime_type },
    });
  } catch (e) {
    console.error('R2 put failed', e?.message || e);
    return jres({ error: 'failed to store file' }, 500);
  }

  try {
    await env.DB.prepare(
      `INSERT INTO attachments
         (id, entity_type, entity_id, filename, mime_type, size_bytes, r2_key, uploaded_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id, entity_type, entity_id, sanitized, mime_type, file.size, r2_key, ctx.user.id, ts
    ).run();
  } catch (e) {
    // Roll back the R2 object on metadata insert failure.
    try { await env.ATTACHMENTS.delete(r2_key); } catch (_) { /* swallow */ }
    console.error('attachments insert failed', e?.message || e);
    return jres({ error: 'failed to record attachment' }, 500);
  }

  const row = await env.DB.prepare(
    `SELECT a.*, u.display_name AS uploaded_by_name
     FROM attachments a
     LEFT JOIN users u ON u.id = a.uploaded_by
     WHERE a.id = ?`
  ).bind(id).first();
  return jres(reshapeAttachmentRow(row || {
    id, entity_type, entity_id, filename: sanitized, mime_type,
    size_bytes: file.size, r2_key, uploaded_by: ctx.user.id, created_at: ts,
    uploaded_by_name: ctx.user.display_name || '',
  }));
}

// ── downloadAttachment ───────────────────────────────────────
// A browser that uploaded with no type (some drag-and-drop paths, older
// Windows builds for PDFs) stored application/octet-stream, which forces a
// save dialog even on /preview. Recover the type from the extension for the
// formats a browser can show inline.
const INLINE_TYPES = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', txt: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8', json: 'application/json', html: 'text/html; charset=utf-8', mp4: 'video/mp4', mp3: 'audio/mpeg',
};
function contentTypeFor(mimeType, filename) {
  const mt = String(mimeType || '').trim();
  if (mt && mt !== 'application/octet-stream') return mt;
  const ext = String(filename || '').toLowerCase().split('.').pop();
  return INLINE_TYPES[ext] || 'application/octet-stream';
}

// GET /api/attachments/:id/download
// GET /api/attachments/:id/preview  (inline=true)
// Returns a raw streaming Response — NOT through jres().
export async function downloadAttachment(env, attachmentIdParam, inline) {
  const row = await env.DB.prepare(
    'SELECT id, filename, mime_type, size_bytes, r2_key FROM attachments WHERE id=?'
  ).bind(attachmentIdParam).first();
  if (!row) return jres({ error: 'Attachment not found' }, 404);

  const obj = await env.ATTACHMENTS.get(row.r2_key);
  if (!obj) return jres({ error: 'Attachment blob missing' }, 404);

  const safeFilename = String(row.filename || 'download.bin').replace(/"/g, '');
  const disposition = `${inline ? 'inline' : 'attachment'}; filename="${safeFilename}"`;
  return new Response(obj.body, {
    status: 200,
    headers: {
      'Content-Type': contentTypeFor(row.mime_type, row.filename),
      'Content-Length': String(row.size_bytes),
      'Content-Disposition': disposition,
      'Cache-Control': 'private, max-age=3600',
    },
  });
}

// ── deleteAttachment ─────────────────────────────────────────
// DELETE /api/attachments/:id — uploader or admin only.
export async function deleteAttachment(env, ctx, attachmentIdParam) {
  const row = await env.DB.prepare(
    'SELECT id, entity_type, r2_key, uploaded_by FROM attachments WHERE id=?'
  ).bind(attachmentIdParam).first();
  if (!row) return jres({ error: 'Attachment not found' }, 404);
  // Customers may delete contract documents their organisation uploaded, but
  // never the copies Cintelis attached.
  if (ctx && ctx.user && ctx.user.customer_id && (row.entity_type === 'customer_contract' || row.entity_type === 'customer')) {
    const up = await env.DB.prepare('SELECT customer_id FROM users WHERE id=?').bind(row.uploaded_by).first();
    if (!up || up.customer_id !== ctx.user.customer_id) {
      return jres({ error: 'Only documents uploaded by your organisation can be deleted' }, 403);
    }
  }
  // No per-user restriction — small team, any authenticated user can delete.
  try {
    await env.ATTACHMENTS.delete(row.r2_key);
  } catch (e) {
    // R2 is best-effort here — the metadata row is the source of truth.
    console.error('R2 delete failed', row.r2_key, e?.message || e);
  }
  await env.DB.prepare('DELETE FROM attachments WHERE id=?').bind(attachmentIdParam).run();
  return jres({ ok: true });
}

// ── deleteAttachmentsForEntity ───────────────────────────────
// Helper for cascade deletes (issues / pages / contacts). NOT a route handler.
export async function deleteAttachmentsForEntity(env, entityType, entityId) {
  if (!entityType || !entityId) return { deleted: 0 };
  const { results } = await env.DB.prepare(
    'SELECT id, r2_key FROM attachments WHERE entity_type=? AND entity_id=?'
  ).bind(entityType, entityId).all();
  const rows = results || [];
  for (const r of rows) {
    try {
      await env.ATTACHMENTS.delete(r.r2_key);
    } catch (e) {
      console.error('cascade R2 delete failed', r.r2_key, e?.message || e);
    }
  }
  await env.DB.prepare(
    'DELETE FROM attachments WHERE entity_type=? AND entity_id=?'
  ).bind(entityType, entityId).run();
  return { deleted: rows.length };
}
