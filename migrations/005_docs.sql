-- Sprint 4: Docs (spaces + pages + version history)
-- Apply: wrangler d1 execute outreach-db --remote --file=migrations/005_docs.sql

CREATE TABLE IF NOT EXISTS doc_spaces (
  id TEXT PRIMARY KEY,                    -- dsp_{hex}
  key TEXT UNIQUE NOT NULL,               -- short uppercase identifier
  name TEXT NOT NULL,
  description_md TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT '',          -- single emoji or short string
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_doc_spaces_key ON doc_spaces(key);
CREATE INDEX IF NOT EXISTS idx_doc_spaces_active ON doc_spaces(active);

CREATE TABLE IF NOT EXISTS doc_pages (
  id TEXT PRIMARY KEY,                    -- dpg_{hex}
  space_id TEXT NOT NULL,
  parent_id TEXT,                         -- nullable; self-FK for tree nesting
  title TEXT NOT NULL,
  slug TEXT NOT NULL DEFAULT '',          -- title-derived; unique within (space_id, parent_id)
  content_md TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,    -- sibling order within parent
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
  id TEXT PRIMARY KEY,                    -- dpv_{hex}
  page_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content_md TEXT NOT NULL DEFAULT '',
  author_id TEXT,
  created_at TEXT NOT NULL                -- snapshot timestamp
);
CREATE INDEX IF NOT EXISTS idx_doc_versions_page ON doc_page_versions(page_id, created_at DESC);
