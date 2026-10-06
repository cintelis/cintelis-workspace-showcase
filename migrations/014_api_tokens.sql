-- API tokens for programmatic access (non-session auth).
-- Tokens are issued with prefix `pat_` and a random body. Only the SHA-256
-- hash is stored. Lookup is by hash, never by plaintext.
CREATE TABLE IF NOT EXISTS api_tokens (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  owner_user_id TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'docs:write',
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_api_tokens_hash ON api_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_api_tokens_owner ON api_tokens(owner_user_id);
