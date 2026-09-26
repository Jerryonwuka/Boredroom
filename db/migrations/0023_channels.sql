-- Messaging, round two (owner decision, 25 September 2026): named channels anyone can create and fill, archiving and
-- deleting conversations, editing and reporting messages, and hiding a direct thread for oneself.

-- A fourth kind of conversation: a channel with a title and a hand-picked set of participants.
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_kind_check;
ALTER TABLE conversations ADD CONSTRAINT conversations_kind_check CHECK (kind IN ('direct', 'team', 'organisation', 'channel'));
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS title text CHECK (title IS NULL OR length(title) BETWEEN 1 AND 80);
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS archived_by uuid;
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_channel_title_check;
ALTER TABLE conversations ADD CONSTRAINT conversations_channel_title_check CHECK ((kind = 'channel') = (title IS NOT NULL));

ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at timestamptz;

-- A direct thread "deleted" by one person is hidden for them until the other writes again.
CREATE TABLE IF NOT EXISTS conversation_hides (
  conversation_id  uuid NOT NULL,
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  membership_id    uuid NOT NULL,
  hidden_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, membership_id),
  FOREIGN KEY (conversation_id, organisation_id) REFERENCES conversations(id, organisation_id) ON DELETE CASCADE,
  FOREIGN KEY (membership_id, organisation_id) REFERENCES memberships(id, organisation_id)
);
ALTER TABLE conversation_hides ENABLE ROW LEVEL SECURITY;
CREATE POLICY conversation_hides_own ON conversation_hides FOR ALL
  USING (app_is_worker() OR membership_id = app_membership_id(organisation_id))
  WITH CHECK (app_is_worker() OR (app_can_read_conversation(conversation_id) AND membership_id = app_membership_id(organisation_id)));
GRANT SELECT, INSERT, DELETE ON conversation_hides TO boardroom_app;

-- A report on a message goes to the organisation owner and HR.
CREATE TABLE IF NOT EXISTS message_reports (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id        uuid NOT NULL REFERENCES organisations(id),
  message_id             uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  reporter_membership_id uuid NOT NULL,
  reason                 text NOT NULL CHECK (length(reason) BETWEEN 1 AND 1000),
  created_at             timestamptz NOT NULL DEFAULT now(),
  resolved_at            timestamptz,
  FOREIGN KEY (reporter_membership_id, organisation_id) REFERENCES memberships(id, organisation_id)
);
CREATE INDEX IF NOT EXISTS message_reports_org_idx ON message_reports(organisation_id, created_at DESC);
ALTER TABLE message_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY message_reports_insert ON message_reports FOR INSERT
  WITH CHECK (app_is_worker() OR (app_can_read_conversation((SELECT conversation_id FROM messages WHERE id = message_id)) AND reporter_membership_id = app_membership_id(organisation_id)));
CREATE POLICY message_reports_select ON message_reports FOR SELECT
  USING (app_is_worker() OR reporter_membership_id = app_membership_id(organisation_id) OR app_has_role(organisation_id, 'owner', 'hr'));
GRANT SELECT, INSERT ON message_reports TO boardroom_app;

-- Channels are read by their participants, like direct threads.
CREATE OR REPLACE FUNCTION app_can_read_conversation(conv uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_is_worker() OR EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = conv AND app_is_member(c.organisation_id) AND (
      (c.kind = 'organisation')
      OR (c.kind = 'team' AND EXISTS (SELECT 1 FROM team_members tm WHERE tm.team_id = c.team_id AND tm.membership_id = app_membership_id(c.organisation_id)))
      OR (c.kind IN ('direct', 'channel') AND EXISTS (SELECT 1 FROM conversation_participants p WHERE p.conversation_id = c.id AND p.membership_id = app_membership_id(c.organisation_id)))
    ))
$$;

-- Creates a channel with the caller and the given members. Any active member may create one.
CREATE OR REPLACE FUNCTION app_create_channel(org uuid, channel_title text, members uuid[]) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid; conv uuid; m uuid;
BEGIN
  me := app_membership_id(org);
  IF me IS NULL THEN RAISE EXCEPTION 'not a member of organisation' USING ERRCODE = 'insufficient_privilege'; END IF;
  INSERT INTO conversations(organisation_id, kind, title, created_by) VALUES (org, 'channel', channel_title, me) RETURNING id INTO conv;
  INSERT INTO conversation_participants(conversation_id, organisation_id, membership_id) VALUES (conv, org, me) ON CONFLICT DO NOTHING;
  FOREACH m IN ARRAY COALESCE(members, ARRAY[]::uuid[]) LOOP
    IF EXISTS (SELECT 1 FROM memberships mm WHERE mm.id = m AND mm.organisation_id = org AND mm.status = 'active') THEN
      INSERT INTO conversation_participants(conversation_id, organisation_id, membership_id) VALUES (conv, org, m) ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
  RETURN conv;
END $$;
GRANT EXECUTE ON FUNCTION app_create_channel(uuid, text, uuid[]) TO boardroom_app;

-- Who may run a channel: its creator, or the organisation owner and HR.
CREATE OR REPLACE FUNCTION app_can_manage_channel(conv uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_is_worker() OR EXISTS (
    SELECT 1 FROM conversations c WHERE c.id = conv AND c.kind = 'channel'
      AND (c.created_by = app_membership_id(c.organisation_id) OR app_has_role(c.organisation_id, 'owner', 'hr')))
$$;
GRANT EXECUTE ON FUNCTION app_can_manage_channel(uuid) TO boardroom_app;

-- Replaces a channel's participants (the creator always stays), renames it, archives or restores it, or deletes it.
CREATE OR REPLACE FUNCTION app_channel_set_members(conv uuid, members uuid[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE org uuid; owner uuid; m uuid;
BEGIN
  IF NOT app_can_manage_channel(conv) THEN RAISE EXCEPTION 'CHANNEL_FORBIDDEN' USING ERRCODE = 'insufficient_privilege'; END IF;
  SELECT organisation_id, created_by INTO org, owner FROM conversations WHERE id = conv;
  DELETE FROM conversation_participants WHERE conversation_id = conv AND membership_id <> owner AND NOT (membership_id = ANY (COALESCE(members, ARRAY[]::uuid[])));
  FOREACH m IN ARRAY COALESCE(members, ARRAY[]::uuid[]) LOOP
    IF EXISTS (SELECT 1 FROM memberships mm WHERE mm.id = m AND mm.organisation_id = org AND mm.status = 'active') THEN
      INSERT INTO conversation_participants(conversation_id, organisation_id, membership_id) VALUES (conv, org, m) ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION app_channel_set_members(uuid, uuid[]) TO boardroom_app;

CREATE OR REPLACE FUNCTION app_channel_update(conv uuid, new_title text, archived boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT app_can_manage_channel(conv) THEN RAISE EXCEPTION 'CHANNEL_FORBIDDEN' USING ERRCODE = 'insufficient_privilege'; END IF;
  UPDATE conversations SET title = COALESCE(new_title, title),
    archived_at = CASE WHEN archived IS NULL THEN archived_at WHEN archived THEN COALESCE(archived_at, now()) ELSE NULL END,
    archived_by = CASE WHEN archived IS NULL THEN archived_by WHEN archived THEN COALESCE(archived_by, app_membership_id(organisation_id)) ELSE NULL END
  WHERE id = conv;
END $$;
GRANT EXECUTE ON FUNCTION app_channel_update(uuid, text, boolean) TO boardroom_app;

CREATE OR REPLACE FUNCTION app_channel_delete(conv uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT app_can_manage_channel(conv) THEN RAISE EXCEPTION 'CHANNEL_FORBIDDEN' USING ERRCODE = 'insufficient_privilege'; END IF;
  DELETE FROM messages WHERE conversation_id = conv;
  DELETE FROM conversation_reads WHERE conversation_id = conv;
  DELETE FROM conversation_participants WHERE conversation_id = conv;
  DELETE FROM conversations WHERE id = conv AND kind = 'channel';
END $$;
GRANT EXECUTE ON FUNCTION app_channel_delete(uuid) TO boardroom_app;

-- A message written in a hidden direct thread brings it back for the person who hid it.
CREATE OR REPLACE FUNCTION messages_after_insert() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE conversations SET last_message_at = NEW.created_at WHERE id = NEW.conversation_id;
  DELETE FROM conversation_hides WHERE conversation_id = NEW.conversation_id AND membership_id <> NEW.sender_membership_id;
  RETURN NULL;
END $$;
