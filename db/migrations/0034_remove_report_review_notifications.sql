-- The staff daily report is removed (owner decision, 6 October 2026; 0033 took away the "due soon" reminders). Two more
-- kinds of notification still ask for something that can no longer be done: "… submitted a report for …" to team
-- leads (it points at Reviews, which no longer lists reports) and "Report for … needs changes" to staff (it points at a
-- timesheet with no report to change or send again). Unread, they also count towards the badge, so they go too.
-- "Report for … approved" asks nothing and stays as history; reports, their versions and the audit trail are untouched.
DELETE FROM notifications WHERE type IN ('report.submitted', 'report.changes_requested');
