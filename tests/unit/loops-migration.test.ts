import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { USAGE_PURPOSES } from "@/server/services/ai-usage";
import { AUTHOR_KINDS } from "@/server/services/messaging";
import { ROUTINE_TEMPLATES } from "@/lib/routines";
import { COMMITMENT_KINDS, COMMITMENT_STATUSES, LOOSE_END_KINDS, LOOP_LIMITS } from "@/lib/commitments";

// Phase 7b (owner decisions, 8 October 2026: "Brenda keeps the loops closed", second part): migration 0048 holds exactly
// what the code knows, only adds, and replaces four objects keeping their old semantics plus the change (old text: 0041
// for ai_usage_purpose_check, 0046 for routines_template_check, 0037 for messages_author_kind_check and
// messages_guard_author_kind()).

const read = (f: string) => readFileSync(join(process.cwd(), "db/migrations", f), "utf8");
const strip = (sql: string) => sql.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
const code = strip(read("0048_loops_closed.sql"));
/** The statements outside function bodies (a definer's UPDATE is its job, not a data rewrite). */
const outside = code.replace(/\$\$[\s\S]*?\$\$/g, "$$ … $$");
const listedIn = (src: string, re: RegExp) => re.exec(src)?.[1].split(",").map((s) => s.trim().replace(/^'|'$/g, ""));
const listed = (re: RegExp) => listedIn(code, re);
const fn = (src: string, name: string) => new RegExp(`CREATE OR REPLACE FUNCTION ${name}\\(\\)[\\s\\S]*?END \\$\\$;`).exec(src)?.[0] ?? "";

describe("migration 0048: the database holds exactly what the code knows", () => {
  it("lists the ledger's purposes, the routine templates and the authors of a message", () => {
    expect(listed(/ai_usage_purpose_check\s+CHECK \(purpose IN \(([^)]*)\)\)/)).toEqual([...USAGE_PURPOSES]);
    expect(listed(/routines_template_check\s+CHECK \(template IN \(([^)]*)\)\)/)).toEqual([...ROUTINE_TEMPLATES]);
    expect(listed(/messages_author_kind_check CHECK \(author_kind IN \(([^)]*)\)\)/)).toEqual([...AUTHOR_KINDS]);
  });

  it("lists the commitment and loose-end kinds and statuses of lib/commitments", () => {
    expect(listed(/commitments_kind_check CHECK \(kind IN \(([^)]*)\)\)/)).toEqual([...COMMITMENT_KINDS]);
    expect(listed(/commitments_status_check\s+CHECK \(status IN \(([^)]*)\)\)/)).toEqual([...COMMITMENT_STATUSES]);
    expect(listed(/loose_ends_kind_check CHECK \(kind IN \(([^)]*)\)\)/)).toEqual([...LOOSE_END_KINDS]);
    expect(code).toMatch(new RegExp(`char_length\\(decline_reason\\) BETWEEN 1 AND ${LOOP_LIMITS.declineReasonMax}`));
    expect(code).toMatch(new RegExp(`char_length\\(question\\) BETWEEN 1 AND ${LOOP_LIMITS.questionMax}`));
    expect(code).toMatch(new RegExp(`char_length\\(answer\\) BETWEEN 1 AND ${LOOP_LIMITS.answerMax}`));
  });
});

describe("migration 0048: replaced objects keep their old semantics plus the change", () => {
  it("widens each list by exactly the new values, in the old order", () => {
    const old = (f: string, re: RegExp) => listedIn(strip(read(f)), re) ?? [];
    expect(listed(/ai_usage_purpose_check\s+CHECK \(purpose IN \(([^)]*)\)\)/)).toEqual([...old("0041_assistant_mentions.sql", /ai_usage_purpose_check CHECK \(purpose IN \(([^)]*)\)\)/), "loose_ends", "commitments"]);
    expect(listed(/routines_template_check\s+CHECK \(template IN \(([^)]*)\)\)/)).toEqual([...old("0046_routines.sql", /routines_template_check CHECK \(template IN \(([^)]*)\)\)/), "loose_ends"]);
    expect(listed(/messages_author_kind_check CHECK \(author_kind IN \(([^)]*)\)\)/)).toEqual([...old("0037_assistant_catch_up.sql", /messages_author_kind_check CHECK \(author_kind IN \(([^)]*)\)\)/), "workspace"]);
  });

  it("holds a 'workspace' message exactly like an 'assistant' one, and changes nothing else in the guard", () => {
    const before = fn(strip(read("0037_assistant_catch_up.sql")), "messages_guard_author_kind");
    const after = fn(code, "messages_guard_author_kind");
    expect(before).not.toBe("");
    expect(after.replace(/IN \('assistant', 'workspace'\)/g, "= 'assistant'")).toBe(before);
  });
});

describe("migration 0048 only adds", () => {
  it("drops no table, rewrites or deletes no data, touches no role or password", () => {
    expect(code).not.toMatch(/\bDROP\s+(TABLE|COLUMN|FUNCTION|INDEX)\b/i);
    expect(outside).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(outside).not.toMatch(/\bUPDATE\s+\w+\s+SET\b/i);
    expect(code).not.toMatch(/^\s*TRUNCATE\b/im);
    expect(code).not.toMatch(/\bALTER\s+(ROLE|USER)\b/i);
    expect(code).not.toMatch(/\bPASSWORD\b/i);
    expect(code).not.toMatch(/\bCONCURRENTLY\b/i);
  });

  it("can run twice: every table, index, policy, trigger and constraint is created again safely", () => {
    expect(code).not.toMatch(/CREATE TABLE (?!IF NOT EXISTS)/);
    expect(code).not.toMatch(/CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/);
    expect(code).not.toMatch(/CREATE FUNCTION/);
    expect(code).not.toMatch(/ADD COLUMN (?!IF NOT EXISTS)/);
    for (const [, name] of code.matchAll(/CREATE POLICY (\w+) ON (\w+)/g)) expect(code).toMatch(new RegExp(`DROP POLICY IF EXISTS ${name} ON `));
    for (const [, name] of code.matchAll(/CREATE TRIGGER (\w+)/g)) expect(code).toMatch(new RegExp(`DROP TRIGGER IF EXISTS ${name} ON `));
    for (const [, name] of code.matchAll(/ADD CONSTRAINT (\w+)/g)) expect(code).toMatch(new RegExp(`DROP CONSTRAINT IF EXISTS ${name};`));
  });

  it("starts every switch off except the conversation's own (the workspace switch is the master)", () => {
    expect(code).toMatch(/brenda_settings ADD COLUMN IF NOT EXISTS track_commitments boolean NOT NULL DEFAULT false;/);
    expect(code).toMatch(/brenda_settings ADD COLUMN IF NOT EXISTS commitment_thread_followups boolean NOT NULL DEFAULT false;/);
    expect(code).toMatch(/conversations ADD COLUMN IF NOT EXISTS track_commitments boolean NOT NULL DEFAULT true;/);
  });

  it("gives the app role no DELETE on what people answer, and the definers to the app role only", () => {
    for (const t of ["commitments", "commitment_scan_cursors", "loose_ends", "task_blocks", "replan_proposals"]) {
      expect(code).toMatch(new RegExp(`REVOKE DELETE, TRUNCATE ON ${t} FROM boardroom_app;`));
    }
    expect(code).toMatch(/REVOKE UPDATE, DELETE, TRUNCATE ON loose_end_dismissals FROM boardroom_app;/);
    for (const [, name] of code.matchAll(/CREATE OR REPLACE FUNCTION (app_\w+)\(/g)) {
      expect(code).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION ${name}\\([^)]*\\) TO boardroom_app;`));
    }
  });
});
