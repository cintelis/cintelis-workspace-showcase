// ============================================================
// Cintelis Workspace — D1-backed session repository
// Session id IS the Bearer token. Two-factor pending state supported.
// Lifted from adsoptimiser-tiktok/src/worker/src/db/sessions.ts, simplified
// (single-tenant, no workspace_id, no separate is_admin — role lives on users).
// ============================================================

import { generateSessionId } from './auth.js';

const DEFAULT_TTL_HOURS = 24 * 7;        // 7 days
const PENDING_2FA_TTL_MINUTES = 10;

function isoNow() { return new Date().toISOString(); }
function isoIn(ms) { return new Date(Date.now() + ms).toISOString(); }

// Create a new session for the given user.
// Options:
//   is2faPending — if true, session is created in pending state with a short TTL
//   ttlHours     — override default TTL (only used when is2faPending is false)
//   userAgent    — request user-agent string for audit
//   ip           — request client IP for audit
// Returns the session row.
export async function createSession(env, userId, options = {}) {
  const id = generateSessionId();
  const now = isoNow();
  const expiresAt = options.is2faPending
    ? isoIn(PENDING_2FA_TTL_MINUTES * 60 * 1000)
    : isoIn((options.ttlHours ?? DEFAULT_TTL_HOURS) * 60 * 60 * 1000);
  const isPending = options.is2faPending ? 1 : 0;

  await env.DB.prepare(
    `INSERT INTO app_sessions
       (id, user_id, is_2fa_pending, created_at, expires_at, last_seen_at, user_agent, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    userId,
    isPending,
    now,
    expiresAt,
    now,
    options.userAgent || null,
    options.ip || null
  ).run();

  return {
    id,
    user_id: userId,
    is_2fa_pending: isPending,
    created_at: now,
    expires_at: expiresAt,
    revoked_at: null,
    last_seen_at: now,
    user_agent: options.userAgent || null,
    ip: options.ip || null,
  };
}

// Returns session row joined with user, or null if missing/expired/revoked.
// Does NOT filter by is_2fa_pending — caller decides what to allow.
export async function getActiveSession(env, sessionId) {
  if (!sessionId) return null;
  const row = await env.DB.prepare(
    `SELECT s.id, s.user_id, s.is_2fa_pending, s.created_at, s.expires_at,
            s.revoked_at, s.last_seen_at,
            u.id AS u_id, u.email AS u_email, u.display_name AS u_display_name,
            u.role AS u_role, u.active AS u_active, u.preferences AS u_preferences,
            u.avatar_url AS u_avatar_url, u.customer_id AS u_customer_id
     FROM app_sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = ?
       AND s.revoked_at IS NULL
       AND datetime(s.expires_at) > datetime('now')
       AND u.active = 1`
  ).bind(sessionId).first();
  if (!row) return null;
  return {
    session: {
      id: row.id,
      user_id: row.user_id,
      is_2fa_pending: Number(row.is_2fa_pending) === 1,
      created_at: row.created_at,
      expires_at: row.expires_at,
      revoked_at: row.revoked_at,
      last_seen_at: row.last_seen_at,
    },
    user: {
      id: row.u_id,
      email: row.u_email,
      display_name: row.u_display_name || '',
      role: row.u_role || 'member',
      active: Number(row.u_active) === 1,
      preferences: safeParseJson(row.u_preferences),
      avatar_url: row.u_avatar_url || null,
      customer_id: row.u_customer_id || null,
    },
  };
}

export async function touchSession(env, sessionId) {
  if (!sessionId) return;
  await env.DB.prepare(
    'UPDATE app_sessions SET last_seen_at=? WHERE id=?'
  ).bind(isoNow(), sessionId).run();
}

export async function revokeSession(env, sessionId) {
  if (!sessionId) return;
  await env.DB.prepare(
    'UPDATE app_sessions SET revoked_at=? WHERE id=?'
  ).bind(isoNow(), sessionId).run();
}

// Promote a 2FA-pending session into a full session and extend its TTL.
// Returns the updated session/user, or null if the session is not pending or invalid.
export async function promotePendingTwoFactor(env, sessionId, ttlHours = DEFAULT_TTL_HOURS) {
  const ctx = await getActiveSession(env, sessionId);
  if (!ctx || !ctx.session.is_2fa_pending) return null;
  const now = isoNow();
  const expiresAt = isoIn(ttlHours * 60 * 60 * 1000);
  await env.DB.prepare(
    'UPDATE app_sessions SET is_2fa_pending=0, expires_at=?, last_seen_at=? WHERE id=?'
  ).bind(expiresAt, now, sessionId).run();
  return await getActiveSession(env, sessionId);
}

function safeParseJson(s) {
  try { return JSON.parse(s || '{}'); } catch { return {}; }
}
