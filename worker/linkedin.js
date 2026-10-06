import { PUBLIC_BASE_URL } from './config.js';
// ============================================================
// Cintelis Workspace — LinkedIn integration (Ad Library + Community Management)
// Self-contained except for the event bus. Owns the 3-legged OAuth flow
// (shared admin connection, token stored in D1) and two API surfaces:
//
//   1. Ad Library (no special scope): /rest/adLibrary, /rest/paidEndorsementPosts
//   2. Community Management API (CMAPI, org-social scopes): publishing,
//      analytics, and comment monitoring for the company page. See the
//      CMAPI section lower in this file.
//
// The shared member access token is stored as a single row (id = 'shared')
// in the linkedin_oauth table and is NEVER returned to the client. All API
// calls reuse it on the team's behalf. The member who connects must hold an
// ADMINISTRATOR role on the page for the CMAPI scopes to be granted.
//
// API reference (api.linkedin.com/rest):
//   Ads:                GET /rest/adLibrary?q=criteria&...
//   Brand partnerships: GET /rest/paidEndorsementPosts?q=searchCriteria&...
// Required headers on every call:
//   Authorization: Bearer <token>
//   X-RestLi-Protocol-Version: 2.0.0
//   Linkedin-Version: <YYYYMM>
// ============================================================

import { emit, EVENT_TYPES } from './events.js';

// Two separate LinkedIn developer apps back the two surfaces, each with its
// own OAuth token (one token can't span two apps):
//   - 'adlib' → Ad Library, on the "Totally Wild AI" app (86y9c1txmueuv2)
//   - 'cmapi' → Community Management API, on the "Brand Build" app (86kbds3w9bh1yt)
// Both apps must register the same redirect URI below.
const CLIENT_ID_FALLBACK = '86y9c1txmueuv2';        // Ad Library app
const CMAPI_CLIENT_ID_FALLBACK = '86kbds3w9bh1yt';  // Community Management app
const REDIRECT_URI_FALLBACK = `/api/linkedin/callback`;
const ADLIB_SCOPE = 'openid profile';
// CMAPI org-social scopes — must be enabled on the Brand Build app, and the
// connecting member must be a page ADMINISTRATOR for them to be granted.
const CMAPI_SCOPE = 'openid profile w_organization_social r_organization_social rw_organization_admin r_organization_social_feed w_organization_social_feed r_organization_followers';
const LINKEDIN_VERSION = '202602'; // YYYYMM — bump if LinkedIn returns a version error

const AUTHORIZE_URL = 'https://www.linkedin.com/oauth/v2/authorization';
const TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const REST_BASE = 'https://api.linkedin.com/rest';
const STATE_TTL_SECONDS = 600; // 10 min to complete the redirect dance

// ── Local helpers ────────────────────────────────────────────
function now() { return new Date().toISOString(); }
function jres(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
function redirectUri(env) { return env.LINKEDIN_REDIRECT_URI || REDIRECT_URI_FALLBACK; }

// Per-surface OAuth config. 'cmapi' = Community Management (Brand Build app);
// anything else = Ad Library (default). Each stores its token in its own
// linkedin_oauth row so the two connections are fully independent.
function accountCfg(env, purpose) {
  if (purpose === 'cmapi') {
    return {
      purpose: 'cmapi',
      rowId: 'cmapi',
      clientId: env.LINKEDIN_CMAPI_CLIENT_ID || CMAPI_CLIENT_ID_FALLBACK,
      clientSecret: env.LINKEDIN_CMAPI_CLIENT_SECRET || '',
      secretVar: 'LINKEDIN_CMAPI_CLIENT_SECRET',
      scope: env.LINKEDIN_CMAPI_SCOPE || CMAPI_SCOPE,
    };
  }
  return {
    purpose: 'adlib',
    rowId: 'shared',
    clientId: env.LINKEDIN_CLIENT_ID || CLIENT_ID_FALLBACK,
    clientSecret: env.LINKEDIN_CLIENT_SECRET || '',
    secretVar: 'LINKEDIN_CLIENT_SECRET',
    scope: env.LINKEDIN_OAUTH_SCOPE || ADLIB_SCOPE,
  };
}

function htmlResponse(body, status = 200) {
  return new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

// Small page shown after the OAuth redirect: reload the opener (so the
// status flips to connected) and close the popup; fall back to redirect.
function callbackPage(message, ok) {
  const safe = String(message).replace(/</g, '&lt;');
  return htmlResponse(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>LinkedIn</title>
<style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f4f5f7;color:#172B4D;
display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.box{background:#fff;border:1px solid #dfe1e6;border-radius:12px;padding:28px 32px;max-width:420px;text-align:center}
.ok{color:#0C66E4}.err{color:#c9372c}</style></head>
<body><div class="box"><h2 class="${ok ? 'ok' : 'err'}">${ok ? 'LinkedIn connected' : 'Connection failed'}</h2>
<p>${safe}</p><p style="font-size:13px;color:#6B778C">You can close this window.</p></div>
<script>
  try { if (window.opener && !window.opener.closed) { window.opener.location.reload(); } } catch (e) {}
  setTimeout(function(){ try { window.close(); } catch(e){} if (!window.opener) { location.href = '/#/linkedin'; } }, 1200);
</script></body></html>`);
}

// ── OAuth: start ─────────────────────────────────────────────
// Returns { authorizeUrl } after stashing a CSRF state token in KV.
export async function startConnect(env, authCtx, purpose = 'adlib') {
  const cfg = accountCfg(env, purpose);
  if (!cfg.clientSecret) {
    return jres({ error: `LinkedIn is not configured (missing ${cfg.secretVar} secret).` }, 500);
  }
  const state = crypto.randomUUID().replace(/-/g, '');
  // Stash both the user and which surface we're connecting, so the callback
  // exchanges the code against the matching app and stores it in the right row.
  await env.KV.put(`li_oauth_state:${state}`, `${authCtx.user.id}|${cfg.purpose}`, { expirationTtl: STATE_TTL_SECONDS });
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: cfg.clientId,
    redirect_uri: redirectUri(env),
    state,
    scope: cfg.scope,
  });
  return jres({ authorizeUrl: `${AUTHORIZE_URL}?${params.toString()}` });
}

// ── OAuth: callback (browser redirect, no Bearer header) ─────
export async function handleOAuthCallback(req, env, url) {
  const err = url.searchParams.get('error');
  if (err) {
    const desc = url.searchParams.get('error_description') || err;
    return callbackPage(`LinkedIn returned: ${desc}`, false);
  }
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) return callbackPage('Missing code or state in the callback.', false);

  const stateKey = `li_oauth_state:${state}`;
  const stored = await env.KV.get(stateKey);
  if (!stored) return callbackPage('This authorization link has expired. Please try connecting again.', false);
  await env.KV.delete(stateKey);
  const [userId, purpose = 'adlib'] = stored.split('|');
  const cfg = accountCfg(env, purpose);

  // Exchange the authorization code for an access token against the right app.
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(env),
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  });
  let tok;
  try {
    const r = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    tok = await r.json();
    if (!r.ok || !tok.access_token) {
      return callbackPage(`Token exchange failed: ${tok.error_description || tok.error || r.status}`, false);
    }
  } catch (e) {
    return callbackPage(`Token exchange error: ${e?.message || e}`, false);
  }

  const nowMs = Date.now();
  const expiresAt = tok.expires_in ? nowMs + Number(tok.expires_in) * 1000 : null;
  const refreshExpiresAt = tok.refresh_token_expires_in ? nowMs + Number(tok.refresh_token_expires_in) * 1000 : null;

  // Look up the connecting user's email for display (best-effort).
  let email = null;
  try {
    const u = await env.DB.prepare('SELECT email FROM users WHERE id=?').bind(userId).first();
    email = u?.email || null;
  } catch { /* ignore */ }

  // Upsert the row for this surface ('shared' = Ad Library, 'cmapi' = CMAPI).
  await env.DB.prepare(
    `INSERT INTO linkedin_oauth (id, access_token, refresh_token, expires_at, refresh_expires_at, scope, connected_by, connected_by_email, connected_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       access_token=excluded.access_token,
       refresh_token=COALESCE(excluded.refresh_token, linkedin_oauth.refresh_token),
       expires_at=excluded.expires_at,
       refresh_expires_at=excluded.refresh_expires_at,
       scope=excluded.scope,
       connected_by=excluded.connected_by,
       connected_by_email=excluded.connected_by_email,
       connected_at=excluded.connected_at`
  ).bind(
    cfg.rowId, tok.access_token, tok.refresh_token || null, expiresAt, refreshExpiresAt,
    tok.scope || cfg.scope, userId, email, now()
  ).run();

  return callbackPage(
    cfg.purpose === 'cmapi'
      ? 'Community Management connected. You can now publish, view analytics, and manage comments.'
      : 'You can now search the LinkedIn Ad Library.',
    true);
}

// ── Status / disconnect ──────────────────────────────────────
async function statusFor(env, purpose) {
  const cfg = accountCfg(env, purpose);
  const row = await env.DB.prepare(
    'SELECT expires_at, scope, connected_by_email, connected_at FROM linkedin_oauth WHERE id=?'
  ).bind(cfg.rowId).first();
  if (!row) return { connected: false, configured: !!cfg.clientSecret };
  const expired = row.expires_at != null && Date.now() >= Number(row.expires_at);
  const scope = row.scope || '';
  const base = {
    connected: true,
    expired,
    expires_at: row.expires_at,
    scope,
    connected_by_email: row.connected_by_email,
    connected_at: row.connected_at,
  };
  if (purpose === 'cmapi') {
    base.canManage = /\bw_organization_social\b/.test(scope) && /\brw_organization_admin\b/.test(scope);
    base.org_id = await env.KV.get('li_org_id');
  }
  return base;
}

// Returns Ad Library status at the top level (back-compat) plus a nested
// `cmapi` object for the Community Management connection.
export async function getStatus(env) {
  const [adlib, cmapi] = await Promise.all([statusFor(env, 'adlib'), statusFor(env, 'cmapi')]);
  return jres({ ...adlib, cmapi });
}

export async function disconnect(env, purpose = 'adlib') {
  const cfg = accountCfg(env, purpose);
  await env.DB.prepare('DELETE FROM linkedin_oauth WHERE id=?').bind(cfg.rowId).run();
  return jres({ ok: true });
}

// Returns a usable access token string for the given surface, or { error }
// if a reconnect is needed.
async function getValidToken(env, purpose = 'adlib') {
  const cfg = accountCfg(env, purpose);
  const row = await env.DB.prepare(
    'SELECT access_token, refresh_token, expires_at, refresh_expires_at FROM linkedin_oauth WHERE id=?'
  ).bind(cfg.rowId).first();
  if (!row) return { error: 'not_connected' };

  const nowMs = Date.now();
  const expired = row.expires_at != null && nowMs >= Number(row.expires_at) - 60_000; // 1 min skew
  if (!expired) return { token: row.access_token };

  // Try a refresh if we have a non-expired refresh token.
  const refreshable = row.refresh_token &&
    (row.refresh_expires_at == null || nowMs < Number(row.refresh_expires_at));
  if (!refreshable) return { error: 'reconnect_required' };

  try {
    const form = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: row.refresh_token,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
    });
    const r = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const tok = await r.json();
    if (!r.ok || !tok.access_token) return { error: 'reconnect_required' };
    const newExpiresAt = tok.expires_in ? nowMs + Number(tok.expires_in) * 1000 : null;
    const newRefreshExpiresAt = tok.refresh_token_expires_in ? nowMs + Number(tok.refresh_token_expires_in) * 1000 : null;
    await env.DB.prepare(
      `UPDATE linkedin_oauth SET access_token=?, refresh_token=COALESCE(?, refresh_token),
       expires_at=?, refresh_expires_at=? WHERE id=?`
    ).bind(tok.access_token, tok.refresh_token || null, newExpiresAt, newRefreshExpiresAt, cfg.rowId).run();
    return { token: tok.access_token };
  } catch {
    return { error: 'reconnect_required' };
  }
}

// ── Rest.li query builders ───────────────────────────────────
// Build raw query strings: LinkedIn's Rest.li syntax needs the (), List(),
// and structural colons/commas to stay literal — only the dynamic *values*
// (and the urn colons) get percent-encoded.
function fmtCountries(raw) {
  const codes = String(raw).split(',').map(c => c.trim()).filter(Boolean);
  if (!codes.length) return null;
  const list = codes.map(c => 'urn%3Ali%3Acountry%3A' + encodeURIComponent(c)).join(',');
  return `(value:List(${list}))`;
}
function ymd(dateStr) {
  // dateStr is yyyy-mm-dd
  const [y, m, d] = String(dateStr).split('-').map(n => parseInt(n, 10));
  if (!y || !m || !d) return null;
  return { y, m, d };
}
function fmtDateRange(startStr, endStr) {
  const s = startStr ? ymd(startStr) : null;
  const e = endStr ? ymd(endStr) : null;
  if (!s && !e) return null;
  const parts = [];
  if (s) parts.push(`start:(day:${s.d},month:${s.m},year:${s.y})`);
  if (e) parts.push(`end:(day:${e.d},month:${e.m},year:${e.y})`);
  return `(${parts.join(',')})`;
}

async function linkedinGet(env, path, rawQuery) {
  const tk = await getValidToken(env);
  if (tk.error) return jres({ error: tk.error }, tk.error === 'not_connected' ? 409 : 401);
  let resp;
  try {
    resp = await fetch(`${REST_BASE}${path}?${rawQuery}`, {
      headers: {
        'Authorization': `Bearer ${tk.token}`,
        'X-RestLi-Protocol-Version': '2.0.0',
        'Linkedin-Version': LINKEDIN_VERSION,
      },
    });
  } catch (e) {
    return jres({ error: 'upstream_error', detail: e?.message || String(e) }, 502);
  }
  const text = await resp.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (resp.status === 401) return jres({ error: 'reconnect_required' }, 401);
  if (!resp.ok) return jres({ error: 'linkedin_error', status: resp.status, detail: data }, resp.status);
  return jres(data);
}

// ── Ads search ───────────────────────────────────────────────
// GET /api/linkedin/ads?keyword=&advertiser=&payerName=&countries=US,GB
//   &dateStart=yyyy-mm-dd&dateEnd=yyyy-mm-dd&sort=DESCENDING&start=0&count=12
export async function searchAds(env, url) {
  const p = url.searchParams;
  const parts = ['q=criteria'];
  const keyword = (p.get('keyword') || '').trim();
  const advertiser = (p.get('advertiser') || '').trim();
  const payerName = (p.get('payerName') || '').trim();
  if (keyword) parts.push('keyword=' + encodeURIComponent(keyword));
  if (advertiser) parts.push('advertiser=' + encodeURIComponent(advertiser));
  if (payerName) parts.push('payerName=' + encodeURIComponent(payerName));

  const countries = p.get('countries');
  if (countries) { const c = fmtCountries(countries); if (c) parts.push('countries=' + c); }

  const dr = fmtDateRange(p.get('dateStart'), p.get('dateEnd'));
  if (dr) parts.push('dateRange=' + dr);

  const sort = (p.get('sort') || '').trim().toUpperCase();
  if (sort === 'ASCENDING' || sort === 'DESCENDING') {
    parts.push(`sortBy=(order:${sort},field:CREATED_TIME)`);
  }

  const start = Math.max(0, parseInt(p.get('start') || '0', 10) || 0);
  let count = parseInt(p.get('count') || '12', 10) || 12;
  count = Math.min(Math.max(count, 1), 24); // API: count must be < 25
  parts.push(`start=${start}`, `count=${count}`);

  return linkedinGet(env, '/adLibrary', parts.join('&'));
}

// ── Brand Partnerships search ────────────────────────────────
// GET /api/linkedin/brand-partnerships?keyword=&dateRange=PAST_WEEK&start=0&count=10
export async function searchBrandPartnerships(env, url) {
  const p = url.searchParams;
  const keyword = (p.get('keyword') || '').trim();
  if (!keyword) return jres({ error: 'keyword_required' }, 400);

  const parts = ['q=searchCriteria', 'keyword=' + encodeURIComponent(keyword)];

  const dateRange = (p.get('dateRange') || '').trim().toUpperCase();
  if (['PAST_24H', 'PAST_WEEK', 'PAST_MONTH'].includes(dateRange)) {
    parts.push('dateRange=' + dateRange);
  }

  const start = Math.max(0, parseInt(p.get('start') || '0', 10) || 0);
  let count = parseInt(p.get('count') || '10', 10) || 10;
  count = Math.min(Math.max(count, 1), 25);
  parts.push(`start=${start}`, `count=${count}`);

  return linkedinGet(env, '/paidEndorsementPosts', parts.join('&'));
}

// ============================================================
// Community Management API (CMAPI) — page publishing, analytics, comments
//
// Everything below reuses getValidToken() and targets the Totally Wild AI
// organization. The org id is resolved once (by vanity name) and cached in KV.
// Exact request/response shapes follow the LinkedIn Marketing docs
// (li-lms-2026-06): Posts API, Comments API, Follower/Share/Page Statistics.
// ============================================================

// Low-level CMAPI request. Unlike linkedinGet (which returns a Response for
// proxy routes), this returns a plain result object so internal callers
// (scheduler) can branch on it. URNs in the path/query must be pre-encoded.
async function apiRequest(env, method, pathAndQuery, { body, extraHeaders } = {}) {
  const tk = await getValidToken(env, 'cmapi');
  if (tk.error) {
    return { ok: false, status: tk.error === 'not_connected' ? 409 : 401, error: tk.error };
  }
  const headers = {
    'Authorization': `Bearer ${tk.token}`,
    'X-RestLi-Protocol-Version': '2.0.0',
    'Linkedin-Version': LINKEDIN_VERSION,
    ...(extraHeaders || {}),
  };
  const init = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let resp;
  try {
    resp = await fetch(`${REST_BASE}${pathAndQuery}`, init);
  } catch (e) {
    return { ok: false, status: 502, error: 'upstream_error', detail: e?.message || String(e) };
  }
  const text = await resp.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  return { ok: resp.ok, status: resp.status, data, restliId: resp.headers.get('x-restli-id') };
}

// Resolve the managed org URN. Order: explicit env id → KV cache → vanityName
// lookup (cached). Returns { id, urn } or { error }.
async function resolveOrgUrn(env) {
  if (env.LINKEDIN_ORG_ID) {
    const id = String(env.LINKEDIN_ORG_ID);
    return { id, urn: `urn:li:organization:${id}` };
  }
  const cached = await env.KV.get('li_org_id');
  if (cached) return { id: cached, urn: `urn:li:organization:${cached}` };

  const vanity = env.LINKEDIN_ORG_VANITY || 'totallywildai';
  const r = await apiRequest(env, 'GET', `/organizations?q=vanityName&vanityName=${encodeURIComponent(vanity)}`);
  if (!r.ok) return { error: r.error || 'org_lookup_failed', status: r.status, detail: r.data };
  const el = Array.isArray(r.data?.elements) ? r.data.elements[0] : null;
  const id = el?.id != null ? String(el.id) : null;
  if (!id) return { error: 'org_not_found', detail: r.data };
  await env.KV.put('li_org_id', id);
  return { id, urn: `urn:li:organization:${id}` };
}

function todayUTC() { return new Date().toISOString().slice(0, 10); }

// The Posts API `commentary` field uses LinkedIn's "little" text format, where
// these characters are reserved and MUST be backslash-escaped to render as
// literal text — otherwise LinkedIn stops parsing at the first one (e.g. an
// unescaped "(" silently truncates the post). Backslash is escaped first.
// We intentionally leave '#' unescaped so "#tag" still renders as a hashtag.
function escapeLittleText(s) {
  if (!s) return s;
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/([|{}@\[\]()<>*_~])/g, '\\$1');
}

// ── Publishing ───────────────────────────────────────────────
// Push a stored post row to LinkedIn as an organic text post and record the
// returned URN (or the failure) back onto the row.
async function doPublish(env, row) {
  const org = await resolveOrgUrn(env);
  if (org.error) {
    await env.DB.prepare("UPDATE linkedin_posts SET status='failed', error=? WHERE id=?")
      .bind(`org: ${org.error}`, row.id).run();
    return { ok: false, error: org.error, status: org.status };
  }
  const postBody = {
    author: org.urn,
    commentary: escapeLittleText(row.body),
    visibility: row.visibility || 'PUBLIC',
    distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false,
  };
  // Single image/document attachment (Images/Documents API URN). Documents
  // want a title; images optionally take altText.
  if (row.media_urn) {
    const media = { id: row.media_urn };
    if (row.media_title) media.title = row.media_title;
    if (row.media_alt) media.altText = row.media_alt;
    postBody.content = { media };
  }
  const r = await apiRequest(env, 'POST', '/posts', { body: postBody, extraHeaders: { 'X-RestLi-Method': 'CREATE' } });
  if (!r.ok || !r.restliId) {
    const detail = r.error || (r.data ? JSON.stringify(r.data) : `HTTP ${r.status}`);
    await env.DB.prepare("UPDATE linkedin_posts SET status='failed', error=? WHERE id=?")
      .bind(String(detail).slice(0, 500), row.id).run();
    return { ok: false, error: 'publish_failed', detail, status: r.status };
  }
  await env.DB.prepare("UPDATE linkedin_posts SET status='published', post_urn=?, published_at=?, error=NULL WHERE id=?")
    .bind(r.restliId, now(), row.id).run();
  return { ok: true, post_urn: r.restliId };
}

// POST /api/linkedin/media?type=image|document&filename=...  (raw file body)
// Registers the asset with LinkedIn, uploads the bytes, returns the asset URN
// for the client to attach to a post. Keeps the token server-side.
export async function uploadMedia(req, env, url) {
  const type = (url.searchParams.get('type') || '').toLowerCase();
  const filename = url.searchParams.get('filename') || '';
  if (type !== 'image' && type !== 'document') return jres({ error: 'bad_type' }, 400);

  const bytes = await req.arrayBuffer();
  if (!bytes || bytes.byteLength === 0) return jres({ error: 'empty_file' }, 400);
  // Guards: LinkedIn caps documents at 100MB; images by pixel count (size proxy).
  const maxBytes = type === 'document' ? 100 * 1024 * 1024 : 40 * 1024 * 1024;
  if (bytes.byteLength > maxBytes) return jres({ error: 'file_too_large' }, 413);

  const org = await resolveOrgUrn(env);
  if (org.error) return jres({ error: org.error }, 409);

  // 1) initializeUpload → { value: { uploadUrl, image|document } }
  const initPath = type === 'image' ? '/images?action=initializeUpload' : '/documents?action=initializeUpload';
  const init = await apiRequest(env, 'POST', initPath, { body: { initializeUploadRequest: { owner: org.urn } } });
  if (!init.ok) return jres({ error: 'init_failed', status: init.status, detail: init.data }, init.status || 502);
  const value = init.data?.value || {};
  const uploadUrl = value.uploadUrl;
  const assetUrn = value.image || value.document;
  if (!uploadUrl || !assetUrn) return jres({ error: 'init_no_url', detail: init.data }, 502);

  // 2) PUT the bytes to the returned upload URL (Bearer-authenticated).
  const tk = await getValidToken(env, 'cmapi');
  if (tk.error) return jres({ error: tk.error }, 401);
  let put;
  try {
    put = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${tk.token}`,
        'Content-Type': req.headers.get('Content-Type') || 'application/octet-stream',
      },
      body: bytes,
    });
  } catch (e) {
    return jres({ error: 'upload_failed', detail: e?.message || String(e) }, 502);
  }
  if (!put.ok) {
    const t = await put.text().catch(() => '');
    return jres({ error: 'upload_rejected', status: put.status, detail: String(t).slice(0, 300) }, 502);
  }

  // 3) Return the URN for the client to include when publishing. Processing is
  // async on LinkedIn's side; the post can reference the URN immediately.
  return jres({ ok: true, type, urn: assetUrn, title: filename });
}

// POST /api/linkedin/posts — create a draft/scheduled post (optionally publish now).
export async function createPost(req, env, authCtx) {
  let b;
  try { b = await req.json(); } catch { return jres({ error: 'invalid_json' }, 400); }
  const body = (b.body || '').trim();
  const mediaType = (b.mediaType === 'image' || b.mediaType === 'document') ? b.mediaType : null;
  const mediaUrn = mediaType ? ((b.mediaUrn || '').trim() || null) : null;
  const mediaTitle = (b.mediaTitle || '').trim() || null;
  const mediaAlt = (b.mediaAlt || '').trim() || null;
  // A post needs text or an attachment (or both).
  if (!body && !mediaUrn) return jres({ error: 'body_required' }, 400);
  const visibility = b.visibility === 'CONNECTIONS' ? 'CONNECTIONS' : 'PUBLIC';
  const scheduledAt = b.scheduledAt || null;
  const publishNow = !!b.publishNow;
  const status = (!publishNow && scheduledAt) ? 'scheduled' : 'draft';
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO linkedin_posts (id, body, visibility, status, scheduled_at, created_by, created_at, media_type, media_urn, media_title, media_alt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(id, body, visibility, status, scheduledAt, authCtx?.user?.id || null, now(),
    mediaType, mediaUrn, mediaTitle, mediaAlt).run();

  if (publishNow) {
    const row = await env.DB.prepare('SELECT * FROM linkedin_posts WHERE id=?').bind(id).first();
    const res = await doPublish(env, row);
    const saved = await env.DB.prepare('SELECT * FROM linkedin_posts WHERE id=?').bind(id).first();
    if (!res.ok) return jres({ error: res.error, detail: res.detail, post: saved }, res.status || 502);
    return jres({ ok: true, post: saved });
  }
  const saved = await env.DB.prepare('SELECT * FROM linkedin_posts WHERE id=?').bind(id).first();
  return jres({ ok: true, post: saved });
}

// GET /api/linkedin/posts
export async function listPosts(env) {
  const { results } = await env.DB.prepare(
    'SELECT * FROM linkedin_posts ORDER BY COALESCE(published_at, scheduled_at, created_at) DESC LIMIT 100'
  ).all();
  return jres({ posts: results || [] });
}

// POST /api/linkedin/posts/:id/publish
export async function publishPostNow(env, id) {
  const row = await env.DB.prepare('SELECT * FROM linkedin_posts WHERE id=?').bind(id).first();
  if (!row) return jres({ error: 'not_found' }, 404);
  if (row.status === 'published') return jres({ error: 'already_published' }, 409);
  const res = await doPublish(env, row);
  const saved = await env.DB.prepare('SELECT * FROM linkedin_posts WHERE id=?').bind(id).first();
  if (!res.ok) return jres({ error: res.error, detail: res.detail, post: saved }, res.status || 502);
  return jres({ ok: true, post: saved });
}

// DELETE /api/linkedin/posts/:id — removes the local row and, if it was
// published, best-effort deletes it from LinkedIn too.
export async function deletePost(env, id) {
  const row = await env.DB.prepare('SELECT * FROM linkedin_posts WHERE id=?').bind(id).first();
  if (!row) return jres({ error: 'not_found' }, 404);
  if (row.post_urn) {
    await apiRequest(env, 'DELETE', `/posts/${encodeURIComponent(row.post_urn)}`, { extraHeaders: { 'X-RestLi-Method': 'DELETE' } });
  }
  await env.DB.prepare('DELETE FROM linkedin_posts WHERE id=?').bind(id).run();
  return jres({ ok: true });
}

// ── Analytics ────────────────────────────────────────────────
// Pull lifetime totals from three endpoints in parallel. Total follower count
// lives in networkSizes (follower-statistics no longer returns it).
async function fetchAnalytics(env) {
  const org = await resolveOrgUrn(env);
  if (org.error) return { error: org.error, status: org.status, detail: org.detail };
  const enc = encodeURIComponent(org.urn);
  const [net, share, page] = await Promise.all([
    apiRequest(env, 'GET', `/networkSizes/${enc}?edgeType=COMPANY_FOLLOWED_BY_MEMBER`),
    apiRequest(env, 'GET', `/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${enc}`),
    apiRequest(env, 'GET', `/organizationPageStatistics?q=organization&organization=${enc}`),
  ]);
  const s = share.ok ? (share.data?.elements?.[0]?.totalShareStatistics || {}) : {};
  const views = page.ok ? page.data?.elements?.[0]?.totalPageStatistics?.views?.allPageViews?.pageViews : null;
  return {
    followerCount: net.ok ? (net.data?.firstDegreeSize ?? null) : null,
    impressionCount: s.impressionCount ?? null,
    uniqueImpressions: s.uniqueImpressionsCount ?? null,
    clickCount: s.clickCount ?? null,
    likeCount: s.likeCount ?? null,
    commentCount: s.commentCount ?? null,
    shareCount: s.shareCount ?? null,
    engagement: s.engagement ?? null,
    pageViews: views ?? null,
    raw: { networkSizes: net.data, shareStatistics: share.data, pageStatistics: page.data },
    errors: [net, share, page].filter(x => !x.ok).map(x => ({ status: x.status, error: x.error || x.data })),
  };
}

async function refreshAnalytics(env) {
  const a = await fetchAnalytics(env);
  if (a.error) return { ok: false, error: a.error, status: a.status, detail: a.detail };
  const date = todayUTC();
  await env.DB.prepare(
    `INSERT INTO linkedin_stats (snapshot_date, follower_count, impression_count, unique_impressions, click_count, like_count, comment_count, share_count, engagement, page_views, raw, captured_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(snapshot_date) DO UPDATE SET
       follower_count=excluded.follower_count, impression_count=excluded.impression_count,
       unique_impressions=excluded.unique_impressions, click_count=excluded.click_count,
       like_count=excluded.like_count, comment_count=excluded.comment_count,
       share_count=excluded.share_count, engagement=excluded.engagement,
       page_views=excluded.page_views, raw=excluded.raw, captured_at=excluded.captured_at`
  ).bind(date, a.followerCount, a.impressionCount, a.uniqueImpressions, a.clickCount, a.likeCount,
    a.commentCount, a.shareCount, a.engagement, a.pageViews, JSON.stringify(a.raw), now()).run();
  return { ok: true, snapshot_date: date, errors: a.errors };
}

// POST /api/linkedin/analytics/refresh
export async function apiRefreshAnalytics(env) {
  const r = await refreshAnalytics(env);
  if (!r.ok) return jres({ error: r.error, detail: r.detail }, r.status || 502);
  return jres({ ok: true, snapshot_date: r.snapshot_date, errors: r.errors });
}

// GET /api/linkedin/analytics
export async function apiGetAnalytics(env) {
  const { results } = await env.DB.prepare(
    'SELECT * FROM linkedin_stats ORDER BY snapshot_date DESC LIMIT 120'
  ).all();
  return jres({ snapshots: results || [] });
}

// ── Comments ─────────────────────────────────────────────────
// Scan the page's most recent posts and ingest any new comments. New
// third-party comments fan out an event via emit().
async function ingestComments(env) {
  const org = await resolveOrgUrn(env);
  if (org.error) return { ok: false, error: org.error };
  const encOrg = encodeURIComponent(org.urn);
  const scan = parseInt(env.LINKEDIN_COMMENT_SCAN_POSTS || '5', 10) || 5;
  const postsRes = await apiRequest(env, 'GET',
    `/posts?q=author&author=${encOrg}&count=${scan}&sortBy=LAST_MODIFIED`,
    { extraHeaders: { 'X-RestLi-Method': 'FINDER' } });
  if (!postsRes.ok) return { ok: false, error: 'posts_finder_failed', status: postsRes.status };
  const posts = Array.isArray(postsRes.data?.elements) ? postsRes.data.elements : [];

  let ingested = 0;
  const fresh = [];
  for (const p of posts) {
    const postUrn = p.id;
    if (!postUrn) continue;
    const cRes = await apiRequest(env, 'GET', `/socialActions/${encodeURIComponent(postUrn)}/comments`);
    if (!cRes.ok) continue;
    const comments = Array.isArray(cRes.data?.elements) ? cRes.data.elements : [];
    for (const c of comments) {
      const urn = c.commentUrn;
      if (!urn) continue;
      const existing = await env.DB.prepare('SELECT comment_urn FROM linkedin_comments WHERE comment_urn=?').bind(urn).first();
      if (existing) continue;
      const actor = c.actor || '';
      const msg = c.message?.text || '';
      const ct = c.created?.time ?? null;
      await env.DB.prepare(
        `INSERT INTO linkedin_comments (comment_urn, post_urn, actor, message, created_time, replied, ingested_at)
         VALUES (?,?,?,?,?,0,?) ON CONFLICT(comment_urn) DO NOTHING`
      ).bind(urn, c.object || postUrn, actor, msg, ct, now()).run();
      ingested++;
      if (actor && actor !== org.urn) fresh.push({ urn, postUrn: c.object || postUrn, actor, message: msg });
    }
  }
  for (const f of fresh) {
    await emit(env, EVENT_TYPES.LINKEDIN_COMMENT_RECEIVED, { comment: f });
  }
  return { ok: true, ingested };
}

// GET /api/linkedin/comments
export async function listComments(env) {
  const { results } = await env.DB.prepare(
    'SELECT * FROM linkedin_comments ORDER BY created_time DESC LIMIT 100'
  ).all();
  return jres({ comments: results || [] });
}

// POST /api/linkedin/comments/refresh — manual ingest trigger.
export async function refreshComments(env) {
  const r = await ingestComments(env);
  if (!r.ok) return jres({ error: r.error, status: r.status }, r.status || 502);
  return jres({ ok: true, ingested: r.ingested });
}

// POST /api/linkedin/comments/reply — reply (or top-level comment) as the page.
// Body: { postUrn, message, commentUrn? }  (commentUrn => nested reply)
export async function replyToComment(req, env) {
  let b;
  try { b = await req.json(); } catch { return jres({ error: 'invalid_json' }, 400); }
  const postUrn = (b.postUrn || '').trim();
  const message = (b.message || '').trim();
  const parentComment = (b.commentUrn || '').trim();
  if (!postUrn || !message) return jres({ error: 'post_and_message_required' }, 400);
  const org = await resolveOrgUrn(env);
  if (org.error) return jres({ error: org.error }, 409);
  const body = { actor: org.urn, object: postUrn, message: { text: message } };
  if (parentComment) body.parentComment = parentComment;
  const r = await apiRequest(env, 'POST', `/socialActions/${encodeURIComponent(postUrn)}/comments`, { body });
  if (!r.ok) return jres({ error: 'reply_failed', status: r.status, detail: r.data }, r.status || 502);
  if (parentComment) {
    await env.DB.prepare('UPDATE linkedin_comments SET replied=1 WHERE comment_urn=?').bind(parentComment).run();
  }
  return jres({ ok: true, id: r.restliId });
}

// ── Scheduler ────────────────────────────────────────────────
// Called from the cron handler (every 5 min). Quiet no-op when LinkedIn isn't
// connected. Publishing runs every tick; analytics and comment ingest are
// throttled so we stay well within the CMAPI Development Tier rate limits
// (500 req/app/day).
export async function runLinkedInScheduler(env) {
  const conn = await env.DB.prepare('SELECT id FROM linkedin_oauth WHERE id=?').bind('cmapi').first();
  if (!conn) return;

  // 1) Publish any scheduled posts that are due.
  try {
    const { results: due } = await env.DB.prepare(
      "SELECT * FROM linkedin_posts WHERE status='scheduled' AND scheduled_at IS NOT NULL AND scheduled_at<=?"
    ).bind(now()).all();
    for (const row of (due || [])) await doPublish(env, row);
  } catch (e) { console.error('LI publish scheduler', e?.message || e); }

  // 2) Analytics snapshot — once per UTC day.
  try {
    const date = todayUTC();
    const have = await env.DB.prepare('SELECT snapshot_date FROM linkedin_stats WHERE snapshot_date=?').bind(date).first();
    if (!have) await refreshAnalytics(env);
  } catch (e) { console.error('LI analytics scheduler', e?.message || e); }

  // 3) Comment ingest — throttled (default every 60 min).
  try {
    const last = await env.KV.get('li_last_comment_ingest');
    const intervalMs = (parseInt(env.LINKEDIN_COMMENT_INGEST_MINUTES || '60', 10) || 60) * 60000;
    if (!last || (Date.now() - Number(last)) >= intervalMs) {
      await env.KV.put('li_last_comment_ingest', String(Date.now()));
      await ingestComments(env);
    }
  } catch (e) { console.error('LI comment scheduler', e?.message || e); }
}
