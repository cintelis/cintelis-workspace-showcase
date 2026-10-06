// Personal Access Tokens for programmatic access — separate from session
// auth so cron jobs and integrations don't break when sessions rotate.
// Tokens are stored as SHA-256 hashes; the plaintext only exists in the
// response of the mint endpoint (shown once to the caller).
//
// api_tokens is a customer-scoped table (018): a token carries its owner's
// customer_id, so everything a token does happens in that tenant. Reads and
// writes here go through worker/scope.js like every other scoped table.

import { scopedAll, scopedFirst, scopedRun, scopedInsert, ALL_SCOPE } from './scope.js';
import { parseFeatures } from './customers.js';

function jres(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function isoNow() { return new Date().toISOString(); }
function tokenIdGen() { return 'pak_' + crypto.randomUUID().replace(/-/g, '').slice(0, 24); }

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function randomTokenBody() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export const TOKEN_SCOPES = ['docs:write', 'docs:read', 'crm:write'];

// Verify a presented Authorization header. Returns { user, token } or null.
export async function verifyApiToken(env, presented) {
  if (!presented || typeof presented !== 'string') return null;
  if (!presented.startsWith('pat_')) return null;
  const hash = await sha256Hex(presented);
  // ALL_SCOPE: the hash is the credential; the tenant is read from the row.
  const row = await scopedFirst(env, null, {
    sql: `SELECT t.id AS t_id, t.name AS t_name, t.scope AS t_scope, t.owner_user_id, t.customer_id AS t_customer_id,
            t.revoked_at, t.created_at AS t_created_at,
            u.id AS u_id, u.email AS u_email, u.display_name AS u_display_name,
            u.role AS u_role, u.active AS u_active, u.customer_id AS u_customer_id
     FROM api_tokens t JOIN users u ON u.id = t.owner_user_id WHERE t.token_hash = ? AND /*SCOPE*/`,
    binds: [hash], alias: 't', scope: ALL_SCOPE,
  });
  if (!row) return null;
  if (row.revoked_at) return null;
  if (Number(row.u_active) !== 1) return null;
  // Best-effort last-used timestamp. ALL_SCOPE: the row was resolved above.
  scopedRun(env, null, { sql: 'UPDATE api_tokens SET last_used_at=? WHERE id=? AND /*SCOPE*/', binds: [isoNow(), row.t_id], alias: 'api_tokens', scope: ALL_SCOPE }).catch(() => {});
  return {
    token: { id: row.t_id, name: row.t_name, scope: row.t_scope, created_at: row.t_created_at },
    user: {
      id: row.u_id,
      email: row.u_email,
      display_name: row.u_display_name || '',
      role: row.u_role || 'member',
      // The token's tenant, stamped at mint time from the minting admin's session.
      customer_id: row.t_customer_id || row.u_customer_id || null,
      active: true,
    },
  };
}

// Auth middleware shape — mirrors requireAuth() so handlers can use ctx.user.id.
export async function requireApiToken(req, env) {
  const h = req.headers.get('Authorization') || '';
  const presented = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!presented) return jres({ error: 'Bearer token required' }, 401);
  const ctx = await verifyApiToken(env, presented);
  if (!ctx) return jres({ error: 'Invalid or revoked API token' }, 401);
  return { session: { id: ctx.token.id, is_2fa_pending: false }, user: ctx.user, _apiToken: ctx.token };
}

// ── Admin endpoints (session-authenticated, admin-only) ──────────
// POST /api/admin/api-tokens   — mint
// GET  /api/admin/api-tokens   — list (no plaintext returned)
// DELETE /api/admin/api-tokens/:id — revoke

export async function adminMintApiToken(req, env, ctx) {
  if (ctx.user.role !== 'admin') return jres({ error: 'Admin only' }, 403);
  const body = await req.json().catch(() => ({}));
  const name = String(body.name || '').trim();
  if (!name) return jres({ error: 'name required' }, 400);
  if (name.length > 80) return jres({ error: 'name too long (max 80 chars)' }, 400);
  const scope = String(body.scope || 'docs:write');
  if (!TOKEN_SCOPES.includes(scope)) return jres({ error: 'invalid scope' }, 400);
  if (scope === 'crm:write' && ctx.user.customer_id) {
    // A customer admin may mint CRM tokens only while the customer is entitled to CRM.
    const cust = await env.DB.prepare('SELECT features FROM customers WHERE id=?').bind(ctx.user.customer_id).first();
    if (!cust || parseFeatures(cust.features).crm === false) {
      return jres({ error: 'The crm feature is not enabled for your organisation' }, 403);
    }
  }
  const plaintext = 'pat_' + randomTokenBody();
  const hash = await sha256Hex(plaintext);
  const id = tokenIdGen();
  const ts = isoNow();
  await scopedInsert(env, ctx, {
    table: 'api_tokens',
    row: { id, name, token_hash: hash, owner_user_id: ctx.user.id, scope, created_at: ts },
  });
  return jres({
    id, name, scope, created_at: ts,
    token: plaintext,
    note: 'Save this token — it will not be shown again.',
  }, 201);
}

export async function adminListApiTokens(env, ctx) {
  if (ctx.user.role !== 'admin') return jres({ error: 'Admin only' }, 403);
  const results = await scopedAll(env, ctx, {
    sql: `SELECT t.id, t.name, t.scope, t.created_at, t.last_used_at, t.revoked_at, t.customer_id,
            u.email AS owner_email, u.display_name AS owner_name
     FROM api_tokens t LEFT JOIN users u ON u.id = t.owner_user_id WHERE /*SCOPE*/ ORDER BY t.created_at DESC`,
    alias: 't',
  });
  return jres({ tokens: results || [] });
}

export async function adminRevokeApiToken(env, ctx, tokenId) {
  if (ctx.user.role !== 'admin') return jres({ error: 'Admin only' }, 403);
  const row = await scopedFirst(env, ctx, { sql: 'SELECT t.id, t.revoked_at FROM api_tokens t WHERE t.id=? AND /*SCOPE*/', binds: [tokenId], alias: 't' });
  if (!row) return jres({ error: 'Token not found' }, 404);
  if (row.revoked_at) return jres({ ok: true, already_revoked: true });
  await scopedRun(env, ctx, { sql: 'UPDATE api_tokens SET revoked_at=? WHERE id=? AND /*SCOPE*/', binds: [isoNow(), tokenId], alias: 'api_tokens' });
  return jres({ ok: true });
}
