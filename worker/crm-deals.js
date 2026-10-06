// CRM deals (sprint 15).
//
// deals is a customer-scoped table (022); every read and write goes through
// worker/scope.js. A deal ties to a contact and/or a company and carries its
// own stage, amount, close date and owner. Notes and stage changes are logged
// to the shared activity table as entity_type 'deal'; a stage change is also
// echoed onto the contact's timeline so the contact record tells the story.

import { scopedAll, scopedFirst, scopedRun, scopedInsert } from './scope.js';

function jres(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
function now() { return new Date().toISOString(); }
function uid() { return crypto.randomUUID(); }
function dealId() { return 'dl_' + crypto.randomUUID().replace(/-/g, '').slice(0, 24); }

export const DEAL_STAGES = ['new', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];
export const DEAL_STAGE_LABELS = { new: 'New', qualified: 'Qualified', proposal: 'Proposal sent', negotiation: 'Negotiation', won: 'Closed won', lost: 'Closed lost' };
const OPEN = "('new','qualified','proposal','negotiation')";

function dealSql(where = '', tail = '') {
  return `SELECT d.*, c.name AS contact_name, c.email AS contact_email, c.phone AS contact_phone, x.name AS company_name, u.display_name AS owner_name FROM deals d LEFT JOIN contacts c ON c.id = d.contact_id LEFT JOIN companies x ON x.id = d.company_id LEFT JOIN users u ON u.id = d.owner_user_id WHERE /*SCOPE*/ ${where} ${tail}`;
}

function readBody(body) {
  const out = {};
  if ('name' in body) out.name = String(body.name || '').trim().slice(0, 200);
  if ('stage' in body) out.stage = DEAL_STAGES.includes(body.stage) ? body.stage : 'new';
  if ('amount' in body) out.amount = Math.max(0, Number(body.amount) || 0);
  if ('close_date' in body) out.close_date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.close_date || '')) ? String(body.close_date) : null;
  if ('owner_user_id' in body) out.owner_user_id = body.owner_user_id ? String(body.owner_user_id) : null;
  if ('contact_id' in body) out.contact_id = body.contact_id ? String(body.contact_id) : null;
  if ('company_id' in body) out.company_id = body.company_id ? String(body.company_id) : null;
  if ('source' in body) out.source = String(body.source || '').trim().slice(0, 80);
  if ('notes' in body) out.notes = String(body.notes || '').slice(0, 4000);
  return out;
}

// GET /api/crm/deals?contact_id=&company_id=&status=open|closed|all
export async function listDeals(env, ctx, url) {
  const contactId = url.searchParams.get('contact_id') || '';
  const companyId = url.searchParams.get('company_id') || '';
  const status = url.searchParams.get('status') || 'all';
  let where = '';
  const binds = [];
  if (contactId) { where += ' AND d.contact_id = ?'; binds.push(contactId); }
  if (companyId) { where += ' AND d.company_id = ?'; binds.push(companyId); }
  if (status === 'open') where += ` AND d.stage IN ${OPEN}`;
  if (status === 'closed') where += " AND d.stage IN ('won','lost')";
  const rows = await scopedAll(env, ctx, { sql: dealSql(where, 'ORDER BY CASE WHEN d.close_date IS NULL THEN 1 ELSE 0 END, d.close_date ASC, d.amount DESC, d.created_at DESC LIMIT 2000'), binds, alias: 'd', url });
  return jres({ deals: rows });
}

export async function dealsForContact(env, ctx, url, contactId) {
  return scopedAll(env, ctx, { sql: dealSql('AND d.contact_id = ?', 'ORDER BY d.stage IN (\'won\',\'lost\') ASC, d.amount DESC'), binds: [contactId], alias: 'd', url });
}
export async function dealsForCompany(env, ctx, url, companyId) {
  return scopedAll(env, ctx, { sql: dealSql('AND d.company_id = ?', 'ORDER BY d.stage IN (\'won\',\'lost\') ASC, d.amount DESC'), binds: [companyId], alias: 'd', url });
}

// GET /api/crm/deals/stats — per-stage counts and value, won this month.
export async function dealStats(env, ctx, url) {
  const rows = await scopedAll(env, ctx, { sql: 'SELECT d.stage, COUNT(*) cnt, COALESCE(SUM(d.amount),0) value FROM deals d WHERE /*SCOPE*/ GROUP BY d.stage', alias: 'd', url });
  const stages = {};
  for (const s of DEAL_STAGES) stages[s] = { count: 0, value: 0 };
  for (const r of rows) if (stages[r.stage]) { stages[r.stage].count = Number(r.cnt); stages[r.stage].value = Number(r.value); }
  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
  const won = await scopedFirst(env, ctx, { sql: "SELECT COUNT(*) cnt, COALESCE(SUM(d.amount),0) value FROM deals d WHERE d.stage='won' AND d.closed_at >= ? AND /*SCOPE*/", binds: [monthStart.toISOString()], alias: 'd', url });
  const openValue = DEAL_STAGES.filter(s => s !== 'won' && s !== 'lost').reduce((a, s) => a + stages[s].value, 0);
  const openCount = DEAL_STAGES.filter(s => s !== 'won' && s !== 'lost').reduce((a, s) => a + stages[s].count, 0);
  return jres({ stages, open_value: openValue, open_count: openCount, won_month: { count: Number(won?.cnt || 0), value: Number(won?.value || 0) } });
}

// GET /api/crm/deals/:id — the deal, its activity, and the linked records.
export async function getDeal(env, ctx, url, id) {
  const deal = await scopedFirst(env, ctx, { sql: dealSql('AND d.id = ?'), binds: [id], alias: 'd', url });
  if (!deal) return jres({ error: 'Not found' }, 404);
  const { results: activity } = await env.DB.prepare(
    `SELECT a.id, a.kind, a.body_md, a.created_at, u.display_name AS by_name FROM activity a LEFT JOIN users u ON u.id = a.user_id WHERE a.entity_type='deal' AND a.entity_id=? ORDER BY a.created_at DESC LIMIT 300`
  ).bind(id).all();
  const timeline = (activity || []).map(a => ({ id: a.id, kind: a.kind || 'note', body: a.body_md || '', at: a.created_at, by: a.by_name || '', deletable: a.kind !== 'stage' }));
  timeline.push({ id: 'created_' + deal.id, kind: 'created', at: deal.created_at, deletable: false });
  timeline.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  const tasks = deal.contact_id
    ? await scopedAll(env, ctx, { sql: 'SELECT t.id, t.title, t.type, t.priority, t.due_at FROM crm_tasks t WHERE t.contact_id = ? AND t.done_at IS NULL AND /*SCOPE*/ ORDER BY t.due_at ASC LIMIT 10', binds: [deal.contact_id], alias: 't', url })
    : [];
  return jres({ deal, timeline, tasks });
}

async function ownedContact(env, ctx, url, id) {
  return id ? scopedFirst(env, ctx, { sql: 'SELECT c.id, c.name, c.email, c.company_id, c.customer_id, c.owner_user_id FROM contacts c WHERE c.id=? AND /*SCOPE*/', binds: [id], alias: 'c', url }) : null;
}
async function ownedCompany(env, ctx, url, id) {
  return id ? scopedFirst(env, ctx, { sql: 'SELECT x.id, x.name, x.customer_id FROM companies x WHERE x.id=? AND /*SCOPE*/', binds: [id], alias: 'x', url }) : null;
}

// POST /api/crm/deals
export async function createDeal(req, env, ctx, url) {
  const body = await req.json().catch(() => ({}));
  const f = readBody(body);
  const contact = await ownedContact(env, ctx, url, f.contact_id);
  if (f.contact_id && !contact) return jres({ error: 'Contact not found' }, 404);
  if (!f.company_id && contact && contact.company_id) f.company_id = contact.company_id;
  const company = await ownedCompany(env, ctx, url, f.company_id);
  if (f.company_id && !company) return jres({ error: 'Company not found' }, 404);
  if (!f.name) f.name = `${(company && company.name) || (contact && (contact.name || contact.email)) || 'New'} — deal`;
  const stage = f.stage || 'new';
  const id = dealId();
  const ts = now();
  await scopedInsert(env, ctx, {
    table: 'deals',
    row: {
      id, name: f.name, contact_id: f.contact_id || null, company_id: f.company_id || null, stage, amount: f.amount || 0,
      close_date: f.close_date || null, closed_at: (stage === 'won' || stage === 'lost') ? ts : null,
      owner_user_id: f.owner_user_id !== undefined ? f.owner_user_id : ((contact && contact.owner_user_id) || (ctx.user ? ctx.user.id : null)),
      source: f.source || '', notes: f.notes || '', created_by: ctx.user ? ctx.user.id : null, created_at: ts, updated_at: ts,
    },
    requested: body.customer_id || (contact && contact.customer_id) || (company && company.customer_id) || null,
  });
  if (contact) await logOnContact(env, contact.id, ctx, `Deal created: ${f.name}${f.amount ? ' (' + money(f.amount) + ')' : ''}`);
  const row = await scopedFirst(env, ctx, { sql: dealSql('AND d.id = ?'), binds: [id], alias: 'd', url });
  return jres({ deal: row }, 201);
}

// PATCH /api/crm/deals/:id
export async function patchDeal(req, env, ctx, url, id) {
  const body = await req.json().catch(() => ({}));
  const existing = await scopedFirst(env, ctx, { sql: 'SELECT d.* FROM deals d WHERE d.id=? AND /*SCOPE*/', binds: [id], alias: 'd', url });
  if (!existing) return jres({ error: 'Not found' }, 404);
  const f = readBody(body);
  if ('name' in f && !f.name) return jres({ error: 'name cannot be empty' }, 400);
  if ('contact_id' in f && f.contact_id && !(await ownedContact(env, ctx, url, f.contact_id))) return jres({ error: 'Contact not found' }, 404);
  if ('company_id' in f && f.company_id && !(await ownedCompany(env, ctx, url, f.company_id))) return jres({ error: 'Company not found' }, 404);
  const sets = [], vals = [];
  for (const [k, v] of Object.entries(f)) { sets.push(`${k}=?`); vals.push(v); }
  const stageChanged = 'stage' in f && f.stage !== existing.stage;
  if (stageChanged) {
    const closing = f.stage === 'won' || f.stage === 'lost';
    sets.push('closed_at=?'); vals.push(closing ? now() : null);
  }
  if (!sets.length) return jres({ error: 'No fields to update' }, 400);
  sets.push('updated_at=?'); vals.push(now());
  await scopedRun(env, ctx, { sql: `UPDATE deals SET ${sets.join(',')} WHERE id=? AND /*SCOPE*/`, binds: [...vals, id], alias: 'deals', url });
  if (stageChanged) {
    const text = `${DEAL_STAGE_LABELS[existing.stage] || existing.stage} -> ${DEAL_STAGE_LABELS[f.stage] || f.stage}`;
    await env.DB.prepare("INSERT INTO activity (id, entity_type, entity_id, user_id, kind, body_md, created_at) VALUES (?, 'deal', ?, ?, 'stage', ?, ?)").bind(uid(), id, ctx.user ? ctx.user.id : null, text, now()).run();
    const contactId = f.contact_id !== undefined ? f.contact_id : existing.contact_id;
    if (contactId) {
      await logOnContact(env, contactId, ctx, `Deal "${f.name || existing.name}" moved to ${DEAL_STAGE_LABELS[f.stage] || f.stage}`);
      // Winning a deal makes the contact a customer; the lifecycle stage follows.
      if (f.stage === 'won') await scopedRun(env, ctx, { sql: "UPDATE contacts SET stage='won' WHERE id=? AND stage<>'won' AND /*SCOPE*/", binds: [contactId], alias: 'contacts', url });
    }
  }
  const row = await scopedFirst(env, ctx, { sql: dealSql('AND d.id = ?'), binds: [id], alias: 'd', url });
  return jres({ deal: row });
}

// DELETE /api/crm/deals/:id
export async function deleteDeal(env, ctx, url, id) {
  const r = await scopedRun(env, ctx, { sql: 'DELETE FROM deals WHERE id=? AND /*SCOPE*/', binds: [id], alias: 'deals', url });
  if (!r.changes) return jres({ error: 'Not found' }, 404);
  await env.DB.prepare("DELETE FROM activity WHERE entity_type='deal' AND entity_id=?").bind(id).run();
  return jres({ ok: true });
}

// POST /api/crm/deals/:id/notes  { content, type }   — DELETE …/notes/:noteId
export async function addDealNote(req, env, ctx, url, id) {
  const deal = await scopedFirst(env, ctx, { sql: 'SELECT d.id FROM deals d WHERE d.id=? AND /*SCOPE*/', binds: [id], alias: 'd', url });
  if (!deal) return jres({ error: 'Not found' }, 404);
  const { content, type } = await req.json().catch(() => ({}));
  if (!content) return jres({ error: 'content required' }, 400);
  const nid = uid(); const ts = now(); const kind = ['note', 'call', 'meeting', 'email'].includes(type) ? type : 'note';
  await env.DB.prepare("INSERT INTO activity (id, entity_type, entity_id, user_id, kind, body_md, created_at) VALUES (?, 'deal', ?, ?, ?, ?, ?)").bind(nid, id, ctx.user ? ctx.user.id : null, kind, content, ts).run();
  return jres({ id: nid, content, type: kind, created_at: ts });
}
export async function deleteDealNote(env, ctx, url, id, noteId) {
  const deal = await scopedFirst(env, ctx, { sql: 'SELECT d.id FROM deals d WHERE d.id=? AND /*SCOPE*/', binds: [id], alias: 'd', url });
  if (!deal) return jres({ error: 'Not found' }, 404);
  await env.DB.prepare("DELETE FROM activity WHERE id=? AND entity_type='deal' AND entity_id=?").bind(noteId, id).run();
  return jres({ ok: true });
}

async function logOnContact(env, contactId, ctx, text) {
  await env.DB.prepare("INSERT INTO activity (id, entity_type, entity_id, user_id, kind, body_md, created_at) VALUES (?, 'contact', ?, ?, 'deal', ?, ?)").bind(uid(), contactId, ctx && ctx.user ? ctx.user.id : null, text, now()).run();
}
function money(n) { try { return Number(n).toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }); } catch { return '$' + n; } }
