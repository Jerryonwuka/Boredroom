-- Personal assistants, phase 5 (owner decision, 8 October 2026): @mentions in Messages. "@Max …" in a conversation
-- makes the person's OWN assistant reply in the thread; "@Ben" highlights Ben and notifies him. What the database holds:
-- 1. Two switches: a conversation's "Assistants can reply here" (conversations.assistant_replies) and the workspace's
--    "Let people ask their assistant in Messages" (brenda_settings.mention_replies). Both on by default.
-- 2. Who reads a conversation, item by item: definer functions that answer "can every current reader of this
--    conversation see this task, document or conversation?" for the assistant's audience rule, without telling the
--    caller anything about items or conversations they cannot see themselves.
-- 3. message_mentions: the mentions on a message, stored as written when it was sent (never re-parsed later). Readers
--    of the conversation read them; the sender writes them only with a fresh message of their own; nobody changes them.
-- 4. assistant_mentions: one row per message that tagged its sender's assistant, with its status machine (pending,
--    thinking, then answered, private, waiting_confirm, refused, failed or withdrawn) and the reply it posted. Readers
--    of the conversation read the status (the "Max is thinking…" row); the sender inserts only a new 'pending' row for
--    their own fresh message; every other change goes through Boredroom's worker role.
-- 5. assistant_mention_private: what only the person who tagged sees: a private answer, the full text of a long reply,
--    a note (refused, failed, no AI), the Confirm proposals with their signed tokens, and whether they posted or
--    dismissed it. Only the tagger reads it (while they can still read the conversation); only the worker writes it.
-- 6. ai_usage.purpose gains 'mention'.
-- Additive and idempotent: safe to run by hand twice. No existing policy, function or trigger is replaced. Code
-- deployed before this runs ignores mentions, offers no autocomplete and says so (server/lib/schema-0041).
-- Note for the owner: the schema's default privileges (0005) grant EXECUTE on every new function to boardroom_app; the
-- three internal app_member_* functions revoke it again below, so only the gated wrappers can be called. Both new
-- columns take a constant DEFAULT (no table rewrite, no row changed). Not CONCURRENTLY anywhere: the migration runner
-- applies each file inside a transaction.

-- 1. Switches --------------------------------------------------------------------------------------------------------
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS assistant_replies boolean NOT NULL DEFAULT true;
ALTER TABLE brenda_settings ADD COLUMN IF NOT EXISTS mention_replies boolean NOT NULL DEFAULT true;

-- 2. Who reads a conversation, item by item -----------------------------------------------------------------------------
-- Internal (EXECUTE revoked below): the same tests as app_can_read_conversation (0023), app_can_view_task (0005) and
-- documents_select (0028), for a given member instead of the caller. Keep them in step if those ever change.
CREATE OR REPLACE FUNCTION app_member_can_read_conversation(member uuid, conv uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM conversations c
    JOIN memberships mm ON mm.id = member AND mm.organisation_id = c.organisation_id AND mm.status = 'active'
    WHERE c.id = conv AND (
      c.kind = 'organisation'
      OR (c.kind = 'team' AND EXISTS (SELECT 1 FROM team_members tm WHERE tm.team_id = c.team_id AND tm.membership_id = member))
      OR (c.kind IN ('direct', 'channel') AND EXISTS (SELECT 1 FROM conversation_participants p WHERE p.conversation_id = c.id AND p.membership_id = member))))
$$;

CREATE OR REPLACE FUNCTION app_member_can_view_task(member uuid, task uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM tasks t
    JOIN memberships mm ON mm.id = member AND mm.organisation_id = t.organisation_id AND mm.status = 'active'
    WHERE t.id = task AND (
      mm.role IN ('owner', 'hr')
      OR member IN (t.assignee_membership_id, t.reviewer_membership_id, t.created_by)
      OR EXISTS (SELECT 1 FROM team_members mgr JOIN team_members tm ON tm.team_id = mgr.team_id
                 WHERE mgr.organisation_id = t.organisation_id AND mgr.is_manager AND mgr.membership_id = member AND tm.membership_id = t.assignee_membership_id)
      OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = t.project_id AND pm.membership_id = member)))
$$;

CREATE OR REPLACE FUNCTION app_member_can_read_doc(member uuid, doc uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM documents d
    JOIN memberships mm ON mm.id = member AND mm.organisation_id = d.organisation_id AND mm.status = 'active'
    WHERE d.id = doc AND d.archived_at IS NULL AND (
      d.visibility = 'organisation'
      OR d.created_by = member
      OR (d.visibility = 'team' AND EXISTS (SELECT 1 FROM team_members tm WHERE tm.team_id = d.team_id AND tm.membership_id = member))
      OR mm.role IN ('owner', 'hr')))
$$;

REVOKE ALL ON FUNCTION app_member_can_read_conversation(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_member_can_view_task(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_member_can_read_doc(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_member_can_read_conversation(uuid, uuid) FROM boardroom_app;
REVOKE ALL ON FUNCTION app_member_can_view_task(uuid, uuid) FROM boardroom_app;
REVOKE ALL ON FUNCTION app_member_can_read_doc(uuid, uuid) FROM boardroom_app;

-- Whether `member` currently reads `conv`. Only the worker, or someone who reads `conv` themself, gets an answer.
CREATE OR REPLACE FUNCTION app_conversation_has_reader(conv uuid, member uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (app_is_worker() OR app_can_read_conversation(conv)) AND app_member_can_read_conversation(member, conv)
$$;
GRANT EXECUTE ON FUNCTION app_conversation_has_reader(uuid, uuid) TO boardroom_app;

-- Everyone who currently reads `conv` (active members only). Empty unless the caller is the worker or reads it.
CREATE OR REPLACE FUNCTION app_conversation_readers(conv uuid) RETURNS TABLE(membership_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.id FROM conversations c
  JOIN memberships m ON m.organisation_id = c.organisation_id AND m.status = 'active'
  WHERE c.id = conv AND (app_is_worker() OR app_can_read_conversation(conv)) AND app_member_can_read_conversation(m.id, conv)
$$;
GRANT EXECUTE ON FUNCTION app_conversation_readers(uuid) TO boardroom_app;

-- The assistant's audience rule: true when EVERY current reader of `conv` can see the item ('task', 'doc' or
-- 'conversation'). The caller must read `conv` and see the item themself (else false: nothing is learnt about items
-- they cannot see); the worker may ask about anything. A conversation always covers itself; a person's own to-do never
-- counts as public.
CREATE OR REPLACE FUNCTION app_visible_to_readers(conv uuid, item_kind text, item uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE org uuid; me uuid; t record;
BEGIN
  SELECT organisation_id INTO org FROM conversations WHERE id = conv;
  IF NOT FOUND OR item IS NULL THEN RETURN false; END IF;
  IF NOT (app_is_worker() OR app_can_read_conversation(conv)) THEN RETURN false; END IF;
  me := app_membership_id(org);
  IF item_kind = 'task' THEN
    SELECT tk.assignee_membership_id, tk.reviewer_membership_id, tk.created_by, tk.project_id INTO t
      FROM tasks tk WHERE tk.id = item AND tk.organisation_id = org;
    IF NOT FOUND THEN RETURN false; END IF;
    IF NOT app_is_worker() AND NOT app_can_view_task(org, t.assignee_membership_id, t.reviewer_membership_id, t.created_by, t.project_id) THEN RETURN false; END IF;
    -- A person's own to-do (made by its holder) is their own data: never public in a thread, however many can open it
    -- (review, 8 October 2026; follow-ups never share one either, 0039).
    IF t.created_by = t.assignee_membership_id THEN RETURN false; END IF;
    RETURN NOT EXISTS (SELECT 1 FROM app_conversation_readers(conv) r WHERE NOT app_member_can_view_task(r.membership_id, item));
  ELSIF item_kind = 'doc' THEN
    IF NOT EXISTS (SELECT 1 FROM documents d WHERE d.id = item AND d.organisation_id = org) THEN RETURN false; END IF;
    IF NOT app_is_worker() AND NOT app_member_can_read_doc(me, item) THEN RETURN false; END IF;
    RETURN NOT EXISTS (SELECT 1 FROM app_conversation_readers(conv) r WHERE NOT app_member_can_read_doc(r.membership_id, item));
  ELSIF item_kind = 'conversation' THEN
    IF item = conv THEN RETURN true; END IF;
    IF NOT EXISTS (SELECT 1 FROM conversations o WHERE o.id = item AND o.organisation_id = org) THEN RETURN false; END IF;
    IF NOT app_is_worker() AND NOT app_can_read_conversation(item) THEN RETURN false; END IF;
    RETURN NOT EXISTS (SELECT 1 FROM app_conversation_readers(conv) r WHERE NOT app_member_can_read_conversation(r.membership_id, item));
  END IF;
  RETURN false;
END $$;
GRANT EXECUTE ON FUNCTION app_visible_to_readers(uuid, text, uuid) TO boardroom_app;

-- Who runs a conversation's assistant switch and may withdraw an assistant's reply in it (review, 8 October 2026):
-- a named channel's creator, owner or HR; either person in a direct thread; owners and HR for Everyone; owners, HR and
-- the team's leads for a team channel; always only while they read the conversation.
CREATE OR REPLACE FUNCTION app_can_manage_conversation(conv uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_is_worker() OR EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = conv AND app_can_read_conversation(conv) AND (
      (c.kind = 'channel' AND (c.created_by = app_membership_id(c.organisation_id) OR app_has_role(c.organisation_id, 'owner', 'hr')))
      OR c.kind = 'direct'
      OR (c.kind = 'organisation' AND app_has_role(c.organisation_id, 'owner', 'hr'))
      OR (c.kind = 'team' AND (app_has_role(c.organisation_id, 'owner', 'hr') OR EXISTS (
            SELECT 1 FROM team_members tm WHERE tm.team_id = c.team_id AND tm.is_manager AND tm.membership_id = app_membership_id(c.organisation_id))))))
$$;
GRANT EXECUTE ON FUNCTION app_can_manage_conversation(uuid) TO boardroom_app;

-- "Assistants can reply here": only through this function (the app role cannot update conversations).
CREATE OR REPLACE FUNCTION app_conversation_set_assistant_replies(conv uuid, allowed boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF allowed IS NULL THEN RAISE EXCEPTION 'ASSISTANT_REPLIES_INVALID' USING ERRCODE = 'check_violation'; END IF;
  IF NOT app_can_manage_conversation(conv) THEN RAISE EXCEPTION 'CONVERSATION_FORBIDDEN' USING ERRCODE = 'insufficient_privilege'; END IF;
  UPDATE conversations SET assistant_replies = allowed WHERE id = conv;
END $$;
GRANT EXECUTE ON FUNCTION app_conversation_set_assistant_replies(uuid, boolean) TO boardroom_app;

-- 3. Mentions on a message --------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS message_mentions (
  message_id       uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  conversation_id  uuid NOT NULL,
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  kind             text NOT NULL CONSTRAINT message_mentions_kind_check CHECK (kind IN ('person', 'assistant')),
  membership_id    uuid NOT NULL,                       -- person: who was mentioned; assistant: whose (always the sender)
  label            text NOT NULL CONSTRAINT message_mentions_label_check CHECK (char_length(label) BETWEEN 2 AND 121 AND left(label, 1) = '@'),
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, kind, membership_id),
  FOREIGN KEY (conversation_id, organisation_id) REFERENCES conversations(id, organisation_id) ON DELETE CASCADE,
  FOREIGN KEY (membership_id, organisation_id) REFERENCES memberships(id, organisation_id)
);
CREATE INDEX IF NOT EXISTS message_mentions_member_idx ON message_mentions(membership_id, created_at DESC);
CREATE INDEX IF NOT EXISTS message_mentions_conversation_idx ON message_mentions(conversation_id);

ALTER TABLE message_mentions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS message_mentions_select ON message_mentions;
CREATE POLICY message_mentions_select ON message_mentions FOR SELECT
  USING (app_is_worker() OR app_can_read_conversation(conversation_id));
-- The sender, with a fresh, unedited text message of their own (inserted in the same transaction): their own assistant,
-- or someone else who reads the conversation. Edits can never add one.
DROP POLICY IF EXISTS message_mentions_insert ON message_mentions;
CREATE POLICY message_mentions_insert ON message_mentions FOR INSERT
  WITH CHECK (app_is_worker() OR (
    EXISTS (SELECT 1 FROM messages m
            WHERE m.id = message_id AND m.conversation_id = message_mentions.conversation_id AND m.organisation_id = message_mentions.organisation_id
              AND m.sender_membership_id = app_membership_id(m.organisation_id) AND m.author_kind = 'person'
              AND m.deleted_at IS NULL AND m.edited_at IS NULL AND m.voice_key IS NULL AND m.created_at >= now() - interval '1 minute')
    AND ((kind = 'assistant' AND membership_id = app_membership_id(organisation_id))
         OR (kind = 'person' AND membership_id <> app_membership_id(organisation_id) AND app_conversation_has_reader(conversation_id, membership_id)))));
GRANT SELECT, INSERT ON message_mentions TO boardroom_app;
REVOKE UPDATE, DELETE, TRUNCATE ON message_mentions FROM boardroom_app;

-- 4. The queue: one row per message that tagged its sender's own assistant ------------------------------------------
CREATE TABLE IF NOT EXISTS assistant_mentions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id       uuid NOT NULL REFERENCES organisations(id),
  conversation_id       uuid NOT NULL,
  message_id            uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,   -- the tagging message
  tagger_membership_id  uuid NOT NULL,
  status                text NOT NULL DEFAULT 'pending' CONSTRAINT assistant_mentions_status_check
                          CHECK (status IN ('pending', 'thinking', 'answered', 'private', 'waiting_confirm', 'refused', 'failed', 'withdrawn')),
  reply_message_id      uuid REFERENCES messages(id) ON DELETE SET NULL,          -- the assistant's own public reply
  engine                text CONSTRAINT assistant_mentions_engine_check CHECK (engine IN ('claude', 'builtin')),
  attempts              smallint NOT NULL DEFAULT 0,
  lease_until           timestamptz,
  confirm_until         timestamptz,       -- waiting_confirm: "Waiting for Olu to confirm" shows until then
  started_at            timestamptz,       -- first claimed (what the limits count)
  finished_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id),
  UNIQUE (id, organisation_id),
  FOREIGN KEY (conversation_id, organisation_id) REFERENCES conversations(id, organisation_id) ON DELETE CASCADE,
  FOREIGN KEY (tagger_membership_id, organisation_id) REFERENCES memberships(id, organisation_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS assistant_mentions_reply_idx ON assistant_mentions(reply_message_id) WHERE reply_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS assistant_mentions_conversation_idx ON assistant_mentions(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS assistant_mentions_tagger_idx ON assistant_mentions(tagger_membership_id, started_at DESC);
CREATE INDEX IF NOT EXISTS assistant_mentions_org_idx ON assistant_mentions(organisation_id, started_at DESC);
CREATE INDEX IF NOT EXISTS assistant_mentions_open_idx ON assistant_mentions(updated_at) WHERE status IN ('pending', 'thinking', 'waiting_confirm');

DROP TRIGGER IF EXISTS assistant_mentions_updated ON assistant_mentions;
CREATE TRIGGER assistant_mentions_updated BEFORE UPDATE ON assistant_mentions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- Realtime: ids only. A new row, then only what a thread shows (status, the reply, the Confirm window); leases stay quiet.
DROP TRIGGER IF EXISTS assistant_mentions_notify_insert ON assistant_mentions;
CREATE TRIGGER assistant_mentions_notify_insert AFTER INSERT ON assistant_mentions FOR EACH ROW EXECUTE FUNCTION notify_org_change();
DROP TRIGGER IF EXISTS assistant_mentions_notify ON assistant_mentions;
CREATE TRIGGER assistant_mentions_notify AFTER UPDATE ON assistant_mentions FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.reply_message_id IS DISTINCT FROM NEW.reply_message_id OR OLD.confirm_until IS DISTINCT FROM NEW.confirm_until)
  EXECUTE FUNCTION notify_org_change();

ALTER TABLE assistant_mentions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assistant_mentions_select ON assistant_mentions;
CREATE POLICY assistant_mentions_select ON assistant_mentions FOR SELECT
  USING (app_is_worker() OR app_can_read_conversation(conversation_id));
-- The tagger inserts only a new, untouched 'pending' row for their own fresh text message that carries the assistant
-- mention (message_mentions, inserted first in the same transaction).
DROP POLICY IF EXISTS assistant_mentions_insert ON assistant_mentions;
CREATE POLICY assistant_mentions_insert ON assistant_mentions FOR INSERT
  WITH CHECK (app_is_worker() OR (
    tagger_membership_id = app_membership_id(organisation_id)
    AND status = 'pending' AND reply_message_id IS NULL AND engine IS NULL AND attempts = 0 AND lease_until IS NULL
    AND confirm_until IS NULL AND started_at IS NULL AND finished_at IS NULL
    AND EXISTS (SELECT 1 FROM messages m
                WHERE m.id = message_id AND m.conversation_id = assistant_mentions.conversation_id AND m.organisation_id = assistant_mentions.organisation_id
                  AND m.sender_membership_id = assistant_mentions.tagger_membership_id AND m.author_kind = 'person'
                  AND m.deleted_at IS NULL AND m.edited_at IS NULL AND m.voice_key IS NULL AND m.created_at >= now() - interval '1 minute')
    AND EXISTS (SELECT 1 FROM message_mentions mm
                WHERE mm.message_id = assistant_mentions.message_id AND mm.kind = 'assistant' AND mm.membership_id = assistant_mentions.tagger_membership_id)));
DROP POLICY IF EXISTS assistant_mentions_update ON assistant_mentions;
CREATE POLICY assistant_mentions_update ON assistant_mentions FOR UPDATE USING (app_is_worker()) WITH CHECK (app_is_worker());
GRANT SELECT, INSERT, UPDATE ON assistant_mentions TO boardroom_app;
REVOKE DELETE, TRUNCATE ON assistant_mentions FROM boardroom_app;

-- 5. What only the tagger sees ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assistant_mention_private (
  mention_id            uuid PRIMARY KEY,
  organisation_id       uuid NOT NULL REFERENCES organisations(id),
  tagger_membership_id  uuid NOT NULL,
  kind                  text NOT NULL CONSTRAINT assistant_mention_private_kind_check CHECK (kind IN ('answer', 'full_answer', 'note')),
  body                  text CONSTRAINT assistant_mention_private_body_check CHECK (body IS NULL OR char_length(body) BETWEEN 1 AND 4000),
  note_code             text CONSTRAINT assistant_mention_private_note_check CHECK (note_code IS NULL OR note_code IN (
                          'off_workspace', 'off_conversation', 'archived', 'limit_minute', 'limit_day', 'limit_conversation',
                          'limit_workspace', 'allowance', 'no_ai', 'not_allowed', 'failed')),
  proposals             jsonb NOT NULL DEFAULT '[]'::jsonb CONSTRAINT assistant_mention_private_proposals_check CHECK (jsonb_typeof(proposals) = 'array'),
  posted_message_id     uuid REFERENCES messages(id) ON DELETE SET NULL,
  posted_at             timestamptz,
  dismissed_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assistant_mention_private_shape_check CHECK (kind = 'note' OR body IS NOT NULL),
  FOREIGN KEY (mention_id, organisation_id) REFERENCES assistant_mentions(id, organisation_id) ON DELETE CASCADE,
  FOREIGN KEY (tagger_membership_id, organisation_id) REFERENCES memberships(id, organisation_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS assistant_mention_private_posted_idx ON assistant_mention_private(posted_message_id) WHERE posted_message_id IS NOT NULL;
DROP TRIGGER IF EXISTS assistant_mention_private_updated ON assistant_mention_private;
CREATE TRIGGER assistant_mention_private_updated BEFORE UPDATE ON assistant_mention_private FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- No change events: it has no `id` column (notify_org_change sends NEW.id) and every change the thread shows also
-- changes the public row or posts a message; the tagger's own page refreshes after each press.

ALTER TABLE assistant_mention_private ENABLE ROW LEVEL SECURITY;
-- The tagger alone, and only while they can still read the conversation (the public row's policy decides that).
DROP POLICY IF EXISTS assistant_mention_private_select ON assistant_mention_private;
CREATE POLICY assistant_mention_private_select ON assistant_mention_private FOR SELECT
  USING (app_is_worker() OR (tagger_membership_id = app_membership_id(organisation_id)
         AND EXISTS (SELECT 1 FROM assistant_mentions a WHERE a.id = mention_id)));
DROP POLICY IF EXISTS assistant_mention_private_insert ON assistant_mention_private;
CREATE POLICY assistant_mention_private_insert ON assistant_mention_private FOR INSERT WITH CHECK (app_is_worker());
DROP POLICY IF EXISTS assistant_mention_private_update ON assistant_mention_private;
CREATE POLICY assistant_mention_private_update ON assistant_mention_private FOR UPDATE USING (app_is_worker()) WITH CHECK (app_is_worker());
GRANT SELECT, INSERT, UPDATE ON assistant_mention_private TO boardroom_app;
REVOKE DELETE, TRUNCATE ON assistant_mention_private FROM boardroom_app;

-- 6. The usage ledger's purposes -------------------------------------------------------------------------------------
ALTER TABLE ai_usage DROP CONSTRAINT IF EXISTS ai_usage_purpose_check;
ALTER TABLE ai_usage ADD CONSTRAINT ai_usage_purpose_check CHECK (purpose IN ('chat', 'plan', 'report', 'summary', 'test', 'other', 'followup', 'mention'));
