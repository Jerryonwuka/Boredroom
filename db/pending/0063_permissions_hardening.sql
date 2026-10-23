-- Permissions hardening (security audit, 23 October 2026: issues 11 and 18). The app already enforces both rules
-- (src/server/services/tasks.ts and orgs.ts); this makes row security and the role trigger say the same, so a code path
-- that forgets a check is still refused. Replaces three functions in place: no tables or data change. Idempotent.
-- Waits in db/pending until the owner's go-ahead.

-- Issue 11. A personal to-do project (app_create_personal_project, 0011) makes its maker "lead", and lead rights let
-- them file tasks for anyone there (tasks_insert), manage those tasks (tasks_update) and make colleagues lead
-- (project_members_write). Staff can create no other project (projects_insert), so a project a staff member created
-- gives them no lead rights. A lead granted to staff on someone else's project is unchanged.
CREATE OR REPLACE FUNCTION app_is_project_lead(org uuid, project uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_is_worker() OR EXISTS (
    SELECT 1 FROM project_members pm JOIN projects p ON p.id = pm.project_id
    WHERE pm.project_id = project AND pm.membership_id = app_membership_id(org) AND pm.access_role = 'lead'
      AND NOT (p.created_by = pm.membership_id AND app_role(org) = 'employee'))
$$;

-- Only project_members_write uses this: staff never manage who is on a project (setProjectMember refuses them too).
CREATE OR REPLACE FUNCTION app_is_project_creator(org uuid, project uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM projects p WHERE p.id = project AND p.organisation_id = org AND p.created_by = app_membership_id(org))
    AND app_role(org) IS DISTINCT FROM 'employee'
$$;

DROP POLICY IF EXISTS project_members_write ON project_members;
CREATE POLICY project_members_write ON project_members FOR ALL
  USING (app_has_role(organisation_id, 'owner', 'hr')
    OR (app_role(organisation_id) IS DISTINCT FROM 'employee' AND (app_is_project_lead(organisation_id, project_id) OR app_is_project_creator(organisation_id, project_id))))
  WITH CHECK (app_has_role(organisation_id, 'owner', 'hr')
    OR (app_role(organisation_id) IS DISTINCT FROM 'employee' AND (app_is_project_lead(organisation_id, project_id) OR app_is_project_creator(organisation_id, project_id))));

-- Issue 18. HR could demote or offboard another HR admin, and only an owner could undo it. Changing an HR membership's
-- role or status is now for owners only, as an owner membership already was (0005). Other columns are unaffected.
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
  IF TG_OP = 'UPDATE' AND OLD.role = 'hr' AND r IS DISTINCT FROM 'owner'
     AND (OLD.role IS DISTINCT FROM NEW.role OR OLD.status IS DISTINCT FROM NEW.status) THEN
    RAISE EXCEPTION 'ROLE_GRANT_FORBIDDEN: only owners can change an HR membership' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
