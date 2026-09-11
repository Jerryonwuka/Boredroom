-- Staff without a team still need somewhere for their own to-dos: a personal project they lead.
-- Definer: staff cannot create projects themselves (only managers can), so this narrow path exists.
CREATE OR REPLACE FUNCTION app_create_personal_project(org uuid, member uuid, pname text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE proj uuid;
BEGIN
  IF app_membership_id(org) IS DISTINCT FROM member THEN RAISE EXCEPTION 'personal projects are created for the caller only' USING ERRCODE = 'insufficient_privilege'; END IF;
  INSERT INTO projects(organisation_id, name, description, created_by) VALUES (org, pname, 'Personal to-do list', member) RETURNING id INTO proj;
  INSERT INTO project_members(organisation_id, project_id, membership_id, access_role) VALUES (org, proj, member, 'lead');
  RETURN proj;
END $$;
GRANT EXECUTE ON FUNCTION app_create_personal_project(uuid, uuid, text) TO boardroom_app;
