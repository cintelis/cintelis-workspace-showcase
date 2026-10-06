-- Sprint 5: integrations + per-user notifications + activity consolidation
-- Apply: wrangler d1 execute outreach-db --remote --file=migrations/006_integrations_notifications.sql

CREATE TABLE IF NOT EXISTS integrations (
  id TEXT PRIMARY KEY,                    -- int_{hex}
  kind TEXT NOT NULL,                     -- 'discord' (extensible — telegram/slack later)
  name TEXT NOT NULL,                     -- human label, e.g. "Engineering channel"
  config TEXT NOT NULL,                   -- JSON: {webhook_url} for discord
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_integrations_kind_active ON integrations(kind, active);

CREATE TABLE IF NOT EXISTS notification_rules (
  id TEXT PRIMARY KEY,                    -- nrl_{hex}
  integration_id TEXT NOT NULL,
  event_type TEXT NOT NULL,               -- 'issue.created' | 'issue.assigned' | etc
  filter TEXT NOT NULL DEFAULT '{}',      -- JSON: {project_id?: ..., space_id?: ...}
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notification_rules_event ON notification_rules(event_type, active);
CREATE INDEX IF NOT EXISTS idx_notification_rules_integration ON notification_rules(integration_id);

CREATE TABLE IF NOT EXISTS notification_log (
  id TEXT PRIMARY KEY,                    -- nlg_{hex}
  integration_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  status TEXT NOT NULL,                   -- 'sent' | 'failed' | 'skipped'
  error TEXT,
  sent_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notification_log_sent ON notification_log(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_log_integration ON notification_log(integration_id, sent_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,                    -- ntf_{hex}
  user_id TEXT NOT NULL,                  -- target user
  kind TEXT NOT NULL,                     -- 'mention' | 'assignment' | 'comment' | 'status_change' | 'doc_update'
  entity_type TEXT NOT NULL,              -- 'issue' | 'doc_page' | 'contact'
  entity_id TEXT NOT NULL,                -- the source entity id
  title TEXT NOT NULL,                    -- one-line summary
  body TEXT NOT NULL DEFAULT '',          -- optional excerpt
  link TEXT,                              -- in-app deep link path
  actor_id TEXT,                          -- user who triggered the notification (nullable)
  read_at TEXT,                           -- nullable; null = unread
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, read_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_recent ON notifications(user_id, created_at DESC);

-- Drop the legacy contact_notes table — data was backfilled into `activity` in Sprint 1.
-- Verify the activity table has the rows first if you're nervous:
--   SELECT COUNT(*) FROM activity WHERE entity_type='contact';
DROP TABLE IF EXISTS contact_notes;
