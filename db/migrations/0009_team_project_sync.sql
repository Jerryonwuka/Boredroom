-- Keeps a team's working project membership in step with team membership.
-- Definer function: a joiner has no rights on project_members yet, so the check that the
-- person really is in the team (or was just removed from it) happens here.
CREATE OR REPLACE FUNCTION app_sync_team_project_member(org uuid, team uuid, member uuid, access text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE proj uuid;
BEGIN
  IF NOT app_is_member(org) THEN RAISE EXCEPTION 'not a member' USING ERRCODE = 'insufficient_privilege'; END IF;
  SELECT project_id INTO proj FROM teams WHERE id = team AND organisation_id = org;
  IF proj IS NULL THEN RETURN; END IF;
  IF access = 'remove' THEN
    IF EXISTS (SELECT 1 FROM team_members tm WHERE tm.team_id = team AND tm.membership_id = member) THEN RETURN; END IF; -- still in the team
    DELETE FROM project_members WHERE project_id = proj AND membership_id = member;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM team_members tm WHERE tm.team_id = team AND tm.membership_id = member) THEN RETURN; END IF;
    IF access NOT IN ('lead','contributor') THEN RAISE EXCEPTION 'bad access role'; END IF;
    INSERT INTO project_members(organisation_id, project_id, membership_id, access_role) VALUES (org, proj, member, access)
    ON CONFLICT (project_id, membership_id) DO UPDATE SET access_role = EXCLUDED.access_role;
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION app_sync_team_project_member(uuid, uuid, uuid, text) TO boardroom_app;
