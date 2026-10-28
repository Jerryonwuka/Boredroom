/**
 * Migration 0066 (Brenda's research in the background; owner decision, 28 October 2026), read as text: it waits in
 * db/pending (never db/migrations), holds exactly what the code knows (formats, statuses, the ledger's purposes), keeps
 * the person's rows to them and the worker, never touches a role, and does not depend on 0065.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { USAGE_PURPOSES } from "@/server/services/ai-usage";
import { RESEARCH_FORMATS, RESEARCH_STATUSES } from "@/lib/research";

const file = join(process.cwd(), "db", "pending", "0066_research.sql");
const code = readFileSync(file, "utf8").split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
const listed = (re: RegExp) => re.exec(code)?.[1].split(",").map((s) => s.trim().replace(/^'|'$/g, ""));

describe("0066_research.sql", () => {
  it("waits in db/pending, not db/migrations", () => {
    expect(existsSync(join(process.cwd(), "db", "migrations", "0066_research.sql"))).toBe(false);
  });
  it("lists the formats, the statuses and every ledger purpose the code knows", () => {
    expect(listed(/research_reports_format_check CHECK \(format IN \(([^)]*)\)\)/)).toEqual([...RESEARCH_FORMATS]);
    expect(listed(/research_reports_status_check\s+CHECK \(status IN \(([^)]*)\)\)/)).toEqual([...RESEARCH_STATUSES]);
    expect(listed(/ai_usage_purpose_check\s+CHECK \(purpose IN \(([^)]*)\)\)/)).toEqual([...USAGE_PURPOSES]);
  });
  it("the person alone and the worker, by row security; the app role's grants and no TRUNCATE", () => {
    expect(code).toMatch(/ALTER TABLE research_reports ENABLE ROW LEVEL SECURITY/);
    expect(code).toMatch(/USING \(app_is_worker\(\) OR membership_id = app_membership_id\(organisation_id\)\)/);
    expect(code).toMatch(/WITH CHECK \(app_is_worker\(\) OR membership_id = app_membership_id\(organisation_id\)\)/);
    expect(code).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE ON research_reports TO boardroom_app/);
    expect(code).toMatch(/REVOKE TRUNCATE ON research_reports FROM boardroom_app/);
  });
  it("is idempotent, never touches a role, and needs nothing from 0065", () => {
    expect(code).not.toMatch(/ALTER ROLE|CREATE ROLE|PASSWORD/i);
    expect(code).not.toMatch(/organisation_secrets|organisation_voice_secrets/);
    expect(code).toMatch(/CREATE TABLE IF NOT EXISTS research_reports/);
    expect(code).toMatch(/DROP POLICY IF EXISTS research_reports_own/);
    expect(code).toMatch(/DROP CONSTRAINT IF EXISTS ai_usage_purpose_check/);
  });
  it("keeps reports 90 days", () => {
    expect(code).toMatch(/expires_at\s+timestamptz NOT NULL DEFAULT now\(\) \+ interval '90 days'/);
  });
});
