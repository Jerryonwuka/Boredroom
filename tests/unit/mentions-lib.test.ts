import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MENTION_LIMITS, MENTION_NOTE_CODES, MENTION_STATUSES, MENTION_WORDS, assistantLabels, findLabel, findLabelAll, mentionNote, mentionQueryAt, otherAssistantLabels, splitMentions,
  type MentionRef, type MentionToken, type MentionView,
} from "@/lib/mentions";
import { mentionTokenSchema } from "@/server/services/messaging";
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
    expect(validateMentions("@max what's left?", t({ kind: "assistant", label: "@Max" }), who)).toEqual({ assistant: { label: "@max", ownerMembershipId: null }, people: [] });
    expect(validateMentions("hey @assistant", t({ kind: "assistant", label: "@assistant" }), who)).toEqual({ assistant: { label: "@assistant", ownerMembershipId: null }, people: [] });
  });

  it("refuses someone else's assistant, a label not in the body, and keeps one assistant only", () => {
    expect(validateMentions("@Juno what's Ben on?", t({ kind: "assistant", label: "@Juno" }), who).assistant).toBeNull();
    expect(validateMentions("@Brenda hi", t({ kind: "assistant", label: "@Brenda" }), who).assistant).toBeNull();
    expect(validateMentions("what's left?", t({ kind: "assistant", label: "@Max" }), who).assistant).toBeNull();
    expect(validateMentions("@Max and @assistant", t({ kind: "assistant", label: "@Max" }, { kind: "assistant", label: "@assistant" }), who)).toEqual({ assistant: { label: "@Max", ownerMembershipId: null }, people: [] });
    expect(validateMentions("@Brenda hi", t({ kind: "assistant", label: "@Brenda" }), { ...who, ownAssistantName: "Brenda" }).assistant).toEqual({ label: "@Brenda", ownerMembershipId: null });
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
    // Phase 5's codes (phase 6's owner codes are in mentions-lib's phase 6 tests below).
    expect(MENTION_NOTE_CODES.slice(0, 11).map((c) => mentionNote(c, "Max"))).toEqual([
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
    // Phase 6 (migration 0043) adds 'asked' and the owner's note codes; 0041 holds the rest, in the same order.
    expect(listed(/assistant_mentions_status_check\s+CHECK \(status IN \(([^)]*)\)\)/)).toEqual(MENTION_STATUSES.filter((x) => x !== "asked"));
    expect(listed(/assistant_mention_private_note_check CHECK \(note_code IS NULL OR note_code IN \(([^)]*)\)\)/)?.map((s) => s.replace(/\s+/g, ""))).toEqual(MENTION_NOTE_CODES.slice(0, 11));
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

// ---- Phase 6: someone else's assistant (owner decision, 8 October 2026: personal assistants, phase 6) ------------------

describe("otherAssistantLabels", () => {
  it("is the first-name form only when the first name is unique among the other readers, and always the full name's", () => {
    expect(otherAssistantLabels("Ben Okafor", "Brenda", true)).toEqual(["@Ben's Brenda", "@Ben’s Brenda", "@Ben Okafor's Brenda", "@Ben Okafor’s Brenda"]);
    expect(otherAssistantLabels("Ben Okafor", "Brenda", false)).toEqual(["@Ben Okafor's Brenda", "@Ben Okafor’s Brenda"]);
    expect(otherAssistantLabels("Ben", "Nova", true)).toEqual(["@Ben's Nova", "@Ben’s Nova"]);
    expect(otherAssistantLabels("  Ada   Obi ", " Max ", true)[0]).toBe("@Ada's Max");
    expect(otherAssistantLabels("", "Brenda", true)).toEqual([]);
  });

  it("leaves out a label longer than message_mentions allows (160)", () => {
    const long = `${"A".repeat(60)} ${"B".repeat(100)}`;
    const labels = otherAssistantLabels(long, "Brenda", true);
    expect(labels).toEqual([`@${"A".repeat(60)}'s Brenda`, `@${"A".repeat(60)}’s Brenda`]);
    for (const l of otherAssistantLabels(`${"C".repeat(120)}`, "Abcdefghijklmnopqrstuvwx", true)) expect(l.length).toBeLessThanOrEqual(160);
    expect(MENTION_LIMITS.labelMax).toBe(160);
  });

  it("is what the composer may send (the token's label up to 160 characters)", () => {
    expect(mentionTokenSchema.safeParse({ kind: "others_assistant", membershipId: BEN, label: "@Ben's Brenda" }).success).toBe(true);
    expect(mentionTokenSchema.safeParse({ kind: "others_assistant", membershipId: "nope", label: "@Ben's Brenda" }).success).toBe(false);
    expect(mentionTokenSchema.safeParse({ kind: "others_assistant", membershipId: BEN, label: `@${"x".repeat(160)}` }).success).toBe(false);
  });
});

describe("validateMentions with someone else's assistant", () => {
  const t = (...tokens: MentionToken[]) => tokens;
  const others = [
    { membershipId: BEN, labels: otherAssistantLabels("Ben Okafor", "Brenda", true), allowed: true },
    { membershipId: ADA, labels: otherAssistantLabels("Ada Obi", "Nova", true), allowed: false },
  ];
  const w = { ...who, others };

  it("keeps it when its owner reads the conversation, allows tags, and the label stands in the body", () => {
    expect(validateMentions("@Ben's Brenda where is the deck?", t({ kind: "others_assistant", membershipId: BEN, label: "@Ben's Brenda" }), w))
      .toEqual({ assistant: { label: "@Ben's Brenda", ownerMembershipId: BEN }, people: [] });
    expect(validateMentions("@ben okafor’s brenda where is it?", t({ kind: "others_assistant", membershipId: BEN, label: "@Ben Okafor’s Brenda" }), w).assistant)
      .toEqual({ label: "@ben okafor’s brenda", ownerMembershipId: BEN });
  });

  it("drops it when the owner switched tags off, does not read here, or the label is wrong or not in the body", () => {
    expect(validateMentions("@Ada's Nova hi", t({ kind: "others_assistant", membershipId: ADA, label: "@Ada's Nova" }), w).assistant).toBeNull();
    expect(validateMentions("@Zed's Brenda hi", t({ kind: "others_assistant", membershipId: ZED, label: "@Zed's Brenda" }), w).assistant).toBeNull();
    expect(validateMentions("@Ben's Max hi", t({ kind: "others_assistant", membershipId: BEN, label: "@Ben's Max" }), w).assistant).toBeNull();
    expect(validateMentions("where is the deck?", t({ kind: "others_assistant", membershipId: BEN, label: "@Ben's Brenda" }), w).assistant).toBeNull();
    expect(validateMentions("@Olu's Max hi", t({ kind: "others_assistant", membershipId: OLU, label: "@Olu's Max" }), w).assistant).toBeNull();   // the sender
    expect(validateMentions("@Ben's Brenda hi", t({ kind: "others_assistant", membershipId: BEN, label: "@Ben's Brenda" }), who).assistant).toBeNull(); // no list: before 0043
  });

  it("keeps one assistant per message, own or someone else's: the first valid token wins", () => {
    expect(validateMentions("@Ben's Brenda and @Max", t({ kind: "others_assistant", membershipId: BEN, label: "@Ben's Brenda" }, { kind: "assistant", label: "@Max" }), w).assistant)
      .toEqual({ label: "@Ben's Brenda", ownerMembershipId: BEN });
    expect(validateMentions("@Max and @Ben's Brenda", t({ kind: "assistant", label: "@Max" }, { kind: "others_assistant", membershipId: BEN, label: "@Ben's Brenda" }), w).assistant)
      .toEqual({ label: "@Max", ownerMembershipId: null });
    // A first token that is not valid does not count.
    expect(validateMentions("@Ada's Nova and @Ben's Brenda", t({ kind: "others_assistant", membershipId: ADA, label: "@Ada's Nova" }, { kind: "others_assistant", membershipId: BEN, label: "@Ben's Brenda" }), w).assistant)
      .toEqual({ label: "@Ben's Brenda", ownerMembershipId: BEN });
  });

  it("still keeps people beside it", () => {
    const r = validateMentions("@Ben's Brenda ask @Ada Obi", t({ kind: "others_assistant", membershipId: BEN, label: "@Ben's Brenda" }, { kind: "person", membershipId: ADA, label: "@Ada Obi" }), w);
    expect(r.people).toEqual([{ membershipId: ADA, label: "@Ada Obi" }]);
  });
});

describe("phase 6 words", () => {
  it("has a note for each of the owner's reasons, naming the owner and their assistant", () => {
    const owner = { firstName: "Ben", assistantName: "Brenda" };
    // Phase 7c (owner decisions, 8–9 October 2026): 'off_ability' (the tagger switched @mentions off) follows them.
    expect(MENTION_NOTE_CODES.slice(11, 16)).toEqual(["off_owner", "owner_left", "owner_muted", "not_followable", "limit_owner"]);
    expect(MENTION_NOTE_CODES.slice(16)).toEqual(["off_ability"]);
    expect(mentionNote("off_ability", "Max")).toBe("You switched off @Max in Messages. Switch it on in Settings → Your assistant → Abilities.");
    expect(MENTION_NOTE_CODES.slice(11, 16).map((c) => mentionNote(c, "Ben's Brenda", owner))).toEqual([
      "Ben has switched off tags for their assistant. Ask Ben here.",
      "Ben isn't in this conversation any more, so Ben's Brenda can't answer here. Ask Ben directly.",
      "Ben isn't taking messages from your assistant right now.",
      "You can ask Ben's Brenda about Ben's work only when you work with Ben. Ask Ben here instead.",
      "Ben's Brenda has been asked a lot today. Ask Ben here instead, or try again later.",
    ]);
  });

  it("says whose assistant answered and who asked", () => {
    const tagger = { membershipId: OLU, name: "Olu Adeyemi", firstName: "Olu", isYou: false };
    const owner = { membershipId: BEN, name: "Ben Okafor", firstName: "Ben", isYou: false };
    const m = (o: Partial<Pick<MentionView, "tagger" | "owner">>) => ({ tagger, owner: null, ...o }) as Pick<MentionView, "tagger" | "owner">;
    expect(MENTION_WORDS.badgeFor(m({ owner }))).toBe("Ben's assistant");
    expect(MENTION_WORDS.badgeFor(m({ owner: { ...owner, isYou: true } }))).toBe("Your assistant");
    expect(MENTION_WORDS.badgeFor(m({}))).toBe("Olu's assistant");
    expect(MENTION_WORDS.badgeFor(m({ tagger: { ...tagger, isYou: true } }))).toBe("Your assistant");
    expect(MENTION_WORDS.askedBy("Olu", false)).toBe("asked by Olu");
    expect(MENTION_WORDS.askedBy("Olu", true)).toBe("asked by you");
    expect(MENTION_WORDS.otherAssistantOption("Ben", "Brenda")).toBe("Ben's Brenda");
    expect(MENTION_WORDS.otherAssistantSecondary("Ben")).toBe("Ben's assistant");
    expect(MENTION_WORDS.otherOff("Ben")).toBe("Ben isn't taking tags");
    expect(MENTION_WORDS.otherHint("Ben", "Brenda")).toBe("Ben's Brenda answers here from Ben's work, or asks Ben. Anything not everyone here can see goes only to you.");
    expect(MENTION_WORDS.disclosure).toBe("When someone tags an assistant here, it reads this conversation to answer. Replies show whose assistant it is and who asked.");
  });

  it("has the limits on tagging someone's assistant", () => {
    expect(MENTION_LIMITS.perOwnerPerHour).toBe(20);
    expect(MENTION_LIMITS.perTaggerOwnerPerDay).toBe(10);
  });
});

// ---- Migration 0043: the statuses and note codes the code knows ---------------------------------------------------------

describe("migration 0043", () => {
  const sql43 = readFileSync(join(process.cwd(), "db/migrations/0043_assistants_talk.sql"), "utf8").split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
  const listed43 = (re: RegExp) => re.exec(sql43)?.[1].split(",").map((s) => s.trim().replace(/^'|'$/g, ""));

  it("lists exactly the statuses and note codes the code knows", () => {
    expect(listed43(/assistant_mentions_status_check\s+CHECK \(status IN \(([^)]*)\)\)/)).toEqual([...MENTION_STATUSES]);
    // Phase 7c (owner decisions, 8–9 October 2026): 0050 widens it with 'off_ability' (0043's list is the rest).
    expect(listed43(/assistant_mention_private_note_check CHECK \(note_code IS NULL OR note_code IN \(([^)]*)\)\)/)?.map((x) => x.replace(/\s+/g, ""))).toEqual(MENTION_NOTE_CODES.filter((c) => c !== "off_ability"));
    const sql50 = readFileSync(join(process.cwd(), "db/migrations/0050_standup_abilities_preferences.sql"), "utf8").split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
    expect(/assistant_mention_private_note_check CHECK \(note_code IS NULL OR note_code IN \(([^)]*)\)\)/.exec(sql50)?.[1].split(",").map((s) => s.trim().replace(/^'|'$/g, "").replace(/\s+/g, ""))).toEqual([...MENTION_NOTE_CODES]);
    expect(sql43).toMatch(/message_mentions_label_check CHECK \(char_length\(label\) BETWEEN 2 AND 160/);
  });
});
