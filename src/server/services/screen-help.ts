/**
 * Screen help on Brenda for Mac, phase 1: the server's side (owner decisions, 11 October 2026: "start building with
 * your recommendations"; contract sections D.4 to D.6).
 *
 * - The pilot gate: screen help is offered only in the workspaces BRENDA_LOOK_WORKSPACES names ("*" offers it everywhere;
 *   unset or empty, nowhere). The owner's own workspace is first.
 * - Boredroom's own key and the pilot model: pictures always go through ANTHROPIC_API_KEY, never a workspace's own key
 *   (owner decision 3), to BRENDA_LOOK_MODEL (claude-opus-5-5 by default; never a Fable or Mythos model, which need
 *   30-day retention: owner decision 4).
 * - The workspace's switch (owner decision 2): Allowed by default; owners and HR can switch it off for everyone and add
 *   apps to a never-look list. A workspace gets 14 days' notice the first time it is offered screen help (the notice
 *   starts lazily, on the first read, and owners and HR are told); owners and HR may start it at once. A workspace created
 *   while screen help is offered is available at once (orgs.createOrganisation inserts its row).
 * - The person's own side: their never-look list and "Turn off on my Macs", in assistant_private (theirs alone). Phase 3
 *   (owner request, 12 October 2026: the person sees what is on; the employer still sees nothing; contract 0b.2, K.2):
 *   what each of their Macs last reported (which abilities are on, which permissions macOS gave, whether the companion
 *   shows) and their last "Set up on my Mac", in assistant_private too (migration 0059), for the person alone: no owner,
 *   HR or lead reads it, and nothing here records any look.
 * - The look's checks: a desktop session, not impersonated, 0057 applied, available, the picture well formed and the
 *   size it says, not a never-look app, not on a call. Nothing from the request body ever reaches a log, an error
 *   message, the database or a thrown error.
 */
import { z } from "zod";
import { withSystem, withUser, withWorker, type Db } from "@/server/db";
import type { OrgContext } from "@/server/lib/api";
import { AppError, forbidden, notFound } from "@/server/lib/errors";
import { schema0054Ready } from "@/server/lib/schema-0054";
import { forget0057, isMissingSchema, retryWithout0057, schema0057Ready } from "@/server/lib/schema-0057";
import { forget0058, schema0058Ready } from "@/server/lib/schema-0058";
import { forget0059, retryWithout0059, schema0059Ready } from "@/server/lib/schema-0059";
import { forget0060, schema0060Ready } from "@/server/lib/schema-0060";
import { imageSize, sniffImage, stripImageMetadata } from "@/server/lib/image-meta";
import { audit, notify } from "@/server/services/common";
import { logAction } from "@/server/services/brenda";
import type { AssistantConnection } from "@/server/services/assistant";
import {
  APP_RULE_LIMITS, LOOK_LIMITS, MAC_REPORTS_MAX, NOTICE_DAYS, SCREEN_HELP_WORDS, SETUP_FRESH_MINUTES, appRuleListSchema, appRulesOf, cleanAppRule, dayMonth, longDate,
  macStateSchema, neverLookMatch, type AppRule, type DesktopAct, type DesktopLook, type MacReport, type MacState, type ScreenHelpMine, type ScreenHelpReason,
  type ScreenHelpView, type macReportBodySchema,
} from "@/lib/screen-help";
import { ACT_LIMITS, FILE_SOURCES, type FileSource } from "@/lib/act";

const W = SCREEN_HELP_WORDS;

// ---- The pilot gate, the model and the key (contract D.4) -------------------------------------------------------------------

/** Whether BRENDA_LOOK_WORKSPACES offers screen help to this workspace: slugs split on commas and spaces; "*" is every one. */
export function lookEligible(slug: string, env: string | undefined = process.env.BRENDA_LOOK_WORKSPACES): boolean {
  const list = String(env ?? "").split(/[\s,]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!list.length) return false;
  return list.includes("*") || list.includes(String(slug ?? "").trim().toLowerCase());
}

export const DEFAULT_LOOK_MODEL = "claude-opus-5-5";
let warnedModel = false;

/**
 * The model that reads pictures: BRENDA_LOOK_MODEL when it is a Claude model id, never a Fable or Mythos model (they
 * need 30-day retention; warned once), else claude-opus-5-5 (owner decision 4, 11 October 2026: the pilot model,
 * configurable so a cheaper one can be swapped in after the pointing test).
 */
export function lookModel(env: string | undefined = process.env.BRENDA_LOOK_MODEL): string {
  const m = String(env ?? "").trim();
  if (!m) return DEFAULT_LOOK_MODEL;
  if (/^claude-[a-z0-9-]+$/.test(m) && !/^claude-(?:fable|mythos)/.test(m)) return m;
  if (!warnedModel) { warnedModel = true; console.warn("[screen-help] BRENDA_LOOK_MODEL is not a model screen help may use; claude-opus-5-5 reads the pictures."); }
  return DEFAULT_LOOK_MODEL;
}

/** Boredroom's own connection for pictures (never a workspace's key), or null without ANTHROPIC_API_KEY. */
export function lookConnection(): AssistantConnection | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  return apiKey ? { apiKey, model: lookModel(), source: "environment" } : null;
}

// ---- Reading the workspace's and the person's settings (contract D.5) -------------------------------------------------------

// `actions_allowed` (migration 0058; phase 2, owner request 12 October 2026) is read through to_jsonb, so the same
// statement works before 0058 (null: Allowed, the default).
type SettingsRow = { allowed: boolean; notice_at: string | null; available_from: string | null; never_look: unknown; actions_allowed?: boolean | null };
// `setup_at` (migration 0059; phase 3) is read through to_jsonb, so the same statement works before 0059 (null).
type MineRow = { never_look: unknown; off_at: string | null; setup_at?: string | null; check_every?: boolean | null };
const iso = (v: string | Date | null | undefined) => (v ? new Date(v).toISOString() : null);

/**
 * What one read finds: whether 0057 is there, the workspace's row (after the lazy notice), the person's own columns, and
 * whether 0058 is there (phase 2: on-screen actions and file work).
 */
type State = { ready: boolean; eligible: boolean; row: SettingsRow | null; mine: MineRow | null; actReady?: boolean; macReady?: boolean; frontReady?: boolean };
/** What `desktopLookOf` reads (Brenda's one-trip Mac context reads it in the same round trip as the session; contract K.5.1). */
export type LookState = State;
export type { SettingsRow as LookSettingsRow, MineRow as LookMineRow };

const SELECT_ROW = `SELECT allowed, notice_at, available_from, never_look, (to_jsonb(s) ->> 'actions_allowed')::boolean AS actions_allowed
                    FROM screen_help_settings s WHERE organisation_id = $1`;

/**
 * Starts the workspace's notice the first time it is offered screen help (contract 0.9, D.5): through the worker, once
 * (ON CONFLICT DO NOTHING), and only when this call inserted the row, owners and HR are told. Returns the row.
 */
async function startNotice(ctx: OrgContext): Promise<SettingsRow | null> {
  return withWorker(async (db) => {
    const inserted = await db.maybeOne<SettingsRow>(
      `INSERT INTO screen_help_settings(organisation_id, notice_at, available_from) VALUES ($1, now(), now() + make_interval(days => $2))
       ON CONFLICT (organisation_id) DO NOTHING RETURNING allowed, notice_at, available_from, never_look, true AS actions_allowed`, [ctx.org.id, NOTICE_DAYS]);
    if (inserted) {
      const date = dayMonth(iso(inserted.available_from) as string, ctx.org.timezone);
      const leads = await db.query<{ id: string }>(
        `SELECT id FROM memberships WHERE organisation_id = $1 AND status = 'active' AND role IN ('owner', 'hr')`, [ctx.org.id]);
      for (const m of leads) {
        await notify(db, {
          organisationId: ctx.org.id, recipientMembershipId: m.id, type: "brenda.screen_help_notice",
          title: W.noticeNotification.title(date), body: W.noticeNotification.body,
          href: `/app/${ctx.org.slug}/settings?section=brenda`, dedupKey: `screen-help-notice:${ctx.org.id}`,
        });
      }
      return inserted;
    }
    return db.maybeOne<SettingsRow>(SELECT_ROW, [ctx.org.id]);
  });
}

async function readState(ctx: OrgContext, o: { mine?: boolean } = {}): Promise<State> {
  const eligible = lookEligible(ctx.org.slug);
  return retryWithout0057(async () => {
    const first = await withUser(ctx.user.profileId, async (db): Promise<State> => {
      if (!(await schema0057Ready(db))) return { ready: false, eligible, row: null, mine: null, actReady: false };
      const row = await db.maybeOne<SettingsRow>(SELECT_ROW, [ctx.org.id]);
      const mine = o.mine === false ? null : await db.maybeOne<MineRow>(
        `SELECT screen_help_never_look AS never_look, screen_help_off_at AS off_at, (to_jsonb(ap) ->> 'screen_help_setup_at')::timestamptz AS setup_at,
                COALESCE((to_jsonb(ap) ->> 'check_every_task')::boolean, false) AS check_every
         FROM assistant_private ap WHERE membership_id = $1 AND organisation_id = $2`,
        [ctx.membership.id, ctx.org.id]);
      // Brenda and her helpers (owner brief, 12 October 2026; contract F.0): whether 0060 is there for the front desk.
      return { ready: true, eligible, row, mine, actReady: await schema0058Ready(db), macReady: await schema0059Ready(db), frontReady: await schema0060Ready(db) };
    });
    if (first.ready && eligible && !first.row) return { ...first, row: await startNotice(ctx) };
    return first;
  });
}

/** Whether screen help is available, and why not (contract A.10: eligible, allowed, notice over, the plan, the key). */
function availability(ctx: OrgContext, s: State, now = Date.now()): { available: boolean; reason: ScreenHelpReason | null; availableFrom: string | null } {
  const from = s.row?.available_from ? iso(s.row.available_from) : null;
  const inNotice = !!from && Date.parse(from) > now;
  const reason: ScreenHelpReason | null = !s.ready ? "not_ready"
    : !s.eligible ? "not_offered"
    : ctx.plan.features.AI_ASSISTANT !== true ? "no_plan"
    : !process.env.ANTHROPIC_API_KEY ? "no_key"
    : !s.row || !s.row.allowed ? "switched_off"
    : !from || inNotice ? "notice"
    : null;
  return { available: reason === null, reason, availableFrom: inNotice ? from : null };
}

const NOT_READY_ACT: DesktopAct = { ready: false, available: false, reason: "not_ready" };
const NOT_READY_LOOK: DesktopLook = { ready: false, eligible: false, available: false, reason: "not_ready", availableFrom: null, neverLook: [], offAt: null, v: 2, act: NOT_READY_ACT, setupAt: null, mac: { ready: false } };

/**
 * The person's "Set up on my Mac" as their Macs see it (contract 0b.3): the time when it is under 15 minutes old, else
 * null; null while someone else is signed in as them (a web press never turns anything on: the Mac's card asks).
 */
export function freshSetupAt(setupAt: string | Date | null | undefined, o: { impersonated: boolean; now?: number }): string | null {
  if (o.impersonated || !setupAt) return null;
  const t = new Date(setupAt).getTime();
  if (!Number.isFinite(t)) return null;
  const age = (o.now ?? Date.now()) - t;
  return age >= -60_000 && age <= SETUP_FRESH_MINUTES * 60_000 ? new Date(t).toISOString() : null;
}

/**
 * On-screen actions and file work (phase 2, owner request 12 October 2026; contract D.4): available when looks are, 0058
 * is applied and the workspace's switch allows them (Allowed by default). Boredroom's own key is part of looks' own
 * availability. Never says whether anyone uses them.
 */
export function actAvailability(lookAvailable: boolean, s: { actReady?: boolean; row: { actions_allowed?: boolean | null } | null }): DesktopAct {
  if (!s.actReady) return { ...NOT_READY_ACT };
  if (s.row && s.row.actions_allowed === false) return { ready: true, available: false, reason: "switched_off" };
  if (!lookAvailable) return { ready: true, available: false, reason: "look_unavailable" };
  return { ready: true, available: true, reason: null };
}

/**
 * The desktop state's `look` from a state already read (contract A.10). Brenda and her helpers (owner brief, 12 October
 * 2026; contract K.5.1): the one-trip Mac context builds it from its own reads.
 */
export function desktopLookOf(ctx: OrgContext, s: LookState): DesktopLook {
  if (!s.ready) return { ...NOT_READY_LOOK, eligible: s.eligible };
  const a = availability(ctx, s);
  const act = actAvailability(a.available, s);
  return {
    ready: true, eligible: s.eligible, available: a.available, reason: a.reason, availableFrom: a.availableFrom,
    neverLook: [
      ...appRulesOf(s.row?.never_look).map((r) => ({ ...r, source: "workspace" as const })),
      ...appRulesOf(s.mine?.never_look).map((r) => ({ ...r, source: "you" as const })),
    ],
    offAt: iso(s.mine?.off_at),
    v: 2,
    act,
    setupAt: s.macReady ? freshSetupAt(s.mine?.setup_at ?? null, { impersonated: !!ctx.user.impersonation }) : null,
    mac: { ready: !!s.macReady },
    // Brenda and her helpers (owner brief, 12 October 2026; contract F.0, 0b.22): the front desk is on for this person
    // once 0060 is applied and actions are available here (the workspace's switch included: matched commands run on the
    // Mac without asking the server, so the Mac must be told); "Check with me before every task" is theirs (default
    // off). Never while someone else is signed in as them.
    front: { ready: !!s.frontReady && act.available && !ctx.user.impersonation, checkEvery: !!s.mine?.check_every },
  };
}

/** The desktop state's `look` (contract A.10). Never throws: any problem reads as not ready. */
export async function desktopLook(ctx: OrgContext): Promise<DesktopLook> {
  try {
    return desktopLookOf(ctx, await readState(ctx));
  } catch (err) {
    if (isMissingSchema(err)) { forget0057(); forget0058(); forget0059(); forget0060(); }
    else console.warn(`[screen-help] desktop state: ${(err as { code?: string })?.code ?? "error"}`);
    return { ...NOT_READY_LOOK };
  }
}

const canEdit = (ctx: OrgContext) => ctx.membership.role === "owner" || ctx.membership.role === "hr";

function viewOf(ctx: OrgContext, s: State): ScreenHelpView {
  const a = availability(ctx, s);
  return {
    ready: s.ready, eligible: s.eligible, allowed: s.row ? s.row.allowed : true,
    noticeAt: iso(s.row?.notice_at), availableFrom: iso(s.row?.available_from),
    available: a.available, reason: a.reason, neverLook: appRulesOf(s.row?.never_look), canEdit: canEdit(ctx),
    actionsAllowed: s.row?.actions_allowed !== false, actReady: !!s.actReady,
  };
}

/** Settings › Brenda's screen help card (any member may read it). Before 0057: `{ ready: false, … }`. */
export async function screenHelpView(ctx: OrgContext): Promise<ScreenHelpView> {
  try {
    return viewOf(ctx, await readState(ctx, { mine: false }));
  } catch (err) {
    if (!isMissingSchema(err)) throw err;
    forget0057();
    forget0058();
    return viewOf(ctx, { ready: false, eligible: lookEligible(ctx.org.slug), row: null, mine: null, actReady: false });
  }
}

const notReady = () => new AppError(503, "NOT_READY", W.errors.notReady);

export const screenHelpPutSchema = z.object({
  allowed: z.boolean().optional(),
  neverLook: appRuleListSchema.optional(),
  startNow: z.literal(true).optional(),
  /** Phase 2 (owner request, 12 October 2026): on-screen actions and file work, owners and HR; 503 before 0058. */
  actionsAllowed: z.boolean().optional(),
});

/**
 * Owners and HR: switch screen help (Allowed, Not allowed), replace the never-look list, or start it now. Under the
 * workspace's Brenda settings lock; logged in Settings › Brenda's log and in Audit. 404 when the workspace is not
 * offered screen help; 503 before 0057.
 */
export async function saveScreenHelp(ctx: OrgContext, input: z.infer<typeof screenHelpPutSchema>): Promise<ScreenHelpView> {
  if (!canEdit(ctx)) throw forbidden(W.errors.settingsForbidden);
  if (!lookEligible(ctx.org.slug)) throw notFound();
  const s = await readState(ctx, { mine: false });
  if (!s.ready) throw notReady();
  if (input.actionsAllowed !== undefined && !s.actReady) throw new AppError(503, "NOT_READY", W.errors.actionsNotReady);
  return retryWithout0057(() => withUser(ctx.user.profileId, async (db) => {
    await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`brenda_settings:${ctx.org.id}`]);
    const cur = await db.maybeOne<SettingsRow>(SELECT_ROW, [ctx.org.id]);
    const list = input.neverLook ? JSON.stringify(input.neverLook) : null;
    // The row exists (readState started the notice); an upsert keeps this working if it was never written.
    await db.query(
      `INSERT INTO screen_help_settings(organisation_id, allowed, notice_at, available_from, never_look, updated_by)
       VALUES ($1, COALESCE($2, true), now(), CASE WHEN $4 THEN now() ELSE now() + make_interval(days => $6) END, COALESCE($3::jsonb, '[]'::jsonb), $5)
       ON CONFLICT (organisation_id) DO UPDATE SET
         allowed = COALESCE($2, screen_help_settings.allowed),
         never_look = COALESCE($3::jsonb, screen_help_settings.never_look),
         notice_at = COALESCE(screen_help_settings.notice_at, now()),
         available_from = CASE WHEN $4 THEN LEAST(COALESCE(screen_help_settings.available_from, now()), now())
                               ELSE COALESCE(screen_help_settings.available_from, now() + make_interval(days => $6)) END,
         updated_by = $5`,
      [ctx.org.id, input.allowed ?? null, list, input.startNow === true, ctx.membership.id, NOTICE_DAYS]);
    // The actions switch (0058; checked above): it can only ever switch things off for the workspace's people.
    if (input.actionsAllowed !== undefined) {
      await db.query(`UPDATE screen_help_settings SET actions_allowed = $2, updated_by = $3 WHERE organisation_id = $1`, [ctx.org.id, input.actionsAllowed, ctx.membership.id]);
    }
    const changes: string[] = [];
    if (input.allowed !== undefined && input.allowed !== (cur?.allowed ?? true)) changes.push(input.allowed ? W.log.allowed : W.log.notAllowed);
    if (input.actionsAllowed !== undefined && input.actionsAllowed !== (cur?.actions_allowed !== false)) changes.push(input.actionsAllowed ? W.log.actionsAllowed : W.log.actionsNotAllowed);
    if (input.startNow) changes.push(W.log.startedNow);
    if (input.neverLook && JSON.stringify(appRulesOf(cur?.never_look)) !== list) changes.push(W.log.listChanged);
    for (const summary of changes) await logAction(db, ctx, { tool: "settings", outcome: "done", source: "confirm", summary });
    if (changes.length) {
      await audit(db, {
        organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, actorUserId: ctx.user.profileId, action: "screen_help.updated",
        subjectType: "organisation", subjectId: ctx.org.id,
        metadata: { ...(input.allowed !== undefined ? { allowed: input.allowed } : {}), ...(input.startNow ? { startedNow: true } : {}), ...(input.neverLook ? { neverLook: input.neverLook.length } : {}), ...(input.actionsAllowed !== undefined ? { actionsAllowed: input.actionsAllowed } : {}) },
      });
    }
    const row = await db.maybeOne<SettingsRow>(SELECT_ROW, [ctx.org.id]);
    return viewOf(ctx, { ready: true, eligible: true, row, mine: null, actReady: s.actReady });
  }));
}

/** One stored report: the Mac's desktop session, when it reported, what, and the "Set up on my Mac" it last acted on. */
export type StoredMac = { session: string; at: string; state: MacState; setupSeenAt: string | null };
const NO_MACS = { macReady: false, macs: [] as MacReport[], linked: [] as ScreenHelpMine["linked"], setupAt: null as string | null };

/** The stored list read defensively: entries that are not reports are left out (a state that no longer parses too). */
export function storedMacsOf(v: unknown): StoredMac[] {
  if (!Array.isArray(v)) return [];
  const out: StoredMac[] = [];
  for (const e of v) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    const state = macStateSchema.safeParse(o.state);
    if (typeof o.session !== "string" || typeof o.at !== "string" || !state.success) continue;
    out.push({ session: o.session, at: o.at, state: state.data, setupSeenAt: typeof o.setupSeenAt === "string" ? o.setupSeenAt : null });
  }
  return out.slice(0, MAC_REPORTS_MAX);
}

/**
 * The list after one Mac reported (contract K.2): that session's entry replaced and put first, newest first, at most five.
 * `null` when the state is the same as that Mac's last one, under ten seconds ago, and its setup answer has not changed
 * (nothing is written). `setupSeen` counts only when it is the person's stored "Set up on my Mac", to the millisecond.
 */
export function mergeMacReports(list: StoredMac[], entry: { session: string; state: MacState; setupSeen: string | null }, o: { now: number; setupAt: string | null }): StoredMac[] | null {
  const prev = list.find((m) => m.session === entry.session) ?? null;
  const setupAtMs = o.setupAt ? new Date(o.setupAt).getTime() : NaN;
  const seenMs = entry.setupSeen ? new Date(entry.setupSeen).getTime() : NaN;
  const setupSeenAt = Number.isFinite(seenMs) && seenMs === setupAtMs ? new Date(setupAtMs).toISOString() : prev?.setupSeenAt ?? null;
  if (prev && JSON.stringify(prev.state) === JSON.stringify(entry.state) && prev.setupSeenAt === setupSeenAt && o.now - new Date(prev.at).getTime() < 10_000) return null;
  const next: StoredMac = { session: entry.session, at: new Date(o.now).toISOString(), state: entry.state, setupSeenAt };
  return [next, ...list.filter((m) => m.session !== entry.session)].slice(0, MAC_REPORTS_MAX);
}

/**
 * The person's Macs for their card (contract K.2): each report joined with its live desktop session (its name, its last
 * poll), newest report first; reports of sessions that are gone are dropped; linked Macs with no report listed apart.
 */
export function macsForCard(stored: StoredMac[], devices: { id: string; device_name: string | null; last_seen_at: string | null }[]): Pick<ScreenHelpMine, "macs" | "linked"> {
  const live = new Map(devices.map((d) => [d.id, d]));
  const macs: MacReport[] = [];
  for (const m of [...stored].sort((x, y) => y.at.localeCompare(x.at))) {
    const d = live.get(m.session);
    if (!d) continue;
    macs.push({ device: d.device_name?.trim() || "Mac", lastSeenAt: iso(d.last_seen_at), reportedAt: m.at, state: m.state, setupSeenAt: m.setupSeenAt });
  }
  const reported = new Set(stored.map((m) => m.session));
  const linked = devices.filter((d) => !reported.has(d.id)).map((d) => ({ device: d.device_name?.trim() || "Mac", lastSeenAt: iso(d.last_seen_at) }));
  return { macs, linked };
}

type MineRow59 = MineRow & { macs?: unknown };

/** Reads the person's own row, with 0059's columns when they are there. */
async function readMine(db: Db, ctx: OrgContext): Promise<{ row: MineRow59 | null; macReady: boolean }> {
  const macReady = await schema0059Ready(db);
  const row = await db.maybeOne<MineRow59>(
    macReady
      ? `SELECT screen_help_never_look AS never_look, screen_help_off_at AS off_at, screen_help_setup_at AS setup_at, screen_help_macs AS macs
         FROM assistant_private WHERE membership_id = $1 AND organisation_id = $2`
      : `SELECT screen_help_never_look AS never_look, screen_help_off_at AS off_at FROM assistant_private WHERE membership_id = $1 AND organisation_id = $2`,
    [ctx.membership.id, ctx.org.id]);
  return { row, macReady };
}

async function mineOf(ctx: OrgContext, row: MineRow59 | null, macReady: boolean): Promise<ScreenHelpMine> {
  const impersonated = !!ctx.user.impersonation;
  const base = { ready: true, neverLook: appRulesOf(row?.never_look), offAt: iso(row?.off_at), impersonated };
  // While someone else is signed in as the person, nothing about their Macs shows (contract G.3).
  if (!macReady || impersonated) return { ...base, ...NO_MACS, macReady };
  // Imported when needed: the desktop service reads this one for its state.
  const { listDevices } = await import("@/server/services/desktop");
  const devices = await listDevices(ctx.user).catch(() => []);
  return { ...base, macReady, ...macsForCard(storedMacsOf(row?.macs), devices), setupAt: iso(row?.setup_at) };
}

/**
 * Settings › Your assistant's card: the person's own list, their last "Turn off on my Macs", and (phase 3, 0059) what each
 * of their Macs last reported and their last "Set up on my Mac". Theirs alone.
 */
export async function myScreenHelp(ctx: OrgContext): Promise<ScreenHelpMine> {
  const impersonated = !!ctx.user.impersonation;
  const notReady: ScreenHelpMine = { ready: false, neverLook: [], offAt: null, impersonated, ...NO_MACS };
  try {
    const r = await retryWithout0059(() => retryWithout0057(() => withUser(ctx.user.profileId, async (db) => {
      if (!(await schema0057Ready(db))) return null;
      return readMine(db, ctx);
    })));
    if (!r) return notReady;
    return await mineOf(ctx, r.row, r.macReady);
  } catch (err) {
    if (!isMissingSchema(err)) throw err;
    forget0057();
    forget0059();
    return notReady;
  }
}

export const screenHelpMinePutSchema = z.object({
  neverLook: appRuleListSchema.optional(),
  off: z.literal(true).optional(),
  /** Phase 3: "Set up on my Mac" (their Macs open the setup card; nothing turns on from here). 503 before 0059. */
  setup: z.literal(true).optional(),
});

/**
 * The person's own: replace their never-look list, "Turn off on my Macs" (a time their Macs obey on the next poll; it also
 * clears a pending "Set up on my Mac"), or "Set up on my Mac" (phase 3, owner request 12 October 2026: their Macs open the
 * setup card at their next poll, which asks on the Mac before turning anything on). Refused while someone else is signed
 * in as them.
 */
export async function saveMyScreenHelp(ctx: OrgContext, input: z.infer<typeof screenHelpMinePutSchema>): Promise<ScreenHelpMine> {
  if (ctx.user.impersonation) throw forbidden(W.errors.personalImpersonated);
  const r = await retryWithout0059(() => retryWithout0057(() => withUser(ctx.user.profileId, async (db) => {
    if (!(await schema0057Ready(db))) throw notReady();
    const macReady = await schema0059Ready(db);
    if (input.setup && !macReady) throw new AppError(503, "NOT_READY", W.errors.setupNotReady);
    const list = input.neverLook ? JSON.stringify(input.neverLook) : null;
    await db.query(
      `INSERT INTO assistant_private(membership_id, organisation_id, screen_help_never_look, screen_help_off_at)
       VALUES ($1, $2, COALESCE($3::jsonb, '[]'::jsonb), CASE WHEN $4 THEN now() ELSE NULL END)
       ON CONFLICT (membership_id) DO UPDATE SET
         screen_help_never_look = COALESCE($3::jsonb, assistant_private.screen_help_never_look),
         screen_help_off_at = CASE WHEN $4 THEN now() ELSE assistant_private.screen_help_off_at END`,
      [ctx.membership.id, ctx.org.id, list, input.off === true]);
    if (macReady && (input.off || input.setup)) {
      // Off wins over a Set up in the same request: turning things off never opens a setup.
      await db.query(`UPDATE assistant_private SET screen_help_setup_at = CASE WHEN $3 THEN NULL ELSE now() END WHERE membership_id = $1 AND organisation_id = $2`,
        [ctx.membership.id, ctx.org.id, input.off === true]);
    }
    return readMine(db, ctx);
  })));
  return mineOf(ctx, r.row, r.macReady);
}

/**
 * What Brenda for Mac says is on, on this Mac, for the person alone (phase 3, owner request 12 October 2026; contract A.6,
 * K.2). Only from a desktop session (403 LOOK_DESKTOP_ONLY), never while someone else is signed in as the person (403);
 * before 0059 nothing is kept (`{saved: false, ready: false}`). The state is never logged.
 */
export async function saveMacState(ctx: OrgContext, body: z.infer<typeof macReportBodySchema>): Promise<{ saved: boolean; ready: boolean }> {
  if (!(await isDesktopSession(ctx))) throw new AppError(403, "LOOK_DESKTOP_ONLY", W.errors.desktopOnly);
  if (ctx.user.impersonation) throw forbidden(W.errors.personalImpersonated);
  try {
    return await retryWithout0059(() => withUser(ctx.user.profileId, async (db) => {
      if (!(await schema0059Ready(db))) return { saved: false, ready: false };
      await db.query(`INSERT INTO assistant_private(membership_id, organisation_id) VALUES ($1, $2) ON CONFLICT (membership_id) DO NOTHING`, [ctx.membership.id, ctx.org.id]);
      const cur = await db.one<{ macs: unknown; setup_at: string | null }>(
        `SELECT screen_help_macs AS macs, screen_help_setup_at AS setup_at FROM assistant_private WHERE membership_id = $1 AND organisation_id = $2 FOR UPDATE`,
        [ctx.membership.id, ctx.org.id]);
      const next = mergeMacReports(storedMacsOf(cur.macs), { session: String(ctx.user.sessionId), state: body.state, setupSeen: body.setupSeen }, { now: Date.now(), setupAt: iso(cur.setup_at) });
      if (!next) return { saved: false, ready: true };
      await db.query(`UPDATE assistant_private SET screen_help_macs = $3::jsonb WHERE membership_id = $1 AND organisation_id = $2`, [ctx.membership.id, ctx.org.id, JSON.stringify(next)]);
      return { saved: true, ready: true };
    }));
  } catch (err) {
    if (isMissingSchema(err)) { forget0059(); return { saved: false, ready: false }; }
    console.warn(`[screen-help] mac state: ${(err as { code?: string })?.code ?? "error"}`);
    throw new AppError(502, "LOOK_FAILED", W.errors.serverFailed);
  }
}

// ---- The look's checks (contract D.6) ---------------------------------------------------------------------------------------

/** Whether the request came from Brenda for Mac (a desktop session). */
export async function isDesktopSession(ctx: OrgContext): Promise<boolean> {
  // A context that is not a signed-in session (a follow-up, a routine, the daily report) has a word for its id.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(ctx.user.sessionId ?? ""))) return false;
  const r = await withSystem((db) => db.maybeOne<{ kind: string }>(`SELECT kind FROM auth_sessions WHERE id = $1`, [ctx.user.sessionId]));
  return r?.kind === "desktop";
}

/**
 * Whether the person is in a call that has not ended, or one rings for them (what /calls/now calls `active` and
 * `ringing`). Before 0054 there are no calls.
 */
export async function onLiveCall(ctx: OrgContext): Promise<boolean> {
  return withSystem(async (db: Db) => {
    if (!(await schema0054Ready(db))) return false;
    const r = await db.maybeOne(
      `SELECT 1 FROM call_participants p JOIN calls c ON c.id = p.call_id
       WHERE p.membership_id = $1 AND c.organisation_id = $2 AND c.state <> 'ended'
         AND (p.state = 'joined' OR (p.state = 'ringing' AND p.rang_at > now() - interval '30 seconds')) LIMIT 1`,
      [ctx.membership.id, ctx.org.id]);
    return !!r;
  });
}

/**
 * Steps 2 to 4 of the look route from the one-trip Mac context (review, 16 October 2026; contract K.5.1): the same checks,
 * in the same order and with the same words, as `assertLookAllowed`, with nothing read again.
 */
export function lookAllowedFrom(mc: { ctx: OrgContext; desktop: boolean; look: DesktopLook }): { workspace: AppRule[]; you: AppRule[]; act: DesktopAct } {
  if (!mc.desktop) throw new AppError(403, "LOOK_DESKTOP_ONLY", W.errors.desktopOnly);
  if (mc.ctx.user.impersonation) throw new AppError(403, "LOOK_IMPERSONATED", W.errors.impersonated);
  const l = mc.look;
  if (!l.ready) throw new AppError(503, "LOOK_NOT_READY", W.errors.notReady);
  switch (l.reason) {
    case null: break;
    case "not_ready": throw new AppError(503, "LOOK_NOT_READY", W.errors.notReady);
    case "no_key": throw new AppError(503, "LOOK_UNAVAILABLE", W.errors.unavailable);
    case "switched_off": throw new AppError(403, "LOOK_SWITCHED_OFF", W.errors.switchedOff);
    case "notice": throw new AppError(403, "LOOK_NOT_YET", W.errors.notYet(longDate(l.availableFrom ?? new Date().toISOString(), mc.ctx.org.timezone)));
    default: throw new AppError(403, "LOOK_NOT_AVAILABLE", W.errors.notAvailable);
  }
  const strip = (source: "workspace" | "you") => l.neverLook.filter((r) => r.source === source).map(({ source: _s, ...r }) => { void _s; return r as AppRule; });
  return { workspace: strip("workspace"), you: strip("you"), act: l.act };
}

/**
 * Steps 2 to 4 of the look route, in order: Brenda for Mac only, not while someone else is signed in as the person,
 * 0057 applied, available (the pilot, the switch, the notice; the key last). Returns the lists the never-look check needs.
 */
export async function assertLookAllowed(ctx: OrgContext): Promise<{ workspace: AppRule[]; you: AppRule[]; act: DesktopAct }> {
  if (!(await isDesktopSession(ctx))) throw new AppError(403, "LOOK_DESKTOP_ONLY", W.errors.desktopOnly);
  if (ctx.user.impersonation) throw new AppError(403, "LOOK_IMPERSONATED", W.errors.impersonated);
  const s = await readState(ctx);
  if (!s.ready) throw new AppError(503, "LOOK_NOT_READY", W.errors.notReady);
  const a = availability(ctx, s);
  switch (a.reason) {
    case null: break;
    case "not_ready": throw new AppError(503, "LOOK_NOT_READY", W.errors.notReady);
    case "no_key": throw new AppError(503, "LOOK_UNAVAILABLE", W.errors.unavailable);
    case "switched_off": throw new AppError(403, "LOOK_SWITCHED_OFF", W.errors.switchedOff);
    case "notice": throw new AppError(403, "LOOK_NOT_YET", W.errors.notYet(longDate(s.row?.available_from ? (iso(s.row.available_from) as string) : new Date().toISOString(), ctx.org.timezone)));
    default: throw new AppError(403, "LOOK_NOT_AVAILABLE", W.errors.notAvailable);
  }
  return { workspace: appRulesOf(s.row?.never_look), you: appRulesOf(s.mine?.never_look), act: actAvailability(true, s) };
}

// ---- The request body (contract A.6) -----------------------------------------------------------------------------------------

/** What the copilot gets for a look: the picture (base64, after its metadata was stripped), the pointer, the app, how. */
export type LookInput = {
  image: { mediaType: "image/jpeg" | "image/png"; data: string; width: number; height: number };
  pointer: { x: number; y: number } | null;
  app: { name: string; bundleId: string | null };
  source: "keys" | "button";
};
export type LookBody = { look: LookInput; messages: { role: "user" | "assistant"; content: string; tainted?: boolean }[] };

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const MAX_BASE64 = Math.ceil(LOOK_LIMITS.imageBytes / 3) * 4;
const edge = z.number().int().min(LOOK_LIMITS.minEdge).max(LOOK_LIMITS.maxEdge);
const coord = z.number().int().min(0);

export const lookBodySchema = z.object({
  version: z.literal(1),
  source: z.enum(["keys", "button"]),
  image: z.object({
    mediaType: z.enum(["image/jpeg", "image/png"]),
    data: z.string().min(4).max(MAX_BASE64).refine((d) => d.length % 4 === 0 && BASE64.test(d)),
    width: edge, height: edge,
  }),
  pointer: z.object({ x: coord, y: coord }).nullable(),
  app: z.object({ name: z.string(), bundleId: z.string().nullable() }),
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(4000), tainted: z.boolean().optional() })).min(1).max(30),
});

const invalidLook = () => new AppError(422, "LOOK_INVALID", W.errors.invalid);

/**
 * The body, checked whole (contract D.6 step 6): any problem is one 422 LOOK_INVALID with no field errors and nothing
 * from the body in it. The picture is decoded, its type sniffed, its own size compared with the claimed one, and its
 * metadata stripped; the decoded buffers are wiped before this returns.
 */
export function readLookBody(raw: Uint8Array): LookBody {
  return readLookBodyValue(parseLookJson(raw));
}

/** A v1 body already parsed. */
export function readLookBodyValue(parsed: unknown): LookBody {
  const r = lookBodySchema.safeParse(parsed);
  if (!r.success) throw invalidLook();
  const b = r.data;
  const { width, height } = b.image;
  if (width * height > LOOK_LIMITS.maxPixels) throw invalidLook();
  if (b.pointer && (b.pointer.x >= width || b.pointer.y >= height)) throw invalidLook();
  const app = cleanAppRule({ name: b.app.name, bundleId: b.app.bundleId });
  // A name the Mac sends is never empty; a bundle id that is not one, or an empty one, is refused rather than read as none.
  if (!app || (b.app.bundleId !== null && app.bundleId === null) || b.app.name.trim().length > APP_RULE_LIMITS.name) throw invalidLook();
  if (b.messages[b.messages.length - 1].role !== "user") throw invalidLook();
  const bytes = Buffer.from(b.image.data, "base64");
  let clean: Buffer | null = null;
  try {
    if (!bytes.length || bytes.length > LOOK_LIMITS.imageBytes) throw invalidLook();
    if (!sniffImage(b.image.mediaType, bytes)) throw invalidLook();
    const size = imageSize(b.image.mediaType, bytes);
    if (!size || size.width !== width || size.height !== height) throw invalidLook();
    clean = stripImageMetadata(b.image.mediaType, bytes);
    if (!clean) throw invalidLook();
    return {
      look: { image: { mediaType: b.image.mediaType, data: clean.toString("base64"), width, height }, pointer: b.pointer, app, source: b.source },
      messages: b.messages,
    };
  } finally {
    bytes.fill(0);
    clean?.fill(0);
  }
}

/** The app that matches a never-look rule, by the rule's own name (never the body's words), or null. */
export function neverLookRefusal(app: { name: string; bundleId: string | null }, rules: { workspace: AppRule[]; you: AppRule[] }): AppError | null {
  const m = neverLookMatch(app, rules);
  return m ? new AppError(409, "LOOK_NEVER_LOOK", W.errors.neverLook(m.name)) : null;
}

/** A short, content-free reason for the server log: the status, the error's class and its code, nothing else. */
export function lookErrorReason(err: unknown): string {
  const e = err as { status?: unknown; code?: unknown; name?: unknown } | null;
  const parts = [typeof e?.status === "number" ? `status ${e.status}` : null, typeof e?.name === "string" ? e.name.slice(0, 40) : null, typeof e?.code === "string" ? e.code.slice(0, 20) : null].filter(Boolean);
  return parts.join(", ") || "unknown error";
}

// ---- Phase 2: the v2 body (owner request, 12 October 2026; contract B.3.2, D.5) ---------------------------------------------

/** One of the v2 look's pictures, after its metadata was stripped; its pointer in its own pixels. */
export type LookPicture = { mediaType: "image/jpeg" | "image/png"; data: string; width: number; height: number; pointer: { x: number; y: number } | null };
/** A file the person could mean (names, kinds and sizes only: paths never leave the Mac). */
/** A file the person could mean; `app`: the app it was found in (review, 12 October 2026: never-look apps' files are refused). */
// Phase 3 (contract C.1, H.1): a folder the person pointed at (the Finder window in front, a folder selected in Finder)
// comes as `kind: "folder"` with source front_folder or finder_selection, its name only.
export type LookFile = { source: FileSource | "front_folder"; name: string; kind: string; bytes: number; app?: { name: string; bundleId: string | null } | null };
export type LookSource = "keys" | "button" | "follow_up" | "drop";

/**
 * A v2 look (phase 2): the whole screen the pointer is on and a close-up round the pointer (both null for a dropped
 * file's request), the request's own record (the person's words, how they came, how old they are, all measured on the
 * Mac), the app under the pointer, the apps blanked out of the picture, what the person turned on on this Mac, and the
 * files they could mean.
 */
export type LookV2Input = {
  source: LookSource;
  request: { text: string; via: "voice" | "typed"; ageMs: number };
  screen: LookPicture | null;
  crop: LookPicture | null;
  display: { widthPt: number; heightPt: number; scale: number } | null;
  /** `desktop`: the pointer was on the desktop (the Mac's own flag; Finder owns the desktop, so the name can't tell). */
  app: { name: string; bundleId: string | null; desktop?: boolean } | null;
  hidden: string[];
  /**
   * Phase 3: `plans`, the plan version this Mac runs (1 with this build's Rust; absent on today's binary, which gets phase
   * 2's propose_task); `accessibility`, false when macOS has not allowed Brenda to click and type.
   */
  abilities: { useMac: boolean; fileWork: boolean; busy: "file" | "plan" | null; plans?: number; accessibility?: boolean };
  files: LookFile[];
  /**
   * Brenda and her helpers (owner brief, 12 October 2026; contract J.1): this Mac's Rust has the front desk (`front: 1`),
   * and which model the look wants: `auto` (the server chooses by the words), `now` (claude-haiku-5-5) or `think`
   * (claude-opus-5-5). Without `front` the look is exactly phase 2/3's.
   */
  front?: boolean;
  lane?: "auto" | "now" | "think";
};
export type LookV2Body = { look: LookV2Input; messages: LookBody["messages"] };

const picture = z.object({
  mediaType: z.enum(["image/jpeg", "image/png"]),
  data: z.string().min(4).max(MAX_BASE64).refine((d) => d.length % 4 === 0 && BASE64.test(d)),
  width: edge, height: edge,
  pointer: z.object({ x: coord, y: coord }).nullable(),
});
const FILE_NAME_BAD = /[/\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

export const lookBodyV2Schema = z.object({
  version: z.literal(2),
  source: z.enum(["keys", "button", "follow_up", "drop"]),
  request: z.object({ text: z.string().trim().min(1).max(ACT_LIMITS.request), via: z.enum(["voice", "typed"]), ageMs: z.number().int().min(0).max(120_000) }),
  screen: picture.nullable(),
  crop: picture.nullable(),
  display: z.object({ widthPt: z.number().positive().max(100_000), heightPt: z.number().positive().max(100_000), scale: z.number().positive().max(8) }).nullable().optional(),
  app: z.object({ name: z.string(), bundleId: z.string().nullable(), desktop: z.boolean().optional() }).nullable(),
  hidden: z.array(z.string().trim().min(1).max(APP_RULE_LIMITS.name)).max(20).default([]),
  abilities: z.object({ useMac: z.boolean(), fileWork: z.boolean(), busy: z.enum(["file", "plan"]).nullable(), plans: z.number().int().min(0).max(99).optional(), accessibility: z.boolean().optional() }),
  files: z.array(z.object({
    source: z.enum([...FILE_SOURCES, "front_folder"]),
    name: z.string().min(1).max(ACT_LIMITS.fileName).refine((n) => !FILE_NAME_BAD.test(n) && n.trim().length > 0),
    // The Mac's reading kinds (B.9.2); any short lower-case word, so a new kind on the Mac never refuses the look.
    kind: z.string().regex(/^[a-z0-9_]{1,16}$/),
    bytes: z.number().int().min(0),
    app: z.object({ name: z.string().max(200), bundleId: z.string().max(255).nullable() }).nullable().optional(),
  }).refine((f) => f.source !== "front_folder" || f.kind === "folder")).max(ACT_LIMITS.filesPerLook).default([]),
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(4000), tainted: z.boolean().optional() })).min(1).max(30),
  // Brenda and her helpers (contract J.1): both optional; `lane` only with `front`.
  front: z.literal(1).optional(),
  lane: z.enum(["auto", "now", "think"]).optional(),
}).refine((b) => b.lane === undefined || b.front === 1);

/** One picture decoded, sniffed, sized and stripped; the decoded buffers wiped. */
function readPicture(p: z.infer<typeof picture>): LookPicture {
  const { width, height } = p;
  if (width * height > LOOK_LIMITS.maxPixels) throw invalidLook();
  if (p.pointer && (p.pointer.x >= width || p.pointer.y >= height)) throw invalidLook();
  const bytes = Buffer.from(p.data, "base64");
  let clean: Buffer | null = null;
  try {
    if (!bytes.length || bytes.length > LOOK_LIMITS.imageBytes) throw invalidLook();
    if (!sniffImage(p.mediaType, bytes)) throw invalidLook();
    const size = imageSize(p.mediaType, bytes);
    if (!size || size.width !== width || size.height !== height) throw invalidLook();
    clean = stripImageMetadata(p.mediaType, bytes);
    if (!clean) throw invalidLook();
    return { mediaType: p.mediaType, data: clean.toString("base64"), width, height, pointer: p.pointer };
  } finally {
    bytes.fill(0);
    clean?.fill(0);
  }
}

/**
 * A v2 body, checked whole (contract D.5): any problem is one 422 LOOK_INVALID with nothing from the body in it. Both
 * pictures are decoded, sniffed, sized and stripped; only a dropped file's request has none; the request's words must be
 * the last message's; the app (null only for a drop) as phase 1.
 */
export function readLookBodyV2(raw: Uint8Array): LookV2Body {
  return readLookBodyV2Value(parseLookJson(raw));
}

/** The body's JSON (one 422 when it is not JSON). */
export function parseLookJson(raw: Uint8Array): unknown {
  try { return JSON.parse(new TextDecoder().decode(raw)); } catch { throw invalidLook(); }
}

/** A v2 body already parsed (the route parses once, to read its version). */
export function readLookBodyV2Value(parsed: unknown): LookV2Body {
  const r = lookBodyV2Schema.safeParse(parsed);
  if (!r.success) throw invalidLook();
  const b = r.data;
  const last = b.messages[b.messages.length - 1];
  if (last.role !== "user" || last.content.trim() !== b.request.text.trim()) throw invalidLook();
  const drop = b.source === "drop";
  if (drop ? b.screen !== null || b.crop !== null : b.screen === null) throw invalidLook();
  if (b.source === "button" && b.crop !== null) throw invalidLook();
  let app: LookV2Input["app"] = null;
  if (b.app) {
    const cleaned = cleanAppRule({ name: b.app.name, bundleId: b.app.bundleId });
    if (!cleaned || (b.app.bundleId !== null && cleaned.bundleId === null) || b.app.name.trim().length > APP_RULE_LIMITS.name) throw invalidLook();
    app = { ...cleaned, ...(b.app.desktop === true ? { desktop: true } : {}) };
  } else if (!drop) throw invalidLook();
  const screen = b.screen ? readPicture(b.screen) : null;
  const crop = b.crop ? readPicture(b.crop) : null;
  return {
    look: {
      source: b.source, request: { text: b.request.text.trim(), via: b.request.via, ageMs: b.request.ageMs },
      screen, crop, display: b.display ?? null, app,
      hidden: [...new Set(b.hidden.map((h) => h.replace(/\s+/g, " ").trim()))].slice(0, 20),
      abilities: b.abilities, files: b.files.map((f) => ({ ...f, name: f.name.trim() })),
      ...(b.front === 1 ? { front: true, lane: b.lane ?? "auto" } : {}),
    },
    messages: b.messages,
  };
}

/** Which version a parsed look body is: 2 only when it says so (today's Mac sends 1). */
export function lookBodyVersion(parsed: unknown): 1 | 2 {
  return parsed && typeof parsed === "object" && (parsed as { version?: unknown }).version === 2 ? 2 : 1;
}
