-- Teams created before 0008 get a working project so their leads have a board to assign from.
DO $$
DECLARE t RECORD; creator uuid; proj uuid;
BEGIN
  FOR t IN SELECT id, organisation_id, name FROM teams WHERE project_id IS NULL AND archived_at IS NULL LOOP
    SELECT tm.membership_id INTO creator FROM team_members tm WHERE tm.team_id = t.id AND tm.is_manager LIMIT 1;
    IF creator IS NULL THEN
      SELECT m.id INTO creator FROM memberships m WHERE m.organisation_id = t.organisation_id AND m.status = 'active' AND m.role = 'owner' ORDER BY m.created_at LIMIT 1;
    END IF;
    IF creator IS NULL THEN CONTINUE; END IF;
    INSERT INTO projects(organisation_id, name, description, created_by)
    VALUES (t.organisation_id, t.name || ' team', 'Working project for the ' || t.name || ' team', creator) RETURNING id INTO proj;
    UPDATE teams SET project_id = proj WHERE id = t.id;
    INSERT INTO project_members(organisation_id, project_id, membership_id, access_role)
    SELECT t.organisation_id, proj, tm.membership_id, CASE WHEN tm.is_manager THEN 'lead' ELSE 'contributor' END
    FROM team_members tm WHERE tm.team_id = t.id
    ON CONFLICT (project_id, membership_id) DO NOTHING;
  END LOOP;
END $$;
