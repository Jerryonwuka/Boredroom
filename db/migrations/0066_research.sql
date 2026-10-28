-- Brenda's research in the background (owner decision, 28 October 2026: "Brenda, research X and give me a PDF when
-- you're done": she works in the background while the person carries on, then tells them).
--   1. research_reports: one row per piece of research a person asked for: what (the topic, their focus notes, the file
--      they want: pdf, docx or md), where it is (queued, running, done, failed, stopped), the finished report (its
--      structure as jsonb and its Markdown), the numbered sources it cites, what it cost (web searches, page fetches, the
--      API's token counts, model calls) and the plain words of a failure. `progress` is the job's own state while it runs
--      (the model's turn so far, the step it is on, how long it has spent), so a worker that stops mid-way picks the job up
--      where it was instead of paying for every step again; it is emptied when the report is done.
--      The person alone (and the worker, which runs the job and purges): owners, HR and leads never read anyone's
--      research, as with mac_requests (0060). Kept 90 days (`expires_at`), then the worker's system.purge_expired
--      deletes it.
--   2. ai_usage's purposes + 'research': each model call of a report is one ledger row for the person (its request id is
--      the report's id, so one report counts as one request) and feeds the Control Center's AI usage page. It is not in
--      the person's 150 a day: research has its own cap (5 a day by default, BRENDA_RESEARCH_DAILY).
--
-- WAITS FOR THE OWNER'S GO-AHEAD in db/pending. It does not depend on 0065 (also pending) or anything after 0054. The
-- code runs before it is applied (server/lib/schema-0066): Brenda says research isn't available yet, the Research page
-- says it needs a database update, the file route answers 404 and the worker's research.run returns at once.
-- Additive and idempotent: safe to run by hand twice. Never touches a role's password (no ALTER ROLE).

DO $$
BEGIN
  IF to_regclass('public.ai_usage') IS NULL THEN
    RAISE EXCEPTION 'MIGRATION_ORDER: apply 0037 (the usage ledger) and 0054 before 0066_research.sql.';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS research_reports (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id    uuid NOT NULL REFERENCES organisations(id),
  membership_id      uuid NOT NULL,
  topic              text NOT NULL CONSTRAINT research_reports_topic_check CHECK (char_length(topic) BETWEEN 1 AND 500),
  focus              text CONSTRAINT research_reports_focus_check CHECK (focus IS NULL OR char_length(focus) <= 1000),
  format             text NOT NULL CONSTRAINT research_reports_format_check CHECK (format IN ('pdf', 'docx', 'md')),
  status             text NOT NULL DEFAULT 'queued' CONSTRAINT research_reports_status_check
                       CHECK (status IN ('queued', 'running', 'done', 'failed', 'stopped')),
  title              text CONSTRAINT research_reports_title_check CHECK (title IS NULL OR char_length(title) <= 200),
  report             jsonb CONSTRAINT research_reports_report_check CHECK (report IS NULL OR jsonb_typeof(report) = 'object'),
  markdown           text CONSTRAINT research_reports_markdown_check CHECK (markdown IS NULL OR char_length(markdown) <= 200000),
  sources            jsonb NOT NULL DEFAULT '[]'::jsonb CONSTRAINT research_reports_sources_check
                       CHECK (jsonb_typeof(sources) = 'array' AND jsonb_array_length(sources) <= 200),
  progress           jsonb CONSTRAINT research_reports_progress_check CHECK (progress IS NULL OR jsonb_typeof(progress) = 'object'),
  model              text CONSTRAINT research_reports_model_check CHECK (model IS NULL OR char_length(model) <= 100),
  steps              integer NOT NULL DEFAULT 0 CONSTRAINT research_reports_steps_check CHECK (steps BETWEEN 0 AND 100),
  searches           integer NOT NULL DEFAULT 0 CONSTRAINT research_reports_searches_check CHECK (searches >= 0),
  fetches            integer NOT NULL DEFAULT 0 CONSTRAINT research_reports_fetches_check CHECK (fetches >= 0),
  input_tokens       bigint NOT NULL DEFAULT 0 CONSTRAINT research_reports_in_check CHECK (input_tokens >= 0),
  output_tokens      bigint NOT NULL DEFAULT 0 CONSTRAINT research_reports_out_check CHECK (output_tokens >= 0),
  cache_read_tokens  bigint NOT NULL DEFAULT 0 CONSTRAINT research_reports_cache_read_check CHECK (cache_read_tokens >= 0),
  cache_write_tokens bigint NOT NULL DEFAULT 0 CONSTRAINT research_reports_cache_write_check CHECK (cache_write_tokens >= 0),
  error              text CONSTRAINT research_reports_error_check CHECK (error IS NULL OR char_length(error) <= 300),
  created_at         timestamptz NOT NULL DEFAULT now(),
  started_at         timestamptz,
  finished_at        timestamptz,
  notified_at        timestamptz,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL DEFAULT now() + interval '90 days',
  FOREIGN KEY (membership_id, organisation_id) REFERENCES memberships(id, organisation_id),
  -- A finished report has its words; an ended one has its end time; a live one has neither.
  CONSTRAINT research_reports_done_has_report CHECK (status <> 'done' OR (markdown IS NOT NULL AND report IS NOT NULL)),
  CONSTRAINT research_reports_ended_has_time CHECK ((status IN ('done', 'failed', 'stopped')) = (finished_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS research_reports_person_idx ON research_reports(membership_id, created_at DESC);
CREATE INDEX IF NOT EXISTS research_reports_expires_idx ON research_reports(expires_at);
CREATE INDEX IF NOT EXISTS research_reports_live_idx ON research_reports(updated_at) WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS research_reports_org_created_idx ON research_reports(organisation_id, created_at);
DROP TRIGGER IF EXISTS research_reports_updated ON research_reports;
CREATE TRIGGER research_reports_updated BEFORE UPDATE ON research_reports FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE research_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS research_reports_own ON research_reports;
CREATE POLICY research_reports_own ON research_reports FOR ALL
  USING (app_is_worker() OR membership_id = app_membership_id(organisation_id))
  WITH CHECK (app_is_worker() OR membership_id = app_membership_id(organisation_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON research_reports TO boardroom_app;   -- DELETE: the worker's 90-day purge
REVOKE TRUNCATE ON research_reports FROM boardroom_app;

-- 0054's purposes + 'research' (Brenda's research for the person; its own cap, not in the 150 a day), and 0067's
-- 'learning' too, so applying 0066 after 0067 never drops it (merge, 28 October 2026).
ALTER TABLE ai_usage DROP CONSTRAINT IF EXISTS ai_usage_purpose_check;
ALTER TABLE ai_usage ADD CONSTRAINT ai_usage_purpose_check
  CHECK (purpose IN ('chat', 'plan', 'report', 'summary', 'test', 'other', 'followup', 'mention', 'loose_ends', 'commitments', 'standup', 'call_recap', 'research', 'learning'));
