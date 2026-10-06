// ============================================================
// Cintelis Workspace — App-wide settings (Sprint 6)
// Currently houses the feature visibility matrix used by the route gate.
// Self-contained: no imports from worker.js to avoid circular deps.
// Cached at module scope with a short TTL so the gate doesn't hit D1 on
// every request.
// ============================================================

// ── Local helpers (mirror worker.js) ─────────────────────────
function jres(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
function now() { return new Date().toISOString(); }

const KNOWN_FEATURES = ['outreach', 'crm', 'tasks', 'docs'];
const KNOWN_ROLES = ['member', 'viewer'];

// ── Module-level cache ───────────────────────────────────────
let FEATURE_VISIBILITY_CACHE = null;
let FEATURE_VISIBILITY_CACHE_AT = 0;
const FEATURE_VISIBILITY_TTL_MS = 30 * 1000;

async function loadFeatureVisibilityFresh(env) {
  const row = await env.DB.prepare(
    "SELECT value FROM app_settings WHERE key='feature_visibility'"
  ).first();
  let parsed;
  try { parsed = JSON.parse(row?.value || '{}'); } catch { parsed = {}; }
  if (!parsed || typeof parsed !== 'object') parsed = {};
  // Fill defaults — every section visible for both roles.
  const defaults = {
    outreach: { member: true, viewer: true },
    crm:      { member: true, viewer: true },
    tasks:    { member: true, viewer: true },
    docs:     { member: true, viewer: true },
  };
  for (const k of Object.keys(defaults)) {
    parsed[k] = { ...defaults[k], ...(parsed[k] || {}) };
  }
  return parsed;
}

async function getFeatureVisibilityCached(env) {
  const t = Date.now();
  if (FEATURE_VISIBILITY_CACHE && (t - FEATURE_VISIBILITY_CACHE_AT) < FEATURE_VISIBILITY_TTL_MS) {
    return FEATURE_VISIBILITY_CACHE;
  }
  FEATURE_VISIBILITY_CACHE = await loadFeatureVisibilityFresh(env);
  FEATURE_VISIBILITY_CACHE_AT = t;
  return FEATURE_VISIBILITY_CACHE;
}

function invalidateCache() {
  FEATURE_VISIBILITY_CACHE = null;
  FEATURE_VISIBILITY_CACHE_AT = 0;
}

// ── getFeatureVisibility ─────────────────────────────────────
// Returns the parsed matrix object (NOT a Response). Caller wraps with jres().
export async function getFeatureVisibility(env) {
  return await getFeatureVisibilityCached(env);
}

// ── patchFeatureVisibility ───────────────────────────────────
// PATCH /api/app-settings/feature-visibility — admin only (gated in worker.js).
// Body: full or partial matrix. Deep-merged with the existing matrix.
export async function patchFeatureVisibility(req, env, ctx) {
  const body = await req.json().catch(() => ({}));
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return jres({ error: 'body must be an object' }, 400);
  }
  // Validate keys + sub-keys + value types.
  for (const featureKey of Object.keys(body)) {
    if (!KNOWN_FEATURES.includes(featureKey)) {
      return jres({ error: `unknown feature: ${featureKey}` }, 400);
    }
    const sub = body[featureKey];
    if (!sub || typeof sub !== 'object' || Array.isArray(sub)) {
      return jres({ error: `${featureKey} must be an object` }, 400);
    }
    for (const role of Object.keys(sub)) {
      if (!KNOWN_ROLES.includes(role)) {
        return jres({ error: `unknown role under ${featureKey}: ${role}` }, 400);
      }
      if (typeof sub[role] !== 'boolean') {
        return jres({ error: `${featureKey}.${role} must be a boolean` }, 400);
      }
    }
  }

  const existing = await loadFeatureVisibilityFresh(env);
  const merged = { ...existing };
  for (const featureKey of Object.keys(body)) {
    merged[featureKey] = { ...(existing[featureKey] || {}), ...body[featureKey] };
  }

  const ts = now();
  await env.DB.prepare(
    `INSERT INTO app_settings (key, value, updated_at, updated_by)
     VALUES ('feature_visibility', ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value=excluded.value,
       updated_at=excluded.updated_at,
       updated_by=excluded.updated_by`
  ).bind(JSON.stringify(merged), ts, ctx?.user?.id || null).run();

  invalidateCache();
  return jres(merged);
}

// ── isFeatureAllowed ─────────────────────────────────────────
// Runtime route-gate helper. Admin always allowed. Unknown features default
// to allowed (fail-open) so a typo in FEATURE_GATES doesn't lock anyone out.
export async function isFeatureAllowed(env, featureKey, role) {
  if (role === 'admin') return true;
  if (!featureKey) return true;
  const map = await getFeatureVisibilityCached(env);
  const entry = map[featureKey];
  if (!entry) return true;
  return entry[role] !== false;
}
