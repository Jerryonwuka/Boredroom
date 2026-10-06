-- Brenda's end-of-day team report (owner decision, 5 October 2026: the Reports page is removed; "For reports going
-- forward, Brenda will handle that automatically by sending supervisors reports of what their team did at the end of
-- every day. The time it sends reports can be set in settings."). Three switches beside Brenda's others, a log that
-- makes each report go out once per person per day however often the job runs, and one helper for the attendance notes.

-- On by default, at 18:00 in the organisation's time zone; owners and HR get the whole organisation unless switched off.
ALTER TABLE brenda_settings ADD COLUMN IF NOT EXISTS daily_report_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE brenda_settings ADD COLUMN IF NOT EXISTS daily_report_time time NOT NULL DEFAULT '18:00';
ALTER TABLE brenda_settings ADD COLUMN IF NOT EXISTS daily_report_org_wide boolean NOT NULL DEFAULT true;

-- One row per recipient per local day: the document Brenda wrote for them (in Docs, private to them), when she last
-- wrote it (a report asked for during the day is refreshed until the person edits it), and when the end-of-day report
-- went out as a notification and email. sent_at is null while only a report asked for during the day exists.
CREATE TABLE IF NOT EXISTS brenda_report_log (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  membership_id    uuid NOT NULL,
  local_date       date NOT NULL,
  doc_id           uuid,
  written_at       timestamptz,
  sent_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (membership_id, local_date),
  FOREIGN KEY (membership_id, organisation_id) REFERENCES memberships(id, organisation_id),
  FOREIGN KEY (doc_id, organisation_id) REFERENCES documents(id, organisation_id)
);
CREATE INDEX IF NOT EXISTS brenda_report_log_org_idx ON brenda_report_log(organisation_id, local_date DESC);
ALTER TABLE brenda_report_log ENABLE ROW LEVEL SECURITY;
-- People see their own; owners and HR see the organisation's. Rows are written by the recipient's own requests (the
-- worker builds each report as the person it is for).
CREATE POLICY brenda_report_log_select ON brenda_report_log FOR SELECT
  USING (app_is_worker() OR membership_id = app_membership_id(organisation_id) OR app_has_role(organisation_id, 'owner', 'hr'));
CREATE POLICY brenda_report_log_insert ON brenda_report_log FOR INSERT
  WITH CHECK (app_is_worker() OR membership_id = app_membership_id(organisation_id));
CREATE POLICY brenda_report_log_update ON brenda_report_log FOR UPDATE
  USING (app_is_worker() OR membership_id = app_membership_id(organisation_id))
  WITH CHECK (app_is_worker() OR membership_id = app_membership_id(organisation_id));
GRANT SELECT, INSERT, UPDATE ON brenda_report_log TO boardroom_app;

-- Whether anyone in the organisation clocked in on a day. The report says someone "did not clock in" only on days the
-- organisation clocks at all, so a workspace that does not use the clock is not told every evening that nobody did.
-- Definer: a team lead's own view of attendance covers only their teams. It answers yes or no, nothing about who.
CREATE OR REPLACE FUNCTION app_anyone_clocked_in(org uuid, d date) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_is_member(org) AND EXISTS (SELECT 1 FROM attendance_days WHERE organisation_id = org AND local_date = d)
$$;
GRANT EXECUTE ON FUNCTION app_anyone_clocked_in(uuid, date) TO boardroom_app;
