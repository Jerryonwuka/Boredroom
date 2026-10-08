-- Personal assistants, phase 6 (owner decision, 8 October 2026): assistants talk to each other. "I want all the bots to
-- be able to communicate with each other." Four abilities, all through an assistant inbox ("Between assistants"), never
-- through Messages threads:
-- 1. assistant_items: one row per thing one person's assistant brings another (a message passed on, a request to accept,
--    a one-line reply to a message) or a note for today's end-of-day team report (recipient NULL: the workspace's own
--    assistant). What was sent never changes (assistant_items_guard, every role); the status machine is guarded too.
--    Sender and recipient read their own; a report note is read by its author and by the people who may view the author's
--    records (the report's audience: their team leads, the owner and HR). The sender inserts only a fresh 'delivered' row
--    they are allowed to send (app_assistant_item_refusal: not muted, an active member, not themself; for a report note
--    the switches and the time); the recipient alone marks seen, accepts or declines (definer functions); the sender alone
--    cancels a request or withdraws a note; Boredroom's worker role does the rest. No DELETE.
-- 2. assistant_item_mutes: a person stops new items from one colleague's assistant. Only that person reads or writes it.
-- 3. Tagging someone else's assistant in Messages ("@Ben's Brenda, where is the deck?"): assistant_mentions gains the
--    assistant's owner, the follow-up it asked, the "I've asked Ben" message and the status 'asked'; message_mentions
--    accepts another reader's assistant when they allow it (assistant_profiles.allow_thread_replies, on by default).
-- 4. Switches: assistant_profiles.allow_thread_replies (the person's), brenda_settings.report_notes (owners and HR).
-- 5. follow_ups.thread_mode: a follow-up asked in a thread ('facts': answer from the work when it can; 'ask': always ask).
-- Additive and idempotent: safe to run by hand twice. Replaced, old semantics kept exactly plus the change: the insert
-- policies of message_mentions and assistant_mentions, and the check constraints assistant_mentions_status_check,
-- assistant_mention_private_note_check and message_mentions_label_check (old text in the phase 6 contract, A.1). Code
-- deployed before this runs offers none of it and says so (server/lib/schema-0043).

-- 1. Switches ---------------------------------------------------------------------------------------------------------
-- 0035's policies cover the profile column (members read; the person writes theirs); 0026's cover brenda_settings.
ALTER TABLE assistant_profiles ADD COLUMN IF NOT EXISTS allow_thread_replies boolean NOT NULL DEFAULT true;
ALTER TABLE brenda_settings ADD COLUMN IF NOT EXISTS report_notes boolean NOT NULL DEFAULT true;

-- 2. When today's report is written (a report note's cutoff), on the organisation's clock. Invoker: members read both.
CREATE OR REPLACE FUNCTION app_report_cutoff(org uuid, d date) RETURNS timestamptz
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT ((d + COALESCE(b.daily_report_time, time '18:00'))::timestamp AT TIME ZONE o.timezone)
  FROM organisations o LEFT JOIN brenda_settings b ON b.organisation_id = o.id WHERE o.id = org
$$;
GRANT EXECUTE ON FUNCTION app_report_cutoff(uuid, date) TO boardroom_app;

-- 3. Mutes ------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assistant_item_mutes (
  organisation_id         uuid NOT NULL REFERENCES organisations(id),
  recipient_membership_id uuid NOT NULL,
  sender_membership_id    uuid NOT NULL,
  muted                   boolean NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (recipient_membership_id, sender_membership_id),
  FOREIGN KEY (recipient_membership_id, organisation_id) REFERENCES memberships(id, organisation_id),
  FOREIGN KEY (sender_membership_id, organisation_id) REFERENCES memberships(id, organisation_id),
  CONSTRAINT assistant_item_mutes_not_self_check CHECK (recipient_membership_id <> sender_membership_id)
);
DROP TRIGGER IF EXISTS assistant_item_mutes_updated ON assistant_item_mutes;
CREATE TRIGGER assistant_item_mutes_updated BEFORE UPDATE ON assistant_item_mutes FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE assistant_item_mutes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assistant_item_mutes_own ON assistant_item_mutes;
CREATE POLICY assistant_item_mutes_own ON assistant_item_mutes FOR ALL
  USING (app_is_worker() OR recipient_membership_id = app_membership_id(organisation_id))
  WITH CHECK (app_is_worker() OR recipient_membership_id = app_membership_id(organisation_id));
-- Unmuting sets muted = false: no DELETE.
GRANT SELECT, INSERT, UPDATE ON assistant_item_mutes TO boardroom_app;
REVOKE DELETE, TRUNCATE ON assistant_item_mutes FROM boardroom_app;

-- 4. Who may send what --------------------------------------------------------------------------------------------------
-- NULL when the signed-in person may send an item of `item_kind` to `recipient` (NULL for a report note); otherwise why
-- not: 'not_member', 'self', 'muted' (the recipient muted the sender's assistant; replies to the recipient's own message
-- are never muted), 'bad_kind', 'notes_off', 'report_off', 'too_late' (today's report has been written). Definer: the
-- sender cannot read the recipient's mutes; it answers with a code, nothing else.
CREATE OR REPLACE FUNCTION app_assistant_item_refusal(org uuid, recipient uuid, item_kind text) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := app_membership_id(org); s record;
BEGIN
  IF me IS NULL THEN RETURN 'not_member'; END IF;
  IF item_kind = 'report_note' THEN
    IF recipient IS NOT NULL THEN RETURN 'bad_kind'; END IF;
    SELECT COALESCE(b.report_notes, true) AS notes, COALESCE(b.daily_report_enabled, true) AS report INTO s
      FROM organisations o LEFT JOIN brenda_settings b ON b.organisation_id = o.id WHERE o.id = org;
    IF NOT s.report THEN RETURN 'report_off'; END IF;
    IF NOT s.notes THEN RETURN 'notes_off'; END IF;
    IF now() >= app_report_cutoff(org, (now() AT TIME ZONE (SELECT timezone FROM organisations WHERE id = org))::date) THEN RETURN 'too_late'; END IF;
    RETURN NULL;
  END IF;
  IF item_kind IS NULL OR item_kind NOT IN ('message', 'request', 'reply') THEN RETURN 'bad_kind'; END IF;
  IF recipient IS NULL THEN RETURN 'not_member'; END IF;
  IF recipient = me THEN RETURN 'self'; END IF;
  IF NOT EXISTS (SELECT 1 FROM memberships m WHERE m.id = recipient AND m.organisation_id = org AND m.status = 'active') THEN RETURN 'not_member'; END IF;
  IF item_kind <> 'reply' AND EXISTS (SELECT 1 FROM assistant_item_mutes x WHERE x.recipient_membership_id = recipient AND x.sender_membership_id = me AND x.muted) THEN RETURN 'muted'; END IF;
  RETURN NULL;
END $$;
GRANT EXECUTE ON FUNCTION app_assistant_item_refusal(uuid, uuid, text) TO boardroom_app;

-- A request about a task: NULL when the signed-in sender can see `task` (not archived) and the recipient could do it
-- themself: 'task_status' only on a task the recipient holds; 'task_comment' only on a task the recipient can see.
-- Otherwise 'task_not_found' (missing, archived or not visible to the sender: one word), 'not_theirs', 'not_visible',
-- 'bad_kind'. Definer: it looks at what the recipient can see (0041's internal app_member_can_view_task).
CREATE OR REPLACE FUNCTION app_assistant_item_task_refusal(task uuid, recipient uuid, req text) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE t record;
BEGIN
  SELECT tk.organisation_id, tk.assignee_membership_id, tk.reviewer_membership_id, tk.created_by, tk.project_id, tk.archived_at INTO t
    FROM tasks tk WHERE tk.id = task;
  IF NOT FOUND OR app_membership_id(t.organisation_id) IS NULL OR t.archived_at IS NOT NULL
     OR NOT app_can_view_task(t.organisation_id, t.assignee_membership_id, t.reviewer_membership_id, t.created_by, t.project_id) THEN RETURN 'task_not_found'; END IF;
  IF req = 'task_status' THEN
    IF t.assignee_membership_id IS DISTINCT FROM recipient THEN RETURN 'not_theirs'; END IF;
    RETURN NULL;
  ELSIF req = 'task_comment' THEN
    IF NOT app_member_can_view_task(recipient, task) THEN RETURN 'not_visible'; END IF;
    RETURN NULL;
  END IF;
  RETURN 'bad_kind';
END $$;
GRANT EXECUTE ON FUNCTION app_assistant_item_task_refusal(uuid, uuid, text) TO boardroom_app;

-- 5. Items ------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assistant_items (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id         uuid NOT NULL REFERENCES organisations(id),
  kind                    text NOT NULL CONSTRAINT assistant_items_kind_check CHECK (kind IN ('message', 'request', 'reply', 'report_note')),
  sender_membership_id    uuid NOT NULL,
  recipient_membership_id uuid,                 -- NULL only for a report note (the workspace)
  parent_id               uuid,                 -- a reply: the message it answers
  body                    text,                 -- the sender's words as sent (a request: the sender's optional note)
  tidied                  boolean NOT NULL DEFAULT false,   -- the sender asked their assistant to reword it
  request_kind            text CONSTRAINT assistant_items_request_kind_check CHECK (request_kind IN ('add_todo', 'set_reminder', 'task_status', 'task_comment')),
  payload                 jsonb NOT NULL DEFAULT '{}'::jsonb CONSTRAINT assistant_items_payload_check CHECK (jsonb_typeof(payload) = 'object'),
  task_id                 uuid,                 -- task_status and task_comment
  report_date             date,                 -- a report note: the organisation's local date of the report
  conversation_id         uuid,                 -- came from Messages (no FK: channels can be deleted)
  mention_id              uuid,                 -- the assistant mention it came from (no FK, same reason)
  status                  text NOT NULL DEFAULT 'delivered' CONSTRAINT assistant_items_status_check
                            CHECK (status IN ('delivered', 'seen', 'accepted', 'declined', 'done', 'failed', 'expired', 'cancelled', 'withdrawn')),
  decline_reason          text CONSTRAINT assistant_items_decline_reason_check CHECK (decline_reason IS NULL OR char_length(decline_reason) BETWEEN 1 AND 280),
  result_code             text CONSTRAINT assistant_items_result_code_check
                            CHECK (result_code IN ('done', 'not_allowed', 'task_gone', 'bad_transition', 'in_past', 'no_todos', 'invalid', 'interrupted', 'error')),
  result                  jsonb NOT NULL DEFAULT '{}'::jsonb CONSTRAINT assistant_items_result_check CHECK (jsonb_typeof(result) = 'object'),
  lease_until             timestamptz,
  seen_at                 timestamptz,
  decided_at              timestamptz,
  finished_at             timestamptz,
  expires_at              timestamptz,          -- a request: when it expires; a report note: the report's cutoff
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organisation_id),
  FOREIGN KEY (sender_membership_id, organisation_id) REFERENCES memberships(id, organisation_id),
  FOREIGN KEY (recipient_membership_id, organisation_id) REFERENCES memberships(id, organisation_id),
  FOREIGN KEY (parent_id, organisation_id) REFERENCES assistant_items(id, organisation_id),
  FOREIGN KEY (task_id, organisation_id) REFERENCES tasks(id, organisation_id),
  CONSTRAINT assistant_items_recipient_shape_check CHECK ((kind = 'report_note') = (recipient_membership_id IS NULL)),
  CONSTRAINT assistant_items_not_self_check CHECK (recipient_membership_id IS DISTINCT FROM sender_membership_id),
  CONSTRAINT assistant_items_parent_shape_check CHECK ((kind = 'reply') = (parent_id IS NOT NULL)),
  CONSTRAINT assistant_items_request_shape_check CHECK (
    (kind = 'request') = (request_kind IS NOT NULL)
    AND (kind = 'request' OR payload = '{}'::jsonb)
    AND ((request_kind IN ('task_status', 'task_comment')) IS NOT DISTINCT FROM (task_id IS NOT NULL) OR kind <> 'request')
    AND (kind = 'request' OR task_id IS NULL)),
  CONSTRAINT assistant_items_report_shape_check CHECK ((kind = 'report_note') = (report_date IS NOT NULL)),
  CONSTRAINT assistant_items_body_check CHECK (
    CASE kind WHEN 'message' THEN body IS NOT NULL AND char_length(body) BETWEEN 1 AND 1000
              WHEN 'reply' THEN body IS NOT NULL AND char_length(body) BETWEEN 1 AND 280
              WHEN 'report_note' THEN body IS NOT NULL AND char_length(body) BETWEEN 1 AND 500
              ELSE body IS NULL OR char_length(body) BETWEEN 1 AND 280 END),
  CONSTRAINT assistant_items_tidied_check CHECK (NOT tidied OR kind IN ('message', 'report_note')),
  CONSTRAINT assistant_items_status_kind_check CHECK (
    CASE kind WHEN 'request' THEN status IN ('delivered', 'seen', 'accepted', 'declined', 'done', 'failed', 'expired', 'cancelled')
              WHEN 'report_note' THEN status IN ('delivered', 'done', 'expired', 'withdrawn')
              ELSE status IN ('delivered', 'seen') END),
  CONSTRAINT assistant_items_expiry_check CHECK (kind NOT IN ('request', 'report_note') OR expires_at IS NOT NULL),
  CONSTRAINT assistant_items_result_shape_check CHECK (
    CASE WHEN kind = 'request' THEN (status IN ('done', 'failed')) = (result_code IS NOT NULL) ELSE result_code IS NULL END),
  CONSTRAINT assistant_items_decline_shape_check CHECK (decline_reason IS NULL OR status = 'declined')
);
CREATE INDEX IF NOT EXISTS assistant_items_recipient_idx ON assistant_items(recipient_membership_id, created_at DESC) WHERE recipient_membership_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS assistant_items_sender_idx ON assistant_items(sender_membership_id, created_at DESC);
CREATE INDEX IF NOT EXISTS assistant_items_pair_idx ON assistant_items(sender_membership_id, recipient_membership_id, created_at DESC) WHERE kind IN ('message', 'request');
CREATE UNIQUE INDEX IF NOT EXISTS assistant_items_one_reply_idx ON assistant_items(parent_id) WHERE kind = 'reply';
CREATE INDEX IF NOT EXISTS assistant_items_open_requests_idx ON assistant_items(expires_at) WHERE kind = 'request' AND status IN ('delivered', 'seen');
CREATE INDEX IF NOT EXISTS assistant_items_accepted_idx ON assistant_items(decided_at) WHERE status = 'accepted';
CREATE INDEX IF NOT EXISTS assistant_items_report_idx ON assistant_items(organisation_id, report_date) WHERE kind = 'report_note';
CREATE INDEX IF NOT EXISTS assistant_items_open_notes_idx ON assistant_items(expires_at) WHERE kind = 'report_note' AND status = 'delivered';
CREATE INDEX IF NOT EXISTS assistant_items_mention_idx ON assistant_items(mention_id) WHERE mention_id IS NOT NULL;

-- What was sent never changes, and the status moves only forward, for every role (the table owner included; a data fix
-- disables the trigger by name). Runs before row-level security has its say on the new row.
CREATE OR REPLACE FUNCTION assistant_items_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.organisation_id IS DISTINCT FROM OLD.organisation_id OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.sender_membership_id IS DISTINCT FROM OLD.sender_membership_id OR NEW.recipient_membership_id IS DISTINCT FROM OLD.recipient_membership_id
     OR NEW.parent_id IS DISTINCT FROM OLD.parent_id OR NEW.body IS DISTINCT FROM OLD.body OR NEW.tidied IS DISTINCT FROM OLD.tidied
     OR NEW.request_kind IS DISTINCT FROM OLD.request_kind OR NEW.payload IS DISTINCT FROM OLD.payload OR NEW.task_id IS DISTINCT FROM OLD.task_id
     OR NEW.report_date IS DISTINCT FROM OLD.report_date OR NEW.conversation_id IS DISTINCT FROM OLD.conversation_id
     OR NEW.mention_id IS DISTINCT FROM OLD.mention_id OR NEW.expires_at IS DISTINCT FROM OLD.expires_at OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'ASSISTANT_ITEM_FIXED: what was sent cannot be changed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.kind IN ('message', 'reply') AND OLD.status = 'delivered' AND NEW.status = 'seen')
    OR (OLD.kind = 'request' AND OLD.status = 'delivered' AND NEW.status IN ('seen', 'accepted', 'declined', 'expired', 'cancelled'))
    OR (OLD.kind = 'request' AND OLD.status = 'seen' AND NEW.status IN ('accepted', 'declined', 'expired', 'cancelled'))
    OR (OLD.kind = 'request' AND OLD.status = 'accepted' AND NEW.status IN ('done', 'failed'))
    OR (OLD.kind = 'report_note' AND OLD.status = 'delivered' AND NEW.status IN ('done', 'expired', 'withdrawn'))) THEN
    RAISE EXCEPTION 'ASSISTANT_ITEM_TRANSITION: % to % is not allowed', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS assistant_items_guard ON assistant_items;
CREATE TRIGGER assistant_items_guard BEFORE UPDATE ON assistant_items FOR EACH ROW EXECUTE FUNCTION assistant_items_guard();
DROP TRIGGER IF EXISTS assistant_items_updated ON assistant_items;
CREATE TRIGGER assistant_items_updated BEFORE UPDATE ON assistant_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- Realtime: ids only. A new row, then only what a card shows (status, seen, result); leases stay quiet.
DROP TRIGGER IF EXISTS assistant_items_notify_insert ON assistant_items;
CREATE TRIGGER assistant_items_notify_insert AFTER INSERT ON assistant_items FOR EACH ROW EXECUTE FUNCTION notify_org_change();
DROP TRIGGER IF EXISTS assistant_items_notify ON assistant_items;
CREATE TRIGGER assistant_items_notify AFTER UPDATE ON assistant_items FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.seen_at IS DISTINCT FROM NEW.seen_at OR OLD.result_code IS DISTINCT FROM NEW.result_code)
  EXECUTE FUNCTION notify_org_change();

ALTER TABLE assistant_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assistant_items_select ON assistant_items;
CREATE POLICY assistant_items_select ON assistant_items FOR SELECT
  USING (app_is_worker()
         OR sender_membership_id = app_membership_id(organisation_id)
         OR recipient_membership_id = app_membership_id(organisation_id)
         OR (kind = 'report_note' AND status IN ('delivered', 'done') AND app_can_view_records(organisation_id, sender_membership_id)));
-- The sender inserts only a fresh 'delivered' row they may send: a reply only to a message sent to them (by its sender),
-- a request that expires in 1 to 7 days on a task they can see and the recipient could act on, a report note for today
-- before today's report, an origin that is their own mention in that conversation.
DROP POLICY IF EXISTS assistant_items_insert ON assistant_items;
CREATE POLICY assistant_items_insert ON assistant_items FOR INSERT
  WITH CHECK (app_is_worker() OR (
    sender_membership_id = app_membership_id(organisation_id)
    AND status = 'delivered' AND seen_at IS NULL AND decided_at IS NULL AND finished_at IS NULL AND lease_until IS NULL
    AND decline_reason IS NULL AND result_code IS NULL AND result = '{}'::jsonb
    AND app_assistant_item_refusal(organisation_id, recipient_membership_id, kind) IS NULL
    AND (kind <> 'reply' OR EXISTS (SELECT 1 FROM assistant_items p
           WHERE p.id = assistant_items.parent_id AND p.organisation_id = assistant_items.organisation_id AND p.kind = 'message'
             AND p.recipient_membership_id = assistant_items.sender_membership_id AND p.sender_membership_id = assistant_items.recipient_membership_id))
    AND (kind <> 'request' OR expires_at BETWEEN now() + interval '1 day' AND now() + interval '7 days')
    AND (task_id IS NULL OR app_assistant_item_task_refusal(task_id, recipient_membership_id, request_kind) IS NULL)
    AND (kind <> 'report_note' OR (report_date = (now() AT TIME ZONE (SELECT o.timezone FROM organisations o WHERE o.id = assistant_items.organisation_id))::date
                                   AND expires_at = app_report_cutoff(organisation_id, report_date)))
    AND (mention_id IS NULL OR EXISTS (SELECT 1 FROM assistant_mentions am
           WHERE am.id = assistant_items.mention_id AND am.tagger_membership_id = assistant_items.sender_membership_id
             AND am.conversation_id = assistant_items.conversation_id))
    AND ((conversation_id IS NULL) = (mention_id IS NULL))));
DROP POLICY IF EXISTS assistant_items_update ON assistant_items;
CREATE POLICY assistant_items_update ON assistant_items FOR UPDATE USING (app_is_worker()) WITH CHECK (app_is_worker());
GRANT SELECT, INSERT, UPDATE ON assistant_items TO boardroom_app;
REVOKE DELETE, TRUNCATE ON assistant_items FROM boardroom_app;

-- 6. The recipient's and the sender's own steps (definer functions; each returns a word) -------------------------------
-- Seen (the recipient; opening it counts): 'ok' (also when already seen or decided), 'not_found' (not theirs: the same
-- word, so nothing is learnt about other people's).
CREATE OR REPLACE FUNCTION app_assistant_item_seen(item uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE i assistant_items%ROWTYPE;
BEGIN
  SELECT * INTO i FROM assistant_items WHERE id = item FOR UPDATE;
  IF NOT FOUND OR i.recipient_membership_id IS NULL OR app_membership_id(i.organisation_id) IS DISTINCT FROM i.recipient_membership_id THEN RETURN 'not_found'; END IF;
  IF i.status <> 'delivered' OR (i.kind = 'request' AND i.expires_at <= now()) THEN RETURN 'ok'; END IF;
  UPDATE assistant_items SET status = 'seen', seen_at = now() WHERE id = item;
  RETURN 'ok';
END $$;
GRANT EXECUTE ON FUNCTION app_assistant_item_seen(uuid) TO boardroom_app;

-- Accept or decline a request (the recipient alone, while it is open and not past its time): 'ok', 'not_found', 'closed',
-- 'expired', 'bad_decision', 'too_long' (a reason over 280 characters). Accept only moves it to 'accepted' with a
-- two-minute lease: Boredroom then does it as the recipient and records done or failed (worker).
CREATE OR REPLACE FUNCTION app_assistant_item_decide(item uuid, decision text, reason text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE i assistant_items%ROWTYPE; clean text;
BEGIN
  SELECT * INTO i FROM assistant_items WHERE id = item FOR UPDATE;
  IF NOT FOUND OR i.kind <> 'request' OR app_membership_id(i.organisation_id) IS DISTINCT FROM i.recipient_membership_id THEN RETURN 'not_found'; END IF;
  IF i.status NOT IN ('delivered', 'seen') THEN RETURN 'closed'; END IF;
  IF i.expires_at <= now() THEN RETURN 'expired'; END IF;
  IF decision = 'accept' THEN
    UPDATE assistant_items SET status = 'accepted', decided_at = now(), seen_at = COALESCE(seen_at, now()), lease_until = now() + interval '2 minutes' WHERE id = item;
    RETURN 'ok';
  ELSIF decision = 'decline' THEN
    clean := NULLIF(btrim(regexp_replace(COALESCE(reason, ''), '[[:cntrl:]]+', ' ', 'g')), '');
    IF clean IS NOT NULL AND char_length(clean) > 280 THEN RETURN 'too_long'; END IF;
    UPDATE assistant_items SET status = 'declined', decided_at = now(), finished_at = now(), seen_at = COALESCE(seen_at, now()), decline_reason = clean WHERE id = item;
    RETURN 'ok';
  END IF;
  RETURN 'bad_decision';
END $$;
GRANT EXECUTE ON FUNCTION app_assistant_item_decide(uuid, text, text) TO boardroom_app;

-- Cancel a request (its sender alone, while open): 'ok', 'not_found', 'closed'.
CREATE OR REPLACE FUNCTION app_assistant_item_cancel(item uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE i assistant_items%ROWTYPE;
BEGIN
  SELECT * INTO i FROM assistant_items WHERE id = item FOR UPDATE;
  IF NOT FOUND OR i.kind <> 'request' OR app_membership_id(i.organisation_id) IS DISTINCT FROM i.sender_membership_id THEN RETURN 'not_found'; END IF;
  IF i.status NOT IN ('delivered', 'seen') THEN RETURN 'closed'; END IF;
  UPDATE assistant_items SET status = 'cancelled', finished_at = now() WHERE id = item;
  RETURN 'ok';
END $$;
GRANT EXECUTE ON FUNCTION app_assistant_item_cancel(uuid) TO boardroom_app;

-- Withdraw a report note (its author alone, before the report is written): 'ok', 'not_found', 'closed', 'too_late'.
CREATE OR REPLACE FUNCTION app_assistant_item_withdraw(item uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE i assistant_items%ROWTYPE;
BEGIN
  SELECT * INTO i FROM assistant_items WHERE id = item FOR UPDATE;
  IF NOT FOUND OR i.kind <> 'report_note' OR app_membership_id(i.organisation_id) IS DISTINCT FROM i.sender_membership_id THEN RETURN 'not_found'; END IF;
  IF i.status <> 'delivered' THEN RETURN 'closed'; END IF;
  IF i.expires_at <= now() THEN RETURN 'too_late'; END IF;
  UPDATE assistant_items SET status = 'withdrawn', finished_at = now() WHERE id = item;
  RETURN 'ok';
END $$;
GRANT EXECUTE ON FUNCTION app_assistant_item_withdraw(uuid) TO boardroom_app;

-- 7. Tagging someone else's assistant in Messages ---------------------------------------------------------------------
ALTER TABLE assistant_mentions ADD COLUMN IF NOT EXISTS owner_membership_id uuid;            -- NULL: the tagger's own assistant
ALTER TABLE assistant_mentions ADD COLUMN IF NOT EXISTS follow_up_id uuid REFERENCES follow_ups(id);
ALTER TABLE assistant_mentions ADD COLUMN IF NOT EXISTS holding_message_id uuid REFERENCES messages(id) ON DELETE SET NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assistant_mentions_owner_fkey') THEN
    ALTER TABLE assistant_mentions ADD CONSTRAINT assistant_mentions_owner_fkey FOREIGN KEY (owner_membership_id, organisation_id) REFERENCES memberships(id, organisation_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assistant_mentions_owner_check') THEN
    ALTER TABLE assistant_mentions ADD CONSTRAINT assistant_mentions_owner_check CHECK (owner_membership_id IS NULL OR owner_membership_id <> tagger_membership_id);
  END IF;
END $$;
ALTER TABLE assistant_mentions DROP CONSTRAINT IF EXISTS assistant_mentions_status_check;
ALTER TABLE assistant_mentions ADD CONSTRAINT assistant_mentions_status_check
  CHECK (status IN ('pending', 'thinking', 'answered', 'private', 'waiting_confirm', 'refused', 'failed', 'withdrawn', 'asked'));
CREATE INDEX IF NOT EXISTS assistant_mentions_owner_idx ON assistant_mentions(owner_membership_id, started_at DESC) WHERE owner_membership_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS assistant_mentions_follow_up_idx ON assistant_mentions(follow_up_id) WHERE follow_up_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS assistant_mentions_holding_idx ON assistant_mentions(holding_message_id) WHERE holding_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS assistant_mentions_asked_idx ON assistant_mentions(updated_at) WHERE status = 'asked';

ALTER TABLE assistant_mention_private DROP CONSTRAINT IF EXISTS assistant_mention_private_note_check;
ALTER TABLE assistant_mention_private ADD CONSTRAINT assistant_mention_private_note_check CHECK (note_code IS NULL OR note_code IN (
  'off_workspace', 'off_conversation', 'archived', 'limit_minute', 'limit_day', 'limit_conversation', 'limit_workspace', 'allowance', 'no_ai',
  'not_allowed', 'failed', 'off_owner', 'owner_left', 'owner_muted', 'not_followable', 'limit_owner'));

ALTER TABLE message_mentions DROP CONSTRAINT IF EXISTS message_mentions_label_check;
ALTER TABLE message_mentions ADD CONSTRAINT message_mentions_label_check CHECK (char_length(label) BETWEEN 2 AND 160 AND left(label, 1) = '@');
-- One assistant per message (phase 5 never stored more; phase 6 keeps it so).
CREATE UNIQUE INDEX IF NOT EXISTS message_mentions_one_assistant_idx ON message_mentions(message_id) WHERE kind = 'assistant';

-- As 0041, plus: someone else's assistant, when its owner reads the conversation and lets people tag it.
DROP POLICY IF EXISTS message_mentions_insert ON message_mentions;
CREATE POLICY message_mentions_insert ON message_mentions FOR INSERT
  WITH CHECK (app_is_worker() OR (
    EXISTS (SELECT 1 FROM messages m
            WHERE m.id = message_id AND m.conversation_id = message_mentions.conversation_id AND m.organisation_id = message_mentions.organisation_id
              AND m.sender_membership_id = app_membership_id(m.organisation_id) AND m.author_kind = 'person'
              AND m.deleted_at IS NULL AND m.edited_at IS NULL AND m.voice_key IS NULL AND m.created_at >= now() - interval '1 minute')
    AND ((kind = 'assistant' AND membership_id = app_membership_id(organisation_id))
         OR (kind = 'person' AND membership_id <> app_membership_id(organisation_id) AND app_conversation_has_reader(conversation_id, membership_id))
         OR (kind = 'assistant' AND membership_id <> app_membership_id(organisation_id) AND app_conversation_has_reader(conversation_id, membership_id)
             AND COALESCE((SELECT ap.allow_thread_replies FROM assistant_profiles ap WHERE ap.membership_id = message_mentions.membership_id), true)))));

-- As 0041, with the assistant's owner: the message_mentions row names the owner (or the tagger for their own), and the
-- phase 6 columns start empty.
DROP POLICY IF EXISTS assistant_mentions_insert ON assistant_mentions;
CREATE POLICY assistant_mentions_insert ON assistant_mentions FOR INSERT
  WITH CHECK (app_is_worker() OR (
    tagger_membership_id = app_membership_id(organisation_id)
    AND status = 'pending' AND reply_message_id IS NULL AND engine IS NULL AND attempts = 0 AND lease_until IS NULL
    AND confirm_until IS NULL AND started_at IS NULL AND finished_at IS NULL
    AND follow_up_id IS NULL AND holding_message_id IS NULL
    AND EXISTS (SELECT 1 FROM messages m
                WHERE m.id = message_id AND m.conversation_id = assistant_mentions.conversation_id AND m.organisation_id = assistant_mentions.organisation_id
                  AND m.sender_membership_id = assistant_mentions.tagger_membership_id AND m.author_kind = 'person'
                  AND m.deleted_at IS NULL AND m.edited_at IS NULL AND m.voice_key IS NULL AND m.created_at >= now() - interval '1 minute')
    AND EXISTS (SELECT 1 FROM message_mentions mm
                WHERE mm.message_id = assistant_mentions.message_id AND mm.kind = 'assistant'
                  AND mm.membership_id = COALESCE(assistant_mentions.owner_membership_id, assistant_mentions.tagger_membership_id))));

-- 8. A follow-up asked in a thread ------------------------------------------------------------------------------------
-- NULL: an ordinary follow-up. 'facts': answer from the work when it can (the phase 4 rules); 'ask': always ask the
-- person once (the question is not about the state of their work). 0039's policies cover it.
ALTER TABLE follow_ups ADD COLUMN IF NOT EXISTS thread_mode text CONSTRAINT follow_ups_thread_mode_check CHECK (thread_mode IN ('facts', 'ask'));
