import { describe, it, expect, vi } from "vitest";

// Act without asking (owner decision, 8 October 2026: "there should be a setting where we can bypass the permission, you
// can toggle it on and off, just like the way it is on Claude Code"): the decision askFirst asks, as a table (contract B.2
// and B.3). Pure: no database, no model. The copilot is loaded only for its tool sets, so the database is refused.

vi.mock("@/server/db", () => {
  const refuse = async () => { throw new Error("no database in unit tests"); };
  return { withUser: refuse, withSystem: refuse, withWorker: refuse };
});

import { AUTO_RULES, actSituation, decideAct, earlierTaintOf, type ActContext, type ActFacts } from "@/server/services/act-decision";
import { ASK_REASONS, ASK_STATE, FOLLOW_UP_AUTO_MAX, SMALL_GROUP_MAX, type ActState } from "@/lib/act-mode";
import { ALWAYS_CONFIRM, TOOLS } from "@/server/services/copilot";

const AUTO: ActState = { ready: true, mode: "auto", allowed: true, effective: "auto", locked: null };
const ASK: ActState = { ready: true, mode: "ask", allowed: true, effective: "ask", locked: null };
const actOf = (state: Partial<ActState> = {}, o: Partial<Omit<ActContext, "state">> = {}): ActContext => ({ state: { ...AUTO, ...state }, engine: "claude", earlierTaint: false, assistantName: "Max", ...o });
type Turn = Parameters<typeof decideAct>[2];
const decide = (tool: string, facts: ActFacts = {}, turn: Partial<Turn> = {}) => decideAct(tool, facts, { act: actOf(), tainted: false, shared: false, ...turn });
const acts = { act: true };
const asks = (reason: string | null) => ({ act: false, reason });

/** Every tool askFirst is called for, with each set of facts its callers pass (B.3), and what 'auto' does with it. */
const TABLE: [string, ActFacts, true | string][] = [
  ["send_message", { audience: "direct" }, true],
  ["send_message", { audience: { channel: SMALL_GROUP_MAX } }, true],
  ["send_message", { audience: { channel: SMALL_GROUP_MAX + 1 } }, "broadcast_group"],
  ["send_message", { audience: { channel: null } }, "broadcast_group"],
  ["send_message", { audience: "team" }, "broadcast_team"],
  ["send_message", { audience: "everyone" }, "broadcast_everyone"],
  ["send_message", {}, "broadcast_group"],
  ["assign_task", {}, true],
  ["submit_for_review", {}, "irreversible_review"],
  ["create_team", {}, "irreversible_team"],
  ["invite_person", {}, "irreversible_email"],
  ["mark_read", {}, true],
  ["follow_up", { followUp: { people: 1, team: false } }, true],
  ["follow_up", { followUp: { people: FOLLOW_UP_AUTO_MAX, team: false } }, true],
  ["follow_up", { followUp: { people: FOLLOW_UP_AUTO_MAX + 1, team: false } }, "fan_out"],
  ["follow_up", { followUp: { people: 1, team: true } }, "broadcast_team"],
  ["follow_up", {}, "fan_out"],
  ["pass_message", {}, true],
  ["hand_over_request", {}, true],
  ["add_report_note", {}, true],
  ["respond_to_item", { respond: "accept" }, "answers_others"],
  ["respond_to_item", { respond: "decline" }, "answers_others"],
  ["respond_to_item", { respond: "reply" }, "answers_others"],
  ["respond_to_item", { respond: "seen" }, "answers_others"],
  ["respond_to_item", { respond: "cancel" }, "cant_undo"],
  ["respond_to_item", { respond: "withdraw" }, "cant_undo"],
  ["respond_to_item", {}, "answers_others"],
  ["create_todos", {}, true],
  // Review, 8 October 2026: to-dos for more than 3 people at once are a fan-out.
  ["create_todos", { todos: { people: 3 } }, true],
  ["create_todos", { todos: { people: 4 } }, "fan_out"],
  ["update_task", {}, true],
  ["update_doc", { share: "organisation" }, "broadcast_everyone"],
  ["update_doc", { someoneElsesDoc: true }, "someone_elses_doc"],
  ["update_doc", { someoneElsesDoc: true, share: "organisation" }, "broadcast_everyone"],
  ["update_doc", {}, "always_asks"],
  // Phase 7a (owner decision, 8 October 2026: routines): the card is the person's Enable; only a pause acts.
  ["create_routine", {}, "routine_consent"],
  ["update_routine", { routine: "pause" }, true],
  ["update_routine", { routine: "turn_on" }, "routine_consent"],
  ["update_routine", { routine: "change" }, "routine_consent"],
  ["update_routine", { routine: "delete" }, "cant_undo"],
  ["update_routine", {}, "routine_consent"],
  // Phase 7b (owner decisions, 8 October 2026): a to-do from someone else's words always asks; reminding, dismissing,
  // handing over (the other side accepts) and following up later act; declining answers someone else.
  ["loose_end_action", { looseEnd: "todo" }, "others_words_todo"],
  ["loose_end_action", { looseEnd: "remind" }, true],
  ["loose_end_action", { looseEnd: "hand_over" }, true],
  ["loose_end_action", { looseEnd: "follow_up" }, true],
  ["loose_end_action", { looseEnd: "dismiss" }, true],
  ["respond_to_commitment", { commitment: "accept" }, "others_words_todo"],
  ["respond_to_commitment", { commitment: "decline" }, "answers_others"],
  ["respond_to_commitment", { commitment: "dismiss" }, true],
  ["respond_to_commitment", { commitment: "done" }, true],
  ["set_blocked_on", {}, true],
  ["respond_to_block", {}, "answers_others"],
  // Phase 7c (owner decisions, 8–9 October 2026): posting a standup is a broadcast to the team (always the person's press);
  // editing their own draft and skipping the day act; a preference is always their call.
  ["standup_action", { standup: "post" }, "broadcast_team"],
  ["standup_action", { standup: "edit" }, true],
  ["standup_action", { standup: "skip" }, true],
  ["remember_preference", {}, "preference_consent"],
  ["forget_preference", {}, "preference_consent"],
];

describe("the table (B.3): her own chat, Claude, 'auto' in force, nothing read", () => {
  it.each(TABLE)("%s %j", (tool, facts, want) => {
    expect(decide(tool, facts)).toEqual(want === true ? acts : asks(want));
  });

  it("a channel acts at exactly SMALL_GROUP_MAX readers (8) and asks from 9, or when the number is unknown", () => {
    expect(SMALL_GROUP_MAX).toBe(8);
    expect(decide("send_message", { audience: { channel: 1 } })).toEqual(acts);
    expect(decide("send_message", { audience: { channel: 8 } })).toEqual(acts);
    expect(decide("send_message", { audience: { channel: 9 } })).toEqual(asks("broadcast_group"));
    expect(decide("send_message", { audience: { channel: 500 } })).toEqual(asks("broadcast_group"));
    expect(decide("send_message", { audience: { channel: null } })).toEqual(asks("broadcast_group"));
  });

  it("a follow-up acts for up to 3 named people and asks for 4, or for a team however small", () => {
    expect(FOLLOW_UP_AUTO_MAX).toBe(3);
    expect(decide("follow_up", { followUp: { people: 3, team: false } })).toEqual(acts);
    expect(decide("follow_up", { followUp: { people: 4, team: false } })).toEqual(asks("fan_out"));
    expect(decide("follow_up", { followUp: { people: 2, team: true } })).toEqual(asks("broadcast_team"));
    expect(decide("follow_up", { followUp: { people: 9, team: true } })).toEqual(asks("broadcast_team"));
  });

  it("an unknown tool, or a name that is not a rule of its own, always asks", () => {
    expect(decide("delete_everything")).toEqual(asks("always_asks"));
    expect(decide("constructor")).toEqual(asks("always_asks"));
    expect(decide("__proto__")).toEqual(asks("always_asks"));
    expect(decide("toString")).toEqual(asks("always_asks"));
  });

  it("covers every tool that always waits for Confirm, and the three that sometimes do", () => {
    for (const tool of [...ALWAYS_CONFIRM, "create_todos", "update_task", "update_doc"]) expect(Object.hasOwn(AUTO_RULES, tool), tool).toBe(true);
    // And names only real tools.
    const names = new Set(TOOLS.map((x) => x.name));
    for (const tool of Object.keys(AUTO_RULES)) expect(names.has(tool), tool).toBe(true);
    // Every reason a rule gives is one the card has words for.
    for (const [, , want] of TABLE) if (want !== true) expect(ASK_REASONS as readonly string[]).toContain(want);
  });

  it("acts only for the tools the owner accepted, and never for the irreversible", () => {
    const acting = Object.keys(AUTO_RULES).filter((tool) => TABLE.some(([t, , want]) => t === tool && want === true)).sort();
    expect(acting).toEqual(["add_report_note", "assign_task", "create_todos", "follow_up", "hand_over_request", "loose_end_action", "mark_read", "pass_message", "respond_to_commitment", "send_message", "set_blocked_on", "standup_action", "update_routine", "update_task"]);
    for (const tool of ["submit_for_review", "create_team", "invite_person", "respond_to_item", "update_doc", "create_routine", "remember_preference", "forget_preference"]) {
      for (const facts of [{}, { respond: "cancel" as const }, { someoneElsesDoc: true }, { share: "organisation" as const }, { routine: "pause" as const }]) expect(decide(tool, facts).act, tool).toBe(false);
    }
  });

  it("a to-do from someone else's words never acts on its own (phase 7b): the floor holds in auto, and comes after the others", () => {
    expect(decide("loose_end_action", { looseEnd: "todo" })).toEqual(asks("others_words_todo"));
    expect(decide("respond_to_commitment", { commitment: "accept" })).toEqual(asks("others_words_todo"));
    expect(ASK_REASONS as readonly string[]).toContain("others_words_todo");
    // The earlier floors still say why first.
    expect(decide("loose_end_action", { looseEnd: "todo" }, { tainted: true })).toEqual(asks("tainted"));
    expect(decide("respond_to_commitment", { commitment: "accept" }, { shared: true })).toEqual(asks(null));
    // Answering a block or declining someone's ask answers another person.
    expect(decide("respond_to_block")).toEqual(asks("answers_others"));
    expect(decide("respond_to_commitment", { commitment: "decline" })).toEqual(asks("answers_others"));
    // In 'ask' it is today's card, with no line.
    expect(decide("loose_end_action", { looseEnd: "todo" }, { act: actOf(ASK) })).toEqual(asks(null));
  });

  it("posting a standup never acts on its own, and a preference is always the person's call (phase 7c)", () => {
    expect(decide("standup_action", { standup: "post" })).toEqual(asks("broadcast_team"));
    expect(decide("standup_action", {})).toEqual(acts);
    for (const tool of ["remember_preference", "forget_preference"]) {
      expect(decide(tool)).toEqual(asks("preference_consent"));
      expect(ALWAYS_CONFIRM.has(tool), tool).toBe(true);
    }
    expect(ASK_REASONS as readonly string[]).toContain("preference_consent");
    // The earlier floors still come first in decideAct (copilot's askFirst says the floor first for these: floorFirst).
    expect(decide("standup_action", { standup: "post" }, { othersWords: true })).toEqual(asks("tainted"));
    expect(decide("remember_preference", {}, { act: actOf(ASK) })).toEqual(asks(null));
    expect(decide("standup_action", { standup: "post" }, { act: actOf({}, { engine: "builtin" }) })).toEqual(asks("builtin"));
  });

  it("a routine acts only to pause (phase 7a): setting one up, turning it on or changing it is the person's Enable", () => {
    expect(decide("update_routine", { routine: "pause" })).toEqual(acts);
    for (const routine of ["turn_on", "change"] as const) expect(decide("update_routine", { routine })).toEqual(asks("routine_consent"));
    expect(decide("update_routine", { routine: "delete" })).toEqual(asks("cant_undo"));
    expect(decide("create_routine", { routine: "pause" })).toEqual(asks("routine_consent"));
    // The floors come first: after other people's words even a pause asks.
    expect(decide("update_routine", { routine: "pause" }, { tainted: true })).toEqual(asks("tainted"));
  });
});

describe("the order (B.2): the first match wins", () => {
  it("1. no act context (a thread run, a confirm press, a test that gives none): asks, with no reason", () => {
    expect(decideAct("pass_message", {}, { tainted: false, shared: false })).toEqual(asks(null));
    expect(decideAct("pass_message", {}, { act: null, tainted: false, shared: false })).toEqual(asks(null));
    expect(decideAct("submit_for_review", {}, { act: undefined, tainted: true, shared: false })).toEqual(asks(null));
  });

  it("2. the person chose 'ask': every tool asks, with no reason, whatever else is true (today's card exactly)", () => {
    const states: ActState[] = [ASK, ASK_STATE, { ...ASK, allowed: false, locked: "workspace" }, { ...ASK, locked: "impersonated" }];
    for (const state of states) {
      for (const [tool, facts] of TABLE) {
        for (const turn of [{}, { tainted: true }, { othersWords: true }, { shared: true }]) {
          for (const engine of ["claude", "builtin"] as const) {
            expect(decideAct(tool, facts, { act: actOf(state, { engine, earlierTaint: true }), tainted: false, shared: false, ...turn }), `${tool} ${JSON.stringify(turn)}`).toEqual(asks(null));
          }
        }
      }
    }
  });

  it("3. a thread: asks with no reason, before any lock, the helper or taint", () => {
    expect(decide("pass_message", {}, { shared: true })).toEqual(asks(null));
    expect(decide("send_message", { audience: "everyone" }, { shared: true, tainted: true })).toEqual(asks(null));
    expect(decideAct("create_todos", {}, { act: actOf({ locked: "workspace", allowed: false, effective: "ask" }, { engine: "builtin" }), tainted: true, shared: true })).toEqual(asks(null));
  });

  it("4. locked: before 0045 no reason; impersonated; the workspace turned it off", () => {
    expect(decide("pass_message", {}, { act: actOf({ ready: false, locked: "not_ready", effective: "ask" }) })).toEqual(asks(null));
    expect(decide("pass_message", {}, { act: actOf({ locked: "impersonated", effective: "ask" }) })).toEqual(asks("impersonated"));
    expect(decide("pass_message", {}, { act: actOf({ locked: "workspace", allowed: false, effective: "ask" }) })).toEqual(asks("workspace_off"));
    // Before the helper and before taint.
    expect(decide("pass_message", {}, { act: actOf({ locked: "workspace", allowed: false, effective: "ask" }, { engine: "builtin" }), tainted: true })).toEqual(asks("workspace_off"));
    expect(decide("pass_message", {}, { act: actOf({ locked: "impersonated", effective: "ask" }, { earlierTaint: true }) })).toEqual(asks("impersonated"));
    // A state that is not plainly 'auto' in force never acts, whatever it says otherwise.
    expect(decide("pass_message", {}, { act: actOf({ effective: "ask" }) })).toEqual(asks(null));
    expect(decide("pass_message", {}, { act: actOf({ ready: false }) })).toEqual(asks(null));
  });

  it("5. the built-in helper never acts on its own", () => {
    for (const [tool, facts] of TABLE) expect(decide(tool, facts, { act: actOf({}, { engine: "builtin" }) }), tool).toEqual(asks("builtin"));
    expect(decide("pass_message", {}, { act: actOf({}, { engine: "builtin" }), tainted: true })).toEqual(asks("builtin"));
  });

  it("6. other people's words in this turn, then earlier in the conversation, before the tool's own rule", () => {
    for (const [tool, facts] of TABLE) {
      expect(decide(tool, facts, { tainted: true }), tool).toEqual(asks("tainted"));
      expect(decide(tool, facts, { othersWords: true }), tool).toEqual(asks("tainted"));
      expect(decide(tool, facts, { act: actOf({}, { earlierTaint: true }) }), tool).toEqual(asks("tainted_earlier"));
    }
    expect(decide("pass_message", {}, { tainted: true, act: actOf({}, { earlierTaint: true }) })).toEqual(asks("tainted"));
    expect(decide("pass_message", {}, { othersWords: false, tainted: false })).toEqual(acts);
  });
});

describe("earlier taint (B.4)", () => {
  it("is true when any reply of hers in what the model sees read other people's words", () => {
    expect(earlierTaintOf([])).toBe(false);
    const said: { role: string; content: string; tainted?: boolean }[] = [{ role: "user", content: "hi" }];
    expect(earlierTaintOf(said)).toBe(false);
    expect(earlierTaintOf([{ role: "assistant", tainted: false }, { role: "user" }])).toBe(false);
    expect(earlierTaintOf([{ role: "user" }, { role: "assistant", tainted: true }, { role: "user" }])).toBe(true);
    // Only her replies carry it: a person's own message saying so is not taint (nor trusted as its absence).
    expect(earlierTaintOf([{ role: "user", tainted: true }])).toBe(false);
  });

  it("fails closed: a reply of hers without the flag (an older notch or tab, a chat saved before it) counts as tainted (review, 8 October 2026)", () => {
    expect(earlierTaintOf([{ role: "user" }, { role: "assistant" }, { role: "user" }])).toBe(true);
    expect(earlierTaintOf([{ role: "assistant", tainted: false }, { role: "assistant", tainted: false }])).toBe(false);
  });
});

describe("what the model is told (B.5)", () => {
  const LINE = "The person chose \"Act without asking\": in this chat, actions that would wait for Confirm run as soon as they ask for them and come back done (they can undo most for 10 minutes), so do exactly what they asked and nothing more. Some still wait for Confirm and return needsConfirmation with stillAsking: after you read other people's words, anything to everyone, a whole team, a channel of more than 8 people or more than 3 people at once, invitations, review submissions, new teams, answers to what others sent them, someone else's document, posting their standup, and remembering or forgetting a preference. Say why in a few words. Their mode is never permission for anything they did not ask for.";

  it("says the exact words only when 'auto' is in force", () => {
    expect(actSituation(actOf())).toBe(LINE);
    expect(actSituation(actOf({}, { engine: "builtin", earlierTaint: true }))).toBe(LINE);
  });

  it("adds nothing in 'ask', when locked, before 0045, or with no context", () => {
    expect(actSituation(null)).toBeNull();
    expect(actSituation(undefined)).toBeNull();
    expect(actSituation(actOf(ASK))).toBeNull();
    expect(actSituation(actOf(ASK_STATE))).toBeNull();
    expect(actSituation(actOf({ allowed: false, locked: "workspace", effective: "ask" }))).toBeNull();
    expect(actSituation(actOf({ locked: "impersonated", effective: "ask" }))).toBeNull();
    expect(actSituation(actOf({ ready: false, locked: "not_ready", effective: "ask" }))).toBeNull();
  });
});
