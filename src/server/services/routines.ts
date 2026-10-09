/**
 * Routines and quiet hours (owner decision, 8 October 2026: phase 7a, "Brenda keeps the loops closed"). Everyone can
 * have their own assistant run a built-in routine on a schedule ("Every Friday at 4pm, send me what's still owed",
 * "Every weekday at 9, brief me", "Every Friday at 4pm, chase stalled tasks on my team"), and set quiet hours when
 * nothing interrupts them. This file is the data and server side: the routines themselves (saved, changed, paused,
 * deleted, previewed, enabled), who may schedule a routine that chases other people, quiet hours and the person's own
 * time zone, the morning opener's "seen today" mark, and the worker's hooks that claim, finish, fail and deliver runs.
 * What each template reads and does is services/routine-templates (it runs as the person, with no model); the cadence
 * math is server/lib/routine-time; the shapes and words are lib/routines.
 *
 * The rules (owner decision, 8 October 2026; contract D):
 * - New routines start paused. The person previews one (what it would send now; nothing is sent) and presses Enable,
 *   which is their standing consent for exactly the action lines its preview showed (`consent`, kept with the lines'
 *   hash). The hash covers only what the routine does to others (template, teams, the per-run cap and, for a chase,
 *   the teams and people its preview named), so a change of time or name keeps it on and a change of teams turns it off
 *   until they enable it again. A run whose routine no longer matches its consent, or a chase that would now reach a
 *   team or person its Enable did not show, is skipped and the routine paused (review, 8 October 2026).
 * - With the assistant off for the workspace (AI_ASSISTANT: its plan, or an admin's override) no routine is set up or
 *   turned on (402) and runs are skipped (`plan`); pausing and deleting still work.
 * - A routine that chases other people (chase_stalled) needs lead rights while the workspace switch "Only leads can
 *   schedule routines that chase other people" is on (the default): the owner and HR for any team, a team lead for the
 *   teams they lead. Checked at create, at every change of teams, at Enable and at every run. Routines about the person
 *   themself never need rights.
 * - A run is not a chat turn: it never calls askFirst, runWithoutAsking or confirmAction; its only actions are its
 *   template's, as the person, within every existing limit and the recipients' own rules. Its context's `sessionId` is
 *   "routine", which copilot's consent rule refuses for any Confirm.
 * - Quiet hours: while the person is quiet a run's delivery is held, and when quiet hours end the held runs arrive
 *   together (two or more as one notification). Notifications that are not routine deliveries are still written.
 *
 * Every write checks that nobody is signed in as the person (support), audits (`routine.*`, metadata `{ template }`
 * only) and is logged in Brenda's log with neutral words (`personalSummary` names it for the person's own Activity).
 * Before migration 0046 every change answers 503 NOT_READY and every read says `ready: false` (server/lib/schema-0046).
 *
 * Phase 7b (owner decisions, 8 October 2026): the `loose_ends` template needs migration 0048 as well. Before it, the list
 * names it in `unavailable`, and setting one up, changing, previewing or enabling one answers 503 NOT_READY.
 *
 * Phase 7c (owner decisions, 8–9 October 2026: the abilities catalogue): "Routines" can be switched off for the
 * workspace or by the person, and a template needs its own ability as well (lib/abilities `TEMPLATE_ABILITY`: the
 * morning brief needs the morning opener, the chase needs follow-ups, loose ends needs loose ends). Either off: setting
 * one up, changing, previewing or enabling it answers 403 ABILITY_OFF with where to switch it on (pausing and deleting
 * still work); the list says so (`off`, and the templates in `unavailable` with `unavailableBecause`); and a run is
 * skipped ('ability_off') with the routine left on, so it runs again once the ability is back. Before migration 0050
 * nothing is ever off.
 */
import { z } from "zod";
import { withUser, withWorker, type Db } from "@/server/db";
import { requireFeature, type OrgContext } from "@/server/lib/api";
import { AppError, conflict, forbidden, invalid, notFound } from "@/server/lib/errors";
import { sha256 } from "@/server/lib/crypto";
import { isValidTimeZone, localDate } from "@/server/lib/time";
import { memberContext } from "@/server/lib/member-context";
import { forget0046, isMissingSchema, retryWithout0046, schema0046Ready } from "@/server/lib/schema-0046";
import { forget0047, personalTable, retryWithout0047 } from "@/server/lib/schema-0047";
import { schema0048Ready } from "@/server/lib/schema-0048";
import { LOOPS_NOT_READY_SHORT } from "@/lib/commitments";
import { abilitiesIn, abilityError } from "@/server/services/abilities";
import { TEMPLATE_ABILITY, abilityOff, type Abilities, type AbilityKey } from "@/lib/abilities";
import { nextRunAt, personTimeZone, quietState } from "@/server/lib/routine-time";
import { audit, notify } from "@/server/services/common";
import { logAction } from "@/server/services/brenda";
import { readPersonalAssistant } from "@/server/services/assistant-profile";
import { consentLines, runTemplate, type ChaseCover, type RoutineRow, type TemplateResult } from "@/server/services/routine-templates";
import {
  NO_QUIET, ROUTINES_NOT_READY, ROUTINE_LIMITS, ROUTINE_TEMPLATES, ROUTINE_WORDS, TIME_PATTERN,
  cadenceFrom, cadenceWords, isChasing, routinePlainLines,
  type Cadence, type Delivery, type PausedReason, type QuietHours, type QuietState, type RoutineInput, type RoutineList,
  type RoutineOutput, type RoutineParams, type RoutinePatch, type RoutinePreview, type RoutineRunView, type RoutineTemplate,
  type RoutineView, type RunStatus,
} from "@/lib/routines";

const W = ROUTINE_WORDS;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
/** The id a preview of a routine not yet saved runs under: it has reported nothing and owns nothing. */
const DRAFT_ID = "00000000-0000-0000-0000-000000000000";
const clamp = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`);

// ---- What the routes take ---------------------------------------------------------------------------------------------

export const cadenceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("daily") }), z.object({ kind: z.literal("weekdays") }),
  z.object({ kind: z.literal("weekly"), days: z.array(z.number().int().min(0).max(6)).min(1, W.errors.pickDay).max(7) }),
  z.object({ kind: z.literal("monthly"), day: z.number().int().min(0).max(31) }),
]);
export const routineInputSchema = z.object({
  template: z.enum(ROUTINE_TEMPLATES), name: z.string().trim().min(1).max(80).refine((v) => !/\p{Cc}/u.test(v), "Use letters, numbers and punctuation only.").optional(),
  cadence: cadenceSchema, time: z.string().regex(TIME_PATTERN, W.errors.time),
  quietWhenEmpty: z.boolean().optional(), teamIds: z.array(z.string().uuid()).max(20).nullable().optional(),
});
export const routinePatchSchema = routineInputSchema.omit({ template: true }).partial();
export const enableSchema = z.object({ consentHash: z.string().regex(/^[0-9a-f]{64}$/, W.errors.consentChanged) });
export const quietHoursSchema = z.object({
  enabled: z.boolean(),
  start: z.string().regex(TIME_PATTERN, W.errors.time).optional(),
  end: z.string().regex(TIME_PATTERN, W.errors.time).optional(),
  days: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  timezone: z.string().max(64).nullable().optional(),
});
export type QuietHoursInput = z.infer<typeof quietHoursSchema>;
export const routineSettingsSchema = z.object({ chaseLeadsOnly: z.boolean({ error: W.errors.sayChaseLeadsOnly }) });
/** Small JSON bodies only: the routes refuse more than this unread (413). */
export const ROUTINE_BODY_MAX = 8192;

/** Parses with a schema, as a 422 with the fields named (the services are called by the chat as well as the routes). */
function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const r = schema.safeParse(raw);
  if (r.success) return r.data;
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of r.error.issues) (fieldErrors[issue.path.join(".") || "_"] ??= []).push(issue.message);
  throw invalid("Check the highlighted fields.", fieldErrors);
}

// ---- Shared pieces ------------------------------------------------------------------------------------------------------

const notReady = () => new AppError(503, "NOT_READY", ROUTINES_NOT_READY);
/** Templates that need a later migration than routines themselves (phase 7b: loose_ends needs 0048). */
const NEEDS_0048: readonly RoutineTemplate[] = ["loose_ends"];
/** 503 NOT_READY for a template whose migration is not applied yet (phase 7b), in the caller's transaction. */
async function templateReady(db: Db, template: RoutineTemplate): Promise<void> {
  if (NEEDS_0048.includes(template) && !(await schema0048Ready(db))) throw new AppError(503, "NOT_READY", LOOPS_NOT_READY_SHORT);
}
/** The templates that cannot be set up here yet (`RoutineList.unavailable`). */
async function unavailableTemplates(db: Db): Promise<RoutineTemplate[]> {
  return (await schema0048Ready(db)) ? [] : [...NEEDS_0048];
}
/**
 * Which ability stops this template now, for this person (phase 7c): "routines" itself first, then the template's own
 * (TEMPLATE_ABILITY); null when both are on (and always before 0050).
 */
function abilityStop(a: Abilities, template: RoutineTemplate | null): { key: AbilityKey; off: "workspace" | "personal" } | null {
  const own = abilityOff(a, "routines");
  if (own) return { key: "routines", off: own };
  const needs = template ? TEMPLATE_ABILITY[template] : null;
  const t = needs ? abilityOff(a, needs) : null;
  return needs && t ? { key: needs, off: t } : null;
}

/** 403 ABILITY_OFF when routines or the template's ability is switched off for this person, in their transaction. */
async function requireRoutineAbility(db: Db, ctx: OrgContext, template: RoutineTemplate | null): Promise<void> {
  const stop = abilityStop(await abilitiesIn(db, ctx.org.id, ctx.membership.id), template);
  if (stop) throw await abilityError(ctx, stop.key, stop.off, db);
}

const notYours = () => notFound(W.errors.notYours);
function notWhileImpersonated(ctx: OrgContext, message: string = W.errors.impersonated) {
  if (ctx.user.impersonation) throw forbidden(message);
}
const canEditWorkspace = (ctx: Pick<OrgContext, "membership">) => ctx.membership.role === "owner" || ctx.membership.role === "hr";
const settingsHref = (slug: string) => `/app/${slug}/settings?section=assistant#routines`;
const runHref = (slug: string, runId: string) => `/app/${slug}/home/routines/${runId}`;

/** A change, in the person's own transaction: 503 before 0046 (and once more on the fallback path after a restore). */
function personTx<T>(ctx: OrgContext, fn: (db: Db) => Promise<T>): Promise<T> {
  return retryWithout0046(() => retryWithout0047(() => withUser(ctx.user.profileId, async (db) => {
    if (!(await schema0046Ready(db))) throw notReady();
    return fn(db);
  })));
}

/** A read, in the person's own transaction: `fallback` before 0046, never a broken page. */
async function personRead<T>(ctx: OrgContext, fallback: T, fn: (db: Db) => Promise<T>): Promise<T> {
  try {
    return await retryWithout0046(() => retryWithout0047(() => withUser(ctx.user.profileId, async (db) => ((await schema0046Ready(db)) ? fn(db) : fallback))));
  } catch (err) {
    if (!isMissingSchema(err)) throw err;
    forget0046();
    forget0047();
    return fallback;
  }
}

type DbRoutine = {
  id: string; organisation_id: string; membership_id: string; template: RoutineTemplate; name: string; params: Record<string, unknown> | null;
  cadence: string; days: number[] | null; day_of_month: number | null; time_of_day: string; quiet_when_empty: boolean; enabled: boolean;
  paused_reason: PausedReason | null; consent: Record<string, unknown> | null; next_run_at: string | null; last_run_at: string | null;
  last_status: Exclude<RunStatus, "running"> | null; failures: number; deleted_at: string | null; created_at: string;
};
const ROUTINE_COLS = `r.id, r.organisation_id, r.membership_id, r.template, r.name, r.params, r.cadence, r.days, r.day_of_month,
  to_char(r.time_of_day, 'HH24:MI') AS time_of_day, r.quiet_when_empty, r.enabled, r.paused_reason, r.consent, r.next_run_at,
  r.last_run_at, r.last_status, r.failures, r.deleted_at, r.created_at`;

/** What a template's parameters may hold: chase_stalled's teams (sorted, each once; null: the teams the person leads). */
function paramsOf(template: RoutineTemplate, raw: { teamIds?: unknown } | null | undefined): RoutineParams {
  if (!isChasing(template)) return {};
  const ids = Array.isArray(raw?.teamIds) ? [...new Set(raw.teamIds.filter(isUuid).map((s) => s.toLowerCase()))].sort() : null;
  return { teamIds: ids && ids.length ? ids : null };
}

const cadenceOf = (r: Pick<DbRoutine, "cadence" | "days" | "day_of_month">): Cadence => cadenceFrom(r.cadence, r.days, r.day_of_month) ?? { kind: "daily" };

function cadenceColumns(c: Cadence): { cadence: Cadence["kind"]; days: number[]; dayOfMonth: number | null } {
  switch (c.kind) {
    case "weekly": return { cadence: "weekly", days: [...new Set(c.days)].sort((a, b) => a - b), dayOfMonth: null };
    case "monthly": return { cadence: "monthly", days: [], dayOfMonth: c.day };
    default: return { cadence: c.kind, days: [], dayOfMonth: null };
  }
}

const idList = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter(isUuid).map((s) => s.toLowerCase()))].sort() : []);

/** A chase's cover as the consent keeps it (null when it has none: an older consent, or a routine about the person). */
function coverOf(raw: unknown): ChaseCover | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const c = raw as { teams?: unknown; people?: unknown };
  if (!Array.isArray(c.teams) || !Array.isArray(c.people)) return null;
  return { teams: idList(c.teams), people: idList(c.people) };
}

function consentOf(raw: Record<string, unknown> | null | undefined): RoutineRow["consent"] {
  if (!raw || typeof raw.hash !== "string") return null;
  return {
    hash: raw.hash,
    lines: Array.isArray(raw.lines) ? raw.lines.filter((l): l is string => typeof l === "string") : [],
    at: typeof raw.at === "string" ? raw.at : "",
    cover: coverOf(raw.cover),
  };
}

function rowOf(r: DbRoutine): RoutineRow {
  return {
    id: r.id, organisationId: r.organisation_id, membershipId: r.membership_id, template: r.template, name: r.name,
    params: paramsOf(r.template, r.params as { teamIds?: unknown }), cadence: cadenceOf(r), time: r.time_of_day,
    quietWhenEmpty: r.quiet_when_empty, enabled: r.enabled, consent: consentOf(r.consent),
  };
}

/**
 * The hash a routine's consent is kept with (contract D.2): what it does to others, nothing else. Its template, the
 * teams it chases (sorted, or null for "the teams I lead") and the per-run cap; cadence, time, name and the quiet
 * switch are not in it, so changing them keeps the routine on.
 *
 * A chase's hash also covers who its preview named (`cover`: the teams it resolved to and the people on them, review,
 * 8 October 2026): the preview and Enable compute it from the teams and people as they are, so a team or a person
 * added between the two refuses Enable (409 CONSENT_CHANGED), and a run checks that it reaches nobody outside the
 * cover kept with the consent. Without `cover` (a change of settings, comparing parameters only) it is the hash of the
 * parameters alone; a routine about the person ignores it.
 */
export function consentHash(r: Pick<RoutineRow, "template" | "params">, cover?: ChaseCover | null): string {
  const chasing = isChasing(r.template);
  const teamIds = chasing ? paramsOf(r.template, r.params).teamIds ?? null : null;
  const base = { v: 1, template: r.template, params: { teamIds }, caps: { chasePerRun: ROUTINE_LIMITS.chasePerRun } };
  return sha256(JSON.stringify(chasing && cover ? { ...base, cover: { teams: idList(cover.teams), people: idList(cover.people) } } : base));
}

/** Whether every team and person a chase covers now was in the cover its Enable showed. */
function withinCover(now: ChaseCover, kept: ChaseCover): boolean {
  return now.teams.every((t) => kept.teams.includes(t)) && now.people.every((p) => kept.people.includes(p));
}

/** The person's zone (their own when set and known, else the organisation's), read in a transaction the caller holds. */
async function zoneOf(db: Db, orgTz: string, membershipId: string): Promise<string> {
  const r = await db.maybeOne<{ tz: string | null }>(`SELECT timezone AS tz FROM ${await personalTable(db)} WHERE membership_id = $1`, [membershipId]);
  return personTimeZone(r?.tz, orgTz);
}

/**
 * The person's own time zone as an SQL expression on `membership` (NULL: the organisation's), from the table that holds
 * it (0047's assistant_private, or 0046's column before it; server/lib/schema-0047).
 */
async function ownZoneSql(db: Db, membership: string): Promise<string> {
  return `(SELECT own.timezone FROM ${await personalTable(db)} own WHERE own.membership_id = ${membership})`;
}

type LiveTeam = { id: string; name: string; lead: boolean };

/** The organisation's live teams, with whether the person leads each. */
async function liveTeams(db: Db, ctx: Pick<OrgContext, "org" | "membership">): Promise<LiveTeam[]> {
  return db.query<LiveTeam>(
    `SELECT t.id, t.name, EXISTS (SELECT 1 FROM team_members tm WHERE tm.team_id = t.id AND tm.membership_id = $2 AND tm.is_manager) AS lead
     FROM teams t WHERE t.organisation_id = $1 AND t.archived_at IS NULL ORDER BY t.name, t.id`, [ctx.org.id, ctx.membership.id]);
}

/** The teams a chase covers now, for display: the named live ones, or the live teams the person leads. */
function coveredTeams(params: RoutineParams, live: LiveTeam[]): { id: string; name: string }[] {
  const picked = params.teamIds ? live.filter((t) => params.teamIds!.includes(t.id)) : live.filter((t) => t.lead);
  return picked.map((t) => ({ id: t.id, name: t.name }));
}

function viewOf(r: DbRoutine, tz: string, live: LiveTeam[] | null): RoutineView {
  const cadence = cadenceOf(r);
  const params = paramsOf(r.template, r.params as { teamIds?: unknown });
  const consent = consentOf(r.consent);
  return {
    id: r.id, template: r.template, name: r.name, cadence, time: r.time_of_day, timezone: tz, quietWhenEmpty: r.quiet_when_empty,
    enabled: r.enabled, pausedReason: r.enabled ? null : (r.paused_reason ?? "person"), params,
    teams: isChasing(r.template) && live ? coveredTeams(params, live) : [],
    scheduleWords: cadenceWords(cadence, r.time_of_day),
    nextRunAt: r.enabled ? r.next_run_at : null, lastRunAt: r.last_run_at, lastStatus: r.last_status,
    consent: consent ? { lines: consent.lines, at: consent.at } : null,
    createdAt: r.created_at,
  };
}

/** The person's routine (not someone else's: RLS hides those, and the membership is checked again), or null. */
async function loadOwn(db: Db, ctx: OrgContext, id: string, opts: { lock?: boolean } = {}): Promise<DbRoutine | null> {
  if (!isUuid(id)) return null;
  return db.maybeOne<DbRoutine>(
    `SELECT ${ROUTINE_COLS} FROM routines r WHERE r.id = $1 AND r.membership_id = $2 AND r.organisation_id = $3${opts.lock ? " FOR UPDATE" : ""}`,
    [id, ctx.membership.id, ctx.org.id]);
}

async function viewIn(db: Db, ctx: OrgContext, id: string): Promise<RoutineView> {
  const r = await loadOwn(db, ctx, id);
  if (!r || r.deleted_at) throw notYours();
  const tz = await zoneOf(db, ctx.org.timezone, ctx.membership.id);
  return viewOf(r, tz, isChasing(r.template) ? await liveTeams(db, ctx) : null);
}

/** Brenda's log and the audit trail for one change (metadata names only the template). */
async function record(db: Db, ctx: OrgContext, r: { id: string; template: RoutineTemplate; name: string }, what: "created" | "updated" | "enabled" | "paused" | "deleted") {
  await audit(db, {
    organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: `routine.${what}`, subjectType: "routine", subjectId: r.id,
    subjectMembershipId: ctx.membership.id, metadata: { template: r.template },
  });
  const words = {
    created: ["Set up a routine", `Set up “${r.name}”`],
    updated: ["Changed a routine", `Changed “${r.name}”`],
    enabled: ["Turned on a routine", `Turned on “${r.name}”`],
    paused: ["Paused a routine", `Paused “${r.name}”`],
    deleted: ["Deleted a routine", `Deleted “${r.name}”`],
  }[what];
  await logAction(db, ctx, {
    tool: "routine", outcome: "done", source: "confirm", summary: words[0],
    detail: { personalSummary: words[1], href: settingsHref(ctx.org.slug) },
  });
}

// ---- Lead rights and the workspace switch (contract D.1) ----------------------------------------------------------------

export type ChaseRights =
  | { ok: true; teams: { id: string; name: string }[] }
  | { ok: false; code: "no_teams" | "not_lead" | "team_gone"; message: string };

/**
 * Whether the person may have a routine chase these teams (null: the teams they lead), in a transaction the caller holds
 * (theirs, or the worker's at a run). The workspace switch on (the default): the owner and HR for any live team, a team
 * lead only for teams they lead, anyone else never. Off: anyone, for the named live teams. A team that is gone or
 * archived refuses (`team_gone`); no team at all refuses (`no_teams`). The follow-up permission still decides per person
 * at each run.
 */
export async function chaseRights(db: Db, ctx: Pick<OrgContext, "org" | "membership">, teamIds: string[] | null | undefined): Promise<ChaseRights> {
  const { chaseLeadsOnly } = await routineSettings(db, ctx.org.id);
  const role = ctx.membership.role;
  const ownerOrHr = role === "owner" || role === "hr";
  if (chaseLeadsOnly && !ownerOrHr && role !== "manager") return { ok: false, code: "not_lead", message: W.errors.notLead };
  const live = await liveTeams(db, ctx);
  let teams: LiveTeam[];
  if (teamIds === null || teamIds === undefined) {
    teams = live.filter((t) => t.lead);
  } else {
    const ids = [...new Set(teamIds.map((s) => String(s).toLowerCase()))];
    if (!ids.length) return { ok: false, code: "no_teams", message: W.errors.noTeams };
    teams = live.filter((t) => ids.includes(t.id));
    if (teams.length !== ids.length) return { ok: false, code: "team_gone", message: W.errors.teamGone };
  }
  if (!teams.length) return { ok: false, code: "no_teams", message: W.errors.noTeams };
  if (chaseLeadsOnly && !ownerOrHr && teams.some((t) => !t.lead)) return { ok: false, code: "not_lead", message: W.errors.notLead };
  return { ok: true, teams: teams.map((t) => ({ id: t.id, name: t.name })) };
}

const rightsError = (r: Extract<ChaseRights, { ok: false }>) => r.code === "not_lead" ? forbidden(r.message) : invalid(r.message, { teamIds: [r.message] });

/**
 * The people a chase would ask about, per team (everyone active on it but the person), for the consent lines, and the
 * cover those lines name (the team ids and the people's membership ids). The chase's own query takes the same people.
 */
async function teamPeople(db: Db, ctx: Pick<OrgContext, "org" | "membership">, teams: { id: string; name: string }[]): Promise<{ teams: { id: string; name: string; people: string[] }[]; cover: ChaseCover }> {
  if (!teams.length) return { teams: [], cover: { teams: [], people: [] } };
  const rows = await db.query<{ team_id: string; membership_id: string; name: string }>(
    `SELECT tm.team_id, tm.membership_id, p.display_name AS name
     FROM team_members tm JOIN memberships m ON m.id = tm.membership_id AND m.status = 'active' JOIN profiles p ON p.id = m.user_id
     WHERE tm.organisation_id = $1 AND tm.team_id = ANY($2::uuid[]) AND tm.membership_id <> $3
     ORDER BY p.display_name`, [ctx.org.id, teams.map((t) => t.id), ctx.membership.id]);
  return {
    teams: teams.map((t) => ({ id: t.id, name: t.name, people: rows.filter((r) => r.team_id === t.id).map((r) => r.name) })),
    cover: { teams: idList(teams.map((t) => t.id)), people: idList(rows.map((r) => r.membership_id)) },
  };
}

/** "Only leads can schedule routines that chase other people" (members may read it): `{ ready: false, chaseLeadsOnly: true }` before 0046. */
export async function routineSettings(db: Db, orgId: string): Promise<{ ready: boolean; chaseLeadsOnly: boolean }> {
  if (!(await schema0046Ready(db))) return { ready: false, chaseLeadsOnly: true };
  const r = await db.maybeOne<{ v: boolean }>(`SELECT routines_chase_leads_only AS v FROM brenda_settings WHERE organisation_id = $1`, [orgId]);
  return { ready: true, chaseLeadsOnly: r?.v ?? true };
}

/** As routineSettings, in its own transaction, for pages and routes. Never throws for a missing schema. */
export function routineSettingsFor(ctx: OrgContext): Promise<{ ready: boolean; chaseLeadsOnly: boolean }> {
  return personRead(ctx, { ready: false, chaseLeadsOnly: true }, (db) => routineSettings(db, ctx.org.id));
}

/**
 * Owners and HR, under the organisation's Brenda settings lock, logged in Brenda's log. Routines that lose their rights
 * are not changed now: they pause at their next run (`no_rights`) and their owner is told.
 */
export async function saveRoutineSettings(ctx: OrgContext, p: { chaseLeadsOnly: boolean }): Promise<{ ready: true; chaseLeadsOnly: boolean }> {
  if (!canEditWorkspace(ctx)) throw forbidden(W.errors.settingsForbidden);
  notWhileImpersonated(ctx, W.errors.settingsForbidden);
  const { chaseLeadsOnly } = parse(routineSettingsSchema, p);
  return personTx(ctx, async (db) => {
    await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`brenda_settings:${ctx.org.id}`]);
    await db.query(
      `INSERT INTO brenda_settings(organisation_id, routines_chase_leads_only, updated_by, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (organisation_id) DO UPDATE SET routines_chase_leads_only = $2, updated_by = $3, updated_at = now()`, [ctx.org.id, chaseLeadsOnly, ctx.membership.id]);
    await logAction(db, ctx, {
      tool: "settings", outcome: "done", source: "confirm",
      summary: chaseLeadsOnly ? "Routines that chase other people: leads only" : "Routines that chase other people: anyone",
    });
    return { ready: true as const, chaseLeadsOnly };
  });
}

/**
 * The teams the person may pick for a chase now, and whether they may chase at all: the owner and HR every live team; a
 * team lead the teams they lead (every live team while the switch is off); anyone else none while it is on.
 */
export async function chaseTeamsFor(ctx: OrgContext): Promise<RoutineList["chase"]> {
  return personRead(ctx, { allowed: false, leadsOnly: true, teams: [] }, (db) => chaseTeamsIn(db, ctx));
}

async function chaseTeamsIn(db: Db, ctx: OrgContext): Promise<RoutineList["chase"]> {
  const { chaseLeadsOnly } = await routineSettings(db, ctx.org.id);
  const live = await liveTeams(db, ctx);
  const role = ctx.membership.role;
  const teams = role === "owner" || role === "hr" || !chaseLeadsOnly ? live
    : role === "manager" ? live.filter((t) => t.lead) : [];
  return { allowed: teams.length > 0, leadsOnly: chaseLeadsOnly, teams };
}

// ---- Reading routines and runs --------------------------------------------------------------------------------------------

// Before 0046 nothing is available (`ready: false`), so `unavailable` is left out; from 0046 it names what still waits.
const EMPTY_LIST = (): RoutineList => ({ ready: false, routines: [], limits: { perPerson: ROUTINE_LIMITS.perPerson }, chase: { allowed: false, leadsOnly: true, teams: [] } });

/** The person's routines (not deleted), oldest first, with what a chase may cover. `ready: false` before 0046. */
export async function listRoutines(ctx: OrgContext): Promise<RoutineList> {
  return personRead(ctx, EMPTY_LIST(), async (db) => {
    const rows = await db.query<DbRoutine>(
      `SELECT ${ROUTINE_COLS} FROM routines r WHERE r.membership_id = $1 AND r.organisation_id = $2 AND r.deleted_at IS NULL ORDER BY r.created_at, r.id`,
      [ctx.membership.id, ctx.org.id]);
    const tz = await zoneOf(db, ctx.org.timezone, ctx.membership.id);
    const live = rows.some((r) => isChasing(r.template)) ? await liveTeams(db, ctx) : null;
    // Phase 7c: routines switched off (`off`), and the templates whose own ability is off (in `unavailable` too).
    const a = await abilitiesIn(db, ctx.org.id, ctx.membership.id);
    const unavailableBecause: Partial<Record<RoutineTemplate, AbilityKey>> = {};
    for (const t of ROUTINE_TEMPLATES) {
      const needs = TEMPLATE_ABILITY[t];
      if (needs && abilityOff(a, needs)) unavailableBecause[t] = needs;
    }
    const unavailable = [...new Set([...(await unavailableTemplates(db)), ...(Object.keys(unavailableBecause) as RoutineTemplate[])])];
    return {
      ready: true, routines: rows.map((r) => viewOf(r, tz, live)), limits: { perPerson: ROUTINE_LIMITS.perPerson },
      chase: await chaseTeamsIn(db, ctx), unavailable, off: abilityOff(a, "routines"), unavailableBecause,
    };
  });
}

/** One of the person's routines; 404 when it is not theirs or was deleted; 503 before 0046. */
export async function getRoutine(ctx: OrgContext, id: string): Promise<RoutineView> {
  return personTx(ctx, (db) => viewIn(db, ctx, id));
}

type DbRun = {
  id: string; routine_id: string; routine_name: string; template: RoutineTemplate; due_at: string; started_at: string; finished_at: string | null;
  status: RunStatus; reason: string | null; summary: string | null; delivery: Delivery; held_until: string | null; delivered_at: string | null;
  counts: Record<string, number | null> | null; output: RoutineOutput | null;
};
const RUN_COLS = `rr.id, rr.routine_id, ro.name AS routine_name, ro.template, rr.due_at, rr.started_at, rr.finished_at, rr.status, rr.reason,
  rr.summary, rr.delivery, rr.held_until, rr.delivered_at, rr.counts`;

function runViewOf(r: DbRun, slug: string, withOutput: boolean): RoutineRunView {
  return {
    id: r.id, routineId: r.routine_id, routineName: r.routine_name, template: r.template, dueAt: r.due_at, startedAt: r.started_at,
    finishedAt: r.finished_at, status: r.status, reason: r.reason, summary: r.summary, delivery: r.delivery, heldUntil: r.held_until,
    deliveredAt: r.delivered_at, counts: r.counts ?? {}, output: withOutput && r.output && r.output.v === 1 ? r.output : null,
    href: runHref(slug, r.id),
  };
}

const RUNS_PAGE = 20;

/**
 * The person's runs, newest first, 20 a page (`before`: the last page's `nextBefore`): one routine's (`routineId`, its
 * history; 404 when it is not theirs, kept readable after it was deleted) or all of theirs (the /home/routines page).
 * Lists carry no output (`output: null`); `getRun` has it. `ready: false` before 0046.
 */
export async function listRuns(ctx: OrgContext, opts: { routineId?: string | null; before?: string | null; limit?: number } = {}): Promise<{ ready: boolean; runs: RoutineRunView[]; nextBefore: string | null }> {
  const limit = Math.min(Math.max(Math.floor(opts.limit ?? RUNS_PAGE), 1), 50);
  const before = opts.before ? new Date(opts.before) : null;
  if (before && Number.isNaN(before.getTime())) throw invalid("Use the link from the previous page.");
  return personRead<{ ready: boolean; runs: RoutineRunView[]; nextBefore: string | null }>(ctx, { ready: false, runs: [], nextBefore: null }, async (db) => {
    if (opts.routineId) {
      const own = await loadOwn(db, ctx, opts.routineId);
      if (!own) throw notYours();
    }
    const rows = await db.query<DbRun>(
      `SELECT ${RUN_COLS} FROM routine_runs rr JOIN routines ro ON ro.id = rr.routine_id
       WHERE rr.membership_id = $1 AND rr.organisation_id = $2 AND ($3::uuid IS NULL OR rr.routine_id = $3) AND ($4::timestamptz IS NULL OR rr.started_at < $4)
       ORDER BY rr.started_at DESC, rr.id DESC LIMIT $5`,
      [ctx.membership.id, ctx.org.id, opts.routineId ?? null, before?.toISOString() ?? null, limit]);
    return { ready: true, runs: rows.map((r) => runViewOf(r, ctx.org.slug, false)), nextBefore: rows.length === limit ? rows[rows.length - 1].started_at : null };
  });
}

/** One of the person's runs with its output; 404 when it is not theirs; 503 before 0046. */
export async function getRun(ctx: OrgContext, runId: string): Promise<RoutineRunView> {
  return personTx(ctx, async (db) => {
    if (!isUuid(runId)) throw notFound(W.errors.runNotFound);
    const r = await db.maybeOne<DbRun>(
      `SELECT ${RUN_COLS}, rr.output FROM routine_runs rr JOIN routines ro ON ro.id = rr.routine_id
       WHERE rr.id = $1 AND rr.membership_id = $2 AND rr.organisation_id = $3`, [runId, ctx.membership.id, ctx.org.id]);
    if (!r) throw notFound(W.errors.runNotFound);
    return runViewOf(r, ctx.org.slug, true);
  });
}

// ---- Changing routines ----------------------------------------------------------------------------------------------------

/**
 * Saves a new routine, paused (`pausedReason 'new'`, no next run): the person previews it and enables it. 409
 * ROUTINE_LIMIT past 20; a chase needs lead rights (403) and a live team (422).
 */
export async function createRoutine(ctx: OrgContext, raw: RoutineInput): Promise<RoutineView> {
  // Routines are the assistant's: with it off for the workspace (its plan, or an admin's override) none is set up or
  // turned on, and the worker skips their runs (review, 8 October 2026). Pausing and deleting still work.
  requireFeature(ctx, "AI_ASSISTANT");
  notWhileImpersonated(ctx);
  const input = parse(routineInputSchema, raw);
  const params = paramsOf(input.template, { teamIds: input.teamIds ?? null });
  if (isChasing(input.template) && Array.isArray(input.teamIds) && !input.teamIds.length) throw invalid(W.errors.noTeams, { teamIds: [W.errors.noTeams] });
  const name = input.name ?? W.templates[input.template].defaultName;
  const cols = cadenceColumns(input.cadence);
  return personTx(ctx, async (db) => {
    // One person's count and insert in order: two tabs can't both add the 20th.
    await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`routines:${ctx.membership.id}`]);
    await templateReady(db, input.template);
    await requireRoutineAbility(db, ctx, input.template);
    const { n } = await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM routines WHERE membership_id = $1 AND deleted_at IS NULL`, [ctx.membership.id]);
    if (n >= ROUTINE_LIMITS.perPerson) throw conflict("ROUTINE_LIMIT", W.errors.limit);
    if (isChasing(input.template)) {
      const rights = await chaseRights(db, ctx, params.teamIds ?? null);
      if (!rights.ok) throw rightsError(rights);
    }
    const row = await db.one<{ id: string }>(
      `INSERT INTO routines(organisation_id, membership_id, template, name, params, cadence, days, day_of_month, time_of_day, quiet_when_empty, enabled, paused_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7::smallint[], $8, $9::time, $10, false, 'new') RETURNING id`,
      [ctx.org.id, ctx.membership.id, input.template, name, JSON.stringify(params), cols.cadence, cols.days, cols.dayOfMonth, input.time, input.quietWhenEmpty ?? true]);
    await record(db, ctx, { id: row.id, template: input.template, name }, "created");
    return viewIn(db, ctx, row.id);
  });
}

/**
 * Changes a routine. A change of what a chase covers (its teams) turns it off and clears its consent (`consent_changed`
 * when it had one): the person previews and enables it again. Any other change keeps it as it is, and an enabled one's
 * next run moves with its time.
 */
export async function updateRoutine(ctx: OrgContext, id: string, raw: RoutinePatch): Promise<RoutineView> {
  notWhileImpersonated(ctx);
  const patch = parse(routinePatchSchema, raw);
  return personTx(ctx, async (db) => {
    const r = await loadOwn(db, ctx, id, { lock: true });
    if (!r || r.deleted_at) throw notYours();
    await templateReady(db, r.template);
    await requireRoutineAbility(db, ctx, r.template);
    const before = rowOf(r);
    const name = patch.name ?? r.name;
    const cadence = patch.cadence ?? before.cadence;
    const time = patch.time ?? r.time_of_day;
    const quietWhenEmpty = patch.quietWhenEmpty ?? r.quiet_when_empty;
    let params = before.params;
    if (isChasing(r.template) && patch.teamIds !== undefined) {
      if (Array.isArray(patch.teamIds) && !patch.teamIds.length) throw invalid(W.errors.noTeams, { teamIds: [W.errors.noTeams] });
      params = paramsOf(r.template, { teamIds: patch.teamIds });
    }
    const paramsChanged = consentHash({ template: r.template, params }) !== consentHash(before);
    const cols = cadenceColumns(cadence);
    const timingChanged = cols.cadence !== r.cadence || JSON.stringify(cols.days) !== JSON.stringify([...(r.days ?? [])].sort((a, b) => a - b))
      || cols.dayOfMonth !== r.day_of_month || time !== r.time_of_day;
    if (!paramsChanged && !timingChanged && name === r.name && quietWhenEmpty === r.quiet_when_empty) return viewIn(db, ctx, r.id);
    if (paramsChanged) {
      const rights = await chaseRights(db, ctx, params.teamIds ?? null);
      if (!rights.ok) throw rightsError(rights);
    }
    let enabled = r.enabled;
    let pausedReason: PausedReason | null = r.paused_reason;
    let consent: Record<string, unknown> | null = r.consent;
    let next: string | null = r.next_run_at;
    if (paramsChanged) {
      const hadConsent = r.enabled || !!r.consent;
      enabled = false;
      pausedReason = hadConsent ? "consent_changed" : (r.paused_reason ?? "new");
      consent = null;
      next = null;
    } else if (r.enabled && timingChanged) {
      next = nextRunAt(cadence, time, await zoneOf(db, ctx.org.timezone, ctx.membership.id), new Date()).toISOString();
    }
    await db.query(
      `UPDATE routines SET name = $2, params = $3, cadence = $4, days = $5::smallint[], day_of_month = $6, time_of_day = $7::time, quiet_when_empty = $8,
         enabled = $9, paused_reason = $10, consent = $11, next_run_at = $12
       WHERE id = $1`,
      [r.id, name, JSON.stringify(params), cols.cadence, cols.days, cols.dayOfMonth, time, quietWhenEmpty, enabled, enabled ? null : pausedReason,
       consent ? JSON.stringify(consent) : null, enabled ? next : null]);
    await record(db, ctx, { id: r.id, template: r.template, name }, "updated");
    return viewIn(db, ctx, r.id);
  });
}

/** The person pauses a routine (`pausedReason 'person'`; its consent is kept, so Enable with the same preview works). */
export async function pauseRoutine(ctx: OrgContext, id: string): Promise<RoutineView> {
  notWhileImpersonated(ctx);
  return personTx(ctx, async (db) => {
    const r = await loadOwn(db, ctx, id, { lock: true });
    if (!r || r.deleted_at) throw notYours();
    if (r.enabled) {
      await db.query(`UPDATE routines SET enabled = false, paused_reason = 'person', next_run_at = NULL WHERE id = $1`, [r.id]);
      await record(db, ctx, r, "paused");
    }
    return viewIn(db, ctx, r.id);
  });
}

/** Deletes a routine (soft: it stops, and its runs stay readable in the person's history). */
export async function deleteRoutine(ctx: OrgContext, id: string): Promise<{ deleted: true }> {
  notWhileImpersonated(ctx);
  return personTx(ctx, async (db) => {
    const r = await loadOwn(db, ctx, id, { lock: true });
    if (!r) throw notYours();
    if (r.deleted_at) return { deleted: true as const };
    await db.query(
      `UPDATE routines SET deleted_at = now(), enabled = false, next_run_at = NULL, paused_reason = COALESCE(paused_reason, 'person') WHERE id = $1`, [r.id]);
    await record(db, ctx, r, "deleted");
    return { deleted: true as const };
  });
}

type Prepared = { row: RoutineRow; teams: { id: string; name: string; people: string[] }[]; cover: ChaseCover | null; assistantName: string; timeZone: string };

/** What a preview and Enable need, read as the person: the routine (or the draft), its teams' people, her name. */
async function prepare(db: Db, ctx: OrgContext, row: RoutineRow): Promise<Prepared> {
  let teams: Prepared["teams"] = [];
  let cover: ChaseCover | null = null;
  if (isChasing(row.template)) {
    const rights = await chaseRights(db, ctx, row.params.teamIds ?? null);
    if (!rights.ok) throw rightsError(rights);
    ({ teams, cover } = await teamPeople(db, ctx, rights.teams));
  }
  const assistant = await readPersonalAssistant(db, ctx.membership.id);
  return { row, teams, cover, assistantName: assistant.name, timeZone: await zoneOf(db, ctx.org.timezone, ctx.membership.id) };
}

/** A routine not saved yet, as a template sees it. */
function draftRow(ctx: OrgContext, input: z.infer<typeof routineInputSchema>): RoutineRow {
  return {
    id: DRAFT_ID, organisationId: ctx.org.id, membershipId: ctx.membership.id, template: input.template,
    name: input.name ?? W.templates[input.template].defaultName, params: paramsOf(input.template, { teamIds: input.teamIds ?? null }),
    cadence: input.cadence, time: input.time, quietWhenEmpty: input.quietWhenEmpty ?? true, enabled: false, consent: null,
  };
}

/**
 * What a routine (saved: its id; or a draft: its input) would send now, with nothing sent or recorded, and the action
 * lines Enable consents to with their hash (contract D.2). The template runs as the person (`mode: "preview"`).
 */
export async function previewRoutine(ctx: OrgContext, idOrInput: string | RoutineInput): Promise<RoutinePreview> {
  const prep = await personTx(ctx, async (db) => {
    if (typeof idOrInput === "string") {
      const r = await loadOwn(db, ctx, idOrInput);
      if (!r || r.deleted_at) throw notYours();
      await templateReady(db, r.template);
      await requireRoutineAbility(db, ctx, r.template);
      return prepare(db, ctx, rowOf(r));
    }
    const input = parse(routineInputSchema, idOrInput);
    await templateReady(db, input.template);
    await requireRoutineAbility(db, ctx, input.template);
    if (isChasing(input.template) && Array.isArray(input.teamIds) && !input.teamIds.length) throw invalid(W.errors.noTeams, { teamIds: [W.errors.noTeams] });
    return prepare(db, ctx, draftRow(ctx, input));
  });
  const result = await runTemplate(ctx, prep.row, { mode: "preview", now: new Date(), timeZone: prep.timeZone });
  const lines = consentLines(prep.row, { assistantName: prep.assistantName, teams: prep.teams });
  return { output: result.output, consent: { hash: consentHash(prep.row, prep.cover), lines } };
}

/** The consent kept with an enabled routine, trimmed to what the column holds (8 KB; a chase's cover is kept whole). */
function consentRecord(hash: string, lines: string[], at: string, cover: ChaseCover | null): { hash: string; lines: string[]; at: string; cover?: ChaseCover } {
  const kept: string[] = [];
  let size = 200 + (cover ? bytes(cover) : 0);
  for (const l of lines) {
    const line = clamp(String(l), 600);
    size += Buffer.byteLength(line) + 8;
    if (size > 7000) break;
    kept.push(line);
  }
  return cover ? { hash, lines: kept, at, cover } : { hash, lines: kept, at };
}

/**
 * Turns a routine on: the person's Enable press, with the hash of the preview they saw. A routine that changed since
 * (its teams, its template's actions) refuses with 409 CONSENT_CHANGED; a chase checks its rights again. Saves the
 * consent (the lines and their hash), clears the pause and the failures, and sets the next run.
 */
export async function enableRoutine(ctx: OrgContext, id: string, p: { consentHash: string }): Promise<RoutineView> {
  requireFeature(ctx, "AI_ASSISTANT");
  notWhileImpersonated(ctx);
  const { consentHash: seen } = parse(enableSchema, p);
  return personTx(ctx, async (db) => {
    const r = await loadOwn(db, ctx, id, { lock: true });
    if (!r || r.deleted_at) throw notYours();
    await templateReady(db, r.template);
    await requireRoutineAbility(db, ctx, r.template);
    const row = rowOf(r);
    // A chase's hash names the teams and people as they are now: one added since the preview refuses (409).
    const prep = await prepare(db, ctx, row);
    const hash = consentHash(row, prep.cover);
    if (hash !== seen) throw conflict("CONSENT_CHANGED", W.errors.consentChanged);
    const lines = consentLines(row, { assistantName: prep.assistantName, teams: prep.teams });
    const now = new Date();
    const next = nextRunAt(row.cadence, row.time, await zoneOf(db, ctx.org.timezone, ctx.membership.id), now);
    await db.query(
      `UPDATE routines SET enabled = true, paused_reason = NULL, failures = 0, consent = $2, next_run_at = $3 WHERE id = $1`,
      [r.id, JSON.stringify(consentRecord(hash, lines, now.toISOString(), prep.cover)), next.toISOString()]);
    await record(db, ctx, r, "enabled");
    return viewIn(db, ctx, r.id);
  });
}

// ---- Quiet hours and the person's time zone (contract B.4) -------------------------------------------------------------------

type QuietRow = { timezone: string | null; quiet_start: string | null; quiet_end: string | null; quiet_days: number[] | null };
const QUIET_COLS = `p.timezone, to_char(p.quiet_start, 'HH24:MI') AS quiet_start, to_char(p.quiet_end, 'HH24:MI') AS quiet_end, p.quiet_days`;

function quietOf(r: QuietRow | null, orgTz: string): QuietHours {
  const days = [...new Set((r?.quiet_days ?? []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);
  const on = !!r?.quiet_start && !!r?.quiet_end;
  return {
    enabled: on, start: on ? r!.quiet_start : null, end: on ? r!.quiet_end : null, days,
    ownTimezone: r?.timezone ?? null, timezone: personTimeZone(r?.timezone, orgTz),
  };
}

export type QuietHoursView = QuietHours & { ready: boolean; state: QuietState };

/** The person's quiet hours and time zone with whether they are quiet now. Before 0046: none, `ready: false`. */
export async function quietHoursFor(ctx: OrgContext, now = new Date()): Promise<QuietHoursView> {
  const fallback: QuietHoursView = { ready: false, enabled: false, start: null, end: null, days: [], ownTimezone: null, timezone: ctx.org.timezone, state: { ...NO_QUIET } };
  return personRead(ctx, fallback, async (db) => {
    const r = await db.maybeOne<QuietRow>(`SELECT ${QUIET_COLS} FROM ${await personalTable(db)} p WHERE p.membership_id = $1`, [ctx.membership.id]);
    const q = quietOf(r, ctx.org.timezone);
    return { ready: true, ...q, state: quietState(q, q.timezone, now) };
  });
}

/**
 * Saves the person's quiet hours and, when given, their own time zone (null: the workspace's). An unknown zone is a 400
 * ("Pick a time zone from the list."). Held routine deliveries are looked at again at the next sweep (their hold ends
 * now), and when the zone changed the next run of each enabled routine moves to the new zone. A person with no profile
 * row gets one with the look as it is and setup still not done. Not logged: a personal preference, as her voice.
 */
export async function saveQuietHours(ctx: OrgContext, raw: QuietHoursInput): Promise<QuietHoursView> {
  notWhileImpersonated(ctx, W.errors.impersonatedQuiet);
  const input = parse(quietHoursSchema, raw);
  if (typeof input.timezone === "string" && (!/^[A-Za-z0-9_+/-]{1,64}$/.test(input.timezone) || !isValidTimeZone(input.timezone))) {
    throw new AppError(400, "INVALID_TIME_ZONE", W.errors.invalidZone, { fieldErrors: { timezone: [W.errors.invalidZone] } });
  }
  let start: string | null = null, end: string | null = null;
  let days: number[] | undefined = input.days ? [...new Set(input.days)].sort((a, b) => a - b) : undefined;
  if (input.enabled) {
    if (!input.start || !input.end) throw invalid(W.errors.time, { [input.start ? "end" : "start"]: [W.errors.time] });
    if (input.start === input.end) throw invalid(W.quiet.sameTimes, { end: [W.quiet.sameTimes] });
    days ??= [0, 1, 2, 3, 4, 5, 6];
    if (!days.length) throw invalid(W.errors.pickDay, { days: [W.errors.pickDay] });
    start = input.start; end = input.end;
  }
  const saved = await personTx(ctx, async (db) => {
    const table = await personalTable(db);
    const prev = await db.maybeOne<QuietRow>(`SELECT ${QUIET_COLS} FROM ${table} p WHERE p.membership_id = $1 FOR UPDATE`, [ctx.membership.id]);
    const timezone = input.timezone === undefined ? (prev?.timezone ?? null) : input.timezone;
    const keepDays = days ?? prev?.quiet_days ?? [];
    const r = await db.one<QuietRow>(
      `INSERT INTO ${table}(membership_id, organisation_id, timezone, quiet_start, quiet_end, quiet_days, updated_at)
       VALUES ($1, $2, $3, $4::time, $5::time, $6::smallint[], now())
       ON CONFLICT (membership_id) DO UPDATE SET timezone = $3, quiet_start = $4::time, quiet_end = $5::time, quiet_days = $6::smallint[], updated_at = now()
       RETURNING timezone, to_char(quiet_start, 'HH24:MI') AS quiet_start, to_char(quiet_end, 'HH24:MI') AS quiet_end, quiet_days`,
      [ctx.membership.id, ctx.org.id, timezone, start, end, keepDays]);
    const before = personTimeZone(prev?.timezone, ctx.org.timezone);
    const after = personTimeZone(r.timezone, ctx.org.timezone);
    if (before !== after) {
      // The person's routines run on their own clock: each enabled one's next run moves to the new zone.
      const now = new Date();
      const rows = await db.query<DbRoutine>(
        `SELECT ${ROUTINE_COLS} FROM routines r WHERE r.membership_id = $1 AND r.enabled AND r.deleted_at IS NULL FOR UPDATE`, [ctx.membership.id]);
      for (const ro of rows) {
        await db.query(`UPDATE routines SET next_run_at = $2 WHERE id = $1`, [ro.id, nextRunAt(cadenceOf(ro), ro.time_of_day, after, now).toISOString()]);
      }
    }
    return quietOf(r, ctx.org.timezone);
  });
  // Runs held for quiet hours are decided again at the next sweep (the worker writes runs, the person never does).
  await withWorker((db) => db.query(`UPDATE routine_runs SET held_until = now() WHERE membership_id = $1 AND delivery = 'held'`, [ctx.membership.id]))
    .catch((err) => console.warn(`[routines] releasing held runs after quiet hours changed: ${(err as Error)?.message ?? String(err)}`));
  return { ready: true, ...saved, state: quietState(saved, saved.timezone, new Date()) };
}

/**
 * Whether a person is in their quiet hours, in a transaction the caller holds (as the worker, or as the person: since
 * 0047 nobody else reads them). Before 0046, or for someone not found: never quiet.
 */
export async function quietStateFor(db: Db, membershipId: string, now = new Date()): Promise<QuietState> {
  if (!(await schema0046Ready(db))) return { ...NO_QUIET };
  const r = await db.maybeOne<QuietRow & { org_tz: string }>(
    `SELECT o.timezone AS org_tz, ${QUIET_COLS}
     FROM memberships m JOIN organisations o ON o.id = m.organisation_id LEFT JOIN ${await personalTable(db)} p ON p.membership_id = m.id
     WHERE m.id = $1`, [membershipId]);
  if (!r) return { ready: true, active: false, until: null, nextStart: null };
  const q = quietOf(r, r.org_tz);
  return quietState(q, q.timezone, now);
}

// ---- The morning opener's "seen today" (contract E.2) ----------------------------------------------------------------------

/**
 * Whether the person has seen the morning opener on the web today (in their own zone), and when they last did
 * (`seenAt`: what "since" counts from). Before 0046: `{ ready: false, seenToday: null, seenAt: null }` (the web then
 * keeps the mark per browser).
 */
export async function openerSeen(ctx: OrgContext, now = new Date()): Promise<{ ready: boolean; seenToday: boolean | null; seenAt: string | null; timeZone: string }> {
  return personRead<{ ready: boolean; seenToday: boolean | null; seenAt: string | null; timeZone: string }>(ctx, { ready: false, seenToday: null, seenAt: null, timeZone: ctx.org.timezone }, async (db) => {
    const r = await db.maybeOne<{ seen: string | null; timezone: string | null }>(
      `SELECT opener_seen_at AS seen, timezone FROM ${await personalTable(db)} WHERE membership_id = $1`, [ctx.membership.id]);
    const tz = personTimeZone(r?.timezone, ctx.org.timezone);
    const seenAt = r?.seen ?? null;
    return { ready: true, seenToday: seenAt ? localDate(seenAt, tz) === localDate(now, tz) : false, seenAt, timeZone: tz };
  });
}

/**
 * The opener was on screen: marks it seen now. 403 while someone else is signed in as the person (nothing saved; the
 * opener still shows to them), 503 before 0046. A person with no profile row gets one with the defaults.
 */
export async function markOpenerSeen(ctx: OrgContext): Promise<{ seenAt: string }> {
  notWhileImpersonated(ctx, W.errors.impersonatedOpener);
  return personTx(ctx, async (db) => {
    const r = await db.one<{ seen: string }>(
      `INSERT INTO ${await personalTable(db)}(membership_id, organisation_id, opener_seen_at, updated_at) VALUES ($1, $2, now(), now())
       ON CONFLICT (membership_id) DO UPDATE SET opener_seen_at = now(), updated_at = now()
       RETURNING opener_seen_at AS seen`, [ctx.membership.id, ctx.org.id]);
    return { seenAt: r.seen };
  });
}

// ---- The worker (contract B.3) -------------------------------------------------------------------------------------------------

/**
 * Routines due within the next minute, soonest first (the scheduler queues one `routine.run` job each, deduplicated by
 * routine and due time). One routine has one next run, so after any downtime each gets at most one job. Nothing before
 * 0046. `dueAt` and `next_run_at` are the same instant (ISO), named both ways for the scheduler.
 */
export async function dueRoutines(opts: { now?: Date; limit?: number } = {}): Promise<{ id: string; dueAt: string; next_run_at: string }[]> {
  const now = opts.now ?? new Date();
  const limit = Math.min(Math.max(Math.floor(opts.limit ?? 200), 1), 1000);
  try {
    return await withWorker(async (db) => {
      if (!(await schema0046Ready(db))) return [];
      const rows = await db.query<{ id: string; next_run_at: string }>(
        `SELECT id, next_run_at FROM routines WHERE enabled AND deleted_at IS NULL AND next_run_at <= $1::timestamptz + interval '60 seconds'
         ORDER BY next_run_at LIMIT $2`, [now.toISOString(), limit]);
      return rows.map((r) => ({ id: r.id, dueAt: r.next_run_at, next_run_at: r.next_run_at }));
    });
  } catch (err) {
    if (!isMissingSchema(err)) throw err;
    forget0046();
    forget0047();
    return [];
  }
}

/** `ability_off` (phase 7c): routines, or the template's own ability, is switched off for the person; the routine stays on. */
export type ClaimSkip = "not_ready" | "stale" | "missed" | "duplicate" | "member_gone" | "no_rights" | "consent_changed" | "plan" | "ability_off";
export type ClaimedRun = { runId: string; routine: RoutineRow; ctx: OrgContext; previousRunAt: string | null; timeZone: string };

type ClaimRow = DbRoutine & { org_tz: string; org_status: string; slug: string; own_tz: string | null };

/** Records a run that did not happen (skipped, with why) and finishes it at once. */
async function skipRun(db: Db, runId: string, reason: string) {
  await db.query(`UPDATE routine_runs SET status = 'skipped', reason = $2, delivery = 'none', finished_at = now() WHERE id = $1`, [runId, reason]);
}

/**
 * The start of one run (the `routine.run` job), in one worker transaction holding the routine: a job for a time the
 * routine no longer has is stale; one missed by more than two hours is recorded as missed and the routine moves on
 * (several missed times collapse into that one row); otherwise the run is recorded (once per routine and time) and the
 * routine's next run set. Then the checks that would stop it, each recorded as a skipped run with the routine paused:
 * the person is no longer an active member (`member_gone`), a chase lost its lead rights (`no_rights`, and the person
 * is told), the routine no longer matches what was consented to (`consent_changed`). Returns the run, the routine, the
 * person's context (`sessionId` "routine": it can never confirm anything) and when it last ran.
 */
export async function claimRun(p: { routineId: string; dueAt: string | Date; now?: Date }): Promise<{ skip: ClaimSkip } | ClaimedRun> {
  const now = p.now ?? new Date();
  const due = new Date(p.dueAt);
  if (!isUuid(p.routineId) || Number.isNaN(due.getTime())) return { skip: "stale" };
  let interrupted: string | null = null;
  try {
    const out = await withWorker(async (db): Promise<{ skip: ClaimSkip } | ClaimedRun> => {
      if (!(await schema0046Ready(db))) return { skip: "not_ready" };
      const r = await db.maybeOne<ClaimRow>(
        `SELECT ${ROUTINE_COLS}, o.timezone AS org_tz, o.status AS org_status, o.slug, ${await ownZoneSql(db, "r.membership_id")} AS own_tz
         FROM routines r JOIN organisations o ON o.id = r.organisation_id
         WHERE r.id = $1 FOR UPDATE OF r`, [p.routineId]);
      if (!r || !r.enabled || r.deleted_at || !r.next_run_at || new Date(r.next_run_at).getTime() !== due.getTime()) {
        // The job came back (the worker died mid-run and its job was reset): the run it had claimed never finished. It
        // is recorded as failed ('interrupted') once this transaction lets go of the routine (review, 8 October 2026).
        const stuck = await db.maybeOne<{ id: string }>(
          `SELECT id FROM routine_runs WHERE routine_id = $1 AND due_at = $2 AND status = 'running' AND started_at < now() - make_interval(mins => $3)`,
          [p.routineId, due.toISOString(), INTERRUPTED_AFTER_MINUTES]);
        interrupted = stuck?.id ?? null;
        return { skip: "stale" };
      }
      const row = rowOf(r);
      const tz = personTimeZone(r.own_tz, r.org_tz);
      const next = nextRunAt(row.cadence, row.time, tz, new Date(Math.max(due.getTime(), now.getTime())));
      if (now.getTime() - due.getTime() > ROUTINE_LIMITS.catchUpMinutes * 60_000) {
        await db.query(
          `INSERT INTO routine_runs(organisation_id, routine_id, membership_id, due_at, status, reason, delivery, finished_at)
           VALUES ($1, $2, $3, $4, 'skipped', 'missed', 'none', now()) ON CONFLICT (routine_id, due_at) DO NOTHING`,
          [r.organisation_id, r.id, r.membership_id, due.toISOString()]);
        await db.query(`UPDATE routines SET next_run_at = $2, last_status = 'skipped' WHERE id = $1`, [r.id, next.toISOString()]);
        return { skip: "missed" };
      }
      const ins = await db.maybeOne<{ id: string }>(
        `INSERT INTO routine_runs(organisation_id, routine_id, membership_id, due_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (routine_id, due_at) DO NOTHING RETURNING id`, [r.organisation_id, r.id, r.membership_id, due.toISOString()]);
      if (!ins) return { skip: "duplicate" };
      await db.query(`UPDATE routines SET next_run_at = $2, last_run_at = $3 WHERE id = $1`, [r.id, next.toISOString(), now.toISOString()]);

      const ctx = await memberContext(db, r.organisation_id, r.membership_id, { sessionId: "routine" });
      if (!ctx || r.org_status !== "active" || ctx.org.status !== "active") {
        await skipRun(db, ins.id, "member_gone");
        await db.query(`UPDATE routines SET enabled = false, paused_reason = 'member_gone', next_run_at = NULL, last_status = 'skipped' WHERE id = $1`, [r.id]);
        return { skip: "member_gone" };
      }
      // The assistant switched off for the workspace (its plan, or an admin's override; review, 8 October 2026): this
      // run does nothing, as the end-of-day report does then. The routine stays on and runs again once it is back.
      if (!ctx.plan.features.AI_ASSISTANT) {
        await skipRun(db, ins.id, "plan");
        await db.query(`UPDATE routines SET last_status = 'skipped' WHERE id = $1`, [r.id]);
        return { skip: "plan" };
      }
      // Routines, or the template's own ability, switched off for the person (phase 7c, owner decisions, 8–9 October
      // 2026): this run does nothing and the routine stays on (not paused), so it runs again once the ability is back.
      if (abilityStop(await abilitiesIn(db, r.organisation_id, r.membership_id), row.template)) {
        await skipRun(db, ins.id, "ability_off");
        await db.query(`UPDATE routines SET last_status = 'skipped' WHERE id = $1`, [r.id]);
        return { skip: "ability_off" };
      }
      let cover: ChaseCover | null = null;
      if (isChasing(row.template)) {
        const rights = await chaseRights(db, ctx, row.params.teamIds ?? null);
        if (!rights.ok) {
          await skipRun(db, ins.id, "no_rights");
          await db.query(`UPDATE routines SET enabled = false, paused_reason = 'no_rights', next_run_at = NULL, last_status = 'skipped' WHERE id = $1`, [r.id]);
          await notify(db, {
            organisationId: r.organisation_id, recipientMembershipId: r.membership_id, type: "brenda.routine_failed",
            title: W.notifications.pausedTitle(r.name), body: W.notifications.noRights, resourceType: "routine", resourceId: r.id,
            href: settingsHref(r.slug), dedupKey: `routine.failed:${r.id}:${localDate(now, tz)}:no_rights`,
          });
          return { skip: "no_rights" };
        }
        cover = (await teamPeople(db, ctx, rights.teams)).cover;
      }
      // What the Enable press consented to (contract D.2): the same parameters and, for a chase, nobody outside the
      // teams and people its preview named (review, 8 October 2026: a team the person took on since, or someone who
      // joined a team, needs a new Enable). Anything else pauses it, and the person is told why.
      const kept = row.consent;
      const consented = !!kept && (isChasing(row.template)
        ? !!kept.cover && !!cover && kept.hash === consentHash(row, kept.cover) && withinCover(cover, kept.cover)
        : kept.hash === consentHash(row));
      if (!consented) {
        await skipRun(db, ins.id, "consent_changed");
        await db.query(`UPDATE routines SET enabled = false, paused_reason = 'consent_changed', consent = NULL, next_run_at = NULL, last_status = 'skipped' WHERE id = $1`, [r.id]);
        await notify(db, {
          organisationId: r.organisation_id, recipientMembershipId: r.membership_id, type: "brenda.routine_failed",
          title: W.notifications.pausedTitle(r.name), body: isChasing(row.template) ? W.notifications.coverChanged : W.notifications.consentChanged,
          resourceType: "routine", resourceId: r.id, href: settingsHref(r.slug), dedupKey: `routine.failed:${r.id}:${localDate(now, tz)}:consent_changed`,
        });
        return { skip: "consent_changed" };
      }
      const prev = await db.maybeOne<{ at: string }>(
        `SELECT started_at AS at FROM routine_runs WHERE routine_id = $1 AND status IN ('done', 'empty') ORDER BY started_at DESC LIMIT 1`, [r.id]);
      return { runId: ins.id, routine: row, ctx, previousRunAt: prev?.at ?? null, timeZone: tz };
    });
    if (interrupted) await failRun(interrupted, "interrupted");
    return out;
  } catch (err) {
    if (!isMissingSchema(err)) throw err;
    forget0046();
    forget0047();
    return { skip: "not_ready" };
  }
}

/** How long a run may stay 'running' before it is taken as interrupted (the worker resets a job after 15 minutes). */
const INTERRUPTED_AFTER_MINUTES = 20;

/**
 * Runs left 'running' by a worker that stopped mid-run and whose job never came back (review, 8 October 2026): recorded
 * as failed ('interrupted', the person told as for any failure). Part of the purge (`system.purge_expired`); at most 50
 * a sweep; nothing before 0046.
 */
export async function sweepInterruptedRuns(): Promise<{ failed: number }> {
  let ids: string[] = [];
  try {
    ids = await withWorker(async (db) => {
      if (!(await schema0046Ready(db))) return [];
      const rows = await db.query<{ id: string }>(
        `SELECT id FROM routine_runs WHERE status = 'running' AND started_at < now() - make_interval(mins => $1) ORDER BY started_at LIMIT 50`,
        [INTERRUPTED_AFTER_MINUTES * 3]);
      return rows.map((r) => r.id);
    });
  } catch (err) {
    if (!isMissingSchema(err)) throw err;
    forget0046();
    forget0047();
    return { failed: 0 };
  }
  for (const id of ids) await failRun(id, "interrupted");
  return { failed: ids.length };
}

const OUTPUT_MAX_BYTES = 48_000;
const ACTIONS_MAX_BYTES = 24_000;
const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v));

/** The output as the column holds it (64 KB): items dropped from the longest section into its "more" until it fits. */
function fitOutput(o: RoutineOutput): RoutineOutput {
  if (bytes(o) <= OUTPUT_MAX_BYTES) return o;
  const out: RoutineOutput = { ...o, sections: o.sections.map((s) => ({ ...s, items: [...s.items] })), actions: o.actions.slice(0, 20) };
  while (bytes(out) > OUTPUT_MAX_BYTES) {
    const s = out.sections.reduce<(typeof out.sections)[number] | null>((a, b) => (b.items.length && (!a || b.items.length > a.items.length) ? b : a), null);
    if (!s) break;
    s.items.pop();
    s.more += 1;
  }
  return bytes(out) <= OUTPUT_MAX_BYTES ? out : { ...out, sections: out.sections.map((s) => ({ ...s, items: [], more: s.more + s.items.length })), actions: [] };
}

function fitActions<T>(actions: T[]): T[] {
  const kept = [...actions];
  while (kept.length && bytes(kept) > ACTIONS_MAX_BYTES) kept.pop();
  return kept;
}

/** The plain words of a delivered run's notification: "{name}: {lead}", and its first two items. */
function runNotice(name: string, o: RoutineOutput | null): { title: string; body: string | undefined } {
  const head = o ? (o.empty ? (o.calm ?? o.lead) : o.lead) : "";
  const items = (o?.sections ?? []).flatMap((s) => s.items.map((it) => it.text.replace(/\s+/g, " ").trim())).filter(Boolean).slice(0, 2);
  return { title: clamp(head ? W.notifications.title(name, head) : name, 200), body: items.length ? clamp(items.join("; "), 300) : undefined };
}

async function deliverRun(db: Db, run: { id: string; organisation_id: string; membership_id: string; name: string; slug: string; output: RoutineOutput | null }) {
  const n = runNotice(run.name, run.output);
  await notify(db, {
    organisationId: run.organisation_id, recipientMembershipId: run.membership_id, type: "brenda.routine", title: n.title, body: n.body,
    resourceType: "routine_run", resourceId: run.id, href: runHref(run.slug, run.id), dedupKey: `routine.run:${run.id}`,
  });
}

/**
 * The end of a run that ran (worker transaction): its output, counts and what it did; the routine's failures cleared;
 * the items it reported recorded (each reported once). Then delivery: nothing to say and the routine stays quiet when
 * there is nothing (always for the afternoon check) → silent; the person in quiet hours → held until they end; else a
 * notification now. Never throws: a failure here is recorded as a failed run instead.
 */
export async function completeRun(runId: string, result: TemplateResult, opts: { now?: Date } = {}): Promise<{ delivery: Delivery }> {
  const now = opts.now ?? new Date();
  try {
    return await withWorker(async (db) => {
      const run = await db.maybeOne<{ id: string; organisation_id: string; membership_id: string; routine_id: string; status: RunStatus; delivery: Delivery; name: string; template: RoutineTemplate; quiet_when_empty: boolean; slug: string }>(
        `SELECT rr.id, rr.organisation_id, rr.membership_id, rr.routine_id, rr.status, rr.delivery, ro.name, ro.template, ro.quiet_when_empty, o.slug
         FROM routine_runs rr JOIN routines ro ON ro.id = rr.routine_id JOIN organisations o ON o.id = rr.organisation_id
         WHERE rr.id = $1 FOR UPDATE OF rr`, [runId]);
      if (!run || run.status !== "running") return { delivery: run?.delivery ?? "none" };
      const output = fitOutput(result.output);
      const status: RunStatus = result.empty ? "empty" : "done";
      const summary = clamp((output.empty ? (output.calm ?? output.lead) : output.lead).replace(/\s+/g, " ").trim(), 300) || null;
      let delivery: Delivery;
      let heldUntil: string | null = null;
      if (result.empty && (run.quiet_when_empty || run.template === "afternoon_check")) {
        delivery = "silent";
      } else {
        const quiet = await quietStateFor(db, run.membership_id, now);
        if (quiet.active && quiet.until) { delivery = "held"; heldUntil = quiet.until; }
        else {
          await deliverRun(db, { ...run, output });
          delivery = "delivered";
        }
      }
      await db.query(
        `UPDATE routine_runs SET finished_at = $2, status = $3, summary = $4, output = $5, counts = $6, actions = $7, used_model = $11,
           delivery = $8, held_until = $9, delivered_at = $10
         WHERE id = $1`,
        [run.id, now.toISOString(), status, summary, JSON.stringify(output), JSON.stringify(result.counts ?? {}), JSON.stringify(fitActions(result.actions ?? [])),
         delivery, heldUntil, delivery === "delivered" ? now.toISOString() : null, !!result.usedModel]);
      await db.query(`UPDATE routines SET failures = 0, last_status = $2 WHERE id = $1`, [run.routine_id, status]);
      const keys = [...new Set((result.reportedKeys ?? []).filter((k): k is string => typeof k === "string" && k.length >= 1 && k.length <= 200))];
      if (keys.length) {
        await db.query(
          `INSERT INTO routine_reported_items(routine_id, organisation_id, item_key, run_id)
           SELECT $1, $2, k, $3 FROM unnest($4::text[]) AS k ON CONFLICT (routine_id, item_key) DO NOTHING`,
          [run.routine_id, run.organisation_id, run.id, keys]);
      }
      return { delivery };
    });
  } catch (err) {
    console.warn(`[routines] finishing run ${runId}: ${(err as Error)?.message ?? String(err)}`);
    await failRun(runId, "complete_failed", (err as Error)?.message ?? String(err));
    return { delivery: "none" };
  }
}

/**
 * A run that failed (worker transaction). The error's text goes to the server log only (it may hold data); the run keeps
 * a short code. After three failures in a row the routine pauses (`failing`). The person is told privately either way
 * (recorded in the bell whatever their quiet hours; the notch does not pop it while they are quiet). Never throws.
 */
export async function failRun(runId: string, code: string, message?: string): Promise<void> {
  if (message) console.warn(`[routines] run ${runId} failed (${code}): ${message}`);
  try {
    await withWorker(async (db) => {
      const run = await db.maybeOne<{ id: string; organisation_id: string; membership_id: string; routine_id: string; status: RunStatus; name: string; slug: string; org_tz: string; own_tz: string | null }>(
        `SELECT rr.id, rr.organisation_id, rr.membership_id, rr.routine_id, rr.status, ro.name, o.slug, o.timezone AS org_tz, ${await ownZoneSql(db, "rr.membership_id")} AS own_tz
         FROM routine_runs rr JOIN routines ro ON ro.id = rr.routine_id JOIN organisations o ON o.id = rr.organisation_id
         WHERE rr.id = $1 FOR UPDATE OF rr`, [runId]);
      if (!run || run.status !== "running") return;
      await db.query(
        `UPDATE routine_runs SET status = 'failed', reason = $2, delivery = 'none', held_until = NULL, finished_at = now() WHERE id = $1`,
        [run.id, clamp(String(code || "error"), 64)]);
      const ro = await db.one<{ failures: number; enabled: boolean }>(
        `UPDATE routines SET failures = LEAST(failures + 1, 32000), last_status = 'failed' WHERE id = $1 RETURNING failures, enabled`, [run.routine_id]);
      const pausing = ro.enabled && ro.failures >= ROUTINE_LIMITS.maxConsecutiveFailures;
      if (pausing) await db.query(`UPDATE routines SET enabled = false, paused_reason = 'failing', next_run_at = NULL WHERE id = $1`, [run.routine_id]);
      const day = localDate(new Date(), personTimeZone(run.own_tz, run.org_tz));
      await notify(db, {
        organisationId: run.organisation_id, recipientMembershipId: run.membership_id, type: "brenda.routine_failed",
        title: pausing ? W.notifications.pausedTitle(run.name) : W.notifications.failedTitle(run.name),
        body: pausing ? W.notifications.failing : W.notifications.error, resourceType: "routine", resourceId: run.routine_id,
        href: settingsHref(run.slug), dedupKey: `routine.failed:${run.routine_id}:${day}${pausing ? ":paused" : ""}`,
      });
    });
  } catch (err) {
    console.warn(`[routines] recording the failure of run ${runId}: ${(err as Error)?.message ?? String(err)}`);
  }
}

/** People with held deliveries whose hold has ended (at most 100): each gets one `routine.release` job. Nothing before 0046. */
export async function heldReleasesDue(now = new Date()): Promise<{ membershipId: string }[]> {
  try {
    return await withWorker(async (db) => {
      if (!(await schema0046Ready(db))) return [];
      const rows = await db.query<{ membership_id: string }>(
        `SELECT DISTINCT membership_id FROM routine_runs WHERE delivery = 'held' AND held_until <= $1 LIMIT 100`, [now.toISOString()]);
      return rows.map((r) => ({ membershipId: r.membership_id }));
    });
  } catch (err) {
    if (!isMissingSchema(err)) throw err;
    forget0046();
    forget0047();
    return [];
  }
}

/**
 * Delivers what was held for a person's quiet hours (the `routine.release` job), in one worker transaction: still quiet
 * (hours changed, a new window) → the holds move to its end; else the held runs, oldest first, as their own notification
 * when there is one, or as ONE "{n} routines ran during quiet hours" when there are more.
 */
export async function releaseHeldRuns(membershipId: string, now = new Date()): Promise<{ released: number; bundled: boolean; heldUntil: string | null }> {
  const none = { released: 0, bundled: false, heldUntil: null };
  if (!isUuid(membershipId)) return none;
  try {
    return await withWorker(async (db) => {
      if (!(await schema0046Ready(db))) return none;
      const rows = await db.query<{ id: string; organisation_id: string; membership_id: string; name: string; slug: string; output: RoutineOutput | null; deleted: boolean }>(
        `SELECT rr.id, rr.organisation_id, rr.membership_id, ro.name, o.slug, rr.output, ro.deleted_at IS NOT NULL AS deleted
         FROM routine_runs rr JOIN routines ro ON ro.id = rr.routine_id JOIN organisations o ON o.id = rr.organisation_id
         WHERE rr.membership_id = $1 AND rr.delivery = 'held' ORDER BY rr.started_at, rr.id FOR UPDATE OF rr`, [membershipId]);
      if (!rows.length) return none;
      const quiet = await quietStateFor(db, membershipId, now);
      if (quiet.active && quiet.until) {
        await db.query(`UPDATE routine_runs SET held_until = $2 WHERE membership_id = $1 AND delivery = 'held'`, [membershipId, quiet.until]);
        return { released: 0, bundled: false, heldUntil: quiet.until };
      }
      // A routine the person deleted while its run waited: its run is kept (their history) but not delivered.
      const gone = rows.filter((h) => h.deleted).map((h) => h.id);
      if (gone.length) await db.query(`UPDATE routine_runs SET delivery = 'none', held_until = NULL WHERE id = ANY($1::uuid[])`, [gone]);
      const held = rows.filter((h) => !h.deleted);
      if (!held.length) return none;
      const first = held[0];
      if (held.length === 1) {
        await deliverRun(db, first);
      } else {
        const minute = now.toISOString().slice(0, 16);
        await notify(db, {
          organisationId: first.organisation_id, recipientMembershipId: membershipId, type: "brenda.routine_bundle",
          title: W.notifications.bundleTitle(held.length), body: clamp(held.map((h) => h.name).join(", "), 300),
          resourceType: "routine_run", resourceId: held[held.length - 1].id, href: `/app/${first.slug}/home/routines`,
          dedupKey: `routine.bundle:${membershipId}:${minute}`,
        });
      }
      await db.query(
        `UPDATE routine_runs SET delivery = 'delivered', delivered_at = $2, held_until = NULL, bundled = $3 WHERE id = ANY($1::uuid[])`,
        [held.map((h) => h.id), now.toISOString(), held.length > 1]);
      return { released: held.length, bundled: held.length > 1, heldUntil: null };
    });
  } catch (err) {
    if (!isMissingSchema(err)) throw err;
    forget0046();
    forget0047();
    return none;
  }
}

/** Which of these keys a routine has already reported (each item once). Read as the worker; [] before 0046 or for a draft. */
export async function reportedKeys(routineId: string, keys: string[]): Promise<string[]> {
  const wanted = [...new Set(keys.filter((k) => typeof k === "string" && k.length >= 1 && k.length <= 200))];
  if (!isUuid(routineId) || routineId === DRAFT_ID || !wanted.length) return [];
  try {
    return await withWorker(async (db) => {
      if (!(await schema0046Ready(db))) return [];
      const rows = await db.query<{ k: string }>(
        `SELECT item_key AS k FROM routine_reported_items WHERE routine_id = $1 AND item_key = ANY($2::text[])`, [routineId, wanted]);
      return rows.map((r) => r.k);
    });
  } catch (err) {
    if (!isMissingSchema(err)) throw err;
    forget0046();
    forget0047();
    return [];
  }
}

/**
 * Every key a routine has reported that starts with `prefix` (the chase's `chase:` keys, at most 30 days of them), so
 * its query can leave them out before it limits (review, 8 October 2026). Read as the worker; [] before 0046 or for a
 * draft.
 */
export async function reportedKeysLike(routineId: string, prefix: string, limit = 5000): Promise<string[]> {
  if (!isUuid(routineId) || routineId === DRAFT_ID || !prefix) return [];
  try {
    return await withWorker(async (db) => {
      if (!(await schema0046Ready(db))) return [];
      const rows = await db.query<{ k: string }>(
        `SELECT item_key AS k FROM routine_reported_items WHERE routine_id = $1 AND starts_with(item_key, $2) ORDER BY reported_at DESC LIMIT $3`,
        [routineId, prefix, Math.min(Math.max(Math.floor(limit), 1), 5000)]);
      return rows.map((r) => r.k);
    });
  } catch (err) {
    if (!isMissingSchema(err)) throw err;
    forget0046();
    forget0047();
    return [];
  }
}

/** The purge's part (`system.purge_expired`): reported keys older than 30 days go. No-op before 0046. */
export async function pruneRoutineReportedItems(): Promise<{ deleted: number }> {
  try {
    return await withWorker(async (db) => {
      if (!(await schema0046Ready(db))) return { deleted: 0 };
      const rows = await db.query(
        `DELETE FROM routine_reported_items WHERE reported_at < now() - make_interval(days => $1) RETURNING 1`, [ROUTINE_LIMITS.reportedKeepDays]);
      return { deleted: rows.length };
    });
  } catch (err) {
    if (!isMissingSchema(err)) throw err;
    forget0046();
    forget0047();
    return { deleted: 0 };
  }
}

// ---- The notch (contract J.8) ------------------------------------------------------------------------------------------------

/** A delivered run as the notch's routine card shows it. */
export type DesktopRoutineRun = { id: string; notificationId: string | null; title: string; lead: string; lines: { text: string; href: string | null }[]; href: string; at: string };
export type DesktopRoutineRuns = { ready: boolean; recent: DesktopRoutineRun[] };

/**
 * The person's runs delivered in the last 24 hours (at most 5, newest first), each with the notification that brought
 * it (its own, or the quiet-hours bundle it came in), its lead and up to 5 plain lines with links. `ready: false`
 * before 0046.
 */
export async function routineRunsForDesktop(ctx: OrgContext, lineMax = 5): Promise<DesktopRoutineRuns> {
  return personRead<DesktopRoutineRuns>(ctx, { ready: false, recent: [] }, async (db) => {
    const rows = await db.query<{ id: string; name: string; output: RoutineOutput | null; delivered_at: string; notification_id: string | null }>(
      `SELECT rr.id, ro.name, rr.output, rr.delivered_at,
              (SELECT n.id FROM notifications n
               WHERE n.recipient_membership_id = rr.membership_id
                 AND ((n.type = 'brenda.routine' AND n.resource_id = rr.id)
                   OR (rr.bundled AND n.type = 'brenda.routine_bundle'
                       AND n.deduplication_key = 'routine.bundle:' || rr.membership_id || ':' || to_char(rr.delivered_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI')))
               ORDER BY n.created_at DESC LIMIT 1) AS notification_id
       FROM routine_runs rr JOIN routines ro ON ro.id = rr.routine_id
       WHERE rr.membership_id = $1 AND rr.delivery = 'delivered' AND rr.delivered_at > now() - interval '24 hours'
       ORDER BY rr.delivered_at DESC, rr.id DESC LIMIT 5`, [ctx.membership.id]);
    return {
      ready: true,
      recent: rows.map((r) => ({
        id: r.id, notificationId: r.notification_id, title: r.name,
        lead: r.output ? (r.output.empty ? (r.output.calm ?? r.output.lead) : r.output.lead) : "",
        lines: r.output && r.output.v === 1 ? routinePlainLines(r.output, ctx.org.slug, lineMax) : [],
        href: runHref(ctx.org.slug, r.id), at: r.delivered_at,
      })),
    };
  });
}
