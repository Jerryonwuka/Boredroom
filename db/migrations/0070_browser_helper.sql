-- The Browser helper (owner decisions, 4 November 2026: phase 2 of the Grok Bot and HeyClicky merge plan, "go with your
-- recommendations"): Brenda works in the person's own signed-in Chrome, in tabs of her own, through Brenda for Mac and its
-- extension. A browser job is a job like the Files helper's and the Mac operator's (0060): the same row, the same request
-- binding, the same asking (any click, select or Return that sends, pays, deletes, submits, signs in, agrees or downloads
-- waits for the person's recorded yes). This only widens two checks:
--   1. assistant_tasks.helper may be 'web';
--   2. act_usage_daily.kind may be 'web' (what browser jobs cost Boredroom, per day and model, with no workspace or person).
--
-- Applied with the owner's go-ahead (4 November 2026: "how do i apply 0069 and 0070?"). The code still runs on a database without it (a deploy ahead of the
-- migration, a restore): the router doesn't offer browser jobs
-- (server/lib/schema-0070.ts). Idempotent; it needs 0060. Never ALTER ROLE.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.assistant_tasks') AND attname = 'helper' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'MIGRATION_ORDER: apply 0060_helpers.sql before 0070_browser_helper.sql.';
  END IF;
END $$;

ALTER TABLE assistant_tasks DROP CONSTRAINT IF EXISTS assistant_tasks_job_check;
ALTER TABLE assistant_tasks ADD CONSTRAINT assistant_tasks_job_check CHECK (
  (kind = 'job') = (helper IS NOT NULL)
  AND (helper IS NULL OR helper IN ('files', 'operator', 'web'))
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

ALTER TABLE act_usage_daily DROP CONSTRAINT IF EXISTS act_usage_daily_kind_check;
ALTER TABLE act_usage_daily ADD CONSTRAINT act_usage_daily_kind_check
  CHECK (kind IN ('screen', 'file', 'router', 'look_now', 'files', 'operator', 'web'));
