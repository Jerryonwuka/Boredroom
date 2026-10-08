import { describe, expect, it } from "vitest";
import {
  ACT_MODES, ACT_WORDS, ASK_REASONS, ASK_STATE, FOLLOW_UP_AUTO_MAX, SMALL_GROUP_MAX, UNDO_WINDOW_MINUTES,
  actStateFrom, actStateOf, isActMode, isAskReason, undoOpen, whyStillAsking,
} from "@/lib/act-mode";

// Act without asking (owner decision, 8 October 2026): what the server, the pages, the pill and the notch share. The
// state the server reads decides what is in force: before 0045 nothing, someone signed in as the person keeps them on
// 'ask', a workspace that switched it off keeps everyone on 'ask', and the person's own choice is kept while locked.

describe("actStateFrom", () => {
  it("before 0045 is ASK_STATE, whatever was given", () => {
    expect(actStateFrom({ ready: false, mode: null, allowed: null, impersonated: false })).toEqual(ASK_STATE);
    expect(actStateFrom({ ready: false, mode: "auto", allowed: false, impersonated: true })).toEqual(ASK_STATE);
    expect(ASK_STATE).toEqual({ ready: false, mode: "ask", allowed: true, effective: "ask", locked: "not_ready" });
  });

  it("defaults: no row is 'ask', no settings row is allowed", () => {
    expect(actStateFrom({ ready: true, mode: null, allowed: null, impersonated: false })).toEqual({ ready: true, mode: "ask", allowed: true, effective: "ask", locked: null });
    expect(actStateFrom({ ready: true, mode: undefined, allowed: undefined, impersonated: false }).locked).toBeNull();
    expect(actStateFrom({ ready: true, mode: "sometimes", allowed: true, impersonated: false }).mode).toBe("ask");
  });

  it("'auto' is in force only when unlocked", () => {
    expect(actStateFrom({ ready: true, mode: "auto", allowed: true, impersonated: false })).toEqual({ ready: true, mode: "auto", allowed: true, effective: "auto", locked: null });
  });

  it("precedence: not_ready > impersonated > workspace, and the choice is kept while locked", () => {
    expect(actStateFrom({ ready: true, mode: "auto", allowed: false, impersonated: false })).toEqual({ ready: true, mode: "auto", allowed: false, effective: "ask", locked: "workspace" });
    expect(actStateFrom({ ready: true, mode: "auto", allowed: true, impersonated: true })).toEqual({ ready: true, mode: "auto", allowed: true, effective: "ask", locked: "impersonated" });
    expect(actStateFrom({ ready: true, mode: "auto", allowed: false, impersonated: true }).locked).toBe("impersonated");
    expect(actStateFrom({ ready: false, mode: "auto", allowed: false, impersonated: true }).locked).toBe("not_ready");
    // A lock says why even when the person chose to be asked anyway.
    expect(actStateFrom({ ready: true, mode: "ask", allowed: false, impersonated: false })).toEqual({ ready: true, mode: "ask", allowed: false, effective: "ask", locked: "workspace" });
  });

  it("returns a fresh object (callers may not mutate the shared ASK_STATE)", () => {
    const s = actStateFrom({ ready: false, mode: null, allowed: null, impersonated: false });
    expect(s).not.toBe(ASK_STATE);
  });
});

describe("actStateOf", () => {
  it("reads a profiles' act, else ASK_STATE", () => {
    const on = actStateFrom({ ready: true, mode: "auto", allowed: true, impersonated: false });
    expect(actStateOf({ act: on })).toBe(on);
    expect(actStateOf({})).toEqual(ASK_STATE);
    expect(actStateOf(null)).toEqual(ASK_STATE);
    expect(actStateOf(undefined)).toEqual(ASK_STATE);
  });
});

describe("the constants and guards", () => {
  it("are the numbers the owner accepted", () => {
    expect(ACT_MODES).toEqual(["ask", "auto"]);
    expect(UNDO_WINDOW_MINUTES).toBe(10);
    expect(SMALL_GROUP_MAX).toBe(8);
    expect(FOLLOW_UP_AUTO_MAX).toBe(3);
    expect(isActMode("auto")).toBe(true);
    expect(isActMode("bypass")).toBe(false);
    expect(isAskReason("tainted")).toBe(true);
    expect(isAskReason("because")).toBe(false);
  });

  it("an Undo offer stands until its time", () => {
    const now = Date.parse("2026-10-08T14:22:00Z");
    expect(undoOpen({ token: "t", until: "2026-10-08T14:32:00Z" }, now)).toBe(true);
    expect(undoOpen({ token: "t", until: "2026-10-08T14:21:59Z" }, now)).toBe(false);
    expect(undoOpen(null, now)).toBe(false);
    expect(undoOpen(undefined, now)).toBe(false);
  });
});

describe("whyStillAsking", () => {
  it("has words for every reason, each starting 'Still asking: '", () => {
    for (const r of ASK_REASONS) {
      const w = whyStillAsking(r, { name: "Max", people: 12 });
      expect(w, r).toMatch(/^Still asking: /);
      expect(w.endsWith("."), r).toBe(true);
    }
  });

  it("names the person's assistant and a channel's size", () => {
    expect(whyStillAsking("tainted", { name: "Max" })).toBe("Still asking: Max read other people's words in this reply.");
    expect(whyStillAsking("tainted_earlier", { name: "Max" })).toBe("Still asking: other people's messages are earlier in this chat. Start a new chat for Max to act without asking.");
    expect(whyStillAsking("broadcast_group", { name: "Max", people: 12 })).toBe("Still asking: this goes to a channel of 12 people.");
    expect(whyStillAsking("broadcast_group", { name: "Max" })).toBe("Still asking: this goes to a large channel.");
    expect(whyStillAsking("fan_out", { name: "Max" })).toBe("Still asking: this reaches more than 3 people at once.");
    expect(whyStillAsking("always_asks", { name: "Max" })).toBe("Still asking: Max always asks before this.");
  });
});

describe("ACT_WORDS", () => {
  it("say the contract's words, with the person's assistant's name", () => {
    expect(ACT_WORDS.settings.description("Max")).toBe("Whether Max asks you before doing things for you.");
    // Review, 8 October 2026: a short lead (others' approval is never skipped), then every floor as a list.
    expect(ACT_WORDS.settings.auto.hint("Max")).toBe("Max does it straight away when you ask in your own chat, with Undo for 10 minutes. Requests still wait for the other person to accept, and follow-ups are answered by their assistant.");
    expect(ACT_WORDS.settings.auto.stillAsks).toEqual([
      "after reading other people's words",
      "before messages to everyone, a whole team or a channel of more than 8 people",
      "before asking or giving to-dos to more than 3 people at once",
      "before invitations, review submissions and new teams",
      "before answering something another person sent you",
      "before changing someone else's document",
      "always in Messages threads",
    ]);
    expect(ACT_WORDS.workspace.switch).toBe("Allow people to let their assistant act without asking");
    expect(ACT_WORDS.settings.tip("Max")).toBe("Tip: while typing in Max's box, press Shift+Tab to switch.");
    expect(ACT_WORDS.pill.labelAsk.startsWith(ACT_WORDS.pill.ask)).toBe(true);
    expect(ACT_WORDS.pill.labelAuto.startsWith(ACT_WORDS.pill.auto)).toBe(true);
    expect(ACT_WORDS.chat.doneUntil("14:32")).toBe("Done without asking. You can undo it until 14:32.");
    expect(ACT_WORDS.workspace.pageNote).toBe("Actions taken without asking are logged like confirmed ones, marked “without asking”, and most can be undone for 10 minutes.");
  });
});
