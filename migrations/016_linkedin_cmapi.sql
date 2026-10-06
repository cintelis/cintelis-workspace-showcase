-- 016_linkedin_cmapi.sql
-- LinkedIn Community Management API (CMAPI) — page publishing, analytics, and
-- comment monitoring for the Totally Wild AI company page.
--
-- Reuses the shared OAuth token in linkedin_oauth (015). The connecting member
-- must hold an ADMINISTRATOR role on the page and the token must carry the
-- org-social scopes (w_organization_social, r_organization_social,
-- rw_organization_admin). The resolved organization id is cached in KV
-- (key `li_org_id`), not here.

-- Posts authored from the CRM. A row is created as a draft/scheduled item and
-- flipped to 'published' (with its returned LinkedIn URN) by the scheduler or
-- an explicit publish. Nothing is sent to LinkedIn until publish time.
CREATE TABLE IF NOT EXISTS linkedin_posts (
  id            TEXT PRIMARY KEY,
  body          TEXT NOT NULL,          -- commentary (little text format)
  visibility    TEXT NOT NULL DEFAULT 'PUBLIC',
  status        TEXT NOT NULL DEFAULT 'draft', -- draft | scheduled | published | failed
  scheduled_at  TEXT,                   -- ISO; when status='scheduled', publish at/after this
  published_at  TEXT,                   -- ISO; set when LinkedIn accepts it
  post_urn      TEXT,                   -- urn:li:share:... | urn:li:ugcPost:... (from x-restli-id)
  error         TEXT,                   -- last failure detail
  created_by    TEXT,                   -- user id
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_li_posts_due ON linkedin_posts (status, scheduled_at);

-- One row per UTC day: a snapshot of lifetime page analytics so we can chart
-- growth over time without re-querying history. Upserted by snapshot_date.
CREATE TABLE IF NOT EXISTS linkedin_stats (
  snapshot_date     TEXT PRIMARY KEY,   -- YYYY-MM-DD (UTC)
  follower_count    INTEGER,            -- networkSizes firstDegreeSize (total followers)
  impression_count  INTEGER,            -- lifetime organic share impressions
  unique_impressions INTEGER,
  click_count       INTEGER,
  like_count        INTEGER,
  comment_count     INTEGER,
  share_count       INTEGER,
  engagement        REAL,               -- LinkedIn's engagement ratio
  page_views        INTEGER,            -- lifetime allPageViews
  raw               TEXT,               -- full JSON blob of the three responses
  captured_at       TEXT NOT NULL       -- ISO timestamp of the snapshot run
);

-- Comments ingested from the page's own posts, for monitoring + reply.
-- comment_urn is the composite urn:li:comment:(threadUrn,commentId).
CREATE TABLE IF NOT EXISTS linkedin_comments (
  comment_urn   TEXT PRIMARY KEY,
  post_urn      TEXT,                   -- the share/ugcPost the comment is on (object field)
  actor         TEXT,                   -- author URN (person/org)
  message       TEXT,
  created_time  INTEGER,                -- ms since epoch (LinkedIn created.time)
  replied       INTEGER NOT NULL DEFAULT 0, -- 1 once we've replied as the page
  ingested_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_li_comments_time ON linkedin_comments (created_time DESC);
