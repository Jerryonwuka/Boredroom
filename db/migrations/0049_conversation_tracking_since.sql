-- Phase 7b review fixes (9 October 2026): "Note commitments here" turned off and on again must never let the workspace's
-- commitments scan read what was said while it was off. The workspace switch already records when tracking was last
-- turned on (brenda_settings.track_commitments_since); the conversation's own switch recorded nothing, so the scan
-- read from its old cursor and noted messages written while the conversation asked not to be tracked, and took the
-- off period's words as context for later lines.
-- 1. conversations.track_commitments_since: when "Note commitments here" was last turned back on (NULL: never turned
--    off, or turned on before this migration). The scan reads nothing older, as a candidate or as context.
-- 2. app_conversation_set_track_commitments: the same checks as 0048, and it records the time when the switch goes
--    from off to on. Nothing else changes.
-- Additive and idempotent: safe to run by hand twice. Requires 0048. Code deployed before this runs still never reads
-- the off period's messages as candidates (it moves the conversation's scan cursor when the switch is turned on); this
-- adds the floor for context lines too (server/lib/schema-0049).

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS track_commitments_since timestamptz;

CREATE OR REPLACE FUNCTION app_conversation_set_track_commitments(conv uuid, allowed boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE k text;
BEGIN
  IF allowed IS NULL THEN RAISE EXCEPTION 'TRACK_COMMITMENTS_INVALID' USING ERRCODE = 'check_violation'; END IF;
  SELECT kind INTO k FROM conversations WHERE id = conv;
  IF NOT FOUND OR NOT app_can_manage_conversation(conv) THEN RAISE EXCEPTION 'CONVERSATION_FORBIDDEN' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF k = 'direct' THEN RAISE EXCEPTION 'TRACK_COMMITMENTS_DIRECT: direct messages are never tracked' USING ERRCODE = 'check_violation'; END IF;
  -- In SET, track_commitments is the value before this update: the time is recorded only when it goes from off to on.
  UPDATE conversations
     SET track_commitments_since = CASE WHEN allowed AND NOT track_commitments THEN now() ELSE track_commitments_since END,
         track_commitments = allowed
   WHERE id = conv;
END $$;
GRANT EXECUTE ON FUNCTION app_conversation_set_track_commitments(uuid, boolean) TO boardroom_app;
