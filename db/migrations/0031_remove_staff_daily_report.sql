-- The staff daily report is removed (owner decision, 6 October 2026): staff no longer write or submit one, and Brenda's
-- end-of-day team report (0030) tells supervisors what their teams did. Past reports, their versions and the day
-- exemptions stay as history; nothing reads or writes them any more. Confirmed time never depended on a report, and the
-- timesheet export now reads the confirmed ledger instead of approved report versions (services/reports.ts).

-- "Your daily report is due soon" reminders still waiting in the queue: the worker no longer has a handler for them.
DELETE FROM jobs WHERE type = 'report.reminder' AND state IN ('pending', 'failed');

-- The week-one email told people to submit the day's report. Only that sentence changes, so an edit made to the
-- template in the Control Center is kept.
UPDATE email_templates
   SET body = replace(body, 'Submit the day''s report at the end of the day; your lead approves it in a click.',
                      'Ask Brenda what you got done this week: she reads it from your to-dos and timer, so there is no report to write.'),
       updated_at = now()
 WHERE code = 'day7' AND position('Submit the day''s report at the end of the day' IN body) > 0;
