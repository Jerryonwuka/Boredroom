/**
 * The front desk's and the jobs' contract with Brenda for Mac, read with the server's own schemas (Brenda and her
 * helpers, build 1; contract T.2). Runs only with ACT_SEAM_DIR (or BRENDA_SEAM_DIR) set, after Rust wrote its bodies
 * there (`cargo test --lib -- --ignored seam_` in the helpers worktree): the router body, the Mac's records, a job's
 * creation, its Files steps (start, results of every shape, the step after a yes), its state and Undo, and a v2 look with
 * `front` and `lane`. Each file is optional here (the integrator runs both sides together); what is there must read.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { frontBodySchema, recordBodySchema } from "@/server/services/front";
import { createJobSchema, filesStepSchema, jobStateSchema, jobUndoneSchema } from "@/server/services/jobs";
import { readLookBodyV2Value } from "@/server/services/screen-help";
import { MAC_ACTION_KINDS } from "@/lib/front";

const dir = process.env.ACT_SEAM_DIR ?? process.env.BRENDA_SEAM_DIR ?? "";
const has = (name: string) => !!dir && existsSync(join(dir, name));
const read = (name: string) => JSON.parse(readFileSync(join(dir, name), "utf8")) as Record<string, unknown>;

describe.skipIf(!dir)("Rust's front-desk and job bodies (T.2)", () => {
  it.skipIf(!has("rust-front-request.json"))("the router body (B.4)", () => {
    const b = frontBodySchema.parse(read("rust-front-request.json"));
    expect(b.request.nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(b.messages.at(-1)!.content.replace(/\s+/g, " ").trim()).toBe(b.request.text);
    // Words only, never a picture: no image block and no base64 (a file's kind may be "image": the router sees names).
    expect(JSON.stringify(b)).not.toMatch(/\/Users\/|base64|"type":"image"/);
  });
  it.skipIf(!has("rust-front-record.json"))("the Mac's records (E.3)", () => {
    const b = recordBodySchema.parse(read("rust-front-record.json"));
    for (const r of b.records as { actions: { kind: string; words: string }[] }[]) {
      for (const a of r.actions) {
        expect(MAC_ACTION_KINDS as readonly string[]).toContain(a.kind);
        if (a.kind === "type_text") expect(a.words).toMatch(/^(Typed into .+|Typed it\.?|)$/);
      }
    }
  });
  it.skipIf(!has("rust-jobs-create.json"))("a job's creation (G.2)", () => { expect(createJobSchema.parse(read("rust-jobs-create.json")).token.length).toBeGreaterThan(10); });
  it.skipIf(!has("rust-files-step-0.json"))("the first Files step carries the start (G.3)", () => {
    const s = filesStepSchema.parse(read("rust-files-step-0.json"));
    expect(s).toMatchObject({ step: 0, transcript: null, results: [] });
    expect(s.start!.folders.length).toBeGreaterThan(0);
  });
  it.skipIf(!has("rust-files-step-1.json"))("later Files steps: the transcript and, across them, a result of every shape (H.5)", () => {
    // As the Mac posts them, at most 8 results a step (JOB_LIMITS.callsPerTurn): step 1, 2 and the one after the Trash's
    // yes (integration, 16 October 2026).
    const names = ["rust-files-step-1.json", "rust-files-step-2.json", "rust-files-step-4.json"].filter(has);
    const seen = new Set<string>();
    for (const n of names) {
      const s = filesStepSchema.parse(read(n));
      expect(s.transcript!.length, n).toBeGreaterThan(0);
      expect(s.results.length, n).toBeGreaterThan(0);
      for (const r of s.results) { expect(r.ok, `${n} ${r.name}`).toBe(true); seen.add(r.name); }
    }
    if (names.length === 3) expect([...seen].sort()).toEqual(["convert", "copy", "list_files", "make_folder", "move", "open", "organise", "read_text", "rename", "rename_by_date", "trash", "write_file"]);
  });
  it.skipIf(!has("rust-files-step-asked.json"))("the step after the person's yes (G.4)", () => {
    expect(filesStepSchema.parse(read("rust-files-step-asked.json"))).toMatchObject({ askAnswered: true, results: [] });
  });
  it.skipIf(!has("rust-job-state.json"))("pause and resume (G.6)", () => { jobStateSchema.parse(read("rust-job-state.json")); });
  it.skipIf(!has("rust-job-undone.json"))("Undo's record (G.11)", () => { jobUndoneSchema.parse(read("rust-job-undone.json")); });
  it.skipIf(!has("rust-look-front.json"))("a v2 look from a front-capable Mac (J.1)", () => {
    const l = readLookBodyV2Value(read("rust-look-front.json")).look;
    expect(l.front).toBe(true);
    expect(["auto", "now", "think"]).toContain(l.lane);
  });
});
