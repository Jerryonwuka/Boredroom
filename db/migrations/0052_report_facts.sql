-- The end-of-day report's counts for the notch (owner decision, 9 October 2026: notch notifications, "A plus the grafts": the
-- team report card shows its numbers as chips, "0h logged, 0 finished, 8 overdue, 2 didn't clock in"). One nullable column on
-- brenda_report_log, written with the snapshot when the report is written; 0030's policies already cover it (the recipient
-- reads and writes their own row). Additive and idempotent: safe to run by hand twice. Code deployed before this runs reads
-- the counts from the snapshot instead (server/lib/schema-0052).
ALTER TABLE brenda_report_log ADD COLUMN IF NOT EXISTS facts jsonb;
ALTER TABLE brenda_report_log DROP CONSTRAINT IF EXISTS brenda_report_log_facts_check;
ALTER TABLE brenda_report_log ADD CONSTRAINT brenda_report_log_facts_check
  CHECK (facts IS NULL OR (jsonb_typeof(facts) = 'object' AND octet_length(facts::text) <= 16384));
