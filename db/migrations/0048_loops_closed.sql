-- Phase 7b (owner decisions, 8 October 2026: "Brenda keeps the loops closed", second part). Eight things:
-- 1. Switches. brenda_settings.track_commitments ("Track commitments in group chats", OFF until an owner or HR turns it
--    on), commitment_thread_followups ("Post gentle follow-ups in the thread", OFF) and track_commitments_since (when
--    tracking was last turned on: nothing older is ever read for it); 0026's policies cover them. conversations.
--    track_commitments (the conversation's own switch, ON: the workspace switch is the master), changed only through
--    app_conversation_set_track_commitments by whoever runs the conversation (0041's app_can_manage_conversation), and
--    never on a direct thread.
-- 2. commitments: one row per commitment the workspace's assistant noticed in a tracked group conversation: a promise
--    ("I'll send the deck Thursday"), an ask the asked person agreed to ("On it"), or an open ask nobody agreed to yet.
--    The committer and the asker read every row; their supervisors (app_can_view_records on the committer) read only
--    open and done ones. Only Boredroom's worker inserts and moves rows; the committer's own steps (seen, accept,
--    decline, not a commitment, done) are definer functions that answer with a word. Identity is fixed and the status
--    machine is guarded for every role (commitments_guard). No DELETE.
-- 3. message_labels: the small "Noted" label everyone in the conversation sees on a message, written only by the worker.
-- 4. commitment_scan_cursors: how far the worker has read each tracked conversation. Worker only.
-- 5. loose_ends and loose_end_dismissals: the person's own loose ends (promises they made, asks of them, asks they made
--    that never became a to-do, reminder, follow-up or commitment) and the messages they said were not a commitment.
--    Only the person (and the worker) reads or writes them.
-- 6. task_blocks: "blocked on whom": the task's holder names who it waits on and the question; that person answers or
--    says "not me". Read by both and by the holder's supervisors. app_task_block_settle closes blocks that are no
--    longer true (anyone may call it: it only clears).
-- 7. replan_proposals: a new due date suggested to the lead when a chase finds a task stalled a second time. Only the
--    lead reads it; nothing changes until they confirm.
-- 8. Replaced, old semantics kept exactly plus the change: ai_usage_purpose_check (+ 'loose_ends', 'commitments'),
--    routines_template_check (+ 'loose_ends'), messages_author_kind_check (+ 'workspace': the workspace's own
--    assistant's note in a thread, written only by the worker) and messages_guard_author_kind() (a 'workspace' message
--    is held exactly as an 'assistant' one).
-- Additive and idempotent: safe to run by hand twice. `DROP … IF EXISTS` only on objects this file creates or replaces
-- (named above). Not CONCURRENTLY: the runner wraps each file in a transaction. Requires 0047 (applied in order). Code
-- deployed before this runs offers none of it and says so (server/lib/schema-0048).

-- 1. Switches ----------------------------------------------------------------------------------------------------------
ALTER TABLE brenda_settings ADD COLUMN IF NOT EXISTS track_commitments boolean NOT NULL DEFAULT false;
ALTER TABLE brenda_settings ADD COLUMN IF NOT EXISTS commitment_thread_followups boolean NOT NULL DEFAULT false;
ALTER TABLE brenda_settings ADD COLUMN IF NOT EXISTS track_commitments_since timestamptz;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS track_commitments boolean NOT NULL DEFAULT true;

-- "Note commitments here": only through this function (the app role cannot update conversations), by whoever runs the
-- conversation, never on a direct thread.
CREATE OR REPLACE FUNCTION app_conversation_set_track_commitments(conv uuid, allowed boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE k text;
BEGIN
  IF allowed IS NULL THEN RAISE EXCEPTION 'TRACK_COMMITMENTS_INVALID' USING ERRCODE = 'check_violation'; END IF;
  SELECT kind INTO k FROM conversations WHERE id = conv;
  IF NOT FOUND OR NOT app_can_manage_conversation(conv) THEN RAISE EXCEPTION 'CONVERSATION_FORBIDDEN' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF k = 'direct' THEN RAISE EXCEPTION 'TRACK_COMMITMENTS_DIRECT: direct messages are never tracked' USING ERRCODE = 'check_violation'; END IF;
  UPDATE conversations SET track_commitments = allowed WHERE id = conv;
END $$;
GRANT EXECUTE ON FUNCTION app_conversation_set_track_commitments(uuid, boolean) TO boardroom_app;

-- 2. Commitments --------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS commitments (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id             uuid NOT NULL REFERENCES organisations(id),
  conversation_id             uuid NOT NULL,              -- no FK: channels can be deleted (as assistant_items)
  source_message_id           uuid NOT NULL,              -- the promise, or the ask (no FK, same reason)
  agreement_message_id        uuid,                       -- agreed_ask: the "On it"
  kind                        text NOT NULL CONSTRAINT commitments_kind_check CHECK (kind IN ('promise', 'agreed_ask', 'open_ask')),
  committer_membership_id     uuid NOT NULL,              -- who owes it (open_ask: who was asked)
  asker_membership_id         uuid,                       -- who asked; for a promise, who it was made to (NULL: nobody named)
  title                       text NOT NULL CONSTRAINT commitments_title_check CHECK (char_length(title) BETWEEN 1 AND 200 AND title = btrim(title) AND title !~ '[[:cntrl:]]'),
  due_at                      timestamptz,
  due_words                   text CONSTRAINT commitments_due_words_check CHECK (due_words IS NULL OR (char_length(due_words) BETWEEN 1 AND 60 AND due_words !~ '[[:cntrl:]]')),
  status                      text NOT NULL CONSTRAINT commitments_status_check
                                CHECK (status IN ('proposed', 'asked', 'accepting', 'open', 'done', 'declined', 'dismissed', 'expired', 'cancelled')),
  detected_by                 text NOT NULL CONSTRAINT commitments_detected_by_check CHECK (detected_by IN ('claude', 'builtin')),
  confidence                  real NOT NULL CONSTRAINT commitments_confidence_check CHECK (confidence >= 0 AND confidence <= 1),
  todo_task_id                uuid,
  decline_reason              text CONSTRAINT commitments_decline_reason_check CHECK (decline_reason IS NULL OR char_length(decline_reason) BETWEEN 1 AND 280),
  done_by                     text CONSTRAINT commitments_done_by_check CHECK (done_by IS NULL OR done_by IN ('todo', 'person')),
  expires_at                  timestamptz NOT NULL,       -- an unanswered proposal or ask expires (created + 7 days)
  ask_notify_after            timestamptz,                -- open_ask: when the asked person is told, if nobody agreed first
  notified_at                 timestamptz,                -- its inbox item reached the committer
  seen_at                     timestamptz,
  lease_until                 timestamptz,
  decided_at                  timestamptz,
  done_at                     timestamptz,
  due_reminded_at             timestamptz,
  stalled_noted_at            timestamptz,
  thread_followup_message_id  uuid REFERENCES messages(id) ON DELETE SET NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organisation_id),
  CONSTRAINT commitments_one_per_message UNIQUE (organisation_id, source_message_id, committer_membership_id),
  FOREIGN KEY (committer_membership_id, organisation_id) REFERENCES memberships(id, organisation_id),
  FOREIGN KEY (asker_membership_id, organisation_id) REFERENCES memberships(id, organisation_id),
  FOREIGN KEY (todo_task_id, organisation_id) REFERENCES tasks(id, organisation_id),
  CONSTRAINT commitments_asker_check CHECK (asker_membership_id IS DISTINCT FROM committer_membership_id AND (kind = 'promise' OR asker_membership_id IS NOT NULL)),
  CONSTRAINT commitments_agreement_check CHECK ((kind = 'agreed_ask') = (agreement_message_id IS NOT NULL)),
  CONSTRAINT commitments_asked_check CHECK (status <> 'asked' OR kind = 'open_ask'),
  CONSTRAINT commitments_ask_notify_check CHECK (kind = 'open_ask' OR ask_notify_after IS NULL),
  CONSTRAINT commitments_decline_shape_check CHECK (decline_reason IS NULL OR status = 'declined'),
  CONSTRAINT commitments_done_shape_check CHECK ((status = 'done') = (done_at IS NOT NULL) AND (status = 'done') = (done_by IS NOT NULL)),
  CONSTRAINT commitments_todo_shape_check CHECK (todo_task_id IS NULL OR status IN ('open', 'done', 'cancelled'))
);
CREATE INDEX IF NOT EXISTS commitments_committer_idx ON commitments(committer_membership_id, created_at DESC);
CREATE INDEX IF NOT EXISTS commitments_asker_idx ON commitments(asker_membership_id, created_at DESC) WHERE asker_membership_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS commitments_org_idx ON commitments(organisation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS commitments_message_idx ON commitments(source_message_id);
CREATE INDEX IF NOT EXISTS commitments_agreement_idx ON commitments(agreement_message_id) WHERE agreement_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS commitments_waiting_idx ON commitments(expires_at) WHERE status IN ('proposed', 'asked');
CREATE INDEX IF NOT EXISTS commitments_ask_notify_idx ON commitments(ask_notify_after) WHERE status = 'asked' AND notified_at IS NULL;
CREATE INDEX IF NOT EXISTS commitments_open_due_idx ON commitments(due_at) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS commitments_accepting_idx ON commitments(decided_at) WHERE status = 'accepting';
CREATE INDEX IF NOT EXISTS commitments_todo_idx ON commitments(todo_task_id) WHERE todo_task_id IS NOT NULL;
DROP TRIGGER IF EXISTS commitments_updated ON commitments;
CREATE TRIGGER commitments_updated BEFORE UPDATE ON commitments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Who owes what, and where it was said, never changes (every role; a data fix disables the trigger by name). An open
-- ask becomes an agreed ask once, when the asked person agrees in the thread. The status moves only forward.
CREATE OR REPLACE FUNCTION commitments_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.organisation_id IS DISTINCT FROM OLD.organisation_id OR NEW.conversation_id IS DISTINCT FROM OLD.conversation_id
     OR NEW.source_message_id IS DISTINCT FROM OLD.source_message_id OR NEW.committer_membership_id IS DISTINCT FROM OLD.committer_membership_id
     OR NEW.asker_membership_id IS DISTINCT FROM OLD.asker_membership_id OR NEW.detected_by IS DISTINCT FROM OLD.detected_by
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (NEW.kind IS DISTINCT FROM OLD.kind AND NOT (OLD.kind = 'open_ask' AND NEW.kind = 'agreed_ask' AND OLD.status = 'asked' AND NEW.status = 'proposed'))
     OR (OLD.agreement_message_id IS NOT NULL AND NEW.agreement_message_id IS DISTINCT FROM OLD.agreement_message_id) THEN
    RAISE EXCEPTION 'COMMITMENT_FIXED: who owes what, and where it was said, cannot change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'proposed' AND NEW.status IN ('accepting', 'declined', 'dismissed', 'expired', 'cancelled'))
    OR (OLD.status = 'asked' AND NEW.status IN ('accepting', 'declined', 'dismissed', 'expired', 'cancelled'))
    OR (OLD.status = 'asked' AND NEW.status = 'proposed' AND NEW.kind = 'agreed_ask')
    OR (OLD.status = 'accepting' AND NEW.status = 'open')
    OR (OLD.status = 'open' AND NEW.status IN ('done', 'cancelled'))) THEN
    RAISE EXCEPTION 'COMMITMENT_TRANSITION: % to % is not allowed', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS commitments_guard ON commitments;
CREATE TRIGGER commitments_guard BEFORE UPDATE ON commitments FOR EACH ROW EXECUTE FUNCTION commitments_guard();
-- Realtime: ids only (the inbox count and the pages refresh).
DROP TRIGGER IF EXISTS commitments_notify ON commitments;
CREATE TRIGGER commitments_notify AFTER INSERT OR UPDATE ON commitments FOR EACH ROW EXECUTE FUNCTION notify_org_change();

ALTER TABLE commitments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commitments_select ON commitments;
CREATE POLICY commitments_select ON commitments FOR SELECT
  USING (app_is_worker()
         OR committer_membership_id = app_membership_id(organisation_id)
         OR asker_membership_id = app_membership_id(organisation_id)
         OR (status IN ('open', 'done') AND app_can_view_records(organisation_id, committer_membership_id)));
DROP POLICY IF EXISTS commitments_worker ON commitments;
CREATE POLICY commitments_worker ON commitments FOR ALL USING (app_is_worker()) WITH CHECK (app_is_worker());
GRANT SELECT, INSERT, UPDATE ON commitments TO boardroom_app;
REVOKE DELETE, TRUNCATE ON commitments FROM boardroom_app;

-- The committer's own steps (definer functions; each answers with a word; anyone else's id reads 'not_found').
-- Seen: 'ok' (also when already seen), 'not_found'.
CREATE OR REPLACE FUNCTION app_commitment_seen(c uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE i commitments%ROWTYPE;
BEGIN
  SELECT * INTO i FROM commitments WHERE id = c FOR UPDATE;
  IF NOT FOUND OR app_membership_id(i.organisation_id) IS DISTINCT FROM i.committer_membership_id THEN RETURN 'not_found'; END IF;
  IF i.seen_at IS NULL THEN UPDATE commitments SET seen_at = now() WHERE id = c; END IF;
  RETURN 'ok';
END $$;
GRANT EXECUTE ON FUNCTION app_commitment_seen(uuid) TO boardroom_app;

-- Accept, decline or "not a commitment", while it waits and is not past its time: 'ok', 'not_found', 'closed',
-- 'expired', 'bad_decision', 'too_long' (a reason over 280 characters). Accept only moves it to 'accepting' with a
-- two-minute lease: Boredroom then adds the to-do as the committer and the worker records it open.
CREATE OR REPLACE FUNCTION app_commitment_decide(c uuid, decision text, reason text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE i commitments%ROWTYPE; clean text;
BEGIN
  SELECT * INTO i FROM commitments WHERE id = c FOR UPDATE;
  IF NOT FOUND OR app_membership_id(i.organisation_id) IS DISTINCT FROM i.committer_membership_id THEN RETURN 'not_found'; END IF;
  IF i.status NOT IN ('proposed', 'asked') THEN RETURN 'closed'; END IF;
  IF i.expires_at <= now() THEN RETURN 'expired'; END IF;
  IF decision = 'accept' THEN
    UPDATE commitments SET status = 'accepting', decided_at = now(), seen_at = COALESCE(seen_at, now()), lease_until = now() + interval '2 minutes' WHERE id = c;
    RETURN 'ok';
  ELSIF decision = 'decline' THEN
    clean := NULLIF(btrim(regexp_replace(COALESCE(reason, ''), '[[:cntrl:]]+', ' ', 'g')), '');
    IF clean IS NOT NULL AND char_length(clean) > 280 THEN RETURN 'too_long'; END IF;
    UPDATE commitments SET status = 'declined', decided_at = now(), seen_at = COALESCE(seen_at, now()), decline_reason = clean WHERE id = c;
    RETURN 'ok';
  ELSIF decision = 'dismiss' THEN
    UPDATE commitments SET status = 'dismissed', decided_at = now(), seen_at = COALESCE(seen_at, now()) WHERE id = c;
    RETURN 'ok';
  END IF;
  RETURN 'bad_decision';
END $$;
GRANT EXECUTE ON FUNCTION app_commitment_decide(uuid, text, text) TO boardroom_app;

-- Done, by the committer, on an open commitment: 'ok' (also when already done), 'not_found', 'closed'.
CREATE OR REPLACE FUNCTION app_commitment_mark_done(c uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE i commitments%ROWTYPE;
BEGIN
  SELECT * INTO i FROM commitments WHERE id = c FOR UPDATE;
  IF NOT FOUND OR app_membership_id(i.organisation_id) IS DISTINCT FROM i.committer_membership_id THEN RETURN 'not_found'; END IF;
  IF i.status = 'done' THEN RETURN 'ok'; END IF;
  IF i.status <> 'open' THEN RETURN 'closed'; END IF;
  UPDATE commitments SET status = 'done', done_at = now(), done_by = 'person' WHERE id = c;
  RETURN 'ok';
END $$;
GRANT EXECUTE ON FUNCTION app_commitment_mark_done(uuid) TO boardroom_app;

-- 3. The label on a message -----------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS message_labels (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id       uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  conversation_id  uuid NOT NULL,
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  kind             text NOT NULL DEFAULT 'commitment' CONSTRAINT message_labels_kind_check CHECK (kind IN ('commitment')),
  state            text NOT NULL CONSTRAINT message_labels_state_check CHECK (state IN ('noted', 'done', 'declined', 'dismissed')),
  commitment_id    uuid REFERENCES commitments(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT message_labels_one UNIQUE (message_id, kind),
  FOREIGN KEY (conversation_id, organisation_id) REFERENCES conversations(id, organisation_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS message_labels_conversation_idx ON message_labels(conversation_id);
DROP TRIGGER IF EXISTS message_labels_updated ON message_labels;
CREATE TRIGGER message_labels_updated BEFORE UPDATE ON message_labels FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS message_labels_notify ON message_labels;
CREATE TRIGGER message_labels_notify AFTER INSERT OR UPDATE ON message_labels FOR EACH ROW EXECUTE FUNCTION notify_org_change();
ALTER TABLE message_labels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS message_labels_select ON message_labels;
CREATE POLICY message_labels_select ON message_labels FOR SELECT USING (app_is_worker() OR app_can_read_conversation(conversation_id));
DROP POLICY IF EXISTS message_labels_worker ON message_labels;
CREATE POLICY message_labels_worker ON message_labels FOR ALL USING (app_is_worker()) WITH CHECK (app_is_worker());
-- DELETE passes only the worker's policy: an expired or cancelled commitment's label goes.
GRANT SELECT, INSERT, UPDATE, DELETE ON message_labels TO boardroom_app;
REVOKE TRUNCATE ON message_labels FROM boardroom_app;

-- 4. How far each tracked conversation has been read -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS commitment_scan_cursors (
  conversation_id  uuid PRIMARY KEY,
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  last_created_at  timestamptz NOT NULL,
  last_message_id  uuid,
  scanned_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (conversation_id, organisation_id) REFERENCES conversations(id, organisation_id) ON DELETE CASCADE
);
ALTER TABLE commitment_scan_cursors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commitment_scan_cursors_worker ON commitment_scan_cursors;
CREATE POLICY commitment_scan_cursors_worker ON commitment_scan_cursors FOR ALL USING (app_is_worker()) WITH CHECK (app_is_worker());
GRANT SELECT, INSERT, UPDATE ON commitment_scan_cursors TO boardroom_app;
REVOKE DELETE, TRUNCATE ON commitment_scan_cursors FROM boardroom_app;

-- 5. Loose ends (the person's own) ----------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS loose_ends (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id            uuid NOT NULL REFERENCES organisations(id),
  membership_id              uuid NOT NULL,
  message_id                 uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  conversation_id            uuid NOT NULL,
  context_message_id         uuid REFERENCES messages(id) ON DELETE SET NULL,   -- the ask an agreement answered
  kind                       text NOT NULL CONSTRAINT loose_ends_kind_check CHECK (kind IN ('promise', 'asked_of_me', 'i_asked')),
  counterpart_membership_id  uuid,                    -- promise: made to; asked_of_me: who asked; i_asked: who was asked
  title                      text NOT NULL CONSTRAINT loose_ends_title_check CHECK (char_length(title) BETWEEN 1 AND 200 AND title = btrim(title) AND title !~ '[[:cntrl:]]'),
  due_at                     timestamptz,
  due_words                  text CONSTRAINT loose_ends_due_words_check CHECK (due_words IS NULL OR (char_length(due_words) BETWEEN 1 AND 60 AND due_words !~ '[[:cntrl:]]')),
  confidence                 real NOT NULL CONSTRAINT loose_ends_confidence_check CHECK (confidence >= 0 AND confidence <= 1),
  detected_by                text NOT NULL CONSTRAINT loose_ends_detected_by_check CHECK (detected_by IN ('claude', 'builtin')),
  source                     text NOT NULL DEFAULT 'on_demand' CONSTRAINT loose_ends_source_check CHECK (source IN ('on_demand', 'routine')),
  status                     text NOT NULL DEFAULT 'open' CONSTRAINT loose_ends_status_check
                               CHECK (status IN ('open', 'todo', 'reminder', 'handed', 'follow_up_scheduled', 'follow_up', 'dismissed', 'resolved')),
  task_id                    uuid,
  reminder_id                uuid REFERENCES brenda_reminders(id),
  assistant_item_id          uuid,
  follow_up_id               uuid,
  follow_up_at               timestamptz,
  follow_up_error            text CONSTRAINT loose_ends_follow_up_error_check CHECK (follow_up_error IS NULL OR char_length(follow_up_error) BETWEEN 1 AND 300),
  acted_at                   timestamptz,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT loose_ends_one UNIQUE (membership_id, message_id, kind),
  FOREIGN KEY (membership_id, organisation_id) REFERENCES memberships(id, organisation_id),
  FOREIGN KEY (counterpart_membership_id, organisation_id) REFERENCES memberships(id, organisation_id),
  FOREIGN KEY (conversation_id, organisation_id) REFERENCES conversations(id, organisation_id) ON DELETE CASCADE,
  FOREIGN KEY (task_id, organisation_id) REFERENCES tasks(id, organisation_id),
  FOREIGN KEY (assistant_item_id, organisation_id) REFERENCES assistant_items(id, organisation_id),
  FOREIGN KEY (follow_up_id, organisation_id) REFERENCES follow_ups(id, organisation_id),
  CONSTRAINT loose_ends_counterpart_check CHECK (counterpart_membership_id IS DISTINCT FROM membership_id),
  CONSTRAINT loose_ends_follow_up_shape_check CHECK (status <> 'follow_up_scheduled' OR follow_up_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS loose_ends_member_idx ON loose_ends(membership_id, created_at DESC);
CREATE INDEX IF NOT EXISTS loose_ends_open_idx ON loose_ends(membership_id, created_at DESC) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS loose_ends_follow_up_due_idx ON loose_ends(follow_up_at) WHERE status = 'follow_up_scheduled';
DROP TRIGGER IF EXISTS loose_ends_updated ON loose_ends;
CREATE TRIGGER loose_ends_updated BEFORE UPDATE ON loose_ends FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Whose it is and what it is never change; a dismissed one stays dismissed; an action taken is never undone here
-- (a scheduled follow-up that could not be asked goes back to open, with why).
CREATE OR REPLACE FUNCTION loose_ends_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.organisation_id IS DISTINCT FROM OLD.organisation_id OR NEW.membership_id IS DISTINCT FROM OLD.membership_id
     OR NEW.message_id IS DISTINCT FROM OLD.message_id OR NEW.conversation_id IS DISTINCT FROM OLD.conversation_id
     OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.detected_by IS DISTINCT FROM OLD.detected_by
     OR NEW.source IS DISTINCT FROM OLD.source OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'LOOSE_END_FIXED: whose loose end it is, and where it came from, cannot change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'open' AND NEW.status IN ('todo', 'reminder', 'handed', 'follow_up_scheduled', 'dismissed', 'resolved'))
    OR (OLD.status = 'follow_up_scheduled' AND NEW.status IN ('follow_up', 'open', 'dismissed'))) THEN
    RAISE EXCEPTION 'LOOSE_END_TRANSITION: % to % is not allowed', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS loose_ends_guard ON loose_ends;
CREATE TRIGGER loose_ends_guard BEFORE UPDATE ON loose_ends FOR EACH ROW EXECUTE FUNCTION loose_ends_guard();

ALTER TABLE loose_ends ENABLE ROW LEVEL SECURITY;
-- Only the person (and the worker, for a scheduled follow-up) reads or writes them; a row is only ever about a message
-- the person can read.
DROP POLICY IF EXISTS loose_ends_own ON loose_ends;
CREATE POLICY loose_ends_own ON loose_ends FOR ALL
  USING (app_is_worker() OR membership_id = app_membership_id(organisation_id))
  WITH CHECK (app_is_worker() OR (membership_id = app_membership_id(organisation_id) AND app_can_read_conversation(conversation_id)));
GRANT SELECT, INSERT, UPDATE ON loose_ends TO boardroom_app;
REVOKE DELETE, TRUNCATE ON loose_ends FROM boardroom_app;

-- "Not a commitment": remembered for good, so the message is never suggested again.
CREATE TABLE IF NOT EXISTS loose_end_dismissals (
  membership_id    uuid NOT NULL,
  message_id       uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  dismissed_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (membership_id, message_id),
  FOREIGN KEY (membership_id, organisation_id) REFERENCES memberships(id, organisation_id)
);
ALTER TABLE loose_end_dismissals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS loose_end_dismissals_own ON loose_end_dismissals;
CREATE POLICY loose_end_dismissals_own ON loose_end_dismissals FOR ALL
  USING (app_is_worker() OR membership_id = app_membership_id(organisation_id))
  WITH CHECK (app_is_worker() OR membership_id = app_membership_id(organisation_id));
GRANT SELECT, INSERT ON loose_end_dismissals TO boardroom_app;
REVOKE UPDATE, DELETE, TRUNCATE ON loose_end_dismissals FROM boardroom_app;

-- 6. Blocked on whom ---------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_blocks (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id           uuid NOT NULL REFERENCES organisations(id),
  task_id                   uuid NOT NULL,
  blocked_membership_id     uuid NOT NULL,           -- the task's holder, waiting
  waiting_on_membership_id  uuid NOT NULL,           -- who it waits on
  task_title                text NOT NULL CONSTRAINT task_blocks_task_title_check CHECK (char_length(task_title) BETWEEN 1 AND 200),
  question                  text NOT NULL CONSTRAINT task_blocks_question_check CHECK (char_length(question) BETWEEN 1 AND 500 AND question = btrim(question)),
  status                    text NOT NULL DEFAULT 'open' CONSTRAINT task_blocks_status_check CHECK (status IN ('open', 'answered', 'not_me', 'cleared', 'cancelled')),
  answer                    text CONSTRAINT task_blocks_answer_check CHECK (answer IS NULL OR char_length(answer) BETWEEN 1 AND 1000),
  unblocked                 boolean NOT NULL DEFAULT false,
  comment_id                uuid REFERENCES task_comments(id),
  seen_at                   timestamptz,
  answered_at               timestamptz,
  closed_at                 timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organisation_id),
  FOREIGN KEY (task_id, organisation_id) REFERENCES tasks(id, organisation_id),
  FOREIGN KEY (blocked_membership_id, organisation_id) REFERENCES memberships(id, organisation_id),
  FOREIGN KEY (waiting_on_membership_id, organisation_id) REFERENCES memberships(id, organisation_id),
  CONSTRAINT task_blocks_not_self_check CHECK (waiting_on_membership_id <> blocked_membership_id),
  CONSTRAINT task_blocks_answer_shape_check CHECK ((status = 'answered') = (answer IS NOT NULL) AND (NOT unblocked OR status = 'answered')),
  CONSTRAINT task_blocks_closed_check CHECK ((status = 'open') = (closed_at IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS task_blocks_one_open_idx ON task_blocks(task_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS task_blocks_waiting_on_idx ON task_blocks(waiting_on_membership_id, created_at DESC) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS task_blocks_blocked_idx ON task_blocks(blocked_membership_id, created_at DESC);
CREATE INDEX IF NOT EXISTS task_blocks_org_open_idx ON task_blocks(organisation_id, created_at DESC) WHERE status = 'open';
DROP TRIGGER IF EXISTS task_blocks_updated ON task_blocks;
CREATE TRIGGER task_blocks_updated BEFORE UPDATE ON task_blocks FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS task_blocks_notify ON task_blocks;
CREATE TRIGGER task_blocks_notify AFTER INSERT OR UPDATE ON task_blocks FOR EACH ROW EXECUTE FUNCTION notify_org_change();

CREATE OR REPLACE FUNCTION task_blocks_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.organisation_id IS DISTINCT FROM OLD.organisation_id OR NEW.task_id IS DISTINCT FROM OLD.task_id
     OR NEW.blocked_membership_id IS DISTINCT FROM OLD.blocked_membership_id OR NEW.waiting_on_membership_id IS DISTINCT FROM OLD.waiting_on_membership_id
     OR NEW.task_title IS DISTINCT FROM OLD.task_title OR NEW.question IS DISTINCT FROM OLD.question OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (OLD.answer IS NOT NULL AND NEW.answer IS DISTINCT FROM OLD.answer) THEN
    RAISE EXCEPTION 'TASK_BLOCK_FIXED: what was asked, and of whom, cannot change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status = 'open' AND NEW.status IN ('answered', 'not_me', 'cleared', 'cancelled')) THEN
    RAISE EXCEPTION 'TASK_BLOCK_TRANSITION: % to % is not allowed', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS task_blocks_guard ON task_blocks;
CREATE TRIGGER task_blocks_guard BEFORE UPDATE ON task_blocks FOR EACH ROW EXECUTE FUNCTION task_blocks_guard();

ALTER TABLE task_blocks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS task_blocks_select ON task_blocks;
CREATE POLICY task_blocks_select ON task_blocks FOR SELECT
  USING (app_is_worker()
         OR blocked_membership_id = app_membership_id(organisation_id)
         OR waiting_on_membership_id = app_membership_id(organisation_id)
         OR app_can_view_records(organisation_id, blocked_membership_id));
-- The holder of a blocked task names, as themself, one active colleague it waits on; the row starts open and empty.
DROP POLICY IF EXISTS task_blocks_insert ON task_blocks;
CREATE POLICY task_blocks_insert ON task_blocks FOR INSERT
  WITH CHECK (app_is_worker() OR (
    blocked_membership_id = app_membership_id(organisation_id)
    AND status = 'open' AND answer IS NULL AND NOT unblocked AND comment_id IS NULL
    AND seen_at IS NULL AND answered_at IS NULL AND closed_at IS NULL
    AND EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_blocks.task_id AND t.organisation_id = task_blocks.organisation_id
                  AND t.assignee_membership_id = task_blocks.blocked_membership_id AND t.status = 'blocked' AND t.archived_at IS NULL)
    AND EXISTS (SELECT 1 FROM memberships m WHERE m.id = task_blocks.waiting_on_membership_id
                  AND m.organisation_id = task_blocks.organisation_id AND m.status = 'active')));
DROP POLICY IF EXISTS task_blocks_worker ON task_blocks;
CREATE POLICY task_blocks_worker ON task_blocks FOR UPDATE USING (app_is_worker()) WITH CHECK (app_is_worker());
GRANT SELECT, INSERT, UPDATE ON task_blocks TO boardroom_app;
REVOKE DELETE, TRUNCATE ON task_blocks FROM boardroom_app;

-- The person waited on: answer ('ok', 'not_found', 'closed', 'empty', 'too_long'), or "not me" ('ok', 'not_found',
-- 'closed'), or seen ('ok', 'not_found'). The holder: cancel ('ok', 'not_found', 'closed'). Boredroom's worker then posts
-- the answer as the answerer's comment and, when they said it unblocks it, moves the task back to In progress.
CREATE OR REPLACE FUNCTION app_task_block_answer(b uuid, answer_text text, unblock boolean) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE i task_blocks%ROWTYPE; clean text;
BEGIN
  SELECT * INTO i FROM task_blocks WHERE id = b FOR UPDATE;
  IF NOT FOUND OR app_membership_id(i.organisation_id) IS DISTINCT FROM i.waiting_on_membership_id THEN RETURN 'not_found'; END IF;
  IF i.status <> 'open' THEN RETURN 'closed'; END IF;
  -- Control characters out, line breaks kept (a comment may have several lines).
  clean := NULLIF(btrim(regexp_replace(COALESCE(answer_text, ''), '[\x01-\x09\x0B-\x1F\x7F]+', ' ', 'g')), '');
  IF clean IS NULL THEN RETURN 'empty'; END IF;
  IF char_length(clean) > 1000 THEN RETURN 'too_long'; END IF;
  UPDATE task_blocks SET status = 'answered', answer = clean, unblocked = COALESCE(unblock, false), answered_at = now(), closed_at = now(), seen_at = COALESCE(seen_at, now()) WHERE id = b;
  RETURN 'ok';
END $$;
GRANT EXECUTE ON FUNCTION app_task_block_answer(uuid, text, boolean) TO boardroom_app;

CREATE OR REPLACE FUNCTION app_task_block_not_me(b uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE i task_blocks%ROWTYPE;
BEGIN
  SELECT * INTO i FROM task_blocks WHERE id = b FOR UPDATE;
  IF NOT FOUND OR app_membership_id(i.organisation_id) IS DISTINCT FROM i.waiting_on_membership_id THEN RETURN 'not_found'; END IF;
  IF i.status <> 'open' THEN RETURN 'closed'; END IF;
  UPDATE task_blocks SET status = 'not_me', closed_at = now(), seen_at = COALESCE(seen_at, now()) WHERE id = b;
  RETURN 'ok';
END $$;
GRANT EXECUTE ON FUNCTION app_task_block_not_me(uuid) TO boardroom_app;

CREATE OR REPLACE FUNCTION app_task_block_seen(b uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE i task_blocks%ROWTYPE;
BEGIN
  SELECT * INTO i FROM task_blocks WHERE id = b FOR UPDATE;
  IF NOT FOUND OR app_membership_id(i.organisation_id) IS DISTINCT FROM i.waiting_on_membership_id THEN RETURN 'not_found'; END IF;
  IF i.seen_at IS NULL THEN UPDATE task_blocks SET seen_at = now() WHERE id = b; END IF;
  RETURN 'ok';
END $$;
GRANT EXECUTE ON FUNCTION app_task_block_seen(uuid) TO boardroom_app;

CREATE OR REPLACE FUNCTION app_task_block_cancel(b uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE i task_blocks%ROWTYPE;
BEGIN
  SELECT * INTO i FROM task_blocks WHERE id = b FOR UPDATE;
  IF NOT FOUND OR app_membership_id(i.organisation_id) IS DISTINCT FROM i.blocked_membership_id THEN RETURN 'not_found'; END IF;
  IF i.status <> 'open' THEN RETURN 'closed'; END IF;
  UPDATE task_blocks SET status = 'cancelled', closed_at = now() WHERE id = b;
  RETURN 'ok';
END $$;
GRANT EXECUTE ON FUNCTION app_task_block_cancel(uuid) TO boardroom_app;

-- Closes the open block on `task` when it is no longer true (the task is not blocked any more, archived, or held by
-- someone else). Anyone may call it: it only ever clears. Returns how many it closed.
CREATE OR REPLACE FUNCTION app_task_block_settle(task uuid) RETURNS integer
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  WITH done AS (
    UPDATE task_blocks b SET status = 'cleared', closed_at = now()
    FROM tasks t
    WHERE b.task_id = task AND b.status = 'open' AND t.id = b.task_id
      AND (t.status <> 'blocked' OR t.archived_at IS NOT NULL OR t.assignee_membership_id <> b.blocked_membership_id)
    RETURNING b.id)
  SELECT count(*)::int FROM done
$$;
GRANT EXECUTE ON FUNCTION app_task_block_settle(uuid) TO boardroom_app;

-- 7. A re-plan suggested to the lead ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS replan_proposals (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id     uuid NOT NULL REFERENCES organisations(id),
  task_id             uuid NOT NULL,
  lead_membership_id  uuid NOT NULL,
  follow_up_id        uuid,
  routine_run_id      uuid REFERENCES routine_runs(id),
  previous_due_at     timestamptz,
  proposed_due_at     timestamptz NOT NULL,
  confirmed_due_at    timestamptz,
  status              text NOT NULL DEFAULT 'proposed' CONSTRAINT replan_proposals_status_check CHECK (status IN ('proposed', 'confirmed', 'dismissed', 'stale')),
  decided_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT replan_proposals_follow_up_one UNIQUE (follow_up_id),
  FOREIGN KEY (task_id, organisation_id) REFERENCES tasks(id, organisation_id),
  FOREIGN KEY (lead_membership_id, organisation_id) REFERENCES memberships(id, organisation_id),
  FOREIGN KEY (follow_up_id, organisation_id) REFERENCES follow_ups(id, organisation_id),
  CONSTRAINT replan_proposals_confirmed_check CHECK ((status = 'confirmed') = (confirmed_due_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS replan_proposals_one_open_idx ON replan_proposals(task_id, lead_membership_id) WHERE status = 'proposed';
DROP TRIGGER IF EXISTS replan_proposals_updated ON replan_proposals;
CREATE TRIGGER replan_proposals_updated BEFORE UPDATE ON replan_proposals FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE replan_proposals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS replan_proposals_select ON replan_proposals;
CREATE POLICY replan_proposals_select ON replan_proposals FOR SELECT USING (app_is_worker() OR lead_membership_id = app_membership_id(organisation_id));
DROP POLICY IF EXISTS replan_proposals_worker ON replan_proposals;
CREATE POLICY replan_proposals_worker ON replan_proposals FOR ALL USING (app_is_worker()) WITH CHECK (app_is_worker());
GRANT SELECT, INSERT, UPDATE ON replan_proposals TO boardroom_app;
REVOKE DELETE, TRUNCATE ON replan_proposals FROM boardroom_app;

-- The lead's answer, after their own change of the task's due date went through: 'ok', 'not_found', 'closed',
-- 'bad_decision', 'no_date' (confirm needs the date that was set).
CREATE OR REPLACE FUNCTION app_replan_decide(p uuid, decision text, due timestamptz) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE i replan_proposals%ROWTYPE;
BEGIN
  SELECT * INTO i FROM replan_proposals WHERE id = p FOR UPDATE;
  IF NOT FOUND OR app_membership_id(i.organisation_id) IS DISTINCT FROM i.lead_membership_id THEN RETURN 'not_found'; END IF;
  IF i.status <> 'proposed' THEN RETURN 'closed'; END IF;
  IF decision = 'confirm' THEN
    IF due IS NULL THEN RETURN 'no_date'; END IF;
    UPDATE replan_proposals SET status = 'confirmed', confirmed_due_at = due, decided_at = now() WHERE id = p;
    RETURN 'ok';
  ELSIF decision = 'dismiss' THEN
    UPDATE replan_proposals SET status = 'dismissed', decided_at = now() WHERE id = p;
    RETURN 'ok';
  END IF;
  RETURN 'bad_decision';
END $$;
GRANT EXECUTE ON FUNCTION app_replan_decide(uuid, text, timestamptz) TO boardroom_app;

-- 8. Replaced, old semantics kept exactly plus the change ---------------------------------------------------------------------
ALTER TABLE ai_usage DROP CONSTRAINT IF EXISTS ai_usage_purpose_check;
ALTER TABLE ai_usage ADD CONSTRAINT ai_usage_purpose_check
  CHECK (purpose IN ('chat', 'plan', 'report', 'summary', 'test', 'other', 'followup', 'mention', 'loose_ends', 'commitments'));

ALTER TABLE routines DROP CONSTRAINT IF EXISTS routines_template_check;
ALTER TABLE routines ADD CONSTRAINT routines_template_check
  CHECK (template IN ('morning_brief', 'still_owed', 'afternoon_check', 'chase_stalled', 'loose_ends'));

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_author_kind_check;
ALTER TABLE messages ADD CONSTRAINT messages_author_kind_check CHECK (author_kind IN ('person', 'via_assistant', 'assistant', 'workspace'));

-- As 0037, with 'workspace' held exactly like 'assistant': only the worker writes or changes one.
CREATE OR REPLACE FUNCTION messages_guard_author_kind() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF app_is_worker() THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.author_kind IN ('assistant', 'workspace') THEN
      RAISE EXCEPTION 'ASSISTANT_AUTHOR: only Boredroom writes an assistant''s own messages' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.author_kind IS DISTINCT FROM OLD.author_kind THEN
    RAISE EXCEPTION 'AUTHOR_KIND_FIXED: who wrote a message cannot be changed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.author_kind IN ('assistant', 'workspace') THEN
    RAISE EXCEPTION 'ASSISTANT_AUTHOR: only Boredroom changes an assistant''s own messages' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
-- The trigger itself (0037) is unchanged: it calls the function by name.
