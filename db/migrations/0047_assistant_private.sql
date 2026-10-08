-- Phase 7a review (review, 8 October 2026). One thing:
-- 1. assistant_private: the person's own time zone, quiet hours and when they last saw the morning opener, in a table
--    only they (and Boredroom's worker) read and write. 0046 put these on assistant_profiles, whose SELECT policy (0035)
--    lets every member of the workspace read every colleague's row: a colleague's sleeping hours, and when they first
--    opened Boredroom each day (an attendance-like signal the app otherwise shows only to leads and HR). Names and
--    looks stay on assistant_profiles, readable by everyone as before.
--    The values already saved move here: copied, then cleared on assistant_profiles (the columns stay, empty, so code
--    deployed before this file keeps working; code after it reads and writes this table only, server/lib/schema-0047).
-- Additive and idempotent: safe to run by hand twice. A new table, its index, trigger and policies (`DROP … IF EXISTS`
-- only on objects this file creates), and a copy that skips rows already here. Not CONCURRENTLY: the runner wraps each
-- file in a transaction. Requires 0046 (applied in order).

CREATE TABLE IF NOT EXISTS assistant_private (
  membership_id    uuid PRIMARY KEY,
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  timezone         text CONSTRAINT assistant_private_timezone_check CHECK (timezone IS NULL OR (char_length(timezone) BETWEEN 1 AND 64 AND timezone ~ '^[A-Za-z0-9_+/-]+$')),
  quiet_start      time,
  quiet_end        time,
  quiet_days       smallint[] NOT NULL DEFAULT '{}'::smallint[],
  opener_seen_at   timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (membership_id, organisation_id) REFERENCES memberships(id, organisation_id),
  CONSTRAINT assistant_private_quiet_check CHECK (
    (quiet_start IS NULL) = (quiet_end IS NULL)
    AND (quiet_start IS NULL OR quiet_start <> quiet_end)
    AND quiet_days <@ '{0,1,2,3,4,5,6}'::smallint[]
    AND (quiet_start IS NULL OR cardinality(quiet_days) BETWEEN 1 AND 7))
);
CREATE INDEX IF NOT EXISTS assistant_private_org_idx ON assistant_private(organisation_id);
DROP TRIGGER IF EXISTS assistant_private_updated ON assistant_private;
CREATE TRIGGER assistant_private_updated BEFORE UPDATE ON assistant_private FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE assistant_private ENABLE ROW LEVEL SECURITY;
-- Only the person reads and writes their own row; the worker reads everyone's (routines run on the person's clock and
-- hold deliveries for their quiet hours). No DELETE.
DROP POLICY IF EXISTS assistant_private_own ON assistant_private;
CREATE POLICY assistant_private_own ON assistant_private FOR ALL
  USING (app_is_worker() OR membership_id = app_membership_id(organisation_id))
  WITH CHECK (app_is_worker() OR membership_id = app_membership_id(organisation_id));
GRANT SELECT, INSERT, UPDATE ON assistant_private TO boardroom_app;
REVOKE DELETE, TRUNCATE ON assistant_private FROM boardroom_app;

-- The values saved under 0046 move here (a row already here is kept as it is), then leave assistant_profiles.
INSERT INTO assistant_private(membership_id, organisation_id, timezone, quiet_start, quiet_end, quiet_days, opener_seen_at)
SELECT membership_id, organisation_id, timezone, quiet_start, quiet_end, quiet_days, opener_seen_at
FROM assistant_profiles
WHERE timezone IS NOT NULL OR quiet_start IS NOT NULL OR opener_seen_at IS NOT NULL OR cardinality(quiet_days) > 0
ON CONFLICT (membership_id) DO NOTHING;

UPDATE assistant_profiles SET timezone = NULL, quiet_start = NULL, quiet_end = NULL, quiet_days = '{}'::smallint[], opener_seen_at = NULL
WHERE timezone IS NOT NULL OR quiet_start IS NOT NULL OR opener_seen_at IS NOT NULL OR cardinality(quiet_days) > 0;
