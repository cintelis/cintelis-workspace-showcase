// CRM tasks and the sales workspace (sprint 13).
//
// crm_tasks is a customer-scoped table (020): every read and write here goes
// through worker/scope.js. A task may belong to a contact; when it does, the
// contact's follow_up_at (the date the board and Follow-ups page show) is kept
// in step with the contact's open "Follow up with …" task, so the two never
// disagree about when someone is next due.

import { scopedAll, scopedFirst, scopedRun, scopedInsert } from './scope.js';

function jres(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
function now() { return new Date().toISOString(); }
function taskId() { return 'tsk_' + crypto.randomUUID().replace(/-/g, '').slice(0, 24); }

export const TASK_TYPES = ['todo', 'call', 'email', 'meeting'];
export const TASK_PRIORITIES = ['low', 'medium', 'high'];

function dayBounds() {
  const d = new Date(); d.setUTCHours(0, 0, 0, 0);
  const start = d.toISOString();
  const end = new Date(d.getTime() + 86400000 - 1).toISOString();
  const week = new Date(d.getTime() + 7 * 86400000).toISOString();
  return { start, end, week };
}

function normaliseDue(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s + 'T00:00:00Z';
  const t = new Date(s);
  return isNaN(t) ? null : t.toISOString();
}

// One statement shape for every task read. The scope marker sits on the same
// line as the table reference (worker/scope.js convention); `where` carries
// the call's extra conditions, `tail` its ORDER BY / LIMIT.
function taskSql(where = '', tail = '') {
  return `SELECT t.*, c.name AS contact_name, c.email AS contact_email, c.company AS contact_company, c.stage AS contact_stage, u.display_name AS owner_name FROM crm_tasks t LEFT JOIN contacts c ON c.id = t.contact_id LEFT JOIN users u ON u.id = t.owner_user_id WHERE /*SCOPE*/ ${where} ${tail}`;
}

// GET /api/crm/tasks?queue=today|overdue|upcoming|open|done&contact_id=&mine=1
export async function listTasks(env, ctx, url) {
  const queue = url.searchParams.get('queue') || 'open';
  const contactId = url.searchParams.get('contact_id') || '';
  const mine = url.searchParams.get('mine') === '1';
  const { start, end, week } = dayBounds();
  let where = '';
  const binds = [];
  if (queue === 'today') { where = ' AND t.done_at IS NULL AND t.due_at >= ? AND t.due_at <= ?'; binds.push(start, end); }
  else if (queue === 'overdue') { where = ' AND t.done_at IS NULL AND t.due_at < ?'; binds.push(start); }
  else if (queue === 'upcoming') { where = ' AND t.done_at IS NULL AND t.due_at > ? AND t.due_at <= ?'; binds.push(end, week); }
  else if (queue === 'done') { where = ' AND t.done_at IS NOT NULL'; }
  else { where = ' AND t.done_at IS NULL'; }
  if (contactId) { where += ' AND t.contact_id = ?'; binds.push(contactId); }
  if (mine && ctx.user) { where += ' AND t.owner_user_id = ?'; binds.push(ctx.user.id); }
  const order = queue === 'done' ? ' ORDER BY t.done_at DESC LIMIT 200' : ' ORDER BY CASE WHEN t.due_at IS NULL THEN 1 ELSE 0 END, t.due_at ASC, t.priority = \'high\' DESC, t.created_at DESC LIMIT 500';
  const rows = await scopedAll(env, ctx, { sql: taskSql(where, order), binds, alias: 't', url });
  return jres({ tasks: rows });
}

export async function openTasksForContact(env, ctx, url, contactId) {
  return scopedAll(env, ctx, { sql: taskSql('AND t.contact_id = ? AND t.done_at IS NULL', 'ORDER BY CASE WHEN t.due_at IS NULL THEN 1 ELSE 0 END, t.due_at ASC'), binds: [contactId], alias: 't', url });
}

function readBody(body) {
  const out = {};
  if ('title' in body) out.title = String(body.title || '').trim().slice(0, 200);
  if ('type' in body) out.type = TASK_TYPES.includes(body.type) ? body.type : 'todo';
  if ('priority' in body) out.priority = TASK_PRIORITIES.includes(body.priority) ? body.priority : 'medium';
  if ('due_at' in body) out.due_at = normaliseDue(body.due_at);
  if ('owner_user_id' in body) out.owner_user_id = body.owner_user_id ? String(body.owner_user_id) : null;
  if ('notes' in body) out.notes = String(body.notes || '').slice(0, 4000);
  if ('contact_id' in body) out.contact_id = body.contact_id ? String(body.contact_id) : null;
  return out;
}

// POST /api/crm/tasks
export async function createTask(req, env, ctx, url) {
  const body = await req.json().catch(() => ({}));
  const t = readBody(body);
  if (!t.title) return jres({ error: 'title required' }, 400);
  if (t.contact_id) {
    const c = await scopedFirst(env, ctx, { sql: 'SELECT c.id FROM contacts c WHERE c.id=? AND /*SCOPE*/', binds: [t.contact_id], alias: 'c', url });
    if (!c) return jres({ error: 'Contact not found' }, 404);
  }
  const id = taskId();
  const ts = now();
  await scopedInsert(env, ctx, {
    table: 'crm_tasks',
    row: {
      id, contact_id: t.contact_id || null, title: t.title, type: t.type || 'todo', priority: t.priority || 'medium',
      due_at: t.due_at || null, done_at: null, owner_user_id: t.owner_user_id || (ctx.user ? ctx.user.id : null),
      notes: t.notes || '', created_by: ctx.user ? ctx.user.id : null, created_at: ts, updated_at: ts,
    },
    requested: body.customer_id,
  });
  if (t.contact_id && t.due_at && isFollowUpTitle(t.title)) await setContactFollowUp(env, ctx, url, t.contact_id, t.due_at);
  const row = await scopedFirst(env, ctx, { sql: taskSql('AND t.id=?'), binds: [id], alias: 't', url });
  return jres({ task: row }, 201);
}

// PATCH /api/crm/tasks/:id  — fields, or { done: true|false }
export async function patchTask(req, env, ctx, url, id) {
  const body = await req.json().catch(() => ({}));
  const existing = await scopedFirst(env, ctx, { sql: 'SELECT t.* FROM crm_tasks t WHERE t.id=? AND /*SCOPE*/', binds: [id], alias: 't', url });
  if (!existing) return jres({ error: 'Not found' }, 404);
  const t = readBody(body);
  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(t)) {
    if (k === 'title' && !v) return jres({ error: 'title cannot be empty' }, 400);
    sets.push(`${k}=?`); vals.push(v);
  }
  if ('done' in body) { sets.push('done_at=?'); vals.push(body.done ? now() : null); }
  if (!sets.length) return jres({ error: 'No fields to update' }, 400);
  sets.push('updated_at=?'); vals.push(now());
  await scopedRun(env, ctx, { sql: `UPDATE crm_tasks SET ${sets.join(',')} WHERE id=? AND /*SCOPE*/`, binds: [...vals, id], alias: 'crm_tasks', url });

  // Keep the contact's follow-up date in step with its follow-up task.
  const contactId = t.contact_id !== undefined ? t.contact_id : existing.contact_id;
  const title = t.title !== undefined ? t.title : existing.title;
  if (contactId && isFollowUpTitle(title)) {
    if ('done' in body && body.done) await setContactFollowUp(env, ctx, url, contactId, null);
    else if (t.due_at !== undefined) await setContactFollowUp(env, ctx, url, contactId, t.due_at);
  }
  const row = await scopedFirst(env, ctx, { sql: taskSql('AND t.id=?'), binds: [id], alias: 't', url });
  return jres({ task: row });
}

// DELETE /api/crm/tasks/:id
export async function deleteTask(env, ctx, url, id) {
  const r = await scopedRun(env, ctx, { sql: 'DELETE FROM crm_tasks WHERE id=? AND /*SCOPE*/', binds: [id], alias: 'crm_tasks', url });
  if (!r.changes) return jres({ error: 'Not found' }, 404);
  return jres({ ok: true });
}

function isFollowUpTitle(title) { return /^follow[- ]?up\b/i.test(String(title || '')); }

async function setContactFollowUp(env, ctx, url, contactId, dueAt) {
  await scopedRun(env, ctx, { sql: 'UPDATE contacts SET follow_up_at=? WHERE id=? AND /*SCOPE*/', binds: [dueAt || null, contactId], alias: 'contacts', url });
}

/**
 * Called by crm.js when a contact's follow_up_at changes through the contact
 * itself (record page, drawer, edit modal): the contact's open follow-up task
 * is moved to the new date, created if there is none, or completed when the
 * date is cleared.
 */
export async function syncFollowUpTask(env, ctx, url, contactId, followUpAt) {
  const open = await scopedFirst(env, ctx, { sql: "SELECT t.id, t.due_at FROM crm_tasks t WHERE t.contact_id=? AND t.done_at IS NULL AND t.title LIKE 'Follow up with %' AND /*SCOPE*/ ORDER BY t.due_at ASC", binds: [contactId], alias: 't', url });
  const ts = now();
  if (!followUpAt) {
    if (open) await scopedRun(env, ctx, { sql: 'UPDATE crm_tasks SET done_at=?, updated_at=? WHERE id=? AND /*SCOPE*/', binds: [ts, ts, open.id], alias: 'crm_tasks', url });
    return;
  }
  const due = normaliseDue(followUpAt);
  if (open) {
    if (open.due_at !== due) await scopedRun(env, ctx, { sql: 'UPDATE crm_tasks SET due_at=?, updated_at=? WHERE id=? AND /*SCOPE*/', binds: [due, ts, open.id], alias: 'crm_tasks', url });
    return;
  }
  const c = await scopedFirst(env, ctx, { sql: 'SELECT c.name, c.email, c.customer_id FROM contacts c WHERE c.id=? AND /*SCOPE*/', binds: [contactId], alias: 'c', url });
  if (!c) return;
  await scopedInsert(env, ctx, {
    table: 'crm_tasks',
    row: { id: taskId(), contact_id: contactId, title: `Follow up with ${c.name || c.email}`, type: 'todo', priority: 'medium', due_at: due, done_at: null, owner_user_id: ctx && ctx.user ? ctx.user.id : null, notes: '', created_by: ctx && ctx.user ? ctx.user.id : null, created_at: ts, updated_at: ts },
    requested: c.customer_id,
  });
}

// GET /api/crm/workspace — the sales home: task counters, guided actions,
// today's list and a recent feed. One call, all scoped.
export async function getWorkspace(env, ctx, url) {
  const { start, end, week } = dayBounds();
  const uid = ctx.user ? ctx.user.id : null;
  const counts = await scopedFirst(env, ctx, {
    sql: `SELECT
      SUM(CASE WHEN t.done_at IS NULL THEN 1 ELSE 0 END) AS open,
      SUM(CASE WHEN t.done_at IS NULL AND t.priority='high' THEN 1 ELSE 0 END) AS high,
      SUM(CASE WHEN t.done_at IS NULL AND t.due_at < ? THEN 1 ELSE 0 END) AS overdue,
      SUM(CASE WHEN t.done_at IS NULL AND t.due_at >= ? AND t.due_at <= ? THEN 1 ELSE 0 END) AS today,
      SUM(CASE WHEN t.done_at IS NULL AND t.type='todo' THEN 1 ELSE 0 END) AS todos,
      SUM(CASE WHEN t.done_at IS NULL AND t.type='call' THEN 1 ELSE 0 END) AS calls,
      SUM(CASE WHEN t.done_at IS NULL AND t.type='email' THEN 1 ELSE 0 END) AS emails,
      SUM(CASE WHEN t.done_at IS NULL AND t.type='meeting' THEN 1 ELSE 0 END) AS meetings,
      SUM(CASE WHEN t.done_at IS NULL AND t.owner_user_id = ? THEN 1 ELSE 0 END) AS mine
     FROM crm_tasks t WHERE /*SCOPE*/`,
    binds: [start, start, end, uid], alias: 't', url,
  });
  const todayList = await scopedAll(env, ctx, { sql: taskSql('AND t.done_at IS NULL AND t.due_at <= ?', 'ORDER BY t.due_at ASC LIMIT 25'), binds: [end], alias: 't', url });
  const upcoming = await scopedAll(env, ctx, { sql: taskSql('AND t.done_at IS NULL AND t.due_at > ? AND t.due_at <= ?', 'ORDER BY t.due_at ASC LIMIT 15'), binds: [end, week], alias: 't', url });

  // Guided actions — simple rules over the data we already keep.
  const d7 = new Date(Date.now() - 7 * 86400000).toISOString();
  const d14 = new Date(Date.now() - 14 * 86400000).toISOString();
  const staleLeads = await scopedAll(env, ctx, { sql: `SELECT c.id, c.name, c.email, c.company, c.stage, c.created_at, c.last_contacted_at FROM contacts c WHERE c.unsubscribed=0 AND c.stage IN ('lead','prospect') AND c.created_at < ? AND (c.last_contacted_at IS NULL OR c.last_contacted_at < ?) AND NOT EXISTS (SELECT 1 FROM crm_tasks t WHERE t.contact_id=c.id AND t.done_at IS NULL) AND /*SCOPE*/ ORDER BY c.created_at DESC LIMIT 8`, binds: [d7, d14], alias: 'c', url });
  const quietProposals = await scopedAll(env, ctx, { sql: `SELECT c.id, c.name, c.email, c.company, c.deal_value, c.last_contacted_at FROM contacts c WHERE c.unsubscribed=0 AND c.stage IN ('qualified','proposal') AND (c.last_contacted_at IS NULL OR c.last_contacted_at < ?) AND NOT EXISTS (SELECT 1 FROM crm_tasks t WHERE t.contact_id=c.id AND t.done_at IS NULL) AND /*SCOPE*/ ORDER BY c.deal_value DESC LIMIT 8`, binds: [d7], alias: 'c', url });
  const newLeads = await scopedAll(env, ctx, { sql: `SELECT c.id, c.name, c.email, c.company, c.created_at FROM contacts c WHERE c.unsubscribed=0 AND c.stage='lead' AND c.created_at >= ? AND c.last_contacted_at IS NULL AND c.notes_count = 0 AND /*SCOPE*/ ORDER BY c.created_at DESC LIMIT 8`, binds: [d7], alias: 'c', url });
  const bounced = await scopedAll(env, ctx, { sql: `SELECT s.contact_id AS id, s.contact_email AS email, s.subject, s.error, s.sent_at FROM sent_log s WHERE s.status='failed' AND s.sent_at >= ? AND s.contact_id IS NOT NULL AND /*SCOPE*/ ORDER BY s.sent_at DESC LIMIT 8`, binds: [d7], alias: 's', url });

  // Deal-aware rules (sprint 16). Items carry kind:'deal' so the workspace opens the deal.
  const todayDate = start.slice(0, 10);
  const d30 = new Date(Date.now() - 30 * 86400000).toISOString();
  const pastDueDeals = await scopedAll(env, ctx, { sql: `SELECT d.id, d.name, d.amount, d.close_date, c.name AS contact_name, x.name AS company_name FROM deals d LEFT JOIN contacts c ON c.id=d.contact_id LEFT JOIN companies x ON x.id=d.company_id WHERE d.stage NOT IN ('won','lost') AND d.close_date IS NOT NULL AND d.close_date < ? AND /*SCOPE*/ ORDER BY d.close_date ASC LIMIT 8`, binds: [todayDate], alias: 'd', url });
  const quietDeals = await scopedAll(env, ctx, { sql: `SELECT d.id, d.name, d.amount, d.stage, d.updated_at, c.name AS contact_name, x.name AS company_name FROM deals d LEFT JOIN contacts c ON c.id=d.contact_id LEFT JOIN companies x ON x.id=d.company_id WHERE d.stage IN ('proposal','negotiation') AND d.updated_at < ? AND (d.contact_id IS NULL OR NOT EXISTS (SELECT 1 FROM crm_tasks t WHERE t.contact_id=d.contact_id AND t.done_at IS NULL)) AND /*SCOPE*/ ORDER BY d.amount DESC LIMIT 8`, binds: [d7], alias: 'd', url });
  const wonNoTask = await scopedAll(env, ctx, { sql: `SELECT d.id, d.name, d.amount, d.closed_at, c.name AS contact_name, x.name AS company_name FROM deals d LEFT JOIN contacts c ON c.id=d.contact_id LEFT JOIN companies x ON x.id=d.company_id WHERE d.stage='won' AND d.closed_at >= ? AND d.contact_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM crm_tasks t WHERE t.contact_id=d.contact_id AND t.done_at IS NULL) AND /*SCOPE*/ ORDER BY d.closed_at DESC LIMIT 8`, binds: [d30], alias: 'd', url });
  const asDeal = (rows) => rows.map(r => ({ ...r, kind: 'deal', name: r.name, email: '', company: r.company_name || '', deal_value: r.amount }));

  const actions = [];
  if (pastDueDeals.length) actions.push({ key: 'past_due_deals', title: 'Deals past their expected close', detail: `${pastDueDeals.length} open deal${pastDueDeals.length === 1 ? '' : 's'} slipped past the close date — move the date or close them out.`, cta: 'Review deal', contacts: asDeal(pastDueDeals) });
  if (quietDeals.length) actions.push({ key: 'quiet_deals', title: 'Proposals with no movement', detail: `${quietDeals.length} deal${quietDeals.length === 1 ? '' : 's'} in proposal or negotiation untouched for 7 days and no task set.`, cta: 'Follow up', contacts: asDeal(quietDeals) });
  if (newLeads.length) actions.push({ key: 'new_leads', title: 'Make first contact with new leads', detail: `${newLeads.length} lead${newLeads.length === 1 ? '' : 's'} arrived this week and nobody has reached out yet.`, cta: 'Reach out', contacts: newLeads });
  if (quietProposals.length) actions.push({ key: 'quiet_proposals', title: 'Chase contacts that have gone quiet', detail: `${quietProposals.length} qualified or proposal-stage contact${quietProposals.length === 1 ? '' : 's'} with no contact in 7 days and no task set.`, cta: 'Follow up', contacts: quietProposals });
  if (staleLeads.length) actions.push({ key: 'stale_leads', title: 'Re-engage leads going cold', detail: `${staleLeads.length} lead${staleLeads.length === 1 ? '' : 's'} older than a week with no contact in 14 days.`, cta: 'Follow up', contacts: staleLeads });
  if (wonNoTask.length) actions.push({ key: 'won_onboarding', title: 'Recently won — schedule the next step', detail: `${wonNoTask.length} deal${wonNoTask.length === 1 ? '' : 's'} won in the last 30 days with no task on the contact.`, cta: 'Add task', contacts: asDeal(wonNoTask) });
  if (bounced.length) actions.push({ key: 'bounced', title: 'Fix addresses that bounced', detail: `${bounced.length} campaign email${bounced.length === 1 ? '' : 's'} failed this week.`, cta: 'Review', contacts: bounced });

  // Feed: the latest activity across this tenant's contacts. activity itself
  // is not scoped; the join to contacts is where the tenant predicate applies.
  const activity = await scopedAll(env, ctx, { sql: `SELECT a.id, a.kind, a.body_md, a.created_at, a.entity_id AS contact_id, u.display_name AS by_name, c.name AS contact_name, c.email AS contact_email FROM activity a JOIN contacts c ON c.id=a.entity_id LEFT JOIN users u ON u.id=a.user_id WHERE a.entity_type='contact' AND /*SCOPE*/ ORDER BY a.created_at DESC LIMIT 25`, alias: 'c', url });
  const feed = activity.map(a => ({ id: a.id, kind: a.kind, body: a.body_md, at: a.created_at, by: a.by_name || '', contact_id: a.contact_id, contact_name: a.contact_name || a.contact_email }));

  return jres({
    counts: {
      open: Number(counts?.open || 0), high: Number(counts?.high || 0), overdue: Number(counts?.overdue || 0), today: Number(counts?.today || 0),
      todos: Number(counts?.todos || 0), calls: Number(counts?.calls || 0), emails: Number(counts?.emails || 0), meetings: Number(counts?.meetings || 0), mine: Number(counts?.mine || 0),
    },
    today: todayList,
    upcoming,
    actions,
    feed,
  });
}
