-- Brenda and her helpers, build 1 (owner's approved brief, 12 October 2026: the doc "Brenda and her helpers", all nine
-- decisions "Agree", "proceed to build"). Permission rule v2 the same day, replacing "always confirm": "when you hold the
-- keys and clearly ask for a routine task, the request is the permission, and she does it. She still asks before
-- anything destructive, anything sent, anything that costs money, or anything sensitive."
-- 1. assistant_private.check_every_task: the person's "Check with me before every task" (off by default). 0047's policy
--    covers it: the person and the worker only; owners and HR can't change it (decision 9).
-- 2. mac_requests: each request the person made on their Mac through her front desk (holding her keys, Option+Space or
--    typing in her notch): their exact words, how they came, when, a once-only nonce, what she did and how it was
--    authorised. The person alone (and the worker, for the 30-day purge); no owner, HR or lead reads it. The database
--    refuses a row that ran something unless it was routine and asked for, or the person's yes was recorded.
-- 3. assistant_tasks: background jobs (kind 'job': the Files helper and the Mac operator), each tied to the recorded
--    request that started it (a trigger checks it is the person's own, with the same nonce), 'paused' while the Mac
--    sleeps, one live job per person beside one live task. The owner's rule again: nothing runs, asks a step, pauses or
--    finishes without the person's recorded yes or, for a job, the recorded request that started it, judged routine.
--    Review, 16 October 2026: only a job may carry a request's authorisation (its request, nonce and risk); a screen,
--    file or plan task (phases 2 and 3) keeps 0058's rule, a recorded yes, at the database too.
-- 4. act_usage_daily: the new kinds of cost (the front desk, quick looks, the Files helper, the Mac operator), with no
--    workspace and no person (decision 8: no helper allowance during the pilot; measure a month).
-- Additive and idempotent: safe to run by hand twice. Requires 0058 and 0059, 0059 first (it replaces the kind check this
-- file widens; the guard below refuses otherwise). Waits in db/pending until the owner's go-ahead; code deployed before
-- it reads it as not ready (server/lib/schema-0060) and Brenda for Mac keeps phase 3's ask-first flow.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assistant_tasks_yes_after_scope') THEN
    RAISE EXCEPTION 'MIGRATION_ORDER: apply 0059_mac_help.sql before 0060_helpers.sql.';
  END IF;
END $$;

ALTER TABLE assistant_private ADD COLUMN IF NOT EXISTS check_every_task boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS mac_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  membership_id    uuid NOT NULL,
  device_session   uuid,
  nonce            text NOT NULL CONSTRAINT mac_requests_nonce_check CHECK (nonce ~ '^[0-9a-f]{32}$'),
  request_text     text NOT NULL CONSTRAINT mac_requests_text_check CHECK (char_length(request_text) BETWEEN 1 AND 1000),
  source           text NOT NULL CONSTRAINT mac_requests_source_check CHECK (source IN ('voice', 'typed')),
  requested_at     timestamptz NOT NULL,
  matched          text NOT NULL CONSTRAINT mac_requests_matched_check CHECK (matched IN ('mac', 'router')),
  lane             text NOT NULL CONSTRAINT mac_requests_lane_check CHECK (lane IN ('mac', 'boredroom', 'job', 'look', 'chat', 'ask', 'none')),
  risk             text NOT NULL CONSTRAINT mac_requests_risk_check CHECK (risk IN ('routine', 'ask', 'never')),
  authorised_by    text NOT NULL CONSTRAINT mac_requests_by_check CHECK (authorised_by IN ('request', 'yes')),
  confirmed_via    text CONSTRAINT mac_requests_via_check CHECK (confirmed_via IS NULL OR confirmed_via IN ('button', 'voice', 'typed')),
  actions          jsonb NOT NULL DEFAULT '[]'::jsonb,
  outcome          text NOT NULL DEFAULT 'pending' CONSTRAINT mac_requests_outcome_check
                     CHECK (outcome IN ('pending', 'done', 'partly', 'refused', 'failed', 'said_no', 'stopped', 'undone')),
  summary          text CONSTRAINT mac_requests_summary_check CHECK (summary IS NULL OR char_length(summary) <= 300),
  undo             jsonb,
  job_id           uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (membership_id, organisation_id) REFERENCES memberships(id, organisation_id),
  CONSTRAINT mac_requests_once UNIQUE (membership_id, nonce),
  CONSTRAINT mac_requests_actions_check CHECK (jsonb_typeof(actions) = 'array' AND jsonb_array_length(actions) <= 10),
  CONSTRAINT mac_requests_undo_check CHECK (undo IS NULL OR jsonb_typeof(undo) = 'object'),
  -- The owner's rule v2 in the database: what ran was routine and asked for, or the person said yes (and how is kept).
  CONSTRAINT mac_requests_authorised CHECK (
    outcome IN ('pending', 'refused', 'said_no')
    OR (authorised_by = 'request' AND risk = 'routine')
    OR (authorised_by = 'yes' AND confirmed_via IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS mac_requests_person_idx ON mac_requests(membership_id, created_at DESC);
CREATE INDEX IF NOT EXISTS mac_requests_created_idx ON mac_requests(created_at);
DROP TRIGGER IF EXISTS mac_requests_updated ON mac_requests;
CREATE TRIGGER mac_requests_updated BEFORE UPDATE ON mac_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE mac_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mac_requests_own ON mac_requests;
CREATE POLICY mac_requests_own ON mac_requests FOR ALL
  USING (app_is_worker() OR membership_id = app_membership_id(organisation_id))
  WITH CHECK (app_is_worker() OR membership_id = app_membership_id(organisation_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON mac_requests TO boardroom_app;   -- DELETE: the person's Forget and the worker's purge
REVOKE TRUNCATE ON mac_requests FROM boardroom_app;

ALTER TABLE assistant_tasks ADD COLUMN IF NOT EXISTS helper text;
ALTER TABLE assistant_tasks ADD COLUMN IF NOT EXISTS authorised_by text;
ALTER TABLE assistant_tasks ADD COLUMN IF NOT EXISTS request_id uuid;
ALTER TABLE assistant_tasks ADD COLUMN IF NOT EXISTS request_nonce text;
ALTER TABLE assistant_tasks ADD COLUMN IF NOT EXISTS request_at timestamptz;
ALTER TABLE assistant_tasks ADD COLUMN IF NOT EXISTS risk text;
ALTER TABLE assistant_tasks ADD COLUMN IF NOT EXISTS job jsonb;
ALTER TABLE assistant_tasks ADD COLUMN IF NOT EXISTS paused_at timestamptz;
ALTER TABLE assistant_tasks DROP CONSTRAINT IF EXISTS assistant_tasks_request_fk;
ALTER TABLE assistant_tasks ADD CONSTRAINT assistant_tasks_request_fk FOREIGN KEY (request_id) REFERENCES mac_requests(id) ON DELETE SET NULL;

ALTER TABLE assistant_tasks DROP CONSTRAINT IF EXISTS assistant_tasks_kind_check;
ALTER TABLE assistant_tasks ADD CONSTRAINT assistant_tasks_kind_check CHECK (kind IN ('screen', 'file', 'plan', 'job'));
ALTER TABLE assistant_tasks DROP CONSTRAINT IF EXISTS assistant_tasks_status_check;
ALTER TABLE assistant_tasks ADD CONSTRAINT assistant_tasks_status_check
  CHECK (status IN ('proposed', 'running', 'asking', 'paused', 'done', 'stopped', 'said_no', 'expired', 'failed'));
ALTER TABLE assistant_tasks DROP CONSTRAINT IF EXISTS assistant_tasks_job_check;
ALTER TABLE assistant_tasks ADD CONSTRAINT assistant_tasks_job_check CHECK (
  (kind = 'job') = (helper IS NOT NULL)
  AND (helper IS NULL OR helper IN ('files', 'operator'))
  AND (authorised_by IS NULL OR authorised_by IN ('request', 'yes'))
  AND (request_nonce IS NULL OR request_nonce ~ '^[0-9a-f]{32}$')
  AND (risk IS NULL OR risk IN ('routine', 'ask'))
  AND (job IS NULL OR jsonb_typeof(job) = 'object')
  AND (kind <> 'job' OR (request_nonce IS NOT NULL AND request_at IS NOT NULL AND authorised_by IS NOT NULL AND risk IS NOT NULL AND job IS NOT NULL))
  AND (kind <> 'job' OR status NOT IN ('proposed', 'running', 'asking', 'paused') OR request_id IS NOT NULL)
  AND (status <> 'paused' OR kind = 'job')
  -- Only a job carries a recorded request (review, 16 October 2026): a screen, file or plan task (phases 2 and 3) keeps
  -- needing the person's yes, so these columns stay empty on them.
  AND (kind = 'job' OR (authorised_by IS NULL AND request_id IS NULL AND request_nonce IS NULL AND risk IS NULL)));
ALTER TABLE assistant_tasks DROP CONSTRAINT IF EXISTS assistant_tasks_live_has_words;
ALTER TABLE assistant_tasks ADD CONSTRAINT assistant_tasks_live_has_words
  CHECK (status NOT IN ('proposed', 'running', 'asking', 'paused') OR request_text IS NOT NULL);
-- The owner's rule in the database (0058's check, widened by rule v2): nothing runs, asks a step, pauses or finishes
-- without the person's recorded yes, or (a job, and only a job: review, 16 October 2026) the recorded request that
-- started it, judged routine.
ALTER TABLE assistant_tasks DROP CONSTRAINT IF EXISTS assistant_tasks_running_needs_yes;
ALTER TABLE assistant_tasks ADD CONSTRAINT assistant_tasks_running_needs_yes CHECK (
  status NOT IN ('running', 'asking', 'paused', 'done')
  OR confirmed_at IS NOT NULL
  OR (kind = 'job' AND authorised_by = 'request' AND risk = 'routine' AND request_nonce IS NOT NULL AND request_at IS NOT NULL
      AND (status = 'done' OR request_id IS NOT NULL)));

CREATE OR REPLACE FUNCTION assistant_tasks_request_is_theirs() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.request_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.request_id IS DISTINCT FROM OLD.request_id
                                     OR NEW.request_nonce IS DISTINCT FROM OLD.request_nonce) THEN
    IF NOT EXISTS (SELECT 1 FROM mac_requests r
                   WHERE r.id = NEW.request_id AND r.organisation_id = NEW.organisation_id
                     AND r.membership_id = NEW.membership_id AND r.nonce = NEW.request_nonce) THEN
      RAISE EXCEPTION 'REQUEST_NOT_THEIRS: a job starts only from the person''s own recorded request' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS assistant_tasks_request_theirs ON assistant_tasks;
CREATE TRIGGER assistant_tasks_request_theirs BEFORE INSERT OR UPDATE OF request_id, request_nonce ON assistant_tasks
  FOR EACH ROW EXECUTE FUNCTION assistant_tasks_request_is_theirs();

-- One live job per person, beside one live task (0058's single index is split).
DROP INDEX IF EXISTS assistant_tasks_one_live;
CREATE UNIQUE INDEX IF NOT EXISTS assistant_tasks_one_live_task ON assistant_tasks(membership_id)
  WHERE kind <> 'job' AND status IN ('proposed', 'running', 'asking');
CREATE UNIQUE INDEX IF NOT EXISTS assistant_tasks_one_live_job ON assistant_tasks(membership_id)
  WHERE kind = 'job' AND status IN ('proposed', 'running', 'asking', 'paused');
CREATE INDEX IF NOT EXISTS assistant_tasks_request_idx ON assistant_tasks(request_id) WHERE request_id IS NOT NULL;

ALTER TABLE act_usage_daily DROP CONSTRAINT IF EXISTS act_usage_daily_kind_check;
ALTER TABLE act_usage_daily ADD CONSTRAINT act_usage_daily_kind_check
  CHECK (kind IN ('screen', 'file', 'router', 'look_now', 'files', 'operator'));
