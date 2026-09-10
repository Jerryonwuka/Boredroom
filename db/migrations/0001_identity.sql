-- 0001 identity, tenancy, teams, invitations, schedules, policies
-- Conventions: UUID keys, timestamptz, organisation_id on every tenant table,
-- (id, organisation_id) unique keys so child tables can carry composite FKs that
-- make cross-tenant links impossible even for privileged server code.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------------------
-- Local auth adapter tables (replaced by Supabase Auth when AUTH_PROVIDER=supabase;
-- profiles.auth_user_id then stores the Supabase auth.users id).
-- ---------------------------------------------------------------------------
CREATE TABLE auth_users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         citext NOT NULL UNIQUE,
  password_hash text NOT NULL,
  email_verified_at timestamptz,
  mfa_required  boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE auth_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('verify_email','recover_password')),
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_tokens_user_idx ON auth_tokens(user_id, kind);

CREATE TABLE auth_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  user_agent   text
);
CREATE INDEX auth_sessions_user_idx ON auth_sessions(user_id) WHERE revoked_at IS NULL;

CREATE TABLE auth_rate_limits (
  bucket      text NOT NULL,
  window_start timestamptz NOT NULL,
  hits        integer NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);

-- ---------------------------------------------------------------------------
-- Profiles and organisations
-- ---------------------------------------------------------------------------
CREATE TABLE profiles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id  uuid NOT NULL UNIQUE,
  display_name  text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
  email         citext NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE policies (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL,
  version          integer NOT NULL CHECK (version >= 1),
  recording_mode   text NOT NULL CHECK (recording_mode IN ('disabled','optional','required_on_designated_tasks')),
  retention_days   integer NOT NULL CHECK (retention_days BETWEEN 1 AND 30),
  capture_audio    boolean NOT NULL DEFAULT false CHECK (capture_audio = false),
  heartbeat_seconds integer NOT NULL DEFAULT 30 CHECK (heartbeat_seconds BETWEEN 10 AND 300),
  stale_after_seconds integer NOT NULL DEFAULT 90 CHECK (stale_after_seconds > heartbeat_seconds),
  reminder_minutes_before_end integer NOT NULL DEFAULT 30 CHECK (reminder_minutes_before_end BETWEEN 0 AND 240),
  invitation_ttl_hours integer NOT NULL DEFAULT 72 CHECK (invitation_ttl_hours BETWEEN 1 AND 720),
  attachment_max_bytes bigint NOT NULL DEFAULT 20971520 CHECK (attachment_max_bytes > 0),
  attachment_mime_types text[] NOT NULL DEFAULT ARRAY['application/pdf','image/png','image/jpeg','image/webp','text/plain'],
  notice_text      text NOT NULL,
  effective_at     timestamptz,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, version),
  UNIQUE (id, organisation_id)
);

CREATE TABLE organisations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  slug              text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])?$'),
  timezone          text NOT NULL DEFAULT 'Africa/Lagos',
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','archived')),
  current_policy_id uuid,
  setup_state       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organisations_current_policy_fk FOREIGN KEY (current_policy_id, id)
    REFERENCES policies(id, organisation_id) DEFERRABLE INITIALLY DEFERRED
);
ALTER TABLE policies ADD CONSTRAINT policies_org_fk FOREIGN KEY (organisation_id) REFERENCES organisations(id);

CREATE TABLE memberships (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  user_id          uuid NOT NULL REFERENCES profiles(id),
  employee_code    text NOT NULL CHECK (employee_code ~ '^[A-Z0-9-]{2,24}$'),
  role             text NOT NULL CHECK (role IN ('owner','hr','manager','employee')),
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  revoked_at       timestamptz,
  revoked_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, user_id),
  UNIQUE (organisation_id, employee_code),
  UNIQUE (id, organisation_id),
  CHECK ((status = 'revoked') = (revoked_at IS NOT NULL))
);
CREATE INDEX memberships_user_idx ON memberships(user_id) WHERE status = 'active';
ALTER TABLE policies ADD CONSTRAINT policies_created_by_fk FOREIGN KEY (created_by, organisation_id) REFERENCES memberships(id, organisation_id);
ALTER TABLE memberships ADD CONSTRAINT memberships_revoked_by_fk FOREIGN KEY (revoked_by, organisation_id) REFERENCES memberships(id, organisation_id);

CREATE TABLE policy_acknowledgements (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  membership_id    uuid NOT NULL,
  policy_id        uuid NOT NULL,
  acknowledged_at  timestamptz NOT NULL DEFAULT now(),
  shown_notice_text text NOT NULL,
  UNIQUE (membership_id, policy_id),
  FOREIGN KEY (membership_id, organisation_id) REFERENCES memberships(id, organisation_id),
  FOREIGN KEY (policy_id, organisation_id) REFERENCES policies(id, organisation_id)
);

CREATE TABLE teams (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  name             text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  archived_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, name),
  UNIQUE (id, organisation_id)
);

CREATE TABLE team_members (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  team_id          uuid NOT NULL,
  membership_id    uuid NOT NULL,
  is_manager       boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, membership_id),
  FOREIGN KEY (team_id, organisation_id) REFERENCES teams(id, organisation_id),
  FOREIGN KEY (membership_id, organisation_id) REFERENCES memberships(id, organisation_id)
);
CREATE INDEX team_members_membership_idx ON team_members(membership_id);
CREATE INDEX team_members_manager_idx ON team_members(team_id) WHERE is_manager;

CREATE TABLE invitations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  email            citext NOT NULL,
  role             text NOT NULL CHECK (role IN ('owner','hr','manager','employee')),
  team_id          uuid,
  employee_code    text,
  token_hash       text NOT NULL UNIQUE,
  expires_at       timestamptz NOT NULL,
  accepted_at      timestamptz,
  accepted_membership_id uuid,
  revoked_at       timestamptz,
  invited_by       uuid NOT NULL,
  sent_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (invited_by, organisation_id) REFERENCES memberships(id, organisation_id),
  FOREIGN KEY (team_id, organisation_id) REFERENCES teams(id, organisation_id),
  FOREIGN KEY (accepted_membership_id, organisation_id) REFERENCES memberships(id, organisation_id)
);
CREATE INDEX invitations_org_idx ON invitations(organisation_id, created_at DESC);
CREATE UNIQUE INDEX invitations_pending_email_idx ON invitations(organisation_id, email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE TABLE schedules (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  membership_id    uuid,
  timezone         text NOT NULL,
  working_days     smallint[] NOT NULL DEFAULT ARRAY[1,2,3,4,5]::smallint[],
  start_local      time NOT NULL DEFAULT '09:00',
  end_local        time NOT NULL DEFAULT '17:00',
  effective_from   date NOT NULL DEFAULT CURRENT_DATE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (end_local > start_local),
  FOREIGN KEY (membership_id, organisation_id) REFERENCES memberships(id, organisation_id)
);
CREATE INDEX schedules_org_idx ON schedules(organisation_id, effective_from DESC);

-- Authorised day exemptions so report-completeness is not knowingly wrong (leave support deferred).
CREATE TABLE workday_exemptions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  membership_id    uuid NOT NULL,
  local_date       date NOT NULL,
  reason           text NOT NULL,
  created_by       uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (membership_id, local_date),
  FOREIGN KEY (membership_id, organisation_id) REFERENCES memberships(id, organisation_id),
  FOREIGN KEY (created_by, organisation_id) REFERENCES memberships(id, organisation_id)
);

-- ---------------------------------------------------------------------------
-- Audit, notifications, jobs, idempotency
-- ---------------------------------------------------------------------------
CREATE TABLE audit_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid REFERENCES organisations(id),
  actor_membership_id uuid,
  actor_user_id    uuid,
  action           text NOT NULL,
  subject_type     text NOT NULL,
  subject_id       uuid,
  occurred_at      timestamptz NOT NULL DEFAULT now(),
  metadata         jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_id       text
);
CREATE INDEX audit_events_org_idx ON audit_events(organisation_id, occurred_at DESC);
CREATE INDEX audit_events_subject_idx ON audit_events(subject_type, subject_id);

CREATE TABLE notifications (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  recipient_membership_id uuid NOT NULL,
  type             text NOT NULL,
  title            text NOT NULL,
  body             text,
  resource_type    text,
  resource_id      uuid,
  href             text,
  deduplication_key text NOT NULL,
  read_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (recipient_membership_id, deduplication_key),
  FOREIGN KEY (recipient_membership_id, organisation_id) REFERENCES memberships(id, organisation_id)
);
CREATE INDEX notifications_recipient_idx ON notifications(recipient_membership_id, created_at DESC) WHERE read_at IS NULL;

CREATE TABLE jobs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type             text NOT NULL,
  payload          jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedup_key        text UNIQUE,
  state            text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','running','succeeded','failed','dead')),
  attempts         integer NOT NULL DEFAULT 0,
  max_attempts     integer NOT NULL DEFAULT 8,
  next_run_at      timestamptz NOT NULL DEFAULT now(),
  locked_at        timestamptz,
  locked_by        text,
  last_error       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz
);
CREATE INDEX jobs_pending_idx ON jobs(next_run_at) WHERE state = 'pending';

CREATE TABLE idempotency_keys (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id    uuid NOT NULL,
  route            text NOT NULL,
  key              text NOT NULL,
  request_hash     text NOT NULL,
  response_status  integer,
  response_body    jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  UNIQUE (actor_user_id, route, key)
);
CREATE INDEX idempotency_keys_expiry_idx ON idempotency_keys(expires_at);

-- ---------------------------------------------------------------------------
-- Helpers for RLS: identity comes from a transaction-local setting that only
-- server code sets (SET LOCAL app.user_id). Workers set app.role = 'worker'.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app_is_worker() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('app.role', true), '') = 'worker'
$$;

CREATE OR REPLACE FUNCTION app_membership_id(org uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.id FROM memberships m
  WHERE m.organisation_id = org AND m.user_id = app_user_id() AND m.status = 'active'
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION app_is_member(org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_is_worker() OR EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.organisation_id = org AND m.user_id = app_user_id() AND m.status = 'active')
$$;

CREATE OR REPLACE FUNCTION app_role(org uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.role FROM memberships m
  WHERE m.organisation_id = org AND m.user_id = app_user_id() AND m.status = 'active'
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION app_has_role(org uuid, VARIADIC roles text[]) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_is_worker() OR COALESCE(app_role(org) = ANY(roles), false)
$$;

-- True when the current user manages a team containing the given membership.
CREATE OR REPLACE FUNCTION app_manages(org uuid, target_membership uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_is_worker() OR EXISTS (
    SELECT 1
    FROM team_members mgr
    JOIN team_members tm ON tm.team_id = mgr.team_id
    WHERE mgr.organisation_id = org
      AND mgr.is_manager
      AND mgr.membership_id = app_membership_id(org)
      AND tm.membership_id = target_membership)
$$;

-- Owners and HR see organisation-wide time records; managers see their teams; everyone sees their own.
CREATE OR REPLACE FUNCTION app_can_view_records(org uuid, target_membership uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_is_worker()
      OR app_membership_id(org) = target_membership
      OR app_has_role(org, 'owner', 'hr')
      OR app_manages(org, target_membership)
$$;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER organisations_updated BEFORE UPDATE ON organisations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER memberships_updated BEFORE UPDATE ON memberships FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER profiles_updated BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER auth_users_updated BEFORE UPDATE ON auth_users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Prevent removing/revoking the last active owner of an organisation.
CREATE OR REPLACE FUNCTION guard_last_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (TG_OP = 'DELETE') OR (NEW.status <> 'active') OR (NEW.role <> 'owner') THEN
    IF OLD.role = 'owner' AND OLD.status = 'active' THEN
      IF NOT EXISTS (
        SELECT 1 FROM memberships m
        WHERE m.organisation_id = OLD.organisation_id AND m.role = 'owner' AND m.status = 'active' AND m.id <> OLD.id
      ) THEN
        RAISE EXCEPTION 'LAST_OWNER: an organisation must keep at least one active owner. Grant the owner role to another member first.'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER memberships_last_owner BEFORE UPDATE OR DELETE ON memberships FOR EACH ROW EXECUTE FUNCTION guard_last_owner();

-- Organisation change notifications for realtime (LISTEN/NOTIFY).
CREATE OR REPLACE FUNCTION notify_org_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE org uuid; payload text;
BEGIN
  org := COALESCE(NEW.organisation_id, OLD.organisation_id);
  payload := json_build_object('table', TG_TABLE_NAME, 'op', TG_OP, 'id', COALESCE(NEW.id, OLD.id), 'at', now())::text;
  PERFORM pg_notify('org_' || replace(org::text, '-', ''), payload);
  RETURN NULL;
END $$;

CREATE TRIGGER memberships_notify AFTER INSERT OR UPDATE ON memberships FOR EACH ROW EXECUTE FUNCTION notify_org_change();
CREATE TRIGGER notifications_notify AFTER INSERT OR UPDATE ON notifications FOR EACH ROW EXECUTE FUNCTION notify_org_change();
