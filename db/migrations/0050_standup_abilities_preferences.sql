-- Phase 7c (owner decisions, 8–9 October 2026: "Brenda keeps the loops closed", third part). Seven things:
-- 1. team_standups: a team's async standup (option B), switched on per team by its lead, the owner or HR (OFF for every
--    team until someone switches it on), with the time drafts arrive, the cutoff for the lead's rollup and the days it
--    runs, all on the organisation's clock. Every member reads a team's settings; only app_standup_can_manage writes.
-- 2. standup_rollups and standup_rollup_recipients: one row per team per standup day (opened at the post time, closed
--    at the cutoff, when the lead's rollup is assembled and sent), and who receives it. Only the worker writes; a
--    recipient reads their own rollups and marks them seen (app_standup_rollup_seen).
-- 3. standup_entries: one person's standup for one team on one day: the draft their own assistant wrote from their work,
--    their edits, and whether they posted it, skipped the day or let it pass. Private to the person (their lead never
--    reads a draft; the rollup is built by the worker). The person's steps are definer functions that answer with a word
--    (edit, skip, unskip, seen, the post check and the posted mark); the status machine is guarded for every role.
-- 4. Abilities (the catalogue in Settings): brenda_settings.abilities_off (what the workspace does not offer; empty: every
--    ability on, today's behaviour) and assistant_private.abilities_off (what the person switched off for their own
--    assistant; empty). Existing switches (mention_replies, track_commitments, allow_auto_act, report_notes,
--    routines_chase_leads_only, assistant_profiles.act_mode, speak, followups, allow_thread_replies) stay the source of
--    truth for what they govern; these lists hold only the abilities that had no switch.
-- 5. assistant_preferences: "How I like things done", at most 16 a person, 150 characters each, in their own words.
--    Only the person reads and writes them (owners and HR never see them); the worker reads them for the person's own
--    standup draft. A trigger keeps the limit for every writer.
-- 6. Private decline labels (owner decision, 9 October 2026): a commitment label "Declined" or "Not a commitment" is read
--    only by the committer and the asker; every other reader of the conversation reads no label for that message.
--    "Noted" and "Done" stay visible to every reader, as in 0048.
-- 7. Replaced, old semantics kept exactly plus the change: message_labels_select (0048: the worker, or anyone who reads
--    the conversation; now: the worker, or a reader of the conversation for 'noted' and 'done', or a reader who is the
--    committer or asker of a declined or dismissed commitment on that message), ai_usage_purpose_check (0048's list +
--    'standup') and assistant_mention_private_note_check (0043's list + 'off_ability': the tagger switched @mentions off
--    for their own assistant).
-- Additive and idempotent: safe to run by hand twice. `DROP … IF EXISTS` only on objects this file creates or replaces
-- (named above). Not CONCURRENTLY: the runner wraps each file in a transaction. Requires 0049 (applied in order). Code
-- deployed before this runs offers none of 1 to 5 and says so (server/lib/schema-0050); 6 is already enforced in the
-- label query before this runs (commitments.ts labelsIn), and by the policy after.

-- 1. Team standup settings ---------------------------------------------------------------------------------------------
-- Whether the caller may change a team's standup: the owner and HR of its organisation, or a lead of that team. An
-- archived team cannot be changed.
CREATE OR REPLACE FUNCTION app_standup_can_manage(team uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM teams t
    WHERE t.id = team AND t.archived_at IS NULL
      AND (app_has_role(t.organisation_id, 'owner', 'hr')
           OR EXISTS (SELECT 1 FROM team_members tm
                      WHERE tm.team_id = t.id AND tm.is_manager AND tm.membership_id = app_membership_id(t.organisation_id))))
$$;
GRANT EXECUTE ON FUNCTION app_standup_can_manage(uuid) TO boardroom_app;

CREATE TABLE IF NOT EXISTS team_standups (
  team_id          uuid PRIMARY KEY,
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  enabled          boolean NOT NULL DEFAULT false,
  post_time        time NOT NULL DEFAULT '09:30',
  cutoff_time      time NOT NULL DEFAULT '12:00',
  days             smallint[] NOT NULL DEFAULT '{1,2,3,4,5}'::smallint[],   -- 0 = Sunday … 6 = Saturday
  enabled_by       uuid,
  enabled_at       timestamptz,
  updated_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (team_id, organisation_id) REFERENCES teams(id, organisation_id),
  FOREIGN KEY (enabled_by, organisation_id) REFERENCES memberships(id, organisation_id),
  FOREIGN KEY (updated_by, organisation_id) REFERENCES memberships(id, organisation_id),
  CONSTRAINT team_standups_times_check CHECK (cutoff_time - post_time >= interval '30 minutes'
                                              AND extract(second FROM post_time) = 0 AND extract(second FROM cutoff_time) = 0),
  CONSTRAINT team_standups_days_check CHECK (days <@ '{0,1,2,3,4,5,6}'::smallint[] AND cardinality(days) BETWEEN 1 AND 7)
);
CREATE INDEX IF NOT EXISTS team_standups_org_idx ON team_standups(organisation_id) WHERE enabled;
DROP TRIGGER IF EXISTS team_standups_updated ON team_standups;
CREATE TRIGGER team_standups_updated BEFORE UPDATE ON team_standups FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A team's standup stays with its team (every role; a data fix disables the trigger by name).
CREATE OR REPLACE FUNCTION team_standups_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.team_id IS DISTINCT FROM OLD.team_id OR NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'STANDUP_FIXED: a team''s standup stays with its team' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS team_standups_guard ON team_standups;
CREATE TRIGGER team_standups_guard BEFORE UPDATE ON team_standups FOR EACH ROW EXECUTE FUNCTION team_standups_guard();
-- No change events (fixed by the foundation builder, 9 October 2026: the contract's draft refused every write here):
-- notify_org_change sends NEW.id and this table's key is team_id, so the trigger failed with 'record "new" has no field
-- "id"' (as 0041 notes for assistant_mention_private). The team page reads the settings when it loads.
DROP TRIGGER IF EXISTS team_standups_notify ON team_standups;

ALTER TABLE team_standups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS team_standups_select ON team_standups;
CREATE POLICY team_standups_select ON team_standups FOR SELECT USING (app_is_worker() OR app_is_member(organisation_id));
DROP POLICY IF EXISTS team_standups_insert ON team_standups;
CREATE POLICY team_standups_insert ON team_standups FOR INSERT WITH CHECK (app_is_worker() OR app_standup_can_manage(team_id));
DROP POLICY IF EXISTS team_standups_update ON team_standups;
CREATE POLICY team_standups_update ON team_standups FOR UPDATE
  USING (app_is_worker() OR app_standup_can_manage(team_id)) WITH CHECK (app_is_worker() OR app_standup_can_manage(team_id));
GRANT SELECT, INSERT, UPDATE ON team_standups TO boardroom_app;
REVOKE DELETE, TRUNCATE ON team_standups FROM boardroom_app;

-- 2. The team's standup day and its rollup -------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS standup_rollups (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  team_id          uuid NOT NULL,
  local_date       date NOT NULL,
  post_at          timestamptz NOT NULL,          -- the day's post time on the organisation's clock
  cutoff_at        timestamptz NOT NULL,          -- the day's cutoff
  status           text NOT NULL DEFAULT 'open' CONSTRAINT standup_rollups_status_check CHECK (status IN ('open', 'sent', 'skipped')),
  reason           text CONSTRAINT standup_rollups_reason_check CHECK (reason IS NULL OR char_length(reason) BETWEEN 1 AND 64),
  content          jsonb,                         -- StandupRollupContent (lib/standup), written at the cutoff
  sent_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organisation_id),
  CONSTRAINT standup_rollups_one UNIQUE (team_id, local_date),
  FOREIGN KEY (team_id, organisation_id) REFERENCES teams(id, organisation_id),
  CONSTRAINT standup_rollups_times_check CHECK (cutoff_at > post_at),
  CONSTRAINT standup_rollups_sent_check CHECK ((status = 'sent') = (sent_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS standup_rollups_due_idx ON standup_rollups(cutoff_at) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS standup_rollups_org_idx ON standup_rollups(organisation_id, local_date DESC);
DROP TRIGGER IF EXISTS standup_rollups_updated ON standup_rollups;
CREATE TRIGGER standup_rollups_updated BEFORE UPDATE ON standup_rollups FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS standup_rollups_notify ON standup_rollups;
CREATE TRIGGER standup_rollups_notify AFTER INSERT OR UPDATE ON standup_rollups FOR EACH ROW EXECUTE FUNCTION notify_org_change();

CREATE TABLE IF NOT EXISTS standup_rollup_recipients (
  rollup_id        uuid NOT NULL,
  organisation_id  uuid NOT NULL,
  membership_id    uuid NOT NULL,
  notify_at        timestamptz NOT NULL,          -- after the recipient's quiet hours
  notified_at      timestamptz,
  seen_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rollup_id, membership_id),
  FOREIGN KEY (rollup_id, organisation_id) REFERENCES standup_rollups(id, organisation_id),
  FOREIGN KEY (membership_id, organisation_id) REFERENCES memberships(id, organisation_id)
);
CREATE INDEX IF NOT EXISTS standup_rollup_recipients_member_idx ON standup_rollup_recipients(membership_id, created_at DESC);
CREATE INDEX IF NOT EXISTS standup_rollup_recipients_due_idx ON standup_rollup_recipients(notify_at) WHERE notified_at IS NULL;

ALTER TABLE standup_rollup_recipients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS standup_rollup_recipients_select ON standup_rollup_recipients;
CREATE POLICY standup_rollup_recipients_select ON standup_rollup_recipients FOR SELECT
  USING (app_is_worker() OR membership_id = app_membership_id(organisation_id));
DROP POLICY IF EXISTS standup_rollup_recipients_worker ON standup_rollup_recipients;
CREATE POLICY standup_rollup_recipients_worker ON standup_rollup_recipients FOR ALL USING (app_is_worker()) WITH CHECK (app_is_worker());
GRANT SELECT, INSERT, UPDATE ON standup_rollup_recipients TO boardroom_app;
REVOKE DELETE, TRUNCATE ON standup_rollup_recipients FROM boardroom_app;

ALTER TABLE standup_rollups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS standup_rollups_select ON standup_rollups;
CREATE POLICY standup_rollups_select ON standup_rollups FOR SELECT
  USING (app_is_worker() OR EXISTS (SELECT 1 FROM standup_rollup_recipients r
                                    WHERE r.rollup_id = standup_rollups.id AND r.membership_id = app_membership_id(standup_rollups.organisation_id)));
DROP POLICY IF EXISTS standup_rollups_worker ON standup_rollups;
CREATE POLICY standup_rollups_worker ON standup_rollups FOR ALL USING (app_is_worker()) WITH CHECK (app_is_worker());
GRANT SELECT, INSERT, UPDATE ON standup_rollups TO boardroom_app;
REVOKE DELETE, TRUNCATE ON standup_rollups FROM boardroom_app;

-- A recipient marks their rollup seen: 'ok' (also when already seen), 'not_found'.
CREATE OR REPLACE FUNCTION app_standup_rollup_seen(r uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  UPDATE standup_rollup_recipients x SET seen_at = COALESCE(x.seen_at, now())
   WHERE x.rollup_id = r AND x.membership_id = app_membership_id(x.organisation_id);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN CASE WHEN n > 0 THEN 'ok' ELSE 'not_found' END;
END $$;
GRANT EXECUTE ON FUNCTION app_standup_rollup_seen(uuid) TO boardroom_app;

-- 3. One person's standup ----------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS standup_entries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  team_id          uuid NOT NULL,
  rollup_id        uuid NOT NULL,                 -- the team's day
  membership_id    uuid NOT NULL,
  local_date       date NOT NULL,
  status           text NOT NULL DEFAULT 'drafting' CONSTRAINT standup_entries_status_check
                     CHECK (status IN ('drafting', 'ready', 'posted', 'skipped', 'missed', 'failed', 'cancelled')),
  engine           text CONSTRAINT standup_entries_engine_check CHECK (engine IS NULL OR engine IN ('template', 'claude')),
  draft            jsonb,                         -- StandupDraft (lib/standup): the drafted lines with their sources
  yesterday_text   text CONSTRAINT standup_entries_yesterday_check CHECK (yesterday_text IS NULL OR (char_length(yesterday_text) <= 1200 AND replace(yesterday_text, E'\n', '') !~ '[[:cntrl:]]')),
  today_text       text CONSTRAINT standup_entries_today_check CHECK (today_text IS NULL OR (char_length(today_text) <= 1200 AND replace(today_text, E'\n', '') !~ '[[:cntrl:]]')),
  blocked_text     text CONSTRAINT standup_entries_blocked_check CHECK (blocked_text IS NULL OR (char_length(blocked_text) <= 1200 AND replace(blocked_text, E'\n', '') !~ '[[:cntrl:]]')),
  blockers         jsonb NOT NULL DEFAULT '[]'::jsonb CONSTRAINT standup_entries_blockers_check CHECK (jsonb_typeof(blockers) = 'array'),
  edited           boolean NOT NULL DEFAULT false,
  attempts         smallint NOT NULL DEFAULT 0 CONSTRAINT standup_entries_attempts_check CHECK (attempts BETWEEN 0 AND 10),
  lease_until      timestamptz,
  drafted_at       timestamptz,
  notify_at        timestamptz,                   -- after the person's quiet hours
  notified_at      timestamptz,
  seen_at          timestamptz,
  conversation_id  uuid,                          -- the team channel it went to (no FK: channels can be deleted)
  message_id       uuid REFERENCES messages(id) ON DELETE SET NULL,
  posted_at        timestamptz,
  posted_late      boolean NOT NULL DEFAULT false,
  rollup_noted_at  timestamptz,                   -- a late post added to the day's rollup
  skipped_at       timestamptz,
  reason           text CONSTRAINT standup_entries_reason_check CHECK (reason IS NULL OR char_length(reason) BETWEEN 1 AND 64),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organisation_id),
  CONSTRAINT standup_entries_one UNIQUE (team_id, membership_id, local_date),
  FOREIGN KEY (team_id, organisation_id) REFERENCES teams(id, organisation_id),
  FOREIGN KEY (rollup_id, organisation_id) REFERENCES standup_rollups(id, organisation_id),
  FOREIGN KEY (membership_id, organisation_id) REFERENCES memberships(id, organisation_id),
  CONSTRAINT standup_entries_posted_shape_check CHECK ((status = 'posted') = (posted_at IS NOT NULL)),
  CONSTRAINT standup_entries_text_shape_check CHECK (status NOT IN ('ready', 'posted')
    OR (yesterday_text IS NOT NULL AND today_text IS NOT NULL AND blocked_text IS NOT NULL AND drafted_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS standup_entries_member_idx ON standup_entries(membership_id, local_date DESC);
CREATE INDEX IF NOT EXISTS standup_entries_rollup_idx ON standup_entries(rollup_id);
CREATE INDEX IF NOT EXISTS standup_entries_drafting_idx ON standup_entries(lease_until) WHERE status = 'drafting';
CREATE INDEX IF NOT EXISTS standup_entries_notify_idx ON standup_entries(notify_at) WHERE status = 'ready' AND notified_at IS NULL;
CREATE INDEX IF NOT EXISTS standup_entries_open_idx ON standup_entries(local_date) WHERE status IN ('drafting', 'ready', 'failed');
CREATE INDEX IF NOT EXISTS standup_entries_late_idx ON standup_entries(rollup_id) WHERE posted_late AND rollup_noted_at IS NULL;
CREATE INDEX IF NOT EXISTS standup_entries_message_idx ON standup_entries(message_id) WHERE message_id IS NOT NULL;
DROP TRIGGER IF EXISTS standup_entries_updated ON standup_entries;
CREATE TRIGGER standup_entries_updated BEFORE UPDATE ON standup_entries FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Whose standup, which team and which day never change; a posted standup is kept exactly as it was posted; the status
-- moves only along the machine below (every role; a data fix disables the trigger by name).
CREATE OR REPLACE FUNCTION standup_entries_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.organisation_id IS DISTINCT FROM OLD.organisation_id OR NEW.team_id IS DISTINCT FROM OLD.team_id
     OR NEW.rollup_id IS DISTINCT FROM OLD.rollup_id OR NEW.membership_id IS DISTINCT FROM OLD.membership_id
     OR NEW.local_date IS DISTINCT FROM OLD.local_date OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'STANDUP_FIXED: whose standup, for which team and day, cannot change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status = 'posted' AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.yesterday_text IS DISTINCT FROM OLD.yesterday_text
     OR NEW.today_text IS DISTINCT FROM OLD.today_text OR NEW.blocked_text IS DISTINCT FROM OLD.blocked_text
     OR NEW.posted_at IS DISTINCT FROM OLD.posted_at OR NEW.conversation_id IS DISTINCT FROM OLD.conversation_id) THEN
    RAISE EXCEPTION 'STANDUP_POSTED: a posted standup is kept as it was posted' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'drafting' AND NEW.status IN ('ready', 'failed', 'skipped', 'missed', 'cancelled'))
    OR (OLD.status = 'failed' AND NEW.status IN ('drafting', 'skipped', 'missed', 'cancelled'))
    OR (OLD.status = 'ready' AND NEW.status IN ('posted', 'skipped', 'missed', 'cancelled'))
    OR (OLD.status = 'skipped' AND NEW.status IN ('ready', 'drafting', 'missed', 'cancelled'))) THEN
    RAISE EXCEPTION 'STANDUP_TRANSITION: % to % is not allowed', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS standup_entries_guard ON standup_entries;
CREATE TRIGGER standup_entries_guard BEFORE UPDATE ON standup_entries FOR EACH ROW EXECUTE FUNCTION standup_entries_guard();
DROP TRIGGER IF EXISTS standup_entries_notify ON standup_entries;
CREATE TRIGGER standup_entries_notify AFTER INSERT OR UPDATE ON standup_entries FOR EACH ROW EXECUTE FUNCTION notify_org_change();

ALTER TABLE standup_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS standup_entries_select ON standup_entries;
CREATE POLICY standup_entries_select ON standup_entries FOR SELECT
  USING (app_is_worker() OR membership_id = app_membership_id(organisation_id));
DROP POLICY IF EXISTS standup_entries_worker ON standup_entries;
CREATE POLICY standup_entries_worker ON standup_entries FOR ALL USING (app_is_worker()) WITH CHECK (app_is_worker());
GRANT SELECT, INSERT, UPDATE ON standup_entries TO boardroom_app;
REVOKE DELETE, TRUNCATE ON standup_entries FROM boardroom_app;

-- The person's steps (definer functions; each answers with a word; anyone else's id reads 'not_found'). Texts arrive
-- cleaned by the service (lib/standup cleanSection: CRLF to LF, tabs and other controls to spaces, trimmed); the column
-- checks are the floor.
-- Edit, while ready: 'ok', 'not_found', 'closed', 'too_long', 'invalid', 'empty' (all three sections empty).
CREATE OR REPLACE FUNCTION app_standup_edit(e uuid, y text, t text, b text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE i standup_entries%ROWTYPE; cy text; ct text; cb text;
BEGIN
  SELECT * INTO i FROM standup_entries WHERE id = e FOR UPDATE;
  IF NOT FOUND OR app_membership_id(i.organisation_id) IS DISTINCT FROM i.membership_id THEN RETURN 'not_found'; END IF;
  IF i.status <> 'ready' THEN RETURN 'closed'; END IF;
  cy := btrim(COALESCE(y, i.yesterday_text)); ct := btrim(COALESCE(t, i.today_text)); cb := btrim(COALESCE(b, i.blocked_text));
  IF char_length(cy) > 1200 OR char_length(ct) > 1200 OR char_length(cb) > 1200 THEN RETURN 'too_long'; END IF;
  IF replace(cy || ct || cb, E'\n', '') ~ '[[:cntrl:]]' THEN RETURN 'invalid'; END IF;
  IF cy = '' AND ct = '' AND cb = '' THEN RETURN 'empty'; END IF;
  UPDATE standup_entries SET yesterday_text = cy, today_text = ct, blocked_text = cb, edited = true, seen_at = COALESCE(seen_at, now()) WHERE id = e;
  RETURN 'ok';
END $$;
GRANT EXECUTE ON FUNCTION app_standup_edit(uuid, text, text, text) TO boardroom_app;

-- Skip today: 'ok' (also when already skipped), 'not_found', 'closed' (posted, missed or cancelled).
CREATE OR REPLACE FUNCTION app_standup_skip(e uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE i standup_entries%ROWTYPE;
BEGIN
  SELECT * INTO i FROM standup_entries WHERE id = e FOR UPDATE;
  IF NOT FOUND OR app_membership_id(i.organisation_id) IS DISTINCT FROM i.membership_id THEN RETURN 'not_found'; END IF;
  IF i.status = 'skipped' THEN RETURN 'ok'; END IF;
  IF i.status NOT IN ('drafting', 'ready', 'failed') THEN RETURN 'closed'; END IF;
  UPDATE standup_entries SET status = 'skipped', skipped_at = now(), lease_until = NULL, seen_at = COALESCE(seen_at, now()) WHERE id = e;
  RETURN 'ok';
END $$;
GRANT EXECUTE ON FUNCTION app_standup_skip(uuid) TO boardroom_app;

-- Undo a skip while the day's rollup is still open: 'ok', 'not_found', 'closed' (not skipped), 'too_late'.
CREATE OR REPLACE FUNCTION app_standup_unskip(e uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE i standup_entries%ROWTYPE;
BEGIN
  SELECT * INTO i FROM standup_entries WHERE id = e FOR UPDATE;
  IF NOT FOUND OR app_membership_id(i.organisation_id) IS DISTINCT FROM i.membership_id THEN RETURN 'not_found'; END IF;
  IF i.status <> 'skipped' THEN RETURN 'closed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM standup_rollups r WHERE r.id = i.rollup_id AND r.status = 'open' AND r.cutoff_at > now()) THEN RETURN 'too_late'; END IF;
  UPDATE standup_entries SET status = CASE WHEN drafted_at IS NOT NULL THEN 'ready' ELSE 'drafting' END, skipped_at = NULL WHERE id = e;
  RETURN 'ok';
END $$;
GRANT EXECUTE ON FUNCTION app_standup_unskip(uuid) TO boardroom_app;

-- Seen: 'ok' (also when already seen), 'not_found'.
CREATE OR REPLACE FUNCTION app_standup_seen(e uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE i standup_entries%ROWTYPE;
BEGIN
  SELECT * INTO i FROM standup_entries WHERE id = e FOR UPDATE;
  IF NOT FOUND OR app_membership_id(i.organisation_id) IS DISTINCT FROM i.membership_id THEN RETURN 'not_found'; END IF;
  IF i.seen_at IS NULL THEN UPDATE standup_entries SET seen_at = now() WHERE id = e; END IF;
  RETURN 'ok';
END $$;
GRANT EXECUTE ON FUNCTION app_standup_seen(uuid) TO boardroom_app;

-- Before posting, in the poster's own transaction (the row stays locked until it commits, so a second press waits and
-- then reads 'posted'): 'ok', 'posted', 'not_found', 'closed' (not ready), 'not_in_team', 'off' (the team's standup is off).
CREATE OR REPLACE FUNCTION app_standup_post_check(e uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE i standup_entries%ROWTYPE;
BEGIN
  SELECT * INTO i FROM standup_entries WHERE id = e FOR UPDATE;
  IF NOT FOUND OR app_membership_id(i.organisation_id) IS DISTINCT FROM i.membership_id THEN RETURN 'not_found'; END IF;
  IF i.status = 'posted' THEN RETURN 'posted'; END IF;
  IF i.status <> 'ready' THEN RETURN 'closed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM team_members tm JOIN teams t ON t.id = tm.team_id AND t.archived_at IS NULL
                 WHERE tm.team_id = i.team_id AND tm.membership_id = i.membership_id) THEN RETURN 'not_in_team'; END IF;
  IF NOT EXISTS (SELECT 1 FROM team_standups s WHERE s.team_id = i.team_id AND s.enabled) THEN RETURN 'off'; END IF;
  RETURN 'ok';
END $$;
GRANT EXECUTE ON FUNCTION app_standup_post_check(uuid) TO boardroom_app;

-- Posted: the message the person's own transaction just wrote, in their team's channel, as theirs via their assistant.
-- 'ok', 'not_found', 'closed', 'bad_message'.
CREATE OR REPLACE FUNCTION app_standup_mark_posted(e uuid, msg uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE i standup_entries%ROWTYPE; m messages%ROWTYPE;
BEGIN
  SELECT * INTO i FROM standup_entries WHERE id = e FOR UPDATE;
  IF NOT FOUND OR app_membership_id(i.organisation_id) IS DISTINCT FROM i.membership_id THEN RETURN 'not_found'; END IF;
  IF i.status <> 'ready' THEN RETURN 'closed'; END IF;
  SELECT * INTO m FROM messages WHERE id = msg;
  IF NOT FOUND OR m.sender_membership_id IS DISTINCT FROM i.membership_id OR m.author_kind <> 'via_assistant' OR m.deleted_at IS NOT NULL
     OR NOT EXISTS (SELECT 1 FROM conversations c WHERE c.id = m.conversation_id AND c.kind = 'team' AND c.team_id = i.team_id) THEN
    RETURN 'bad_message';
  END IF;
  UPDATE standup_entries
     SET status = 'posted', posted_at = now(), message_id = msg, conversation_id = m.conversation_id, lease_until = NULL,
         seen_at = COALESCE(seen_at, now()),
         posted_late = EXISTS (SELECT 1 FROM standup_rollups r WHERE r.id = i.rollup_id AND r.status <> 'open')
   WHERE id = e;
  RETURN 'ok';
END $$;
GRANT EXECUTE ON FUNCTION app_standup_mark_posted(uuid, uuid) TO boardroom_app;

-- 4. Abilities ---------------------------------------------------------------------------------------------------------
ALTER TABLE brenda_settings ADD COLUMN IF NOT EXISTS abilities_off text[] NOT NULL DEFAULT '{}'::text[];
ALTER TABLE brenda_settings DROP CONSTRAINT IF EXISTS brenda_settings_abilities_off_check;
ALTER TABLE brenda_settings ADD CONSTRAINT brenda_settings_abilities_off_check CHECK (
  abilities_off <@ ARRAY['catch_up', 'loose_ends', 'follow_ups', 'assistant_talk', 'routines', 'standup', 'voice', 'morning_opener']::text[]
  AND cardinality(abilities_off) <= 16);
ALTER TABLE assistant_private ADD COLUMN IF NOT EXISTS abilities_off text[] NOT NULL DEFAULT '{}'::text[];
ALTER TABLE assistant_private DROP CONSTRAINT IF EXISTS assistant_private_abilities_off_check;
ALTER TABLE assistant_private ADD CONSTRAINT assistant_private_abilities_off_check CHECK (
  abilities_off <@ ARRAY['catch_up', 'loose_ends', 'follow_ups', 'assistant_talk', 'mentions', 'routines', 'standup', 'morning_opener']::text[]
  AND cardinality(abilities_off) <= 16);
-- 0026's and 0047's policies cover both columns (owners and HR write the workspace's; only the person, and the worker,
-- read and write their own).

-- 5. How I like things done --------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assistant_preferences (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  membership_id    uuid NOT NULL,
  body             text NOT NULL CONSTRAINT assistant_preferences_body_check
                     CHECK (char_length(body) BETWEEN 1 AND 150 AND body = btrim(body) AND body !~ '[[:cntrl:]]'),
  source           text NOT NULL DEFAULT 'settings' CONSTRAINT assistant_preferences_source_check CHECK (source IN ('settings', 'chat')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (membership_id, organisation_id) REFERENCES memberships(id, organisation_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS assistant_preferences_body_idx ON assistant_preferences(membership_id, lower(body));
CREATE INDEX IF NOT EXISTS assistant_preferences_member_idx ON assistant_preferences(membership_id, created_at);
DROP TRIGGER IF EXISTS assistant_preferences_updated ON assistant_preferences;
CREATE TRIGGER assistant_preferences_updated BEFORE UPDATE ON assistant_preferences FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- At most 16 a person, whoever writes (two saves at once take turns on the person's lock); whose it is never changes.
CREATE OR REPLACE FUNCTION assistant_preferences_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.membership_id IS DISTINCT FROM OLD.membership_id OR NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.source IS DISTINCT FROM OLD.source THEN
      RAISE EXCEPTION 'PREFERENCE_FIXED: whose preference it is cannot change' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('assistant_preferences:' || NEW.membership_id::text));
  IF (SELECT count(*) FROM assistant_preferences WHERE membership_id = NEW.membership_id) >= 16 THEN
    RAISE EXCEPTION 'PREFERENCES_FULL: at most 16 preferences' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS assistant_preferences_guard ON assistant_preferences;
CREATE TRIGGER assistant_preferences_guard BEFORE INSERT OR UPDATE ON assistant_preferences FOR EACH ROW EXECUTE FUNCTION assistant_preferences_guard();

ALTER TABLE assistant_preferences ENABLE ROW LEVEL SECURITY;
-- Only the person reads and writes their own (owners, HR and leads read nothing); the worker reads them for the
-- person's own standup draft. No notify trigger: nothing about them is broadcast.
DROP POLICY IF EXISTS assistant_preferences_own ON assistant_preferences;
CREATE POLICY assistant_preferences_own ON assistant_preferences FOR ALL
  USING (membership_id = app_membership_id(organisation_id)) WITH CHECK (membership_id = app_membership_id(organisation_id));
DROP POLICY IF EXISTS assistant_preferences_worker ON assistant_preferences;
CREATE POLICY assistant_preferences_worker ON assistant_preferences FOR SELECT USING (app_is_worker());
GRANT SELECT, INSERT, UPDATE, DELETE ON assistant_preferences TO boardroom_app;
REVOKE TRUNCATE ON assistant_preferences FROM boardroom_app;

-- 6. Private decline labels (owner decision, 9 October 2026) ---------------------------------------------------------------
-- Whether the caller is the committer or the asker of a declined or dismissed commitment on this message (the label's
-- message: the agreement for an agreed ask, else the promise or the ask, as commitments.ts syncLabel picks it).
CREATE OR REPLACE FUNCTION app_label_party(msg uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM commitments x
    WHERE (x.agreement_message_id = msg OR (x.agreement_message_id IS NULL AND x.source_message_id = msg))
      AND x.status IN ('declined', 'dismissed')
      AND app_membership_id(x.organisation_id) IN (x.committer_membership_id, x.asker_membership_id))
$$;
GRANT EXECUTE ON FUNCTION app_label_party(uuid) TO boardroom_app;

-- Replaced (0048: USING (app_is_worker() OR app_can_read_conversation(conversation_id))). Kept: the worker, and a reader
-- of the conversation for 'noted' and 'done'. Changed: 'declined' and 'dismissed' only for a reader who is that
-- commitment's committer or asker.
DROP POLICY IF EXISTS message_labels_select ON message_labels;
CREATE POLICY message_labels_select ON message_labels FOR SELECT
  USING (app_is_worker()
         OR (app_can_read_conversation(conversation_id) AND (state IN ('noted', 'done') OR app_label_party(message_id))));

-- 7. Replaced checks -------------------------------------------------------------------------------------------------------
-- 0048's purposes + 'standup' (one model call per person per standup day, counted against their own allowance).
ALTER TABLE ai_usage DROP CONSTRAINT IF EXISTS ai_usage_purpose_check;
ALTER TABLE ai_usage ADD CONSTRAINT ai_usage_purpose_check
  CHECK (purpose IN ('chat', 'plan', 'report', 'summary', 'test', 'other', 'followup', 'mention', 'loose_ends', 'commitments', 'standup'));

-- 0043's note codes + 'off_ability' (the tagger switched @mentions off for their own assistant).
ALTER TABLE assistant_mention_private DROP CONSTRAINT IF EXISTS assistant_mention_private_note_check;
ALTER TABLE assistant_mention_private ADD CONSTRAINT assistant_mention_private_note_check CHECK (note_code IS NULL OR note_code IN (
  'off_workspace', 'off_conversation', 'archived', 'limit_minute', 'limit_day', 'limit_conversation', 'limit_workspace', 'allowance', 'no_ai',
  'not_allowed', 'failed', 'off_owner', 'owner_left', 'owner_muted', 'not_followable', 'limit_owner', 'off_ability'));
