import { describe, it, expect } from "vitest";

// The async standup's shared words (owner decisions, 8–9 October 2026: phase 7c, contract B.7; lib/standup, foundation):
// what a post carries, how a section is cleaned, and the rollup's headline. Pure.

import { cleanSection, rollupHeadline, rollupNoticeBody, standupDateLabel, standupPostBody, standupSinceLabel, type StandupRollupContent } from "@/lib/standup";

const content = (posted: number, members: number, o: Partial<StandupRollupContent> = {}): StandupRollupContent => ({
  v: 1, team: { id: "t", name: "Design" }, localDate: "2026-10-09", dateLabel: "Friday 9 October", cutoffAt: "2026-10-09T11:00:00.000Z", timeZone: "Africa/Lagos",
  counts: { members, posted }, posted: [], blockers: [], noUpdate: [], late: [], ...o,
});

describe("what a post carries (standupPostBody)", () => {
  it("is the date, then each section under its heading", () => {
    expect(standupPostBody({ dateLabel: "Friday 9 October", sinceLabel: "Since Friday", texts: { yesterday: "- Finished \"Landing page copy\"", today: "- \"Hero images\" (40%)", blocked: "- Nothing" } }))
      .toBe("Standup, Friday 9 October\nSince Friday:\n- Finished \"Landing page copy\"\nToday:\n- \"Hero images\" (40%)\nBlocked:\n- Nothing");
  });

  it("leaves an empty section out, except Blocked, which says Nothing", () => {
    expect(standupPostBody({ dateLabel: "Friday 9 October", sinceLabel: "Yesterday", texts: { yesterday: "", today: "  ", blocked: "" } }))
      .toBe("Standup, Friday 9 October\nBlocked:\n- Nothing");
  });

  it("stays within a message's 4,000 characters", () => {
    const long = Array.from({ length: 40 }, () => `- ${"x".repeat(110)}`).join("\n");
    expect(standupPostBody({ dateLabel: "Friday 9 October", sinceLabel: "Yesterday", texts: { yesterday: long, today: long, blocked: long } }).length).toBeLessThanOrEqual(4000);
  });
});

describe("a section as the person writes it (cleanSection)", () => {
  it("turns CRLF into LF and tabs into spaces, trims each line's end and the whole, and keeps at most one blank line", () => {
    expect(cleanSection("  - one\t two  \r\n\r\n\r\n\r\n- three\u0007 \n")).toBe("- one  two\n\n- three");
    expect(cleanSection("")).toBe("");
  });
});

describe("the rollup's words", () => {
  it("says how many posted by the cutoff, on the organisation's clock", () => {
    expect(rollupHeadline(content(4, 6))).toBe("4 of 6 posted by 12:00.");
    expect(rollupHeadline(content(0, 6))).toBe("Nobody posted by 12:00.");
    expect(rollupHeadline(content(6, 6))).toBe("Everyone posted by 12:00.");
  });

  it("names the blockers and who has no update by first name, neutrally", () => {
    const c = content(4, 6, {
      blockers: [{ membershipId: "b", name: "Ben Okafor", text: "\"Logo files\": waiting on Ada Obi", taskId: null, onMembershipId: "a", onName: "Ada Obi" }],
      noUpdate: [{ membershipId: "o", name: "Olu Ade" }, { membershipId: "s", name: "Sam Lee" }],
    });
    expect(rollupNoticeBody(c)).toBe("Blocked: Ben on Ada (logo files). No update: Olu, Sam.");
    expect(rollupNoticeBody(content(6, 6))).toBe("Everyone posted, nothing blocked.");
  });

  it("labels the day and the window", () => {
    expect(standupDateLabel("2026-10-09")).toBe("Friday 9 October");
    expect(standupSinceLabel("2026-10-12", "2026-10-09")).toBe("Since Friday");
    expect(standupSinceLabel("2026-10-09", "2026-10-08")).toBe("Yesterday");
  });
});
