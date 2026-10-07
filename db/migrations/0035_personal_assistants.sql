-- Personal assistants (owner decision, 7 October 2026: phase 1). Every person has their own assistant in each workspace
-- they belong to: a name (Brenda unless they choose another), a sphere colour from a curated palette, a visor and eyes.
-- The workspace has one of its own, kept beside the organisation's other Brenda settings, which signs what the workspace
-- sends on its own (the end-of-day team report). Names and looks are not secret: everyone in the workspace can read them
-- (later phases show one person's assistant to another); only the person writes their own, only owners and HR the
-- workspace's. setup_done_at records that the person has seen "Meet your assistant" (saved or kept Brenda), so it shows
-- once. A missing row means Brenda as she is, with setup not yet done.
-- Additive and idempotent: safe to run by hand twice; the constant DEFAULTs keep the brenda_settings columns metadata-only.

CREATE TABLE IF NOT EXISTS assistant_profiles (
  membership_id    uuid PRIMARY KEY,
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  name             text NOT NULL DEFAULT 'Brenda',
  colour           text NOT NULL DEFAULT 'white',
  visor            text NOT NULL DEFAULT 'bean',
  eyes             text NOT NULL DEFAULT 'pill',
  setup_done_at    timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (membership_id, organisation_id) REFERENCES memberships(id, organisation_id),
  -- The name goes into the assistant's instructions as quoted data; the server checks it properly (letters of any script,
  -- digits, space, apostrophe, hyphen, full stop). This is the floor the database holds whatever writes it.
  CONSTRAINT assistant_profiles_name_check CHECK (
    char_length(name) BETWEEN 1 AND 24 AND name = btrim(name) AND position('  ' IN name) = 0
    AND name !~ '[[:cntrl:]]' AND name !~ '[\u115F\u1160\u3164\uFFA0]'  -- the invisible Hangul fillers
    AND length(translate(name, '!"#$%&()*+,/:;<=>?@[\]^_`{|}~', '')) = length(name)),
  CONSTRAINT assistant_profiles_colour_check CHECK (colour IN ('white', 'grey', 'yellow', 'orange', 'coral', 'pink', 'purple', 'blue', 'teal', 'green')),
  CONSTRAINT assistant_profiles_visor_check CHECK (visor IN ('bean', 'band', 'screen')),
  CONSTRAINT assistant_profiles_eyes_check CHECK (eyes IN ('pill', 'round', 'square'))
);
CREATE INDEX IF NOT EXISTS assistant_profiles_org_idx ON assistant_profiles(organisation_id);

ALTER TABLE assistant_profiles ENABLE ROW LEVEL SECURITY;
-- Everyone in the workspace reads them; the person writes their own; the worker may do either (system jobs).
DROP POLICY IF EXISTS assistant_profiles_select ON assistant_profiles;
CREATE POLICY assistant_profiles_select ON assistant_profiles FOR SELECT
  USING (app_is_worker() OR app_is_member(organisation_id));
DROP POLICY IF EXISTS assistant_profiles_insert ON assistant_profiles;
CREATE POLICY assistant_profiles_insert ON assistant_profiles FOR INSERT
  WITH CHECK (app_is_worker() OR membership_id = app_membership_id(organisation_id));
DROP POLICY IF EXISTS assistant_profiles_update ON assistant_profiles;
CREATE POLICY assistant_profiles_update ON assistant_profiles FOR UPDATE
  USING (app_is_worker() OR membership_id = app_membership_id(organisation_id))
  WITH CHECK (app_is_worker() OR membership_id = app_membership_id(organisation_id));
-- No DELETE: "Reset to Brenda" saves the defaults.
GRANT SELECT, INSERT, UPDATE ON assistant_profiles TO boardroom_app;

-- The workspace's own assistant, beside the organisation's Brenda switches (0026: read by members, written by owners,
-- HR and the worker). Same rules as above.
ALTER TABLE brenda_settings ADD COLUMN IF NOT EXISTS assistant_name text NOT NULL DEFAULT 'Brenda'
  CONSTRAINT brenda_settings_assistant_name_check CHECK (
    char_length(assistant_name) BETWEEN 1 AND 24 AND assistant_name = btrim(assistant_name) AND position('  ' IN assistant_name) = 0
    AND assistant_name !~ '[[:cntrl:]]' AND assistant_name !~ '[\u115F\u1160\u3164\uFFA0]'
    AND length(translate(assistant_name, '!"#$%&()*+,/:;<=>?@[\]^_`{|}~', '')) = length(assistant_name));
ALTER TABLE brenda_settings ADD COLUMN IF NOT EXISTS assistant_colour text NOT NULL DEFAULT 'white'
  CONSTRAINT brenda_settings_assistant_colour_check CHECK (assistant_colour IN ('white', 'grey', 'yellow', 'orange', 'coral', 'pink', 'purple', 'blue', 'teal', 'green'));
ALTER TABLE brenda_settings ADD COLUMN IF NOT EXISTS assistant_visor text NOT NULL DEFAULT 'bean'
  CONSTRAINT brenda_settings_assistant_visor_check CHECK (assistant_visor IN ('bean', 'band', 'screen'));
ALTER TABLE brenda_settings ADD COLUMN IF NOT EXISTS assistant_eyes text NOT NULL DEFAULT 'pill'
  CONSTRAINT brenda_settings_assistant_eyes_check CHECK (assistant_eyes IN ('pill', 'round', 'square'));
