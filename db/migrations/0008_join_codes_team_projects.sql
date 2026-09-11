-- 0008 organisation join codes and one working project per team

ALTER TABLE organisations
  ADD COLUMN join_code text UNIQUE,
  ADD COLUMN join_code_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN join_code_role text NOT NULL DEFAULT 'employee' CHECK (join_code_role IN ('manager','employee')),
  ADD COLUMN join_code_team_id uuid,
  ADD COLUMN join_code_rotated_at timestamptz;
ALTER TABLE organisations ADD CONSTRAINT organisations_join_code_team_fk FOREIGN KEY (join_code_team_id, id) REFERENCES teams(id, organisation_id);
CREATE INDEX organisations_join_code_idx ON organisations(join_code) WHERE join_code_enabled;

-- Each team gets a working project so team leads have a place to create and assign tasks.
ALTER TABLE teams ADD COLUMN project_id uuid;
ALTER TABLE teams ADD CONSTRAINT teams_project_fk FOREIGN KEY (project_id, organisation_id) REFERENCES projects(id, organisation_id);

-- Joining through a code: the caller is not a member yet, so the lookup runs as definer and
-- returns only what a joiner needs to see (name, role) and nothing else.
CREATE OR REPLACE FUNCTION app_join_code_preview(code text)
RETURNS TABLE (organisation_id uuid, name text, slug text, role text, team_id uuid, enabled boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT o.id, o.name, o.slug, o.join_code_role, o.join_code_team_id, o.join_code_enabled AND o.status = 'active'
  FROM organisations o WHERE o.join_code = upper(trim(code))
$$;
GRANT EXECUTE ON FUNCTION app_join_code_preview(text) TO boardroom_app;

-- Self-join through an enabled join code (validated in service code; the policy only allows the matching role).
CREATE OR REPLACE FUNCTION app_can_self_join(org uuid, wanted_role text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_is_worker()
    OR (wanted_role = 'owner' AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.organisation_id = org))
    OR EXISTS (
      SELECT 1 FROM invitations i
      WHERE i.organisation_id = org AND i.email = app_profile_email() AND i.role = wanted_role
        AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now())
    OR EXISTS (
      SELECT 1 FROM organisations o
      WHERE o.id = org AND o.join_code_enabled AND o.status = 'active' AND o.join_code_role = wanted_role
        AND COALESCE(current_setting('app.join_code', true), '') = o.join_code)
$$;

-- A joiner may enter the team named on the join code they used.
CREATE POLICY team_members_join_code ON team_members FOR INSERT WITH CHECK (
  membership_id = app_membership_id(organisation_id) AND EXISTS (
    SELECT 1 FROM organisations o WHERE o.id = team_members.organisation_id AND o.join_code_team_id = team_members.team_id
      AND o.join_code_enabled AND COALESCE(current_setting('app.join_code', true), '') = o.join_code));
