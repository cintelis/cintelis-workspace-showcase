-- Sprint 6: app-wide settings (feature visibility, etc.)
-- Apply: wrangler d1 execute outreach-db --remote --file=migrations/009_app_settings.sql

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

-- Seed default feature visibility (everyone sees everything until admin opts out).
INSERT OR IGNORE INTO app_settings (key, value, updated_at, updated_by)
VALUES (
  'feature_visibility',
  '{"outreach":{"member":true,"viewer":true},"crm":{"member":true,"viewer":true},"tasks":{"member":true,"viewer":true},"docs":{"member":true,"viewer":true}}',
  datetime('now'),
  NULL
);
