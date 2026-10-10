/**
 * Calls (owner decisions, 8 October 2026, confirmed 10 October 2026: phase 8, "build Phase 8, cook"). Screen recording for
 * tasks is gone; people call each other instead, on every plan: one-to-one in a direct thread, a group call from a team
 * channel (the team call) or a named channel. Every call is anchored to a conversation the starter reads, so who may call
 * or join is exactly who may write there; owners, HR and team leads get no extra access to anyone's calls.
 *
 * Who does what:
 * - Each person's own step (start, join, accept, decline, leave, end, heartbeat) runs AS THEM (`withUser`) through a
 *   definer function of migration 0054 that answers with a word; this module maps the word to an error or goes on.
 * - Who is rung is chosen as the worker and never shown to the caller (D2, D3): a group call rings the readers who are
 *   online and available (not Offline or Do not disturb, a web or desktop session seen in the last 10 minutes, not in
 *   quiet hours, not in another call), at most 50; a one-to-one call always reaches the other person, rung, or (quiet
 *   hours, Do not disturb) added silently and missed at 30 s.
 * - Time (a ring past 30 s, a device silent for 45 s, 15 minutes alone, the 4-hour cap) is `app_call_settle`'s, run by
 *   `settleCall` as the worker, which also does every side effect still owed, once: missed-call notifications, the
 *   one-to-one call's line in its thread, the recap job, and closing the LiveKit room. It runs after every step, on the
 *   ring-timeout job, on reads that find something past due (C.6), from the webhook and from the sweep, so a lost or late
 *   job never leaves a call wrong.
 * - LiveKit (server/lib/livekit) carries the media; Boredroom's own tables decide who is in a call. Tokens last 2
 *   minutes (fix review, 10 October 2026) and are only minted after the person's own step said yes. LiveKit cannot
 *   revoke a token, so anyone in a call's room without a `joined` row is taken out whenever Boredroom sees them: the
 *   webhook's `participant_joined` (production), a device's heartbeat (at most every 15 s a call) and the sweep.
 * - Who is on a call follows who reads its conversation (fix review, 10 October 2026): someone removed from the channel
 *   or the team, or whose membership ends, is out at once (settleCallsAfterAccessChange runs after those changes; any
 *   settle and their device's next heartbeat do it too) and cannot join it again.
 * - One ringer (fix review, 10 October 2026): a signed-in notch that rings aloud says so on its ring poll
 *   (noteDesktopRinger); a browser on the same network then shows the incoming card without its own ring.
 * Nothing about who called whom is audited (it is not an audit fact); nothing here logs a token or a secret.
 * Before migration 0054 every write answers 503 NOT_READY and the reads answer empty (server/lib/schema-0054); without
 * LiveKit configured every write answers 503 CALLS_NOT_CONFIGURED (history and the call view still read).
 */
import { withSystem, withUser, withWorker, type Db } from "@/server/db";
import type { OrgContext } from "@/server/lib/api";
import { rateLimitIn } from "@/server/auth";
import { keyedDigest } from "@/server/lib/crypto";
import { AppError, conflict, forbidden, invalid, notFound } from "@/server/lib/errors";
import { enqueueJob, notify } from "@/server/services/common";
import { openDirect, sendMessage } from "@/server/services/messaging";
import { quietStateFor } from "@/server/services/routines";
import { retryWithout0054, schema0054Ready } from "@/server/lib/schema-0054";
import { callToken, deleteRoomQuietly, livekit, livekitConfigured, livekitGatewayReady } from "@/server/lib/livekit";
import { PALETTE, toProfile } from "@/lib/assistant-look";
import {
  CALL_LIMITS, CALL_WORDS, callHref, ringExpiresAt,
  type ActiveCall, type CallConnection, type CallConversationKind, type CallEndReason, type CallHistoryItem, type CallHistoryList,
  type CallKind, type CallOutcome, type CallParticipantView, type CallPerson, type CallsNow, type CallState, type CallView, type CallWhere,
  type LiveCallSummary, type NotesConsent, type ParticipantRole, type ParticipantState, type RecapState, type RingingCall,
} from "@/lib/calls";

// ---- Rows and small helpers ------------------------------------------------------------------------------------------------

type CallRow = {
  id: string; organisation_id: string; conversation_id: string; conversation_kind: CallConversationKind; kind: CallKind; room_name: string;
  started_by: string; state: CallState; created_at: string; answered_at: string | null; last_together_at: string | null; ended_at: string | null;
  end_reason: CallEndReason | null; ended_by: string | null; notes_state: "off" | "on"; notes_on_by: string | null; notes_on_at: string | null;
  notes_off_at: string | null; recap_state: RecapState; line_message_id: string | null; room_closed_at: string | null;
};
type PartRow = {
  call_id: string; membership_id: string; role: ParticipantRole; state: ParticipantState; rang_at: string | null; answered_at: string | null;
  first_joined_at: string | null; joined_at: string | null; left_at: string | null; last_seen_at: string | null; created_at: string;
};
type PersonRow = { membership_id: string; name: string; profile_id: string; avatar_key: string | null; a_name: string | null; a_colour: string | null; a_visor: string | null; a_eyes: string | null };
type Word = { word: string; callId?: string; otherCallId?: string | null };
type SettleResult = { found: boolean; ended?: boolean; endedNow?: boolean; reason?: string | null; missed?: string[]; left?: string[] };

const CALL_COLS = `c.id, c.organisation_id, c.conversation_id, c.conversation_kind, c.kind, c.room_name, c.started_by, c.state, c.created_at,
  c.answered_at, c.last_together_at, c.ended_at, c.end_reason, c.ended_by, c.notes_state, c.notes_on_by, c.notes_on_at, c.notes_off_at,
  c.recap_state, c.line_message_id, c.room_closed_at`;
const PART_COLS = `p.call_id, p.membership_id, p.role, p.state, p.rang_at, p.answered_at, p.first_joined_at, p.joined_at, p.left_at, p.last_seen_at, p.created_at`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROOM = /^call-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const firstOf = (name: string) => name.trim().split(/\s+/)[0] || name;
const iso = (v: string | null | undefined) => (v ? new Date(v).toISOString() : null);
const secondsBetween = (from: string, to: string) => Math.max(0, Math.floor((Date.parse(to) - Date.parse(from)) / 1000));
const threadHref = (slug: string, conversationId: string) => `/app/${slug}/messages?c=${conversationId}`;
const warn = (what: string, err: unknown) => console.warn(`[calls] ${what}: ${(err as Error)?.message?.slice(0, 200) ?? String(err)}`);

const notReady = () => new AppError(503, "NOT_READY", CALL_WORDS.notReady);
const notConfigured = () => new AppError(503, "CALLS_NOT_CONFIGURED", CALL_WORDS.notConfigured);

/** A person's step is theirs alone: never while someone else is signed in as them (Control Center support). */
function notWhileImpersonated(ctx: OrgContext) {
  if (ctx.user.impersonation) throw forbidden(CALL_WORDS.errors.impersonated(ctx.user.displayName));
}

/** Whether 0054 is applied (cached by schema-0054). */
async function ready(db?: Db): Promise<boolean> {
  return db ? schema0054Ready(db) : withSystem((d) => schema0054Ready(d));
}

/** The checks every write makes first: not impersonated, 0054 applied, LiveKit configured. */
async function guardWrite(ctx: OrgContext) {
  notWhileImpersonated(ctx);
  if (!(await ready())) throw notReady();
  if (!livekitConfigured()) throw notConfigured();
}

/** A step once more after a deadlock (40P01: two people swapping between the same two calls at the same instant). */
async function retryDeadlock<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if ((err as { code?: string } | null)?.code !== "40P01") throw err;
    return fn();
  }
}

/** The person's own step, as them, answering its word. */
async function step(ctx: OrgContext, sql: string, params: unknown[]): Promise<Word> {
  return retryDeadlock(() => withUser(ctx.user.profileId, async (db) => {
    const r = await db.one<{ r: Word | string }>(sql, params);
    return typeof r.r === "string" ? { word: r.r } : r.r;
  }));
}

/** Calls (0054) as the person sees them: the assistant's face, resolved (the notch draws it; the web may ignore it). */
function personOf(r: PersonRow | undefined, membershipId: string): CallPerson {
  const name = (r?.name ?? "Someone").trim().replace(/\s+/g, " ") || "Someone";
  const profile = toProfile({ name: r?.a_name, colour: r?.a_colour, visor: r?.a_visor, eyes: r?.a_eyes });
  return {
    membershipId, name, firstName: firstOf(name), profileId: r?.profile_id ?? "", avatarKey: r?.avatar_key ?? null,
    assistant: { ...profile, face: PALETTE[profile.colour].face },
  };
}

/** People by membership, with their own assistants' looks (read in whatever context the caller holds). */
async function peopleIn(db: Db, ids: string[]): Promise<Map<string, CallPerson>> {
  const unique = [...new Set(ids.filter((x) => UUID.test(x)))];
  const out = new Map<string, CallPerson>();
  if (!unique.length) return out;
  const rows = await db.query<PersonRow>(
    `SELECT m.id AS membership_id, p.display_name AS name, p.id AS profile_id, p.avatar_key,
            ap.name AS a_name, ap.colour AS a_colour, ap.visor AS a_visor, ap.eyes AS a_eyes
     FROM memberships m JOIN profiles p ON p.id = m.user_id LEFT JOIN assistant_profiles ap ON ap.membership_id = m.id
     WHERE m.id = ANY($1::uuid[])`, [unique]);
  const byId = new Map(rows.map((r) => [r.membership_id, r]));
  for (const id of unique) out.set(id, personOf(byId.get(id), id));
  return out;
}

/**
 * Where each call is, in the viewer's words: "#Design" for a team channel or named channel, the other person's name for a
 * direct call (from the call's own rows: exactly its two people). `name` null: the viewer cannot read that channel (or it
 * is gone); `href` the thread, or null then. Read in the caller's context: as the person, row-level security decides.
 */
async function whereIn(db: Db, slug: string, me: string, calls: Pick<CallRow, "id" | "conversation_id" | "conversation_kind">[], opts: { system?: boolean } = {}): Promise<Map<string, CallWhere>> {
  const out = new Map<string, CallWhere>();
  if (!calls.length) return out;
  const convIds = [...new Set(calls.map((c) => c.conversation_id))];
  const convs = await db.query<{ id: string; name: string | null; readable: boolean }>(
    `SELECT c.id, CASE c.kind WHEN 'team' THEN t.name WHEN 'channel' THEN c.title END AS name,
            ${opts.system ? "app_conversation_has_reader(c.id, $2)" : "true"} AS readable
     FROM conversations c LEFT JOIN teams t ON t.id = c.team_id WHERE c.id = ANY($1::uuid[])`, opts.system ? [convIds, me] : [convIds]);
  const convById = new Map(convs.map((c) => [c.id, c]));
  const direct = calls.filter((c) => c.conversation_kind === "direct").map((c) => c.id);
  const others = direct.length
    ? await db.query<{ call_id: string; name: string }>(
      `SELECT p.call_id, pr.display_name AS name FROM call_participants p JOIN memberships m ON m.id = p.membership_id JOIN profiles pr ON pr.id = m.user_id
       WHERE p.call_id = ANY($1::uuid[]) AND p.membership_id <> $2`, [direct, me])
    : [];
  const otherByCall = new Map(others.map((o) => [o.call_id, o.name.trim().replace(/\s+/g, " ")]));
  for (const c of calls) {
    const conv = convById.get(c.conversation_id);
    const readable = !!conv && conv.readable;
    const name = c.conversation_kind === "direct" ? (otherByCall.get(c.id) ?? null) : conv?.name ? `#${conv.name.trim()}` : null;
    out.set(c.id, { conversationId: c.conversation_id, kind: c.conversation_kind, name: readable || c.conversation_kind === "direct" ? name : null, href: readable ? threadHref(slug, c.conversation_id) : null });
  }
  return out;
}

const endsAtOf = (c: Pick<CallRow, "created_at">) => new Date(Date.parse(c.created_at) + CALL_LIMITS.maxCallMs).toISOString();
const durationOf = (c: Pick<CallRow, "answered_at" | "ended_at">, now: string) => (c.answered_at ? secondsBetween(c.answered_at, c.ended_at ?? now) : null);

// ---- Availability and presence ---------------------------------------------------------------------------------------------

/** Whether calls can be offered: 0054 applied (`ready`), LiveKit configured (`configured`), both (`available`). */
export async function callsAvailability(db?: Db): Promise<{ ready: boolean; configured: boolean; available: boolean }> {
  let isReady = false;
  try { isReady = await ready(db); } catch (err) { warn("availability", err); }
  const configured = livekitConfigured();
  return { ready: isReady, configured, available: isReady && configured };
}

/**
 * Membership ids in a live call in the organisation now (who is on a call, never which call): the Workroom's "On a call",
 * the person card, the notch's teammates. Empty before 0054 or on any failure (never throws): it runs inside the caller's
 * transaction, under a savepoint, so a failure here never aborts the rest of it.
 */
export async function membersOnCall(db: Db, orgId: string): Promise<Set<string>> {
  try {
    if (!(await schema0054Ready(db))) return new Set();
  } catch (err) {
    warn("members on a call (readiness)", err);
    return new Set();
  }
  await db.query("SAVEPOINT members_on_call");
  try {
    const rows = await db.query<{ id: string }>(`SELECT app_members_on_call($1) AS id`, [orgId]);
    await db.query("RELEASE SAVEPOINT members_on_call");
    return new Set(rows.map((r) => r.id));
  } catch (err) {
    await db.query("ROLLBACK TO SAVEPOINT members_on_call").catch(() => undefined);
    warn("members on a call", err);
    return new Set();
  }
}

// ---- The call view ---------------------------------------------------------------------------------------------------------

/** The view of one call as the person (row-level security: a call they may not see is null). */
async function viewIn(db: Db, ctx: OrgContext, callId: string): Promise<CallView | null> {
  if (!UUID.test(callId)) return null;
  const me = ctx.membership.id;
  // `readable`: the person reads the call's conversation now; someone removed from the channel or the team still sees a
  // call they were on (their history) but can no longer join it (fix review, 10 October 2026).
  const c = await db.maybeOne<CallRow & { readable: boolean }>(
    `SELECT ${CALL_COLS}, app_can_read_conversation(c.conversation_id) AS readable FROM calls c WHERE c.id = $1 AND c.organisation_id = $2`, [callId, ctx.org.id]);
  if (!c) return null;
  const parts = await db.query<PartRow>(`SELECT ${PART_COLS} FROM call_participants p WHERE p.call_id = $1`, [callId]);
  const consents = await db.query<{ membership_id: string; consent: "yes" | "no"; decided_at: string }>(
    `SELECT membership_id, consent, decided_at FROM call_note_consents WHERE call_id = $1 ORDER BY decided_at, membership_id`, [callId]);
  const mine = parts.find((p) => p.membership_id === me) ?? null;
  const elsewhereRow = await db.maybeOne<Pick<CallRow, "id" | "conversation_id" | "conversation_kind">>(
    `SELECT c.id, c.conversation_id, c.conversation_kind FROM call_participants p JOIN calls c ON c.id = p.call_id
     WHERE p.membership_id = $1 AND p.state = 'joined' AND c.state <> 'ended' AND c.id <> $2 LIMIT 1`, [me, callId]);
  const people = await peopleIn(db, [...parts.map((p) => p.membership_id), c.started_by, ...(c.notes_on_by ? [c.notes_on_by] : []), ...consents.map((x) => x.membership_id)]);
  const wheres = await whereIn(db, ctx.org.slug, me, elsewhereRow ? [c, elsewhereRow] : [c]);
  const serverNow = new Date().toISOString();
  const live = c.state !== "ended";
  const consentOf = new Map(consents.map((x) => [x.membership_id, x.consent]));
  // The viewer's own answer: theirs when they chose, "pending" when they were in the call and have not; null when they
  // were never in it (they cannot answer).
  const myConsent: NotesConsent | null = mine?.first_joined_at ? (consentOf.get(me) ?? "pending") : null;
  const rank = (p: PartRow) => (p.state === "joined" ? 0 : p.state === "ringing" || p.state === "invited" ? 1 : 2);
  const at = (p: PartRow) => Date.parse(p.first_joined_at ?? p.rang_at ?? p.created_at);
  const sorted = [...parts].sort((a, b) => rank(a) - rank(b) || at(a) - at(b));
  const participants: CallParticipantView[] = sorted.map((p) => ({
    ...people.get(p.membership_id)!, role: p.role, state: p.state, you: p.membership_id === me, inRoom: p.state === "joined",
    rangAt: iso(p.rang_at), firstJoinedAt: iso(p.first_joined_at), joinedAt: iso(p.joined_at), leftAt: iso(p.left_at),
    // Someone else's answer only when it is "yes" (row-level security never returns their "no" anyway).
    consent: p.membership_id === me ? myConsent : consentOf.get(p.membership_id) === "yes" ? "yes" : null,
  }));
  const inRoom = parts.filter((p) => p.state === "joined").length;
  const included = consents.filter((x) => x.consent === "yes").map((x) => people.get(x.membership_id)!).filter(Boolean);
  // Who in the room has not said yes, as the viewer may know it: someone else's "no" is never shown, so it counts here as
  // not answered; the viewer's own "no" is theirs to know.
  const pendingCount = parts.filter((p) => p.state === "joined" && consentOf.get(p.membership_id) !== "yes" && !(p.membership_id === me && consentOf.get(me) === "no")).length;
  const myState = mine?.state ?? null;
  const where = wheres.get(c.id)!;
  return {
    id: c.id, kind: c.kind, state: c.state, where, room: c.room_name,
    startedBy: people.get(c.started_by)!, startedAt: iso(c.created_at)!, answeredAt: iso(c.answered_at), endedAt: iso(c.ended_at), endReason: c.end_reason,
    durationSeconds: durationOf(c, serverNow), endsAt: endsAtOf(c), participants, inRoom,
    me: {
      membershipId: me, state: myState, role: mine?.role ?? null, access: mine ? "participant" : "reader",
      // Join: their own row (rung, declined, missed, left, or joined on another device: this one joins too), or anyone
      // who reads a live group call's conversation; always only while they read it; not when it is full (unless they are
      // already in it).
      canJoin: live && c.readable && (!!mine || c.kind === "group") && (myState === "joined" || inRoom < CALL_LIMITS.maxParticipants),
      canDecline: live && (myState === "ringing" || myState === "invited"),
      canLeave: live && myState === "joined",
      // Only while they still read its conversation (app_call_end; fix review, 10 October 2026).
      canEnd: live && myState === "joined" && c.readable && (c.kind === "direct" || c.started_by === me),
      elsewhere: elsewhereRow ? { callId: elsewhereRow.id, where: wheres.get(elsewhereRow.id)! } : null,
    },
    notes: {
      state: c.notes_state, everOn: !!c.notes_on_at, onBy: c.notes_on_by ? people.get(c.notes_on_by) ?? null : null,
      onAt: iso(c.notes_on_at), offAt: iso(c.notes_off_at), myConsent, included, pendingCount, recap: c.recap_state,
    },
    serverNow,
  };
}

/**
 * The view of a call as the person, or null when they may not see it. Settles first (as the worker) when something is
 * past due: a ring past 30 seconds, a device silent for 45 seconds, 15 minutes alone, the 4-hour cap (C.6).
 */
export async function getCallView(ctx: OrgContext, callId: string): Promise<CallView | null> {
  if (!UUID.test(callId)) return null;
  if (!(await ready())) throw notReady();
  const due = await withUser(ctx.user.profileId, (db) => db.maybeOne<{ due: boolean }>(
    `SELECT (c.state <> 'ended' AND (
               c.created_at <= now() - interval '4 hours'
            OR EXISTS (SELECT 1 FROM call_participants p WHERE p.call_id = c.id AND p.state IN ('ringing', 'invited') AND p.rang_at <= now() - interval '30 seconds')
            OR EXISTS (SELECT 1 FROM call_participants p WHERE p.call_id = c.id AND p.state = 'joined' AND p.last_seen_at < now() - interval '45 seconds')
            OR (c.kind = 'group' AND COALESCE(c.last_together_at, c.created_at) <= now() - interval '15 minutes'))) AS due
     FROM calls c WHERE c.id = $1 AND c.organisation_id = $2`, [callId, ctx.org.id]));
  if (!due) return null;
  if (due.due) await settleQuietly(callId);
  return withUser(ctx.user.profileId, (db) => viewIn(db, ctx, callId));
}

async function viewOrThrow(ctx: OrgContext, callId: string): Promise<CallView> {
  const v = await withUser(ctx.user.profileId, (db) => viewIn(db, ctx, callId));
  if (!v) throw notFound(CALL_WORDS.errors.notFound);
  return v;
}

/** A word that is not 'ok', as the error the person gets (C.3). */
async function wordError(ctx: OrgContext, w: Word): Promise<AppError> {
  switch (w.word) {
    case "not_found": return notFound(CALL_WORDS.errors.notFound);
    case "ended": return conflict("CALL_ENDED", CALL_WORDS.errors.ended);
    case "full": return conflict("CALL_FULL", CALL_WORDS.errors.full);
    case "closed": return conflict("ALREADY_ANSWERED", CALL_WORDS.errors.answered);
    case "not_here": case "bad_people": case "too_many": return conflict("CALL_NOT_HERE", CALL_WORDS.errors.notHere);
    case "not_allowed": return forbidden(CALL_WORDS.errors.notAllowed);
    case "in_call": {
      const other = w.otherCallId ?? null;
      let where: CallWhere | null = null;
      if (other) {
        try {
          where = await withUser(ctx.user.profileId, async (db) => {
            const c = await db.maybeOne<CallRow>(`SELECT ${CALL_COLS} FROM calls c WHERE c.id = $1`, [other]);
            return c ? (await whereIn(db, ctx.org.slug, ctx.membership.id, [c])).get(c.id) ?? null : null;
          });
        } catch (err) { warn("the other call's place", err); }
      }
      return conflict("IN_ANOTHER_CALL", CALL_WORDS.errors.inAnotherCall, { callId: other, where });
    }
    default: return new AppError(500, "INTERNAL", `Something went wrong with that call (${w.word}).`);
  }
}

/** The token metadata the person's tiles draw until the call view arrives (C.1). */
async function connectionFor(ctx: OrgContext, room: string): Promise<CallConnection> {
  const assistant = await withUser(ctx.user.profileId, async (db) => {
    const r = await db.maybeOne<{ name: string; colour: string; visor: string; eyes: string }>(
      `SELECT name, colour, visor, eyes FROM assistant_profiles WHERE membership_id = $1`, [ctx.membership.id]);
    return toProfile(r);
  });
  const name = ctx.user.displayName.trim().replace(/\s+/g, " ").slice(0, 120) || "Someone";
  return callToken({ room, identity: ctx.membership.id, name, metadata: { v: 1, name, profileId: ctx.user.profileId, avatarKey: ctx.user.avatarKey ?? null, assistant } });
}

// ---- Starting a call ---------------------------------------------------------------------------------------------------------

type RingPlan = { ring: string[]; quiet: string[] };

/**
 * Whom to ring (as the worker; never shown to the caller). A direct call: its other person, rung, or added silently in
 * quiet hours or on Do not disturb (D3). A group call: the readers who are online and available, not in quiet hours nor
 * in another call, most recently seen first, at most 50 (D2). Everyone else can join while it runs.
 */
async function ringPlan(orgId: string, conversationId: string, me: string): Promise<RingPlan> {
  return withWorker(async (db) => {
    const conv = await db.maybeOne<{ kind: string }>(`SELECT kind FROM conversations WHERE id = $1 AND organisation_id = $2`, [conversationId, orgId]);
    if (!conv || !["direct", "team", "channel"].includes(conv.kind)) return { ring: [], quiet: [] };
    const rows = await db.query<{ membership_id: string; presence: string | null; online: boolean; seen: string | null; in_call: boolean }>(
      `SELECT r.membership_id, p.presence,
              s.seen IS NOT NULL AND s.seen > now() - make_interval(secs => $3) AS online, s.seen,
              EXISTS (SELECT 1 FROM call_participants cp JOIN calls c ON c.id = cp.call_id
                      WHERE cp.membership_id = r.membership_id AND cp.state = 'joined' AND c.state <> 'ended') AS in_call
       FROM app_conversation_readers($1) r
       JOIN memberships m ON m.id = r.membership_id JOIN profiles p ON p.id = m.user_id
       LEFT JOIN LATERAL (SELECT max(a.last_seen_at) AS seen FROM auth_sessions a
                          WHERE a.user_id = p.auth_user_id AND a.revoked_at IS NULL AND a.expires_at > now()) s ON true
       WHERE r.membership_id <> $2`, [conversationId, me, CALL_LIMITS.onlineWindowMs / 1000]);
    if (conv.kind === "direct") {
      const other = rows[0];
      if (!other) return { ring: [], quiet: [] };
      const quiet = (await quietStateFor(db, other.membership_id)).active || other.presence === "busy";
      return quiet ? { ring: [], quiet: [other.membership_id] } : { ring: [other.membership_id], quiet: [] };
    }
    const candidates = rows
      .filter((r) => r.online && r.presence !== "offline" && r.presence !== "busy" && !r.in_call)
      .sort((a, b) => Date.parse(b.seen ?? "1970-01-01") - Date.parse(a.seen ?? "1970-01-01"));
    const ring: string[] = [];
    for (const r of candidates) {
      if (ring.length >= CALL_LIMITS.ringGroupMax) break;
      if ((await quietStateFor(db, r.membership_id)).active) continue;
      ring.push(r.membership_id);
    }
    return { ring, quiet: [] };
  });
}

/**
 * Starts a call in a conversation the person reads (`conversationId`), or with a person (`to`: their direct thread,
 * created on first use). A live call already there answers `{ existing: true, connection: null }` (the client offers
 * Join). Rate limits: 30 starts an hour, 10 an hour in one conversation.
 */
export async function startCall(ctx: OrgContext, input: { conversationId?: string; to?: string }): Promise<{ call: CallView; existing: boolean; connection: CallConnection | null }> {
  await guardWrite(ctx);
  if (!!input.conversationId === !!input.to) throw invalid("Choose who to call, or where.", { _: ["Send exactly one of conversationId and to."] });
  const me = ctx.membership.id;
  const conversationId = input.to ? await openDirect(ctx, input.to) : input.conversationId!;
  if (!UUID.test(conversationId)) throw notFound(CALL_WORDS.errors.notFound);
  await withSystem(async (db) => {
    await rateLimitIn(db, `call.start:${me}`, CALL_LIMITS.startsPerHour, 3600, CALL_WORDS.errors.rateLimited);
    await rateLimitIn(db, `call.start:${me}:${conversationId}`, CALL_LIMITS.startsPerConversationPerHour, 3600, CALL_WORDS.errors.rateLimited);
  });
  let w: Word = { word: "bad_people" };
  for (let attempt = 0; attempt < 2; attempt++) {
    // Recomputed once when the people changed under us (someone left the channel, or went on another call).
    const plan = await ringPlan(ctx.org.id, conversationId, me);
    w = await step(ctx, `SELECT app_call_start($1, $2::uuid[], $3::uuid[]) AS r`, [conversationId, plan.ring, plan.quiet]);
    if (w.word !== "bad_people" && w.word !== "too_many") break;
  }
  if (w.word === "exists" && w.callId) return { call: await viewOrThrow(ctx, w.callId), existing: true, connection: null };
  if (w.word !== "ok" || !w.callId) throw await wordError(ctx, w);
  const callId = w.callId;
  // After the commit, as the worker: the ring's timeout (the fast path; reads and the sweep also settle it), and a group
  // call's line in its thread now (a one-to-one call's line is posted when it ends).
  await withWorker(async (db) => {
    const c = await db.one<CallRow>(`SELECT ${CALL_COLS} FROM calls c WHERE c.id = $1`, [callId]);
    await enqueueJob(db, "call.ring_timeout", { callId }, { dedupKey: `call.ring:${callId}`, runAt: new Date(Date.now() + CALL_LIMITS.ringMs + 2_000) });
    if (c.kind === "group" && !c.line_message_id) {
      const lineId = await postCallThreadMessage(db, { id: c.id, organisationId: c.organisation_id, conversationId: c.conversation_id },
        { part: "line", senderMembershipId: c.started_by, body: CALL_WORDS.thread.started(ctx.user.displayName), markReadFor: [c.started_by] });
      if (lineId) await db.query(`UPDATE calls SET line_message_id = $2 WHERE id = $1 AND line_message_id IS NULL`, [callId, lineId]);
    }
  });
  const call = await viewOrThrow(ctx, callId);
  return { call, existing: false, connection: await connectionFor(ctx, call.room) };
}

// ---- The person's other steps ---------------------------------------------------------------------------------------------

async function settleQuietly(callId: string, o: { removed?: string[] } = {}) {
  try { await settleCall(callId, o); } catch (err) { warn(`settling ${callId}`, err); }
}

/**
 * The join step (as the person) and its settles: this call, and the call it left when `leaveOther`. Joined, their
 * missed-call notification for this call is read (fix review, 10 October 2026: the bell and the notch kept offering
 * Join on a call they were already in).
 */
async function joinStep(ctx: OrgContext, callId: string, leaveOther: boolean): Promise<void> {
  if (!UUID.test(callId)) throw notFound(CALL_WORDS.errors.notFound);
  const w = await step(ctx, `SELECT app_call_join($1, $2) AS r`, [callId, leaveOther]);
  if (w.word !== "ok") throw await wordError(ctx, w);
  try {
    await withUser(ctx.user.profileId, (db) => db.query(
      `UPDATE notifications SET read_at = now() WHERE recipient_membership_id = $1 AND type = 'call.missed' AND resource_id = $2 AND read_at IS NULL`,
      [ctx.membership.id, callId]));
  } catch (err) { warn("reading the missed-call notification", err); }
  if (w.otherCallId) await settleQuietly(w.otherCallId, { removed: [ctx.membership.id] });
  await settleQuietly(callId);
}

/** Joins a live call (answering a ring, changing one's mind, or a group call one reads) and gives the person a token. */
export async function joinCall(ctx: OrgContext, callId: string, opts: { leaveOther?: boolean } = {}): Promise<{ call: CallView; connection: CallConnection }> {
  await guardWrite(ctx);
  await joinStep(ctx, callId, !!opts.leaveOther);
  const call = await viewOrThrow(ctx, callId);
  return { call, connection: await connectionFor(ctx, call.room) };
}

/** The same step without a token: the notch's Accept, which then opens the call page in the person's browser. */
export async function acceptCall(ctx: OrgContext, callId: string, opts: { leaveOther?: boolean } = {}): Promise<{ call: CallView }> {
  await guardWrite(ctx);
  await joinStep(ctx, callId, !!opts.leaveOther);
  return { call: await viewOrThrow(ctx, callId) };
}

/**
 * Declines the person's own ring. With a message, the person's OWN message is sent (D7): in the call's direct thread, or
 * for a group call as a direct message to the caller. Nothing is stored on the call.
 */
export async function declineCall(ctx: OrgContext, callId: string, message?: string | null): Promise<{ call: CallView; messageId: string | null }> {
  await guardWrite(ctx);
  const text = (message ?? "").trim();
  if (text.length > CALL_LIMITS.declineMessageMax) throw invalid(`Keep the message under ${CALL_LIMITS.declineMessageMax} characters.`, { message: [`At most ${CALL_LIMITS.declineMessageMax} characters.`] });
  if (!UUID.test(callId)) throw notFound(CALL_WORDS.errors.notFound);
  const w = await step(ctx, `SELECT app_call_decline($1) AS r`, [callId]);
  if (w.word !== "ok") throw await wordError(ctx, w);
  await settleQuietly(callId);
  const call = await viewOrThrow(ctx, callId);
  let messageId: string | null = null;
  if (text) {
    const conversationId = call.kind === "direct" ? call.where.conversationId : await openDirect(ctx, call.startedBy.membershipId);
    messageId = (await sendMessage(ctx, { conversationId, body: text })).id;
  }
  return { call, messageId };
}

/** Leaves the call (a one-to-one call then ends). Their device is taken out of the LiveKit room too. */
export async function leaveCall(ctx: OrgContext, callId: string): Promise<{ call: CallView }> {
  await guardWrite(ctx);
  if (!UUID.test(callId)) throw notFound(CALL_WORDS.errors.notFound);
  const w = await step(ctx, `SELECT app_call_leave($1) AS r`, [callId]);
  if (w.word !== "ok") throw await wordError(ctx, w);
  await settleQuietly(callId, { removed: [ctx.membership.id] });
  return { call: await viewOrThrow(ctx, callId) };
}

/** Ends the call for everyone: either person of a direct call, or a group call's starter, while in it. */
export async function endCall(ctx: OrgContext, callId: string): Promise<{ call: CallView }> {
  await guardWrite(ctx);
  if (!UUID.test(callId)) throw notFound(CALL_WORDS.errors.notFound);
  const w = await step(ctx, `SELECT app_call_end($1) AS r`, [callId]);
  if (w.word !== "ok") throw await wordError(ctx, w);
  await settleQuietly(callId);
  return { call: await viewOrThrow(ctx, callId) };
}

/**
 * The person's device is still in the call (every 15 seconds). No view, and no settle unless the step just took the person
 * out: it is the cheapest step there is. 'removed' (they no longer read the call's conversation: fix review, 10 October
 * 2026) answers "left" like any other way out, and the call is settled with them as a leaver, so their device is taken
 * out of LiveKit's room even if it ignores the answer (and a direct call ends). The route compares LiveKit's room with
 * who is in the call after answering an "ok" (reconcileCallSoon).
 */
export async function callHeartbeat(ctx: OrgContext, callId: string): Promise<{ state: "ok" | "left" | "ended" }> {
  await guardWrite(ctx);
  if (!UUID.test(callId)) throw notFound(CALL_WORDS.errors.notFound);
  const w = await step(ctx, `SELECT app_call_heartbeat($1) AS r`, [callId]);
  if (w.word === "removed") {
    await settleQuietly(callId, { removed: [ctx.membership.id] });
    return { state: "left" };
  }
  if (w.word === "ok" || w.word === "left" || w.word === "ended") return { state: w.word };
  throw await wordError(ctx, w);
}

// ---- What is ringing now (the overlay, the dock and the notch) ---------------------------------------------------------------

/**
 * GET /calls/now inside orgContextTx (the system context: every query filters by the person's membership and the
 * organisation). `ringing`: the person's own rings still inside their 30 seconds in live calls, newest first, at most 3,
 * with the caller's face; `active`: the call they are in; both only in conversations the person still reads (fix
 * review, 10 October 2026); `expiredRings`: rings past their time that the route settles after answering. `pollMs`: 2 s
 * while ringing, 4 s otherwise, 60 s while calls are unavailable. `ringsOnDesktop`: a notch on the same `network` rings
 * for the person (noteDesktopRinger), so the browser shows the card without its own ring.
 */
export async function callsNowIn(db: Db, ctx: OrgContext, o: { network?: string | null } = {}): Promise<CallsNow & { expiredRings: string[] }> {
  const serverNow = new Date().toISOString();
  const me = ctx.membership.id;
  const isReady = await schema0054Ready(db);
  const available = isReady && livekitConfigured();
  if (!available) return { ready: isReady, available: false, me, ringing: [], active: null, pollMs: CALL_LIMITS.pollMs.notReady, serverNow, ringsOnDesktop: false, expiredRings: [] };
  const rows = await db.query<CallRow & { my_state: ParticipantState; my_rang_at: string | null; my_joined_at: string | null; expired: boolean; in_room: number }>(
    `SELECT ${CALL_COLS}, p.state AS my_state, p.rang_at AS my_rang_at, p.joined_at AS my_joined_at,
            (p.state = 'ringing' AND p.rang_at <= now() - interval '30 seconds') AS expired,
            (SELECT count(*)::int FROM call_participants x WHERE x.call_id = c.id AND x.state = 'joined') AS in_room
     FROM call_participants p JOIN calls c ON c.id = p.call_id
     WHERE p.membership_id = $1 AND c.organisation_id = $2 AND c.state <> 'ended' AND p.state IN ('ringing', 'joined')
       AND app_conversation_has_reader(c.conversation_id, $1)
     ORDER BY p.rang_at DESC NULLS LAST, c.created_at DESC LIMIT 20`, [me, ctx.org.id]);
  const desktop = o.network
    ? await db.maybeOne<{ ok: boolean }>(
      `SELECT true AS ok FROM call_ringers WHERE membership_id = $1 AND network = $2 AND rings_at > now() - make_interval(secs => $3)`,
      [me, o.network, CALL_LIMITS.desktopRingerMs / 1000])
    : null;
  const expiredRings = rows.filter((r) => r.my_state === "ringing" && r.expired).map((r) => r.id);
  const ringingRows = rows.filter((r) => r.my_state === "ringing" && !r.expired).slice(0, 3);
  const activeRow = rows.find((r) => r.my_state === "joined") ?? null;
  const shown = [...ringingRows, ...(activeRow ? [activeRow] : [])];
  const [people, wheres] = shown.length
    ? await Promise.all([peopleIn(db, ringingRows.map((r) => r.started_by)), whereIn(db, ctx.org.slug, me, shown, { system: true })])
    : [new Map<string, CallPerson>(), new Map<string, CallWhere>()];
  const ringing: RingingCall[] = ringingRows.map((r) => {
    const rangAt = iso(r.my_rang_at) ?? iso(r.created_at)!;
    return {
      id: r.id, kind: r.kind, caller: people.get(r.started_by)!, where: wheres.get(r.id)!, rangAt, expiresAt: ringExpiresAt(rangAt),
      href: callHref(ctx.org.slug, r.id), inAnotherCall: !!activeRow && activeRow.id !== r.id,
    };
  });
  const active: ActiveCall | null = activeRow ? {
    id: activeRow.id, kind: activeRow.kind, where: wheres.get(activeRow.id)!, startedAt: iso(activeRow.created_at)!, answeredAt: iso(activeRow.answered_at),
    joinedAt: iso(activeRow.my_joined_at) ?? iso(activeRow.created_at)!, inRoom: activeRow.in_room, href: callHref(ctx.org.slug, activeRow.id),
  } : null;
  return { ready: true, available: true, me, ringing, active, pollMs: ringing.length ? CALL_LIMITS.pollMs.ringing : CALL_LIMITS.pollMs.idle, serverNow, ringsOnDesktop: !!desktop, expiredRings };
}

/** A network as call_ringers keeps it: a keyed digest of the request's address (never the address itself). */
export const ringerNetworkOf = (address: string) => keyedDigest(`calls.network:${address || "unknown"}`).slice(0, 32);

/**
 * The notch's ring poll (fix review, 10 October 2026: the web tab and the notch rang at once, on their own timers). A
 * signed-in notch (a desktop session) says on GET /calls/now whether it rings aloud for the person (`?ring=1`: its sounds
 * on, not in quiet hours) or not (`?ring=0`); while it does, a browser on the same network shows the incoming card
 * without its own ring. Written at most every 5 seconds a person (the notch polls every 2 to 4); `?ring=0` forgets it at
 * once, so the browser rings again. In the route's system transaction; nothing before 0054.
 */
export async function noteDesktopRinger(db: Db, ctx: OrgContext, o: { network: string; rings: boolean }): Promise<void> {
  if (!(await schema0054Ready(db))) return;
  const session = await db.maybeOne<{ desktop: boolean }>(`SELECT kind = 'desktop' AS desktop FROM auth_sessions WHERE id = $1`, [ctx.user.sessionId]);
  if (!session?.desktop) return;
  if (!o.rings) {
    await db.query(`DELETE FROM call_ringers WHERE membership_id = $1`, [ctx.membership.id]);
    return;
  }
  await db.query(
    `INSERT INTO call_ringers(membership_id, organisation_id, network, rings_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (membership_id) DO UPDATE SET network = EXCLUDED.network, rings_at = EXCLUDED.rings_at
     WHERE call_ringers.network <> EXCLUDED.network OR call_ringers.rings_at < now() - interval '5 seconds'`,
    [ctx.membership.id, ctx.org.id, o.network]);
}

// ---- History and live calls ------------------------------------------------------------------------------------------------

/**
 * The person's calls, newest first, from their side (C.1 CallOutcome): every call they have a row on (rung, joined,
 * started). `filter: "missed"`: the calls they were rung for and never joined; reading them marks their missed-call
 * notifications read. `before`: the `startedAt` of the last item of the previous page.
 */
export async function callHistory(ctx: OrgContext, f: { filter: "all" | "missed"; before?: string | null; limit?: number }): Promise<CallHistoryList> {
  const limit = Math.max(1, Math.min(50, Math.round(f.limit ?? CALL_LIMITS.historyPageSize)));
  const before = f.before && !Number.isNaN(Date.parse(f.before)) ? new Date(f.before).toISOString() : null;
  const me = ctx.membership.id;
  return retryWithout0054(() => withUser(ctx.user.profileId, async (db): Promise<CallHistoryList> => {
    if (!(await schema0054Ready(db))) return { ready: false, items: [], nextBefore: null };
    const rows = await db.query<CallRow & { my_role: ParticipantRole; my_state: ParticipantState; my_first_joined: string | null }>(
      `SELECT ${CALL_COLS}, p.role AS my_role, p.state AS my_state, p.first_joined_at AS my_first_joined
       FROM call_participants p JOIN calls c ON c.id = p.call_id
       WHERE p.membership_id = $1 AND c.organisation_id = $2 AND ($3::timestamptz IS NULL OR c.created_at < $3::timestamptz)
         AND ($4 = 'all' OR p.state = 'missed')
       ORDER BY c.created_at DESC, c.id LIMIT $5`, [me, ctx.org.id, before, f.filter, limit]);
    if (f.filter === "missed") {
      await db.query(`UPDATE notifications SET read_at = now() WHERE recipient_membership_id = $1 AND type = 'call.missed' AND read_at IS NULL`, [me]);
    }
    if (!rows.length) return { ready: true, items: [], nextBefore: null };
    const ids = rows.map((r) => r.id);
    const parts = await db.query<PartRow>(`SELECT ${PART_COLS} FROM call_participants p WHERE p.call_id = ANY($1::uuid[])`, [ids]);
    const people = await peopleIn(db, [...parts.map((p) => p.membership_id), ...rows.map((r) => r.started_by)]);
    const wheres = await whereIn(db, ctx.org.slug, me, rows);
    const now = new Date().toISOString();
    const items: CallHistoryItem[] = rows.map((r) => {
      const mineJoined = !!r.my_first_joined;
      const outcome: CallOutcome = mineJoined
        ? (r.my_role === "caller" && !r.answered_at && r.state === "ended" ? "not_answered" : "joined")
        : r.my_state === "declined" ? "declined" : "missed";
      const here = parts.filter((p) => p.call_id === r.id);
      const joined = here.filter((p) => p.first_joined_at).sort((a, b) => Date.parse(a.first_joined_at!) - Date.parse(b.first_joined_at!));
      const others = r.kind === "direct" ? here.filter((p) => p.membership_id !== me) : joined.filter((p) => p.membership_id !== me);
      return {
        id: r.id, kind: r.kind, where: wheres.get(r.id)!, startedBy: people.get(r.started_by)!, youStarted: r.started_by === me,
        startedAt: iso(r.created_at)!, endedAt: iso(r.ended_at), durationSeconds: durationOf(r, now), live: r.state !== "ended", outcome,
        people: others.slice(0, 6).map((p) => people.get(p.membership_id)!), peopleCount: joined.length, recap: r.recap_state,
        href: callHref(ctx.org.slug, r.id),
      };
    });
    return { ready: true, items, nextBefore: rows.length === limit ? items[items.length - 1].startedAt : null };
  }));
}

/**
 * Live calls in conversations the person reads, newest first; one at most per conversation. Only conversations they
 * read NOW: someone removed from a channel is not offered its call to join (fix review, 10 October 2026).
 */
export async function liveCalls(ctx: OrgContext, o: { conversationId?: string } = {}): Promise<LiveCallSummary[]> {
  if (o.conversationId && !UUID.test(o.conversationId)) return [];
  const me = ctx.membership.id;
  return retryWithout0054(() => withUser(ctx.user.profileId, async (db): Promise<LiveCallSummary[]> => {
    if (!(await schema0054Ready(db))) return [];
    const rows = await db.query<CallRow>(
      `SELECT ${CALL_COLS} FROM calls c WHERE c.organisation_id = $1 AND c.state <> 'ended' AND ($2::uuid IS NULL OR c.conversation_id = $2::uuid)
         AND app_can_read_conversation(c.conversation_id)
       ORDER BY c.created_at DESC LIMIT 50`, [ctx.org.id, o.conversationId ?? null]);
    if (!rows.length) return [];
    const parts = await db.query<PartRow>(`SELECT ${PART_COLS} FROM call_participants p WHERE p.call_id = ANY($1::uuid[]) AND p.state = 'joined' ORDER BY p.joined_at`, [rows.map((r) => r.id)]);
    const people = await peopleIn(db, [...parts.map((p) => p.membership_id), ...rows.map((r) => r.started_by)]);
    const wheres = await whereIn(db, ctx.org.slug, me, rows);
    return rows.map((r) => {
      const inRoom = parts.filter((p) => p.call_id === r.id);
      return {
        id: r.id, kind: r.kind, where: wheres.get(r.id)!, startedBy: people.get(r.started_by)!, startedAt: iso(r.created_at)!, inRoom: inRoom.length,
        people: inRoom.map((p) => people.get(p.membership_id)!), notesOn: r.notes_state === "on", youAreIn: inRoom.some((p) => p.membership_id === me),
        href: callHref(ctx.org.slug, r.id),
      };
    });
  }));
}

// ---- The worker: settling, the sweep, the webhook ---------------------------------------------------------------------------

/**
 * A 'workspace' message for a call in its thread (the call's line, or brenda_notes' recap), as the worker, in the
 * caller's transaction. Null when the thread is gone. `markReadFor`: their read marks move past it (a 'workspace' message
 * counts as unread even for its sender).
 */
export async function postCallThreadMessage(db: Db, call: { id: string; organisationId: string; conversationId: string },
  o: { part: "line" | "recap"; senderMembershipId: string; body: string; markReadFor: string[] }): Promise<string | null> {
  const body = o.body.trim().slice(0, 4000) || CALL_WORDS.call;
  const m = await db.maybeOne<{ id: string; created_at: string }>(
    `INSERT INTO messages(organisation_id, conversation_id, sender_membership_id, body, author_kind, call_id, call_part)
     SELECT $1, c.id, $3, $4, 'workspace', $5, $6 FROM conversations c WHERE c.id = $2 AND c.organisation_id = $1
     RETURNING id, created_at`, [call.organisationId, call.conversationId, o.senderMembershipId, body, call.id, o.part]);
  if (!m) return null;
  const readers = [...new Set(o.markReadFor.filter((x) => UUID.test(x)))];
  if (readers.length) {
    // The read mark is the message's own created_at, read back in SQL: a JavaScript Date keeps only milliseconds, and
    // Messages counts unread as created_at > last_read_at in microseconds (integration fix, 10 October 2026).
    await db.query(
      `INSERT INTO conversation_reads(conversation_id, organisation_id, membership_id, last_read_at)
       SELECT $1, $2, x, (SELECT created_at FROM messages WHERE id = $4) FROM unnest($3::uuid[]) x
       ON CONFLICT (conversation_id, membership_id) DO UPDATE SET last_read_at = GREATEST(conversation_reads.last_read_at, EXCLUDED.last_read_at)`,
      [call.conversationId, call.organisationId, readers, m.id]);
  }
  return m.id;
}

/** What one settle did (sweepCalls counts it). */
type Settled = { found: boolean; moved: boolean; endedNow: boolean; roomClosed: boolean; recapQueued: boolean };

async function settleInner(callId: string, o: { now?: Date; removed?: string[] } = {}): Promise<Settled> {
  const none: Settled = { found: false, moved: false, endedNow: false, roomClosed: false, recapQueued: false };
  if (!UUID.test(callId)) return none;
  const after = await withWorker(async (db) => {
    if (!(await schema0054Ready(db))) return null;
    const s = (await db.one<{ r: SettleResult }>(`SELECT app_call_settle($1, $2::timestamptz) AS r`, [callId, o.now ? o.now.toISOString() : null])).r;
    if (!s?.found) return null;
    const c = await db.one<CallRow & { slug: string }>(
      `SELECT ${CALL_COLS}, o.slug FROM calls c JOIN organisations o ON o.id = c.organisation_id WHERE c.id = $1`, [callId]);
    // Missed calls, once each (a direct call's silent 'invited' person too: D3).
    const missed = await db.query<{ membership_id: string }>(
      `UPDATE call_participants SET notified_at = now() WHERE call_id = $1 AND state = 'missed' AND notified_at IS NULL RETURNING membership_id`, [callId]);
    let moved = !!(s.endedNow || s.missed?.length || s.left?.length || missed.length);
    if (missed.length) {
      const caller = (await peopleIn(db, [c.started_by])).get(c.started_by)!;
      const where = c.kind === "group" ? (await whereIn(db, c.slug, "00000000-0000-0000-0000-000000000000", [c])).get(c.id)?.name ?? null : null;
      for (const m of missed) {
        await notify(db, {
          organisationId: c.organisation_id, recipientMembershipId: m.membership_id, type: "call.missed",
          title: CALL_WORDS.notifications.missed(caller.name, where), resourceType: "call", resourceId: c.id,
          href: callHref(c.slug, c.id), dedupKey: `call.missed:${c.id}:${m.membership_id}`,
        });
      }
    }
    // A one-to-one call's line in its thread, once, when it ends (D11). Read already for its caller, for both when it was
    // answered, and for the person who declined it (fix review, 10 October 2026: "Missed call from Ada" sat unread for the
    // one who had just pressed Decline), whose line says so.
    if (c.state === "ended" && c.kind === "direct" && !c.line_message_id) {
      const parts = await db.query<{ membership_id: string; state: ParticipantState }>(`SELECT membership_id, state FROM call_participants WHERE call_id = $1`, [callId]);
      const callerName = (await peopleIn(db, [c.started_by])).get(c.started_by)!.name;
      const answered = !!c.answered_at;
      const declined = !answered && c.end_reason === "declined";
      const body = answered ? CALL_WORDS.thread.done(durationOf(c, c.ended_at!)) : declined ? CALL_WORDS.thread.declined(callerName) : CALL_WORDS.thread.missed(callerName);
      const readers = answered ? parts.map((p) => p.membership_id)
        : [c.started_by, ...parts.filter((p) => p.state === "declined").map((p) => p.membership_id)];
      const lineId = await postCallThreadMessage(db, { id: c.id, organisationId: c.organisation_id, conversationId: c.conversation_id },
        { part: "line", senderMembershipId: c.started_by, body, markReadFor: readers });
      if (lineId) await db.query(`UPDATE calls SET line_message_id = $2 WHERE id = $1 AND line_message_id IS NULL`, [callId, lineId]);
      moved = true;
    }
    let recapQueued = false;
    if (c.state === "ended" && c.recap_state === "pending") {
      await enqueueJob(db, "call.recap", { callId }, { dedupKey: `call.recap:${callId}` });
      recapQueued = true;
    }
    return { c, s, moved, recapQueued };
  });
  if (!after) return none;
  const { c, s } = after;
  let roomClosed = false;
  if (c.state === "ended") {
    if (!c.room_closed_at) {
      // No LiveKit to ask (calls switched off since): there is no room to close from here; LiveKit closes an empty one
      // itself after 5 minutes.
      const gone = livekitGatewayReady() ? await deleteRoomQuietly(c.room_name) : true;
      if (gone) {
        await withWorker((db) => db.query(`UPDATE calls SET room_closed_at = now() WHERE id = $1 AND room_closed_at IS NULL`, [callId]));
        roomClosed = true;
      }
    }
  } else if (livekitGatewayReady()) {
    // Still live: whoever left by their own step, or whose device went silent, is out of the room at once (a device that
    // left from another tab, or a token kept after leaving).
    const out = [...new Set([...(o.removed ?? []), ...(s.left ?? [])])].filter((x) => UUID.test(x));
    for (const identity of out) {
      try { await livekit().removeParticipant(c.room_name, identity); } catch (err) { warn(`removing a participant from ${c.room_name}`, err); }
    }
  }
  return { found: true, moved: after.moved, endedNow: !!s.endedNow, roomClosed, recapQueued: after.recapQueued };
}

/** Worker: applies time (app_call_settle) and every side effect still owed, once. Idempotent; never throws for a missing call. */
export async function settleCall(callId: string, o: { now?: Date; removed?: string[] } = {}): Promise<void> {
  await settleInner(callId, o);
}

/**
 * The `call.sweep` job: settles up to `limit` (200) live calls (oldest first) and up to 50 ended calls whose room is
 * still open; reconciles up to 50 live rooms with LiveKit (anyone in the room without a `joined` row is removed: devices'
 * heartbeats are the only thing that keeps a person in); queues recaps that look stuck and fails one still pending a day
 * after its call; and with `rooms` lists LiveKit's rooms and deletes `call-<uuid>` rooms whose call ended (or that this
 * database does not know and nobody is in), older than 2 minutes, at most 20 a pass.
 */
export async function sweepCalls(o: { now?: Date; limit?: number; rooms?: boolean } = {}): Promise<{ settled: number; roomsClosed: number; recapsQueued: number; strayRooms: number }> {
  const out = { settled: 0, roomsClosed: 0, recapsQueued: 0, strayRooms: 0 };
  const now = o.now ?? new Date();
  const at = now.toISOString();
  const lists = await withWorker(async (db) => {
    if (!(await schema0054Ready(db))) return null;
    const live = await db.query<{ id: string; room_name: string }>(
      `SELECT id, room_name FROM calls WHERE state <> 'ended' ORDER BY created_at LIMIT $1`, [Math.max(1, Math.min(1000, o.limit ?? 200))]);
    const open = await db.query<{ id: string }>(
      `SELECT id FROM calls WHERE state = 'ended' AND room_closed_at IS NULL ORDER BY ended_at LIMIT 50`);
    return { live, open };
  });
  if (!lists) return out;
  for (const c of [...lists.live, ...lists.open]) {
    try {
      const r = await settleInner(c.id, { now: o.now });
      if (r.moved || r.endedNow) out.settled++;
      if (r.roomClosed) out.roomsClosed++;
      if (r.recapQueued) out.recapsQueued++;
    } catch (err) { warn(`sweep settling ${c.id}`, err); }
  }
  if (livekitGatewayReady()) {
    // Reconcile: LiveKit's list never marks anyone joined; it only takes out who Boredroom thinks has left.
    const still = await withWorker((db) => db.query<{ id: string; room_name: string }>(
      `SELECT id, room_name FROM calls WHERE id = ANY($1::uuid[]) AND state <> 'ended' ORDER BY created_at LIMIT 50`, [lists.live.map((c) => c.id)]));
    for (const c of still) {
      try { await reconcileRoom(c.id, c.room_name); } catch (err) { warn(`reconciling ${c.room_name}`, err); }
    }
  }
  // Recaps (brenda_notes' job): stuck ones go again; one still pending a day after its call has failed.
  const hour = Math.floor(now.getTime() / 3_600_000);
  const stuck = await withWorker(async (db) => {
    const rows = await db.query<{ id: string }>(
      `SELECT id FROM calls WHERE state = 'ended' AND ended_at < $1::timestamptz - interval '2 minutes'
         AND (recap_state = 'pending' OR (recap_state = 'writing' AND recap_started_at < $1::timestamptz - interval '10 minutes'))
         AND ended_at > $1::timestamptz - interval '24 hours'
       ORDER BY ended_at LIMIT 20`, [at]);
    for (const r of rows) await enqueueJob(db, "call.recap", { callId: r.id }, { dedupKey: `call.recap:${r.id}:${hour}` });
    await db.query(`UPDATE calls SET recap_state = 'failed' WHERE state = 'ended' AND recap_state IN ('pending', 'writing') AND ended_at <= $1::timestamptz - interval '24 hours'`, [at]);
    // A room LiveKit would not let us delete for a day has long closed itself (empty rooms close after 5 minutes).
    await db.query(`UPDATE calls SET room_closed_at = $1::timestamptz WHERE state = 'ended' AND room_closed_at IS NULL AND ended_at <= $1::timestamptz - interval '1 day'`, [at]);
    return rows.length;
  });
  out.recapsQueued += stuck;
  if (o.rooms && livekitGatewayReady()) {
    try {
      const rooms = (await livekit().listRooms()).filter((r) => ROOM.test(r.name));
      if (rooms.length) {
        const ids = rooms.map((r) => ROOM.exec(r.name)![1].toLowerCase());
        const known = new Map((await withWorker((db) => db.query<{ id: string; state: CallState }>(
          `SELECT id, state FROM calls WHERE id = ANY($1::uuid[])`, [ids]))).map((r) => [r.id, r.state]));
        let deleted = 0;
        for (const r of rooms) {
          if (deleted >= 20) break;
          const id = ROOM.exec(r.name)![1].toLowerCase();
          const state = known.get(id);
          const old = r.createdAt === null || r.createdAt < now.getTime() - 2 * 60_000;
          // Ended here: delete. Unknown here: only when empty (owner's LiveKit project may also serve another copy of
          // Boredroom, whose live rooms this database does not know; an empty room is nobody's call).
          if (!old || state === "ringing" || state === "active" || (state === undefined && r.numParticipants > 0)) continue;
          if (await deleteRoomQuietly(r.name)) {
            deleted++;
            out.strayRooms++;
            if (state === "ended") await withWorker((db) => db.query(`UPDATE calls SET room_closed_at = now() WHERE id = $1 AND room_closed_at IS NULL`, [id]));
          }
        }
      }
    } catch (err) { warn("listing LiveKit rooms", err); }
  }
  return out;
}

/** Whether the sweep has work: a live call, an ended call with its room open, or a recap pending or being written. */
export async function callsDueIn(db: Db): Promise<boolean> {
  if (!(await schema0054Ready(db))) return false;
  const r = await db.one<{ due: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM calls WHERE state <> 'ended')
         OR EXISTS (SELECT 1 FROM calls WHERE state = 'ended' AND room_closed_at IS NULL)
         OR EXISTS (SELECT 1 FROM calls WHERE recap_state IN ('pending', 'writing')) AS due`);
  return r.due;
}

/**
 * Compares a live call's LiveKit room with who is in the call and takes out everyone else: a device that left, or someone
 * no longer on the call who came back with a token they kept (LiveKit cannot revoke a token; fix review, 10 October 2026).
 * LiveKit's list never marks anyone joined: heartbeats are the only thing that keeps a person in. Answers how many were
 * taken out; a room LiveKit no longer has lists nobody.
 */
async function reconcileRoom(callId: string, room: string): Promise<number> {
  const inRoom = await livekit().listParticipants(room);
  if (!inRoom.length) return 0;
  const joined = new Set((await withWorker((db) => db.query<{ membership_id: string }>(
    `SELECT p.membership_id FROM call_participants p JOIN calls c ON c.id = p.call_id WHERE p.call_id = $1 AND p.state = 'joined' AND c.state <> 'ended'`,
    [callId]))).map((r) => r.membership_id));
  let out = 0;
  for (const p of inRoom) {
    if (joined.has(p.identity)) continue;
    try { await livekit().removeParticipant(room, p.identity); out++; } catch (err) { warn(`taking someone out of ${room}`, err); }
  }
  return out;
}

/** This process's last try per call (a busy call's devices all beat; only one try in 5 s goes to the database). */
const reconcileTried = new Map<string, number>();

/**
 * After a device's "ok" heartbeat (the route runs it after answering): at most every 15 seconds a call
 * (CALL_LIMITS.reconcileEveryMs, claimed with one UPDATE so the devices of one call compare once), LiveKit's room is
 * compared with who is in the call (reconcileRoom). Someone removed who rejoined with the token they held is out within
 * seconds, without webhooks (localhost, or a production server whose webhook is not registered), instead of at the
 * sweep a minute later (fix review, 10 October 2026). Best effort: never throws; nothing without LiveKit or before 0054.
 */
export async function reconcileCallSoon(callId: string, o: { now?: number } = {}): Promise<number> {
  if (!UUID.test(callId) || !livekitGatewayReady()) return 0;
  const now = o.now ?? Date.now();
  if ((reconcileTried.get(callId) ?? 0) > now - 5_000) return 0;
  if (reconcileTried.size > 1_000) reconcileTried.clear();
  reconcileTried.set(callId, now);
  try {
    const claimed = await withWorker(async (db) => {
      if (!(await schema0054Ready(db))) return null;
      return db.maybeOne<{ room_name: string }>(
        `UPDATE calls SET reconciled_at = now() WHERE id = $1 AND state <> 'ended'
           AND (reconciled_at IS NULL OR reconciled_at < now() - make_interval(secs => $2)) RETURNING room_name`,
        [callId, CALL_LIMITS.reconcileEveryMs / 1000]);
    });
    return claimed ? await reconcileRoom(callId, claimed.room_name) : 0;
  } catch (err) {
    warn(`reconciling call ${callId}`, err);
    return 0;
  }
}

/** Tests: forget this process's reconcile throttle. */
export function forgetReconcileThrottleForTests(): void {
  reconcileTried.clear();
}

/**
 * After someone's access to conversations changed: removed from a channel (`conversationIds`) or a team (`teamId`), a
 * channel deleted, a membership ended (`membershipId`). Every live call in those conversations, or that the person is
 * on or being rung for, is settled now, so whoever no longer reads its conversation leaves it and their device is taken
 * out of LiveKit's room at once (fix review, 10 October 2026: someone removed from a channel stayed on its call). Best
 * effort, after the change committed: never throws; any settle, the sweep and the person's next heartbeat do the same.
 */
export async function settleCallsAfterAccessChange(orgId: string, scope: { conversationIds?: string[]; teamId?: string | null; membershipId?: string | null }): Promise<number> {
  if (!UUID.test(orgId)) return 0;
  try {
    const ids = await withWorker(async (db) => {
      if (!(await schema0054Ready(db))) return [] as string[];
      const rows = await db.query<{ id: string }>(
        `SELECT c.id FROM calls c
          WHERE c.organisation_id = $1 AND c.state <> 'ended' AND (
                c.conversation_id = ANY($2::uuid[])
             OR ($3::uuid IS NOT NULL AND c.conversation_id IN (SELECT x.id FROM conversations x WHERE x.team_id = $3::uuid AND x.kind = 'team'))
             OR ($4::uuid IS NOT NULL AND EXISTS (SELECT 1 FROM call_participants p WHERE p.call_id = c.id AND p.membership_id = $4::uuid AND p.state IN ('joined', 'ringing', 'invited'))))
          ORDER BY c.created_at LIMIT 200`,
        [orgId, (scope.conversationIds ?? []).filter((x) => UUID.test(x)), scope.teamId && UUID.test(scope.teamId) ? scope.teamId : null,
          scope.membershipId && UUID.test(scope.membershipId) ? scope.membershipId : null]);
      return rows.map((r) => r.id);
    });
    for (const id of ids) await settleQuietly(id);
    return ids.length;
  } catch (err) {
    warn("settling calls after an access change", err);
    return 0;
  }
}

/**
 * A verified LiveKit webhook (production only; D15): `room_finished` ends a live call ('empty': LiveKit only finishes a
 * room nobody is in), then its side effects and the room marked closed; `participant_left` and
 * `participant_connection_aborted` settle (heartbeats decide: a reconnecting device is never dropped by a webhook alone);
 * `participant_joined` settles the call first (so whoever no longer reads its conversation is out of it), then takes out
 * at once anyone without a `joined` row on the call (a token kept after leaving or after being removed from the
 * conversation; LiveKit cannot revoke one), and a room that came back for an ended call is deleted again (fix review,
 * 10 October 2026). Everything else is ignored. Duplicates are harmless: each step is idempotent.
 */
export async function handleLiveKitWebhook(e: { event: string; room: string | null; identity: string | null }): Promise<void> {
  const m = e.room ? ROOM.exec(e.room) : null;
  if (!m) return;
  const callId = m[1].toLowerCase();
  if (e.event === "participant_joined") {
    if (!e.identity) return;
    await settleQuietly(callId);
    const c = await withWorker(async (db) => {
      if (!(await schema0054Ready(db))) return null;
      return db.maybeOne<{ state: CallState; room_name: string; joined: boolean }>(
        `SELECT c.state, c.room_name,
                EXISTS (SELECT 1 FROM call_participants p WHERE p.call_id = c.id AND p.state = 'joined' AND p.membership_id::text = $2) AS joined
         FROM calls c WHERE c.id = $1`, [callId, e.identity]);
    });
    // A call this database does not know: another copy of Boredroom on the same LiveKit project may own the room.
    if (!c) return;
    if (c.state === "ended") { await deleteRoomQuietly(c.room_name); return; }
    if (!c.joined) {
      try { await livekit().removeParticipant(c.room_name, e.identity); } catch (err) { warn(`taking someone out of ${c.room_name}`, err); }
    }
    return;
  }
  if (e.event === "room_finished") {
    const exists = await withWorker(async (db) => {
      if (!(await schema0054Ready(db))) return false;
      const c = await db.maybeOne<{ state: CallState }>(`SELECT state FROM calls WHERE id = $1`, [callId]);
      if (!c) return false;
      if (c.state !== "ended") await db.query(`SELECT app_call_finish($1, 'empty')`, [callId]);
      return true;
    });
    if (!exists) return;
    await settleCall(callId);
    await withWorker((db) => db.query(`UPDATE calls SET room_closed_at = now() WHERE id = $1 AND room_closed_at IS NULL`, [callId]));
    return;
  }
  if (e.event === "participant_left" || e.event === "participant_connection_aborted") await settleCall(callId);
}
