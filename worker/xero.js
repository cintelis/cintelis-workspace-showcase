// ============================================================
// Cintelis Workspace — Xero (Cintelis's own organisation, read-only)
// ------------------------------------------------------------
// Invoices are raised in Xero as before. An internal admin connects
// Cintelis's Xero organisation once (OAuth 2.0, Settings › Integrations)
// and links each customer to a Xero contact. The cron then pulls those
// contacts' sales invoices into the xero_invoices table; customers see them on
// Contract & Billing with a PDF preview and Xero's online pay link.
// Nothing is ever written to Xero.
//
// Xero apps created after 2 March 2026 must use granular scopes, so the
// default asks for accounting.invoices.read + accounting.contacts.read
// (override with XERO_SCOPES). Access tokens last 30 minutes; the refresh
// token rotates on every refresh and expires after 60 days unused, which the
// 30-minute sync keeps from happening.
//
// Secrets: XERO_CLIENT_ID, XERO_CLIENT_SECRET. Redirect URI to register on
// the Xero app: {PUBLIC_BASE_URL}/api/xero/callback.
// ============================================================

import { PUBLIC_BASE_URL } from './config.js';
import { scopedAll, scopedFirst, scopedRun, resolveScope } from './scope.js';
import { isInternalAdmin, isCustomerUser, parseFeatures } from './customers.js';

const AUTHORIZE_URL = 'https://login.xero.com/identity/connect/authorize';
const TOKEN_URL = 'https://identity.xero.com/connect/token';
const REVOKE_URL = 'https://identity.xero.com/connect/revocation';
const CONNECTIONS_URL = 'https://api.xero.com/connections';
const API = 'https://api.xero.com/api.xro/2.0';
const DEFAULT_SCOPE = 'offline_access accounting.invoices.read accounting.contacts.read';
const ROW_ID = 'cintelis';
const STATE_TTL_SECONDS = 600;
const DEFAULT_SYNC_MINUTES = 30;
const PAGE_SIZE = 100;            // Xero's page size for /Invoices
const CONTACTS_PER_REQUEST = 40;  // keeps the ContactIDs query string well under URL limits
const ONLINE_URLS_PER_RUN = 10;   // OnlineInvoice is one call per invoice; Xero allows 60/min

// Statuses a customer sees. Drafts are Cintelis's work in progress; voided and
// deleted invoices are not the customer's concern.
const CUSTOMER_STATUSES = ['AUTHORISED', 'PAID'];

function jres(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
function now() { return new Date().toISOString(); }
const FORBIDDEN_ADMIN = () => jres({ error: 'Forbidden: Cintelis admin only' }, 403);

function cfg(env) {
  return {
    clientId: String(env.XERO_CLIENT_ID || '').trim(),
    clientSecret: String(env.XERO_CLIENT_SECRET || '').trim(),
    scope: String(env.XERO_SCOPES || DEFAULT_SCOPE).trim(),
    redirectUri: `${PUBLIC_BASE_URL}/api/xero/callback`,
    syncMinutes: Number(env.XERO_SYNC_MINUTES) > 0 ? Number(env.XERO_SYNC_MINUTES) : DEFAULT_SYNC_MINUTES,
  };
}
const isConfigured = (c) => !!(c.clientId && c.clientSecret);

// Xero's JSON dates come as "/Date(1518685950940+0000)/".
function xeroDate(v) {
  if (!v) return null;
  const m = String(v).match(/\/Date\((-?\d+)/);
  if (m) return new Date(Number(m[1])).toISOString();
  const d = new Date(v);
  return isNaN(d) ? null : d.toISOString();
}
// DateString ("2026-09-01T00:00:00") has no zone and is the organisation's
// calendar date: take it as written rather than parsing it as an instant.
const xeroDay = (v) => {
  if (v && /^\d{4}-\d{2}-\d{2}/.test(String(v))) return String(v).slice(0, 10);
  const iso = xeroDate(v);
  return iso ? iso.slice(0, 10) : null;
};

// ── Connection row ───────────────────────────────────────────
async function getConn(env) {
  return env.DB.prepare('SELECT * FROM xero_connection WHERE id=?').bind(ROW_ID).first();
}

async function tokenRequest(env, form) {
  const c = cfg(env);
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + btoa(`${c.clientId}:${c.clientSecret}`),
    },
    body: new URLSearchParams(form).toString(),
  });
  const tok = await r.json().catch(() => ({}));
  if (!r.ok || !tok.access_token) {
    throw new Error(`Xero token request failed: ${tok.error_description || tok.error || r.status}`);
  }
  return tok;
}

// A valid access token, refreshing when it is within a minute of expiry.
async function accessToken(env, conn, force = false) {
  if (!force && Number(conn.expires_at) - 60_000 > Date.now()) return conn.access_token;
  const tok = await tokenRequest(env, { grant_type: 'refresh_token', refresh_token: conn.refresh_token });
  const expiresAt = Date.now() + Number(tok.expires_in || 1800) * 1000;
  // The refresh token rotates: persist the new one before using the access token,
  // or the next refresh fails once Xero's grace period on the old one runs out.
  await env.DB.prepare(
    'UPDATE xero_connection SET access_token=?, refresh_token=?, expires_at=? WHERE id=?'
  ).bind(tok.access_token, tok.refresh_token || conn.refresh_token, expiresAt, conn.id).run();
  conn.access_token = tok.access_token;
  conn.refresh_token = tok.refresh_token || conn.refresh_token;
  conn.expires_at = expiresAt;
  return tok.access_token;
}

// GET against the Accounting API for the connected organisation. Retries once
// with a fresh token on 401 (revoked early, or a clock-skewed expiry).
async function xeroGet(env, conn, path, { accept = 'application/json', headers = {} } = {}) {
  if (!conn.tenant_id) throw new Error('No Xero organisation selected.');
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await accessToken(env, conn, attempt > 0);
    const r = await fetch(API + path, {
      headers: { Authorization: `Bearer ${token}`, 'xero-tenant-id': conn.tenant_id, Accept: accept, ...headers },
    });
    if (r.status === 401 && attempt === 0) continue;
    if (r.status === 429) {
      throw new Error(`Xero rate limit reached; retry after ${r.headers.get('Retry-After') || 60}s.`);
    }
    return r;
  }
}

async function xeroJson(env, conn, path, opts) {
  const r = await xeroGet(env, conn, path, opts);
  if (r.status === 304) return null;
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = body.Detail || body.Message || body.Title || (body.Elements && body.Elements[0]?.ValidationErrors?.[0]?.Message);
    throw new Error(`Xero ${path.split('?')[0]} failed: ${msg || r.status}`);
  }
  return body;
}

// ── OAuth ────────────────────────────────────────────────────
// GET /api/xero/connect (internal admin) → { authorizeUrl }
export async function startConnect(env, ctx) {
  if (!isInternalAdmin(ctx)) return FORBIDDEN_ADMIN();
  const c = cfg(env);
  if (!isConfigured(c)) return jres({ error: 'Xero is not configured (set the XERO_CLIENT_ID and XERO_CLIENT_SECRET secrets).' }, 500);
  const state = crypto.randomUUID().replace(/-/g, '');
  await env.KV.put(`xero_oauth_state:${state}`, ctx.user.id, { expirationTtl: STATE_TTL_SECONDS });
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: c.clientId,
    redirect_uri: c.redirectUri,
    scope: c.scope,
    state,
  });
  return jres({ authorizeUrl: `${AUTHORIZE_URL}?${params.toString()}` });
}

function htmlResponse(html, status = 200) {
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

function callbackPage(message, ok) {
  const safe = String(message).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  return htmlResponse(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Xero</title>
<style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f4f5f7;color:#172B4D;
display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.box{background:#fff;border:1px solid #dfe1e6;border-radius:12px;padding:28px 32px;max-width:420px;text-align:center}
.ok{color:#0C66E4}.err{color:#c9372c}</style></head>
<body><div class="box"><h2 class="${ok ? 'ok' : 'err'}">${ok ? 'Xero connected' : 'Connection failed'}</h2>
<p>${safe}</p><p style="font-size:13px;color:#6B778C">You can close this window.</p></div>
<script>
  try { if (window.opener && !window.opener.closed) { window.opener.location.reload(); } } catch (e) {}
  setTimeout(function(){ try { window.close(); } catch(e){} if (!window.opener) { location.href = '/#/integrations'; } }, 1500);
</script></body></html>`);
}

// GET /api/xero/callback — Xero's browser redirect (no Bearer). CSRF is the
// single-use `state` stored in KV by startConnect.
export async function handleCallback(req, env, url) {
  const err = url.searchParams.get('error');
  if (err) return callbackPage(`Xero returned: ${url.searchParams.get('error_description') || err}`, false);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) return callbackPage('Missing code or state in the callback.', false);
  const stateKey = `xero_oauth_state:${state}`;
  const userId = await env.KV.get(stateKey);
  if (!userId) return callbackPage('This authorisation link has expired. Please connect again.', false);
  await env.KV.delete(stateKey);

  const c = cfg(env);
  let tok;
  try {
    tok = await tokenRequest(env, { grant_type: 'authorization_code', code, redirect_uri: c.redirectUri });
  } catch (e) {
    return callbackPage(e.message || String(e), false);
  }

  // Which organisations did the user grant? Keep them all; use the first
  // ORGANISATION until an admin picks another.
  let tenants = [];
  try {
    const r = await fetch(CONNECTIONS_URL, { headers: { Authorization: `Bearer ${tok.access_token}`, Accept: 'application/json' } });
    const list = await r.json();
    tenants = (Array.isArray(list) ? list : [])
      .filter(t => t.tenantType === 'ORGANISATION')
      .map(t => ({ connection_id: t.id, tenant_id: t.tenantId, tenant_name: t.tenantName || '' }));
  } catch { /* handled below */ }
  if (!tenants.length) return callbackPage('Xero did not grant access to any organisation. Connect again and choose an organisation.', false);

  // If an organisation was already chosen and is still granted, keep it.
  const existing = await getConn(env);
  const keep = existing && tenants.find(t => t.tenant_id === existing.tenant_id);
  const pick = keep || tenants[0];

  const u = await env.DB.prepare('SELECT email FROM users WHERE id=?').bind(userId).first().catch(() => null);
  await env.DB.prepare(
    `INSERT INTO xero_connection (id, tenant_id, tenant_name, connection_id, tenants_json, access_token, refresh_token,
       expires_at, scope, connected_by, connected_by_email, connected_at, last_sync_error, sync_cursor)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
     ON CONFLICT(id) DO UPDATE SET
       tenant_id=excluded.tenant_id, tenant_name=excluded.tenant_name, connection_id=excluded.connection_id,
       tenants_json=excluded.tenants_json, access_token=excluded.access_token, refresh_token=excluded.refresh_token,
       expires_at=excluded.expires_at, scope=excluded.scope, connected_by=excluded.connected_by,
       connected_by_email=excluded.connected_by_email, connected_at=excluded.connected_at,
       last_sync_error=NULL, sync_cursor=NULL`
  ).bind(
    ROW_ID, pick.tenant_id, pick.tenant_name, pick.connection_id, JSON.stringify(tenants),
    tok.access_token, tok.refresh_token || '', Date.now() + Number(tok.expires_in || 1800) * 1000,
    tok.scope || c.scope, userId, u?.email || null, now()
  ).run();

  return callbackPage(`Connected to ${pick.tenant_name || 'your Xero organisation'}. Link customers to Xero contacts on each customer's page.`, true);
}

// ── Status / organisation / disconnect ───────────────────────
// GET /api/xero/status (internal admin)
export async function getStatus(env, ctx) {
  if (!isInternalAdmin(ctx)) return FORBIDDEN_ADMIN();
  const c = cfg(env);
  const conn = await getConn(env);
  const linked = await env.DB.prepare('SELECT COUNT(*) AS n FROM customers WHERE xero_contact_id IS NOT NULL').first();
  if (!conn) return jres({ configured: isConfigured(c), connected: false, linked_customers: linked?.n || 0 });
  let tenants = [];
  try { tenants = JSON.parse(conn.tenants_json || '[]'); } catch { /* ignore */ }
  return jres({
    configured: isConfigured(c),
    connected: true,
    tenant_id: conn.tenant_id,
    tenant_name: conn.tenant_name,
    tenants: tenants.map(t => ({ tenant_id: t.tenant_id, tenant_name: t.tenant_name })),
    connected_by_email: conn.connected_by_email,
    connected_at: conn.connected_at,
    last_sync_at: conn.last_sync_at,
    last_sync_error: conn.last_sync_error,
    sync_minutes: c.syncMinutes,
    linked_customers: linked?.n || 0,
  });
}

// PUT /api/xero/tenant { tenant_id } (internal admin) — switch organisation.
export async function setTenant(req, env, ctx) {
  if (!isInternalAdmin(ctx)) return FORBIDDEN_ADMIN();
  const conn = await getConn(env);
  if (!conn) return jres({ error: 'Xero is not connected' }, 400);
  const body = await req.json().catch(() => ({}));
  let tenants = [];
  try { tenants = JSON.parse(conn.tenants_json || '[]'); } catch { /* ignore */ }
  const t = tenants.find(x => x.tenant_id === body.tenant_id);
  if (!t) return jres({ error: 'That organisation is not part of this connection' }, 400);
  if (t.tenant_id === conn.tenant_id) return jres({ ok: true });
  // Contacts and invoices belong to an organisation; links to the old one are meaningless.
  await env.DB.batch([
    env.DB.prepare('UPDATE xero_connection SET tenant_id=?, tenant_name=?, connection_id=?, sync_cursor=NULL, last_sync_error=NULL WHERE id=?')
      .bind(t.tenant_id, t.tenant_name, t.connection_id, ROW_ID),
    env.DB.prepare("UPDATE customers SET xero_contact_id=NULL, xero_contact_name='' WHERE xero_contact_id IS NOT NULL"),
  ]);
  // Every customer's invoices go: staff-only maintenance across all tenants.
  await scopedRun(env, ctx, { sql: 'DELETE FROM xero_invoices WHERE /*SCOPE*/', alias: 'xero_invoices', scope: { mode: 'all', customerId: null } });
  return jres({ ok: true });
}

// POST /api/xero/disconnect (internal admin). Revokes the refresh token, which
// removes this app from the organisation's connected apps. Cached invoices stay
// visible until a reconnect re-syncs them.
export async function disconnect(env, ctx) {
  if (!isInternalAdmin(ctx)) return FORBIDDEN_ADMIN();
  const conn = await getConn(env);
  if (conn) {
    const c = cfg(env);
    try {
      await fetch(REVOKE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: 'Basic ' + btoa(`${c.clientId}:${c.clientSecret}`),
        },
        body: new URLSearchParams({ token: conn.refresh_token }).toString(),
      });
    } catch { /* best effort: the row goes either way */ }
    await env.DB.prepare('DELETE FROM xero_connection WHERE id=?').bind(ROW_ID).run();
  }
  return jres({ ok: true });
}

// ── Contacts ─────────────────────────────────────────────────
// GET /api/xero/contacts?q= (internal admin) — pick a contact to link.
export async function searchContacts(env, ctx, url) {
  if (!isInternalAdmin(ctx)) return FORBIDDEN_ADMIN();
  const conn = await getConn(env);
  if (!conn) return jres({ error: 'Xero is not connected' }, 400);
  const q = (url.searchParams.get('q') || '').trim();
  const params = new URLSearchParams({ summaryOnly: 'true', page: '1' });
  if (q) params.set('searchTerm', q);
  try {
    const body = await xeroJson(env, conn, `/Contacts?${params.toString()}`);
    const contacts = (body?.Contacts || [])
      .filter(c => c.ContactStatus !== 'ARCHIVED')
      .slice(0, 25)
      .map(c => ({ id: c.ContactID, name: c.Name || '', email: c.EmailAddress || '', is_customer: !!c.IsCustomer }));
    return jres({ contacts });
  } catch (e) {
    return jres({ error: e.message || String(e) }, 502);
  }
}

// PUT /api/customers/:id/xero-contact { contact_id, contact_name } (internal admin)
export async function linkCustomerContact(req, env, ctx, customerId) {
  if (!isInternalAdmin(ctx)) return FORBIDDEN_ADMIN();
  const conn = await getConn(env);
  if (!conn) return jres({ error: 'Xero is not connected' }, 400);
  const body = await req.json().catch(() => ({}));
  const contactId = String(body.contact_id || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(contactId)) return jres({ error: 'contact_id must be a Xero ContactID' }, 400);
  const cust = await env.DB.prepare('SELECT id FROM customers WHERE id=?').bind(customerId).first();
  if (!cust) return jres({ error: 'Not found' }, 404);
  const other = await env.DB.prepare('SELECT name FROM customers WHERE xero_contact_id=? AND id<>?').bind(contactId, customerId).first();
  if (other) return jres({ error: `That Xero contact is already linked to ${other.name}` }, 409);

  const one = { mode: 'one', customerId };
  await env.DB.prepare('UPDATE customers SET xero_contact_id=?, xero_contact_name=?, updated_at=? WHERE id=?')
    .bind(contactId, String(body.contact_name || '').slice(0, 200), now(), customerId).run();
  // A changed link must not leave the previous contact's invoices behind.
  await scopedRun(env, ctx, { sql: 'DELETE FROM xero_invoices WHERE xero_contact_id<>? AND /*SCOPE*/', binds: [contactId], alias: 'xero_invoices', scope: one });
  let sync = null;
  try { sync = await syncContacts(env, conn, [contactId], { full: true }); }
  catch (e) { sync = { error: e.message || String(e) }; }
  return jres({ ok: true, sync });
}

// DELETE /api/customers/:id/xero-contact (internal admin)
export async function unlinkCustomerContact(env, ctx, customerId) {
  if (!isInternalAdmin(ctx)) return FORBIDDEN_ADMIN();
  await env.DB.prepare("UPDATE customers SET xero_contact_id=NULL, xero_contact_name='', updated_at=? WHERE id=?")
    .bind(now(), customerId).run();
  await scopedRun(env, ctx, { sql: 'DELETE FROM xero_invoices WHERE /*SCOPE*/', alias: 'xero_invoices', scope: { mode: 'one', customerId } });
  return jres({ ok: true });
}

// ── Sync ─────────────────────────────────────────────────────
// Pulls ACCREC invoices for the given contacts. `full` ignores the
// If-Modified-Since cursor (used when a contact is first linked).
async function syncContacts(env, conn, contactIds, { full = false } = {}) {
  if (!contactIds.length) return { invoices: 0 };
  const { results: owners } = await env.DB.prepare(
    `SELECT id, xero_contact_id FROM customers WHERE xero_contact_id IN (${contactIds.map(() => '?').join(',')})`
  ).bind(...contactIds).all();
  const ownerOf = new Map((owners || []).map(o => [o.xero_contact_id.toLowerCase(), o.id]));

  const headers = {};
  if (!full && conn.sync_cursor) headers['If-Modified-Since'] = conn.sync_cursor;
  let count = 0;
  const ts = now();
  for (let i = 0; i < contactIds.length; i += CONTACTS_PER_REQUEST) {
    const chunk = contactIds.slice(i, i + CONTACTS_PER_REQUEST);
    for (let page = 1; ; page++) {
      const params = new URLSearchParams({ ContactIDs: chunk.join(','), where: 'Type=="ACCREC"', page: String(page) });
      const body = await xeroJson(env, conn, `/Invoices?${params.toString()}`, { headers });
      const invoices = body?.Invoices || [];
      const stmts = [];
      for (const inv of invoices) {
        const contactId = inv.Contact?.ContactID || '';
        const customerId = ownerOf.get(contactId.toLowerCase());
        if (!customerId) continue;
        stmts.push(env.DB.prepare(
          `INSERT INTO xero_invoices (id, customer_id, xero_contact_id, invoice_number, reference, status, date, due_date, currency,
             sub_total, total_tax, total, amount_due, amount_paid, fully_paid_on, xero_updated_at, synced_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             customer_id=excluded.customer_id, xero_contact_id=excluded.xero_contact_id,
             invoice_number=excluded.invoice_number, reference=excluded.reference, status=excluded.status,
             date=excluded.date, due_date=excluded.due_date, currency=excluded.currency,
             sub_total=excluded.sub_total, total_tax=excluded.total_tax, total=excluded.total,
             amount_due=excluded.amount_due, amount_paid=excluded.amount_paid, fully_paid_on=excluded.fully_paid_on,
             online_url=CASE WHEN excluded.status IN ('AUTHORISED','PAID') THEN xero_invoices.online_url ELSE NULL END,
             xero_updated_at=excluded.xero_updated_at, synced_at=excluded.synced_at`
        ).bind(
          inv.InvoiceID, customerId, contactId, inv.InvoiceNumber || '', inv.Reference || '', inv.Status || '',
          xeroDay(inv.DateString || inv.Date), xeroDay(inv.DueDateString || inv.DueDate), inv.CurrencyCode || 'AUD',
          inv.SubTotal ?? null, inv.TotalTax ?? null, inv.Total ?? 0, inv.AmountDue ?? 0, inv.AmountPaid ?? 0,
          xeroDay(inv.FullyPaidOnDate), xeroDate(inv.UpdatedDateUTC), ts
        ));
      }
      if (stmts.length) await env.DB.batch(stmts);
      count += stmts.length;
      if (invoices.length < PAGE_SIZE) break;
    }
  }
  await fillOnlineUrls(env, conn);
  return { invoices: count };
}

// Xero's online invoice page lets the customer view and pay. One call per
// invoice, so a few per run, newest first.
async function fillOnlineUrls(env, conn) {
  // Staff-side maintenance across every tenant's unpaid invoices.
  const rows = await scopedAll(env, null, {
    sql: `SELECT x.id FROM xero_invoices x WHERE /*SCOPE*/
          AND x.status='AUTHORISED' AND x.online_url IS NULL
          ORDER BY x.date DESC LIMIT ${ONLINE_URLS_PER_RUN}`,
    alias: 'x',
    scope: { mode: 'all', customerId: null },
  });
  for (const r of rows) {
    try {
      const body = await xeroJson(env, conn, `/Invoices/${encodeURIComponent(r.id)}/OnlineInvoice`);
      const link = body?.OnlineInvoices?.[0]?.OnlineInvoiceUrl;
      if (link) {
        await scopedRun(env, null, {
          sql: 'UPDATE xero_invoices SET online_url=? WHERE id=? AND /*SCOPE*/',
          binds: [link, r.id], alias: 'xero_invoices', scope: { mode: 'all', customerId: null },
        });
      }
    } catch { /* not fatal: the PDF is still there */ }
  }
}

async function syncAll(env, conn) {
  const started = new Date().toISOString().slice(0, 19); // Xero wants UTC without a zone suffix
  try {
    const { results } = await env.DB.prepare('SELECT xero_contact_id FROM customers WHERE xero_contact_id IS NOT NULL').all();
    const ids = (results || []).map(r => r.xero_contact_id);
    const out = await syncContacts(env, conn, ids);
    await env.DB.prepare('UPDATE xero_connection SET last_sync_at=?, last_sync_error=NULL, sync_cursor=? WHERE id=?')
      .bind(now(), started, ROW_ID).run();
    return out;
  } catch (e) {
    const msg = e.message || String(e);
    await env.DB.prepare('UPDATE xero_connection SET last_sync_at=?, last_sync_error=? WHERE id=?')
      .bind(now(), msg.slice(0, 500), ROW_ID).run();
    throw e;
  }
}

// POST /api/xero/sync (internal admin) — sync now.
export async function syncNow(env, ctx) {
  if (!isInternalAdmin(ctx)) return FORBIDDEN_ADMIN();
  const conn = await getConn(env);
  if (!conn) return jres({ error: 'Xero is not connected' }, 400);
  try { return jres({ ok: true, ...(await syncAll(env, conn)) }); }
  catch (e) { return jres({ error: e.message || String(e) }, 502); }
}

// Cron (*/5): syncs every XERO_SYNC_MINUTES (default 30). Regular syncs also
// keep the 60-day refresh token alive.
export async function runXeroScheduler(env) {
  const c = cfg(env);
  if (!isConfigured(c)) return;
  const conn = await getConn(env);
  if (!conn || !conn.tenant_id) return;
  const last = conn.last_sync_at ? Date.parse(conn.last_sync_at) : 0;
  if (Date.now() - last < c.syncMinutes * 60_000) return;
  await syncAll(env, conn);
}

// ── Invoices ─────────────────────────────────────────────────
const INVOICE_COLS = `x.id, x.invoice_number, x.reference, x.status, x.date, x.due_date, x.currency,
  x.sub_total, x.total_tax, x.total, x.amount_due, x.amount_paid, x.fully_paid_on, x.online_url, x.synced_at`;

// GET /api/customers/:id/invoices (internal admin) — every status.
export async function listCustomerInvoices(env, ctx, customerId) {
  if (!isInternalAdmin(ctx)) return FORBIDDEN_ADMIN();
  const invoices = await scopedAll(env, ctx, {
    sql: `SELECT ${INVOICE_COLS} FROM xero_invoices x WHERE /*SCOPE*/ ORDER BY x.date DESC, x.invoice_number DESC`,
    alias: 'x',
    scope: { mode: 'one', customerId },
  });
  return jres({ invoices });
}

// GET /api/customer/invoices — a customer's own issued invoices.
export async function listMyInvoices(env, ctx) {
  if (!isCustomerUser(ctx)) return jres({ error: 'Not a customer account' }, 400);
  const cust = await env.DB.prepare('SELECT features, xero_contact_id FROM customers WHERE id=?').bind(ctx.user.customer_id).first();
  if (!cust || parseFeatures(cust.features).billing === false) return jres({ invoices: [], linked: false });
  const invoices = await scopedAll(env, ctx, {
    sql: `SELECT ${INVOICE_COLS} FROM xero_invoices x WHERE /*SCOPE*/
          AND x.status IN ('AUTHORISED','PAID')
          ORDER BY x.date DESC, x.invoice_number DESC`,
    alias: 'x',
  });
  return jres({ invoices, linked: !!cust.xero_contact_id });
}

// GET /api/xero/invoices/:id/(download|preview) — the invoice PDF, fetched
// from Xero on demand. Reached before requireAuth because <iframe>/<a> cannot
// send a Bearer header; the caller passes the session it resolved from
// ?token=. Customers see only their own issued invoices; staff need admin.
export async function serveInvoicePdf(env, sess, invoiceId, inline, headOnly = false) {
  const customer = isCustomerUser(sess);
  if (!customer && !isInternalAdmin(sess)) return jres({ error: 'Forbidden' }, 403);
  if (customer) {
    const cust = await env.DB.prepare('SELECT status, features FROM customers WHERE id=?').bind(sess.user.customer_id).first();
    if (!cust || cust.status !== 'active' || parseFeatures(cust.features).billing === false) {
      return jres({ error: 'Forbidden' }, 403);
    }
  }
  // resolveScope pins a customer user to their own rows; staff see all.
  const row = await scopedFirst(env, sess, {
    sql: 'SELECT x.id, x.status, x.invoice_number FROM xero_invoices x WHERE x.id=? AND /*SCOPE*/',
    binds: [invoiceId],
    alias: 'x',
    scope: resolveScope(sess),
  });
  if (!row || (customer && !CUSTOMER_STATUSES.includes(row.status))) return jres({ error: 'Not found' }, 404);
  // The preview pane probes with HEAD to learn the type; answer without a Xero call.
  if (headOnly) return new Response(null, { headers: { 'Content-Type': 'application/pdf' } });

  const conn = await getConn(env);
  if (!conn) return jres({ error: 'Xero is not connected' }, 503);
  let r;
  try { r = await xeroGet(env, conn, `/Invoices/${encodeURIComponent(row.id)}`, { accept: 'application/pdf' }); }
  catch (e) { return jres({ error: e.message || String(e) }, 502); }
  if (!r.ok) return jres({ error: `Xero returned ${r.status} for the invoice PDF` }, 502);
  const filename = `Invoice ${row.invoice_number || row.id}.pdf`.replace(/["\\]/g, '');
  return new Response(r.body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${filename}"`,
      'Cache-Control': 'private, max-age=300',
    },
  });
}
