-- Quiet heartbeats (owner request, 23 October 2026: realtime plan, phase 0, item 3). A running timer's heartbeat updates
-- work_sessions.last_heartbeat_at every 30 seconds, and the old trigger sent a change notification for every update, so
-- every visible page in the organisation refreshed every 30 seconds while anyone's timer ran. Now: a notification for a
-- new session, and for an update only when what a page shows changes (the state, or the version every start, pause,
-- resume, stop and interruption bumps). A heartbeat on its own (last_heartbeat_at, updated_at) is silent.
-- Additive and idempotent; independent of 0061. Waits in db/pending until the owner's go-ahead.

DROP TRIGGER IF EXISTS work_sessions_notify ON work_sessions;
DROP TRIGGER IF EXISTS work_sessions_notify_insert ON work_sessions;
CREATE TRIGGER work_sessions_notify_insert AFTER INSERT ON work_sessions FOR EACH ROW EXECUTE FUNCTION notify_org_change();
CREATE TRIGGER work_sessions_notify AFTER UPDATE ON work_sessions FOR EACH ROW
  WHEN (OLD.state IS DISTINCT FROM NEW.state OR OLD.version IS DISTINCT FROM NEW.version)
  EXECUTE FUNCTION notify_org_change();
