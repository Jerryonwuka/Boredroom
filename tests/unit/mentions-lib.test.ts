import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MENTION_LIMITS, MENTION_NOTE_CODES, MENTION_STATUSES, MENTION_WORDS, assistantLabels, findLabel, findLabelAll, mentionNote, mentionQueryAt, splitMentions,
  type MentionRef, type MentionToken,
} from "@/lib/mentions";
import { validateMentions } from "@/server/services/mentions";

// @mentions in Messages (owner decision, 8 October 2026: personal assistants, phase 5): the pure text helpers the
// composer, the thread and the server share, the server's check of the composer's tokens, the fixed words, and the
// migration that holds the queue.

const BEN = "b0000000-0000-4000-8000-000000000001";
const ADA = "a0000000-0000-4000-8000-000000000002";
const OLU = "c0000000-0000-4000-8000-000000000003";
const ZED = "d0000000-0000-4000-8000-000000000004";
const people = [{ membershipId: BEN, name: "Ben Okafor" }, { membershipId: ADA, name: "Ada Obi" }];
const who = { ownAssistantName: "Max", people, selfMembershipId: OLU };

describe("findLabel", () => {
  it("finds a whole mention, case-insensitively, at the start, after spaces and punctuation", () => {
    expect(findLabel("@Ben Okafor can you look?", "@Ben Okafor")).toBe(0);
    expect(findLabel("thanks @ben okafor!", "@Ben Okafor")).toBe(7);
    expect(findLabel("(@Max) what's left?", "@Max")).toBe(1);
    expect(findLabel("“@Max”, please", "@Max")).toBe(1);
    expect(findLabel("Ask @Max's view", "@Max")).toBe(4);
    expect(findLabel("@MAX", "@Max")).toBe(0);
  });

  it("refuses a label inside a word, an address, a longer name or after another @ or _", () => {
    expect(findLabel("mail@Ben Okafor", "@Ben Okafor")).toBe(-1);
    expect(findLabel("@Ben Okafors", "@Ben Okafor")).toBe(-1);
    expect(findLabel("@Maxine", "@Max")).toBe(-1);
    expect(findLabel("@@Max", "@Max")).toBe(-1);
    expect(findLabel("a_@Max", "@Max")).toBe(-1);
    expect(findLabel("@Max2", "@Max")).toBe(-1);
    expect(findLabel("no mention here", "@Max")).toBe(-1);
    expect(findLabel("", "@Max")).toBe(-1);
  });

  it("treats accents as letters and emoji as boundaries", () => {
    expect(findLabel("@Zoë Adé", "@Zoë Adé")).toBe(0);
    expect(findLabel("@zoë adé, hi", "@Zoë Adé")).toBe(0);
    expect(findLabel("@Zoë Adéx", "@Zoë Adé")).toBe(-1);
    expect(findLabel("éa@Max", "@Max")).toBe(-1);
    expect(findLabel("🎉@Max🎉", "@Max")).toBe(2);
    expect(findLabel("👋 @Ben Okafor👍", "@Ben Okafor")).toBe(3);
  });

  it("finds every place a label stands", () => {
    expect(findLabelAll("@Max and @max again, mail@Max", "@Max")).toEqual([0, 9]);
  });
});

describe("findLabel with characters a pattern would read (fixer pass, 8 October 2026)", () => {
  it("matches them as typed, overlapping places included", () => {
    expect(findLabel("x @a.b+(c) y", "@a.b+(c)")).toBe(2);
    expect(findLabel("x @aXb+(c) y", "@a.b+(c)")).toBe(-1);
    expect(findLabel("hi @Jean-Paul!", "@Jean-Paul")).toBe(3);
    expect(findLabel("hi @jean-paul", "@Jean-Paul")).toBe(3);
    expect(findLabelAll("@a @a @a", "@a @a")).toEqual([0, 3]);
  });
});

describe("splitMentions", () => {
  const ben: MentionRef = { kind: "person", membershipId: BEN, label: "@Ben Okafor" };
  const benShort: MentionRef = { kind: "person", membershipId: ADA, label: "@Ben" };
  const max: MentionRef = { kind: "assistant", membershipId: OLU, label: "@Max" };

  it("cuts the body into text and mention pieces, in order", () => {
    expect(splitMentions("@Max ask @Ben Okafor now", [max, ben])).toEqual([
      { text: "@Max", ref: max }, { text: " ask " }, { text: "@Ben Okafor", ref: ben }, { text: " now" },
    ]);
  });

  it("lets the longest label win where two overlap", () => {
    expect(splitMentions("hi @Ben Okafor and @Ben", [benShort, ben])).toEqual([
      { text: "hi " }, { text: "@Ben Okafor", ref: ben }, { text: " and " }, { text: "@Ben", ref: benShort },
    ]);
  });

  it("marks a repeated label each time, keeps the body's own spelling, and leaves plain text alone", () => {
    expect(splitMentions("@max, then @MAX", [max])).toEqual([{ text: "@max", ref: max }, { text: ", then " }, { text: "@MAX", ref: max }]);
    expect(splitMentions("nothing to see", [max])).toEqual([{ text: "nothing to see" }]);
    expect(splitMentions("", [max])).toEqual([{ text: "" }]);
    expect(splitMentions("mail@Max", [max])).toEqual([{ text: "mail@Max" }]);
  });
});

describe("mentionQueryAt", () => {
  it("opens at the start, after a space, a bracket or a quote", () => {
    expect(mentionQueryAt("@Ma", 3)).toEqual({ start: 0, query: "Ma" });
    expect(mentionQueryAt("hi @Be", 6)).toEqual({ start: 3, query: "Be" });
    expect(mentionQueryAt("(@Be", 4)).toEqual({ start: 1, query: "Be" });
    expect(mentionQueryAt("“@Be", 4)).toEqual({ start: 1, query: "Be" });
    expect(mentionQueryAt("'@Be", 4)).toEqual({ start: 1, query: "Be" });
    expect(mentionQueryAt("hi @", 4)).toEqual({ start: 3, query: "" });
    expect(mentionQueryAt("@Ben Ok", 7)).toEqual({ start: 0, query: "Ben Ok" });
  });

  it("stays shut inside a word, past two spaces, a line break or 40 characters, and on '@ '", () => {
    expect(mentionQueryAt("mail@Be", 7)).toBeNull();
    expect(mentionQueryAt("@Ben Oka fo", 11)).toBeNull();
    expect(mentionQueryAt("@Ben\nOk", 7)).toBeNull();
    expect(mentionQueryAt(`@${"a".repeat(40)}`, 41)).toEqual({ start: 0, query: "a".repeat(40) });
    expect(mentionQueryAt(`@${"a".repeat(41)}`, 42)).toBeNull();
    expect(mentionQueryAt("meet @ 5", 8)).toBeNull();
    expect(mentionQueryAt("no at here", 5)).toBeNull();
    expect(mentionQueryAt("@Max", 0)).toBeNull();
  });

  it("reads only up to the caret", () => {
    expect(mentionQueryAt("@Ben Okafor is here", 4)).toEqual({ start: 0, query: "Ben" });
  });
});

describe("assistantLabels", () => {
  it("is the assistant's name first, then @assistant, once each", () => {
    expect(assistantLabels("Max")).toEqual(["@Max", "@assistant"]);
    expect(assistantLabels("Brenda")).toEqual(["@Brenda", "@assistant"]);
    expect(assistantLabels("Assistant")).toEqual(["@Assistant"]);
    expect(assistantLabels("R2 D2")).toEqual(["@R2 D2", "@assistant"]);
  });
});

describe("validateMentions", () => {
  const t = (...tokens: MentionToken[]) => tokens;

  it("keeps the sender's own assistant, by name or as @assistant, and the body's spelling", () => {
    expect(validateMentions("@max what's left?", t({ kind: "assistant", label: "@Max" }), who)).toEqual({ assistant: { label: "@max" }, people: [] });
    expect(validateMentions("hey @assistant", t({ kind: "assistant", label: "@assistant" }), who)).toEqual({ assistant: { label: "@assistant" }, people: [] });
  });

  it("refuses someone else's assistant, a label not in the body, and keeps one assistant only", () => {
    expect(validateMentions("@Juno what's Ben on?", t({ kind: "assistant", label: "@Juno" }), who).assistant).toBeNull();
    expect(validateMentions("@Brenda hi", t({ kind: "assistant", label: "@Brenda" }), who).assistant).toBeNull();
    expect(validateMentions("what's left?", t({ kind: "assistant", label: "@Max" }), who).assistant).toBeNull();
    expect(validateMentions("@Max and @assistant", t({ kind: "assistant", label: "@Max" }, { kind: "assistant", label: "@assistant" }), who)).toEqual({ assistant: { label: "@Max" }, people: [] });
    expect(validateMentions("@Brenda hi", t({ kind: "assistant", label: "@Brenda" }), { ...who, ownAssistantName: "Brenda" }).assistant).toEqual({ label: "@Brenda" });
  });

  it("keeps people who read the conversation under their own name, and drops the rest", () => {
    const body = "@Ben Okafor and @ada obi, not @Zed Last or me @Olu";
    const r = validateMentions(body, t(
      { kind: "person", membershipId: BEN, label: "@Ben Okafor" },
      { kind: "person", membershipId: ADA, label: "@Ada Obi" },
      { kind: "person", membershipId: ZED, label: "@Zed Last" },   // not a reader
      { kind: "person", membershipId: OLU, label: "@Olu" },        // the sender
      { kind: "person", membershipId: BEN, label: "@Ben Okafor" }, // twice
    ), who);
    expect(r.people).toEqual([{ membershipId: BEN, label: "@Ben Okafor" }, { membershipId: ADA, label: "@ada obi" }]);
    expect(r.assistant).toBeNull();
  });

  it("drops a wrong label for the id, and a label that is not in the body", () => {
    expect(validateMentions("@Ada Obi hi", t({ kind: "person", membershipId: BEN, label: "@Ada Obi" }), who).people).toEqual([]);
    expect(validateMentions("Ben, hi", t({ kind: "person", membershipId: BEN, label: "@Ben Okafor" }), who).people).toEqual([]);
    expect(validateMentions("mail@Ben Okafor", t({ kind: "person", membershipId: BEN, label: "@Ben Okafor" }), who).people).toEqual([]);
  });

  it("keeps at most 20 people", () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ membershipId: `e0000000-0000-4000-8000-${String(i).padStart(12, "0")}`, name: `Person ${String.fromCharCode(65 + i)}` }));
    const body = many.map((p) => `@${p.name}`).join(" ");
    const r = validateMentions(body, many.map((p) => ({ kind: "person" as const, membershipId: p.membershipId, label: `@${p.name}` })), { ownAssistantName: "Max", people: many });
    expect(r.people).toHaveLength(20);
    expect(MENTION_LIMITS.tokensPerMessage).toBe(20);
  });
});

describe("words", () => {
  it("has a note for every code, with the person's own assistant's name", () => {
    expect(MENTION_NOTE_CODES.map((c) => mentionNote(c, "Max"))).toEqual([
      "Assistant replies in Messages are off in this workspace. Ask Max in your own chat instead.",
      "Assistants can't reply in this conversation. Ask Max in your own chat instead.",
      "This conversation is archived, so Max kept the answer for you.",
      "That's a lot of questions in one minute. Wait a moment, then ask again.",
      "You've asked Max in Messages a lot today. Ask again tomorrow, or in your own chat.",
      "Max has answered a lot here in the last hour. Ask again later, or in your own chat.",
      "Assistants have answered a lot in Messages today. Ask again tomorrow, or in your own chat.",
      "You've used today's 150 requests to Max, so the built-in helper answered. Max can act for you again tomorrow.",
      "Max can't answer that here without the AI connected.",
      "Max couldn't answer: you can't read this conversation any more.",
      "Max couldn't answer this time. Ask again, or ask in your own chat.",
    ]);
  });

  it("says the thread's and the composer's lines in plain words", () => {
    expect(MENTION_WORDS.thinking("Max")).toBe("Max is thinking…");
    expect(MENTION_WORDS.waiting("Olu")).toBe("Waiting for Olu to confirm");
    expect(MENTION_WORDS.post(false)).toBe("Post to channel");
    expect(MENTION_WORDS.post(true)).toBe("Post to chat");
    expect(MENTION_WORDS.withdrawTitle("Max")).toBe("Withdraw Max's reply?");
    expect(MENTION_WORDS.suggestions(1)).toBe("1 suggestion. Up and down to choose, Enter to insert.");
    expect(MENTION_WORDS.suggestions(3)).toBe("3 suggestions. Up and down to choose, Enter to insert.");
    expect(MENTION_WORDS.composerHint("Max")).toBe("Max replies here for everyone to see. Anything only you can see stays private to you.");
    expect(MENTION_WORDS.badge("Olu", false)).toBe("Olu's assistant");
    expect(MENTION_WORDS.badge("Olu", true)).toBe("Your assistant");
  });
});

// ---- Migration 0041: the database holds exactly what the code knows, and only adds -------------------------------------

const sql = readFileSync(join(process.cwd(), "db/migrations/0041_assistant_mentions.sql"), "utf8");
const code = sql.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
const outside = code.replace(/\$\$[\s\S]*?\$\$/g, "$$ … $$");
const listed = (re: RegExp) => re.exec(code)?.[1].split(",").map((s) => s.trim().replace(/^'|'$/g, ""));

describe("migration 0041", () => {
  it("lists exactly the statuses, note codes and purposes the code knows", () => {
    expect(listed(/assistant_mentions_status_check\s+CHECK \(status IN \(([^)]*)\)\)/)).toEqual([...MENTION_STATUSES]);
    expect(listed(/assistant_mention_private_note_check CHECK \(note_code IS NULL OR note_code IN \(([^)]*)\)\)/)?.map((s) => s.replace(/\s+/g, ""))).toEqual([...MENTION_NOTE_CODES]);
    expect(listed(/ai_usage_purpose_check CHECK \(purpose IN \(([^)]*)\)\)/)).toEqual(["chat", "plan", "report", "summary", "test", "other", "followup", "mention"]);
    expect(code).toMatch(new RegExp(`char_length\\(body\\) BETWEEN 1 AND ${MENTION_LIMITS.privateChars}`));
  });

  it("only adds: no dropped tables, no rows rewritten or deleted, no roles or passwords, no policy replaced", () => {
    expect(outside).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(outside).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(outside).not.toMatch(/\bUPDATE\s+\w+\s+SET\b/i);
    expect(outside).not.toMatch(/^\s*TRUNCATE\b/im);
    expect(code).not.toMatch(/\bALTER\s+(ROLE|USER)\b/i);
    expect(code).not.toMatch(/\bPASSWORD\b/i);
    // Every policy it drops is one it creates, on its own new tables.
    for (const m of outside.matchAll(/\bDROP POLICY IF EXISTS (\w+) ON (\w+)/gi)) {
      expect(["message_mentions", "assistant_mentions", "assistant_mention_private"]).toContain(m[2]);
      expect(outside).toMatch(new RegExp(`CREATE POLICY ${m[1]} ON ${m[2]}\\b`));
    }
    // Functions: only new names (nothing existing is replaced).
    const fns = [...outside.matchAll(/CREATE OR REPLACE FUNCTION (\w+)/gi)].map((m) => m[1]);
    expect(fns).toEqual([
      "app_member_can_read_conversation", "app_member_can_view_task", "app_member_can_read_doc", "app_conversation_has_reader",
      "app_conversation_readers", "app_visible_to_readers", "app_can_manage_conversation", "app_conversation_set_assistant_replies",
    ]);
    for (const m of outside.matchAll(/\bCREATE\s+(?:UNIQUE\s+)?(TABLE|INDEX)\s+(\S+)/gi)) expect(m[2], m[0]).toMatch(/^IF$/i);
    for (const m of outside.matchAll(/\bADD COLUMN\s+(\S+)/gi)) expect(m[1], m[0]).toMatch(/^IF$/i);
    // The internal per-member functions are revoked from the app role.
    for (const f of ["app_member_can_read_conversation", "app_member_can_view_task", "app_member_can_read_doc"]) {
      expect(outside).toMatch(new RegExp(`REVOKE ALL ON FUNCTION ${f}\\([^)]*\\) FROM boardroom_app;`));
    }
  });
});
