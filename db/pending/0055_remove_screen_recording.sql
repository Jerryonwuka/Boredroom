-- Phase 8 (owner decision, 8 October 2026): screen recording for tasks is taken out entirely; this drops what it left in
-- the database. It lives in db/pending, NOT db/migrations: the lead moves it into db/migrations only after (1) the new web
-- app AND worker run everywhere (a worker from before phase 8 reads `recordings` on every maintenance pass and would fail
-- each one) and (2) the owner ran `pnpm db:delete-recordings --confirm=<host>/<database>`. The guard refuses while any
-- recording data remains. Destructive, not reversible; idempotent (IF EXISTS everywhere), safe to run twice.

DO $$
DECLARE n bigint := 0;
BEGIN
  IF to_regclass('public.recordings') IS NOT NULL THEN
    SELECT (SELECT count(*) FROM recordings) + (SELECT count(*) FROM recording_chunks) + (SELECT count(*) FROM recording_access_log)
         + (SELECT count(*) FROM privacy_incidents) + (SELECT count(*) FROM recording_grants) + (SELECT count(*) FROM capture_exceptions)
         + (SELECT count(*) FROM deletion_tombstones)
      INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION 'RECORDINGS_REMAIN: % recording rows are still in the database. Run pnpm db:delete-recordings (the dry run, then --confirm) first.', n;
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.work_sessions') AND attname = 'capture_exception_id' AND NOT attisdropped) THEN
    IF EXISTS (SELECT 1 FROM work_sessions WHERE capture_exception_id IS NOT NULL) THEN
      RAISE EXCEPTION 'RECORDINGS_REMAIN: work sessions still point at capture exceptions. Run pnpm db:delete-recordings first.';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM jobs WHERE type IN ('recording.assemble', 'recording.retention_delete') AND state IN ('pending', 'running')) THEN
    RAISE EXCEPTION 'RECORDINGS_REMAIN: recording jobs are still queued. Run pnpm db:delete-recordings first.';
  END IF;
END $$;

ALTER TABLE work_sessions DROP CONSTRAINT IF EXISTS work_sessions_capture_exception_fk;
ALTER TABLE work_sessions DROP COLUMN IF EXISTS capture_exception_id;
ALTER TABLE work_sessions DROP COLUMN IF EXISTS capture_mode;
ALTER TABLE tasks DROP COLUMN IF EXISTS capture_requirement;

DROP TABLE IF EXISTS recording_access_log;
DROP TABLE IF EXISTS privacy_incidents;
DROP TABLE IF EXISTS recording_chunks;
DROP TABLE IF EXISTS recordings;
DROP TABLE IF EXISTS capture_exceptions;
DROP TABLE IF EXISTS recording_grants;
DROP TABLE IF EXISTS deletion_tombstones;

DROP FUNCTION IF EXISTS app_recording_in_org(uuid, uuid);
DROP FUNCTION IF EXISTS app_can_review_recording(uuid, uuid);
DROP FUNCTION IF EXISTS app_is_privacy_admin(uuid);

ALTER TABLE policies DROP COLUMN IF EXISTS recording_mode;
ALTER TABLE policies DROP COLUMN IF EXISTS retention_days;
ALTER TABLE policies DROP COLUMN IF EXISTS capture_audio;

UPDATE plans SET features = features - 'VIDEO_RECORDING' - 'SCREEN_CAPTURE' WHERE features ?| ARRAY['VIDEO_RECORDING', 'SCREEN_CAPTURE'];
UPDATE organisations SET feature_overrides = feature_overrides - 'VIDEO_RECORDING' - 'SCREEN_CAPTURE' WHERE feature_overrides ?| ARRAY['VIDEO_RECORDING', 'SCREEN_CAPTURE'];
UPDATE platform_settings SET value = value - 'VIDEO_RECORDING' - 'SCREEN_CAPTURE'
 WHERE key = 'feature_flags' AND jsonb_typeof(value) = 'object' AND value ?| ARRAY['VIDEO_RECORDING', 'SCREEN_CAPTURE'];
DELETE FROM jobs WHERE type IN ('recording.assemble', 'recording.retention_delete');
