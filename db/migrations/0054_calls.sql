-- Phase 8 (owner decisions, 8 October 2026, confirmed 10 October 2026: "build Phase 8, cook"): calls. Screen recording
-- for tasks is taken out (migration 0055, db/pending) and replaced by calls between people who can already message each
-- other: one-to-one in a direct thread, a group call from a team channel (the team call) or a named channel, on every
-- plan. Video goes through LiveKit Cloud; ringing, missed calls, history and Brenda's notes are Boredroom's own. Seven
-- things:
-- 1. calls: one row per call, always anchored to the conversation it was started from (no FK: a named channel can be
--    deleted). At most one live call per conversation. Read by the people on it and by whoever reads its conversation
--    (the thread shows it; a live group call can be joined from it). Written only by the definer steps below and the
--    worker; who started it, and where, never changes; its state only moves forward.
-- 2. call_participants: who was rung, who joined, declined or missed it, with their times. A person is in at most one
--    live call at a time. Their own steps are definer functions that answer with a word; time-based moves (a ring past 30
--    seconds, a device silent for 45 seconds, the 4-hour cap, 15 minutes alone) are app_call_settle's, for the worker.
-- 3. call_note_consents: each person's own answer to "Brenda takes notes" on that call (no row: not chosen yet). Nobody
--    else ever reads a "no".
-- 4. call_transcript_lines: the words a consenting person's own device wrote down from their own microphone, sent as text
--    (never audio). Read ONLY by the people who were on the call: no owner, HR or team-lead exception. Inserted only through
--    app_call_add_lines as the speaker; a "no" deletes the person's lines; the worker deletes them 7 days after the recap.
--    No realtime event.
-- 5. call_recaps: the workspace assistant's notes for a call (summary, decisions, action items), read by the people who
--    were on it, written by the worker. Kept.
-- 6. Additions: messages.call_id and call_part (a call's line or recap in its thread, only ever the worker's
--    'workspace' messages); commitments.call_id and call_item (an action item from a recap that its person must accept,
--    one per item, so commitments_one_per_message gains call_item, NULLS NOT DISTINCT: PostgreSQL 15 or later, the
--    project runs 16); commitments_guard (0048) keeps them fixed; ai_usage purpose 'call_recap'; the workspace ability
--    'call_notes' (brenda_settings.abilities_off may hold it).
-- 7. Seeded copy that described screen recording (the Pro plan's description, the "plan ending" email), only where it is
--    still exactly the seeded text.
-- 8. call_ringers (fix review, 10 October 2026): a signed-in notch says on its ring poll that it rings this person's calls
--    on the network it polls from, so a browser on that network shows the incoming card without its own ring (one
--    ringer, never two rings out of step). Server-only.
-- Who is on a call follows who reads its conversation (fix review, 10 October 2026): someone removed from the channel or
-- the team, or whose membership ends, is out of a live call at once (their device's next heartbeat, any settle), can
-- no longer join it again, add notes or switch them, and (a group call) no longer reads its transcript or recap.
-- Additive and idempotent: safe to run by hand twice. `DROP … IF EXISTS` only on objects this file creates or replaces
-- (named above). It never touches the recording tables. Requires 0053 (applied in order). Code deployed before this runs
-- offers no calls and says so (server/lib/schema-0054).

-- 1. Calls --------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS calls (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   uuid NOT NULL REFERENCES organisations(id),
  conversation_id   uuid NOT NULL,              -- no FK: a named channel can be deleted (as commitments)
  conversation_kind text NOT NULL CONSTRAINT calls_conversation_kind_check CHECK (conversation_kind IN ('direct', 'team', 'channel')),
  kind              text NOT NULL CONSTRAINT calls_kind_check CHECK (kind IN ('direct', 'group')),
  room_name         text NOT NULL,
  started_by        uuid NOT NULL,
  state             text NOT NULL DEFAULT 'ringing' CONSTRAINT calls_state_check CHECK (state IN ('ringing', 'active', 'ended')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  answered_at       timestamptz,                -- a second person joined
  last_together_at  timestamptz,                -- the last time two or more were in it (the 15-minute "alone" rule)
  ended_at          timestamptz,
  end_reason        text CONSTRAINT calls_end_reason_check CHECK (end_reason IS NULL OR end_reason IN ('completed', 'cancelled', 'declined', 'missed', 'empty', 'alone', 'cap', 'failed')),
  ended_by          uuid,
  notes_state       text NOT NULL DEFAULT 'off' CONSTRAINT calls_notes_state_check CHECK (notes_state IN ('off', 'on')),
  notes_on_by       uuid,                       -- who switched notes on last
  notes_on_at       timestamptz,                -- when (NULL: never on)
  notes_off_at      timestamptz,
  recap_state       text NOT NULL DEFAULT 'none' CONSTRAINT calls_recap_state_check CHECK (recap_state IN ('none', 'pending', 'writing', 'done', 'skipped', 'failed')),
  recap_started_at  timestamptz,                -- 'writing' since (a stuck one is taken again after 10 minutes)
  -- When the model was asked for this call's recap: once per call (fix review, 10 October 2026). A run taken again after
  -- a crash never asks a second time; without the recap row it fails and says so.
  recap_model_at    timestamptz,
  -- Why no recap was written (fix review, 10 October 2026): nobody agreed or nothing was said ('no_consent'), the call
  -- never had two people in it ('not_answered'), or notes were switched off for the workspace or its plan by then
  -- ('switched_off'). The call's page says which.
  recap_skipped     text CONSTRAINT calls_recap_skipped_check CHECK (recap_skipped IS NULL OR (recap_state = 'skipped' AND recap_skipped IN ('no_consent', 'not_answered', 'switched_off'))),
  line_message_id   uuid,                       -- the call's line in its thread (no FK: the thread can go)
  room_closed_at    timestamptz,                -- LiveKit's room was deleted (or was already gone)
  -- The last time LiveKit's room was compared with who is in the call, so anyone in it without a `joined` row (a token
  -- kept after leaving) is taken out within seconds: at most every 15 s, from a device's heartbeat (fix review,
  -- 10 October 2026); the sweep does it too. Sends no realtime event.
  reconciled_at     timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calls_room_name_key UNIQUE (room_name),
  CONSTRAINT calls_room_name_check CHECK (room_name = 'call-' || id::text),
  CONSTRAINT calls_kind_shape_check CHECK ((kind = 'direct') = (conversation_kind = 'direct')),
  CONSTRAINT calls_ended_shape_check CHECK ((state = 'ended') = (ended_at IS NOT NULL) AND (state = 'ended') = (end_reason IS NOT NULL)),
  CONSTRAINT calls_answered_check CHECK (state <> 'active' OR answered_at IS NOT NULL),
  CONSTRAINT calls_notes_shape_check CHECK (notes_state = 'off' OR (notes_on_by IS NOT NULL AND notes_on_at IS NOT NULL AND state <> 'ended')),
  UNIQUE (id, organisation_id),
  FOREIGN KEY (started_by, organisation_id) REFERENCES memberships(id, organisation_id),
  FOREIGN KEY (ended_by, organisation_id) REFERENCES memberships(id, organisation_id),
  FOREIGN KEY (notes_on_by, organisation_id) REFERENCES memberships(id, organisation_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS calls_one_live_per_conversation ON calls(conversation_id) WHERE state <> 'ended';
CREATE INDEX IF NOT EXISTS calls_org_idx ON calls(organisation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS calls_live_idx ON calls(created_at) WHERE state <> 'ended';
CREATE INDEX IF NOT EXISTS calls_recap_idx ON calls(ended_at) WHERE recap_state IN ('pending', 'writing');
CREATE INDEX IF NOT EXISTS calls_room_idx ON calls(ended_at) WHERE state = 'ended' AND room_closed_at IS NULL;

-- Who started a call, and where, never changes; the state only moves forward (every role; a data fix disables it by name).
CREATE OR REPLACE FUNCTION calls_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.organisation_id IS DISTINCT FROM OLD.organisation_id OR NEW.conversation_id IS DISTINCT FROM OLD.conversation_id
     OR NEW.conversation_kind IS DISTINCT FROM OLD.conversation_kind OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.room_name IS DISTINCT FROM OLD.room_name OR NEW.started_by IS DISTINCT FROM OLD.started_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'CALL_FIXED: who started a call, and where, cannot change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state AND NOT (
       (OLD.state = 'ringing' AND NEW.state IN ('active', 'ended')) OR (OLD.state = 'active' AND NEW.state = 'ended')) THEN
    RAISE EXCEPTION 'CALL_TRANSITION: % to % is not allowed', OLD.state, NEW.state USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS calls_guard ON calls;
CREATE TRIGGER calls_guard BEFORE UPDATE ON calls FOR EACH ROW EXECUTE FUNCTION calls_guard();
DROP TRIGGER IF EXISTS calls_updated ON calls;
CREATE TRIGGER calls_updated BEFORE UPDATE ON calls FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- Realtime: ids only, and only when something a screen shows changed (never for a heartbeat's last_together_at).
DROP TRIGGER IF EXISTS calls_notify_insert ON calls;
CREATE TRIGGER calls_notify_insert AFTER INSERT ON calls FOR EACH ROW EXECUTE FUNCTION notify_org_change();
DROP TRIGGER IF EXISTS calls_notify_update ON calls;
CREATE TRIGGER calls_notify_update AFTER UPDATE ON calls FOR EACH ROW
  WHEN (OLD.state IS DISTINCT FROM NEW.state OR OLD.notes_state IS DISTINCT FROM NEW.notes_state OR OLD.recap_state IS DISTINCT FROM NEW.recap_state)
  EXECUTE FUNCTION notify_org_change();

-- 2. Who is on it -------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS call_participants (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id          uuid NOT NULL,
  organisation_id  uuid NOT NULL,
  membership_id    uuid NOT NULL,
  role             text NOT NULL CONSTRAINT call_participants_role_check CHECK (role IN ('caller', 'invitee', 'joiner')),
  -- invited: added without ringing (a direct call's other person in quiet hours or on Do not disturb): missed at 30 s.
  state            text NOT NULL CONSTRAINT call_participants_state_check CHECK (state IN ('invited', 'ringing', 'joined', 'left', 'declined', 'missed')),
  rang_at          timestamptz,                 -- an invitee's ring started (or they were added, for 'invited')
  answered_at      timestamptz,                 -- an invitee accepted
  declined_at      timestamptz,
  missed_at        timestamptz,
  first_joined_at  timestamptz,                 -- NULL: never in the call
  joined_at        timestamptz,                 -- the latest join
  left_at          timestamptz,                 -- the latest leave
  last_seen_at     timestamptz,                 -- the device's latest heartbeat (a join sets it 45 s ahead: 90 s to connect)
  seconds_in_call  integer NOT NULL DEFAULT 0 CONSTRAINT call_participants_seconds_check CHECK (seconds_in_call >= 0),
  notified_at      timestamptz,                 -- their missed-call notification went out
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT call_participants_one UNIQUE (call_id, membership_id),
  FOREIGN KEY (call_id, organisation_id) REFERENCES calls(id, organisation_id),
  FOREIGN KEY (membership_id, organisation_id) REFERENCES memberships(id, organisation_id),
  CONSTRAINT call_participants_rung_check CHECK (role <> 'invitee' OR rang_at IS NOT NULL),
  CONSTRAINT call_participants_joined_check CHECK (state NOT IN ('joined', 'left') OR (first_joined_at IS NOT NULL AND joined_at IS NOT NULL)),
  CONSTRAINT call_participants_caller_check CHECK (role = 'invitee' OR state IN ('joined', 'left'))
);
CREATE INDEX IF NOT EXISTS call_participants_member_idx ON call_participants(membership_id, created_at DESC);
CREATE INDEX IF NOT EXISTS call_participants_ringing_idx ON call_participants(rang_at) WHERE state IN ('ringing', 'invited');
CREATE INDEX IF NOT EXISTS call_participants_seen_idx ON call_participants(last_seen_at) WHERE state = 'joined';
CREATE UNIQUE INDEX IF NOT EXISTS call_participants_one_live_join ON call_participants(membership_id) WHERE state = 'joined';
CREATE INDEX IF NOT EXISTS call_participants_unnotified_idx ON call_participants(call_id) WHERE state = 'missed' AND notified_at IS NULL;

CREATE OR REPLACE FUNCTION call_participants_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.call_id IS DISTINCT FROM OLD.call_id OR NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
     OR NEW.membership_id IS DISTINCT FROM OLD.membership_id OR NEW.role IS DISTINCT FROM OLD.role OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'CALL_PARTICIPANT_FIXED: who is on a call cannot change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS call_participants_guard ON call_participants;
CREATE TRIGGER call_participants_guard BEFORE UPDATE ON call_participants FOR EACH ROW EXECUTE FUNCTION call_participants_guard();
DROP TRIGGER IF EXISTS call_participants_updated ON call_participants;
CREATE TRIGGER call_participants_updated BEFORE UPDATE ON call_participants FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- Realtime: a row added or its state changed (never a heartbeat).
DROP TRIGGER IF EXISTS call_participants_notify_insert ON call_participants;
CREATE TRIGGER call_participants_notify_insert AFTER INSERT ON call_participants FOR EACH ROW EXECUTE FUNCTION notify_org_change();
DROP TRIGGER IF EXISTS call_participants_notify_update ON call_participants;
CREATE TRIGGER call_participants_notify_update AFTER UPDATE ON call_participants FOR EACH ROW
  WHEN (OLD.state IS DISTINCT FROM NEW.state) EXECUTE FUNCTION notify_org_change();

-- 3. Consent to notes ---------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS call_note_consents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id          uuid NOT NULL,
  organisation_id  uuid NOT NULL,
  membership_id    uuid NOT NULL,
  consent          text NOT NULL CONSTRAINT call_note_consents_consent_check CHECK (consent IN ('yes', 'no')),
  decided_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT call_note_consents_one UNIQUE (call_id, membership_id),
  FOREIGN KEY (call_id, organisation_id) REFERENCES calls(id, organisation_id),
  FOREIGN KEY (membership_id, organisation_id) REFERENCES memberships(id, organisation_id)
);
DROP TRIGGER IF EXISTS call_note_consents_notify ON call_note_consents;
CREATE TRIGGER call_note_consents_notify AFTER INSERT OR UPDATE ON call_note_consents FOR EACH ROW EXECUTE FUNCTION notify_org_change();

-- 4. Transcript lines (no realtime event) --------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS call_transcript_lines (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id          uuid NOT NULL,
  organisation_id  uuid NOT NULL,
  membership_id    uuid NOT NULL,                -- the speaker: always the person whose device sent it
  seq              integer NOT NULL CONSTRAINT call_transcript_lines_seq_check CHECK (seq BETWEEN 0 AND 10000000),
  spoken_at        timestamptz NOT NULL,
  text             text NOT NULL CONSTRAINT call_transcript_lines_text_check CHECK (char_length(text) BETWEEN 1 AND 1000 AND text !~ '[[:cntrl:]]'),
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT call_transcript_lines_one UNIQUE (call_id, membership_id, seq),
  FOREIGN KEY (call_id, organisation_id) REFERENCES calls(id, organisation_id),
  FOREIGN KEY (membership_id, organisation_id) REFERENCES memberships(id, organisation_id)
);
CREATE INDEX IF NOT EXISTS call_transcript_lines_call_idx ON call_transcript_lines(call_id, spoken_at);

-- 5. Recaps -------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS call_recaps (
  call_id            uuid PRIMARY KEY,
  organisation_id    uuid NOT NULL,
  summary            text NOT NULL CONSTRAINT call_recaps_summary_check CHECK (char_length(summary) BETWEEN 1 AND 2000),
  decisions          jsonb NOT NULL DEFAULT '[]'::jsonb CONSTRAINT call_recaps_decisions_check CHECK (jsonb_typeof(decisions) = 'array' AND jsonb_array_length(decisions) <= 20),
  action_items       jsonb NOT NULL DEFAULT '[]'::jsonb CONSTRAINT call_recaps_items_check CHECK (jsonb_typeof(action_items) = 'array' AND jsonb_array_length(action_items) <= 20),
  speakers           uuid[] NOT NULL DEFAULT '{}'::uuid[],   -- whose words were used
  model              text,
  thread_message_id  uuid,
  lines_used         integer NOT NULL DEFAULT 0,
  lines_delete_after timestamptz NOT NULL,                    -- created_at + 7 days
  lines_deleted_at   timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (call_id, organisation_id) REFERENCES calls(id, organisation_id)
);

-- Who may see what --------------------------------------------------------------------------------------------------------
-- Whether the caller may see a call: they have a row on it, or they read its conversation (or the worker asks).
CREATE OR REPLACE FUNCTION app_call_can_see(cid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_is_worker() OR EXISTS (
    SELECT 1 FROM calls c
    WHERE c.id = cid AND app_is_member(c.organisation_id)
      AND (EXISTS (SELECT 1 FROM call_participants p WHERE p.call_id = c.id AND p.membership_id = app_membership_id(c.organisation_id))
           OR app_can_read_conversation(c.conversation_id)))
$$;
GRANT EXECUTE ON FUNCTION app_call_can_see(uuid) TO boardroom_app;

-- Whether the caller has a row on the call (rung, joined or not).
CREATE OR REPLACE FUNCTION app_call_participant(cid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_is_worker() OR EXISTS (
    SELECT 1 FROM call_participants p JOIN calls c ON c.id = p.call_id
    WHERE p.call_id = cid AND p.membership_id = app_membership_id(c.organisation_id))
$$;
GRANT EXECUTE ON FUNCTION app_call_participant(uuid) TO boardroom_app;

-- Whether the caller was ON the call (joined at least once): the transcript and the recap are theirs alone. Someone who
-- no longer reads the call's conversation (removed from the channel or the team) loses them too (fix review, 10 October
-- 2026: the rest of the call happened without them); a channel deleted since keeps them for the people who were on it.
CREATE OR REPLACE FUNCTION app_call_was_on(cid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_is_worker() OR EXISTS (
    SELECT 1 FROM call_participants p JOIN calls c ON c.id = p.call_id
    WHERE p.call_id = cid AND p.membership_id = app_membership_id(c.organisation_id) AND p.first_joined_at IS NOT NULL
      AND (app_can_read_conversation(c.conversation_id) OR NOT EXISTS (SELECT 1 FROM conversations x WHERE x.id = c.conversation_id)))
$$;
GRANT EXECUTE ON FUNCTION app_call_was_on(uuid) TO boardroom_app;

ALTER TABLE calls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS calls_select ON calls;
CREATE POLICY calls_select ON calls FOR SELECT USING (app_is_worker() OR app_call_can_see(id));
DROP POLICY IF EXISTS calls_worker ON calls;
CREATE POLICY calls_worker ON calls FOR ALL USING (app_is_worker()) WITH CHECK (app_is_worker());
GRANT SELECT, INSERT, UPDATE ON calls TO boardroom_app;
REVOKE DELETE, TRUNCATE ON calls FROM boardroom_app;

ALTER TABLE call_participants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS call_participants_select ON call_participants;
CREATE POLICY call_participants_select ON call_participants FOR SELECT
  USING (app_is_worker() OR membership_id = app_membership_id(organisation_id) OR app_call_can_see(call_id));
DROP POLICY IF EXISTS call_participants_worker ON call_participants;
CREATE POLICY call_participants_worker ON call_participants FOR ALL USING (app_is_worker()) WITH CHECK (app_is_worker());
GRANT SELECT, INSERT, UPDATE ON call_participants TO boardroom_app;
REVOKE DELETE, TRUNCATE ON call_participants FROM boardroom_app;

-- One's own answer always; someone else's only when it is "yes" and the reader has a row on that call. A "no" is never shown.
ALTER TABLE call_note_consents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS call_note_consents_select ON call_note_consents;
CREATE POLICY call_note_consents_select ON call_note_consents FOR SELECT
  USING (app_is_worker() OR membership_id = app_membership_id(organisation_id) OR (consent = 'yes' AND app_call_participant(call_id)));
DROP POLICY IF EXISTS call_note_consents_worker ON call_note_consents;
CREATE POLICY call_note_consents_worker ON call_note_consents FOR ALL USING (app_is_worker()) WITH CHECK (app_is_worker());
GRANT SELECT, INSERT, UPDATE ON call_note_consents TO boardroom_app;
REVOKE DELETE, TRUNCATE ON call_note_consents FROM boardroom_app;

-- The people who were on the call, and nobody else (no owner, HR or team-lead exception).
ALTER TABLE call_transcript_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS call_transcript_lines_select ON call_transcript_lines;
CREATE POLICY call_transcript_lines_select ON call_transcript_lines FOR SELECT USING (app_is_worker() OR app_call_was_on(call_id));
DROP POLICY IF EXISTS call_transcript_lines_worker ON call_transcript_lines;
CREATE POLICY call_transcript_lines_worker ON call_transcript_lines FOR ALL USING (app_is_worker()) WITH CHECK (app_is_worker());
GRANT SELECT, INSERT, UPDATE, DELETE ON call_transcript_lines TO boardroom_app;   -- DELETE: the worker's purge (RLS)
REVOKE TRUNCATE ON call_transcript_lines FROM boardroom_app;

ALTER TABLE call_recaps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS call_recaps_select ON call_recaps;
CREATE POLICY call_recaps_select ON call_recaps FOR SELECT USING (app_is_worker() OR app_call_was_on(call_id));
DROP POLICY IF EXISTS call_recaps_worker ON call_recaps;
CREATE POLICY call_recaps_worker ON call_recaps FOR ALL USING (app_is_worker()) WITH CHECK (app_is_worker());
GRANT SELECT, INSERT, UPDATE ON call_recaps TO boardroom_app;
REVOKE DELETE, TRUNCATE ON call_recaps FROM boardroom_app;

-- Internal steps (the definer steps and the worker only) ---------------------------------------------------------------
-- Ends a call: every joined row leaves (its seconds counted), every ring still going is missed, notes stop, and a call
-- that ever had notes on waits for its recap.
CREATE OR REPLACE FUNCTION app_call_close(cid uuid, reason text, by_member uuid, at_time timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE call_participants SET state = 'left', left_at = at_time,
         seconds_in_call = seconds_in_call + GREATEST(0, floor(extract(epoch FROM (at_time - joined_at))))::int
   WHERE call_id = cid AND state = 'joined';
  UPDATE call_participants SET state = 'missed', missed_at = at_time WHERE call_id = cid AND state IN ('ringing', 'invited');
  UPDATE calls SET state = 'ended', ended_at = at_time, end_reason = reason, ended_by = by_member,
         notes_off_at = CASE WHEN notes_state = 'on' THEN at_time ELSE notes_off_at END, notes_state = 'off',
         recap_state = CASE WHEN notes_on_at IS NOT NULL AND recap_state = 'none' THEN 'pending' ELSE recap_state END
   WHERE id = cid AND state <> 'ended';
END $$;
REVOKE ALL ON FUNCTION app_call_close(uuid, text, uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_call_close(uuid, text, uuid, timestamptz) FROM boardroom_app;

-- What time has settled: rings past 30 seconds are missed; a device silent for 45 seconds has left; then a call that
-- should end ends: at 4 hours ('cap'); a direct call nobody answered when its caller went ('cancelled') or nobody is being
-- rung any more ('declined' or 'missed'), an answered one when fewer than two are in it ('completed'); a group call when
-- nobody is in it ('cancelled' or 'completed'), or one person has been alone with nobody rung for 15 minutes ('alone').
-- First, whoever no longer reads the call's conversation (removed from the channel or the team, the channel deleted, or
-- their membership ended) is out of it (fix review, 10 October 2026): in the room, they leave (and are in `left`, so
-- Boredroom takes their device out of LiveKit's room too); still being rung, the ring is missed without a notification.
-- The numbers are src/lib/calls.ts CALL_LIMITS (tests/unit/calls-lib.test.ts checks they match).
CREATE OR REPLACE FUNCTION app_call_settle_at(cid uuid, at_time timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE k calls%ROWTYPE; in_room integer; ringing integer; reason text := NULL; missed uuid[]; gone uuid[]; outs uuid[];
BEGIN
  SELECT * INTO k FROM calls WHERE id = cid FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('found', false); END IF;
  IF k.state = 'ended' THEN
    RETURN jsonb_build_object('found', true, 'ended', true, 'endedNow', false, 'reason', k.end_reason, 'missed', '[]'::jsonb, 'left', '[]'::jsonb);
  END IF;
  UPDATE call_participants SET state = 'missed', missed_at = at_time, notified_at = at_time
   WHERE call_id = cid AND state IN ('ringing', 'invited') AND NOT app_member_can_read_conversation(membership_id, k.conversation_id);
  WITH o AS (UPDATE call_participants SET state = 'left', left_at = at_time,
                    seconds_in_call = seconds_in_call + GREATEST(0, floor(extract(epoch FROM (LEAST(at_time, last_seen_at + interval '15 seconds') - joined_at))))::int
              WHERE call_id = cid AND state = 'joined' AND NOT app_member_can_read_conversation(membership_id, k.conversation_id) RETURNING membership_id)
  SELECT COALESCE(array_agg(membership_id), '{}'::uuid[]) INTO outs FROM o;
  WITH m AS (UPDATE call_participants SET state = 'missed', missed_at = at_time
              WHERE call_id = cid AND state IN ('ringing', 'invited') AND rang_at <= at_time - interval '30 seconds' RETURNING membership_id)
  SELECT COALESCE(array_agg(membership_id), '{}'::uuid[]) INTO missed FROM m;
  WITH g AS (UPDATE call_participants SET state = 'left', left_at = at_time,
                    seconds_in_call = seconds_in_call + GREATEST(0, floor(extract(epoch FROM (LEAST(at_time, last_seen_at + interval '15 seconds') - joined_at))))::int
              WHERE call_id = cid AND state = 'joined' AND last_seen_at < at_time - interval '45 seconds' RETURNING membership_id)
  SELECT COALESCE(array_agg(membership_id), '{}'::uuid[]) INTO gone FROM g;
  SELECT count(*) FILTER (WHERE state = 'joined'), count(*) FILTER (WHERE state IN ('ringing', 'invited'))
    INTO in_room, ringing FROM call_participants WHERE call_id = cid;
  IF k.created_at <= at_time - interval '4 hours' THEN reason := 'cap';
  ELSIF k.kind = 'direct' THEN
    IF k.answered_at IS NULL THEN
      IF in_room = 0 THEN reason := 'cancelled';
      ELSIF ringing = 0 THEN
        reason := CASE WHEN EXISTS (SELECT 1 FROM call_participants WHERE call_id = cid AND state = 'declined') THEN 'declined' ELSE 'missed' END;
      END IF;
    ELSIF in_room < 2 THEN reason := 'completed';
    END IF;
  ELSIF in_room = 0 THEN reason := CASE WHEN k.answered_at IS NULL THEN 'cancelled' ELSE 'completed' END;
  ELSIF in_room = 1 AND ringing = 0 AND COALESCE(k.last_together_at, k.created_at) <= at_time - interval '15 minutes' THEN reason := 'alone';
  END IF;
  IF reason IS NOT NULL THEN PERFORM app_call_close(cid, reason, NULL, at_time); END IF;
  RETURN jsonb_build_object('found', true, 'ended', reason IS NOT NULL, 'endedNow', reason IS NOT NULL, 'reason', reason,
                            'missed', to_jsonb(missed), 'left', to_jsonb(outs || gone));
END $$;
REVOKE ALL ON FUNCTION app_call_settle_at(uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_call_settle_at(uuid, timestamptz) FROM boardroom_app;

-- The worker's door to it (a test's clock may pass `at_time`).
CREATE OR REPLACE FUNCTION app_call_settle(cid uuid, at_time timestamptz DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT app_is_worker() THEN RAISE EXCEPTION 'CALL_SETTLE_FORBIDDEN: only Boredroom settles calls' USING ERRCODE = 'insufficient_privilege'; END IF;
  RETURN app_call_settle_at(cid, COALESCE(at_time, now()));
END $$;
GRANT EXECUTE ON FUNCTION app_call_settle(uuid, timestamptz) TO boardroom_app;

-- The worker ends a live call for a reason of its own ('empty': LiveKit says its room finished; 'failed'): every joined
-- row leaves, every ring is missed. Answers {ended: true when it ended it now}.
CREATE OR REPLACE FUNCTION app_call_finish(cid uuid, reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE k calls%ROWTYPE;
BEGIN
  IF NOT app_is_worker() THEN RAISE EXCEPTION 'CALL_FINISH_FORBIDDEN: only Boredroom ends calls this way' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF reason IS NULL OR reason NOT IN ('empty', 'failed') THEN RAISE EXCEPTION 'CALL_FINISH_REASON' USING ERRCODE = 'check_violation'; END IF;
  SELECT * INTO k FROM calls WHERE id = cid FOR UPDATE;
  IF NOT FOUND OR k.state = 'ended' THEN RETURN jsonb_build_object('ended', false); END IF;
  PERFORM app_call_close(cid, reason, NULL, now());
  RETURN jsonb_build_object('ended', true);
END $$;
GRANT EXECUTE ON FUNCTION app_call_finish(uuid, text) TO boardroom_app;

-- The person's own steps (definer functions; each answers with a word; anyone else's id reads 'not_found') ---------------
-- Start a call in a conversation the caller reads: a direct thread, a team channel or a named channel; never Everyone,
-- never an archived channel. `ring`: whom to ring now (Boredroom chose them: online and available); `quiet`: whom to add
-- without ringing (only a direct call's other person, in quiet hours or on Do not disturb; missed silently at 30 s). A
-- direct call names exactly its other person, in one of the two. Answers {word, callId?, otherCallId?}: 'ok', 'exists'
-- (callId: the live call there already), 'in_call' (otherCallId: the caller's own live call), 'not_found', 'not_here',
-- 'bad_people', 'too_many'.
CREATE OR REPLACE FUNCTION app_call_start(conv uuid, ring uuid[], quiet uuid[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cv conversations%ROWTYPE; me uuid; other uuid; existing uuid; elsewhere uuid; cid uuid; ckind text; m uuid;
        rung uuid[] := COALESCE(ring, '{}'::uuid[]); silent uuid[] := COALESCE(quiet, '{}'::uuid[]); people uuid[];
BEGIN
  people := rung || silent;
  SELECT * INTO cv FROM conversations WHERE id = conv;
  IF NOT FOUND THEN RETURN jsonb_build_object('word', 'not_found'); END IF;
  me := app_membership_id(cv.organisation_id);
  IF me IS NULL OR NOT app_can_read_conversation(conv) THEN RETURN jsonb_build_object('word', 'not_found'); END IF;
  IF cv.kind NOT IN ('direct', 'team', 'channel') OR cv.archived_at IS NOT NULL THEN RETURN jsonb_build_object('word', 'not_here'); END IF;
  PERFORM pg_advisory_xact_lock(hashtext('call.start:' || conv::text));
  SELECT id INTO existing FROM calls WHERE conversation_id = conv AND state <> 'ended';
  IF existing IS NOT NULL THEN RETURN jsonb_build_object('word', 'exists', 'callId', existing); END IF;
  SELECT p.call_id INTO elsewhere FROM call_participants p JOIN calls c ON c.id = p.call_id
   WHERE p.membership_id = me AND p.state = 'joined' AND c.state <> 'ended' LIMIT 1;
  IF elsewhere IS NOT NULL THEN RETURN jsonb_build_object('word', 'in_call', 'otherCallId', elsewhere); END IF;
  IF me = ANY(people) OR cardinality(people) <> (SELECT count(DISTINCT x) FROM unnest(people) x) THEN RETURN jsonb_build_object('word', 'bad_people'); END IF;
  IF cv.kind = 'direct' THEN
    SELECT cp.membership_id INTO other FROM conversation_participants cp WHERE cp.conversation_id = conv AND cp.membership_id <> me LIMIT 1;
    IF other IS NULL OR cardinality(people) <> 1 OR people[1] <> other
       OR NOT EXISTS (SELECT 1 FROM memberships WHERE id = other AND status = 'active') THEN
      RETURN jsonb_build_object('word', 'bad_people');
    END IF;
    ckind := 'direct';
  ELSE
    IF cardinality(silent) > 0 THEN RETURN jsonb_build_object('word', 'bad_people'); END IF;
    IF cardinality(rung) > 50 THEN RETURN jsonb_build_object('word', 'too_many'); END IF;
    FOREACH m IN ARRAY rung LOOP
      IF NOT app_member_can_read_conversation(m, conv) THEN RETURN jsonb_build_object('word', 'bad_people'); END IF;
    END LOOP;
    ckind := 'group';
  END IF;
  cid := gen_random_uuid();
  INSERT INTO calls(id, organisation_id, conversation_id, conversation_kind, kind, room_name, started_by)
  VALUES (cid, cv.organisation_id, conv, cv.kind, ckind, 'call-' || cid::text, me);
  INSERT INTO call_participants(call_id, organisation_id, membership_id, role, state, first_joined_at, joined_at, last_seen_at)
  VALUES (cid, cv.organisation_id, me, 'caller', 'joined', now(), now(), now() + interval '45 seconds');
  INSERT INTO call_participants(call_id, organisation_id, membership_id, role, state, rang_at)
  SELECT cid, cv.organisation_id, x, 'invitee', 'ringing', now() FROM unnest(rung) x;
  INSERT INTO call_participants(call_id, organisation_id, membership_id, role, state, rang_at)
  SELECT cid, cv.organisation_id, x, 'invitee', 'invited', now() FROM unnest(silent) x;
  RETURN jsonb_build_object('word', 'ok', 'callId', cid);
END $$;
GRANT EXECUTE ON FUNCTION app_call_start(uuid, uuid[], uuid[]) TO boardroom_app;

-- Join a live call: its rung person accepting, someone who declined or missed it changing their mind, or (a group call)
-- anyone who reads its conversation while it runs. Always only while the person reads the call's conversation, a row on
-- the call or not (fix review, 10 October 2026: someone removed from the channel or the team cannot come back from a ring
-- they declined or a call they left). `leave_other`: leave the person's other live call first (that call is settled at
-- once: a direct one ends). At most 50 in a call. Answers {word, otherCallId?, other?}: 'ok' (also when already in it),
-- 'not_found', 'ended', 'in_call' (otherCallId), 'full'.
CREATE OR REPLACE FUNCTION app_call_join(cid uuid, leave_other boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE k calls%ROWTYPE; me uuid; mine call_participants%ROWTYPE; has_row boolean; elsewhere uuid; others integer; left_other jsonb := NULL;
BEGIN
  SELECT * INTO k FROM calls WHERE id = cid FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('word', 'not_found'); END IF;
  me := app_membership_id(k.organisation_id);
  IF me IS NULL THEN RETURN jsonb_build_object('word', 'not_found'); END IF;
  SELECT * INTO mine FROM call_participants WHERE call_id = cid AND membership_id = me FOR UPDATE;
  has_row := FOUND;
  IF (NOT has_row AND k.kind = 'direct') OR NOT app_can_read_conversation(k.conversation_id) THEN RETURN jsonb_build_object('word', 'not_found'); END IF;
  IF k.state = 'ended' THEN RETURN jsonb_build_object('word', 'ended'); END IF;
  IF has_row AND mine.state = 'joined' THEN
    UPDATE call_participants SET last_seen_at = GREATEST(last_seen_at, now() + interval '45 seconds') WHERE id = mine.id;
    RETURN jsonb_build_object('word', 'ok');
  END IF;
  SELECT p.call_id INTO elsewhere FROM call_participants p JOIN calls c ON c.id = p.call_id
   WHERE p.membership_id = me AND p.state = 'joined' AND c.state <> 'ended' AND p.call_id <> cid LIMIT 1;
  IF elsewhere IS NOT NULL THEN
    IF NOT COALESCE(leave_other, false) THEN RETURN jsonb_build_object('word', 'in_call', 'otherCallId', elsewhere); END IF;
    UPDATE call_participants SET state = 'left', left_at = now(),
           seconds_in_call = seconds_in_call + GREATEST(0, floor(extract(epoch FROM (now() - joined_at))))::int
     WHERE call_id = elsewhere AND membership_id = me AND state = 'joined';
    left_other := app_call_settle_at(elsewhere, now());
  END IF;
  SELECT count(*) INTO others FROM call_participants WHERE call_id = cid AND state = 'joined';
  IF others >= 50 THEN RETURN jsonb_build_object('word', 'full'); END IF;
  IF NOT has_row THEN
    INSERT INTO call_participants(call_id, organisation_id, membership_id, role, state, first_joined_at, joined_at, last_seen_at)
    VALUES (cid, k.organisation_id, me, 'joiner', 'joined', now(), now(), now() + interval '45 seconds');
  ELSE
    UPDATE call_participants SET state = 'joined',
           answered_at = CASE WHEN mine.state IN ('ringing', 'invited') THEN now() ELSE answered_at END,
           first_joined_at = COALESCE(first_joined_at, now()), joined_at = now(), left_at = NULL,
           last_seen_at = now() + interval '45 seconds'
     WHERE id = mine.id;
  END IF;
  IF others + 1 >= 2 THEN
    UPDATE calls SET state = CASE WHEN state = 'ringing' THEN 'active' ELSE state END,
           answered_at = COALESCE(answered_at, now()), last_together_at = now()
     WHERE id = cid;
  END IF;
  RETURN jsonb_build_object('word', 'ok', 'otherCallId', elsewhere, 'other', left_other);
END $$;
GRANT EXECUTE ON FUNCTION app_call_join(uuid, boolean) TO boardroom_app;

-- Decline a ring (the person's own ring, while it rings): {word, settle}: 'ok', 'not_found', 'ended', 'closed'.
CREATE OR REPLACE FUNCTION app_call_decline(cid uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE k calls%ROWTYPE; me uuid; mine call_participants%ROWTYPE;
BEGIN
  SELECT * INTO k FROM calls WHERE id = cid FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('word', 'not_found'); END IF;
  me := app_membership_id(k.organisation_id);
  SELECT * INTO mine FROM call_participants WHERE call_id = cid AND membership_id = me FOR UPDATE;
  IF me IS NULL OR NOT FOUND THEN RETURN jsonb_build_object('word', 'not_found'); END IF;
  IF k.state = 'ended' THEN RETURN jsonb_build_object('word', 'ended'); END IF;
  IF mine.state NOT IN ('ringing', 'invited') THEN RETURN jsonb_build_object('word', 'closed'); END IF;
  UPDATE call_participants SET state = 'declined', declined_at = now() WHERE id = mine.id;
  RETURN jsonb_build_object('word', 'ok', 'settle', app_call_settle_at(cid, now()));
END $$;
GRANT EXECUTE ON FUNCTION app_call_decline(uuid) TO boardroom_app;

-- Leave (a direct call then ends): {word, settle}: 'ok' (also when already out), 'not_found'.
CREATE OR REPLACE FUNCTION app_call_leave(cid uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE k calls%ROWTYPE; me uuid; mine call_participants%ROWTYPE;
BEGIN
  SELECT * INTO k FROM calls WHERE id = cid FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('word', 'not_found'); END IF;
  me := app_membership_id(k.organisation_id);
  SELECT * INTO mine FROM call_participants WHERE call_id = cid AND membership_id = me FOR UPDATE;
  IF me IS NULL OR NOT FOUND THEN RETURN jsonb_build_object('word', 'not_found'); END IF;
  IF mine.state = 'joined' THEN
    UPDATE call_participants SET state = 'left', left_at = now(),
           seconds_in_call = seconds_in_call + GREATEST(0, floor(extract(epoch FROM (now() - joined_at))))::int
     WHERE id = mine.id;
  END IF;
  RETURN jsonb_build_object('word', 'ok', 'settle', app_call_settle_at(cid, now()));
END $$;
GRANT EXECUTE ON FUNCTION app_call_leave(uuid) TO boardroom_app;

-- End for everyone: either person of a direct call, or a group call's starter, while in it and still reading its
-- conversation (fix review, 10 October 2026: a starter taken out of the channel cannot end the call for those still in
-- it). {word}: 'ok' (also when already ended), 'not_found', 'not_allowed'.
CREATE OR REPLACE FUNCTION app_call_end(cid uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE k calls%ROWTYPE; me uuid; mine call_participants%ROWTYPE;
BEGIN
  SELECT * INTO k FROM calls WHERE id = cid FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('word', 'not_found'); END IF;
  me := app_membership_id(k.organisation_id);
  SELECT * INTO mine FROM call_participants WHERE call_id = cid AND membership_id = me;
  IF me IS NULL OR NOT FOUND THEN RETURN jsonb_build_object('word', 'not_found'); END IF;
  IF k.state = 'ended' THEN RETURN jsonb_build_object('word', 'ok'); END IF;
  IF mine.state <> 'joined' OR (k.kind = 'group' AND k.started_by <> me) OR NOT app_can_read_conversation(k.conversation_id) THEN
    RETURN jsonb_build_object('word', 'not_allowed');
  END IF;
  PERFORM app_call_close(cid, CASE WHEN k.answered_at IS NULL THEN 'cancelled' ELSE 'completed' END, me, now());
  RETURN jsonb_build_object('word', 'ok');
END $$;
GRANT EXECUTE ON FUNCTION app_call_end(uuid) TO boardroom_app;

-- The person's device is still in the call (every 15 seconds): 'ok', 'left' (their row is not in the call: the device
-- stops), 'removed' (they no longer read the call's conversation, so their row left just now: the device stops and
-- Boredroom takes it out of LiveKit's room; fix review, 10 October 2026), 'ended', 'not_found'.
CREATE OR REPLACE FUNCTION app_call_heartbeat(cid uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE k calls%ROWTYPE; me uuid; st text; n integer;
BEGIN
  SELECT * INTO k FROM calls WHERE id = cid;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  me := app_membership_id(k.organisation_id);
  IF me IS NULL THEN RETURN 'not_found'; END IF;
  IF k.state = 'ended' THEN RETURN 'ended'; END IF;
  IF NOT app_can_read_conversation(k.conversation_id) THEN
    UPDATE call_participants SET state = 'left', left_at = now(),
           seconds_in_call = seconds_in_call + GREATEST(0, floor(extract(epoch FROM (now() - joined_at))))::int
     WHERE call_id = cid AND membership_id = me AND state = 'joined' RETURNING state INTO st;
    IF st IS NOT NULL THEN RETURN 'removed'; END IF;
    RETURN CASE WHEN EXISTS (SELECT 1 FROM call_participants WHERE call_id = cid AND membership_id = me) THEN 'left' ELSE 'not_found' END;
  END IF;
  UPDATE call_participants SET last_seen_at = GREATEST(last_seen_at, now())
   WHERE call_id = cid AND membership_id = me AND state = 'joined' RETURNING state INTO st;
  IF st IS NULL THEN
    RETURN CASE WHEN EXISTS (SELECT 1 FROM call_participants WHERE call_id = cid AND membership_id = me) THEN 'left' ELSE 'not_found' END;
  END IF;
  SELECT count(*) INTO n FROM call_participants WHERE call_id = cid AND state = 'joined';
  IF n >= 2 THEN
    UPDATE calls SET last_together_at = now()
     WHERE id = cid AND state <> 'ended' AND (last_together_at IS NULL OR last_together_at < now() - interval '10 seconds');
  END IF;
  RETURN 'ok';
END $$;
GRANT EXECUTE ON FUNCTION app_call_heartbeat(uuid) TO boardroom_app;

-- "Brenda takes notes" on or off, by anyone in the call (and still reading its conversation: fix review, 10 October
-- 2026); switching on includes that person. Boredroom checks the plan, the AI connection and the workspace's switch
-- first. 'ok', 'not_found', 'ended', 'not_in_call'. A person who already said yes keeps the time they said it (fix
-- review, 10 October 2026: decided_at is when the answer was given, so pressing again never refuses their words since).
CREATE OR REPLACE FUNCTION app_call_set_notes(cid uuid, turn_on boolean) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE k calls%ROWTYPE; me uuid; mine call_participants%ROWTYPE;
BEGIN
  SELECT * INTO k FROM calls WHERE id = cid FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  me := app_membership_id(k.organisation_id);
  SELECT * INTO mine FROM call_participants WHERE call_id = cid AND membership_id = me;
  IF me IS NULL OR NOT FOUND THEN RETURN 'not_found'; END IF;
  IF k.state = 'ended' THEN RETURN 'ended'; END IF;
  IF mine.state <> 'joined' OR NOT app_can_read_conversation(k.conversation_id) THEN RETURN 'not_in_call'; END IF;
  IF COALESCE(turn_on, false) THEN
    UPDATE calls SET notes_state = 'on', notes_on_by = me, notes_on_at = now() WHERE id = cid AND notes_state = 'off';
    INSERT INTO call_note_consents AS c(call_id, organisation_id, membership_id, consent) VALUES (cid, k.organisation_id, me, 'yes')
      ON CONFLICT (call_id, membership_id) DO UPDATE SET consent = 'yes', decided_at = CASE WHEN c.consent = 'yes' THEN c.decided_at ELSE now() END;
  ELSE
    UPDATE calls SET notes_state = 'off', notes_off_at = now() WHERE id = cid AND notes_state = 'on';
  END IF;
  RETURN 'ok';
END $$;
GRANT EXECUTE ON FUNCTION app_call_set_notes(uuid, boolean) TO boardroom_app;

-- The person's own answer to notes on this call, while it runs: 'yes', or 'no' ("Not me": their lines on this call are
-- deleted at once). Only someone who is or was in the call. 'ok', 'not_found', 'ended', 'bad_choice'. The same answer
-- again keeps the time it was first given (fix review, 10 October 2026: app_call_add_lines takes words from then on).
CREATE OR REPLACE FUNCTION app_call_consent(cid uuid, choice text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE k calls%ROWTYPE; me uuid; mine call_participants%ROWTYPE;
BEGIN
  IF choice IS NULL OR choice NOT IN ('yes', 'no') THEN RETURN 'bad_choice'; END IF;
  SELECT * INTO k FROM calls WHERE id = cid;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  me := app_membership_id(k.organisation_id);
  SELECT * INTO mine FROM call_participants WHERE call_id = cid AND membership_id = me;
  IF me IS NULL OR NOT FOUND OR mine.first_joined_at IS NULL THEN RETURN 'not_found'; END IF;
  IF k.state = 'ended' THEN RETURN 'ended'; END IF;
  INSERT INTO call_note_consents AS c(call_id, organisation_id, membership_id, consent) VALUES (cid, k.organisation_id, me, choice)
    ON CONFLICT (call_id, membership_id) DO UPDATE SET consent = EXCLUDED.consent,
      decided_at = CASE WHEN c.consent = EXCLUDED.consent THEN c.decided_at ELSE now() END;
  IF choice = 'no' THEN DELETE FROM call_transcript_lines WHERE call_id = cid AND membership_id = me; END IF;
  RETURN 'ok';
END $$;
GRANT EXECUTE ON FUNCTION app_call_consent(uuid, text) TO boardroom_app;

-- Lines the person's own device wrote down from their own microphone: [{seq, at (epoch ms), text}], 1 to 10. Kept only
-- while notes are on (or went off, or the call ended, under a minute ago: the last words still arrive), the person said
-- yes, and they are (or were, under a minute ago) in the call and still read its conversation (fix review, 10 October
-- 2026); spoken after the call began and not in the future; each line once (seq). At most 2,000 lines a person and
-- 20,000 a call. Boredroom checks first that the workspace still offers notes (its switch, the plan, the AI connection).
-- The minute is for ARRIVAL only. Each line must also have been SPOKEN inside the person's own window (fix review,
-- 10 October 2026: "without consent, Brenda takes no notes" held only because the device cooperated): not before notes
-- were last switched on, not before the person's own yes, and, once notes are off or the person has left, not after
-- that. One second's grace: the device stamps a line with the server's clock (the call view's serverNow), which only
-- ever makes a line look earlier than it was, and it starts writing only after the server said yes; so a line outside
-- the window comes from a device that did not cooperate, and is refused (counted in `refused`).
-- Answers {word, accepted, refused}: 'ok', 'not_found', 'bad_lines', 'not_in_call', 'notes_off', 'no_consent', 'too_many'.
CREATE OR REPLACE FUNCTION app_call_add_lines(cid uuid, lines jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE k calls%ROWTYPE; me uuid; mine call_participants%ROWTYPE; said text; said_at timestamptz; item jsonb; s integer;
        spoken timestamptz; spoken_from timestamptz; spoken_until timestamptz;
        clean text; accepted integer := 0; refused integer := 0; mine_n integer; all_n integer; rc integer;
BEGIN
  IF lines IS NULL OR jsonb_typeof(lines) <> 'array' OR jsonb_array_length(lines) NOT BETWEEN 1 AND 10 THEN
    RETURN jsonb_build_object('word', 'bad_lines', 'accepted', 0, 'refused', 0);
  END IF;
  SELECT * INTO k FROM calls WHERE id = cid;
  IF NOT FOUND THEN RETURN jsonb_build_object('word', 'not_found', 'accepted', 0, 'refused', 0); END IF;
  me := app_membership_id(k.organisation_id);
  SELECT * INTO mine FROM call_participants WHERE call_id = cid AND membership_id = me;
  IF me IS NULL OR NOT FOUND THEN RETURN jsonb_build_object('word', 'not_found', 'accepted', 0, 'refused', 0); END IF;
  IF NOT (mine.state = 'joined' OR (mine.state = 'left' AND mine.left_at > now() - interval '60 seconds'))
     OR NOT app_can_read_conversation(k.conversation_id) THEN
    RETURN jsonb_build_object('word', 'not_in_call', 'accepted', 0, 'refused', 0);
  END IF;
  IF NOT (k.notes_state = 'on' OR (k.notes_off_at IS NOT NULL AND k.notes_off_at > now() - interval '60 seconds')) THEN
    RETURN jsonb_build_object('word', 'notes_off', 'accepted', 0, 'refused', 0);
  END IF;
  SELECT consent, decided_at INTO said, said_at FROM call_note_consents WHERE call_id = cid AND membership_id = me;
  IF said IS DISTINCT FROM 'yes' THEN RETURN jsonb_build_object('word', 'no_consent', 'accepted', 0, 'refused', 0); END IF;
  -- When this person's words may have been spoken (above): from the later of the call's start, notes last switched on and
  -- their own yes; until now (notes on), or until notes went off, or until they left.
  spoken_from := GREATEST(k.created_at, k.notes_on_at, said_at) - interval '1 second';
  spoken_until := CASE WHEN k.notes_state = 'on' THEN now() + interval '5 seconds' ELSE k.notes_off_at + interval '1 second' END;
  IF mine.state = 'left' THEN spoken_until := LEAST(spoken_until, mine.left_at + interval '1 second'); END IF;
  SELECT count(*) FILTER (WHERE membership_id = me), count(*) INTO mine_n, all_n FROM call_transcript_lines WHERE call_id = cid;
  IF mine_n + jsonb_array_length(lines) > 2000 OR all_n + jsonb_array_length(lines) > 20000 THEN
    RETURN jsonb_build_object('word', 'too_many', 'accepted', 0, 'refused', 0);
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(lines) LOOP
    IF jsonb_typeof(item) <> 'object' OR jsonb_typeof(item->'text') <> 'string'
       OR COALESCE(item->>'seq', '') !~ '^[0-9]{1,8}$' OR COALESCE(item->>'at', '') !~ '^[0-9]{10,15}$' THEN
      refused := refused + 1; CONTINUE;
    END IF;
    s := (item->>'seq')::integer;
    spoken := to_timestamp((item->>'at')::numeric / 1000.0);
    clean := btrim(regexp_replace(item->>'text', '[[:cntrl:][:space:]]+', ' ', 'g'));
    IF s > 10000000 OR char_length(clean) NOT BETWEEN 1 AND 1000
       OR spoken < spoken_from OR spoken > spoken_until OR spoken > now() + interval '5 seconds' THEN
      refused := refused + 1; CONTINUE;
    END IF;
    INSERT INTO call_transcript_lines(call_id, organisation_id, membership_id, seq, spoken_at, text)
    VALUES (cid, k.organisation_id, me, s, spoken, clean)
    ON CONFLICT (call_id, membership_id, seq) DO NOTHING;
    GET DIAGNOSTICS rc = ROW_COUNT;
    IF rc = 1 THEN accepted := accepted + 1; ELSE refused := refused + 1; END IF;
  END LOOP;
  RETURN jsonb_build_object('word', 'ok', 'accepted', accepted, 'refused', refused);
END $$;
GRANT EXECUTE ON FUNCTION app_call_add_lines(uuid, jsonb) TO boardroom_app;

-- Who is in a live call in the organisation now (membership ids only, never which call): the Workroom's "On a call", the
-- person card, the notch's faces. Members of the organisation (and the worker) only.
CREATE OR REPLACE FUNCTION app_members_on_call(org uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT p.membership_id FROM call_participants p JOIN calls c ON c.id = p.call_id
  WHERE app_is_member(org) AND c.organisation_id = org AND c.state <> 'ended' AND p.state = 'joined'
$$;
GRANT EXECUTE ON FUNCTION app_members_on_call(uuid) TO boardroom_app;

-- 6. Additions ----------------------------------------------------------------------------------------------------------
-- A call's line or recap in its thread: only ever a 'workspace' message (written only by the worker, 0048's guard).
ALTER TABLE messages ADD COLUMN IF NOT EXISTS call_id uuid;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS call_part text;
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_call_part_check;
ALTER TABLE messages ADD CONSTRAINT messages_call_part_check
  CHECK ((call_id IS NULL) = (call_part IS NULL) AND (call_part IS NULL OR (call_part IN ('line', 'recap') AND author_kind = 'workspace')));
CREATE INDEX IF NOT EXISTS messages_call_idx ON messages(call_id) WHERE call_id IS NOT NULL;

-- An action item from a call's recap, which its person must accept: a promise with nobody asking, one per item.
ALTER TABLE commitments ADD COLUMN IF NOT EXISTS call_id uuid;
ALTER TABLE commitments ADD COLUMN IF NOT EXISTS call_item smallint;
ALTER TABLE commitments DROP CONSTRAINT IF EXISTS commitments_call_shape_check;
ALTER TABLE commitments ADD CONSTRAINT commitments_call_shape_check
  CHECK ((call_id IS NULL) = (call_item IS NULL) AND (call_item IS NULL OR (call_item BETWEEN 0 AND 19 AND kind = 'promise' AND asker_membership_id IS NULL)));
-- 0048's rule (one commitment per message and person) with the item added: NULL (every detected commitment) counts as a
-- value, so detected commitments keep exactly their old rule. Same name: `ON CONFLICT ON CONSTRAINT` callers are unchanged.
ALTER TABLE commitments DROP CONSTRAINT IF EXISTS commitments_one_per_message;
ALTER TABLE commitments ADD CONSTRAINT commitments_one_per_message
  UNIQUE NULLS NOT DISTINCT (organisation_id, source_message_id, committer_membership_id, call_item);
CREATE INDEX IF NOT EXISTS commitments_call_idx ON commitments(call_id) WHERE call_id IS NOT NULL;

-- As 0048, and the call an action item came from is fixed too.
CREATE OR REPLACE FUNCTION commitments_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.organisation_id IS DISTINCT FROM OLD.organisation_id OR NEW.conversation_id IS DISTINCT FROM OLD.conversation_id
     OR NEW.source_message_id IS DISTINCT FROM OLD.source_message_id OR NEW.committer_membership_id IS DISTINCT FROM OLD.committer_membership_id
     OR NEW.asker_membership_id IS DISTINCT FROM OLD.asker_membership_id OR NEW.detected_by IS DISTINCT FROM OLD.detected_by
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.call_id IS DISTINCT FROM OLD.call_id OR NEW.call_item IS DISTINCT FROM OLD.call_item
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
-- The trigger itself (0048) is unchanged: it calls the function by name.

-- 0050's purposes + 'call_recap' (the workspace's own recap of a call; counted against nobody's allowance).
ALTER TABLE ai_usage DROP CONSTRAINT IF EXISTS ai_usage_purpose_check;
ALTER TABLE ai_usage ADD CONSTRAINT ai_usage_purpose_check
  CHECK (purpose IN ('chat', 'plan', 'report', 'summary', 'test', 'other', 'followup', 'mention', 'loose_ends', 'commitments', 'standup', 'call_recap'));

-- 0050's workspace abilities + 'call_notes' (Brenda's notes on calls; on unless an owner or HR switches it off).
ALTER TABLE brenda_settings DROP CONSTRAINT IF EXISTS brenda_settings_abilities_off_check;
ALTER TABLE brenda_settings ADD CONSTRAINT brenda_settings_abilities_off_check CHECK (
  abilities_off <@ ARRAY['catch_up', 'loose_ends', 'follow_ups', 'assistant_talk', 'routines', 'standup', 'voice', 'morning_opener', 'call_notes']::text[]
  AND cardinality(abilities_off) <= 16);

-- 7. Seeded copy that described screen recording (only where it is still the seed text: the owner may have changed it) ----
UPDATE plans SET description = 'Everything a remote team needs.'
 WHERE code = 'pro' AND description = 'Everything a remote team needs, recordings included.';
UPDATE email_templates
   SET body = 'The {{plan_name}} plan for {{organization_name}} ends on {{subscription_expiry}}. Renew to keep reports and history for the whole team.'
 WHERE code = 'subscription_expiring'
   AND body = 'The {{plan_name}} plan for {{organization_name}} ends on {{subscription_expiry}}. Renew to keep recordings, reports and history for the whole team.';

-- 8. Which device rings (fix review, 10 October 2026: the web tab and the notch rang at once, on their own timers) ---------
-- A signed-in notch says on each ring poll (GET /calls/now, every few seconds) whether it can ring aloud (its sounds on,
-- not in quiet hours), from which network (a hash of the address it polls from; never the address itself). While it can
-- (seen in the last 20 seconds), a browser on the same network shows the incoming card without its own ring, so a person
-- at their Mac hears one ring: the notch's. A browser elsewhere (another network) still rings. Server-only: read and
-- written by Boredroom's routes in the system context, never under a person's own context.
CREATE TABLE IF NOT EXISTS call_ringers (
  membership_id    uuid PRIMARY KEY,
  organisation_id  uuid NOT NULL,
  network          text NOT NULL CONSTRAINT call_ringers_network_check CHECK (network ~ '^[0-9a-f]{16,64}$'),
  rings_at         timestamptz NOT NULL,          -- the notch's latest poll that said it rings aloud
  FOREIGN KEY (membership_id, organisation_id) REFERENCES memberships(id, organisation_id)
);
ALTER TABLE call_ringers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS call_ringers_system ON call_ringers;
CREATE POLICY call_ringers_system ON call_ringers FOR ALL USING (app_is_worker()) WITH CHECK (app_is_worker());
GRANT SELECT, INSERT, UPDATE, DELETE ON call_ringers TO boardroom_app;
REVOKE TRUNCATE ON call_ringers FROM boardroom_app;
