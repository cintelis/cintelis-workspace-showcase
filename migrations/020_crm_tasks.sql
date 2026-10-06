-- 020: CRM tasks (sprint 13).
--
-- Until now the only "to-do" a contact could carry was contacts.follow_up_at:
-- one date, no type, no owner, no history. HubSpot users expect tasks — a
-- to-do / call / email / meeting with a due date, a priority and an owner,
-- listed in queues (due today, overdue, upcoming) and pinned on the record.
--
-- Same tenancy model as 019: customer_id NULL means Cintelis. A task belongs
-- to the tenant of its contact when it has one; the column is still stamped
-- at write time (scopedInsert) rather than derived, because tasks without a
-- contact are legitimate and because every list reads this table on its own.
--
-- follow_up_at is kept and stays the "next follow-up date" the Follow-ups page
-- and the board show; the backfill below turns every open follow-up into a
-- task once, and worker/crm-tasks.js keeps a contact's follow-up task and its
-- follow_up_at in step from then on.

CREATE TABLE IF NOT EXISTS crm_tasks (
  id            TEXT PRIMARY KEY,
  customer_id   TEXT,                          -- NULL = Cintelis internal
  contact_id    TEXT,                          -- optional; contacts.id
  title         TEXT NOT NULL,
  type          TEXT NOT NULL DEFAULT 'todo',  -- todo | call | email | meeting
  priority      TEXT NOT NULL DEFAULT 'medium',-- low | medium | high
  due_at        TEXT,                          -- ISO; date-only tasks use T00:00:00Z
  done_at       TEXT,
  owner_user_id TEXT,                          -- users.id
  notes         TEXT NOT NULL DEFAULT '',
  created_by    TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_crm_tasks_queue   ON crm_tasks(customer_id, done_at, due_at);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_contact ON crm_tasks(contact_id, done_at);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_owner   ON crm_tasks(owner_user_id, done_at, due_at);

-- Backfill: one open follow-up task per contact that has a follow-up date and
-- is still in play. Idempotent — a contact that already has an open task titled
-- this way is skipped, so re-running the file is safe.
INSERT INTO crm_tasks (id, customer_id, contact_id, title, type, priority, due_at, done_at, owner_user_id, notes, created_by, created_at, updated_at)
SELECT
  'tsk_' || lower(hex(randomblob(12))),
  c.customer_id,
  c.id,
  'Follow up with ' || COALESCE(NULLIF(c.name, ''), c.email),
  'todo',
  'medium',
  c.follow_up_at,
  NULL,
  NULL,
  '',
  NULL,
  strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
FROM contacts c
WHERE c.follow_up_at IS NOT NULL
  AND c.stage NOT IN ('won', 'lost')
  AND NOT EXISTS (
    SELECT 1 FROM crm_tasks t
    WHERE t.contact_id = c.id AND t.done_at IS NULL AND t.title LIKE 'Follow up with %'
  );
