-- Sprint 3: sprints + issue→sprint link
-- Apply: wrangler d1 execute outreach-db --remote --file=migrations/004_sprints.sql

CREATE TABLE IF NOT EXISTS sprints (
  id TEXT PRIMARY KEY,                    -- spr_{hex}
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,                     -- e.g. "Sprint 1", "Q2 hardening"
  goal TEXT NOT NULL DEFAULT '',          -- short markdown one-liner
  state TEXT NOT NULL DEFAULT 'planned',  -- planned | active | completed
  start_at TEXT,                          -- set when state goes active
  end_at TEXT,                            -- set when state goes completed
  planned_end_at TEXT,                    -- target end date set during planning (nullable)
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sprints_project_state ON sprints(project_id, state);
CREATE INDEX IF NOT EXISTS idx_sprints_state ON sprints(state);

-- Add sprint_id to issues. Existing rows default to NULL (= backlog).
ALTER TABLE issues ADD COLUMN sprint_id TEXT;
CREATE INDEX IF NOT EXISTS idx_issues_sprint ON issues(sprint_id, status);
