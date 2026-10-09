-- Phase 7c fixes (fix review, 9 October 2026). Four things, all additive:
-- 1. Private decline labels, tied to the label's own commitment: app_label_party_of(msg, commitment) and
--    message_labels_select replaced. 0050 asked whether the reader was a party to ANY declined or dismissed commitment
--    on the message, so with two commitments on one message (Ada's promise to Olu, and David's ask Ada agreed to and
--    declined) David read the state of Ada's promise to Olu. Now: a reader of the conversation for 'noted' and 'done'
--    (unchanged), and for 'declined' and 'dismissed' only the committer or asker of the commitment the row names
--    (`commitment_id`, which commitments.ts syncLabel always writes); a row without one keeps 0050's rule.
-- 2. app_standup_unskip replaced: undoing the skip of a draft that failed after its three attempts gives it one more
--    attempt (attempts back to 2), so the sweep drafts it again instead of the card reading "drafting" all day (the
--    sweep marks such an entry failed again, and the person was told once already). Everything else exactly as 0050.
-- 3. app_standup_notices_read(entries): the worker marks a closed or called-off entry's notices read ("Your standup for
--    Design is ready" after the day passed); the worker cannot update a person's notifications, so a definer function
--    that touches only those two notice keys of those entries' own people, and only for the worker.
-- 4. standup_entries_unnotified_idx: the sweep's release of held notices (notified_at IS NULL AND notify_at <= now)
--    had no index for entries no longer ready.
-- Idempotent: CREATE OR REPLACE, DROP … IF EXISTS only on what this file creates or replaces, IF NOT EXISTS. Requires
-- 0050. The code works before this runs (labels: commitments.ts labelsIn already applies rule 1; unskip: the sweep fails
-- a spent draft again with its notice; notices: left as they are; the index: a slower sweep).

-- 1. Private decline labels ------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_label_party_of(msg uuid, commitment uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN commitment IS NULL THEN app_label_party(msg) ELSE EXISTS (
    SELECT 1 FROM commitments x
    WHERE x.id = commitment
      AND app_membership_id(x.organisation_id) IN (x.committer_membership_id, x.asker_membership_id)) END
$$;
GRANT EXECUTE ON FUNCTION app_label_party_of(uuid, uuid) TO boardroom_app;

-- Replaced (0050): the same, except that a private state is checked against the label's own commitment.
DROP POLICY IF EXISTS message_labels_select ON message_labels;
CREATE POLICY message_labels_select ON message_labels FOR SELECT
  USING (app_is_worker()
         OR (app_can_read_conversation(conversation_id) AND (state IN ('noted', 'done') OR app_label_party_of(message_id, commitment_id))));

-- 2. Undo a skip --------------------------------------------------------------------------------------------------------
-- 0050's, with one change: a never-drafted entry out of attempts goes back with one attempt left.
CREATE OR REPLACE FUNCTION app_standup_unskip(e uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE i standup_entries%ROWTYPE;
BEGIN
  SELECT * INTO i FROM standup_entries WHERE id = e FOR UPDATE;
  IF NOT FOUND OR app_membership_id(i.organisation_id) IS DISTINCT FROM i.membership_id THEN RETURN 'not_found'; END IF;
  IF i.status <> 'skipped' THEN RETURN 'closed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM standup_rollups r WHERE r.id = i.rollup_id AND r.status = 'open' AND r.cutoff_at > now()) THEN RETURN 'too_late'; END IF;
  UPDATE standup_entries SET status = CASE WHEN drafted_at IS NOT NULL THEN 'ready' ELSE 'drafting' END,
         attempts = CASE WHEN drafted_at IS NULL THEN LEAST(attempts, 2) ELSE attempts END, skipped_at = NULL
   WHERE id = e;
  RETURN 'ok';
END $$;
GRANT EXECUTE ON FUNCTION app_standup_unskip(uuid) TO boardroom_app;

-- 3. The worker reads a closed entry's notices ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_standup_notices_read(entries uuid[]) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  IF NOT app_is_worker() OR entries IS NULL THEN RETURN 0; END IF;
  UPDATE notifications x SET read_at = now()
    FROM standup_entries e
   WHERE e.id = ANY(entries) AND x.recipient_membership_id = e.membership_id AND x.organisation_id = e.organisation_id
     AND x.deduplication_key IN ('standup.draft:' || e.id::text, 'standup.failed:' || e.id::text) AND x.read_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
GRANT EXECUTE ON FUNCTION app_standup_notices_read(uuid[]) TO boardroom_app;

-- 4. The release of held notices ---------------------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS standup_entries_unnotified_idx ON standup_entries(notify_at) WHERE notified_at IS NULL;
