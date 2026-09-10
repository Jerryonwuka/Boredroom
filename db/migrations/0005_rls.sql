-- 0005 row-level security and role grants.
-- The web/worker application role (boardroom_app) is not the table owner, so
-- RLS applies to every query it runs. Identity is a transaction-local setting.

ALTER TABLE audit_events ADD COLUMN subject_membership_id uuid;
CREATE INDEX audit_events_subject_membership_idx ON audit_events(subject_membership_id);

CREATE OR REPLACE FUNCTION app_is_worker() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('app.role', true), '') IN ('worker','system')
$$;

CREATE OR REPLACE FUNCTION app_profile_email() RETURNS citext
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.email FROM profiles p WHERE p.id = app_user_id()
$$;

-- A user may insert their own membership only when creating a brand-new organisation
-- or when a live invitation for their email with the same role exists.
CREATE OR REPLACE FUNCTION app_can_self_join(org uuid, wanted_role text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_is_worker()
    OR (wanted_role = 'owner' AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.organisation_id = org))
    OR EXISTS (
      SELECT 1 FROM invitations i
      WHERE i.organisation_id = org AND i.email = app_profile_email() AND i.role = wanted_role
        AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now())
$$;

CREATE OR REPLACE FUNCTION app_can_review_recording(org uuid, target_membership uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_is_worker() OR EXISTS (
    SELECT 1 FROM recording_grants g
    WHERE g.organisation_id = org AND g.revoked_at IS NULL
      AND g.grantee_membership_id = app_membership_id(org)
      AND (
        g.scope_type = 'organisation'
        OR (g.scope_type = 'team' AND EXISTS (
              SELECT 1 FROM team_members tm WHERE tm.team_id = g.scope_id AND tm.membership_id = target_membership))
      ))
$$;

CREATE OR REPLACE FUNCTION app_is_privacy_admin(org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_is_worker() OR EXISTS (
    SELECT 1 FROM recording_grants g
    WHERE g.organisation_id = org AND g.revoked_at IS NULL AND g.scope_type = 'privacy_admin'
      AND g.grantee_membership_id = app_membership_id(org))
$$;

CREATE OR REPLACE FUNCTION app_can_view_task(org uuid, assignee uuid, reviewer uuid, creator uuid, project uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_is_worker()
    OR app_has_role(org, 'owner', 'hr')
    OR app_membership_id(org) IN (assignee, reviewer, creator)
    OR app_manages(org, assignee)
    OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = project AND pm.membership_id = app_membership_id(org))
$$;

CREATE OR REPLACE FUNCTION app_is_project_lead(org uuid, project uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_is_worker() OR EXISTS (
    SELECT 1 FROM project_members pm
    WHERE pm.project_id = project AND pm.membership_id = app_membership_id(org) AND pm.access_role = 'lead')
$$;

-- Role grants: HR cannot grant owner/hr roles; only owners can. Enforced in DB too.
CREATE OR REPLACE FUNCTION guard_role_grant() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r text;
BEGIN
  IF app_is_worker() THEN RETURN NEW; END IF;
  r := app_role(NEW.organisation_id);
  IF NEW.role IN ('owner','hr') AND (TG_OP = 'INSERT' OR OLD.role <> NEW.role) THEN
    IF r IS DISTINCT FROM 'owner' AND NOT (TG_OP = 'INSERT' AND app_can_self_join(NEW.organisation_id, NEW.role)) THEN
      RAISE EXCEPTION 'ROLE_GRANT_FORBIDDEN: only owners can grant owner or HR roles' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.role = 'owner' AND r IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'ROLE_GRANT_FORBIDDEN: only owners can change an owner membership' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER memberships_role_grant BEFORE INSERT OR UPDATE ON memberships FOR EACH ROW EXECUTE FUNCTION guard_role_grant();

-- ---------------------------------------------------------------------------
-- Enable RLS
-- ---------------------------------------------------------------------------
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY profiles_select ON profiles FOR SELECT USING (
  app_is_worker() OR id = app_user_id()
  OR EXISTS (SELECT 1 FROM memberships a JOIN memberships b ON a.organisation_id = b.organisation_id
             WHERE a.user_id = app_user_id() AND a.status = 'active' AND b.user_id = profiles.id));
CREATE POLICY profiles_insert ON profiles FOR INSERT WITH CHECK (app_is_worker() OR app_user_id() IS NULL OR id = app_user_id());
CREATE POLICY profiles_update ON profiles FOR UPDATE USING (app_is_worker() OR id = app_user_id());

ALTER TABLE organisations ENABLE ROW LEVEL SECURITY;
CREATE POLICY organisations_select ON organisations FOR SELECT USING (app_is_member(id));
CREATE POLICY organisations_insert ON organisations FOR INSERT WITH CHECK (app_is_worker() OR app_user_id() IS NOT NULL);
CREATE POLICY organisations_update ON organisations FOR UPDATE USING (app_has_role(id, 'owner', 'hr'));

ALTER TABLE policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY policies_select ON policies FOR SELECT USING (app_is_member(organisation_id));
CREATE POLICY policies_insert ON policies FOR INSERT WITH CHECK (app_has_role(organisation_id, 'owner') OR app_is_worker());
CREATE POLICY policies_update ON policies FOR UPDATE USING (app_has_role(organisation_id, 'owner'));

ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY memberships_select ON memberships FOR SELECT USING (app_is_member(organisation_id) OR user_id = app_user_id());
CREATE POLICY memberships_insert ON memberships FOR INSERT WITH CHECK (
  app_has_role(organisation_id, 'owner', 'hr') OR (user_id = app_user_id() AND app_can_self_join(organisation_id, role)));
CREATE POLICY memberships_update ON memberships FOR UPDATE USING (app_has_role(organisation_id, 'owner', 'hr'));

ALTER TABLE policy_acknowledgements ENABLE ROW LEVEL SECURITY;
CREATE POLICY ack_select ON policy_acknowledgements FOR SELECT USING (
  membership_id = app_membership_id(organisation_id) OR app_has_role(organisation_id, 'owner', 'hr'));
CREATE POLICY ack_insert ON policy_acknowledgements FOR INSERT WITH CHECK (membership_id = app_membership_id(organisation_id));

ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
CREATE POLICY teams_select ON teams FOR SELECT USING (app_is_member(organisation_id));
CREATE POLICY teams_write ON teams FOR ALL USING (app_has_role(organisation_id, 'owner', 'hr')) WITH CHECK (app_has_role(organisation_id, 'owner', 'hr'));

ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY team_members_select ON team_members FOR SELECT USING (app_is_member(organisation_id));
CREATE POLICY team_members_write ON team_members FOR ALL USING (app_has_role(organisation_id, 'owner', 'hr')) WITH CHECK (app_has_role(organisation_id, 'owner', 'hr'));

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY invitations_select ON invitations FOR SELECT USING (
  app_has_role(organisation_id, 'owner', 'hr') OR email = app_profile_email());
CREATE POLICY invitations_insert ON invitations FOR INSERT WITH CHECK (
  app_has_role(organisation_id, 'owner', 'hr') AND (role IN ('manager','employee') OR app_has_role(organisation_id, 'owner')));
CREATE POLICY invitations_update ON invitations FOR UPDATE USING (
  app_has_role(organisation_id, 'owner', 'hr') OR email = app_profile_email());

ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY schedules_select ON schedules FOR SELECT USING (app_is_member(organisation_id));
CREATE POLICY schedules_write ON schedules FOR ALL USING (app_has_role(organisation_id, 'owner', 'hr')) WITH CHECK (app_has_role(organisation_id, 'owner', 'hr'));

ALTER TABLE workday_exemptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY exemptions_select ON workday_exemptions FOR SELECT USING (app_can_view_records(organisation_id, membership_id));
CREATE POLICY exemptions_write ON workday_exemptions FOR ALL
  USING (app_has_role(organisation_id, 'owner', 'hr') OR app_manages(organisation_id, membership_id))
  WITH CHECK (app_has_role(organisation_id, 'owner', 'hr') OR app_manages(organisation_id, membership_id));

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_select ON audit_events FOR SELECT USING (
  app_is_worker()
  OR app_has_role(organisation_id, 'owner', 'hr')
  OR actor_membership_id = app_membership_id(organisation_id)
  OR subject_membership_id = app_membership_id(organisation_id)
  OR (subject_membership_id IS NOT NULL AND app_manages(organisation_id, subject_membership_id)));
CREATE POLICY audit_insert ON audit_events FOR INSERT WITH CHECK (
  app_is_worker() OR organisation_id IS NULL OR app_is_member(organisation_id));
-- No UPDATE/DELETE policy: application clients cannot change audit history.

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY notifications_select ON notifications FOR SELECT USING (recipient_membership_id = app_membership_id(organisation_id));
CREATE POLICY notifications_insert ON notifications FOR INSERT WITH CHECK (app_is_member(organisation_id));
CREATE POLICY notifications_update ON notifications FOR UPDATE USING (recipient_membership_id = app_membership_id(organisation_id));

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY projects_select ON projects FOR SELECT USING (app_is_member(organisation_id));
CREATE POLICY projects_insert ON projects FOR INSERT WITH CHECK (app_has_role(organisation_id, 'owner', 'hr', 'manager'));
CREATE POLICY projects_update ON projects FOR UPDATE USING (app_has_role(organisation_id, 'owner', 'hr') OR app_is_project_lead(organisation_id, id));

ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY project_members_select ON project_members FOR SELECT USING (app_is_member(organisation_id));
CREATE OR REPLACE FUNCTION app_is_project_creator(org uuid, project uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM projects p WHERE p.id = project AND p.organisation_id = org AND p.created_by = app_membership_id(org))
$$;
CREATE POLICY project_members_write ON project_members FOR ALL
  USING (app_has_role(organisation_id, 'owner', 'hr') OR app_is_project_lead(organisation_id, project_id) OR app_is_project_creator(organisation_id, project_id))
  WITH CHECK (app_has_role(organisation_id, 'owner', 'hr') OR app_is_project_lead(organisation_id, project_id) OR app_is_project_creator(organisation_id, project_id));

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY tasks_select ON tasks FOR SELECT USING (
  app_can_view_task(organisation_id, assignee_membership_id, reviewer_membership_id, created_by, project_id));
CREATE POLICY tasks_insert ON tasks FOR INSERT WITH CHECK (
  app_is_member(organisation_id) AND created_by = app_membership_id(organisation_id) AND (
    app_has_role(organisation_id, 'owner', 'hr')
    OR app_manages(organisation_id, assignee_membership_id)
    OR app_is_project_lead(organisation_id, project_id)
    OR assignee_membership_id = app_membership_id(organisation_id)));
CREATE POLICY tasks_update ON tasks FOR UPDATE USING (
  app_is_worker()
  OR app_has_role(organisation_id, 'owner', 'hr')
  OR app_manages(organisation_id, assignee_membership_id)
  OR app_is_project_lead(organisation_id, project_id)
  OR app_membership_id(organisation_id) IN (assignee_membership_id, reviewer_membership_id));

ALTER TABLE task_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY task_comments_select ON task_comments FOR SELECT USING (EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_id));
CREATE POLICY task_comments_insert ON task_comments FOR INSERT WITH CHECK (
  author_membership_id = app_membership_id(organisation_id) AND EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_id));

ALTER TABLE task_status_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY tsh_select ON task_status_history FOR SELECT USING (EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_id));
CREATE POLICY tsh_insert ON task_status_history FOR INSERT WITH CHECK (app_is_member(organisation_id));

ALTER TABLE daily_plan_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY plan_select ON daily_plan_items FOR SELECT USING (app_can_view_records(organisation_id, membership_id));
CREATE POLICY plan_write ON daily_plan_items FOR ALL USING (membership_id = app_membership_id(organisation_id)) WITH CHECK (membership_id = app_membership_id(organisation_id));

ALTER TABLE work_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY sessions_select ON work_sessions FOR SELECT USING (app_can_view_records(organisation_id, membership_id));
CREATE POLICY sessions_insert ON work_sessions FOR INSERT WITH CHECK (
  membership_id = app_membership_id(organisation_id) AND user_id = app_user_id());
CREATE POLICY sessions_update ON work_sessions FOR UPDATE USING (
  app_is_worker() OR membership_id = app_membership_id(organisation_id) OR app_has_role(organisation_id, 'owner', 'hr'));

ALTER TABLE session_intervals ENABLE ROW LEVEL SECURITY;
CREATE POLICY intervals_select ON session_intervals FOR SELECT USING (app_can_view_records(organisation_id, membership_id));
CREATE POLICY intervals_insert ON session_intervals FOR INSERT WITH CHECK (
  app_is_worker() OR membership_id = app_membership_id(organisation_id)
  OR app_has_role(organisation_id, 'owner', 'hr') OR app_manages(organisation_id, membership_id));
CREATE POLICY intervals_update ON session_intervals FOR UPDATE USING (
  app_is_worker() OR membership_id = app_membership_id(organisation_id)
  OR app_has_role(organisation_id, 'owner', 'hr') OR app_manages(organisation_id, membership_id));

ALTER TABLE session_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY session_events_select ON session_events FOR SELECT USING (EXISTS (SELECT 1 FROM work_sessions s WHERE s.id = session_id));
CREATE POLICY session_events_insert ON session_events FOR INSERT WITH CHECK (app_is_worker() OR EXISTS (SELECT 1 FROM work_sessions s WHERE s.id = session_id));

ALTER TABLE task_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY submissions_select ON task_submissions FOR SELECT USING (EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_id));
CREATE POLICY submissions_insert ON task_submissions FOR INSERT WITH CHECK (submitted_by = app_membership_id(organisation_id));

ALTER TABLE deliverables ENABLE ROW LEVEL SECURITY;
CREATE POLICY deliverables_select ON deliverables FOR SELECT USING (app_is_worker() OR EXISTS (SELECT 1 FROM task_submissions s WHERE s.id = submission_id));
CREATE POLICY deliverables_insert ON deliverables FOR INSERT WITH CHECK (uploaded_by = app_membership_id(organisation_id));
CREATE POLICY deliverables_update ON deliverables FOR UPDATE USING (app_is_worker());

ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY reviews_select ON reviews FOR SELECT USING (EXISTS (SELECT 1 FROM task_submissions s WHERE s.id = submission_id));
CREATE POLICY reviews_insert ON reviews FOR INSERT WITH CHECK (reviewer_membership_id = app_membership_id(organisation_id));

ALTER TABLE daily_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY reports_select ON daily_reports FOR SELECT USING (app_can_view_records(organisation_id, membership_id));
CREATE POLICY reports_insert ON daily_reports FOR INSERT WITH CHECK (membership_id = app_membership_id(organisation_id));
CREATE POLICY reports_update ON daily_reports FOR UPDATE USING (
  app_is_worker() OR membership_id = app_membership_id(organisation_id)
  OR app_has_role(organisation_id, 'owner', 'hr') OR app_manages(organisation_id, membership_id));

ALTER TABLE report_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY rv_select ON report_versions FOR SELECT USING (EXISTS (SELECT 1 FROM daily_reports r WHERE r.id = report_id));
CREATE POLICY rv_insert ON report_versions FOR INSERT WITH CHECK (submitted_by = app_membership_id(organisation_id));
CREATE POLICY rv_update ON report_versions FOR UPDATE USING (
  app_is_worker() OR submitted_by = app_membership_id(organisation_id)
  OR app_has_role(organisation_id, 'owner', 'hr')
  OR EXISTS (SELECT 1 FROM daily_reports r WHERE r.id = report_id AND app_manages(organisation_id, r.membership_id)));

ALTER TABLE time_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY adj_select ON time_adjustments FOR SELECT USING (app_can_view_records(organisation_id, membership_id));
CREATE POLICY adj_insert ON time_adjustments FOR INSERT WITH CHECK (membership_id = app_membership_id(organisation_id));
CREATE POLICY adj_update ON time_adjustments FOR UPDATE USING (
  membership_id = app_membership_id(organisation_id) OR app_has_role(organisation_id, 'owner', 'hr') OR app_manages(organisation_id, membership_id));

ALTER TABLE recording_grants ENABLE ROW LEVEL SECURITY;
CREATE POLICY grants_select ON recording_grants FOR SELECT USING (
  app_has_role(organisation_id, 'owner', 'hr') OR grantee_membership_id = app_membership_id(organisation_id));
CREATE POLICY grants_write ON recording_grants FOR ALL USING (app_has_role(organisation_id, 'owner')) WITH CHECK (app_has_role(organisation_id, 'owner'));

ALTER TABLE capture_exceptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY cex_select ON capture_exceptions FOR SELECT USING (app_can_view_records(organisation_id, membership_id));
CREATE POLICY cex_insert ON capture_exceptions FOR INSERT WITH CHECK (membership_id = app_membership_id(organisation_id));
CREATE POLICY cex_update ON capture_exceptions FOR UPDATE USING (
  app_has_role(organisation_id, 'owner', 'hr') OR app_manages(organisation_id, membership_id));

ALTER TABLE recordings ENABLE ROW LEVEL SECURITY;
CREATE POLICY recordings_select ON recordings FOR SELECT USING (
  app_is_worker() OR membership_id = app_membership_id(organisation_id)
  OR app_can_review_recording(organisation_id, membership_id) OR app_is_privacy_admin(organisation_id));
CREATE POLICY recordings_insert ON recordings FOR INSERT WITH CHECK (membership_id = app_membership_id(organisation_id));
CREATE POLICY recordings_update ON recordings FOR UPDATE USING (
  app_is_worker() OR membership_id = app_membership_id(organisation_id) OR app_is_privacy_admin(organisation_id));

ALTER TABLE recording_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY chunks_select ON recording_chunks FOR SELECT USING (EXISTS (SELECT 1 FROM recordings r WHERE r.id = recording_id));
CREATE POLICY chunks_insert ON recording_chunks FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM recordings r WHERE r.id = recording_id AND r.membership_id = app_membership_id(organisation_id)));
CREATE POLICY chunks_update ON recording_chunks FOR UPDATE USING (
  app_is_worker() OR EXISTS (SELECT 1 FROM recordings r WHERE r.id = recording_id AND r.membership_id = app_membership_id(organisation_id)));

ALTER TABLE recording_access_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY ral_select ON recording_access_log FOR SELECT USING (
  app_has_role(organisation_id, 'owner', 'hr')
  OR EXISTS (SELECT 1 FROM recordings r WHERE r.id = recording_id AND r.membership_id = app_membership_id(organisation_id)));
CREATE POLICY ral_insert ON recording_access_log FOR INSERT WITH CHECK (actor_membership_id = app_membership_id(organisation_id));

ALTER TABLE privacy_incidents ENABLE ROW LEVEL SECURITY;
CREATE POLICY incidents_select ON privacy_incidents FOR SELECT USING (
  reporter_membership_id = app_membership_id(organisation_id) OR app_is_privacy_admin(organisation_id) OR app_has_role(organisation_id, 'owner'));
CREATE POLICY incidents_insert ON privacy_incidents FOR INSERT WITH CHECK (
  reporter_membership_id = app_membership_id(organisation_id)
  AND EXISTS (SELECT 1 FROM recordings r WHERE r.id = recording_id AND r.membership_id = app_membership_id(organisation_id)));
CREATE POLICY incidents_update ON privacy_incidents FOR UPDATE USING (app_is_privacy_admin(organisation_id));

ALTER TABLE deletion_tombstones ENABLE ROW LEVEL SECURITY;
CREATE POLICY tombstones_select ON deletion_tombstones FOR SELECT USING (app_has_role(organisation_id, 'owner', 'hr'));
CREATE POLICY tombstones_insert ON deletion_tombstones FOR INSERT WITH CHECK (app_is_worker() OR app_has_role(organisation_id, 'owner'));

-- ---------------------------------------------------------------------------
-- Grants for the application role
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'boardroom_app') THEN
    CREATE ROLE boardroom_app LOGIN PASSWORD 'boardroom_app' NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO boardroom_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO boardroom_app;
REVOKE DELETE ON audit_events, session_intervals, report_versions, reviews, task_submissions, deliverables,
  recording_access_log, deletion_tombstones, policy_acknowledgements FROM boardroom_app;
REVOKE UPDATE ON audit_events, reviews, policy_acknowledgements, recording_access_log FROM boardroom_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO boardroom_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO boardroom_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO boardroom_app;

-- An invitee may join the team named on their own accepted invitation.
CREATE POLICY team_members_self_join ON team_members FOR INSERT WITH CHECK (
  membership_id = app_membership_id(organisation_id) AND EXISTS (
    SELECT 1 FROM invitations i
    WHERE i.organisation_id = team_members.organisation_id AND i.accepted_membership_id = team_members.membership_id
      AND i.team_id = team_members.team_id));

-- Deduplicated notification insert. Runs as definer so ON CONFLICT can consult the
-- unique index without granting senders read access to recipients' notifications.
CREATE OR REPLACE FUNCTION app_notify(org uuid, recipient uuid, ntype text, ntitle text, nbody text, rtype text, rid uuid, nhref text, dedup text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT app_is_member(org) THEN
    RAISE EXCEPTION 'not a member of organisation' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM memberships m WHERE m.id = recipient AND m.organisation_id = org AND m.status = 'active') THEN
    RETURN; -- recipient no longer active: nothing to deliver
  END IF;
  INSERT INTO notifications(organisation_id, recipient_membership_id, type, title, body, resource_type, resource_id, href, deduplication_key)
  VALUES (org, recipient, ntype, ntitle, nbody, rtype, rid, nhref, dedup)
  ON CONFLICT (recipient_membership_id, deduplication_key) DO NOTHING;
END $$;
GRANT EXECUTE ON FUNCTION app_notify(uuid, uuid, text, text, text, text, uuid, text, text) TO boardroom_app;

-- Next free EMP-### code. Definer: an invitee cannot see existing memberships before joining.
CREATE OR REPLACE FUNCTION app_next_employee_code(org uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT 'EMP-' || lpad((COALESCE(MAX(NULLIF(regexp_replace(employee_code, '^EMP-(\d+)$', '\1'), employee_code)::int), 0) + 1)::text, 3, '0')
  FROM memberships WHERE organisation_id = org
$$;
GRANT EXECUTE ON FUNCTION app_next_employee_code(uuid) TO boardroom_app;
