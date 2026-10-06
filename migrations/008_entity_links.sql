-- Sprint 6: cross-entity links (issues ↔ contacts ↔ doc pages)
-- Apply: wrangler d1 execute outreach-db --remote --file=migrations/008_entity_links.sql

CREATE TABLE IF NOT EXISTS entity_links (
  id TEXT PRIMARY KEY,                    -- elk_{hex}
  from_type TEXT NOT NULL,                -- 'issue' | 'doc_page' | 'contact'
  from_id TEXT NOT NULL,
  to_type TEXT NOT NULL,
  to_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(from_type, from_id, to_type, to_id)
);
CREATE INDEX IF NOT EXISTS idx_entity_links_from ON entity_links(from_type, from_id);
CREATE INDEX IF NOT EXISTS idx_entity_links_to ON entity_links(to_type, to_id);
