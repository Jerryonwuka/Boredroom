-- Personal assistants, phase 4 follow-up (reviews, 8 October 2026): hardening for follow-ups between assistants.
-- 1. app_follow_up_refusal: a "shared task" no longer counts when the asker made the link alone by naming the other
--    person as the task's checker (as its creator, or by setting the checker themself), so nobody can make anyone
--    followable in one step. Owners, HR and team leads are unchanged.
-- 2. Indexes for the facts' signal queries and the collection's "work today" checks (by who did it, newest first),
--    and for the sweep's open batches.
-- 3. follow_ups change events only when something a page shows changes (status, answer, reply), not on every lease.
-- 4. The workspace's collection batch is readable by owners and HR, and by people who can read one of its rows.
-- Additive and idempotent: safe to run by hand twice. The code works before and after it runs: before it, the old
-- refusal rule, slower queries, more change events and the old batch policy apply (the service already hides the
-- collection's organisation-wide summary from everyone but owners and HR).
-- Not CONCURRENTLY: the migration runner applies each file inside a transaction.

-- 1. Who may ask about whom -----------------------------------------------------------------------------------------
-- As 0039, except that a task where the subject is only the checker does not count when the asker created the task or
-- set its checker themself (task.updated audit rows record which fields each person changed).
CREATE OR REPLACE FUNCTION app_follow_up_refusal(org uuid, subject uuid, task uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me uuid := app_membership_id(org);
  my_role text := app_role(org);
  t record;
BEGIN
  IF me IS NULL THEN RETURN 'not_member'; END IF;
  IF subject = me THEN RETURN 'self'; END IF;
  IF NOT EXISTS (SELECT 1 FROM memberships m WHERE m.id = subject AND m.organisation_id = org AND m.status = 'active') THEN RETURN 'not_member'; END IF;
  IF task IS NOT NULL THEN
    SELECT tk.assignee_membership_id, tk.reviewer_membership_id, tk.created_by, tk.project_id INTO t
      FROM tasks tk WHERE tk.id = task AND tk.organisation_id = org AND tk.archived_at IS NULL;
    IF NOT FOUND OR NOT app_can_view_task(org, t.assignee_membership_id, t.reviewer_membership_id, t.created_by, t.project_id) THEN RETURN 'task_not_found'; END IF;
    IF t.created_by = t.assignee_membership_id THEN RETURN 'own_todo'; END IF;
    IF subject <> t.assignee_membership_id AND subject IS DISTINCT FROM t.reviewer_membership_id THEN RETURN 'task_not_theirs'; END IF;
  END IF;
  IF my_role IN ('owner', 'hr') THEN RETURN NULL; END IF;
  IF app_manages(org, subject) THEN RETURN NULL; END IF;
  IF EXISTS (
    SELECT 1 FROM tasks s
    WHERE s.organisation_id = org AND s.archived_at IS NULL AND s.created_by <> s.assignee_membership_id
      AND (s.status <> 'completed' OR s.completed_at > now() - interval '14 days')
      AND me IN (s.assignee_membership_id, s.reviewer_membership_id, s.created_by)
      AND subject IN (s.assignee_membership_id, s.reviewer_membership_id, s.created_by)
      -- Not a link the asker made alone: the subject only the checker, named by the asker.
      AND NOT (
        subject = s.reviewer_membership_id AND subject <> s.assignee_membership_id AND subject <> s.created_by
        AND (s.created_by = me OR EXISTS (
          SELECT 1 FROM audit_events a
          WHERE a.subject_type = 'task' AND a.subject_id = s.id AND a.organisation_id = org AND a.action = 'task.updated'
            AND a.actor_membership_id = me AND a.metadata->'changed' ? 'reviewerMembershipId')))) THEN RETURN NULL; END IF;
  RETURN 'not_allowed';
END $$;
GRANT EXECUTE ON FUNCTION app_follow_up_refusal(uuid, uuid, uuid) TO boardroom_app;

-- 2. Indexes ----------------------------------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS task_status_history_actor_idx ON task_status_history(actor_membership_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS task_comments_author_idx ON task_comments(author_membership_id, created_at DESC);
CREATE INDEX IF NOT EXISTS task_submissions_submitter_idx ON task_submissions(submitted_by, submitted_at DESC);
CREATE INDEX IF NOT EXISTS follow_up_batches_open_idx ON follow_up_batches(created_at) WHERE completed_at IS NULL;

-- 3. Change events --------------------------------------------------------------------------------------------------
-- A new row, then only changes a page shows: claims (lease_until, attempts) and the facts snapshot alone stay quiet.
DROP TRIGGER IF EXISTS follow_ups_notify ON follow_ups;
DROP TRIGGER IF EXISTS follow_ups_notify_insert ON follow_ups;
CREATE TRIGGER follow_ups_notify_insert AFTER INSERT ON follow_ups FOR EACH ROW EXECUTE FUNCTION notify_org_change();
CREATE TRIGGER follow_ups_notify AFTER UPDATE ON follow_ups FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.answer IS DISTINCT FROM NEW.answer OR OLD.reply_choice IS DISTINCT FROM NEW.reply_choice)
  EXECUTE FUNCTION notify_org_change();

-- 4. Who reads the workspace's collection batch ------------------------------------------------------------------------
-- Owners and HR, and anyone who can read one of its rows (the follow_ups policy decides that; it never reads batches).
DROP POLICY IF EXISTS follow_up_batches_select ON follow_up_batches;
CREATE POLICY follow_up_batches_select ON follow_up_batches FOR SELECT
  USING (app_is_worker() OR requester_membership_id = app_membership_id(organisation_id)
         OR (requester_membership_id IS NULL AND (app_has_role(organisation_id, 'owner', 'hr')
             OR EXISTS (SELECT 1 FROM follow_ups f WHERE f.batch_id = follow_up_batches.id))));
