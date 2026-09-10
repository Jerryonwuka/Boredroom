-- Files uploaded before a submission exists. Attached to a revision on submit, or purged.
CREATE TABLE staged_uploads (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  task_id          uuid NOT NULL,
  membership_id    uuid NOT NULL,
  storage_key      text NOT NULL UNIQUE,
  file_name        text NOT NULL,
  mime_type        text NOT NULL,
  size_bytes       bigint NOT NULL,
  sha256           text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (task_id, organisation_id) REFERENCES tasks(id, organisation_id),
  FOREIGN KEY (membership_id, organisation_id) REFERENCES memberships(id, organisation_id)
);
ALTER TABLE staged_uploads ENABLE ROW LEVEL SECURITY;
CREATE POLICY staged_uploads_own ON staged_uploads FOR ALL USING (app_is_worker() OR membership_id = app_membership_id(organisation_id)) WITH CHECK (membership_id = app_membership_id(organisation_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON staged_uploads TO boardroom_app;
