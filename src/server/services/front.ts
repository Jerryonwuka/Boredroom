/**
 * Brenda's front desk on the person's Mac, the server's side (Brenda and her helpers, build 1; owner's approved brief, 12
 * October 2026: "one Brenda, three lanes … she picks the lane"; contract B.4, E.1 to E.4, M.2, N.2, O, R.2).
 *
 * Permission rule v2 (owner, 12 October 2026; replaces "always confirm"), verbatim: "when you hold the keys and clearly
 * ask for a routine task, the request is the permission, and she does it. She still asks before anything destructive,
 * anything sent, anything that costs money, or anything sensitive." Here that means:
 * - Only the person's own request starts anything: the router, the record and (jobs.ts) a job take a desktop session's
 *   request only, never while someone else is signed in as the person, at most 30 seconds old, with a nonce never seen
 *   for this person. No timer, routine, notification, server line or screen text reaches any of it.
 * - The request is the record (`mac_requests`, the person alone, 30 days): their exact words, how they came, when, the
 *   nonce, the lane, what ran and how it was authorised. The database refuses a row that ran something unless it was
 *   routine and asked for, or the person's yes was recorded (mac_requests_authorised).
 * - Routine runs; `ask` waits for the person's yes on the Mac; `never` is refused (lib/mac-risk, on both sides).
 * - "Check with me before every task" (default off; owners can't change it, decision 9): routine requests and job starts
 *   ask too; their own to-dos, reminders and timer become Confirm cards (copilot's `check_every`).
 *
 * The router is text only (front-model.ts). The quick tools run through the chat's own tools as ordinary chat runs them
 * (Undo on the done line); everything else about their work goes to the Boredroom chat, where anything that sends waits
 * for Confirm as today.
 *
 * Nothing here logs a word, a name, an app, a path, a nonce or an id: errors are `[front] CODE`.
 */
import { z } from "zod";
import { after } from "next/server";
import { withUser, isUniqueViolation, type Db } from "@/server/db";
import type { OrgContext } from "@/server/lib/api";
import { AppError } from "@/server/lib/errors";
import { signPayload } from "@/server/lib/crypto";
import { schema0060Ready, retryWithout0060, forget0060, isMissingSchema } from "@/server/lib/schema-0060";
import type { MacContext } from "@/server/lib/mac-context";
import type { NdjsonWrite } from "@/server/lib/ndjson";
import { AI_BURST, AI_BURST_MESSAGE, checkAiBurst, newRequestId, recordActUsage, recordUsage } from "@/server/services/ai-usage";
import { actClient, aiErrorCode, actSafe, withBusyRetry } from "@/server/services/act-model";
import { checkRoute, routerMessages, routerSituation, runRouter, type RouteDecision, type RouterContext } from "@/server/services/front-model";
import { FRONT_LIMITS, FRONT_WORDS, MAC_ACTION_KINDS, type JobHelper } from "@/lib/front";
import { SPEECH_MAX_CHARS } from "@/lib/natural-voices";
import { speakable } from "@/lib/assistant-speech/speakable";
import { classify, riskKindOfAction } from "@/lib/mac-risk";
import { rateLimited } from "@/server/lib/errors";
// What Brenda has learned (owner decision, 28 October 2026): the person's own requests on their Mac.
import { noteTurn } from "@/server/services/learning";

const E = FRONT_WORDS.errors;
export const frontFail = (status: number, code: string, message: string) => new AppError(status, code, message);

// ---- Writes after the answer (Next 16 `after`; contract K.5.3) --------------------------------------------------------------

const pending = new Set<Promise<unknown>>();
/**
 * Runs `fn` after the response (Next's `after`), so the record, the usage rows and the burst count never delay the
 * answer. Outside a request (the tests, a script) it runs at once in the background; `settleFrontWrites` waits for it.
 * Never throws; a failure is logged as a code.
 */
export function later(fn: () => Promise<unknown>): void {
  const run = () => fn().catch((err: unknown) => { console.warn(`[front] LATER_FAILED ${(err as { code?: string })?.code ?? actSafe(err)}`); });
  try {
    after(run);
  } catch {
    const p = run();
    pending.add(p);
    void p.finally(() => pending.delete(p));
  }
}
/** Waits for every write `later` started outside a request (tests). */
export async function settleFrontWrites(): Promise<void> {
  while (pending.size) await Promise.all([...pending]);
}

// ---- The gates every front-desk and job route passes (contract B.4, O.1) -----------------------------------------------------

/**
 * A desktop session (403 FRONT_DESKTOP_ONLY), not impersonated (403 FRONT_IMPERSONATED), 0060 (503 FRONT_NOT_READY), and
 * unless `minimal` (a stop, a state change, a record of something that already happened) screen help and actions
 * available (403 ACT_SWITCHED_OFF / 503 ACT_UNAVAILABLE).
 */
export function frontGate(mc: MacContext, o: { minimal?: boolean } = {}): void {
  if (!mc.desktop) throw frontFail(403, "FRONT_DESKTOP_ONLY", E.desktopOnly);
  if (mc.ctx.user.impersonation) throw frontFail(403, "FRONT_IMPERSONATED", E.impersonated);
  if (!mc.ready0060) throw frontFail(503, "FRONT_NOT_READY", E.notReady);
  if (o.minimal) return;
  if (mc.look.act.reason === "switched_off") throw frontFail(403, "ACT_SWITCHED_OFF", "Your workspace has switched off on-screen actions and file work.");
  if (!mc.look.act.available) throw frontFail(503, "ACT_UNAVAILABLE", "This isn't set up on this Boredroom yet.");
}

/**
 * The burst limit (20 a minute): from the count the one-trip context read, and the count itself kept after the answer;
 * when the context was read the ordinary way (no count), counted here at once instead.
 */
const burstCounted = new WeakSet<MacContext>();
export async function frontBurst(mc: MacContext): Promise<void> {
  if (mc.burstHits === null) { await checkAiBurst(mc.ctx); burstCounted.add(mc); return; }
  if (mc.burstHits >= AI_BURST.requests) throw rateLimited(AI_BURST_MESSAGE);
}

/** After the answer: the request counted in the burst limit, when `frontBurst` didn't count it already. Never throws. */
export async function countBurst(mc: MacContext): Promise<void> {
  if (!burstCounted.has(mc)) { burstCounted.add(mc); await checkAiBurst(mc.ctx).catch(() => undefined); }
}

/** A model error as the person reads it (contract L.2, O.3): only the code is logged. */
export function aiFail(err: unknown): AppError {
  const code = aiErrorCode(err);
  console.warn(`[front] ${code} ${actSafe(err)}`);
  if (code === "AI_NO_CREDIT") return frontFail(503, code, E.noCredit);
  if (code === "AI_BUSY") return frontFail(503, code, E.busy);
  return frontFail(502, code, E.failed);
}

// ---- The router's body (contract B.4) -----------------------------------------------------------------------------------------

const NONCE = /^[0-9a-f]{32}$/;
const ONE_LINE_BAD = /[\u0000-\u001f\u007f-\u009f]/;
const fold = (s: string) => s.replace(/\s+/g, " ").trim();
const nameSchema = z.string().max(FRONT_LIMITS.runningChars).refine((n) => !ONE_LINE_BAD.test(n));
export const requestSchema = z.object({
  text: z.string().transform(fold).pipe(z.string().min(1).max(FRONT_LIMITS.textChars)),
  via: z.enum(["voice", "typed"]),
  // Up to two minutes is read; over 30 seconds is refused as stale (409 FRONT_STALE), not as unreadable.
  ageMs: z.number().int().min(0).max(120_000),
  nonce: z.string().regex(NONCE),
  at: z.string().datetime({ offset: true }),
});
export const frontBodySchema = z.object({
  version: z.literal(1),
  request: requestSchema,
  context: z.object({
    front: z.object({ name: nameSchema, bundleId: z.string().max(255).nullable() }).nullable(),
    running: z.array(nameSchema).max(FRONT_LIMITS.running),
    files: z.array(z.object({ source: z.string().regex(/^[a-z_]{1,20}$/), name: z.string().min(1).max(255).refine((n) => !ONE_LINE_BAD.test(n) && !n.includes("/")), kind: z.string().regex(/^[a-z0-9_]{1,16}$/), bytes: z.number().int().min(0) })).max(FRONT_LIMITS.files),
    folders: z.array(z.object({ source: z.enum(["named", "added", "pointed"]), name: z.string().min(1).max(255).refine((n) => !ONE_LINE_BAD.test(n) && !n.includes("/")) })).max(FRONT_LIMITS.folders),
    abilities: z.object({ useMac: z.boolean(), fileWork: z.boolean(), accessibility: z.boolean(), clickConsent: z.boolean(), screenRecording: z.boolean() }),
    pictures: z.boolean(),
  }),
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(FRONT_LIMITS.messageChars) })).min(1).max(FRONT_LIMITS.messages),
}).refine((b) => { const last = b.messages[b.messages.length - 1]; return last.role === "user" && fold(last.content) === b.request.text; });
export type FrontBody = z.infer<typeof frontBodySchema>;
export type FrontRequest = z.infer<typeof requestSchema>;

/** A body read whole: any problem is one 422 FRONT_INVALID with nothing from the body in it. */
/**
 * The request's nonce, read ahead from the body's bytes so the route can check it in the Mac context's one round trip
 * (integration, 16 October 2026); null when it can't be read. Only a hint: readFrontBody still checks the whole body.
 */
export function nonceHint(raw: Uint8Array): string | null {
  try {
    const n = (JSON.parse(new TextDecoder().decode(raw)) as { request?: { nonce?: unknown } } | null)?.request?.nonce;
    return typeof n === "string" && /^[0-9a-f]{32}$/.test(n) ? n : null;
  } catch { return null; }
}

export function readFrontBody(raw: Uint8Array): FrontBody {
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder().decode(raw)); } catch { throw frontFail(422, "FRONT_INVALID", E.invalid); } finally { raw.fill(0); }
  const r = frontBodySchema.safeParse(parsed);
  if (!r.success) throw frontFail(422, "FRONT_INVALID", E.invalid);
  return r.data;
}

/** The request is the person's own, fresh: at most 30 seconds old, and its time not in the future by more than 10 minutes. */
export function freshRequest(r: Pick<FrontRequest, "ageMs" | "at">): void {
  if (r.ageMs > FRONT_LIMITS.requestAgeMs) throw frontFail(409, "FRONT_STALE", E.stale);
  const at = Date.parse(r.at);
  if (!Number.isFinite(at) || at > Date.now() + 10 * 60_000) throw frontFail(422, "FRONT_INVALID", E.invalid);
}

/** Whether this person has used the nonce before (409 FRONT_REPLAY): the router's own rows and jobs' rows. */
export async function nonceUsed(ctx: OrgContext, nonce: string): Promise<boolean> {
  return retryWithout0060(() => withUser(ctx.user.profileId, async (db) => !!(await db.maybeOne(
    `SELECT 1 FROM mac_requests WHERE membership_id = $1 AND nonce = $2`, [ctx.membership.id, nonce]))));
}

// ---- The record (contract E.1, E.3) ---------------------------------------------------------------------------------------------

export type RequestRecord = {
  nonce: string; text: string; via: "voice" | "typed"; at: string; matched: "mac" | "router";
  lane: "mac" | "boredroom" | "job" | "look" | "chat" | "ask" | "none"; risk: "routine" | "ask" | "never";
  authorisedBy: "request" | "yes"; confirmedVia: "button" | "voice" | "typed" | null;
  actions: { kind: string; outcome?: string; words?: string }[];
  outcome: "pending" | "done" | "partly" | "refused" | "failed" | "said_no" | "stopped" | "undone";
  summary: string | null; undo: Record<string, unknown> | null; jobId?: string | null;
};

/** Inserts the person's request row in `db` (their own transaction) and answers its id. */
export async function insertRequest(db: Db, ctx: OrgContext, r: RequestRecord): Promise<string> {
  const row = await db.one<{ id: string }>(
    `INSERT INTO mac_requests(organisation_id, membership_id, device_session, nonce, request_text, source, requested_at, matched, lane, risk, authorised_by, confirmed_via,
                              actions, outcome, summary, undo, job_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15, $16::jsonb, $17) RETURNING id`,
    [ctx.org.id, ctx.membership.id, sessionId(ctx), r.nonce, r.text, r.via, r.at, r.matched, r.lane, r.risk, r.authorisedBy, r.confirmedVia,
      JSON.stringify(r.actions.slice(0, FRONT_LIMITS.recordActions)), r.outcome, r.summary ? r.summary.slice(0, 300) : null, r.undo ? JSON.stringify(r.undo) : null, r.jobId ?? null]);
  return row.id;
}
const sessionId = (ctx: OrgContext) => (/^[0-9a-f-]{36}$/i.test(String(ctx.user.sessionId ?? "")) ? String(ctx.user.sessionId) : null);

/** The lane a route decision is recorded under. */
function recordOf(d: RouteDecision, req: FrontRequest): RequestRecord | null {
  const base = { nonce: req.nonce, text: req.text, via: req.via, at: req.at, matched: "router" as const, authorisedBy: "request" as const, confirmedVia: null, summary: null, undo: null };
  switch (d.lane) {
    case "mac": return { ...base, lane: "mac", risk: d.risk, actions: d.actions.map((a) => ({ kind: a.kind, outcome: "pending" })), outcome: "pending" };
    case "quick": return { ...base, lane: "boredroom", risk: "routine", actions: [], outcome: "done" };
    case "boredroom": return { ...base, lane: "boredroom", risk: "routine", actions: [], outcome: "done" };
    case "look": case "look_screen": return { ...base, lane: "look", risk: "routine", actions: [], outcome: "done" };
    case "ask": return { ...base, lane: "ask", risk: "routine", actions: [], outcome: "done" };
    case "enable": return { ...base, lane: "mac", risk: "routine", actions: [], outcome: "refused" };
    case "refused": return { ...base, lane: "mac", risk: "never", actions: [], outcome: "refused" };
    // A job's row is written by POST /assistant/jobs, so its id exists before the job.
    case "job": return null;
  }
}

// ---- The router (contract B.4) ------------------------------------------------------------------------------------------------

export type JobToken = { k: "job"; o: string; m: string; n: string; h: JobHelper; t: string; d: string; g: string; w: string; v: "voice" | "typed"; a: string; s: number };

/**
 * The router's turn, written as lines. The gates ran in the route (frontGate, the call, the burst); here the body's
 * freshness, the nonce, today's allowance, then the model, then the lane. The record and the usage rows are written after
 * the answer.
 */
export async function routeFront(mc: MacContext, body: FrontBody, write: NdjsonWrite): Promise<void> {
  const { ctx } = mc;
  const req = body.request;
  freshRequest(req);
  // Read with the Mac's context when the route passed the nonce (one round trip), else on its own.
  const replay = mc.nonce?.value === req.nonce ? mc.nonce.used : await nonceUsed(ctx, req.nonce);
  if (replay) throw frontFail(409, "FRONT_REPLAY", E.replay);
  if (mc.allowance?.ready && mc.allowance.remaining <= 0) {
    throw frontFail(429, "AI_LIMIT", `You've used today's ${mc.allowance.limit} requests to ${mc.name}, so ${mc.name} can't think that through now. Simple things like “open Figma” still work. Try again tomorrow.`);
  }
  const client = await actClient();
  if (!client) throw frontFail(503, "ACT_UNAVAILABLE", "This isn't set up on this Boredroom yet.");
  const context: RouterContext = { ...body.context, front: body.context.front, files: body.context.files, folders: body.context.folders };
  const situation = routerSituation({ now: new Date(), timeZone: ctx.org.timezone, name: mc.name, context });
  const history = body.messages.slice(0, -1).map((m) => ({ role: m.role, content: m.content }));
  const messages = routerMessages({ history, situation, via: req.via, text: req.text });
  const requestId = newRequestId();
  let run: Awaited<ReturnType<typeof runRouter>>;
  try {
    run = await withBusyRetry(() => runRouter(client, messages));
  } catch (err) {
    throw aiFail(err);
  }
  // One ordinary chat request in the ledger (the router is the person's request, as a look is), and its cost by kind.
  later(async () => {
    await recordUsage(ctx, { purpose: "chat", model: run.model, usage: run.usage, requestId });
    await recordActUsage({ model: run.model, kind: "router", usage: run.usage, first: true });
    if (!burstCounted.has(mc)) await checkAiBurst(ctx).catch(() => undefined);
  });
  const decision: RouteDecision = run.stopReason === "refusal"
    ? { lane: "ask", question: FRONT_WORDS.router.refusal }
    : checkRoute(run.content, { abilities: body.context.abilities, pictures: body.context.pictures, checkEvery: mc.checkEvery });
  // What Brenda has learned (owner decision, 28 October 2026): the person's request on their Mac, with the lane and, for
  // what the Mac does itself, each action's kind and app (never an address or a file). A request that goes on to her
  // chat or a look is noted there instead, once.
  if (decision.lane !== "boredroom" && decision.lane !== "look" && decision.lane !== "look_screen") {
    const extra = decision.lane === "mac" ? decision.actions.slice(0, 5).map((a) => ({ kind: "mac" as const, detail: `${a.kind}${a.app ? ` in ${a.app}` : ""}` }))
      : decision.lane === "quick" ? [{ kind: "ran" as const, detail: decision.tool }]
      : decision.lane === "job" ? [{ kind: "mac" as const, detail: `job for the ${decision.helper} helper` }] : [];
    noteTurn(ctx, { channel: "mac", words: req.text, extra });
  }
  const record = recordOf(decision, req);
  if (record) later(() => retryWithout0060(() => withUser(ctx.user.profileId, (db) => insertRequest(db, ctx, record))).catch((err) => {
    // A replay that raced this one: the first row stands.
    if (!isUniqueViolation(err)) throw err;
  }));
  await writeDecision(mc, body, decision, write);
}

async function writeDecision(mc: MacContext, body: FrontBody, d: RouteDecision, write: NdjsonWrite): Promise<void> {
  const { ctx } = mc;
  const req = body.request;
  switch (d.lane) {
    case "mac":
      write({ t: "route", lane: "mac", actions: d.actions, risk: d.risk });
      write({ t: "done", result: {} });
      return;
    case "job": {
      const token = signPayload({ k: "job", o: ctx.org.id, m: ctx.membership.id, n: req.nonce, h: d.helper, t: d.title, d: d.doing, g: d.goal, w: req.text, v: req.via, a: req.at, s: req.ageMs } satisfies Omit<JobToken, never>, 120);
      const say = `${d.doing.replace(/[.!]+$/, "")}.`;
      const { speechOfferFor } = await import("@/server/services/natural-voice");
      const speech = await speechOfferFor(ctx)(say).catch(() => null);
      write({ t: "route", lane: "job", job: { helper: d.helper, title: d.title, doing: d.doing, goal: d.goal, token, needs: { consent: d.consent, yes: d.checkEvery } }, say, speech });
      write({ t: "done", result: {} });
      return;
    }
    case "look":
      write({ t: "route", lane: "look", look: { lane: d.look } });
      write({ t: "done", result: {} });
      return;
    case "look_screen":
      write({ t: "route", lane: "look", look: { lane: "now" }, screen: true });
      write({ t: "done", result: {} });
      return;
    case "ask":
      write({ t: "route", lane: "ask", question: d.question });
      write({ t: "done", result: {} });
      return;
    case "enable":
      write({ t: "route", lane: "enable", which: d.which });
      write({ t: "done", result: {} });
      return;
    case "refused":
      write({ t: "route", lane: "refused", reason: d.reason, message: d.message });
      write({ t: "done", result: {} });
      return;
    case "quick": {
      write({ t: "route", lane: "boredroom" });
      const { runBrendaTool } = await import("@/server/services/copilot");
      const r = await runBrendaTool(ctx, d.tool, d.input, "chat", { act: "read", userWords: [req.text], checkEvery: mc.checkEvery, onMac: true });
      const out = r.out && typeof r.out === "object" && !Array.isArray(r.out) ? (r.out as Record<string, unknown>) : {};
      const reply = r.actions.length ? r.actions.map((a) => a.summary).join(". ").replace(/\.\.$/, ".")
        : r.proposals.length ? "Press Confirm and I'll do it."
        : typeof out.error === "string" ? out.error : "Done.";
      write({ t: "done", result: await withSpeech(ctx, { reply, engine: "claude", actions: r.actions, proposals: r.proposals, note: null, tainted: false }) });
      return;
    }
    case "boredroom": {
      write({ t: "route", lane: "boredroom" });
      const { chat } = await import("@/server/services/copilot");
      const result = await chat(ctx, { messages: body.messages.map((m) => ({ role: m.role, content: m.content })) }, { checkEvery: mc.checkEvery });
      write({ t: "done", result: await withSpeech(ctx, result) });
      return;
    }
  }
}

async function withSpeech<T extends { reply: string }>(ctx: OrgContext, result: T): Promise<T & { spoken: string; speech: unknown }> {
  const spoken = speakable(result.reply);
  const { speechOfferFor } = await import("@/server/services/natural-voice");
  return { ...result, spoken, speech: await speechOfferFor(ctx)(spoken).catch(() => null) };
}

// ---- Mac-local records (contract E.3) ------------------------------------------------------------------------------------------

const RECORD_ACTION_OUTCOMES = ["done", "refused", "failed", "said_no", "stopped", "skipped"] as const;
const RECORD_OUTCOMES = ["pending", "done", "partly", "refused", "failed", "said_no", "stopped", "undone"] as const;
const recordSchema = z.object({
  nonce: z.string().regex(NONCE),
  text: z.string().transform(fold).pipe(z.string().min(1).max(FRONT_LIMITS.textChars)),
  via: z.enum(["voice", "typed"]),
  at: z.string().datetime({ offset: true }),
  matched: z.enum(["mac", "router"]),
  lane: z.enum(["mac", "boredroom", "job", "look", "chat", "ask", "none"]),
  risk: z.enum(["routine", "ask", "never"]),
  authorisedBy: z.enum(["request", "yes"]),
  confirmedVia: z.enum(["button", "voice", "typed"]).nullable(),
  actions: z.array(z.object({
    kind: z.enum(MAC_ACTION_KINDS),
    outcome: z.enum(RECORD_ACTION_OUTCOMES),
    words: z.string().max(FRONT_LIMITS.actionWords).refine((w) => !ONE_LINE_BAD.test(w)),
  })).max(FRONT_LIMITS.recordActions),
  outcome: z.enum(RECORD_OUTCOMES),
  summary: z.string().max(300).nullable(),
  undo: z.object({ available: z.boolean() }).passthrough().nullable(),
});
export const recordBodySchema = z.object({ version: z.literal(1), records: z.array(z.unknown()).min(1).max(FRONT_LIMITS.records) });
export type FrontRecord = z.infer<typeof recordSchema>;

/**
 * The least an action that ran needed (review, 16 October 2026): the shared classifier's base class for its kind, so a
 * record can't say an ask-first action (emptying the Trash, Wi-Fi off) ran on the request alone. A Wi-Fi record says
 * which way in its words ("Wi-Fi is on"); anything else is read as off, the side that asks.
 */
export function recordFloor(actions: FrontRecord["actions"]): "routine" | "ask" | "never" {
  let floor: "routine" | "ask" | "never" = "routine";
  for (const a of actions) {
    if (a.outcome !== "done") continue;
    const kind = riskKindOfAction(a.kind, a.kind === "wifi" ? /\bon\b/i.test(a.words) && !/\boff\b/i.test(a.words) : undefined);
    const c = kind ? classify(kind).class : "ask";
    if (c === "never") return "never";
    if (c === "ask") floor = "ask";
  }
  return floor;
}

/** One record's own checks beyond its shape: its time, and the database's rule (said again here, so a bad one is 422). */
function recordOk(r: FrontRecord): boolean {
  const at = Date.parse(r.at);
  if (!Number.isFinite(at) || at < Date.now() - 86_400_000 || at > Date.now() + 10 * 60_000) return false;
  const ran = !["pending", "refused", "said_no"].includes(r.outcome);
  if (ran && !((r.authorisedBy === "request" && r.risk === "routine") || (r.authorisedBy === "yes" && r.confirmedVia))) return false;
  // What actually ran sets the floor, whatever the record says of itself: an ask-first action needs the person's yes.
  if (ran && recordFloor(r.actions) !== "routine" && !(r.authorisedBy === "yes" && r.confirmedVia)) return false;
  // A typed text's words are never kept (contract E.3): "Typed into {App}", never the text.
  if (r.actions.some((a) => a.kind === "type_text" && !/^(Typed into .{1,80}|Typed it\.?|)$/.test(a.words))) return false;
  return true;
}

/**
 * Records of requests the Mac handled itself (matched there, or a routed Mac action after it ran, or an ask answered no),
 * sent without blocking anything (contract E.3). Upserted by (person, nonce): a router-made row keeps its words, lane and
 * `matched`, and takes the Mac's actions, outcome, summary, undo and (an ask answered yes) `authorised_by 'yes'` with how.
 * A record that fails its checks is skipped (422 FRONT_INVALID when none was saved); the rest are saved.
 */
export async function recordFront(mc: MacContext, body: z.infer<typeof recordBodySchema>): Promise<{ saved: number; ready: boolean }> {
  const { ctx } = mc;
  if (!mc.ready0060) return { saved: 0, ready: false };
  const good: FrontRecord[] = [];
  for (const raw of body.records) {
    const r = recordSchema.safeParse(raw);
    if (r.success && recordOk(r.data)) good.push(r.data);
  }
  if (!good.length) throw frontFail(422, "FRONT_INVALID", E.invalid);
  let saved = 0;
  try {
    await retryWithout0060(() => withUser(ctx.user.profileId, async (db) => {
      saved = 0;
      for (const r of good) {
        // Each record on its own savepoint: one the database refuses (its rule) is skipped, the rest are saved.
        await db.query("SAVEPOINT front_record");
        const row = await db.maybeOne(
          `INSERT INTO mac_requests AS q (organisation_id, membership_id, device_session, nonce, request_text, source, requested_at, matched, lane, risk, authorised_by, confirmed_via,
                                          actions, outcome, summary, undo)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15, $16::jsonb)
           ON CONFLICT (membership_id, nonce) DO UPDATE SET
             actions = EXCLUDED.actions, outcome = EXCLUDED.outcome, summary = EXCLUDED.summary, undo = EXCLUDED.undo,
             -- Never a downgrade (review, 16 October 2026): the higher of the two, never > ask > routine, so a request the
             -- router refused ('never') stays refused whatever the Mac sends (and the database then refuses a run of it).
             risk = CASE WHEN q.risk = 'never' OR EXCLUDED.risk = 'never' THEN 'never' WHEN q.risk = 'ask' OR EXCLUDED.risk = 'ask' THEN 'ask' ELSE 'routine' END,
             authorised_by = CASE WHEN EXCLUDED.authorised_by = 'yes' THEN 'yes' ELSE q.authorised_by END,
             confirmed_via = COALESCE(EXCLUDED.confirmed_via, q.confirmed_via)
           WHERE q.job_id IS NULL
           RETURNING id`,
          [ctx.org.id, ctx.membership.id, sessionId(ctx), r.nonce, r.text, r.via, r.at, r.matched, r.lane, r.risk, r.authorisedBy, r.confirmedVia,
            JSON.stringify(r.actions), r.outcome, r.summary, r.undo ? JSON.stringify(r.undo) : null]).catch(async (err: unknown) => {
          if ((err as { code?: string })?.code !== "23514") throw err;
          await db.query("ROLLBACK TO SAVEPOINT front_record");
          return null;
        });
        if (row) { saved++; await db.query("RELEASE SAVEPOINT front_record"); }
      }
    }));
  } catch (err) {
    if (isMissingSchema(err)) { forget0060(); return { saved: 0, ready: false }; }
    throw err;
  }
  return { saved, ready: true };
}

// ---- The first short line in her natural voice (contract M.2) ------------------------------------------------------------------

/**
 * Up to one utterance (SPEECH_MAX_CHARS). Every line the notch says goes through here when it has no offer of its own
 * (owner request, 27 October 2026: "everything ElevenLabs, no local voice at all"): the fixed doing and done lines (S.1),
 * and the lines the Mac words itself (a plan and "Do you want me to do this?", a step's question, a job's end, a
 * refusal). The offer is signed for this person only and plays only to them; the speech route's burst guard
 * (SPEECH_BURST) bounds it as it bounds every utterance.
 */
export const lineSchema = z.object({ text: z.string().min(1).max(SPEECH_MAX_CHARS) });

/** A speech offer for a line the notch says to its own person (else null: no voice, Voice off, no key). */
export async function frontLineOffer(ctx: OrgContext, text: string): Promise<{ speech: unknown }> {
  const { speechOfferFor } = await import("@/server/services/natural-voice");
  return { speech: await speechOfferFor(ctx)(text).catch(() => null) };
}

// ---- "Check with me before every task" (contract F.3, N.2; decision 9) ---------------------------------------------------------

export const macPermissionSchema = z.object({ checkEveryTask: z.boolean() });
export type MacPermission = { ready: boolean; checkEveryTask: boolean; impersonated: boolean };

/** The person's own switch (default off). Before 0060: `{ready: false}`. Owners and HR never read anyone else's. */
export async function macPermission(ctx: OrgContext): Promise<MacPermission> {
  const impersonated = !!ctx.user.impersonation;
  try {
    return await retryWithout0060(() => withUser(ctx.user.profileId, async (db) => {
      if (!(await schema0060Ready(db))) return { ready: false, checkEveryTask: false, impersonated };
      const r = await db.maybeOne<{ c: boolean }>(`SELECT check_every_task AS c FROM assistant_private WHERE membership_id = $1 AND organisation_id = $2`, [ctx.membership.id, ctx.org.id]);
      return { ready: true, checkEveryTask: r?.c === true, impersonated };
    }));
  } catch (err) {
    if (!isMissingSchema(err)) throw err;
    forget0060();
    return { ready: false, checkEveryTask: false, impersonated };
  }
}

/** Saves the person's own switch. 403 while someone else is signed in as them; 503 FRONT_NOT_READY before 0060. */
export async function saveMacPermission(ctx: OrgContext, input: z.infer<typeof macPermissionSchema>): Promise<MacPermission> {
  if (ctx.user.impersonation) throw frontFail(403, "FRONT_IMPERSONATED", "Only the person can change this. It stays as it is while someone else is signed in as them.");
  return retryWithout0060(() => withUser(ctx.user.profileId, async (db) => {
    if (!(await schema0060Ready(db))) throw frontFail(503, "FRONT_NOT_READY", E.notReady);
    await db.query(
      `INSERT INTO assistant_private(membership_id, organisation_id, check_every_task) VALUES ($1, $2, $3)
       ON CONFLICT (membership_id) DO UPDATE SET check_every_task = EXCLUDED.check_every_task`, [ctx.membership.id, ctx.org.id, input.checkEveryTask]);
    return { ready: true, checkEveryTask: input.checkEveryTask, impersonated: false };
  }));
}

// ---- Forget (contract E.4, N.3) ---------------------------------------------------------------------------------------------------

/** The person's own request row, with its job when it has one; 409 JOB_LIVE while that job runs; 404 otherwise. */
export async function forgetRequest(ctx: OrgContext, id: string): Promise<{ forgotten: true }> {
  if (ctx.user.impersonation) throw frontFail(403, "FRONT_IMPERSONATED", E.impersonated);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw frontFail(404, "NOT_FOUND", "That's gone already.");
  try {
    return await retryWithout0060(() => withUser(ctx.user.profileId, async (db) => {
      if (!(await schema0060Ready(db))) throw frontFail(404, "NOT_FOUND", "That's gone already.");
      const r = await db.maybeOne<{ id: string; job_id: string | null; live: boolean }>(
        `SELECT q.id, q.job_id, EXISTS (SELECT 1 FROM assistant_tasks t WHERE t.id = q.job_id AND t.status IN ('proposed', 'running', 'asking', 'paused')) AS live
         FROM mac_requests q WHERE q.id = $1 AND q.membership_id = $2 AND q.organisation_id = $3 FOR UPDATE`, [id, ctx.membership.id, ctx.org.id]);
      if (!r) throw frontFail(404, "NOT_FOUND", "That's gone already.");
      if (r.live) throw frontFail(409, "JOB_LIVE", E.jobLive);
      if (r.job_id) await db.query(`DELETE FROM assistant_tasks WHERE id = $1 AND membership_id = $2 AND ended_at IS NOT NULL`, [r.job_id, ctx.membership.id]);
      await db.query(`DELETE FROM mac_requests WHERE id = $1 AND membership_id = $2`, [r.id, ctx.membership.id]);
      return { forgotten: true as const };
    }));
  } catch (err) {
    if (isMissingSchema(err)) { forget0060(); throw frontFail(404, "NOT_FOUND", "That's gone already."); }
    throw err;
  }
}
