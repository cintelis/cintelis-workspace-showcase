-- Add start_at for roadmap/timeline view
ALTER TABLE issues ADD COLUMN start_at TEXT;
CREATE INDEX IF NOT EXISTS idx_issues_timeline ON issues(project_id, active, start_at, due_at);
