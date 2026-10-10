import { describe, it, expect } from "vitest";

// The abilities catalogue (owner decisions, 8–9 October 2026: phase 7c, contract C.1/C.2; lib/abilities, foundation):
// eleven abilities in the owner's order (twelve since phase 8: `call_notes`, last, a workspace switch only; owner
// decisions, 8 October 2026), each with what it does, "Use when" and "Never"; the workspace's switch wins over
// the person's; a key with no switch of that kind is governed by its existing switch. Pure.

import { ABILITY_CATALOGUE, ABILITY_KEYS, ABILITY_WORDS, ALL_ON, PERSONAL_SWITCH_KEYS, TEMPLATE_ABILITY, WORKSPACE_SWITCH_KEYS, abilitiesOff, abilityOff } from "@/lib/abilities";

describe("the catalogue", () => {
  it("has the twelve abilities in order, each with its copy", () => {
    expect(ABILITY_CATALOGUE.map((c) => c.key)).toEqual([...ABILITY_KEYS]);
    expect(ABILITY_KEYS).toEqual(["catch_up", "loose_ends", "follow_ups", "assistant_talk", "mentions", "routines", "commitments", "standup", "voice", "act", "morning_opener", "call_notes"]);
    expect(ABILITY_KEYS).toHaveLength(12);
    for (const c of ABILITY_CATALOGUE) {
      expect(c.title, c.key).toBeTruthy();
      expect(c.what({ name: "Max", ws: "Brenda" }), c.key).toMatch(/\S/);
      expect(c.useWhen, c.key).toMatch(/^Use when /);
      expect(c.never, c.key).toMatch(/^Never /);
      expect(c.icon, c.key).toMatch(/^[A-Z][A-Za-z]+$/);
    }
    expect(ABILITY_CATALOGUE.find((c) => c.key === "standup")?.never).toBe("Never posts without your press, and never chases or shames anyone who didn't post.");
    expect(ABILITY_CATALOGUE.find((c) => c.key === "commitments")?.what({ name: "Max", ws: "Brenda" })).toMatch(/^Brenda notes/);
    expect(ABILITY_CATALOGUE.find((c) => c.key === "catch_up")?.what({ name: "Max", ws: "Brenda" })).toMatch(/^Max reads/);
    const notes = ABILITY_CATALOGUE.find((c) => c.key === "call_notes")!;
    expect(notes.title).toBe("Notes on calls");
    expect(notes.what({ name: "Max", ws: "Brenda" })).toBe("On a call, anyone can ask Brenda to take notes. Everyone chooses for themselves, and Brenda writes a recap from the words of the people who agree.");
    expect(notes.never).toBe("Never listens without each person's yes, never sends audio anywhere, never shows the transcript to anyone who wasn't on the call, and never adds a to-do until its person accepts.");
  });

  it("switches what had no switch: the workspace's and the person's lists", () => {
    expect([...WORKSPACE_SWITCH_KEYS]).toEqual(["catch_up", "loose_ends", "follow_ups", "assistant_talk", "routines", "standup", "voice", "morning_opener", "call_notes"]);
    expect([...PERSONAL_SWITCH_KEYS]).toEqual(["catch_up", "loose_ends", "follow_ups", "assistant_talk", "mentions", "routines", "standup", "morning_opener"]);
    expect(TEMPLATE_ABILITY).toEqual({ morning_brief: "morning_opener", still_owed: null, afternoon_check: null, chase_stalled: "follow_ups", loose_ends: "loose_ends" });
  });
});

describe("whether an ability is off (abilityOff)", () => {
  it("the workspace wins; nothing read is everything on; an existing switch's key is never off here", () => {
    const a = { ready: true, workspaceOff: ["standup", "voice"] as const, personalOff: ["standup", "catch_up", "mentions"] as const };
    const ab = { ...a, workspaceOff: [...a.workspaceOff], personalOff: [...a.personalOff] };
    expect(abilityOff(ab, "standup")).toBe("workspace");
    expect(abilityOff(ab, "catch_up")).toBe("personal");
    expect(abilityOff(ab, "mentions")).toBe("personal");
    expect(abilityOff(ab, "voice")).toBe("workspace");
    expect(abilityOff(ab, "follow_ups")).toBeNull();
    expect(abilityOff({ ...ab, workspaceOff: ["mentions" as never] }, "mentions")).toBe("personal");
    expect(abilityOff({ ready: true, workspaceOff: [], personalOff: ["voice" as never] }, "voice")).toBeNull();
    expect(abilityOff(null, "standup")).toBeNull();
    expect(abilityOff(ALL_ON, "standup")).toBeNull();
    expect(abilitiesOff(ab)).toEqual(["catch_up", "mentions", "standup", "voice"]);
    // Notes on calls: the workspace's switch only; a personal list never turns them off (each call asks each person).
    expect(abilityOff({ ready: true, workspaceOff: ["call_notes"], personalOff: [] }, "call_notes")).toBe("workspace");
    expect(abilityOff({ ready: true, workspaceOff: [], personalOff: ["call_notes" as never] }, "call_notes")).toBeNull();
  });

  it("refuses in one sentence naming where it is switched on", () => {
    expect(ABILITY_WORDS.refusal("Standup", "workspace", "Max")).toBe("Standup is switched off in this workspace. An owner or HR can switch it on in Settings → Brenda → Abilities.");
    expect(ABILITY_WORDS.refusal("Standup", "personal", "Max")).toBe("Standup is switched off for Max. You can switch it on in Settings → Your assistant → Abilities.");
  });
});
