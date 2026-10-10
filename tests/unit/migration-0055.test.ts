import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

// Phase 8 (owner decisions, 8 October 2026: screen recording taken out, contract A.6): migration 0055 waits in db/pending
// (never db/migrations, which `pnpm db:migrate` and every test reset apply), starts with the guard that refuses while
// recording data remains, and drops exactly what screen recording left: 7 tables, 3 functions, 6 columns and 1
// constraint. It strips the two plan flags and the recording jobs, and touches nothing else.

const FILE = "0055_remove_screen_recording.sql";
const path = join(process.cwd(), "db/pending", FILE);
const raw = readFileSync(path, "utf8");
const code = raw.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
/** The top-level statements: the DO block as one, then each `;`-terminated statement. */
const statements = (() => {
  const doEnd = code.indexOf("END $$;");
  const guard = code.slice(0, doEnd + "END $$;".length).trim();
  const rest = code.slice(doEnd + "END $$;".length).split(";").map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
  return { guard, rest };
})();
const matching = (re: RegExp) => statements.rest.map((s) => re.exec(s)).filter((m): m is RegExpExecArray => !!m);

describe("migration 0055: screen recording's database objects", () => {
  it("waits in db/pending, never in db/migrations", () => {
    expect(existsSync(path)).toBe(true);
    expect(existsSync(join(process.cwd(), "db/migrations", FILE))).toBe(false);
    expect(readFileSync(join(process.cwd(), "db/pending/README.md"), "utf8")).toMatch(/db:delete-recordings --confirm=<host>\/<database>/);
  });

  it("starts with the guard, which refuses while any recording data remains", () => {
    expect(code.trimStart().startsWith("DO $$")).toBe(true);
    const g = statements.guard;
    for (const t of ["recordings", "recording_chunks", "recording_access_log", "privacy_incidents", "recording_grants", "capture_exceptions", "deletion_tombstones"]) {
      expect(g, t).toContain(`(SELECT count(*) FROM ${t})`);
    }
    expect(g).toMatch(/IF n > 0 THEN\s+RAISE EXCEPTION 'RECORDINGS_REMAIN/);
    expect(g).toMatch(/work_sessions WHERE capture_exception_id IS NOT NULL\) THEN\s+RAISE EXCEPTION 'RECORDINGS_REMAIN/);
    expect(g).toMatch(/jobs WHERE type IN \('recording\.assemble', 'recording\.retention_delete'\) AND state IN \('pending', 'running'\)\) THEN\s+RAISE EXCEPTION 'RECORDINGS_REMAIN/);
    // Safe on a database where the tables are already gone (applied twice).
    expect(g).toContain("IF to_regclass('public.recordings') IS NOT NULL THEN");
  });

  it("drops exactly the 7 tables, 3 functions, 6 columns and 1 constraint, all IF EXISTS", () => {
    expect(matching(/^DROP TABLE IF EXISTS (\w+)$/).map((m) => m[1]).sort()).toEqual(
      ["capture_exceptions", "deletion_tombstones", "privacy_incidents", "recording_access_log", "recording_chunks", "recording_grants", "recordings"]);
    expect(matching(/^DROP FUNCTION IF EXISTS (\w+)\(([^)]*)\)$/).map((m) => `${m[1]}(${m[2].replace(/\s/g, "")})`).sort()).toEqual(
      ["app_can_review_recording(uuid,uuid)", "app_is_privacy_admin(uuid)", "app_recording_in_org(uuid,uuid)"]);
    expect(matching(/^ALTER TABLE (\w+) DROP COLUMN IF EXISTS (\w+)$/).map((m) => `${m[1]}.${m[2]}`).sort()).toEqual(
      ["policies.capture_audio", "policies.recording_mode", "policies.retention_days", "tasks.capture_requirement", "work_sessions.capture_exception_id", "work_sessions.capture_mode"]);
    expect(matching(/^ALTER TABLE (\w+) DROP CONSTRAINT IF EXISTS (\w+)$/).map((m) => `${m[1]}.${m[2]}`)).toEqual(["work_sessions.work_sessions_capture_exception_fk"]);
    // The constraint goes before its column, and both before capture_exceptions.
    const at = (s: string) => statements.rest.findIndex((x) => x.includes(s));
    expect(at("DROP CONSTRAINT IF EXISTS work_sessions_capture_exception_fk")).toBeLessThan(at("DROP COLUMN IF EXISTS capture_exception_id"));
    expect(at("DROP COLUMN IF EXISTS capture_exception_id")).toBeLessThan(at("DROP TABLE IF EXISTS capture_exceptions"));
    expect(at("DROP TABLE IF EXISTS recording_chunks")).toBeLessThan(at("DROP TABLE IF EXISTS recordings"));
  });

  it("does nothing else: the plan flags stripped, the recording jobs deleted, no CASCADE", () => {
    const known = /^(DROP TABLE IF EXISTS \w+|DROP FUNCTION IF EXISTS \w+\([^)]*\)|ALTER TABLE \w+ DROP (COLUMN|CONSTRAINT) IF EXISTS \w+)$/;
    const others = statements.rest.filter((s) => !known.test(s));
    expect(others).toEqual([
      "UPDATE plans SET features = features - 'VIDEO_RECORDING' - 'SCREEN_CAPTURE' WHERE features ?| ARRAY['VIDEO_RECORDING', 'SCREEN_CAPTURE']",
      "UPDATE organisations SET feature_overrides = feature_overrides - 'VIDEO_RECORDING' - 'SCREEN_CAPTURE' WHERE feature_overrides ?| ARRAY['VIDEO_RECORDING', 'SCREEN_CAPTURE']",
      "UPDATE platform_settings SET value = value - 'VIDEO_RECORDING' - 'SCREEN_CAPTURE' WHERE key = 'feature_flags' AND jsonb_typeof(value) = 'object' AND value ?| ARRAY['VIDEO_RECORDING', 'SCREEN_CAPTURE']",
      "DELETE FROM jobs WHERE type IN ('recording.assemble', 'recording.retention_delete')",
    ]);
    expect(code).not.toMatch(/\bCASCADE\b/i);
  });
});
