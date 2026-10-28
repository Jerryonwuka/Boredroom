/**
 * The usage ledger and the limits (owner decision, 8 October 2026: personal assistants, phase 3). Every call to the
 * model is one row in `ai_usage` (migration 0037): the organisation, the person it was for (NULL for the workspace's own
 * jobs, the end-of-day report), what it was for, the model and the token counts from the API's usage block. One chat
 * turn (one press of Send, however many model steps) shares one `request_id` and counts as one request (review,
 * 8 October 2026: decision 8).
 *
 * - Rows are written by the server: as the person under row-level security (their own row only) or through the worker
 *   (any row). People read their own; owners and HR their organisation's. Nothing updates or deletes a row.
 * - Each person may make AI_DAILY_REQUEST_LIMIT requests a day (chat turns, to-do planner calls, follow-ups and
 *   mentions in Messages), counted in the organisation's own day from local midnight; after that the built-in helper
 *   answers until midnight. Bursts are held separately, per person per minute, by the auth module's rate limiter.
 * - Owners and HR see this month's usage in Settings → Brenda: requests and tokens, by purpose, the people who asked
 *   most. No prices anywhere.
 *
 * Recording never throws and never holds up a reply. Until 0037 is applied nothing is recorded, there is no daily limit
 * and the summary says it is not ready (server/lib/schema-0037).
 */
import { randomUUID } from "node:crypto";
import { withSystem, withUser, withWorker } from "@/server/db";
import type { OrgContext } from "@/server/lib/api";
import { forbidden } from "@/server/lib/errors";
import { forget0037, isMissingSchema, schema0037Ready } from "@/server/lib/schema-0037";
import { forget0057, schema0057Ready } from "@/server/lib/schema-0057";
import { forget0058, schema0058Ready } from "@/server/lib/schema-0058";
import { schema0060Ready } from "@/server/lib/schema-0060";
import { addDays, localMidnight, todayLocal } from "@/server/lib/time";

/** Per person per day (owner decision, 8 October 2026). Counted in the organisation's own day, from local midnight. */
export const AI_DAILY_REQUEST_LIMIT = 150;
/** Bursts, on top of the daily limit: per person, per minute. */
export const AI_BURST = { requests: 20, windowSeconds: 60 } as const;
export const AI_BURST_MESSAGE = "That's a lot of requests in one minute. Wait a moment, then try again.";

/**
 * What a model call was for. 'followup' (owner decision, 8 October 2026: personal assistants, phase 4; migration 0039
 * widens the column's CHECK) is the one call that writes a follow-up's answer from the facts and the person's reply,
 * recorded against the person who asked. Before 0039 the database refuses it, so nothing is recorded (and nothing calls
 * the model for a follow-up before 0039 anyway).
 *
 * 'mention' (owner decision, 8 October 2026: personal assistants, phase 5; migration 0041 widens the CHECK the same way)
 * is the person's own assistant answering them in a conversation they tagged it in ("@Max …"): every model call of one
 * mention shares the mention's id as its request id, so one mention counts once, against the person who asked. Before
 * 0041 nothing is processed, so nothing is recorded.
 *
 * 'loose_ends' and 'commitments' (owner decisions, 8 October 2026: phase 7b; migration 0048 widens the CHECK the same way):
 * the person's own loose-ends scan, one request per scan against their 150 a day; and the workspace's own scan of tracked
 * group conversations for commitments, recorded with no person (it never spends anyone's allowance) and capped per
 * organisation per day (LOOP_LIMITS.modelCallsPerOrgPerDay). Before 0048 neither runs, so neither is recorded.
 *
 * 'standup' (owner decisions, 8–9 October 2026: phase 7c; migration 0050 widens the CHECK the same way): the one model
 * call that rewrites a person's standup facts into short sentences, recorded against that person (its request id is the
 * entry's id, so a retried draft counts once) and counted in their 150 a day. Before 0050 no standup runs, so nothing is
 * recorded.
 *
 * 'call_recap' (owner decisions, 8 October 2026: phase 8; migration 0054 widens the CHECK the same way): the workspace
 * assistant's recap of a call its people agreed to have notes on, recorded with no person (it never spends anyone's
 * allowance; the call's id is its request id, so a retried recap counts once) and capped per organisation per day
 * (NOTES_LIMITS.recapsPerOrgPerDay). Before 0054 no call has notes, so nothing is recorded.
 */
//
// 'learning' (owner decision, 28 October 2026: "What Brenda has learned"; migration 0067 widens the CHECK the same way):
// the cheap model reading one person's own signals to learn their habits, recorded for the workspace with no person (it
// never spends anyone's allowance, and owners never see who has learning on). Before 0067 nothing is learned, so nothing
// is recorded.
export const USAGE_PURPOSES = ["chat", "plan", "report", "summary", "test", "other", "followup", "mention", "loose_ends", "commitments", "standup", "call_recap", "learning"] as const;
export type UsagePurpose = (typeof USAGE_PURPOSES)[number];
/**
 * Purposes that count towards the person's daily limit. A team report the person asked for counts too (review,
 * 8 October 2026: it calls the model each time it is asked, from Settings or by her team_report, until the end-of-day
 * report has gone out); one asked for in a chat turn shares that turn's request id, so it is not counted twice. The
 * end-of-day send is the workspace's own (membership NULL) and counts towards nobody. A follow-up's calls share their
 * batch's id (its request id), so one ask counts once however many people it covers (owner decision, 8 October 2026:
 * personal assistants, phase 4). A mention in Messages counts too, once per mention (owner decision, 8 October 2026:
 * personal assistants, phase 5: it comes out of the same 150 a day).
 */
// A loose-ends scan counts too, once per scan (owner decisions, 8 October 2026: phase 7b); the workspace's commitments scan
// never does (it has no person). A standup draft counts once a day per team (owner decisions, 8–9 October 2026: phase 7c).
export const LIMITED_PURPOSES: readonly UsagePurpose[] = ["chat", "plan", "report", "followup", "mention", "loose_ends", "standup"];

/** The API's usage block (Anthropic Messages API `res.usage`), as it comes. */
export type ModelUsage = { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null } | null | undefined;
export type UsageEntry = { purpose: UsagePurpose; model: string; usage: ModelUsage; requestId?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INT_MAX = 2_147_483_647;

/** A new request id: one per chat turn or planner call; every model call in it records the same one. */
export function newRequestId(): string {
  return randomUUID();
}

/** A token count as the column holds it: a whole number from 0 to the integer maximum (null, missing or junk read 0). */
const tokens = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(INT_MAX, Math.round(n)) : 0;
};

/** One ledger row's values; the model name is clamped to what the column allows. */
function rowOf(e: UsageEntry) {
  const purpose: UsagePurpose = (USAGE_PURPOSES as readonly string[]).includes(e.purpose) ? e.purpose : "other";
  const model = String(e.model ?? "").trim().slice(0, 100) || "unknown";
  const u = e.usage ?? {};
  return {
    requestId: e.requestId && UUID.test(e.requestId) ? e.requestId : newRequestId(),
    purpose, model,
    input: tokens(u.input_tokens), output: tokens(u.output_tokens),
    cacheRead: tokens(u.cache_read_input_tokens), cacheWrite: tokens(u.cache_creation_input_tokens),
  };
}

// No RETURNING: a row the caller may not read back would refuse the insert (the ledger's rows are plain inserts).
const INSERT = `INSERT INTO ai_usage(organisation_id, membership_id, request_id, purpose, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`;

function swallow(err: unknown) {
  if (isMissingSchema(err)) { forget0037(); return; }
  console.warn(`[ai-usage] could not record a model call: ${(err as Error)?.message ?? String(err)}`);
}

/** One model call, as the person (their row under row-level security). Never throws; does nothing before 0037. */
export async function recordUsage(ctx: OrgContext, e: UsageEntry): Promise<void> {
  try {
    const r = rowOf(e);
    await withUser(ctx.user.profileId, async (db) => {
      if (!(await schema0037Ready(db))) return;
      await db.query(INSERT, [ctx.org.id, ctx.membership.id, r.requestId, r.purpose, r.model, r.input, r.output, r.cacheRead, r.cacheWrite]);
    });
  } catch (err) { swallow(err); }
}

/** One model call for the workspace's own job (membership NULL), through the worker. Never throws; does nothing before 0037. */
export async function recordWorkspaceUsage(organisationId: string, e: UsageEntry): Promise<void> {
  try {
    const r = rowOf(e);
    await withWorker(async (db) => {
      if (!(await schema0037Ready(db))) return;
      await db.query(INSERT, [organisationId, null, r.requestId, r.purpose, r.model, r.input, r.output, r.cacheRead, r.cacheWrite]);
    });
  } catch (err) { swallow(err); }
}

// ---- Screen help: what a look costs, with no workspace and no person ------------------------------------------------------

/**
 * Screen help on Brenda for Mac (owner decision 1, 11 October 2026: "the employer never sees it nor whether it is used";
 * contract D.9). A look is one ordinary chat request in the person's ledger, recorded with recordUsage like any chat step,
 * with the picture's tokens taken out of its input (`withoutImage`): owners see an ordinary request with ordinary-looking
 * tokens. What the picture really cost goes to `look_usage_daily` (migration 0057), per day (UTC) and model only: no
 * workspace, no person, the worker alone reads or writes it. There is no look-specific rate limit either (it would be a
 * per-person record of looks).
 */
export function withoutImage(usage: ModelUsage, imageTokens: number): ModelUsage {
  if (!usage) return usage;
  const take = Math.max(0, Math.round(Number(imageTokens) || 0));
  const input = typeof usage.input_tokens === "number" && Number.isFinite(usage.input_tokens) ? usage.input_tokens : 0;
  return { ...usage, input_tokens: Math.max(0, input - take) };
}

/**
 * One model call of a look, added to today's (UTC) row for its model: `looks` +1 on the look's first step, `steps` +1,
 * the picture's tokens and the API's own counts. Through the worker; never throws; nothing before 0057.
 */
export async function recordLookUsage(e: { model: string; usage: ModelUsage; imageTokens: number; first: boolean }): Promise<void> {
  try {
    const model = String(e.model ?? "").trim().slice(0, 100) || "unknown";
    const u = e.usage ?? {};
    await withWorker(async (db) => {
      if (!(await schema0057Ready(db))) return;
      await db.query(
        `INSERT INTO look_usage_daily(day, model, looks, steps, image_tokens, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens)
         VALUES ((now() AT TIME ZONE 'UTC')::date, $1, $2, 1, $3, $4, $5, $6, $7)
         ON CONFLICT (day, model) DO UPDATE SET looks = look_usage_daily.looks + EXCLUDED.looks, steps = look_usage_daily.steps + 1,
           image_tokens = look_usage_daily.image_tokens + EXCLUDED.image_tokens, input_tokens = look_usage_daily.input_tokens + EXCLUDED.input_tokens,
           output_tokens = look_usage_daily.output_tokens + EXCLUDED.output_tokens, cache_read_tokens = look_usage_daily.cache_read_tokens + EXCLUDED.cache_read_tokens,
           cache_write_tokens = look_usage_daily.cache_write_tokens + EXCLUDED.cache_write_tokens`,
        [model, e.first ? 1 : 0, tokens(e.imageTokens), tokens(u.input_tokens), tokens(u.output_tokens), tokens(u.cache_read_input_tokens), tokens(u.cache_creation_input_tokens)]);
    });
  } catch (err) {
    if (isMissingSchema(err)) { forget0057(); return; }
    console.warn(`[ai-usage] could not record a look's cost: ${(err as { code?: string })?.code ?? "error"}`);
  }
}

// ---- Brenda for Mac, phase 2: what tasks cost, with no workspace and no person --------------------------------------------

/**
 * Tasks on the person's Mac (owner request, 12 October 2026; contract 0b.13, D.10): a task's units (a screen task 1 per 2
 * steps, a file job 1 per 25,000 tokens) are kept on the person's own task row and counted in their daily limit by
 * aiAllowance; no `ai_usage` row is ever written for a step or a file call, so owners see nothing per person. What a
 * task really cost goes to `act_usage_daily` (migration 0058), per day (UTC), model and kind only, through the worker.
 * `first`: the task's first model call (tasks +1). Never throws; nothing before 0058.
 */
// Brenda and her helpers (owner brief, 12 October 2026; decision 8: no helper allowance during the pilot, measure costs for
// a month): the front desk's router, quick looks, the Files helper and the Mac operator are counted here too, by kind,
// with no workspace and no person. Migration 0060 widens the kinds; before it those rows are skipped (as tasks' were
// before 0058).
export type ActUsageKind = "screen" | "file" | "router" | "look_now" | "files" | "operator";
const NEW_KINDS: ReadonlySet<ActUsageKind> = new Set(["router", "look_now", "files", "operator"]);

export async function recordActUsage(e: { model: string; kind: ActUsageKind; usage: ModelUsage; imageTokens?: number; first: boolean }): Promise<void> {
  try {
    const model = String(e.model ?? "").trim().slice(0, 100) || "unknown";
    const u = e.usage ?? {};
    await withWorker(async (db) => {
      if (!(await schema0058Ready(db))) return;
      if (NEW_KINDS.has(e.kind) && !(await schema0060Ready(db))) return;
      await db.query(
        `INSERT INTO act_usage_daily(day, model, kind, tasks, steps, image_tokens, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens)
         VALUES ((now() AT TIME ZONE 'UTC')::date, $1, $2, $3, 1, $4, $5, $6, $7, $8)
         ON CONFLICT (day, model, kind) DO UPDATE SET tasks = act_usage_daily.tasks + EXCLUDED.tasks, steps = act_usage_daily.steps + 1,
           image_tokens = act_usage_daily.image_tokens + EXCLUDED.image_tokens, input_tokens = act_usage_daily.input_tokens + EXCLUDED.input_tokens,
           output_tokens = act_usage_daily.output_tokens + EXCLUDED.output_tokens, cache_read_tokens = act_usage_daily.cache_read_tokens + EXCLUDED.cache_read_tokens,
           cache_write_tokens = act_usage_daily.cache_write_tokens + EXCLUDED.cache_write_tokens`,
        [model, (["screen", "file", "router", "look_now", "files", "operator"] as const).includes(e.kind) ? e.kind : "screen", e.first ? 1 : 0, tokens(e.imageTokens), tokens(u.input_tokens), tokens(u.output_tokens), tokens(u.cache_read_input_tokens), tokens(u.cache_creation_input_tokens)]);
    });
  } catch (err) {
    if (isMissingSchema(err)) { forget0058(); return; }
    console.warn(`[ai-usage] could not record a task's cost: ${(err as { code?: string })?.code ?? "error"}`);
  }
}

export type Allowance = { ready: boolean; used: number; limit: number; remaining: number; resetsAt: string };

/**
 * Requests today: the distinct request ids of the person's rows for chat and the to-do planner since the organisation's
 * local midnight; `resetsAt` is the next local midnight. Before 0037 nothing is counted (`ready: false`).
 * Plus, once 0058 is applied (phase 2, owner request 12 October 2026; contract D.10), the units of the person's own tasks
 * on their Mac that they said yes to today, read as the person from their own rows (owners never read them).
 */
export async function aiAllowance(ctx: OrgContext): Promise<Allowance> {
  const tz = ctx.org.timezone;
  const today = todayLocal(tz);
  const limit = AI_DAILY_REQUEST_LIMIT;
  const resetsAt = localMidnight(addDays(today, 1), tz).toISOString();
  const none: Allowance = { ready: false, used: 0, limit, remaining: limit, resetsAt };
  try {
    return await withUser(ctx.user.profileId, async (db) => {
      if (!(await schema0037Ready(db))) return none;
      const since = localMidnight(today, tz).toISOString();
      const r = await db.one<{ used: number }>(
        `SELECT count(DISTINCT request_id)::int AS used FROM ai_usage
         WHERE organisation_id = $1 AND membership_id = $2 AND purpose = ANY($3::text[]) AND created_at >= $4::timestamptz`,
        [ctx.org.id, ctx.membership.id, [...LIMITED_PURPOSES], since]);
      const tasks = await taskUnitsToday(db, ctx, since);
      const used = r.used + tasks;
      return { ready: true, used, limit, remaining: Math.max(0, limit - used), resetsAt };
    });
  } catch (err) {
    if (!isMissingSchema(err)) throw err;
    forget0037();
    return none;
  }
}

/**
 * The units of the person's own tasks they said yes to since `since` (0 before 0058, or when the read fails). Read from
 * `assistant_task_units`, which the person's Forget never touches (review, 12 October 2026: deleting today's tasks reset
 * the limit when the units were read from the tasks themselves).
 */
async function taskUnitsToday(db: Parameters<Parameters<typeof withUser>[1]>[0], ctx: OrgContext, since: string): Promise<number> {
  try {
    if (!(await schema0058Ready(db))) return 0;
    await db.query("SAVEPOINT act_units");
    const t = await db.one<{ units: number }>(
      `SELECT COALESCE(sum(units), 0)::int AS units FROM assistant_task_units WHERE organisation_id = $1 AND membership_id = $2 AND confirmed_at >= $3::timestamptz`,
      [ctx.org.id, ctx.membership.id, since]);
    await db.query("RELEASE SAVEPOINT act_units");
    return Number(t.units) || 0;
  } catch (err) {
    await db.query("ROLLBACK TO SAVEPOINT act_units").catch(() => undefined);
    if (isMissingSchema(err)) forget0058();
    return 0;
  }
}

/**
 * Throws rateLimited(AI_BURST_MESSAGE) past 20 requests a minute for this person (auth's rateLimitIn, as the system).
 * The auth module is loaded here, when a route asks, so the background worker (which records the end-of-day report's
 * usage through this file) never loads the request-only modules it imports.
 */
export async function checkAiBurst(ctx: OrgContext): Promise<void> {
  const { rateLimitIn } = await import("@/server/auth");
  await withSystem((db) => rateLimitIn(db, `ai.burst:${ctx.membership.id}`, AI_BURST.requests, AI_BURST.windowSeconds, AI_BURST_MESSAGE));
}

// ---- This month, for owners and HR ------------------------------------------------------------------------------------

export type UsageTotals = { requests: number; calls: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
export type UsageSummary = {
  ready: boolean;
  /** Local dates: the 1st of this month, and today. */
  from: string; to: string;
  dailyLimit: number;
  totals: UsageTotals;
  /** Purposes with any calls, most requests first. */
  byPurpose: (UsageTotals & { purpose: UsagePurpose })[];
  /** The five people with the most requests; tokens are in plus out. */
  topPeople: { membershipId: string; name: string; requests: number; tokens: number }[];
  /** Rows with no person: the workspace's own jobs (the end-of-day report). */
  workspace: UsageTotals;
};

const ZERO: UsageTotals = { requests: 0, calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
const TOTALS = `count(DISTINCT request_id)::int AS requests, count(*)::int AS calls,
  COALESCE(sum(input_tokens), 0)::bigint AS input_tokens, COALESCE(sum(output_tokens), 0)::bigint AS output_tokens,
  COALESCE(sum(cache_read_tokens), 0)::bigint AS cache_read_tokens, COALESCE(sum(cache_write_tokens), 0)::bigint AS cache_write_tokens`;
type TotalsRow = { requests: number; calls: number; input_tokens: number | string; output_tokens: number | string; cache_read_tokens: number | string; cache_write_tokens: number | string };
const totalsOf = (r: TotalsRow | null | undefined): UsageTotals => r ? {
  requests: Number(r.requests) || 0, calls: Number(r.calls) || 0,
  inputTokens: Number(r.input_tokens) || 0, outputTokens: Number(r.output_tokens) || 0,
  cacheReadTokens: Number(r.cache_read_tokens) || 0, cacheWriteTokens: Number(r.cache_write_tokens) || 0,
} : { ...ZERO };

/** This month's usage for the organisation (owners and HR; forbidden() otherwise). */
export async function usageSummary(ctx: OrgContext): Promise<UsageSummary> {
  if (ctx.membership.role !== "owner" && ctx.membership.role !== "hr") throw forbidden("Only the organisation owner or HR can see how much the assistants are used.");
  const tz = ctx.org.timezone;
  const today = todayLocal(tz);
  const from = `${today.slice(0, 7)}-01`;
  const empty: UsageSummary = { ready: false, from, to: today, dailyLimit: AI_DAILY_REQUEST_LIMIT, totals: { ...ZERO }, byPurpose: [], topPeople: [], workspace: { ...ZERO } };
  const since = localMidnight(from, tz).toISOString();
  try {
    return await withUser(ctx.user.profileId, async (db) => {
      if (!(await schema0037Ready(db))) return empty;
      const params = [ctx.org.id, since];
      const where = `organisation_id = $1 AND created_at >= $2::timestamptz`;
      const [totals, byPurpose, people, workspace] = [
        await db.one<TotalsRow>(`SELECT ${TOTALS} FROM ai_usage WHERE ${where}`, params),
        await db.query<TotalsRow & { purpose: UsagePurpose }>(`SELECT purpose, ${TOTALS} FROM ai_usage WHERE ${where} GROUP BY purpose ORDER BY requests DESC, calls DESC, purpose`, params),
        await db.query<{ membership_id: string; name: string | null; requests: number; tokens: number | string }>(
          `SELECT a.membership_id, p.display_name AS name, count(DISTINCT a.request_id)::int AS requests, COALESCE(sum(a.input_tokens::bigint + a.output_tokens), 0)::bigint AS tokens
           FROM ai_usage a JOIN memberships m ON m.id = a.membership_id LEFT JOIN profiles p ON p.id = m.user_id
           WHERE a.organisation_id = $1 AND a.created_at >= $2::timestamptz AND a.membership_id IS NOT NULL
           GROUP BY a.membership_id, p.display_name ORDER BY requests DESC, tokens DESC, p.display_name LIMIT 5`, params),
        await db.one<TotalsRow>(`SELECT ${TOTALS} FROM ai_usage WHERE ${where} AND membership_id IS NULL`, params),
      ];
      return {
        ready: true, from, to: today, dailyLimit: AI_DAILY_REQUEST_LIMIT,
        totals: totalsOf(totals),
        byPurpose: byPurpose.map((r) => ({ purpose: r.purpose, ...totalsOf(r) })),
        topPeople: people.map((r) => ({ membershipId: r.membership_id, name: r.name ?? "Someone", requests: Number(r.requests) || 0, tokens: Number(r.tokens) || 0 })),
        workspace: totalsOf(workspace),
      };
    });
  } catch (err) {
    if (!isMissingSchema(err)) throw err;
    forget0037();
    return empty;
  }
}
