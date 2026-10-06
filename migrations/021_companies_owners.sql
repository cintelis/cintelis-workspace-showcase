-- 021: Companies as a real object, and contact owners (sprint 14).
--
-- contacts.company has been a free-text field, which is why the pipeline
-- grouped by string and the record page could only say "no other contacts
-- at this company" by matching text. A companies row per tenant gives the
-- record page and the board something to link to, and lets a company carry
-- its own properties (domain, phone, website, industry, owner, notes).
--
-- contacts.company (the name) is KEPT and stays denormalised: every list and
-- CSV import writes it, and the read paths that only need a label keep
-- reading it. worker/crm-companies.js keeps company_id and the name in step.
--
-- contacts.owner_user_id: the person responsible, so the board can show an
-- avatar and the workspace can count "mine".
--
-- Same tenancy model: companies.customer_id NULL = Cintelis, stamped at write
-- time. Backfill below creates one company per distinct name per tenant and
-- links the contacts; safe to re-run (INSERT skips names that already exist).

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
-- Name uniqueness per tenant, case-insensitive, with the same NULL split as contacts.
CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_name_internal ON companies(lower(name)) WHERE customer_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_name_customer ON companies(customer_id, lower(name)) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_companies_customer ON companies(customer_id, name);

ALTER TABLE contacts ADD COLUMN company_id TEXT;
ALTER TABLE contacts ADD COLUMN owner_user_id TEXT;
CREATE INDEX IF NOT EXISTS idx_contacts_company_id ON contacts(company_id);
CREATE INDEX IF NOT EXISTS idx_contacts_owner ON contacts(owner_user_id);

INSERT INTO companies (id, customer_id, name, domain, website, phone, industry, notes, owner_user_id, created_at, updated_at)
SELECT
  'cmp_' || lower(hex(randomblob(12))),
  src.customer_id,
  src.name,
  '', '', '', '', '', NULL,
  strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
FROM (
  SELECT customer_id, MIN(trim(company)) AS name, lower(trim(company)) AS key
  FROM contacts
  WHERE trim(COALESCE(company, '')) <> ''
  GROUP BY customer_id, lower(trim(company))
) src
WHERE NOT EXISTS (
  SELECT 1 FROM companies x
  WHERE lower(x.name) = src.key AND (x.customer_id = src.customer_id OR (x.customer_id IS NULL AND src.customer_id IS NULL))
);

UPDATE contacts SET company_id = (
  SELECT x.id FROM companies x
  WHERE lower(x.name) = lower(trim(contacts.company))
    AND (x.customer_id = contacts.customer_id OR (x.customer_id IS NULL AND contacts.customer_id IS NULL))
)
WHERE company_id IS NULL AND trim(COALESCE(company, '')) <> '';
