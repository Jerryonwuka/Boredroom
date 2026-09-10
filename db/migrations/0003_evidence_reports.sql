-- 0003 deliverables, reviews, daily reports, time adjustments

CREATE TABLE task_submissions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  task_id          uuid NOT NULL,
  revision         integer NOT NULL CHECK (revision >= 1),
  submitted_by     uuid NOT NULL,
  note             text NOT NULL DEFAULT '',
  submitted_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, revision),
  UNIQUE (id, organisation_id),
  FOREIGN KEY (task_id, organisation_id) REFERENCES tasks(id, organisation_id),
  FOREIGN KEY (submitted_by, organisation_id) REFERENCES memberships(id, organisation_id)
);

CREATE TABLE deliverables (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  submission_id    uuid NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('file','link')),
  storage_key      text,
  url              text,
  file_name        text,
  mime_type        text,
  size_bytes       bigint,
  sha256           text,
  scan_status      text NOT NULL DEFAULT 'not_applicable' CHECK (scan_status IN ('not_applicable','pending','clean','infected','failed')),
  notes            text,
  uploaded_by      uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (storage_key),
  CHECK ((kind = 'file' AND storage_key IS NOT NULL AND url IS NULL) OR (kind = 'link' AND url IS NOT NULL AND storage_key IS NULL)),
  CHECK (url IS NULL OR url ~* '^https://'),
  FOREIGN KEY (submission_id, organisation_id) REFERENCES task_submissions(id, organisation_id),
  FOREIGN KEY (uploaded_by, organisation_id) REFERENCES memberships(id, organisation_id)
);
CREATE INDEX deliverables_submission_idx ON deliverables(submission_id);

CREATE TABLE reviews (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  submission_id    uuid NOT NULL,
  reviewer_membership_id uuid NOT NULL,
  decision         text NOT NULL CHECK (decision IN ('approved','changes_requested','question')),
  note             text NOT NULL DEFAULT '',
  reviewed_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (submission_id, organisation_id) REFERENCES task_submissions(id, organisation_id),
  FOREIGN KEY (reviewer_membership_id, organisation_id) REFERENCES memberships(id, organisation_id)
);
CREATE INDEX reviews_submission_idx ON reviews(submission_id, reviewed_at);
-- Self-review is impossible at the database level as well as in service code.
CREATE OR REPLACE FUNCTION guard_self_review() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM task_submissions s WHERE s.id = NEW.submission_id AND s.submitted_by = NEW.reviewer_membership_id) THEN
    RAISE EXCEPTION 'SELF_REVIEW: a submission cannot be reviewed by its submitter' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reviews_no_self BEFORE INSERT ON reviews FOR EACH ROW EXECUTE FUNCTION guard_self_review();

CREATE TABLE daily_reports (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  membership_id    uuid NOT NULL,
  local_date       date NOT NULL,
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','changes_requested','approved')),
  current_version  integer NOT NULL DEFAULT 0,
  approved_version integer,
  blockers         text NOT NULL DEFAULT '',
  next_priorities  text NOT NULL DEFAULT '',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (membership_id, local_date),
  UNIQUE (id, organisation_id),
  FOREIGN KEY (membership_id, organisation_id) REFERENCES memberships(id, organisation_id)
);
CREATE INDEX daily_reports_org_date_idx ON daily_reports(organisation_id, local_date DESC);
CREATE TRIGGER daily_reports_updated BEFORE UPDATE ON daily_reports FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER daily_reports_notify AFTER INSERT OR UPDATE ON daily_reports FOR EACH ROW EXECUTE FUNCTION notify_org_change();

-- Immutable snapshots. status: submitted, changes_requested, approved, superseded, withdrawn.
CREATE TABLE report_versions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  report_id        uuid NOT NULL,
  version          integer NOT NULL CHECK (version >= 1),
  timezone_snapshot text NOT NULL,
  status           text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','changes_requested','approved','superseded','withdrawn')),
  snapshot         jsonb NOT NULL,
  total_seconds    integer NOT NULL CHECK (total_seconds >= 0),
  blockers         text NOT NULL DEFAULT '',
  next_priorities  text NOT NULL DEFAULT '',
  submitted_by     uuid NOT NULL,
  submitted_at     timestamptz NOT NULL DEFAULT now(),
  reviewed_by      uuid,
  reviewed_at      timestamptz,
  review_note      text,
  superseded_at    timestamptz,
  adjustment_id    uuid,
  UNIQUE (report_id, version),
  UNIQUE (id, organisation_id),
  CHECK (reviewed_by IS NULL OR reviewed_by <> submitted_by),
  FOREIGN KEY (report_id, organisation_id) REFERENCES daily_reports(id, organisation_id),
  FOREIGN KEY (submitted_by, organisation_id) REFERENCES memberships(id, organisation_id),
  FOREIGN KEY (reviewed_by, organisation_id) REFERENCES memberships(id, organisation_id)
);
CREATE INDEX report_versions_report_idx ON report_versions(report_id, version DESC);

CREATE OR REPLACE FUNCTION guard_report_version_immutability() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.snapshot <> OLD.snapshot OR NEW.total_seconds <> OLD.total_seconds OR NEW.version <> OLD.version
     OR NEW.timezone_snapshot <> OLD.timezone_snapshot OR NEW.submitted_at <> OLD.submitted_at THEN
    RAISE EXCEPTION 'REPORT_VERSION_IMMUTABLE: snapshots cannot be rewritten' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER report_versions_immutable BEFORE UPDATE ON report_versions FOR EACH ROW EXECUTE FUNCTION guard_report_version_immutability();

CREATE TABLE time_adjustments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  membership_id    uuid NOT NULL,
  report_id        uuid,
  based_on_version integer,
  task_id          uuid NOT NULL,
  session_id       uuid,
  original_interval_ids uuid[] NOT NULL DEFAULT '{}',
  proposed_intervals jsonb NOT NULL,
  reason           text NOT NULL CHECK (length(reason) BETWEEN 1 AND 2000),
  evidence_note    text,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','withdrawn')),
  reviewer_membership_id uuid,
  review_note      text,
  reviewed_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organisation_id),
  CHECK (reviewer_membership_id IS NULL OR reviewer_membership_id <> membership_id),
  FOREIGN KEY (membership_id, organisation_id) REFERENCES memberships(id, organisation_id),
  FOREIGN KEY (report_id, organisation_id) REFERENCES daily_reports(id, organisation_id),
  FOREIGN KEY (task_id, organisation_id) REFERENCES tasks(id, organisation_id),
  FOREIGN KEY (session_id, organisation_id) REFERENCES work_sessions(id, organisation_id),
  FOREIGN KEY (reviewer_membership_id, organisation_id) REFERENCES memberships(id, organisation_id)
);
CREATE INDEX time_adjustments_org_status_idx ON time_adjustments(organisation_id, status);
CREATE INDEX time_adjustments_membership_idx ON time_adjustments(membership_id, created_at DESC);
ALTER TABLE session_intervals ADD CONSTRAINT session_intervals_adjustment_fk FOREIGN KEY (adjustment_id, organisation_id) REFERENCES time_adjustments(id, organisation_id);
ALTER TABLE report_versions ADD CONSTRAINT report_versions_adjustment_fk FOREIGN KEY (adjustment_id, organisation_id) REFERENCES time_adjustments(id, organisation_id);
CREATE TRIGGER time_adjustments_notify AFTER INSERT OR UPDATE ON time_adjustments FOR EACH ROW EXECUTE FUNCTION notify_org_change();
