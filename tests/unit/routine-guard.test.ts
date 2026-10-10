import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Routines are fixed code, not a model, and never a Confirm (owner decision, 8 October 2026: phase 7a, contract D.3 and
// G.2): a run is not a chat turn. The templates' source never imports or names the chat's Confirm path or the model's
// SDK, so nothing a routine reads can press a Confirm or reach a model, now or after a later edit.

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");

describe("routine-templates.ts", () => {
  const src = read("src/server/services/routine-templates.ts");

  it("never imports or mentions the Confirm path or a model", () => {
    for (const w of ["confirmAction", "askFirst", "runWithoutAsking", "@anthropic-ai/sdk", "prepareConfirm", "recordUsage", "composeFollowUpAnswer", "startFollowUps"]) {
      expect(src.includes(w), w).toBe(false);
    }
  });

  it("does not load the copilot (whose Confirm path it must never reach)", () => {
    const imports = [...src.matchAll(/from\s+"([^"]+)"|import\(\s*"([^"]+)"\s*\)/g)].map((m) => m[1] ?? m[2]);
    expect(imports.length).toBeGreaterThan(0);
    expect(imports).not.toContain("@/server/services/copilot");
    expect(imports.filter((x) => /anthropic|copilot$|act-decision|undo/.test(x))).toEqual([]);
  });

  it("its only write is the chase's follow-up, as the person", () => {
    expect(src.match(/createFollowUps\(/g)?.length).toBe(1);
    expect(src).not.toMatch(/\bINSERT\b|\bUPDATE\b|\bDELETE\b/);
    expect(src).not.toMatch(/withWorker|withSystem/);
  });
});

describe("the loose ends template (owner decisions, 8 October 2026: phase 7b)", () => {
  const src = read("src/server/services/routine-templates.ts");

  it("its run is loose-end-detect's scan as the person, with at most one model call; the preview never scans", () => {
    const start = src.indexOf("async function looseEnds(");
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start);
    expect(body).toContain("scanLooseEnds(ctx, { days, source: \"routine\", useModel: true, maxModelCalls: 1, now })");
    expect(src.match(/scanLooseEnds\(/g)?.length).toBe(1);
    // The preview branch reads the open ones and nothing else.
    const preview = body.slice(body.indexOf("if (preview)"), body.indexOf("} else {"));
    expect(preview).toContain("listLooseEnds(");
    expect(preview).not.toContain("scanLooseEnds");
  });
});

describe("loose-end-detect.ts (owner decisions, 8 October 2026: phase 7b)", () => {
  const src = read("src/server/services/loose-end-detect.ts");

  it("never loads the copilot, a Confirm or Undo", () => {
    const imports = [...src.matchAll(/from\s+"([^"]+)"|import\(\s*"([^"]+)"\s*\)/g)].map((m) => m[1] ?? m[2]);
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.filter((x) => /copilot$|act-decision|undo|confirm/.test(x))).toEqual([]);
    for (const w of ["confirmAction", "askFirst", "runWithoutAsking", "prepareConfirm"]) expect(src.includes(w), w).toBe(false);
  });

  it("reads as the person, and its model call goes through the classifier only, counted against the person", () => {
    expect(src).not.toMatch(/withWorker/);
    expect(src).not.toContain("@anthropic-ai/sdk");
    expect(src).toContain("classifyBatch(");
    expect(src).toContain("purpose: \"loose_ends\"");
  });
});

describe("the workspace's commitments scan (phase 7b)", () => {
  const detect = read("src/server/services/commitment-detect.ts");
  const classify = read("src/server/services/commitment-classify.ts");

  it("never loads the copilot or a Confirm; the classifier's one call has no tools", () => {
    for (const src of [detect, classify]) {
      for (const w of ["confirmAction", "askFirst", "runWithoutAsking", "prepareConfirm", "@/server/services/copilot\""]) expect(src.includes(w), w).toBe(false);
    }
    expect(classify).toMatch(/messages: \[\{ role: "user", content \}\] \}\), \/\/ NO tools|\/\/ NO tools/);
    expect(classify).not.toMatch(/\btools:/);
    expect(detect).toContain("purpose: \"commitments\"");
    expect(detect).toContain("recordWorkspaceUsage(");
  });
});

describe("the worker's routine run", () => {
  const src = read("worker/handlers.ts");
  it("runs the template and nothing of the chat's", () => {
    const start = src.indexOf("const routineRun");
    const end = src.indexOf("const routineRelease");
    const body = src.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(body).toContain("runTemplate(c.ctx, c.routine, { mode: \"run\"");
    for (const w of ["confirmAction", "askFirst", "runWithoutAsking", "copilot"]) expect(body.includes(w), w).toBe(false);
  });
});

describe("the worker's loose ends and commitments jobs (phase 7b)", () => {
  const src = read("worker/handlers.ts");
  it("run the services and nothing of the chat's", () => {
    const start = src.indexOf("const commitmentsScan");
    const end = src.indexOf("const scanDeliverable");
    const body = src.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    for (const w of ["scanWorkspaceCommitments(", "sweepCommitments(", "runCommitmentFollowThrough(", "settleBlocks(", "runDueLooseEndFollowUps("]) expect(body, w).toContain(w);
    for (const w of ["confirmAction", "askFirst", "runWithoutAsking", "copilot"]) expect(body.includes(w), w).toBe(false);
  });
});
