-- The first-run welcome (owner request, 11 October 2026: "when new users login and create an account i need there to be a
-- sort of set up, walkthrough guide, elevator pitch kind of thing … then maybe after, a 'you're all set up' message").
-- Two things:
-- 1. assistant_private gains the person's own welcome progress, per membership: the screen they reached, when they
--    started and finished, how it ended ('done', 'skipped', or 'existing' for everyone who was already a member when this
--    ran), the steps they skipped, how many times it opened on its own, and whether they hid Next steps on their
--    assistant's page. On assistant_private, never on assistant_profiles: colleagues read assistant_profiles, and whether
--    someone finished setting up is theirs alone. 0047's policy covers the new columns (the person and the worker only),
--    so no manager ever sees it.
--    Everyone who is a member when this runs is marked done ('existing'): nobody already using Boredroom sees the welcome
--    unless they replay it from Settings.
-- 2. Joining as a team lead: a join code whose role is "Team lead" and that names a team now makes the joiner that team's
--    lead (services/orgs joinWithCode). The two self-join policies on team_members are tightened to match: a joiner may
--    take a team's lead seat only when their code or invitation is for a team lead.
-- Additive and idempotent: safe to run by hand twice. `DROP … IF EXISTS` only on objects this file creates or replaces.
-- The backfill below runs only on the run that adds the columns, so a second run never marks anyone who joined since
-- (or anyone part-way through the welcome) as 'existing' (review, 11 October 2026).
-- Requires 0047 and 0050 (applied in order). It does not depend on 0055 (which waits in db/pending) and may run before it.
-- Code deployed before this runs keeps the old "Meet your assistant" dialog and keeps welcome progress in the browser's
-- session (server/lib/schema-0056).

-- 1. The person's own welcome progress, and, only on the run that adds it, everyone already a member marked done.
--    Whether this is that run is read before any column is added (welcome_done_at is the marker).
DO $welcome$
DECLARE
  first_run boolean := NOT EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'assistant_private'::regclass AND attname = 'welcome_done_at' AND NOT attisdropped);
BEGIN
  ALTER TABLE assistant_private ADD COLUMN IF NOT EXISTS welcome_step text;
  ALTER TABLE assistant_private ADD COLUMN IF NOT EXISTS welcome_started_at timestamptz;
  ALTER TABLE assistant_private ADD COLUMN IF NOT EXISTS welcome_done_at timestamptz;
  ALTER TABLE assistant_private ADD COLUMN IF NOT EXISTS welcome_outcome text;
  ALTER TABLE assistant_private ADD COLUMN IF NOT EXISTS welcome_skipped text[] NOT NULL DEFAULT '{}'::text[];
  ALTER TABLE assistant_private ADD COLUMN IF NOT EXISTS welcome_shown smallint NOT NULL DEFAULT 0;
  ALTER TABLE assistant_private ADD COLUMN IF NOT EXISTS next_steps_hidden_at timestamptz;

  -- Everyone who is already a member is done: they never see the welcome unless they replay it. Only on the first run:
  -- by a second, people who joined since have their own rows and their own progress, and must keep them.
  IF first_run THEN
    INSERT INTO assistant_private(membership_id, organisation_id, welcome_done_at, welcome_outcome)
    SELECT m.id, m.organisation_id, COALESCE(p.setup_done_at, now()), 'existing'
      FROM memberships m
      LEFT JOIN assistant_profiles p ON p.membership_id = m.id
    ON CONFLICT (membership_id) DO UPDATE
      SET welcome_done_at = COALESCE(assistant_private.welcome_done_at, EXCLUDED.welcome_done_at),
          welcome_outcome = COALESCE(assistant_private.welcome_outcome, EXCLUDED.welcome_outcome);
  END IF;
END
$welcome$;

ALTER TABLE assistant_private DROP CONSTRAINT IF EXISTS assistant_private_welcome_check;
ALTER TABLE assistant_private ADD CONSTRAINT assistant_private_welcome_check CHECK (
  (welcome_step IS NULL OR welcome_step IN ('welcome', 'you', 'assistant', 'how', 'seen', 'team', 'done'))
  AND (welcome_outcome IS NULL OR welcome_outcome IN ('done', 'skipped', 'existing'))
  AND ((welcome_done_at IS NULL) = (welcome_outcome IS NULL))
  AND welcome_skipped <@ '{you,assistant,how,seen,team}'::text[]
  AND cardinality(welcome_skipped) <= 5
  AND welcome_shown BETWEEN 0 AND 99);

-- 2. A joiner takes a team's lead seat only when their join code or invitation is for a team lead (0008's and 0005's
--    policies, with that one condition added).
DROP POLICY IF EXISTS team_members_join_code ON team_members;
CREATE POLICY team_members_join_code ON team_members FOR INSERT WITH CHECK (
  membership_id = app_membership_id(organisation_id) AND EXISTS (
    SELECT 1 FROM organisations o WHERE o.id = team_members.organisation_id AND o.join_code_team_id = team_members.team_id
      AND o.join_code_enabled AND COALESCE(current_setting('app.join_code', true), '') = o.join_code
      AND (NOT team_members.is_manager OR o.join_code_role = 'manager')));

DROP POLICY IF EXISTS team_members_self_join ON team_members;
CREATE POLICY team_members_self_join ON team_members FOR INSERT WITH CHECK (
  membership_id = app_membership_id(organisation_id) AND EXISTS (
    SELECT 1 FROM invitations i
    WHERE i.organisation_id = team_members.organisation_id AND i.accepted_membership_id = team_members.membership_id
      AND i.team_id = team_members.team_id
      AND (NOT team_members.is_manager OR i.role = 'manager')));
