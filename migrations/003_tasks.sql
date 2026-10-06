-- Sprint 2: Tasks MVP — projects + issues
-- Activity comments live in the existing `activity` table from Sprint 1.
-- Apply: wrangler d1 execute outreach-db --remote --file=migrations/003_tasks.sql

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,                    -- prj_{hex}
  key TEXT UNIQUE NOT NULL,               -- e.g. ENG, OPS — uppercase, 2–10 chars
  name TEXT NOT NULL,
  description_md TEXT NOT NULL DEFAULT '',
  lead_user_id TEXT,                      -- nullable; FK app-enforced
  issue_seq INTEGER NOT NULL DEFAULT 0,   -- last-issued issue number for this project
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,               -- user_id
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_key ON projects(key);
CREATE INDEX IF NOT EXISTS idx_projects_active ON projects(active);

CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY,                    -- iss_{hex}
  project_id TEXT NOT NULL,
  issue_key TEXT NOT NULL,                -- denormalized for fast display, e.g. ENG-12
  issue_number INTEGER NOT NULL,          -- the N portion, for sorting
  title TEXT NOT NULL,
  description_md TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'task',      -- task | bug | story | epic
  status TEXT NOT NULL DEFAULT 'todo',    -- backlog | todo | in_progress | in_review | done
  priority TEXT NOT NULL DEFAULT 'medium',-- lowest | low | medium | high | highest
  assignee_id TEXT,                       -- nullable user_id
  reporter_id TEXT NOT NULL,              -- user_id who created
  parent_id TEXT,                         -- nullable; self-ref for sub-tasks
  due_at TEXT,                            -- ISO 8601 or NULL
  active INTEGER NOT NULL DEFAULT 1,      -- soft delete (cascaded from project soft-delete)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, issue_number)
);
CREATE INDEX IF NOT EXISTS idx_issues_project ON issues(project_id, active, status);
CREATE INDEX IF NOT EXISTS idx_issues_assignee ON issues(assignee_id, active);
CREATE INDEX IF NOT EXISTS idx_issues_key ON issues(issue_key);
CREATE INDEX IF NOT EXISTS idx_issues_parent ON issues(parent_id);
CREATE INDEX IF NOT EXISTS idx_issues_updated ON issues(updated_at DESC);
