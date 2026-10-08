-- Personal assistants, phase 4 (owner decision, 8 October 2026): assistant-to-assistant follow-ups. "Instead of
-- following up with the people, the assistants follow up with each other's assistants to know what the staff are
-- working on." A person asks their own assistant ("Where is Ben on the landing page?"); Ben's assistant answers from
-- Ben's work when it is recent, and asks Ben once only when it is not. What the database holds:
-- 1. follow_up_batches: one ask by one person (one subject, several, or a team), or the workspace's own collection of
--    updates before the end-of-day report (requester NULL, one per organisation per local date).
-- 2. follow_ups: one row per subject, with its status machine (pending, asking, answering, then answered, expired,
--    declined, cancelled or failed), a snapshot of exactly what was shared (facts), the subject's reply in their own
--    words, the answer, and its times. Read by the requester and the subject; the workspace's own rows by the people
--    who may view the subject's records (owners, HR, their team leads, themself). Owners and HR see that a follow-up
--    happened in the audit trail, never its words. Written by the requester only as a new 'pending' row they are
--    allowed to make (app_follow_up_refusal), by the subject only through app_follow_up_reply while 'asking', by the
--    requester only through app_follow_up_cancel while open; every other change goes through Boredroom's worker role.
-- 3. assistant_profiles.followups: 'auto' (answer from my work, ask me only if it can't; the default) or 'ask_first'.
-- 4. brenda_settings: the workspace collection before the report (off by default), whether it asks people with no
--    update today (off), and how long before the report it runs (60 minutes).
-- 5. ai_usage.purpose gains 'followup'.
-- Additive and idempotent: safe to run by hand twice. Code deployed before this runs offers no follow-ups and says so
-- (server/lib/schema-0039).

-- 1. Batches -------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS follow_up_batches (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id         uuid NOT NULL REFERENCES organisations(id),
  requester_membership_id uuid,                -- NULL: the workspace's own collection
  kind                    text NOT NULL CONSTRAINT follow_up_batches_kind_check CHECK (kind IN ('person', 'group', 'workspace')),
  team_id                 uuid,                -- a group asked as a team
  task_id                 uuid,
  question                text NOT NULL CONSTRAINT follow_up_batches_question_check CHECK (char_length(question) BETWEEN 1 AND 280),
  local_date              date NOT NULL,       -- the organisation's local date when it was made
  size                    integer NOT NULL CONSTRAINT follow_up_batches_size_check CHECK (size BETWEEN 1 AND 1000),
  completed_at            timestamptz,         -- every follow-up in it closed; set once
  summary                 text CONSTRAINT follow_up_batches_summary_check CHECK (summary IS NULL OR char_length(summary) <= 500),
  created_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organisation_id),
  CONSTRAINT follow_up_batches_requester_kind_check CHECK ((requester_membership_id IS NULL) = (kind = 'workspace')),
  FOREIGN KEY (requester_membership_id, organisation_id) REFERENCES memberships(id, organisation_id),
  FOREIGN KEY (team_id, organisation_id) REFERENCES teams(id, organisation_id),
  FOREIGN KEY (task_id, organisation_id) REFERENCES tasks(id, organisation_id)
);
CREATE INDEX IF NOT EXISTS follow_up_batches_requester_idx ON follow_up_batches(requester_membership_id, created_at DESC) WHERE requester_membership_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS follow_up_batches_workspace_day_idx ON follow_up_batches(organisation_id, local_date) WHERE kind = 'workspace';

-- 2. Follow-ups ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS follow_ups (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id         uuid NOT NULL REFERENCES organisations(id),
  batch_id                uuid NOT NULL,
  requester_membership_id uuid,                -- NULL: the workspace's own collection
  subject_membership_id   uuid NOT NULL,
  task_id                 uuid,                -- NULL: "what are they working on"
  question                text NOT NULL CONSTRAINT follow_ups_question_check CHECK (char_length(question) BETWEEN 1 AND 280),
  status                  text NOT NULL DEFAULT 'pending' CONSTRAINT follow_ups_status_check
                            CHECK (status IN ('pending', 'asking', 'answering', 'answered', 'expired', 'declined', 'cancelled', 'failed')),
  answered_from           text CONSTRAINT follow_ups_answered_from_check CHECK (answered_from IN ('facts', 'person', 'deadline')),
  facts                   jsonb NOT NULL DEFAULT '{}'::jsonb CONSTRAINT follow_ups_facts_check CHECK (jsonb_typeof(facts) = 'object'),
  fresh                   boolean,
  capped                  boolean NOT NULL DEFAULT false,   -- answered from facts only: the subject was asked enough today
  reply_choice            text CONSTRAINT follow_ups_reply_choice_check CHECK (reply_choice IN ('on_track', 'blocked', 'done', 'not_started', 'not_now')),
  reply_note              text CONSTRAINT follow_ups_reply_note_check CHECK (reply_note IS NULL OR char_length(reply_note) BETWEEN 1 AND 280),
  answer                  text CONSTRAINT follow_ups_answer_check CHECK (answer IS NULL OR char_length(answer) BETWEEN 1 AND 2000),
  answer_engine           text CONSTRAINT follow_ups_answer_engine_check CHECK (answer_engine IN ('claude', 'template')),
  failure                 text CONSTRAINT follow_ups_failure_check CHECK (failure IN ('subject_left', 'not_allowed', 'task_gone', 'error')),
  attempts                smallint NOT NULL DEFAULT 0,
  lease_until             timestamptz,
  asked_at                timestamptz,
  deadline_at             timestamptz,
  replied_at              timestamptz,
  answered_at             timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organisation_id),
  FOREIGN KEY (batch_id, organisation_id) REFERENCES follow_up_batches(id, organisation_id),
  FOREIGN KEY (requester_membership_id, organisation_id) REFERENCES memberships(id, organisation_id),
  FOREIGN KEY (subject_membership_id, organisation_id) REFERENCES memberships(id, organisation_id),
  FOREIGN KEY (task_id, organisation_id) REFERENCES tasks(id, organisation_id),
  CONSTRAINT follow_ups_not_self_check CHECK (requester_membership_id IS DISTINCT FROM subject_membership_id),
  CONSTRAINT follow_ups_asking_check CHECK (status <> 'asking' OR (asked_at IS NOT NULL AND deadline_at IS NOT NULL)),
  CONSTRAINT follow_ups_answer_shape_check CHECK (status NOT IN ('answered', 'expired', 'declined') OR (answer IS NOT NULL AND answered_at IS NOT NULL AND answered_from IS NOT NULL)),
  CONSTRAINT follow_ups_reply_shape_check CHECK (reply_choice IS NULL OR replied_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS follow_ups_requester_idx ON follow_ups(requester_membership_id, created_at DESC) WHERE requester_membership_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS follow_ups_subject_idx ON follow_ups(subject_membership_id, created_at DESC);
CREATE INDEX IF NOT EXISTS follow_ups_batch_idx ON follow_ups(batch_id);
CREATE INDEX IF NOT EXISTS follow_ups_deadline_idx ON follow_ups(deadline_at) WHERE status = 'asking';
CREATE INDEX IF NOT EXISTS follow_ups_open_idx ON follow_ups(updated_at) WHERE status IN ('pending', 'answering');
CREATE INDEX IF NOT EXISTS follow_ups_asked_idx ON follow_ups(subject_membership_id, asked_at) WHERE asked_at IS NOT NULL;

DROP TRIGGER IF EXISTS follow_ups_updated ON follow_ups;
CREATE TRIGGER follow_ups_updated BEFORE UPDATE ON follow_ups FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- Realtime: ids only, on the organisation's channel (the requester's chat card and pages refetch).
DROP TRIGGER IF EXISTS follow_ups_notify ON follow_ups;
CREATE TRIGGER follow_ups_notify AFTER INSERT OR UPDATE ON follow_ups FOR EACH ROW EXECUTE FUNCTION notify_org_change();
DROP TRIGGER IF EXISTS follow_up_batches_notify ON follow_up_batches;
CREATE TRIGGER follow_up_batches_notify AFTER INSERT OR UPDATE ON follow_up_batches FOR EACH ROW EXECUTE FUNCTION notify_org_change();

-- 3. Who may ask about whom --------------------------------------------------------------------------------------
-- NULL when the signed-in person may follow up on `subject` (about `task`, when given); otherwise why not:
-- 'not_member' (the asker or the subject is not an active member here), 'self', 'task_not_found' (archived, missing,
-- or not visible to the asker), 'task_not_theirs' (the subject neither holds nor checks it), 'own_todo' (a task its
-- holder made for themself: never shared), 'not_allowed'. Owners and HR may ask about anyone; a team lead about the
-- members of the teams they lead (app_manages); anyone about a person they share live work with (both are the
-- assignee, the reviewer or the creator of one task that is not an own to-do, open or finished in the last 14 days).
-- Definer: the shared-work test looks at tasks the asker may not see in full; it answers with a code, nothing else.
CREATE OR REPLACE FUNCTION app_follow_up_refusal(org uuid, subject uuid, task uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me uuid := app_membership_id(org);
  my_role text := app_role(org);
  t record;
BEGIN
  IF me IS NULL THEN RETURN 'not_member'; END IF;
  IF subject = me THEN RETURN 'self'; END IF;
  IF NOT EXISTS (SELECT 1 FROM memberships m WHERE m.id = subject AND m.organisation_id = org AND m.status = 'active') THEN RETURN 'not_member'; END IF;
  IF task IS NOT NULL THEN
    SELECT tk.assignee_membership_id, tk.reviewer_membership_id, tk.created_by, tk.project_id INTO t
      FROM tasks tk WHERE tk.id = task AND tk.organisation_id = org AND tk.archived_at IS NULL;
    IF NOT FOUND OR NOT app_can_view_task(org, t.assignee_membership_id, t.reviewer_membership_id, t.created_by, t.project_id) THEN RETURN 'task_not_found'; END IF;
    IF t.created_by = t.assignee_membership_id THEN RETURN 'own_todo'; END IF;
    IF subject <> t.assignee_membership_id AND subject IS DISTINCT FROM t.reviewer_membership_id THEN RETURN 'task_not_theirs'; END IF;
  END IF;
  IF my_role IN ('owner', 'hr') THEN RETURN NULL; END IF;
  IF app_manages(org, subject) THEN RETURN NULL; END IF;
  IF EXISTS (
    SELECT 1 FROM tasks s
    WHERE s.organisation_id = org AND s.archived_at IS NULL AND s.created_by <> s.assignee_membership_id
      AND (s.status <> 'completed' OR s.completed_at > now() - interval '14 days')
      AND me IN (s.assignee_membership_id, s.reviewer_membership_id, s.created_by)
      AND subject IN (s.assignee_membership_id, s.reviewer_membership_id, s.created_by)) THEN RETURN NULL; END IF;
  RETURN 'not_allowed';
END $$;
GRANT EXECUTE ON FUNCTION app_follow_up_refusal(uuid, uuid, uuid) TO boardroom_app;

-- 4. Row-level security --------------------------------------------------------------------------------------------
ALTER TABLE follow_up_batches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS follow_up_batches_select ON follow_up_batches;
CREATE POLICY follow_up_batches_select ON follow_up_batches FOR SELECT
  USING (app_is_worker() OR requester_membership_id = app_membership_id(organisation_id)
         OR (requester_membership_id IS NULL AND app_is_member(organisation_id)));
DROP POLICY IF EXISTS follow_up_batches_insert ON follow_up_batches;
CREATE POLICY follow_up_batches_insert ON follow_up_batches FOR INSERT
  WITH CHECK (app_is_worker() OR (requester_membership_id = app_membership_id(organisation_id) AND kind IN ('person', 'group') AND completed_at IS NULL AND summary IS NULL));
DROP POLICY IF EXISTS follow_up_batches_update ON follow_up_batches;
CREATE POLICY follow_up_batches_update ON follow_up_batches FOR UPDATE USING (app_is_worker()) WITH CHECK (app_is_worker());

ALTER TABLE follow_ups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS follow_ups_select ON follow_ups;
CREATE POLICY follow_ups_select ON follow_ups FOR SELECT
  USING (app_is_worker()
         OR requester_membership_id = app_membership_id(organisation_id)
         OR subject_membership_id = app_membership_id(organisation_id)
         OR (requester_membership_id IS NULL AND app_can_view_records(organisation_id, subject_membership_id)));
-- A person inserts only a new, empty 'pending' row they are allowed to make, into a batch of their own.
DROP POLICY IF EXISTS follow_ups_insert ON follow_ups;
CREATE POLICY follow_ups_insert ON follow_ups FOR INSERT
  WITH CHECK (app_is_worker() OR (
    requester_membership_id = app_membership_id(organisation_id)
    AND status = 'pending' AND facts = '{}'::jsonb AND answered_from IS NULL AND answer IS NULL AND answer_engine IS NULL
    AND reply_choice IS NULL AND reply_note IS NULL AND asked_at IS NULL AND deadline_at IS NULL AND replied_at IS NULL
    AND answered_at IS NULL AND failure IS NULL AND attempts = 0 AND NOT capped
    AND app_follow_up_refusal(organisation_id, subject_membership_id, task_id) IS NULL
    AND EXISTS (SELECT 1 FROM follow_up_batches b WHERE b.id = batch_id AND b.requester_membership_id = follow_ups.requester_membership_id)));
DROP POLICY IF EXISTS follow_ups_update ON follow_ups;
CREATE POLICY follow_ups_update ON follow_ups FOR UPDATE USING (app_is_worker()) WITH CHECK (app_is_worker());
-- No DELETE on either table: a follow-up is a record of what was shared. The worker updates, so UPDATE stays granted
-- (row-level security limits it to the worker); DELETE and TRUNCATE are taken away outright.
GRANT SELECT, INSERT, UPDATE ON follow_up_batches, follow_ups TO boardroom_app;
REVOKE DELETE, TRUNCATE ON follow_up_batches, follow_ups FROM boardroom_app;

-- 5. The subject's reply and the requester's cancel ----------------------------------------------------------------
-- The subject alone replies, only while their assistant is asking them. Returns 'ok', or why not: 'not_found' (no such
-- follow-up, or not theirs: the same word, so nothing is learnt about other people's), 'closed', 'bad_choice',
-- 'too_long'. "Not now" keeps no note. The answer itself is written afterwards by Boredroom (status 'answering').
CREATE OR REPLACE FUNCTION app_follow_up_reply(fid uuid, choice text, note text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE f follow_ups%ROWTYPE; clean text;
BEGIN
  SELECT * INTO f FROM follow_ups WHERE id = fid FOR UPDATE;
  IF NOT FOUND OR app_membership_id(f.organisation_id) IS DISTINCT FROM f.subject_membership_id THEN RETURN 'not_found'; END IF;
  IF f.status <> 'asking' THEN RETURN 'closed'; END IF;
  IF choice IS NULL OR choice NOT IN ('on_track', 'blocked', 'done', 'not_started', 'not_now') THEN RETURN 'bad_choice'; END IF;
  clean := NULLIF(btrim(regexp_replace(COALESCE(note, ''), '[[:cntrl:]]+', ' ', 'g')), '');
  IF clean IS NOT NULL AND char_length(clean) > 280 THEN RETURN 'too_long'; END IF;
  UPDATE follow_ups SET status = 'answering', answered_from = 'person', reply_choice = choice,
         reply_note = CASE WHEN choice = 'not_now' THEN NULL ELSE clean END, replied_at = now(), lease_until = NULL
   WHERE id = fid;
  RETURN 'ok';
END $$;
GRANT EXECUTE ON FUNCTION app_follow_up_reply(uuid, text, text) TO boardroom_app;

-- The requester alone cancels, while it is still open ('pending' or 'asking'). Returns 'ok', 'not_found' or 'closed'.
CREATE OR REPLACE FUNCTION app_follow_up_cancel(fid uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE f follow_ups%ROWTYPE;
BEGIN
  SELECT * INTO f FROM follow_ups WHERE id = fid FOR UPDATE;
  IF NOT FOUND OR f.requester_membership_id IS NULL OR app_membership_id(f.organisation_id) IS DISTINCT FROM f.requester_membership_id THEN RETURN 'not_found'; END IF;
  IF f.status NOT IN ('pending', 'asking') THEN RETURN 'closed'; END IF;
  UPDATE follow_ups SET status = 'cancelled', lease_until = NULL WHERE id = fid;
  RETURN 'ok';
END $$;
GRANT EXECUTE ON FUNCTION app_follow_up_cancel(uuid) TO boardroom_app;

-- 6. The person's choice and the workspace's collection --------------------------------------------------------------
-- 0035's policies cover the new column (everyone in the workspace reads the profile; only the person writes theirs).
ALTER TABLE assistant_profiles ADD COLUMN IF NOT EXISTS followups text NOT NULL DEFAULT 'auto'
  CONSTRAINT assistant_profiles_followups_check CHECK (followups IN ('auto', 'ask_first'));
-- 0026's policies cover these (read by members; written by owners, HR and the worker).
ALTER TABLE brenda_settings ADD COLUMN IF NOT EXISTS followup_collect boolean NOT NULL DEFAULT false;
ALTER TABLE brenda_settings ADD COLUMN IF NOT EXISTS followup_collect_ask boolean NOT NULL DEFAULT false;
ALTER TABLE brenda_settings ADD COLUMN IF NOT EXISTS followup_collect_minutes smallint NOT NULL DEFAULT 60
  CONSTRAINT brenda_settings_followup_collect_minutes_check CHECK (followup_collect_minutes IN (30, 60, 90, 120));

-- 7. The usage ledger's purposes -------------------------------------------------------------------------------------
ALTER TABLE ai_usage DROP CONSTRAINT IF EXISTS ai_usage_purpose_check;
ALTER TABLE ai_usage ADD CONSTRAINT ai_usage_purpose_check CHECK (purpose IN ('chat', 'plan', 'report', 'summary', 'test', 'other', 'followup'));
