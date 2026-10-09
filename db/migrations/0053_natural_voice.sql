-- Natural voice (owner decision, 9 October 2026: natural voice (ElevenLabs), "use your recommendations"). Each person may
-- pick a natural voice for their own assistant; the words it says are turned into speech by ElevenLabs, on the workspace's
-- own key (entered by owners or HR in Settings) or, without one, on Boredroom's key within a daily share. Three things:
-- 1. assistant_profiles.natural_voice: the person's chosen voice (NULL: "Computer voice", the default). On the profile
--    everyone in the workspace reads; 0035's policies cover the new column (only the person writes their own row). A format
--    check only: the server checks the catalogue (lib/natural-voices).
-- 2. organisation_voice_secrets: the workspace's own ElevenLabs key, encrypted with APP_SECRET, in a table of its own (not
--    on organisation_secrets, which is owner-only and whose row clearAssistantKey deletes whole). Owners and HR (both may
--    manage the key) and the server's system context.
-- 3. voice_usage_daily: characters spoken, per person per day (the organisation's own day) per key, for the caps. Written
--    only by the server's system context (a reservation is checked against everyone's totals under a lock); read: one's own
--    rows, owners and HR the organisation's. Never the text, never audio.
-- Additive and idempotent: safe to run by hand twice. `DROP … IF EXISTS` only on objects this file creates. Requires 0052
-- (applied in order). Code deployed before this runs offers no natural voice: every assistant uses the computer voice and
-- Settings says a database update is needed (server/lib/schema-0053).

-- 1. The person's chosen natural voice.
ALTER TABLE assistant_profiles ADD COLUMN IF NOT EXISTS natural_voice text;
ALTER TABLE assistant_profiles DROP CONSTRAINT IF EXISTS assistant_profiles_natural_voice_check;
ALTER TABLE assistant_profiles ADD CONSTRAINT assistant_profiles_natural_voice_check
  CHECK (natural_voice IS NULL OR natural_voice ~ '^[A-Za-z0-9]{16,40}$');

-- 2. The workspace's own ElevenLabs key, encrypted with APP_SECRET. Owners and HR (and the server's system context).
CREATE TABLE IF NOT EXISTS organisation_voice_secrets (
  organisation_id uuid PRIMARY KEY REFERENCES organisations(id) ON DELETE CASCADE,
  key_enc         text NOT NULL,
  key_hint        text NOT NULL CONSTRAINT organisation_voice_secrets_hint_check CHECK (char_length(key_hint) <= 8),
  connected_at    timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid REFERENCES memberships(id),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE organisation_voice_secrets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organisation_voice_secrets_all ON organisation_voice_secrets;
CREATE POLICY organisation_voice_secrets_all ON organisation_voice_secrets FOR ALL
  USING (app_is_worker() OR app_has_role(organisation_id, 'owner', 'hr'))
  WITH CHECK (app_is_worker() OR app_has_role(organisation_id, 'owner', 'hr'));
GRANT SELECT, INSERT, UPDATE, DELETE ON organisation_voice_secrets TO boardroom_app;

-- 3. Characters spoken, per person per day (the organisation's own day) per key. Written only by the server's system
--    context (reservations must be checked against everyone's totals); read: one's own rows, owners and HR the organisation's.
CREATE TABLE IF NOT EXISTS voice_usage_daily (
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  membership_id   uuid NOT NULL,
  day             date NOT NULL,
  key_source      text NOT NULL CONSTRAINT voice_usage_daily_source_check CHECK (key_source IN ('organisation', 'environment')),
  characters      integer NOT NULL DEFAULT 0 CONSTRAINT voice_usage_daily_characters_check CHECK (characters >= 0),
  utterances      integer NOT NULL DEFAULT 0 CONSTRAINT voice_usage_daily_utterances_check CHECK (utterances >= 0),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (membership_id, day, key_source),
  FOREIGN KEY (membership_id, organisation_id) REFERENCES memberships(id, organisation_id)
);
CREATE INDEX IF NOT EXISTS voice_usage_daily_org_idx ON voice_usage_daily(organisation_id, day);
CREATE INDEX IF NOT EXISTS voice_usage_daily_env_idx ON voice_usage_daily(day) WHERE key_source = 'environment';
ALTER TABLE voice_usage_daily ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS voice_usage_daily_select ON voice_usage_daily;
CREATE POLICY voice_usage_daily_select ON voice_usage_daily FOR SELECT
  USING (app_is_worker() OR membership_id = app_membership_id(organisation_id) OR app_has_role(organisation_id, 'owner', 'hr'));
DROP POLICY IF EXISTS voice_usage_daily_insert ON voice_usage_daily;
CREATE POLICY voice_usage_daily_insert ON voice_usage_daily FOR INSERT WITH CHECK (app_is_worker());
DROP POLICY IF EXISTS voice_usage_daily_update ON voice_usage_daily;
CREATE POLICY voice_usage_daily_update ON voice_usage_daily FOR UPDATE USING (app_is_worker()) WITH CHECK (app_is_worker());
GRANT SELECT, INSERT, UPDATE ON voice_usage_daily TO boardroom_app;
REVOKE DELETE, TRUNCATE ON voice_usage_daily FROM boardroom_app;
