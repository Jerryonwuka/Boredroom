/**
 * Brenda desktop (owner decision, 3 October 2026): how the desktop app signs in and what it reads.
 *
 * Sign-in is a device code, the way a TV app links to an account. The app asks for a code, shows the short half
 * ("KQ7M-4TXD") and opens Boredroom; the person, already signed in there, approves it for one workspace. The app polls
 * with the long half and, once approved, claims an ordinary session marked "desktop", good for 90 days, which it sends
 * as a bearer token. The person sees every linked computer and can unlink it, which revokes the session at once.
 *
 * Once linked, the app uses Boredroom's normal API with that token (Brenda's briefing, confirm and presence, the timer,
 * task progress) plus one combined read, `desktopState`, so its poll is a single request.
 *
 * Her voice (owner decision, 7 October 2026: personal assistants, phase 2): the state's `assistant.speak` says when the
 * person's own assistant reads replies aloud ('voice', 'always' or 'never'), the same preference the web follows, so a
 * change in Settings reaches the notch on its next poll.
 *
 * Follow-ups between assistants (owner decision, 8 October 2026: personal assistants, phase 4): the state's `followUps`
 * holds the asks waiting for the person's reply (the notch's request card) and the answers to their own follow-ups from
 * the last 24 hours (its answer card), and each notification carries its `resource_id`, so an unread ask opens its
 * request card. Before migration 0039 `followUps` is `{ ready: false, waiting: [], answered: [] }`; an older notch
 * ignores it.
 *
 * Assistants talk to each other (owner decision, 8 October 2026: personal assistants, phase 6): the state's
 * `assistantItems` holds what other people's assistants brought the person and is waiting for them (a message passed
 * on, a request to accept, a reply to one of theirs: the notch's message and request cards) and what came back to them
 * in the last 24 hours (their requests decided or expired, replies to their messages: its update card). Notifications
 * of type `assistant.*` carry the item's id as `resource_id`, so an unread one opens its card. Before migration 0043
 * `assistantItems` is `{ ready: false, waiting: [], updates: [] }`; an older notch ignores it.
 *
 * Act without asking (owner decision, 8 October 2026): the state's `assistant.act` is the person's permission mode as
 * the server enforces it (lib/act-mode `ActState`: what they chose, whether the workspace allows it, the lock), so the
 * notch shows "Acting without asking" when it is in force. Before migration 0045 it reads `ready: false` and the notch
 * shows nothing; an older notch ignores it.
 *
 * Brenda keeps the loops closed (owner decision, 8 October 2026: phase 7a): the state's `opener` is the morning opener
 * (counts and one-tap actions, services/opener; `null` when it could not be read), which the notch shows instead of the
 * briefing card once a day; `quiet` is whether the person is in their quiet hours (lib/routines `QuietState`: while
 * active the notch opens nothing on its own, plays no sound and speaks nothing on its own); `routineRuns` holds the
 * routine runs delivered in the last 24 hours with their lines, for the routine card. Before migration 0046 `quiet` is
 * `{ ready: false, … }` (never quiet) and `routineRuns` `{ ready: false, recent: [] }`; an older notch ignores all three.
 *
 * Loose ends and commitments (owner decisions, 8 October 2026: phase 7b): the state's `loops` (lib/commitments
 * `DesktopLoops`) holds the commitments noted for the person and the open asks they were told of (the notch's commitment
 * and open-ask cards, at most 5, oldest first), the blocks waiting on them (the blocked-on card), and how many loose
 * ends are open (the day card's link). Notifications of type `brenda.commitment`, `brenda.open_ask` and
 * `brenda.blocked_on` carry the commitment's or block's id as `resource_id`, so an unread one opens its card. Before
 * migration 0048, or when it cannot be read, `loops` is `{ ready: false, commitments: [], blocks: [], looseEnds: { open: 0, … } }`;
 * an older notch ignores it.
 *
 * Standup, abilities and voice (owner decisions, 8–9 October 2026: phase 7c): the state's `standup` (lib/standup
 * `DesktopStandup`) holds the person's standup drafts ready to post today (the notch's standup card: Post, Skip today,
 * Edit on the web) and today's rollups they received and have not seen (its rollup card); notifications of type
 * `brenda.standup`, `brenda.standup_rollup` and `brenda.standup_failed` carry the entry's or rollup's id as
 * `resource_id`. `abilities.off` lists the abilities switched off for the person (by the workspace or by them);
 * `assistant.voice` is false when the workspace switched Voice off (nothing is read aloud; the talk keys say so); the
 * opener is `null` when the morning opener is switched off. Before migration 0050 `standup` is `{ ready: false, entries:
 * [], rollups: [] }`, nothing is off and voice is on; an older notch ignores all three.
 */
import { z } from "zod";
import { withSystem, withUser } from "@/server/db";
import type { OrgContext } from "@/server/lib/api";
import type { CurrentUser } from "@/server/auth";
import { rateLimitIn } from "@/server/auth";
import { randomToken, sha256 } from "@/server/lib/crypto";
import { AppError, forbidden, invalid, notFound } from "@/server/lib/errors";
import { briefing, brendaPrefs, brendaSettings } from "@/server/services/brenda";
import { currentSession } from "@/server/services/sessions";
import { myClock } from "@/server/services/attendance";
import { teamStatus } from "@/server/services/views";
import { aiConnected, readAssistantProfiles } from "@/server/services/assistant-profile";
import { followUpsForDesktop, type DesktopFollowUps } from "@/server/services/follow-ups";
import { assistantItemsForDesktop, type DesktopAssistantItems } from "@/server/services/assistant-items";
import { DEFAULT_ASSISTANT, PALETTE, isAssistantColour, isAssistantEyes, isAssistantVisor, type AssistantEyes, type AssistantProfile, type AssistantSpeak, type AssistantVisor, type FaceShades } from "@/lib/assistant-look";
import { actStateOf, type ActState } from "@/lib/act-mode";
import { morningOpener } from "@/server/services/opener";
import type { Opener } from "@/lib/opener";
import { routineRunsForDesktop, type DesktopRoutineRuns } from "@/server/services/routines";
import { schema0046Ready } from "@/server/lib/schema-0046";
import { NO_QUIET, type QuietState } from "@/lib/routines";
import { loopsForDesktop } from "@/server/services/commitments";
import type { DesktopLoops } from "@/lib/commitments";
import { standupForDesktop } from "@/server/services/standup";
import type { DesktopStandup } from "@/lib/standup";
import { abilitiesFor } from "@/server/services/abilities";
import { abilitiesOff, abilityOff, type AbilityKey } from "@/lib/abilities";

const CODE_TTL_SECONDS = 10 * 60;
const DESKTOP_SESSION_DAYS = 90;
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L: easy to read aloud and type

function userCode() {
  const bytes = randomToken(16);
  let out = "";
  for (let i = 0; out.length < 8; i++) out += ALPHABET[bytes.charCodeAt(i % bytes.length) % ALPHABET.length];
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}
const normalise = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^(.{4})(.{4})$/, "$1-$2");

export const startSchema = z.object({ deviceName: z.string().trim().max(120).optional() });

/** Step one, from the app (no sign-in yet): a fresh pair of codes. */
export async function startLink(input: z.infer<typeof startSchema>, meta: { ip: string; origin: string }) {
  return withSystem(async (db) => {
    await rateLimitIn(db, `desktop.link:${meta.ip}`, 20, 3600);
    await db.query(`DELETE FROM desktop_link_codes WHERE expires_at < now() - interval '1 day'`);
    const deviceCode = randomToken(32);
    let code = userCode();
    for (let tries = 0; tries < 5; tries++) {
      const clash = await db.maybeOne(`SELECT 1 FROM desktop_link_codes WHERE user_code = $1`, [code]);
      if (!clash) break;
      code = userCode();
    }
    await db.query(`INSERT INTO desktop_link_codes(device_code_hash, user_code, device_name, expires_at) VALUES ($1, $2, $3, now() + ($4 || ' seconds')::interval)`,
      [sha256(deviceCode), code, input.deviceName ?? null, String(CODE_TTL_SECONDS)]);
    return { deviceCode, userCode: code, verifyUrl: `${meta.origin}/desktop/link?code=${code}`, expiresIn: CODE_TTL_SECONDS, interval: 3 };
  });
}

export const approveSchema = z.object({ userCode: z.string().trim().min(8).max(12), orgSlug: z.string().trim().min(1).max(80) });

/** Step two, in Boredroom, by the signed-in person: this computer may act as me in this workspace. */
export async function approveLink(user: CurrentUser, input: z.infer<typeof approveSchema>) {
  // Review, 8 October 2026: someone signed in as the person (support) cannot link a computer as them. Its session would
  // carry no impersonation, so it would also slip every lock that holds while they are signed in (act without asking).
  if (user.impersonation) throw forbidden("Only the person can link a computer. It can't be done while you are signed in as them.");
  const code = normalise(input.userCode);
  return withSystem(async (db) => {
    await rateLimitIn(db, `desktop.approve:${user.authUserId}`, 30, 3600);
    const row = await db.maybeOne<{ id: string; expires_at: string; approved_at: string | null; device_name: string | null }>(`SELECT id, expires_at, approved_at, device_name FROM desktop_link_codes WHERE user_code = $1`, [code]);
    if (!row || new Date(row.expires_at) < new Date()) throw invalid("That code is not valid or has expired. Start again from the desktop app.", { userCode: ["Not valid or expired."] });
    if (row.approved_at) throw invalid("That code has already been used.", { userCode: ["Already used."] });
    const org = await db.maybeOne<{ id: string; name: string }>(
      `SELECT o.id, o.name FROM organisations o JOIN memberships m ON m.organisation_id = o.id WHERE o.slug = $1 AND m.user_id = $2 AND m.status = 'active' AND o.status = 'active'`, [input.orgSlug, user.profileId]);
    if (!org) throw notFound("You are not an active member of that workspace.");
    await db.query(`UPDATE desktop_link_codes SET approved_at = now(), approved_user_id = $2, organisation_id = $3 WHERE id = $1`, [row.id, user.authUserId, org.id]);
    await db.query(`INSERT INTO audit_events(actor_user_id, action, subject_type, subject_id, metadata) VALUES ($1, 'auth.desktop_link_approved', 'desktop_link', $2, $3)`,
      [user.authUserId, row.id, JSON.stringify({ organisationId: org.id, deviceName: row.device_name })]);
    return { approved: true, workspace: org.name, deviceName: row.device_name };
  });
}

export const pollSchema = z.object({ deviceCode: z.string().min(20).max(200) });

/** Step three, from the app: pending until approved, then the session token, once. */
export async function pollLink(input: z.infer<typeof pollSchema>, meta: { userAgent?: string }) {
  return withSystem(async (db) => {
    const row = await db.maybeOne<{ id: string; expires_at: string; approved_at: string | null; claimed_at: string | null; approved_user_id: string | null; organisation_id: string | null; device_name: string | null }>(
      `SELECT id, expires_at, approved_at, claimed_at, approved_user_id, organisation_id, device_name FROM desktop_link_codes WHERE device_code_hash = $1 FOR UPDATE`, [sha256(input.deviceCode)]);
    if (!row) throw new AppError(404, "LINK_NOT_FOUND", "Start linking again from the desktop app.");
    if (row.claimed_at) throw new AppError(410, "LINK_USED", "This code has already been used. Start again if you signed out.");
    if (!row.approved_at) {
      if (new Date(row.expires_at) < new Date()) throw new AppError(410, "LINK_EXPIRED", "The code expired before it was approved. Start again.");
      return { status: "pending" as const };
    }
    const token = randomToken(32);
    const session = await db.one<{ id: string }>(
      `INSERT INTO auth_sessions(user_id, token_hash, expires_at, user_agent, kind, device_name) VALUES ($1, $2, now() + ($3 || ' days')::interval, $4, 'desktop', $5) RETURNING id`,
      [row.approved_user_id, sha256(token), String(DESKTOP_SESSION_DAYS), meta.userAgent?.slice(0, 300) ?? "Brenda desktop", row.device_name ?? "Brenda desktop"]);
    await db.query(`UPDATE desktop_link_codes SET claimed_at = now(), session_id = $2 WHERE id = $1`, [row.id, session.id]);
    const who = await db.one<{ slug: string; name: string; display_name: string }>(
      `SELECT o.slug, o.name, p.display_name FROM organisations o, profiles p WHERE o.id = $1 AND p.auth_user_id = $2`, [row.organisation_id, row.approved_user_id]);
    await db.query(`INSERT INTO audit_events(actor_user_id, action, subject_type, subject_id, metadata) VALUES ($1, 'auth.sign_in', 'auth_session', $2, $3)`,
      [row.approved_user_id, session.id, JSON.stringify({ method: "desktop_link", deviceName: row.device_name })]);
    return { status: "approved" as const, token, workspace: { slug: who.slug, name: who.name }, displayName: who.display_name };
  });
}

/** The computers linked to this person, newest first. */
export async function listDevices(user: CurrentUser) {
  return withSystem((db) => db.query<{ id: string; device_name: string | null; created_at: string; last_seen_at: string; expires_at: string }>(
    `SELECT id, device_name, created_at, last_seen_at, expires_at FROM auth_sessions WHERE user_id = $1 AND kind = 'desktop' AND revoked_at IS NULL AND expires_at > now() ORDER BY created_at DESC`, [user.authUserId]));
}

/** Unlinks a computer: its session is revoked and the app signs out on its next request. */
export async function revokeDevice(user: CurrentUser, sessionId: string) {
  return withSystem(async (db) => {
    const r = await db.query(`UPDATE auth_sessions SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND kind = 'desktop' AND revoked_at IS NULL RETURNING id`, [sessionId, user.authUserId]);
    if (!r.length) throw notFound("That computer is not linked to your account.");
    await db.query(`INSERT INTO audit_events(actor_user_id, action, subject_type, subject_id) VALUES ($1, 'auth.desktop_unlinked', 'auth_session', $2)`, [user.authUserId, sessionId]);
    return { revoked: true };
  });
}

/**
 * An assistant as the notch draws it: the profile plus its face colours, resolved here because the notch cannot import
 * lib/assistant-look (owner decision, 7 October 2026: personal assistants).
 */
export type DesktopAssistant = { name: string; colour: string; visor: AssistantVisor; eyes: AssistantEyes; face: FaceShades };
const forNotch = (p: AssistantProfile): DesktopAssistant => ({ name: p.name, colour: p.colour, visor: p.visor, eyes: p.eyes, face: PALETTE[p.colour].face });

export type { DesktopFollowUps, DesktopAssistantItems, DesktopRoutineRuns, DesktopLoops, DesktopStandup };
const NO_FOLLOW_UPS: DesktopFollowUps = { ready: false, waiting: [], answered: [] };
const NO_ITEMS: DesktopAssistantItems = { ready: false, waiting: [], updates: [] };
const NO_RUNS: DesktopRoutineRuns = { ready: false, recent: [] };

/** The morning opener for the notch, without the lists behind its counts (the card shows counts and actions). Never throws. */
async function openerForNotch(ctx: OrgContext, brief: Awaited<ReturnType<typeof briefing>>): Promise<Opener | null> {
  try {
    const o = await morningOpener(ctx, { briefing: brief });
    return Object.fromEntries(Object.entries(o).filter(([k]) => k !== "detail")) as Opener;
  } catch (err) {
    console.warn(`[desktop] opener: ${(err as Error)?.message ?? String(err)}`);
    return null;
  }
}

/**
 * Everything the notch shows, in one read: the briefing, the timer, the clock, unread notifications (Brenda's
 * reminders and nudges, assignments, confirmations), what the person allows, and their own assistant and the
 * workspace's. Polled every 20 seconds. `opener: false` (the notch has shown today's first card): the morning opener is
 * not built (`opener: null`), as it costs a score of reads and the notch shows it once a day (review, 8 October 2026).
 */
/**
 * Teammates' own assistants, for their faces in the notch (owner request, 9 October 2026: "other team's bots still show
 * like this instead of their Brenda"): each person's chosen name, colour, visor and eyes, read under the viewer's own
 * access (profiles are readable by everyone in the workspace, 0035). Anyone without a saved profile is Brenda.
 */
async function teammateAssistants(ctx: OrgContext, ids: string[]): Promise<Map<string, DesktopAssistant>> {
  const out = new Map<string, DesktopAssistant>();
  if (!ids.length) return out;
  const rows = await withUser(ctx.user.profileId, (db) => db.query<{ membership_id: string; name: string; colour: string; visor: string; eyes: string }>(
    `SELECT membership_id, name, colour, visor, eyes FROM assistant_profiles WHERE organisation_id = $1 AND membership_id = ANY($2::uuid[])`,
    [ctx.org.id, ids]));
  for (const r of rows) {
    out.set(r.membership_id, forNotch({
      name: r.name || DEFAULT_ASSISTANT.name,
      colour: isAssistantColour(r.colour) ? r.colour : DEFAULT_ASSISTANT.colour,
      visor: isAssistantVisor(r.visor) ? r.visor : DEFAULT_ASSISTANT.visor,
      eyes: isAssistantEyes(r.eyes) ? r.eyes : DEFAULT_ASSISTANT.eyes,
    }));
  }
  return out;
}

export async function desktopState(ctx: OrgContext, o: { opener?: boolean } = {}) {
  const wantOpener = o.opener !== false;
  const worker = ctx.membership.role === "employee" || ctx.membership.role === "manager";
  const lead = ctx.membership.role !== "employee";
  const noLoops: DesktopLoops = { ready: false, commitments: [], blocks: [], looseEnds: { open: 0, href: `/app/${ctx.org.slug}/home/loose-ends` } };
  const noStandup: DesktopStandup = { ready: false, entries: [], rollups: [] };
  const [brief, session, clock, team, extra, followUps, assistantItems, routineRuns, loops, standup, abilities] = await Promise.all([
    briefing(ctx),
    worker ? currentSession(ctx) : Promise.resolve(null),
    worker ? myClock(ctx) : Promise.resolve(null),
    lead ? teamStatus(ctx) : Promise.resolve(null),
    withUser(ctx.user.profileId, async (db) => ({
      settings: await brendaSettings(db, ctx.org.id),
      prefs: await brendaPrefs(db, ctx.membership.id),
      notifications: await db.query<{ id: string; type: string; title: string; body: string | null; href: string | null; resource_id: string | null; created_at: string }>(
        `SELECT id, type, title, body, href, resource_id, created_at FROM notifications WHERE recipient_membership_id = $1 AND read_at IS NULL ORDER BY created_at DESC LIMIT 10`, [ctx.membership.id]),
      progress: await db.query<{ id: string; title: string; due_at: string | null; progress_percent: number; version: number }>(
        `SELECT id, title, due_at, progress_percent::int AS progress_percent, version FROM tasks WHERE assignee_membership_id = $1 AND status IN ('todo','in_progress','blocked') AND archived_at IS NULL ORDER BY due_at NULLS LAST, created_at DESC`, [ctx.membership.id]),
      assistants: await readAssistantProfiles(db, ctx),
      // Cached for the process once 0046 is there: whether "not quiet" means no quiet hours set or no database update yet.
      quietReady: await schema0046Ready(db),
    })),
    // A follow-up problem never takes the rest of the notch down with it.
    followUpsForDesktop(ctx).catch((err) => { console.warn(`[desktop] follow-ups: ${(err as Error)?.message ?? String(err)}`); return NO_FOLLOW_UPS; }),
    // Nor does a problem with what other people's assistants brought the person (owner decision, 8 October 2026: phase 6).
    assistantItemsForDesktop(ctx).catch((err) => { console.warn(`[desktop] assistant items: ${(err as Error)?.message ?? String(err)}`); return NO_ITEMS; }),
    // Nor does a problem with the routine runs (owner decision, 8 October 2026: phase 7a).
    routineRunsForDesktop(ctx).catch((err) => { console.warn(`[desktop] routine runs: ${(err as Error)?.message ?? String(err)}`); return NO_RUNS; }),
    // Nor does a problem with commitments, blocks or loose ends (owner decisions, 8 October 2026: phase 7b).
    loopsForDesktop(ctx).catch((err) => { console.warn(`[desktop] loops: ${(err as Error)?.message ?? String(err)}`); return noLoops; }),
    // Nor does a problem with standups (owner decisions, 8–9 October 2026: phase 7c).
    standupForDesktop(ctx).catch((err) => { console.warn(`[desktop] standup: ${(err as Error)?.message ?? String(err)}`); return noStandup; }),
    // The abilities switched off for the person (never throws: everything on when it cannot be read).
    abilitiesFor(ctx),
  ]);
  const mates = team ? team.rows.filter((r) => r.membership_id !== ctx.membership.id)
    .sort((a, b) => Number(!!b.session_state) - Number(!!a.session_state) || a.display_name.localeCompare(b.display_name))
    .slice(0, 8) : [];
  // A problem reading their looks never takes the notch down: they show as Brenda.
  const mateLooks = await teammateAssistants(ctx, mates.map((r) => r.membership_id))
    .catch((err) => { console.warn(`[desktop] teammates' assistants: ${(err as Error)?.message ?? String(err)}`); return new Map<string, DesktopAssistant>(); });
  // The opener counts from the briefing just read (no second read of it), and only until the notch has shown today's
  // first card.
  // Phase 7c: none while the morning opener is switched off for the person.
  const opener = wantOpener && abilityOff(abilities, "morning_opener") === null ? await openerForNotch(ctx, brief) : null;
  // Quiet hours come with the profiles read: present only for someone who has them on.
  const quiet: QuietState = extra.assistants.quiet ?? (extra.quietReady ? { ready: true, active: false, until: null, nextStart: null } : { ...NO_QUIET });
  const s = session?.session ?? null;
  const running = s ? extra.progress.find((p) => p.id === s.taskId) : undefined;
  // Whether an AI is connected, only for someone who chose 'auto' (review, 8 October 2026): the notch's pill then says
  // that acting without asking waits for it.
  const act = actStateOf(extra.assistants);
  const ai = act.mode === "auto" ? await aiConnected(ctx.org.id) : undefined;
  return {
    serverNow: new Date().toISOString(),
    me: { displayName: ctx.user.displayName, role: ctx.membership.role, presence: ctx.user.presence ?? "active" },
    workspace: { slug: ctx.org.slug, name: ctx.org.name },
    brendaEnabled: ctx.plan.features.AI_ASSISTANT === true,
    // The person's own assistant and the workspace's, resolved, with the face colours the notch draws (it cannot import
    // lib/assistant-look) (owner decision, 7 October 2026: personal assistants), and when the person's own reads replies
    // aloud (phase 2: her voice; the notch reads anything else, or its absence from an older server, as 'voice'), and
    // whether it asks before acting (act without asking, 8 October 2026; `ready: false` before 0045).
    // Phase 7c: `voice` false when the workspace switched Voice off (speak then reads 'never').
    assistant: { personal: forNotch(extra.assistants.personal), workspace: forNotch(extra.assistants.workspace), speak: extra.assistants.speak, act, voice: extra.assistants.voice !== false, ...(ai === undefined ? {} : { ai }) } satisfies { personal: DesktopAssistant; workspace: DesktopAssistant; speak: AssistantSpeak; act: ActState; voice: boolean; ai?: boolean },
    settings: extra.settings, prefs: extra.prefs,
    clock: clock ? { status: clock.status, workingDay: clock.workingDay, startAt: clock.scheduledStartAt, endAt: clock.scheduledEndAt, clockInAt: clock.record?.clock_in_at ?? null, lateSeconds: clock.record?.late_seconds ?? 0 } : null,
    timer: s ? { id: s.id, version: s.version, state: s.state, taskId: s.taskId, taskTitle: s.taskTitle, confirmedSeconds: s.confirmedSeconds, openIntervalStartedAt: s.openIntervalStartedAt, serverNow: s.serverNow, estimateMinutes: s.estimateMinutes, progress: running?.progress_percent ?? 0, taskVersion: running?.version ?? null } : null,
    briefing: brief,
    notifications: extra.notifications,
    // Asks waiting for the person's reply and answers to their own follow-ups (owner decision, 8 October 2026: phase 4).
    followUps: followUps satisfies DesktopFollowUps,
    // Messages and requests from other people's assistants, and what came back (owner decision, 8 October 2026: phase 6).
    assistantItems: assistantItems satisfies DesktopAssistantItems,
    // The morning opener, quiet hours and the routine runs delivered today (owner decision, 8 October 2026: phase 7a).
    opener,
    quiet,
    routineRuns: routineRuns satisfies DesktopRoutineRuns,
    // Commitments and open asks waiting for the person, blocks waiting on them, and open loose ends (phase 7b).
    loops: loops satisfies DesktopLoops,
    // Standup drafts ready to post and rollups not yet seen, today (owner decisions, 8–9 October 2026: phase 7c).
    standup: standup satisfies DesktopStandup,
    // The abilities switched off for the person (phase 7c): the notch leaves out what they need.
    abilities: { off: abilitiesOff(abilities) satisfies AbilityKey[] },
    // The person's own open tasks, soonest due first: where a dropped file can go.
    myTasks: worker ? extra.progress.slice(0, 8).map((t) => ({ id: t.id, title: t.title, due: t.due_at })) : [],
    // Team leads and organisation accounts: who is working right now, for the small faces in the notch.
    // Each teammate's face is their own assistant (owner request, 9 October 2026), Brenda where they have none.
    team: mates.map((r) => ({ id: r.membership_id, name: r.display_name, state: r.session_state ?? null, task: r.task_title ?? null,
      assistant: mateLooks.get(r.membership_id) ?? forNotch(DEFAULT_ASSISTANT) })),
  };
}
