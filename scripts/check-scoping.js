// Fails when a customer-owned table is queried outside worker/scope.js.
//
// The tenancy in 018/019 is opt-in: customer_id is nullable, NULL means
// Cintelis, and a statement with no customer predicate returns every customer's
// rows. Nothing in the schema prevents that, so this does — not by
// understanding SQL, but by insisting that statements touching a scoped table
// go through the one module that refuses to run them without a /*SCOPE*/ marker.
//
// It is deliberately dumb. A regex over source is easy to reason about and
// impossible to half-satisfy; anything cleverer would need a SQL parser and
// would still be guessing. False positives are handled by routing the query
// through scope.js, which is the point, or by an explicit allow below when a
// statement genuinely has no tenant (a migration runner, a global count).
//
//   node scripts/check-scoping.js        # or: npm run check:scoping
//
// Exits 1 on the first offending file so it can gate a deploy.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

// Kept in step with SCOPED_TABLES in worker/scope.js by hand. A mismatch is
// caught below rather than left to drift.
const SCOPED = [
  'projects', 'doc_spaces', 'api_tokens', 'integrations',
  'contacts', 'contact_lists', 'templates', 'campaigns', 'sent_log',
  'crm_tasks', 'companies', 'deals', 'xero_invoices',
];

// Files that may talk to scoped tables directly.
const EXEMPT = new Set([
  'worker/scope.js',        // the helper itself
  'worker/customers.js',    // resolves an entity's owner; scoping it would be circular
  'scripts/check-scoping.js',
]);

// Specific lines that are genuinely tenant-free. Keep this list short and make
// every entry explain itself; a long allowlist means the rule is wrong.
const ALLOW = [
  /INSERT INTO sent_log/,   // write path; customer_id is set explicitly from the campaign
  /INSERT INTO xero_invoices/, // sync upsert; customer_id comes from the customer linked to the Xero contact
];

/** FROM/JOIN/UPDATE/DELETE against a scoped table, in a SQL-looking string. */
const PATTERN = new RegExp(
  String.raw`\b(?:FROM|JOIN|UPDATE|INTO|DELETE\s+FROM)\s+(${SCOPED.join('|')})\b`,
  'i',
);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === '.wrangler') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

const offences = [];

for (const file of walk(ROOT)) {
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  if (EXEMPT.has(rel)) continue;
  // public/ is browser code and holds no SQL; skip it rather than match on
  // strings that merely mention a table name.
  if (rel.startsWith('public/')) continue;

  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    const m = line.match(PATTERN);
    if (!m) return;
    if (line.includes('/*SCOPE*/')) return;              // scoped inline, fine
    if (ALLOW.some((re) => re.test(line))) return;
    offences.push({ file: rel, line: i + 1, table: m[1], text: line.trim().slice(0, 100) });
  });
}

// Guard against SCOPED drifting from worker/scope.js.
const helper = readFileSync(join(ROOT, 'worker/scope.js'), 'utf8');
const declared = [...helper.matchAll(/'([a-z_]+)',/g)].map((m) => m[1]);
const missing = SCOPED.filter((t) => !declared.includes(t));
if (missing.length) {
  console.error(`check-scoping: ${missing.join(', ')} listed here but not in worker/scope.js SCOPED_TABLES`);
  process.exit(1);
}

if (offences.length) {
  console.error(`\ncheck-scoping: ${offences.length} unscoped quer${offences.length === 1 ? 'y' : 'ies'} on customer-owned tables\n`);
  for (const o of offences) {
    console.error(`  ${o.file}:${o.line}  [${o.table}]`);
    console.error(`    ${o.text}`);
  }
  console.error(
    '\nRoute these through worker/scope.js (scopedAll / scopedFirst / scopedRun),\n' +
    'placing /*SCOPE*/ where the customer predicate belongs. If a statement truly\n' +
    'has no tenant, add it to ALLOW in this file with a comment saying why.\n',
  );
  process.exit(1);
}

console.log(`check-scoping: clean — ${SCOPED.length} scoped tables, no unscoped queries.`);
