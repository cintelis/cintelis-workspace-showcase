-- Issue dependency relationships (blocker → blocked)
CREATE TABLE IF NOT EXISTS issue_dependencies (
  id TEXT PRIMARY KEY,
  blocker_issue_id TEXT NOT NULL,
  blocked_issue_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(blocker_issue_id, blocked_issue_id)
);
CREATE INDEX IF NOT EXISTS idx_deps_blocker ON issue_dependencies(blocker_issue_id);
CREATE INDEX IF NOT EXISTS idx_deps_blocked ON issue_dependencies(blocked_issue_id);
