import { describe, expect, it } from "vitest";
import { EMPTY_INPUT, EXAMPLES, buildReport, items, reportFilename, summaryLine } from "@/components/marketing/tools/eod-report";

// The end-of-day report generator's template (owner request, 17 October 2026: SEO analysis, Content Plan page 14).

describe("items", () => {
  it("tidies bullet points", () => {
    expect(items("- one.\n* two\n• three\n1. four\n2) five...\n\n  six  ")).toEqual(["One", "Two", "Three", "Four", "Five...", "Six"]);
  });

  it("keeps numbers that only look like list markers", () => {
    expect(items("2.0 release shipped to staging\n10.5 hours of interviews transcribed\n1.5x faster checkout\n-5% churn\n3) 2.5 days saved")).toEqual([
      "2.0 release shipped to staging",
      "10.5 hours of interviews transcribed",
      "1.5x faster checkout",
      "-5% churn",
      "2.5 days saved",
    ]);
  });

  it("drops lines that are only a marker", () => {
    expect(items("-\n*\n1.\n•\nreal item")).toEqual(["Real item"]);
  });
});

describe("buildReport", () => {
  const input = { ...EMPTY_INPUT, name: "Ada", team: "Payments", date: "16 October 2026", hours: "7.5", decisions: "ship on friday? waiting on Sam", changed: "- webhook merged\n- test fixed", blocked: "", tomorrow: "finish backoff" };

  it("writes the four parts in the lead's order, decisions first", () => {
    const text = buildReport(input);
    expect(text).toBe([
      "End-of-day report: Ada, Payments, 16 October 2026", "",
      "2 changes, 1 decision waiting, nothing blocked. Hours today: 7.5.", "",
      "Decisions waiting on someone:", "- Ship on friday? waiting on Sam", "",
      "What changed since yesterday:", "- Webhook merged", "- Test fixed", "",
      "Blocked, and on whom:", "- Nothing blocked", "",
      "Tomorrow:", "- Finish backoff", "",
    ].join("\n"));
  });

  it("writes Markdown and a standup update", () => {
    const md = buildReport(input, "eod", "markdown");
    expect(md.startsWith("# End-of-day report: Ada, Payments, 16 October 2026\n")).toBe(true);
    expect(md).toContain("\n## Decisions waiting on someone\n");
    const standup = buildReport(input, "standup");
    expect(standup).toContain("Standup update: Ada, Payments, 16 October 2026");
    expect(standup).toContain("Yesterday:\n- Webhook merged\n- Test fixed");
    expect(standup).toContain("Today:\n- Finish backoff");
    expect(standup).toContain("Blockers:\n- None");
  });

  it("works with nothing typed", () => {
    expect(buildReport(EMPTY_INPUT)).toContain("End-of-day report\n\n0 changes, 0 decisions waiting, nothing blocked.");
    expect(summaryLine({ ...EMPTY_INPUT, blocked: "a\nb" })).toBe("0 changes, 0 decisions waiting, 2 blockers.");
  });

  it("names the download", () => {
    expect(reportFilename(input, "eod", "markdown")).toBe("end-of-day-report-ada.md");
    expect(reportFilename(EMPTY_INPUT, "standup", "text")).toBe("standup-update.txt");
  });

  it("has three examples, each giving a full report", () => {
    expect(EXAMPLES.map((e) => e.id)).toEqual(["engineering", "support", "design"]);
    for (const e of EXAMPLES) expect(buildReport(e.input).split("\n").filter((l) => l.startsWith("- ")).length).toBeGreaterThanOrEqual(5);
  });
});
