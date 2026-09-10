-- Overlap check for proposed intervals across every organisation the user belongs to.
-- Definer function: it returns only a boolean-like row, never another organisation's details.
CREATE OR REPLACE FUNCTION app_user_interval_overlaps(p_start timestamptz, p_end timestamptz, p_exclude uuid[])
RETURNS TABLE (overlaps boolean) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT true FROM session_intervals i
  WHERE i.user_id = app_user_id() AND i.confirmation_status = 'confirmed'
    AND NOT (i.id = ANY(COALESCE(p_exclude, '{}'::uuid[])))
    AND tstzrange(i.started_at, COALESCE(i.ended_at, 'infinity'::timestamptz), '[)') && tstzrange(p_start, p_end, '[)')
  LIMIT 1
$$;
GRANT EXECUTE ON FUNCTION app_user_interval_overlaps(timestamptz, timestamptz, uuid[]) TO boardroom_app;

-- Existence check used to log denied playback attempts without exposing recording details.
CREATE OR REPLACE FUNCTION app_recording_in_org(org uuid, rec uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_is_member(org) AND EXISTS (SELECT 1 FROM recordings r WHERE r.id = rec AND r.organisation_id = org)
$$;
GRANT EXECUTE ON FUNCTION app_recording_in_org(uuid, uuid) TO boardroom_app;
