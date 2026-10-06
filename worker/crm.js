// ============================================================
// CRM + Outreach — contacts, lists, templates, campaigns, sent log, the
// pipeline views, and the campaign scheduler. Per-customer since sprint 9.
//
// Every read or write of a scoped table goes through worker/scope.js. The
// scope comes from the session (resolveScope), never from the request; the
// only places that pick a scope explicitly are the scheduler (no session —
// it walks every tenant's due campaigns, then does each campaign's work under
// that campaign's own tenant) and a few follow-up statements on a row whose
// ownership the same handler has just established (ALL_SCOPE, commented).
//
// Statements that touch a scoped table are written on ONE line with their
// /*SCOPE*/ marker: scripts/check-scoping.js is line-based, and that is the
// price of a checker simple enough to trust.
//
// Self-contained: no imports from worker.js (see customers.js on cycles).
// ============================================================

import {
  resolveScope, isCustomerScope, scopedAll, scopedFirst, scopedRun, scopedInsert,
  assertOwned, customerIdForInsert, ALL_SCOPE, INTERNAL_SCOPE, scopeForRow,
} from './scope.js';
import { customerIdForCreate, isCustomerUser } from './customers.js';
import { sendEmail, resolveSender, merge, DEFAULT_FROM, DEFAULT_NAME } from './email.js';
import { deleteAttachmentsForEntity } from './attachments.js';
import { deleteLinksForEntity } from './entity-links.js';
import { emit, EVENT_TYPES } from './events.js';
import { openTasksForContact, syncFollowUpTask } from './crm-tasks.js';
import { linkCompanyByName } from './crm-companies.js';
import { dealsForContact } from './crm-deals.js';

function jres(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
function uid() { return crypto.randomUUID(); }
function now() { return new Date().toISOString(); }

export const STAGES = ['lead', 'prospect', 'qualified', 'proposal', 'won', 'lost'];

/** The tenant a staff-created row lands in, validated; client users are pinned. */
async function tenantForCreate(env, ctx, requested) {
  const scoped = await customerIdForCreate(env, ctx, requested);
  if (scoped.error) return scoped;
  const cid = customerIdForInsert(ctx, scoped.customer_id);
  return { customer_id: cid, scope: cid ? { mode: 'one', customerId: cid } : INTERNAL_SCOPE };
}

// ── Contact helpers (unscoped tables: contact_profiles, activity) ─────

async function ensureContactProfileTable(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS contact_profiles (
    contact_id TEXT PRIMARY KEY,
    first_name TEXT DEFAULT '',
    last_name TEXT DEFAULT '',
    title TEXT DEFAULT '',
    image_url TEXT DEFAULT '',
    updated_at TEXT NOT NULL
  )`).run();
  try {
    await env.DB.prepare(`ALTER TABLE contact_profiles ADD COLUMN title TEXT DEFAULT ''`).run();
  } catch (err) {
    const message = String(err?.message || err || '');
    if (!message.includes('duplicate column name')) throw err;
  }
}

function formatContactName(firstName, lastName, fallbackName) {
  const fullName = [String(firstName || '').trim(), String(lastName || '').trim()].filter(Boolean).join(' ').trim();
  return fullName || String(fallbackName || '').trim();
}

function parseContactSearchQuery(rawQuery) {
  const source = String(rawQuery || '');
  const tags = [];
  const companies = [];
  const titles = [];
  const tokenRegex = /\b(tag|company|title):("([^"]+)"|[^\s]+)/gi;
  let plainText = source.replace(tokenRegex, (_, key, rawValue, quotedValue) => {
    const value = String(quotedValue || rawValue || '').replace(/^"|"$/g, '').trim().toLowerCase();
    if (!value) return ' ';
    if (key.toLowerCase() === 'tag') tags.push(value);
    else if (key.toLowerCase() === 'company') companies.push(value);
    else if (key.toLowerCase() === 'title') titles.push(value);
    return ' ';
  });
  plainText = plainText.replace(/\s+/g, ' ').trim().toLowerCase();
  return { text: plainText, tags: uniqueTags(tags), companies: uniqueTags(companies), titles: uniqueTags(titles) };
}

function parseTags(rawTags) {
  if (Array.isArray(rawTags)) return rawTags.map(tag => String(tag || '').trim()).filter(Boolean);
  try { return JSON.parse(rawTags || '[]').map(tag => String(tag || '').trim()).filter(Boolean); } catch { return []; }
}

function uniqueTags(values) {
  return Array.from(new Set((values || []).map(tag => String(tag || '').trim()).filter(Boolean)));
}

async function saveContactProfile(env, contactId, firstName, lastName, title, imageUrl) {
  const ts = now();
  await env.DB.prepare(`INSERT INTO contact_profiles (contact_id,first_name,last_name,title,image_url,updated_at)
    VALUES (?,?,?,?,?,?)
    ON CONFLICT(contact_id) DO UPDATE SET
      first_name=excluded.first_name,
      last_name=excluded.last_name,
      title=excluded.title,
      image_url=excluded.image_url,
      updated_at=excluded.updated_at`)
    .bind(contactId, firstName || '', lastName || '', title || '', imageUrl || '', ts).run();
}

function reshapeActivityAsNote(r) {
  return { id: r.id, contact_id: r.entity_id, content: r.body_md, type: r.kind, created_at: r.created_at };
}

/** notes_count bump on a contact whose ownership the caller has just checked. */
async function bumpNotesCount(env, contactId, delta) {
  // ALL_SCOPE: the caller resolved this contact through the session scope already.
  const sql = delta > 0
    ? 'UPDATE contacts SET notes_count=notes_count+1 WHERE id=? AND /*SCOPE*/'
    : 'UPDATE contacts SET notes_count=MAX(0,notes_count-1) WHERE id=? AND /*SCOPE*/';
  await scopedRun(env, null, { sql, binds: [contactId], alias: 'contacts', scope: ALL_SCOPE });
}

async function logStageChangeActivity(env, contactId, fromStage, toStage) {
  if (!contactId) return;
  const previous = String(fromStage || 'lead').trim().toLowerCase();
  const next = String(toStage || 'lead').trim().toLowerCase();
  if (previous === next) return;
  const content = `${formatStageActivityValue(previous)} -> ${formatStageActivityValue(next)}`;
  await env.DB.prepare(
    `INSERT INTO activity (id, entity_type, entity_id, user_id, kind, body_md, created_at)
     VALUES (?, 'contact', ?, NULL, 'stage', ?, ?)`
  ).bind(uid(), contactId, content, now()).run();
  await bumpNotesCount(env, contactId, +1);
  try {
    // ALL_SCOPE: ownership was established by the handler that changed the stage.
    const contact = await scopedFirst(env, null, { sql: 'SELECT c.id, c.name, c.email FROM contacts c WHERE c.id=? AND /*SCOPE*/', binds: [contactId], alias: 'c', scope: ALL_SCOPE });
    if (contact) await emit(env, EVENT_TYPES.CONTACT_STAGE_CHANGED, { contact, old_stage: previous, new_stage: next });
  } catch {}
}

function formatStageActivityValue(stage) {
  const value = String(stage || 'lead').trim().toLowerCase();
  return STAGES.includes(value) ? value[0].toUpperCase() + value.slice(1) : 'Lead';
}

// ── Overview / stats ─────────────────────────────────────────

function normalizeOverviewRange(value) {
  const allowed = new Set(['7d', '30d', 'month', 'all']);
  const range = String(value || 'all').toLowerCase();
  return allowed.has(range) ? range : 'all';
}

function getOverviewDateFilter(range, column) {
  if (range === '7d') return ` AND datetime(${column}) >= datetime('now', '-7 days')`;
  if (range === '30d') return ` AND datetime(${column}) >= datetime('now', '-30 days')`;
  if (range === 'month') return ` AND datetime(${column}) >= datetime('now', 'start of month')`;
  return '';
}

// A value arriving with a contact (CSV import, the v1 intake) becomes a deal —
// the contact row no longer carries money (sprint 15). Stage maps from the
// contact's lifecycle stage; company links through the contact's company_id.
export async function createDealForImportedContact(env, ctx, contactId, contactLabel, companyName, contactStage, amount, customerId, source = 'import') {
  const dealStage = { qualified: 'qualified', proposal: 'proposal', won: 'won', lost: 'lost' }[contactStage] || 'new';
  const ts = now();
  const c = await scopedFirst(env, null, { sql: 'SELECT c.company_id FROM contacts c WHERE c.id=? AND /*SCOPE*/', binds: [contactId], alias: 'c', scope: ALL_SCOPE });
  await scopedInsert(env, ctx, {
    table: 'deals',
    row: {
      id: 'dl_' + crypto.randomUUID().replace(/-/g, '').slice(0, 24), name: `${companyName || contactLabel} — deal`, contact_id: contactId, company_id: (c && c.company_id) || null,
      stage: dealStage, amount: Number(amount) || 0, close_date: null, closed_at: (dealStage === 'won' || dealStage === 'lost') ? ts : null,
      owner_user_id: ctx && ctx.user ? ctx.user.id : null, source, notes: '', created_by: ctx && ctx.user ? ctx.user.id : null, created_at: ts, updated_at: ts,
    },
    requested: customerId,
  });
}

export async function getOverview(env, ctx, url) {
  await ensureContactProfileTable(env);
  const range = normalizeOverviewRange(url?.searchParams?.get('range'));
  const sentFilter = getOverviewDateFilter(range, 's.sent_at');
  const noteActivityFilter = getOverviewDateFilter(range, 'n.created_at');
  const emailActivityFilter = getOverviewDateFilter(range, 's.sent_at');
  // Won is a deal count (sprint 15), ranged by the date the deal closed.
  const wonRangeFilter = getOverviewDateFilter(range, 'd.closed_at');
  const q = (sql, binds = [], alias = 'c') => scopedAll(env, ctx, { sql, binds, alias, url });
  const one = (sql, binds = [], alias = 'c') => scopedFirst(env, ctx, { sql, binds, alias, url });

  const [contacts, templates, campaigns, sent, pipelineValue, followUps, stageRows, wonInRange, recentSends, noteActivity, emailActivity, closedDeals] = await Promise.all([
    one('SELECT COUNT(*) n FROM contacts c WHERE c.unsubscribed=0 AND /*SCOPE*/'),
    one('SELECT COUNT(*) n FROM templates t WHERE /*SCOPE*/', [], 't'),
    one('SELECT COUNT(*) n FROM campaigns c WHERE c.status NOT IN ("draft","completed") AND /*SCOPE*/'),
    one(`SELECT COUNT(*) n FROM sent_log s WHERE s.status="sent"${sentFilter} AND /*SCOPE*/`, [], 's'),
    one("SELECT COALESCE(SUM(d.amount),0) v FROM deals d WHERE d.stage NOT IN ('won','lost') AND /*SCOPE*/", [], 'd'),
    one(`SELECT COALESCE(SUM(CASE WHEN c.follow_up_at IS NOT NULL AND date(c.follow_up_at) < date('now') AND c.stage NOT IN ('won','lost') THEN 1 ELSE 0 END),0) overdue, COALESCE(SUM(CASE WHEN c.follow_up_at IS NOT NULL AND date(c.follow_up_at) = date('now') AND c.stage NOT IN ('won','lost') THEN 1 ELSE 0 END),0) today FROM contacts c WHERE c.unsubscribed=0 AND /*SCOPE*/`),
    // Stage counts are contacts by lifecycle stage; the value beside each is the
    // open deal amount held by contacts in that stage.
    q("SELECT c.stage, COUNT(*) count, COALESCE(SUM((SELECT SUM(d.amount) FROM deals d WHERE d.contact_id=c.id AND d.stage NOT IN ('won','lost'))),0) value FROM contacts c WHERE c.unsubscribed=0 AND /*SCOPE*/ GROUP BY c.stage"),
    one(`SELECT COUNT(*) count, COALESCE(SUM(d.amount),0) value FROM deals d WHERE d.stage='won'${wonRangeFilter} AND /*SCOPE*/`, [], 'd'),
    q(`SELECT s.id, s.campaign_name, s.contact_email, s.subject, s.status, s.sent_at FROM sent_log s WHERE /*SCOPE*/${sentFilter} ORDER BY s.sent_at DESC LIMIT 10`, [], 's'),
    q(`SELECT n.id, n.entity_id contact_id, COALESCE(NULLIF(TRIM(COALESCE(cp.first_name,'') || ' ' || COALESCE(cp.last_name,'')), ''), NULLIF(c.name, ''), c.email) contact_name, c.email contact_email, LOWER(COALESCE(n.kind, 'note')) type, n.body_md body, n.created_at FROM activity n JOIN contacts c ON c.id = n.entity_id LEFT JOIN contact_profiles cp ON cp.contact_id = n.entity_id WHERE n.entity_type = 'contact'${noteActivityFilter} AND /*SCOPE*/ ORDER BY n.created_at DESC LIMIT 15`),
    q(`SELECT s.id, s.contact_id, COALESCE(NULLIF(s.contact_email,''), '') contact_email, 'email' type, COALESCE(NULLIF(s.subject, ''), 'Email sent') body, s.sent_at created_at FROM sent_log s WHERE /*SCOPE*/${emailActivityFilter} ORDER BY s.sent_at DESC LIMIT 15`, [], 's'),
    // All-time won/lost by deal, for average deal size and win rate.
    q("SELECT d.stage, COUNT(*) count, COALESCE(SUM(d.amount),0) value FROM deals d WHERE d.stage IN ('won','lost') AND /*SCOPE*/ GROUP BY d.stage", [], 'd'),
  ]);
  const closed = {};
  for (const row of closedDeals || []) closed[row.stage] = { count: Number(row.count || 0), value: Number(row.value || 0) };

  // The two activity feeds are separate statements (one scope marker each);
  // merge and trim here instead of in a UNION.
  const recentActivity = [...(noteActivity || []), ...(emailActivity || []).map(e => ({ ...e, contact_name: e.contact_email }))]
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    .slice(0, 15);

  const stageLookup = {};
  for (const row of stageRows || []) stageLookup[row.stage] = { count: Number(row.count || 0), value: Number(row.value || 0) };
  const pipelineStages = ['lead', 'prospect', 'qualified', 'proposal'].map(stage => ({
    stage, count: stageLookup[stage]?.count || 0, value: stageLookup[stage]?.value || 0,
  }));

  return jres({
    range,
    contacts: Number(contacts?.n || 0),
    templates: Number(templates?.n || 0),
    campaigns: Number(campaigns?.n || 0),
    sent: Number(sent?.n || 0),
    pipeline_value: Number(pipelineValue?.v || 0),
    follow_ups_overdue: Number(followUps?.overdue || 0),
    follow_ups_today: Number(followUps?.today || 0),
    pipeline_stages: pipelineStages,
    won: closed.won || { count: 0, value: 0 },
    lost: closed.lost || { count: 0, value: 0 },
    won_in_range: { count: Number(wonInRange?.count || 0), value: Number(wonInRange?.value || 0) },
    recent_sends: recentSends || [],
    recent_activity: recentActivity,
  });
}

// ── Templates ────────────────────────────────────────────────

export async function listTemplates(env, ctx, url) {
  const results = await scopedAll(env, ctx, { sql: 'SELECT t.id,t.name,t.subject,t.customer_id,t.created_at,t.updated_at FROM templates t WHERE /*SCOPE*/ ORDER BY t.created_at DESC', alias: 't', url });
  return jres(results);
}

/** Seed the Ads Optimiser real-estate templates into the internal tenant. */
export async function seedTemplates(env, ctx, templates) {
  if (isCustomerUser(ctx)) return jres({ error: 'Forbidden' }, 403);
  const created = [];
  const existing = [];
  const s = { alias: 'templates', scope: INTERNAL_SCOPE };
  await scopedRun(env, ctx, { ...s, sql: 'DELETE FROM templates WHERE id=? AND /*SCOPE*/', binds: ['seed_ads_optimiser_real_estate_video_walkthrough_v1'] });
  for (const template of templates) {
    const row = await scopedFirst(env, ctx, { sql: 'SELECT t.id,t.name,t.subject,t.created_at,t.updated_at FROM templates t WHERE t.id=? AND /*SCOPE*/ LIMIT 1', binds: [template.id], alias: 't', scope: INTERNAL_SCOPE });
    if (row) {
      if (template.id === 'seed_ao_re_luxury_homes_editorial_v3') {
        const ts = now();
        await scopedRun(env, ctx, { ...s, sql: 'UPDATE templates SET name=?,subject=?,html_body=?,updated_at=? WHERE id=? AND /*SCOPE*/', binds: [template.name, template.subject, template.html_body, ts, template.id] });
        existing.push({ ...row, name: template.name, subject: template.subject, updated_at: ts });
        continue;
      }
      existing.push(row);
      continue;
    }
    const ts = now();
    await scopedInsert(env, ctx, { table: 'templates', row: { id: template.id, name: template.name, subject: template.subject, html_body: template.html_body, created_at: ts, updated_at: ts } });
    created.push({ id: template.id, name: template.name, subject: template.subject, created_at: ts, updated_at: ts });
  }
  return jres({ ok: true, created_count: created.length, existing_count: existing.length, templates: [...created, ...existing] });
}

export async function getTemplate(env, ctx, url, id) {
  const row = await scopedFirst(env, ctx, { sql: 'SELECT t.id,t.name,t.subject,t.html_body,t.customer_id,t.created_at,t.updated_at FROM templates t WHERE t.id=? AND /*SCOPE*/', binds: [id], alias: 't', url });
  if (!row) return jres({ error: 'Template not found' }, 404);
  return jres(row);
}

export async function createTemplate(req, env, ctx) {
  const body = await req.json().catch(() => ({}));
  const { name, subject, html_body } = body;
  if (!name || !subject || !html_body) return jres({ error: 'name, subject, html_body required' }, 400);
  const tenant = await tenantForCreate(env, ctx, body.customer_id);
  if (tenant.error) return tenant.error;
  const id = uid(), ts = now();
  await scopedInsert(env, ctx, { table: 'templates', row: { id, name, subject, html_body, created_at: ts, updated_at: ts }, requested: tenant.customer_id });
  return jres({ id, name, subject });
}

export async function updateTemplate(req, env, ctx, url, id) {
  const { name, subject, html_body } = await req.json().catch(() => ({}));
  const r = await scopedRun(env, ctx, { sql: 'UPDATE templates SET name=?,subject=?,html_body=?,updated_at=? WHERE id=? AND /*SCOPE*/', binds: [name, subject, html_body, now(), id], alias: 'templates', url });
  if (!r.changes) return jres({ error: 'Template not found' }, 404);
  return jres({ ok: true });
}

export async function deleteTemplate(env, ctx, url, id) {
  const r = await scopedRun(env, ctx, { sql: 'DELETE FROM templates WHERE id=? AND /*SCOPE*/', binds: [id], alias: 'templates', url });
  if (!r.changes) return jres({ error: 'Template not found' }, 404);
  return jres({ ok: true });
}

// ── Contacts ─────────────────────────────────────────────────

export async function listContacts(env, ctx, url) {
  await ensureContactProfileTable(env);
  const q = url.searchParams.get('q') || '';
  const stage = url.searchParams.get('stage') || '';
  const title = url.searchParams.get('title') || '';
  const search = parseContactSearchQuery(q);
  // One line for the scoped tables (contacts, contact_lists) and the marker.
  let sql = `SELECT c.*, u.display_name AS owner_name, COALESCE((SELECT SUM(d.amount) FROM deals d WHERE d.contact_id=c.id AND d.stage NOT IN ('won','lost')),0) open_deal_value, COALESCE((SELECT COUNT(*) FROM deals d WHERE d.contact_id=c.id AND d.stage NOT IN ('won','lost')),0) open_deal_count, COALESCE(p.first_name,'') first_name, COALESCE(p.last_name,'') last_name, COALESCE(p.title,'') title, COALESCE(p.image_url,'') image_url, COALESCE((SELECT json_group_array(l.name) FROM contact_list_members m JOIN contact_lists l ON l.id=m.list_id WHERE m.contact_id=c.id), '[]') list_names_json, COALESCE((SELECT COUNT(*) FROM contact_list_members m WHERE m.contact_id=c.id), 0) list_count FROM contacts c LEFT JOIN contact_profiles p ON p.contact_id=c.id LEFT JOIN users u ON u.id=c.owner_user_id WHERE c.unsubscribed=0 AND /*SCOPE*/`;
  const binds = [];
  if (search.text) {
    sql += ' AND (lower(c.email) LIKE ? OR lower(c.name) LIKE ? OR lower(c.company) LIKE ? OR lower(c.phone) LIKE ? OR lower(p.title) LIKE ?)';
    binds.push(`%${search.text}%`, `%${search.text}%`, `%${search.text}%`, `%${search.text}%`, `%${search.text}%`);
  }
  for (const tag of search.tags) {
    sql += ` AND EXISTS (SELECT 1 FROM json_each(CASE WHEN c.tags IS NULL OR c.tags='' THEN '[]' ELSE c.tags END) jt WHERE lower(jt.value)=?)`;
    binds.push(tag);
  }
  for (const companyFilter of search.companies) { sql += ' AND lower(c.company) LIKE ?'; binds.push(`%${companyFilter}%`); }
  for (const titleFilter of search.titles) { sql += ' AND lower(p.title) LIKE ?'; binds.push(`%${titleFilter}%`); }
  if (title) { sql += ' AND p.title = ?'; binds.push(title); }
  if (stage) { sql += ' AND c.stage=?'; binds.push(stage); }
  sql += ' ORDER BY c.created_at DESC LIMIT 1000';
  const results = await scopedAll(env, ctx, { sql, binds, alias: 'c', url });
  return jres(results);
}

export async function createContact(req, env, ctx) {
  await ensureContactProfileTable(env);
  const body = await req.json().catch(() => ({}));
  const { email, name, first_name, last_name, title, company, stage, tags, phone, linkedin, image_url } = body;
  if (!email) return jres({ error: 'Email required' }, 400);
  const tenant = await tenantForCreate(env, ctx, body.customer_id);
  if (tenant.error) return tenant.error;
  const id = uid();
  const fullName = formatContactName(first_name, last_name, name);
  try {
    await scopedInsert(env, ctx, {
      table: 'contacts',
      row: { id, email: email.toLowerCase().trim(), name: fullName, company: company || '', stage: stage || 'lead', tags: JSON.stringify(tags || []), phone: phone || '', linkedin: linkedin || '', created_at: now() },
      requested: tenant.customer_id,
    });
    await saveContactProfile(env, id, first_name, last_name, title, image_url);
    if (company) await linkCompanyByName(env, ctx, null, id, company, tenant.customer_id);
    if (body.owner_user_id !== undefined) await scopedRun(env, ctx, { sql: 'UPDATE contacts SET owner_user_id=? WHERE id=? AND /*SCOPE*/', binds: [body.owner_user_id || null, id], alias: 'contacts' });
    return jres({ id, email });
  } catch { return jres({ error: 'Email already exists' }, 409); }
}

export async function importContacts(req, env, ctx) {
  const body = await req.json().catch(() => ({}));
  const { csv, batch_tag, extra_tags, list_id, new_list_name } = body;
  if (!csv) return jres({ error: 'csv required' }, 400);
  await ensureContactProfileTable(env);
  const tenant = await tenantForCreate(env, ctx, body.customer_id);
  if (tenant.error) return tenant.error;
  const T = { scope: tenant.scope };

  let targetListId = '';
  let listName = '';
  const requestedListName = (new_list_name || '').trim();
  if (requestedListName) {
    const existingList = await scopedFirst(env, ctx, { ...T, sql: 'SELECT l.id,l.name FROM contact_lists l WHERE lower(l.name)=lower(?) AND /*SCOPE*/ LIMIT 1', binds: [requestedListName], alias: 'l' });
    if (existingList?.id) {
      targetListId = existingList.id;
      listName = existingList.name || requestedListName;
    } else {
      targetListId = uid();
      listName = requestedListName;
      await scopedInsert(env, ctx, { table: 'contact_lists', row: { id: targetListId, name: listName, description: '', created_at: now() }, requested: tenant.customer_id });
    }
  } else if (list_id) {
    const list = await scopedFirst(env, ctx, { ...T, sql: 'SELECT l.id,l.name FROM contact_lists l WHERE l.id=? AND /*SCOPE*/ LIMIT 1', binds: [list_id], alias: 'l' });
    if (!list?.id) return jres({ error: 'Selected list was not found' }, 400);
    targetListId = list.id;
    listName = list.name || '';
  }
  const importTags = uniqueTags(['source:csv', batch_tag, ...(Array.isArray(extra_tags) ? extra_tags : [])]);
  const lines = csv.trim().split('\n');
  const hdr = lines[0].toLowerCase().split(',').map(h => h.trim().replace(/["\r]/g, ''));
  const ei = hdr.indexOf('email');
  const ni = hdr.indexOf('name');
  const fi = hdr.indexOf('first_name');
  const li = hdr.indexOf('last_name');
  const ti = hdr.indexOf('title');
  const ci = hdr.indexOf('company');
  const si = hdr.indexOf('stage');
  const di = hdr.indexOf('deal_value');
  const pi = hdr.indexOf('phone');
  const ii = hdr.indexOf('image_url') >= 0 ? hdr.indexOf('image_url') : hdr.indexOf('image');
  if (ei === -1) return jres({ error: 'CSV must have an "email" column header' }, 400);
  let imported = 0, skipped = 0, linked = 0;
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim().replace(/["\r]/g, ''));
    const email = cols[ei]?.toLowerCase().trim();
    if (!email || !email.includes('@')) { skipped++; continue; }
    const firstName = fi >= 0 ? cols[fi] || '' : '';
    const lastName = li >= 0 ? cols[li] || '' : '';
    const title = ti >= 0 ? cols[ti] || '' : '';
    const fullName = formatContactName(firstName, lastName, ni >= 0 ? cols[ni] || '' : '');
    try {
      const ins = await scopedInsert(env, ctx, {
        table: 'contacts', orIgnore: true, requested: tenant.customer_id,
        row: { id: uid(), email, name: fullName, company: ci >= 0 ? cols[ci] || '' : '', stage: si >= 0 ? cols[si] || 'lead' : 'lead', phone: pi >= 0 ? cols[pi] || '' : '', tags: JSON.stringify(importTags), created_at: now() },
      });
      const row = await scopedFirst(env, ctx, { ...T, sql: 'SELECT c.id,c.tags FROM contacts c WHERE c.email=? AND /*SCOPE*/ LIMIT 1', binds: [email], alias: 'c' });
      if (row?.id) {
        await saveContactProfile(env, row.id, firstName, lastName, title, ii >= 0 ? cols[ii] || '' : '');
        if (ins.changes && ci >= 0 && cols[ci]) await linkCompanyByName(env, ctx, null, row.id, cols[ci], tenant.customer_id);
        // A deal_value column on import becomes a deal, not a contact field.
        const importedValue = di >= 0 ? parseFloat(cols[di]) || 0 : 0;
        if (ins.changes && importedValue > 0) await createDealForImportedContact(env, ctx, row.id, fullName || email, ci >= 0 ? cols[ci] || '' : '', si >= 0 ? cols[si] || 'lead' : 'lead', importedValue, tenant.customer_id);
        const mergedTags = uniqueTags([...parseTags(row.tags), ...importTags]);
        await scopedRun(env, ctx, { ...T, sql: 'UPDATE contacts SET tags=? WHERE id=? AND /*SCOPE*/', binds: [JSON.stringify(mergedTags), row.id], alias: 'contacts' });
        if (targetListId) {
          const membership = await env.DB.prepare('INSERT OR IGNORE INTO contact_list_members (contact_id,list_id) VALUES (?,?)').bind(row.id, targetListId).run();
          if (membership.meta?.changes) linked++;
        }
      }
      if (ins.changes) imported++; else skipped++;
    } catch { skipped++; }
  }
  return jres({ imported, skipped, linked, list_name: listName });
}

export async function updateContact(req, env, ctx, url, id) {
  await ensureContactProfileTable(env);
  const body = await req.json().catch(() => ({}));
  const { name, first_name, last_name, title, company, stage, tags, phone, linkedin, follow_up_at, image_url } = body;
  const fullName = formatContactName(first_name, last_name, name);
  const current = await scopedFirst(env, ctx, { sql: 'SELECT c.stage, c.company FROM contacts c WHERE c.id=? AND /*SCOPE*/', binds: [id], alias: 'c', url });
  if (!current) return jres({ error: 'Not found' }, 404);
  const nextStage = stage || 'lead';
  await scopedRun(env, ctx, { sql: 'UPDATE contacts SET name=?,company=?,stage=?,tags=?,phone=?,linkedin=?,follow_up_at=? WHERE id=? AND /*SCOPE*/', binds: [fullName, company || '', nextStage, JSON.stringify(tags || []), phone || '', linkedin || '', follow_up_at || null, id], alias: 'contacts', url });
  if (body.owner_user_id !== undefined) await scopedRun(env, ctx, { sql: 'UPDATE contacts SET owner_user_id=? WHERE id=? AND /*SCOPE*/', binds: [body.owner_user_id || null, id], alias: 'contacts', url });
  await saveContactProfile(env, id, first_name, last_name, title, image_url);
  if (String(company || '').trim() !== String(current.company || '').trim()) await linkCompanyByName(env, ctx, url, id, company);
  await logStageChangeActivity(env, id, current.stage || 'lead', nextStage);
  await syncFollowUpTask(env, ctx, url, id, follow_up_at || null);
  return jres({ ok: true });
}

export async function deleteContact(env, ctx, url, id) {
  const denied = await assertOwned(env, ctx, { table: 'contacts', alias: 'c', id, url });
  if (denied) return denied;
  await env.DB.prepare('DELETE FROM contact_list_members WHERE contact_id=?').bind(id).run();
  await env.DB.prepare("DELETE FROM activity WHERE entity_type='contact' AND entity_id=?").bind(id).run();
  await deleteAttachmentsForEntity(env, 'contact', id);
  await deleteLinksForEntity(env, 'contact', id);
  await ensureContactProfileTable(env);
  await env.DB.prepare('DELETE FROM contact_profiles WHERE contact_id=?').bind(id).run();
  await scopedRun(env, ctx, { sql: 'UPDATE deals SET contact_id=NULL WHERE contact_id=? AND /*SCOPE*/', binds: [id], alias: 'deals', url });
  await scopedRun(env, ctx, { sql: 'DELETE FROM contacts WHERE id=? AND /*SCOPE*/', binds: [id], alias: 'contacts', url });
  return jres({ ok: true });
}

// ── Lists ────────────────────────────────────────────────────

export async function listLists(env, ctx, url) {
  const results = await scopedAll(env, ctx, { sql: 'SELECT l.*,(SELECT COUNT(*) FROM contact_list_members m WHERE m.list_id=l.id) cnt FROM contact_lists l WHERE /*SCOPE*/ ORDER BY l.created_at DESC', alias: 'l', url });
  return jres(results);
}

export async function createList(req, env, ctx) {
  const body = await req.json().catch(() => ({}));
  const { name, description } = body;
  if (!name) return jres({ error: 'Name required' }, 400);
  const tenant = await tenantForCreate(env, ctx, body.customer_id);
  if (tenant.error) return tenant.error;
  const id = uid();
  await scopedInsert(env, ctx, { table: 'contact_lists', row: { id, name, description: description || '', created_at: now() }, requested: tenant.customer_id });
  return jres({ id, name });
}

export async function updateList(req, env, ctx, url, id) {
  const { name, description } = await req.json().catch(() => ({}));
  if (!name) return jres({ error: 'Name required' }, 400);
  const r = await scopedRun(env, ctx, { sql: 'UPDATE contact_lists SET name=?,description=? WHERE id=? AND /*SCOPE*/', binds: [name, description || '', id], alias: 'contact_lists', url });
  if (!r.changes) return jres({ error: 'Not found' }, 404);
  return jres({ ok: true });
}

export async function deleteList(env, ctx, url, id) {
  const denied = await assertOwned(env, ctx, { table: 'contact_lists', alias: 'l', id, url });
  if (denied) return denied;
  await env.DB.prepare('DELETE FROM contact_list_members WHERE list_id=?').bind(id).run();
  await scopedRun(env, ctx, { sql: 'DELETE FROM contact_lists WHERE id=? AND /*SCOPE*/', binds: [id], alias: 'contact_lists', url });
  return jres({ ok: true });
}

export async function getListContacts(env, ctx, url, listId) {
  const denied = await assertOwned(env, ctx, { table: 'contact_lists', alias: 'l', id: listId, url });
  if (denied) return denied;
  const results = await scopedAll(env, ctx, { sql: 'SELECT c.* FROM contacts c JOIN contact_list_members m ON c.id=m.contact_id WHERE m.list_id=? AND /*SCOPE*/', binds: [listId], alias: 'c', url });
  return jres(results);
}

export async function addToList(req, env, ctx, url, listId) {
  const denied = await assertOwned(env, ctx, { table: 'contact_lists', alias: 'l', id: listId, url });
  if (denied) return denied;
  const { contact_ids } = await req.json().catch(() => ({}));
  const ids = (contact_ids || []).map(String).filter(Boolean).slice(0, 5000);
  if (!ids.length) return jres({ ok: true, added: 0 });
  // Only contacts in the same scope may be added — a foreign id is silently dropped.
  const placeholders = ids.map(() => '?').join(',');
  const owned = await scopedAll(env, ctx, { sql: `SELECT c.id FROM contacts c WHERE c.id IN (${placeholders}) AND /*SCOPE*/`, binds: ids, alias: 'c', url });
  let added = 0;
  for (const c of owned) {
    const r = await env.DB.prepare('INSERT OR IGNORE INTO contact_list_members (contact_id,list_id) VALUES (?,?)').bind(c.id, listId).run();
    if (r.meta?.changes) added++;
  }
  return jres({ ok: true, added });
}

export async function removeFromList(env, ctx, url, listId, contactId) {
  const denied = await assertOwned(env, ctx, { table: 'contact_lists', alias: 'l', id: listId, url });
  if (denied) return denied;
  await env.DB.prepare('DELETE FROM contact_list_members WHERE list_id=? AND contact_id=?').bind(listId, contactId).run();
  return jres({ ok: true });
}

// ── Campaigns ────────────────────────────────────────────────

async function campaignSteps(env, campaignId, scope) {
  return scopedAll(env, null, { sql: 'SELECT s.*,t.name tname,t.subject,t.html_body FROM campaign_steps s JOIN templates t ON s.template_id=t.id WHERE s.campaign_id=? AND /*SCOPE*/ ORDER BY s.step_order', binds: [campaignId], alias: 't', scope });
}

export async function listCampaigns(env, ctx, url) {
  const results = await scopedAll(env, ctx, { sql: 'SELECT c.*,l.name list_name FROM campaigns c LEFT JOIN contact_lists l ON c.list_id=l.id WHERE /*SCOPE*/ ORDER BY c.created_at DESC', alias: 'c', url });
  for (const c of results) {
    const steps = await campaignSteps(env, c.id, scopeForRow(c));
    c.steps = steps.map(({ html_body, ...rest }) => rest);
    c.schedule_config = JSON.parse(c.schedule_config || '{}');
  }
  return jres(results);
}

/** The list and every template must belong to the campaign's tenant. */
async function validateCampaignRefs(env, listId, steps, scope) {
  const list = await scopedFirst(env, null, { sql: 'SELECT l.id FROM contact_lists l WHERE l.id=? AND /*SCOPE*/', binds: [listId], alias: 'l', scope });
  if (!list) return 'list_id not found';
  const tids = Array.from(new Set((steps || []).map(s => String(s.template_id || '')).filter(Boolean)));
  if (tids.length) {
    const found = await scopedAll(env, null, { sql: `SELECT t.id FROM templates t WHERE t.id IN (${tids.map(() => '?').join(',')}) AND /*SCOPE*/`, binds: tids, alias: 't', scope });
    if (found.length !== tids.length) return 'one or more template_id not found';
  }
  return null;
}

export async function createCampaign(req, env, ctx) {
  const body = await req.json().catch(() => ({}));
  const { name, list_id, schedule_type, schedule_config, steps, from_email, from_name } = body;
  if (!name || !list_id || !schedule_type || !steps?.length) return jres({ error: 'name, list_id, schedule_type, steps required' }, 400);
  const tenant = await tenantForCreate(env, ctx, body.customer_id);
  if (tenant.error) return tenant.error;
  const bad = await validateCampaignRefs(env, list_id, steps, tenant.scope);
  if (bad) return jres({ error: bad }, 400);
  // A customer's campaigns send as the customer's own identity (resolveSender);
  // from_email/from_name on the row are only honoured for the internal tenant.
  const internal = !tenant.customer_id;
  const id = uid(), ts = now();
  await scopedInsert(env, ctx, {
    table: 'campaigns', requested: tenant.customer_id,
    row: { id, name, list_id, schedule_type, schedule_config: JSON.stringify(schedule_config || {}), status: 'draft', from_email: internal ? (from_email || DEFAULT_FROM) : '', from_name: internal ? (from_name || DEFAULT_NAME) : '', created_at: ts, updated_at: ts },
  });
  for (let i = 0; i < steps.length; i++) {
    await env.DB.prepare('INSERT INTO campaign_steps (id,campaign_id,template_id,step_order,delay_days) VALUES (?,?,?,?,?)').bind(uid(), id, steps[i].template_id, i, steps[i].delay_days || 0).run();
  }
  return jres({ id, name });
}

export async function updateCampaign(req, env, ctx, url, id) {
  const { name, list_id, schedule_type, schedule_config, steps, from_email, from_name } = await req.json().catch(() => ({}));
  const campaign = await scopedFirst(env, ctx, { sql: 'SELECT c.* FROM campaigns c WHERE c.id=? AND /*SCOPE*/', binds: [id], alias: 'c', url });
  if (!campaign) return jres({ error: 'Campaign not found' }, 404);
  const scope = scopeForRow(campaign);
  const bad = await validateCampaignRefs(env, list_id, steps || [], scope);
  if (bad) return jres({ error: bad }, 400);
  const internal = !campaign.customer_id;
  await scopedRun(env, ctx, { sql: 'UPDATE campaigns SET name=?,list_id=?,schedule_type=?,schedule_config=?,from_email=?,from_name=?,updated_at=? WHERE id=? AND /*SCOPE*/', binds: [name, list_id, schedule_type, JSON.stringify(schedule_config || {}), internal ? (from_email || DEFAULT_FROM) : '', internal ? (from_name || DEFAULT_NAME) : '', now(), id], alias: 'campaigns', url });
  if (steps) {
    await env.DB.prepare('DELETE FROM campaign_steps WHERE campaign_id=?').bind(id).run();
    for (let i = 0; i < steps.length; i++) {
      await env.DB.prepare('INSERT INTO campaign_steps (id,campaign_id,template_id,step_order,delay_days) VALUES (?,?,?,?,?)').bind(uid(), id, steps[i].template_id, i, steps[i].delay_days || 0).run();
    }
  }
  return jres({ ok: true });
}

export async function deleteCampaign(env, ctx, url, id) {
  const denied = await assertOwned(env, ctx, { table: 'campaigns', alias: 'c', id, url });
  if (denied) return denied;
  await env.DB.prepare('DELETE FROM campaign_steps WHERE campaign_id=?').bind(id).run();
  await env.DB.prepare('DELETE FROM drip_progress WHERE campaign_id=?').bind(id).run();
  await scopedRun(env, ctx, { sql: 'DELETE FROM campaigns WHERE id=? AND /*SCOPE*/', binds: [id], alias: 'campaigns', url });
  return jres({ ok: true });
}

export async function setCampaignStatus(env, ctx, url, id, status) {
  const r = await scopedRun(env, ctx, { sql: 'UPDATE campaigns SET status=?,updated_at=? WHERE id=? AND /*SCOPE*/', binds: [status, now(), id], alias: 'campaigns', url });
  if (!r.changes) return jres({ error: 'Campaign not found' }, 404);
  return jres({ ok: true });
}

// ── Sending ──────────────────────────────────────────────────

async function addLog(env, campaign, d) {
  // Direct insert: customer_id is set explicitly from the campaign (checker ALLOW).
  await env.DB.prepare('INSERT INTO sent_log (id,campaign_id,campaign_name,contact_id,contact_email,template_id,template_name,subject,status,error,sent_at,customer_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').bind(uid(), d.campaign_id, d.campaign_name, d.contact_id, d.contact_email, d.template_id, d.template_name, d.subject, d.status, d.error || null, now(), campaign.customer_id || null).run();
  if (d.status === 'sent' && d.contact_id) {
    await scopedRun(env, null, { sql: 'UPDATE contacts SET last_contacted_at=? WHERE id=? AND /*SCOPE*/', binds: [now(), d.contact_id], alias: 'contacts', scope: scopeForRow(campaign) });
  }
}

// A Cintelis campaign goes out from the From address set on the campaign; resolveSender alone
// gave every one of them the default identity, and the campaign's own field was never used.
// A customer's campaign keeps its organisation's sending identity, which it cannot override.
async function resolveCampaignSender(env, campaign) {
  const sender = await resolveSender(env, campaign.customer_id || null);
  if (!sender.ok || campaign.customer_id) return sender;
  const fromEmail = String(campaign.from_email || '').trim();
  if (!fromEmail) return sender;
  return { ...sender, from_email: fromEmail, from_name: String(campaign.from_name || '').trim() || fromEmail };
}

/** Send the first step of a campaign to its list. Runs under the campaign's tenant. */
async function sendCampaignNow(env, campaign) {
  const scope = scopeForRow(campaign);
  const sender = await resolveCampaignSender(env, campaign);
  if (!sender.ok) return { error: sender.error, status: 400 };
  const steps = await campaignSteps(env, campaign.id, scope);
  const step = steps[0];
  if (!step) return { error: 'No steps configured', status: 400 };
  const contacts = await scopedAll(env, null, { sql: 'SELECT c.* FROM contacts c JOIN contact_list_members m ON c.id=m.contact_id WHERE m.list_id=? AND /*SCOPE*/', binds: [campaign.list_id], alias: 'c', scope });
  let sent = 0, failed = 0, skipped = 0;
  for (const contact of contacts) {
    const r = await sendEmail(env, { to: contact.email, subject: merge(step.subject, contact), html_body: merge(step.html_body, contact), from_email: sender.from_email, from_name: sender.from_name, transport: sender.transport });
    const status = r.ok ? 'sent' : r.skipped ? 'skipped' : 'failed';
    await addLog(env, campaign, { campaign_id: campaign.id, campaign_name: campaign.name, contact_id: contact.id, contact_email: contact.email, template_id: step.template_id, template_name: step.tname, subject: merge(step.subject, contact), status, error: r.error });
    if (r.ok) sent++; else if (r.skipped) skipped++; else failed++;
  }
  await scopedRun(env, null, { sql: 'UPDATE campaigns SET status=?,updated_at=? WHERE id=? AND /*SCOPE*/', binds: ['completed', now(), campaign.id], alias: 'campaigns', scope });
  return { sent, failed, skipped };
}

export async function sendNow(env, ctx, url, id) {
  const campaign = await scopedFirst(env, ctx, { sql: 'SELECT c.* FROM campaigns c WHERE c.id=? AND /*SCOPE*/', binds: [id], alias: 'c', url });
  if (!campaign) return jres({ error: 'Campaign not found' }, 404);
  const r = await sendCampaignNow(env, campaign);
  if (r.error) return jres({ error: r.error }, r.status || 400);
  return jres(r);
}

// ── Logs / unsubscribes ──────────────────────────────────────

export async function getLogs(env, ctx, url) {
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '200'), 500);
  const results = await scopedAll(env, ctx, { sql: 'SELECT s.* FROM sent_log s WHERE /*SCOPE*/ ORDER BY s.sent_at DESC LIMIT ?', binds: [limit], alias: 's', url });
  return jres(results);
}

export async function getUnsubscribes(env, ctx, url) {
  // The KV suppression list is global (owned by the email worker); a customer
  // only sees entries that are their own contacts.
  if (!env.UNSUBSCRIBES) return jres({ error: 'UNSUBSCRIBES KV binding not configured' }, 500);
  const list = await env.UNSUBSCRIBES.list({ prefix: 'unsub:' });
  const records = [];
  for (const key of list.keys) {
    const raw = await env.UNSUBSCRIBES.get(key.name);
    if (raw) {
      try { records.push(JSON.parse(raw)); } catch { records.push({ email: key.name.replace('unsub:', '') }); }
    }
  }
  let visible = records;
  if (isCustomerScope(resolveScope(ctx, url))) {
    const own = await scopedAll(env, ctx, { sql: 'SELECT c.email FROM contacts c WHERE /*SCOPE*/', alias: 'c', url });
    const mine = new Set(own.map(r => String(r.email || '').toLowerCase()));
    visible = records.filter(r => mine.has(String(r.email || '').toLowerCase()));
  }
  visible.sort((a, b) => (b.unsubscribedAt || '').localeCompare(a.unsubscribedAt || ''));
  return jres(visible);
}

// ── Scheduler (cron; no session) ─────────────────────────────

export async function runScheduler(env) {
  const ts = now();
  // ALL_SCOPE: the cron walks every tenant's due campaigns; each campaign's
  // work below runs under that campaign's own tenant (scopeForRow).
  const A = { alias: 'c', scope: ALL_SCOPE };
  const once = await scopedAll(env, null, { ...A, sql: "SELECT c.* FROM campaigns c WHERE c.schedule_type='once' AND c.status='active' AND json_extract(c.schedule_config,'$.send_at')<=? AND /*SCOPE*/", binds: [ts] });
  for (const c of once) {
    const r = await sendCampaignNow(env, c);
    if (r.error) console.error(`scheduler: campaign ${c.id} not sent: ${r.error}`);
  }
  const rec = await scopedAll(env, null, { ...A, sql: "SELECT c.* FROM campaigns c WHERE c.schedule_type='recurring' AND c.status='active' AND json_extract(c.schedule_config,'$.next_run')<=? AND /*SCOPE*/", binds: [ts] });
  for (const c of rec) {
    const r = await sendCampaignNow(env, c);
    if (r.error) { console.error(`scheduler: campaign ${c.id} not sent: ${r.error}`); continue; }
    const cfg = JSON.parse(c.schedule_config || '{}');
    cfg.next_run = new Date(Date.now() + (cfg.interval_days || 7) * 86400000).toISOString();
    await scopedRun(env, null, { sql: 'UPDATE campaigns SET schedule_config=?,status=?,updated_at=? WHERE id=? AND /*SCOPE*/', binds: [JSON.stringify(cfg), 'active', now(), c.id], alias: 'campaigns', scope: scopeForRow(c) });
  }
  const drips = await scopedAll(env, null, { ...A, sql: "SELECT c.* FROM campaigns c WHERE c.schedule_type='drip' AND c.status='active' AND /*SCOPE*/" });
  for (const c of drips) await processDrip(env, c, ts);
}

async function processDrip(env, campaign, ts) {
  const scope = scopeForRow(campaign);
  const sender = await resolveCampaignSender(env, campaign);
  if (!sender.ok) { console.error(`scheduler: drip ${campaign.id} not sent: ${sender.error}`); return; }
  const contacts = await scopedAll(env, null, { sql: 'SELECT c.* FROM contacts c JOIN contact_list_members m ON c.id=m.contact_id WHERE m.list_id=? AND /*SCOPE*/', binds: [campaign.list_id], alias: 'c', scope });
  const steps = await campaignSteps(env, campaign.id, scope);
  if (!steps.length) return;
  for (const contact of contacts) {
    let prog = await env.DB.prepare('SELECT * FROM drip_progress WHERE campaign_id=? AND contact_id=?').bind(campaign.id, contact.id).first();
    if (!prog) {
      await env.DB.prepare('INSERT INTO drip_progress (id,campaign_id,contact_id,current_step,last_sent_at,next_send_at,completed) VALUES (?,?,?,0,?,?,0)').bind(uid(), campaign.id, contact.id, ts, ts).run();
      prog = { current_step: 0, next_send_at: ts, completed: 0 };
    }
    if (prog.completed || prog.next_send_at > ts) continue;
    const step = steps[prog.current_step];
    if (!step) { await env.DB.prepare('UPDATE drip_progress SET completed=1 WHERE campaign_id=? AND contact_id=?').bind(campaign.id, contact.id).run(); continue; }
    const r = await sendEmail(env, { to: contact.email, subject: merge(step.subject, contact), html_body: merge(step.html_body, contact), from_email: sender.from_email, from_name: sender.from_name, transport: sender.transport });
    const status = r.ok ? 'sent' : r.skipped ? 'skipped' : 'failed';
    await addLog(env, campaign, { campaign_id: campaign.id, campaign_name: campaign.name, contact_id: contact.id, contact_email: contact.email, template_id: step.template_id, template_name: step.tname, subject: merge(step.subject, contact), status, error: r.error });
    if (r.skipped) {
      await env.DB.prepare('UPDATE drip_progress SET completed=1 WHERE campaign_id=? AND contact_id=?').bind(campaign.id, contact.id).run();
      continue;
    }
    const nextIdx = prog.current_step + 1;
    const nextStep = steps[nextIdx];
    const nextSend = nextStep ? new Date(Date.now() + (nextStep.delay_days || 1) * 86400000).toISOString() : null;
    await env.DB.prepare('UPDATE drip_progress SET current_step=?,last_sent_at=?,next_send_at=?,completed=? WHERE campaign_id=? AND contact_id=?').bind(nextIdx, ts, nextSend, nextStep ? 0 : 1, campaign.id, contact.id).run();
  }
}

// ── Pipeline views ───────────────────────────────────────────

export async function getCrmPipeline(env, ctx, url) {
  const results = await scopedAll(env, ctx, { sql: 'SELECT c.*, u.display_name AS owner_name FROM contacts c LEFT JOIN users u ON u.id = c.owner_user_id WHERE c.unsubscribed=0 AND /*SCOPE*/ ORDER BY c.last_contacted_at DESC NULLS LAST, c.created_at DESC', alias: 'c', url });
  const pipeline = {};
  for (const s of STAGES) pipeline[s] = [];
  for (const c of results) {
    const s = STAGES.includes(c.stage) ? c.stage : 'lead';
    try { c.tags = JSON.parse(c.tags || '[]'); } catch { c.tags = []; }
    pipeline[s].push(c);
  }
  return jres(pipeline);
}

export async function getCrmStats(env, ctx, url) {
  const results = await scopedAll(env, ctx, { sql: 'SELECT c.stage, COUNT(*) cnt, COALESCE(SUM(c.deal_value),0) value FROM contacts c WHERE c.unsubscribed=0 AND /*SCOPE*/ GROUP BY c.stage', alias: 'c', url });
  const stats = {};
  for (const s of STAGES) stats[s] = { count: 0, value: 0 };
  for (const r of results) { if (stats[r.stage]) { stats[r.stage].count = r.cnt; stats[r.stage].value = r.value; } }
  const today = new Date().toISOString().split('T')[0];
  // followups_due drives the Tasks nav badge: open tasks overdue or due today.
  const fu = await scopedFirst(env, ctx, { sql: 'SELECT COUNT(*) n FROM crm_tasks t WHERE t.done_at IS NULL AND t.due_at<=? AND /*SCOPE*/', binds: [today + 'T23:59:59Z'], alias: 't', url });
  return jres({ stages: stats, followups_due: fu ? fu.n : 0 });
}

export async function getFollowUps(env, ctx, url) {
  const today = new Date().toISOString().split('T')[0];
  const results = await scopedAll(env, ctx, { sql: 'SELECT c.* FROM contacts c WHERE c.unsubscribed=0 AND c.follow_up_at<=? AND c.stage NOT IN ("won","lost") AND /*SCOPE*/ ORDER BY c.follow_up_at ASC', binds: [today + 'T23:59:59Z'], alias: 'c', url });
  for (const c of results) { try { c.tags = JSON.parse(c.tags || '[]'); } catch { c.tags = []; } }
  return jres(results);
}

export async function getContactDetail(env, ctx, url, id) {
  await ensureContactProfileTable(env);
  const contact = await scopedFirst(env, ctx, { sql: `SELECT c.*, COALESCE(p.first_name,'') first_name, COALESCE(p.last_name,'') last_name, COALESCE(p.title,'') title, COALESCE(p.image_url,'') image_url FROM contacts c LEFT JOIN contact_profiles p ON p.contact_id=c.id WHERE c.id=? AND /*SCOPE*/`, binds: [id], alias: 'c', url });
  if (!contact) return jres({ error: 'Not found' }, 404);
  try { contact.tags = JSON.parse(contact.tags || '[]'); } catch { contact.tags = []; }
  const { results: notesRaw } = await env.DB.prepare(
    `SELECT id, entity_id, body_md, kind, created_at FROM activity WHERE entity_type='contact' AND entity_id=? ORDER BY created_at DESC`
  ).bind(id).all();
  const notes = (notesRaw || []).map(reshapeActivityAsNote);
  const emails = await scopedAll(env, ctx, { sql: 'SELECT s.* FROM sent_log s WHERE s.contact_id=? AND /*SCOPE*/ ORDER BY s.sent_at DESC LIMIT 50', binds: [id], alias: 's', url });
  const lists = await scopedAll(env, ctx, { sql: 'SELECT l.name FROM contact_lists l JOIN contact_list_members m ON l.id=m.list_id WHERE m.contact_id=? AND /*SCOPE*/', binds: [id], alias: 'l', url });
  return jres({ contact, notes, emails, lists: lists.map(l => l.name) });
}

// POST /api/crm/contact/:id/email — send one email to the contact from the
// record page, through the tenant's sending identity (a customer's own
// integration, or the Cintelis defaults), logged to sent_log like a campaign
// send so it shows on the timeline with its delivery status.
export async function sendContactEmail(req, env, ctx, url, id) {
  const contact = await scopedFirst(env, ctx, { sql: 'SELECT c.* FROM contacts c WHERE c.id=? AND /*SCOPE*/', binds: [id], alias: 'c', url });
  if (!contact) return jres({ error: 'Not found' }, 404);
  if (contact.unsubscribed) return jres({ error: 'This contact has unsubscribed' }, 400);
  const body = await req.json().catch(() => ({}));
  const subject = String(body.subject || '').trim().slice(0, 300);
  const text = String(body.body || '').trim().slice(0, 20000);
  if (!subject) return jres({ error: 'subject required' }, 400);
  if (!text) return jres({ error: 'message required' }, 400);
  const sender = await resolveSender(env, contact.customer_id || null);
  if (!sender.ok) return jres({ error: sender.error }, 400);
  const html = body.html ? text : `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#172B4D">${text.split(/\n{2,}/).map(p => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('')}</div>`;
  // Merge tags apply to the subject as well as the body; the subject was sent and logged raw.
  const mergedSubject = merge(subject, contact);
  const r = await sendEmail(env, { to: contact.email, subject: mergedSubject, html_body: merge(html, contact), from_email: sender.from_email, from_name: sender.from_name, transport: sender.transport });
  const status = r.ok ? 'sent' : r.skipped ? 'skipped' : 'failed';
  const senderName = ctx && ctx.user ? (ctx.user.display_name || ctx.user.email) : '';
  await addLog(env, { customer_id: contact.customer_id || null }, { campaign_id: null, campaign_name: senderName ? `Sent by ${senderName}` : 'One-off email', contact_id: contact.id, contact_email: contact.email, template_id: null, template_name: null, subject: mergedSubject, status, error: r.error });
  if (!r.ok) return jres({ error: r.error || 'Send failed', status }, 502);
  return jres({ ok: true, status });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// GET /api/crm/contact/:id/record — everything the record page shows, in one
// call: the contact, a merged timeline (notes, calls, meetings, logged and
// sent emails, stage changes, creation) newest first, and the associations
// for the right rail (people at the same company, lists with membership,
// campaigns that have mailed this contact, attachment count).
export async function getContactRecord(env, ctx, url, id) {
  await ensureContactProfileTable(env);
  const contact = await scopedFirst(env, ctx, { sql: `SELECT c.*, u.display_name AS owner_name, COALESCE(p.first_name,'') first_name, COALESCE(p.last_name,'') last_name, COALESCE(p.title,'') title, COALESCE(p.image_url,'') image_url FROM contacts c LEFT JOIN contact_profiles p ON p.contact_id=c.id LEFT JOIN users u ON u.id=c.owner_user_id WHERE c.id=? AND /*SCOPE*/`, binds: [id], alias: 'c', url });
  if (!contact) return jres({ error: 'Not found' }, 404);
  try { contact.tags = JSON.parse(contact.tags || '[]'); } catch { contact.tags = []; }

  const { results: activity } = await env.DB.prepare(
    `SELECT a.id, a.kind, a.body_md, a.created_at, u.display_name AS by_name
     FROM activity a LEFT JOIN users u ON u.id = a.user_id
     WHERE a.entity_type='contact' AND a.entity_id=? ORDER BY a.created_at DESC LIMIT 500`
  ).bind(id).all();
  const emails = await scopedAll(env, ctx, { sql: 'SELECT s.id, s.campaign_id, s.campaign_name, s.template_name, s.subject, s.status, s.error, s.sent_at FROM sent_log s WHERE s.contact_id=? AND /*SCOPE*/ ORDER BY s.sent_at DESC LIMIT 200', binds: [id], alias: 's', url });

  const timeline = [];
  for (const a of activity || []) {
    timeline.push({ id: a.id, kind: a.kind || 'note', body: a.body_md || '', at: a.created_at, by: a.by_name || '', deletable: a.kind !== 'stage' && a.kind !== 'deal' });
  }
  for (const e of emails) {
    timeline.push({ id: 'sent_' + e.id, kind: 'sent_email', subject: e.subject || '', status: e.status || 'sent', error: e.error || '', campaign: e.campaign_name || '', template: e.template_name || '', at: e.sent_at, deletable: false });
  }
  timeline.push({ id: 'created_' + contact.id, kind: 'created', at: contact.created_at, deletable: false });
  timeline.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));

  const companyContacts = contact.company_id
    ? await scopedAll(env, ctx, { sql: 'SELECT c.id, c.name, c.email, c.stage FROM contacts c WHERE c.company_id=? AND c.id<>? AND /*SCOPE*/ ORDER BY c.name LIMIT 12', binds: [contact.company_id, id], alias: 'c', url })
    : (contact.company
      ? await scopedAll(env, ctx, { sql: 'SELECT c.id, c.name, c.email, c.stage FROM contacts c WHERE c.company=? AND c.id<>? AND /*SCOPE*/ ORDER BY c.name LIMIT 12', binds: [contact.company, id], alias: 'c', url })
      : []);
  const companyRow = contact.company_id
    ? await scopedFirst(env, ctx, { sql: 'SELECT x.id, x.name, x.domain, x.website, x.phone, x.industry FROM companies x WHERE x.id=? AND /*SCOPE*/', binds: [contact.company_id], alias: 'x', url })
    : null;
  const lists = await scopedAll(env, ctx, { sql: 'SELECT l.id, l.name, EXISTS(SELECT 1 FROM contact_list_members m WHERE m.list_id=l.id AND m.contact_id=?) AS member FROM contact_lists l WHERE /*SCOPE*/ ORDER BY l.name', binds: [id], alias: 'l', url });
  const campaigns = [];
  const seen = new Set();
  for (const e of emails) {
    if (!e.campaign_id || seen.has(e.campaign_id)) continue;
    seen.add(e.campaign_id);
    campaigns.push({ id: e.campaign_id, name: e.campaign_name || '', last_sent_at: e.sent_at, status: e.status });
  }
  const att = await env.DB.prepare("SELECT COUNT(*) AS n FROM attachments WHERE entity_type='contact' AND entity_id=?").bind(id).first();
  const tasks = await openTasksForContact(env, ctx, url, id);
  const deals = await dealsForContact(env, ctx, url, id);

  return jres({
    contact,
    tasks,
    deals,
    timeline,
    related: {
      company: companyRow,
      company_contacts: companyContacts,
      lists: lists.map(l => ({ id: l.id, name: l.name, member: Number(l.member) === 1 })),
      campaigns,
      attachment_count: Number(att?.n || 0),
    },
  });
}

export async function patchContact(req, env, ctx, url, id) {
  const body = await req.json().catch(() => ({}));
  const allowed = ['name', 'company', 'stage', 'tags', 'phone', 'linkedin', 'follow_up_at', 'owner_user_id'];
  const current = await scopedFirst(env, ctx, { sql: 'SELECT c.stage, c.company FROM contacts c WHERE c.id=? AND /*SCOPE*/', binds: [id], alias: 'c', url });
  if (!current) return jres({ error: 'Not found' }, 404);
  const fields = [];
  const vals = [];
  for (const k of allowed) {
    if (k in body) {
      fields.push(`${k}=?`);
      vals.push(k === 'tags' ? JSON.stringify(body[k] || []) : body[k]);
    }
  }
  if (!fields.length) return jres({ error: 'No fields to update' }, 400);
  await scopedRun(env, ctx, { sql: `UPDATE contacts SET ${fields.join(',')} WHERE id=? AND /*SCOPE*/`, binds: [...vals, id], alias: 'contacts', url });
  if ('stage' in body) await logStageChangeActivity(env, id, current.stage || 'lead', body.stage || 'lead');
  if ('follow_up_at' in body) await syncFollowUpTask(env, ctx, url, id, body.follow_up_at);
  if ('company' in body && String(body.company || '').trim() !== String(current.company || '').trim()) await linkCompanyByName(env, ctx, url, id, body.company);
  return jres({ ok: true });
}

export async function getNotes(env, ctx, url, contactId) {
  const denied = await assertOwned(env, ctx, { table: 'contacts', alias: 'c', id: contactId, url });
  if (denied) return denied;
  const { results } = await env.DB.prepare(
    `SELECT id, entity_id, body_md, kind, created_at FROM activity WHERE entity_type='contact' AND entity_id=? ORDER BY created_at DESC`
  ).bind(contactId).all();
  return jres((results || []).map(reshapeActivityAsNote));
}

export async function addNote(req, env, ctx, url, contactId) {
  const denied = await assertOwned(env, ctx, { table: 'contacts', alias: 'c', id: contactId, url });
  if (denied) return denied;
  const { content, type } = await req.json().catch(() => ({}));
  if (!content) return jres({ error: 'content required' }, 400);
  const id = uid();
  const ts = now();
  const kind = type || 'note';
  await env.DB.prepare(
    `INSERT INTO activity (id, entity_type, entity_id, user_id, kind, body_md, created_at) VALUES (?, 'contact', ?, ?, ?, ?, ?)`
  ).bind(id, contactId, ctx && ctx.user ? ctx.user.id : null, kind, content, ts).run();
  await bumpNotesCount(env, contactId, +1);
  return jres({ id, content, type: kind, created_at: ts });
}

export async function deleteNote(env, ctx, url, contactId, noteId) {
  const denied = await assertOwned(env, ctx, { table: 'contacts', alias: 'c', id: contactId, url });
  if (denied) return denied;
  // The note must belong to this contact — a note id from another tenant's
  // contact is not deletable through this contact's URL.
  const note = await env.DB.prepare("SELECT entity_id FROM activity WHERE id=? AND entity_type='contact' AND entity_id=?").bind(noteId, contactId).first();
  if (!note) return jres({ error: 'Not found' }, 404);
  await env.DB.prepare("DELETE FROM activity WHERE id=? AND entity_type='contact'").bind(noteId).run();
  await bumpNotesCount(env, contactId, -1);
  return jres({ ok: true });
}
