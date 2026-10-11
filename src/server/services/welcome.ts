/**
 * The first-run welcome (owner request, 11 October 2026: "when new users login and create an account i need there to be a
 * sort of set up, walkthrough guide, elevator pitch kind of thing … then maybe after, a 'you're all set up' message").
 * One full-screen page per workspace, `/app/[workspace]/welcome`; the screens, the words and each role's first action live
 * in lib/welcome (shared with the client). This file is the server's side:
 * - the person's own progress (migration 0056: `assistant_private`, the person and the worker only, never a colleague or a
 *   manager), read by `welcomeState` and written by `markWelcome` (PATCH) and `finishWelcome` (POST /done);
 * - the gate (`welcomeGatePath`): a bare `/app/{slug}` or `/app/{slug}/home` opens the welcome while it is unfinished, at
 *   most WELCOME_AUTO_SHOWS times, never while impersonated; deep links and APIs are never taken over;
 * - everything the page shows (`welcomeView`), each read with its own fallback so one failed read never fails the page;
 * - Next steps on the assistant's page (`nextStepsFor`): only what is left to do, derived from data.
 * Before 0056 (the real database today) the welcome still works, keeping its step in the browser's session; the gate
 * never fires, progress writes answer 503, and finishing marks the assistant's setup done so the old "Meet your
 * assistant" dialog never follows (contract 8.3, server/lib/schema-0056).
 *
 * Nothing about a person's setup is ever shown to anyone else; the one platform event (`WELCOME_FINISHED`) carries no
 * person id, and the aggregate funnel lives in docs/runbooks.md for the lead.
 */
import { cache } from "react"; // a pass-through outside a render (route handlers, tests)
import { z } from "zod";
import { withSystem, withUser, type Db } from "@/server/db";
import type { OrgContext } from "@/server/lib/api";
import { AppError, forbidden } from "@/server/lib/errors";
import { retryWithout0056, schema0056Known, schema0056Ready } from "@/server/lib/schema-0056";
import { aiConnected, assistantProfiles, assistantSchemaReady } from "@/server/services/assistant-profile";
import { naturalVoiceView } from "@/server/services/natural-voice";
import { myTeams, policyView } from "@/server/services/views";
import { DEFAULT_NOTICE, noticeMentionsScreenRecording } from "@/server/services/orgs";
import { listDevices } from "@/server/services/desktop";
import { emitEvent } from "@/server/admin/events";
import { ASK_STATE } from "@/lib/act-mode";
import { DEFAULT_PROFILES, type AssistantProfiles } from "@/lib/assistant-look";
import {
  COUNTED_STEPS, WELCOME_AUTO_SHOWS, WELCOME_NOT_READY, WELCOME_WORDS, bringsTeam, firstActionFor, firstNameOf, isCountedStep, isWelcomeStep, welcomeAutoPath,
  type FirstActionInput, type NextStepItem, type NextSteps, type WelcomeDoneInput, type WelcomeNotice, type WelcomeOutcome,
  type WelcomePatch, type WelcomeRole, type WelcomeState, type WelcomeTeamData, type WelcomeView,
} from "@/lib/welcome";

// ---- Bodies --------------------------------------------------------------------------------------------------------------

/** The steps skipped so far: counted steps, each once, five at most (0056's check constraint says the same). */
const skippedSchema = z.array(z.enum(COUNTED_STEPS, { error: "Unknown step." })).max(COUNTED_STEPS.length)
  .refine((a) => new Set(a).size === a.length, { message: "Each step once." });

/** PATCH /api/orgs/{org}/welcome: the screen reached (never "done": that is POST /done), skipped steps, a page view, Next steps hidden. */
export const welcomePatchSchema: z.ZodType<WelcomePatch> = z.object({
  step: z.enum(["welcome", "you", "assistant", "how", "seen", "team"], { error: "Unknown step." }).optional(),
  skipped: skippedSchema.optional(),
  seen: z.literal(true).optional(),
  nextStepsHidden: z.boolean().optional(),
}).refine((p) => p.step !== undefined || p.skipped !== undefined || p.seen !== undefined || p.nextStepsHidden !== undefined, { message: "Nothing to save." });

/** POST /api/orgs/{org}/welcome/done: finished or skipped, and the steps skipped on the way. */
export const welcomeDoneSchema: z.ZodType<WelcomeDoneInput> = z.object({
  outcome: z.enum(["done", "skipped"], { error: "Say whether it was finished or skipped." }),
  skipped: skippedSchema.optional(),
});

// ---- Readiness and state ---------------------------------------------------------------------------------------------------

/** Migration 0056 is applied (the shell keeps "Meet your assistant" until it is). Never throws: a failed check reads false. */
export async function welcomeReady(): Promise<boolean> {
  // The shell asks on every workspace page: a cached answer costs no transaction (a distant database shows every round trip).
  const known = schema0056Known();
  if (known !== null) return known;
  try {
    return await withSystem((db) => schema0056Ready(db));
  } catch {
    return false;
  }
}

type StateRow = {
  welcome_step: string | null; welcome_done_at: string | null; welcome_outcome: string | null; welcome_skipped: string[] | null;
  welcome_shown: number | null; next_steps_hidden_at: string | null; you_done: boolean;
};

const OUTCOMES: readonly WelcomeOutcome[] = ["done", "skipped", "existing"];

/**
 * The person's own welcome in this workspace, inside a transaction the caller holds as the person (0056 applied). One
 * statement: their row here (none yet reads as not started) and whether they got past "You" in another workspace, read
 * from their own rows only (RLS shows a person their own assistant_private rows, in every workspace, and nobody else's).
 * Unknown values in the text columns are dropped, never trusted.
 */
export async function readWelcomeState(db: Db, ctx: OrgContext): Promise<WelcomeState> {
  const r = await db.one<StateRow>(
    `SELECT q.welcome_step, q.welcome_done_at, q.welcome_outcome, q.welcome_skipped, q.welcome_shown, q.next_steps_hidden_at,
            EXISTS (SELECT 1 FROM assistant_private o JOIN memberships m ON m.id = o.membership_id
                     WHERE m.user_id = $2 AND o.membership_id <> $1
                       AND (o.welcome_done_at IS NOT NULL OR o.welcome_step IN ('assistant','how','seen','team','done'))) AS you_done
       FROM (SELECT 1) one LEFT JOIN assistant_private q ON q.membership_id = $1`, [ctx.membership.id, ctx.user.profileId]);
  const skipped = [...new Set((r.welcome_skipped ?? []).filter(isCountedStep))];
  return {
    ready: true,
    done: !!r.welcome_done_at,
    outcome: OUTCOMES.includes(r.welcome_outcome as WelcomeOutcome) ? (r.welcome_outcome as WelcomeOutcome) : null,
    step: isWelcomeStep(r.welcome_step) ? r.welcome_step : null,
    skipped,
    shown: Math.max(0, Math.min(99, Number(r.welcome_shown ?? 0) || 0)),
    nextStepsHidden: !!r.next_steps_hidden_at,
    youDone: !!r.you_done,
  };
}

/** Before 0056: nothing is kept on the server, and "done" is whether the assistant's setup is done (the old dialog's mark). */
async function notReadyState(ctx: OrgContext): Promise<WelcomeState> {
  return { ...WELCOME_NOT_READY, done: (await assistantProfiles(ctx)).setupDone };
}

/**
 * The person's welcome in this workspace, once per request (React's cache: the page, the shell and Settings share it).
 * Before 0056 it reads as not ready (contract 8.3).
 */
export const welcomeState = cache(async (ctx: OrgContext): Promise<WelcomeState> => {
  // A "not yet" under 30 seconds old needs no transaction at all (every bare /home asks, through the gate).
  if (schema0056Known() === false) return notReadyState(ctx);
  const state = await retryWithout0056(() => withUser(ctx.user.profileId, async (db) => ((await schema0056Ready(db)) ? readWelcomeState(db, ctx) : null)));
  return state ?? notReadyState(ctx);
});

/**
 * Where a bare workspace address goes instead of the assistant's page (contract 3.2): the welcome, while it is
 * unfinished and has opened on its own fewer than WELCOME_AUTO_SHOWS times; never while impersonated (Control Center
 * support never sees or counts it) and never before 0056. Null otherwise, and when the state cannot be read: the gate
 * never stands between anyone and their page.
 */
export async function welcomeGatePath(ctx: OrgContext): Promise<string | null> {
  if (ctx.user.impersonation) return null;
  try {
    const s = await welcomeState(ctx);
    return s.ready && !s.done && s.shown < WELCOME_AUTO_SHOWS ? welcomeAutoPath(ctx.org.slug) : null;
  } catch (err) {
    console.warn(`[welcome] the gate could not read the welcome, so the page opens as usual: ${(err as Error)?.message ?? String(err)}`);
    return null;
  }
}

// ---- Writing -----------------------------------------------------------------------------------------------------------------

function notWhileImpersonated(ctx: OrgContext) {
  if (ctx.user.impersonation) throw forbidden(WELCOME_WORDS.errors.impersonated);
}

/**
 * Saves progress on the person's own row (PATCH): the screen reached, the steps skipped, a page view (`seen`: the first
 * sets the start time, each adds one to `shown`, which the gate counts), and whether Next steps is hidden. Once the
 * welcome is done only `nextStepsHidden` changes anything (a replay saves nothing, and a stale tab cannot reopen it).
 * 403 while impersonated, 503 before 0056 (the page keeps its step in the browser's session then).
 */
export async function markWelcome(ctx: OrgContext, patch: WelcomePatch): Promise<WelcomeState> {
  notWhileImpersonated(ctx);
  const step = patch.step ?? null;
  const skipped = patch.skipped ? [...new Set(patch.skipped)] : null;
  const seen = patch.seen === true;
  const hidden = patch.nextStepsHidden ?? null;
  return retryWithout0056(() => withUser(ctx.user.profileId, async (db) => {
    if (!(await schema0056Ready(db))) throw new AppError(503, "NOT_READY", WELCOME_WORDS.errors.notReady);
    await db.query(
      `INSERT INTO assistant_private(membership_id, organisation_id, welcome_step, welcome_skipped, welcome_shown, welcome_started_at, next_steps_hidden_at)
       VALUES ($1, $2, $3::text, COALESCE($4::text[], '{}'::text[]), CASE WHEN $5::boolean THEN 1 ELSE 0 END,
               CASE WHEN $5::boolean THEN now() END, CASE WHEN $6::boolean THEN now() END)
       ON CONFLICT (membership_id) DO UPDATE SET
         welcome_step = CASE WHEN assistant_private.welcome_done_at IS NULL AND $3::text IS NOT NULL THEN $3::text ELSE assistant_private.welcome_step END,
         welcome_skipped = CASE WHEN assistant_private.welcome_done_at IS NULL AND $4::text[] IS NOT NULL THEN $4::text[] ELSE assistant_private.welcome_skipped END,
         welcome_shown = CASE WHEN assistant_private.welcome_done_at IS NULL AND $5::boolean THEN LEAST(assistant_private.welcome_shown + 1, 99) ELSE assistant_private.welcome_shown END,
         welcome_started_at = CASE WHEN assistant_private.welcome_done_at IS NULL AND $5::boolean THEN COALESCE(assistant_private.welcome_started_at, now()) ELSE assistant_private.welcome_started_at END,
         next_steps_hidden_at = CASE WHEN $6::boolean IS NULL THEN assistant_private.next_steps_hidden_at
                                     WHEN $6::boolean THEN COALESCE(assistant_private.next_steps_hidden_at, now()) ELSE NULL END`,
      [ctx.membership.id, ctx.org.id, step, skipped, seen, hidden]);
    return readWelcomeState(db, ctx);
  }));
}

type FinishRow = { welcome_step: string | null; welcome_done_at: string | null; welcome_skipped: string[] | null; seconds: number | null; founder: boolean };

/**
 * Finishes the welcome (POST /done): "done" after What's seen or Team, "skipped" from "Skip setup". The assistant's setup
 * is always marked done first (as "Keep Brenda": the look stays), so the old dialog never follows, before 0056 too. Then,
 * once 0056 is applied, the person's row is locked and marked; a second call changes nothing and emits nothing
 * (idempotent). Only the call that finished it records `WELCOME_FINISHED`, after the commit and best-effort, with the
 * workspace, the role, the outcome, the step reached, the steps skipped and the seconds taken: never a person's id or name.
 */
export async function finishWelcome(ctx: OrgContext, input: WelcomeDoneInput): Promise<WelcomeState> {
  notWhileImpersonated(ctx);
  await withUser(ctx.user.profileId, async (db) => {
    if (!(await assistantSchemaReady(db))) return;
    await db.query(
      `INSERT INTO assistant_profiles(membership_id, organisation_id, setup_done_at) VALUES ($1, $2, now())
       ON CONFLICT (membership_id) DO UPDATE SET setup_done_at = COALESCE(assistant_profiles.setup_done_at, now())`,
      [ctx.membership.id, ctx.org.id]);
  });
  const skipped = input.skipped ? [...new Set(input.skipped)] : null;
  const out = await retryWithout0056(() => withUser(ctx.user.profileId, async (db) => {
    if (!(await schema0056Ready(db))) return null;
    await db.query(`INSERT INTO assistant_private(membership_id, organisation_id) VALUES ($1, $2) ON CONFLICT (membership_id) DO NOTHING`, [ctx.membership.id, ctx.org.id]);
    const before = await db.one<FinishRow>(
      `SELECT q.welcome_step, q.welcome_done_at, q.welcome_skipped,
              round(extract(epoch FROM now() - COALESCE(q.welcome_started_at, now())))::int AS seconds,
              ($3 = 'owner' AND NOT EXISTS (SELECT 1 FROM memberships o WHERE o.organisation_id = $2 AND o.created_at < me.created_at)) AS founder
         FROM assistant_private q JOIN memberships me ON me.id = q.membership_id
        WHERE q.membership_id = $1
          FOR UPDATE OF q`, [ctx.membership.id, ctx.org.id, ctx.membership.role]);
    if (before.welcome_done_at) return { state: await readWelcomeState(db, ctx), finished: null };
    await db.query(
      `UPDATE assistant_private SET welcome_done_at = now(), welcome_outcome = $2, welcome_step = 'done',
              welcome_skipped = COALESCE($3::text[], welcome_skipped), welcome_started_at = COALESCE(welcome_started_at, now())
        WHERE membership_id = $1`, [ctx.membership.id, input.outcome, skipped]);
    const state = await readWelcomeState(db, ctx);
    return { state, finished: { step: isWelcomeStep(before.welcome_step) ? before.welcome_step : null, founder: !!before.founder, seconds: Number(before.seconds ?? 0), skipped: state.skipped } };
  }));
  if (!out) return { ...WELCOME_NOT_READY, done: true };
  if (out.finished) {
    const f = out.finished;
    await withSystem((db) => emitEvent(db, "WELCOME_FINISHED", {
      organisationId: ctx.org.id, role: ctx.membership.role, founder: f.founder, outcome: input.outcome, step: f.step, skipped: f.skipped, seconds: f.seconds,
    })).catch(() => undefined);
  }
  return out.state;
}

// ---- What the page shows ---------------------------------------------------------------------------------------------------

type PeopleRow = {
  founder: boolean; lead_name: string | null; owner_name: string | null;
  join_code: string | null; join_code_enabled: boolean | null; join_code_role: string | null; join_code_team_id: string | null;
  teams: { id: string; name: string }[] | null; invitations: number | null; members: number | null;
};

/**
 * The people facts, in one statement as the person: whether they founded the workspace (an owner with no membership of it
 * created before theirs), a lead of their first team (by name; active, not themself), the earliest active owner's name,
 * and for owners and HR the Team step's data (the join code, the teams not archived by name, the invitations made to
 * anyone but the person, the active members other than the person and the owners). Staff and leads read no team data.
 */
async function peopleFacts(ctx: OrgContext): Promise<PeopleRow> {
  const team = bringsTeam(ctx.membership.role);
  return withUser(ctx.user.profileId, (db) => db.one<PeopleRow>(
    `SELECT ($3 = 'owner' AND NOT EXISTS (SELECT 1 FROM memberships o WHERE o.organisation_id = $1
                AND o.created_at < (SELECT created_at FROM memberships WHERE id = $2))) AS founder,
            (SELECT pr.display_name FROM team_members mine
               JOIN teams t ON t.id = mine.team_id AND t.archived_at IS NULL
               JOIN team_members lead ON lead.team_id = t.id AND lead.is_manager AND lead.membership_id <> $2
               JOIN memberships lm ON lm.id = lead.membership_id AND lm.status = 'active'
               JOIN profiles pr ON pr.id = lm.user_id
              WHERE mine.membership_id = $2
                AND t.id = (SELECT t2.id FROM team_members m2 JOIN teams t2 ON t2.id = m2.team_id AND t2.archived_at IS NULL
                             WHERE m2.membership_id = $2 ORDER BY t2.name LIMIT 1)
              ORDER BY pr.display_name LIMIT 1) AS lead_name,
            (SELECT pr.display_name FROM memberships o JOIN profiles pr ON pr.id = o.user_id
              WHERE o.organisation_id = $1 AND o.role = 'owner' AND o.status = 'active' ORDER BY o.created_at LIMIT 1) AS owner_name,
            ${team ? `o.join_code, o.join_code_enabled, o.join_code_role, o.join_code_team_id,
            (SELECT json_agg(json_build_object('id', t.id, 'name', t.name) ORDER BY t.name) FROM teams t WHERE t.organisation_id = $1 AND t.archived_at IS NULL) AS teams,
            (SELECT count(*) FROM invitations i WHERE i.organisation_id = $1 AND lower(i.email::text) <> lower($4)) AS invitations,
            (SELECT count(*) FROM memberships m WHERE m.organisation_id = $1 AND m.status = 'active' AND m.id <> $2 AND m.role <> 'owner') AS members`
              : `NULL::text AS join_code, NULL::boolean AS join_code_enabled, NULL::text AS join_code_role, NULL::uuid AS join_code_team_id,
            NULL::json AS teams, NULL::int AS invitations, NULL::int AS members`}
       FROM organisations o WHERE o.id = $1`,
    team ? [ctx.org.id, ctx.membership.id, ctx.membership.role, ctx.user.email] : [ctx.org.id, ctx.membership.id, ctx.membership.role]));
}

const NO_PEOPLE: PeopleRow = { founder: false, lead_name: null, owner_name: null, join_code: null, join_code_enabled: null, join_code_role: null, join_code_team_id: null, teams: null, invitations: null, members: null };

function teamDataOf(ctx: OrgContext, r: PeopleRow): WelcomeTeamData {
  return {
    isOwner: ctx.membership.role === "owner",
    teams: (r.teams ?? []).map((t) => ({ id: String(t.id), name: String(t.name) })),
    joinCode: { code: r.join_code, enabled: !!r.join_code_enabled, role: r.join_code_role === "manager" ? "manager" : "employee", teamId: r.join_code_team_id },
    invitations: Number(r.invitations ?? 0),
    members: Number(r.members ?? 0),
  };
}

const sameText = (a: string, b: string) => a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();

/** The monitoring notice in force: its words, whether they are today's standard notice, and whether they still describe screen recording. */
async function noticeOf(ctx: OrgContext): Promise<WelcomeNotice> {
  try {
    const { policy } = await policyView(ctx);
    const text = policy?.notice_text ?? null;
    return { text, version: policy?.version ?? null, standard: !!text && sameText(text, DEFAULT_NOTICE), outdated: noticeMentionsScreenRecording(text) };
  } catch {
    return { text: null, version: null, standard: false, outdated: false };
  }
}

/** Whether the person's account has a Google sign-in and a photo (the photo came from Google on their first sign-in). */
async function photoFromGoogle(ctx: OrgContext): Promise<boolean> {
  if (!ctx.user.avatarKey) return false;
  try {
    const r = await withSystem((db) => db.one<{ ok: boolean }>(`SELECT EXISTS (SELECT 1 FROM auth_identities WHERE user_id = $1 AND provider = 'google') AS ok`, [ctx.user.authUserId]));
    return r.ok;
  } catch {
    return false;
  }
}

/** DESKTOP_DOWNLOAD_URL when it is an https address; null otherwise (the welcome then offers to link an installed app). */
export function desktopDownloadUrl(env: Record<string, string | undefined> = process.env): string | null {
  const raw = env.DESKTOP_DOWNLOAD_URL?.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

const leadOf = (teams: { id: string; name: string; is_manager: boolean }[]) => {
  const t = [...teams].filter((x) => x.is_manager).sort((a, b) => a.name.localeCompare(b.name))[0];
  return t ? { id: t.id, name: t.name } : null;
};

const brendaFallback = (ctx: OrgContext): AssistantProfiles => ({ ...DEFAULT_PROFILES, setupDone: false, canEditWorkspace: bringsTeam(ctx.membership.role), act: { ...ASK_STATE } });

/**
 * Everything the welcome page shows (contract 9.3), read in parallel, each with its own fallback so one failed read never
 * fails the page. `replay` holds only once the welcome is done (`?replay=1` before then is the normal flow).
 */
export async function welcomeView(ctx: OrgContext, opts: { replay: boolean; teams?: { id: string; name: string; is_manager: boolean }[] }): Promise<WelcomeView> {
  const warn = (what: string) => (err: unknown) => { console.warn(`[welcome] ${what} could not be read, so the welcome goes on without it: ${(err as Error)?.message ?? String(err)}`); };
  const [state, assistants, natural, connected, notice, people, google, teams] = await Promise.all([
    welcomeState(ctx).catch((err) => { warn("the progress")(err); return { ...WELCOME_NOT_READY }; }),
    assistantProfiles(ctx).catch((err) => { warn("the assistant")(err); return brendaFallback(ctx); }),
    naturalVoiceView(ctx).catch(() => null),
    aiConnected(ctx.org.id),
    noticeOf(ctx),
    peopleFacts(ctx).catch((err) => { warn("the people facts")(err); return NO_PEOPLE; }),
    photoFromGoogle(ctx),
    opts.teams ? Promise.resolve(opts.teams) : myTeams(ctx).catch(() => []),
  ]);
  const role: WelcomeRole = ctx.membership.role;
  const displayName = ctx.user.displayName;
  return {
    state,
    replay: opts.replay && state.done,
    founder: !!people.founder,
    role,
    org: { slug: ctx.org.slug, name: ctx.org.name },
    person: {
      profileId: ctx.user.profileId, displayName, firstName: firstNameOf(displayName), avatarKey: ctx.user.avatarKey ?? null,
      title: ctx.user.title ?? null, statusText: ctx.user.statusText ?? null, photoFromGoogle: google,
    },
    assistants,
    aiPlan: ctx.plan.features.AI_ASSISTANT === true,
    aiConnected: connected,
    natural,
    notice,
    leadFirstName: people.lead_name ? firstNameOf(people.lead_name) : null,
    leadsTeam: leadOf(teams),
    ownerFirstName: people.owner_name ? firstNameOf(people.owner_name) : null,
    team: bringsTeam(role) ? teamDataOf(ctx, people) : null,
    desktopDownloadUrl: desktopDownloadUrl(),
  };
}

// ---- Next steps on the assistant's page --------------------------------------------------------------------------------------

type DoneRow = { invited: boolean; has_team: boolean; assigned: boolean; planned: boolean };

/**
 * Next steps (contract 6.4): shown once the welcome finished or was skipped (never for members from before it,
 * 'existing'), or once an unfinished welcome has opened on its own WELCOME_AUTO_SHOWS times; never while hidden,
 * impersonated or before 0056. Only what is left, in order: finishing the welcome; for owners and HR, inviting the team
 * and creating a team; for a team's lead, assigning a first task; for everyone else, planning today; and the Mac app
 * when there is a download to offer. Each item's "done" is read from data (one statement as the person), never from
 * clicks. Null when nothing is left.
 */
export async function nextStepsFor(ctx: OrgContext): Promise<NextSteps | null> {
  if (ctx.user.impersonation) return null;
  const state = await welcomeState(ctx);
  if (!state.ready || state.nextStepsHidden || state.outcome === "existing") return null;
  if (!state.done && state.shown < WELCOME_AUTO_SHOWS) return null;
  const role: WelcomeRole = ctx.membership.role;
  const leadsTeam = bringsTeam(role) || role !== "manager" ? null : leadOf(await myTeams(ctx));
  const r = await withUser(ctx.user.profileId, (db) => db.one<DoneRow>(
    `SELECT (EXISTS (SELECT 1 FROM invitations i WHERE i.organisation_id = $1 AND lower(i.email::text) <> lower($3))
             OR EXISTS (SELECT 1 FROM organisations o WHERE o.id = $1 AND o.join_code_enabled)
             OR EXISTS (SELECT 1 FROM memberships m WHERE m.organisation_id = $1 AND m.status = 'active' AND m.id <> $2 AND m.role <> 'owner')) AS invited,
            EXISTS (SELECT 1 FROM teams t WHERE t.organisation_id = $1 AND t.archived_at IS NULL) AS has_team,
            EXISTS (SELECT 1 FROM tasks t WHERE t.organisation_id = $1 AND t.created_by = $2 AND t.assignee_membership_id <> $2) AS assigned,
            (EXISTS (SELECT 1 FROM tasks t WHERE t.organisation_id = $1 AND t.created_by = $2 AND t.assignee_membership_id = $2)
             OR EXISTS (SELECT 1 FROM work_sessions w WHERE w.organisation_id = $1 AND w.membership_id = $2)) AS planned`,
    [ctx.org.id, ctx.membership.id, ctx.user.email]));
  const base: FirstActionInput = { slug: ctx.org.slug, role, assistantName: "", leadsTeam, aiReady: false, invited: false, teams: 0, ownerFirstName: null };
  const item = (a: { key: NextStepItem["key"]; label: string; href: string }, external = false): NextStepItem => ({ key: a.key, label: a.label, href: a.href, external });
  const items: NextStepItem[] = [];
  if (!state.done) items.push(item({ key: "finish_welcome", label: WELCOME_WORDS.nextSteps.finishWelcome, href: `/app/${ctx.org.slug}/welcome` }));
  if (bringsTeam(role)) {
    if (!r.invited) items.push(item(firstActionFor({ ...base, invited: false })));
    if (!r.has_team) items.push(item(firstActionFor({ ...base, invited: true, teams: 0 })));
  } else if (role === "manager" && leadsTeam) {
    if (!r.assigned) {
      const aiReady = ctx.plan.features.AI_ASSISTANT === true && (await aiConnected(ctx.org.id));
      const name = aiReady ? (await assistantProfiles(ctx)).personal.name : "";
      items.push(item(firstActionFor({ ...base, aiReady, assistantName: name })));
    }
  } else if (!r.planned) {
    items.push(item(firstActionFor(base)));
  }
  const mac = desktopDownloadUrl();
  if (mac && (await listDevices(ctx.user).catch(() => [{}])).length === 0) items.push(item({ key: "mac_app", label: WELCOME_WORDS.nextSteps.mac, href: mac }, true));
  return items.length ? { items, left: items.length } : null;
}
