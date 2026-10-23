-- Connected apps (owner decisions, 22 October 2026: connectors). Workspace connections (owners and HR, for everyone) and
-- personal connections (each person, private to them: RLS person-only, owners and HR never see them or whether they
-- exist). Tokens encrypted (AES-256-GCM, bound to their row) in a table only Boredroom's server reads. Synced items,
-- sources, channel choices, links to Boredroom tasks, and audit rows without content.
-- Additive and idempotent. Requires 0060. Waits in db/pending until the owner's go-ahead (server/lib/schema-0061).

DO $$
BEGIN
  IF to_regclass('public.mac_requests') IS NULL THEN
    RAISE EXCEPTION 'MIGRATION_ORDER: apply 0060_helpers.sql before 0061_connectors.sql.';
  END IF;
END $$;

-- The providers, once, for every CHECK below.
CREATE OR REPLACE FUNCTION app_connector_provider_ok(p text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p IN ('google_calendar', 'outlook_calendar', 'slack', 'teams', 'notion', 'linear', 'jira', 'github', 'asana', 'fake')
$$;

-- 1. Connections -------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS connector_connections (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id     uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  provider            text NOT NULL CONSTRAINT connector_connections_provider_check CHECK (app_connector_provider_ok(provider)),
  kind                text NOT NULL CONSTRAINT connector_connections_kind_check CHECK (kind IN ('workspace', 'personal')),
  membership_id       uuid,                 -- personal: the person; workspace: NULL
  connected_by        uuid NOT NULL,        -- who ran the connect (personal: the same person)
  status              text NOT NULL DEFAULT 'active'
                        CONSTRAINT connector_connections_status_check CHECK (status IN ('active', 'needs_reauth', 'paused', 'disconnecting')),
  external_account_id text NOT NULL CONSTRAINT connector_connections_account_check CHECK (char_length(external_account_id) BETWEEN 1 AND 200),
  external_tenant_id  text CONSTRAINT connector_connections_tenant_check CHECK (external_tenant_id IS NULL OR char_length(external_tenant_id) BETWEEN 1 AND 200),
  account_label       text CONSTRAINT connector_connections_label_check CHECK (account_label IS NULL OR char_length(account_label) <= 200),
  scopes              text[] NOT NULL DEFAULT '{}'::text[],
  can_read            boolean NOT NULL DEFAULT true,
  can_act             boolean NOT NULL DEFAULT false,
  settings            jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_sync_at        timestamptz,
  last_ok_at          timestamptz,
  last_error_code     text CONSTRAINT connector_connections_error_check CHECK (last_error_code IS NULL OR last_error_code ~ '^[A-Z_]{2,40}$'),
  last_error_at       timestamptz,
  error_count         integer NOT NULL DEFAULT 0 CONSTRAINT connector_connections_error_count_check CHECK (error_count >= 0),
  backoff_until       timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (membership_id, organisation_id) REFERENCES memberships(id, organisation_id),
  FOREIGN KEY (connected_by, organisation_id) REFERENCES memberships(id, organisation_id),
  CONSTRAINT connector_connections_settings_check CHECK (jsonb_typeof(settings) = 'object' AND pg_column_size(settings) <= 16384),
  CONSTRAINT connector_connections_owner_check CHECK (
    (kind = 'personal') = (membership_id IS NOT NULL) AND (kind <> 'personal' OR membership_id = connected_by)),
  -- Calendars are personal only; Slack and Teams workspace only (v1).
  CONSTRAINT connector_connections_kind_allowed CHECK (
    (provider NOT IN ('google_calendar', 'outlook_calendar') OR kind = 'personal')
    AND (provider NOT IN ('slack', 'teams') OR kind = 'workspace'))
);
CREATE UNIQUE INDEX IF NOT EXISTS connector_connections_personal_one
  ON connector_connections(membership_id, provider, external_account_id) WHERE kind = 'personal' AND status <> 'disconnecting';
CREATE UNIQUE INDEX IF NOT EXISTS connector_connections_workspace_one
  ON connector_connections(organisation_id, provider, COALESCE(external_tenant_id, external_account_id)) WHERE kind = 'workspace' AND status <> 'disconnecting';
CREATE INDEX IF NOT EXISTS connector_connections_org_idx ON connector_connections(organisation_id, provider);
DROP TRIGGER IF EXISTS connector_connections_updated ON connector_connections;
CREATE TRIGGER connector_connections_updated BEFORE UPDATE ON connector_connections FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE connector_connections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS connector_connections_select ON connector_connections;
CREATE POLICY connector_connections_select ON connector_connections FOR SELECT USING (
  app_is_worker()
  OR (kind = 'personal' AND membership_id = app_membership_id(organisation_id))
  OR (kind = 'workspace' AND app_is_member(organisation_id)));
DROP POLICY IF EXISTS connector_connections_insert ON connector_connections;
CREATE POLICY connector_connections_insert ON connector_connections FOR INSERT WITH CHECK (
  app_is_worker()
  OR (kind = 'personal' AND membership_id = app_membership_id(organisation_id))
  OR (kind = 'workspace' AND app_has_role(organisation_id, 'owner', 'hr') AND connected_by = app_membership_id(organisation_id)));
DROP POLICY IF EXISTS connector_connections_update ON connector_connections;
CREATE POLICY connector_connections_update ON connector_connections FOR UPDATE
  USING (app_is_worker() OR (kind = 'personal' AND membership_id = app_membership_id(organisation_id))
         OR (kind = 'workspace' AND app_has_role(organisation_id, 'owner', 'hr')))
  WITH CHECK (app_is_worker() OR (kind = 'personal' AND membership_id = app_membership_id(organisation_id))
         OR (kind = 'workspace' AND app_has_role(organisation_id, 'owner', 'hr')));
DROP POLICY IF EXISTS connector_connections_delete ON connector_connections;
CREATE POLICY connector_connections_delete ON connector_connections FOR DELETE USING (app_is_worker());
GRANT SELECT, INSERT, UPDATE, DELETE ON connector_connections TO boardroom_app;
REVOKE TRUNCATE ON connector_connections FROM boardroom_app;
-- The web and the worker share one database role, so column grants can't tell them apart: outside Boredroom's server
-- contexts a person (or an owner, for the workspace's) may change only what the screens change.
CREATE OR REPLACE FUNCTION connector_connections_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF app_is_worker() THEN RETURN NEW; END IF;
  IF (NEW.id, NEW.organisation_id, NEW.provider, NEW.kind, NEW.membership_id, NEW.connected_by, NEW.status, NEW.external_account_id,
      NEW.external_tenant_id, NEW.account_label, NEW.scopes, NEW.last_sync_at, NEW.last_ok_at, NEW.last_error_code, NEW.error_count, NEW.backoff_until)
     IS DISTINCT FROM
     (OLD.id, OLD.organisation_id, OLD.provider, OLD.kind, OLD.membership_id, OLD.connected_by, OLD.status, OLD.external_account_id,
      OLD.external_tenant_id, OLD.account_label, OLD.scopes, OLD.last_sync_at, OLD.last_ok_at, OLD.last_error_code, OLD.error_count, OLD.backoff_until) THEN
    RAISE EXCEPTION 'CONNECTION_FIELDS: only can_read, can_act and settings change here' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS connector_connections_guard ON connector_connections;
CREATE TRIGGER connector_connections_guard BEFORE UPDATE ON connector_connections FOR EACH ROW EXECUTE FUNCTION connector_connections_guard();

-- 2. Tokens: Boredroom's server only (system and worker contexts), never a person's own context ------------------------
CREATE TABLE IF NOT EXISTS connector_tokens (
  connection_id       uuid PRIMARY KEY REFERENCES connector_connections(id) ON DELETE CASCADE,
  organisation_id     uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  access_enc          text NOT NULL,
  refresh_enc         text,
  extra_enc           text,                 -- provider extras (GitHub: the installation's verifying user token)
  token_type          text NOT NULL DEFAULT 'bearer' CONSTRAINT connector_tokens_type_check CHECK (token_type ~ '^[a-z_]{2,20}$'),
  expires_at          timestamptz,
  refresh_expires_at  timestamptz,
  key_version         smallint NOT NULL DEFAULT 1,
  refreshed_at        timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE connector_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS connector_tokens_server ON connector_tokens;
CREATE POLICY connector_tokens_server ON connector_tokens FOR ALL USING (app_is_worker()) WITH CHECK (app_is_worker());
GRANT SELECT, INSERT, UPDATE, DELETE ON connector_tokens TO boardroom_app;
REVOKE TRUNCATE ON connector_tokens FROM boardroom_app;

-- 3. OAuth state: single use, 10 minutes, matched by its hash ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS connector_oauth_states (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_hash       text NOT NULL UNIQUE CONSTRAINT connector_oauth_states_hash_check CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  organisation_id  uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  membership_id    uuid NOT NULL,
  user_id          uuid NOT NULL REFERENCES profiles(id),
  provider         text NOT NULL CONSTRAINT connector_oauth_states_provider_check CHECK (app_connector_provider_ok(provider)),
  kind             text NOT NULL CONSTRAINT connector_oauth_states_kind_check CHECK (kind IN ('workspace', 'personal')),
  purpose          text NOT NULL DEFAULT 'connect' CONSTRAINT connector_oauth_states_purpose_check
                     CHECK (purpose IN ('connect', 'reconnect', 'upgrade', 'install', 'admin_consent')),
  connection_id    uuid REFERENCES connector_connections(id) ON DELETE CASCADE,
  verifier_enc     text,
  nonce            text NOT NULL CONSTRAINT connector_oauth_states_nonce_check CHECK (nonce ~ '^[A-Za-z0-9_-]{16,128}$'),
  want_act         boolean NOT NULL DEFAULT false,
  scopes           text[] NOT NULL DEFAULT '{}'::text[],
  return_to        text CONSTRAINT connector_oauth_states_return_check CHECK (return_to IS NULL OR (char_length(return_to) <= 300 AND return_to LIKE '/app/%')),
  pending          jsonb NOT NULL DEFAULT '{}'::jsonb CONSTRAINT connector_oauth_states_pending_check CHECK (jsonb_typeof(pending) = 'object'),
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  used_at          timestamptz,
  FOREIGN KEY (membership_id, organisation_id) REFERENCES memberships(id, organisation_id)
);
CREATE INDEX IF NOT EXISTS connector_oauth_states_expiry_idx ON connector_oauth_states(expires_at);
ALTER TABLE connector_oauth_states ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS connector_oauth_states_server ON connector_oauth_states;
CREATE POLICY connector_oauth_states_server ON connector_oauth_states FOR ALL USING (app_is_worker()) WITH CHECK (app_is_worker());
GRANT SELECT, INSERT, UPDATE, DELETE ON connector_oauth_states TO boardroom_app;

-- Who may see a workspace item or source: everyone in the workspace, or one team (and owners and HR). A team that no
-- longer exists leaves only owners and HR (fail closed).
CREATE OR REPLACE FUNCTION app_connector_audience(org uuid, team uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_is_worker() OR (app_is_member(org) AND (
    team IS NULL OR app_has_role(org, 'owner', 'hr')
    OR EXISTS (SELECT 1 FROM team_members tm WHERE tm.team_id = team AND tm.membership_id = app_membership_id(org))))
$$;

-- 4. Sources: channels, teams, projects, repositories, calendars, page roots ---------------------------------------------
CREATE TABLE IF NOT EXISTS connector_sources (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  connection_id     uuid NOT NULL REFERENCES connector_connections(id) ON DELETE CASCADE,
  visibility        text NOT NULL CONSTRAINT connector_sources_visibility_check CHECK (visibility IN ('workspace', 'personal')),
  membership_id     uuid,
  kind              text NOT NULL CONSTRAINT connector_sources_kind_check CHECK (kind IN ('channel', 'team', 'project', 'repo', 'calendar', 'page')),
  external_id       text NOT NULL CONSTRAINT connector_sources_external_check CHECK (char_length(external_id) BETWEEN 1 AND 300),
  label             text NOT NULL CONSTRAINT connector_sources_label_check CHECK (char_length(label) BETWEEN 1 AND 200),
  selected          boolean NOT NULL DEFAULT false,
  audience_team_id  uuid,                 -- workspace only: NULL = everyone in the workspace
  members           integer CONSTRAINT connector_sources_members_check CHECK (members IS NULL OR members >= 0),
  is_private        boolean,
  archived          boolean NOT NULL DEFAULT false,
  seen_at           timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, kind, external_id),
  FOREIGN KEY (membership_id, organisation_id) REFERENCES memberships(id, organisation_id),
  CONSTRAINT connector_sources_visibility_owner CHECK ((visibility = 'personal') = (membership_id IS NOT NULL)),
  CONSTRAINT connector_sources_audience_check CHECK (audience_team_id IS NULL OR visibility = 'workspace')
);
DROP TRIGGER IF EXISTS connector_sources_updated ON connector_sources;
CREATE TRIGGER connector_sources_updated BEFORE UPDATE ON connector_sources FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE connector_sources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS connector_sources_select ON connector_sources;
-- Security fix, 22 October 2026: a workspace source is seen by owners and HR (who choose them), and otherwise only when it
-- is selected and its audience includes the reader: unselected sources (private channel names, say) and other teams'
-- sources stay out of everyone else's sight.
CREATE POLICY connector_sources_select ON connector_sources FOR SELECT USING (
  app_is_worker()
  OR (visibility = 'personal' AND membership_id = app_membership_id(organisation_id))
  OR (visibility = 'workspace' AND (app_has_role(organisation_id, 'owner', 'hr')
      OR (selected AND app_connector_audience(organisation_id, audience_team_id)))));
DROP POLICY IF EXISTS connector_sources_update ON connector_sources;
-- People choose their own sources; owners and HR choose the workspace's (selected, audience). Rows are written by the worker.
CREATE POLICY connector_sources_update ON connector_sources FOR UPDATE
  USING (app_is_worker() OR (visibility = 'personal' AND membership_id = app_membership_id(organisation_id))
         OR (visibility = 'workspace' AND app_has_role(organisation_id, 'owner', 'hr')))
  WITH CHECK (app_is_worker() OR (visibility = 'personal' AND membership_id = app_membership_id(organisation_id))
         OR (visibility = 'workspace' AND app_has_role(organisation_id, 'owner', 'hr')));
DROP POLICY IF EXISTS connector_sources_write ON connector_sources;
CREATE POLICY connector_sources_write ON connector_sources FOR INSERT WITH CHECK (app_is_worker());
DROP POLICY IF EXISTS connector_sources_delete ON connector_sources;
CREATE POLICY connector_sources_delete ON connector_sources FOR DELETE USING (app_is_worker());
GRANT SELECT, INSERT, UPDATE, DELETE ON connector_sources TO boardroom_app;
-- Outside the server's contexts only `selected` and `audience_team_id` change, and an audience is a team of this workspace.
CREATE OR REPLACE FUNCTION connector_sources_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF app_is_worker() THEN RETURN NEW; END IF;
  IF (NEW.id, NEW.organisation_id, NEW.connection_id, NEW.visibility, NEW.membership_id, NEW.kind, NEW.external_id, NEW.label,
      NEW.members, NEW.is_private, NEW.archived)
     IS DISTINCT FROM
     (OLD.id, OLD.organisation_id, OLD.connection_id, OLD.visibility, OLD.membership_id, OLD.kind, OLD.external_id, OLD.label,
      OLD.members, OLD.is_private, OLD.archived) THEN
    RAISE EXCEPTION 'SOURCE_FIELDS: only selected and audience change here' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.audience_team_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM teams t WHERE t.id = NEW.audience_team_id AND t.organisation_id = NEW.organisation_id) THEN
    RAISE EXCEPTION 'SOURCE_AUDIENCE: that team is not in this workspace' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS connector_sources_guard ON connector_sources;
CREATE TRIGGER connector_sources_guard BEFORE UPDATE ON connector_sources FOR EACH ROW EXECUTE FUNCTION connector_sources_guard();

-- 5. Items: events, issues (and pull requests, tasks), pages ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS connector_items (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id       uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  connection_id         uuid NOT NULL REFERENCES connector_connections(id) ON DELETE CASCADE,
  source_id             uuid REFERENCES connector_sources(id) ON DELETE CASCADE,
  visibility            text NOT NULL CONSTRAINT connector_items_visibility_check CHECK (visibility IN ('workspace', 'personal')),
  membership_id         uuid,
  audience_team_id      uuid,
  provider              text NOT NULL CONSTRAINT connector_items_provider_check CHECK (app_connector_provider_ok(provider)),
  kind                  text NOT NULL CONSTRAINT connector_items_kind_check CHECK (kind IN ('event', 'issue', 'page')),
  subtype               text CONSTRAINT connector_items_subtype_check CHECK (subtype IS NULL OR subtype IN ('issue', 'pull_request', 'task', 'page', 'row')),
  external_id           text NOT NULL CONSTRAINT connector_items_external_check CHECK (char_length(external_id) BETWEEN 1 AND 300),
  external_key          text CONSTRAINT connector_items_key_check CHECK (external_key IS NULL OR char_length(external_key) <= 60),
  url                   text CONSTRAINT connector_items_url_check CHECK (url IS NULL OR (char_length(url) <= 1000 AND url ~ '^https://')),
  title                 text NOT NULL CONSTRAINT connector_items_title_check CHECK (char_length(title) BETWEEN 1 AND 500),
  state                 text CONSTRAINT connector_items_state_check CHECK (state IS NULL OR state IN ('open', 'in_progress', 'done', 'cancelled')),
  state_label           text CONSTRAINT connector_items_state_label_check CHECK (state_label IS NULL OR char_length(state_label) <= 80),
  priority              smallint CONSTRAINT connector_items_priority_check CHECK (priority IS NULL OR priority BETWEEN 0 AND 4),
  container_label       text CONSTRAINT connector_items_container_check CHECK (container_label IS NULL OR char_length(container_label) <= 200),
  assignee_external_id  text CONSTRAINT connector_items_assignee_check CHECK (assignee_external_id IS NULL OR char_length(assignee_external_id) <= 200),
  assignee_label        text CONSTRAINT connector_items_assignee_label_check CHECK (assignee_label IS NULL OR char_length(assignee_label) <= 200),
  assignee_digest       text CONSTRAINT connector_items_digest_check CHECK (assignee_digest IS NULL OR assignee_digest ~ '^[0-9a-f]{64}$'),
  mine                  boolean NOT NULL DEFAULT false,   -- personal: assigned to (or organised by) the connected account
  due_on                date,
  due_at                timestamptz,
  starts_at             timestamptz,
  ends_at               timestamptz,
  all_day               boolean,
  busy                  boolean,
  response              text CONSTRAINT connector_items_response_check CHECK (response IS NULL OR response IN ('accepted', 'tentative', 'declined', 'needs_action', 'organiser')),
  online                boolean,
  guests                smallint CONSTRAINT connector_items_guests_check CHECK (guests IS NULL OR guests >= 0),
  excerpt               text CONSTRAINT connector_items_excerpt_check CHECK (excerpt IS NULL OR char_length(excerpt) <= 20000),
  search                tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(external_key, '') || ' ' || title || ' ' || coalesce(excerpt, ''))) STORED,
  provider_updated_at   timestamptz,
  synced_at             timestamptz NOT NULL DEFAULT now(),
  gone_at               timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, kind, external_id),
  FOREIGN KEY (membership_id, organisation_id) REFERENCES memberships(id, organisation_id),
  CONSTRAINT connector_items_visibility_owner CHECK ((visibility = 'personal') = (membership_id IS NOT NULL)),
  CONSTRAINT connector_items_audience_check CHECK (audience_team_id IS NULL OR visibility = 'workspace'),
  CONSTRAINT connector_items_events_personal CHECK (kind <> 'event' OR visibility = 'personal'),
  CONSTRAINT connector_items_event_times CHECK (kind <> 'event' OR (starts_at IS NOT NULL AND ends_at IS NOT NULL AND ends_at >= starts_at))
);
CREATE INDEX IF NOT EXISTS connector_items_person_events_idx ON connector_items(membership_id, starts_at) WHERE kind = 'event' AND gone_at IS NULL;
CREATE INDEX IF NOT EXISTS connector_items_person_issues_idx ON connector_items(membership_id, state) WHERE kind = 'issue' AND gone_at IS NULL;
CREATE INDEX IF NOT EXISTS connector_items_assignee_idx ON connector_items(organisation_id, provider, assignee_external_id) WHERE visibility = 'workspace' AND gone_at IS NULL;
CREATE INDEX IF NOT EXISTS connector_items_digest_idx ON connector_items(organisation_id, assignee_digest) WHERE assignee_digest IS NOT NULL AND gone_at IS NULL;
CREATE INDEX IF NOT EXISTS connector_items_search_idx ON connector_items USING gin(search);
CREATE INDEX IF NOT EXISTS connector_items_gone_idx ON connector_items(gone_at) WHERE gone_at IS NOT NULL;
DROP TRIGGER IF EXISTS connector_items_updated ON connector_items;
CREATE TRIGGER connector_items_updated BEFORE UPDATE ON connector_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE connector_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS connector_items_select ON connector_items;
CREATE POLICY connector_items_select ON connector_items FOR SELECT USING (
  app_is_worker()
  OR (visibility = 'personal' AND membership_id = app_membership_id(organisation_id))
  OR (visibility = 'workspace' AND app_connector_audience(organisation_id, audience_team_id)));
DROP POLICY IF EXISTS connector_items_write ON connector_items;
CREATE POLICY connector_items_write ON connector_items FOR ALL USING (app_is_worker()) WITH CHECK (app_is_worker());
GRANT SELECT, INSERT, UPDATE, DELETE ON connector_items TO boardroom_app;
REVOKE TRUNCATE ON connector_items FROM boardroom_app;
-- (Postgres combines permissive policies with OR: SELECT is the select policy OR the write policy, both safe.)

-- 6. What a person hid from their own My Day -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS connector_item_hides (
  membership_id    uuid NOT NULL,
  organisation_id  uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  item_id          uuid NOT NULL REFERENCES connector_items(id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (membership_id, item_id),
  FOREIGN KEY (membership_id, organisation_id) REFERENCES memberships(id, organisation_id)
);
ALTER TABLE connector_item_hides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS connector_item_hides_own ON connector_item_hides;
CREATE POLICY connector_item_hides_own ON connector_item_hides FOR ALL
  USING (app_is_worker() OR membership_id = app_membership_id(organisation_id))
  WITH CHECK (app_is_worker() OR membership_id = app_membership_id(organisation_id));
GRANT SELECT, INSERT, DELETE ON connector_item_hides TO boardroom_app;

-- 7. Links between an item and a Boredroom task (timers run on the task) -------------------------------------------------
CREATE TABLE IF NOT EXISTS connector_task_links (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  item_id          uuid NOT NULL REFERENCES connector_items(id) ON DELETE CASCADE,
  task_id          uuid NOT NULL,
  membership_id    uuid NOT NULL,          -- who linked it (the task's assignee)
  visibility       text NOT NULL CONSTRAINT connector_task_links_visibility_check CHECK (visibility IN ('workspace', 'personal')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, task_id),
  FOREIGN KEY (task_id, organisation_id) REFERENCES tasks(id, organisation_id) ON DELETE CASCADE,
  FOREIGN KEY (membership_id, organisation_id) REFERENCES memberships(id, organisation_id)
);
CREATE INDEX IF NOT EXISTS connector_task_links_task_idx ON connector_task_links(task_id);
ALTER TABLE connector_task_links ENABLE ROW LEVEL SECURITY;
-- A personal link is its person's alone. A workspace link is seen by whoever may see both the task and the item (the
-- subqueries run under the reader's own row security).
DROP POLICY IF EXISTS connector_task_links_select ON connector_task_links;
CREATE POLICY connector_task_links_select ON connector_task_links FOR SELECT USING (
  app_is_worker() OR membership_id = app_membership_id(organisation_id)
  OR (visibility = 'workspace' AND EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_id)
      AND EXISTS (SELECT 1 FROM connector_items i WHERE i.id = item_id)));
DROP POLICY IF EXISTS connector_task_links_insert ON connector_task_links;
CREATE POLICY connector_task_links_insert ON connector_task_links FOR INSERT WITH CHECK (app_is_worker() OR membership_id = app_membership_id(organisation_id));
DROP POLICY IF EXISTS connector_task_links_delete ON connector_task_links;
CREATE POLICY connector_task_links_delete ON connector_task_links FOR DELETE USING (app_is_worker() OR membership_id = app_membership_id(organisation_id));
GRANT SELECT, INSERT, DELETE ON connector_task_links TO boardroom_app;
-- The link must be honest: the item visible to its maker with the same visibility (a personal item: theirs), the task
-- theirs (assignee). Read under the caller's row security, so nothing they can't see can be linked.
CREATE OR REPLACE FUNCTION connector_task_links_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF app_is_worker() THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM connector_items i WHERE i.id = NEW.item_id AND i.organisation_id = NEW.organisation_id
                   AND i.visibility = NEW.visibility AND (i.visibility = 'workspace' OR i.membership_id = NEW.membership_id)) THEN
    RAISE EXCEPTION 'LINK_ITEM: that item is not yours to link' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id = NEW.task_id AND t.organisation_id = NEW.organisation_id
                   AND t.assignee_membership_id = NEW.membership_id AND t.archived_at IS NULL) THEN
    RAISE EXCEPTION 'LINK_TASK: only your own open tasks can be linked' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS connector_task_links_check ON connector_task_links;
CREATE TRIGGER connector_task_links_check BEFORE INSERT ON connector_task_links FOR EACH ROW EXECUTE FUNCTION connector_task_links_check();

-- 8. A person's own identity in an app (from their personal connection): matches workspace items "assigned to me" ------
CREATE TABLE IF NOT EXISTS connector_identities (
  membership_id      uuid NOT NULL,
  organisation_id    uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  provider           text NOT NULL CONSTRAINT connector_identities_provider_check CHECK (app_connector_provider_ok(provider)),
  external_user_id   text NOT NULL CONSTRAINT connector_identities_user_check CHECK (char_length(external_user_id) BETWEEN 1 AND 200),
  external_tenant_id text,
  connection_id      uuid NOT NULL REFERENCES connector_connections(id) ON DELETE CASCADE,
  created_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (membership_id, provider, external_user_id),
  FOREIGN KEY (membership_id, organisation_id) REFERENCES memberships(id, organisation_id)
);
ALTER TABLE connector_identities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS connector_identities_own ON connector_identities;
CREATE POLICY connector_identities_own ON connector_identities FOR ALL
  USING (app_is_worker() OR membership_id = app_membership_id(organisation_id))
  WITH CHECK (app_is_worker());
GRANT SELECT, INSERT, UPDATE, DELETE ON connector_identities TO boardroom_app;

-- 9. Sync cursors (the worker's) -------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS connector_sync_state (
  connection_id    uuid NOT NULL REFERENCES connector_connections(id) ON DELETE CASCADE,
  stream           text NOT NULL CONSTRAINT connector_sync_state_stream_check CHECK (stream ~ '^[a-z_]{2,30}$'),
  cursor           text CONSTRAINT connector_sync_state_cursor_check CHECK (cursor IS NULL OR char_length(cursor) <= 4000),
  full_resync      boolean NOT NULL DEFAULT true,
  next_run_at      timestamptz NOT NULL DEFAULT now(),
  last_run_at      timestamptz,
  last_ok_at       timestamptz,
  last_full_at     timestamptz,
  last_error_code  text,
  items_last_run   integer,
  PRIMARY KEY (connection_id, stream)
);
CREATE INDEX IF NOT EXISTS connector_sync_state_due_idx ON connector_sync_state(next_run_at);
ALTER TABLE connector_sync_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS connector_sync_state_server ON connector_sync_state;
CREATE POLICY connector_sync_state_server ON connector_sync_state FOR ALL USING (app_is_worker()) WITH CHECK (app_is_worker());
GRANT SELECT, INSERT, UPDATE, DELETE ON connector_sync_state TO boardroom_app;

-- 10. Where the workspace posts (channel choices) ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS connector_channel_routes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  source_id        uuid NOT NULL REFERENCES connector_sources(id) ON DELETE CASCADE,
  purpose          text NOT NULL CONSTRAINT connector_channel_routes_purpose_check CHECK (purpose IN ('daily_digest', 'standup', 'reminders')),
  team_id          uuid,                   -- NULL: the whole workspace (daily_digest only)
  enabled          boolean NOT NULL DEFAULT false,
  enabled_by       uuid,
  enabled_at       timestamptz,
  created_by       uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (team_id, organisation_id) REFERENCES teams(id, organisation_id) ON DELETE CASCADE,
  FOREIGN KEY (created_by, organisation_id) REFERENCES memberships(id, organisation_id),
  CONSTRAINT connector_channel_routes_team_check CHECK (purpose = 'daily_digest' OR team_id IS NOT NULL),
  CONSTRAINT connector_channel_routes_enabled_check CHECK (NOT enabled OR (enabled_by IS NOT NULL AND enabled_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS connector_channel_routes_one
  ON connector_channel_routes(organisation_id, purpose, COALESCE(team_id, '00000000-0000-0000-0000-000000000000'::uuid));
DROP TRIGGER IF EXISTS connector_channel_routes_updated ON connector_channel_routes;
CREATE TRIGGER connector_channel_routes_updated BEFORE UPDATE ON connector_channel_routes FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE connector_channel_routes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS connector_channel_routes_select ON connector_channel_routes;
CREATE POLICY connector_channel_routes_select ON connector_channel_routes FOR SELECT USING (app_is_member(organisation_id));
DROP POLICY IF EXISTS connector_channel_routes_write ON connector_channel_routes;
CREATE POLICY connector_channel_routes_write ON connector_channel_routes FOR ALL
  USING (app_has_role(organisation_id, 'owner', 'hr')) WITH CHECK (app_has_role(organisation_id, 'owner', 'hr'));
GRANT SELECT, INSERT, UPDATE, DELETE ON connector_channel_routes TO boardroom_app;
-- A route posts only to a selected channel of one of this workspace's own Slack or Teams connections.
CREATE OR REPLACE FUNCTION connector_channel_routes_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM connector_sources s JOIN connector_connections c ON c.id = s.connection_id
                 WHERE s.id = NEW.source_id AND s.organisation_id = NEW.organisation_id AND s.kind = 'channel'
                   AND s.visibility = 'workspace' AND s.selected AND c.kind = 'workspace' AND c.provider IN ('slack', 'teams', 'fake')) THEN
    RAISE EXCEPTION 'ROUTE_CHANNEL: choose one of the workspace''s selected channels' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS connector_channel_routes_check ON connector_channel_routes;
CREATE TRIGGER connector_channel_routes_check BEFORE INSERT OR UPDATE OF source_id, organisation_id ON connector_channel_routes
  FOR EACH ROW EXECUTE FUNCTION connector_channel_routes_check();

-- 11. The workspace's rules per app (owners and HR) -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS connector_policies (
  organisation_id   uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  provider          text NOT NULL CONSTRAINT connector_policies_provider_check CHECK (app_connector_provider_ok(provider)),
  personal_allowed  boolean NOT NULL DEFAULT true,
  brenda_reads      boolean NOT NULL DEFAULT true,
  brenda_acts       boolean NOT NULL DEFAULT true,
  updated_by        uuid,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organisation_id, provider)
);
ALTER TABLE connector_policies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS connector_policies_select ON connector_policies;
CREATE POLICY connector_policies_select ON connector_policies FOR SELECT USING (app_is_member(organisation_id));
DROP POLICY IF EXISTS connector_policies_write ON connector_policies;
CREATE POLICY connector_policies_write ON connector_policies FOR ALL
  USING (app_has_role(organisation_id, 'owner', 'hr')) WITH CHECK (app_has_role(organisation_id, 'owner', 'hr'));
GRANT SELECT, INSERT, UPDATE ON connector_policies TO boardroom_app;

-- 12. Audit without content: what happened to a connection, never what was in it ---------------------------------------------
CREATE TABLE IF NOT EXISTS connector_audit (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  connection_id    uuid,                   -- no foreign key: the row outlives the connection
  provider         text NOT NULL CONSTRAINT connector_audit_provider_check CHECK (app_connector_provider_ok(provider)),
  kind             text NOT NULL CONSTRAINT connector_audit_kind_check CHECK (kind IN ('workspace', 'personal')),
  membership_id    uuid NOT NULL,          -- the actor; for a personal connection always its person
  action           text NOT NULL CONSTRAINT connector_audit_action_check CHECK (action ~ '^[a-z_.]{3,60}$'),
  outcome          text NOT NULL CONSTRAINT connector_audit_outcome_check CHECK (outcome IN ('ok', 'refused', 'failed')),
  error_code       text CONSTRAINT connector_audit_error_check CHECK (error_code IS NULL OR error_code ~ '^[A-Z_]{2,40}$'),
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (membership_id, organisation_id) REFERENCES memberships(id, organisation_id)
);
CREATE INDEX IF NOT EXISTS connector_audit_org_idx ON connector_audit(organisation_id, created_at DESC);
ALTER TABLE connector_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS connector_audit_select ON connector_audit;
CREATE POLICY connector_audit_select ON connector_audit FOR SELECT USING (
  app_is_worker()
  OR (kind = 'personal' AND membership_id = app_membership_id(organisation_id))
  OR (kind = 'workspace' AND app_has_role(organisation_id, 'owner', 'hr')));
DROP POLICY IF EXISTS connector_audit_insert ON connector_audit;
CREATE POLICY connector_audit_insert ON connector_audit FOR INSERT WITH CHECK (app_is_worker());
GRANT SELECT, INSERT ON connector_audit TO boardroom_app;
REVOKE UPDATE, DELETE, TRUNCATE ON connector_audit FROM boardroom_app;
-- Retention (framework, 22 October 2026): the app role can't delete audit rows, so the worker's hourly purge keeps 400
-- days through this function, which deletes nothing younger.
CREATE OR REPLACE FUNCTION app_connector_audit_purge() RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH d AS (DELETE FROM connector_audit WHERE created_at < now() - interval '400 days' RETURNING 1) SELECT count(*)::int FROM d
$$;
REVOKE ALL ON FUNCTION app_connector_audit_purge() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_connector_audit_purge() TO boardroom_app;

-- 13. Webhooks registered at providers, and deliveries seen (deduplication) ----------------------------------------------------
CREATE TABLE IF NOT EXISTS connector_webhooks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id    uuid NOT NULL REFERENCES connector_connections(id) ON DELETE CASCADE,
  provider         text NOT NULL CONSTRAINT connector_webhooks_provider_check CHECK (app_connector_provider_ok(provider)),
  external_id      text,
  secret_enc       text,
  status           text NOT NULL DEFAULT 'pending' CONSTRAINT connector_webhooks_status_check CHECK (status IN ('pending', 'active', 'failed')),
  expires_at       timestamptz,
  last_event_at    timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS connector_webhooks_external_idx ON connector_webhooks(provider, external_id);
ALTER TABLE connector_webhooks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS connector_webhooks_server ON connector_webhooks;
CREATE POLICY connector_webhooks_server ON connector_webhooks FOR ALL USING (app_is_worker()) WITH CHECK (app_is_worker());
GRANT SELECT, INSERT, UPDATE, DELETE ON connector_webhooks TO boardroom_app;

CREATE TABLE IF NOT EXISTS connector_webhook_deliveries (
  provider     text NOT NULL,
  delivery_id  text NOT NULL CONSTRAINT connector_webhook_deliveries_id_check CHECK (char_length(delivery_id) BETWEEN 1 AND 200),
  received_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, delivery_id)
);
CREATE INDEX IF NOT EXISTS connector_webhook_deliveries_age_idx ON connector_webhook_deliveries(received_at);
ALTER TABLE connector_webhook_deliveries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS connector_webhook_deliveries_server ON connector_webhook_deliveries;
CREATE POLICY connector_webhook_deliveries_server ON connector_webhook_deliveries FOR ALL USING (app_is_worker()) WITH CHECK (app_is_worker());
GRANT SELECT, INSERT, DELETE ON connector_webhook_deliveries TO boardroom_app;

-- 14. Shared rate budgets (Jira's global points pool) --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS connector_rate_budget (
  bucket        text NOT NULL CONSTRAINT connector_rate_budget_bucket_check CHECK (bucket ~ '^[a-z0-9_:.-]{3,120}$'),
  window_start  timestamptz NOT NULL,
  used          integer NOT NULL DEFAULT 0,
  cap           integer NOT NULL,
  PRIMARY KEY (bucket, window_start)
);
ALTER TABLE connector_rate_budget ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS connector_rate_budget_server ON connector_rate_budget;
CREATE POLICY connector_rate_budget_server ON connector_rate_budget FOR ALL USING (app_is_worker()) WITH CHECK (app_is_worker());
GRANT SELECT, INSERT, UPDATE, DELETE ON connector_rate_budget TO boardroom_app;

-- 15. Brenda's log: 'private' rows (what she did in a person's own connected apps) are the person's alone, like 'read' -----
ALTER TABLE brenda_actions DROP CONSTRAINT IF EXISTS brenda_actions_source_check;
ALTER TABLE brenda_actions ADD CONSTRAINT brenda_actions_source_check CHECK (source IN ('chat', 'confirm', 'automatic', 'read', 'private'));
DROP POLICY IF EXISTS brenda_actions_select ON brenda_actions;
CREATE POLICY brenda_actions_select ON brenda_actions FOR SELECT
  USING (app_is_worker() OR membership_id = app_membership_id(organisation_id)
         OR (source NOT IN ('read', 'private') AND app_has_role(organisation_id, 'owner', 'hr')));

-- 16. The plan flag: on for every plan (owner decision 9), switchable in the Control Center.
UPDATE plans SET features = features || '{"CONNECTORS": true}'::jsonb WHERE NOT (features ? 'CONNECTORS');
