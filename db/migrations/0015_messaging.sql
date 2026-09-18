-- 0015 messaging: people in an organisation message each other directly, in a channel per team,
-- and in one organisation-wide channel. Messages can point at a task ("how far with this?").
-- Direct conversations list their two participants; team and organisation channels derive their
-- audience from team_members / memberships so nobody has to be added by hand.

CREATE TABLE conversations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  kind             text NOT NULL CHECK (kind IN ('direct','team','organisation')),
  team_id          uuid,
  direct_key       text,                       -- the two membership ids, sorted and joined; one direct thread per pair
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_message_at  timestamptz,
  UNIQUE (id, organisation_id),
  FOREIGN KEY (team_id, organisation_id) REFERENCES teams(id, organisation_id),
  CHECK ((kind = 'team') = (team_id IS NOT NULL)),
  CHECK ((kind = 'direct') = (direct_key IS NOT NULL))
);
CREATE UNIQUE INDEX conversations_team_idx ON conversations(team_id) WHERE kind = 'team';
CREATE UNIQUE INDEX conversations_org_channel_idx ON conversations(organisation_id) WHERE kind = 'organisation';
CREATE UNIQUE INDEX conversations_direct_idx ON conversations(organisation_id, direct_key) WHERE kind = 'direct';
CREATE INDEX conversations_recent_idx ON conversations(organisation_id, last_message_at DESC NULLS LAST);

CREATE TABLE conversation_participants (
  conversation_id  uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  organisation_id  uuid NOT NULL,
  membership_id    uuid NOT NULL,
  joined_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, membership_id),
  FOREIGN KEY (membership_id, organisation_id) REFERENCES memberships(id, organisation_id)
);
CREATE INDEX conversation_participants_member_idx ON conversation_participants(membership_id);

-- Where each person has read up to, per conversation (any kind).
CREATE TABLE conversation_reads (
  conversation_id  uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  membership_id    uuid NOT NULL REFERENCES memberships(id),
  last_read_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, membership_id)
);

CREATE TABLE messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  conversation_id  uuid NOT NULL,
  sender_membership_id uuid NOT NULL,
  body             text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  task_id          uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,
  FOREIGN KEY (conversation_id, organisation_id) REFERENCES conversations(id, organisation_id) ON DELETE CASCADE,
  FOREIGN KEY (sender_membership_id, organisation_id) REFERENCES memberships(id, organisation_id),
  FOREIGN KEY (task_id, organisation_id) REFERENCES tasks(id, organisation_id)
);
CREATE INDEX messages_conversation_idx ON messages(conversation_id, created_at);
CREATE INDEX messages_task_idx ON messages(task_id) WHERE task_id IS NOT NULL;

-- Keep the conversation's last_message_at current and wake the org's event stream.
CREATE OR REPLACE FUNCTION messages_after_insert() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE conversations SET last_message_at = NEW.created_at WHERE id = NEW.conversation_id;
  RETURN NULL;
END $$;
CREATE TRIGGER messages_touch AFTER INSERT ON messages FOR EACH ROW EXECUTE FUNCTION messages_after_insert();
CREATE TRIGGER messages_notify AFTER INSERT OR UPDATE ON messages FOR EACH ROW EXECUTE FUNCTION notify_org_change();

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------
-- A person can read a conversation when they are one of its direct participants, a member of its team,
-- or (for the organisation channel) an active member of the organisation.
CREATE OR REPLACE FUNCTION app_can_read_conversation(conv uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_is_worker() OR EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = conv AND app_is_member(c.organisation_id) AND (
      (c.kind = 'organisation')
      OR (c.kind = 'team' AND EXISTS (SELECT 1 FROM team_members tm WHERE tm.team_id = c.team_id AND tm.membership_id = app_membership_id(c.organisation_id)))
      OR (c.kind = 'direct' AND EXISTS (SELECT 1 FROM conversation_participants p WHERE p.conversation_id = c.id AND p.membership_id = app_membership_id(c.organisation_id)))
    ))
$$;
GRANT EXECUTE ON FUNCTION app_can_read_conversation(uuid) TO boardroom_app;

-- Returns the direct conversation between the caller and another active member of the same organisation,
-- creating it on first use. Definer: the caller cannot see the other person's participant rows before the thread exists.
CREATE OR REPLACE FUNCTION app_direct_conversation(org uuid, other uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid; key text; conv uuid;
BEGIN
  me := app_membership_id(org);
  IF me IS NULL THEN RAISE EXCEPTION 'not a member of organisation' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF other = me THEN RAISE EXCEPTION 'SELF_MESSAGE: you cannot message yourself' USING ERRCODE = 'check_violation'; END IF;
  IF NOT EXISTS (SELECT 1 FROM memberships m WHERE m.id = other AND m.organisation_id = org AND m.status = 'active') THEN
    RAISE EXCEPTION 'MEMBER_NOT_FOUND: that person is not an active member' USING ERRCODE = 'no_data_found';
  END IF;
  key := least(me::text, other::text) || ':' || greatest(me::text, other::text);
  SELECT id INTO conv FROM conversations WHERE organisation_id = org AND kind = 'direct' AND direct_key = key;
  IF conv IS NULL THEN
    INSERT INTO conversations(organisation_id, kind, direct_key, created_by) VALUES (org, 'direct', key, me)
      ON CONFLICT (organisation_id, direct_key) WHERE kind = 'direct' DO NOTHING RETURNING id INTO conv;
    IF conv IS NULL THEN SELECT id INTO conv FROM conversations WHERE organisation_id = org AND kind = 'direct' AND direct_key = key; END IF;
    INSERT INTO conversation_participants(conversation_id, organisation_id, membership_id) VALUES (conv, org, me), (conv, org, other) ON CONFLICT DO NOTHING;
  END IF;
  RETURN conv;
END $$;
GRANT EXECUTE ON FUNCTION app_direct_conversation(uuid, uuid) TO boardroom_app;

-- The team channel (team_id given) or the organisation channel (NULL), created on first use by any member allowed to read it.
CREATE OR REPLACE FUNCTION app_channel_conversation(org uuid, team uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid; conv uuid;
BEGIN
  me := app_membership_id(org);
  IF me IS NULL AND NOT app_is_worker() THEN RAISE EXCEPTION 'not a member of organisation' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF team IS NULL THEN
    SELECT id INTO conv FROM conversations WHERE organisation_id = org AND kind = 'organisation';
    IF conv IS NULL THEN
      INSERT INTO conversations(organisation_id, kind, created_by) VALUES (org, 'organisation', me)
        ON CONFLICT (organisation_id) WHERE kind = 'organisation' DO NOTHING RETURNING id INTO conv;
      IF conv IS NULL THEN SELECT id INTO conv FROM conversations WHERE organisation_id = org AND kind = 'organisation'; END IF;
    END IF;
    RETURN conv;
  END IF;
  IF NOT app_is_worker() AND NOT EXISTS (SELECT 1 FROM team_members tm WHERE tm.team_id = team AND tm.organisation_id = org AND tm.membership_id = me) THEN
    RAISE EXCEPTION 'TEAM_FORBIDDEN: you are not in that team' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT id INTO conv FROM conversations WHERE kind = 'team' AND team_id = team;
  IF conv IS NULL THEN
    INSERT INTO conversations(organisation_id, kind, team_id, created_by) VALUES (org, 'team', team, me)
      ON CONFLICT (team_id) WHERE kind = 'team' DO NOTHING RETURNING id INTO conv;
    IF conv IS NULL THEN SELECT id INTO conv FROM conversations WHERE kind = 'team' AND team_id = team; END IF;
  END IF;
  RETURN conv;
END $$;
GRANT EXECUTE ON FUNCTION app_channel_conversation(uuid, uuid) TO boardroom_app;

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY conversations_select ON conversations FOR SELECT USING (app_can_read_conversation(id));
-- Rows are only ever created through the definer functions above.

ALTER TABLE conversation_participants ENABLE ROW LEVEL SECURITY;
CREATE POLICY conversation_participants_select ON conversation_participants FOR SELECT USING (app_can_read_conversation(conversation_id));

ALTER TABLE conversation_reads ENABLE ROW LEVEL SECURITY;
CREATE POLICY conversation_reads_own ON conversation_reads FOR ALL
  USING (app_is_worker() OR membership_id = app_membership_id(organisation_id))
  WITH CHECK (app_is_worker() OR (app_can_read_conversation(conversation_id) AND membership_id = app_membership_id(organisation_id)));

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY messages_select ON messages FOR SELECT USING (app_can_read_conversation(conversation_id));
CREATE POLICY messages_insert ON messages FOR INSERT
  WITH CHECK (app_is_worker() OR (app_can_read_conversation(conversation_id) AND sender_membership_id = app_membership_id(organisation_id)));
-- Only the sender may change a message, and only to withdraw it.
CREATE POLICY messages_update_own ON messages FOR UPDATE
  USING (app_is_worker() OR sender_membership_id = app_membership_id(organisation_id))
  WITH CHECK (app_is_worker() OR sender_membership_id = app_membership_id(organisation_id));

GRANT SELECT ON conversations, conversation_participants TO boardroom_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON conversation_reads TO boardroom_app;
GRANT SELECT, INSERT, UPDATE ON messages TO boardroom_app;
