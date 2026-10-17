-- Brenda for Mac, phase 3: easy setup, opening things, folder work and plans (owner report and requests, 12 October 2026,
-- after trying phase 2: "I wanted Brenda to assist me with some things, like open an app on my desktop, and it said it
-- can't do that"; "when I turned this setting on, I stopped seeing my Brenda"; "Brenda is meant to assist you do anything
-- you need it to do"). The permission rule of 12 October 2026 governs all of it: nothing happens unless the person asks,
-- hears exactly what Brenda will do, and says yes.
-- 1. assistant_private.screen_help_macs: each of the person's Macs as Brenda for Mac last reported it (which abilities are
--    on, which permissions macOS has given, whether the companion shows and why not), keyed by the Mac's desktop session,
--    at most five; screen_help_setup_at: when the person pressed "Set up on my Mac" in Settings (their Macs open the setup
--    card at their next poll). 0047's policy covers both: the person and the worker only; no owner, HR or lead reads them
--    (owner request, 12 October 2026: the person sees what is on; the employer still sees nothing).
-- 2. assistant_tasks: plans (kind 'plan'): up to six steps in order under one sentence and one yes, the lines the person saw
--    under the sentence (plan_v 2: the yes is to the sentence and the lines), what Brenda for Mac found before asking
--    (counts and names, never paths), and which step the plan is on. The database refuses a yes before what was found came
--    back, and any step past the first without a yes. Steps (with prepared Boredroom changes), lines and what was found go
--    when the task ends, with the person's words (0058).
-- Additive and idempotent: safe to run by hand twice. Requires 0058. Waits in db/pending until the owner's go-ahead; code
-- deployed before it reads it as not ready (server/lib/schema-0059).

ALTER TABLE assistant_private ADD COLUMN IF NOT EXISTS screen_help_macs jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE assistant_private ADD COLUMN IF NOT EXISTS screen_help_setup_at timestamptz;
ALTER TABLE assistant_private DROP CONSTRAINT IF EXISTS assistant_private_screen_help_macs_check;
ALTER TABLE assistant_private ADD CONSTRAINT assistant_private_screen_help_macs_check
  CHECK (jsonb_typeof(screen_help_macs) = 'array' AND jsonb_array_length(screen_help_macs) <= 5);

ALTER TABLE assistant_tasks DROP CONSTRAINT IF EXISTS assistant_tasks_kind_check;
ALTER TABLE assistant_tasks ADD CONSTRAINT assistant_tasks_kind_check CHECK (kind IN ('screen', 'file', 'plan'));
ALTER TABLE assistant_tasks ADD COLUMN IF NOT EXISTS plan_v smallint NOT NULL DEFAULT 1;
ALTER TABLE assistant_tasks ADD COLUMN IF NOT EXISTS steps jsonb;
ALTER TABLE assistant_tasks ADD COLUMN IF NOT EXISTS lines jsonb;
ALTER TABLE assistant_tasks ADD COLUMN IF NOT EXISTS needs_scope boolean NOT NULL DEFAULT false;
ALTER TABLE assistant_tasks ADD COLUMN IF NOT EXISTS scope jsonb;
ALTER TABLE assistant_tasks ADD COLUMN IF NOT EXISTS scoped_at timestamptz;
ALTER TABLE assistant_tasks ADD COLUMN IF NOT EXISTS step_index smallint NOT NULL DEFAULT 0;
ALTER TABLE assistant_tasks ADD COLUMN IF NOT EXISTS progress jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE assistant_tasks DROP CONSTRAINT IF EXISTS assistant_tasks_plan_shape;
ALTER TABLE assistant_tasks ADD CONSTRAINT assistant_tasks_plan_shape CHECK (
  plan_v IN (1, 2) AND (kind <> 'plan' OR plan_v = 2)
  AND (steps IS NULL OR (jsonb_typeof(steps) = 'array' AND jsonb_array_length(steps) BETWEEN 1 AND 6))
  AND (lines IS NULL OR (jsonb_typeof(lines) = 'array' AND jsonb_array_length(lines) <= 8))
  AND jsonb_typeof(progress) = 'array' AND jsonb_array_length(progress) <= 6
  AND step_index BETWEEN 0 AND 6);
ALTER TABLE assistant_tasks DROP CONSTRAINT IF EXISTS assistant_tasks_plan_live;
ALTER TABLE assistant_tasks ADD CONSTRAINT assistant_tasks_plan_live
  CHECK (kind <> 'plan' OR status NOT IN ('proposed', 'running', 'asking') OR steps IS NOT NULL);
-- The owner's rule in the database again: no yes before what was found on the Mac came back (the yes is to the sentence
-- and its lines), and no step past the first without the person's yes.
ALTER TABLE assistant_tasks DROP CONSTRAINT IF EXISTS assistant_tasks_yes_after_scope;
ALTER TABLE assistant_tasks ADD CONSTRAINT assistant_tasks_yes_after_scope
  CHECK (NOT needs_scope OR confirmed_at IS NULL OR scoped_at IS NOT NULL);
ALTER TABLE assistant_tasks DROP CONSTRAINT IF EXISTS assistant_tasks_progress_needs_yes;
ALTER TABLE assistant_tasks ADD CONSTRAINT assistant_tasks_progress_needs_yes CHECK (step_index = 0 OR confirmed_at IS NOT NULL);
