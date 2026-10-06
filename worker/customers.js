// ============================================================
// Cintelis — Customers (tenants), contracts, and the tenant guard
// ------------------------------------------------------------
// A "customer" is a client company Cintelis onboards. Users, projects,
// doc spaces, API tokens and integrations carry a nullable customer_id:
//   NULL  → Cintelis internal (staff) — sees everything
//   set   → customer user — sees only rows of that customer
//
// Enforcement has three layers, all in this module:
//   1. enforceCustomerScope()  — runs first in route() for customer users.
//      Deny-by-default allowlist of API paths + per-entity ownership check
//      (issue → project → customer, page → space → customer, ...).
//   2. Handlers that LIST rows take ctx and filter by customer (tasks.js
//      listProjects, docs.js listSpaces, users, tokens, integrations).
//   3. Handlers that CREATE top-level rows stamp customer_id via
//      customerIdForCreate().
//
// Self-contained helpers (jres/now/ids) to avoid circular imports with
// worker.js. Imports only from ./auth.js.
// ============================================================

import { hashPassword, generateUserId } from './auth.js';
import { createNotification } from './notifications.js';
import { emit, EVENT_TYPES } from './events.js';

function jres(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
function now() { return new Date().toISOString(); }
function hex24() { return crypto.randomUUID().replace(/-/g, '').slice(0, 24); }
function customerId() { return 'cus_' + hex24(); }
function contractId() { return 'ctr_' + hex24(); }

// 019: 'crm' (contacts, lists, pipeline) and 'outreach' (templates, campaigns,
// logs, unsubscribes) are per-customer entitlements like the rest.
export const FEATURE_KEYS = ['tasks', 'docs', 'roadmap', 'billing', 'integrations', 'api_tokens', 'crm', 'outreach'];
const CUSTOMER_STATUSES = new Set(['active', 'suspended', 'archived']);
const CONTRACT_STATUSES = new Set(['draft', 'active', 'expired', 'terminated']);
const RATE_UNITS = new Set(['hour', 'day', 'month', 'fixed']);

export function slugify(s) {
  return String(s || '').toLowerCase().trim()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'customer';
}

export function parseFeatures(raw) {
  let obj = {};
  if (raw && typeof raw === 'object') obj = raw;
  else if (typeof raw === 'string') { try { obj = JSON.parse(raw) || {}; } catch { obj = {}; } }
  const out = {};
  for (const k of FEATURE_KEYS) out[k] = obj[k] !== false;
  return out;
}

function publicCustomer(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    abn: row.abn || '',
    address: row.address || '',
    contact_name: row.contact_name || '',
    contact_email: row.contact_email || '',
    status: row.status || 'active',
    features: parseFeatures(row.features),
    notes: row.notes || '',
    xero_contact_id: row.xero_contact_id || null,     // 023
    xero_contact_name: row.xero_contact_name || '',
    created_at: row.created_at,
    updated_at: row.updated_at || null,
  };
}

function publicContract(row) {
  if (!row) return null;
  return {
    id: row.id,
    customer_id: row.customer_id,
    title: row.title,
    status: row.status,
    commencement_date: row.commencement_date || null,
    initial_term: row.initial_term || '',
    hours_per_week: row.hours_per_week || '',
    rate_amount: row.rate_amount === null || row.rate_amount === undefined ? null : Number(row.rate_amount),
    rate_unit: row.rate_unit || 'hour',
    currency: row.currency || 'AUD',
    invoicing: row.invoicing || '',
    payment_terms: row.payment_terms || '',
    key_person: row.key_person || '',
    notes: row.notes || '',
    created_at: row.created_at,
    updated_at: row.updated_at || null,
  };
}

// ── Role helpers ─────────────────────────────────────────────
export function isCustomerUser(ctx) { return !!(ctx && ctx.user && ctx.user.customer_id); }
export function isInternal(ctx) { return !!(ctx && ctx.user) && !ctx.user.customer_id; }
export function isInternalAdmin(ctx) { return isInternal(ctx) && ctx.user.role === 'admin'; }

export async function getCustomer(env, id) {
  if (!id) return null;
  const row = await env.DB.prepare('SELECT * FROM customers WHERE id=?').bind(id).first();
  return row ? publicCustomer(row) : null;
}

// Which customer_id a newly created top-level row (project, space, token,
// integration, user) should carry. Customer users are always pinned to
// their own customer; internal users may target a customer via body.
// Returns { customer_id } or { error: Response }.
export async function customerIdForCreate(env, ctx, requested) {
  if (isCustomerUser(ctx)) return { customer_id: ctx.user.customer_id };
  const want = String(requested || '').trim();
  if (!want) return { customer_id: null };
  const row = await env.DB.prepare('SELECT id, status FROM customers WHERE id=?').bind(want).first();
  if (!row) return { error: jres({ error: 'Unknown customer_id' }, 400) };
  return { customer_id: row.id };
}

// ── Entity → customer resolver ───────────────────────────────
// Returns { found: false } when the entity doesn't exist, otherwise
// { found: true, customer_id } (null = internal). Since 019 CRM rows
// (contact, contact_list, template, campaign) carry their own customer_id.
const INTERNAL_ONLY = '__internal_only__';

export async function entityCustomerId(env, kind, id, depth = 0) {
  if (!id || depth > 3) return { found: false };
  const one = async (sql, ...binds) => env.DB.prepare(sql).bind(...binds).first();
  let row;
  switch (kind) {
    case 'project':
      row = await one('SELECT customer_id FROM projects WHERE id=?', id); break;
    case 'issue':
      row = await one(
        `SELECT p.customer_id FROM issues i JOIN projects p ON p.id = i.project_id
         WHERE i.id=? OR i.issue_key=? LIMIT 1`, id, id); break;
    case 'sprint':
      row = await one(
        'SELECT p.customer_id FROM sprints s JOIN projects p ON p.id = s.project_id WHERE s.id=?', id); break;
    case 'custom_field':
      row = await one(
        'SELECT p.customer_id FROM custom_field_defs f JOIN projects p ON p.id = f.project_id WHERE f.id=?', id); break;
    case 'dependency':
      row = await one(
        `SELECT p.customer_id FROM issue_dependencies d
         JOIN issues i ON i.id = d.blocker_issue_id
         JOIN projects p ON p.id = i.project_id WHERE d.id=?`, id); break;
    case 'doc_space':
      row = await one('SELECT customer_id FROM doc_spaces WHERE id=? OR key=? LIMIT 1', id, id); break;
    case 'doc_page':
      row = await one(
        'SELECT s.customer_id FROM doc_pages pg JOIN doc_spaces s ON s.id = pg.space_id WHERE pg.id=?', id); break;
    case 'customer_contract':
      row = await one('SELECT customer_id FROM customer_contracts WHERE id=?', id); break;
    case 'customer': {
      // Documents attached straight to the customer (e.g. the signed agreement
      // before a contract record exists). The entity IS the customer.
      const c = await one('SELECT id FROM customers WHERE id=?', id);
      return c ? { found: true, customer_id: c.id } : { found: false };
    }
    case 'user':
      row = await one('SELECT customer_id FROM users WHERE id=?', id); break;
    case 'integration':
      row = await one('SELECT customer_id FROM integrations WHERE id=?', id); break;
    case 'integration_rule':
      row = await one(
        'SELECT i.customer_id FROM notification_rules r JOIN integrations i ON i.id = r.integration_id WHERE r.id=?', id); break;
    case 'api_token':
      row = await one('SELECT customer_id FROM api_tokens WHERE id=?', id); break;
    case 'contact':
      row = await one('SELECT customer_id FROM contacts WHERE id=?', id); break;
    case 'crm_task':
      row = await one('SELECT customer_id FROM crm_tasks WHERE id=?', id); break;
    case 'company':
      row = await one('SELECT customer_id FROM companies WHERE id=?', id); break;
    case 'deal':
      row = await one('SELECT customer_id FROM deals WHERE id=?', id); break;
    case 'contact_list':
      row = await one('SELECT customer_id FROM contact_lists WHERE id=?', id); break;
    case 'template':
      row = await one('SELECT customer_id FROM templates WHERE id=?', id); break;
    case 'campaign':
      row = await one('SELECT customer_id FROM campaigns WHERE id=?', id); break;
    case 'activity': {
      const a = await one('SELECT entity_type, entity_id FROM activity WHERE id=?', id);
      if (!a) return { found: false };
      return entityCustomerId(env, a.entity_type, a.entity_id, depth + 1);
    }
    case 'attachment': {
      const a = await one('SELECT entity_type, entity_id FROM attachments WHERE id=?', id);
      if (!a) return { found: false };
      return entityCustomerId(env, a.entity_type, a.entity_id, depth + 1);
    }
    case 'entity_link': {
      const l = await one('SELECT from_type, from_id, to_type, to_id FROM entity_links WHERE id=?', id);
      if (!l) return { found: false };
      const a = await entityCustomerId(env, l.from_type, l.from_id, depth + 1);
      const b = await entityCustomerId(env, l.to_type, l.to_id, depth + 1);
      if (!a.found || !b.found) return { found: false };
      if (a.customer_id !== b.customer_id) return { found: true, customer_id: INTERNAL_ONLY };
      return a;
    }
    default:
      return { found: true, customer_id: INTERNAL_ONLY };
  }
  if (!row) return { found: false };
  return { found: true, customer_id: row.customer_id || null };
}

// True when the given entity belongs to ctx's customer (internal users
// always pass). Used by handlers that read entity refs from a body.
export async function canAccessEntity(env, ctx, kind, id) {
  if (!isCustomerUser(ctx)) return true;
  const r = await entityCustomerId(env, kind, id);
  if (!(r.found && r.customer_id === ctx.user.customer_id)) return false;
  if (kind === 'customer_contract' || kind === 'customer') {
    // Contract documents follow the customer's Contract & Billing feature flag.
    const c = await env.DB.prepare('SELECT features FROM customers WHERE id=?').bind(ctx.user.customer_id).first();
    if (c && parseFeatures(c.features).billing === false) return false;
  }
  return true;
}

// Called after a CUSTOMER user uploads a contract document — either to a
// contract record (entity_type 'customer_contract') or straight to the customer
// (entity_type 'customer', used before a contract exists). Notifies every active
// Cintelis admin in-app and by email, and emits the event. Never throws.
export async function onContractDocumentUploaded(env, ctx, entityType, entityIdValue, att, sendEmailFn) {
  if (!isCustomerUser(ctx)) return;
  try {
    const row = entityType === 'customer'
      ? await env.DB.prepare(
          `SELECT c.id AS id, 'Contract documents' AS title, c.id AS customer_id, c.name AS customer_name
           FROM customers c WHERE c.id = ?`
        ).bind(ctx.user.customer_id).first()
      : await env.DB.prepare(
          `SELECT k.id, k.title, k.customer_id, c.name AS customer_name
           FROM customer_contracts k JOIN customers c ON c.id = k.customer_id
           WHERE k.id = ? AND k.customer_id = ?`
        ).bind(entityIdValue, ctx.user.customer_id).first();
    if (!row) return;
    const uploader = ctx.user.display_name || ctx.user.email;
    const filename = (att && att.filename) || 'a document';
    const { results: admins } = await env.DB.prepare(
      `SELECT id, email FROM users WHERE active = 1 AND role = 'admin' AND customer_id IS NULL`
    ).all();
    for (const a of admins || []) {
      await createNotification(env, {
        user_id: a.id,
        kind: 'contract_upload',
        entity_type: entityType === 'customer' ? 'customer' : 'customer_contract',
        entity_id: row.id,
        title: `${row.customer_name} uploaded ${filename}`,
        body: `${uploader} uploaded a document to "${row.title}".`,
        link: `/?nav=customers&customer=${row.customer_id}`,
        actor_id: ctx.user.id,
      });
      if (typeof sendEmailFn === 'function') {
        try {
          await sendEmailFn(env, {
            to: a.email, customerName: row.customer_name, customerId: row.customer_id,
            contractTitle: row.title, filename, uploader,
          });
        } catch (e) { console.error('contract upload email failed', e?.message || e); }
      }
    }
    await emit(env, EVENT_TYPES.CUSTOMER_CONTRACT_UPLOADED, {
      customer_id: row.customer_id, customer_name: row.customer_name,
      contract_id: row.id, contract_title: row.title,
      attachment_id: att && att.id, filename, actor: ctx.user,
    });
  } catch (e) {
    console.error('onContractDocumentUploaded failed', e?.message || e);
  }
}

// ── The guard ────────────────────────────────────────────────
// Path allowlist for customer users. Each rule: [regex, feature|null, kind|null].
//   feature → checked against the customer's feature flags
//   kind    → capture group 1 is an entity id resolved via entityCustomerId
// Paths matching nothing are denied (Outreach, CRM, LinkedIn, overview,
// feature-visibility admin, customers admin, ...).
const RULES = [
  [/^\/api\/me(\/|$)/, null, null],
  [/^\/api\/auth\//, null, null],
  [/^\/api\/customer(\/|$)/, null, null],
  [/^\/api\/app-settings\/feature-visibility$/, null, null],
  [/^\/api\/users\/mention-search$/, null, null],
  [/^\/api\/users$/, null, null],
  [/^\/api\/users\/([^/]+)/, null, 'user'],
  [/^\/api\/attachments$/, null, null],                       // list/upload: checked via query/body below
  [/^\/api\/attachments\/([^/]+)/, null, 'attachment'],
  [/^\/api\/entity-links$/, null, null],                      // list/create: checked via query/body below
  [/^\/api\/entity-links\/([^/]+)$/, null, 'entity_link'],
  [/^\/api\/entity-search$/, null, null],
  [/^\/api\/search$/, null, null],
  [/^\/api\/projects$/, 'tasks', null],
  [/^\/api\/projects\/([^/]+)/, 'tasks', 'project'],
  [/^\/api\/custom-fields\/([^/]+)$/, 'tasks', 'custom_field'],
  [/^\/api\/sprints\/([^/]+)/, 'tasks', 'sprint'],
  [/^\/api\/issues\/([^/]+)/, 'tasks', 'issue'],
  [/^\/api\/dependencies\/([^/]+)$/, 'tasks', 'dependency'],
  [/^\/api\/activity\/([^/]+)$/, 'tasks', 'activity'],
  [/^\/api\/doc-spaces$/, 'docs', null],
  [/^\/api\/doc-spaces\/([^/]+)/, 'docs', 'doc_space'],
  [/^\/api\/doc-pages\/by-slug\/([^/]+)\//, 'docs', 'doc_space'],
  [/^\/api\/doc-pages\/([^/]+)/, 'docs', 'doc_page'],
  [/^\/api\/admin\/api-tokens$/, 'api_tokens', null],
  [/^\/api\/admin\/api-tokens\/([^/]+)$/, 'api_tokens', 'api_token'],
  // 019: CRM and Outreach per customer. Collection routes are filtered by the
  // scope helper inside the handlers; item routes resolve the row's owner here.
  // `import` and `seed` are sub-paths, not ids, so they are matched first.
  [/^\/api\/contacts\/import$/, 'crm', null],
  [/^\/api\/contacts$/, 'crm', null],
  [/^\/api\/contacts\/([^/]+)/, 'crm', 'contact'],
  [/^\/api\/lists$/, 'crm', null],
  [/^\/api\/lists\/([^/]+)/, 'crm', 'contact_list'],
  [/^\/api\/crm\/(pipeline|stats|followups|workspace|tasks|companies|deals)$/, 'crm', null],
  [/^\/api\/crm\/deals\/stats$/, 'crm', null],
  [/^\/api\/crm\/tasks\/([^/]+)/, 'crm', 'crm_task'],
  [/^\/api\/crm\/companies\/([^/]+)/, 'crm', 'company'],
  [/^\/api\/crm\/deals\/([^/]+)/, 'crm', 'deal'],
  [/^\/api\/crm\/contact\/([^/]+)/, 'crm', 'contact'],
  [/^\/api\/templates$/, 'outreach', null],
  [/^\/api\/templates\/([^/]+)/, 'outreach', 'template'],
  [/^\/api\/campaigns$/, 'outreach', null],
  [/^\/api\/campaigns\/([^/]+)/, 'outreach', 'campaign'],
  [/^\/api\/logs$/, 'outreach', null],
  [/^\/api\/unsubscribes$/, 'outreach', null],
];

const FORBIDDEN = () => jres({ error: 'Forbidden: outside your organisation' }, 403);
const NOT_FOUND = () => jres({ error: 'Not found' }, 404);

// Returns null when the request may proceed, else a Response.
export async function enforceCustomerScope(env, ctx, path, method, url, req) {
  if (!isCustomerUser(ctx)) return null;
  const cid = ctx.user.customer_id;

  // Customer status: suspended/archived tenants can only log out / read self.
  const cust = await env.DB.prepare('SELECT status, features FROM customers WHERE id=?').bind(cid).first();
  if (!cust) return jres({ error: 'Your organisation no longer exists' }, 403);
  if (cust.status !== 'active' && !/^\/api\/(me$|auth\/logout$)/.test(path)) {
    return jres({ error: 'Your organisation account is ' + cust.status + '. Contact Cintelis.' }, 403);
  }
  const features = parseFeatures(cust.features);

  let rule = null, m = null;
  for (const r of RULES) { m = path.match(r[0]); if (m) { rule = r; break; } }
  if (!rule) return FORBIDDEN();
  const [, feature, kind] = rule;
  if (feature && features[feature] === false) {
    return jres({ error: `The ${feature} feature is not enabled for your organisation` }, 403);
  }
  if (kind) {
    const r = await entityCustomerId(env, kind, m[1]);
    // Another tenant's row answers 404, not 403: confirming that an id exists
    // but belongs to someone else is itself a disclosure.
    if (!r.found || r.customer_id !== cid) return NOT_FOUND();
  }

  // Entity references carried in query string / JSON body.
  if (path === '/api/attachments' || path === '/api/entity-links') {
    if (method === 'GET') {
      const et = url.searchParams.get('entity_type'), ei = url.searchParams.get('entity_id');
      if (et && ei) {
        const r = await entityCustomerId(env, et, ei);
        if (!r.found || r.customer_id !== cid) return NOT_FOUND();
      }
    } else if (method === 'POST' && path === '/api/entity-links' && req) {
      const body = await req.clone().json().catch(() => ({}));
      for (const [t, i] of [[body.from_type, body.from_id], [body.to_type, body.to_id]]) {
        if (!t || !i) continue;
        const r = await entityCustomerId(env, t, i);
        if (!r.found || r.customer_id !== cid) return NOT_FOUND();
      }
    }
    // POST /api/attachments is multipart → checked inside uploadAttachment via canAccessEntity.
  }
  return null;
}

// ── Internal-admin handlers: /api/customers ──────────────────
export async function listCustomers(env, ctx) {
  if (!isInternalAdmin(ctx)) return jres({ error: 'Forbidden: Cintelis admin only' }, 403);
  const { results } = await env.DB.prepare(
    `SELECT c.*,
            (SELECT COUNT(*) FROM users u WHERE u.customer_id = c.id AND u.active = 1)          AS user_count,
            (SELECT COUNT(*) FROM projects p WHERE p.customer_id = c.id AND p.active = 1)       AS project_count,
            (SELECT COUNT(*) FROM doc_spaces s WHERE s.customer_id = c.id AND s.active = 1)     AS space_count,
            (SELECT COUNT(*) FROM customer_contracts k WHERE k.customer_id = c.id)              AS contract_count
     FROM customers c
     ORDER BY CASE c.status WHEN 'active' THEN 0 WHEN 'suspended' THEN 1 ELSE 2 END, c.name ASC`
  ).all();
  const customers = (results || []).map(r => ({
    ...publicCustomer(r),
    user_count: Number(r.user_count || 0),
    project_count: Number(r.project_count || 0),
    space_count: Number(r.space_count || 0),
    contract_count: Number(r.contract_count || 0),
  }));
  return jres({ customers });
}

function generateTempPassword() {
  // 14 chars from an unambiguous alphabet; meets the >= 8 rule.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(14));
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

// Creates a customer user (role admin|member|viewer) pinned to customerIdValue.
// Shared by onboarding and by POST /api/users when a customer_id is given.
export async function createCustomerUser(env, { email, display_name, role, password, customer_id }) {
  const em = String(email || '').trim().toLowerCase();
  if (!em || !em.includes('@')) return { error: jres({ error: 'A valid email is required' }, 400) };
  const exists = await env.DB.prepare('SELECT id FROM users WHERE email=?').bind(em).first();
  if (exists) return { error: jres({ error: 'A user with that email already exists' }, 409) };
  const pw = String(password || '') || generateTempPassword();
  if (pw.length < 8) return { error: jres({ error: 'password must be at least 8 characters' }, 400) };
  const r = ['admin', 'member', 'viewer'].includes(role) ? role : 'member';
  const id = generateUserId();
  const ts = now();
  await env.DB.prepare(
    `INSERT INTO users (id, email, display_name, role, active, preferences, customer_id, created_at)
     VALUES (?, ?, ?, ?, 1, '{}', ?, ?)`
  ).bind(id, em, String(display_name || '').trim(), r, customer_id, ts).run();
  const { hash, salt, iterations, algorithm } = await hashPassword(pw);
  await env.DB.prepare(
    `INSERT INTO user_credentials (user_id, password_hash, salt, algorithm, iterations, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, hash, salt, algorithm, iterations, ts, ts).run();
  return { user: { id, email: em, display_name: String(display_name || '').trim(), role: r, customer_id }, password: pw };
}

// POST /api/customers — onboarding. `sendWelcome(env, {to, name, customerName, password})`
// is injected by worker.js so this module stays free of the email helpers.
export async function createCustomer(req, env, ctx, sendWelcome) {
  if (!isInternalAdmin(ctx)) return jres({ error: 'Forbidden: Cintelis admin only' }, 403);
  const body = await req.json().catch(() => ({}));
  const name = String(body.name || '').trim();
  if (!name) return jres({ error: 'name required' }, 400);
  let slug = slugify(body.slug || name);
  const slugTaken = await env.DB.prepare('SELECT id FROM customers WHERE slug=?').bind(slug).first();
  if (slugTaken) slug = slug + '-' + hex24().slice(0, 4);
  const status = CUSTOMER_STATUSES.has(body.status) ? body.status : 'active';
  const features = parseFeatures(body.features);
  const id = customerId();
  const ts = now();
  await env.DB.prepare(
    `INSERT INTO customers (id, name, slug, abn, address, contact_name, contact_email, status, features, notes, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, name, slug,
    String(body.abn || '').trim(), String(body.address || '').trim(),
    String(body.contact_name || '').trim(), String(body.contact_email || '').trim().toLowerCase(),
    status, JSON.stringify(features), String(body.notes || ''),
    ctx.user.id, ts, ts
  ).run();

  let admin_user = null;
  if (body.admin_user && body.admin_user.email) {
    const made = await createCustomerUser(env, {
      email: body.admin_user.email,
      display_name: body.admin_user.display_name,
      role: 'admin',
      password: body.admin_user.password,
      customer_id: id,
    });
    if (made.error) {
      // Customer row stays; caller can add the user afterwards.
      const cust = await getCustomer(env, id);
      const err = await made.error.json();
      return jres({ customer: cust, admin_user: null, error: 'Customer created, but the admin user failed: ' + err.error }, 207);
    }
    let welcome_email_sent = false;
    if (typeof sendWelcome === 'function') {
      try {
        await sendWelcome(env, { to: made.user.email, name: made.user.display_name, customerName: name, password: made.password });
        welcome_email_sent = true;
      } catch { welcome_email_sent = false; }
    }
    admin_user = { ...made.user, welcome_email_sent };
  }
  const cust = await getCustomer(env, id);
  return jres({ customer: cust, admin_user }, 201);
}

export async function getCustomerDetail(env, ctx, id) {
  if (!isInternalAdmin(ctx)) return jres({ error: 'Forbidden: Cintelis admin only' }, 403);
  const cust = await getCustomer(env, id);
  if (!cust) return NOT_FOUND();
  const [users, contracts, projects, spaces, documents] = await Promise.all([
    env.DB.prepare(
      `SELECT id, email, display_name, role, active, created_at, last_login_at
       FROM users WHERE customer_id=? ORDER BY created_at ASC`).bind(id).all(),
    env.DB.prepare('SELECT * FROM customer_contracts WHERE customer_id=? ORDER BY created_at DESC').bind(id).all(),
    env.DB.prepare('SELECT id, key, name FROM projects WHERE customer_id=? AND active=1 ORDER BY key ASC').bind(id).all(),
    env.DB.prepare('SELECT id, key, name FROM doc_spaces WHERE customer_id=? AND active=1 ORDER BY key ASC').bind(id).all(),
    env.DB.prepare(
      `SELECT a.id, a.filename, a.size_bytes, a.mime_type, a.created_at,
              u.display_name AS uploaded_by_name, u.customer_id AS uploaded_by_customer_id
       FROM attachments a LEFT JOIN users u ON u.id = a.uploaded_by
       WHERE a.entity_type = 'customer' AND a.entity_id = ?
       ORDER BY a.created_at DESC`
    ).bind(id).all(),
  ]);
  return jres({
    customer: cust,
    users: users.results || [],
    contracts: (contracts.results || []).map(publicContract),
    projects: projects.results || [],
    spaces: spaces.results || [],
    documents: documents.results || [],
  });
}

export async function patchCustomer(req, env, ctx, id) {
  if (!isInternalAdmin(ctx)) return jres({ error: 'Forbidden: Cintelis admin only' }, 403);
  const existing = await env.DB.prepare('SELECT * FROM customers WHERE id=?').bind(id).first();
  if (!existing) return NOT_FOUND();
  const body = await req.json().catch(() => ({}));
  const sets = [], binds = [];
  const str = (k) => { if (body[k] !== undefined) { sets.push(`${k}=?`); binds.push(String(body[k] || '').trim()); } };
  if (body.name !== undefined) {
    const nm = String(body.name || '').trim();
    if (!nm) return jres({ error: 'name cannot be empty' }, 400);
    sets.push('name=?'); binds.push(nm);
  }
  if (body.slug !== undefined) {
    const sl = slugify(body.slug);
    const taken = await env.DB.prepare('SELECT id FROM customers WHERE slug=? AND id<>?').bind(sl, id).first();
    if (taken) return jres({ error: 'slug already in use' }, 409);
    sets.push('slug=?'); binds.push(sl);
  }
  for (const k of ['abn', 'address', 'contact_name', 'notes']) str(k);
  if (body.contact_email !== undefined) { sets.push('contact_email=?'); binds.push(String(body.contact_email || '').trim().toLowerCase()); }
  if (body.status !== undefined) {
    if (!CUSTOMER_STATUSES.has(body.status)) return jres({ error: 'status must be active, suspended or archived' }, 400);
    sets.push('status=?'); binds.push(body.status);
  }
  if (body.features !== undefined) { sets.push('features=?'); binds.push(JSON.stringify(parseFeatures(body.features))); }
  if (!sets.length) return jres({ customer: publicCustomer(existing) });
  sets.push('updated_at=?'); binds.push(now());
  binds.push(id);
  await env.DB.prepare(`UPDATE customers SET ${sets.join(', ')} WHERE id=?`).bind(...binds).run();
  return jres({ customer: await getCustomer(env, id) });
}

// ── Contracts ────────────────────────────────────────────────
function contractFieldsFromBody(body, { requireTitle }) {
  const out = {};
  if (body.title !== undefined || requireTitle) {
    const t = String(body.title || '').trim();
    if (!t) return { error: jres({ error: 'title required' }, 400) };
    out.title = t;
  }
  if (body.status !== undefined) {
    if (!CONTRACT_STATUSES.has(body.status)) return { error: jres({ error: 'status must be draft, active, expired or terminated' }, 400) };
    out.status = body.status;
  }
  if (body.commencement_date !== undefined) {
    const d = String(body.commencement_date || '').trim();
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) return { error: jres({ error: 'commencement_date must be YYYY-MM-DD' }, 400) };
    out.commencement_date = d || null;
  }
  if (body.rate_amount !== undefined) {
    if (body.rate_amount === null || body.rate_amount === '') out.rate_amount = null;
    else {
      const n = Number(body.rate_amount);
      if (!Number.isFinite(n) || n < 0) return { error: jres({ error: 'rate_amount must be a non-negative number' }, 400) };
      out.rate_amount = n;
    }
  }
  if (body.rate_unit !== undefined) {
    if (!RATE_UNITS.has(body.rate_unit)) return { error: jres({ error: 'rate_unit must be hour, day, month or fixed' }, 400) };
    out.rate_unit = body.rate_unit;
  }
  if (body.currency !== undefined) out.currency = (String(body.currency || 'AUD').trim().toUpperCase().slice(0, 3)) || 'AUD';
  for (const k of ['initial_term', 'hours_per_week', 'invoicing', 'payment_terms', 'key_person', 'notes']) {
    if (body[k] !== undefined) out[k] = String(body[k] || '').trim();
  }
  return { fields: out };
}

export async function createContract(req, env, ctx, customerIdValue) {
  if (!isInternalAdmin(ctx)) return jres({ error: 'Forbidden: Cintelis admin only' }, 403);
  const cust = await env.DB.prepare('SELECT id FROM customers WHERE id=?').bind(customerIdValue).first();
  if (!cust) return NOT_FOUND();
  const body = await req.json().catch(() => ({}));
  const parsed = contractFieldsFromBody(body, { requireTitle: true });
  if (parsed.error) return parsed.error;
  const f = { status: 'active', commencement_date: null, initial_term: '', hours_per_week: '', rate_amount: null,
              rate_unit: 'hour', currency: 'AUD', invoicing: '', payment_terms: '', key_person: '', notes: '', ...parsed.fields };
  const id = contractId();
  const ts = now();
  await env.DB.prepare(
    `INSERT INTO customer_contracts (id, customer_id, title, status, commencement_date, initial_term, hours_per_week,
       rate_amount, rate_unit, currency, invoicing, payment_terms, key_person, notes, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, customerIdValue, f.title, f.status, f.commencement_date, f.initial_term, f.hours_per_week,
         f.rate_amount, f.rate_unit, f.currency, f.invoicing, f.payment_terms, f.key_person, f.notes,
         ctx.user.id, ts, ts).run();
  const row = await env.DB.prepare('SELECT * FROM customer_contracts WHERE id=?').bind(id).first();
  return jres({ contract: publicContract(row) }, 201);
}

export async function patchContract(req, env, ctx, customerIdValue, cid) {
  if (!isInternalAdmin(ctx)) return jres({ error: 'Forbidden: Cintelis admin only' }, 403);
  const existing = await env.DB.prepare('SELECT * FROM customer_contracts WHERE id=? AND customer_id=?').bind(cid, customerIdValue).first();
  if (!existing) return NOT_FOUND();
  const body = await req.json().catch(() => ({}));
  const parsed = contractFieldsFromBody(body, { requireTitle: false });
  if (parsed.error) return parsed.error;
  const keys = Object.keys(parsed.fields);
  if (!keys.length) return jres({ contract: publicContract(existing) });
  const sets = keys.map(k => `${k}=?`);
  const binds = keys.map(k => parsed.fields[k]);
  sets.push('updated_at=?'); binds.push(now());
  binds.push(cid);
  await env.DB.prepare(`UPDATE customer_contracts SET ${sets.join(', ')} WHERE id=?`).bind(...binds).run();
  const row = await env.DB.prepare('SELECT * FROM customer_contracts WHERE id=?').bind(cid).first();
  return jres({ contract: publicContract(row) });
}

// `deleteAttachmentsForEntity` is injected by worker.js (attachments.js owns R2).
export async function deleteContract(env, ctx, customerIdValue, cid, deleteAttachmentsForEntity) {
  if (!isInternalAdmin(ctx)) return jres({ error: 'Forbidden: Cintelis admin only' }, 403);
  const existing = await env.DB.prepare('SELECT id FROM customer_contracts WHERE id=? AND customer_id=?').bind(cid, customerIdValue).first();
  if (!existing) return NOT_FOUND();
  if (typeof deleteAttachmentsForEntity === 'function') {
    try { await deleteAttachmentsForEntity(env, 'customer_contract', cid); } catch { /* best effort */ }
  }
  await env.DB.prepare('DELETE FROM customer_contracts WHERE id=?').bind(cid).run();
  return jres({ ok: true });
}

// ── Customer self-service: GET /api/customer ─────────────────
export async function getMyCustomer(env, ctx) {
  if (!isCustomerUser(ctx)) return jres({ error: 'Not a customer account' }, 400);
  const cust = await getCustomer(env, ctx.user.customer_id);
  if (!cust) return NOT_FOUND();
  let contracts = [];
  if (cust.features.billing !== false) {
    const { results } = await env.DB.prepare(
      'SELECT * FROM customer_contracts WHERE customer_id=? ORDER BY created_at DESC'
    ).bind(cust.id).all();
    contracts = (results || []).map(publicContract);
    if (contracts.length) {
      const ids = contracts.map(c => c.id);
      const placeholders = ids.map(() => '?').join(',');
      const { results: atts } = await env.DB.prepare(
        `SELECT a.id, a.entity_id, a.filename, a.size_bytes, a.mime_type, a.created_at,
                u.display_name AS uploaded_by_name, u.email AS uploaded_by_email, u.customer_id AS uploaded_by_customer_id
         FROM attachments a LEFT JOIN users u ON u.id = a.uploaded_by
         WHERE a.entity_type='customer_contract' AND a.entity_id IN (${placeholders})
         ORDER BY a.created_at DESC`
      ).bind(...ids).all();
      const byContract = {};
      for (const a of atts || []) (byContract[a.entity_id] ||= []).push({
        id: a.id, filename: a.filename, size_bytes: a.size_bytes, mime_type: a.mime_type, created_at: a.created_at,
        uploaded_by_name: a.uploaded_by_name || a.uploaded_by_email || '',
        from_customer: !!a.uploaded_by_customer_id && a.uploaded_by_customer_id === cust.id,
      });
      for (const c of contracts) c.attachments = byContract[c.id] || [];
    }
  }
  let documents = [];
  if (cust.features.billing !== false) {
    const { results } = await env.DB.prepare(
      `SELECT a.id, a.filename, a.size_bytes, a.mime_type, a.created_at,
              u.display_name AS uploaded_by_name, u.email AS uploaded_by_email, u.customer_id AS uploaded_by_customer_id
       FROM attachments a LEFT JOIN users u ON u.id = a.uploaded_by
       WHERE a.entity_type = 'customer' AND a.entity_id = ?
       ORDER BY a.created_at DESC`
    ).bind(cust.id).all();
    documents = (results || []).map(a => ({
      id: a.id, filename: a.filename, size_bytes: a.size_bytes, mime_type: a.mime_type, created_at: a.created_at,
      uploaded_by_name: a.uploaded_by_name || a.uploaded_by_email || '',
      from_customer: !!a.uploaded_by_customer_id && a.uploaded_by_customer_id === cust.id,
    }));
  }
  const { notes, ...publicSafe } = cust; // internal notes are never shown to the customer
  return jres({ customer: publicSafe, contracts, documents });
}
