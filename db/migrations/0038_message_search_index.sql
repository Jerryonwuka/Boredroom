-- Personal assistants, phase 3 follow-up (review, 8 October 2026): an index for the assistant's message search
-- (server/services/catch-up.ts, searchMessages). The search filters by organisation and the last N days (90 by default),
-- optionally by who wrote the message, newest first; until now the only indexes on messages were
-- (conversation_id, created_at), task_id and reply_to_id, so every search read every organisation's messages.
-- Additive and idempotent: safe to run by hand twice. The code works the same before and after it runs (only faster).
-- Not CONCURRENTLY: the migration runner applies each file inside a transaction.

CREATE INDEX IF NOT EXISTS messages_org_created_idx ON messages(organisation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS messages_sender_created_idx ON messages(sender_membership_id, created_at DESC);
