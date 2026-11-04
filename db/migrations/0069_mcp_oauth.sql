-- Signing in to MCP servers (owner request, 4 November 2026: "plan phase 1b first, then execute"). Phase 1 took keys
-- only; many servers instead ask the workspace to sign in with OAuth (the MCP authorization spec, 2025-06-18: protected
-- resource metadata, authorization server metadata, dynamic client registration, PKCE S256, the resource indicator,
-- refresh tokens). Owners and HR sign in for the workspace and everyone's Brenda uses that account (no personal servers
-- yet); tool approvals are unchanged.
--   1. mcp_servers.auth_kind may be 'oauth'.
--   2. mcp_server_oauth: per server, where it signs in, the client Boredroom registered (or the admin gave), and the
--      sealed tokens (AES-256-GCM bound to the row and field, connectors/crypto.ts). Boredroom's server contexts only.
--   3. mcp_oauth_states: single-use sign-in states (sha256 only, 10 minutes) bound to the person, the workspace and the
--      server, with the sealed PKCE verifier. Boredroom's server contexts only.
--
-- Applied with the owner's go-ahead (4 November 2026: "how do i apply 0069 and 0070?"). The code still runs on a database without it (a deploy ahead of the
-- migration, a restore): Settings says signing in needs a database
-- update and keys keep working (server/lib/schema-0069.ts). Additive and idempotent; it needs 0068. Never ALTER ROLE.

DO $$
BEGIN
  IF to_regclass('public.mcp_servers') IS NULL THEN
    RAISE EXCEPTION 'MIGRATION_ORDER: apply 0068_mcp_and_skills.sql before 0069_mcp_oauth.sql.';
  END IF;
END $$;

-- 1. A server may sign in --------------------------------------------------------------------------------------------
ALTER TABLE mcp_servers DROP CONSTRAINT IF EXISTS mcp_servers_auth_check;
ALTER TABLE mcp_servers ADD CONSTRAINT mcp_servers_auth_check CHECK (auth_kind IN ('none', 'bearer', 'header', 'oauth'));

-- 2. Where it signs in, and the tokens: Boredroom's server contexts only ---------------------------------------------
CREATE TABLE IF NOT EXISTS mcp_server_oauth (
  server_id          uuid PRIMARY KEY,
  organisation_id    uuid NOT NULL,
  issuer             text NOT NULL CONSTRAINT mcp_server_oauth_issuer_check CHECK (char_length(issuer) BETWEEN 9 AND 500 AND issuer ~ '^https?://\S+$'),
  authorize_url      text NOT NULL CONSTRAINT mcp_server_oauth_authorize_check CHECK (char_length(authorize_url) BETWEEN 9 AND 500 AND authorize_url ~ '^https?://\S+$'),
  token_url          text NOT NULL CONSTRAINT mcp_server_oauth_token_check CHECK (char_length(token_url) BETWEEN 9 AND 500 AND token_url ~ '^https://\S+$'),
  registration_url   text CONSTRAINT mcp_server_oauth_registration_check CHECK (registration_url IS NULL OR (char_length(registration_url) <= 500 AND registration_url ~ '^https://\S+$')),
  revocation_url     text CONSTRAINT mcp_server_oauth_revocation_check CHECK (revocation_url IS NULL OR (char_length(revocation_url) <= 500 AND revocation_url ~ '^https://\S+$')),
  resource           text NOT NULL CONSTRAINT mcp_server_oauth_resource_check CHECK (char_length(resource) BETWEEN 9 AND 500 AND resource ~ '^https://\S+$'),
  scopes             text CONSTRAINT mcp_server_oauth_scopes_check CHECK (scopes IS NULL OR (char_length(scopes) <= 1000 AND scopes !~ '[\x01-\x1f\x7f]')),
  client_id          text CONSTRAINT mcp_server_oauth_client_check CHECK (client_id IS NULL OR (char_length(client_id) BETWEEN 1 AND 500 AND client_id !~ '[\x01-\x1f\x7f]')),
  client_secret_enc  text CONSTRAINT mcp_server_oauth_secret_check CHECK (client_secret_enc IS NULL OR client_secret_enc ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'),
  client_auth        text NOT NULL DEFAULT 'none' CONSTRAINT mcp_server_oauth_client_auth_check CHECK (client_auth IN ('none', 'client_secret_post', 'client_secret_basic')),
  client_registered  boolean NOT NULL DEFAULT false,
  access_enc         text CONSTRAINT mcp_server_oauth_access_check CHECK (access_enc IS NULL OR access_enc ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'),
  refresh_enc        text CONSTRAINT mcp_server_oauth_refresh_check CHECK (refresh_enc IS NULL OR refresh_enc ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'),
  expires_at         timestamptz,
  signed_in_by       uuid,
  signed_in_at       timestamptz,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (server_id, organisation_id) REFERENCES mcp_servers(id, organisation_id) ON DELETE CASCADE,
  FOREIGN KEY (signed_in_by, organisation_id) REFERENCES memberships(id, organisation_id),
  CONSTRAINT mcp_server_oauth_secret_auth CHECK ((client_auth = 'none') = (client_secret_enc IS NULL))
);
DROP TRIGGER IF EXISTS mcp_server_oauth_updated ON mcp_server_oauth;
CREATE TRIGGER mcp_server_oauth_updated BEFORE UPDATE ON mcp_server_oauth FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE mcp_server_oauth ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mcp_server_oauth_server ON mcp_server_oauth;
CREATE POLICY mcp_server_oauth_server ON mcp_server_oauth FOR ALL USING (app_is_worker()) WITH CHECK (app_is_worker());
GRANT SELECT, INSERT, UPDATE, DELETE ON mcp_server_oauth TO boardroom_app;
REVOKE TRUNCATE ON mcp_server_oauth FROM boardroom_app;

-- 3. Sign-in states: Boredroom's server contexts only ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mcp_oauth_states (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_hash       text NOT NULL UNIQUE CONSTRAINT mcp_oauth_states_hash_check CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  server_id        uuid NOT NULL,
  organisation_id  uuid NOT NULL,
  membership_id    uuid NOT NULL,
  user_id          uuid NOT NULL,
  verifier_enc     text NOT NULL CONSTRAINT mcp_oauth_states_verifier_check CHECK (verifier_enc ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'),
  expires_at       timestamptz NOT NULL,
  used_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (server_id, organisation_id) REFERENCES mcp_servers(id, organisation_id) ON DELETE CASCADE,
  FOREIGN KEY (membership_id, organisation_id) REFERENCES memberships(id, organisation_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS mcp_oauth_states_expiry_idx ON mcp_oauth_states(expires_at);
ALTER TABLE mcp_oauth_states ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mcp_oauth_states_server ON mcp_oauth_states;
CREATE POLICY mcp_oauth_states_server ON mcp_oauth_states FOR ALL USING (app_is_worker()) WITH CHECK (app_is_worker());
GRANT SELECT, INSERT, UPDATE, DELETE ON mcp_oauth_states TO boardroom_app;
REVOKE TRUNCATE ON mcp_oauth_states FROM boardroom_app;
