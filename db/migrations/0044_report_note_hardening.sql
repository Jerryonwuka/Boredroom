-- Report notes hardening (review of personal assistants phase 6, 8 October 2026). Two definers of 0043 replaced, their
-- old semantics kept exactly plus the change; nothing else. Additive and idempotent: safe to run by hand twice. The
-- service (services/assistant-items.ts: noteCoverage, withdrawReportNote) checks the same before it calls these, so
-- code deployed before or after this runs behaves the same; this makes the database refuse it too.
--
-- 1. app_assistant_item_refusal: a report note is also refused when no report goes out today that could carry it:
--    'no_report_today' (today is not one of the organisation's working days, as scheduleDailyReports reads them: the
--    latest organisation-wide schedule, Monday to Friday without one) and 'no_reader' (nobody other than the author
--    receives a report that covers them: a lead of a live team they are in, or the owner and HR while the report goes
--    organisation-wide). The insert policy assistant_items_insert calls this function, so it refuses the same.
-- 2. app_assistant_item_withdraw: 'too_late' also once the report's time has passed as it is set now (it may have moved
--    earlier since the note was added: expires_at was frozen at insert), and once a report for the note's day that may
--    hold it has been written (a lead's report asked for early).

CREATE OR REPLACE FUNCTION app_assistant_item_refusal(org uuid, recipient uuid, item_kind text) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := app_membership_id(org); s record; today date;
BEGIN
  IF me IS NULL THEN RETURN 'not_member'; END IF;
  IF item_kind = 'report_note' THEN
    IF recipient IS NOT NULL THEN RETURN 'bad_kind'; END IF;
    SELECT COALESCE(b.report_notes, true) AS notes, COALESCE(b.daily_report_enabled, true) AS report, COALESCE(b.daily_report_org_wide, true) AS org_wide,
           (o.timezone) AS tz INTO s
      FROM organisations o LEFT JOIN brenda_settings b ON b.organisation_id = o.id WHERE o.id = org;
    IF NOT s.report THEN RETURN 'report_off'; END IF;
    IF NOT s.notes THEN RETURN 'notes_off'; END IF;
    today := (now() AT TIME ZONE s.tz)::date;
    IF now() >= app_report_cutoff(org, today) THEN RETURN 'too_late'; END IF;
    IF NOT (COALESCE((SELECT sc.working_days::int[] FROM schedules sc WHERE sc.organisation_id = org AND sc.membership_id IS NULL
                      ORDER BY sc.effective_from DESC, sc.created_at DESC LIMIT 1), '{1,2,3,4,5}'::int[]) @> ARRAY[EXTRACT(DOW FROM today)::int]) THEN
      RETURN 'no_report_today';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM memberships r
                   WHERE r.organisation_id = org AND r.status = 'active' AND r.id <> me
                     AND ((r.role = 'manager' AND EXISTS (
                            SELECT 1 FROM team_members mgr JOIN teams t ON t.id = mgr.team_id AND t.archived_at IS NULL
                            JOIN team_members tm ON tm.team_id = mgr.team_id
                            WHERE mgr.membership_id = r.id AND mgr.is_manager AND tm.membership_id = me))
                       OR (s.org_wide AND r.role IN ('owner', 'hr')))) THEN
      RETURN 'no_reader';
    END IF;
    RETURN NULL;
  END IF;
  IF item_kind IS NULL OR item_kind NOT IN ('message', 'request', 'reply') THEN RETURN 'bad_kind'; END IF;
  IF recipient IS NULL THEN RETURN 'not_member'; END IF;
  IF recipient = me THEN RETURN 'self'; END IF;
  IF NOT EXISTS (SELECT 1 FROM memberships m WHERE m.id = recipient AND m.organisation_id = org AND m.status = 'active') THEN RETURN 'not_member'; END IF;
  IF item_kind <> 'reply' AND EXISTS (SELECT 1 FROM assistant_item_mutes x WHERE x.recipient_membership_id = recipient AND x.sender_membership_id = me AND x.muted) THEN RETURN 'muted'; END IF;
  RETURN NULL;
END $$;
GRANT EXECUTE ON FUNCTION app_assistant_item_refusal(uuid, uuid, text) TO boardroom_app;

-- Withdraw a report note (its author alone, before the report is written): 'ok', 'not_found', 'closed', 'too_late'.
CREATE OR REPLACE FUNCTION app_assistant_item_withdraw(item uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE i assistant_items%ROWTYPE;
BEGIN
  SELECT * INTO i FROM assistant_items WHERE id = item FOR UPDATE;
  IF NOT FOUND OR i.kind <> 'report_note' OR app_membership_id(i.organisation_id) IS DISTINCT FROM i.sender_membership_id THEN RETURN 'not_found'; END IF;
  IF i.status = 'done' THEN RETURN 'too_late'; END IF;
  IF i.status <> 'delivered' THEN RETURN 'closed'; END IF;
  IF i.expires_at <= now() OR now() >= app_report_cutoff(i.organisation_id, i.report_date) THEN RETURN 'too_late'; END IF;
  IF EXISTS (SELECT 1 FROM brenda_report_log l JOIN memberships r ON r.id = l.membership_id
             WHERE l.organisation_id = i.organisation_id AND l.local_date = i.report_date AND l.written_at IS NOT NULL AND l.written_at >= i.created_at
               AND (l.membership_id = i.sender_membership_id OR r.role IN ('owner', 'hr')
                    OR EXISTS (SELECT 1 FROM team_members mgr JOIN team_members tm ON tm.team_id = mgr.team_id
                               WHERE mgr.membership_id = l.membership_id AND mgr.is_manager AND tm.membership_id = i.sender_membership_id))) THEN
    RETURN 'too_late';
  END IF;
  UPDATE assistant_items SET status = 'withdrawn', finished_at = now() WHERE id = item;
  RETURN 'ok';
END $$;
GRANT EXECUTE ON FUNCTION app_assistant_item_withdraw(uuid) TO boardroom_app;
