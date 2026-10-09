import { describe, it, expect } from "vitest";

// The lead's one rollup at the cutoff (owner decisions, 8–9 October 2026: phase 7c, contract B.6): who posted by the
// cutoff with their message, the blockers named in what they posted (their own approved words), and who has no update:
// one neutral alphabetical list where a skip and silence read exactly the same (never chased, never shamed). Pure.

import { composeRollup } from "@/server/services/standup-compose";
import type { RollupInput } from "@/server/services/standup";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ADA = id(1), BEN = id(2), OLU = id(3), SAM = id(4), DAVID = id(5), GONE = id(6);
const CONV = id(50);
const input = (o: Partial<RollupInput> = {}): RollupInput => ({
  rollupId: id(90), organisationId: id(91), slug: "acme", team: { id: id(92), name: "Design" }, localDate: "2026-10-09", dateLabel: "Friday 9 October",
  cutoffAt: "2026-10-09T11:00:00.000Z", timeZone: "Africa/Lagos",
  members: [{ membershipId: ADA, name: "Ada Obi" }, { membershipId: BEN, name: "Ben Okafor" }, { membershipId: OLU, name: "Olu Ade" }, { membershipId: SAM, name: "Sam Lee" }, { membershipId: DAVID, name: "David King" }],
  entries: [
    { membershipId: BEN, name: "Ben Okafor", status: "posted", postedAt: "2026-10-09T09:05:00.000Z", messageId: id(61), conversationId: CONV,
      blockedText: "- \"Logo files\": waiting on Ada Obi (Can you send the SVGs?)\n- \"Hosting\": DNS not set", blockers: [
        { taskId: id(71), title: "Logo files", onMembershipId: ADA, onName: "Ada Obi" },
        { taskId: id(72), title: "Hosting", onMembershipId: null, onName: null },
        // Edited away by Ben before posting: not in his words, so not in the rollup.
        { taskId: id(73), title: "Fonts licence", onMembershipId: SAM, onName: "Sam Lee" },
      ] },
    { membershipId: ADA, name: "Ada Obi", status: "posted", postedAt: "2026-10-09T08:41:00.000Z", messageId: id(62), conversationId: CONV, blockedText: "- Nothing", blockers: [] },
    // Skipped, silent (ready, never posted), failed: all the same to the lead.
    { membershipId: OLU, name: "Olu Ade", status: "skipped", postedAt: null, messageId: null, conversationId: null, blockedText: "- \"Pricing\": waiting on Ben", blockers: [{ taskId: id(74), title: "Pricing", onMembershipId: BEN, onName: "Ben Okafor" }] },
    { membershipId: SAM, name: "Sam Lee", status: "ready", postedAt: null, messageId: null, conversationId: null, blockedText: "- \"Brand sheet\": waiting on David", blockers: [] },
    // Posted after the cutoff: not in this rollup (the sweep adds it to `late`).
    { membershipId: DAVID, name: "David King", status: "posted", postedAt: "2026-10-09T11:20:00.000Z", messageId: id(63), conversationId: CONV, blockedText: "- Nothing", blockers: [] },
    // Left the team today: called off, not listed.
    { membershipId: GONE, name: "Zed Gone", status: "cancelled", postedAt: null, messageId: null, conversationId: null, blockedText: null, blockers: [] },
  ],
  recipients: [DAVID], ...o,
});

describe("the rollup (composeRollup)", () => {
  it("lists who posted by the cutoff, by time, with their message", () => {
    const c = composeRollup(input());
    expect(c.posted).toEqual([
      { membershipId: ADA, name: "Ada Obi", at: "2026-10-09T08:41:00.000Z", messageId: id(62), conversationId: CONV },
      { membershipId: BEN, name: "Ben Okafor", at: "2026-10-09T09:05:00.000Z", messageId: id(61), conversationId: CONV },
    ]);
    expect(c.counts).toEqual({ members: 5, posted: 2 });
    expect(c.late).toEqual([]);
    expect(c).toMatchObject({ v: 1, team: { id: id(92), name: "Design" }, localDate: "2026-10-09", dateLabel: "Friday 9 October", cutoffAt: "2026-10-09T11:00:00.000Z", timeZone: "Africa/Lagos" });
  });

  it("takes blockers only from what was posted, in the person's own kept words, with the blocker their line names", () => {
    const c = composeRollup(input());
    expect(c.blockers).toEqual([
      { membershipId: BEN, name: "Ben Okafor", text: "\"Logo files\": waiting on Ada Obi (Can you send the SVGs?)", taskId: id(71), onMembershipId: ADA, onName: "Ada Obi" },
      { membershipId: BEN, name: "Ben Okafor", text: "\"Hosting\": DNS not set", taskId: id(72), onMembershipId: null, onName: null },
    ]);
    // Ada's "Nothing" is no blocker; Olu skipped, so his draft's blocker never reaches the lead; the edited-away one neither.
    expect(JSON.stringify(c.blockers)).not.toMatch(/Pricing|Fonts licence|Brand sheet/);
  });

  it("lists everyone else under No update, alphabetically, the same whatever the reason", () => {
    const c = composeRollup(input());
    expect(c.noUpdate).toEqual([{ membershipId: DAVID, name: "David King" }, { membershipId: OLU, name: "Olu Ade" }, { membershipId: SAM, name: "Sam Lee" }]);
    // A skip and silence read exactly the same: swap Olu's and Sam's statuses, and the content does not change.
    const swapped = input();
    swapped.entries = swapped.entries.map((e) => (e.membershipId === OLU ? { ...e, status: "ready" as const } : e.membershipId === SAM ? { ...e, status: "skipped" as const } : e));
    expect(composeRollup(swapped)).toEqual(c);
    // Never a reason, never a word of judgement.
    expect(JSON.stringify(c.noUpdate)).not.toMatch(/skip|silent|late|failed|reason/i);
  });

  it("counts a member with no entry at all (personal standup off, no draft) under No update", () => {
    const c = composeRollup(input({ entries: [] }));
    expect(c.noUpdate.map((p) => p.name)).toEqual(["Ada Obi", "Ben Okafor", "David King", "Olu Ade", "Sam Lee"]);
    expect(c.counts).toEqual({ members: 5, posted: 0 });
    expect(c.posted).toEqual([]);
    expect(c.blockers).toEqual([]);
  });

  it("keeps at most 20 blockers and each at most 160 characters", () => {
    const many = Array.from({ length: 25 }, (_, i) => `- "Task ${i}": ${"waiting ".repeat(30)}`).join("\n");
    const c = composeRollup(input({ entries: [{ membershipId: BEN, name: "Ben Okafor", status: "posted", postedAt: "2026-10-09T09:00:00.000Z", messageId: null, conversationId: null, blockedText: many, blockers: [] }] }));
    expect(c.blockers).toHaveLength(20);
    expect(Math.max(...c.blockers.map((b) => b.text.length))).toBeLessThanOrEqual(160);
  });
});
