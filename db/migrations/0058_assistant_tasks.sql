-- Brenda for Mac, phase 2 (owner request and permission rule, 12 October 2026: "Brenda cannot take any action except I
-- explicitly give an instruction … if it's a core task, Brenda should confirm, do you want me to do this? And then I'll
-- say, yes, I need you to do this").
-- 1. assistant_tasks: each on-screen task and file job a person asked for on their Mac: their words (kept only while the task
--    lives), how they asked, the one sentence Brenda proposed and its hash, their yes (how, when, the words while it lives),
--    step counts, the computer-use transcript's SHA-256 (never the transcript), the outcome and her short summary. The person
--    and the worker only: no owner, HR or lead reads it. The database refuses a running task with no yes. One live task per
--    person. Rows go 30 days after they end (the worker) or when the person deletes them.
-- 2. screen_help_settings.actions_allowed: the workspace's switch for on-screen actions and file work (Allowed by default;
--    owners and HR can only switch it off).
-- 3. act_usage_daily: what tasks cost Boredroom, per day, model and kind, with no workspace and no person; the worker only.
-- 4. assistant_task_units: what each task counted in the person's daily limit, kept apart from the task so the person's
--    Forget cannot reset the limit (review, 12 October 2026). Units and times only, never a word; the person and the
--    worker read it, a trigger on assistant_tasks writes it, only the worker deletes it (after two days).
-- Additive and idempotent: safe to run by hand twice. Requires 0057. Waits in db/pending until the owner's go-ahead.

CREATE TABLE IF NOT EXISTS assistant_tasks (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   uuid NOT NULL REFERENCES organisations(id),
  membership_id     uuid NOT NULL,
  kind              text NOT NULL CONSTRAINT assistant_tasks_kind_check CHECK (kind IN ('screen', 'file')),
  status            text NOT NULL DEFAULT 'proposed' CONSTRAINT assistant_tasks_status_check
                      CHECK (status IN ('proposed', 'running', 'asking', 'done', 'stopped', 'said_no', 'expired', 'failed')),
  request_text      text CONSTRAINT assistant_tasks_request_check CHECK (request_text IS NULL OR char_length(request_text) BETWEEN 1 AND 4000),
  request_source    text NOT NULL CONSTRAINT assistant_tasks_source_check CHECK (request_source IN ('voice', 'typed')),
  request_age_ms    integer NOT NULL CHECK (request_age_ms BETWEEN 0 AND 30000),
  app_name          text CHECK (app_name IS NULL OR char_length(app_name) <= 80),
  plan_text         text NOT NULL CONSTRAINT assistant_tasks_plan_check CHECK (char_length(plan_text) BETWEEN 12 AND 200),
  plan_sha256       text NOT NULL CHECK (plan_sha256 ~ '^[0-9a-f]{64}$'),
  risky             boolean NOT NULL DEFAULT false,
  file_source       text CHECK (file_source IS NULL OR file_source IN ('pointer', 'front_document', 'finder_selection', 'dropped')),
  file_name         text CHECK (file_name IS NULL OR char_length(file_name) BETWEEN 1 AND 255),
  output_format     text CHECK (output_format IS NULL OR output_format IN ('md', 'txt', 'csv', 'docx', 'pdf', 'doc')),
  output_name       text CHECK (output_name IS NULL OR char_length(output_name) BETWEEN 1 AND 120),
  proposed_at       timestamptz NOT NULL DEFAULT now(),
  answer_by         timestamptz NOT NULL,
  confirmed_at      timestamptz,
  confirmed_via     text CHECK (confirmed_via IS NULL OR confirmed_via IN ('button', 'voice', 'typed')),
  confirm_text      text CHECK (confirm_text IS NULL OR char_length(confirm_text) <= 200),
  step_cap          integer NOT NULL DEFAULT 20 CHECK (step_cap BETWEEN 1 AND 50),
  steps_used        integer NOT NULL DEFAULT 0 CHECK (steps_used >= 0),
  step_started_at   timestamptz,
  last_step_at      timestamptz,
  step_yeses        integer NOT NULL DEFAULT 0 CHECK (step_yeses >= 0),
  pending_ask       jsonb,
  approved_ask      jsonb,
  transcript_sha256 text CHECK (transcript_sha256 IS NULL OR transcript_sha256 ~ '^[0-9a-f]{64}$'),
  units             integer NOT NULL DEFAULT 0 CHECK (units >= 0),
  ended_at          timestamptz,
  end_reason        text CHECK (end_reason IS NULL OR end_reason IN ('done', 'stopped', 'said_no', 'unclear', 'expired', 'cap', 'time',
                      'size', 'limit', 'failed', 'cannot', 'unresolved')),
  stopped_by        text CHECK (stopped_by IS NULL OR char_length(stopped_by) <= 20),
  summary           text CHECK (summary IS NULL OR char_length(summary) <= 500),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (membership_id, organisation_id) REFERENCES memberships(id, organisation_id),
  CONSTRAINT assistant_tasks_yes_check CHECK ((confirmed_at IS NULL) = (confirmed_via IS NULL)),
  -- The owner's rule in the database itself: nothing runs, asks a step or finishes without the person's recorded yes.
  CONSTRAINT assistant_tasks_running_needs_yes CHECK (status NOT IN ('running', 'asking', 'done') OR confirmed_at IS NOT NULL),
  CONSTRAINT assistant_tasks_live_has_words CHECK (status NOT IN ('proposed', 'running', 'asking') OR request_text IS NOT NULL),
  CONSTRAINT assistant_tasks_file_check CHECK (kind <> 'file' OR (file_source IS NOT NULL AND file_name IS NOT NULL AND output_format IS NOT NULL AND output_name IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS assistant_tasks_person_idx ON assistant_tasks(membership_id, created_at DESC);
CREATE INDEX IF NOT EXISTS assistant_tasks_ended_idx ON assistant_tasks(ended_at) WHERE ended_at IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS assistant_tasks_one_live ON assistant_tasks(membership_id) WHERE status IN ('proposed', 'running', 'asking');
DROP TRIGGER IF EXISTS assistant_tasks_updated ON assistant_tasks;
CREATE TRIGGER assistant_tasks_updated BEFORE UPDATE ON assistant_tasks FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE assistant_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assistant_tasks_own ON assistant_tasks;
CREATE POLICY assistant_tasks_own ON assistant_tasks FOR ALL
  USING (app_is_worker() OR membership_id = app_membership_id(organisation_id))
  WITH CHECK (app_is_worker() OR membership_id = app_membership_id(organisation_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON assistant_tasks TO boardroom_app;   -- DELETE: the person's Forget and the worker's purge
REVOKE TRUNCATE ON assistant_tasks FROM boardroom_app;

ALTER TABLE screen_help_settings ADD COLUMN IF NOT EXISTS actions_allowed boolean NOT NULL DEFAULT true;

-- 4. The units a task counted in the person's daily limit (review, 12 October 2026). Written by the trigger below whenever
-- a confirmed task's units change, never lowered; Forget deletes the task, not this; the worker purges it after two days.
CREATE TABLE IF NOT EXISTS assistant_task_units (
  task_id          uuid PRIMARY KEY,
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  membership_id    uuid NOT NULL,
  confirmed_at     timestamptz NOT NULL,
  units            integer NOT NULL DEFAULT 0 CHECK (units >= 0),
  FOREIGN KEY (membership_id, organisation_id) REFERENCES memberships(id, organisation_id)
);
CREATE INDEX IF NOT EXISTS assistant_task_units_person_idx ON assistant_task_units(membership_id, confirmed_at);
ALTER TABLE assistant_task_units ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assistant_task_units_read ON assistant_task_units;
CREATE POLICY assistant_task_units_read ON assistant_task_units FOR SELECT
  USING (app_is_worker() OR membership_id = app_membership_id(organisation_id));
DROP POLICY IF EXISTS assistant_task_units_insert ON assistant_task_units;
CREATE POLICY assistant_task_units_insert ON assistant_task_units FOR INSERT
  WITH CHECK (app_is_worker() OR membership_id = app_membership_id(organisation_id));
DROP POLICY IF EXISTS assistant_task_units_update ON assistant_task_units;
CREATE POLICY assistant_task_units_update ON assistant_task_units FOR UPDATE
  USING (app_is_worker() OR membership_id = app_membership_id(organisation_id))
  WITH CHECK (app_is_worker() OR membership_id = app_membership_id(organisation_id));
DROP POLICY IF EXISTS assistant_task_units_purge ON assistant_task_units;
CREATE POLICY assistant_task_units_purge ON assistant_task_units FOR DELETE USING (app_is_worker());
GRANT SELECT, INSERT, UPDATE, DELETE ON assistant_task_units TO boardroom_app;   -- DELETE: the worker's purge only (policy)
REVOKE TRUNCATE ON assistant_task_units FROM boardroom_app;

CREATE OR REPLACE FUNCTION assistant_task_units_keep() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.confirmed_at IS NOT NULL AND NEW.units > 0 THEN
    INSERT INTO assistant_task_units(task_id, organisation_id, membership_id, confirmed_at, units)
    VALUES (NEW.id, NEW.organisation_id, NEW.membership_id, NEW.confirmed_at, NEW.units)
    ON CONFLICT (task_id) DO UPDATE SET units = GREATEST(assistant_task_units.units, EXCLUDED.units);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS assistant_tasks_units ON assistant_tasks;
CREATE TRIGGER assistant_tasks_units AFTER INSERT OR UPDATE OF units, confirmed_at ON assistant_tasks
  FOR EACH ROW EXECUTE FUNCTION assistant_task_units_keep();

CREATE TABLE IF NOT EXISTS act_usage_daily (
  day                date NOT NULL,
  model              text NOT NULL CHECK (char_length(model) BETWEEN 1 AND 100),
  kind               text NOT NULL CHECK (kind IN ('screen', 'file')),
  tasks              integer NOT NULL DEFAULT 0,
  steps              integer NOT NULL DEFAULT 0,
  image_tokens       bigint NOT NULL DEFAULT 0,
  input_tokens       bigint NOT NULL DEFAULT 0,
  output_tokens      bigint NOT NULL DEFAULT 0,
  cache_read_tokens  bigint NOT NULL DEFAULT 0,
  cache_write_tokens bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (day, model, kind)
);
ALTER TABLE act_usage_daily ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS act_usage_daily_worker ON act_usage_daily;
CREATE POLICY act_usage_daily_worker ON act_usage_daily FOR ALL USING (app_is_worker()) WITH CHECK (app_is_worker());
GRANT SELECT, INSERT, UPDATE ON act_usage_daily TO boardroom_app;
REVOKE DELETE, TRUNCATE ON act_usage_daily FROM boardroom_app;
