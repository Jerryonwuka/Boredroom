-- Act without asking (owner decision, 8 October 2026: "there should be a setting where we can bypass the permission,
-- you can toggle it on and off, just like the way it is on Claude Code"). Four things:
-- 1. assistant_profiles.act_mode: 'ask' (the default: Confirm before anything that lands on someone else) or 'auto'
--    (actions the person asks for in their own private chat run at once, with Undo for 10 minutes; the safety floors in
--    services/copilot still ask). 0035's policies cover it (members read; the person writes their own).
-- 2. brenda_settings.allow_auto_act: owners and HR let people choose 'auto' (on by default); off, everyone asks. 0026's
--    policies cover it.
-- 3. A message passed to someone's assistant can be withdrawn by its sender while it is unseen, unanswered and under 10
--    minutes old (Undo): the status machine gains message delivered → withdrawn, and the recipient no longer reads it.
-- 4. app_assistant_item_unsend: the sender's withdrawal, as a definer that answers with a word.
-- Replaced, old semantics kept exactly plus the change: assistant_items_status_kind_check, assistant_items_guard(),
-- policy assistant_items_select (old text in 0043). Code deployed before this runs reads 'ask' for everyone
-- (server/lib/schema-0045).
-- Additive and idempotent: safe to run by hand twice. Requires 0043 and 0044 (applied in order).

-- 1 and 2. The switches ---------------------------------------------------------------------------------------------
ALTER TABLE assistant_profiles ADD COLUMN IF NOT EXISTS act_mode text NOT NULL DEFAULT 'ask'
  CONSTRAINT assistant_profiles_act_mode_check CHECK (act_mode IN ('ask', 'auto'));
ALTER TABLE brenda_settings ADD COLUMN IF NOT EXISTS allow_auto_act boolean NOT NULL DEFAULT true;

-- 3. Withdrawing a passed-on message -----------------------------------------------------------------------------------
ALTER TABLE assistant_items DROP CONSTRAINT IF EXISTS assistant_items_status_kind_check;
ALTER TABLE assistant_items ADD CONSTRAINT assistant_items_status_kind_check CHECK (
  CASE kind WHEN 'request' THEN status IN ('delivered', 'seen', 'accepted', 'declined', 'done', 'failed', 'expired', 'cancelled')
            WHEN 'report_note' THEN status IN ('delivered', 'done', 'expired', 'withdrawn')
            WHEN 'message' THEN status IN ('delivered', 'seen', 'withdrawn')
            ELSE status IN ('delivered', 'seen') END);

CREATE OR REPLACE FUNCTION assistant_items_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.organisation_id IS DISTINCT FROM OLD.organisation_id OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.sender_membership_id IS DISTINCT FROM OLD.sender_membership_id OR NEW.recipient_membership_id IS DISTINCT FROM OLD.recipient_membership_id
     OR NEW.parent_id IS DISTINCT FROM OLD.parent_id OR NEW.body IS DISTINCT FROM OLD.body OR NEW.tidied IS DISTINCT FROM OLD.tidied
     OR NEW.request_kind IS DISTINCT FROM OLD.request_kind OR NEW.payload IS DISTINCT FROM OLD.payload OR NEW.task_id IS DISTINCT FROM OLD.task_id
     OR NEW.report_date IS DISTINCT FROM OLD.report_date OR NEW.conversation_id IS DISTINCT FROM OLD.conversation_id
     OR NEW.mention_id IS DISTINCT FROM OLD.mention_id OR NEW.expires_at IS DISTINCT FROM OLD.expires_at OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'ASSISTANT_ITEM_FIXED: what was sent cannot be changed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.kind IN ('message', 'reply') AND OLD.status = 'delivered' AND NEW.status = 'seen')
    OR (OLD.kind = 'message' AND OLD.status = 'delivered' AND NEW.status = 'withdrawn')
    OR (OLD.kind = 'request' AND OLD.status = 'delivered' AND NEW.status IN ('seen', 'accepted', 'declined', 'expired', 'cancelled'))
    OR (OLD.kind = 'request' AND OLD.status = 'seen' AND NEW.status IN ('accepted', 'declined', 'expired', 'cancelled'))
    OR (OLD.kind = 'request' AND OLD.status = 'accepted' AND NEW.status IN ('done', 'failed'))
    OR (OLD.kind = 'report_note' AND OLD.status = 'delivered' AND NEW.status IN ('done', 'expired', 'withdrawn'))) THEN
    RAISE EXCEPTION 'ASSISTANT_ITEM_TRANSITION: % to % is not allowed', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
-- The trigger itself (0043) is unchanged: it calls the function by name.

DROP POLICY IF EXISTS assistant_items_select ON assistant_items;
CREATE POLICY assistant_items_select ON assistant_items FOR SELECT
  USING (app_is_worker()
         OR sender_membership_id = app_membership_id(organisation_id)
         OR (recipient_membership_id = app_membership_id(organisation_id) AND NOT (kind = 'message' AND status = 'withdrawn'))
         OR (kind = 'report_note' AND status IN ('delivered', 'done') AND app_can_view_records(organisation_id, sender_membership_id)));

-- 4. The sender's withdrawal (Undo): 'ok' (also when already withdrawn), 'not_found' (not theirs: one word), 'closed'
-- (seen or replied to), 'too_late' (over 10 minutes old).
CREATE OR REPLACE FUNCTION app_assistant_item_unsend(item uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE i assistant_items%ROWTYPE;
BEGIN
  SELECT * INTO i FROM assistant_items WHERE id = item FOR UPDATE;
  IF NOT FOUND OR i.kind <> 'message' OR app_membership_id(i.organisation_id) IS DISTINCT FROM i.sender_membership_id THEN RETURN 'not_found'; END IF;
  IF i.status = 'withdrawn' THEN RETURN 'ok'; END IF;
  IF i.status <> 'delivered' OR i.seen_at IS NOT NULL OR EXISTS (SELECT 1 FROM assistant_items r WHERE r.parent_id = i.id) THEN RETURN 'closed'; END IF;
  IF i.created_at < now() - interval '10 minutes' THEN RETURN 'too_late'; END IF;
  UPDATE assistant_items SET status = 'withdrawn', finished_at = now() WHERE id = item;
  RETURN 'ok';
END $$;
GRANT EXECUTE ON FUNCTION app_assistant_item_unsend(uuid) TO boardroom_app;
