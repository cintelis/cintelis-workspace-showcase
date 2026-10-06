// CRM companies (sprint 14).
//
// companies is a customer-scoped table (021); every read and write goes
// through worker/scope.js. A contact links to a company by company_id and
// also carries the company name in contacts.company (the field every import
// and list already reads); linkCompanyByName() keeps the two in step whenever
// a contact's company text changes.

import { scopedAll, scopedFirst, scopedRun, scopedInsert } from './scope.js';
import { dealsForCompany } from './crm-deals.js';

function jres(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
function now() { return new Date().toISOString(); }
function companyId() { return 'cmp_' + crypto.randomUUID().replace(/-/g, '').slice(0, 24); }

const FIELDS = ['name', 'domain', 'website', 'phone', 'industry', 'notes', 'owner_user_id'];

function readBody(body) {
  const out = {};
  for (const k of FIELDS) {
    if (!(k in body)) continue;
    if (k === 'owner_user_id') out[k] = body[k] ? String(body[k]) : null;
    else out[k] = String(body[k] || '').trim().slice(0, k === 'notes' ? 4000 : 200);
  }
  if (out.domain) out.domain = out.domain.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return out;
}

function companySql(where = '', tail = '') {
  return `SELECT x.*, u.display_name AS owner_name, (SELECT COUNT(*) FROM contacts c WHERE c.company_id = x.id AND c.unsubscribed = 0) AS contact_count, (SELECT COALESCE(SUM(d.amount),0) FROM deals d WHERE d.company_id = x.id AND d.stage NOT IN ('won','lost')) AS open_value, (SELECT COALESCE(SUM(d.amount),0) FROM deals d WHERE d.company_id = x.id AND d.stage = 'won') AS won_value, (SELECT COUNT(*) FROM deals d WHERE d.company_id = x.id AND d.stage NOT IN ('won','lost')) AS open_deal_count, (SELECT MAX(c.last_contacted_at) FROM contacts c WHERE c.company_id = x.id) AS last_contacted_at FROM companies x LEFT JOIN users u ON u.id = x.owner_user_id WHERE /*SCOPE*/ ${where} ${tail}`;
}

// GET /api/crm/companies?q=
export async function listCompanies(env, ctx, url) {
  const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
  const where = q ? 'AND (lower(x.name) LIKE ? OR lower(x.domain) LIKE ? OR lower(x.industry) LIKE ?)' : '';
  const binds = q ? [`%${q}%`, `%${q}%`, `%${q}%`] : [];
  const rows = await scopedAll(env, ctx, { sql: companySql(where, 'ORDER BY x.name COLLATE NOCASE ASC LIMIT 1000'), binds, alias: 'x', url });
  return jres({ companies: rows });
}

// GET /api/crm/companies/:id — the company plus its contacts.
export async function getCompany(env, ctx, url, id) {
  const company = await scopedFirst(env, ctx, { sql: companySql('AND x.id = ?'), binds: [id], alias: 'x', url });
  if (!company) return jres({ error: 'Not found' }, 404);
  const contacts = await scopedAll(env, ctx, { sql: `SELECT c.id, c.name, c.email, c.phone, c.stage, c.deal_value, c.follow_up_at, c.last_contacted_at, c.owner_user_id, COALESCE(p.title,'') title, u.display_name AS owner_name FROM contacts c LEFT JOIN contact_profiles p ON p.contact_id = c.id LEFT JOIN users u ON u.id = c.owner_user_id WHERE c.company_id = ? AND /*SCOPE*/ ORDER BY c.deal_value DESC, c.name COLLATE NOCASE`, binds: [id], alias: 'c', url });
  const openTasks = await scopedAll(env, ctx, { sql: 'SELECT t.id, t.title, t.type, t.priority, t.due_at, t.contact_id, c.name AS contact_name FROM crm_tasks t JOIN contacts c ON c.id = t.contact_id WHERE c.company_id = ? AND t.done_at IS NULL AND /*SCOPE*/ ORDER BY t.due_at ASC LIMIT 20', binds: [id], alias: 't', url });
  const deals = await dealsForCompany(env, ctx, url, id);
  return jres({ company, contacts, tasks: openTasks, deals });
}

// POST /api/crm/companies
export async function createCompany(req, env, ctx, url) {
  const body = await req.json().catch(() => ({}));
  const f = readBody(body);
  if (!f.name) return jres({ error: 'name required' }, 400);
  const clash = await scopedFirst(env, ctx, { sql: 'SELECT x.id FROM companies x WHERE lower(x.name) = lower(?) AND /*SCOPE*/', binds: [f.name], alias: 'x', url });
  if (clash) return jres({ error: 'A company with that name already exists', id: clash.id }, 409);
  const id = companyId();
  const ts = now();
  await scopedInsert(env, ctx, {
    table: 'companies',
    row: { id, name: f.name, domain: f.domain || '', website: f.website || '', phone: f.phone || '', industry: f.industry || '', notes: f.notes || '', owner_user_id: f.owner_user_id || null, created_at: ts, updated_at: ts },
    requested: body.customer_id,
  });
  const row = await scopedFirst(env, ctx, { sql: companySql('AND x.id = ?'), binds: [id], alias: 'x', url });
  return jres({ company: row }, 201);
}

// PATCH /api/crm/companies/:id
export async function patchCompany(req, env, ctx, url, id) {
  const body = await req.json().catch(() => ({}));
  const existing = await scopedFirst(env, ctx, { sql: 'SELECT x.* FROM companies x WHERE x.id = ? AND /*SCOPE*/', binds: [id], alias: 'x', url });
  if (!existing) return jres({ error: 'Not found' }, 404);
  const f = readBody(body);
  if ('name' in f && !f.name) return jres({ error: 'name cannot be empty' }, 400);
  const sets = [], vals = [];
  for (const [k, v] of Object.entries(f)) { sets.push(`${k}=?`); vals.push(v); }
  if (!sets.length) return jres({ error: 'No fields to update' }, 400);
  sets.push('updated_at=?'); vals.push(now());
  await scopedRun(env, ctx, { sql: `UPDATE companies SET ${sets.join(',')} WHERE id=? AND /*SCOPE*/`, binds: [...vals, id], alias: 'companies', url });
  // A rename flows to the denormalised name on every linked contact.
  if (f.name && f.name !== existing.name) {
    await scopedRun(env, ctx, { sql: 'UPDATE contacts SET company=? WHERE company_id=? AND /*SCOPE*/', binds: [f.name, id], alias: 'contacts', url });
  }
  const row = await scopedFirst(env, ctx, { sql: companySql('AND x.id = ?'), binds: [id], alias: 'x', url });
  return jres({ company: row });
}

// DELETE /api/crm/companies/:id — contacts keep their name text, lose the link.
export async function deleteCompany(env, ctx, url, id) {
  const existing = await scopedFirst(env, ctx, { sql: 'SELECT x.id FROM companies x WHERE x.id = ? AND /*SCOPE*/', binds: [id], alias: 'x', url });
  if (!existing) return jres({ error: 'Not found' }, 404);
  await scopedRun(env, ctx, { sql: 'UPDATE contacts SET company_id=NULL WHERE company_id=? AND /*SCOPE*/', binds: [id], alias: 'contacts', url });
  await scopedRun(env, ctx, { sql: 'UPDATE deals SET company_id=NULL WHERE company_id=? AND /*SCOPE*/', binds: [id], alias: 'deals', url });
  await scopedRun(env, ctx, { sql: 'DELETE FROM companies WHERE id=? AND /*SCOPE*/', binds: [id], alias: 'companies', url });
  return jres({ ok: true });
}

/**
 * Called by crm.js whenever a contact's company text is written: finds the
 * tenant's company of that name (creating it if new) and links the contact.
 * An empty name clears the link. Returns the company id or null.
 */
export async function linkCompanyByName(env, ctx, url, contactId, name, requestedCustomerId = null) {
  const clean = String(name || '').trim();
  if (!clean) {
    await scopedRun(env, ctx, { sql: 'UPDATE contacts SET company_id=NULL WHERE id=? AND /*SCOPE*/', binds: [contactId], alias: 'contacts', url });
    return null;
  }
  let company = await scopedFirst(env, ctx, { sql: 'SELECT x.id FROM companies x WHERE lower(x.name) = lower(?) AND /*SCOPE*/', binds: [clean], alias: 'x', url });
  if (!company) {
    const contact = await scopedFirst(env, ctx, { sql: 'SELECT c.customer_id FROM contacts c WHERE c.id=? AND /*SCOPE*/', binds: [contactId], alias: 'c', url });
    const id = companyId();
    const ts = now();
    await scopedInsert(env, ctx, {
      table: 'companies',
      row: { id, name: clean, domain: '', website: '', phone: '', industry: '', notes: '', owner_user_id: null, created_at: ts, updated_at: ts },
      requested: requestedCustomerId || (contact ? contact.customer_id : null),
    });
    company = { id };
  }
  await scopedRun(env, ctx, { sql: 'UPDATE contacts SET company_id=? WHERE id=? AND /*SCOPE*/', binds: [company.id, contactId], alias: 'contacts', url });
  // Open deals on this contact without a company follow the contact's company.
  await scopedRun(env, ctx, { sql: 'UPDATE deals SET company_id=? WHERE contact_id=? AND company_id IS NULL AND /*SCOPE*/', binds: [company.id, contactId], alias: 'deals', url });
  return company.id;
}
