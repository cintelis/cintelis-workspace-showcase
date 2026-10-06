-- Sprint 1, landing 1: polymorphic activity table
-- Created now for use by issues/docs in later sprints; backfilled from contact_notes
-- so the new entity-agnostic feed has historical data. The existing contact_notes
-- table is preserved unchanged in landing 1 — getNotes/addNote/deleteNote still
-- read/write it. A later landing will switch reads to `activity` and drop the
-- legacy table.
-- Apply: wrangler d1 execute outreach-db --remote --file=migrations/002_activity_table.sql

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

-- Backfill from contact_notes (idempotent: INSERT OR IGNORE on PK)
INSERT OR IGNORE INTO activity (id, entity_type, entity_id, user_id, kind, body_md, created_at)
SELECT id, 'contact', contact_id, NULL, COALESCE(type, 'note'), content, created_at
FROM contact_notes;
