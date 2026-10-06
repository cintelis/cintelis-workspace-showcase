// Outbound email — the call to the 365soft email worker and the sender
// identity a campaign goes out under.
//
// Moved out of worker.js so the CRM module and worker.js can both send without
// a circular import. The transport (worker URL + Cloudflare Access service
// token) and the From address are resolved together in resolveSender():
// Cintelis campaigns use the env defaults; a customer's campaigns use ONLY the
// customer's own `email` integration and fail if it is missing. There is no
// fallback to the Cintelis identity — a customer's spam complaints must not be
// able to degrade delivery for everyone, and a customer's mail must never
// quietly go out as Cintelis.

import { scopedFirst, scopedRun, scopedInsert } from './scope.js';
import { isInternalAdmin, getCustomer } from './customers.js';

const EMAIL_WORKER = 'https://email.365softlabs.com/api/send';
export const DEFAULT_FROM = 'nick@365softlabs.com';
export const DEFAULT_NAME = 'Nick | 365Soft Labs';

function jres(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
function now() { return new Date().toISOString(); }
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// The sending identity is stored as the customer's one active `email`
// integration. Staff set it from the customer page; nothing else writes it.
async function activeEmailIntegration(env, customerId) {
  return scopedFirst(env, null, {
    sql: "SELECT i.id, i.config, i.updated_at FROM integrations i WHERE i.kind='email' AND i.active=1 AND /*SCOPE*/ ORDER BY i.updated_at DESC LIMIT 1",
    alias: 'i', scope: { mode: 'one', customerId },
  });
}

function parseConfig(raw) {
  try { return JSON.parse(raw || '{}') || {}; } catch { return {}; }
}

/** What the admin UI sees: everything except the Access secret itself. */
function publicSender(row) {
  if (!row) return null;
  const cfg = parseConfig(row.config);
  return {
    from_email: cfg.from_email || '',
    from_name: cfg.from_name || '',
    api_url: cfg.api_url || '',
    cf_client_id: cfg.cf_client_id || '',
    has_secret: !!cfg.cf_client_secret,
    updated_at: row.updated_at,
  };
}

// GET /api/customers/:id/sender — Cintelis admin only.
export async function getSenderIdentity(env, ctx, customerId) {
  if (!isInternalAdmin(ctx)) return jres({ error: 'Forbidden: Cintelis admin only' }, 403);
  if (!(await getCustomer(env, customerId))) return jres({ error: 'Not found' }, 404);
  return jres({ sender: publicSender(await activeEmailIntegration(env, customerId)) });
}

// PUT /api/customers/:id/sender — Cintelis admin only.
//   Body: { from_email, from_name?, api_url?, cf_client_id, cf_client_secret? }
//   The secret may be omitted on an update to keep the stored one.
export async function putSenderIdentity(req, env, ctx, customerId) {
  if (!isInternalAdmin(ctx)) return jres({ error: 'Forbidden: Cintelis admin only' }, 403);
  if (!(await getCustomer(env, customerId))) return jres({ error: 'Not found' }, 404);
  const body = await req.json().catch(() => ({}));
  const fromEmail = String(body.from_email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(fromEmail)) return jres({ error: 'from_email must be a valid address' }, 400);
  const clientId = String(body.cf_client_id || '').trim();
  if (!clientId) return jres({ error: 'cf_client_id required' }, 400);
  const apiUrl = String(body.api_url || '').trim();
  if (apiUrl && !/^https:\/\//.test(apiUrl)) return jres({ error: 'api_url must be an https URL' }, 400);

  const existing = await activeEmailIntegration(env, customerId);
  const prev = existing ? parseConfig(existing.config) : {};
  const clientSecret = String(body.cf_client_secret || '').trim() || prev.cf_client_secret || '';
  if (!clientSecret) return jres({ error: 'cf_client_secret required' }, 400);

  const config = JSON.stringify({
    from_email: fromEmail,
    from_name: String(body.from_name || '').trim(),
    api_url: apiUrl,
    cf_client_id: clientId,
    cf_client_secret: clientSecret,
  });
  const ts = now();
  if (existing) {
    await scopedRun(env, null, {
      sql: 'UPDATE integrations SET config=?, name=?, updated_at=? WHERE id=? AND /*SCOPE*/',
      binds: [config, `Email sender (${fromEmail})`, ts, existing.id], alias: 'integrations', scope: { mode: 'one', customerId },
    });
  } else {
    await scopedInsert(env, ctx, {
      table: 'integrations',
      row: { id: 'int_' + crypto.randomUUID().replace(/-/g, '').slice(0, 24), kind: 'email', name: `Email sender (${fromEmail})`, config, active: 1, created_by: ctx.user.id, created_at: ts, updated_at: ts },
      requested: customerId,
    });
  }
  return jres({ sender: publicSender(await activeEmailIntegration(env, customerId)) });
}

// DELETE /api/customers/:id/sender — Cintelis admin only. Campaigns for this
// customer fail to send until a new identity is set; that is the point.
export async function deleteSenderIdentity(env, ctx, customerId) {
  if (!isInternalAdmin(ctx)) return jres({ error: 'Forbidden: Cintelis admin only' }, 403);
  const existing = await activeEmailIntegration(env, customerId);
  if (!existing) return jres({ ok: true, already_removed: true });
  await scopedRun(env, null, {
    sql: 'UPDATE integrations SET active=0, updated_at=? WHERE id=? AND /*SCOPE*/',
    binds: [now(), existing.id], alias: 'integrations', scope: { mode: 'one', customerId },
  });
  return jres({ ok: true });
}

/**
 * Sender + transport for a tenant.
 *
 *   customerId null → Cintelis: env transport, DEFAULT_FROM/NAME.
 *   customerId set  → that customer's active `email` integration:
 *                     config { api_url?, cf_client_id, cf_client_secret, from_email, from_name? }
 *                     api_url defaults to the shared worker URL (the worker
 *                     picks the Microsoft tenant from the request hostname, so
 *                     a customer with their own send domain sets api_url).
 * Returns { ok, transport, from_email, from_name, error }.
 */
export async function resolveSender(env, customerId) {
  if (!customerId) {
    return {
      ok: true,
      transport: {
        apiUrl: String(env.EMAIL_API_URL || env.EMAIL_WORKER_URL || EMAIL_WORKER).trim(),
        clientId: String(env.CF_ACCESS_CLIENT_ID || '').trim(),
        clientSecret: String(env.CF_ACCESS_CLIENT_SECRET || '').trim(),
      },
      from_email: DEFAULT_FROM,
      from_name: DEFAULT_NAME,
    };
  }
  const row = await activeEmailIntegration(env, customerId);
  if (!row) return { ok: false, error: 'No sending identity is configured for this organisation. Ask Cintelis to set one up.' };
  const cfg = parseConfig(row.config);
  const fromEmail = String(cfg.from_email || '').trim();
  const clientId = String(cfg.cf_client_id || '').trim();
  const clientSecret = String(cfg.cf_client_secret || '').trim();
  if (!fromEmail || !clientId || !clientSecret) {
    return { ok: false, error: 'The sending identity for this organisation is incomplete (from_email, cf_client_id and cf_client_secret are required).' };
  }
  return {
    ok: true,
    transport: {
      apiUrl: String(cfg.api_url || EMAIL_WORKER).trim(),
      clientId,
      clientSecret,
    },
    from_email: fromEmail,
    from_name: String(cfg.from_name || '').trim() || fromEmail,
  };
}

/**
 * One send. `transport` is optional — worker.js's transactional mail passes
 * none and gets the env transport, exactly as before the move.
 */
export async function sendEmail(env, { to, subject, html_body, from_email, from_name, transport = null }) {
  const t = transport || {
    apiUrl: String(env.EMAIL_API_URL || env.EMAIL_WORKER_URL || EMAIL_WORKER).trim(),
    clientId: String(env.CF_ACCESS_CLIENT_ID || '').trim(),
    clientSecret: String(env.CF_ACCESS_CLIENT_SECRET || '').trim(),
  };
  if (!t.apiUrl) return { ok: false, skipped: false, error: 'Email API URL is not configured.' };
  if (!t.clientId || !t.clientSecret) {
    return { ok: false, skipped: false, error: 'Cloudflare Access service token is not configured.' };
  }
  const delays = [1500, 4000, 9000];
  let lastError = 'Email send failed';
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const r = await fetch(t.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'CF-Access-Client-Id': t.clientId,
          'CF-Access-Client-Secret': t.clientSecret
        },
        body: JSON.stringify({ to, subject, message: html_body, contentType: 'HTML', fromEmail: from_email, fromName: from_name })
      });
      const d = await r.json().catch(() => ({}));
      if (r.status === 403 && d.code === 'RECIPIENT_UNSUBSCRIBED') {
        return { ok: false, skipped: true, error: 'Unsubscribed' };
      }
      if (r.ok && d.success !== false) {
        return { ok: true, skipped: false, error: null };
      }
      lastError = d.error || d.message || `Email API returned HTTP ${r.status}`;
      if (!shouldRetryEmailSend(r.status, d) || attempt === delays.length) {
        return { ok: false, skipped: false, error: lastError };
      }
      await sleep(getRetryDelayMs(r, attempt, delays));
    } catch (e) {
      lastError = e?.message || 'Network error';
      if (attempt === delays.length) {
        return { ok: false, skipped: false, error: lastError };
      }
      await sleep(delays[attempt]);
    }
  }
  return { ok: false, skipped: false, error: lastError };
}

function shouldRetryEmailSend(status, body) {
  if (status === 429 || status >= 500) return true;
  const combined = [body?.code, body?.error, body?.message, body?.details].map(value => String(value || '')).join(' ').toLowerCase();
  if (status === 400 && body?.code === 'MS_GRAPH_SEND_ERROR') {
    return /429|thrott|too many requests|temporar|timeout|try again|server busy|service unavailable/.test(combined);
  }
  return false;
}

function getRetryDelayMs(response, attempt, defaults) {
  const retryAfter = response.headers.get('Retry-After');
  const fallback = defaults[Math.min(attempt, defaults.length - 1)];
  if (!retryAfter) return fallback;
  const seconds = parseInt(retryAfter, 10);
  if (Number.isFinite(seconds) && seconds > 0) return Math.max(fallback, seconds * 1000);
  const retryAt = Date.parse(retryAfter);
  if (Number.isFinite(retryAt)) return Math.max(fallback, Math.max(0, retryAt - Date.now()));
  return fallback;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Merge tags resolved here; {{unsubscribe_url}} / {{physical_address}} are the email worker's. */
export function merge(html, c) {
  const firstName = String(c.first_name || splitContactName(c.name).first_name || '').trim();
  const lastName = String(c.last_name || splitContactName(c.name).last_name || '').trim();
  return html
    .replace(/\{\{first_name\}\}/gi, firstName || 'there')
    .replace(/\{\{last_name\}\}/gi, lastName)
    .replace(/\{\{name\}\}/gi, c.name || 'there')
    .replace(/\{\{email\}\}/gi, c.email)
    .replace(/\{\{company\}\}/gi, c.company || '');
}

export function splitContactName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first_name: '', last_name: '' };
  return { first_name: parts[0], last_name: parts.slice(1).join(' ') };
}
