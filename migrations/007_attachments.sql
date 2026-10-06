-- Sprint 6: attachments (R2-backed)
-- Apply: wrangler d1 execute outreach-db --remote --file=migrations/007_attachments.sql

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,                    -- att_{hex}
  entity_type TEXT NOT NULL,              -- 'issue' | 'doc_page' | 'contact'
  entity_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes INTEGER NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,            -- e.g. 'att_xxx/screenshot.png'
  uploaded_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attachments_entity ON attachments(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attachments_uploader ON attachments(uploaded_by);
