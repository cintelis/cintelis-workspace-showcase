-- 015_linkedin_oauth.sql
-- LinkedIn Ad Library API — shared 3-legged OAuth member token.
-- Single-row table (id = 'shared'): an admin connects once and the token is
-- reused server-side for everyone's Ad Library / Brand Partnerships searches.
-- The token is never sent to the client.

CREATE TABLE IF NOT EXISTS linkedin_oauth (
  id                 TEXT PRIMARY KEY,  -- always 'shared'
  access_token       TEXT NOT NULL,
  refresh_token      TEXT,
  expires_at         INTEGER,           -- epoch ms when access_token expires
  refresh_expires_at INTEGER,           -- epoch ms when refresh_token expires
  scope              TEXT,
  connected_by       TEXT,              -- user id who authorized
  connected_by_email TEXT,
  connected_at       TEXT               -- ISO timestamp
);
