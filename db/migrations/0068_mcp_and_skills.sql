-- Brenda's own apps (MCP) and skills (owner decisions, 4 November 2026: phase 1 of the Grok Bot and HeyClicky merge plan,
-- "go with your recommendations"). A workspace's owner or HR adds remote MCP servers and switches each of their tools on
-- for Brenda as Read (she uses it when asked) or Act (always a Confirm card); and adds skills (a SKILL.md and up to 5
-- reference files) that Brenda opens when a request matches one. Owners and HR only; no personal servers yet; keys only
-- (MCP OAuth sign-in is phase 1b); behind the CONNECTORS plan feature like connected apps.
--   1. mcp_servers: name, https address, what it's for (the admin's words), how it signs in, status. Members read it
--      (Brenda lists the names); owner or HR write it.
--   2. mcp_server_secrets: the key (AES-256-GCM, bound to its row, connectors/crypto.ts). Boredroom's server contexts only.
--   3. mcp_tools: each tool the server listed, with a hash of its name, title, description and input shape. A tool is used
--      only while its access is read or act AND approved_hash = hash: a server that changes a tool switches it off until
--      an admin looks again. Members read it; the worker writes what the server lists; owner or HR set access, and only
--      to approve the hash the row holds now (a trigger).
--   4. brenda_skills: the workspace's own skills, and one row per built-in skill a workspace turned off (built-ins live in
--      code). Members read them; owner or HR write them.
-- Control characters are refused by code point (not [[:cntrl:]], which some locales stretch to cover dashes).
--
-- Applied with the owner's go-ahead (4 November 2026: "apply 0068"). The code still runs on a database without it: Settings
-- says MCP servers and skills need a database update, their routes answer 503 NOT_READY, and Brenda's app_tools,
-- use_app_tool, act_with_app_tool and read_skill say they aren't switched on here yet (server/lib/schema-0068.ts).
-- Additive and idempotent; it needs 0061 (connector_rate_budget for the hourly call budget). Never ALTER ROLE.

DO $$
BEGIN
  IF to_regclass('public.connector_rate_budget') IS NULL THEN
    RAISE EXCEPTION 'MIGRATION_ORDER: apply 0061_connectors.sql before 0068_mcp_and_skills.sql.';
  END IF;
END $$;

-- 1. Servers -----------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mcp_servers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name             text NOT NULL CONSTRAINT mcp_servers_name_check
                     CHECK (char_length(name) BETWEEN 1 AND 60 AND name = btrim(name) AND name !~ '[\x01-\x1f\x7f]'),
  url              text NOT NULL CONSTRAINT mcp_servers_url_check
                     CHECK (char_length(url) BETWEEN 9 AND 500 AND url ~ '^https://[^\s@/]+(/[^\s]*)?$'),
  use_for          text CONSTRAINT mcp_servers_use_for_check
                     CHECK (use_for IS NULL OR (char_length(use_for) BETWEEN 1 AND 200 AND use_for !~ '[\x01-\x1f\x7f]')),
  auth_kind        text NOT NULL DEFAULT 'none' CONSTRAINT mcp_servers_auth_check CHECK (auth_kind IN ('none', 'bearer', 'header')),
  auth_header      text CONSTRAINT mcp_servers_header_check CHECK (auth_header IS NULL OR auth_header ~ '^[A-Za-z0-9-]{1,60}$'),
  status           text NOT NULL DEFAULT 'active' CONSTRAINT mcp_servers_status_check CHECK (status IN ('active', 'needs_attention', 'paused')),
  server_label     text CONSTRAINT mcp_servers_label_check CHECK (server_label IS NULL OR char_length(server_label) <= 200),
  last_checked_at  timestamptz,
  last_ok_at       timestamptz,
  last_error_code  text CONSTRAINT mcp_servers_error_check CHECK (last_error_code IS NULL OR last_error_code ~ '^[A-Z_]{2,40}$'),
  added_by         uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (added_by, organisation_id) REFERENCES memberships(id, organisation_id),
  CONSTRAINT mcp_servers_header_kind CHECK ((auth_kind = 'header') = (auth_header IS NOT NULL)),
  UNIQUE (id, organisation_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS mcp_servers_name_idx ON mcp_servers(organisation_id, lower(name));
DROP TRIGGER IF EXISTS mcp_servers_updated ON mcp_servers;
CREATE TRIGGER mcp_servers_updated BEFORE UPDATE ON mcp_servers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- At most 20 servers a workspace; whose a server is never changes.
CREATE OR REPLACE FUNCTION mcp_servers_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.organisation_id <> OLD.organisation_id OR NEW.added_by <> OLD.added_by THEN
      RAISE EXCEPTION 'MCP_SERVER_OWNER: a server stays its workspace''s' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('mcp_servers:' || NEW.organisation_id::text));
  IF (SELECT count(*) FROM mcp_servers WHERE organisation_id = NEW.organisation_id) >= 20 THEN
    RAISE EXCEPTION 'MCP_SERVERS_FULL: at most 20 MCP servers' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS mcp_servers_guard ON mcp_servers;
CREATE TRIGGER mcp_servers_guard BEFORE INSERT OR UPDATE ON mcp_servers FOR EACH ROW EXECUTE FUNCTION mcp_servers_guard();

ALTER TABLE mcp_servers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mcp_servers_select ON mcp_servers;
CREATE POLICY mcp_servers_select ON mcp_servers FOR SELECT USING (app_is_member(organisation_id));
DROP POLICY IF EXISTS mcp_servers_insert ON mcp_servers;
CREATE POLICY mcp_servers_insert ON mcp_servers FOR INSERT WITH CHECK (
  app_is_worker() OR (app_has_role(organisation_id, 'owner', 'hr') AND added_by = app_membership_id(organisation_id)));
DROP POLICY IF EXISTS mcp_servers_update ON mcp_servers;
CREATE POLICY mcp_servers_update ON mcp_servers FOR UPDATE
  USING (app_has_role(organisation_id, 'owner', 'hr')) WITH CHECK (app_has_role(organisation_id, 'owner', 'hr'));
DROP POLICY IF EXISTS mcp_servers_delete ON mcp_servers;
CREATE POLICY mcp_servers_delete ON mcp_servers FOR DELETE USING (app_has_role(organisation_id, 'owner', 'hr'));
GRANT SELECT, INSERT, UPDATE, DELETE ON mcp_servers TO boardroom_app;
REVOKE TRUNCATE ON mcp_servers FROM boardroom_app;

-- 2. Keys: Boredroom's server contexts only (like connector_tokens) ------------------------------------------------------
CREATE TABLE IF NOT EXISTS mcp_server_secrets (
  server_id        uuid PRIMARY KEY,
  organisation_id  uuid NOT NULL,
  secret           text NOT NULL CONSTRAINT mcp_server_secrets_secret_check CHECK (secret ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'),
  hint             text CONSTRAINT mcp_server_secrets_hint_check CHECK (hint IS NULL OR hint ~ '^[A-Za-z0-9_.-]{1,4}$'),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (server_id, organisation_id) REFERENCES mcp_servers(id, organisation_id) ON DELETE CASCADE
);
DROP TRIGGER IF EXISTS mcp_server_secrets_updated ON mcp_server_secrets;
CREATE TRIGGER mcp_server_secrets_updated BEFORE UPDATE ON mcp_server_secrets FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE mcp_server_secrets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mcp_server_secrets_server ON mcp_server_secrets;
CREATE POLICY mcp_server_secrets_server ON mcp_server_secrets FOR ALL USING (app_is_worker()) WITH CHECK (app_is_worker());
GRANT SELECT, INSERT, UPDATE, DELETE ON mcp_server_secrets TO boardroom_app;
REVOKE TRUNCATE ON mcp_server_secrets FROM boardroom_app;

-- 3. Tools -------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mcp_tools (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id        uuid NOT NULL,
  organisation_id  uuid NOT NULL,
  name             text NOT NULL CONSTRAINT mcp_tools_name_check CHECK (name ~ '^[A-Za-z0-9_./-]{1,128}$'),
  title            text CONSTRAINT mcp_tools_title_check CHECK (title IS NULL OR char_length(title) <= 200),
  description      text NOT NULL DEFAULT '' CONSTRAINT mcp_tools_description_check CHECK (char_length(description) <= 4000),
  input_schema     jsonb NOT NULL DEFAULT '{"type":"object"}'::jsonb
                     CONSTRAINT mcp_tools_schema_check CHECK (jsonb_typeof(input_schema) = 'object' AND pg_column_size(input_schema) <= 32768),
  read_only_hint   boolean,
  destructive_hint boolean,
  hash             text NOT NULL CONSTRAINT mcp_tools_hash_check CHECK (hash ~ '^[0-9a-f]{64}$'),
  access           text NOT NULL DEFAULT 'off' CONSTRAINT mcp_tools_access_check CHECK (access IN ('off', 'read', 'act')),
  approved_hash    text CONSTRAINT mcp_tools_approved_check CHECK (approved_hash IS NULL OR approved_hash ~ '^[0-9a-f]{64}$'),
  gone_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (server_id, organisation_id) REFERENCES mcp_servers(id, organisation_id) ON DELETE CASCADE,
  CONSTRAINT mcp_tools_approved_access CHECK (access = 'off' OR approved_hash IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS mcp_tools_name_idx ON mcp_tools(server_id, name);
CREATE INDEX IF NOT EXISTS mcp_tools_org_idx ON mcp_tools(organisation_id) WHERE access <> 'off';
DROP TRIGGER IF EXISTS mcp_tools_updated ON mcp_tools;
CREATE TRIGGER mcp_tools_updated BEFORE UPDATE ON mcp_tools FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- An admin changes only access and approved_hash, and approves only the hash the row holds now; the worker writes what the
-- server listed. At most 200 tools a server.
CREATE OR REPLACE FUNCTION mcp_tools_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM pg_advisory_xact_lock(hashtext('mcp_tools:' || NEW.server_id::text));
    IF (SELECT count(*) FROM mcp_tools WHERE server_id = NEW.server_id) >= 200 THEN
      RAISE EXCEPTION 'MCP_TOOLS_FULL: at most 200 tools a server' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.server_id <> OLD.server_id OR NEW.organisation_id <> OLD.organisation_id OR NEW.name <> OLD.name THEN
    RAISE EXCEPTION 'MCP_TOOL_OWNER: a tool stays its server''s' USING ERRCODE = 'check_violation';
  END IF;
  IF app_is_worker() THEN RETURN NEW; END IF;
  IF NEW.title IS DISTINCT FROM OLD.title OR NEW.description <> OLD.description OR NEW.input_schema <> OLD.input_schema
     OR NEW.read_only_hint IS DISTINCT FROM OLD.read_only_hint OR NEW.destructive_hint IS DISTINCT FROM OLD.destructive_hint
     OR NEW.hash <> OLD.hash OR NEW.gone_at IS DISTINCT FROM OLD.gone_at THEN
    RAISE EXCEPTION 'MCP_TOOL_LISTED: only the server''s listing changes a tool' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.approved_hash IS NOT NULL AND NEW.approved_hash <> NEW.hash THEN
    RAISE EXCEPTION 'MCP_TOOL_STALE: approve the tool as it is now' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS mcp_tools_guard ON mcp_tools;
CREATE TRIGGER mcp_tools_guard BEFORE INSERT OR UPDATE ON mcp_tools FOR EACH ROW EXECUTE FUNCTION mcp_tools_guard();

ALTER TABLE mcp_tools ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mcp_tools_select ON mcp_tools;
CREATE POLICY mcp_tools_select ON mcp_tools FOR SELECT USING (app_is_member(organisation_id));
DROP POLICY IF EXISTS mcp_tools_insert ON mcp_tools;
CREATE POLICY mcp_tools_insert ON mcp_tools FOR INSERT WITH CHECK (app_is_worker());
DROP POLICY IF EXISTS mcp_tools_update ON mcp_tools;
CREATE POLICY mcp_tools_update ON mcp_tools FOR UPDATE
  USING (app_has_role(organisation_id, 'owner', 'hr')) WITH CHECK (app_has_role(organisation_id, 'owner', 'hr'));
DROP POLICY IF EXISTS mcp_tools_delete ON mcp_tools;
CREATE POLICY mcp_tools_delete ON mcp_tools FOR DELETE USING (app_is_worker());
GRANT SELECT, INSERT, UPDATE, DELETE ON mcp_tools TO boardroom_app;
REVOKE TRUNCATE ON mcp_tools FROM boardroom_app;

-- 4. Skills ------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS brenda_skills (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  slug             text NOT NULL CONSTRAINT brenda_skills_slug_check CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,47}$'),
  builtin          boolean NOT NULL DEFAULT false,
  name             text CONSTRAINT brenda_skills_name_check
                     CHECK (name IS NULL OR (char_length(name) BETWEEN 1 AND 60 AND name = btrim(name) AND name !~ '[\x01-\x1f\x7f]')),
  use_when         text CONSTRAINT brenda_skills_use_when_check
                     CHECK (use_when IS NULL OR (char_length(use_when) BETWEEN 1 AND 200 AND use_when !~ '[\x01-\x1f\x7f]')),
  body             text CONSTRAINT brenda_skills_body_check
                     CHECK (body IS NULL OR (char_length(body) BETWEEN 1 AND 50000 AND body !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]')),
  files            jsonb NOT NULL DEFAULT '[]'::jsonb CONSTRAINT brenda_skills_files_check
                     CHECK (jsonb_typeof(files) = 'array' AND jsonb_array_length(files) <= 5 AND pg_column_size(files) <= 225000),
  enabled          boolean NOT NULL DEFAULT true,
  added_by         uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (added_by, organisation_id) REFERENCES memberships(id, organisation_id),
  -- A built-in's row only records that the workspace turned it off; its words live in code.
  CONSTRAINT brenda_skills_kind_check CHECK (
    (builtin AND name IS NULL AND use_when IS NULL AND body IS NULL AND files = '[]'::jsonb AND NOT enabled)
    OR (NOT builtin AND name IS NOT NULL AND use_when IS NOT NULL AND body IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS brenda_skills_slug_idx ON brenda_skills(organisation_id, slug);
DROP TRIGGER IF EXISTS brenda_skills_updated ON brenda_skills;
CREATE TRIGGER brenda_skills_updated BEFORE UPDATE ON brenda_skills FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- At most 30 of a workspace's own skills; a skill stays its workspace's, and built-in or not.
CREATE OR REPLACE FUNCTION brenda_skills_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.organisation_id <> OLD.organisation_id OR NEW.builtin <> OLD.builtin OR NEW.slug <> OLD.slug THEN
      RAISE EXCEPTION 'SKILL_OWNER: a skill stays what it is' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT NEW.builtin THEN
    PERFORM pg_advisory_xact_lock(hashtext('brenda_skills:' || NEW.organisation_id::text));
    IF (SELECT count(*) FROM brenda_skills WHERE organisation_id = NEW.organisation_id AND NOT builtin) >= 30 THEN
      RAISE EXCEPTION 'SKILLS_FULL: at most 30 skills' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS brenda_skills_guard ON brenda_skills;
CREATE TRIGGER brenda_skills_guard BEFORE INSERT OR UPDATE ON brenda_skills FOR EACH ROW EXECUTE FUNCTION brenda_skills_guard();

ALTER TABLE brenda_skills ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS brenda_skills_select ON brenda_skills;
CREATE POLICY brenda_skills_select ON brenda_skills FOR SELECT USING (app_is_member(organisation_id));
DROP POLICY IF EXISTS brenda_skills_insert ON brenda_skills;
CREATE POLICY brenda_skills_insert ON brenda_skills FOR INSERT WITH CHECK (
  app_has_role(organisation_id, 'owner', 'hr') AND (app_is_worker() OR added_by = app_membership_id(organisation_id)));
DROP POLICY IF EXISTS brenda_skills_update ON brenda_skills;
CREATE POLICY brenda_skills_update ON brenda_skills FOR UPDATE
  USING (app_has_role(organisation_id, 'owner', 'hr')) WITH CHECK (app_has_role(organisation_id, 'owner', 'hr'));
DROP POLICY IF EXISTS brenda_skills_delete ON brenda_skills;
CREATE POLICY brenda_skills_delete ON brenda_skills FOR DELETE USING (app_has_role(organisation_id, 'owner', 'hr'));
GRANT SELECT, INSERT, UPDATE, DELETE ON brenda_skills TO boardroom_app;
REVOKE TRUNCATE ON brenda_skills FROM boardroom_app;
