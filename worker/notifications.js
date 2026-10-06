import { PUBLIC_BASE_URL } from './config.js';
// ============================================================
// Cintelis Workspace — In-app notifications + @mention parser (Sprint 5)
// Self-contained: no imports from worker.js to avoid circular deps.
// Handlers expect (req, env, ctx) where ctx = {session, user} from requireAuth().
// ============================================================

// ── Local helpers (mirror worker.js) ─────────────────────────
function jres(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
function now() { return new Date().toISOString(); }
function uid() { return crypto.randomUUID(); }
function notifId() { return `ntf_${uid().replace(/-/g, '').slice(0, 24)}`; }

// Match @-followed-by a name. 2–40 chars of [A-Za-z0-9._-]. Requires a
// whitespace (or start-of-string) before the @ so we don't match email
// addresses mid-sentence. The `g` flag lets us scan the whole body.
const MENTION_RE = /(?:^|\s)@([a-zA-Z0-9._-]{2,40})/g;

// ── extractMentionExcerpt ────────────────────────────────────
// Return a short single-line excerpt around the mention site. Falls back to
// the whole (cleaned) body when the position is unknown.
function extractMentionExcerpt(body, mentionAt) {
  const clean = String(body || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const MAX = 120;
  if (clean.length <= MAX) return clean;
  // When we have a position, center the window on it; otherwise take the head.
  let start = 0;
  if (typeof mentionAt === 'number' && mentionAt > 0) {
    // mentionAt is a position in the ORIGINAL (not-cleaned) string, which is
    // close enough for a rough window. Center a MAX-char window around it.
    start = Math.max(0, Math.min(clean.length - MAX, mentionAt - Math.floor(MAX / 2)));
  }
  const slice = clean.slice(start, start + MAX - 1);
  const prefix = start > 0 ? '…' : '';
  const suffix = (start + MAX - 1) < clean.length ? '…' : '';
  return prefix + slice + suffix;
}

// ── createNotification ───────────────────────────────────────
// Internal API for handlers to call. Inserts one notification row and
// returns it. Silently no-ops if required fields are missing (this is an
// internal helper; callers are trusted but we defend against bad input).
export async function createNotification(env, opts) {
  const {
    user_id, kind, entity_type, entity_id,
    title, body, link, actor_id,
  } = opts || {};
  if (!user_id || !kind || !entity_type || !entity_id || !title) {
    console.error('createNotification: missing required fields', opts);
    return null;
  }
  const id = notifId();
  const ts = now();
  await env.DB.prepare(
    `INSERT INTO notifications
       (id, user_id, kind, entity_type, entity_id, title, body, link, actor_id, read_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`
  ).bind(
    id, user_id, kind, entity_type, entity_id,
    String(title), String(body || ''), link || null, actor_id || null, ts
  ).run();
  return {
    id, user_id, kind, entity_type, entity_id,
    title: String(title), body: String(body || ''),
    link: link || null, actor_id: actor_id || null,
    read_at: null, created_at: ts,
  };
}

// ── parseMentionsAndNotify ───────────────────────────────────
// Scan `body_md` for @mentions, resolve candidates against active users,
// and insert a mention notification for each match. Returns the array of
// matched user rows so the caller can log / act on them.
export async function parseMentionsAndNotify(env, opts) {
  const { body_md, entity_type, entity_id, actor, link, title } = opts || {};
  if (!body_md || !entity_type || !entity_id) return [];

  // 1. Extract candidate names. Track first-match position per candidate
  //    so we can center the excerpt on it.
  const candidates = new Map(); // slug -> first position
  // Reset lastIndex defensively since MENTION_RE has the `g` flag and is shared.
  MENTION_RE.lastIndex = 0;
  let m;
  while ((m = MENTION_RE.exec(body_md)) !== null) {
    const slug = m[1].toLowerCase();
    if (!candidates.has(slug)) candidates.set(slug, m.index);
  }
  if (!candidates.size) return [];

  // 2. Resolve against active users.
  const { results: users } = await env.DB.prepare(
    `SELECT id, email, display_name FROM users WHERE active = 1`
  ).all();

  const matched = [];
  const seen = new Set();
  for (const u of (users || [])) {
    if (actor && u.id === actor.id) continue;
    if (seen.has(u.id)) continue;
    const emailPrefix = String(u.email || '').split('@')[0].toLowerCase();
    const nameSlug = String(u.display_name || '').toLowerCase().replace(/\s+/g, '');
    let hit = null;
    if (emailPrefix && candidates.has(emailPrefix)) hit = candidates.get(emailPrefix);
    else if (nameSlug && candidates.has(nameSlug))   hit = candidates.get(nameSlug);
    if (hit == null) continue;
    seen.add(u.id);
    matched.push({ user: u, position: hit });
  }
  if (!matched.length) return [];

  // 3. Fan out notifications.
  const actorName = actor?.display_name || actor?.email || 'Someone';
  const out = [];
  for (const { user, position } of matched) {
    const notifTitle = title || `${actorName} mentioned you`;
    const excerpt = extractMentionExcerpt(body_md, position);
    await createNotification(env, {
      user_id: user.id,
      kind: 'mention',
      entity_type,
      entity_id,
      title: notifTitle,
      body: excerpt,
      link: link || null,
      actor_id: actor?.id || null,
    });
    // Send email notification for the @mention (fire-and-forget).
    sendMentionEmail(env, {
      to: user.email,
      toName: user.display_name,
      actorName,
      entityType: entity_type,
      entityId: entity_id,
      excerpt,
      bodyMd: body_md,
      link: link || null,
    }).catch(() => {});
    out.push(user);
  }
  return out;
}

// ── Mention email notification ──────────────────────────────
async function sendMentionEmail(env, opts) {
  const { to, toName, actorName, entityType, entityId, excerpt, bodyMd, link } = opts;
  if (!to) return;
  const entityLabel = entityType === 'issue' ? 'an issue' : entityType === 'doc_page' ? 'a doc page' : 'a comment';
  const fullLink = link ? `${PUBLIC_BASE_URL}/${link.replace(/^\//, '')}` : PUBLIC_BASE_URL;
  const subject = `${actorName} mentioned you in ${entityLabel}`;
  // Render a clean excerpt (first 500 chars of the body, no markdown syntax)
  const cleanBody = String(bodyMd || '').replace(/[#*_`~>\[\]|]/g, '').replace(/\n+/g, '<br>').slice(0, 500);
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
    <div style="max-width:560px;margin:32px auto;background:#ffffff;border-radius:12px;border:1px solid #dfe1e6;overflow:hidden">
      <div style="background:#0C66E4;padding:20px 28px">
        <div style="color:#ffffff;font-size:18px;font-weight:700">Cintelis Workspace</div>
      </div>
      <div style="padding:28px">
        <p style="margin:0 0 14px;color:#172B4D;font-size:15px;line-height:1.6">Hi ${toName || 'there'},</p>
        <p style="margin:0 0 18px;color:#172B4D;font-size:15px;line-height:1.6"><strong>${actorName}</strong> mentioned you in ${entityLabel}:</p>
        <div style="padding:16px 18px;background:#f4f5f7;border-left:3px solid #0C66E4;border-radius:4px;margin:0 0 18px;font-size:14px;line-height:1.7;color:#172B4D">
          ${cleanBody}${String(bodyMd || '').length > 500 ? '<span style="color:#6B778C">…</span>' : ''}
        </div>
        <a href="${fullLink}" style="display:inline-block;padding:12px 24px;background:#0C66E4;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px">View in Cintelis Workspace</a>
      </div>
      <div style="padding:16px 28px;border-top:1px solid #dfe1e6;background:#f4f5f7;font-size:12px;color:#6B778C">
        You received this because you were mentioned with @${(to || '').split('@')[0]}. <a href="${PUBLIC_BASE_URL}" style="color:#0C66E4;text-decoration:none">Cintelis Workspace</a>
      </div>
    </div>
  </body></html>`;
  try {
    // Reuse the sendEmail from worker.js — but since we're in a separate module,
    // we call the email worker directly.
    const apiUrl = String(env.EMAIL_API_URL || env.EMAIL_WORKER_URL || 'https://email.365softlabs.com/api/send').trim();
    const clientId = String(env.CF_ACCESS_CLIENT_ID || '').trim();
    const clientSecret = String(env.CF_ACCESS_CLIENT_SECRET || '').trim();
    if (!apiUrl || !clientId || !clientSecret) return;
    const r = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CF-Access-Client-Id': clientId,
        'CF-Access-Client-Secret': clientSecret,
      },
      body: JSON.stringify({
        to,
        subject: `[Cintelis Workspace] ${subject}`,
        message: html,
        contentType: 'HTML',
        fromEmail: 'noreply@cintelis.ai',
        fromName: 'Cintelis Workspace',
      }),
    });
  } catch (e) {
    // Silent fail — email is best-effort, never blocks the comment.
  }
}

// ── listNotifications ────────────────────────────────────────
// GET /api/me/notifications[?unread=1&limit=50&offset=0]
export async function listNotifications(req, env, ctx) {
  const url = new URL(req.url);
  const unreadOnly = ['1', 'true', 'yes'].includes(String(url.searchParams.get('unread') || '').toLowerCase());
  const limitRaw = parseInt(url.searchParams.get('limit') || '50', 10);
  const offsetRaw = parseInt(url.searchParams.get('offset') || '0', 10);
  const limit = Math.max(1, Math.min(isNaN(limitRaw) ? 50 : limitRaw, 200));
  const offset = Math.max(0, isNaN(offsetRaw) ? 0 : offsetRaw);

  const where = ['n.user_id = ?'];
  const params = [ctx.user.id];
  if (unreadOnly) where.push('n.read_at IS NULL');

  const totalRow = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM notifications n WHERE ${where.join(' AND ')}`
  ).bind(...params).first();
  const total = (totalRow && totalRow.n) || 0;

  const { results } = await env.DB.prepare(
    `SELECT n.*, u.display_name AS actor_display_name, u.email AS actor_email
     FROM notifications n
     LEFT JOIN users u ON u.id = n.actor_id
     WHERE ${where.join(' AND ')}
     ORDER BY n.created_at DESC
     LIMIT ? OFFSET ?`
  ).bind(...params, limit, offset).all();

  const notifications = (results || []).map(r => {
    const out = { ...r };
    out.actor = r.actor_id
      ? { id: r.actor_id, display_name: r.actor_display_name || '', email: r.actor_email || '' }
      : null;
    delete out.actor_display_name;
    delete out.actor_email;
    return out;
  });

  return jres({ notifications, total });
}

// ── getUnreadCount ───────────────────────────────────────────
// GET /api/me/notifications/unread-count
export async function getUnreadCount(env, ctx) {
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM notifications WHERE user_id=? AND read_at IS NULL'
  ).bind(ctx.user.id).first();
  return jres({ unread_count: (row && row.n) || 0 });
}

// ── markRead ─────────────────────────────────────────────────
// POST /api/me/notifications/:id/read — idempotent
export async function markRead(env, ctx, notificationId) {
  const row = await env.DB.prepare(
    'SELECT id, user_id, read_at FROM notifications WHERE id=?'
  ).bind(notificationId).first();
  if (!row) return jres({ error: 'Notification not found' }, 404);
  if (row.user_id !== ctx.user.id) return jres({ error: 'Forbidden' }, 403);
  if (!row.read_at) {
    await env.DB.prepare(
      'UPDATE notifications SET read_at=? WHERE id=? AND user_id=? AND read_at IS NULL'
    ).bind(now(), notificationId, ctx.user.id).run();
  }
  return jres({ ok: true });
}

// ── markAllRead ──────────────────────────────────────────────
// POST /api/me/notifications/read-all
export async function markAllRead(env, ctx) {
  const res = await env.DB.prepare(
    'UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL'
  ).bind(now(), ctx.user.id).run();
  const updated = (res && res.meta && typeof res.meta.changes === 'number') ? res.meta.changes : 0;
  return jres({ ok: true, updated });
}

// ── mentionSearch ────────────────────────────────────────────
// GET /api/users/mention-search?q=...
// Prefix match against either email (before the @) or display_name. Limit 8.
export async function mentionSearch(req, env, ctx) {
  const url = new URL(req.url);
  const qRaw = String(url.searchParams.get('q') || '').trim();
  // Tenant scoping: customer users can only mention people in their organisation.
  const scope = ctx && ctx.user && ctx.user.customer_id ? ctx.user.customer_id : null;
  const sb = scope ? [scope] : [];
  // If q is empty, return all active users (for the initial @-trigger popup).
  if (qRaw.length < 1) {
    const { results } = await env.DB.prepare(
      `SELECT id, email, display_name FROM users WHERE active = 1 ${scope ? 'AND customer_id = ?' : ''} ORDER BY display_name ASC LIMIT 8`
    ).bind(...sb).all();
    return jres({ users: results || [] });
  }
  // Sanitize: strip LIKE-wildcard chars to avoid injection into our own pattern.
  const q = qRaw.replace(/[%_]/g, '').toLowerCase();
  if (!q) return jres({ users: [] });
  const emailPat = `${q}%@%`;
  const namePat = `${q}%`;
  const { results } = await env.DB.prepare(
    `SELECT id, email, display_name
     FROM users
     WHERE active = 1 ${scope ? 'AND customer_id = ?' : ''} AND (LOWER(email) LIKE ? OR LOWER(display_name) LIKE ?)
     ORDER BY display_name ASC
     LIMIT 8`
  ).bind(...sb, emailPat, namePat).all();
  return jres({ users: results || [] });
}
