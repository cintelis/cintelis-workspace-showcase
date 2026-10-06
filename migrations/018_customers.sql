-- 018: Customers (tenants) + contracts. Cintelis onboards client companies;
-- each customer is an isolated tenant. users/projects/doc_spaces/api_tokens/
-- integrations gain a nullable customer_id (NULL = Cintelis internal).
--
-- WHY NULL RATHER THAN A SENTINEL CUSTOMER ROW.
-- NULL is not "unset", it is "Cintelis". On `users` it distinguishes staff from
-- a client's own people, which is a kind of user and not a missing value; on the
-- data tables it marks our own work. Giving internal rows a real customer id
-- would make `ctx.user.customer_id` truthy for staff and scope them to it,
-- which is the opposite of what staff need.
--
-- WHAT THIS MEANS FOR QUERIES — the part that is easy to get wrong.
-- Scoping here is OPT-IN: a query with no customer filter returns every
-- customer's rows. That is the reverse of Lintel's tenancy, where a tenant with
-- no grant sees nothing and an incomplete setup fails closed. It is safe only
-- while every read goes through the scope block in worker/tasks.js and every
-- write through customerIdForCreate(), which checks isCustomerUser() FIRST so a
-- client user can never widen their own scope from a URL or a request body.
-- A new handler that forgets is a cross-customer leak, and nothing in the
-- schema will stop it. Route new reads through one shared scoping helper rather
-- than repeating the WHERE clause.

CREATE TABLE IF NOT EXISTS customers (
  id            TEXT PRIMARY KEY,                 -- cus_ + uuid
  name          TEXT NOT NULL,
  slug          TEXT UNIQUE NOT NULL,
  abn           TEXT NOT NULL DEFAULT '',
  address       TEXT NOT NULL DEFAULT '',
  contact_name  TEXT NOT NULL DEFAULT '',
  contact_email TEXT NOT NULL DEFAULT '',         -- email for notices
  status        TEXT NOT NULL DEFAULT 'active',   -- active | suspended | archived
  -- Per-customer ENTITLEMENT: may this customer have the feature at all.
  -- Distinct from app_settings key 'feature_visibility' (migration 009), which
  -- answers a different question: which ROLES inside an account may see a
  -- feature they are already entitled to. Precedence is entitlement first,
  -- visibility second — if this blob says false, no role sees it and
  -- feature_visibility is never consulted. Resolve both in ONE helper; two
  -- feature systems answering independently is how they drift apart.
  features      TEXT NOT NULL DEFAULT '{}',       -- JSON {tasks,docs,roadmap,billing,integrations,api_tokens: bool}
  notes         TEXT NOT NULL DEFAULT '',
  created_by    TEXT,
  created_at    TEXT NOT NULL,
  -- NOT NULL to match projects/issues, which never leave updated_at unset.
  updated_at    TEXT NOT NULL
);

-- Suspending a customer must lock out all of their people at once, so status is
-- read on every scoped request rather than only on the customers screen.
CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status);

CREATE TABLE IF NOT EXISTS customer_contracts (
  id                TEXT PRIMARY KEY,             -- ctr_ + uuid
  -- The only FOREIGN KEY in this schema, and a deliberate exception. Elsewhere
  -- an orphaned child is still something a human wants to find; a contract
  -- belonging to no customer is unreadable by anyone, and there is no delete
  -- path yet that would clean one up. D1 enforces foreign keys, so this
  -- cascades for real. If that surprises an existing delete flow, drop the
  -- REFERENCES clause rather than leaving the cascade half-trusted.
  customer_id       TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'active', -- draft | active | expired | terminated
  commencement_date TEXT,                         -- YYYY-MM-DD
  initial_term      TEXT NOT NULL DEFAULT '',
  hours_per_week    TEXT NOT NULL DEFAULT '',
  rate_amount       REAL,
  rate_unit         TEXT NOT NULL DEFAULT 'hour', -- hour | day | month | fixed
  currency          TEXT NOT NULL DEFAULT 'AUD',
  invoicing         TEXT NOT NULL DEFAULT '',
  payment_terms     TEXT NOT NULL DEFAULT '',
  key_person        TEXT NOT NULL DEFAULT '',
  notes             TEXT NOT NULL DEFAULT '',
  created_by        TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_customer_contracts_customer ON customer_contracts(customer_id);
-- "Which contracts are live" is the question the onboarding screen asks first.
CREATE INDEX IF NOT EXISTS idx_customer_contracts_status   ON customer_contracts(customer_id, status);

ALTER TABLE users        ADD COLUMN customer_id TEXT;
ALTER TABLE projects     ADD COLUMN customer_id TEXT;
ALTER TABLE doc_spaces   ADD COLUMN customer_id TEXT;
ALTER TABLE api_tokens   ADD COLUMN customer_id TEXT;
ALTER TABLE integrations ADD COLUMN customer_id TEXT;

-- No backfill: every pre-existing row is Cintelis internal, which NULL already
-- says. Stated so the absence reads as a decision rather than an omission.

CREATE INDEX IF NOT EXISTS idx_users_customer        ON users(customer_id);
CREATE INDEX IF NOT EXISTS idx_projects_customer     ON projects(customer_id);
CREATE INDEX IF NOT EXISTS idx_doc_spaces_customer   ON doc_spaces(customer_id);
CREATE INDEX IF NOT EXISTS idx_api_tokens_customer   ON api_tokens(customer_id);
CREATE INDEX IF NOT EXISTS idx_integrations_customer ON integrations(customer_id);
