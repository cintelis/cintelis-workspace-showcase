// Customer scoping — the single way a scoped table is read or written.
//
// THE PROBLEM THIS EXISTS TO SOLVE.
// Tenancy here is opt-in: customer_id is nullable, NULL means Cintelis, and a
// query with no customer filter returns every customer's rows. Nothing in the
// schema stops that. Repeat the WHERE clause by hand in forty handlers and one
// of them will eventually be written without it — and on `contacts` that is a
// customer's entire prospect list, which is both PII and the most commercially
// sensitive thing they have given us.
//
// So the filter is not something a handler remembers. Every scoped statement
// carries the literal token /*SCOPE*/ where its predicate belongs, and this
// module refuses to run a statement that lacks one. Forgetting is then a loud
// throw in development rather than a silent leak in production.
//
// WHAT IT DELIBERATELY DOES NOT DO.
// It does not parse SQL or guess where the predicate goes. Placement is the
// caller's job because only the caller knows the alias and the join shape; the
// guarantee offered here is narrower and therefore keepable: a scoped statement
// without a scope marker does not execute.

// Self-contained, like the other worker modules: jres is redefined here rather
// than imported, to avoid the circular imports customers.js warns about.
function jres(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Tables whose rows belong to a customer. A read of any of these outside this
 * module is a bug — `npm run check:scoping` greps for exactly that.
 */
export const SCOPED_TABLES = new Set([
  // 018
  'projects', 'doc_spaces', 'api_tokens', 'integrations',
  // 019
  'contacts', 'contact_lists', 'templates', 'campaigns', 'sent_log',
  // 020
  'crm_tasks',
  // 021
  'companies',
  // 022
  'deals',
  // 023
  'xero_invoices',
]);

const SCOPE_TOKEN = '/*SCOPE*/';

/**
 * Who is asking, and what they may see.
 *
 *   mode 'customer' — a client's own user. Their customer_id, always, and it is
 *                     read from the session and never from the request. A URL
 *                     or body parameter cannot widen it; that is the whole
 *                     point of resolving scope here rather than per handler.
 *   mode 'internal' — staff who asked for Cintelis's own rows (?customer_id=internal),
 *                     or staff on a screen that is ours by nature.
 *   mode 'one'      — staff narrowing to a single customer (?customer_id=cus_...).
 *   mode 'all'      — staff, unfiltered. The only mode that emits no predicate,
 *                     and it is unreachable for a customer user.
 */
export function resolveScope(ctx, url = null) {
  const own = ctx && ctx.user && ctx.user.customer_id;
  if (own) return { mode: 'customer', customerId: own };

  const asked = url && url.searchParams ? (url.searchParams.get('customer_id') || '').trim() : '';
  if (asked === 'internal') return { mode: 'internal', customerId: null };
  if (asked) return { mode: 'one', customerId: asked };
  return { mode: 'all', customerId: null };
}

/** True when this session belongs to a client rather than to Cintelis. */
export const isCustomerScope = (scope) => scope.mode === 'customer';

/**
 * The predicate for a scope, and the binds that go with it.
 *
 * `alias` is the table or alias the customer_id column hangs off — 'c' for
 * `contacts c`, 'p' for `projects p`. Passing the wrong one produces a SQL
 * error rather than a wrong answer, which is the failure direction we want.
 */
function predicate(scope, alias) {
  const col = `${alias}.customer_id`;
  switch (scope.mode) {
    case 'customer':
    case 'one':
      return { clause: `${col} = ?`, binds: [scope.customerId] };
    case 'internal':
      return { clause: `${col} IS NULL`, binds: [] };
    case 'all':
      // Staff, unfiltered. 1=1 rather than an empty string so the surrounding
      // SQL keeps its shape whatever the mode — a caller writing
      // "WHERE /*SCOPE*/ AND x = ?" stays valid instead of becoming "WHERE AND".
      return { clause: '1=1', binds: [] };
    default:
      throw new Error(`scope: unknown mode ${scope.mode}`);
  }
}

/**
 * Substitutes the scope marker and interleaves the binds.
 *
 * Binds are positional in SQLite, so the scope's binds have to land in the
 * order the markers appear. `before` counts the placeholders preceding the
 * token in the SQL, and the scope's binds are spliced in at that point.
 */
function apply(sql, scope, alias, binds) {
  const at = sql.indexOf(SCOPE_TOKEN);
  if (at === -1) {
    throw new Error(
      'scope: statement has no /*SCOPE*/ marker. Every read or write of a ' +
      'customer-owned table must say where its customer predicate goes. If the ' +
      'statement genuinely touches no scoped table, use env.DB directly.',
    );
  }
  if (sql.indexOf(SCOPE_TOKEN, at + 1) !== -1) {
    throw new Error('scope: more than one /*SCOPE*/ marker; split the query instead.');
  }
  const { clause, binds: scopeBinds } = predicate(scope, alias);
  const before = (sql.slice(0, at).match(/\?/g) || []).length;
  return {
    sql: sql.replace(SCOPE_TOKEN, clause),
    binds: [...binds.slice(0, before), ...scopeBinds, ...binds.slice(before)],
  };
}

function prep(env, ctx, opts) {
  const { sql, binds = [], alias, url = null, scope = null } = opts;
  if (!alias) throw new Error('scope: alias is required so the predicate knows its table.');
  const s = scope || resolveScope(ctx, url);
  const built = apply(sql, s, alias, binds);
  return env.DB.prepare(built.sql).bind(...built.binds);
}

/** Rows. */
export async function scopedAll(env, ctx, opts) {
  const { results } = await prep(env, ctx, opts).all();
  return results || [];
}

/** One row, or null. */
export async function scopedFirst(env, ctx, opts) {
  return (await prep(env, ctx, opts).first()) || null;
}

/**
 * UPDATE and DELETE.
 *
 * Writes need this every bit as much as reads: without the predicate a client
 * user could update a row belonging to another customer by guessing its id.
 * Returns the D1 meta so a caller can tell "not yours" (0 changes) from "not
 * found", which are the same HTTP answer but different log lines.
 */
export async function scopedRun(env, ctx, opts) {
  const res = await prep(env, ctx, opts).run();
  return { changes: res.meta?.changes ?? 0, meta: res.meta };
}

/**
 * Guard for a write whose target is addressed by id.
 *
 * Reads the row's owner through the same scope and answers with a Response when
 * the caller may not touch it. 404 rather than 403 deliberately: telling a
 * client that a row exists but belongs to someone else is itself a disclosure.
 */
export async function assertOwned(env, ctx, { table, alias = 't', id, url = null }) {
  if (!SCOPED_TABLES.has(table)) throw new Error(`scope: ${table} is not a scoped table.`);
  const row = await scopedFirst(env, ctx, {
    sql: `SELECT ${alias}.id FROM ${table} ${alias} WHERE ${alias}.id = ? AND /*SCOPE*/`,
    binds: [id],
    alias,
    url,
  });
  return row ? null : jres({ error: 'Not found' }, 404);
}

/**
 * The customer_id a new row should carry.
 *
 * Mirrors customerIdForCreate() in customers.js and defers to it for validating
 * a staff-supplied id; the rule that matters is the first line — a client user
 * gets their own id and whatever the request asked for is ignored.
 */
export function customerIdForInsert(ctx, requested) {
  const own = ctx && ctx.user && ctx.user.customer_id;
  if (own) return own;
  const want = String(requested || '').trim();
  return want || null;
}

/**
 * Explicit scopes for code paths that have no session.
 *
 *   ALL_SCOPE      — the cron scheduler walking every tenant's campaigns, or a
 *                    lookup whose ownership was already established by the
 *                    caller (assertOwned / enforceCustomerScope). Say why in a
 *                    comment at the call site; "all" is never the lazy default.
 *   INTERNAL_SCOPE — Cintelis's own rows, e.g. seed data or an internal API token.
 *   scopeForRow    — the tenant a row belongs to, for work done on that row's
 *                    behalf (a campaign's contacts, its sent_log entries).
 */
export const ALL_SCOPE = Object.freeze({ mode: 'all', customerId: null });
export const INTERNAL_SCOPE = Object.freeze({ mode: 'internal', customerId: null });
export function scopeForRow(row) {
  const cid = row && row.customer_id;
  return cid ? { mode: 'one', customerId: cid } : INTERNAL_SCOPE;
}

/**
 * INSERT into a scoped table with customer_id stamped here, not by the caller.
 *
 * `row` is the column → value map without customer_id; `requested` is a
 * staff-supplied customer id (already validated by customerIdForCreate) and is
 * ignored for client users. Returns the customer_id written and the D1 meta,
 * so a caller can tell an OR IGNORE no-op (0 changes) from an insert.
 */
export async function scopedInsert(env, ctx, { table, row, requested = null, orIgnore = false }) {
  if (!SCOPED_TABLES.has(table)) throw new Error(`scope: ${table} is not a scoped table.`);
  if (!row || typeof row !== 'object' || 'customer_id' in row) {
    throw new Error('scope: pass the row without customer_id; scopedInsert stamps it.');
  }
  const customerId = customerIdForInsert(ctx, requested);
  const cols = [...Object.keys(row), 'customer_id'];
  const vals = [...Object.values(row), customerId];
  const sql = `INSERT ${orIgnore ? 'OR IGNORE ' : ''}INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
  const res = await env.DB.prepare(sql).bind(...vals).run();
  return { customer_id: customerId, changes: res.meta?.changes ?? 0, meta: res.meta };
}
