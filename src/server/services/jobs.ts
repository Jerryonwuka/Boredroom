/**
 * Brenda's helpers in the background (Brenda and her helpers, build 1; owner's approved brief, 12 October 2026: "Helpers
 * in the background. Multi-step work as jobs: a notch card with progress and Stop, then a result card with Open / Show in
 * Finder / Undo; a private Jobs list on the web (only the person)"; contract G, H, I, N.1).
 *
 * A job is an `assistant_tasks` row (kind 'job', helper 'files' or 'operator'; migration 0060), tied to the person's
 * recorded request (`mac_requests`). Permission rule v2 (owner, 12 October 2026): "when you hold the keys and clearly ask
 * for a routine task, the request is the permission, and she does it. She still asks before anything destructive,
 * anything sent, anything that costs money, or anything sensitive." So:
 * - Only the router's signed job token for the person's own fresh request starts one (120 seconds, this person, this
 *   workspace, a nonce with no job yet); with "Check with me before every task" on, their yes too; the Mac operator also
 *   needs this Mac's one-time "click and type for you" consent. The database refuses a running job with neither a
 *   recorded request judged routine nor a recorded yes, and a request that isn't the person's own.
 * - The Files helper's `trash` is the only call that asks: it is held (`asking`) until step-answer records the person's
 *   yes for exactly those files (their count and the SHA-256 of their refs), and the Mac moves them only then.
 * - Stop is instant (act.ts stopTask takes job rows); a job idle 30 minutes or 24 hours old ends.
 * - The Mac holds the transcript; the server keeps its SHA-256 and checks it on every step. Paths never leave the Mac:
 *   the model sees names and refs. Undo manifests live on the Mac; the server keeps content-free counts and whether Undo
 *   is available.
 * - No helper allowance during the pilot (decision 8): jobs add no units; their costs go to `act_usage_daily`.
 *
 * Logs say only `[jobs] CODE`: never a word, a name, a ref, a path or an id.
 */
import { z } from "zod";
import { withUser, withWorker, isUniqueViolation, type Db } from "@/server/db";
import type { OrgContext } from "@/server/lib/api";
import { AppError } from "@/server/lib/errors";
import { sha256, verifyPayload } from "@/server/lib/crypto";
import { schema0060Ready, retryWithout0060, forget0060, isMissingSchema } from "@/server/lib/schema-0060";
import type { MacContext } from "@/server/lib/mac-context";
import { recordActUsage } from "@/server/services/ai-usage";
import { actClient, actSafe, toolResult, toolUsesOf, type ActMessage } from "@/server/services/act-model";
import { END_SET, ROW, readRow, transcriptHash, type TaskRow } from "@/server/services/act";
import { FILES_WORDS, asksToOpen, filesFirstMessage, forMac, runFilesTurn, trashWhat, type FilesStart } from "@/server/services/jobs-model";
import { aiFail, frontFail, frontGate, insertRequest, type JobToken } from "@/server/services/front";
import { ACT_LIMITS, CONFIRM_VIAS, verdict, type ConfirmVia } from "@/lib/act";
import { FRONT_LIMITS, FRONT_WORDS, JOB_LIMITS, type FilesCall, type JobItem, type JobStatus, type JobView } from "@/lib/front";

const E = FRONT_WORDS.errors;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const JOB_LIVE = ["proposed", "running", "asking", "paused"] as const;

/** A job's own record on its row (`job`, jsonb): content-free except the title, the doing line and the goal while it lives. */
export type JobState = {
  title: string; doing: string; goal: string | null; model: "sonnet" | "opus";
  progress: { done: number; of: number }; counts: Record<string, number>; outputs: { name: string; folder: string }[];
  undo: { available: boolean; undoneAt: string | null };
  /** The operator's escalation (I.2 b): steps in a row whose actions all failed. */
  failRun?: number;
  /** The SHA-256 of the refs the person said yes to moving to the Trash, until that call's result comes back (G.4). */
  approvedTrash?: string | null;
  /** The person's own words asked to open, see or find something (review, 16 October 2026); else `open` is refused. */
  mayOpen?: boolean;
};
type JobRow = Omit<TaskRow, "job"> & { helper: "files" | "operator" | null; authorised_by: "request" | "yes" | null; request_id: string | null; job: JobState | null; paused_at: string | null; idle: boolean; aged: boolean; created_at: string };

const JOB_ROW = `${ROW}, to_jsonb(t) ->> 'paused_at' AS paused_at, t.created_at,
  (COALESCE(t.last_step_at, t.created_at) < now() - make_interval(mins => ${JOB_LIMITS.idleMinutes})) AS idle,
  (t.created_at < now() - make_interval(hours => ${JOB_LIMITS.maxHours})) AS aged`;

async function readJob(db: Db, ctx: OrgContext, id: string): Promise<JobRow | null> {
  if (!UUID.test(id)) return null;
  return db.maybeOne<JobRow>(`SELECT ${JOB_ROW} FROM assistant_tasks t WHERE id = $1 AND membership_id = $2 AND organisation_id = $3 AND kind = 'job' FOR UPDATE`, [id, ctx.membership.id, ctx.org.id]);
}

type Out<T> = { ok: T } | { err: AppError };
async function jtx<T>(ctx: OrgContext, fn: (db: Db) => Promise<Out<T>>): Promise<T> {
  const out = await retryWithout0060(() => withUser(ctx.user.profileId, fn));
  if ("err" in out) throw out.err;
  return out.ok;
}

/** How a job's end reads on its request row. */
const requestOutcome = (status: string) => (status === "done" ? "done" : status === "failed" ? "failed" : "stopped");

/** Ends a live job (any live status, paused included) and mirrors it on the person's request row. Nothing when it already ended. */
export async function endJob(db: Db, id: string, o: { status: "done" | "stopped" | "failed"; reason: string; stoppedBy?: string | null; summary?: string | null; job?: JobState | null }): Promise<boolean> {
  const r = await db.maybeOne<{ request_id: string | null }>(
    `UPDATE assistant_tasks SET status = $2, end_reason = $3, stopped_by = COALESCE($4, stopped_by), summary = $5, paused_at = NULL,
            job = CASE WHEN $6::jsonb IS NULL THEN job ELSE $6::jsonb END, ${END_SET}
     WHERE id = $1 AND status = ANY($7::text[]) RETURNING request_id`,
    [id, o.status, o.reason, o.stoppedBy ?? null, o.summary ? o.summary.slice(0, ACT_LIMITS.summary) : null, o.job ? JSON.stringify({ ...o.job, goal: null }) : null, [...JOB_LIVE]]);
  if (!r) return false;
  if (r.request_id) {
    await db.query(`UPDATE mac_requests SET outcome = $2, summary = COALESCE($3, summary) WHERE id = $1`, [r.request_id, requestOutcome(o.status), o.summary ? o.summary.slice(0, 300) : null]);
  }
  return true;
}

// ---- Creating a job (contract G.2) ---------------------------------------------------------------------------------------------

export const createJobSchema = z.object({
  version: z.literal(1),
  token: z.string().min(10).max(8_000),
  yes: z.object({ via: z.enum(CONFIRM_VIAS), text: z.string().max(ACT_LIMITS.confirmText).nullable().optional() }).nullable().optional(),
  consent: z.object({ click: z.boolean() }).nullable().optional(),
});

const planOf = (title: string) => FRONT_WORDS.jobPlan(title);

export function jobViewOf(r: Pick<JobRow, "id" | "helper" | "plan_text" | "plan_sha256" | "step_cap" | "job" | "created_at">): JobView {
  return {
    id: r.id, helper: r.helper === "operator" ? "operator" : "files", title: r.job?.title ?? "", doing: r.job?.doing ?? "", goal: r.job?.goal ?? "",
    plan: r.plan_text, planSha256: r.plan_sha256, stepCap: r.step_cap, startedAt: new Date(r.created_at).toISOString(),
  };
}

/** Starts the job the router offered for the person's own request (contract G.2). */
export async function createJob(mc: MacContext, body: z.infer<typeof createJobSchema>): Promise<{ job: JobView }> {
  frontGate(mc);
  const { ctx } = mc;
  const t = verifyPayload<JobToken>(body.token);
  if (!t || t.k !== "job" || t.o !== ctx.org.id || t.m !== ctx.membership.id || !/^[0-9a-f]{32}$/.test(String(t.n))
    || (t.h !== "files" && t.h !== "operator") || typeof t.t !== "string" || typeof t.d !== "string" || typeof t.g !== "string" || typeof t.w !== "string") {
    throw frontFail(409, "JOB_TOKEN", E.jobToken);
  }
  if (!(t.s >= 0 && t.s <= FRONT_LIMITS.requestAgeMs)) throw frontFail(409, "FRONT_STALE", E.stale);
  // "Check with me before every task": the person's yes (a real press, checked on the Mac; or words the grammar accepts).
  let yes: { via: ConfirmVia; text: string | null } | null = null;
  if (mc.checkEvery) {
    if (!body.yes) throw frontFail(422, "ACT_ANSWER", "I didn't catch a clear yes, so I won't do it.");
    const words = typeof body.yes.text === "string" ? body.yes.text.trim().slice(0, ACT_LIMITS.confirmText) : "";
    const heard = body.yes.via === "button" ? "yes" : verdict(words, mc.name);
    if (heard !== "yes") throw frontFail(422, "ACT_ANSWER", "I didn't catch a clear yes, so I won't do it.");
    yes = { via: body.yes.via, text: body.yes.via === "button" ? null : words || null };
  }
  if (t.h === "operator" && body.consent?.click !== true) throw frontFail(409, "JOB_CONSENT", E.jobConsent);
  const plan = planOf(t.t);
  const job: JobState = { title: t.t, doing: t.d, goal: t.g, model: "sonnet", progress: { done: 0, of: 0 }, counts: {}, outputs: [], undo: { available: false, undoneAt: null }, mayOpen: asksToOpen(t.w) };
  try {
    return await jtx(ctx, async (db): Promise<Out<{ job: JobView }>> => {
      if (await db.maybeOne(`SELECT 1 FROM mac_requests WHERE membership_id = $1 AND nonce = $2`, [ctx.membership.id, t.n])) return { err: frontFail(409, "FRONT_REPLAY", E.replay) };
      const requestId = await insertRequest(db, ctx, {
        nonce: t.n, text: t.w.slice(0, FRONT_LIMITS.textChars), via: t.v, at: t.a, matched: "router", lane: "job", risk: "routine",
        authorisedBy: yes ? "yes" : "request", confirmedVia: yes?.via ?? null, actions: [], outcome: "pending", summary: null, undo: null,
      });
      const row = await db.one<JobRow>(
        `INSERT INTO assistant_tasks AS t (organisation_id, membership_id, kind, helper, status, request_text, request_source, request_age_ms, plan_text, plan_sha256, risky,
                                           answer_by, step_cap, confirmed_at, confirmed_via, confirm_text, authorised_by, risk, request_id, request_nonce, request_at, job)
         VALUES ($1, $2, 'job', $3, 'running', $4, $5, $6, $7, $8, false, now() + interval '600 seconds', $9,
                 CASE WHEN $10::text IS NULL THEN NULL ELSE now() END, $10, $11, $12, 'routine', $13, $14, $15, $16::jsonb)
         RETURNING ${JOB_ROW}`,
        [ctx.org.id, ctx.membership.id, t.h, t.w.slice(0, ACT_LIMITS.request), t.v, Math.round(t.s), plan, sha256(Buffer.from(plan, "utf8")),
          t.h === "files" ? JOB_LIMITS.filesSteps : JOB_LIMITS.operatorSteps, yes?.via ?? null, yes?.text ?? null, yes ? "yes" : "request",
          requestId, t.n, t.a, JSON.stringify(job)]);
      await db.query(`UPDATE mac_requests SET job_id = $2 WHERE id = $1`, [requestId, row.id]);
      return { ok: { job: jobViewOf(row) } };
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      const c = (err as { constraint?: string }).constraint ?? "";
      if (c === "mac_requests_once") throw frontFail(409, "FRONT_REPLAY", E.replay);
      throw frontFail(409, "JOB_BUSY", E.jobBusy);
    }
    throw err;
  }
}

// ---- A Files helper step (contract G.3, G.4) ----------------------------------------------------------------------------------

const ref = z.string().regex(/^[cefn][0-9]{1,6}$/);
const filesName = z.string().min(1).max(255).refine((n) => !/[/\u0000-\u001f]/.test(n));
export const filesStepSchema = z.object({
  version: z.literal(1),
  step: z.number().int().min(0).max(1_000),
  transcript: z.array(z.object({ role: z.enum(["user", "assistant", "system"]), content: z.unknown() }).passthrough()).max(600).nullable(),
  results: z.array(z.object({
    id: z.string().min(1).max(200), name: z.string().min(1).max(40), ok: z.boolean(),
    out: z.unknown().optional(), error: z.string().max(2_000).nullable().optional(),
  })).max(JOB_LIMITS.callsPerTurn),
  start: z.object({
    candidates: z.array(z.object({ ref, name: filesName, kind: z.string().regex(/^[a-z0-9_]{1,16}$/), bytes: z.number().int().min(0) })).max(FRONT_LIMITS.files),
    folders: z.array(z.object({ ref, source: z.enum(["named", "added", "pointed"]), name: filesName, title: filesName })).min(1).max(FRONT_LIMITS.folders),
  }).nullable().optional(),
  progress: z.object({ done: z.number().int().min(0).max(1_000_000), of: z.number().int().min(0).max(1_000_000) }).optional(),
  undo: z.boolean().optional(),
  askAnswered: z.boolean().optional(),
});
export type FilesStepInput = z.infer<typeof filesStepSchema>;

export type FilesStepResponse =
  | { status: "act"; calls: FilesCall[]; approved: { kind: "delete"; count: number; refsSha256: string } | null; note: string | null; append: ActMessage[]; step: number; stepsLeft: number }
  | { status: "ask"; ask: { kind: "delete"; what: string; question: string; because: string; count: number; refs: string[]; refsSha256: string }; append: ActMessage[]; step: number }
  | { status: "finished"; summary: string; outputs: string[]; speech: unknown; append: ActMessage[]; step: number }
  | { status: "cannot"; reason: string; append: ActMessage[]; step: number };

const refsSha = (refs: string[]) => sha256(Buffer.from(refs.join(","), "utf8"));
const capChars = (v: unknown) => { const s = JSON.stringify(v ?? null) ?? "null"; return s.length > JOB_LIMITS.resultChars ? `${s.slice(0, JOB_LIMITS.resultChars)}…` : s; };

/** The folders the first message named, by ref ("Desktop" (f1), …). */
function startFolders(transcript: ActMessage[]): Map<string, string> {
  const out = new Map<string, string>();
  const first = transcript.find((m) => m.role === "user");
  const text = Array.isArray(first?.content) ? (first!.content as Record<string, unknown>[]).map((b) => String(b?.text ?? "")).join("\n") : String(first?.content ?? "");
  const line = text.split("\n").find((l) => l.startsWith("Folders you may use: ")) ?? "";
  for (const m of line.matchAll(/("(?:[^"\\]|\\.)*") \((f[0-9]{1,6})\)/g)) {
    try { out.set(m[2], JSON.parse(m[1]) as string); } catch { /* not a quoted name */ }
  }
  return out;
}

/** New files the job made (names and folder titles), read from the results the Mac sent in this transcript. Best effort. */
function outputsOf(transcript: ActMessage[], refs: string[]): { name: string; folder: string }[] {
  const folders = startFolders(transcript);
  const names = new Map<string, string>();
  const callFolder = new Map<string, string>();
  const refFolder = new Map<string, string>();
  for (const m of transcript) {
    if (m.role === "assistant") {
      for (const u of toolUsesOf(m)) if (typeof u.input.in === "string") callFolder.set(u.id, String(u.input.in));
      continue;
    }
    if (!Array.isArray(m.content)) continue;
    for (const b of m.content as Record<string, unknown>[]) {
      if (b?.type !== "tool_result" || typeof b.content !== "string") continue;
      try {
        const v = JSON.parse(b.content) as Record<string, unknown>;
        if (typeof v.ref !== "string" || typeof v.name !== "string") continue;
        names.set(v.ref, v.name);
        const f = callFolder.get(String(b.tool_use_id));
        if (f) refFolder.set(v.ref, f);
        if (/^n[0-9]+$/.test(v.ref) && !folders.has(v.ref)) folders.set(v.ref, v.name);
      } catch { /* a text result */ }
    }
  }
  return refs.filter((r) => names.has(r)).map((r) => ({ name: String(names.get(r)).slice(0, 255), folder: String(folders.get(refFolder.get(r) ?? "") ?? "").slice(0, 255) }));
}

/** Counts of what changed, from this step's results (content-free numbers only). */
function countsAfter(counts: Record<string, number>, results: FilesStepInput["results"]): Record<string, number> {
  const next = { ...counts };
  for (const r of results) {
    if (!r.ok) continue;
    const out = (r.out ?? {}) as Record<string, unknown>;
    const n = Array.isArray(out.done) ? out.done.length : typeof out.moved === "number" ? out.moved : typeof out.done === "number" ? out.done : 1;
    next[r.name] = Math.min(1_000_000, (next[r.name] ?? 0) + n);
  }
  return next;
}

/**
 * One step of a Files helper job (contract G.3): the checks in stepTask's order, then one model turn (or, after the
 * person's yes to `trash`, the held call itself without the model), the calls checked, the row updated.
 */
export async function filesStep(mc: MacContext, id: string, input: FilesStepInput): Promise<FilesStepResponse> {
  frontGate(mc);
  const { ctx } = mc;
  type Prep = { row: JobRow; transcript: ActMessage[]; next: ActMessage | null; approved: { call: FilesCall; count: number; refsSha256: string } | null };
  const prepare = () => jtx(ctx, async (db): Promise<Out<Prep>> => {
    const r = await readJob(db, ctx, id);
    if (!r) return { err: frontFail(404, "ACT_NOT_FOUND", E.jobNotFound) };
    if (r.helper !== "files") return { err: frontFail(422, "ACT_INVALID", "That step couldn't be read, so I stopped.") };
    if (r.status === "asking") return { err: frontFail(409, "ACT_STEP_ASK", "I'm waiting for your answer about the next step.") };
    if (r.status === "paused") await db.query(`UPDATE assistant_tasks SET status = 'running', paused_at = NULL WHERE id = $1 AND status = 'paused'`, [r.id]);
    else if (r.status !== "running") return { err: frontFail(409, "ACT_ENDED", E.jobEnded) };
    // Belt and braces over the database: the person's yes, or their own request judged routine.
    if (!r.confirmed_at && r.authorised_by !== "request") return { err: frontFail(403, "ACT_NOT_CONFIRMED", "I haven't heard a yes for that, so I won't do it.") };
    if (r.idle) { await endJob(db, r.id, { status: "stopped", reason: "time", stoppedBy: "idle", job: r.job }); return { err: frontFail(409, "ACT_ENDED", E.jobEnded) }; }
    if (r.aged) { await endJob(db, r.id, { status: "stopped", reason: "time", stoppedBy: "age", job: r.job }); return { err: frontFail(409, "ACT_ENDED", E.jobEnded) }; }
    if (r.steps_used >= r.step_cap) { await endJob(db, r.id, { status: "stopped", reason: "cap", job: r.job }); return { err: frontFail(429, "ACT_STEP_CAP", FILES_WORDS.tooLong) }; }
    if (input.step !== r.steps_used) return { err: frontFail(409, "ACT_STEP_STALE", "I lost my place in that job, so I stopped.") };
    if (r.gap_ms !== null && r.gap_ms < ACT_LIMITS.stepGapMs) return { err: frontFail(429, "ACT_WAIT", "One step at a time. Try again in a moment.") };
    const invalid = async () => { await endJob(db, r.id, { status: "failed", reason: "failed", job: r.job }); return { err: frontFail(422, "JOB_CALL", E.jobCall) }; };
    const job = r.job;
    if (!job?.goal) return invalid();
    let transcript: ActMessage[] = [];
    let next: ActMessage | null = null;
    let approved: Prep["approved"] = null;
    if (r.steps_used === 0 && !r.transcript_sha256) {
      if (input.transcript !== null || input.results.length || input.askAnswered || !input.start) return invalid();
      next = filesFirstMessage({ via: r.request_source, request: r.request_text ?? "", goal: job.goal, start: input.start as FilesStart, now: new Date(), timeZone: ctx.org.timezone });
    } else {
      if (!input.transcript?.length) return invalid();
      transcript = input.transcript as ActMessage[];
      if (!r.transcript_sha256 || transcriptHash(transcript) !== r.transcript_sha256) {
        await endJob(db, r.id, { status: "failed", reason: "failed", job: r.job });
        return { err: frontFail(409, "ACT_TRANSCRIPT", "That job's steps didn't match, so I stopped it.") };
      }
      const last = transcript[transcript.length - 1];
      const uses = toolUsesOf(last);
      if (last.role !== "assistant" || !uses.length) return invalid();
      if (input.askAnswered) {
        // The person said yes to the held trash (step-answer recorded it): the server answers with that call itself.
        const held = r.approved_ask as { kind?: string; what?: string; count?: number; refsSha256?: string } | null;
        const t = uses.length === 1 && uses[0].name === "trash" ? uses[0] : null;
        if (input.results.length || !held || held.kind !== "delete" || !t) return invalid();
        const refs = Array.isArray(t.input.refs) ? (t.input.refs as string[]) : [];
        if (refsSha(refs) !== held.refsSha256 || refs.length !== held.count) return invalid();
        approved = { call: { id: t.id, name: "trash", input: { refs, what: t.input.what } }, count: refs.length, refsSha256: held.refsSha256 };
      } else {
        if (r.approved_ask) return invalid();
        // A trash call's result comes only after the person's yes for exactly those files (G.4).
        if (uses.some((u) => u.name === "trash")) {
          const t = uses.length === 1 ? uses[0] : null;
          const refs = t && Array.isArray(t.input.refs) ? (t.input.refs as string[]) : [];
          if (!t || !job.approvedTrash || job.approvedTrash !== refsSha(refs)) return invalid();
        }
        if (input.results.length !== uses.length) return invalid();
        const content: Record<string, unknown>[] = [];
        for (let i = 0; i < uses.length; i++) {
          const res = input.results[i];
          if (res.id !== uses[i].id || res.name !== uses[i].name) return invalid();
          content.push(res.ok
            ? toolResult({ id: res.id, member: false, text: capChars(res.out ?? { ok: true }) })
            : toolResult({ id: res.id, member: false, text: String(res.error ?? "Not done.").slice(0, 2_000), error: true }));
        }
        next = { role: "user", content };
      }
    }
    if (!approved) {
      const claimed = await db.maybeOne(
        `UPDATE assistant_tasks SET step_started_at = now() WHERE id = $1 AND status = 'running' AND steps_used = $2
           AND (step_started_at IS NULL OR step_started_at < now() - make_interval(secs => $3)) RETURNING id`, [r.id, r.steps_used, ACT_LIMITS.claimSeconds]);
      if (!claimed) return { err: frontFail(409, "ACT_STEP_STALE", "I lost my place in that job, so I stopped.") };
    }
    return { ok: { row: r, transcript, next, approved } };
  });
  let prep: Prep;
  try { prep = await prepare(); }
  catch (err) {
    if (!(err instanceof AppError) || err.code !== "ACT_WAIT") throw err;
    await new Promise((res) => setTimeout(res, ACT_LIMITS.stepGapMs));
    prep = await prepare();
  }
  const { row } = prep;
  const job = row.job as JobState;
  const progress = input.progress ?? job.progress;
  const undo = input.undo ?? job.undo.available;

  // After the person's yes: the held call goes back, approved for exactly those files, without asking the model again.
  if (prep.approved) {
    const a = prep.approved;
    return jtx(ctx, async (db): Promise<Out<FilesStepResponse>> => {
      const ok = await db.maybeOne(`UPDATE assistant_tasks SET approved_ask = NULL, last_step_at = now(), job = $2::jsonb WHERE id = $1 AND status = 'running' RETURNING id`,
        [row.id, JSON.stringify({ ...job, progress, undo: { ...job.undo, available: undo }, approvedTrash: a.refsSha256 })]);
      if (!ok) return { err: frontFail(409, "ACT_ENDED", E.jobEnded) };
      return { ok: { status: "act", calls: [a.call], approved: { kind: "delete", count: a.count, refsSha256: a.refsSha256 }, note: null, append: [], step: row.steps_used, stepsLeft: Math.max(0, row.step_cap - row.steps_used) } };
    });
  }

  const client = await actClient();
  if (!client) {
    await jtx(ctx, async (db) => { await endJob(db, row.id, { status: "failed", reason: "failed", job }); return { ok: null }; });
    throw frontFail(503, "ACT_UNAVAILABLE", "This isn't set up on this Boredroom yet.");
  }
  let run: Awaited<ReturnType<typeof runFilesTurn>>;
  try {
    run = await runFilesTurn(client, {
      transcript: prep.transcript, next: prep.next, goal: job.goal ?? "", mayOpen: job.mayOpen === true, extraCalls: Math.max(0, Math.min(ACT_LIMITS.extraCalls, row.step_cap - row.steps_used - 1)),
      left: (calls) => row.step_cap - row.steps_used - calls,
    });
  } catch (err) {
    await jtx(ctx, async (db) => { await endJob(db, row.id, { status: "failed", reason: "failed", job }); return { ok: null }; });
    throw aiFail(err);
  }
  run.usages.forEach((u, i) => { void recordActUsage({ model: u.model, kind: "files", usage: u.usage, first: row.steps_used === 0 && i === 0 }); });
  const steps = row.steps_used + run.calls;
  const hash = transcriptHash([...prep.transcript, ...run.append]);
  const turn = run.turn;
  const nextJob: JobState = { ...job, progress, counts: countsAfter(job.counts ?? {}, input.results), undo: { ...job.undo, available: undo }, approvedTrash: null };
  return jtx(ctx, async (db): Promise<Out<FilesStepResponse>> => {
    const p = [row.id, row.steps_used, steps, hash, JSON.stringify(nextJob)];
    const live = `steps_used = $3, transcript_sha256 = $4, last_step_at = now(), job = $5::jsonb, step_started_at = NULL`;
    const where = `WHERE id = $1 AND status = 'running' AND steps_used = $2`;
    if (turn.kind === "act") {
      const ok = await db.maybeOne(`UPDATE assistant_tasks SET ${live} ${where} RETURNING id`, p);
      if (!ok) return { err: frontFail(409, "ACT_ENDED", E.jobEnded) };
      return { ok: { status: "act", calls: turn.calls.map(forMac), approved: null, note: run.note, append: run.append, step: steps, stepsLeft: Math.max(0, row.step_cap - steps) } };
    }
    if (turn.kind === "ask") {
      const count = turn.refs.length;
      const what = trashWhat(count, turn.what);
      const pendingAsk = { kind: "delete", what, count, refsSha256: refsSha(turn.refs) };
      const ok = await db.maybeOne(`UPDATE assistant_tasks SET ${live}, status = 'asking', pending_ask = $6::jsonb ${where} RETURNING id`, [...p, JSON.stringify(pendingAsk)]);
      if (!ok) return { err: frontFail(409, "ACT_ENDED", E.jobEnded) };
      // Review, 16 October 2026: the refs and their SHA-256 go with the question, so the Mac asks about exactly those files
      // in its own words (read off the files, never the model's `what`) and keeps the person's yes for exactly them.
      return { ok: { status: "ask", ask: { kind: "delete", what, question: count === 1 ? "Move 1 file to the Trash?" : `Move ${count} files to the Trash?`, because: "You can put them back from the Trash.", count, refs: turn.refs, refsSha256: pendingAsk.refsSha256 }, append: run.append, step: steps } };
    }
    // The end: the row and the request row say how it went; the words go (END_SET), the goal too.
    const ended = await db.maybeOne<{ id: string }>(`SELECT id FROM assistant_tasks ${where} FOR UPDATE`, [row.id, row.steps_used]);
    if (!ended) return { err: frontFail(409, "ACT_ENDED", E.jobEnded) };
    await db.query(`UPDATE assistant_tasks SET steps_used = $2, transcript_sha256 = $3, last_step_at = now() WHERE id = $1`, [row.id, steps, hash]);
    if (turn.kind === "finished") {
      const outputs = outputsOf([...prep.transcript, ...run.append], turn.outputs);
      await endJob(db, row.id, { status: "done", reason: "done", summary: turn.summary, job: { ...nextJob, outputs } });
      const { speechOfferFor } = await import("@/server/services/natural-voice");
      const speech = await speechOfferFor(ctx)(turn.summary).catch(() => null);
      return { ok: { status: "finished", summary: turn.summary, outputs: turn.outputs, speech, append: run.append, step: steps } };
    }
    if (turn.kind === "cannot") {
      await endJob(db, row.id, { status: "stopped", reason: "cannot", summary: `Couldn't: ${turn.reason}`, job: nextJob });
      return { ok: { status: "cannot", reason: turn.reason, append: run.append, step: steps } };
    }
    const message = turn.kind === "failed" ? turn.message : FILES_WORDS.noStep;
    await endJob(db, row.id, { status: "failed", reason: "failed", job: nextJob });
    return { err: frontFail(502, "ACT_FAILED", message) };
  });
}

// ---- Pause, resume and Undo (contract G.6, G.11) -------------------------------------------------------------------------

export const jobStateSchema = z.object({ version: z.literal(1), state: z.enum(["paused", "running"]), why: z.enum(["sleep", "offline", "lock", "call", "share"]).optional() });

/** The Mac says the job paused (its Mac slept, lost Boredroom, …) or carries on. Content-free; only while it lives. */
export async function jobState(mc: MacContext, id: string, input: z.infer<typeof jobStateSchema>): Promise<{ status: JobStatus }> {
  frontGate(mc, { minimal: true });
  return jtx(mc.ctx, async (db): Promise<Out<{ status: JobStatus }>> => {
    const r = await readJob(db, mc.ctx, id);
    if (!r) return { err: frontFail(404, "ACT_NOT_FOUND", E.jobNotFound) };
    if (!(JOB_LIVE as readonly string[]).includes(r.status)) return { ok: { status: r.status as JobStatus } };
    if (input.state === "paused" && r.status === "running") {
      await db.query(`UPDATE assistant_tasks SET status = 'paused', paused_at = now(), step_started_at = NULL WHERE id = $1`, [r.id]);
      return { ok: { status: "paused" } };
    }
    if (input.state === "running" && r.status === "paused") {
      await db.query(`UPDATE assistant_tasks SET status = 'running', paused_at = NULL, last_step_at = now() WHERE id = $1`, [r.id]);
      return { ok: { status: "running" } };
    }
    return { ok: { status: r.status as JobStatus } };
  });
}

export const jobUndoneSchema = z.object({ version: z.literal(1), restored: z.number().int().min(0).max(JOB_LIMITS.changes), skipped: z.number().int().min(0).max(JOB_LIMITS.changes) });

/** The person pressed Undo on their Mac and it put things back: the row and the request row say so (counts only). */
export async function jobUndone(mc: MacContext, id: string, input: z.infer<typeof jobUndoneSchema>): Promise<{ ok: true }> {
  frontGate(mc, { minimal: true });
  return jtx(mc.ctx, async (db): Promise<Out<{ ok: true }>> => {
    const r = await readJob(db, mc.ctx, id);
    if (!r) return { err: frontFail(404, "ACT_NOT_FOUND", E.jobNotFound) };
    if ((JOB_LIVE as readonly string[]).includes(r.status)) return { err: frontFail(409, "JOB_LIVE", E.jobLive) };
    const job: JobState = { ...(r.job as JobState), undo: { available: false, undoneAt: new Date().toISOString() }, counts: { ...(r.job?.counts ?? {}), restored: input.restored, undoSkipped: input.skipped } };
    await db.query(`UPDATE assistant_tasks SET job = $2::jsonb WHERE id = $1`, [r.id, JSON.stringify(job)]);
    if (r.request_id) await db.query(`UPDATE mac_requests SET outcome = 'undone' WHERE id = $1`, [r.request_id]);
    return { ok: { ok: true } };
  });
}

// ---- The web's Jobs list (contract N.1) ----------------------------------------------------------------------------------

type ListRow = { id: string; helper: string; status: string; created_at: string; ended_at: string | null; summary: string | null; job: JobState | null; request: string | null };

/** The person's own jobs from the last 30 days, newest first (at most 100), with their request's words while kept. */
export async function listJobs(ctx: OrgContext): Promise<{ ready: boolean; jobs: JobItem[] }> {
  try {
    return await retryWithout0060(() => withUser(ctx.user.profileId, async (db) => {
      if (!(await schema0060Ready(db))) return { ready: false, jobs: [] };
      const rows = await db.query<ListRow>(
        `SELECT t.id, t.helper, t.status, t.created_at, t.ended_at, t.summary, t.job, q.request_text AS request
         FROM assistant_tasks t LEFT JOIN mac_requests q ON q.id = t.request_id
         WHERE t.membership_id = $1 AND t.organisation_id = $2 AND t.kind = 'job' AND t.created_at > now() - make_interval(days => $3)
         ORDER BY t.created_at DESC LIMIT 100`, [ctx.membership.id, ctx.org.id, FRONT_LIMITS.keepDays]);
      return { ready: true, jobs: rows.map(itemOf) };
    }));
  } catch (err) {
    if (!isMissingSchema(err)) throw err;
    forget0060();
    return { ready: false, jobs: [] };
  }
}

function itemOf(r: ListRow): JobItem {
  const j = r.job;
  const status = (["running", "asking", "paused", "done", "stopped", "said_no", "expired", "failed"] as const).includes(r.status as JobStatus) ? (r.status as JobStatus) : "stopped";
  return {
    id: r.id, helper: r.helper === "operator" ? "operator" : "files", title: j?.title ?? "", status,
    startedAt: new Date(r.created_at).toISOString(), endedAt: r.ended_at ? new Date(r.ended_at).toISOString() : null,
    progress: { done: Number(j?.progress?.done) || 0, of: Number(j?.progress?.of) || 0 }, summary: r.summary,
    outputs: Array.isArray(j?.outputs) ? j!.outputs.slice(0, 10).map((o) => ({ name: String(o.name ?? ""), folder: String(o.folder ?? "") })) : [],
    undo: { available: !!j?.undo?.available && !j?.undo?.undoneAt, undoneAt: j?.undo?.undoneAt ?? null }, request: r.request,
  };
}

/** The person forgets one of their ended jobs (and its request). 404 not theirs; 409 JOB_LIVE while it runs. */
export async function forgetJob(ctx: OrgContext, id: string): Promise<{ forgotten: true }> {
  if (ctx.user.impersonation) throw frontFail(403, "FRONT_IMPERSONATED", E.impersonated);
  if (!UUID.test(id)) throw frontFail(404, "ACT_NOT_FOUND", E.jobNotFound);
  try {
    return await jtx(ctx, async (db): Promise<Out<{ forgotten: true }>> => {
      if (!(await schema0060Ready(db))) return { err: frontFail(404, "ACT_NOT_FOUND", E.jobNotFound) };
      const r = await db.maybeOne<{ id: string; status: string; request_id: string | null }>(
        `SELECT id, status, request_id FROM assistant_tasks WHERE id = $1 AND membership_id = $2 AND organisation_id = $3 AND kind = 'job' FOR UPDATE`, [id, ctx.membership.id, ctx.org.id]);
      if (!r) return { err: frontFail(404, "ACT_NOT_FOUND", E.jobNotFound) };
      if ((JOB_LIVE as readonly string[]).includes(r.status)) return { err: frontFail(409, "JOB_LIVE", E.jobLive) };
      await db.query(`DELETE FROM assistant_tasks WHERE id = $1`, [r.id]);
      if (r.request_id) await db.query(`DELETE FROM mac_requests WHERE id = $1 AND membership_id = $2`, [r.request_id, ctx.membership.id]);
      return { ok: { forgotten: true } };
    });
  } catch (err) {
    if (isMissingSchema(err)) { forget0060(); throw frontFail(404, "ACT_NOT_FOUND", E.jobNotFound); }
    throw err;
  }
}

// ---- The purge's part (contract E.4; called from act.ts purgeTasks, so the worker is unchanged) ----------------------------

/** Requests older than 30 days go; live jobs idle for 30 minutes or older than 24 hours end. Nothing before 0060. */
export async function purgeJobs(db: Db): Promise<{ requests: number; ended: number }> {
  if (!(await schema0060Ready(db))) return { requests: 0, ended: 0 };
  const requests = await db.query(`DELETE FROM mac_requests WHERE created_at < now() - make_interval(days => $1) RETURNING id`, [FRONT_LIMITS.keepDays]);
  const ended = await db.query<{ id: string; request_id: string | null; aged: boolean }>(
    `UPDATE assistant_tasks t SET status = 'stopped', end_reason = 'time', paused_at = NULL,
            stopped_by = CASE WHEN t.created_at < now() - make_interval(hours => ${JOB_LIMITS.maxHours}) THEN 'age' ELSE 'idle' END,
            job = CASE WHEN t.job IS NULL THEN NULL ELSE t.job - 'goal' END, ${END_SET}
     WHERE t.kind = 'job' AND t.status = ANY($1::text[])
       AND (COALESCE(t.last_step_at, t.created_at) < now() - make_interval(mins => ${JOB_LIMITS.idleMinutes}) OR t.created_at < now() - make_interval(hours => ${JOB_LIMITS.maxHours}))
     RETURNING t.id, t.request_id, false AS aged`, [[...JOB_LIVE]]);
  for (const e of ended) if (e.request_id) await db.query(`UPDATE mac_requests SET outcome = 'stopped' WHERE id = $1`, [e.request_id]);
  return { requests: requests.length, ended: ended.length };
}

/** Run by the purge through the worker; never throws. */
export async function purgeJobsAsWorker(): Promise<{ requests: number; ended: number }> {
  try { return await withWorker((db) => purgeJobs(db)); }
  catch (err) {
    if (isMissingSchema(err)) { forget0060(); return { requests: 0, ended: 0 }; }
    console.warn(`[jobs] PURGE_FAILED ${actSafe(err)}`);
    return { requests: 0, ended: 0 };
  }
}

export { readRow };
