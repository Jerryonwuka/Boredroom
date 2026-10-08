/**
 * The usage ledger and the limits (owner decision, 8 October 2026: personal assistants, phase 3). Every call to the
 * model is one row in `ai_usage` (migration 0037): the organisation, the person it was for (NULL for the workspace's own
 * jobs, the end-of-day report), what it was for, the model and the token counts from the API's usage block. One chat
 * turn (one press of Send, however many model steps) shares one `request_id` and counts as one request (review,
 * 8 October 2026: decision 8).
 *
 * - Rows are written by the server: as the person under row-level security (their own row only) or through the worker
 *   (any row). People read their own; owners and HR their organisation's. Nothing updates or deletes a row.
 * - Each person may make AI_DAILY_REQUEST_LIMIT requests a day (chat turns and to-do planner calls), counted in the
 *   organisation's own day from local midnight; after that the built-in helper answers until midnight. Bursts are held
 *   separately, per person per minute, by the auth module's rate limiter.
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
import { addDays, localMidnight, todayLocal } from "@/server/lib/time";

/** Per person per day (owner decision, 8 October 2026). Counted in the organisation's own day, from local midnight. */
export const AI_DAILY_REQUEST_LIMIT = 150;
/** Bursts, on top of the daily limit: per person, per minute. */
export const AI_BURST = { requests: 20, windowSeconds: 60 } as const;
export const AI_BURST_MESSAGE = "That's a lot of requests in one minute. Wait a moment, then try again.";

export const USAGE_PURPOSES = ["chat", "plan", "report", "summary", "test", "other"] as const;
export type UsagePurpose = (typeof USAGE_PURPOSES)[number];
/**
 * Purposes that count towards the person's daily limit. A team report the person asked for counts too (review,
 * 8 October 2026: it calls the model each time it is asked, from Settings or by her team_report, until the end-of-day
 * report has gone out); one asked for in a chat turn shares that turn's request id, so it is not counted twice. The
 * end-of-day send is the workspace's own (membership NULL) and counts towards nobody.
 */
export const LIMITED_PURPOSES: readonly UsagePurpose[] = ["chat", "plan", "report"];

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

export type Allowance = { ready: boolean; used: number; limit: number; remaining: number; resetsAt: string };

/**
 * Requests today: the distinct request ids of the person's rows for chat and the to-do planner since the organisation's
 * local midnight; `resetsAt` is the next local midnight. Before 0037 nothing is counted (`ready: false`).
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
      const r = await db.one<{ used: number }>(
        `SELECT count(DISTINCT request_id)::int AS used FROM ai_usage
         WHERE organisation_id = $1 AND membership_id = $2 AND purpose = ANY($3::text[]) AND created_at >= $4::timestamptz`,
        [ctx.org.id, ctx.membership.id, [...LIMITED_PURPOSES], localMidnight(today, tz).toISOString()]);
      return { ready: true, used: r.used, limit, remaining: Math.max(0, limit - r.used), resetsAt };
    });
  } catch (err) {
    if (!isMissingSchema(err)) throw err;
    forget0037();
    return none;
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
