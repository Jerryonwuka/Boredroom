import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { ASSISTANT_SPEAK, DEFAULT_PROFILES, DEFAULT_SPEAK, isAssistantSpeak, toSpeak } from "@/lib/assistant-look";
import { assistantSpeakSchema } from "@/server/services/assistant-profile";

// Her voice (owner decision, 7 October 2026: personal assistants, phase 2): when the person's own assistant reads replies
// aloud. Stored values are read leniently (anything unknown, or nothing before migration 0036, is "voice"); what a save
// sends is checked strictly at the door with one plain message.

const PICK = "Pick when your assistant speaks.";

describe("when the assistant speaks", () => {
  it("has three choices, and 'When I talk to her' is the default", () => {
    expect(ASSISTANT_SPEAK).toEqual(["voice", "always", "never"]);
    expect(DEFAULT_SPEAK).toBe("voice");
    expect(DEFAULT_PROFILES.speak).toBe("voice");
  });

  it.each(["voice", "always", "never"])("knows %s", (v) => {
    expect(isAssistantSpeak(v)).toBe(true);
    expect(toSpeak(v)).toBe(v);
  });

  it.each([["Always"], ["VOICE"], [" never"], ["loud"], [""], [null], [undefined], [1], [true], [{}], [["always"]]])("reads %j as the default", (v) => {
    expect(isAssistantSpeak(v)).toBe(false);
    expect(toSpeak(v)).toBe("voice");
  });
});

describe("what a save may send", () => {
  it.each(["voice", "always", "never"])("accepts %s", (speak) => {
    expect(assistantSpeakSchema.parse({ speak })).toEqual({ speak });
  });

  it("keeps only the choice", () => {
    expect(assistantSpeakSchema.parse({ speak: "never", name: "Max", setupDone: true })).toEqual({ speak: "never" });
  });

  it.each([["Always"], ["loud"], [""], [null], [1], [["always"]]])("refuses %j with one plain message", (speak) => {
    const r = assistantSpeakSchema.safeParse({ speak });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => [i.path.join("."), i.message])).toEqual([["speak", PICK]]);
  });

  it("refuses a missing choice with the same message", () => {
    const r = assistantSpeakSchema.safeParse({});
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => [i.path.join("."), i.message])).toEqual([["speak", PICK]]);
  });
});

describe("migration 0036", () => {
  const sql = readFileSync(join(process.cwd(), "db/migrations/0036_assistant_voice.sql"), "utf8");
  const code = sql.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");

  it("lets the database hold exactly the choices the code knows, with the same default", () => {
    const listed = /CHECK \(speak IN \(([^)]*)\)\)/.exec(code)?.[1].split(",").map((s) => s.trim().replace(/^'|'$/g, ""));
    expect(listed).toEqual([...ASSISTANT_SPEAK]);
    expect(code).toMatch(new RegExp(`DEFAULT '${DEFAULT_SPEAK}'`));
  });

  it("is additive and idempotent: one column, added only if missing, and nothing else", () => {
    expect(code).toMatch(/ADD COLUMN IF NOT EXISTS speak\b/);
    expect(code).not.toMatch(/\b(DROP|DELETE|UPDATE|TRUNCATE|GRANT|REVOKE|ROLE|PASSWORD|POLICY|INSERT)\b/i);
    expect(code.split(";").filter((s) => s.trim())).toHaveLength(1);
  });
});
