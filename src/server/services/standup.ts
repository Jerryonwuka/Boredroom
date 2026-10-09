/**
 * Async standup, option B (owner decisions, 8–9 October 2026: phase 7c, "Brenda keeps the loops closed", third part).
 * This file is the data and server side (contract B): a team's settings (switched on per team by its lead, the owner or
 * HR; off for every team until then), the team's day (opened at the post time, one draft per eligible member, closed at
 * the cutoff with the lead's one rollup), the person's own steps on their draft (edit, post, skip, undo the skip, seen),
 * the worker's hooks (claim, save and fail a draft; gather and send the rollup; the sweep that finishes anything a lost
 * job left; what the scheduler queues) and the reads her page, the chat, the notch and the report use.
 *
 * What a draft says is services/standup-compose (gathered as the person, under their own row-level security; the
 * worker never reads facts). The words and shapes are lib/standup.
 *
 * The rules (owner decisions, 8–9 October 2026):
 * - Drafts are private to the person: only they read their entry (migration 0050), their lead never reads a draft; the
 *   rollup is built by the worker from what was POSTED (the person's approved Blocked words), never from a draft.
 * - Posting always needs the person's own press (a broadcast to the team channel: the act-mode floor): `postStandup` is
 *   only ever called by their route (the card, the notch) or their confirmed chat card. It posts their approved words as
 *   theirs, sent by their assistant ('via_assistant'), with no mentions. A second press, a retried request or the notch
 *   without an Idempotency-Key reads the first post (`already: true`): the entry's row lock makes the second wait.
 * - The rollup lists who has no update in one neutral, alphabetical list, never the reason (a skip and silence read the
 *   same), and nobody is ever chased: one notification per draft, no second nudge.
 * - Notices respect quiet hours by arriving after them (`notify_at`); her page shows the card at once.
 * - The old Fly.io worker kills job types it does not know; every job here is idempotent and re-derivable from the
 *   tables, and the sweep (`sweepStandups`) opens, drafts, sends and releases whatever a lost job left.
 *
 * Before migration 0050 every read is empty with `ready: false`, every change answers 503 NOT_READY and the worker's
 * hooks return at once (server/lib/schema-0050).
 */
import { z } from "zod";
import { withUser, withWorker, type Db } from "@/server/db";
import type { OrgContext } from "@/server/lib/api";
import { AppError, conflict, forbidden, notFound } from "@/server/lib/errors";
import { forget0050, isMissingSchema, retryWithout0050, schema0050Ready } from "@/server/lib/schema-0050";
import { memberContext } from "@/server/lib/member-context";
import { addDays, localDate as localDateOf, localMidnight, localTimeOn, weekdayOf } from "@/server/lib/time";
import { audit, enqueueJob, notify } from "@/server/services/common";
import { recordAction } from "@/server/services/brenda";
import { quietStateFor } from "@/server/services/routines";
import { abilitiesIn } from "@/server/services/abilities";
import { preferencesForWorker } from "@/server/services/preferences";
import { insertViaAssistantIn } from "@/server/services/messaging";
import { readPersonalAssistant } from "@/server/services/assistant-profile";
import { ABILITY_WORDS } from "@/lib/abilities";
import { evidenceHref } from "@/lib/evidence-links";
import { firstName } from "@/lib/follow-ups";
import {
  STANDUP_DEFAULTS, STANDUP_LIMITS as L, STANDUP_NOT_READY_SHORT, STANDUP_SECTIONS, STANDUP_WORDS as W,
  cleanSection, clockOf, rollupNoticeBody, standupDateLabel, standupEntryHref, standupPostBody, standupRollupHref, standupSinceLabel,
  type DesktopStandup, type StandupBlocker, type StandupDraft, type StandupEntryView, type StandupRollupContent, type StandupRollupView,
  type StandupSection, type StandupSettingsView, type StandupStatus, type StandupTexts, type StandupToday,
} from "@/lib/standup";

// ---- Shared shapes (contract B.10) ---------------------------------------------------------------------------------------

/** One claimed draft, for the brain's composeStandup: the person's own context (`sessionId` "standup") and the window. */
export type StandupClaim = {
  entryId: string; ctx: OrgContext; team: { id: string; name: string; projectIds: string[] /* this team's working project */ };
  localDate: string; dateLabel: string; sinceLabel: string; window: { since: string; until: string }; timeZone: string; preferences: string[];
};
export type StandupComposed = { draft: StandupDraft; texts: StandupTexts; blockers: StandupBlocker[]; engine: "template" | "claude"; usedModel: boolean };
export type RollupInput = {
  rollupId: string; organisationId: string; slug: string; team: { id: string; name: string }; localDate: string; dateLabel: string; cutoffAt: string; timeZone: string;
  members: { membershipId: string; name: string }[];
  entries: { membershipId: string; name: string; status: StandupStatus; postedAt: string | null; messageId: string | null; conversationId: string | null; blockedText: string | null; blockers: StandupBlocker[] }[];
  recipients: string[];
};

// ---- Small helpers ------------------------------------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const notReady = () => new AppError(503, "NOT_READY", STANDUP_NOT_READY_SHORT);
const notYours = () => notFound(W.errors.notFound);
const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`);
const oneLine = (s: unknown) => String(s ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
const iso = (d: Date) => d.toISOString();
const minutesOf = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const warn = (what: string) => (err: unknown) => console.warn(`[standup] ${what}: ${(err as Error)?.message ?? String(err)}`);
const bad = (field: string, message: string) => new AppError(400, "INVALID_INPUT", message, { fieldErrors: { [field]: [message] } });

/** The next minute's key, for the sweep job's dedup. */
const minuteKey = (now: Date) => now.toISOString().slice(0, 16);

/** A read as the worker: `fallback` before 0050 (and on the fallback path after a restore). */
async function inWorker<T>(fallback: T, fn: (db: Db) => Promise<T>): Promise<T> {
  try {
    return await retryWithout0050(() => withWorker(async (db) => ((await schema0050Ready(db)) ? fn(db) : fallback)));
  } catch (err) {
    if (!isMissingSchema(err)) throw err;
    forget0050();
    return fallback;
  }
}

/** A read as the person: `fallback` before 0050, never a broken page. */
async function personRead<T>(ctx: OrgContext, fallback: T, fn: (db: Db) => Promise<T>): Promise<T> {
  try {
    return await retryWithout0050(() => withUser(ctx.user.profileId, async (db) => ((await schema0050Ready(db)) ? fn(db) : fallback)));
  } catch (err) {
    if (!isMissingSchema(err)) throw err;
    forget0050();
    return fallback;
  }
}

/** A change as the person: 503 before 0050. */
async function personTx<T>(ctx: OrgContext, fn: (db: Db) => Promise<T>): Promise<T> {
  try {
    return await retryWithout0050(() => withUser(ctx.user.profileId, async (db) => {
      if (!(await schema0050Ready(db))) throw notReady();
      return fn(db);
    }));
  } catch (err) {
    if (isMissingSchema(err)) { forget0050(); throw notReady(); }
    throw err;
  }
}

/** Refused while an administrator is signed in as the person (support): "Only Olu can post their own standup." */
function onlyThePerson(ctx: OrgContext) {
  if (ctx.user.impersonation) throw forbidden(W.errors.onlyPerson(firstName(ctx.user.displayName)));
}

/** Whether the workspace offers standup (brenda_settings.abilities_off), in the caller's transaction. */
async function workspaceOffers(db: Db, orgId: string): Promise<boolean> {
  return !(await abilitiesIn(db, orgId, null)).workspaceOff.includes("standup");
}

/** 409 STANDUP_OFF in the workspace's words (ABILITY_WORDS.refusal). */
const workspaceOff = () => conflict("STANDUP_OFF", ABILITY_WORDS.refusal("Standup", "workspace", ""));

/** The notices an entry sent its person: "Your standup for Design is ready" and "… couldn't be drafted". */
const entryNoticeKeys = (id: string) => [`standup.draft:${id}`, `standup.failed:${id}`];

/**
 * Marks the person's own standup notices read in their transaction, once they acted (posted, skipped, opened the card)
 * or opened their rollup, as every phase 7b flow does: nothing lingers in the bell, and a notch that had not shown it
 * yet never pops it later (fix review, 9 October 2026).
 */
async function readNotices(db: Db, membershipId: string, keys: string[]): Promise<void> {
  await db.query(`UPDATE notifications SET read_at = now() WHERE recipient_membership_id = $1 AND deduplication_key = ANY($2::text[]) AND read_at IS NULL`,
    [membershipId, keys]);
}

let noticesFn: boolean | null = null;
/**
 * The worker's side of the same (entries the day closed or called off): migration 0051's definer function, since the
 * worker cannot update a person's notifications; before 0051 nothing happens (the card says the day passed).
 */
async function workerReadNotices(db: Db, entryIds: string[]): Promise<void> {
  if (!entryIds.length) return;
  if (noticesFn === null) noticesFn = !!(await db.one<{ ok: boolean }>(`SELECT to_regprocedure('public.app_standup_notices_read(uuid[])') IS NOT NULL AS ok`)).ok;
  if (!noticesFn) return;
  await db.query(`SELECT app_standup_notices_read($1::uuid[])`, [entryIds]);
}

/** The standup day before `date` among `days` (Monday's is Friday for Monday to Friday); a week back at most. */
export function previousStandupDay(date: string, days: readonly number[]): string {
  for (let i = 1; i <= 7; i++) {
    const d = addDays(date, -i);
    if (days.includes(weekdayOf(d))) return d;
  }
  return addDays(date, -1);
}

const daysOf = (v: unknown): number[] => {
  const d = Array.isArray(v) ? v.map(Number).filter((x) => Number.isInteger(x) && x >= 0 && x <= 6) : [];
  return d.length ? [...new Set(d)].sort((a, b) => a - b) : [...STANDUP_DEFAULTS.days];
};

/** A blocker as stored: the four fields, clipped; at most 20. */
function blockersOf(v: unknown): StandupBlocker[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, L.blockersMax).flatMap((b): StandupBlocker[] => {
    if (!b || typeof b !== "object") return [];
    const o = b as Record<string, unknown>;
    const title = clip(oneLine(o.title), 200);
    return [{ taskId: isUuid(o.taskId) ? o.taskId : null, title, onMembershipId: isUuid(o.onMembershipId) ? o.onMembershipId : null, onName: o.onName ? clip(oneLine(o.onName), 120) : null }];
  });
}

/** A stored draft, or null when it is not one. */
function draftOf(v: unknown): StandupDraft | null {
  if (!v || typeof v !== "object") return null;
  const d = v as StandupDraft;
  if (d.v !== 1 || !d.sections || typeof d.sections !== "object") return null;
  for (const s of STANDUP_SECTIONS) if (!Array.isArray(d.sections[s])) return null;
  return d;
}

/** The team's rollup recipients now: its active leads; else whoever switched it on, while they are the owner or HR and active. */
async function recipientsIn(db: Db, teamId: string): Promise<{ membershipId: string; name: string }[]> {
  const leads = await db.query<{ membership_id: string; name: string }>(
    `SELECT tm.membership_id, p.display_name AS name FROM team_members tm
     JOIN memberships m ON m.id = tm.membership_id AND m.status = 'active' JOIN profiles p ON p.id = m.user_id
     WHERE tm.team_id = $1 AND tm.is_manager ORDER BY p.display_name, tm.membership_id`, [teamId]);
  if (leads.length) return leads.map((r) => ({ membershipId: r.membership_id, name: r.name }));
  const by = await db.maybeOne<{ membership_id: string; name: string }>(
    `SELECT m.id AS membership_id, p.display_name AS name FROM team_standups s
     JOIN memberships m ON m.id = s.enabled_by AND m.status = 'active' AND m.role IN ('owner', 'hr') JOIN profiles p ON p.id = m.user_id
     WHERE s.team_id = $1`, [teamId]);
  return by ? [{ membershipId: by.membership_id, name: by.name }] : [];
}

/**
 * The team's members who get a draft (B.1): active, staff or a team lead (owners and HR hold no tasks), with their
 * personal switch. Someone with an authorised day off on `localDate` (workday_exemptions, as the daily report leaves
 * them out) gets no draft and is not counted in that day's rollup (fix review, 9 October 2026).
 */
async function eligibleIn(db: Db, teamId: string, localDate: string): Promise<{ membershipId: string; name: string; personalOff: boolean }[]> {
  const rows = await db.query<{ membership_id: string; name: string; personal_off: boolean }>(
    `SELECT tm.membership_id, p.display_name AS name, COALESCE('standup' = ANY(ap.abilities_off), false) AS personal_off
     FROM team_members tm
     JOIN memberships m ON m.id = tm.membership_id AND m.status = 'active' AND m.role IN ('employee', 'manager')
     JOIN profiles p ON p.id = m.user_id
     LEFT JOIN assistant_private ap ON ap.membership_id = tm.membership_id
     WHERE tm.team_id = $1 AND NOT EXISTS (SELECT 1 FROM workday_exemptions x WHERE x.membership_id = tm.membership_id AND x.local_date = $2::date)
     ORDER BY p.display_name, tm.membership_id`, [teamId, localDate]);
  return rows.map((r) => ({ membershipId: r.membership_id, name: r.name, personalOff: r.personal_off }));
}

// ---- Team settings (contract B.1, F.2) ----------------------------------------------------------------------------------

export const standupSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  time: z.string().regex(TIME, W.errors.time).optional(),
  cutoff: z.string().regex(TIME, W.errors.time).optional(),
  days: z.array(z.number().int().min(0).max(6)).min(1, W.errors.days).max(7, W.errors.days).optional(),
});
export type StandupSettingsPatch = z.infer<typeof standupSettingsSchema>;
export const STANDUP_BODY_MAX = 8192;

type SettingsRow = { enabled: boolean; post_time: string; cutoff_time: string; days: number[]; updated_at: string | null; enabled_by: string | null };

/** The team as the caller reads it, or 404. */
async function teamFor(db: Db, ctx: OrgContext, teamId: string): Promise<{ id: string; name: string; archived: boolean }> {
  if (!isUuid(teamId)) throw notFound(W.errors.teamNotFound);
  const t = await db.maybeOne<{ id: string; name: string; archived: boolean }>(
    `SELECT id, name, archived_at IS NOT NULL AS archived FROM teams WHERE id = $1 AND organisation_id = $2`, [teamId, ctx.org.id]);
  if (!t) throw notFound(W.errors.teamNotFound);
  return t;
}

/** Whether the caller may change this team's standup without 0050's function: the owner and HR, or a lead of the team. */
async function canManageByRole(db: Db, ctx: OrgContext, teamId: string): Promise<boolean> {
  if (ctx.membership.role === "owner" || ctx.membership.role === "hr") return true;
  return !!(await db.maybeOne(`SELECT 1 FROM team_members WHERE team_id = $1 AND membership_id = $2 AND is_manager`, [teamId, ctx.membership.id]));
}

async function settingsIn(db: Db, ctx: OrgContext, teamId: string): Promise<StandupSettingsView> {
  const team = await teamFor(db, ctx, teamId);
  const ready = await schema0050Ready(db);
  const base = { teamId: team.id, teamName: team.name, timeZone: ctx.org.timezone };
  if (!ready) {
    const lead = await canManageByRole(db, ctx, team.id);
    const leads = await db.query<{ name: string }>(
      `SELECT p.display_name AS name FROM team_members tm JOIN memberships m ON m.id = tm.membership_id AND m.status = 'active' JOIN profiles p ON p.id = m.user_id
       WHERE tm.team_id = $1 AND tm.is_manager ORDER BY p.display_name`, [team.id]);
    return {
      ready: false, ...base, enabled: false, time: STANDUP_DEFAULTS.time, cutoff: STANDUP_DEFAULTS.cutoff, days: [...STANDUP_DEFAULTS.days],
      canEdit: lead && !team.archived, offered: true, leads: leads.map((l) => l.name), noLead: !leads.length, updatedAt: null,
    };
  }
  const s = await db.maybeOne<SettingsRow>(
    `SELECT enabled, to_char(post_time, 'HH24:MI') AS post_time, to_char(cutoff_time, 'HH24:MI') AS cutoff_time, days, updated_at, enabled_by
     FROM team_standups WHERE team_id = $1`, [team.id]);
  const can = await db.one<{ ok: boolean }>(`SELECT app_standup_can_manage($1) AS ok`, [team.id]);
  const recipients = await recipientsIn(db, team.id);
  return {
    ready: true, ...base, enabled: !!s?.enabled, time: s?.post_time ?? STANDUP_DEFAULTS.time, cutoff: s?.cutoff_time ?? STANDUP_DEFAULTS.cutoff,
    days: daysOf(s?.days), canEdit: can.ok, offered: await workspaceOffers(db, ctx.org.id), leads: recipients.map((r) => r.name), noLead: !recipients.length,
    updatedAt: s?.updated_at ?? null,
  };
}

/** A team's standup settings as the caller reads them (every member may). 404 when the team is not one of theirs. */
export async function standupSettings(ctx: OrgContext, teamId: string): Promise<StandupSettingsView> {
  try {
    return await retryWithout0050(() => withUser(ctx.user.profileId, (db) => settingsIn(db, ctx, teamId)));
  } catch (err) {
    if (!isMissingSchema(err)) throw err;
    forget0050();
    return withUser(ctx.user.profileId, (db) => settingsIn(db, ctx, teamId));
  }
}

/**
 * Changes a team's standup (its lead, the owner or HR; `app_standup_can_manage`): on or off, the post time, the cutoff
 * (at least 30 minutes after) and the days, on the organisation's clock. Switching it on while the workspace does not
 * offer standup answers 409 STANDUP_NOT_OFFERED; it records who switched it on (the rollup's recipient when the team has
 * no lead). Switching it off ends today's standup at once (drafts cancelled, the open rollup skipped). 403 for anyone
 * else and while someone else is signed in as the person; 400 for the fields; 503 before 0050.
 */
export async function saveStandupSettings(ctx: OrgContext, teamId: string, raw: StandupSettingsPatch): Promise<StandupSettingsView> {
  if (ctx.user.impersonation) throw forbidden(W.errors.forbidden);
  const r = standupSettingsSchema.safeParse(raw);
  if (!r.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of r.error.issues) (fieldErrors[issue.path.join(".") || "_"] ??= []).push(issue.message);
    throw new AppError(400, "INVALID_INPUT", Object.values(fieldErrors)[0]?.[0] ?? "Check the highlighted fields.", { fieldErrors });
  }
  const p = r.data;
  let turnedOff = false;
  await personTx(ctx, async (db) => {
    const team = await teamFor(db, ctx, teamId);
    const can = await db.one<{ ok: boolean }>(`SELECT app_standup_can_manage($1) AS ok`, [team.id]);
    if (!can.ok) throw forbidden(W.errors.forbidden);
    await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`team_standups:${team.id}`]);
    const old = await db.maybeOne<SettingsRow>(
      `SELECT enabled, to_char(post_time, 'HH24:MI') AS post_time, to_char(cutoff_time, 'HH24:MI') AS cutoff_time, days, updated_at, enabled_by
       FROM team_standups WHERE team_id = $1 FOR UPDATE`, [team.id]);
    const enabled = p.enabled ?? old?.enabled ?? false;
    const time = p.time ?? old?.post_time ?? STANDUP_DEFAULTS.time;
    const cutoff = p.cutoff ?? old?.cutoff_time ?? STANDUP_DEFAULTS.cutoff;
    const days = p.days ? [...new Set(p.days)].sort((a, b) => a - b) : daysOf(old?.days);
    if (minutesOf(cutoff) - minutesOf(time) < L.minGapMinutes) throw bad("cutoff", W.errors.gap);
    if (!days.length || days.length > 7) throw bad("days", W.errors.days);
    const enabling = enabled && !old?.enabled;
    if (enabling && !(await workspaceOffers(db, ctx.org.id))) throw conflict("STANDUP_NOT_OFFERED", W.errors.notOffered);
    turnedOff = !enabled && !!old?.enabled;
    await db.query(
      `INSERT INTO team_standups(team_id, organisation_id, enabled, post_time, cutoff_time, days, enabled_by, enabled_at, updated_by)
       VALUES ($1, $2, $3, $4::time, $5::time, $6::smallint[], CASE WHEN $3 THEN $7::uuid END, CASE WHEN $3 THEN now() END, $7)
       ON CONFLICT (team_id) DO UPDATE SET enabled = $3, post_time = $4::time, cutoff_time = $5::time, days = $6::smallint[],
         enabled_by = CASE WHEN $8 THEN $7::uuid ELSE team_standups.enabled_by END,
         enabled_at = CASE WHEN $8 THEN now() ELSE team_standups.enabled_at END, updated_by = $7`,
      [team.id, ctx.org.id, enabled, time, cutoff, days, ctx.membership.id, enabling]);
    if (enabling || turnedOff || p.time || p.cutoff || p.days) {
      await audit(db, {
        organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "standup.settings_changed", subjectType: "team", subjectId: team.id,
        metadata: { enabled, time, cutoff, days },
      });
    }
  });
  if (turnedOff) await cancelStandupDay(teamId, localDateOf(new Date(), ctx.org.timezone)).catch(warn("ending today's standup"));
  else if (p.cutoff) await moveTodaysCutoff(teamId).catch(warn("moving today's rollup"));
  return standupSettings(ctx, teamId);
}

/**
 * A new rollup time moves today's open rollup too, while the new time is still ahead and at least 30 minutes after the
 * day's post time (fix review, 9 October 2026: the tab said 11:58 while today's rollup still went at 10:58); a time
 * already past leaves today as it was. As the worker (only it writes rollups); the scheduler moves the pending job.
 */
async function moveTodaysCutoff(teamId: string, now = new Date()): Promise<void> {
  await inWorker(undefined, async (db) => {
    const s = await db.maybeOne<{ cutoff_time: string; timezone: string }>(
      `SELECT to_char(s.cutoff_time, 'HH24:MI') AS cutoff_time, o.timezone FROM team_standups s JOIN organisations o ON o.id = s.organisation_id
       WHERE s.team_id = $1 AND s.enabled`, [teamId]);
    if (!s) return;
    const date = localDateOf(now, s.timezone);
    const r = await db.maybeOne<{ id: string; post_at: string; cutoff_at: string }>(
      `SELECT id, post_at, cutoff_at FROM standup_rollups WHERE team_id = $1 AND local_date = $2 AND status = 'open' FOR UPDATE`, [teamId, date]);
    if (!r) return;
    const cutoff = localTimeOn(date, s.cutoff_time, s.timezone);
    if (cutoff.getTime() === Date.parse(r.cutoff_at) || cutoff.getTime() <= now.getTime()) return;
    if (cutoff.getTime() - Date.parse(r.post_at) < L.minGapMinutes * 60_000) return;
    await db.query(`UPDATE standup_rollups SET cutoff_at = $2::timestamptz WHERE id = $1 AND status = 'open'`, [r.id, iso(cutoff)]);
  });
}

// ---- The team's day (contract B.2) ----------------------------------------------------------------------------------------

type DayRow = {
  team_id: string; organisation_id: string; enabled: boolean; post_time: string; cutoff_time: string; days: number[];
  team_name: string; archived: boolean; org_status: string; timezone: string; slug: string;
};
const DAY_SQL = `SELECT s.team_id, s.organisation_id, s.enabled, to_char(s.post_time, 'HH24:MI') AS post_time, to_char(s.cutoff_time, 'HH24:MI') AS cutoff_time,
         s.days, t.name AS team_name, t.archived_at IS NOT NULL AS archived, o.status AS org_status, o.timezone, o.slug
  FROM team_standups s JOIN teams t ON t.id = s.team_id JOIN organisations o ON o.id = s.organisation_id`;

/**
 * Opens a team's standup day (job `standup.open` or the sweep), in one worker transaction holding the settings row;
 * idempotent. Off (switched off, team archived, workspace not active or not offering standup, the weekday not one of its
 * days, or before the post time): nothing written. Past the cutoff: the day is recorded as missed (a day is never
 * drafted late after downtime). Else the day's rollup row and, with it, one 'drafting' entry per eligible member (B.1);
 * opened again, nothing is added (someone who joined since gets none). Returns the entries still to draft (no live
 * lease) and the rollup's id.
 */
export async function openStandupDay(teamId: string, localDate: string, now = new Date()): Promise<{ status: "opened" | "exists" | "off" | "missed"; entryIds: string[]; rollupId: string | null }> {
  const off = { status: "off" as const, entryIds: [], rollupId: null };
  if (!isUuid(teamId) || !DATE.test(localDate)) return off;
  return inWorker<{ status: "opened" | "exists" | "off" | "missed"; entryIds: string[]; rollupId: string | null }>(off, async (db) => {
    const s = await db.maybeOne<DayRow>(`${DAY_SQL} WHERE s.team_id = $1 FOR UPDATE OF s`, [teamId]);
    if (!s || !s.enabled || s.archived || s.org_status !== "active" || !daysOf(s.days).includes(weekdayOf(localDate))) return off;
    if (!(await workspaceOffers(db, s.organisation_id))) return off;
    const postAt = localTimeOn(localDate, s.post_time, s.timezone);
    const cutoffAt = localTimeOn(localDate, s.cutoff_time, s.timezone);
    // A job queued for an older post time (the lead moved it later): not yet; the right one comes at the new time.
    if (now.getTime() < postAt.getTime() - 60_000) return off;
    if (now.getTime() >= cutoffAt.getTime()) {
      const missed = await db.maybeOne<{ id: string }>(
        `INSERT INTO standup_rollups(organisation_id, team_id, local_date, post_at, cutoff_at, status, reason)
         VALUES ($1, $2, $3, $4, $5, 'skipped', 'missed') ON CONFLICT ON CONSTRAINT standup_rollups_one DO NOTHING RETURNING id`,
        [s.organisation_id, s.team_id, localDate, iso(postAt), iso(cutoffAt)]);
      const row = missed ?? await db.maybeOne<{ id: string }>(`SELECT id FROM standup_rollups WHERE team_id = $1 AND local_date = $2`, [s.team_id, localDate]);
      return { status: "missed", entryIds: [], rollupId: row?.id ?? null };
    }
    const inserted = await db.maybeOne<{ id: string }>(
      `INSERT INTO standup_rollups(organisation_id, team_id, local_date, post_at, cutoff_at) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT ON CONSTRAINT standup_rollups_one DO NOTHING RETURNING id`,
      [s.organisation_id, s.team_id, localDate, iso(postAt), iso(cutoffAt)]);
    const rollup = await db.one<{ id: string; status: string }>(`SELECT id, status FROM standup_rollups WHERE team_id = $1 AND local_date = $2`, [s.team_id, localDate]);
    if (rollup.status !== "open") return { status: "exists", entryIds: [], rollupId: rollup.id };
    // The drafts are made with the day, in the same transaction, so a day opened again (a reclaimed job, the sweep) adds
    // nobody: someone who joins the team later that day gets no draft (B.1).
    if (inserted) {
      for (const m of await eligibleIn(db, s.team_id, localDate)) {
        if (m.personalOff) continue;
        await db.query(
          `INSERT INTO standup_entries(organisation_id, team_id, rollup_id, membership_id, local_date) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT ON CONSTRAINT standup_entries_one DO NOTHING`, [s.organisation_id, s.team_id, rollup.id, m.membershipId, localDate]);
      }
    }
    const todo = await db.query<{ id: string }>(
      `SELECT id FROM standup_entries WHERE rollup_id = $1 AND status = 'drafting' AND (lease_until IS NULL OR lease_until < $2::timestamptz) AND attempts < $3
       ORDER BY created_at, id`, [rollup.id, iso(now), L.maxAttempts]);
    return { status: inserted ? "opened" : "exists", entryIds: todo.map((r) => r.id), rollupId: rollup.id };
  });
}

/**
 * Ends a team's standup day now (the team or the workspace switched it off): its drafts, ready, failed and skipped
 * entries become 'cancelled' (reason 'off') and an open rollup 'skipped' ('off'). As the worker; nothing before 0050.
 */
export async function cancelStandupDay(teamId: string, localDate: string): Promise<void> {
  if (!isUuid(teamId) || !DATE.test(localDate)) return;
  await inWorker(undefined, async (db) => {
    const gone = await db.query<{ id: string }>(
      `UPDATE standup_entries SET status = 'cancelled', reason = 'off', lease_until = NULL
       WHERE team_id = $1 AND local_date = $2 AND status IN ('drafting', 'ready', 'failed', 'skipped') RETURNING id`, [teamId, localDate]);
    await db.query(`UPDATE standup_rollups SET status = 'skipped', reason = 'off' WHERE team_id = $1 AND local_date = $2 AND status = 'open'`, [teamId, localDate]);
    await workerReadNotices(db, gone.map((g) => g.id));
  });
}

/**
 * The person switched standup off for their own assistant: their drafts of days still open (drafting, ready or failed)
 * are called off ('off'), and their notices read. Skipped and posted ones stay as they are. As the worker.
 */
export async function endOwnStandupToday(membershipId: string): Promise<number> {
  if (!isUuid(membershipId)) return 0;
  return inWorker(0, async (db) => {
    const gone = await db.query<{ id: string }>(
      `UPDATE standup_entries e SET status = 'cancelled', reason = 'off', lease_until = NULL FROM standup_rollups r
       WHERE r.id = e.rollup_id AND r.status = 'open' AND e.membership_id = $1 AND e.status IN ('drafting', 'ready', 'failed') RETURNING e.id`, [membershipId]);
    await workerReadNotices(db, gone.map((g) => g.id));
    return gone.length;
  });
}

// ---- Drafting (contract B.3: the claim, the save, the failure) ----------------------------------------------------------

type ClaimRow = {
  id: string; organisation_id: string; team_id: string; rollup_id: string; membership_id: string; local_date: string; status: StandupStatus; attempts: number;
  lease_live: boolean; rollup_status: string; cutoff_at: string; team_name: string; timezone: string; days: number[] | null; enabled: boolean | null;
  archived: boolean; in_team: boolean; personal_off: boolean;
};

/**
 * Claims one draft for composing (job `standup.draft` or the sweep), in one worker transaction holding the entry: still
 * drafting, no live lease, fewer than 3 attempts, the day's rollup open and before its cutoff → a 180-second lease and
 * one more attempt, and the person's own context (`sessionId` "standup": it can never confirm anything). The person no
 * longer active → cancelled ('member_gone'); no longer in the team → cancelled ('left_team'); the team or the workspace
 * switched standup off → cancelled ('off'). Past the cutoff → 'late' (the entry stays drafting until the day-end sweep
 * marks it missed).
 */
export async function claimStandupDraft(entryId: string, now = new Date()): Promise<StandupClaim | { skip: "not_ready" | "done" | "busy" | "late" | "gone" }> {
  if (!isUuid(entryId)) return { skip: "gone" };
  return inWorker<StandupClaim | { skip: "not_ready" | "done" | "busy" | "late" | "gone" }>({ skip: "not_ready" }, async (db) => {
    const e = await db.maybeOne<ClaimRow>(
      `SELECT e.id, e.organisation_id, e.team_id, e.rollup_id, e.membership_id, e.local_date::text AS local_date, e.status, e.attempts,
              COALESCE(e.lease_until > $2::timestamptz, false) AS lease_live, r.status AS rollup_status, r.cutoff_at, t.name AS team_name, o.timezone,
              s.days, s.enabled, t.archived_at IS NOT NULL AS archived,
              EXISTS (SELECT 1 FROM team_members tm WHERE tm.team_id = e.team_id AND tm.membership_id = e.membership_id) AS in_team,
              COALESCE((SELECT 'standup' = ANY(ap.abilities_off) FROM assistant_private ap WHERE ap.membership_id = e.membership_id), false) AS personal_off
       FROM standup_entries e JOIN standup_rollups r ON r.id = e.rollup_id JOIN teams t ON t.id = e.team_id
       JOIN organisations o ON o.id = e.organisation_id LEFT JOIN team_standups s ON s.team_id = e.team_id
       WHERE e.id = $1 FOR UPDATE OF e`, [entryId, iso(now)]);
    if (!e) return { skip: "gone" };
    if (e.status !== "drafting") return { skip: "done" };
    const cancel = async (reason: string) => {
      await db.query(`UPDATE standup_entries SET status = 'cancelled', reason = $2, lease_until = NULL WHERE id = $1 AND status = 'drafting'`, [e.id, reason]);
      return { skip: "gone" as const };
    };
    if (e.lease_live) return { skip: "busy" };
    // Out of attempts (a worker that died during the third, or an undone skip of a failed draft): failed, and the person
    // is told once, as failStandupDraft does (fix review, 9 October 2026: it used to stay silent).
    if (e.attempts >= L.maxAttempts) {
      await failIn(db, e.id, "attempts");
      return { skip: "done" };
    }
    if (e.rollup_status !== "open" || now.getTime() >= Date.parse(e.cutoff_at)) return { skip: "late" };
    if (!e.enabled || e.archived || !(await workspaceOffers(db, e.organisation_id))) return cancel("off");
    // The person switched standup off for their own assistant after the day opened: no draft, no notice, no model call.
    if (e.personal_off) return cancel("off");
    if (!e.in_team) return cancel("left_team");
    const ctx = await memberContext(db, e.organisation_id, e.membership_id, { sessionId: "standup" });
    if (!ctx || ctx.org.status !== "active") return cancel("member_gone");
    await db.query(
      `UPDATE standup_entries SET lease_until = $2::timestamptz + make_interval(secs => $3), attempts = attempts + 1 WHERE id = $1`,
      [e.id, iso(now), L.leaseSeconds]);
    // This team's working project only: a draft is posted to this team's channel, so another team's project is not its
    // business (security review, 9 October 2026; compose also drops any task the channel's readers cannot all see).
    const projects = await db.query<{ project_id: string }>(
      `SELECT t.project_id FROM teams t WHERE t.id = $1 AND t.archived_at IS NULL AND t.project_id IS NOT NULL`, [e.team_id]);
    const days = daysOf(e.days);
    const previous = previousStandupDay(e.local_date, days);
    return {
      entryId: e.id, ctx, team: { id: e.team_id, name: e.team_name, projectIds: projects.map((p) => p.project_id) },
      localDate: e.local_date, dateLabel: standupDateLabel(e.local_date), sinceLabel: standupSinceLabel(e.local_date, previous),
      window: { since: iso(localMidnight(previous, e.timezone)), until: iso(now) }, timeZone: e.timezone,
      preferences: await preferencesForWorker(db, e.membership_id),
    };
  });
}

/** The draft notification's body: the first two Yesterday lines joined with "; " (≤ 300). */
function draftNoticeBody(texts: StandupTexts): string | undefined {
  const lines = texts.yesterday.split("\n").map((l) => oneLine(l.replace(/^\s*-\s*/, ""))).filter(Boolean).slice(0, 2);
  return lines.length ? clip(lines.join("; "), 300) : undefined;
}

async function notifyDraft(db: Db, r: { id: string; organisation_id: string; membership_id: string; team_name: string; slug: string; texts: StandupTexts }) {
  await notify(db, {
    organisationId: r.organisation_id, recipientMembershipId: r.membership_id, type: "brenda.standup",
    title: W.notifications.draftTitle(r.team_name), body: draftNoticeBody(r.texts),
    resourceType: "standup_entry", resourceId: r.id, href: standupEntryHref(r.slug, r.id), dedupKey: `standup.draft:${r.id}`,
  });
}

const sectionText = (s: unknown) => clip(cleanSection(String(s ?? "")), L.sectionMax);

/**
 * Keeps a composed draft (worker transaction holding the entry): still drafting → ready, with the draft, the three
 * texts, the blockers and the engine; then its notice: held to the end of the person's quiet hours (`held`), else sent
 * now (`notified`). Anything else (skipped, cancelled meanwhile) discards it (`none`).
 */
export async function saveStandupDraft(entryId: string, c: StandupComposed, now = new Date()): Promise<{ delivery: "notified" | "held" | "none" }> {
  if (!isUuid(entryId) || !c) return { delivery: "none" };
  return inWorker<{ delivery: "notified" | "held" | "none" }>({ delivery: "none" }, async (db) => {
    const e = await db.maybeOne<{ id: string; organisation_id: string; membership_id: string; status: StandupStatus; team_name: string; slug: string }>(
      `SELECT e.id, e.organisation_id, e.membership_id, e.status, t.name AS team_name, o.slug
       FROM standup_entries e JOIN teams t ON t.id = e.team_id JOIN organisations o ON o.id = e.organisation_id WHERE e.id = $1 FOR UPDATE OF e`, [entryId]);
    if (!e || e.status !== "drafting") return { delivery: "none" };
    const texts: StandupTexts = { yesterday: sectionText(c.texts?.yesterday), today: sectionText(c.texts?.today), blocked: sectionText(c.texts?.blocked) };
    const draft = draftOf(c.draft);
    const engine = c.engine === "claude" ? "claude" : "template";
    const quiet = await quietStateFor(db, e.membership_id, now);
    const held = quiet.active && !!quiet.until;
    await db.query(
      `UPDATE standup_entries SET status = 'ready', draft = $2, yesterday_text = $3, today_text = $4, blocked_text = $5, blockers = $6, engine = $7,
         drafted_at = $8::timestamptz, lease_until = NULL, notify_at = $9::timestamptz, notified_at = $10::timestamptz
       WHERE id = $1`,
      [e.id, draft ? JSON.stringify(draft) : null, texts.yesterday, texts.today, texts.blocked, JSON.stringify(blockersOf(c.blockers)), engine,
       iso(now), held ? quiet.until : iso(now), held ? null : iso(now)]);
    if (held) return { delivery: "held" };
    await notifyDraft(db, { ...e, texts });
    return { delivery: "notified" };
  });
}

/**
 * A draft that could not be composed (worker transaction). Fewer than 3 attempts: the lease is cleared and it stays
 * drafting (the sweep tries again). The third: 'failed' with the short code (≤ 64 characters, never the error's words,
 * which go to the server log only) and the person is told once (in the bell; the notch holds it during quiet hours as
 * it does any notice). Never throws.
 */
export async function failStandupDraft(entryId: string, code: string, message?: string): Promise<void> {
  if (message) console.warn(`[standup] draft ${entryId} failed (${code}): ${String(message).slice(0, 300)}`);
  if (!isUuid(entryId)) return;
  try {
    await inWorker(undefined, async (db) => {
      const e = await db.maybeOne<{ id: string; status: StandupStatus; attempts: number }>(
        `SELECT e.id, e.status, e.attempts FROM standup_entries e WHERE e.id = $1 FOR UPDATE OF e`, [entryId]);
      if (!e || e.status !== "drafting") return;
      if (e.attempts < L.maxAttempts) {
        await db.query(`UPDATE standup_entries SET lease_until = NULL WHERE id = $1`, [e.id]);
        return;
      }
      await failIn(db, e.id, code);
    });
  } catch (err) { warn(`recording the failure of draft ${entryId}`)(err); }
}

/** A drafting entry (held by the caller) becomes 'failed' with its short code, and the person is told once. */
async function failIn(db: Db, entryId: string, code: string): Promise<void> {
  const e = await db.maybeOne<{ id: string; organisation_id: string; membership_id: string; team_name: string; slug: string }>(
    `UPDATE standup_entries x SET status = 'failed', reason = $2, lease_until = NULL FROM teams t, organisations o
     WHERE x.id = $1 AND x.status = 'drafting' AND t.id = x.team_id AND o.id = x.organisation_id
     RETURNING x.id, x.organisation_id, x.membership_id, t.name AS team_name, o.slug`, [entryId, clip(oneLine(code) || "error", 64)]);
  if (!e) return;
  const name = (await readPersonalAssistant(db, e.membership_id)).name;
  await notify(db, {
    organisationId: e.organisation_id, recipientMembershipId: e.membership_id, type: "brenda.standup_failed",
    title: W.notifications.failedTitle(e.team_name), body: W.results.failed(name, e.team_name),
    resourceType: "standup_entry", resourceId: e.id, href: standupEntryHref(e.slug, e.id), dedupKey: `standup.failed:${e.id}`,
  });
}

// ---- The cutoff and the rollup (contract B.6) ---------------------------------------------------------------------------

type RollupRow = { id: string; organisation_id: string; team_id: string; local_date: string; status: string; cutoff_at: string; team_name: string; timezone: string; slug: string };
const ROLLUP_SQL = `SELECT r.id, r.organisation_id, r.team_id, r.local_date::text AS local_date, r.status, r.cutoff_at, t.name AS team_name, o.timezone, o.slug
  FROM standup_rollups r JOIN teams t ON t.id = r.team_id JOIN organisations o ON o.id = r.organisation_id`;

/**
 * What the brain's composeRollup needs at the cutoff (job `standup.rollup` or the sweep), read by the worker holding the
 * rollup: the team, the day, the eligible members now, every entry of the day (with the person's posted Blocked words
 * and structured blockers) and the recipients. Not yet due → 'not_due'; already sent or skipped → 'done'.
 */
export async function rollupInput(rollupId: string, now = new Date()): Promise<RollupInput | { skip: "not_ready" | "not_due" | "done" }> {
  if (!isUuid(rollupId)) return { skip: "done" };
  return inWorker<RollupInput | { skip: "not_ready" | "not_due" | "done" }>({ skip: "not_ready" }, async (db) => {
    const r = await db.maybeOne<RollupRow>(`${ROLLUP_SQL} WHERE r.id = $1 FOR UPDATE OF r`, [rollupId]);
    if (!r || r.status !== "open") return { skip: "done" };
    if (now.getTime() < Date.parse(r.cutoff_at)) return { skip: "not_due" };
    const members = (await eligibleIn(db, r.team_id, r.local_date)).map((m) => ({ membershipId: m.membershipId, name: m.name }));
    const entries = await db.query<{ membership_id: string; name: string; status: StandupStatus; posted_at: string | null; message_id: string | null; conversation_id: string | null; blocked_text: string | null; blockers: unknown }>(
      `SELECT e.membership_id, p.display_name AS name, e.status, e.posted_at, e.message_id, e.conversation_id, e.blocked_text, e.blockers
       FROM standup_entries e JOIN memberships m ON m.id = e.membership_id JOIN profiles p ON p.id = m.user_id
       WHERE e.rollup_id = $1 ORDER BY p.display_name, e.membership_id`, [r.id]);
    return {
      rollupId: r.id, organisationId: r.organisation_id, slug: r.slug, team: { id: r.team_id, name: r.team_name }, localDate: r.local_date,
      dateLabel: standupDateLabel(r.local_date), cutoffAt: r.cutoff_at, timeZone: r.timezone, members,
      entries: entries.map((e) => ({
        membershipId: e.membership_id, name: e.name, status: e.status, postedAt: e.posted_at, messageId: e.message_id, conversationId: e.conversation_id,
        blockedText: e.blocked_text, blockers: blockersOf(e.blockers),
      })),
      recipients: (await recipientsIn(db, r.team_id)).map((x) => x.membershipId),
    };
  });
}

/** A composed rollup as it is kept: the shape checked, lists bounded, the organisation's zone attached. */
function contentOf(c: StandupRollupContent, r: RollupRow): StandupRollupContent {
  const person = (p: { membershipId?: unknown; name?: unknown }) => ({ membershipId: isUuid(p.membershipId) ? p.membershipId : "", name: clip(oneLine(p.name), 120) || "Someone" });
  const post = (p: StandupRollupContent["posted"][number]) => ({
    ...person(p), at: String(p.at ?? ""), messageId: isUuid(p.messageId) ? p.messageId : null, conversationId: isUuid(p.conversationId) ? p.conversationId : null,
  });
  const list = <T>(v: T[] | null | undefined, max: number) => (Array.isArray(v) ? v.slice(0, max) : []);
  return {
    v: 1, team: { id: r.team_id, name: r.team_name }, localDate: r.local_date, dateLabel: standupDateLabel(r.local_date), cutoffAt: r.cutoff_at,
    counts: { members: Math.max(0, Math.floor(Number(c?.counts?.members) || 0)), posted: Math.max(0, Math.floor(Number(c?.counts?.posted) || 0)) },
    posted: list(c?.posted, 500).map(post),
    blockers: list(c?.blockers, L.blockersMax).map((b) => ({
      ...person(b), text: clip(oneLine(b.text), 160), taskId: isUuid(b.taskId) ? b.taskId : null,
      onMembershipId: isUuid(b.onMembershipId) ? b.onMembershipId : null, onName: b.onName ? clip(oneLine(b.onName), 120) : null,
    })),
    noUpdate: list(c?.noUpdate, 500).map(person),
    late: list(c?.late, 500).map(post),
    timeZone: r.timezone,
  };
}

async function notifyRollup(db: Db, r: { id: string; organisation_id: string; slug: string; team_name: string }, membershipId: string, c: StandupRollupContent) {
  await notify(db, {
    organisationId: r.organisation_id, recipientMembershipId: membershipId, type: "brenda.standup_rollup",
    title: W.notifications.rollupTitle(r.team_name, c.counts.posted, c.counts.members), body: rollupNoticeBody(c),
    resourceType: "standup_rollup", resourceId: r.id, href: standupRollupHref(r.slug, r.id), dedupKey: `standup.rollup:${r.id}:${membershipId}`,
  });
}

/**
 * Sends the lead's rollup (worker transaction holding the rollup, still open): 'sent' with its content, one recipient
 * row each (`notify_at`: the end of their quiet hours, or now), and a notification now for those not quiet (the sweep
 * releases the others). Nobody on the team → sent with reason 'empty'; nobody to receive it → sent with reason
 * 'no_lead'; neither notifies anyone. A post made after the cutoff but before this ran is listed as late.
 */
export async function sendRollup(rollupId: string, content: StandupRollupContent, now = new Date()): Promise<{ notified: number; held: number }> {
  if (!isUuid(rollupId)) return { notified: 0, held: 0 };
  return inWorker({ notified: 0, held: 0 }, async (db) => {
    const r = await db.maybeOne<RollupRow>(`${ROLLUP_SQL} WHERE r.id = $1 FOR UPDATE OF r`, [rollupId]);
    if (!r || r.status !== "open") return { notified: 0, held: 0 };
    const c = contentOf(content, r);
    // Posted after the cutoff while this waited: late, as a post after the send would be.
    const after = await db.query<{ id: string; membership_id: string; name: string; posted_at: string; message_id: string | null; conversation_id: string | null }>(
      `SELECT e.id, e.membership_id, p.display_name AS name, e.posted_at, e.message_id, e.conversation_id
       FROM standup_entries e JOIN memberships m ON m.id = e.membership_id JOIN profiles p ON p.id = m.user_id
       WHERE e.rollup_id = $1 AND e.status = 'posted' AND e.posted_at > $2::timestamptz AND e.rollup_noted_at IS NULL ORDER BY e.posted_at, e.id`,
      [r.id, r.cutoff_at]);
    for (const a of after) {
      if (!c.late.some((l) => l.membershipId === a.membership_id)) c.late.push({ membershipId: a.membership_id, name: a.name, at: a.posted_at, messageId: a.message_id, conversationId: a.conversation_id });
    }
    if (after.length) {
      await db.query(`UPDATE standup_entries SET posted_late = true, rollup_noted_at = $2::timestamptz WHERE id = ANY($1::uuid[])`, [after.map((a) => a.id), iso(now)]);
    }
    const recipients = await recipientsIn(db, r.team_id);
    const reason = c.counts.members === 0 ? "empty" : !recipients.length ? "no_lead" : null;
    await db.query(`UPDATE standup_rollups SET status = 'sent', content = $2, sent_at = $3::timestamptz, reason = $4 WHERE id = $1`,
      [r.id, JSON.stringify(c), iso(now), reason]);
    if (reason) return { notified: 0, held: 0 };
    let notified = 0, held = 0;
    for (const x of recipients) {
      const quiet = await quietStateFor(db, x.membershipId, now);
      const hold = quiet.active && !!quiet.until;
      await db.query(
        `INSERT INTO standup_rollup_recipients(rollup_id, organisation_id, membership_id, notify_at, notified_at) VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz)
         ON CONFLICT (rollup_id, membership_id) DO NOTHING`,
        [r.id, r.organisation_id, x.membershipId, hold ? quiet.until : iso(now), hold ? null : iso(now)]);
      if (hold) { held++; continue; }
      await notifyRollup(db, r, x.membershipId, c);
      notified++;
    }
    return { notified, held };
  });
}

// ---- The sweep and the scheduler's questions (contract B.9) ----------------------------------------------------------------

type EnabledTeam = { team_id: string; organisation_id: string; post_time: string; cutoff_time: string; days: number[]; timezone: string; offered: boolean };

/** Every team with standup on, in an active workspace, with whether the workspace offers standup. */
async function enabledTeams(db: Db): Promise<EnabledTeam[]> {
  return db.query<EnabledTeam>(
    `SELECT s.team_id, s.organisation_id, to_char(s.post_time, 'HH24:MI') AS post_time, to_char(s.cutoff_time, 'HH24:MI') AS cutoff_time, s.days, o.timezone,
            NOT COALESCE('standup' = ANY(b.abilities_off), false) AS offered
     FROM team_standups s JOIN teams t ON t.id = s.team_id AND t.archived_at IS NULL
     JOIN organisations o ON o.id = s.organisation_id AND o.status = 'active'
     LEFT JOIN brenda_settings b ON b.organisation_id = s.organisation_id
     WHERE s.enabled ORDER BY s.team_id`);
}

type DueDay = { teamId: string; localDate: string; postAt: string; cutoffAt: string; opened: boolean };

/** Each enabled team's day today (its zone) that runs, with its times and whether its rollup row exists. */
async function todaysDays(db: Db, now: Date): Promise<DueDay[]> {
  const teams = (await enabledTeams(db)).filter((t) => t.offered);
  if (!teams.length) return [];
  const out: DueDay[] = [];
  for (const t of teams) {
    const date = localDateOf(now, t.timezone);
    if (!daysOf(t.days).includes(weekdayOf(date))) continue;
    out.push({ teamId: t.team_id, localDate: date, postAt: iso(localTimeOn(date, t.post_time, t.timezone)), cutoffAt: iso(localTimeOn(date, t.cutoff_time, t.timezone)), opened: false });
  }
  if (!out.length) return out;
  const rows = await db.query<{ team_id: string; local_date: string }>(
    `SELECT team_id, local_date::text AS local_date FROM standup_rollups WHERE team_id = ANY($1::uuid[]) AND local_date = ANY($2::date[])`,
    [out.map((d) => d.teamId), [...new Set(out.map((d) => d.localDate))]]);
  const have = new Set(rows.map((r) => `${r.team_id}:${r.local_date}`));
  return out.map((d) => ({ ...d, opened: have.has(`${d.teamId}:${d.localDate}`) }));
}

/**
 * The days the scheduler queues `standup.open` for (brain's scheduleStandups): enabled teams in active workspaces that
 * offer standup, today's weekday among its days, whose post time is within the next hour, or has passed with the
 * cutoff still ahead and no rollup row yet. [] before 0050.
 */
export async function standupDaysDue(now = new Date()): Promise<DueDay[]> {
  return inWorker<DueDay[]>([], async (db) => {
    const t = now.getTime();
    return (await todaysDays(db, now)).filter((d) => {
      const post = Date.parse(d.postAt), cutoff = Date.parse(d.cutoffAt);
      return (post > t && post <= t + 3_600_000) || (post <= t && t < cutoff && !d.opened);
    });
  });
}

/** Open rollups whose cutoff is within `withinMinutes` (60 by default) or past, soonest first. [] before 0050. */
export async function standupRollupsDue(now = new Date(), withinMinutes = 60): Promise<{ rollupId: string; cutoffAt: string }[]> {
  return inWorker<{ rollupId: string; cutoffAt: string }[]>([], async (db) => {
    const rows = await db.query<{ id: string; cutoff_at: string }>(
      `SELECT id, cutoff_at FROM standup_rollups WHERE status = 'open' AND cutoff_at <= $1::timestamptz + make_interval(mins => $2)
       ORDER BY cutoff_at, id LIMIT 200`, [iso(now), Math.max(0, Math.floor(withinMinutes))]);
    return rows.map((r) => ({ rollupId: r.id, cutoffAt: r.cutoff_at }));
  });
}

/** The entry ids the sweep would draft now (drafting, lease free, attempts left, day open, created over 2 minutes ago). */
const STALE_DRAFTS_SQL = `
  SELECT e.id FROM standup_entries e JOIN standup_rollups r ON r.id = e.rollup_id
  WHERE e.status = 'drafting' AND (e.lease_until IS NULL OR e.lease_until < $1::timestamptz) AND e.attempts < $2
    AND r.status = 'open' AND r.cutoff_at > $1::timestamptz AND e.created_at < $1::timestamptz - interval '2 minutes'
  ORDER BY e.created_at, e.id LIMIT $3`;

/**
 * Whether the sweep has anything to do this minute (the scheduler queues `standup.sweep` for the minute when it has, and
 * hourly whatever happens): a day to open, a draft to retry, a rollup due, a notice to release, a late post to note, a
 * past day to close. False before 0050 and on any error.
 */
export async function standupSweepDue(now = new Date()): Promise<boolean> {
  try {
    return await inWorker(false, async (db) => {
      const t = now.getTime();
      if ((await todaysDays(db, now)).some((d) => !d.opened && Date.parse(d.postAt) <= t && t < Date.parse(d.cutoffAt))) return true;
      const r = await db.one<{ due: boolean }>(
        `SELECT EXISTS (${STALE_DRAFTS_SQL.replace("LIMIT $3", "LIMIT 1")})
             OR EXISTS (SELECT 1 FROM standup_entries e JOIN standup_rollups r ON r.id = e.rollup_id
                        WHERE e.status = 'drafting' AND e.attempts >= $2 AND (e.lease_until IS NULL OR e.lease_until < $1::timestamptz) AND r.status = 'open')
             OR EXISTS (SELECT 1 FROM standup_rollups WHERE status = 'open' AND cutoff_at <= $1::timestamptz)
             OR EXISTS (SELECT 1 FROM standup_entries WHERE status = 'ready' AND notified_at IS NULL AND notify_at <= $1::timestamptz)
             OR EXISTS (SELECT 1 FROM standup_rollup_recipients WHERE notified_at IS NULL AND notify_at <= $1::timestamptz)
             OR EXISTS (SELECT 1 FROM standup_entries WHERE posted_late AND rollup_noted_at IS NULL)
             OR EXISTS (SELECT 1 FROM standup_entries e JOIN organisations o ON o.id = e.organisation_id
                        WHERE e.status IN ('drafting', 'ready', 'failed') AND e.local_date < ($1::timestamptz AT TIME ZONE o.timezone)::date) AS due`,
        [iso(now), L.maxAttempts]);
      return r.due;
    });
  } catch (err) {
    warn("checking whether the sweep is due")(err);
    return false;
  }
}

/**
 * The sweep (`standup.sweep`, every minute something is due and hourly), bounded, in turn: opens any due day not yet
 * opened (≤ 20 teams; its new entries are returned to draft), returns other drafts to retry (≤ 10 in all), returns the
 * rollups due (≤ 10; the handler sends them inline), releases held notices (the person or the lead no longer quiet; an
 * entry no longer ready is not announced), adds late posts to their day's rollup (no new notification), marks
 * unfinished entries of past days missed, and cancels entries of people who left the team and of teams (or workspaces)
 * that switched standup off, skipping their open rollups. Nothing before 0050.
 */
export async function sweepStandups(now = new Date()): Promise<{ opened: number; toDraft: string[]; rollupsDue: string[]; released: number; lateNoted: number; missed: number; cancelled: number }> {
  const none = { opened: 0, toDraft: [] as string[], rollupsDue: [] as string[], released: 0, lateNoted: 0, missed: 0, cancelled: 0 };
  const ready = await inWorker(false, async () => true).catch(() => false);
  if (!ready) return none;
  const out = { ...none, toDraft: [] as string[], rollupsDue: [] as string[] };

  // 1. Days due and not opened (a lost or killed `standup.open`).
  const due = await inWorker<DueDay[]>([], async (db) => {
    const t = now.getTime();
    return (await todaysDays(db, now)).filter((d) => !d.opened && Date.parse(d.postAt) <= t && t < Date.parse(d.cutoffAt)).slice(0, 20);
  }).catch((err) => { warn("finding days to open")(err); return [] as DueDay[]; });
  for (const d of due) {
    const r = await openStandupDay(d.teamId, d.localDate, now).catch((err) => { warn(`opening ${d.teamId}`)(err); return null; });
    if (r?.status === "opened") out.opened++;
    for (const id of r?.entryIds ?? []) if (out.toDraft.length < 10) out.toDraft.push(id);
  }

  await inWorker(undefined, async (db) => {
    // 2. Drafts to retry; and drafts out of attempts with no live lease (a worker that died during the third, an undone
    // skip of a failed draft): failed, and the person told once (fix review, 9 October 2026: they read "drafting" all day).
    if (out.toDraft.length < 10) {
      const stale = await db.query<{ id: string }>(STALE_DRAFTS_SQL, [iso(now), L.maxAttempts, 10 - out.toDraft.length]);
      for (const s of stale) if (!out.toDraft.includes(s.id)) out.toDraft.push(s.id);
    }
    const spent = await db.query<{ id: string }>(
      `SELECT e.id FROM standup_entries e JOIN standup_rollups r ON r.id = e.rollup_id
       WHERE e.status = 'drafting' AND e.attempts >= $2 AND (e.lease_until IS NULL OR e.lease_until < $1::timestamptz) AND r.status = 'open'
       ORDER BY e.created_at, e.id LIMIT 20 FOR UPDATE OF e SKIP LOCKED`, [iso(now), L.maxAttempts]);
    for (const x of spent) await failIn(db, x.id, "attempts");
    // 3. Rollups due.
    out.rollupsDue = (await db.query<{ id: string }>(
      `SELECT id FROM standup_rollups WHERE status = 'open' AND cutoff_at <= $1::timestamptz ORDER BY cutoff_at, id LIMIT 10`, [iso(now)])).map((r) => r.id);
  }).catch(warn("reading drafts and rollups due"));

  // 4. Held notices.
  out.released = await releaseHeld(now).catch((err) => { warn("releasing held notices")(err); return 0; });
  // 5. Late posts.
  out.lateNoted = await noteLatePosts(now).catch((err) => { warn("noting late posts")(err); return 0; });
  // 6 and 7. Past days missed; people who left and teams switched off cancelled.
  const closed = await closeDays(now).catch((err) => { warn("closing days")(err); return { missed: 0, cancelled: 0 }; });
  out.missed = closed.missed;
  out.cancelled = closed.cancelled;
  return out;
}

/** Releases the notices held for quiet hours that are now due (at most 50 of each kind). */
async function releaseHeld(now: Date): Promise<number> {
  return inWorker(0, async (db) => {
    let released = 0;
    // An entry that is no longer ready when its notice comes due is not announced.
    await db.query(
      `UPDATE standup_entries SET notified_at = $1::timestamptz WHERE notified_at IS NULL AND notify_at <= $1::timestamptz AND status <> 'ready'`, [iso(now)]);
    const entries = await db.query<{ id: string; organisation_id: string; membership_id: string; team_name: string; slug: string; yesterday_text: string | null; today_text: string | null; blocked_text: string | null; personal_off: boolean }>(
      `SELECT e.id, e.organisation_id, e.membership_id, t.name AS team_name, o.slug, e.yesterday_text, e.today_text, e.blocked_text,
              COALESCE((SELECT 'standup' = ANY(ap.abilities_off) FROM assistant_private ap WHERE ap.membership_id = e.membership_id), false) AS personal_off
       FROM standup_entries e JOIN teams t ON t.id = e.team_id JOIN organisations o ON o.id = e.organisation_id
       WHERE e.status = 'ready' AND e.notified_at IS NULL AND e.notify_at <= $1::timestamptz ORDER BY e.notify_at, e.id LIMIT 50 FOR UPDATE OF e SKIP LOCKED`, [iso(now)]);
    for (const e of entries) {
      // Switched off for their own assistant while it waited: called off, never announced.
      if (e.personal_off) {
        await db.query(`UPDATE standup_entries SET status = 'cancelled', reason = 'off', notified_at = $2::timestamptz WHERE id = $1 AND status = 'ready'`, [e.id, iso(now)]);
        continue;
      }
      const quiet = await quietStateFor(db, e.membership_id, now);
      if (quiet.active && quiet.until) { await db.query(`UPDATE standup_entries SET notify_at = $2::timestamptz WHERE id = $1`, [e.id, quiet.until]); continue; }
      await notifyDraft(db, { ...e, texts: { yesterday: e.yesterday_text ?? "", today: e.today_text ?? "", blocked: e.blocked_text ?? "" } });
      await db.query(`UPDATE standup_entries SET notified_at = $2::timestamptz WHERE id = $1`, [e.id, iso(now)]);
      released++;
    }
    const recipients = await db.query<{ rollup_id: string; membership_id: string; organisation_id: string; slug: string; team_name: string; content: StandupRollupContent | null }>(
      `SELECT x.rollup_id, x.membership_id, x.organisation_id, o.slug, t.name AS team_name, r.content
       FROM standup_rollup_recipients x JOIN standup_rollups r ON r.id = x.rollup_id JOIN teams t ON t.id = r.team_id JOIN organisations o ON o.id = x.organisation_id
       WHERE x.notified_at IS NULL AND x.notify_at <= $1::timestamptz ORDER BY x.notify_at LIMIT 50 FOR UPDATE OF x SKIP LOCKED`, [iso(now)]);
    for (const x of recipients) {
      const quiet = await quietStateFor(db, x.membership_id, now);
      if (quiet.active && quiet.until) {
        await db.query(`UPDATE standup_rollup_recipients SET notify_at = $3::timestamptz WHERE rollup_id = $1 AND membership_id = $2`, [x.rollup_id, x.membership_id, quiet.until]);
        continue;
      }
      if (x.content) await notifyRollup(db, { id: x.rollup_id, organisation_id: x.organisation_id, slug: x.slug, team_name: x.team_name }, x.membership_id, x.content);
      await db.query(`UPDATE standup_rollup_recipients SET notified_at = $3::timestamptz WHERE rollup_id = $1 AND membership_id = $2`, [x.rollup_id, x.membership_id, iso(now)]);
      released++;
    }
    return released;
  });
}

/** Adds posts made after their day's rollup was sent to its `late` list (no new notification). */
async function noteLatePosts(now: Date): Promise<number> {
  return inWorker(0, async (db) => {
    const rows = await db.query<{ id: string; rollup_id: string; membership_id: string; name: string; posted_at: string; message_id: string | null; conversation_id: string | null }>(
      `SELECT e.id, e.rollup_id, e.membership_id, p.display_name AS name, e.posted_at, e.message_id, e.conversation_id
       FROM standup_entries e JOIN memberships m ON m.id = e.membership_id JOIN profiles p ON p.id = m.user_id
       WHERE e.posted_late AND e.rollup_noted_at IS NULL ORDER BY e.posted_at, e.id LIMIT 50`);
    let noted = 0;
    for (const rollupId of [...new Set(rows.map((r) => r.rollup_id))]) {
      const r = await db.maybeOne<{ content: StandupRollupContent | null }>(`SELECT content FROM standup_rollups WHERE id = $1 FOR UPDATE`, [rollupId]);
      const mine = rows.filter((x) => x.rollup_id === rollupId);
      if (r?.content) {
        const c = r.content;
        const late = Array.isArray(c.late) ? [...c.late] : [];
        for (const x of mine) if (!late.some((l) => l.membershipId === x.membership_id)) late.push({ membershipId: x.membership_id, name: x.name, at: x.posted_at, messageId: x.message_id, conversationId: x.conversation_id });
        await db.query(`UPDATE standup_rollups SET content = $2 WHERE id = $1`, [rollupId, JSON.stringify({ ...c, late })]);
      }
      await db.query(`UPDATE standup_entries SET rollup_noted_at = $2::timestamptz WHERE id = ANY($1::uuid[])`, [mine.map((x) => x.id), iso(now)]);
      noted += mine.length;
    }
    return noted;
  });
}

/** Past days' unfinished entries → missed; entries of people who left the team or of teams switched off → cancelled. */
async function closeDays(now: Date): Promise<{ missed: number; cancelled: number }> {
  return inWorker({ missed: 0, cancelled: 0 }, async (db) => {
    const missed = await db.query<{ id: string }>(
      `UPDATE standup_entries e SET status = 'missed', lease_until = NULL FROM organisations o
       WHERE o.id = e.organisation_id AND e.status IN ('drafting', 'ready', 'failed') AND e.local_date < ($1::timestamptz AT TIME ZONE o.timezone)::date
       RETURNING e.id`, [iso(now)]);
    // Only days still open (a past day's skip stays a skip), through the open rollups' index rather than every
    // historical skipped row (fix review, 9 October 2026).
    const left = await db.query<{ id: string }>(
      `UPDATE standup_entries e SET status = 'cancelled', reason = 'left_team', lease_until = NULL
       FROM standup_rollups r
       WHERE r.id = e.rollup_id AND r.status = 'open' AND e.status IN ('drafting', 'ready', 'failed', 'skipped')
         AND NOT EXISTS (SELECT 1 FROM team_members tm JOIN memberships m ON m.id = tm.membership_id AND m.status = 'active'
                         WHERE tm.team_id = e.team_id AND tm.membership_id = e.membership_id)
       RETURNING e.id`);
    const offTeams = await db.query<{ id: string }>(
      `SELECT r.id FROM standup_rollups r
       LEFT JOIN team_standups s ON s.team_id = r.team_id JOIN teams t ON t.id = r.team_id LEFT JOIN brenda_settings b ON b.organisation_id = r.organisation_id
       WHERE r.status = 'open' AND (s.enabled IS NOT TRUE OR t.archived_at IS NOT NULL OR COALESCE('standup' = ANY(b.abilities_off), false))`);
    let cancelled = left.length;
    const closed = [...missed, ...left].map((x) => x.id);
    if (offTeams.length) {
      const ids = offTeams.map((r) => r.id);
      const c = await db.query<{ id: string }>(
        `UPDATE standup_entries SET status = 'cancelled', reason = 'off', lease_until = NULL WHERE rollup_id = ANY($1::uuid[]) AND status IN ('drafting', 'ready', 'failed', 'skipped') RETURNING id`, [ids]);
      cancelled += c.length;
      closed.push(...c.map((x) => x.id));
      await db.query(`UPDATE standup_rollups SET status = 'skipped', reason = 'off' WHERE id = ANY($1::uuid[]) AND status = 'open'`, [ids]);
    }
    await workerReadNotices(db, closed);
    return { missed: missed.length, cancelled };
  });
}

// ---- The person's views (contract B.4, F.2) -------------------------------------------------------------------------------

type EntryRow = {
  id: string; team_id: string; team_name: string; local_date: string; rollup_id: string; status: StandupStatus; draft: unknown;
  yesterday_text: string | null; today_text: string | null; blocked_text: string | null; edited: boolean; engine: "template" | "claude" | null;
  posted_at: string | null; message_id: string | null; conversation_id: string | null; posted_late: boolean; seen_at: string | null;
};
const ENTRY_SQL = `SELECT e.id, e.team_id, t.name AS team_name, e.local_date::text AS local_date, e.rollup_id, e.status, e.draft, e.yesterday_text, e.today_text,
         e.blocked_text, e.edited, e.engine, e.posted_at, e.message_id, e.conversation_id, e.posted_late, e.seen_at
  FROM standup_entries e JOIN teams t ON t.id = e.team_id`;

/** The person's entries as views, read as them (only their own: row-level security), with each day's times and channel. */
async function entryViewsIn(db: Db, ctx: OrgContext, where: string, params: unknown[]): Promise<StandupEntryView[]> {
  const rows = await db.query<EntryRow>(
    `${ENTRY_SQL} WHERE e.organisation_id = $1 AND e.membership_id = $2 AND (${where}) ORDER BY e.local_date DESC, t.name, e.id`, [ctx.org.id, ctx.membership.id, ...params]);
  if (!rows.length) return [];
  const teamIds = [...new Set(rows.map((r) => r.team_id))];
  // The day's times and state: the rollup row is the worker's (only its recipients read it), so these few columns of
  // the person's own days are read through the worker.
  const days = new Map((await withWorker((w) => w.query<{ id: string; post_at: string; cutoff_at: string; status: string }>(
    `SELECT id, post_at, cutoff_at, status FROM standup_rollups WHERE id = ANY($1::uuid[])`, [[...new Set(rows.map((r) => r.rollup_id))]]))).map((d) => [d.id, d]));
  const settings = new Map((await db.query<{ team_id: string; days: number[] }>(`SELECT team_id, days FROM team_standups WHERE team_id = ANY($1::uuid[])`, [teamIds]))
    .map((s) => [s.team_id, daysOf(s.days)]));
  const channels = new Map((await db.query<{ team_id: string; id: string }>(
    `SELECT team_id, id FROM conversations WHERE kind = 'team' AND team_id = ANY($1::uuid[])`, [teamIds])).map((c) => [c.team_id, c.id]));
  const readers = new Map<string, number | null>();
  for (const [teamId, conv] of channels) {
    const n = await db.maybeOne<{ n: number }>(`SELECT count(*)::int AS n FROM app_conversation_readers($1)`, [conv]).catch(() => null);
    readers.set(teamId, n && n.n >= 1 ? n.n : null);
  }
  const leads = new Map<string, { membershipId: string; name: string }[]>();
  for (const t of teamIds) leads.set(t, await recipientsIn(db, t));
  const now = Date.now();
  return rows.map((r): StandupEntryView => {
    const day = days.get(r.rollup_id);
    const draft = draftOf(r.draft);
    const since = draft?.sinceLabel ?? standupSinceLabel(r.local_date, previousStandupDay(r.local_date, settings.get(r.team_id) ?? [...STANDUP_DEFAULTS.days]));
    const texts = r.yesterday_text !== null && r.today_text !== null && r.blocked_text !== null
      ? { yesterday: r.yesterday_text, today: r.today_text, blocked: r.blocked_text } : null;
    const conv = r.conversation_id ?? channels.get(r.team_id) ?? null;
    return {
      id: r.id, team: { id: r.team_id, name: r.team_name }, localDate: r.local_date, dateLabel: draft?.dateLabel ?? standupDateLabel(r.local_date), sinceLabel: since,
      status: r.status, texts, draft, edited: r.edited, engine: r.engine,
      postTo: { conversationId: conv, name: `#${r.team_name}`, members: readers.get(r.team_id) ?? null },
      leads: (leads.get(r.team_id) ?? []).map((l) => l.name), postAt: day?.post_at ?? "", cutoffAt: day?.cutoff_at ?? "",
      youLead: (leads.get(r.team_id) ?? []).some((l) => l.membershipId === ctx.membership.id),
      otherLeads: (leads.get(r.team_id) ?? []).filter((l) => l.membershipId !== ctx.membership.id).map((l) => l.name),
      posted: r.status === "posted" && r.posted_at ? {
        at: r.posted_at, messageId: r.message_id,
        href: r.message_id && r.conversation_id ? evidenceHref(ctx.org.slug, { kind: "message", id: r.message_id, conversationId: r.conversation_id }) : null,
        late: r.posted_late,
      } : null,
      canUnskip: r.status === "skipped" && day?.status === "open" && Date.parse(day.cutoff_at) > now,
      seen: !!r.seen_at, href: standupEntryHref(ctx.org.slug, r.id), timeZone: ctx.org.timezone,
    };
  });
}

/** One of the person's standups, or null (not theirs, or before 0050). */
export async function getStandupEntry(ctx: OrgContext, id: string): Promise<StandupEntryView | null> {
  if (!isUuid(id)) return null;
  return personRead<StandupEntryView | null>(ctx, null, async (db) => (await entryViewsIn(db, ctx, "e.id = $3", [id]))[0] ?? null);
}

async function entryOrThrow(db: Db, ctx: OrgContext, id: string): Promise<StandupEntryView> {
  const v = (await entryViewsIn(db, ctx, "e.id = $3", [id]))[0];
  if (!v) throw notYours();
  return v;
}

type RollupViewRow = { id: string; team_id: string; team_name: string; local_date: string; status: "open" | "sent" | "skipped"; reason: string | null; content: StandupRollupContent | null; cutoff_at: string; seen_at: string | null };
const ROLLUP_VIEW_SQL = `SELECT r.id, r.team_id, t.name AS team_name, r.local_date::text AS local_date, r.status, r.reason, r.content, r.cutoff_at, x.seen_at
  FROM standup_rollups r JOIN standup_rollup_recipients x ON x.rollup_id = r.id AND x.membership_id = $2 JOIN teams t ON t.id = r.team_id`;

function rollupViewOf(r: RollupViewRow, ctx: OrgContext): StandupRollupView {
  const content = r.content && r.content.v === 1 ? { ...r.content, timeZone: r.content.timeZone ?? ctx.org.timezone } : null;
  return {
    id: r.id, team: { id: r.team_id, name: r.team_name }, localDate: r.local_date, dateLabel: standupDateLabel(r.local_date), status: r.status, reason: r.reason,
    content, seen: !!r.seen_at, href: standupRollupHref(ctx.org.slug, r.id), cutoffAt: r.cutoff_at, timeZone: ctx.org.timezone,
  };
}

/** One rollup the person receives, or 404 (not a recipient). 503 before 0050. */
export async function getStandupRollup(ctx: OrgContext, id: string): Promise<StandupRollupView> {
  if (!isUuid(id)) throw notFound(W.errors.rollupNotFound);
  return personTx(ctx, async (db) => {
    const r = await db.maybeOne<RollupViewRow>(`${ROLLUP_VIEW_SQL} WHERE r.id = $1 AND r.organisation_id = $3`, [id, ctx.membership.id, ctx.org.id]);
    if (!r) throw notFound(W.errors.rollupNotFound);
    return rollupViewOf(r, ctx);
  });
}

/**
 * The person's standup today (their entries in any state, in every team that runs one) and the rollups they receive
 * from the last `days` days (1 to 7; today by default), newest first. `off`: the workspace does not offer standup or the
 * person switched it off. `{ ready: false, … }` before 0050.
 */
export async function standupToday(ctx: OrgContext, o: { days?: number } = {}): Promise<StandupToday> {
  const days = Math.min(7, Math.max(1, Math.floor(Number(o.days) || 1)));
  return personRead<StandupToday>(ctx, { ready: false, off: false, entries: [], rollups: [] }, async (db) => {
    const today = localDateOf(new Date(), ctx.org.timezone);
    const a = await abilitiesIn(db, ctx.org.id, ctx.membership.id);
    const entries = await entryViewsIn(db, ctx, "e.local_date = $3::date", [today]);
    const rollups = await db.query<RollupViewRow>(
      `${ROLLUP_VIEW_SQL} WHERE r.organisation_id = $1 AND r.local_date > $3::date - $4::int ORDER BY r.local_date DESC, t.name, r.id`,
      [ctx.org.id, ctx.membership.id, today, days]);
    const off = a.workspaceOff.includes("standup") || a.personalOff.includes("standup");
    return {
      ready: true, off, entries, rollups: rollups.map((r) => rollupViewOf(r, ctx)),
      upcoming: off ? [] : await upcomingIn(db, ctx, today),
    };
  });
}

/**
 * The person's teams whose standup runs today and has not opened yet (fix review, 9 October 2026: before the post time
 * her page said "No standup today" and told a lead to switch on what was already on): the times on the organisation's
 * clock, whether the person gets a draft (staff and leads; not owners and HR) and whether they receive the rollup.
 */
async function upcomingIn(db: Db, ctx: OrgContext, today: string): Promise<NonNullable<StandupToday["upcoming"]>> {
  const rows = await db.query<{ team_id: string; team_name: string; post_time: string; cutoff_time: string; days: number[] }>(
    `SELECT s.team_id, t.name AS team_name, to_char(s.post_time, 'HH24:MI') AS post_time, to_char(s.cutoff_time, 'HH24:MI') AS cutoff_time, s.days
     FROM team_standups s JOIN teams t ON t.id = s.team_id AND t.archived_at IS NULL
     JOIN team_members tm ON tm.team_id = s.team_id AND tm.membership_id = $2
     WHERE s.organisation_id = $1 AND s.enabled ORDER BY t.name, s.team_id`, [ctx.org.id, ctx.membership.id]);
  const out: NonNullable<StandupToday["upcoming"]> = [];
  const now = Date.now();
  for (const r of rows) {
    if (!daysOf(r.days).includes(weekdayOf(today))) continue;
    if (now >= localTimeOn(today, r.cutoff_time, ctx.org.timezone).getTime()) continue;
    // Opened already (the person got no draft: joined later, a day off): nothing is coming today.
    const opened = await withWorker((w) => w.maybeOne(`SELECT 1 FROM standup_rollups WHERE team_id = $1 AND local_date = $2`, [r.team_id, today]));
    if (opened) continue;
    const lead = (await recipientsIn(db, r.team_id)).some((x) => x.membershipId === ctx.membership.id);
    out.push({ teamId: r.team_id, teamName: r.team_name, time: r.post_time, cutoff: r.cutoff_time, drafts: ctx.membership.role === "employee" || ctx.membership.role === "manager", lead });
  }
  return out;
}

/** The notch's part: today's ready drafts and today's sent rollups not yet seen. `ready: false` before 0050. */
export async function standupForDesktop(ctx: OrgContext): Promise<DesktopStandup> {
  const t = await standupToday(ctx, { days: 1 });
  return { ready: t.ready, entries: t.entries.filter((e) => e.status === "ready"), rollups: t.rollups.filter((r) => r.status === "sent" && !r.seen) };
}

/**
 * The end-of-day report's Standup section, as its reader (only rollups they receive): each sent rollup of the day with
 * its counts and blockers. Null before 0050 or on any failure (the section is left out).
 */
export async function standupForReport(ctx: OrgContext, localDate: string): Promise<{ teams: { rollupId: string; team: string; posted: number; members: number; blockers: StandupRollupContent["blockers"]; href: string }[] } | null> {
  if (!DATE.test(localDate)) return null;
  try {
    return await personRead<{ teams: { rollupId: string; team: string; posted: number; members: number; blockers: StandupRollupContent["blockers"]; href: string }[] } | null>(ctx, null, async (db) => {
      const rows = await db.query<RollupViewRow>(
        `${ROLLUP_VIEW_SQL} WHERE r.organisation_id = $1 AND r.local_date = $3::date AND r.status = 'sent' AND r.content IS NOT NULL ORDER BY t.name, r.id`,
        [ctx.org.id, ctx.membership.id, localDate]);
      return {
        teams: rows.filter((r) => r.content?.v === 1).map((r) => ({
          rollupId: r.id, team: r.team_name, posted: r.content!.counts.posted, members: r.content!.counts.members,
          blockers: r.content!.blockers ?? [], href: standupRollupHref(ctx.org.slug, r.id),
        })),
      };
    });
  } catch (err) {
    warn("reading the report's standup")(err);
    return null;
  }
}

// ---- The person's steps (contract B.4, B.5, F.2) ---------------------------------------------------------------------------

/** The word a definer step answered, as the routes' errors. */
async function stepError(db: Db, ctx: OrgContext, id: string, word: string): Promise<AppError | null> {
  if (word === "ok") return null;
  if (word === "not_found") return notYours();
  const team = (await db.maybeOne<{ name: string }>(`SELECT t.name FROM standup_entries e JOIN teams t ON t.id = e.team_id WHERE e.id = $1`, [id]))?.name ?? "the team";
  switch (word) {
    case "closed": return conflict("STANDUP_CLOSED", W.errors.closed);
    case "too_late": return conflict("STANDUP_TOO_LATE", W.errors.tooLate(team));
    case "too_long": return new AppError(400, "INVALID_INPUT", W.errors.tooLong);
    case "invalid": return new AppError(400, "INVALID_INPUT", W.errors.invalid);
    case "empty": return new AppError(400, "INVALID_INPUT", W.errors.empty);
    case "not_in_team": return conflict("STANDUP_NOT_IN_TEAM", W.errors.notInTeam(team));
    case "off": return conflict("STANDUP_OFF", W.errors.teamOff(team));
    default: return conflict("STANDUP_CLOSED", W.errors.closed);
  }
}

export const standupEditSchema = z.object({
  yesterday: z.string().max(L.sectionMax * 4).optional(),
  today: z.string().max(L.sectionMax * 4).optional(),
  blocked: z.string().max(L.sectionMax * 4).optional(),
});

/**
 * The person's own words for one or more sections of a ready draft (cleaned: lib/standup cleanSection). 400 too long,
 * invalid or all three empty; 404 not theirs; 409 STANDUP_CLOSED once it is not ready; 409 STANDUP_OFF while the
 * workspace does not offer standup; 403 while someone else is signed in as them; 503 before 0050.
 */
export async function editStandup(ctx: OrgContext, id: string, texts: { yesterday?: string | null; today?: string | null; blocked?: string | null }): Promise<StandupEntryView> {
  onlyThePerson(ctx);
  if (!isUuid(id)) throw notYours();
  const clean = (v: string | null | undefined) => (typeof v === "string" ? cleanSection(v) : null);
  const y = clean(texts?.yesterday), t = clean(texts?.today), b = clean(texts?.blocked);
  for (const [field, v] of [["yesterday", y], ["today", t], ["blocked", b]] as const) {
    if (v !== null && v.length > L.sectionMax) throw bad(field, W.errors.tooLong);
  }
  return personTx(ctx, async (db) => {
    if (!(await workspaceOffers(db, ctx.org.id))) throw workspaceOff();
    const word = (await db.one<{ w: string }>(`SELECT app_standup_edit($1, $2, $3, $4) AS w`, [id, y, t, b])).w;
    const err = await stepError(db, ctx, id, word);
    if (err) throw err;
    return entryOrThrow(db, ctx, id);
  });
}

/** Skip today: the rollup lists them under No update like anyone who did not post. 404 not theirs; 409 closed; 403 impersonated. */
export async function skipStandup(ctx: OrgContext, id: string): Promise<StandupEntryView> {
  onlyThePerson(ctx);
  if (!isUuid(id)) throw notYours();
  return personTx(ctx, async (db) => {
    const err = await stepError(db, ctx, id, (await db.one<{ w: string }>(`SELECT app_standup_skip($1) AS w`, [id])).w);
    if (err) throw err;
    await readNotices(db, ctx.membership.id, entryNoticeKeys(id));
    return entryOrThrow(db, ctx, id);
  });
}

/**
 * Undo a skip while the day's rollup is still open: back to ready (or to drafting when it was never drafted; the sweep
 * drafts it). 409 STANDUP_TOO_LATE once the rollup has gone; 409 STANDUP_CLOSED when it is not skipped.
 */
export async function unskipStandup(ctx: OrgContext, id: string): Promise<StandupEntryView> {
  onlyThePerson(ctx);
  if (!isUuid(id)) throw notYours();
  const v = await personTx(ctx, async (db) => {
    const err = await stepError(db, ctx, id, (await db.one<{ w: string }>(`SELECT app_standup_unskip($1) AS w`, [id])).w);
    if (err) throw err;
    return entryOrThrow(db, ctx, id);
  });
  if (v.status === "drafting") {
    const now = new Date();
    await withWorker((db) => enqueueJob(db, "standup.sweep", {}, { dedupKey: `standup.sweep:${minuteKey(now)}` })).catch(warn("queueing the sweep"));
  }
  return v;
}

/** Opening the card marks it seen (nothing is written while someone else is signed in as the person). 404 not theirs. */
export async function markStandupSeen(ctx: OrgContext, id: string): Promise<{ ok: true }> {
  if (!isUuid(id)) throw notYours();
  if (ctx.user.impersonation) {
    if (!(await getStandupEntry(ctx, id))) throw notYours();
    return { ok: true };
  }
  return personTx(ctx, async (db) => {
    const err = await stepError(db, ctx, id, (await db.one<{ w: string }>(`SELECT app_standup_seen($1) AS w`, [id])).w);
    if (err) throw err;
    await readNotices(db, ctx.membership.id, entryNoticeKeys(id));
    return { ok: true as const };
  });
}

/** The lead opened their rollup: seen (nothing written while someone else is signed in as them). 404 not a recipient. */
export async function markRollupSeen(ctx: OrgContext, id: string): Promise<{ ok: true }> {
  if (!isUuid(id)) throw notFound(W.errors.rollupNotFound);
  return personTx(ctx, async (db) => {
    if (ctx.user.impersonation) {
      if (!(await db.maybeOne(`SELECT 1 FROM standup_rollup_recipients WHERE rollup_id = $1 AND membership_id = $2`, [id, ctx.membership.id]))) throw notFound(W.errors.rollupNotFound);
      return { ok: true as const };
    }
    const w = (await db.one<{ w: string }>(`SELECT app_standup_rollup_seen($1) AS w`, [id])).w;
    if (w !== "ok") throw notFound(W.errors.rollupNotFound);
    await readNotices(db, ctx.membership.id, [`standup.rollup:${id}:${ctx.membership.id}`]);
    return { ok: true as const };
  });
}

/**
 * Posts the person's standup to their team's channel (contract B.5): their press is the consent (a broadcast to a team:
 * nothing posts on its own, ever). One transaction as the person: the post check (holding the entry, so a second press
 * waits and then reads 'posted' and gets the first post back, `already: true`), the channel, their approved words as
 * 'via_assistant' (no mentions), the posted mark (which checks the message is theirs, via their assistant, in this
 * team's channel) — all or nothing. Then Brenda's log ("Posted your standup to #Design") and, for a post after the
 * rollup went, the sweep that adds it to the rollup's late list.
 * Errors: 403 while someone else is signed in as them; 404 not theirs; 409 STANDUP_CLOSED, STANDUP_NOT_IN_TEAM,
 * STANDUP_OFF (the workspace or the team), CONVERSATION_ARCHIVED; 503 before 0050.
 */
export async function postStandup(ctx: OrgContext, entryId: string): Promise<{ entry: StandupEntryView; message: { id: string; conversationId: string; href: string }; already?: true }> {
  onlyThePerson(ctx);
  if (!isUuid(entryId)) throw notYours();
  const done = await personTx(ctx, async (db) => {
    if (!(await workspaceOffers(db, ctx.org.id))) throw workspaceOff();
    const word = (await db.one<{ w: string }>(`SELECT app_standup_post_check($1) AS w`, [entryId])).w;
    if (word === "posted") {
      const entry = await entryOrThrow(db, ctx, entryId);
      return { entry, already: true as const, late: false };
    }
    const err = await stepError(db, ctx, entryId, word);
    if (err) throw err;
    const e = await db.one<{ team_id: string; team_name: string; local_date: string; yesterday_text: string; today_text: string; blocked_text: string; draft: unknown }>(
      `SELECT e.team_id, t.name AS team_name, e.local_date::text AS local_date, e.yesterday_text, e.today_text, e.blocked_text, e.draft
       FROM standup_entries e JOIN teams t ON t.id = e.team_id WHERE e.id = $1`, [entryId]);
    const conv = (await db.one<{ id: string }>(`SELECT app_channel_conversation($1, $2) AS id`, [ctx.org.id, e.team_id])).id;
    const archived = await db.maybeOne<{ archived: boolean }>(`SELECT archived_at IS NOT NULL AS archived FROM conversations WHERE id = $1`, [conv]);
    if (!archived || archived.archived) throw conflict("CONVERSATION_ARCHIVED", W.errors.archived);
    const draft = draftOf(e.draft);
    const view = (await entryViewsIn(db, ctx, "e.id = $3", [entryId]))[0];
    const body = standupPostBody({
      dateLabel: draft?.dateLabel ?? standupDateLabel(e.local_date), sinceLabel: view?.sinceLabel ?? draft?.sinceLabel ?? W.card.yesterday,
      texts: { yesterday: e.yesterday_text, today: e.today_text, blocked: e.blocked_text },
    });
    const msg = await insertViaAssistantIn(db, ctx, { conversationId: conv, body });
    const marked = (await db.one<{ w: string }>(`SELECT app_standup_mark_posted($1, $2) AS w`, [entryId, msg.id])).w;
    if (marked !== "ok") throw new Error(`standup: the posted mark answered ${marked}`);
    await readNotices(db, ctx.membership.id, entryNoticeKeys(entryId));
    // In the same transaction: no post without its audit row (ids only, never the words).
    await audit(db, {
      organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "standup.posted", subjectType: "standup_entry", subjectId: entryId,
      subjectMembershipId: ctx.membership.id, metadata: { teamId: e.team_id, messageId: msg.id },
    });
    const entry = await entryOrThrow(db, ctx, entryId);
    return { entry, already: undefined, late: !!entry.posted?.late, team: e.team_name };
  });
  const message = {
    id: done.entry.posted?.messageId ?? "", conversationId: done.entry.postTo.conversationId ?? "",
    href: done.entry.posted?.href ?? (done.entry.postTo.conversationId ? `/app/${ctx.org.slug}/messages?c=${done.entry.postTo.conversationId}` : ""),
  };
  if (done.already) return { entry: done.entry, message, already: true };
  await recordAction(ctx, {
    tool: "standup_post", summary: W.chat.posted(done.entry.postTo.name), outcome: "done", source: "confirm",
    detail: { href: message.href, at: clockOf(done.entry.posted?.at, ctx.org.timezone) },
  });
  if (done.late) {
    const now = new Date();
    await withWorker((db) => enqueueJob(db, "standup.sweep", {}, { dedupKey: `standup.sweep:${minuteKey(now)}` })).catch(warn("queueing the sweep for a late post"));
  }
  return { entry: done.entry, message };
}

// ---- What other files read --------------------------------------------------------------------------------------------------

/** The sections in order with their headings for a view ("Since Friday", "Today", "Blocked"). */
export function standupHeadings(v: Pick<StandupEntryView, "sinceLabel">): Record<StandupSection, string> {
  return { yesterday: v.sinceLabel, today: W.card.today, blocked: W.card.blocked };
}
