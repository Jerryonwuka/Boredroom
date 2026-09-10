-- 0004 recording pilot: grants, recordings, chunks, exceptions, incidents

CREATE TABLE recording_grants (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  grantee_membership_id uuid NOT NULL,
  scope_type       text NOT NULL CHECK (scope_type IN ('organisation','team','privacy_admin')),
  scope_id         uuid,
  granted_by       uuid NOT NULL,
  granted_at       timestamptz NOT NULL DEFAULT now(),
  revoked_at       timestamptz,
  revoked_by       uuid,
  CHECK ((scope_type = 'team') = (scope_id IS NOT NULL)),
  FOREIGN KEY (grantee_membership_id, organisation_id) REFERENCES memberships(id, organisation_id),
  FOREIGN KEY (granted_by, organisation_id) REFERENCES memberships(id, organisation_id),
  FOREIGN KEY (revoked_by, organisation_id) REFERENCES memberships(id, organisation_id),
  FOREIGN KEY (scope_id, organisation_id) REFERENCES teams(id, organisation_id)
);
CREATE INDEX recording_grants_grantee_idx ON recording_grants(grantee_membership_id) WHERE revoked_at IS NULL;

CREATE TABLE capture_exceptions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  membership_id    uuid NOT NULL,
  session_id       uuid,
  task_id          uuid,
  reason_code      text NOT NULL CHECK (reason_code IN ('permission_denied','unsupported_browser','capture_failed','quota_exceeded','sensitive_context','other')),
  reason           text NOT NULL CHECK (length(reason) BETWEEN 1 AND 2000),
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected')),
  reviewer_membership_id uuid,
  decision_note    text,
  reviewed_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organisation_id),
  CHECK (session_id IS NOT NULL OR task_id IS NOT NULL),
  FOREIGN KEY (membership_id, organisation_id) REFERENCES memberships(id, organisation_id),
  FOREIGN KEY (session_id, organisation_id) REFERENCES work_sessions(id, organisation_id),
  FOREIGN KEY (task_id, organisation_id) REFERENCES tasks(id, organisation_id),
  FOREIGN KEY (reviewer_membership_id, organisation_id) REFERENCES memberships(id, organisation_id)
);
CREATE INDEX capture_exceptions_org_status_idx ON capture_exceptions(organisation_id, status);
ALTER TABLE work_sessions ADD CONSTRAINT work_sessions_capture_exception_fk
  FOREIGN KEY (capture_exception_id, organisation_id) REFERENCES capture_exceptions(id, organisation_id) DEFERRABLE INITIALLY DEFERRED;
CREATE TRIGGER capture_exceptions_notify AFTER INSERT OR UPDATE ON capture_exceptions FOR EACH ROW EXECUTE FUNCTION notify_org_change();

-- A recording is one recorder instance (one media container). A session may own several
-- (pause/resume, lost capture) which are played back through the session manifest.
CREATE TABLE recordings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  session_id       uuid NOT NULL,
  membership_id    uuid NOT NULL,
  policy_id        uuid NOT NULL,
  recorder_instance text NOT NULL,
  segment_index    integer NOT NULL CHECK (segment_index >= 0),
  source_type      text NOT NULL DEFAULT 'unknown' CHECK (source_type IN ('monitor','window','browser','unknown')),
  source_label     text,
  mime_type        text NOT NULL,
  capture_state    text NOT NULL DEFAULT 'requesting' CHECK (capture_state IN ('requesting','recording','interrupted','ended','failed')),
  upload_state     text NOT NULL DEFAULT 'pending' CHECK (upload_state IN ('pending','uploading','processing','ready','partial','failed','restricted','deleting','deleted')),
  storage_prefix   text NOT NULL UNIQUE,
  assembled_key    text,
  declared_chunk_count integer,
  received_bytes   bigint NOT NULL DEFAULT 0,
  max_bytes        bigint NOT NULL DEFAULT 2147483648,
  capture_started_at timestamptz,
  capture_ended_at timestamptz,
  finalised_at     timestamptz,
  expires_at       timestamptz NOT NULL,
  restricted_at    timestamptz,
  deleted_at       timestamptz,
  failure_reason   text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, recorder_instance),
  UNIQUE (id, organisation_id),
  FOREIGN KEY (session_id, organisation_id) REFERENCES work_sessions(id, organisation_id),
  FOREIGN KEY (membership_id, organisation_id) REFERENCES memberships(id, organisation_id),
  FOREIGN KEY (policy_id, organisation_id) REFERENCES policies(id, organisation_id)
);
CREATE INDEX recordings_session_idx ON recordings(session_id, segment_index);
CREATE INDEX recordings_retention_idx ON recordings(expires_at) WHERE deleted_at IS NULL;
CREATE INDEX recordings_membership_idx ON recordings(membership_id, created_at DESC);
CREATE TRIGGER recordings_updated BEFORE UPDATE ON recordings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE recording_chunks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  recording_id     uuid NOT NULL,
  sequence         integer NOT NULL CHECK (sequence >= 0),
  checksum         text NOT NULL,
  size_bytes       bigint NOT NULL CHECK (size_bytes > 0),
  storage_key      text NOT NULL UNIQUE,
  state            text NOT NULL DEFAULT 'authorised' CHECK (state IN ('authorised','received','verified','rejected','deleted')),
  received_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (recording_id, sequence),
  FOREIGN KEY (recording_id, organisation_id) REFERENCES recordings(id, organisation_id)
);

CREATE TABLE recording_access_log (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  recording_id     uuid NOT NULL,
  actor_membership_id uuid NOT NULL,
  action           text NOT NULL CHECK (action IN ('playback_authorised','playback_denied','downloaded')),
  occurred_at      timestamptz NOT NULL DEFAULT now(),
  metadata         jsonb NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (recording_id, organisation_id) REFERENCES recordings(id, organisation_id),
  FOREIGN KEY (actor_membership_id, organisation_id) REFERENCES memberships(id, organisation_id)
);
CREATE INDEX recording_access_log_recording_idx ON recording_access_log(recording_id, occurred_at DESC);

CREATE TABLE privacy_incidents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  recording_id     uuid NOT NULL,
  reporter_membership_id uuid NOT NULL,
  reason           text NOT NULL CHECK (length(reason) BETWEEN 1 AND 2000),
  restricted_at    timestamptz NOT NULL DEFAULT now(),
  disposition      text NOT NULL DEFAULT 'open' CHECK (disposition IN ('open','deleted','released')),
  resolved_by      uuid,
  resolution_note  text,
  resolved_at      timestamptz,
  FOREIGN KEY (recording_id, organisation_id) REFERENCES recordings(id, organisation_id),
  FOREIGN KEY (reporter_membership_id, organisation_id) REFERENCES memberships(id, organisation_id),
  FOREIGN KEY (resolved_by, organisation_id) REFERENCES memberships(id, organisation_id)
);
CREATE INDEX privacy_incidents_open_idx ON privacy_incidents(organisation_id) WHERE disposition = 'open';

CREATE TABLE deletion_tombstones (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  subject_type     text NOT NULL,
  subject_id       uuid NOT NULL,
  storage_keys     text[] NOT NULL DEFAULT '{}',
  reason           text NOT NULL CHECK (reason IN ('retention','incident','offboarding')),
  deleted_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subject_type, subject_id)
);
