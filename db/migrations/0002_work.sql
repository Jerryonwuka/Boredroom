-- 0002 projects, tasks, daily plans, work sessions, intervals, events

CREATE TABLE projects (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  name             text NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  description      text,
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  requires_due_date boolean NOT NULL DEFAULT false,
  requires_estimate boolean NOT NULL DEFAULT false,
  created_by       uuid NOT NULL,
  archived_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organisation_id),
  FOREIGN KEY (created_by, organisation_id) REFERENCES memberships(id, organisation_id)
);
CREATE INDEX projects_org_idx ON projects(organisation_id, status);

CREATE TABLE project_members (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  project_id       uuid NOT NULL,
  membership_id    uuid NOT NULL,
  access_role      text NOT NULL DEFAULT 'contributor' CHECK (access_role IN ('lead','contributor','viewer')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, membership_id),
  FOREIGN KEY (project_id, organisation_id) REFERENCES projects(id, organisation_id),
  FOREIGN KEY (membership_id, organisation_id) REFERENCES memberships(id, organisation_id)
);
CREATE INDEX project_members_membership_idx ON project_members(membership_id);

CREATE TABLE tasks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  project_id       uuid NOT NULL,
  assignee_membership_id uuid NOT NULL,
  reviewer_membership_id uuid,
  created_by       uuid NOT NULL,
  title            text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  expected_output  text NOT NULL CHECK (length(expected_output) BETWEEN 1 AND 4000),
  category         text NOT NULL DEFAULT 'work' CHECK (category IN ('work','meeting','offline','admin')),
  priority         text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  estimate_minutes integer CHECK (estimate_minutes IS NULL OR estimate_minutes > 0),
  due_at           timestamptz,
  status           text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','blocked','in_review','completed')),
  blocked_reason   text,
  capture_requirement text NOT NULL DEFAULT 'none' CHECK (capture_requirement IN ('none','optional','required')),
  archived_at      timestamptz,
  completed_at     timestamptz,
  version          integer NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organisation_id),
  CHECK (reviewer_membership_id IS NULL OR reviewer_membership_id <> assignee_membership_id),
  FOREIGN KEY (project_id, organisation_id) REFERENCES projects(id, organisation_id),
  FOREIGN KEY (assignee_membership_id, organisation_id) REFERENCES memberships(id, organisation_id),
  FOREIGN KEY (reviewer_membership_id, organisation_id) REFERENCES memberships(id, organisation_id),
  FOREIGN KEY (created_by, organisation_id) REFERENCES memberships(id, organisation_id)
);
CREATE INDEX tasks_assignee_status_idx ON tasks(assignee_membership_id, status);
CREATE INDEX tasks_project_idx ON tasks(project_id, status);
CREATE INDEX tasks_org_due_idx ON tasks(organisation_id, due_at) WHERE archived_at IS NULL;
CREATE INDEX tasks_reviewer_idx ON tasks(reviewer_membership_id) WHERE status = 'in_review';
CREATE TRIGGER tasks_updated BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER tasks_notify AFTER INSERT OR UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION notify_org_change();

CREATE TABLE task_comments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  task_id          uuid NOT NULL,
  author_membership_id uuid NOT NULL,
  body             text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (task_id, organisation_id) REFERENCES tasks(id, organisation_id),
  FOREIGN KEY (author_membership_id, organisation_id) REFERENCES memberships(id, organisation_id)
);
CREATE INDEX task_comments_task_idx ON task_comments(task_id, created_at);

CREATE TABLE daily_plan_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  membership_id    uuid NOT NULL,
  local_date       date NOT NULL,
  task_id          uuid NOT NULL,
  position         integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (membership_id, local_date, task_id),
  FOREIGN KEY (membership_id, organisation_id) REFERENCES memberships(id, organisation_id),
  FOREIGN KEY (task_id, organisation_id) REFERENCES tasks(id, organisation_id)
);
CREATE INDEX daily_plan_items_day_idx ON daily_plan_items(membership_id, local_date, position);

-- One open session per USER (not per membership) across all organisations.
CREATE TABLE work_sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  user_id          uuid NOT NULL REFERENCES profiles(id),
  membership_id    uuid NOT NULL,
  task_id          uuid NOT NULL,
  state            text NOT NULL DEFAULT 'running' CHECK (state IN ('running','paused','interrupted','stopped')),
  capture_mode     text NOT NULL DEFAULT 'none' CHECK (capture_mode IN ('none','optional','required','exception')),
  capture_exception_id uuid,
  policy_id        uuid,
  started_at       timestamptz NOT NULL DEFAULT now(),
  ended_at         timestamptz,
  last_heartbeat_at timestamptz NOT NULL DEFAULT now(),
  stop_note        text,
  stop_outcome     text CHECK (stop_outcome IS NULL OR stop_outcome IN ('continue_later','blocked','ready_for_review')),
  version          integer NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organisation_id),
  CHECK ((state = 'stopped') = (ended_at IS NOT NULL)),
  FOREIGN KEY (membership_id, organisation_id) REFERENCES memberships(id, organisation_id),
  FOREIGN KEY (task_id, organisation_id) REFERENCES tasks(id, organisation_id),
  FOREIGN KEY (policy_id, organisation_id) REFERENCES policies(id, organisation_id)
);
CREATE UNIQUE INDEX work_sessions_one_open_per_user ON work_sessions(user_id) WHERE state IN ('running','paused','interrupted');
CREATE INDEX work_sessions_membership_idx ON work_sessions(membership_id, started_at DESC);
CREATE INDEX work_sessions_task_idx ON work_sessions(task_id);
CREATE INDEX work_sessions_open_idx ON work_sessions(last_heartbeat_at) WHERE state = 'running';
CREATE TRIGGER work_sessions_updated BEFORE UPDATE ON work_sessions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER work_sessions_notify AFTER INSERT OR UPDATE ON work_sessions FOR EACH ROW EXECUTE FUNCTION notify_org_change();

-- Immutable timed intervals. Tracked time is the sum of confirmed interval durations.
-- confirmation_status: confirmed (server-bounded timer time), uncertain (elapsed after
-- last heartbeat; needs reconciliation), proposed (time adjustment awaiting review),
-- rejected (adjustment declined), superseded (replaced through an approved adjustment).
CREATE TABLE session_intervals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  session_id       uuid NOT NULL,
  user_id          uuid NOT NULL REFERENCES profiles(id),
  membership_id    uuid NOT NULL,
  task_id          uuid NOT NULL,
  started_at       timestamptz NOT NULL,
  ended_at         timestamptz,
  confirmation_status text NOT NULL DEFAULT 'confirmed' CHECK (confirmation_status IN ('confirmed','uncertain','proposed','rejected','superseded')),
  source           text NOT NULL DEFAULT 'timer' CHECK (source IN ('timer','adjustment','recovery')),
  adjustment_id    uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organisation_id),
  CHECK (ended_at IS NULL OR ended_at >= started_at),
  FOREIGN KEY (session_id, organisation_id) REFERENCES work_sessions(id, organisation_id),
  FOREIGN KEY (membership_id, organisation_id) REFERENCES memberships(id, organisation_id),
  FOREIGN KEY (task_id, organisation_id) REFERENCES tasks(id, organisation_id),
  -- Confirmed intervals never overlap for a user, across every organisation.
  CONSTRAINT session_intervals_no_overlap EXCLUDE USING gist (
    user_id WITH =,
    tstzrange(started_at, COALESCE(ended_at, 'infinity'::timestamptz), '[)') WITH &&
  ) WHERE (confirmation_status = 'confirmed')
);
CREATE INDEX session_intervals_session_idx ON session_intervals(session_id);
CREATE INDEX session_intervals_membership_time_idx ON session_intervals(membership_id, started_at);
CREATE UNIQUE INDEX session_intervals_one_open_per_session ON session_intervals(session_id) WHERE ended_at IS NULL;

-- Intervals are immutable except for closing an open one (ended_at) and status transitions.
CREATE OR REPLACE FUNCTION guard_interval_immutability() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.started_at <> OLD.started_at OR NEW.session_id <> OLD.session_id OR NEW.user_id <> OLD.user_id
     OR NEW.task_id <> OLD.task_id OR NEW.membership_id <> OLD.membership_id THEN
    RAISE EXCEPTION 'INTERVAL_IMMUTABLE: session intervals cannot be rewritten' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.ended_at IS NOT NULL AND NEW.ended_at IS DISTINCT FROM OLD.ended_at THEN
    RAISE EXCEPTION 'INTERVAL_IMMUTABLE: a closed interval cannot change its end' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER session_intervals_immutable BEFORE UPDATE ON session_intervals FOR EACH ROW EXECUTE FUNCTION guard_interval_immutability();

CREATE TABLE session_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  session_id       uuid NOT NULL,
  actor_user_id    uuid,
  event_type       text NOT NULL,
  occurred_at      timestamptz NOT NULL DEFAULT now(),
  request_id       text,
  metadata         jsonb NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (session_id, organisation_id) REFERENCES work_sessions(id, organisation_id)
);
CREATE INDEX session_events_session_idx ON session_events(session_id, occurred_at);

CREATE TABLE task_status_history (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  task_id          uuid NOT NULL,
  actor_membership_id uuid,
  from_status      text,
  to_status        text NOT NULL,
  reason           text,
  occurred_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (task_id, organisation_id) REFERENCES tasks(id, organisation_id)
);
CREATE INDEX task_status_history_task_idx ON task_status_history(task_id, occurred_at);
