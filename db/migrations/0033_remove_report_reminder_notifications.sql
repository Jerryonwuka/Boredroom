-- The staff daily report is removed (owner decision, 6 October 2026; 0031 dropped the reminders still queued). The
-- reminders already delivered stay in people's notifications ("Your daily report for … is due soon … then submit"),
-- count towards the unread badge and point at a report that can no longer be written, so they go too. Nothing else
-- refers to a notification; reports, their versions and the audit trail are untouched.
DELETE FROM notifications WHERE type = 'report.reminder';
