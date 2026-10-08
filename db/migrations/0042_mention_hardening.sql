-- Personal assistants, phase 5, hardening (review, 8 October 2026). Two definer functions, nothing else:
-- 1. app_visible_to_readers_many(conv, kind, items[]): the audience rule of app_visible_to_readers (0041) for many items
--    at once. 0041's function lists every reader of the conversation again for each item (a set-returning definer
--    function is never inlined), about 7 ms per item in a 1,000-person Everyone; this one lists them once per call and
--    returns the items every reader can see. Same answers, item by item, as app_visible_to_readers.
-- 2. app_retract_mention_reply(mention): when an assistant's public reply is withdrawn, the notifications it sent (the
--    tagger's "Max replied in …", and in a direct thread the other person's) and the tagger's Activity line stop
--    quoting it. Only Boredroom's worker role may call it; neither table is otherwise writable by the worker.
-- Additive and idempotent: CREATE OR REPLACE only, no table, column, policy or existing function changes. Code deployed
-- before this runs uses 0041's function item by item and leaves notifications as they are (server/lib/schema-0042).

-- 1. The audience rule for many items ---------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_visible_to_readers_many(conv uuid, item_kind text, items uuid[]) RETURNS SETOF uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE org uuid; me uuid; worker boolean; readers uuid[]; it uuid; t record;
BEGIN
  SELECT organisation_id INTO org FROM conversations WHERE id = conv;
  IF NOT FOUND OR items IS NULL OR item_kind NOT IN ('task', 'doc', 'conversation') THEN RETURN; END IF;
  worker := app_is_worker();
  IF NOT (worker OR app_can_read_conversation(conv)) THEN RETURN; END IF;
  me := app_membership_id(org);
  -- Once per call (app_conversation_readers checks the caller again; it is the same caller).
  SELECT COALESCE(array_agg(r.membership_id), '{}'::uuid[]) INTO readers FROM app_conversation_readers(conv) r;
  FOR it IN SELECT DISTINCT x FROM unnest(items) AS x WHERE x IS NOT NULL LOOP
    IF item_kind = 'task' THEN
      SELECT tk.assignee_membership_id, tk.reviewer_membership_id, tk.created_by, tk.project_id INTO t
        FROM tasks tk WHERE tk.id = it AND tk.organisation_id = org;
      CONTINUE WHEN NOT FOUND;
      CONTINUE WHEN NOT worker AND NOT app_can_view_task(org, t.assignee_membership_id, t.reviewer_membership_id, t.created_by, t.project_id);
      -- A person's own to-do is never public in a thread (as 0041).
      CONTINUE WHEN t.created_by = t.assignee_membership_id;
      IF NOT EXISTS (SELECT 1 FROM unnest(readers) AS r(id) WHERE NOT app_member_can_view_task(r.id, it)) THEN RETURN NEXT it; END IF;
    ELSIF item_kind = 'doc' THEN
      CONTINUE WHEN NOT EXISTS (SELECT 1 FROM documents d WHERE d.id = it AND d.organisation_id = org);
      CONTINUE WHEN NOT worker AND NOT app_member_can_read_doc(me, it);
      IF NOT EXISTS (SELECT 1 FROM unnest(readers) AS r(id) WHERE NOT app_member_can_read_doc(r.id, it)) THEN RETURN NEXT it; END IF;
    ELSE
      IF it = conv THEN RETURN NEXT it; CONTINUE; END IF;
      CONTINUE WHEN NOT EXISTS (SELECT 1 FROM conversations o WHERE o.id = it AND o.organisation_id = org);
      CONTINUE WHEN NOT worker AND NOT app_can_read_conversation(it);
      IF NOT EXISTS (SELECT 1 FROM unnest(readers) AS r(id) WHERE NOT app_member_can_read_conversation(r.id, it)) THEN RETURN NEXT it; END IF;
    END IF;
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION app_visible_to_readers_many(uuid, text, uuid[]) TO boardroom_app;

-- 2. A withdrawn reply stops being quoted ---------------------------------------------------------------------------------
-- Worker only. The notifications keep their place (and their link) but no longer quote the reply, and count as read;
-- the tagger's Activity line says it was withdrawn. Only rows this mention wrote are touched.
CREATE OR REPLACE FUNCTION app_retract_mention_reply(mention uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE am record;
BEGIN
  IF NOT app_is_worker() THEN RAISE EXCEPTION 'worker only' USING ERRCODE = '42501'; END IF;
  SELECT a.id, a.organisation_id, a.tagger_membership_id, a.reply_message_id INTO am
    FROM assistant_mentions a WHERE a.id = mention AND a.status = 'withdrawn';
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE notifications n SET body = 'This reply was withdrawn.', read_at = COALESCE(n.read_at, now())
   WHERE n.organisation_id = am.organisation_id AND (
     (n.recipient_membership_id = am.tagger_membership_id AND n.deduplication_key = 'mention.reply:' || am.id::text)
     OR (am.reply_message_id IS NOT NULL AND n.type = 'message.direct' AND n.deduplication_key = 'message:' || am.reply_message_id::text));
  UPDATE brenda_actions b
     SET detail = jsonb_set(b.detail, '{personalSummary}', to_jsonb(left(COALESCE(b.detail->>'personalSummary', 'Answered you'), 480) || ' (withdrawn)'))
   WHERE b.organisation_id = am.organisation_id AND b.membership_id = am.tagger_membership_id AND b.tool = 'mention_reply'
     AND b.detail->>'mentionId' = am.id::text AND COALESCE(b.detail->>'personalSummary', '') NOT LIKE '%(withdrawn)';
END $$;
REVOKE ALL ON FUNCTION app_retract_mention_reply(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_retract_mention_reply(uuid) TO boardroom_app;
