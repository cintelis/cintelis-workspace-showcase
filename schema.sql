-- 365Soft Labs Outreach Dashboard — D1 Schema
-- Run: wrangler d1 execute outreach-db --file=schema.sql

-- CRM + Outreach are per customer since migration 019: customer_id NULL means
-- Cintelis's own rows. Every read/write of these tables goes through
-- worker/scope.js (enforced by `npm run check:scoping`).
CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  customer_id TEXT,               -- NULL = Cintelis internal, else customers.id (migration 019)
  email TEXT NOT NULL,            -- unique per customer, see the partial indexes below
  name TEXT DEFAULT '',
  company TEXT DEFAULT '',
  unsubscribed INTEGER DEFAULT 0,
  unsubscribed_at TEXT,
  created_at TEXT NOT NULL,
  stage TEXT DEFAULT 'lead',
  deal_value REAL DEFAULT 0,
  tags TEXT DEFAULT '[]',
  last_contacted_at TEXT,
  follow_up_at TEXT,
  linkedin TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  notes_count INTEGER DEFAULT 0,
  company_id TEXT,                -- companies.id (migration 021)
  owner_user_id TEXT              -- users.id (migration 021)
);
-- Two partial unique indexes rather than UNIQUE(customer_id, email): SQLite
-- treats every NULL as distinct, so a composite index would not hold for the
-- internal tenant.
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_email_internal ON contacts(email) WHERE customer_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_email_customer ON contacts(customer_id, email) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_email    ON contacts(email);
CREATE INDEX IF NOT EXISTS idx_contacts_unsub    ON contacts(customer_id, unsubscribed);
CREATE INDEX IF NOT EXISTS idx_contacts_stage    ON contacts(customer_id, stage);
CREATE INDEX IF NOT EXISTS idx_contacts_followup ON contacts(customer_id, follow_up_at);

CREATE TABLE IF NOT EXISTS contact_lists (
  id TEXT PRIMARY KEY,
  customer_id TEXT,               -- NULL = Cintelis internal (migration 019)
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contact_lists_customer ON contact_lists(customer_id);

-- CRM tasks (migration 020): to-do / call / email / meeting with due date,
-- priority and owner. Optional contact; customer_id stamped at write time.
CREATE TABLE IF NOT EXISTS crm_tasks (
  id            TEXT PRIMARY KEY,
  customer_id   TEXT,
  contact_id    TEXT,
  title         TEXT NOT NULL,
  type          TEXT NOT NULL DEFAULT 'todo',
  priority      TEXT NOT NULL DEFAULT 'medium',
  due_at        TEXT,
  done_at       TEXT,
  owner_user_id TEXT,
  notes         TEXT NOT NULL DEFAULT '',
  created_by    TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_queue   ON crm_tasks(customer_id, done_at, due_at);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_contact ON crm_tasks(contact_id, done_at);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_owner   ON crm_tasks(owner_user_id, done_at, due_at);

-- Companies (migration 021). contacts.company_id links here; contacts.company
-- keeps the denormalised name. contacts.owner_user_id added in the same migration.
CREATE TABLE IF NOT EXISTS companies (
  id            TEXT PRIMARY KEY,
  customer_id   TEXT,
  name          TEXT NOT NULL,
  domain        TEXT NOT NULL DEFAULT '',
  website       TEXT NOT NULL DEFAULT '',
  phone         TEXT NOT NULL DEFAULT '',
  industry      TEXT NOT NULL DEFAULT '',
  notes         TEXT NOT NULL DEFAULT '',
  owner_user_id TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_name_internal ON companies(lower(name)) WHERE customer_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_name_customer ON companies(customer_id, lower(name)) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_companies_customer ON companies(customer_id, name);

-- Deals (migration 022): a named opportunity with its own stage, amount,
-- close date and owner, tied to a contact and/or company. contacts.stage
-- remains the lifecycle stage; money numbers come from here.
CREATE TABLE IF NOT EXISTS deals (
  id            TEXT PRIMARY KEY,
  customer_id   TEXT,
  name          TEXT NOT NULL,
  contact_id    TEXT,
  company_id    TEXT,
  stage         TEXT NOT NULL DEFAULT 'new',
  amount        REAL NOT NULL DEFAULT 0,
  close_date    TEXT,
  closed_at     TEXT,
  owner_user_id TEXT,
  source        TEXT NOT NULL DEFAULT '',
  notes         TEXT NOT NULL DEFAULT '',
  created_by    TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_deals_board   ON deals(customer_id, stage, close_date);
CREATE INDEX IF NOT EXISTS idx_deals_contact ON deals(contact_id);
CREATE INDEX IF NOT EXISTS idx_deals_company ON deals(company_id);
CREATE INDEX IF NOT EXISTS idx_deals_owner   ON deals(owner_user_id, stage);

CREATE TABLE IF NOT EXISTS contact_list_members (
  contact_id TEXT NOT NULL,
  list_id TEXT NOT NULL,
  PRIMARY KEY (contact_id, list_id)
);

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  customer_id TEXT,               -- NULL = Cintelis internal (migration 019)
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  html_body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_templates_customer ON templates(customer_id);

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  customer_id TEXT,               -- NULL = Cintelis internal (migration 019); a customer's
                                  -- campaigns send via its `email` integration, never the env defaults
  name TEXT NOT NULL,
  list_id TEXT,
  schedule_type TEXT NOT NULL,
  schedule_config TEXT DEFAULT '{}',
  status TEXT DEFAULT 'draft',
  from_email TEXT DEFAULT 'nick@365softlabs.com',
  from_name TEXT DEFAULT 'Nick | 365Soft Labs',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS campaign_steps (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  step_order INTEGER NOT NULL,
  delay_days INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS drip_progress (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  current_step INTEGER DEFAULT 0,
  last_sent_at TEXT,
  next_send_at TEXT,
  completed INTEGER DEFAULT 0,
  UNIQUE(campaign_id, contact_id)
);

CREATE TABLE IF NOT EXISTS sent_log (
  id TEXT PRIMARY KEY,
  customer_id TEXT,               -- set at write time from the campaign (migration 019); queried on its own by the dashboards
  campaign_id TEXT,
  campaign_name TEXT,
  contact_id TEXT,
  contact_email TEXT NOT NULL,
  template_id TEXT,
  template_name TEXT,
  subject TEXT,
  status TEXT DEFAULT 'sent',
  error TEXT,
  sent_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_campaigns_customer ON campaigns(customer_id);
CREATE INDEX IF NOT EXISTS idx_sent_log_customer  ON sent_log(customer_id, sent_at);
CREATE INDEX IF NOT EXISTS idx_logs_sent_at ON sent_log(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_drip ON drip_progress(campaign_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_steps ON campaign_steps(campaign_id, step_order);

-- ── CRM Extensions ───────────────────────────────────────────

-- Migrate contacts table with CRM fields
-- (Run ALTER statements separately if contacts table already exists)
ALTER TABLE contacts ADD COLUMN stage TEXT DEFAULT 'lead';
ALTER TABLE contacts ADD COLUMN deal_value REAL DEFAULT 0;
ALTER TABLE contacts ADD COLUMN tags TEXT DEFAULT '[]';
ALTER TABLE contacts ADD COLUMN last_contacted_at TEXT;
ALTER TABLE contacts ADD COLUMN follow_up_at TEXT;
ALTER TABLE contacts ADD COLUMN linkedin TEXT DEFAULT '';
ALTER TABLE contacts ADD COLUMN phone TEXT DEFAULT '';
ALTER TABLE contacts ADD COLUMN notes_count INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS contact_profiles (
  contact_id TEXT PRIMARY KEY,
  first_name TEXT DEFAULT '',
  last_name TEXT DEFAULT '',
  title TEXT DEFAULT '',
  image_url TEXT DEFAULT '',
  updated_at TEXT NOT NULL
);

-- contact_notes was dropped in Sprint 5; contact notes now live in the
-- polymorphic `activity` table (entity_type='contact').

CREATE INDEX IF NOT EXISTS idx_contact_profiles_name ON contact_profiles(last_name, first_name);

-- ── Sprint 1: multi-user auth foundation ─────────────────────
-- Mirrors migrations/001_users_and_sessions.sql so a fresh DB created from
-- this file alone has the complete schema. Existing databases should run the
-- migration file once via wrangler d1 execute.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'member',
  active INTEGER NOT NULL DEFAULT 1,
  preferences TEXT NOT NULL DEFAULT '{}',
  customer_id TEXT,               -- NULL = Cintelis internal, else customers.id (migration 018)
  created_at TEXT NOT NULL,
  last_login_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(active);

CREATE TABLE IF NOT EXISTS user_credentials (
  user_id TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  algorithm TEXT NOT NULL DEFAULT 'PBKDF2-SHA256',
  iterations INTEGER NOT NULL DEFAULT 100000,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_totp (
  user_id TEXT PRIMARY KEY,
  secret TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  verified_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_backup_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_backup_codes_user ON user_backup_codes(user_id, used_at);

CREATE TABLE IF NOT EXISTS app_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  is_2fa_pending INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  last_seen_at TEXT,
  user_agent TEXT,
  ip TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON app_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON app_sessions(expires_at);

-- ── Sprint 1: polymorphic activity feed ──────────────────────
CREATE TABLE IF NOT EXISTS activity (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  user_id TEXT,
  kind TEXT NOT NULL DEFAULT 'note',
  body_md TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_entity ON activity(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_user ON activity(user_id, created_at DESC);

-- ── Sprint 2: Tasks (projects + issues) ──────────────────────

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description_md TEXT NOT NULL DEFAULT '',
  lead_user_id TEXT,
  issue_seq INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  customer_id TEXT,               -- NULL = Cintelis internal, else customers.id (migration 018)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_key ON projects(key);
CREATE INDEX IF NOT EXISTS idx_projects_active ON projects(active);

CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  issue_key TEXT NOT NULL,
  issue_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  description_md TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'task',
  status TEXT NOT NULL DEFAULT 'todo',
  priority TEXT NOT NULL DEFAULT 'medium',
  assignee_id TEXT,
  reporter_id TEXT NOT NULL,
  parent_id TEXT,
  start_at TEXT,
  due_at TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, issue_number)
);
CREATE INDEX IF NOT EXISTS idx_issues_project ON issues(project_id, active, status);
CREATE INDEX IF NOT EXISTS idx_issues_assignee ON issues(assignee_id, active);
CREATE INDEX IF NOT EXISTS idx_issues_key ON issues(issue_key);
CREATE INDEX IF NOT EXISTS idx_issues_parent ON issues(parent_id);
CREATE INDEX IF NOT EXISTS idx_issues_updated ON issues(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_issues_timeline ON issues(project_id, active, start_at, due_at);

-- ── Sprint 6: attachments (R2-backed) ───────────────────────

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes INTEGER NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  uploaded_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attachments_entity ON attachments(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attachments_uploader ON attachments(uploaded_by);

-- ── Sprint 6: cross-entity links ────────────────────────────

CREATE TABLE IF NOT EXISTS entity_links (
  id TEXT PRIMARY KEY,
  from_type TEXT NOT NULL,
  from_id TEXT NOT NULL,
  to_type TEXT NOT NULL,
  to_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(from_type, from_id, to_type, to_id)
);
CREATE INDEX IF NOT EXISTS idx_entity_links_from ON entity_links(from_type, from_id);
CREATE INDEX IF NOT EXISTS idx_entity_links_to ON entity_links(to_type, to_id);

-- ── Sprint 6: app-wide settings ─────────────────────────────

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

-- ── Sprint 5: integrations + per-user notifications ─────────

CREATE TABLE IF NOT EXISTS integrations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  config TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  customer_id TEXT,               -- NULL = Cintelis internal, else customers.id (migration 018)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_integrations_kind_active ON integrations(kind, active);

CREATE TABLE IF NOT EXISTS notification_rules (
  id TEXT PRIMARY KEY,
  integration_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  filter TEXT NOT NULL DEFAULT '{}',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notification_rules_event ON notification_rules(event_type, active);
CREATE INDEX IF NOT EXISTS idx_notification_rules_integration ON notification_rules(integration_id);

CREATE TABLE IF NOT EXISTS notification_log (
  id TEXT PRIMARY KEY,
  integration_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  status TEXT NOT NULL,
  error TEXT,
  sent_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notification_log_sent ON notification_log(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_log_integration ON notification_log(integration_id, sent_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  link TEXT,
  actor_id TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, read_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_recent ON notifications(user_id, created_at DESC);

-- ── Sprint 4: Docs (spaces + pages + version history) ───────

CREATE TABLE IF NOT EXISTS doc_spaces (
  id TEXT PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description_md TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  customer_id TEXT,               -- NULL = Cintelis internal, else customers.id (migration 018)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_doc_spaces_key ON doc_spaces(key);
CREATE INDEX IF NOT EXISTS idx_doc_spaces_active ON doc_spaces(active);

CREATE TABLE IF NOT EXISTS doc_pages (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  parent_id TEXT,
  title TEXT NOT NULL,
  slug TEXT NOT NULL DEFAULT '',
  content_md TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_doc_pages_space ON doc_pages(space_id, active);
CREATE INDEX IF NOT EXISTS idx_doc_pages_parent ON doc_pages(parent_id, position);
CREATE INDEX IF NOT EXISTS idx_doc_pages_updated ON doc_pages(updated_at DESC);

CREATE TABLE IF NOT EXISTS doc_page_versions (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content_md TEXT NOT NULL DEFAULT '',
  author_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_doc_versions_page ON doc_page_versions(page_id, created_at DESC);

-- ── Sprint 3: sprints ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sprints (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  goal TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'planned',
  start_at TEXT,
  end_at TEXT,
  planned_end_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sprints_project_state ON sprints(project_id, state);
CREATE INDEX IF NOT EXISTS idx_sprints_state ON sprints(state);

-- sprint_id is added to issues via migrations/004_sprints.sql for existing
-- databases. For fresh installs from this file, issues already has it via
-- the column list below would need updating — but we keep the original
-- issues definition above untouched for clarity. New installs can run the
-- 004 migration as the final step.

-- ── Sprint 8: Custom fields ──────────────────────────────────
CREATE TABLE IF NOT EXISTS custom_field_defs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  field_type TEXT NOT NULL DEFAULT 'text',
  options TEXT NOT NULL DEFAULT '[]',
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cfd_project ON custom_field_defs(project_id, active, sort_order);

CREATE TABLE IF NOT EXISTS custom_field_values (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL,
  field_def_id TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '',
  UNIQUE(issue_id, field_def_id)
);
CREATE INDEX IF NOT EXISTS idx_cfv_issue ON custom_field_values(issue_id);
CREATE INDEX IF NOT EXISTS idx_cfv_field ON custom_field_values(field_def_id);

-- ── Sprint 8: Issue dependencies ─────────────────────────────
CREATE TABLE IF NOT EXISTS issue_dependencies (
  id TEXT PRIMARY KEY,
  blocker_issue_id TEXT NOT NULL,
  blocked_issue_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(blocker_issue_id, blocked_issue_id)
);
CREATE INDEX IF NOT EXISTS idx_deps_blocker ON issue_dependencies(blocker_issue_id);
CREATE INDEX IF NOT EXISTS idx_deps_blocked ON issue_dependencies(blocked_issue_id);

-- ── LinkedIn Ad Library: shared 3-legged OAuth member token ───
CREATE TABLE IF NOT EXISTS linkedin_oauth (
  id                 TEXT PRIMARY KEY,  -- always 'shared'
  access_token       TEXT NOT NULL,
  refresh_token      TEXT,
  expires_at         INTEGER,           -- epoch ms when access_token expires
  refresh_expires_at INTEGER,           -- epoch ms when refresh_token expires
  scope              TEXT,
  connected_by       TEXT,
  connected_by_email TEXT,
  connected_at       TEXT
);

-- LinkedIn Community Management API (016): page publishing, analytics snapshots,
-- and comment monitoring. Reuses the shared token in linkedin_oauth.
CREATE TABLE IF NOT EXISTS linkedin_posts (
  id            TEXT PRIMARY KEY,
  body          TEXT NOT NULL,
  visibility    TEXT NOT NULL DEFAULT 'PUBLIC',
  status        TEXT NOT NULL DEFAULT 'draft', -- draft | scheduled | published | failed
  scheduled_at  TEXT,
  published_at  TEXT,
  post_urn      TEXT,
  error         TEXT,
  created_by    TEXT,
  created_at    TEXT NOT NULL,
  media_type    TEXT,   -- 'image' | 'document' | NULL (017)
  media_urn     TEXT,   -- urn:li:image:... | urn:li:document:...
  media_title   TEXT,
  media_alt     TEXT
);
CREATE INDEX IF NOT EXISTS idx_li_posts_due ON linkedin_posts (status, scheduled_at);

CREATE TABLE IF NOT EXISTS linkedin_stats (
  snapshot_date     TEXT PRIMARY KEY,   -- YYYY-MM-DD (UTC)
  follower_count    INTEGER,
  impression_count  INTEGER,
  unique_impressions INTEGER,
  click_count       INTEGER,
  like_count        INTEGER,
  comment_count     INTEGER,
  share_count       INTEGER,
  engagement        REAL,
  page_views        INTEGER,
  raw               TEXT,
  captured_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS linkedin_comments (
  comment_urn   TEXT PRIMARY KEY,
  post_urn      TEXT,
  actor         TEXT,
  message       TEXT,
  created_time  INTEGER,
  replied       INTEGER NOT NULL DEFAULT 0,
  ingested_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_li_comments_time ON linkedin_comments (created_time DESC);

-- ── Customers / tenants (migration 018) ──────────────────────
CREATE TABLE IF NOT EXISTS customers (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  slug          TEXT UNIQUE NOT NULL,
  abn           TEXT NOT NULL DEFAULT '',
  address       TEXT NOT NULL DEFAULT '',
  contact_name  TEXT NOT NULL DEFAULT '',
  contact_email TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'active',
  features      TEXT NOT NULL DEFAULT '{}',
  notes         TEXT NOT NULL DEFAULT '',
  xero_contact_id   TEXT,                         -- 023
  xero_contact_name TEXT NOT NULL DEFAULT '',     -- 023
  created_by    TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT
);
CREATE TABLE IF NOT EXISTS customer_contracts (
  id                TEXT PRIMARY KEY,
  customer_id       TEXT NOT NULL,
  title             TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'active',
  commencement_date TEXT,
  initial_term      TEXT NOT NULL DEFAULT '',
  hours_per_week    TEXT NOT NULL DEFAULT '',
  rate_amount       REAL,
  rate_unit         TEXT NOT NULL DEFAULT 'hour',
  currency          TEXT NOT NULL DEFAULT 'AUD',
  invoicing         TEXT NOT NULL DEFAULT '',
  payment_terms     TEXT NOT NULL DEFAULT '',
  key_person        TEXT NOT NULL DEFAULT '',
  notes             TEXT NOT NULL DEFAULT '',
  created_by        TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_customer_contracts_customer ON customer_contracts(customer_id);
CREATE INDEX IF NOT EXISTS idx_users_customer        ON users(customer_id);
CREATE INDEX IF NOT EXISTS idx_projects_customer     ON projects(customer_id);
CREATE INDEX IF NOT EXISTS idx_doc_spaces_customer   ON doc_spaces(customer_id);
CREATE INDEX IF NOT EXISTS idx_integrations_customer ON integrations(customer_id);

-- ── Xero (migration 023) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS xero_connection (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT,
  tenant_name         TEXT NOT NULL DEFAULT '',
  connection_id       TEXT,
  tenants_json        TEXT NOT NULL DEFAULT '[]',
  access_token        TEXT NOT NULL,
  refresh_token       TEXT NOT NULL,
  expires_at          INTEGER NOT NULL,
  scope               TEXT NOT NULL DEFAULT '',
  connected_by        TEXT,
  connected_by_email  TEXT,
  connected_at        TEXT NOT NULL,
  last_sync_at        TEXT,
  last_sync_error     TEXT,
  sync_cursor         TEXT
);
CREATE TABLE IF NOT EXISTS xero_invoices (
  id               TEXT PRIMARY KEY,
  customer_id      TEXT,
  xero_contact_id  TEXT NOT NULL,
  invoice_number   TEXT NOT NULL DEFAULT '',
  reference        TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL,
  date             TEXT,
  due_date         TEXT,
  currency         TEXT NOT NULL DEFAULT 'AUD',
  sub_total        REAL,
  total_tax        REAL,
  total            REAL NOT NULL DEFAULT 0,
  amount_due       REAL NOT NULL DEFAULT 0,
  amount_paid      REAL NOT NULL DEFAULT 0,
  fully_paid_on    TEXT,
  online_url       TEXT,
  xero_updated_at  TEXT,
  synced_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_xero_invoices_customer ON xero_invoices(customer_id, date);
CREATE INDEX IF NOT EXISTS idx_xero_invoices_contact  ON xero_invoices(xero_contact_id);
