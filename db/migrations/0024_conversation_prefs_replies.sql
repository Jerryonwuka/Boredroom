-- Messaging, round three (owner decision, 26 September 2026): a person can mark a conversation unread or mute it,
-- and a message can reply to another one in the same conversation.

-- Per-person, per-conversation choices live on the reads row, which is already one row per person and conversation
-- and only ever visible to that person.
ALTER TABLE conversation_reads ADD COLUMN IF NOT EXISTS marked_unread boolean NOT NULL DEFAULT false;
ALTER TABLE conversation_reads ADD COLUMN IF NOT EXISTS muted_at timestamptz;

-- A reply points at the message it answers. Withdrawing the original leaves the pointer; the thread shows "withdrawn".
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_id uuid REFERENCES messages(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS messages_reply_idx ON messages(reply_to_id) WHERE reply_to_id IS NOT NULL;

-- Whether a person has muted a conversation. Definer: a sender cannot see other people's reads rows, but must not
-- notify someone who muted the thread.
CREATE OR REPLACE FUNCTION app_conversation_muted(conv uuid, member uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM conversation_reads r WHERE r.conversation_id = conv AND r.membership_id = member AND r.muted_at IS NOT NULL)
$$;
GRANT EXECUTE ON FUNCTION app_conversation_muted(uuid, uuid) TO boardroom_app;
