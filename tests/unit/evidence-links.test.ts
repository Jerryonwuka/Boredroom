/**
 * Every line has a source (owner decision, 8 October 2026: phase 7a). The link helper builds paths from a checked slug
 * and UUIDs only, escapes Markdown, and says "not available" for a figure that could not be read, never 0.
 */
import { describe, expect, it } from "vitest";
import { EVIDENCE_WORDS, NOT_AVAILABLE, countOrNA, countWords, evidenceHref, evidenceLink, mdEscape, sourcesSuffix, type EvidenceKind } from "@/lib/evidence-links";

const T = "11111111-1111-4111-8111-111111111111";
const C = "22222222-2222-4222-8222-222222222222";

describe("evidenceHref", () => {
  it("builds each kind's page inside the workspace", () => {
    const cases: [EvidenceKind, string | null, string][] = [
      ["task", T, `/app/acme/tasks/${T}`],
      ["conversation", C, `/app/acme/messages?c=${C}`],
      ["doc", T, `/app/acme/docs/${T}`],
      ["follow_up", T, `/app/acme/home/follow-ups/${T}`],
      ["assistant_item", T, `/app/acme/home/assistants/items/${T}`],
      ["review", null, "/app/acme/reviews?tab=submissions"],
      ["time_correction", null, "/app/acme/reviews?tab=corrections"],
      ["routine_run", T, `/app/acme/home/routines/${T}`],
      ["attendance", null, "/app/acme/attendance"],
    ];
    for (const [kind, id, href] of cases) expect(evidenceHref("acme", { kind, id })).toBe(href);
    expect(evidenceHref("acme", { kind: "message", id: T, conversationId: C })).toBe(`/app/acme/messages?c=${C}#m-${T}`);
  });

  it("gives no link for a bad slug or id", () => {
    expect(evidenceHref("Acme", { kind: "task", id: T })).toBeNull();
    expect(evidenceHref("acme/../x", { kind: "task", id: T })).toBeNull();
    expect(evidenceHref("", { kind: "review" })).toBeNull();
    expect(evidenceHref("acme", { kind: "task", id: "abc" })).toBeNull();
    expect(evidenceHref("acme", { kind: "task", id: `${T}/../../admin` })).toBeNull();
    expect(evidenceHref("acme", { kind: "task" })).toBeNull();
    expect(evidenceHref("acme", { kind: "message", id: T })).toBeNull(); // a message needs its conversation
    expect(evidenceHref("acme", { kind: "message", id: T, conversationId: "javascript:alert(1)" })).toBeNull();
    expect(evidenceHref("acme", { kind: "nonsense" as EvidenceKind, id: T })).toBeNull();
  });
});

describe("mdEscape and evidenceLink", () => {
  it("escapes Markdown and keeps one line", () => {
    expect(mdEscape("**Launch** [now](http://x) #1 <b>|~`_\\")).toBe("\\*\\*Launch\\*\\* \\[now\\]\\(http://x\\) \\#1 \\<b\\>\\|\\~\\`\\_\\\\");
    expect(mdEscape("  two\n lines  ")).toBe("two lines");
  });

  it("links a label, or leaves it escaped when there is no page", () => {
    expect(evidenceLink("acme", { kind: "task", id: T }, "“Landing [page]”")).toBe(`[“Landing \\[page\\]”](/app/acme/tasks/${T})`);
    expect(evidenceLink("acme", { kind: "task", id: "x" }, "Pricing *copy*")).toBe("Pricing \\*copy\\*");
  });
});

describe("sourcesSuffix", () => {
  it("lists the sources that have a page, each once, at most `max`", () => {
    expect(sourcesSuffix("acme", [{ kind: "task", id: T }, { kind: "follow_up", id: C }])).toBe(` ([task](/app/acme/tasks/${T}), [follow-up](/app/acme/home/follow-ups/${C}))`);
    expect(sourcesSuffix("acme", [{ kind: "task", id: T }, { kind: "task", id: T }, { kind: "review" }])).toBe(` ([task](/app/acme/tasks/${T}), [review](/app/acme/reviews?tab=submissions))`);
    expect(sourcesSuffix("acme", [{ kind: "task", id: T }, { kind: "doc", id: C }, { kind: "review" }, { kind: "attendance" }], 2)).toBe(` ([task](/app/acme/tasks/${T}), [doc](/app/acme/docs/${C}))`);
  });

  it("is empty when nothing resolves", () => {
    expect(sourcesSuffix("acme", [])).toBe("");
    expect(sourcesSuffix("acme", null)).toBe("");
    expect(sourcesSuffix("acme", [{ kind: "task", id: "x" }])).toBe("");
    expect(sourcesSuffix("acme", [{ kind: "task", id: T }], 0)).toBe("");
  });

  it("names every kind", () => {
    // Phase 7b (owner decision, 8 October 2026): commitments, loose ends and "blocked on you" items.
    // Phase 7c (owner decisions, 8–9 October 2026): a standup draft and a rollup.
    expect(Object.keys(EVIDENCE_WORDS).sort()).toEqual(["assistant_item", "attendance", "commitment", "conversation", "doc", "follow_up", "loose_end", "message", "review", "routine_run", "standup", "standup_rollup", "task", "task_block", "time_correction"]);
  });

  it("links a standup draft and a rollup to the Standup page, by id only (phase 7c)", () => {
    expect(sourcesSuffix("acme", [{ kind: "standup", id: T }, { kind: "standup_rollup", id: C }])).toBe(` ([standup](/app/acme/home/standup?e=${T}), [rollup](/app/acme/home/standup?r=${C}))`);
    expect(sourcesSuffix("acme", [{ kind: "standup", id: "x" }, { kind: "standup_rollup", id: null }])).toBe("");
  });

  it("links a commitment, a loose end and a block to their own pages, by id only", () => {
    expect(sourcesSuffix("acme", [{ kind: "commitment", id: T }, { kind: "loose_end", id: C }])).toBe(` ([commitment](/app/acme/commitments?c=${T}), [loose end](/app/acme/home/loose-ends?l=${C}))`);
    expect(sourcesSuffix("acme", [{ kind: "task_block", id: T }])).toBe(` ([item](/app/acme/home/assistants?f=${T}))`);
    expect(sourcesSuffix("acme", [{ kind: "commitment", id: "x" }, { kind: "loose_end", id: null }, { kind: "task_block" }])).toBe("");
  });
});

describe("counts", () => {
  it("never reads a figure it could not get as zero", () => {
    expect(countWords(3, "task")).toBe("3 tasks");
    expect(countWords(1, "task")).toBe("1 task");
    expect(countWords(0, "task")).toBe("0 tasks");
    expect(countWords(2, "person", "people")).toBe("2 people");
    expect(countWords(null, "task")).toBe(NOT_AVAILABLE);
    expect(countWords(undefined, "task")).toBe("not available");
    expect(countWords(Number.NaN, "task")).toBe("not available");
    expect(countOrNA(4)).toBe("4");
    expect(countOrNA(0)).toBe("0");
    expect(countOrNA(null)).toBe("not available");
  });
});
