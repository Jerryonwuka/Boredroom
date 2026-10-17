-- Screen help on Brenda for Mac, phase 1 (owner decisions, 11 October 2026: "start building with your recommendations").
-- 1. screen_help_settings: the workspace's switch (Allowed, the default, or Not allowed), when owners and HR were told
--    (notice_at) and when screen help becomes available (available_from: 14 days later, or sooner if they choose), and the
--    apps Brenda must never look at. Members read it (their Mac needs it); owners and HR write it. No row: nobody has
--    been told yet (services/screen-help starts the notice the first time the workspace is offered screen help); a
--    workspace created while it is offered gets its row at creation, available at once.
-- 2. assistant_private: the person's own never-look list and when they pressed "Turn off on my Macs". 0047's policy (the
--    person and the worker only) covers the new columns: no owner, HR or lead reads them.
-- 3. look_usage_daily: what looks cost Boredroom, per day and model, with no workspace and no person; the worker only.
-- Additive and idempotent: safe to run by hand twice. Requires 0056 (applied in order); does not depend on 0055.
-- Code deployed before this runs reads screen help as not ready (server/lib/schema-0057).
-- Waits in db/pending (written 11 October 2026, never applied): `pnpm db:migrate` (and `pnpm dev` on the self-contained
-- local PostgreSQL) applies everything in db/migrations, so it moves there only with the owner's go-ahead for the pilot.
-- The tests apply it by hand to their own database.

CREATE TABLE IF NOT EXISTS screen_help_settings (
  organisation_id  uuid PRIMARY KEY REFERENCES organisations(id),
  allowed          boolean NOT NULL DEFAULT true,
  notice_at        timestamptz,
  available_from   timestamptz,
  never_look       jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT screen_help_settings_never_look_check CHECK (jsonb_typeof(never_look) = 'array' AND jsonb_array_length(never_look) <= 50),
  CONSTRAINT screen_help_settings_notice_check CHECK ((notice_at IS NULL) = (available_from IS NULL))
);
DROP TRIGGER IF EXISTS screen_help_settings_updated ON screen_help_settings;
CREATE TRIGGER screen_help_settings_updated BEFORE UPDATE ON screen_help_settings FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE screen_help_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS screen_help_settings_select ON screen_help_settings;
CREATE POLICY screen_help_settings_select ON screen_help_settings FOR SELECT
  USING (app_is_worker() OR app_membership_id(organisation_id) IS NOT NULL);
DROP POLICY IF EXISTS screen_help_settings_insert ON screen_help_settings;
CREATE POLICY screen_help_settings_insert ON screen_help_settings FOR INSERT
  WITH CHECK (app_is_worker() OR app_has_role(organisation_id, 'owner', 'hr'));
DROP POLICY IF EXISTS screen_help_settings_update ON screen_help_settings;
CREATE POLICY screen_help_settings_update ON screen_help_settings FOR UPDATE
  USING (app_is_worker() OR app_has_role(organisation_id, 'owner', 'hr'))
  WITH CHECK (app_is_worker() OR app_has_role(organisation_id, 'owner', 'hr'));
GRANT SELECT, INSERT, UPDATE ON screen_help_settings TO boardroom_app;
REVOKE DELETE, TRUNCATE ON screen_help_settings FROM boardroom_app;

ALTER TABLE assistant_private ADD COLUMN IF NOT EXISTS screen_help_never_look jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE assistant_private ADD COLUMN IF NOT EXISTS screen_help_off_at timestamptz;
ALTER TABLE assistant_private DROP CONSTRAINT IF EXISTS assistant_private_screen_help_check;
ALTER TABLE assistant_private ADD CONSTRAINT assistant_private_screen_help_check
  CHECK (jsonb_typeof(screen_help_never_look) = 'array' AND jsonb_array_length(screen_help_never_look) <= 50);

CREATE TABLE IF NOT EXISTS look_usage_daily (
  day                date NOT NULL,
  model              text NOT NULL CONSTRAINT look_usage_daily_model_check CHECK (char_length(model) BETWEEN 1 AND 100),
  looks              integer NOT NULL DEFAULT 0,
  steps              integer NOT NULL DEFAULT 0,
  image_tokens       bigint NOT NULL DEFAULT 0,
  input_tokens       bigint NOT NULL DEFAULT 0,
  output_tokens      bigint NOT NULL DEFAULT 0,
  cache_read_tokens  bigint NOT NULL DEFAULT 0,
  cache_write_tokens bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (day, model)
);
ALTER TABLE look_usage_daily ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS look_usage_daily_worker ON look_usage_daily;
CREATE POLICY look_usage_daily_worker ON look_usage_daily FOR ALL USING (app_is_worker()) WITH CHECK (app_is_worker());
GRANT SELECT, INSERT, UPDATE ON look_usage_daily TO boardroom_app;
REVOKE DELETE, TRUNCATE ON look_usage_daily FROM boardroom_app;
