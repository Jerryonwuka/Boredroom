-- Owner decision (16 September 2026): team leads may watch recordings of the people on their teams, and
-- organisation accounts (owner, HR) may watch any recording in the organisation, without an explicit grant.
-- Grants still extend access to anyone else (for example a reviewer who is not the person's lead).
-- Every playback is still logged in recording_access_log and the audit trail; flagged footage stays locked.
CREATE OR REPLACE FUNCTION app_can_review_recording(org uuid, target_membership uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_is_worker()
    OR app_has_role(org, 'owner', 'hr')
    OR app_manages(org, target_membership)
    OR EXISTS (
    SELECT 1 FROM recording_grants g
    WHERE g.organisation_id = org AND g.revoked_at IS NULL
      AND g.grantee_membership_id = app_membership_id(org)
      AND (
        g.scope_type = 'organisation'
        OR (g.scope_type = 'team' AND EXISTS (
          SELECT 1 FROM team_members tm WHERE tm.team_id = g.scope_id AND tm.membership_id = target_membership))))
$$;
