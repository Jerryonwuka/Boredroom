-- Phase 7a (owner decision, 8 October 2026: "Brenda keeps the loops closed", first part). Six things:
-- 1. assistant_profiles: the person's own time zone (NULL: the organisation's), their quiet hours (start, end, the days
--    a quiet window starts on; NULL start: none, the default), and when they last saw the morning opener on the web.
--    0035's policies cover them (members read; the person writes their own).
-- 2. brenda_settings.routines_chase_leads_only: "Only leads can schedule routines that chase other people" (on by
--    default; owners and HR change it). 0026's policies cover it.
-- 3. routines: one row per scheduled routine of a person's own assistant: a built-in template, its parameters, the
--    cadence and time of day (in the person's time zone), whether it stays quiet when there is nothing, enabled (new rows
--    start paused), the consent given at Enable (the preview's action lines and their hash), the next and last run.
--    Only the person reads and writes their own; Boredroom's worker runs them. No DELETE (deleted_at).
-- 4. routine_runs: every run (started, finished, status, summary, output, counts, what it did, delivery: delivered,
--    held for quiet hours, silent, none). The person reads their own; only the worker writes.
-- 5. routine_reported_items: what a routine has already reported (each item once); worker only.
-- 6. brenda_report_log.snapshot: the structured state the end-of-day report was written from, so the next report can say
--    what changed since.
-- Additive and idempotent: safe to run by hand twice. Nothing existing is replaced: every change is a new column,
-- table, index, function, trigger or policy, and `DROP … IF EXISTS` is used only on objects this migration creates
-- (assistant_profiles_quiet_check, the routines triggers, the new tables' policies), so a second run recreates them
-- identically. Not CONCURRENTLY: the runner wraps each file in a transaction. Requires 0045 (applied in order). Code
-- deployed before this runs offers none of it and says so (server/lib/schema-0046).

-- 1. The person's time zone, quiet hours and opener --------------------------------------------------------------------
ALTER TABLE assistant_profiles ADD COLUMN IF NOT EXISTS timezone text
  CONSTRAINT assistant_profiles_timezone_check CHECK (timezone IS NULL OR (char_length(timezone) BETWEEN 1 AND 64 AND timezone ~ '^[A-Za-z0-9_+/-]+$'));
ALTER TABLE assistant_profiles ADD COLUMN IF NOT EXISTS quiet_start time;
ALTER TABLE assistant_profiles ADD COLUMN IF NOT EXISTS quiet_end time;
ALTER TABLE assistant_profiles ADD COLUMN IF NOT EXISTS quiet_days smallint[] NOT NULL DEFAULT '{}'::smallint[];
ALTER TABLE assistant_profiles ADD COLUMN IF NOT EXISTS opener_seen_at timestamptz;
ALTER TABLE assistant_profiles DROP CONSTRAINT IF EXISTS assistant_profiles_quiet_check;
ALTER TABLE assistant_profiles ADD CONSTRAINT assistant_profiles_quiet_check CHECK (
  (quiet_start IS NULL) = (quiet_end IS NULL)
  AND (quiet_start IS NULL OR quiet_start <> quiet_end)
  AND quiet_days <@ '{0,1,2,3,4,5,6}'::smallint[]
  AND (quiet_start IS NULL OR cardinality(quiet_days) BETWEEN 1 AND 7));

-- 2. The workspace switch ------------------------------------------------------------------------------------------------
ALTER TABLE brenda_settings ADD COLUMN IF NOT EXISTS routines_chase_leads_only boolean NOT NULL DEFAULT true;

-- 3. Routines --------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS routines (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  membership_id    uuid NOT NULL,
  template         text NOT NULL CONSTRAINT routines_template_check CHECK (template IN ('morning_brief', 'still_owed', 'afternoon_check', 'chase_stalled')),
  name             text NOT NULL CONSTRAINT routines_name_check CHECK (char_length(name) BETWEEN 1 AND 80 AND name = btrim(name) AND name !~ '[[:cntrl:]]'),
  params           jsonb NOT NULL DEFAULT '{}'::jsonb CONSTRAINT routines_params_check CHECK (jsonb_typeof(params) = 'object' AND pg_column_size(params) <= 4096),
  cadence          text NOT NULL CONSTRAINT routines_cadence_check CHECK (cadence IN ('daily', 'weekdays', 'weekly', 'monthly')),
  days             smallint[] NOT NULL DEFAULT '{}'::smallint[],
  day_of_month     smallint,
  time_of_day      time NOT NULL,
  quiet_when_empty boolean NOT NULL DEFAULT true,
  enabled          boolean NOT NULL DEFAULT false,
  paused_reason    text CONSTRAINT routines_paused_reason_check CHECK (paused_reason IS NULL OR paused_reason IN ('new', 'person', 'consent_changed', 'no_rights', 'member_gone', 'failing')),
  consent          jsonb,
  next_run_at      timestamptz,
  last_run_at      timestamptz,
  last_status      text CONSTRAINT routines_last_status_check CHECK (last_status IS NULL OR last_status IN ('done', 'empty', 'skipped', 'failed')),
  failures         smallint NOT NULL DEFAULT 0,
  deleted_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organisation_id),
  FOREIGN KEY (membership_id, organisation_id) REFERENCES memberships(id, organisation_id),
  CONSTRAINT routines_days_check CHECK (days <@ '{0,1,2,3,4,5,6}'::smallint[] AND (cadence <> 'weekly' OR cardinality(days) BETWEEN 1 AND 7)),
  CONSTRAINT routines_day_of_month_check CHECK ((cadence = 'monthly') = (day_of_month IS NOT NULL) AND (day_of_month IS NULL OR day_of_month BETWEEN 0 AND 31)),
  CONSTRAINT routines_enabled_check CHECK (NOT enabled OR (consent IS NOT NULL AND next_run_at IS NOT NULL AND deleted_at IS NULL AND paused_reason IS NULL)),
  CONSTRAINT routines_consent_check CHECK (consent IS NULL OR (jsonb_typeof(consent) = 'object' AND pg_column_size(consent) <= 8192))
);
CREATE INDEX IF NOT EXISTS routines_due_idx ON routines(next_run_at) WHERE enabled AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS routines_member_idx ON routines(membership_id, created_at) WHERE deleted_at IS NULL;
DROP TRIGGER IF EXISTS routines_updated ON routines;
CREATE TRIGGER routines_updated BEFORE UPDATE ON routines FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Whose routine it is and what it is never change (every role).
CREATE OR REPLACE FUNCTION routines_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.organisation_id IS DISTINCT FROM OLD.organisation_id OR NEW.membership_id IS DISTINCT FROM OLD.membership_id
     OR NEW.template IS DISTINCT FROM OLD.template OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS DISTINCT FROM OLD.deleted_at) THEN
    RAISE EXCEPTION 'ROUTINE_FIXED: a routine''s owner and template cannot change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS routines_guard ON routines;
CREATE TRIGGER routines_guard BEFORE UPDATE ON routines FOR EACH ROW EXECUTE FUNCTION routines_guard();

ALTER TABLE routines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS routines_own ON routines;
CREATE POLICY routines_own ON routines FOR ALL
  USING (app_is_worker() OR membership_id = app_membership_id(organisation_id))
  WITH CHECK (app_is_worker() OR membership_id = app_membership_id(organisation_id));
GRANT SELECT, INSERT, UPDATE ON routines TO boardroom_app;
REVOKE DELETE, TRUNCATE ON routines FROM boardroom_app;

-- 4. Runs --------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS routine_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  routine_id       uuid NOT NULL,
  membership_id    uuid NOT NULL,
  due_at           timestamptz NOT NULL,
  started_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz,
  status           text NOT NULL DEFAULT 'running' CONSTRAINT routine_runs_status_check CHECK (status IN ('running', 'done', 'empty', 'skipped', 'failed')),
  reason           text CONSTRAINT routine_runs_reason_check CHECK (reason IS NULL OR char_length(reason) <= 64),
  summary          text CONSTRAINT routine_runs_summary_check CHECK (summary IS NULL OR char_length(summary) <= 300),
  output           jsonb CONSTRAINT routine_runs_output_check CHECK (output IS NULL OR (jsonb_typeof(output) = 'object' AND pg_column_size(output) <= 65536)),
  counts           jsonb NOT NULL DEFAULT '{}'::jsonb,
  actions          jsonb NOT NULL DEFAULT '[]'::jsonb CONSTRAINT routine_runs_actions_check CHECK (jsonb_typeof(actions) = 'array' AND pg_column_size(actions) <= 32768),
  delivery         text NOT NULL DEFAULT 'pending' CONSTRAINT routine_runs_delivery_check CHECK (delivery IN ('pending', 'delivered', 'held', 'silent', 'none')),
  held_until       timestamptz,
  delivered_at     timestamptz,
  bundled          boolean NOT NULL DEFAULT false,
  used_model       boolean NOT NULL DEFAULT false,
  UNIQUE (routine_id, due_at),
  FOREIGN KEY (routine_id, organisation_id) REFERENCES routines(id, organisation_id),
  FOREIGN KEY (membership_id, organisation_id) REFERENCES memberships(id, organisation_id),
  CONSTRAINT routine_runs_held_check CHECK ((delivery = 'held') = (held_until IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS routine_runs_routine_idx ON routine_runs(routine_id, due_at DESC);
CREATE INDEX IF NOT EXISTS routine_runs_member_idx ON routine_runs(membership_id, started_at DESC);
CREATE INDEX IF NOT EXISTS routine_runs_held_idx ON routine_runs(held_until) WHERE delivery = 'held';
ALTER TABLE routine_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS routine_runs_select ON routine_runs;
CREATE POLICY routine_runs_select ON routine_runs FOR SELECT USING (app_is_worker() OR membership_id = app_membership_id(organisation_id));
DROP POLICY IF EXISTS routine_runs_worker ON routine_runs;
CREATE POLICY routine_runs_worker ON routine_runs FOR ALL USING (app_is_worker()) WITH CHECK (app_is_worker());
GRANT SELECT, INSERT, UPDATE ON routine_runs TO boardroom_app;
REVOKE DELETE, TRUNCATE ON routine_runs FROM boardroom_app;

-- 5. What a routine already reported ----------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS routine_reported_items (
  routine_id       uuid NOT NULL,
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  item_key         text NOT NULL CONSTRAINT routine_reported_items_key_check CHECK (char_length(item_key) BETWEEN 1 AND 200),
  run_id           uuid,
  reported_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (routine_id, item_key),
  FOREIGN KEY (routine_id, organisation_id) REFERENCES routines(id, organisation_id)
);
CREATE INDEX IF NOT EXISTS routine_reported_items_age_idx ON routine_reported_items(reported_at);
ALTER TABLE routine_reported_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS routine_reported_items_worker ON routine_reported_items;
CREATE POLICY routine_reported_items_worker ON routine_reported_items FOR ALL USING (app_is_worker()) WITH CHECK (app_is_worker());
-- Only the worker passes the policy; DELETE is for its purge of keys older than 30 days.
GRANT SELECT, INSERT, DELETE ON routine_reported_items TO boardroom_app;

-- 6. The report's snapshot (0030's policies cover it: the recipient reads and writes their own row) -------------------
ALTER TABLE brenda_report_log ADD COLUMN IF NOT EXISTS snapshot jsonb
  CONSTRAINT brenda_report_log_snapshot_check CHECK (snapshot IS NULL OR (jsonb_typeof(snapshot) = 'object' AND pg_column_size(snapshot) <= 262144));
