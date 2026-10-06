-- Brenda's past chats (owner decision, 5 October 2026): "For Brenda let there be a tab for past chats where users can
-- continue their past conversation. They should also be able to delete." Each conversation is kept as it was shown
-- (the messages, what she did, what she offered), private to the person who had it: no role reads another person's
-- conversations, not the owner, not HR, not a team lead. Deleting one removes it for good.

CREATE TABLE IF NOT EXISTS brenda_conversations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  membership_id    uuid NOT NULL,
  -- The first thing the person asked, trimmed.
  title            text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  -- The messages as the chat shows them, oldest first; Confirm tokens are removed before they are stored.
  messages         jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(messages) = 'array'),
  -- Derived from the messages, so the list never has to read them.
  message_count    int GENERATED ALWAYS AS (jsonb_array_length(messages)) STORED,
  preview          text GENERATED ALWAYS AS (left(messages -> -1 ->> 'content', 200)) STORED,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (message_count <= 200),
  FOREIGN KEY (membership_id, organisation_id) REFERENCES memberships(id, organisation_id)
);
CREATE INDEX IF NOT EXISTS brenda_conversations_member_idx ON brenda_conversations(membership_id, updated_at DESC);

ALTER TABLE brenda_conversations ENABLE ROW LEVEL SECURITY;
-- Only the person, in an organisation they are an active member of. The worker escape is for system jobs, as on the
-- other Brenda tables; nothing a person can reach reads conversations that way.
CREATE POLICY brenda_conversations_own ON brenda_conversations FOR ALL
  USING (app_is_worker() OR membership_id = app_membership_id(organisation_id))
  WITH CHECK (app_is_worker() OR membership_id = app_membership_id(organisation_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON brenda_conversations TO boardroom_app;
