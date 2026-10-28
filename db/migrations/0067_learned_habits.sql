-- "What Brenda has learned" (owner decision, 28 October 2026: "I want her to learn from the person's usage and interaction
-- with her and interact with the person based on that"). Until now she remembered only what the person explicitly asked
-- (phase 7c's assistant_preferences, 0050). This adds:
--   1. assistant_learning: the person's own switch "Learn from how I use Brenda" (on by default; a missing row reads as
--      on), how many of their turns since she last learned, when she last did, and when they last pressed "Forget
--      everything" (nothing from before it is read again).
--   2. assistant_signals: short records of the person's OWN use of their assistant (their own request words, at most
--      200 characters; which tools ran or waited for Confirm; Confirm cards confirmed or declined; the apps and file
--      formats of what they asked their Mac to do). Never other people's messages, connected apps' content or screen
--      pictures. Kept 30 days: the worker's system.purge_expired deletes older rows.
--   3. assistant_learned: what she learned from them, at most 12 active habits a person (a trigger keeps it for every
--      writer), each one short plain sentence about work style or tools, with a kind, a confidence, how many signals
--      back it and when it was last seen. A habit the person deletes stays as a hidden "dismissed" row (its words only)
--      so it is not learned again; "Forget everything" deletes every row.
--   4. ai_usage purposes + 'learning' (the cheap model's run, recorded for the workspace with no person, so it shows in
--      the Control Center's AI usage and never says who has learning on).
-- Control characters are refused by code point (not [[:cntrl:]], which some locales stretch to cover dashes).
-- Private to the person by row-level security, like assistant_preferences: owners, HR and leads read nothing; the worker
-- may only read and delete signals (the purge). While someone else is signed in as the person the code shows and records
-- nothing (services/learning.ts).
--
-- WAITS FOR THE OWNER'S GO-AHEAD. It lives in db/pending, NOT db/migrations. The code runs before it is applied: nothing
-- is recorded or learned, the situation carries nothing learned, and Settings › Your assistant says "What Brenda has
-- learned" is coming (server/lib/schema-0067.ts). Additive and idempotent; it needs 0037 (ai_usage) and 0050
-- (set_updated_at, app_membership_id, app_is_worker are older still), and nothing in 0065 or 0066. The ai_usage CHECK is
-- rebuilt from whatever list it holds now, plus 'learning', so a later or earlier widening is kept. Never ALTER ROLE.

CREATE TABLE IF NOT EXISTS assistant_learning (
  membership_id    uuid PRIMARY KEY,
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  enabled          boolean NOT NULL DEFAULT true,
  turns_since      integer NOT NULL DEFAULT 0 CONSTRAINT assistant_learning_turns_check CHECK (turns_since >= 0),
  last_run_at      timestamptz,
  forgotten_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (membership_id, organisation_id) REFERENCES memberships(id, organisation_id)
);
DROP TRIGGER IF EXISTS assistant_learning_updated ON assistant_learning;
CREATE TRIGGER assistant_learning_updated BEFORE UPDATE ON assistant_learning FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS assistant_signals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  membership_id    uuid NOT NULL,
  kind             text NOT NULL CONSTRAINT assistant_signals_kind_check
                     CHECK (kind IN ('request', 'correction', 'ran', 'asked', 'confirmed', 'declined', 'mac')),
  channel          text NOT NULL DEFAULT 'chat' CONSTRAINT assistant_signals_channel_check CHECK (channel IN ('chat', 'look', 'mac')),
  detail           text NOT NULL CONSTRAINT assistant_signals_detail_check
                     CHECK (char_length(detail) BETWEEN 1 AND 200 AND detail !~ '[\x01-\x1f\x7f]'),
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (membership_id, organisation_id) REFERENCES memberships(id, organisation_id)
);
CREATE INDEX IF NOT EXISTS assistant_signals_member_idx ON assistant_signals(membership_id, created_at DESC);
CREATE INDEX IF NOT EXISTS assistant_signals_created_idx ON assistant_signals(created_at);

CREATE TABLE IF NOT EXISTS assistant_learned (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  membership_id    uuid NOT NULL,
  body             text NOT NULL CONSTRAINT assistant_learned_body_check
                     CHECK (char_length(body) BETWEEN 1 AND 120 AND body = btrim(body) AND body !~ '[\x01-\x1f\x7f]'),
  kind             text NOT NULL DEFAULT 'other' CONSTRAINT assistant_learned_kind_check
                     CHECK (kind IN ('format', 'app', 'length', 'tone', 'timing', 'workflow', 'other')),
  confidence       smallint NOT NULL DEFAULT 50 CONSTRAINT assistant_learned_confidence_check CHECK (confidence BETWEEN 0 AND 100),
  evidence         integer NOT NULL DEFAULT 1 CONSTRAINT assistant_learned_evidence_check CHECK (evidence BETWEEN 1 AND 100000),
  last_seen        timestamptz NOT NULL DEFAULT now(),
  dismissed_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (membership_id, organisation_id) REFERENCES memberships(id, organisation_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS assistant_learned_body_idx ON assistant_learned(membership_id, lower(body));
CREATE INDEX IF NOT EXISTS assistant_learned_member_idx ON assistant_learned(membership_id, created_at);
DROP TRIGGER IF EXISTS assistant_learned_updated ON assistant_learned;
CREATE TRIGGER assistant_learned_updated BEFORE UPDATE ON assistant_learned FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- At most 12 active habits and 40 rows (dismissed ones included) a person, whoever writes; whose it is never changes.
CREATE OR REPLACE FUNCTION assistant_learned_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.membership_id <> OLD.membership_id OR NEW.organisation_id <> OLD.organisation_id THEN
      RAISE EXCEPTION 'LEARNED_OWNER: a learned habit stays its person''s' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.dismissed_at IS NOT NULL OR OLD.dismissed_at IS NULL THEN
      RETURN NEW;
    END IF;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('assistant_learned:' || NEW.membership_id::text));
  IF NEW.dismissed_at IS NULL
     AND (SELECT count(*) FROM assistant_learned WHERE membership_id = NEW.membership_id AND dismissed_at IS NULL AND id <> NEW.id) >= 12 THEN
    RAISE EXCEPTION 'LEARNED_FULL: at most 12 learned habits' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' AND (SELECT count(*) FROM assistant_learned WHERE membership_id = NEW.membership_id) >= 40 THEN
    RAISE EXCEPTION 'LEARNED_FULL: at most 40 learned rows' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS assistant_learned_guard ON assistant_learned;
CREATE TRIGGER assistant_learned_guard BEFORE INSERT OR UPDATE ON assistant_learned FOR EACH ROW EXECUTE FUNCTION assistant_learned_guard();

-- Row security: the person alone (owners, HR and leads read nothing). The worker may read and delete signals (the
-- 30-day purge); it never reads what was learned. No notify triggers: nothing about them is broadcast.
ALTER TABLE assistant_learning ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assistant_learning_own ON assistant_learning;
CREATE POLICY assistant_learning_own ON assistant_learning FOR ALL
  USING (membership_id = app_membership_id(organisation_id)) WITH CHECK (membership_id = app_membership_id(organisation_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON assistant_learning TO boardroom_app;
REVOKE TRUNCATE ON assistant_learning FROM boardroom_app;

ALTER TABLE assistant_signals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assistant_signals_own ON assistant_signals;
CREATE POLICY assistant_signals_own ON assistant_signals FOR ALL
  USING (membership_id = app_membership_id(organisation_id)) WITH CHECK (membership_id = app_membership_id(organisation_id));
DROP POLICY IF EXISTS assistant_signals_worker_read ON assistant_signals;
CREATE POLICY assistant_signals_worker_read ON assistant_signals FOR SELECT USING (app_is_worker());
DROP POLICY IF EXISTS assistant_signals_worker_purge ON assistant_signals;
CREATE POLICY assistant_signals_worker_purge ON assistant_signals FOR DELETE USING (app_is_worker());
GRANT SELECT, INSERT, DELETE ON assistant_signals TO boardroom_app;
REVOKE TRUNCATE ON assistant_signals FROM boardroom_app;

ALTER TABLE assistant_learned ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assistant_learned_own ON assistant_learned;
CREATE POLICY assistant_learned_own ON assistant_learned FOR ALL
  USING (membership_id = app_membership_id(organisation_id)) WITH CHECK (membership_id = app_membership_id(organisation_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON assistant_learned TO boardroom_app;
REVOKE TRUNCATE ON assistant_learned FROM boardroom_app;

-- ai_usage purposes + 'learning', keeping every purpose the CHECK allows now (whichever migrations widened it).
DO $$
DECLARE
  def  text;
  vals text[];
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO def FROM pg_constraint c
   WHERE c.conrelid = 'public.ai_usage'::regclass AND c.conname = 'ai_usage_purpose_check';
  IF def IS NOT NULL AND position('''learning''' IN def) > 0 THEN
    RETURN;
  END IF;
  SELECT array_agg(DISTINCT m[1]) INTO vals FROM regexp_matches(COALESCE(def, ''), '''([a-z_]+)''', 'g') AS m;
  vals := ARRAY(SELECT DISTINCT v FROM unnest(COALESCE(vals, ARRAY[]::text[]) || ARRAY['chat', 'plan', 'report', 'summary', 'test', 'other',
    'followup', 'mention', 'loose_ends', 'commitments', 'standup', 'call_recap', 'learning']) AS v ORDER BY v);
  ALTER TABLE ai_usage DROP CONSTRAINT IF EXISTS ai_usage_purpose_check;
  EXECUTE format('ALTER TABLE ai_usage ADD CONSTRAINT ai_usage_purpose_check CHECK (purpose IN (%s))',
    (SELECT string_agg(quote_literal(v), ', ' ORDER BY v) FROM unnest(vals) AS v));
END $$;
