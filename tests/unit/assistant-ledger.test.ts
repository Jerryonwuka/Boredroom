import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { AI_BURST, AI_BURST_MESSAGE, AI_DAILY_REQUEST_LIMIT, LIMITED_PURPOSES, USAGE_PURPOSES, newRequestId } from "@/server/services/ai-usage";
import { AUTHOR_KINDS } from "@/server/services/messaging";
import { ACTIVITY_KINDS, activityQuerySchema } from "@/server/services/assistant-activity";
import { CATCH_UP_LIMITS, readConversationSchema, searchMessagesSchema } from "@/server/services/catch-up";

// Personal assistants, phase 3 (owner decision, 8 October 2026): the database holds exactly what the code knows (who wrote
// a message, the activity log's sources, the ledger's purposes), migration 0037 only adds, and the inputs the server takes
// for catch-up and the Activity list are checked at the door.

const sql = readFileSync(join(process.cwd(), "db/migrations/0037_assistant_catch_up.sql"), "utf8");
/** The statements without their comments, so words in the explanations ("Nothing updates or deletes a row") do not count. */
const code = sql.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
const listed = (re: RegExp) => re.exec(code)?.[1].split(",").map((s) => s.trim().replace(/^'|'$/g, ""));

describe("migration 0037", () => {
  it("lets the database hold exactly the purposes the ledger records (0039 adds 'followup' after it)", () => {
    // Personal assistants, phase 4 (owner decision, 8 October 2026): 0039 widens the same CHECK with 'followup'; its own
    // list is checked against USAGE_PURPOSES in follow-ups-lib.test.ts.
    expect(listed(/ai_usage_purpose_check CHECK \(purpose IN \(([^)]*)\)\)/)).toEqual(USAGE_PURPOSES.filter((p) => p !== "followup"));
  });

  it("lets a message be written by exactly the kinds of author the code knows, the person by default", () => {
    expect(listed(/messages_author_kind_check CHECK \(author_kind IN \(([^)]*)\)\)/)).toEqual([...AUTHOR_KINDS]);
    expect(code).toMatch(/ADD COLUMN IF NOT EXISTS author_kind text NOT NULL DEFAULT 'person'/);
  });

  it("adds 'read' to the activity log's sources and keeps the three it had", () => {
    expect(listed(/brenda_actions_source_check CHECK \(source IN \(([^)]*)\)\)/)).toEqual(["chat", "confirm", "automatic", "read"]);
  });

  it("only adds: no dropped tables, no data rewritten or deleted, no roles, no grants beyond the new table", () => {
    expect(code).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(code).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(code).not.toMatch(/\bUPDATE\s+\w+\s+SET\b/i);
    expect(code).not.toMatch(/^\s*TRUNCATE\b/im);
    expect(code).not.toMatch(/\bALTER\s+(ROLE|USER)\b/i);
    expect(code).not.toMatch(/\bPASSWORD\b/i);
    const grants = code.match(/\bGRANT\b[^;]*;/gi) ?? [];
    expect(grants).toEqual(["GRANT SELECT, INSERT ON ai_usage TO boardroom_app;"]);
    // The one revoke takes the default UPDATE and DELETE (0005) off the new ledger, nothing else.
    expect(code.match(/\bREVOKE\b[^;]*;/gi) ?? []).toEqual(["REVOKE UPDATE, DELETE, TRUNCATE ON ai_usage FROM boardroom_app;"]);
    // Every policy, trigger, constraint and object can be created again: the file is safe to run twice.
    for (const [, name] of code.matchAll(/CREATE POLICY (\w+)/g)) expect(code).toMatch(new RegExp(`DROP POLICY IF EXISTS ${name} `));
    for (const [, name] of code.matchAll(/CREATE TRIGGER (\w+)/g)) expect(code).toMatch(new RegExp(`DROP TRIGGER IF EXISTS ${name} `));
    for (const [, name] of code.matchAll(/ADD CONSTRAINT (\w+)/g)) expect(code).toMatch(new RegExp(`DROP CONSTRAINT IF EXISTS ${name};`));
    expect(code).toMatch(/CREATE TABLE IF NOT EXISTS ai_usage/);
    expect(code).not.toMatch(/CREATE TABLE (?!IF NOT EXISTS)/);
    expect(code).not.toMatch(/CREATE INDEX (?!IF NOT EXISTS)/);
    expect(code).not.toMatch(/CREATE FUNCTION/);
  });

  it("gives the ledger no way to change a row: no UPDATE or DELETE policy or grant, and the default ones revoked", () => {
    expect(code).not.toMatch(/ON ai_usage FOR (UPDATE|DELETE|ALL)/);
    expect(code).not.toMatch(/GRANT[^;]*(UPDATE|DELETE)[^;]*ai_usage/);
    expect(code).toMatch(/REVOKE UPDATE, DELETE, TRUNCATE ON ai_usage FROM boardroom_app;/);
  });
});

describe("the limits", () => {
  it("are the owner's: 150 requests a day for chat, the to-do planner and follow-ups, 20 a minute in bursts", () => {
    expect(AI_DAILY_REQUEST_LIMIT).toBe(150);
    // Phase 4 (owner decision, 8 October 2026): a follow-up ask counts against the requester's allowance, once per batch.
    expect([...LIMITED_PURPOSES]).toEqual(["chat", "plan", "report", "followup"]);
    expect(AI_BURST).toEqual({ requests: 20, windowSeconds: 60 });
    expect(AI_BURST_MESSAGE).toBe("That's a lot of requests in one minute. Wait a moment, then try again.");
  });

  it("gives every request its own id", () => {
    const a = newRequestId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(newRequestId()).not.toBe(a);
  });
});

describe("what catch-up takes", () => {
  it("reads the unread messages by default, and checks the rest", () => {
    expect(readConversationSchema.parse({ conversation: " #design " })).toEqual({ conversation: "#design", mode: "unread" });
    expect(readConversationSchema.parse({ conversation: "design", mode: "last", last: 30 })).toMatchObject({ mode: "last", last: 30 });
    expect(readConversationSchema.safeParse({ conversation: "design", mode: "last", last: 201 }).success).toBe(false);
    expect(readConversationSchema.safeParse({ conversation: "" }).success).toBe(false);
    expect(readConversationSchema.safeParse({ conversation: "design", mode: "since", since: "yesterday" }).success).toBe(false);
    expect(readConversationSchema.safeParse({ conversation: "design", mode: "since", since: "2026-10-06T09:00:00+01:00" }).success).toBe(true);
  });

  it("searches by words or by person, never by nothing", () => {
    expect(searchMessagesSchema.parse({ q: "landing page" })).toEqual({ q: "landing page", days: 90 });
    expect(searchMessagesSchema.parse({ from: "Ben" })).toEqual({ from: "Ben", days: 90 });
    for (const bad of [{}, { q: "a" }, { q: "  " }, { conversation: "design" }]) {
      const r = searchMessagesSchema.safeParse(bad);
      expect(r.success, JSON.stringify(bad)).toBe(false);
      expect(r.error?.issues[0].message).toBe("Give words to look for, or whose messages.");
    }
    expect(searchMessagesSchema.safeParse({ q: "x".repeat(101) }).success).toBe(false);
    expect(searchMessagesSchema.safeParse({ q: "ok", days: 366 }).success).toBe(false);
  });

  it("keeps the caps the contract names", () => {
    expect(CATCH_UP_LIMITS).toMatchObject({ messages: 200, chars: 12_000, bodyChars: 2_000, contextWhenNothingNew: 10, searchResults: 30, searchDays: 90, digestConversations: 5, digestLines: 3 });
  });
});

describe("the Activity list's query", () => {
  it("defaults to everything, 30 at a time, and reads the limit from the address", () => {
    expect([...ACTIVITY_KINDS]).toEqual(["all", "actions", "reads", "problems"]);
    expect(activityQuerySchema.parse({})).toEqual({ kind: "all", limit: 30 });
    expect(activityQuerySchema.parse({ kind: "reads", limit: "5", cursor: "abc" })).toEqual({ kind: "reads", limit: 5, cursor: "abc" });
  });

  it.each([[{ kind: "everything" }], [{ limit: "0" }], [{ limit: "51" }], [{ limit: "ten" }], [{ cursor: "x".repeat(201) }]])("refuses %j", (q) => {
    expect(activityQuerySchema.safeParse(q).success).toBe(false);
  });
});
