-- 023: Xero (Cintelis's own organisation, read-only invoice sync)
--
-- Invoices are raised in Xero as before. The app links each customer to a Xero
-- contact, pulls that contact's sales invoices on the cron, and shows them on
-- the customer's Contract & Billing page. It never writes to Xero.

-- One row per Xero connection. 'cintelis' is the only row today; the id leaves
-- room for a per-customer connection later without a schema change.
-- Tokens never leave the Worker.
CREATE TABLE IF NOT EXISTS xero_connection (
  id                  TEXT PRIMARY KEY,           -- 'cintelis'
  tenant_id           TEXT,                       -- Xero organisation (xero-tenant-id header)
  tenant_name         TEXT NOT NULL DEFAULT '',
  connection_id       TEXT,                       -- /connections id, for disconnect
  tenants_json        TEXT NOT NULL DEFAULT '[]', -- every organisation the consent covered
  access_token        TEXT NOT NULL,
  refresh_token       TEXT NOT NULL,              -- rotates on every refresh
  expires_at          INTEGER NOT NULL,           -- access token expiry, ms epoch
  scope               TEXT NOT NULL DEFAULT '',
  connected_by        TEXT,
  connected_by_email  TEXT,
  connected_at        TEXT NOT NULL,
  last_sync_at        TEXT,
  last_sync_error     TEXT,
  sync_cursor         TEXT                        -- If-Modified-Since for the next incremental sync (UTC)
);

ALTER TABLE customers ADD COLUMN xero_contact_id TEXT;
ALTER TABLE customers ADD COLUMN xero_contact_name TEXT NOT NULL DEFAULT '';

-- Sales invoices (Xero Type ACCREC) for linked contacts. customer_id makes this
-- a customer-owned table: reads go through worker/scope.js.
CREATE TABLE IF NOT EXISTS xero_invoices (
  id               TEXT PRIMARY KEY,              -- Xero InvoiceID
  customer_id      TEXT,
  xero_contact_id  TEXT NOT NULL,
  invoice_number   TEXT NOT NULL DEFAULT '',
  reference        TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL,                 -- DRAFT | SUBMITTED | AUTHORISED | PAID | VOIDED | DELETED
  date             TEXT,                          -- YYYY-MM-DD
  due_date         TEXT,                          -- YYYY-MM-DD
  currency         TEXT NOT NULL DEFAULT 'AUD',
  sub_total        REAL,
  total_tax        REAL,
  total            REAL NOT NULL DEFAULT 0,
  amount_due       REAL NOT NULL DEFAULT 0,
  amount_paid      REAL NOT NULL DEFAULT 0,
  fully_paid_on    TEXT,                          -- YYYY-MM-DD
  online_url       TEXT,                          -- Xero online invoice (view + pay)
  xero_updated_at  TEXT,
  synced_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_xero_invoices_customer ON xero_invoices(customer_id, date);
CREATE INDEX IF NOT EXISTS idx_xero_invoices_contact  ON xero_invoices(xero_contact_id);
