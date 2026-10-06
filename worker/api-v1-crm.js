// Public v1 CRM API — lets external lead sources (a website quote form,
// a visualiser app) upsert a CRM contact without a session.
// Authenticated by API token (Authorization: Bearer pat_...) with scope
// crm:write. Since 019 the token's tenant decides where the contact lands:
// a customer-minted token writes into that customer's CRM, an internal token
// into Cintelis's own. The tenant comes from the token, never from the body.
//
// Upsert by email within the tenant. An existing contact keeps its stage (a
// qualified contact must not be knocked back to 'lead' by a second enquiry);
// blank fields are filled in, tags are merged, and the enquiry is recorded
// as a note.

import { scopedFirst, scopedRun, scopedInsert, resolveScope, INTERNAL_SCOPE } from './scope.js';
import { parseFeatures } from './customers.js';
import { createDealForImportedContact } from './crm.js';
import { linkCompanyByName } from './crm-companies.js';

function jres(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function isoNow() { return new Date().toISOString(); }
function uid() { return crypto.randomUUID(); }

const STAGES = ['lead', 'prospect', 'qualified', 'proposal', 'won', 'lost'];
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function cleanTags(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  for (const t of input) {
    const s = String(t || '').trim().toLowerCase().slice(0, 40);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= 20) break;
  }
  return out;
}

function parseTags(raw) {
  try {
    const v = JSON.parse(raw || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

async function addNote(env, scope, contactId, userId, bodyMd) {
  await env.DB.prepare(
    `INSERT INTO activity (id, entity_type, entity_id, user_id, kind, body_md, created_at)
     VALUES (?, 'contact', ?, ?, 'note', ?, ?)`
  ).bind(uid(), contactId, userId || null, bodyMd, isoNow()).run();
  await scopedRun(env, null, { sql: 'UPDATE contacts SET notes_count=notes_count+1 WHERE id=? AND /*SCOPE*/', binds: [contactId], alias: 'contacts', scope });
}

// POST /api/v1/contacts
//   Body: { email, name?, phone?, company?, stage?, deal_value?, tags?, note? }
//   201 { id, email, action: 'created' }  |  200 { id, email, action: 'updated' }
export async function apiV1UpsertContact(req, env, ctx) {
  const tokenScope = ctx && ctx._apiToken ? ctx._apiToken.scope : '';
  if (tokenScope !== 'crm:write') return jres({ error: 'Token scope crm:write required' }, 403);

  // Tenant: a customer token → that customer, who must be active and entitled
  // to CRM. An internal token → INTERNAL_SCOPE explicitly, so the find-by-email
  // below can never match another tenant's contact.
  const customerId = ctx.user && ctx.user.customer_id ? ctx.user.customer_id : null;
  let scope = INTERNAL_SCOPE;
  if (customerId) {
    const cust = await env.DB.prepare('SELECT status, features FROM customers WHERE id=?').bind(customerId).first();
    if (!cust) return jres({ error: 'Your organisation no longer exists' }, 403);
    if (cust.status !== 'active') return jres({ error: `Your organisation account is ${cust.status}` }, 403);
    if (parseFeatures(cust.features).crm === false) return jres({ error: 'The crm feature is not enabled for your organisation' }, 403);
    scope = resolveScope(ctx);
  }

  const body = await req.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return jres({ error: 'valid email required' }, 400);

  const name = String(body.name || '').trim().slice(0, 120);
  const phone = String(body.phone || '').trim().slice(0, 40);
  const company = String(body.company || '').trim().slice(0, 120);
  const stage = STAGES.includes(body.stage) ? body.stage : 'lead';
  const dealValue = Number.isFinite(Number(body.deal_value)) ? Math.max(0, Number(body.deal_value)) : 0;
  const tags = cleanTags(body.tags);
  const note = String(body.note || '').trim().slice(0, 8000);
  const ts = isoNow();

  const existing = await scopedFirst(env, ctx, {
    sql: 'SELECT c.id, c.name, c.phone, c.company, c.tags, c.stage FROM contacts c WHERE c.email=? AND /*SCOPE*/ ORDER BY c.created_at LIMIT 1',
    binds: [email], alias: 'c', scope,
  });

  // A deal_value with the enquiry becomes a deal (sprint 15): one open deal per
  // contact from this source — a repeat enquiry updates the note, not the pipeline.
  const ensureDeal = async (contactId, label, companyName, contactStage) => {
    if (!(dealValue > 0)) return false;
    const open = await scopedFirst(env, ctx, { sql: "SELECT d.id FROM deals d WHERE d.contact_id=? AND d.stage NOT IN ('won','lost') AND /*SCOPE*/", binds: [contactId], alias: 'd', scope });
    if (open) return false;
    await createDealForImportedContact(env, ctx, contactId, label, companyName, contactStage, dealValue, customerId, 'intake');
    return true;
  };

  if (existing) {
    const mergedTags = cleanTags([...parseTags(existing.tags), ...tags]);
    await scopedRun(env, ctx, {
      sql: `UPDATE contacts SET name = CASE WHEN COALESCE(name,'')='' THEN ? ELSE name END, phone = CASE WHEN COALESCE(phone,'')='' THEN ? ELSE phone END, company = CASE WHEN COALESCE(company,'')='' THEN ? ELSE company END, tags = ?, last_contacted_at = ? WHERE id = ? AND /*SCOPE*/`,
      binds: [name, phone, company, JSON.stringify(mergedTags), ts, existing.id], alias: 'contacts', scope,
    });
    if (company && !existing.company) await linkCompanyByName(env, ctx, null, existing.id, company, customerId);
    if (note) await addNote(env, scope, existing.id, ctx.user && ctx.user.id, note);
    const dealCreated = await ensureDeal(existing.id, existing.name || name || email, existing.company || company, existing.stage);
    return jres({ id: existing.id, email, action: 'updated', note_added: !!note, deal_created: dealCreated, customer_id: customerId });
  }

  const id = uid();
  await scopedInsert(env, ctx, {
    table: 'contacts',
    row: { id, email, name, company, stage, tags: JSON.stringify(tags), phone, linkedin: '', created_at: ts },
  });
  if (company) await linkCompanyByName(env, ctx, null, id, company, customerId);
  if (note) await addNote(env, scope, id, ctx.user && ctx.user.id, note);
  const dealCreated = await ensureDeal(id, name || email, company, stage);
  return jres({ id, email, action: 'created', note_added: !!note, deal_created: dealCreated, customer_id: customerId }, 201);
}
