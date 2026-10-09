import { describe, it, expect } from "vitest";

// The standup in the built-in helper (owner decisions, 8–9 October 2026: phase 7c, contract F.1): what it understands and
// the words it answers with. Pure.

import { STANDUP_HELPER_WORDS, entryLists, entryStateWords, rollupLines, sectionLabel, standupIntent } from "@/server/services/standup-intent";
import type { StandupEntryView, StandupRollupView } from "@/lib/standup";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("what the helper understands (standupIntent)", () => {
  it.each([
    ["post my standup", "post"], ["Post today's standup", "post"], ["please post my stand-up", "post"],
    ["skip my standup today", "skip"], ["Skip today’s standup", "skip"], ["no standup from me today", "skip"],
    ["who hasn't posted their standup?", "rollup"], ["Who has not posted a standup yet", "rollup"], ["who posted today's standup", "rollup"], ["show me the standup rollup", "rollup"], ["standup summary please", "rollup"],
    ["what's in my standup?", "show"], ["show today's standup", "show"], ["my stand-up draft", "show"],
  ])("%s → %s", (text, want) => {
    expect(standupIntent(text)).toBe(want);
  });

  it("is nothing for other words", () => {
    // "Who posted in #design today?" is a Messages question; a meeting called standup is not the async standup.
    for (const t of ["post a message to Ben", "what did I miss?", "skip the meeting", "stand up for yourself", "who hasn't posted?", "Who posted in #design today?",
      "What's on today's standup meeting agenda?", "", "x".repeat(400)]) expect(standupIntent(t), t).toBeNull();
  });
});

const entry = (o: Partial<StandupEntryView> = {}): StandupEntryView => ({
  id: id(1), team: { id: id(2), name: "Design" }, localDate: "2026-10-12", dateLabel: "Monday 12 October", sinceLabel: "Since Friday", status: "ready",
  texts: { yesterday: "- Finished \"Landing page copy\"", today: "- \"Hero images\" (40%)", blocked: "- Nothing" },
  draft: { v: 1, sinceLabel: "Since Friday", dateLabel: "Monday 12 October", engine: "template", sections: {
    yesterday: [{ text: "Finished \"Landing *page* copy\"", refs: [{ kind: "task", id: id(11) }] }],
    today: [{ text: "\"Hero images\" (40%)", refs: [{ kind: "task", id: id(12) }] }],
    blocked: [{ text: "Nothing", refs: [] }],
  } },
  edited: false, engine: "template", postTo: { conversationId: id(3), name: "#Design", members: 6 }, leads: ["David King"],
  postAt: "2026-10-12T08:30:00.000Z", cutoffAt: "2026-10-12T11:00:00.000Z", posted: null, canUnskip: false, seen: false, href: `/app/acme/home/standup?e=${id(1)}`, ...o,
});

describe("the helper's words", () => {
  it("lists a draft's sections under bold labels, each drafted line with its links, others' words shown as typed", () => {
    expect(entryLists(entry(), "acme")).toBe([
      "**Since Friday**", `- Finished "Landing \\*page\\* copy" ([task](/app/acme/tasks/${id(11)}))`, "",
      "**Today**", `- "Hero images" (40%) ([task](/app/acme/tasks/${id(12)}))`, "",
      "**Blocked**", "- Nothing",
    ].join("\n"));
    // Edited: the person's own words, no links.
    expect(entryLists(entry({ edited: true, texts: { yesterday: "- Shipped it", today: "", blocked: "- Waiting on legal" } }), "acme")).toBe(
      ["**Since Friday**", "- Shipped it", "", "**Today**", "- Nothing", "", "**Blocked**", "- Waiting on legal"].join("\n"));
    expect(sectionLabel(entry({ sinceLabel: "Yesterday" }), "yesterday")).toBe("Yesterday");
  });

  it("says where each draft stands", () => {
    const o = { timeZone: "Africa/Lagos", name: "Max" };
    expect(entryStateWords(entry({ status: "posted", posted: { at: "2026-10-12T08:41:00.000Z", messageId: id(4), href: null, late: false } }), o)).toBe("You posted your standup for **Design** at 09:41.");
    expect(entryStateWords(entry({ status: "skipped" }), o)).toBe("You skipped today's standup for **Design**. The rollup lists you under No update, like anyone who didn't post.");
    expect(entryStateWords(entry({ status: "failed" }), o)).toBe("Max couldn't draft your standup for **Design** today. You can still write one in #Design.");
    expect(entryStateWords(entry({ status: "drafting" }), o)).toBe("Max is still drafting your standup for **Design**.");
    expect(STANDUP_HELPER_WORDS.none).toBe("No standup for you today. Your team lead switches it on for the team.");
    expect(STANDUP_HELPER_WORDS.postLead("Design", "#Design", "Max")).toBe("Your standup for **Design** is ready. Press Confirm to post it to #Design as yours, sent by Max.");
    expect(STANDUP_HELPER_WORDS.skipLead("Design")).toBe("Skip today's standup for Design? The rollup lists you under No update, like anyone who didn't post.");
  });

  it("shows a lead's rollup in lib/standup's words, and an open one as not ready yet", () => {
    const r: StandupRollupView = {
      id: id(9), team: { id: id(2), name: "Design" }, localDate: "2026-10-12", dateLabel: "Monday 12 October", status: "sent", reason: null, seen: false, href: "",
      content: { v: 1, team: { id: id(2), name: "Design" }, localDate: "2026-10-12", dateLabel: "Monday 12 October", cutoffAt: "2026-10-12T11:00:00.000Z", timeZone: "Africa/Lagos",
        counts: { members: 3, posted: 1 }, posted: [{ membershipId: id(5), name: "Ada Obi", at: "2026-10-12T08:41:00.000Z", messageId: null, conversationId: null }],
        blockers: [], noUpdate: [{ membershipId: id(6), name: "Ben Okafor" }, { membershipId: id(7), name: "Olu Ade" }], late: [] },
    };
    const text = rollupLines("acme", r);
    expect(text).toContain("**Design standup, Monday 12 October**");
    expect(text).toContain("1 of 3 posted by 12:00.");
    expect(text).toContain("**No update**\n- Ben Okafor\n- Olu Ade");
    expect(rollupLines("acme", { ...r, status: "open", content: null })).toBe(`**Design**: ${STANDUP_HELPER_WORDS.rollupOpen}`);
  });
});
