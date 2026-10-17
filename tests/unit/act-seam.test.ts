/**
 * The contract between Brenda for Mac and Boredroom, checked both ways with each side's own code (integration,
 * 12 October 2026; contract B.3, B.6 to B.9, D.5, D.7 to D.9). Runs only with ACT_SEAM_DIR set, after:
 *   1. ACT_SEAM_DIR=<dir> pnpm vitest run tests/integration/act-flow.test.ts   (the server's real answers, written there)
 *   2. BRENDA_SEAM_DIR=<dir> cargo test --lib -- --ignored seam_                (in desktop/src-tauri: Rust reads those
 *      answers with its own parsers, and writes every body it sends, exactly as it writes them)
 * Here the server's own schemas and readers take Rust's bodies, and the transcript Rust holds after a step still hashes
 * to what the server recorded (the server keeps only that hash; the Mac re-serialises the transcript every step).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { lookBodyVersion, readLookBodyV2Value, readLookBodyValue } from "@/server/services/screen-help";
import { answerSchema, fileSchema, stepAnswerSchema, stepSchema, stopSchema, transcriptHash } from "@/server/services/act";
import { folderFileSchema, folderFinishSchema, progressSchema, runSchema, scopeSchema } from "@/server/services/act-plan";
import { macReportBodySchema } from "@/lib/screen-help";
import { imageSize, sniffImage } from "@/server/lib/image-meta";
import { sha256 } from "@/server/lib/crypto";

const dir = process.env.ACT_SEAM_DIR ?? "";
const read = (name: string) => JSON.parse(readFileSync(join(dir, name), "utf8")) as Record<string, unknown>;
const rust = (prefix: string) => (dir ? readdirSync(dir).filter((f) => f.startsWith(`rust-${prefix}`) && f.endsWith(".json")).sort() : []);
const image = (i: { mediaType: "image/jpeg" | "image/png"; data: string; width: number; height: number }) => {
  const bytes = Buffer.from(i.data, "base64");
  return sniffImage(i.mediaType, bytes) && JSON.stringify(imageSize(i.mediaType, bytes)) === JSON.stringify({ width: i.width, height: i.height });
};

describe.skipIf(!dir)("Rust's bodies, read by the server's own schemas (ACT_SEAM_DIR)", () => {
  it("every look body: v2 keys, desktop, follow-up, button and drop, and v1 for an older server", () => {
    // rust-look-front.json is the helpers build's front-capable look (tests/unit/front-seam.test.ts reads it).
    const names = rust("look-").filter((n) => n !== "rust-look-front.json");
    expect(names).toEqual(["rust-look-v1.json", "rust-look-v2-button.json", "rust-look-v2-desktop.json", "rust-look-v2-drop.json", "rust-look-v2-follow-up.json", "rust-look-v2-keys.json"]);
    const keys = readLookBodyV2Value(read("rust-look-v2-keys.json")).look;
    expect(keys).toMatchObject({ source: "keys", request: { via: "voice", ageMs: 900 }, app: { name: "Figma", bundleId: "com.figma.Desktop" }, hidden: ["1Password"], abilities: { useMac: true, fileWork: true, busy: null } });
    expect(keys.screen).toMatchObject({ width: 40, height: 24, pointer: { x: 12, y: 9 } });
    expect(keys.crop).toMatchObject({ width: 40, height: 24, pointer: { x: 20, y: 12 } });
    expect(keys.files.map((f) => `${f.source}:${f.kind}:${f.name}`)).toEqual(["dropped:text:notes.txt", "finder_selection:pdf:Q3 report.pdf", "front_document:document:Plan.docx", "pointer:spreadsheet:Budget.xlsx"]);
    expect(JSON.stringify(read("rust-look-v2-keys.json"))).not.toContain("/Users/x");
    expect(readLookBodyV2Value(read("rust-look-v2-desktop.json")).look.app).toEqual({ name: "Finder", bundleId: "com.apple.finder", desktop: true });
    expect(readLookBodyV2Value(read("rust-look-v2-follow-up.json")).look).toMatchObject({ source: "follow_up", request: { via: "typed" }, abilities: { busy: "file" } });
    expect(readLookBodyV2Value(read("rust-look-v2-button.json")).look).toMatchObject({ source: "button", crop: null, app: { name: "your screen", bundleId: null } });
    expect(readLookBodyV2Value(read("rust-look-v2-drop.json")).look).toMatchObject({ source: "drop", screen: null, crop: null, app: null, files: [{ source: "dropped", name: "notes.txt" }] });
    const v1 = read("rust-look-v1.json");
    expect(lookBodyVersion(v1)).toBe(1);
    expect(readLookBodyValue(v1).look).toMatchObject({ source: "keys", pointer: { x: 12, y: 9 }, app: { name: "Figma" } });
  });

  it("every answer, step answer and stop", () => {
    const answers = rust("answer-");
    expect(answers.length).toBe(8);
    for (const f of answers) expect(answerSchema.safeParse(read(f)).success, f).toBe(true);
    expect(read("rust-answer-yes-voice.json")).toEqual({ version: 1, answer: "yes", via: "voice", planSha256: sha256(Buffer.from("I'll rename these 6 files to Invoice-01 to Invoice-06.", "utf8")), text: "Yes, I need you to do this." });
    expect(read("rust-answer-yes-button.json")).not.toHaveProperty("text");
    expect(String(read("rust-answer-no-voice-long.json").text).length).toBeLessThanOrEqual(200);
    const steps = rust("step-answer-");
    expect(steps.length).toBe(3);
    for (const f of steps) expect(stepAnswerSchema.safeParse(read(f)).success, f).toBe(true);
    expect(read("rust-step-answer-yes-button.json").askSha256).toBe(sha256(Buffer.from("press Send on the email to Ada", "utf8")));
    const stops = rust("stop-");
    expect(stops.length).toBe(25);
    for (const f of stops) expect(stopSchema.safeParse(read(f)).success, f).toBe(true);
  });

  it("every step body: the first screenshot, results with a picture and an error, an answered ask", () => {
    for (const f of ["rust-step-0.json", "rust-step-1.json", "rust-step-ask-answered.json", "rust-step-1-from-server.json"]) {
      const r = stepSchema.safeParse(read(f));
      expect(r.success, `${f}: ${JSON.stringify(r.error?.issues ?? [])}`).toBe(true);
    }
    const s0 = stepSchema.parse(read("rust-step-0.json"));
    expect(s0).toMatchObject({ step: 0, transcript: null, results: [], pointer: { x: 12, y: 9 }, front: { name: "Finder", bundleId: "com.apple.finder" }, askAnswered: false });
    expect(image(s0.screen!)).toBe(true);
    const s1 = stepSchema.parse(read("rust-step-1.json"));
    expect(s1.results.map((r) => [r.id, r.name, r.ok])).toEqual([["c1", "left_click", true], ["c2", "screenshot", true], ["c3", "type", false]]);
    expect(image(s1.results[1].image!)).toBe(true);
    expect(s1.results[2].error).toBe("Not executed: a password field has the keyboard, and I never type into those.");
    expect(stepSchema.parse(read("rust-step-ask-answered.json"))).toMatchObject({ askAnswered: true, results: [] });
  });

  it("the transcript Rust holds after step 0 hashes to what the server recorded (its re-serialisation changes nothing)", () => {
    const body = stepSchema.parse(read("rust-step-1-from-server.json"));
    const recorded = readFileSync(join(dir, "server-step-act.hash"), "utf8").trim();
    expect(recorded).toMatch(/^[0-9a-f]{64}$/);
    expect(transcriptHash(body.transcript!)).toBe(recorded);
    // Rust sorts object keys its own way: the bytes differ from the server's, the hash does not.
    const server = JSON.stringify((read("server-step-act.json") as { append: unknown[] }).append);
    expect(JSON.stringify(body.transcript)).not.toBe(server);
  });

  it("every file body: text (with and without pages), a PDF itself, a picture", () => {
    const files = rust("file-");
    expect(files).toEqual(["rust-file-image.json", "rust-file-pdf.json", "rust-file-text-no-pages.json", "rust-file-text.json"]);
    for (const f of files) {
      const r = fileSchema.safeParse(read(f));
      expect(r.success, `${f}: ${JSON.stringify(r.error?.issues ?? [])}`).toBe(true);
    }
    expect(fileSchema.parse(read("rust-file-text.json")).file).toMatchObject({ source: "finder_selection", name: "Plan.docx", kind: "text", mediaType: "text/plain", text: "Plan, in words.", pages: 1, bytes: 2104 });
    const pdf = fileSchema.parse(read("rust-file-pdf.json")).file;
    expect([pdf.kind, pdf.mediaType, Buffer.from(pdf.data!, "base64").subarray(0, 5).toString("latin1")]).toEqual(["pdf", "application/pdf", "%PDF-"]);
    const pic = fileSchema.parse(read("rust-file-image.json")).file;
    expect(image({ mediaType: pic.mediaType as "image/jpeg", data: pic.data!, width: 40, height: 24 })).toBe(true);
    expect(JSON.stringify(files.map(read))).not.toContain("/Users/x");
  });
});

/**
 * Phase 3 (owner report and requests, 12 October 2026; contract I.5, N): plans. Rust writes rust-scope-*.json,
 * rust-progress-*.json, rust-run.json, rust-folder-<n>.json and rust-folder-finish.json, and (the notch page) the Mac
 * state body; the server's own schemas read them. Names never travel before the yes: only hashes.
 */
describe.skipIf(!dir || !rust("scope-").length)("phase 3: Rust's plan bodies, read by the server's own schemas (ACT_SEAM_DIR)", () => {
  it("every scope body: one entry per step, each found shape, no paths", () => {
    for (const f of rust("scope-")) {
      const r = scopeSchema.safeParse(read(f));
      expect(r.success, `${f}: ${JSON.stringify(r.error?.issues ?? [])}`).toBe(true);
      expect(JSON.stringify(read(f)), f).not.toMatch(/\/Users\/|\/Volumes\/|~\//);
    }
  });
  it("progress, run, the folder's files and its finish", () => {
    for (const f of rust("progress-")) expect(progressSchema.safeParse(read(f)).success, f).toBe(true);
    for (const f of rust("run")) expect(runSchema.safeParse(read(f)).success, f).toBe(true);
    const files = rust("folder-").filter((f) => f !== "rust-folder-finish.json");
    for (const f of files) {
      const r = folderFileSchema.safeParse(read(f));
      expect(r.success, `${f}: ${JSON.stringify(r.error?.issues ?? [])}`).toBe(true);
    }
    if (rust("folder-finish").length) {
      const r = folderFinishSchema.safeParse(read("rust-folder-finish.json"));
      expect(r.success, JSON.stringify(r.error?.issues ?? [])).toBe(true);
    }
  });
  it("the Mac state the page reports, when written", () => {
    for (const f of (dir ? readdirSync(dir) : []).filter((x) => /^(page|rust)-mac-state.*\.json$/.test(x))) expect(macReportBodySchema.safeParse(read(f)).success, f).toBe(true);
  });
});
