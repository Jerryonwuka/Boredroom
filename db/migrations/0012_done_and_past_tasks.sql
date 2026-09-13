-- Round 3: "Done" from My Day, past-task clearing, and a 'completed' stop outcome for sessions.

-- A member can clear completed tasks from their own past-tasks list. The task itself is kept
-- (history, reports and the organisation's views are unaffected); only the assignee's list hides it.
ALTER TABLE tasks ADD COLUMN cleared_at timestamptz;

-- Stopping a session may now mark the task done in the same step.
ALTER TABLE work_sessions DROP CONSTRAINT work_sessions_stop_outcome_check;
ALTER TABLE work_sessions ADD CONSTRAINT work_sessions_stop_outcome_check
  CHECK (stop_outcome IS NULL OR stop_outcome IN ('continue_later','blocked','ready_for_review','completed'));
