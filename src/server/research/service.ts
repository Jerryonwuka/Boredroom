/**
 * Brenda's research in the background, the person's side (owner decision, 28 October 2026: "Brenda, research X and give
 * me a PDF when you're done": she works in the background while the person carries on, then tells them).
 *
 * - Starting: the person's own explicit request is the permission (owner permission rule v2, 12 October 2026: research
 *   only reads the public web, so it is low-risk), so no Confirm. It is refused, in plain words, when Boredroom's switch
 *   is off (the Control Center's global flag BRENDA_RESEARCH, or BRENDA_RESEARCH=off in the environment), when the AI
 *   isn't connected, past the person's cap (BRENDA_RESEARCH_DAILY a day, 5 by default, from local midnight in the
 *   workspace's time zone; every report asked for counts, stopped or failed too, since they cost), and before 0066.
 *   The row and its `research.run` job are written in one transaction, under a per-person lock so two quick asks can't
 *   both slip under the cap.
 * - Listing, stopping and the files: the person's own rows only (row security: owners, HR and leads never read anyone's
 *   research). Someone else's id reads as not found.
 * - Queued means queued: nothing says "researching" before the worker has picked it up (the production worker is often
 *   stopped), and a report waiting more than ten minutes says the worker isn't running.
 * Server-only.
 */
import { withUser, type Db } from "@/server/db";
import type { OrgContext } from "@/server/lib/api";
import { AppError, notFound } from "@/server/lib/errors";
import { localMidnight, todayLocal } from "@/server/lib/time";
import { noteMissing0066, schema0066Missing } from "@/server/lib/schema-0066";
import { enqueueJob } from "@/server/services/common";
import { environmentAssistant } from "@/server/services/assistant";
import { renderReport, type ReportFile } from "@/server/research/files";
import { RESEARCH_LIMITS, RESEARCH_WORDS, fileNameOf, isResearchFormat, type ResearchFormat, type ResearchItem, type ResearchReport, type ResearchStatus } from "@/lib/research";

const W = RESEARCH_WORDS.brenda;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ResearchRefusal extends Error {
  constructor(readonly code: "RESEARCH_NOT_READY" | "RESEARCH_OFF" | "RESEARCH_NO_KEY" | "RESEARCH_CAP" | "RESEARCH_NOT_FOUND" | "RESEARCH_ENDED", message: string) { super(message); }
}

/** The person's daily cap (BRENDA_RESEARCH_DAILY, a whole number from 0 to 100; 5 when unset or not a number). */
export function researchDailyLimit(env: Record<string, string | undefined> = process.env): number {
  const raw = env.BRENDA_RESEARCH_DAILY?.trim();
  if (!raw || !/^\d{1,3}$/.test(raw)) return RESEARCH_LIMITS.dailyDefault;
  return Math.min(100, Number(raw));
}

/**
 * Whether research is switched on for Boredroom: BRENDA_RESEARCH=off (or false, 0, no) in the environment switches it off
 * everywhere; else the Control Center's global feature flag BRENDA_RESEARCH (Settings, Feature flags), on unless set off.
 * A settings read that fails counts as on (the environment still wins).
 */
export async function researchSwitchedOn(env: Record<string, string | undefined> = process.env): Promise<boolean> {
  if (/^(off|false|0|no)$/i.test(env.BRENDA_RESEARCH?.trim() ?? "")) return false;
  try {
    const { featureFlags } = await import("@/server/admin/settings");
    return (await featureFlags()).BRENDA_RESEARCH !== false;
  } catch { return true; }
}

type Row = {
  id: string; topic: string; focus: string | null; format: ResearchFormat; status: ResearchStatus; title: string | null; error: string | null;
  searches: number; sources_n: number; created_at: string; started_at: string | null; finished_at: string | null;
};
const COLS = `id, topic, focus, format, status, title, error, searches, jsonb_array_length(sources)::int AS sources_n, created_at, started_at, finished_at`;
const itemOf = (r: Row): ResearchItem => ({
  id: r.id, topic: r.topic, focus: r.focus, format: r.format, status: r.status, title: r.title, error: r.error,
  searches: Number(r.searches) || 0, sources: Number(r.sources_n) || 0,
  createdAt: new Date(r.created_at).toISOString(), startedAt: r.started_at ? new Date(r.started_at).toISOString() : null, finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null,
});

/** Runs `fn` as the person; 0066 missing becomes RESEARCH_NOT_READY (and is noted). Refuses at once while noted. */
async function asPerson<T>(ctx: OrgContext, fn: (db: Db) => Promise<T>): Promise<T> {
  if (schema0066Missing()) throw new ResearchRefusal("RESEARCH_NOT_READY", W.notReady);
  try {
    return await withUser(ctx.user.profileId, fn);
  } catch (err) {
    if (noteMissing0066(err)) throw new ResearchRefusal("RESEARCH_NOT_READY", W.notReady);
    throw err;
  }
}

const clean = (s: unknown, max: number) => (typeof s === "string" ? s.replace(/[\p{Cc}\u2028\u2029]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");

/** How many reports the person asked for today (from local midnight in the workspace's time zone). */
async function countToday(db: Db, ctx: OrgContext, now: Date): Promise<number> {
  const since = localMidnight(todayLocal(ctx.org.timezone, now), ctx.org.timezone).toISOString();
  const r = await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM research_reports WHERE membership_id = $1 AND organisation_id = $2 AND created_at >= $3::timestamptz`, [ctx.membership.id, ctx.org.id, since]);
  return r.n;
}

export type StartInput = { topic: string; focus?: string | null; format?: ResearchFormat | null };

/**
 * Starts a piece of research for the person: the row (queued) and its first job, in one transaction. Throws a
 * ResearchRefusal with Brenda's words when it may not start.
 */
export async function startResearch(ctx: OrgContext, input: StartInput, o: { now?: Date } = {}): Promise<ResearchItem> {
  const topic = clean(input.topic, RESEARCH_LIMITS.topic);
  if (!topic) throw new AppError(422, "INVALID_INPUT", "Say what to research.");
  const focus = clean(input.focus, RESEARCH_LIMITS.focus) || null;
  const format: ResearchFormat = isResearchFormat(input.format) ? input.format : "docx";
  if (!(await researchSwitchedOn())) throw new ResearchRefusal("RESEARCH_OFF", W.off);
  if (!environmentAssistant()) throw new ResearchRefusal("RESEARCH_NO_KEY", W.noKey);
  const limit = researchDailyLimit();
  const now = o.now ?? new Date();
  return asPerson(ctx, async (db) => {
    await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`research:${ctx.membership.id}`]);
    if ((await countToday(db, ctx, now)) >= limit) throw new ResearchRefusal("RESEARCH_CAP", W.cap(limit));
    const row = await db.one<Row>(
      `INSERT INTO research_reports(organisation_id, membership_id, topic, focus, format) VALUES ($1, $2, $3, $4, $5) RETURNING ${COLS}`,
      [ctx.org.id, ctx.membership.id, topic, focus, format]);
    await enqueueJob(db, "research.run", { id: row.id, step: 0 }, { dedupKey: `research.run:${row.id}:0` });
    return itemOf(row);
  });
}

/** The person's research, newest first (at most 50). Before 0066: `{ ready: false, reports: [] }`. */
export async function listResearch(ctx: OrgContext): Promise<{ ready: boolean; reports: ResearchItem[] }> {
  try {
    return await asPerson(ctx, async (db) => ({
      ready: true,
      reports: (await db.query<Row>(`SELECT ${COLS} FROM research_reports WHERE membership_id = $1 AND organisation_id = $2 ORDER BY created_at DESC LIMIT ${RESEARCH_LIMITS.listMax}`, [ctx.membership.id, ctx.org.id])).map(itemOf),
    }));
  } catch (err) {
    if (err instanceof ResearchRefusal && err.code === "RESEARCH_NOT_READY") return { ready: false, reports: [] };
    throw err;
  }
}

/** Stops one of the person's queued or running reports. Their own only; an ended one says so. */
export async function stopResearch(ctx: OrgContext, id: string): Promise<ResearchItem> {
  if (!UUID.test(id)) throw new ResearchRefusal("RESEARCH_NOT_FOUND", W.notFound);
  return asPerson(ctx, async (db) => {
    const row = await db.maybeOne<Row>(
      `UPDATE research_reports SET status = 'stopped', finished_at = now(), progress = NULL
       WHERE id = $1 AND membership_id = $2 AND organisation_id = $3 AND status IN ('queued', 'running') RETURNING ${COLS}`, [id, ctx.membership.id, ctx.org.id]);
    if (row) return itemOf(row);
    const exists = await db.maybeOne<{ id: string }>(`SELECT id FROM research_reports WHERE id = $1 AND membership_id = $2 AND organisation_id = $3`, [id, ctx.membership.id, ctx.org.id]);
    throw exists ? new ResearchRefusal("RESEARCH_ENDED", W.alreadyEnded) : new ResearchRefusal("RESEARCH_NOT_FOUND", W.notFound);
  });
}

/** The person's finished report as a file in `format`, with its download name. 404 for anything else. */
export async function researchFile(ctx: OrgContext, id: string, format: ResearchFormat): Promise<ReportFile & { fileName: string }> {
  if (!UUID.test(id)) throw notFound();
  let row: { report: ResearchReport | null; markdown: string | null; title: string | null; status: ResearchStatus } | null;
  try {
    row = await asPerson(ctx, (db) => db.maybeOne(
      `SELECT report, markdown, title, status FROM research_reports WHERE id = $1 AND membership_id = $2 AND organisation_id = $3`, [id, ctx.membership.id, ctx.org.id]));
  } catch (err) {
    if (err instanceof ResearchRefusal) throw notFound();
    throw err;
  }
  if (!row || row.status !== "done" || !row.report || !row.markdown) throw notFound();
  const file = await renderReport(row.report, row.markdown, format, ctx.org.timezone);
  return { ...file, fileName: fileNameOf(row.title || row.report.title, format) };
}

/** A queued report waiting longer than this reads as "the worker isn't running". */
export const QUEUED_SLOW_MS = 10 * 60_000;
