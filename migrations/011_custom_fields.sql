-- Custom field definitions per project
CREATE TABLE IF NOT EXISTS custom_field_defs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  field_type TEXT NOT NULL DEFAULT 'text',
  options TEXT NOT NULL DEFAULT '[]',
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cfd_project ON custom_field_defs(project_id, active, sort_order);

-- Custom field values per issue
CREATE TABLE IF NOT EXISTS custom_field_values (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL,
  field_def_id TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '',
  UNIQUE(issue_id, field_def_id)
);
CREATE INDEX IF NOT EXISTS idx_cfv_issue ON custom_field_values(issue_id);
CREATE INDEX IF NOT EXISTS idx_cfv_field ON custom_field_values(field_def_id);
