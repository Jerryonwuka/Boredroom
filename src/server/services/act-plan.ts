/**
 * Brenda for Mac, phase 3: plans (owner report and requests, 12 October 2026, after trying phase 2: "I wanted Brenda to
 * assist me with some things, like open an app on my desktop, and it said it can't do that, why?"; "Brenda is meant to
 * assist you do anything you need it to do"; his spoken request: "look through my documents and summarise them and maybe
 * open up"; contract sections 0, B, C, D, H).
 *
 * A plan is one sentence ("I'll …") and one to six steps in order, under one yes: open (an app, a page, a folder, a file,
 * a recent document, or a file shown in Finder; never by clicking), folder (read the files of one folder and write one new
 * file), file (phase 2's file job), screen (computer use, phase 2's step loop) and boredroom (a Boredroom change the model
 * prepared in the same look turn). The owner's permission rule (12 October 2026) holds exactly as in phase 2:
 * - (a) only the person's own request: proposePlan is called only by proposeTask (services/act), after every gate of a
 *   phase 2 proposal, for a Mac that runs plans; a Boredroom step must name a change prepared in this very turn;
 * - (b) propose, then wait for yes: what the Mac finds before asking (`scopePlan`: the app, the file, the folder's files,
 *   counts and names only) becomes the lines under the sentence, and the yes is to the sentence and the lines
 *   (`planHash`); the database refuses a yes before the scope came back and any step past the first without a yes;
 * - (c) outward steps ask again: a Boredroom change that reaches anyone else waits for its own yes when the plan reaches it
 *   (`runPlanChange`: `asking`, then step-answer, then run again);
 * - (d) "Act without asking" never applies: this file imports nothing about act mode (a unit test checks the imports), and
 *   a Boredroom change runs through the same confirmAction a Confirm press runs;
 * - (e) scope is not an action: it changes nothing and nothing runs from it;
 * - (f) stop ends a plan at once (services/act stopTask); every later step answers 409 ACT_ENDED;
 * - (g) every step route checks the desktop session, impersonation, 0059, the row, the recorded yes, that the step is the
 *   plan's current one (409 ACT_STEP_ORDER), the wall clock and the daily limit before any model call.
 *
 * Nothing from a file, a section, a name, a line, a plan or an id is ever logged: errors are `[act] <code>`.
 */
import { z } from "zod";
import { withUser, isUniqueViolation, type Db } from "@/server/db";
import type { OrgContext } from "@/server/lib/api";
import { AppError } from "@/server/lib/errors";
import { sha256, verifyPayload } from "@/server/lib/crypto";
import { forget0059, isMissingSchema, schema0059Ready } from "@/server/lib/schema-0059";
import { markdownToHtml } from "@/server/lib/markdown-html";
import { aiAllowance, recordActUsage } from "@/server/services/ai-usage";
import { recordAction } from "@/server/services/brenda";
import { ownerWords } from "@/server/services/assistant-activity";
import { createDoc } from "@/server/services/docs";
import type { LookV2Input } from "@/server/services/screen-help";
import {
  ACT_LIMITS, ACT_QUESTION, ACT_WORDS, BECAUSE, FIND_KINDS, FOUND_WHYS, FILE_SOURCES, NAMED_FOLDERS, OPEN_TARGETS, OUTPUT_FORMATS, PLAN_TOOLS,
  allUnmet, cleanOpenUrl, cleanPlan, folderOutputNameOf, folderTitle, foundTypeOf, installerLike, neverOpenName, noActMatch, outputNameOf, outwardChange,
  planHash, planLines, stepNeedsScope, stepQuestion,
  type FileSource, type FindKind, type FolderRef, type Found, type FoundWhy, type OpenTarget, type OutputFormat, type PlanStep, type PlanStepView,
  type StepAsk, type TaskViewV2,
} from "@/lib/act";
import { neverLookMatch, type AppRule } from "@/lib/screen-help";
import {
  ROW, actGate, assistantName, completePlanStep, endRow, expireOld, fail, planStepGate, planUnitsOf, readFileIn, readRow, tx,
  type FileResponse, type Out, type PlanDone, type PlanScope, type PreparedChange, type ProposeRefusal, type ProposeToolInput, type TaskRow,
} from "@/server/services/act";
import { actClient, actSafe, runFolderCompose, runFolderSection } from "@/server/services/act-model";

const E = ACT_WORDS.errors;
const R = ACT_WORDS.notProposed;

// ---- Gates ------------------------------------------------------------------------------------------------------------------

/** Whether migration 0059 is applied (plans, the Mac state). */
export async function ready0059(ctx: OrgContext): Promise<boolean> {
  try { return await withUser(ctx.user.profileId, (db) => schema0059Ready(db)); }
  catch (err) { if (isMissingSchema(err)) { forget0059(); return false; } throw err; }
}

/** Every plan route's gate: phase 2's (a desktop session, not impersonated, 0058, the workspace offers it), then 0059. */
async function planGate(ctx: OrgContext, o: { minimal?: boolean } = {}) {
  const look = await actGate(ctx, o);
  if (!(await ready0059(ctx))) throw fail(503, "ACT_NOT_READY", E.notReady);
  return look;
}

// ---- What the model proposes, checked (contract D.2) ------------------------------------------------------------------------

const LINK = /:\/\/|\bwww\.|\bmailto:|\]\(/i;
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const WORD = /^[\p{L}\p{N} ._-]{1,40}$/u;

/** One line of text between `min` and `max` characters, with no link: trimmed, or null. */
function lineText(v: unknown, min: number, max: number): string | null {
  if (typeof v !== "string" || CONTROL.test(v)) return null;
  const s = v.replace(/\s+/g, " ").trim();
  if (s.length < min || s.length > max || LINK.test(s)) return null;
  return s;
}
function wordsOf(v: unknown): string[] | null {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > ACT_LIMITS.words) return null;
  const out: string[] = [];
  for (const w of v) {
    if (typeof w !== "string") return null;
    const t = w.replace(/\s+/g, " ").trim();
    if (!t) continue;
    if (t.length > ACT_LIMITS.wordChars || !WORD.test(t)) return null;
    out.push(t);
  }
  return out;
}
function kindsOf(v: unknown): FindKind[] | null {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > FIND_KINDS.length) return null;
  if (!v.every((k) => (FIND_KINDS as readonly unknown[]).includes(k))) return null;
  return [...new Set(v as FindKind[])];
}
function sinceOf(v: unknown): number | null {
  if (v === undefined || v === null) return 0;
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= ACT_LIMITS.sinceDaysMax ? v : null;
}

type LookFacts = Pick<LookV2Input, "files" | "app" | "source" | "abilities" | "screen">;

/**
 * A folder reference: one the person named (Home, Desktop, Documents, Downloads, Pictures, Movies, Music), or one they
 * pointed at (the Finder window in front, a folder selected in Finder) by its exact name from the look; `none` only where
 * the step may search the usual folders.
 */
function folderOf(v: unknown, look: LookFacts, allowNone: boolean): FolderRef | null {
  if (!v || typeof v !== "object") return null;
  const o = v as { source?: unknown; name?: unknown };
  const name = typeof o.name === "string" ? o.name.trim() : "";
  if (o.source === "named") {
    const n = name.toLowerCase();
    return (NAMED_FOLDERS as readonly string[]).includes(n) ? { source: "named", name: n } : null;
  }
  if (o.source === "front_folder" || o.source === "finder_selection") {
    const held = look.files.find((f) => f.kind === "folder" && f.source === o.source && f.name === name);
    return held ? { source: o.source, name: held.name } : null;
  }
  if (o.source === "none") return allowNone ? { source: "none", name: "" } : null;
  return null;
}

/** The app's name as a rule names it when Brenda never opens or works in it (the fixed tables, the workspace's, the person's). */
function forbiddenApp(app: { name: string; bundleId: string | null }, lists: { workspace: AppRule[]; you: AppRule[] }): string | null {
  return noActMatch(app) ?? neverLookMatch(app, lists)?.name ?? null;
}

export type PlanEnv = {
  look: LookFacts;
  lists: { workspace: AppRule[]; you: AppRule[] };
  name: string;
  /** The Boredroom changes the model prepared earlier in this look turn, by number. */
  changes: ReadonlyMap<number, PreparedChange>;
  /** Changes already bound to a plan. */
  bound: ReadonlySet<number>;
  now?: number;
};
export type CheckedPlan = { plan: string; risky: boolean; steps: PlanStep[]; bound: number[] };

const refuse = (reason: string): ProposeRefusal => ({ refused: reason });

/** What a line adds after a change that reaches anyone else (M.8). */
export const ASK_AGAIN_TAIL = " (I'll ask again before it goes)";

/**
 * A prepared change as its line says it, whole: its card's summary, for a message the words it sends (the card showed
 * them in full; the yes is to the line, so the line carries them too), and who it reaches when the summary doesn't name
 * them (its readback). Null when that does not fit in one line with the ask-again tail: such a change is never bound to
 * a plan and keeps its own Confirm card (review, 12 October 2026: a long message was clipped to its first ~170
 * characters, its Confirm card was removed, and the hidden tail went out after two yeses to a cut-off version).
 */
export function changeSummary(c: Pick<PreparedChange, "summary" | "detail" | "readback">): string | null {
  const one = (s: string) => s.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim();
  const summary = one(c.summary);
  const detail = c.detail ? one(c.detail) : "";
  let s = detail ? `${summary.replace(/[:\s]+$/, "")}: “${detail}”` : summary;
  const lower = s.toLowerCase();
  const to = (c.readback?.to ?? []).map((x) => one(String(x))).filter((x) => x && x !== "Only you");
  const unnamed = to.filter((x) => !lower.includes(x.toLowerCase()) && !lower.includes((x.split(" ")[0] ?? "").toLowerCase()));
  if (unnamed.length) s = `${s} (to ${to.join(", ")})`;
  return s && s.length + ASK_AGAIN_TAIL.length <= ACT_LIMITS.lineChars ? s : null;
}

/**
 * The model's plan, checked whole (contract D.2.1, D.2.2): the counts, each step, the sentence, then what has to be on on
 * this Mac (never just "I can't": the first switch that is off comes back as `enable`, with the words the model is told).
 * Pure: everything it needs is in `env`.
 */
export function checkPlan(input: ProposeToolInput, env: PlanEnv): CheckedPlan | ProposeRefusal {
  const L = ACT_LIMITS;
  const raw = Array.isArray(input.steps) ? (input.steps as unknown[]) : null;
  if (!raw || raw.length < 1 || raw.length > L.planSteps) return refuse(R.steps);
  const kinds = raw.map((s) => (s && typeof s === "object" ? (s as { kind?: unknown }).kind : null));
  const count = (k: string) => kinds.filter((x) => x === k).length;
  if (count("open") > L.planOpens || count("screen") > 1 || count("folder") + count("file") > 1 || count("boredroom") > L.planChanges) return refuse(R.steps);
  const steps: PlanStep[] = [];
  const bound: number[] = [];
  const look = env.look;
  for (let i = 0; i < raw.length; i++) {
    const s = raw[i] as Record<string, unknown>;
    switch (s?.kind) {
      case "open": {
        const target = (OPEN_TARGETS as readonly unknown[]).includes(s.target) ? (s.target as OpenTarget) : null;
        if (!target) return refuse(R.plan);
        const words = wordsOf(s.words);
        const kindsList = kindsOf(s.kinds);
        let since = sinceOf(s.since_days);
        if (!words || !kindsList || since === null) return refuse(R.plan);
        const none: FolderRef = { source: "none", name: "" };
        if (target === "app") {
          const name = lineText(s.name, 1, L.appName);
          if (!name || name.includes("/")) return refuse(R.plan);
          const never = forbiddenApp({ name, bundleId: null }, env.lists);
          if (never) return refuse(R.forbidden(JSON.stringify(never)));
          // Installers, updaters and apps that erase never open (review, 12 October 2026; the Mac checks again).
          if (installerLike([name], null)) return refuse(R.installer);
          steps.push({ i, kind: "open", target, name, url: "", folder: none, words: [], kinds: [], sinceDays: 0 });
        } else if (target === "url") {
          const url = cleanOpenUrl(s.url);
          if (!url) return refuse(R.url);
          steps.push({ i, kind: "open", target, name: "", url, folder: none, words: [], kinds: [], sinceDays: 0 });
        } else if (target === "folder") {
          const folder = folderOf(s.folder, look, false);
          if (!folder) return refuse(R.folder);
          steps.push({ i, kind: "open", target, name: "", url: "", folder, words: [], kinds: [], sinceDays: 0 });
        } else {
          // A file they named or pointed at (one of the look's files), or one found by words in a folder they named or pointed
          // at (or, with none, the usual folders). Never something that runs, never a secret.
          const name = typeof s.name === "string" ? s.name.trim() : "";
          const held = name ? look.files.find((f) => f.kind !== "folder" && f.name === name) : undefined;
          if (held && neverOpenName(held.name)) return refuse(R.file);
          if (!held && !words.length) return refuse(R.file);
          const folder = held ? none : folderOf(s.folder ?? { source: "none", name: "" }, look, true);
          if (!folder) return refuse(R.folder);
          if (target === "recent" && since === 0) since = 7;
          steps.push({ i, kind: "open", target, name: held ? held.name : "", url: "", folder, words: held ? [] : words, kinds: held ? [] : kindsList, sinceDays: held ? 0 : since });
        }
        break;
      }
      case "folder": {
        const folder = folderOf(s.folder, look, false);
        if (!folder) return refuse(R.folder);
        const words = wordsOf(s.words);
        const kindsList = kindsOf(s.kinds);
        const since = sinceOf(s.since_days);
        const job = lineText(s.job, L.jobMin, L.jobMax);
        const perFile = s.per_file === true;
        const format = (OUTPUT_FORMATS as readonly unknown[]).includes(s.output_format) ? (s.output_format as OutputFormat) : null;
        if (!words || !kindsList || since === null || !job || !format || (format === "csv" && perFile)) return refuse(R.plan);
        steps.push({
          i, kind: "folder", folder, kinds: kindsList.length ? kindsList : ["any"], recursive: s.recursive === true, sinceDays: since, words, perFile, job,
          output: { format, name: folderOutputNameOf(folderTitle(folder), typeof s.output_name === "string" ? s.output_name : "", format) },
        });
        break;
      }
      case "file": {
        // Phase 2's file-job rules: one of the look's files, from an app Brenda works in.
        const source = (FILE_SOURCES as readonly unknown[]).includes(s.file_source) ? (s.file_source as FileSource) : null;
        const name = typeof s.file_name === "string" ? s.file_name : "";
        const held = source ? look.files.find((f) => f.source === source && f.name === name && f.kind !== "folder") : undefined;
        if (!held || neverOpenName(held.name)) return refuse(R.file);
        if ((held.source === "front_document" || held.source === "pointer") && !held.app) return refuse(R.file);
        const fromApp = held.app ? forbiddenApp(held.app, env.lists) : null;
        if (fromApp) return refuse(R.app(JSON.stringify(fromApp)));
        const format = (OUTPUT_FORMATS as readonly unknown[]).includes(s.output_format) ? (s.output_format as OutputFormat) : null;
        if (!format) return refuse(R.plan);
        steps.push({ i, kind: "file", file: { source: held.source as FileSource, name: held.name }, output: { format, name: outputNameOf(held.name, typeof s.output_name === "string" ? s.output_name : "", format) } });
        break;
      }
      case "screen": {
        const goal = lineText(s.goal, L.goalMin, L.goalMax);
        if (!goal) return refuse(R.plan);
        // Clicks and typing need the screen: never from a dropped file's request, never in an app Brenda doesn't work in.
        if (!look.screen || look.source === "drop" || !look.app) return refuse(R.unavailable);
        const never = forbiddenApp(look.app, env.lists);
        if (never) return refuse(R.app(JSON.stringify(never)));
        steps.push({ i, kind: "screen", goal });
        break;
      }
      case "boredroom": {
        const n = typeof s.change === "number" && Number.isInteger(s.change) ? s.change : -1;
        const c = env.changes.get(n);
        if (!c || env.bound.has(n) || bound.includes(n) || !PLAN_TOOLS.includes(c.tool)) return refuse(R.change);
        // The change's Confirm token must outlive a long plan by ten minutes (contract D.2.2).
        const exp = verifyPayload<{ exp?: number }>(c.token)?.exp ?? 0;
        if (exp * 1000 < (env.now ?? Date.now()) + L.changeMinutesLeft * 60_000) return refuse(R.change);
        const { outward, askKind } = outwardChange(c.tool, c.readback ?? null);
        // Every word the change will send is in its line, or it isn't part of the plan (review, 12 October 2026).
        const summary = changeSummary(c);
        if (!summary) return { refused: R.change, told: R.changeLong(n) };
        steps.push({ i, kind: "boredroom", tool: c.tool, token: c.token, summary, readback: c.readback ?? null, outward, askKind });
        bound.push(n);
        break;
      }
      default:
        return refuse(R.plan);
    }
  }
  const plan = cleanPlan(input.plan);
  if (!plan) return refuse(R.plan);
  // Every switch the plan needs that is off comes back at once, so one Turn it on covers the whole request (review, 12
  // October 2026: one setup per switch took three trips).
  const needs = allUnmet(steps, { useMac: look.abilities.useMac, fileWork: look.abilities.fileWork, accessibility: look.abilities.accessibility });
  const unmet = needs[0] ?? null;
  const labels = needs.filter((x): x is "mac" | "files" => x === "mac" || x === "files").map((x) => ACT_WORDS.switches[x]);
  if (unmet === "mac") return { refused: R.macOff(env.name), told: R.switchOff(labels), enable: "mac", needs };
  if (unmet === "files") return { refused: R.filesOff(env.name), told: R.switchOff(labels), enable: "files", needs };
  if (unmet === "accessibility") return { refused: R.unavailable, told: R.accessibility(env.name), enable: "accessibility", needs };
  const risky = input.risky === true || steps.some((s) => s.kind === "boredroom" && s.outward);
  return { plan, risky, steps, bound };
}

// ---- The view the Mac gets (contract H.2.1) ---------------------------------------------------------------------------------

/** A step as the Mac sees it: a Boredroom change without its tool, token, readback or ask. */
export function stepView(s: PlanStep): PlanStepView {
  if (s.kind === "boredroom") return { i: s.i, kind: "boredroom", summary: s.summary, outward: s.outward };
  return s;
}

export function planView(r: Pick<TaskRow, "id" | "plan_text" | "plan_sha256" | "answer_by" | "risky" | "step_cap" | "needs_scope" | "scoped_at" | "lines" | "steps">): TaskViewV2 {
  const waiting = r.needs_scope && !r.scoped_at;
  return {
    id: r.id, kind: "plan", v: 2, plan: r.plan_text, question: ACT_QUESTION, planSha256: waiting ? "" : r.plan_sha256,
    answerBy: new Date(r.answer_by).toISOString(), risky: r.risky, stepCap: r.step_cap, needsScope: waiting, lines: waiting ? null : r.lines ?? [],
    file: null, output: null, steps: (r.steps ?? []).map(stepView),
  };
}

// ---- Propose (contract D.2; from proposeTask only) ----------------------------------------------------------------------------

/**
 * A plan from the look turn, after proposeTask's gates (the person's own fresh request, an instruction, the switches): this
 * Mac runs plans, 0059 is applied, no other task lives, and the plan checks out (`checkPlan`). One row; its lines and hash
 * now when nothing needs looking up on the Mac, else after the scope.
 */
export async function proposePlan(ctx: OrgContext, o: { look: LookV2Input; lists: { workspace: AppRule[]; you: AppRule[] }; name: string; input: ProposeToolInput; changes: ReadonlyMap<number, PreparedChange>; bound: ReadonlySet<number> }): Promise<{ task: TaskViewV2; bound: number[] } | ProposeRefusal> {
  if (!(await ready0059(ctx))) return refuse(R.unavailable);
  if (!((o.look.abilities.plans ?? 0) >= 1)) return refuse(R.unavailable);
  if (o.look.abilities.busy) return refuse(R.busy);
  const checked = checkPlan(o.input, { look: o.look, lists: o.lists, name: o.name, changes: o.changes, bound: o.bound });
  if ("refused" in checked) return checked;
  const needsScope = checked.steps.some((s) => stepNeedsScope(s));
  const lines = needsScope ? null : planLines(checked.steps, {});
  // Until the scope came back the row holds the sentence's own hash (the column is never empty); no yes is taken meanwhile.
  const planSha = planHash(checked.plan, lines ?? []);
  const request = o.look.request.text.slice(0, ACT_LIMITS.request);
  const app = o.look.app ? o.look.app.name.slice(0, 80) : null;
  try {
    const row = await withUser(ctx.user.profileId, async (db) => {
      await expireOld(db, ctx);
      // A background job (Brenda and her helpers, migration 0060) lives beside one task: it never blocks a plan.
      const live = await db.maybeOne(`SELECT 1 FROM assistant_tasks WHERE membership_id = $1 AND status IN ('proposed', 'running', 'asking') AND kind <> 'job' LIMIT 1`, [ctx.membership.id]);
      if (live) return null;
      return db.one<TaskRow>(
        `INSERT INTO assistant_tasks AS t (organisation_id, membership_id, kind, plan_v, request_text, request_source, request_age_ms, app_name, plan_text, plan_sha256, risky,
                                           steps, lines, needs_scope, answer_by, step_cap)
         VALUES ($1, $2, 'plan', 2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12, now() + make_interval(secs => $13), $14)
         RETURNING ${ROW}`,
        [ctx.org.id, ctx.membership.id, request, o.look.request.via, Math.round(o.look.request.ageMs), app, checked.plan, planSha, checked.risky,
          JSON.stringify(checked.steps), lines ? JSON.stringify(lines) : null, needsScope, ACT_LIMITS.answerSeconds, ACT_LIMITS.stepCap]);
    });
    if (!row) return refuse(R.busy);
    return { task: planView(row), bound: checked.bound };
  } catch (err) {
    if (isUniqueViolation(err)) return refuse(R.busy);
    throw err;
  }
}

// ---- Scope: what the Mac found before asking (contract D.3, H.2.2) -------------------------------------------------------------

const oneLineName = (max: number) => z.string().min(1).max(max).refine((s) => !CONTROL.test(s) && !s.includes("/") && s.trim().length > 0);
const displayWhere = z.string().min(1).max(80).refine((s) => !CONTROL.test(s) && s.trim().length > 0);
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hex64 = z.string().regex(/^[0-9a-f]{64}$/);
const kindCount = z.number().int().min(0).max(ACT_LIMITS.folderFiles);
export const foundSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("app"), name: oneLineName(ACT_LIMITS.appName), bundleId: z.string().regex(/^[A-Za-z0-9.\-_]{1,255}$/).nullable(), where: displayWhere }),
  z.object({
    type: z.literal("files"), folder: displayWhere, count: z.number().int().min(1).max(ACT_LIMITS.folderFiles), total: z.number().int().min(1).max(1_000_000),
    kinds: z.object({ pdf: kindCount.optional(), word: kindCount.optional(), text: kindCount.optional(), spreadsheet: kindCount.optional(), image: kindCount.optional() }),
    bytes: z.number().int().min(0).max(ACT_LIMITS.folderBytes), nameHashes: z.array(hex64).max(ACT_LIMITS.folderFiles),
  }).refine((f) => f.total >= f.count && f.nameHashes.length === f.count && new Set(f.nameHashes).size === f.count
    && Object.values(f.kinds).reduce((a: number, b) => a + (b ?? 0), 0) === f.count),
  z.object({ type: z.literal("file"), name: oneLineName(ACT_LIMITS.fileName), kind: z.string().regex(/^[a-z0-9_]{1,16}$/), where: displayWhere, modified: ymd, lastUsed: ymd.nullable(), others: z.number().int().min(0).max(99) }),
  z.object({ type: z.literal("folder"), name: oneLineName(ACT_LIMITS.fileName) }),
]);
export const scopeSchema = z.object({
  version: z.literal(1),
  steps: z.array(z.object({ i: z.number().int().min(0).max(5), found: foundSchema.nullable(), why: z.enum(FOUND_WHYS).nullable().optional() })).min(1).max(ACT_LIMITS.planSteps),
});
export type ScopeInput = z.infer<typeof scopeSchema>;
export type ScopeAnswer = { status: "ready"; task: TaskViewV2 } | { status: "unresolved"; message: string; settings: "files" | null };

/** Where a step looked, in words ("Documents", "your home folder", "“Invoices”", "your Desktop, Documents and Downloads folders"). */
function whereWords(f: FolderRef): string {
  if (f.source === "named") return f.name === "home" ? "your home folder" : folderTitle(f);
  if (f.source === "none") return "your Desktop, Documents and Downloads folders";
  return `“${f.name}”`;
}

/** What the person hears when something can't be found or opened (contract M.8). */
export function unresolvedWords(step: PlanStep, why: FoundWhy, matched?: string | null): { message: string; settings: "files" | null } {
  const S = ACT_WORDS.scope;
  if (why === "timeout") return { message: S.timeout, settings: null };
  if (why === "runs" && !(step.kind === "open" && step.target === "app")) return { message: S.runs, settings: null };
  // A file that opens in an app Brenda never works in (review, 12 October 2026: a certificate opens Keychain Access).
  if (why === "forbidden" && step.kind === "open" && step.target !== "app" && step.target !== "folder" && step.target !== "url") return { message: S.fileForbidden, settings: null };
  if (step.kind === "open" && step.target === "app") {
    const name = matched || step.name;
    if (why === "runs") return { message: S.installer(name), settings: null };
    if (why === "forbidden") return { message: S.forbidden(name), settings: null };
    if (why === "quarantined") return { message: S.quarantined(name), settings: null };
    if (why === "outside") return { message: S.outside(name), settings: null };
    return { message: S.appNone(step.name), settings: null };
  }
  const folder = step.kind === "open" || step.kind === "folder" ? step.folder : { source: "none" as const, name: "" };
  if (why === "denied") return { message: S.denied(whereWords(folder)), settings: "files" };
  if (step.kind === "open" && step.target === "folder") return { message: S.gone, settings: null };
  if (why === "gone") return { message: step.kind === "folder" ? S.gone : S.fileNone(whereWords(folder)), settings: null };
  if (why === "forbidden" || why === "quarantined" || why === "outside") return { message: S.runs, settings: null };
  if (step.kind === "folder") return { message: S.folderNone(whereWords(folder)), settings: null };
  return { message: S.fileNone(whereWords(folder)), settings: null };
}

/**
 * What Brenda for Mac found for the plan's steps, before asking (contract D.3): checked, then the lines are written and the
 * hash taken over the sentence and the lines; or, when something can't be found or opened, the plan ends here with the
 * words to say. Nothing runs. Only Brenda for Mac, only the person's own proposed plan, once.
 */
export async function scopePlan(ctx: OrgContext, id: string, input: ScopeInput): Promise<ScopeAnswer> {
  const look = await planGate(ctx);
  const lists = { workspace: (look?.neverLook ?? []).filter((r) => r.source === "workspace"), you: (look?.neverLook ?? []).filter((r) => r.source === "you") };
  return tx(ctx, async (db): Promise<Out<ScopeAnswer>> => {
    const r = await readRow(db, ctx, id);
    if (!r) return { err: fail(404, "ACT_NOT_FOUND", E.notFound) };
    if (r.kind !== "plan" || !r.steps) return { err: fail(422, "ACT_INVALID", E.invalid) };
    if (r.status !== "proposed") return { err: fail(409, "ACT_ENDED", E.ended) };
    if (!r.needs_scope || r.scoped_at) return { err: fail(409, "ACT_SCOPED", E.scoped) };
    if (r.answer_passed) { await endRow(db, r.id, { status: "expired", reason: "expired", plan: true }); return { err: fail(410, "ACT_EXPIRED", E.expired) }; }
    const bad = async () => { await endRow(db, r.id, { status: "failed", reason: "failed", plan: true }); return { err: fail(422, "ACT_SCOPE", E.scope) }; };
    const steps = r.steps;
    const needing = steps.filter((s) => stepNeedsScope(s)).map((s) => s.i);
    const got = input.steps.map((s) => s.i);
    if (got.length !== needing.length || new Set(got).size !== got.length || !needing.every((i) => got.includes(i))) return bad();
    const found: Record<string, Found> = {};
    let unresolved: { step: PlanStep; why: FoundWhy; matched?: string | null } | null = null;
    for (const s of [...input.steps].sort((a, b) => a.i - b.i)) {
      const step = steps[s.i];
      if (!s.found) { unresolved ??= { step, why: s.why ?? "none" }; continue; }
      if (s.found.type !== foundTypeOf(step)) return bad();
      if (s.found.type === "app") {
        // The app it found, checked again by its own name and bundle id.
        const never = forbiddenApp({ name: s.found.name, bundleId: s.found.bundleId }, lists);
        if (never) { unresolved ??= { step, why: "forbidden", matched: never }; continue; }
        if (installerLike([s.found.name], s.found.bundleId)) { unresolved ??= { step, why: "runs", matched: s.found.name }; continue; }
      }
      if (s.found.type === "file" && neverOpenName(s.found.name)) { unresolved ??= { step, why: neverOpenName(s.found.name) === "runs" ? "runs" : "none" }; continue; }
      found[String(s.i)] = s.found as Found;
    }
    if (unresolved) {
      const w = unresolvedWords(unresolved.step, unresolved.why, unresolved.matched);
      await endRow(db, r.id, { status: "said_no", reason: "unresolved", summary: null, plan: true });
      return { ok: { status: "unresolved", message: w.message, settings: w.settings } };
    }
    const byIndex: Record<number, Found> = Object.fromEntries(Object.entries(found).map(([k, v]) => [Number(k), v]));
    const lines = planLines(steps, byIndex);
    const scope: PlanScope = { found };
    const u = await db.one<TaskRow>(
      `UPDATE assistant_tasks t SET lines = $2::jsonb, plan_sha256 = $3, scope = $4::jsonb, scoped_at = now(), answer_by = now() + make_interval(secs => $5)
       WHERE id = $1 AND status = 'proposed' RETURNING ${ROW}`,
      [r.id, JSON.stringify(lines), planHash(r.plan_text, lines), JSON.stringify(scope), ACT_LIMITS.answerSeconds]);
    return { ok: { status: "ready", task: planView(u) } };
  });
}

// ---- Progress: an open step done on the Mac (contract D.5.1) ---------------------------------------------------------------------

export const progressSchema = z.object({ version: z.literal(1), i: z.number().int().min(0).max(5), ok: z.boolean(), error: z.enum(["gone", "refused", "failed"]).nullable().optional() });
export type ProgressAnswer = { status: "done" | "failed" } & PlanDone;

/** An open step the Mac did (or couldn't: the plan ends failed, "What I did before that stays done."). */
export async function progressPlan(ctx: OrgContext, id: string, input: z.infer<typeof progressSchema>): Promise<ProgressAnswer> {
  await planGate(ctx);
  return tx(ctx, async (db): Promise<Out<ProgressAnswer>> => {
    const r = await readRow(db, ctx, id);
    if (!r) return { err: fail(404, "ACT_NOT_FOUND", E.notFound) };
    const g = await planStepGate(db, r, input.i, "open");
    if (g) return g;
    if (!input.ok) {
      const summary = `Couldn't: ${ACT_WORDS.progress[input.error ?? "failed"]}`;
      await endRow(db, r.id, { status: "failed", reason: "failed", summary, plan: true });
      return { ok: { status: "failed", planDone: false, summary } };
    }
    const done = await completePlanStep(db, r, { i: input.i });
    if (!done) return { err: fail(409, "ACT_ENDED", E.ended) };
    return { ok: { status: "done", ...done } };
  });
}

// ---- Run: a Boredroom change in a plan (contract D.5.4) --------------------------------------------------------------------------

export const runSchema = z.object({ version: z.literal(1), i: z.number().int().min(0).max(5) });
export type RunAnswer = ({ status: "done"; line: string } & PlanDone) | { status: "ask"; ask: StepAsk & { i: number } };

/**
 * A Boredroom change the plan reached. One that reaches anyone else asks again first (`asking`, its own question; the
 * Mac's step card; step-answer records the yes for this step alone), then runs when the Mac calls again. It runs through
 * confirmAction, exactly as the person's Confirm press would (its checks and its once-only claim).
 */
export async function runPlanChange(ctx: OrgContext, id: string, input: z.infer<typeof runSchema>): Promise<RunAnswer> {
  await planGate(ctx);
  const first = await tx(ctx, async (db): Promise<Out<{ ask: RunAnswer } | { token: string; summary: string }>> => {
    const r = await readRow(db, ctx, id);
    if (!r) return { err: fail(404, "ACT_NOT_FOUND", E.notFound) };
    const g = await planStepGate(db, r, input.i, "boredroom");
    if (g) return g;
    const step = r.steps![input.i] as Extract<PlanStep, { kind: "boredroom" }>;
    const exp = verifyPayload<{ exp?: number }>(step.token)?.exp ?? 0;
    if (exp * 1000 <= Date.now() + 5_000) {
      await endRow(db, r.id, { status: "failed", reason: "failed", summary: `Couldn't: ${E.changeExpired}`, plan: true });
      return { err: fail(409, "ACT_CHANGE_EXPIRED", E.changeExpired) };
    }
    if (step.outward && r.approved_ask?.i !== input.i) {
      // Outward: its own yes first (permission rule c). Quotes inside the change's summary become single ones, so a
      // message's words don't close the outer quote (integration, 12 October 2026: "go ahead with “Message Ada:
      // “Landing v2 is started””" read as a typo).
      // Whole, never clipped (review, 12 October 2026): the step's yes and its hash (step-answer's askSha256) cover every
      // word that goes out; a change too long for its line was never bound to the plan.
      const inner = step.summary.replace(/“/g, "‘").replace(/”/g, "’");
      const what = `go ahead with “${inner}”`;
      await db.query(`UPDATE assistant_tasks SET status = 'asking', pending_ask = $2::jsonb, approved_ask = NULL WHERE id = $1 AND status = 'running'`,
        [r.id, JSON.stringify({ kind: step.askKind, what, i: input.i })]);
      return { ok: { ask: { status: "ask", ask: { i: input.i, kind: step.askKind, what, question: stepQuestion(what), because: BECAUSE[step.askKind] } } } };
    }
    const claimed = await db.maybeOne(
      `UPDATE assistant_tasks SET step_started_at = now() WHERE id = $1 AND status = 'running' AND step_index = $2
         AND (step_started_at IS NULL OR step_started_at < now() - make_interval(secs => $3)) RETURNING id`,
      [r.id, input.i, ACT_LIMITS.claimSeconds]);
    if (!claimed) return { err: fail(409, "ACT_STEP_STALE", E.stepStale) };
    return { ok: { token: step.token, summary: step.summary } };
  });
  if ("ask" in first) return first.ask;
  const endFailed = async (code: string, message: string, status = 409) => {
    await tx(ctx, async (db) => { await endRow(db, id, { status: "failed", reason: "failed", summary: `Couldn't: ${message}`, plan: true }); return { ok: null }; });
    return fail(status, code, message);
  };
  const { confirmAction } = await import("@/server/services/copilot");
  let ran: { actions: { summary: string }[]; error: string | null };
  try {
    ran = await confirmAction(ctx, first.token);
  } catch (err) {
    if (err instanceof AppError && /expired/i.test(err.message)) throw await endFailed("ACT_CHANGE_EXPIRED", E.changeExpired);
    if (err instanceof AppError && err.status < 500) throw await endFailed("ACT_CHANGE_FAILED", err.message || E.changeFailed);
    console.error(`[act] ACT_CHANGE_FAILED ${actSafe(err)}`);
    throw await endFailed("ACT_CHANGE_FAILED", E.changeFailed, 502);
  }
  if (ran.error) throw await endFailed("ACT_CHANGE_FAILED", ran.error.slice(0, 300) || E.changeFailed);
  const line = ran.actions.map((a) => a.summary).filter(Boolean).join("; ").slice(0, ACT_LIMITS.summary) || first.summary;
  return tx(ctx, async (db): Promise<Out<RunAnswer>> => {
    const fresh = await readRow(db, ctx, id);
    // A stop meanwhile: the change was already made (one quick call), and the plan stays stopped.
    if (!fresh || fresh.status !== "running" || fresh.step_index !== input.i) return { err: fail(409, "ACT_ENDED", E.ended) };
    const done = await completePlanStep(db, fresh, { i: input.i, words: line });
    if (!done) return { err: fail(409, "ACT_ENDED", E.ended) };
    return { ok: { status: "done", line, ...done } };
  });
}

// ---- The folder job (contract C.2, D.5.2, K.6) -----------------------------------------------------------------------------------

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
export const folderFileSchema = z.object({
  version: z.literal(1),
  i: z.number().int().min(0).max(5),
  n: z.number().int().min(0).max(ACT_LIMITS.folderFiles - 1),
  file: z.object({
    name: oneLineName(ACT_LIMITS.fileName),
    kind: z.enum(["text", "pdf", "image"]),
    mediaType: z.string().max(100),
    text: z.string().max(ACT_LIMITS.folderFileText).nullable().optional(),
    data: z.string().max(Math.ceil(ACT_LIMITS.fileBytes / 3) * 4 + 4).refine((d) => d.length % 4 === 0 && BASE64.test(d)).nullable().optional(),
    bytes: z.number().int().min(0),
    pages: z.number().int().min(0).nullable().optional(),
    truncated: z.boolean().optional(),
  }),
});
export type FolderFileAnswer = { status: "ok"; n: number; section: { title: string; markdown: string } };

const scopeFiles = (r: TaskRow, i: number) => {
  const f = r.scope?.found?.[String(i)];
  return f?.type === "files" ? f : null;
};

/**
 * One file of a folder job the person said yes to: it must be one Brenda for Mac counted before asking (its name's hash in
 * the scope) and not one already read; its section (or notes) comes back, and nothing from it is kept.
 */
export async function folderFile(ctx: OrgContext, id: string, input: z.infer<typeof folderFileSchema>): Promise<FolderFileAnswer> {
  await planGate(ctx);
  const name = await assistantName(ctx);
  const allowance = await aiAllowance(ctx).catch(() => null);
  const nameHash = sha256(Buffer.from(input.file.name, "utf8"));
  const row = await tx(ctx, async (db): Promise<Out<TaskRow>> => {
    const r = await readRow(db, ctx, id);
    if (!r) return { err: fail(404, "ACT_NOT_FOUND", E.notFound) };
    const g = await planStepGate(db, r, input.i, "folder");
    if (g) return g;
    const files = scopeFiles(r, input.i);
    const seen = r.scope?.seen?.[String(input.i)] ?? [];
    // A secret (a password store or export) or something that runs is never read, whatever the Mac counted (review, 12
    // October 2026: the Mac's walk skips them; this is the server's own check).
    if (!files || input.n >= files.count || !files.nameHashes.includes(nameHash) || seen.includes(nameHash) || seen.length >= files.count || neverOpenName(input.file.name)) {
      await endRow(db, r.id, { status: "failed", reason: "failed", plan: true });
      return { err: fail(409, "ACT_FILE", E.file) };
    }
    if (allowance?.ready && allowance.remaining <= 0) { await endRow(db, r.id, { status: "stopped", reason: "limit", plan: true }); return { err: fail(429, "ACT_LIMIT", E.limit(allowance.limit, name)) }; }
    const scope: PlanScope = { ...(r.scope ?? {}), seen: { ...(r.scope?.seen ?? {}), [String(input.i)]: [...seen, nameHash] } };
    const claimed = await db.maybeOne(
      `UPDATE assistant_tasks SET step_started_at = now(), scope = $2::jsonb WHERE id = $1 AND status = 'running'
         AND (step_started_at IS NULL OR step_started_at < now() - make_interval(secs => $3)) RETURNING id`,
      [r.id, JSON.stringify(scope), ACT_LIMITS.claimSeconds]);
    if (!claimed) return { err: fail(409, "ACT_STEP_STALE", E.stepStale) };
    return { ok: { ...r, scope } };
  });
  const step = row.steps![input.i] as Extract<PlanStep, { kind: "folder" }>;
  const fileTokens = row.scope?.fileTokens ?? 0;
  const endFailed = async (status: number, code: string, message: string, tokens = 0) => {
    await tx(ctx, async (db) => { await endRow(db, row.id, { status: "failed", reason: "failed", units: planUnitsOf(row.steps_used, fileTokens + tokens), plan: true }); return { ok: null }; });
    return fail(status, code, message);
  };
  const file = readFileIn(input.file);
  if (!file) throw await endFailed(422, "ACT_INVALID", E.invalid);
  const client = await actClient();
  if (!client) throw await endFailed(503, "ACT_UNAVAILABLE", E.unavailable);
  let run: Awaited<ReturnType<typeof runFolderSection>>;
  try {
    run = await runFolderSection(client, { request: row.request_text ?? "", plan: row.plan_text, job: step.job, perFile: step.perFile, truncated: input.file.truncated === true, file });
  } catch (err) {
    console.error(`[act] ACT_FAILED ${actSafe(err)}`);
    throw await endFailed(502, "ACT_FAILED", E.failed);
  } finally {
    if (file.data) file.data = "";
    if (file.text) file.text = "";
  }
  const u = run.usage ?? {};
  const tokens = (Number(u.input_tokens) || 0) + (Number(u.output_tokens) || 0);
  void recordActUsage({ model: run.model, kind: "file", usage: run.usage, first: input.n === 0 });
  if ("failed" in run) throw await endFailed(502, "ACT_FAILED", run.failed, tokens);
  return tx(ctx, async (db): Promise<Out<FolderFileAnswer>> => {
    const fresh = await readRow(db, ctx, row.id);
    // A stop meanwhile wins: nothing is returned.
    if (!fresh || fresh.status !== "running" || fresh.step_index !== input.i) return { err: fail(409, "ACT_ENDED", E.ended) };
    const scope: PlanScope = { ...(fresh.scope ?? {}), fileTokens: (fresh.scope?.fileTokens ?? 0) + tokens };
    await db.query(`UPDATE assistant_tasks SET scope = $2::jsonb, units = $3, step_started_at = NULL, last_step_at = now() WHERE id = $1`,
      [fresh.id, JSON.stringify(scope), planUnitsOf(fresh.steps_used, scope.fileTokens ?? 0)]);
    return { ok: { status: "ok", n: input.n, section: { title: input.file.name, markdown: run.markdown } } };
  });
}

export const FOLDER_SKIPPED_WHYS = ["too_long", "too_big", "unreadable", "budget"] as const;
const SKIPPED_WORDS: Readonly<Record<(typeof FOLDER_SKIPPED_WHYS)[number], string>> = { too_long: "too long", too_big: "too big", unreadable: "couldn't be read", budget: "over what I can read in one go" };
export const folderFinishSchema = z.object({
  version: z.literal(1),
  i: z.number().int().min(0).max(5),
  sections: z.array(z.object({ title: oneLineName(ACT_LIMITS.fileName), markdown: z.string().min(1).max(ACT_LIMITS.sectionChars) })).max(ACT_LIMITS.folderFiles)
    .refine((xs) => xs.reduce((n, x) => n + x.markdown.length, 0) <= ACT_LIMITS.sectionsChars),
  skipped: z.array(z.object({ name: oneLineName(ACT_LIMITS.fileName), why: z.enum(FOLDER_SKIPPED_WHYS) })).max(ACT_LIMITS.folderFiles).default([]),
});

/** The whole output of a folder job a section per file (contract K.6): the folder's title, each section, then what wasn't read. */
export function assembleSections(folder: string, sections: { title: string; markdown: string }[], skipped: { name: string; why: (typeof FOLDER_SKIPPED_WHYS)[number] }[]): string {
  const body = `# ${folder} summary\n\n${sections.map((s) => `## ${s.title}\n\n${s.markdown}`).join("\n\n")}`;
  return skipped.length ? `${body}\n\n## Not read\n\n${skipped.map((s) => `- ${s.name}: ${SKIPPED_WORDS[s.why]}`).join("\n")}` : body;
}

/**
 * The end of a folder job: the sections the Mac kept become one new file (a section per file, assembled here; or one piece
 * composed from the notes by one more model call), as the file job makes it (Word and PDF as HTML, a private Boredroom
 * document for `doc`). The step completes; nothing from the files is kept.
 */
export async function folderFinish(ctx: OrgContext, id: string, input: z.infer<typeof folderFinishSchema>): Promise<FileResponse> {
  await planGate(ctx);
  const name = await assistantName(ctx);
  const allowance = await aiAllowance(ctx).catch(() => null);
  const row = await tx(ctx, async (db): Promise<Out<TaskRow>> => {
    const r = await readRow(db, ctx, id);
    if (!r) return { err: fail(404, "ACT_NOT_FOUND", E.notFound) };
    const g = await planStepGate(db, r, input.i, "folder");
    if (g) return g;
    const files = scopeFiles(r, input.i);
    const seen = r.scope?.seen?.[String(input.i)] ?? [];
    // The Mac can only finish with sections for files the server read with it.
    if (!files || input.sections.length > seen.length || input.sections.length + input.skipped.length > files.count) {
      await endRow(db, r.id, { status: "failed", reason: "failed", plan: true });
      return { err: fail(409, "ACT_FILE", E.file) };
    }
    if (!input.sections.length) {
      await endRow(db, r.id, { status: "failed", reason: "failed", summary: `Couldn't: ${E.fileFailed}`, plan: true });
      return { err: fail(422, "ACT_FAILED", E.fileFailed) };
    }
    const step = r.steps![input.i] as Extract<PlanStep, { kind: "folder" }>;
    if (!step.perFile && allowance?.ready && allowance.remaining <= 0) { await endRow(db, r.id, { status: "stopped", reason: "limit", plan: true }); return { err: fail(429, "ACT_LIMIT", E.limit(allowance.limit, name)) }; }
    const claimed = await db.maybeOne(
      `UPDATE assistant_tasks SET step_started_at = now() WHERE id = $1 AND status = 'running' AND (step_started_at IS NULL OR step_started_at < now() - make_interval(secs => $2)) RETURNING id`,
      [r.id, ACT_LIMITS.claimSeconds]);
    if (!claimed) return { err: fail(409, "ACT_STEP_STALE", E.stepStale) };
    return { ok: r };
  });
  const step = row.steps![input.i] as Extract<PlanStep, { kind: "folder" }>;
  const files = scopeFiles(row, input.i)!;
  const title = folderTitle(step.folder);
  const format = step.output.format;
  const outName = step.output.name;
  let tokens = 0;
  const endFailed = async (status: number, code: string, message: string) => {
    await tx(ctx, async (db) => { await endRow(db, row.id, { status: "failed", reason: "failed", units: planUnitsOf(row.steps_used, (row.scope?.fileTokens ?? 0) + tokens), plan: true }); return { ok: null }; });
    return fail(status, code, message);
  };
  let content: string;
  let sentence: string;
  if (step.perFile) {
    content = assembleSections(title, input.sections, input.skipped);
    const n = input.sections.length;
    const noun = (files.kinds.image ?? 0) === files.count ? (n === 1 ? "picture" : "pictures") : (files.kinds.image ?? 0) > 0 ? (n === 1 ? "file" : "files") : (n === 1 ? "document" : "documents");
    sentence = `I've written a summary of each of the ${n} ${noun} in ${title} into ${outName}.`;
  } else {
    const client = await actClient();
    if (!client) throw await endFailed(503, "ACT_UNAVAILABLE", E.unavailable);
    let run: Awaited<ReturnType<typeof runFolderCompose>>;
    try {
      run = await runFolderCompose(client, { request: row.request_text ?? "", plan: row.plan_text, job: step.job, format, notes: input.sections });
    } catch (err) {
      console.error(`[act] ACT_FAILED ${actSafe(err)}`);
      throw await endFailed(502, "ACT_FAILED", E.failed);
    }
    const u = run.usage ?? {};
    tokens = (Number(u.input_tokens) || 0) + (Number(u.output_tokens) || 0);
    void recordActUsage({ model: run.model, kind: "file", usage: run.usage, first: false });
    if ("failed" in run) throw await endFailed(502, "ACT_FAILED", run.failed);
    content = run.content;
    sentence = run.summary;
  }
  if (content.length > ACT_LIMITS.contentChars * 2) throw await endFailed(422, "ACT_FAILED", E.fileTooLong);
  // Still running (a stop meanwhile wins: nothing is made or returned).
  const still = await tx(ctx, async (db) => ({ ok: await db.maybeOne(`SELECT 1 FROM assistant_tasks WHERE id = $1 AND status = 'running'`, [row.id]) }));
  if (!still) throw fail(409, "ACT_ENDED", E.ended);
  let doc: FileResponse["doc"] = null;
  if (format === "doc") {
    const made = await createDoc(ctx, { title: outName.slice(0, 200), body: content, visibility: "private" });
    const href = `/app/${ctx.org.slug}/docs/${made.id}`;
    doc = { href, title: outName };
    // Logged with the generic owner words, as any document she saves: nothing says it came from the Mac.
    void recordAction(ctx, { tool: "create_doc", summary: ownerWords("doc"), outcome: "done", source: "chat", detail: { href, personalSummary: `Saved “${outName}” (only you can see it)` } });
  }
  const html = format === "docx" || format === "pdf" ? markdownToHtml(content, outName) : null;
  return tx(ctx, async (db): Promise<Out<FileResponse>> => {
    const fresh = await readRow(db, ctx, row.id);
    if (!fresh || fresh.status !== "running" || fresh.step_index !== input.i) return { err: fail(409, "ACT_ENDED", E.ended) };
    const done = await completePlanStep(db, fresh, { i: input.i, tokens });
    if (!done) return { err: fail(409, "ACT_ENDED", E.ended) };
    return { ok: { status: "done", content: format === "doc" ? "" : content, html, format: format as OutputFormat, name: outName, summary: done.summary ?? sentence, doc, planDone: done.planDone } };
  });
}

/** For the type of a database handle in tests. */
export type { Db };
