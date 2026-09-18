-- 0016 clocking: one attendance record per person per local day. Everyone (staff, team leads, owner, HR)
-- clocks in and out; lateness is judged against the organisation schedule at the moment of clocking in.

ALTER TABLE schedules ADD COLUMN clock_grace_minutes smallint NOT NULL DEFAULT 0 CHECK (clock_grace_minutes BETWEEN 0 AND 180);

CREATE TABLE attendance_days (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  membership_id    uuid NOT NULL,
  local_date       date NOT NULL,
  timezone         text NOT NULL,
  scheduled_start  time NOT NULL,
  scheduled_end    time NOT NULL,
  grace_minutes    smallint NOT NULL DEFAULT 0,
  clock_in_at      timestamptz NOT NULL DEFAULT now(),
  clock_out_at     timestamptz,
  late_seconds     integer NOT NULL DEFAULT 0 CHECK (late_seconds >= 0),
  left_early_seconds integer CHECK (left_early_seconds IS NULL OR left_early_seconds >= 0),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (membership_id, local_date),
  FOREIGN KEY (membership_id, organisation_id) REFERENCES memberships(id, organisation_id),
  CHECK (clock_out_at IS NULL OR clock_out_at >= clock_in_at)
);
CREATE INDEX attendance_days_org_date_idx ON attendance_days(organisation_id, local_date DESC);
CREATE TRIGGER attendance_days_updated BEFORE UPDATE ON attendance_days FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER attendance_days_notify AFTER INSERT OR UPDATE ON attendance_days FOR EACH ROW EXECUTE FUNCTION notify_org_change();

ALTER TABLE attendance_days ENABLE ROW LEVEL SECURITY;
-- Your own record; supervisors (owner, HR, your team lead) see their people's.
CREATE POLICY attendance_days_select ON attendance_days FOR SELECT USING (
  app_is_worker() OR membership_id = app_membership_id(organisation_id) OR app_has_role(organisation_id, 'owner', 'hr') OR app_manages(organisation_id, membership_id));
-- Only you clock yourself in and out.
CREATE POLICY attendance_days_insert ON attendance_days FOR INSERT WITH CHECK (app_is_worker() OR membership_id = app_membership_id(organisation_id));
CREATE POLICY attendance_days_update ON attendance_days FOR UPDATE
  USING (app_is_worker() OR membership_id = app_membership_id(organisation_id))
  WITH CHECK (app_is_worker() OR membership_id = app_membership_id(organisation_id));
GRANT SELECT, INSERT, UPDATE ON attendance_days TO boardroom_app;
