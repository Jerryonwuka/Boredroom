-- Brenda, the AI work assistant (owner decision, 3 October 2026; spec "Brenda for Boredroom", MVP).
-- Four things the database has to hold: what the organisation allows Brenda to do, what each person allows her to do
-- for them, every action she took (the audit trail behind "visible, authorised, auditable, revocable"), and the
-- reminders people ask her to set. Attendance also records who clocked a person in.

-- What the organisation allows. Automatic clock-in is off until an owner or HR switches it on; reminders are on.
CREATE TABLE IF NOT EXISTS brenda_settings (
  organisation_id  uuid PRIMARY KEY REFERENCES organisations(id),
  auto_clock_in    boolean NOT NULL DEFAULT false,
  reminders        boolean NOT NULL DEFAULT true,
  updated_by       uuid,
  updated_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE brenda_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY brenda_settings_select ON brenda_settings FOR SELECT USING (app_is_worker() OR app_membership_id(organisation_id) IS NOT NULL);
CREATE POLICY brenda_settings_write ON brenda_settings FOR ALL
  USING (app_is_worker() OR app_has_role(organisation_id, 'owner', 'hr'))
  WITH CHECK (app_is_worker() OR app_has_role(organisation_id, 'owner', 'hr'));
GRANT SELECT, INSERT, UPDATE ON brenda_settings TO boardroom_app;

-- What each person allows, inside what the organisation allows. Both default on: switching off is the person's call.
CREATE TABLE IF NOT EXISTS brenda_member_prefs (
  membership_id    uuid PRIMARY KEY,
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  auto_clock_in    boolean NOT NULL DEFAULT true,
  reminders        boolean NOT NULL DEFAULT true,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (membership_id, organisation_id) REFERENCES memberships(id, organisation_id)
);
ALTER TABLE brenda_member_prefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY brenda_member_prefs_own ON brenda_member_prefs FOR ALL
  USING (app_is_worker() OR membership_id = app_membership_id(organisation_id))
  WITH CHECK (app_is_worker() OR membership_id = app_membership_id(organisation_id));
GRANT SELECT, INSERT, UPDATE ON brenda_member_prefs TO boardroom_app;

-- Every action Brenda took or was refused, as the person she acted for. Reads are not logged; actions are.
CREATE TABLE IF NOT EXISTS brenda_actions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  membership_id    uuid NOT NULL,
  tool             text NOT NULL,
  summary          text NOT NULL CHECK (length(summary) <= 500),
  outcome          text NOT NULL CHECK (outcome IN ('done', 'confirmed', 'refused', 'failed')),
  source           text NOT NULL DEFAULT 'chat' CHECK (source IN ('chat', 'confirm', 'automatic')),
  detail           jsonb NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (membership_id, organisation_id) REFERENCES memberships(id, organisation_id)
);
CREATE INDEX IF NOT EXISTS brenda_actions_member_idx ON brenda_actions(membership_id, created_at DESC);
CREATE INDEX IF NOT EXISTS brenda_actions_org_idx ON brenda_actions(organisation_id, created_at DESC);
ALTER TABLE brenda_actions ENABLE ROW LEVEL SECURITY;
-- People see their own; owners and HR see the organisation's. Rows are written by the person's own requests.
CREATE POLICY brenda_actions_select ON brenda_actions FOR SELECT
  USING (app_is_worker() OR membership_id = app_membership_id(organisation_id) OR app_has_role(organisation_id, 'owner', 'hr'));
CREATE POLICY brenda_actions_insert ON brenda_actions FOR INSERT
  WITH CHECK (app_is_worker() OR membership_id = app_membership_id(organisation_id));
GRANT SELECT, INSERT ON brenda_actions TO boardroom_app;

-- "Remind me to call Josh at 7": a reminder Brenda delivers as a notification at the time asked.
CREATE TABLE IF NOT EXISTS brenda_reminders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  membership_id    uuid NOT NULL,
  body             text NOT NULL CHECK (length(body) BETWEEN 1 AND 500),
  remind_at        timestamptz NOT NULL,
  task_id          uuid,
  sent_at          timestamptz,
  cancelled_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (membership_id, organisation_id) REFERENCES memberships(id, organisation_id),
  FOREIGN KEY (task_id, organisation_id) REFERENCES tasks(id, organisation_id)
);
CREATE INDEX IF NOT EXISTS brenda_reminders_due_idx ON brenda_reminders(remind_at) WHERE sent_at IS NULL AND cancelled_at IS NULL;
ALTER TABLE brenda_reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY brenda_reminders_own ON brenda_reminders FOR ALL
  USING (app_is_worker() OR membership_id = app_membership_id(organisation_id))
  WITH CHECK (app_is_worker() OR membership_id = app_membership_id(organisation_id));
GRANT SELECT, INSERT, UPDATE ON brenda_reminders TO boardroom_app;

-- Who clocked the person in: themself, or Brenda on their behalf (shown on the record and in the audit trail).
ALTER TABLE attendance_days ADD COLUMN IF NOT EXISTS clocked_in_by text NOT NULL DEFAULT 'self' CHECK (clocked_in_by IN ('self', 'brenda'));
