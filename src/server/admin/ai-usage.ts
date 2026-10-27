/**
 * The Control Center's AI usage (owner request, 27 October 2026: "on the Control Center I want to see which company is
 * spending more tokens, how many AI bots, how many Brendas they have, so we can manage AI usage"). Every workspace runs on
 * Boredroom's own Claude and ElevenLabs keys since the same day, so Boredroom pays for all of it.
 *
 * Read from what is already recorded, nothing new:
 * - `ai_usage` (migration 0037): every Claude call made for a workspace, with the person it was for (NULL for the
 *   workspace's own jobs: the end-of-day report, commitments, call notes), its purpose, model and the API's token counts.
 *   One request (a chat turn, however many model calls) shares one request id.
 * - `voice_usage_daily` (0053): characters said aloud in a natural voice, per person per (the workspace's own) day.
 * - `look_usage_daily` (0057) and `act_usage_daily` (0058, 0060): Brenda for Mac's looks and tasks, per UTC day and model
 *   only, with no workspace and no person by the owner's decisions (11 and 12 October 2026: "the employer never sees it
 *   nor whether it is used"). They are shown for the whole platform only. A look's words (its picture's tokens taken
 *   out) and the front desk's router are also in the workspace's `ai_usage` as ordinary chat, so those overlap a little.
 * - Assistants ("Brendas"): every active member has their own, and each workspace has one of its own; `assistant_profiles`
 *   says who has set theirs up.
 *
 * Costs are estimates from lib/ai-pricing (list prices, one table). Each table is checked before it is read, so the page
 * works on a database without any of these migrations. One transaction per page, a handful of grouped statements: no
 * query per organisation (ai_usage is read through its (organisation_id, created_at) index for one workspace, and by
 * created_at across all of them).
 */
import { withSystem, type Db } from "@/server/db";
import { notFound } from "@/server/lib/errors";
import { estimateUsd, priceFor, type TokenCounts } from "@/lib/ai-pricing";
import type { UsagePurpose } from "@/server/services/ai-usage";

export const AI_PERIODS = [
  { value: "month", label: "This month" },
  { value: "30d", label: "Last 30 days" },
  { value: "7d", label: "Last 7 days" },
] as const;
export type AiPeriod = (typeof AI_PERIODS)[number]["value"];
export const isAiPeriod = (v: unknown): v is AiPeriod => AI_PERIODS.some((p) => p.value === v);

/** The period's start: the 1st of this month (UTC), or 30 or 7 days ago. `day`: its UTC date, for the daily tables. */
export function periodStart(period: AiPeriod, now = new Date()): { since: Date; day: string } {
  const since = period === "month"
    ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    : new Date(now.getTime() - (period === "7d" ? 7 : 30) * 86_400_000);
  return { since, day: since.toISOString().slice(0, 10) };
}

export type Tokens = TokenCounts & { totalTokens: number };
export type Usage = Tokens & { requests: number; calls: number; costUsd: number };
const ZERO: Usage = { requests: 0, calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, costUsd: 0 };

type SumRow = { calls: number | string; input_tokens: number | string; output_tokens: number | string; cache_read_tokens: number | string; cache_write_tokens: number | string };
const SUMS = `count(*)::int AS calls, COALESCE(sum(input_tokens), 0)::bigint AS input_tokens, COALESCE(sum(output_tokens), 0)::bigint AS output_tokens,
  COALESCE(sum(cache_read_tokens), 0)::bigint AS cache_read_tokens, COALESCE(sum(cache_write_tokens), 0)::bigint AS cache_write_tokens`;

function tokensOf(r: SumRow): Tokens {
  const t = { inputTokens: Number(r.input_tokens) || 0, outputTokens: Number(r.output_tokens) || 0, cacheReadTokens: Number(r.cache_read_tokens) || 0, cacheWriteTokens: Number(r.cache_write_tokens) || 0 };
  return { ...t, totalTokens: t.inputTokens + t.outputTokens + t.cacheReadTokens + t.cacheWriteTokens };
}

/** Adds one model's row (priced at that model) into a running total. */
function addModelRow(into: Usage, model: string, r: SumRow): Usage {
  const t = tokensOf(r);
  return {
    requests: into.requests, calls: into.calls + (Number(r.calls) || 0),
    inputTokens: into.inputTokens + t.inputTokens, outputTokens: into.outputTokens + t.outputTokens,
    cacheReadTokens: into.cacheReadTokens + t.cacheReadTokens, cacheWriteTokens: into.cacheWriteTokens + t.cacheWriteTokens,
    totalTokens: into.totalTokens + t.totalTokens, costUsd: into.costUsd + estimateUsd(model, t),
  };
}

function sumUsage(list: Usage[]): Usage {
  return list.reduce((a, u) => ({
    requests: a.requests + u.requests, calls: a.calls + u.calls, inputTokens: a.inputTokens + u.inputTokens, outputTokens: a.outputTokens + u.outputTokens,
    cacheReadTokens: a.cacheReadTokens + u.cacheReadTokens, cacheWriteTokens: a.cacheWriteTokens + u.cacheWriteTokens,
    totalTokens: a.totalTokens + u.totalTokens, costUsd: a.costUsd + u.costUsd,
  }), { ...ZERO });
}

type Ready = { ai: boolean; voice: boolean; looks: boolean; acts: boolean };
async function readyIn(db: Db): Promise<Ready> {
  const r = await db.one<{ ai: boolean; voice: boolean; looks: boolean; acts: boolean }>(
    `SELECT to_regclass('public.ai_usage') IS NOT NULL AS ai, to_regclass('public.voice_usage_daily') IS NOT NULL AS voice,
            to_regclass('public.look_usage_daily') IS NOT NULL AS looks, to_regclass('public.act_usage_daily') IS NOT NULL AS acts`);
  return { ai: !!r.ai, voice: !!r.voice, looks: !!r.looks, acts: !!r.acts };
}

/** A model the price table does not name (priced as a guess), for the page note. */
function unpricedOf(models: Iterable<string>): string[] {
  return [...new Set([...models].filter((m) => !priceFor(m).exact))].sort();
}

// ---- All organisations ---------------------------------------------------------------------------------------------------

export type OrgAiRow = Usage & {
  id: string; name: string; slug: string; status: string; plan: string | null;
  /** Active members: each has their own assistant. */ members: number;
  /** Members' assistants plus the workspace's own. */ assistants: number;
  /** Members who set theirs up (named it, chose its look). */ setUp: number;
  /** People with at least one request in the period. */ people: number;
  voiceCharacters: number; voiceUtterances: number;
};

export type MacUsage = {
  looks: { looks: number; steps: number; imageTokens: number } & Usage;
  tasks: { tasks: number; steps: number } & Usage;
  /** The front desk's router: also in the workspaces' chat rows. */
  router: { steps: number } & Usage;
};

export type AiUsageOverview = {
  period: AiPeriod; since: string; ready: Ready;
  totals: Usage & { orgsUsing: number; people: number; assistants: number; setUp: number; voiceCharacters: number; voiceUtterances: number };
  orgs: OrgAiRow[];
  byDay: { day: string; tokens: number; costUsd: number }[];
  mac: MacUsage | null;
  unpriced: string[];
};

export async function aiUsageOverview(period: AiPeriod, now = new Date()): Promise<AiUsageOverview> {
  const { since, day } = periodStart(period, now);
  return withSystem(async (db) => {
    const ready = await readyIn(db);
    const orgs = await db.query<{ id: string; name: string; slug: string; status: string; plan: string | null; members: number; set_up: number }>(
      `SELECT o.id, o.name, o.slug, o.status, p.name AS plan,
              (SELECT count(*)::int FROM memberships m WHERE m.organisation_id = o.id AND m.status = 'active') AS members,
              (SELECT count(*)::int FROM assistant_profiles ap JOIN memberships m ON m.id = ap.membership_id
                WHERE ap.organisation_id = o.id AND m.status = 'active' AND ap.setup_done_at IS NOT NULL) AS set_up
         FROM organisations o LEFT JOIN subscriptions s ON s.organisation_id = o.id LEFT JOIN plans p ON p.id = s.plan_id`);
    const byOrgModel = ready.ai ? await db.query<SumRow & { organisation_id: string; model: string }>(
      `SELECT organisation_id, model, ${SUMS} FROM ai_usage WHERE created_at >= $1 GROUP BY organisation_id, model`, [since]) : [];
    const byOrg = ready.ai ? await db.query<{ organisation_id: string; requests: number; people: number }>(
      `SELECT organisation_id, count(DISTINCT request_id)::int AS requests, count(DISTINCT membership_id)::int AS people
         FROM ai_usage WHERE created_at >= $1 GROUP BY organisation_id`, [since]) : [];
    const people = ready.ai ? (await db.one<{ n: number }>(`SELECT count(DISTINCT membership_id)::int AS n FROM ai_usage WHERE created_at >= $1`, [since])).n : 0;
    const byDayModel = ready.ai ? await db.query<SumRow & { day: string; model: string }>(
      `SELECT (created_at AT TIME ZONE 'UTC')::date::text AS day, model, ${SUMS} FROM ai_usage WHERE created_at >= $1 GROUP BY 1, 2`, [since]) : [];
    const voice = ready.voice ? await db.query<{ organisation_id: string; characters: number | string; utterances: number | string }>(
      `SELECT organisation_id, COALESCE(sum(characters), 0)::bigint AS characters, COALESCE(sum(utterances), 0)::bigint AS utterances
         FROM voice_usage_daily WHERE day >= $1::date GROUP BY organisation_id`, [day]) : [];
    const looks = ready.looks ? await db.query<SumRow & { model: string; looks: number | string; steps: number | string; image_tokens: number | string }>(
      `SELECT model, COALESCE(sum(looks), 0)::bigint AS looks, COALESCE(sum(steps), 0)::bigint AS steps, COALESCE(sum(image_tokens), 0)::bigint AS image_tokens,
              COALESCE(sum(steps), 0)::bigint AS calls, COALESCE(sum(input_tokens), 0)::bigint AS input_tokens, COALESCE(sum(output_tokens), 0)::bigint AS output_tokens,
              COALESCE(sum(cache_read_tokens), 0)::bigint AS cache_read_tokens, COALESCE(sum(cache_write_tokens), 0)::bigint AS cache_write_tokens
         FROM look_usage_daily WHERE day >= $1::date GROUP BY model`, [day]) : [];
    const acts = ready.acts ? await db.query<SumRow & { model: string; kind: string; tasks: number | string; steps: number | string }>(
      `SELECT model, kind, COALESCE(sum(tasks), 0)::bigint AS tasks, COALESCE(sum(steps), 0)::bigint AS steps,
              COALESCE(sum(steps), 0)::bigint AS calls, COALESCE(sum(input_tokens), 0)::bigint AS input_tokens, COALESCE(sum(output_tokens), 0)::bigint AS output_tokens,
              COALESCE(sum(cache_read_tokens), 0)::bigint AS cache_read_tokens, COALESCE(sum(cache_write_tokens), 0)::bigint AS cache_write_tokens
         FROM act_usage_daily WHERE day >= $1::date GROUP BY model, kind`, [day]) : [];

    const usageByOrg = new Map<string, Usage>();
    for (const r of byOrgModel) usageByOrg.set(r.organisation_id, addModelRow(usageByOrg.get(r.organisation_id) ?? { ...ZERO }, r.model, r));
    const reqByOrg = new Map(byOrg.map((r) => [r.organisation_id, r]));
    const voiceByOrg = new Map(voice.map((r) => [r.organisation_id, r]));
    const rows: OrgAiRow[] = orgs.map((o) => {
      const u = usageByOrg.get(o.id) ?? { ...ZERO };
      const q = reqByOrg.get(o.id);
      const v = voiceByOrg.get(o.id);
      return {
        ...u, requests: q?.requests ?? 0,
        id: o.id, name: o.name, slug: o.slug, status: o.status, plan: o.plan,
        members: o.members, assistants: o.members + 1, setUp: o.set_up, people: q?.people ?? 0,
        voiceCharacters: Number(v?.characters ?? 0), voiceUtterances: Number(v?.utterances ?? 0),
      };
    });
    rows.sort((a, b) => b.totalTokens - a.totalTokens || b.requests - a.requests || a.name.localeCompare(b.name));

    const dayMap = new Map<string, { tokens: number; costUsd: number }>();
    for (const r of byDayModel) {
      const t = tokensOf(r);
      const d = dayMap.get(r.day) ?? { tokens: 0, costUsd: 0 };
      dayMap.set(r.day, { tokens: d.tokens + t.totalTokens, costUsd: d.costUsd + estimateUsd(r.model, t) });
    }
    const byDay: AiUsageOverview["byDay"] = [];
    for (let d = new Date(`${day}T00:00:00Z`); d <= now; d = new Date(d.getTime() + 86_400_000)) {
      const k = d.toISOString().slice(0, 10);
      byDay.push({ day: k, ...(dayMap.get(k) ?? { tokens: 0, costUsd: 0 }) });
    }

    let mac: MacUsage | null = null;
    if (ready.looks || ready.acts) {
      let lookU: Usage = { ...ZERO }, taskU: Usage = { ...ZERO }, routerU: Usage = { ...ZERO };
      let nLooks = 0, lookSteps = 0, imageTokens = 0, nTasks = 0, taskSteps = 0, routerSteps = 0;
      for (const r of looks) { lookU = addModelRow(lookU, r.model, r); nLooks += Number(r.looks) || 0; lookSteps += Number(r.steps) || 0; imageTokens += Number(r.image_tokens) || 0; }
      for (const r of acts) {
        if (r.kind === "router") { routerU = addModelRow(routerU, r.model, r); routerSteps += Number(r.steps) || 0; continue; }
        taskU = addModelRow(taskU, r.model, r); nTasks += Number(r.tasks) || 0; taskSteps += Number(r.steps) || 0;
      }
      mac = {
        looks: { ...lookU, requests: nLooks, looks: nLooks, steps: lookSteps, imageTokens },
        tasks: { ...taskU, requests: nTasks, tasks: nTasks, steps: taskSteps },
        router: { ...routerU, requests: routerSteps, steps: routerSteps },
      };
    }

    const all = sumUsage(rows);
    return {
      period, since: since.toISOString(), ready,
      totals: {
        ...all, orgsUsing: rows.filter((r) => r.calls > 0).length, people,
        assistants: rows.reduce((n, r) => n + r.assistants, 0), setUp: rows.reduce((n, r) => n + r.setUp, 0),
        voiceCharacters: rows.reduce((n, r) => n + r.voiceCharacters, 0), voiceUtterances: rows.reduce((n, r) => n + r.voiceUtterances, 0),
      },
      orgs: rows, byDay, mac,
      unpriced: unpricedOf([...byOrgModel.map((r) => r.model), ...looks.map((r) => r.model), ...acts.map((r) => r.model)]),
    };
  });
}

// ---- One organisation ----------------------------------------------------------------------------------------------------

export type OrgAiDetail = {
  period: AiPeriod; since: string; ready: Ready;
  org: { id: string; name: string; slug: string; status: string; plan: string | null; members: number; assistants: number; setUp: number; workspaceAssistant: string };
  totals: Usage & { people: number; voiceCharacters: number; voiceUtterances: number; voicePeople: number };
  byPurpose: (Usage & { purpose: UsagePurpose })[];
  byModel: (Usage & { model: string; priced: string; exact: boolean })[];
  /** The people with the most requests (names only with `names`). */
  topPeople: (Usage & { membershipId: string; name: string | null; role: string | null })[];
  /** Rows with no person: the workspace's own jobs. */
  workspace: Usage;
  byDay: { day: string; tokens: number; costUsd: number }[];
  unpriced: string[];
};

export async function aiUsageForOrg(orgId: string, period: AiPeriod, opts: { names: boolean; top?: number }, now = new Date()): Promise<OrgAiDetail> {
  const { since, day } = periodStart(period, now);
  const top = Math.min(25, Math.max(1, opts.top ?? 10));
  return withSystem(async (db) => {
    const ready = await readyIn(db);
    const org = await db.maybeOne<{ id: string; name: string; slug: string; status: string; plan: string | null; members: number; set_up: number }>(
      `SELECT o.id, o.name, o.slug, o.status, p.name AS plan,
              (SELECT count(*)::int FROM memberships m WHERE m.organisation_id = o.id AND m.status = 'active') AS members,
              (SELECT count(*)::int FROM assistant_profiles ap JOIN memberships m ON m.id = ap.membership_id
                WHERE ap.organisation_id = o.id AND m.status = 'active' AND ap.setup_done_at IS NOT NULL) AS set_up
         FROM organisations o LEFT JOIN subscriptions s ON s.organisation_id = o.id LEFT JOIN plans p ON p.id = s.plan_id WHERE o.id = $1`, [orgId]);
    if (!org) throw notFound("Organisation not found.");
    const ws = await db.maybeOne<{ name: string | null }>(`SELECT assistant_name AS name FROM brenda_settings WHERE organisation_id = $1`, [orgId]);
    const params = [orgId, since];
    const byPurposeModel = ready.ai ? await db.query<SumRow & { purpose: UsagePurpose; model: string; requests: number }>(
      `SELECT purpose, model, count(DISTINCT request_id)::int AS requests, ${SUMS} FROM ai_usage WHERE organisation_id = $1 AND created_at >= $2 GROUP BY purpose, model`, params) : [];
    const purposeReq = ready.ai ? await db.query<{ purpose: UsagePurpose; requests: number }>(
      `SELECT purpose, count(DISTINCT request_id)::int AS requests FROM ai_usage WHERE organisation_id = $1 AND created_at >= $2 GROUP BY purpose`, params) : [];
    const overall = ready.ai ? await db.one<{ requests: number; people: number }>(
      `SELECT count(DISTINCT request_id)::int AS requests, count(DISTINCT membership_id)::int AS people FROM ai_usage WHERE organisation_id = $1 AND created_at >= $2`, params) : { requests: 0, people: 0 };
    const people = ready.ai ? await db.query<SumRow & { membership_id: string | null; model: string; requests: number }>(
      `SELECT membership_id, model, count(DISTINCT request_id)::int AS requests, ${SUMS} FROM ai_usage WHERE organisation_id = $1 AND created_at >= $2 GROUP BY membership_id, model`, params) : [];
    const byDayModel = ready.ai ? await db.query<SumRow & { day: string; model: string }>(
      `SELECT (created_at AT TIME ZONE 'UTC')::date::text AS day, model, ${SUMS} FROM ai_usage WHERE organisation_id = $1 AND created_at >= $2 GROUP BY 1, 2`, params) : [];
    const voice = ready.voice ? await db.one<{ characters: number | string; utterances: number | string; people: number }>(
      `SELECT COALESCE(sum(characters), 0)::bigint AS characters, COALESCE(sum(utterances), 0)::bigint AS utterances, count(DISTINCT membership_id) FILTER (WHERE characters > 0)::int AS people
         FROM voice_usage_daily WHERE organisation_id = $1 AND day >= $2::date`, [orgId, day]) : { characters: 0, utterances: 0, people: 0 };

    // By purpose: tokens and cost from the per-model rows, requests counted once per purpose.
    const purposeMap = new Map<UsagePurpose, Usage>();
    for (const r of byPurposeModel) purposeMap.set(r.purpose, addModelRow(purposeMap.get(r.purpose) ?? { ...ZERO }, r.model, r));
    const byPurpose = purposeReq.map((r) => ({ purpose: r.purpose, ...(purposeMap.get(r.purpose) ?? { ...ZERO }), requests: r.requests }))
      .sort((a, b) => b.totalTokens - a.totalTokens || b.requests - a.requests);

    const modelMap = new Map<string, Usage>();
    for (const r of byPurposeModel) {
      const m = addModelRow(modelMap.get(r.model) ?? { ...ZERO }, r.model, r);
      modelMap.set(r.model, { ...m, requests: m.requests + r.requests });
    }
    const byModel = [...modelMap.entries()].map(([model, u]) => { const p = priceFor(model); return { model, priced: p.as, exact: p.exact, ...u }; })
      .sort((a, b) => b.costUsd - a.costUsd);

    const personMap = new Map<string, Usage>();
    let workspace: Usage = { ...ZERO };
    for (const r of people) {
      if (!r.membership_id) { workspace = addModelRow({ ...workspace, requests: workspace.requests + r.requests }, r.model, r); continue; }
      const p = personMap.get(r.membership_id) ?? { ...ZERO };
      personMap.set(r.membership_id, addModelRow({ ...p, requests: p.requests + r.requests }, r.model, r));
    }
    const ranked = [...personMap.entries()].sort((a, b) => b[1].requests - a[1].requests || b[1].totalTokens - a[1].totalTokens).slice(0, top);
    const names = opts.names && ranked.length
      ? new Map((await db.query<{ id: string; name: string | null; role: string }>(
        `SELECT m.id, p.display_name AS name, m.role FROM memberships m LEFT JOIN profiles p ON p.id = m.user_id WHERE m.id = ANY($1::uuid[])`, [ranked.map(([id]) => id)])).map((r) => [r.id, r]))
      : new Map<string, { name: string | null; role: string }>();
    const topPeople = ranked.map(([membershipId, u]) => ({ membershipId, name: names.get(membershipId)?.name ?? null, role: names.get(membershipId)?.role ?? null, ...u }));

    const dayMap = new Map<string, { tokens: number; costUsd: number }>();
    for (const r of byDayModel) {
      const t = tokensOf(r);
      const d = dayMap.get(r.day) ?? { tokens: 0, costUsd: 0 };
      dayMap.set(r.day, { tokens: d.tokens + t.totalTokens, costUsd: d.costUsd + estimateUsd(r.model, t) });
    }
    const byDay: OrgAiDetail["byDay"] = [];
    for (let d = new Date(`${day}T00:00:00Z`); d <= now; d = new Date(d.getTime() + 86_400_000)) {
      const k = d.toISOString().slice(0, 10);
      byDay.push({ day: k, ...(dayMap.get(k) ?? { tokens: 0, costUsd: 0 }) });
    }

    const all = sumUsage(byPurpose.map((p) => ({ ...p, requests: 0 })));
    return {
      period, since: since.toISOString(), ready,
      org: { id: org.id, name: org.name, slug: org.slug, status: org.status, plan: org.plan, members: org.members, assistants: org.members + 1, setUp: org.set_up, workspaceAssistant: ws?.name || "Brenda" },
      totals: { ...all, requests: overall.requests, people: overall.people, voiceCharacters: Number(voice.characters), voiceUtterances: Number(voice.utterances), voicePeople: voice.people },
      byPurpose, byModel, topPeople, workspace, byDay,
      unpriced: unpricedOf(byPurposeModel.map((r) => r.model)),
    };
  });
}
