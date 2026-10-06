-- 022: Deals as their own object (sprint 15).
--
-- Until now a contact *was* the deal: one stage and one deal_value on the
-- contact row. That breaks as soon as a contact has a second job, a company
-- has several opportunities, or a lost quote should not erase the contact's
-- history. HubSpot users expect deals: a named opportunity with its own
-- stage, amount, expected close date and owner, tied to a contact and/or a
-- company, shown on a deals board.
--
-- contacts.stage stays as the LIFECYCLE stage (lead → … → won) and
-- contacts.deal_value stays as a legacy field the edit modal still writes;
-- the CRM's money numbers (board totals, workspace, company/contact record)
-- now come from deals. Backfill below creates one deal per contact that
-- carried a value or had reached proposal/won/lost, mapped onto the deal
-- stages; idempotent (skips contacts that already have a deal).
--
-- Same tenancy model: customer_id NULL = Cintelis, stamped at write time.

CREATE TABLE IF NOT EXISTS deals (
  id            TEXT PRIMARY KEY,
  customer_id   TEXT,
  name          TEXT NOT NULL,
  contact_id    TEXT,                            -- contacts.id
  company_id    TEXT,                            -- companies.id
  stage         TEXT NOT NULL DEFAULT 'new',     -- new | qualified | proposal | negotiation | won | lost
  amount        REAL NOT NULL DEFAULT 0,
  close_date    TEXT,                            -- expected close, YYYY-MM-DD
  closed_at     TEXT,                            -- set when stage becomes won/lost
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

INSERT INTO deals (id, customer_id, name, contact_id, company_id, stage, amount, close_date, closed_at, owner_user_id, source, notes, created_by, created_at, updated_at)
SELECT
  'dl_' || lower(hex(randomblob(12))),
  c.customer_id,
  COALESCE(NULLIF(trim(c.company), ''), NULLIF(trim(c.name), ''), c.email) || ' — deal',
  c.id,
  c.company_id,
  CASE c.stage WHEN 'qualified' THEN 'qualified' WHEN 'proposal' THEN 'proposal' WHEN 'won' THEN 'won' WHEN 'lost' THEN 'lost' ELSE 'new' END,
  COALESCE(c.deal_value, 0),
  NULL,
  CASE WHEN c.stage IN ('won', 'lost') THEN COALESCE(c.last_contacted_at, c.created_at) ELSE NULL END,
  c.owner_user_id,
  'backfill',
  '',
  NULL,
  c.created_at,
  strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
FROM contacts c
WHERE (COALESCE(c.deal_value, 0) > 0 OR c.stage IN ('proposal', 'won', 'lost'))
  AND NOT EXISTS (SELECT 1 FROM deals d WHERE d.contact_id = c.id);
