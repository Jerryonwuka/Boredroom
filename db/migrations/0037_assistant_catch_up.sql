-- Personal assistants, phase 3 (owner decision, 8 October 2026). Three things the database has to hold so a person's
-- assistant can catch them up on Messages and, in later phases, talk in threads itself:
-- 1. Who wrote a message: the person ('person', the default and every existing row), the person's own assistant for
--    them after they confirmed it ('via_assistant'), or the assistant itself ('assistant': its own words in a thread,
--    written only by Boredroom's worker; reserved for phases 4 and 5, nothing writes it yet). An ordinary insert may only
--    be 'person' or 'via_assistant', and only as oneself; only the worker writes or changes an 'assistant' message, and
--    nobody but the worker changes author_kind after the insert (the trigger below, which also binds the table owner).
-- 2. What she read for the person: catch-up reads are logged in brenda_actions with source 'read'. They are the
--    person's alone: owners and HR keep seeing her actions organisation-wide, not what she read for someone.
-- 3. A ledger of every model call (ai_usage): who it was for (NULL for the workspace's own jobs), what for, the model
--    and the token counts from the API's usage block. People write their own rows, the worker any; people read their
--    own, owners and HR their organisation's. Nothing updates or deletes a row.
-- Additive and idempotent: safe to run by hand twice. Code deployed before this runs reads every message as the
-- person's, logs no reads, records no usage and applies no daily limit (server/lib/schema-0037).

-- 1. Who wrote a message ---------------------------------------------------------------------------------------------
ALTER TABLE messages ADD COLUMN IF NOT EXISTS author_kind text NOT NULL DEFAULT 'person';
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_author_kind_check;
ALTER TABLE messages ADD CONSTRAINT messages_author_kind_check CHECK (author_kind IN ('person', 'via_assistant', 'assistant'));

-- An ordinary insert: as oneself, into a conversation one can read, as the person or via one's own assistant.
DROP POLICY IF EXISTS messages_insert ON messages;
CREATE POLICY messages_insert ON messages FOR INSERT
  WITH CHECK (app_is_worker() OR (app_can_read_conversation(conversation_id) AND sender_membership_id = app_membership_id(organisation_id)
    AND author_kind IN ('person', 'via_assistant')));

-- The guard: row-level security cannot compare a row with its old self, so a trigger holds author_kind. It runs for
-- every role, the table owner included (data fixes set app.role = 'worker' first).
CREATE OR REPLACE FUNCTION messages_guard_author_kind() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF app_is_worker() THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.author_kind = 'assistant' THEN
      RAISE EXCEPTION 'ASSISTANT_AUTHOR: only Boredroom writes an assistant''s own messages' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.author_kind IS DISTINCT FROM OLD.author_kind THEN
    RAISE EXCEPTION 'AUTHOR_KIND_FIXED: who wrote a message cannot be changed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.author_kind = 'assistant' THEN
    RAISE EXCEPTION 'ASSISTANT_AUTHOR: only Boredroom changes an assistant''s own messages' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS messages_guard_author_kind ON messages;
CREATE TRIGGER messages_guard_author_kind BEFORE INSERT OR UPDATE ON messages FOR EACH ROW EXECUTE FUNCTION messages_guard_author_kind();

-- 2. What she read for the person -------------------------------------------------------------------------------------
ALTER TABLE brenda_actions DROP CONSTRAINT IF EXISTS brenda_actions_source_check;
ALTER TABLE brenda_actions ADD CONSTRAINT brenda_actions_source_check CHECK (source IN ('chat', 'confirm', 'automatic', 'read'));
DROP POLICY IF EXISTS brenda_actions_select ON brenda_actions;
CREATE POLICY brenda_actions_select ON brenda_actions FOR SELECT
  USING (app_is_worker() OR membership_id = app_membership_id(organisation_id) OR (source <> 'read' AND app_has_role(organisation_id, 'owner', 'hr')));

-- 3. The usage ledger -------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_usage (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id    uuid NOT NULL REFERENCES organisations(id),
  membership_id      uuid,                                   -- NULL: the workspace's own job (the end-of-day report)
  request_id         uuid NOT NULL DEFAULT gen_random_uuid(), -- one chat turn (several model calls) shares one
  purpose            text NOT NULL CONSTRAINT ai_usage_purpose_check CHECK (purpose IN ('chat', 'plan', 'report', 'summary', 'test', 'other')),
  model              text NOT NULL CONSTRAINT ai_usage_model_check CHECK (char_length(model) BETWEEN 1 AND 100),
  input_tokens       integer NOT NULL DEFAULT 0 CONSTRAINT ai_usage_input_check CHECK (input_tokens >= 0),
  output_tokens      integer NOT NULL DEFAULT 0 CONSTRAINT ai_usage_output_check CHECK (output_tokens >= 0),
  cache_read_tokens  integer NOT NULL DEFAULT 0 CONSTRAINT ai_usage_cache_read_check CHECK (cache_read_tokens >= 0),
  cache_write_tokens integer NOT NULL DEFAULT 0 CONSTRAINT ai_usage_cache_write_check CHECK (cache_write_tokens >= 0),
  created_at         timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (membership_id, organisation_id) REFERENCES memberships(id, organisation_id)
);
CREATE INDEX IF NOT EXISTS ai_usage_member_idx ON ai_usage(membership_id, created_at DESC) WHERE membership_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ai_usage_org_idx ON ai_usage(organisation_id, created_at DESC);

ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;
-- Written by the server as the person (their own row) or by the worker (any row, the workspace's included).
DROP POLICY IF EXISTS ai_usage_insert ON ai_usage;
CREATE POLICY ai_usage_insert ON ai_usage FOR INSERT
  WITH CHECK (app_is_worker() OR (membership_id IS NOT NULL AND membership_id = app_membership_id(organisation_id)));
-- Read: one's own rows; owners and HR the organisation's.
DROP POLICY IF EXISTS ai_usage_select ON ai_usage;
CREATE POLICY ai_usage_select ON ai_usage FOR SELECT
  USING (app_is_worker() OR membership_id = app_membership_id(organisation_id) OR app_has_role(organisation_id, 'owner', 'hr'));
-- No UPDATE or DELETE: the ledger is append-only. The schema's default privileges (0005) hand every new table UPDATE and
-- DELETE as well; without a policy those would only ever match nothing, but on this table they are taken away outright,
-- so a change is refused rather than quietly ignored (review, 8 October 2026).
GRANT SELECT, INSERT ON ai_usage TO boardroom_app;
REVOKE UPDATE, DELETE, TRUNCATE ON ai_usage FROM boardroom_app;
