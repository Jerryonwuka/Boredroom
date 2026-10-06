-- Docs (owner decision, 5 October 2026): documents people and Brenda write inside Boredroom (notes, SOPs, meeting
-- notes, reports, policy drafts, the staff handbook). Markdown text with a title, an optional folder, and who can read
-- it: only the writer (private), one team, or everyone in the organisation. Archived documents disappear for everyone;
-- nothing is deleted. A generated full-text index lets Brenda and the library search titles and text.

CREATE TABLE IF NOT EXISTS documents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  created_by       uuid NOT NULL,
  title            text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  body             text NOT NULL DEFAULT '' CHECK (length(body) <= 200000),
  folder           text CHECK (folder IS NULL OR (length(folder) BETWEEN 1 AND 80 AND folder = btrim(folder))),
  visibility       text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'team', 'organisation')),
  team_id          uuid,
  pinned           boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  archived_at      timestamptz,
  -- Title matches rank above text matches.
  search           tsvector GENERATED ALWAYS AS (setweight(to_tsvector('english', title), 'A') || setweight(to_tsvector('english', body), 'B')) STORED,
  UNIQUE (id, organisation_id),
  FOREIGN KEY (created_by, organisation_id) REFERENCES memberships(id, organisation_id),
  FOREIGN KEY (team_id, organisation_id) REFERENCES teams(id, organisation_id),
  -- A team document names its team; a private or organisation document names none.
  CHECK ((visibility = 'team') = (team_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS documents_search_idx ON documents USING gin (search);
CREATE INDEX IF NOT EXISTS documents_org_updated_idx ON documents(organisation_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS documents_creator_idx ON documents(created_by);

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
-- Read: a live document in your organisation that is shared with everyone, written by you, shared with a team you are
-- on, or any document when you are the owner or HR.
CREATE POLICY documents_select ON documents FOR SELECT USING (
  app_is_worker() OR (archived_at IS NULL AND app_is_member(organisation_id) AND (
    visibility = 'organisation'
    OR created_by = app_membership_id(organisation_id)
    OR (visibility = 'team' AND EXISTS (SELECT 1 FROM team_members tm WHERE tm.team_id = documents.team_id AND tm.membership_id = app_membership_id(documents.organisation_id)))
    OR app_has_role(organisation_id, 'owner', 'hr'))));
-- Write: any active member, as themself.
CREATE POLICY documents_insert ON documents FOR INSERT
  WITH CHECK (app_is_worker() OR created_by = app_membership_id(organisation_id));
-- Change: the writer, or the owner and HR.
CREATE POLICY documents_update ON documents FOR UPDATE
  USING (app_is_worker() OR created_by = app_membership_id(organisation_id) OR app_has_role(organisation_id, 'owner', 'hr'))
  WITH CHECK (app_is_worker() OR created_by = app_membership_id(organisation_id) OR app_has_role(organisation_id, 'owner', 'hr'));
GRANT SELECT, INSERT, UPDATE ON documents TO boardroom_app;
REVOKE DELETE ON documents FROM boardroom_app;

-- Archiving hides the row from every reader, which an ordinary UPDATE cannot do under the read policy (the new row must
-- stay readable). The same people who may change a document may archive it; anyone else is refused.
CREATE OR REPLACE FUNCTION app_archive_document(doc uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE org uuid; creator uuid;
BEGIN
  SELECT organisation_id, created_by INTO org, creator FROM documents WHERE id = doc AND archived_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF NOT (app_is_worker() OR creator = app_membership_id(org) OR app_has_role(org, 'owner', 'hr')) THEN
    RAISE EXCEPTION 'DOCUMENT_FORBIDDEN: only the writer, the owner or HR can archive a document' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE documents SET archived_at = now() WHERE id = doc;
  RETURN true;
END $$;
GRANT EXECUTE ON FUNCTION app_archive_document(uuid) TO boardroom_app;
