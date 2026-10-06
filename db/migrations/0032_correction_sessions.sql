-- A time correction for a day the timer never ran ("Request a time correction" on Timesheets, for a task with no
-- session that day) needs a stopped session to hold the corrected time, and the team lead who approves it creates that
-- session for the person (services/reports.ts, applyAdjustmentLedger). The insert policy let people create only their
-- own sessions, so approving such a correction failed and the time was never confirmed. With the staff daily report
-- gone (owner decision, 6 October 2026) a correction is the one way to add time the timer missed, so it has to work.
-- A lead may now add a stopped session for someone they manage. They could already add intervals to that person's
-- sessions (intervals_insert), so nothing about the person's time opens up that was not open to them before.
DROP POLICY IF EXISTS sessions_insert ON work_sessions;
CREATE POLICY sessions_insert ON work_sessions FOR INSERT WITH CHECK (
  (membership_id = app_membership_id(organisation_id) AND user_id = app_user_id())
  OR (state = 'stopped' AND ended_at IS NOT NULL AND app_manages(organisation_id, membership_id)));
