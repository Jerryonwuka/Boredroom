-- Per-organisation AI assistant connection. The API key is encrypted with APP_SECRET before it is stored
-- and lives in its own table so only owners (and the server's system context) can read the row.
CREATE TABLE organisation_secrets (
  organisation_id  uuid PRIMARY KEY REFERENCES organisations(id) ON DELETE CASCADE,
  assistant_key_enc text,
  assistant_key_hint text,            -- last 4 characters, for display only
  assistant_model   text,
  assistant_connected_at timestamptz,
  updated_by        uuid REFERENCES memberships(id),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE organisation_secrets ENABLE ROW LEVEL SECURITY;
CREATE POLICY organisation_secrets_all ON organisation_secrets FOR ALL
  USING (app_is_worker() OR app_has_role(organisation_id, 'owner'))
  WITH CHECK (app_is_worker() OR app_has_role(organisation_id, 'owner'));
GRANT SELECT, INSERT, UPDATE, DELETE ON organisation_secrets TO boardroom_app;
