-- 019: CRM + Outreach become per-customer.
--
-- Until now contacts/campaigns/templates were Cintelis's own sales tooling and
-- 018 deliberately left them out: worker/customers.js returns INTERNAL_ONLY for
-- `contact`. That reverses here — every customer gets their own CRM and their
-- own outreach — so `case 'contact'` in entityCustomerId() must be changed to
-- read contacts.customer_id, or this migration silently does nothing.
--
-- Same tenancy model as 018: customer_id NULL means Cintelis. Our own sales
-- data therefore stays exactly where it is and becomes "the internal tenant",
-- which has the useful property that the scoped code path is the one everybody
-- exercises every day rather than a rarely-tested special case.
--
-- WHY contacts IS REBUILT RATHER THAN ALTERED.
-- `email TEXT UNIQUE NOT NULL` is global: two customers could not both hold a
-- prospect, and the second insert would fail. SQLite cannot drop a column
-- constraint with ALTER TABLE, so the table is copied. 458 rows at the time of
-- writing, so this is quick — but EXPORT contacts BEFORE RUNNING. A rebuild is
-- the one operation here with no undo.
--
-- The column list below is taken from the LIVE table, not from schema.sql.
-- schema.sql has drifted: it shows 7 columns, production has 15 (stage,
-- deal_value, tags, last_contacted_at, follow_up_at, linkedin, phone,
-- notes_count were added by hand and never written back). Re-check with
--   SELECT sql FROM sqlite_master WHERE name='contacts';
-- before applying, and add anything that has appeared since — a column missing
-- from the INSERT below is data silently dropped on the floor.

-- ── contacts: rebuild ────────────────────────────────────────────────────────

CREATE TABLE contacts_new (
  id                TEXT PRIMARY KEY,
  customer_id       TEXT,                       -- NULL = Cintelis internal
  email             TEXT NOT NULL,              -- uniqueness is now per customer, see indexes
  name              TEXT DEFAULT '',
  company           TEXT DEFAULT '',
  -- Unsubscribe is per row, and rows are now per customer, so opting out of one
  -- customer's campaigns no longer suppresses a person for every other
  -- customer. That fell out of the rebuild rather than needing its own table.
  unsubscribed      INTEGER DEFAULT 0,
  unsubscribed_at   TEXT,
  created_at        TEXT NOT NULL,
  stage             TEXT DEFAULT 'lead',
  deal_value        REAL DEFAULT 0,
  tags              TEXT DEFAULT '[]',
  last_contacted_at TEXT,
  follow_up_at      TEXT,
  linkedin          TEXT DEFAULT '',
  phone             TEXT DEFAULT '',
  notes_count       INTEGER DEFAULT 0
);

INSERT INTO contacts_new (
  id, customer_id, email, name, company, unsubscribed, unsubscribed_at,
  created_at, stage, deal_value, tags, last_contacted_at, follow_up_at,
  linkedin, phone, notes_count
)
SELECT
  id, NULL, email, name, company, unsubscribed, unsubscribed_at,
  created_at, stage, deal_value, tags, last_contacted_at, follow_up_at,
  linkedin, phone, notes_count
FROM contacts;

DROP TABLE contacts;
ALTER TABLE contacts_new RENAME TO contacts;

-- UNIQUENESS: two partial indexes, not one composite.
--
-- A plain UNIQUE(customer_id, email) would NOT hold for our own data, because
-- SQLite treats every NULL as distinct — so any number of internal rows could
-- share an address and the constraint that exists today would quietly weaken.
-- Splitting it keeps global uniqueness for internal contacts and per-customer
-- uniqueness for everyone else.
CREATE UNIQUE INDEX idx_contacts_email_internal
  ON contacts(email) WHERE customer_id IS NULL;
CREATE UNIQUE INDEX idx_contacts_email_customer
  ON contacts(customer_id, email) WHERE customer_id IS NOT NULL;

-- Lookups now filter by customer first, so the old single-column indexes are
-- rebuilt with customer_id leading. idx_contacts_email is kept unprefixed as
-- well: staff search by address across all customers, and the unique indexes
-- above cannot serve that because they are partial.
CREATE INDEX idx_contacts_email    ON contacts(email);
CREATE INDEX idx_contacts_unsub    ON contacts(customer_id, unsubscribed);
CREATE INDEX idx_contacts_stage    ON contacts(customer_id, stage);
CREATE INDEX idx_contacts_followup ON contacts(customer_id, follow_up_at);

-- ── The tables that own their own scope ──────────────────────────────────────

ALTER TABLE contact_lists ADD COLUMN customer_id TEXT;
ALTER TABLE templates     ADD COLUMN customer_id TEXT;
ALTER TABLE campaigns     ADD COLUMN customer_id TEXT;

-- sent_log carries customer_id directly even though it could be reached through
-- campaign_id. Two reasons: campaign_id is nullable, so one-off sends have no
-- parent to inherit from, and the dashboards read this table by customer and
-- date without otherwise needing campaigns at all. Set it at write time from
-- the campaign's customer; never leave it to be derived later.
ALTER TABLE sent_log      ADD COLUMN customer_id TEXT;

CREATE INDEX IF NOT EXISTS idx_contact_lists_customer ON contact_lists(customer_id);
CREATE INDEX IF NOT EXISTS idx_templates_customer     ON templates(customer_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_customer     ON campaigns(customer_id);
CREATE INDEX IF NOT EXISTS idx_sent_log_customer      ON sent_log(customer_id, sent_at);

-- ── The tables that inherit, and why they get no column ─────────────────────
--
-- contact_list_members  -> its list
-- campaign_steps        -> its campaign
-- drip_progress         -> its campaign
-- contact_profiles      -> its contact
--
-- Each is only ever reached through a parent that is already scoped, and each
-- would need the same value kept in step on every write. A denormalised copy
-- that nothing reads is a copy that goes wrong quietly. sent_log is the one
-- exception above because it is genuinely queried on its own.

-- No backfill. Every existing row is Cintelis's own, which NULL already says.
