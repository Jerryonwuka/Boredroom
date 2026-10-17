/**
 * Brenda for Mac's context in one round trip (Brenda and her helpers, build 1; owner's approved brief, 12 October 2026:
 * "server ≤ 0.3 s (fewer sequential trips, warm connections …)", measured that day from the owner's Mac at about 240 ms
 * per round trip to the database; contract K.5.1).
 *
 * Every front-desk and job route needs the same things before it can answer: the session, the membership, the
 * organisation and its plan (orgContext); whether the session is Brenda for Mac's; whether screen help and actions are
 * available here (the workspace's settings and the person's own never-look list); the person's assistant's name; today's
 * requests; "Check with me before every task"; whether a call rings for them; this minute's burst count. Read one by one
 * that was about ten round trips. Here it is ONE simple-protocol query string: BEGIN; the context statement as the system
 * role; the session's kind, the call and the burst count; the person's id bound for row security and the role reset;
 * then, under the person's own row security, one SELECT of their reads; COMMIT. A query string takes no parameters, so
 * the only values in it are checked first (the token's SHA-256 is hex; the workspace is a slug or a UUID; the front
 * desk's nonce, when the route passes one for its replay check, is 32 lowercase hex).
 *
 * The fast path runs only once migration 0060 is known to be applied (cached), which implies 0057 to 0059: every table it
 * names is there. Otherwise, or on any error (the transaction is rolled back and the connection released), the ordinary
 * reads run instead and answer the same.
 */
import type { PoolClient, QueryResult } from "pg";
import { getPool, withUser } from "@/server/db";
import { orgContext, orgContextOf, orgContextSql, type OrgContext } from "@/server/lib/api";
import { AppError, unauthenticated } from "@/server/lib/errors";
import { sha256 } from "@/server/lib/crypto";
import { addDays, localMidnight, todayLocal } from "@/server/lib/time";
import { schema0060Known, schema0060Ready } from "@/server/lib/schema-0060";
import { requestSessionToken } from "@/server/auth";
import { AI_BURST, AI_DAILY_REQUEST_LIMIT, LIMITED_PURPOSES, aiAllowance, type Allowance } from "@/server/services/ai-usage";
import { desktopLook, desktopLookOf, isDesktopSession, lookEligible, onLiveCall, type LookState } from "@/server/services/screen-help";
import { toProfile, DEFAULT_ASSISTANT_NAME } from "@/lib/assistant-look";
import type { AppRule, DesktopLook } from "@/lib/screen-help";

export type MacContext = {
  ctx: OrgContext;
  /** A Brenda for Mac (desktop) session. */
  desktop: boolean;
  /** Migration 0060 is applied. */
  ready0060: boolean;
  look: DesktopLook;
  lists: { workspace: AppRule[]; you: AppRule[] };
  name: string;
  allowance: Allowance | null;
  checkEvery: boolean;
  onCall: boolean;
  /** This minute's requests to the person's assistant so far (the burst limit's count), or null when not read. */
  burstHits: number | null;
  /** Read in one round trip (tests and timing only). */
  fast: boolean;
  /**
   * Whether the person used this request's nonce before (FRONT_REPLAY), read in the same round trip when the route
   * passed the nonce (the front desk; integration, 16 October 2026: it was a transaction of its own, three more round
   * trips on the owner's link). Absent: not read here, so the caller asks the ordinary way.
   */
  nonce?: { value: string; used: boolean };
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const NONCE = /^[0-9a-f]{32}$/;

const listsOf = (look: DesktopLook) => ({
  workspace: look.neverLook.filter((r) => r.source === "workspace").map(({ source: _s, ...r }) => { void _s; return r; }),
  you: look.neverLook.filter((r) => r.source === "you").map(({ source: _s, ...r }) => { void _s; return r; }),
});

/** The ordinary reads (several round trips), answering exactly what the fast path answers. */
async function slowContext(orgSlug: string): Promise<MacContext> {
  const ctx = await orgContext(orgSlug);
  const desktop = await isDesktopSession(ctx);
  const look = await desktopLook(ctx);
  const ready0060 = schema0060Known() ?? await withUser(ctx.user.profileId, (db) => schema0060Ready(db)).catch(() => false);
  const [onCall, name, allowance] = await Promise.all([
    onLiveCall(ctx).catch(() => false),
    import("@/server/services/assistant-profile").then((m) => m.assistantProfiles(ctx)).then((p) => p.personal.name).catch(() => DEFAULT_ASSISTANT_NAME),
    aiAllowance(ctx).catch(() => null),
  ]);
  return { ctx, desktop, ready0060, look, lists: listsOf(look), name, allowance, checkEvery: !!look.front?.checkEvery, onCall, burstHits: null, fast: false };
}

/** The query string (exported for the unit test, which checks every value in it was checked first). */
export function macContextSql(tokenHash: string, slug: string, nonce?: string): string {
  if (!HEX64.test(tokenHash) || !(SLUG.test(slug) || UUID.test(slug))) throw new Error("mac-context: unexpected value");
  if (nonce !== undefined && !NONCE.test(nonce)) throw new Error("mac-context: unexpected value");
  const h = `'${tokenHash}'`, o = `'${slug}'`;
  const context = orgContextSql().replace(/\$1\b/g, h).replace(/\$2\b/g, o);
  if (/\$\d/.test(context)) throw new Error("mac-context: the context statement takes other parameters");
  const purposes = LIMITED_PURPOSES.map((p) => `'${p.replace(/[^a-z_]/g, "")}'`).join(", ");
  const meSystem = `me AS (SELECT m.id AS mid, o.id AS oid, p.id AS pid FROM auth_sessions s JOIN auth_users u ON u.id = s.user_id JOIN profiles p ON p.auth_user_id = u.id
      JOIN memberships m ON m.user_id = p.id JOIN organisations o ON o.id = m.organisation_id
      WHERE s.token_hash = ${h} AND s.revoked_at IS NULL AND s.expires_at > now() AND u.status = 'active' AND (o.slug = ${o} OR o.id::text = ${o}) AND m.status = 'active' LIMIT 1)`;
  const mePerson = `me AS (SELECT m.id AS mid, m.organisation_id AS oid, o.timezone AS tz FROM memberships m JOIN organisations o ON o.id = m.organisation_id
      WHERE (o.slug = ${o} OR o.id::text = ${o}) AND m.user_id = app_user_id() AND m.status = 'active' LIMIT 1)`;
  const midnight = "(date_trunc('day', now() AT TIME ZONE me.tz) AT TIME ZONE me.tz)";
  return [
    "BEGIN",
    "SELECT set_config('app.role', 'system', true)",
    context,
    `WITH ${meSystem}
     SELECT (SELECT kind FROM auth_sessions WHERE token_hash = ${h} AND revoked_at IS NULL AND expires_at > now()) AS session_kind,
            EXISTS (SELECT 1 FROM call_participants cp JOIN calls c ON c.id = cp.call_id, me
                    WHERE cp.membership_id = me.mid AND c.organisation_id = me.oid AND c.state <> 'ended'
                      AND (cp.state = 'joined' OR (cp.state = 'ringing' AND cp.rang_at > now() - interval '30 seconds'))) AS on_call,
            (SELECT r.hits FROM auth_rate_limits r, me WHERE r.bucket = 'ai.burst:' || me.mid::text
               AND r.window_start = to_timestamp(floor(extract(epoch from now()) / ${AI_BURST.windowSeconds}) * ${AI_BURST.windowSeconds})) AS burst_hits,
            set_config('app.user_id', COALESCE((SELECT pid::text FROM me), ''), true) AS bound`,
    "SELECT set_config('app.role', '', true)",
    `WITH ${mePerson}
     SELECT (SELECT jsonb_build_object('allowed', s.allowed, 'notice_at', s.notice_at, 'available_from', s.available_from, 'never_look', s.never_look,
                                       'actions_allowed', s.actions_allowed)
               FROM screen_help_settings s, me WHERE s.organisation_id = me.oid) AS settings,
            (SELECT jsonb_build_object('never_look', ap.screen_help_never_look, 'off_at', ap.screen_help_off_at, 'setup_at', ap.screen_help_setup_at,
                                       'check_every', ap.check_every_task)
               FROM assistant_private ap, me WHERE ap.membership_id = me.mid) AS mine,
            (SELECT ap.name FROM assistant_profiles ap, me WHERE ap.membership_id = me.mid) AS name,
            (SELECT count(DISTINCT a.request_id)::int FROM ai_usage a, me WHERE a.organisation_id = me.oid AND a.membership_id = me.mid
               AND a.purpose = ANY(ARRAY[${purposes}]::text[]) AND a.created_at >= ${midnight}) AS used,
            (SELECT COALESCE(sum(t.units), 0)::int FROM assistant_task_units t, me WHERE t.organisation_id = me.oid AND t.membership_id = me.mid
               AND t.confirmed_at >= ${midnight}) AS units,
            (SELECT 1 FROM me) AS member,
            ${nonce === undefined ? "NULL::boolean" : `EXISTS (SELECT 1 FROM mac_requests r, me WHERE r.membership_id = me.mid AND r.nonce = '${nonce}')`} AS replay`,
    "COMMIT",
  ].join(";\n");
}

type SystemRow = { session_kind: string | null; on_call: boolean; burst_hits: number | null };
type PersonRow = { settings: Record<string, unknown> | null; mine: Record<string, unknown> | null; name: string | null; used: number | null; units: number | null; member: number | null; replay: boolean | null };

/** For the unit test: the pool connection's queries are counted there. */
export async function connectForMacContext(): Promise<PoolClient> { return getPool().connect(); }

/**
 * The one-trip read, or null when it can't be used here (0060 not known to be applied, a value that isn't what it should
 * be, a workspace whose screen-help notice hasn't started yet, or any error): the caller then reads the ordinary way.
 */
async function fastContext(orgSlug: string, token: string, nonce?: string): Promise<MacContext | null> {
  if (schema0060Known() !== true) return null;
  const hash = sha256(token);
  let sql: string;
  try { sql = macContextSql(hash, String(orgSlug ?? "").trim().toLowerCase(), nonce); } catch { return null; }
  const client = await connectForMacContext();
  let res: QueryResult[];
  try {
    res = (await client.query(sql)) as unknown as QueryResult[];
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    console.warn(`[front] MAC_CONTEXT_SLOW ${(err as { code?: string })?.code ?? "error"}`);
    return null;
  }
  client.release();
  if (!Array.isArray(res) || res.length < 7) return null;
  const ctx = orgContextOf((res[2].rows[0] as Record<string, unknown> | undefined) ?? null);
  if (ctx instanceof AppError) throw ctx;
  const sys = res[3].rows[0] as SystemRow;
  const person = res[5].rows[0] as PersonRow;
  // Not a member as the person sees it (should not happen once the context said so): the ordinary reads decide.
  if (!person?.member) return null;
  const eligible = lookEligible(ctx.org.slug);
  const row = person.settings as LookState["row"];
  // The first time the workspace is offered screen help its notice starts (a write): the ordinary path does that.
  if (eligible && !row) return null;
  const state: LookState = {
    ready: true, eligible, row, mine: person.mine as LookState["mine"], actReady: true, macReady: true, frontReady: true,
  };
  const look = desktopLookOf(ctx, state);
  const tz = ctx.org.timezone;
  const used = (Number(person.used) || 0) + (Number(person.units) || 0);
  const allowance: Allowance = {
    ready: true, used, limit: AI_DAILY_REQUEST_LIMIT, remaining: Math.max(0, AI_DAILY_REQUEST_LIMIT - used),
    resetsAt: localMidnight(addDays(todayLocal(tz), 1), tz).toISOString(),
  };
  return {
    ctx, desktop: sys?.session_kind === "desktop", ready0060: true, look, lists: listsOf(look),
    name: toProfile({ name: person.name }).name, allowance, checkEvery: person.mine?.check_every === true,
    onCall: !!sys?.on_call, burstHits: typeof sys?.burst_hits === "number" ? sys.burst_hits : 0, fast: true,
    ...(nonce !== undefined && typeof person.replay === "boolean" ? { nonce: { value: nonce, used: person.replay } } : {}),
  };
}

/**
 * Brenda for Mac's whole context for a front-desk or job route: in one round trip when it can be, else the ordinary way.
 * `nonce` (the front desk's request, 32 lowercase hex; anything else is ignored): whether the person used it before is
 * read in the same trip.
 */
export async function macContext(orgSlug: string, o: { nonce?: string | null } = {}): Promise<MacContext> {
  const token = await requestSessionToken();
  if (!token) throw unauthenticated();
  const nonce = typeof o.nonce === "string" && NONCE.test(o.nonce) ? o.nonce : undefined;
  try {
    const fast = await fastContext(orgSlug, token, nonce);
    if (fast) return fast;
  } catch (err) {
    if (err instanceof AppError) throw err;
  }
  return slowContext(orgSlug);
}
