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
