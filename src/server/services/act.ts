/**
 * Brenda for Mac, phase 2: tasks on the person's Mac, enforced on the server (owner request and permission rule,
 * 12 October 2026, verbatim: "Brenda cannot take any action except I explicitly give an instruction. So Brenda cannot
 * just be doing things in the background on its own. Except I explicitly say Brenda, I need you to do this. And then if
 * it's a core task, Brenda should confirm, oh, do you want me to do this? And then I'll say, yes, I need you to do this.
 * To just ensure that it's clarity before any instruction is carried out."; contract section 0, D.7, D.9, D.11, D.12).
 *
 * The record and the binding are kept here, in the person's own `assistant_tasks` row (migration 0058; the person and
 * the worker only):
 * - (a) Only the person's own request can start a task. `proposeTask` is called from one place, the look turn, with the
 *   look request's own record (the words, how they came, their age, all measured on the Mac). No other route, no chat,
 *   no routine, no notification and nothing the model reads can make a proposal; there is no server→Mac message that
 *   starts anything. The words themselves must ask for something to be done (`isInstruction`, review 12 October 2026):
 *   a question ("what does this email say?") never becomes a proposal, whatever the screen says.
 * - (b) Propose, then wait for yes. A proposal is one sentence ("I'll …"), its SHA-256, and 75 seconds to answer. Nothing
 *   runs until `answerTask` records the person's yes (how, when, the words) for that exact plan; anything else is no.
 * - (c) Outward steps ask again: the model's `ask_before` stops the loop (`asking`) until `stepAnswerTask` records a yes
 *   for that exact step; a send, delete or quit shortcut without it is refused (act-model).
 * - (d) "Act without asking" never applies: nothing here reads the person's act mode (a unit test checks the imports).
 * - (f) `stopTask` ends a live task at once; every later step answers 409 ACT_ENDED.
 * - (g) A step or a file job without the recorded yes answers 403 ACT_NOT_CONFIRMED, and the database itself refuses a
 *   running task with no yes (assistant_tasks_running_needs_yes).
 * Plus: one live task per person, the step cap, the wall clock, the transcript's hash (the Mac holds the computer-use
 * transcript; the server keeps only its SHA-256 and checks it on every step), the daily limit (task units on the row).
 *
 * Phase 3 (owner report and requests, 12 October 2026: "open an app on my desktop … it said it can't do that"; "Brenda is
 * meant to assist you do anything you need it to do"; contract D): a plan (`kind 'plan'`, migration 0059) is up to six
 * steps under one sentence and one yes; act-plan.ts proposes it, takes what the Mac found before asking, and runs its
 * opens, Boredroom changes and folder job; this file's answer, step, step-answer, file and stop take plan rows too, each
 * step only when it is the plan's current one. A switch that is off is never "I can't": the model is told which one, and
 * the notch offers Turn it on (`enable`).
 *
 * Nothing is kept beyond the row: never a picture, a step, a transcript or a file's contents. The person's words go when
 * the task ends; the plan, how the yes was given, the outcome and her short summary stay 30 days in their own Activity.
 * Nothing here logs a word, a plan, a name or an id: errors are `[act] <code>`.
 */
import { z } from "zod";
import { withUser, withWorker, isUniqueViolation, type Db } from "@/server/db";
import type { OrgContext } from "@/server/lib/api";
import { AppError } from "@/server/lib/errors";
import { sha256 } from "@/server/lib/crypto";
import { forget0058, isMissingSchema, retryWithout0058, schema0058Ready } from "@/server/lib/schema-0058";
import { schema0059Ready } from "@/server/lib/schema-0059";
import { imageSize, sniffImage, stripImageMetadata } from "@/server/lib/image-meta";
import { markdownToHtml } from "@/server/lib/markdown-html";
import { aiAllowance, recordActUsage } from "@/server/services/ai-usage";
import { assistantProfiles } from "@/server/services/assistant-profile";
import { recordAction } from "@/server/services/brenda";
import { ownerWords } from "@/server/services/assistant-activity";
import { createDoc } from "@/server/services/docs";
import { desktopLook, isDesktopSession, onLiveCall, type LookV2Input } from "@/server/services/screen-help";
import {
  ACT_LIMITS, ACT_QUESTION, ACT_WORDS, CONFIRM_VIAS, NO_VIAS, OUTPUT_FORMATS, FILE_SOURCES, actUnits, canonicalJson, cleanPlan, isInstruction, noActMatch, outputNameOf,
  planDoneParts, planSummary, verdict,
  type ActKind, type ConfirmVia, type EndReason, type FileSource, type Found, type Need, type OutputFormat, type PlanStep, type StepAsk, type TaskStatus, type TaskView,
  type TaskViewV2,
} from "@/lib/act";
import { neverLookMatch, type AppRule, type DesktopAct, type DesktopLook } from "@/lib/screen-help";
import { JOB_LIMITS } from "@/lib/front";
import { DEFAULT_ASSISTANT_NAME } from "@/lib/assistant-look";
import {
  actClient, actEffort, actSafe, askAnsweredMessage, firstMessage, operatorEffort, operatorFirstMessage, operatorModel, operatorStrongModel, runFileJob, runStep, toolResult, toolUsesOf,
  type ActMessage, type ApprovedAction, type FileIn, type ImageIn,
} from "@/server/services/act-model";

const E = ACT_WORDS.errors;
export const fail = (status: number, code: string, message: string) => new AppError(status, code, message);

// ---- The row --------------------------------------------------------------------------------------------------------------------

export type TaskRow = {
  id: string; kind: ActKind; status: TaskStatus; request_text: string | null; request_source: "voice" | "typed"; plan_text: string; plan_sha256: string; risky: boolean;
  file_source: FileSource | null; file_name: string | null; output_format: OutputFormat | null; output_name: string | null;
  answer_by: string; confirmed_at: string | null; confirmed_via: ConfirmVia | null; step_cap: number; steps_used: number; step_started_at: string | null;
  last_step_at: string | null; pending_ask: { kind: string; what: string; i?: number } | null; approved_ask: { kind: string; what: string; i?: number } | null;
  transcript_sha256: string | null; units: number; end_reason: EndReason | null; ended_at: string | null;
  /** Computed in the read: whether the answer window, the wall clock or the last step's gap has passed. */
  answer_passed: boolean; wall_passed: boolean; gap_ms: number | null;
  /**
   * Phase 3 (migration 0059), read through to_jsonb so the same statement works before it (null, false, 0, []): a plan's
   * steps (with its prepared Boredroom changes' tokens; server-only), the lines under its sentence, whether the Mac looks
   * things up before asking and what it found (`scope`), which step it is on and what each finished step did.
   */
  steps: PlanStep[] | null; lines: string[] | null; needs_scope: boolean; scope: PlanScope | null; scoped_at: string | null; step_index: number;
  progress: PlanProgress[];
  /**
   * Brenda and her helpers (migration 0060; owner brief, 12 October 2026), read through to_jsonb so the same statement
   * works before it (null): a job's helper, how it was authorised, its request row and its own record; whether it sat idle
   * 30 minutes or is 24 hours old.
   */
  helper?: "files" | "operator" | null; authorised_by?: "request" | "yes" | null; request_id?: string | null;
  job?: { title: string; doing: string; goal: string | null; model: "sonnet" | "opus"; failRun?: number; [k: string]: unknown } | null;
  job_idle?: boolean; job_aged?: boolean;
};

/** What a plan keeps while it lives (cleared when it ends): what the Mac found, the files read so far, each step's words, the tokens read. */
export type PlanScope = { found?: Record<string, Found>; seen?: Record<string, string[]>; words?: Record<string, string>; fileTokens?: number };
/** One finished step of a plan (content-free; kept 30 days with the row). */
export type PlanProgress = { i: number; kind: string; ok: boolean; at: string; tokens?: number };

/**
 * A task's wall clock in minutes, as SQL over the row `t`: a screen task 10, a file job 5, a plan 10, or 15 when it reads
 * files (phase 3, contract D.5). Read through to_jsonb, so it works before 0059.
 */
const WALL_MINUTES = `CASE t.kind WHEN 'screen' THEN ${ACT_LIMITS.screenMinutes} WHEN 'job' THEN ${JOB_LIMITS.maxHours * 60} WHEN 'plan' THEN CASE WHEN COALESCE(to_jsonb(t) -> 'steps', '[]'::jsonb) @> '[{"kind":"folder"}]'::jsonb
    OR COALESCE(to_jsonb(t) -> 'steps', '[]'::jsonb) @> '[{"kind":"file"}]'::jsonb THEN ${ACT_LIMITS.planMinutes} ELSE ${ACT_LIMITS.screenMinutes} END ELSE ${ACT_LIMITS.fileMinutes} END`;

export const ROW = `id, kind, status, request_text, request_source, plan_text, plan_sha256, risky, file_source, file_name, output_format, output_name,
  answer_by, confirmed_at, confirmed_via, step_cap, steps_used, step_started_at, last_step_at, pending_ask, approved_ask, transcript_sha256, units,
  end_reason, ended_at, answer_by < now() AS answer_passed,
  (confirmed_at IS NOT NULL AND confirmed_at < now() - make_interval(mins => ${WALL_MINUTES})) AS wall_passed,
  (EXTRACT(EPOCH FROM (now() - last_step_at)) * 1000)::int AS gap_ms,
  to_jsonb(t) -> 'steps' AS steps, to_jsonb(t) -> 'lines' AS lines, COALESCE((to_jsonb(t) ->> 'needs_scope')::boolean, false) AS needs_scope,
  to_jsonb(t) -> 'scope' AS scope, to_jsonb(t) ->> 'scoped_at' AS scoped_at, COALESCE((to_jsonb(t) ->> 'step_index')::int, 0) AS step_index,
  COALESCE(to_jsonb(t) -> 'progress', '[]'::jsonb) AS progress,
  to_jsonb(t) ->> 'helper' AS helper, to_jsonb(t) ->> 'authorised_by' AS authorised_by, to_jsonb(t) ->> 'request_id' AS request_id, to_jsonb(t) -> 'job' AS job,
  (COALESCE(last_step_at, created_at) < now() - make_interval(mins => ${JOB_LIMITS.idleMinutes})) AS job_idle,
  (created_at < now() - make_interval(hours => ${JOB_LIMITS.maxHours})) AS job_aged`;

// "paused" (Brenda and her helpers, migration 0060): a job while the person's Mac sleeps is live too (contract R.5 LIVE_ALL).
export const LIVE: readonly TaskStatus[] = ["proposed", "running", "asking", "paused"];
/** What every end of a task sets (contract D.7.6): the words go, the asks go, the claim goes. */
export const END_SET = `ended_at = now(), request_text = NULL, confirm_text = NULL, pending_ask = NULL, approved_ask = NULL, step_started_at = NULL`;
/** And a plan's (phase 3, contract D.6): its steps (with the prepared changes' tokens), lines and what the Mac found go too. */
export const PLAN_END_SET = `${END_SET}, steps = NULL, lines = NULL, scope = NULL`;

export async function readRow(db: Db, ctx: OrgContext, id: string, lock = true): Promise<TaskRow | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  return db.maybeOne<TaskRow>(`SELECT ${ROW} FROM assistant_tasks t WHERE id = $1 AND membership_id = $2 AND organisation_id = $3${lock ? " FOR UPDATE" : ""}`, [id, ctx.membership.id, ctx.org.id]);
}

/**
 * Ends a live row: its status and reason, who stopped it, its summary; the words cleared (a plan's steps, lines and scope
 * too: `plan`). Nothing when it already ended.
 */
export async function endRow(db: Db, id: string, o: { status: TaskStatus; reason: EndReason; stoppedBy?: string | null; summary?: string | null; units?: number | null; plan?: boolean; job?: boolean }): Promise<boolean> {
  // A job (migration 0060): no longer paused, its goal goes with the words, and its request row says how it ended.
  const jobSet = o.job ? `, paused_at = NULL, job = CASE WHEN job IS NULL THEN NULL ELSE job - 'goal' END` : "";
  const r = await db.maybeOne<{ request_id: string | null }>(
    `UPDATE assistant_tasks SET status = $2, end_reason = $3, stopped_by = COALESCE($4, stopped_by), summary = $5, units = COALESCE($6, units), ${o.plan ? PLAN_END_SET : END_SET}${jobSet}
     WHERE id = $1 AND status = ANY($7::text[]) RETURNING ${o.job ? "request_id" : "NULL::uuid AS request_id"}`,
    [id, o.status, o.reason, o.stoppedBy ?? null, o.summary ? o.summary.slice(0, ACT_LIMITS.summary) : null, o.units ?? null, [...LIVE]]);
  if (r?.request_id) {
    await db.query(`UPDATE mac_requests SET outcome = $2, summary = COALESCE($3, summary) WHERE id = $1`,
      [r.request_id, o.status === "done" ? "done" : o.status === "failed" ? "failed" : "stopped", o.summary ? o.summary.slice(0, 300) : null]);
  }
  return !!r;
}

/** A transaction's outcome: a value, or an error thrown only after the transaction committed (so the row's end stays). */
export type Out<T> = { ok: T } | { err: AppError };
export async function tx<T>(ctx: OrgContext, fn: (db: Db) => Promise<Out<T>>): Promise<T> {
  const out = await retryWithout0058(() => withUser(ctx.user.profileId, fn));
  if ("err" in out) throw out.err;
  return out.ok;
}

export function taskView(r: Pick<TaskRow, "id" | "kind" | "plan_text" | "plan_sha256" | "answer_by" | "risky" | "step_cap" | "file_source" | "file_name" | "output_format" | "output_name">): TaskView {
  return {
    id: r.id, kind: r.kind === "file" ? "file" : "screen", plan: r.plan_text, question: ACT_QUESTION, planSha256: r.plan_sha256, answerBy: new Date(r.answer_by).toISOString(), risky: r.risky,
    stepCap: r.step_cap,
    file: r.kind === "file" && r.file_source && r.file_name ? { source: r.file_source, name: r.file_name } : null,
    output: r.kind === "file" && r.output_format && r.output_name ? { format: r.output_format, name: r.output_name } : null,
  };
}

// ---- The gate every act route passes (contract D.7.2, D.16) -------------------------------------------------------------------

export async function ready0058(ctx: OrgContext): Promise<boolean> {
  try { return await withUser(ctx.user.profileId, (db) => schema0058Ready(db)); }
  catch (err) { if (isMissingSchema(err)) { forget0058(); return false; } throw err; }
}

/**
 * Brenda for Mac only (a desktop session), never while someone else is signed in as the person, 0058 applied; and, unless
 * `minimal` (a no, a stop: always allowed), the workspace offers it now (screen help available, the actions switch).
 */
export async function actGate(ctx: OrgContext, o: { minimal?: boolean } = {}): Promise<DesktopLook | null> {
  if (!(await isDesktopSession(ctx))) throw fail(403, "ACT_DESKTOP_ONLY", E.desktopOnly);
  if (ctx.user.impersonation) throw fail(403, "ACT_IMPERSONATED", E.impersonated);
  if (!(await ready0058(ctx))) throw fail(503, "ACT_NOT_READY", E.notReady);
  if (o.minimal) return null;
  const look = await desktopLook(ctx);
  if (look.act.reason === "switched_off") throw fail(403, "ACT_SWITCHED_OFF", E.switchedOff);
  if (!look.act.available) throw fail(503, "ACT_UNAVAILABLE", E.unavailable);
  return look;
}

/**
 * The app in front when a step comes, if Brenda never works in it (the fixed tables, then the workspace's and the person's
 * never-look lists), by the table's or the rule's own name, never the body's words (integration, 12 October 2026: the Mac
 * checks every action's app itself; the server ends the task too when one of these is in front).
 */
export function forbiddenFront(front: { name: string; bundleId: string | null } | null | undefined, look: Pick<DesktopLook, "neverLook"> | null): string | null {
  if (!front || !String(front.name ?? "").trim()) return null;
  const rules = look?.neverLook ?? [];
  return noActMatch(front) ?? neverLookMatch(front, { workspace: rules.filter((r) => r.source === "workspace"), you: rules.filter((r) => r.source === "you") })?.name ?? null;
}

export const assistantName = async (ctx: OrgContext) => (await assistantProfiles(ctx).catch(() => null))?.personal.name ?? DEFAULT_ASSISTANT_NAME;

// ---- Propose (contract D.7.1; from the look turn only) ----------------------------------------------------------------------

/** What the model's propose_task call carried (strict: every field is there). A plan (phase 3) carries `steps`. */
export type ProposeToolInput = { kind?: unknown; plan?: unknown; risky?: unknown; file_source?: unknown; file_name?: unknown; output_format?: unknown; output_name?: unknown; steps?: unknown };

/** A Boredroom change the model prepared earlier in this look turn (a Confirm card), by its number (phase 3, contract D.1.4). */
export type PreparedChange = { n: number; token: string; summary: string; tool: string; readback?: { to: string[]; what?: string } | null; detail?: string | null };

/**
 * A refusal: `refused` the reason (the model is told `Not proposed: <reason>. …`), or `told` the whole of what the model is
 * told; `enable` when a switch on this Mac is off (phase 3, owner report 12 October 2026: never just "I can't": the notch
 * shows which one and Turn it on).
 */
export type ProposeRefusal = { refused: string; told?: string; enable?: Need; needs?: Need[] };
export type ProposeResult = { task: TaskView | TaskViewV2; bound?: number[] } | ProposeRefusal;

/**
 * A proposal from the look turn, or why not (D.6.6's words, for the model). `look` is the look request's own record,
 * `act` and `lists` what the look route read. Never throws for a refusal; a database fault throws. With `plans` (this
 * Mac runs plans and 0059 is applied) and a `steps` list, the proposal is a plan (act-plan.ts), after the same gates.
 */
export async function proposeTask(ctx: OrgContext, o: {
  look: LookV2Input; act: DesktopAct; lists: { workspace: AppRule[]; you: AppRule[] }; name: string; input: ProposeToolInput; desktop: boolean;
  plans?: boolean; changes?: ReadonlyMap<number, PreparedChange>; bound?: ReadonlySet<number>;
}): Promise<ProposeResult> {
  const R = ACT_WORDS.notProposed;
  const { look, input } = o;
  // (a): only a desktop session's own look request, not impersonated, fresh, spoken or typed by the person.
  if (!o.desktop || ctx.user.impersonation) return { refused: R.unavailable };
  if (!o.act.ready || !(await ready0058(ctx))) return { refused: R.unavailable };
  if (o.act.reason === "switched_off") return { refused: R.switchedOff };
  if (!o.act.available) return { refused: R.unavailable };
  if (look.request.via !== "voice" && look.request.via !== "typed") return { refused: R.unavailable };
  if (!(look.request.ageMs >= 0 && look.request.ageMs <= ACT_LIMITS.requestAgeMs)) return { refused: R.unavailable };
  // (a): their own words ask for something to be done, not only a question (review, 12 October 2026).
  if (!isInstruction(look.request.text, o.name)) return { refused: R.notAsked };
  // Phase 3: a plan, from a Mac that runs plans, once 0059 is applied (the look turn offers the plan tool only then).
  if (o.plans && Array.isArray(input.steps)) {
    const { proposePlan } = await import("@/server/services/act-plan");
    return proposePlan(ctx, { look, lists: o.lists, name: o.name, input, changes: o.changes ?? new Map(), bound: o.bound ?? new Set() });
  }
  const kind: "screen" | "file" | null = input.kind === "screen" || input.kind === "file" ? input.kind : null;
  if (!kind) return { refused: R.plan };
  // Never just "I can't" (owner report, 12 October 2026): the model says which switch is off, the notch offers Turn it on.
  if (kind === "screen" && !look.abilities.useMac) return { refused: R.macOff(o.name), told: R.switchOff(ACT_WORDS.switches.mac), enable: "mac" };
  if (kind === "file" && !look.abilities.fileWork) return { refused: R.filesOff(o.name), told: R.switchOff(ACT_WORDS.switches.files), enable: "files" };
  if (look.abilities.busy) return { refused: R.busy };
  let file: { source: FileSource; name: string } | null = null;
  let output: { format: OutputFormat; name: string } | null = null;
  if (kind === "file") {
    const source = (FILE_SOURCES as readonly unknown[]).includes(input.file_source) ? (input.file_source as FileSource) : null;
    const name = typeof input.file_name === "string" ? input.file_name : "";
    const held = source ? look.files.find((f) => f.source === source && f.name === name && f.kind !== "folder") : undefined;
    if (!held) return { refused: R.file };
    // A file found in an app Brenda never looks at or never works in is never worked on (review, 12 October 2026). The
    // front document and the file under the pointer must say which app they came from.
    if ((held.source === "front_document" || held.source === "pointer") && !held.app) return { refused: R.file };
    const fromApp = held.app ? noActMatch(held.app) ?? neverLookMatch(held.app, o.lists)?.name ?? null : null;
    if (fromApp) return { refused: R.app(JSON.stringify(fromApp)) };
    const format = (OUTPUT_FORMATS as readonly unknown[]).includes(input.output_format) ? (input.output_format as OutputFormat) : null;
    if (!format) return { refused: R.plan };
    file = { source: held.source as FileSource, name: held.name };
    output = { format, name: outputNameOf(held.name, typeof input.output_name === "string" ? input.output_name : "", format) };
  } else {
    // A screen task needs the screen: never from a dropped file's request, never in an app Brenda doesn't work in.
    if (!look.app || look.source === "drop") return { refused: R.unavailable };
    const never = noActMatch(look.app) ?? neverLookMatch(look.app, o.lists)?.name ?? null;
    if (never) return { refused: R.app(JSON.stringify(never)) };
  }
  const plan = cleanPlan(input.plan);
  if (!plan) return { refused: R.plan };
  const planSha = sha256(Buffer.from(plan, "utf8"));
  const request = look.request.text.slice(0, ACT_LIMITS.request);
  const app = look.app ? look.app.name.slice(0, 80) : null;
  try {
    const row = await retryWithout0058(() => withUser(ctx.user.profileId, async (db) => {
      // A proposal the person never answered has expired; one still live blocks a new one (one task at a time).
      await expireOld(db, ctx);
      // A background job (migration 0060) lives beside one task: it never blocks a proposal.
      const live = await db.maybeOne(`SELECT 1 FROM assistant_tasks WHERE membership_id = $1 AND status = ANY($2::text[]) AND kind <> 'job' LIMIT 1`, [ctx.membership.id, [...LIVE]]);
      if (live) return null;
      return db.one<TaskRow>(
        `INSERT INTO assistant_tasks AS t (organisation_id, membership_id, kind, request_text, request_source, request_age_ms, app_name, plan_text, plan_sha256, risky,
                                     file_source, file_name, output_format, output_name, answer_by, step_cap)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now() + make_interval(secs => $15), $16)
         RETURNING ${ROW}`,
        [ctx.org.id, ctx.membership.id, kind, request, look.request.via, Math.round(look.request.ageMs), app, plan, planSha, input.risky === true,
          file?.source ?? null, file?.name ?? null, output?.format ?? null, output?.name ?? null, ACT_LIMITS.answerSeconds, ACT_LIMITS.stepCap]);
    }));
    if (!row) return { refused: R.busy };
    return { task: taskView(row) };
  } catch (err) {
    if (isUniqueViolation(err)) return { refused: R.busy };
    throw err;
  }
}

/**
 * A proposal the person never answered has expired (with a plan's steps, lines and scope once 0059 is there). Called
 * before a new proposal is made; one still live blocks it (one task at a time).
 */
export async function expireOld(db: Db, ctx: OrgContext): Promise<void> {
  const set = (await schema0059Ready(db)) ? PLAN_END_SET : END_SET;
  await db.query(
    `UPDATE assistant_tasks SET status = 'expired', end_reason = 'expired', ${set}
     WHERE membership_id = $1 AND organisation_id = $2 AND status = 'proposed' AND answer_by < now()`, [ctx.membership.id, ctx.org.id]);
}

// ---- Answer (contract D.7.2) ------------------------------------------------------------------------------------------------

export const answerSchema = z.object({
  version: z.literal(1),
  answer: z.enum(["yes", "no"]),
  via: z.enum(NO_VIAS),
  text: z.string().max(ACT_LIMITS.confirmText).nullable().optional(),
  planSha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export type AnswerInput = z.infer<typeof answerSchema>;

export type AnswerResult = { status: "running"; stepCap: number; deadline: string } | { status: "said_no" };

/**
 * The person's answer to a proposal: a yes is recorded (how, when, the words) and starts the task; anything else ends it.
 * A plan (phase 3, contract D.4): a yes only once what the Mac found came back (409 ACT_NOT_SCOPED, nothing changed; the
 * database refuses it too), for the sentence and the lines under it (`planHash`); its wall clock is 10 minutes, or 15
 * when it reads files.
 */
export async function answerTask(ctx: OrgContext, id: string, input: AnswerInput): Promise<AnswerResult> {
  const yes = input.answer === "yes";
  await actGate(ctx, { minimal: !yes });
  if (yes && (await onLiveCall(ctx))) throw fail(409, "ACT_ON_CALL", E.onCall);
  const name = yes ? await assistantName(ctx) : DEFAULT_ASSISTANT_NAME;
  const allowance = yes ? await aiAllowance(ctx).catch(() => null) : null;
  const words = typeof input.text === "string" ? input.text.trim().slice(0, ACT_LIMITS.confirmText) : "";
  return tx(ctx, async (db): Promise<Out<AnswerResult>> => {
    const r = await readRow(db, ctx, id);
    if (!r) return { err: fail(404, "ACT_NOT_FOUND", E.notFound) };
    if (r.status !== "proposed") return { err: fail(409, "ACT_ENDED", E.ended) };
    const plan = r.kind === "plan";
    if (r.answer_passed) {
      await endRow(db, r.id, { status: "expired", reason: "expired", plan });
      return { err: fail(410, "ACT_EXPIRED", E.expired) };
    }
    // The yes is to the sentence and the lines, which exist only once the Mac's scope came back (a no is always heard).
    if (yes && plan && r.needs_scope && !r.scoped_at) return { err: fail(409, "ACT_NOT_SCOPED", E.notScoped) };
    if (input.planSha256 !== r.plan_sha256) {
      await endRow(db, r.id, { status: "failed", reason: "failed", plan });
      return { err: fail(409, "ACT_PLAN", E.plan) };
    }
    if (yes) {
      const via = (CONFIRM_VIAS as readonly string[]).includes(input.via) ? (input.via as ConfirmVia) : null;
      // A yes is a real press (the Mac checks it) or words that pass the grammar, checked here again.
      const heard = via === "voice" || via === "typed" ? verdict(words, name) : via === "button" ? "yes" : "unclear";
      if (!via || heard !== "yes") {
        await endRow(db, r.id, { status: "said_no", reason: heard === "no" ? "said_no" : "unclear", plan });
        return { err: fail(422, "ACT_ANSWER", E.answer) };
      }
      if (allowance?.ready && allowance.remaining <= 0) {
        await endRow(db, r.id, { status: "stopped", reason: "limit", plan });
        return { err: fail(429, "ACT_LIMIT", E.limit(allowance.limit, name)) };
      }
      const u = await db.one<{ confirmed_at: string }>(
        `UPDATE assistant_tasks SET status = 'running', confirmed_at = now(), confirmed_via = $2, confirm_text = $3 WHERE id = $1 RETURNING confirmed_at`,
        [r.id, via, via === "button" ? null : words || null]);
      const minutes = r.kind === "screen" ? ACT_LIMITS.screenMinutes : plan ? planMinutes(r.steps) : ACT_LIMITS.fileMinutes;
      return { ok: { status: "running", stepCap: r.step_cap, deadline: new Date(new Date(u.confirmed_at).getTime() + minutes * 60_000).toISOString() } };
    }
    const reason: EndReason = input.via === "timeout" ? "expired" : input.via === "unresolved" ? "unresolved"
      : (input.via === "voice" || input.via === "typed") && words && verdict(words, name) === "unclear" ? "unclear" : "said_no";
    await endRow(db, r.id, { status: input.via === "timeout" ? "expired" : "said_no", reason, plan });
    return { ok: { status: "said_no" } };
  });
}

/** A plan's wall clock from the yes: 15 minutes when it reads files (a folder or file job), else 10 (contract D.5). */
export const planMinutes = (steps: readonly { kind: string }[] | null) =>
  (steps ?? []).some((s) => s.kind === "folder" || s.kind === "file") ? ACT_LIMITS.planMinutes : ACT_LIMITS.screenMinutes;

// ---- A plan's steps, in order (phase 3, contract D.5) ------------------------------------------------------------------------

/** A plan step's answer always says whether the plan is done, and then its summary. */
export type PlanDone = { planDone: boolean; summary?: string };

/**
 * The checks every plan step passes, in the contract's order (D.5), inside the row's lock: the row is a plan, it is
 * running (a proposal: 403 ACT_NOT_CONFIRMED; a step waiting for its own yes: 409 ACT_STEP_ASK; ended: 409 ACT_ENDED), the
 * person's yes is recorded, `i` is the step the plan is on and of this route's kind (409 ACT_STEP_ORDER, and the plan
 * fails), and the wall clock has not run out (409 ACT_ENDED). Null when the step may run.
 */
export async function planStepGate(db: Db, r: TaskRow, i: unknown, kind: PlanStep["kind"]): Promise<{ err: AppError } | null> {
  if (r.kind !== "plan") return { err: fail(422, "ACT_INVALID", E.invalid) };
  if (r.status === "proposed") return { err: fail(403, "ACT_NOT_CONFIRMED", E.notConfirmed) };
  if (r.status === "asking") return { err: fail(409, "ACT_STEP_ASK", E.stepAsk) };
  if (r.status !== "running") return { err: fail(409, "ACT_ENDED", E.ended) };
  if (!r.confirmed_at || !r.confirmed_via) return { err: fail(403, "ACT_NOT_CONFIRMED", E.notConfirmed) };
  const step = typeof i === "number" && Number.isInteger(i) ? r.steps?.[i] : undefined;
  if (i !== r.step_index || !step || step.kind !== kind || step.i !== i) {
    await endRow(db, r.id, { status: "failed", reason: "failed", plan: true });
    return { err: fail(409, "ACT_STEP_ORDER", E.stepOrder) };
  }
  if (r.wall_passed) { await endRow(db, r.id, { status: "stopped", reason: "time", plan: true }); return { err: fail(409, "ACT_ENDED", E.ended) }; }
  return null;
}

/** What the plan read from files so far, as task units (contract D.6): its computer-use steps and its file tokens. */
export const planUnitsOf = (stepsUsed: number, fileTokens: number) => actUnits("plan", { steps: stepsUsed, inputTokens: fileTokens });

/**
 * One step of a plan done (contract D.5): recorded in `progress` (content-free), the plan moves to the next step, and after
 * the last one it ends done with its summary (planSummary over what it did). `words`: a Boredroom change's done line or a
 * screen part's summary; `tokens`: what this step read from files (added to the plan's units). Only while the plan runs
 * and is still on this step. Returns the answer's plan part, or null when the plan is no longer on this step.
 */
export async function completePlanStep(db: Db, r: TaskRow, o: { i: number; words?: string | null; tokens?: number; stepsUsed?: number }): Promise<PlanDone | null> {
  const steps = r.steps ?? [];
  const step = steps[o.i];
  if (!step) return null;
  const scope: PlanScope = { ...(r.scope ?? {}) };
  if (o.words) scope.words = { ...(scope.words ?? {}), [String(o.i)]: o.words.slice(0, ACT_LIMITS.summary) };
  if (o.tokens) scope.fileTokens = (scope.fileTokens ?? 0) + o.tokens;
  const progress: PlanProgress[] = [...(r.progress ?? []), { i: o.i, kind: step.kind, ok: true, at: new Date().toISOString(), ...(o.tokens ? { tokens: o.tokens } : {}) }];
  const stepsUsed = o.stepsUsed ?? r.steps_used;
  const units = planUnitsOf(stepsUsed, scope.fileTokens ?? 0);
  const last = o.i === steps.length - 1;
  if (last) {
    const found: Record<number, Found> = Object.fromEntries(Object.entries(scope.found ?? {}).map(([k, v]) => [Number(k), v]));
    const words: Record<number, string> = Object.fromEntries(Object.entries(scope.words ?? {}).map(([k, v]) => [Number(k), v]));
    const summary = planSummary(steps, found, progress.map((p) => p.i), words);
    const done = await db.maybeOne(
      `UPDATE assistant_tasks SET status = 'done', end_reason = 'done', summary = $3, units = $4, steps_used = $5, progress = $6::jsonb, step_index = $7, last_step_at = now(), ${PLAN_END_SET}
       WHERE id = $1 AND status = 'running' AND step_index = $2 RETURNING id`,
      [r.id, o.i, summary, units, stepsUsed, JSON.stringify(progress), steps.length]);
    return done ? { planDone: true, summary } : null;
  }
  const moved = await db.maybeOne(
    `UPDATE assistant_tasks SET step_index = $2 + 1, progress = $3::jsonb, scope = $4::jsonb, units = $5, steps_used = $6, step_started_at = NULL, approved_ask = NULL, last_step_at = now()
     WHERE id = $1 AND status = 'running' AND step_index = $2 RETURNING id`,
    [r.id, o.i, JSON.stringify(progress), JSON.stringify(scope), units, stepsUsed]);
  return moved ? { planDone: false } : null;
}

/** "opened Figma; set a reminder for 15:00": what a plan did before its screen part (contract K.4). */
export function planDoneWords(r: TaskRow): string {
  const scope = r.scope ?? {};
  const found: Record<number, Found> = Object.fromEntries(Object.entries(scope.found ?? {}).map(([k, v]) => [Number(k), v]));
  const words: Record<number, string> = Object.fromEntries(Object.entries(scope.words ?? {}).map(([k, v]) => [Number(k), v]));
  return planDoneParts(r.steps ?? [], found, (r.progress ?? []).map((p) => p.i), words).join("; ");
}

// ---- Step (contract D.7.3, D.8) ------------------------------------------------------------------------------------------------

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const stepImage = z.object({
  mediaType: z.enum(["image/jpeg", "image/png"]),
  data: z.string().min(4).max(Math.ceil(ACT_LIMITS.stepImageBytes / 3) * 4 + 4).refine((d) => d.length % 4 === 0 && BASE64.test(d)),
  width: z.number().int().min(16).max(ACT_LIMITS.stepImageEdge),
  height: z.number().int().min(16).max(ACT_LIMITS.stepImageEdge),
});
const stepResult = z.object({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(40),
  ok: z.boolean(),
  text: z.string().max(ACT_LIMITS.resultText).nullable().optional(),
  image: stepImage.nullable().optional(),
  error: z.string().max(ACT_LIMITS.resultText).nullable().optional(),
});
export const stepSchema = z.object({
  version: z.literal(1),
  step: z.number().int().min(0).max(1000),
  transcript: z.array(z.object({ role: z.enum(["user", "assistant", "system"]), content: z.unknown() }).passthrough()).max(400).nullable(),
  results: z.array(stepResult).max(ACT_LIMITS.maxActions),
  screen: stepImage.nullable().optional(),
  pointer: z.object({ x: z.number().int().min(0), y: z.number().int().min(0) }).nullable().optional(),
  front: z.object({ name: z.string().max(200), bundleId: z.string().max(255).nullable() }).nullable().optional(),
  askAnswered: z.boolean().optional(),
  /** A plan's screen part (phase 3): its step's index, required for plans. */
  i: z.number().int().min(0).max(5).optional(),
});
export type StepInput = z.infer<typeof stepSchema>;

export type StepResponse = {
  status: "act" | "ask" | "finished" | "cannot";
  actions: ApprovedAction[];
  approvedOutward: { kind: string; what: string } | null;
  ask: StepAsk | null;
  note: string | null; summary: string | null; reason: string | null;
  append: ActMessage[];
  step: number; stepsLeft: number;
  /** Phase 3: the plan (or the screen task) is done; `summary` is then the plan's. */
  planDone: boolean;
};

/** A picture from the Mac checked as a look picture is: sniffed, sized as it says, its metadata stripped. */
function readStepImage(i: z.infer<typeof stepImage>): ImageIn | null {
  const bytes = Buffer.from(i.data, "base64");
  try {
    if (!bytes.length || bytes.length > ACT_LIMITS.stepImageBytes || !sniffImage(i.mediaType, bytes)) return null;
    const size = imageSize(i.mediaType, bytes);
    if (!size || size.width !== i.width || size.height !== i.height) return null;
    const clean = stripImageMetadata(i.mediaType, bytes);
    if (!clean) return null;
    const out = { mediaType: i.mediaType, data: clean.toString("base64"), width: i.width, height: i.height };
    clean.fill(0);
    return out;
  } finally {
    bytes.fill(0);
  }
}

export const transcriptHash = (messages: unknown[]) => sha256(canonicalJson(messages));

/**
 * One step of a screen task the person said yes to. Every check in the contract's order; the model is asked only once
 * the step is claimed; the row is updated only if the task is still running when the model answers (a stop meanwhile
 * wins: 409 ACT_ENDED, and nothing goes to the Mac).
 */
export async function stepTask(ctx: OrgContext, id: string, input: StepInput): Promise<StepResponse> {
  const look = await actGate(ctx);
  const forbidden = forbiddenFront(input.front, look);
  const onCall = await onLiveCall(ctx);
  const name = await assistantName(ctx);
  const allowance = await aiAllowance(ctx).catch(() => null);
  type Prep = { row: TaskRow; transcript: ActMessage[]; next: ActMessage; approved: { kind: string; what: string } | null };
  const prepare = () => tx(ctx, async (db): Promise<Out<Prep>> => {
    const r = await readRow(db, ctx, id);
    if (!r) return { err: fail(404, "ACT_NOT_FOUND", E.notFound) };
    const plan = r.kind === "plan";
    const job = r.kind === "job";
    if (job) {
      // The Mac operator (Brenda and her helpers, owner brief 12 October 2026; contract I, R.5): a job started by the
      // person's own recorded request (or their yes), with no proposal and no answer of its own. Its limits are the job's
      // (idle 30 minutes, 24 hours), not a wall clock; a paused job carries on once the Mac is back.
      if (r.helper !== "operator") return { err: fail(422, "ACT_INVALID", E.invalid) };
      if (r.status === "asking") return { err: fail(409, "ACT_STEP_ASK", E.stepAsk) };
      if (r.status === "paused") await db.query(`UPDATE assistant_tasks SET status = 'running', paused_at = NULL WHERE id = $1 AND status = 'paused'`, [r.id]);
      else if (r.status !== "running") return { err: fail(409, "ACT_ENDED", E.ended) };
      // Belt and braces over the database: the person's yes, or their own request judged routine.
      if (!r.confirmed_at && r.authorised_by !== "request") return { err: fail(403, "ACT_NOT_CONFIRMED", E.notConfirmed) };
      if (r.job_idle || r.job_aged) { await endRow(db, r.id, { status: "stopped", reason: "time", stoppedBy: r.job_aged ? "age" : "idle", job }); return { err: fail(409, "ACT_ENDED", E.ended) }; }
    } else if (plan) {
      // A plan's screen part (phase 3): only when it is the step the plan is on.
      const g = await planStepGate(db, r, input.i, "screen");
      if (g) return g;
    } else {
      if (r.kind !== "screen") return { err: fail(422, "ACT_INVALID", E.invalid) };
      if (r.status === "asking") return { err: fail(409, "ACT_STEP_ASK", E.stepAsk) };
      if (r.status === "proposed") return { err: fail(403, "ACT_NOT_CONFIRMED", E.notConfirmed) };
      if (r.status !== "running") return { err: fail(409, "ACT_ENDED", E.ended) };
      // Belt and braces: the database refuses 'running' without a yes; this never runs without one either.
      if (!r.confirmed_at || !r.confirmed_via) return { err: fail(403, "ACT_NOT_CONFIRMED", E.notConfirmed) };
    }
    // An app Brenda never works in came to the front: the task ends here, before the model is asked for anything more.
    if (forbidden) { await endRow(db, r.id, { status: "stopped", reason: "cannot", summary: `Couldn't: ${E.forbiddenApp(forbidden)}`, plan, job }); return { err: fail(403, "ACT_FORBIDDEN_APP", E.forbiddenApp(forbidden)) }; }
    // A call: a job pauses on the Mac (owner brief: "Mac jobs pause … and resume"), so the server only refuses the step.
    if (onCall && job) return { err: fail(409, "ACT_ON_CALL", E.onCall) };
    if (onCall) { await endRow(db, r.id, { status: "stopped", reason: "stopped", stoppedBy: "call", plan }); return { err: fail(409, "ACT_ON_CALL", E.onCall) }; }
    if (r.wall_passed) { await endRow(db, r.id, { status: "stopped", reason: "time", plan, job }); return { err: fail(409, "ACT_ENDED", E.ended) }; }
    if (r.steps_used >= r.step_cap) { await endRow(db, r.id, { status: "stopped", reason: "cap", plan, job }); return { err: fail(429, "ACT_STEP_CAP", E.stepCap) }; }
    if (input.step !== r.steps_used) return { err: fail(409, "ACT_STEP_STALE", E.stepStale) };
    if (r.gap_ms !== null && r.gap_ms < ACT_LIMITS.stepGapMs) return { err: fail(429, "ACT_WAIT", E.wait) };
    const invalidEnd = async () => { await endRow(db, r.id, { status: "failed", reason: "failed", plan, job }); return { err: fail(422, "ACT_INVALID", E.invalid) }; };
    let transcript: ActMessage[] = [];
    let next: ActMessage;
    let approved: Prep["approved"] = null;
    if (r.steps_used === 0) {
      if (input.transcript !== null || input.results.length || input.askAnswered || !input.screen) return invalidEnd();
      const screen = readStepImage(input.screen);
      if (!screen) return invalidEnd();
      const pointer = input.pointer && input.pointer.x < screen.width && input.pointer.y < screen.height ? input.pointer : null;
      const step = plan ? r.steps?.[r.step_index] : undefined;
      next = job
        ? operatorFirstMessage({ request: r.request_text ?? "", goal: r.job?.goal ?? r.plan_text, via: r.request_source, yes: (r.confirmed_via as ConfirmVia | null) ?? null, screen, pointer })
        : firstMessage({ request: r.request_text ?? "", plan: r.plan_text, via: r.confirmed_via as ConfirmVia, screen, pointer,
          ...(step?.kind === "screen" ? { goal: step.goal, done: planDoneWords(r) || null } : {}) });
    } else {
      if (!input.transcript || !input.transcript.length) return invalidEnd();
      transcript = input.transcript as ActMessage[];
      if (!r.transcript_sha256 || transcriptHash(transcript) !== r.transcript_sha256) {
        await endRow(db, r.id, { status: "failed", reason: "failed", plan, job });
        return { err: fail(409, "ACT_TRANSCRIPT", E.transcript) };
      }
      const last = transcript[transcript.length - 1];
      const uses = toolUsesOf(last);
      if (last.role !== "assistant" || !uses.length) return invalidEnd();
      if (input.askAnswered) {
        // The person said yes to the asked step (step-answer recorded it): the server answers the turn itself.
        if (input.results.length || !r.approved_ask || !uses.some((u) => u.name === "ask_before")) return invalidEnd();
        next = askAnsweredMessage(last);
        approved = r.approved_ask;
      } else {
        if (r.approved_ask) return invalidEnd();
        const computer = uses.filter((u) => u.toolset_name === "computer");
        if (computer.length !== uses.length || input.results.length !== computer.length) return invalidEnd();
        const content: Record<string, unknown>[] = [];
        for (let i = 0; i < computer.length; i++) {
          const res = input.results[i];
          if (res.id !== computer[i].id || res.name !== computer[i].name) return invalidEnd();
          if (res.ok && res.image) {
            const img = readStepImage(res.image);
            if (!img) return invalidEnd();
            content.push(toolResult({ id: res.id, member: true, image: img }));
          } else if (res.ok) {
            content.push(toolResult({ id: res.id, member: true, text: (res.text ?? "").trim() || "OK" }));
          } else {
            content.push(toolResult({ id: res.id, member: true, text: (res.error ?? res.text ?? "").trim() || ACT_WORDS.model.earlierFailed, error: true }));
          }
        }
        next = { role: "user", content };
      }
    }
    // No helper allowance during the pilot (decision 8): a job is never stopped by the daily limit and adds no units.
    if (!job && allowance?.ready && allowance.remaining <= 0) {
      await endRow(db, r.id, { status: "stopped", reason: "limit", plan });
      return { err: fail(429, "ACT_LIMIT", E.limit(allowance.limit, name)) };
    }
    // The claim: one request per step, taken again only when an earlier one was abandoned two minutes ago.
    const claimed = await db.maybeOne(
      `UPDATE assistant_tasks SET step_started_at = now() WHERE id = $1 AND status = 'running' AND steps_used = $2
         AND (step_started_at IS NULL OR step_started_at < now() - make_interval(secs => $3)) RETURNING id`,
      [r.id, r.steps_used, ACT_LIMITS.claimSeconds]);
    if (!claimed) return { err: fail(409, "ACT_STEP_STALE", E.stepStale) };
    return { ok: { row: r, transcript, next, approved } };
  });
  // A step sooner than 500 ms after the last one waits out the gap once and is checked again from the start (integration,
  // 12 October 2026): the Mac's quickest turns (a key, then a screenshot) can come back that fast, and refusing them ended
  // a task the person had said yes to while its row stayed live here until the purge. Nothing was written before ACT_WAIT.
  let prep: Prep;
  try {
    prep = await prepare();
  } catch (err) {
    if (!(err instanceof AppError) || err.code !== "ACT_WAIT") throw err;
    await new Promise((r) => setTimeout(r, ACT_LIMITS.stepGapMs));
    prep = await prepare();
  }

  const { row } = prep;
  const plan = row.kind === "plan";
  const job = row.kind === "job";
  const fileTokens = row.scope?.fileTokens ?? 0;
  // A job adds no units (decision 8: no helper allowance during the pilot).
  const unitsAt = (steps: number) => (job ? 0 : plan ? planUnitsOf(steps, fileTokens) : actUnits("screen", { steps }));
  const client = await actClient();
  if (!client) {
    await tx(ctx, async (db) => { await endRow(db, row.id, { status: "failed", reason: "failed", plan, job }); return { ok: null }; });
    throw fail(503, "ACT_UNAVAILABLE", E.unavailable);
  }
  const extraCalls = Math.max(0, Math.min(ACT_LIMITS.extraCalls, row.step_cap - row.steps_used - 1));
  const goalStep = plan ? row.steps?.[row.step_index] : undefined;
  // The Mac operator's models (owner brief, 12 October 2026; contract I.2): claude-sonnet-5-5, moving to claude-opus-5-5
  // for the rest of the job once it struggles; phase 2 and 3 tasks keep BRENDA_ACT_MODEL.
  const jobState = job ? { ...(row.job ?? { title: "", doing: "", goal: null, model: "sonnet" as const }) } : null;
  const modelOf = () => (jobState ? (jobState.model === "opus" ? { model: operatorStrongModel(), effort: actEffort() } : { model: operatorModel(), effort: operatorEffort() }) : {});
  const stepOnce = () => runStep(client, {
    transcript: prep.transcript, next: prep.next, plan: row.plan_text, approved: !!prep.approved, extraCalls,
    goal: jobState ? jobState.goal : goalStep?.kind === "screen" ? goalStep.goal : null,
    left: (calls) => row.step_cap - row.steps_used - calls, job, ...modelOf(),
  });
  let run: Awaited<ReturnType<typeof runStep>>;
  const usages: Awaited<ReturnType<typeof runStep>>["usages"] = [];
  try {
    run = await stepOnce();
    // (a) Every call of the step refused on Sonnet: the same step again on Opus, for the rest of the job.
    if (jobState && jobState.model === "sonnet" && run.refusedOut) {
      usages.push(...run.usages);
      jobState.model = "opus";
      run = await stepOnce();
    }
  } catch (err) {
    console.error(`[act] ACT_FAILED ${actSafe(err)}`);
    await tx(ctx, async (db) => { await endRow(db, row.id, { status: "failed", reason: "failed", units: unitsAt(row.steps_used + 1), plan, job }); return { ok: null }; });
    if (job) {
      const { aiFail } = await import("@/server/services/front");
      throw aiFail(err);
    }
    throw fail(502, "ACT_FAILED", E.failed);
  }
  usages.push(...run.usages);
  usages.forEach((u, i) => { void recordActUsage({ model: u.model, kind: job ? "operator" : "screen", usage: u.usage, first: row.steps_used === 0 && i === 0 }); });
  const steps = row.steps_used + run.calls;
  const units = unitsAt(steps);
  if (jobState) {
    // (b) two steps in a row whose actions all failed, or (c) 12 steps without finishing: Opus from the next step on.
    const allFailed = input.results.length > 0 && input.results.every((x) => !x.ok);
    jobState.failRun = allFailed ? (jobState.failRun ?? 0) + 1 : 0;
    if (jobState.model === "sonnet" && ((jobState.failRun ?? 0) >= 2 || steps >= 12)) jobState.model = "opus";
  }
  const hash = transcriptHash([...prep.transcript, ...run.append]);
  const o = run.outcome;
  return tx(ctx, async (db): Promise<Out<StepResponse>> => {
    // The step's own fields; a live task also lets go of its claim and of the approval this turn carried (an end clears
    // both, and more, through END_SET).
    const base = `steps_used = $3, transcript_sha256 = $4, last_step_at = now(), units = $5`;
    const live = `${base}, step_started_at = NULL, approved_ask = NULL`;
    const where = `WHERE id = $1 AND status = 'running' AND steps_used = $2`;
    const p = [row.id, row.steps_used, steps, hash, units];
    const ends = plan ? PLAN_END_SET : END_SET;
    let done: unknown;
    let planDone: PlanDone | null = null;
    if (o.status === "act") done = await db.maybeOne(`UPDATE assistant_tasks SET ${live} ${where} RETURNING id`, p);
    // A plan's asked step keeps its index (phase 3).
    else if (o.status === "ask") done = await db.maybeOne(`UPDATE assistant_tasks SET ${live}, status = 'asking', pending_ask = $6::jsonb ${where} RETURNING id`, [...p, JSON.stringify(plan ? { ...o.pending, i: row.step_index } : o.pending)]);
    else if (o.status === "finished" && plan) {
      // A plan's screen part is one step: the plan moves on (or ends done after its last step).
      const fresh = await readRow(db, ctx, row.id);
      done = fresh && fresh.status === "running" && fresh.steps_used === row.steps_used
        ? (planDone = await completePlanStep(db, fresh, { i: row.step_index, words: o.summary, stepsUsed: steps }))
        : null;
      if (done && !planDone?.planDone) await db.query(`UPDATE assistant_tasks SET transcript_sha256 = $2 WHERE id = $1`, [row.id, hash]);
    }
    else if (o.status === "finished") done = await db.maybeOne(`UPDATE assistant_tasks SET ${base}, status = 'done', end_reason = 'done', summary = $6, ${ends} ${where} RETURNING id`, [...p, o.summary.slice(0, ACT_LIMITS.summary)]);
    else if (o.status === "cannot") done = await db.maybeOne(`UPDATE assistant_tasks SET ${base}, status = 'stopped', end_reason = 'cannot', summary = $6, ${ends} ${where} RETURNING id`, [...p, `Couldn't: ${o.reason}`.slice(0, ACT_LIMITS.summary)]);
    else done = await db.maybeOne(`UPDATE assistant_tasks SET ${base}, status = 'failed', end_reason = 'failed', ${ends} ${where} RETURNING id`, p);
    if (!done) return { err: fail(409, "ACT_ENDED", E.ended) };
    // A job's own record (its model after any escalation; its goal goes when it ends).
    if (jobState) {
      const live = o.status === "act" || o.status === "ask";
      await db.query(`UPDATE assistant_tasks SET job = $2::jsonb WHERE id = $1`, [row.id, JSON.stringify({ ...jobState, goal: live ? jobState.goal : null })]);
    }
    // A job's end shows on the person's request row too (the Jobs list and Activity read it).
    if (job && row.request_id && o.status !== "act" && o.status !== "ask") {
      const outcome = o.status === "finished" ? "done" : o.status === "failed" ? "failed" : "stopped";
      const summary = o.status === "finished" ? o.summary : o.status === "cannot" ? `Couldn't: ${o.reason}` : null;
      await db.query(`UPDATE mac_requests SET outcome = $2, summary = COALESCE($3, summary) WHERE id = $1`, [row.request_id, outcome, summary ? summary.slice(0, 300) : null]);
    }
    if (o.status === "failed") return { err: fail(502, o.code, o.message) };
    const res: StepResponse = {
      status: o.status, actions: o.status === "act" ? o.actions : [],
      // Only when the actions came from the call that carried the yes (review, 12 October 2026).
      approvedOutward: o.status === "act" && prep.approved && run.approvedUsed ? prep.approved : null,
      ask: o.status === "ask" ? o.ask : null,
      note: run.note, summary: o.status === "finished" ? (planDone?.summary ?? o.summary) : null, reason: o.status === "cannot" ? o.reason : null,
      append: run.append, step: steps, stepsLeft: Math.max(0, row.step_cap - steps),
      planDone: plan ? !!planDone?.planDone : o.status === "finished",
    };
    return { ok: res };
  });
}

// ---- Step-answer (contract D.7.4) ------------------------------------------------------------------------------------------

export const stepAnswerSchema = z.object({
  version: z.literal(1),
  answer: z.enum(["yes", "no"]),
  via: z.enum(NO_VIAS),
  text: z.string().max(ACT_LIMITS.confirmText).nullable().optional(),
  askSha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export type StepAnswerInput = z.infer<typeof stepAnswerSchema>;

/**
 * The person's answer to an asked step: a yes covers exactly that step; anything else stops the task. A plan's asked step
 * (a screen action, or a Boredroom change that reaches someone else) keeps its index in the recorded yes (phase 3).
 */
export async function stepAnswerTask(ctx: OrgContext, id: string, input: StepAnswerInput): Promise<{ status: "running" | "stopped" }> {
  const yes = input.answer === "yes";
  await actGate(ctx, { minimal: !yes });
  const name = yes ? await assistantName(ctx) : DEFAULT_ASSISTANT_NAME;
  const words = typeof input.text === "string" ? input.text.trim().slice(0, ACT_LIMITS.confirmText) : "";
  return tx(ctx, async (db): Promise<Out<{ status: "running" | "stopped" }>> => {
    const r = await readRow(db, ctx, id);
    if (!r) return { err: fail(404, "ACT_NOT_FOUND", E.notFound) };
    if (!LIVE.includes(r.status)) return { err: fail(409, "ACT_ENDED", E.ended) };
    if (r.status !== "asking" || !r.pending_ask) return { err: fail(422, "ACT_INVALID", E.invalid) };
    const plan = r.kind === "plan";
    // A job's asked step (Brenda and her helpers, contract G.4): the Files helper's trash, or the operator's ask_before.
    const job = r.kind === "job";
    if (input.askSha256 !== sha256(Buffer.from(String(r.pending_ask.what ?? ""), "utf8"))) {
      await endRow(db, r.id, { status: "failed", reason: "failed", plan, job });
      return { err: fail(409, "ACT_PLAN", E.plan) };
    }
    if (r.wall_passed) { await endRow(db, r.id, { status: "stopped", reason: "time", plan, job }); return { err: fail(409, "ACT_ENDED", E.ended) }; }
    if (yes) {
      const via = (CONFIRM_VIAS as readonly string[]).includes(input.via) ? input.via : null;
      const heard = via === "voice" || via === "typed" ? verdict(words, name) : via === "button" ? "yes" : "unclear";
      if (!via || heard !== "yes") {
        await endRow(db, r.id, { status: "stopped", reason: heard === "no" ? "said_no" : "unclear", plan, job });
        return { err: fail(422, "ACT_ANSWER", E.answer) };
      }
      await db.query(`UPDATE assistant_tasks SET status = 'running', approved_ask = pending_ask, pending_ask = NULL, step_yeses = step_yeses + 1 WHERE id = $1`, [r.id]);
      return { ok: { status: "running" } };
    }
    await endRow(db, r.id, { status: "stopped", reason: "said_no", plan, job });
    return { ok: { status: "stopped" } };
  });
}

// ---- Stop (contract D.7.5) -------------------------------------------------------------------------------------------------

export const stopSchema = z.object({ version: z.literal(1), why: z.string().regex(/^[a-z_]{1,20}$/).optional() });

/** Why a file job's save failed on the Mac after the server recorded it done (review, 12 October 2026). */
const SAVE_FAILED = new Set(["file_failed", "pdf_unavailable"]);

/**
 * Ends a live task at once (idempotent: an ended task answers its status). Always allowed from the person's Mac. A file
 * job the server recorded done whose new file the Mac then could not save (why file_failed or pdf_unavailable, within ten
 * minutes) is corrected to failed, so the person's Activity says what the notch said (review, 12 October 2026).
 */
export async function stopTask(ctx: OrgContext, id: string, input: z.infer<typeof stopSchema>): Promise<{ status: TaskStatus }> {
  await actGate(ctx, { minimal: true });
  return tx(ctx, async (db): Promise<Out<{ status: TaskStatus }>> => {
    const r = await readRow(db, ctx, id);
    if (!r) return { err: fail(404, "ACT_NOT_FOUND", E.notFound) };
    // A plan whose last step saved a file the Mac then couldn't write reads the same (phase 3).
    if (r.status === "done" && (r.kind === "file" || r.kind === "plan") && SAVE_FAILED.has(input.why ?? "")) {
      const fixed = await db.maybeOne(
        `UPDATE assistant_tasks SET status = 'failed', end_reason = 'failed', stopped_by = $2, summary = NULL
         WHERE id = $1 AND status = 'done' AND kind IN ('file', 'plan') AND ended_at > now() - interval '10 minutes' RETURNING id`, [r.id, input.why]);
      return { ok: { status: fixed ? "failed" : r.status } };
    }
    if (!LIVE.includes(r.status)) return { ok: { status: r.status } };
    const why = input.why ?? "button";
    const reason: EndReason = why === "too_big" ? "size" : why === "time" ? "time" : "stopped";
    await endRow(db, r.id, { status: "stopped", reason, stoppedBy: why, plan: r.kind === "plan", job: r.kind === "job" });
    return { ok: { status: "stopped" } };
  });
}

/** Ends a task whose step body was too big to read (the route's 413), so the Mac's next step finds it ended. */
export async function endTooBig(ctx: OrgContext, id: string): Promise<void> {
  try {
    await tx(ctx, async (db) => { const r = await readRow(db, ctx, id); if (r) await endRow(db, r.id, { status: "stopped", reason: "size", stoppedBy: "too_big", plan: r.kind === "plan" }); return { ok: null }; });
  } catch { /* the 413 still answers */ }
}

// ---- The file job (contract D.9) -------------------------------------------------------------------------------------------

export const fileSchema = z.object({
  version: z.literal(1),
  file: z.object({
    source: z.enum(FILE_SOURCES),
    name: z.string().min(1).max(ACT_LIMITS.fileName),
    kind: z.enum(["text", "pdf", "image"]),
    mediaType: z.string().max(100),
    text: z.string().max(ACT_LIMITS.fileTextChars).nullable().optional(),
    data: z.string().max(Math.ceil(ACT_LIMITS.fileBytes / 3) * 4 + 4).nullable().optional(),
    bytes: z.number().int().min(0),
    pages: z.number().int().min(0).nullable().optional(),
  }),
  /** A plan's file job (phase 3): its step's index, required for plans. */
  i: z.number().int().min(0).max(5).optional(),
});
export type FileInput = z.infer<typeof fileSchema>;
/**
 * The new file. `planDone` (phase 3): the task is done (a file job always; a plan after its last step), and then `summary`
 * is the plan's; otherwise it is the job's own sentence.
 */
export type FileResponse = { status: "done"; content: string; html: string | null; format: OutputFormat; name: string; summary: string; doc: { href: string; title: string } | null; planDone: boolean };

/** The file the Mac read, checked: text as text; a PDF must be one; a picture as a look picture. Null when it is not what it says. */
export function readFileIn(f: Pick<FileInput["file"], "name" | "kind" | "mediaType" | "text" | "data">): FileIn | null {
  if (f.kind === "text") {
    if (typeof f.text !== "string" || !f.text.trim()) return null;
    return { name: f.name, kind: "text", mediaType: "text/plain", text: f.text };
  }
  if (typeof f.data !== "string" || f.data.length % 4 !== 0 || !BASE64.test(f.data)) return null;
  const bytes = Buffer.from(f.data, "base64");
  try {
    if (!bytes.length || bytes.length > ACT_LIMITS.fileBytes) return null;
    if (f.kind === "pdf") {
      if (f.mediaType !== "application/pdf" || bytes.subarray(0, 5).toString("latin1") !== "%PDF-") return null;
      return { name: f.name, kind: "pdf", mediaType: "application/pdf", data: f.data };
    }
    const type = f.mediaType === "image/png" ? "image/png" : f.mediaType === "image/jpeg" ? "image/jpeg" : null;
    if (!type || !sniffImage(type, bytes)) return null;
    const size = imageSize(type, bytes);
    if (!size || size.width > 2_576 || size.height > 2_576) return null;
    const clean = stripImageMetadata(type, bytes);
    if (!clean) return null;
    const out: FileIn = { name: f.name, kind: "image", mediaType: type, data: clean.toString("base64") };
    clean.fill(0);
    return out;
  } finally {
    bytes.fill(0);
  }
}

/**
 * A file job the person said yes to: the file they gave (checked to be the one they said yes to), one model call, the new
 * file's contents (and, for Word and PDF, the one HTML the server makes), or a private Boredroom document. Nothing from
 * the file or the output is stored or logged.
 */
export async function fileTask(ctx: OrgContext, id: string, input: FileInput): Promise<FileResponse> {
  await actGate(ctx);
  const name = await assistantName(ctx);
  const allowance = await aiAllowance(ctx).catch(() => null);
  const row = await tx(ctx, async (db): Promise<Out<TaskRow>> => {
    const r = await readRow(db, ctx, id);
    if (!r) return { err: fail(404, "ACT_NOT_FOUND", E.notFound) };
    const plan = r.kind === "plan";
    let want: { source: string | null; name: string | null };
    if (plan) {
      // A plan's file job (phase 3): only when it is the step the plan is on, for the file named in it.
      const g = await planStepGate(db, r, input.i, "file");
      if (g) return g;
      const step = r.steps?.[r.step_index];
      want = step?.kind === "file" ? step.file : { source: null, name: null };
    } else {
      if (r.kind !== "file") return { err: fail(422, "ACT_INVALID", E.invalid) };
      if (r.status === "proposed") return { err: fail(403, "ACT_NOT_CONFIRMED", E.notConfirmed) };
      if (r.status !== "running") return { err: fail(409, "ACT_ENDED", E.ended) };
      if (!r.confirmed_at || !r.confirmed_via) return { err: fail(403, "ACT_NOT_CONFIRMED", E.notConfirmed) };
      if (r.wall_passed) { await endRow(db, r.id, { status: "stopped", reason: "time" }); return { err: fail(409, "ACT_ENDED", E.ended) }; }
      want = { source: r.file_source, name: r.file_name };
    }
    if (input.file.name !== want.name || input.file.source !== want.source) { await endRow(db, r.id, { status: "failed", reason: "failed", plan }); return { err: fail(409, "ACT_FILE", E.file) }; }
    if (allowance?.ready && allowance.remaining <= 0) { await endRow(db, r.id, { status: "stopped", reason: "limit", plan }); return { err: fail(429, "ACT_LIMIT", E.limit(allowance.limit, name)) }; }
    const claimed = await db.maybeOne(`UPDATE assistant_tasks SET step_started_at = now() WHERE id = $1 AND status = 'running' AND step_started_at IS NULL RETURNING id`, [r.id]);
    if (!claimed) return { err: fail(409, "ACT_STEP_STALE", E.stepStale) };
    return { ok: r };
  });
  const plan = row.kind === "plan";
  const planStep = plan ? row.steps?.[row.step_index] : undefined;
  const fileTokens = row.scope?.fileTokens ?? 0;
  const endFailed = async (status: number, code: string, message: string, units?: number) => {
    await tx(ctx, async (db) => { await endRow(db, row.id, { status: "failed", reason: "failed", units: plan ? planUnitsOf(row.steps_used, fileTokens) + (units ?? 1) : units ?? 1, plan }); return { ok: null }; });
    return fail(status, code, message);
  };
  const file = readFileIn(input.file);
  if (!file) throw await endFailed(422, "ACT_INVALID", E.invalid, 0);
  const client = await actClient();
  if (!client) throw await endFailed(503, "ACT_UNAVAILABLE", E.unavailable, 0);
  const format = (planStep?.kind === "file" ? planStep.output.format : row.output_format) as OutputFormat;
  let run: Awaited<ReturnType<typeof runFileJob>>;
  try {
    run = await runFileJob(client, { request: row.request_text ?? "", plan: row.plan_text, format, file });
  } catch (err) {
    console.error(`[act] ACT_FAILED ${actSafe(err)}`);
    throw await endFailed(502, "ACT_FAILED", E.failed);
  } finally {
    if (file.data) file.data = "";
    if (file.text) file.text = "";
  }
  const u = run.usage ?? {};
  const tokens = (Number(u.input_tokens) || 0) + (Number(u.output_tokens) || 0);
  const units = actUnits("file", { inputTokens: Number(u.input_tokens) || 0, outputTokens: Number(u.output_tokens) || 0 });
  void recordActUsage({ model: run.model, kind: "file", usage: run.usage, first: true });
  if ("failed" in run) throw await endFailed(502, "ACT_FAILED", run.failed, units);
  // Still running (a stop meanwhile wins: nothing is made or returned).
  const still = await tx(ctx, async (db) => ({ ok: await db.maybeOne(`SELECT 1 FROM assistant_tasks WHERE id = $1 AND status = 'running'`, [row.id]) }));
  if (!still) throw fail(409, "ACT_ENDED", E.ended);
  const outName = (planStep?.kind === "file" ? planStep.output.name : row.output_name) as string;
  let doc: FileResponse["doc"] = null;
  if (format === "doc") {
    const made = await createDoc(ctx, { title: outName.slice(0, 200), body: run.content, visibility: "private" });
    const href = `/app/${ctx.org.slug}/docs/${made.id}`;
    doc = { href, title: outName };
    // Logged with the generic owner words, as any document she saves (phase 1 D.8): nothing says it came from the Mac.
    void recordAction(ctx, { tool: "create_doc", summary: ownerWords("doc"), outcome: "done", source: "chat", detail: { href, personalSummary: `Saved “${outName}” (only you can see it)` } });
  }
  const html = format === "docx" || format === "pdf" ? markdownToHtml(run.content, outName) : null;
  if (plan) {
    // A plan's file job is one step: the plan moves on (or ends done after its last step).
    return tx(ctx, async (db): Promise<Out<FileResponse>> => {
      const fresh = await readRow(db, ctx, row.id);
      const done = fresh && fresh.status === "running" ? await completePlanStep(db, fresh, { i: row.step_index, tokens }) : null;
      if (!done) return { err: fail(409, "ACT_ENDED", E.ended) };
      return { ok: { status: "done", content: format === "doc" ? "" : run.content, html, format, name: outName, summary: done.summary ?? run.summary, doc, planDone: done.planDone } };
    });
  }
  return tx(ctx, async (db): Promise<Out<FileResponse>> => {
    const ok = await db.maybeOne(
      `UPDATE assistant_tasks SET status = 'done', end_reason = 'done', summary = $2, units = $3, steps_used = steps_used + 1, last_step_at = now(), ${END_SET}
       WHERE id = $1 AND status = 'running' RETURNING id`, [row.id, run.summary.slice(0, ACT_LIMITS.summary), units]);
    if (!ok) return { err: fail(409, "ACT_ENDED", E.ended) };
    return { ok: { status: "done", content: format === "doc" ? "" : run.content, html, format, name: outName, summary: run.summary, doc, planDone: true } };
  });
}

// ---- Forget, and the purge (contract D.11, D.12) ---------------------------------------------------------------------------

/**
 * The person's own ended task, deleted from their Activity. 404 otherwise; refused while someone else is signed in as them.
 * What it counted in today's limit stays (`assistant_task_units`, review 12 October 2026).
 */
export async function forgetTask(ctx: OrgContext, id: string): Promise<{ forgotten: true }> {
  if (ctx.user.impersonation) throw fail(403, "ACT_IMPERSONATED", E.impersonated);
  if (!(await ready0058(ctx))) throw fail(404, "ACT_NOT_FOUND", E.notFound);
  const gone = await retryWithout0058(() => withUser(ctx.user.profileId, async (db) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
    return db.maybeOne(`DELETE FROM assistant_tasks WHERE id = $1 AND membership_id = $2 AND organisation_id = $3 AND ended_at IS NOT NULL RETURNING id`, [id, ctx.membership.id, ctx.org.id]);
  }));
  if (!gone) throw fail(404, "ACT_NOT_FOUND", E.notFound);
  return { forgotten: true };
}

/**
 * The hourly purge (worker): ended rows go after 30 days; a proposal past its answer time expires; a task still live
 * five minutes past its wall clock is stopped. The words go with every end. Nothing before 0058.
 */
export async function purgeTasks(): Promise<{ deleted: number; expired: number; stopped: number }> {
  try {
    return await withWorker(async (db) => {
      if (!(await schema0058Ready(db))) return { deleted: 0, expired: 0, stopped: 0 };
      const deleted = await db.query(`DELETE FROM assistant_tasks WHERE ended_at < now() - make_interval(days => $1) RETURNING id`, [ACT_LIMITS.keepDays]);
      // What a task counted in the daily limit is needed only for its day (review, 12 October 2026).
      await db.query(`DELETE FROM assistant_task_units WHERE confirmed_at < now() - interval '2 days'`);
      // A plan's steps, lines and scope go with every end once 0059 is there (phase 3); its wall clock is 10 or 15 minutes.
      const set = (await schema0059Ready(db)) ? PLAN_END_SET : END_SET;
      const expired = await db.query(`UPDATE assistant_tasks SET status = 'expired', end_reason = 'expired', ${set} WHERE status = 'proposed' AND answer_by < now() RETURNING id`);
      const stopped = await db.query(
        `UPDATE assistant_tasks t SET status = 'stopped', end_reason = 'stopped', stopped_by = 'timeout', ${set}
         WHERE status IN ('running', 'asking')
           AND confirmed_at < now() - make_interval(mins => ${WALL_MINUTES} + 5) RETURNING id`);
      // Brenda and her helpers (migration 0060; contract E.4): requests older than 30 days go; live jobs idle 30 minutes or
      // 24 hours old end. Here, so the worker is unchanged.
      const { purgeJobs } = await import("@/server/services/jobs");
      const jobs = await purgeJobs(db);
      return { deleted: deleted.length, expired: expired.length, stopped: stopped.length + jobs.ended };
    });
  } catch (err) {
    if (isMissingSchema(err)) { forget0058(); return { deleted: 0, expired: 0, stopped: 0 }; }
    throw err;
  }
}

/** For the routes: the body's error words when an act request is too big. */
export const ACT_TOO_LARGE = E.tooLarge;
export type { ActMessage };

// ---- The routes' bodies --------------------------------------------------------------------------------------------------------

/** Small act bodies (an answer, a stop): a few short fields. */
export const ACT_SMALL_BODY = 16_000;

/**
 * An act route's body, read capped (413 PAYLOAD_TOO_LARGE with the act's words) and checked against `schema` (any
 * problem: one 422 ACT_INVALID with nothing from the body in it). The bytes are wiped once parsed.
 */
export async function readActBody<T>(req: Request, schema: z.ZodType<T>, maxBytes: number): Promise<T> {
  const { readCappedBytes } = await import("@/server/lib/api");
  const raw = await readCappedBytes(req, maxBytes, E.tooLarge);
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder().decode(raw)); } catch { throw fail(422, "ACT_INVALID", E.invalid); } finally { raw.fill(0); }
  const r = schema.safeParse(parsed);
  if (!r.success) throw fail(422, "ACT_INVALID", E.invalid);
  return r.data;
}
