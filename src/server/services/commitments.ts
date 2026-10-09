/**
 * Workspace commitments (owner decisions, 8 October 2026: phase 7b, "Brenda keeps the loops closed", second part). When
 * an owner or HR turns on "Track commitments in group chats" (Settings → Brenda; off until they do), the workspace's
 * assistant notices commitments in tracked group conversations (channels, team chats, Everyone; never direct messages):
 * a promise ("I'll send the deck Thursday"), an ask the asked person agreed to ("On it"), or an open ask nobody agreed to
 * yet. Detection is the worker's (commitment-detect); this file is what happens to a commitment once noticed:
 * - a PROPOSAL (a promise or an agreed ask) is marked "Noted" on the message (everyone in the conversation sees the label)
 *   and handed to the committer's own assistant: "Brenda noted you said you'd … Add it to your to-dos?". Accept makes a
 *   to-do linked to the message and the commitment (owners and HR hold no to-dos: Accept tracks it without one); Decline
 *   or "Not a commitment" closes it and the label says so, to the committer and the asker only (owner decision,
 *   9 October 2026: phase 7c; every other reader sees no label on that message);
 * - an OPEN ASK waits 60 minutes (an "On it" in the thread turns it into a proposal instead: `markAgreed`), then the asked
 *   person's assistant brings "Olu asked you to … Take it on?" (Accept → a commitment; Decline → the asker is told
 *   privately). It respects the asked person's mutes: muted, they are never told and it expires quietly;
 * - an open commitment is done when its to-do is done (or the person marks it done), cancelled when its to-do is archived;
 *   anything unanswered expires after 7 days (its label goes); a proposal whose message was withdrawn is cancelled.
 *
 * Who sees what (contract decision 3): the committer and the asker read every status (an open ask never told to its
 * committer stays out of their lists); their supervisors (app_can_view_records on the committer: their team leads, the
 * owner, HR) read only open and done ones, so nothing unanswered, declined or "not a commitment" reaches a supervisor. The
 * message's words and the conversation's name are read live under the viewer's own row-level security: a supervisor who
 * cannot read the conversation sees the title, the people, the dates and the status, never the words or the link.
 *
 * Accept is the consent (decision 7): a to-do from someone else's words is only ever made here, by the person's own press
 * (web, notch) or their confirmed chat card. Only Boredroom's worker inserts and moves commitments, labels and cursors;
 * the committer's own steps are definer functions that answer with a word (migration 0048). Every worker transition is
 * one guarded statement: no row back means someone moved it first, and the caller stops quietly. Reads settle overdue
 * rows on the spot, so expiry, delivery and "done" work even with a worker that predates this phase. Audit rows hold ids
 * only. Before migration 0048 everything here is absent and says so (server/lib/schema-0048).
 */
import { z } from "zod";
import { withUser, withWorker, type Db } from "@/server/db";
import type { OrgContext } from "@/server/lib/api";
import { AppError, conflict, forbidden, invalid, notFound } from "@/server/lib/errors";
import { forget0048, isMissingSchema, retryWithout0048, schema0048Ready } from "@/server/lib/schema-0048";
import { addDays, localMidnight, todayLocal, weekdayOf } from "@/server/lib/time";
import { audit, notify } from "@/server/services/common";
import { logAction, recordAction } from "@/server/services/brenda";
import { quickTodo } from "@/server/services/tasks";
import { readWorkspaceAssistant } from "@/server/services/assistant-profile";
import { toProfile } from "@/lib/assistant-look";
import { clip, firstName, type PersonRef } from "@/lib/follow-ups";
import {
  LOOP_LIMITS as L, LOOP_WORDS as W, LOOPS_NOT_READY_SHORT, commitmentBadge, commitmentDisplay, commitmentHref, commitmentInboxHref, isCommitmentKind,
  loopDueLabel, loopTitle, messageLabel,
  type CommitmentKind, type CommitmentList, type CommitmentScope, type CommitmentFilters, type CommitmentSettings, type CommitmentStatus, type CommitmentView,
  type ConversationTracking, type DesktopLoops, type DetectedCommitment, type LoopInboxItem, type MessageLabel, type MessageLabelState,
} from "@/lib/commitments";

// ---- Small helpers ----------------------------------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const notReady = () => new AppError(503, "NOT_READY", LOOPS_NOT_READY_SHORT);
const notHere = () => notFound(W.errors.notFound);
const warn = (what: string) => (err: unknown) => console.warn(`[commitments] ${what}: ${(err as Error)?.message ?? String(err)}`);
/** One line of someone's words: control characters (line breaks included) become spaces, runs of spaces one, trimmed. */
const oneLine = (s: unknown) => String(s ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
const isOrgAccount = (role: string | null | undefined) => role === "owner" || role === "hr";
const appOrigin = () => process.env.APP_ORIGIN ?? "http://localhost:3000";
const messageHref = (slug: string, conversationId: string, messageId: string) => `/app/${slug}/messages?c=${conversationId}#m-${messageId}`;
const isIso = (s: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(s) && !Number.isNaN(Date.parse(s));

/** Refused while an administrator is signed in as the person (support): their commitments stay exactly as they left them. */
function notWhileImpersonated(ctx: OrgContext) {
  if (ctx.user.impersonation) throw forbidden(W.errors.impersonated(firstName(ctx.user.displayName)));
}

/** The conversation's name as a list shows it: "#Design", "Everyone" (a direct thread never holds a commitment). */
const CONV_NAME_SQL = `CASE c.kind WHEN 'organisation' THEN 'Everyone' WHEN 'team' THEN '#' || ct.name WHEN 'channel' THEN '#' || c.title END`;

/** The label a commitment's status puts on its message; null: no label (expired, cancelled). */
function labelStateOf(status: CommitmentStatus): MessageLabelState | null {
  switch (status) {
    case "proposed": case "asked": case "accepting": case "open": return "noted";
    case "done": return "done";
    case "declined": return "declined";
    case "dismissed": return "dismissed";
    default: return null;
  }
}

/** The organisation's local week (Monday 00:00 to the next Monday 00:00), for "This week". */
function thisWeek(timeZone: string, now = new Date()): { start: string; end: string } {
  const today = todayLocal(timeZone, now);
  const monday = addDays(today, -((weekdayOf(today) + 6) % 7));
  return { start: localMidnight(monday, timeZone).toISOString(), end: localMidnight(addDays(monday, 7), timeZone).toISOString() };
}

// ---- Readiness and settings ---------------------------------------------------------------------------------------------

/** Whether this exists here yet (migration 0048), for the routes' `ready: false` and 503 answers. */
export async function commitmentsReady(ctx: OrgContext): Promise<boolean> {
  try { return await withUser(ctx.user.profileId, (db) => schema0048Ready(db)); } catch (err) { if (isMissingSchema(err)) { forget0048(); return false; } throw err; }
}

/** "Track commitments in group chats" and "Post gentle follow-ups in the thread" (members may read them). Off before 0048. */
export async function commitmentSettings(db: Db, orgId: string): Promise<CommitmentSettings> {
  if (!(await schema0048Ready(db))) return { ready: false, track: false, threadFollowUps: false, since: null };
  const r = await db.maybeOne<{ track: boolean; follow: boolean; since: string | null }>(
    `SELECT track_commitments AS track, commitment_thread_followups AS follow, track_commitments_since AS since FROM brenda_settings WHERE organisation_id = $1`, [orgId]);
  return { ready: true, track: !!r?.track, threadFollowUps: !!r?.follow, since: r?.since ?? null };
}

export const commitmentSettingsSchema = z.object({ track: z.boolean().optional(), threadFollowUps: z.boolean().optional() })
  .refine((v) => v.track !== undefined || v.threadFollowUps !== undefined, { message: "Say what to change." });

/**
 * Owners and HR, under the same lock as the organisation's other Brenda settings. Turning tracking on records when
 * (`track_commitments_since`): nothing said before it is ever read for it, also when it was on once and off since.
 * Logged in Brenda's log and audited (the switches only).
 */
export async function saveCommitmentSettings(ctx: OrgContext, p: { track?: boolean; threadFollowUps?: boolean }): Promise<CommitmentSettings> {
  if (!isOrgAccount(ctx.membership.role)) throw forbidden(W.settings.forbidden);
  if (p.track === undefined && p.threadFollowUps === undefined) throw invalid("Say what to change.");
  try {
    return await retryWithout0048(() => withUser(ctx.user.profileId, async (db) => {
      if (!(await schema0048Ready(db))) throw notReady();
      await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`brenda_settings:${ctx.org.id}`]);
      const before = await commitmentSettings(db, ctx.org.id);
      const track = p.track ?? before.track;
      const follow = p.threadFollowUps ?? before.threadFollowUps;
      const turnedOn = track && !before.track;
      await db.query(
        `INSERT INTO brenda_settings(organisation_id, track_commitments, commitment_thread_followups, track_commitments_since, updated_by, updated_at)
         VALUES ($1, $2, $3, CASE WHEN $2 THEN now() END, $4, now())
         ON CONFLICT (organisation_id) DO UPDATE SET track_commitments = $2, commitment_thread_followups = $3,
           track_commitments_since = CASE WHEN $5 THEN now() ELSE brenda_settings.track_commitments_since END, updated_by = $4, updated_at = now()`,
        [ctx.org.id, track, follow, ctx.membership.id, turnedOn]);
      if (track !== before.track || follow !== before.threadFollowUps) {
        await logAction(db, ctx, { tool: "settings", outcome: "done", source: "confirm", summary: `Commitments in group chats: ${track ? "on" : "off"}; follow-ups in the thread: ${follow ? "on" : "off"}` });
        await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "settings.commitments", subjectType: "organisation", subjectId: ctx.org.id, metadata: { track, threadFollowUps: follow } });
      }
      return commitmentSettings(db, ctx.org.id);
    }));
  } catch (err) {
    if (isMissingSchema(err)) { forget0048(); throw notReady(); }
    throw err;
  }
}

// ---- The conversation's switch and labels (messaging's thread) -----------------------------------------------------------

/**
 * Whether commitments are noted in this conversation, as the thread's disclosure and the details pane need it: the
 * workspace switch (the master), the conversation's own (on by default), whether the caller may change it (whoever runs
 * the conversation: 0041's app_can_manage_conversation), and whether it applies at all (never on a direct thread). In a
 * transaction the caller holds, as the person. Before 0048: `ready: false`, nothing applies.
 */
export async function conversationTrackingIn(db: Db, ctx: OrgContext, conversationId: string): Promise<ConversationTracking> {
  if (!(await schema0048Ready(db))) {
    // Through the profile reader, which checks its own migration first (a failed read would abort the caller's transaction).
    const ws = await readWorkspaceAssistant(db, ctx.org.id);
    return { ready: false, workspaceOn: false, here: false, tracked: false, canChange: false, applies: false, workspaceAssistantName: ws.name };
  }
  const r = await db.maybeOne<{ kind: string; here: boolean; archived: boolean; workspace_on: boolean; can_manage: boolean; ws_name: string | null }>(
    `SELECT c.kind, c.track_commitments AS here, (c.archived_at IS NOT NULL) AS archived, COALESCE(bs.track_commitments, false) AS workspace_on,
            app_can_manage_conversation(c.id) AS can_manage, bs.assistant_name AS ws_name
     FROM conversations c LEFT JOIN brenda_settings bs ON bs.organisation_id = c.organisation_id
     WHERE c.id = $1 AND c.organisation_id = $2`, [conversationId, ctx.org.id]);
  const name = toProfile({ name: r?.ws_name }).name;
  if (!r || r.kind === "direct") return { ready: true, workspaceOn: !!r?.workspace_on, here: false, tracked: false, canChange: false, applies: false, workspaceAssistantName: name };
  return {
    ready: true, workspaceOn: r.workspace_on, here: r.here, tracked: r.workspace_on && r.here && !r.archived, canChange: r.can_manage, applies: true,
    workspaceAssistantName: name,
  };
}

/**
 * "Note commitments here", by whoever runs the conversation, never on a direct thread: through the definer
 * app_conversation_set_track_commitments under a savepoint (the app role cannot update conversations). 403 for anyone
 * else, 422 on a direct thread, 404 when the caller cannot read it, 503 before 0048. Audited (the switch only).
 */
export async function setConversationTracking(ctx: OrgContext, conversationId: string, allowed: boolean): Promise<{ trackCommitments: boolean }> {
  if (!isUuid(conversationId)) throw notFound("That conversation does not exist or you are not part of it.");
  let turnedOnAt: string | null = null;
  try {
    const out = await retryWithout0048(() => withUser(ctx.user.profileId, async (db) => {
      turnedOnAt = null;
      if (!(await schema0048Ready(db))) throw notReady();
      const conv = await db.maybeOne<{ id: string; kind: string; here: boolean; at: string }>(
        `SELECT id, kind, track_commitments AS here, now()::text AS at FROM conversations WHERE id = $1 AND organisation_id = $2`, [conversationId, ctx.org.id]);
      if (!conv) throw notFound("That conversation does not exist or you are not part of it.");
      try {
        await db.query(`SAVEPOINT track_commitments`);
        await db.query(`SELECT app_conversation_set_track_commitments($1, $2)`, [conversationId, !!allowed]);
        await db.query(`RELEASE SAVEPOINT track_commitments`);
      } catch (err) {
        await db.query(`ROLLBACK TO SAVEPOINT track_commitments`).catch(() => undefined);
        const msg = (err as Error).message ?? "";
        if (msg.includes("TRACK_COMMITMENTS_DIRECT")) throw new AppError(422, "INVALID_INPUT", W.errors.direct);
        if (msg.includes("CONVERSATION_FORBIDDEN")) throw forbidden(W.conversationSwitch.forbidden);
        throw err;
      }
      await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "conversation.track_commitments", subjectType: "conversation", subjectId: conversationId, metadata: { allowed: !!allowed } });
      if (allowed && !conv.here) turnedOnAt = conv.at;
      return { trackCommitments: !!allowed };
    }));
    // Turned back on (security and correctness reviews, 9 October 2026): nothing said while it was off is ever read for
    // commitments. The scan reads after the conversation's cursor, so the cursor moves to the moment it was turned on
    // (the worker's table; migration 0049 also records the time for the context lines). Never moves a cursor back.
    if (turnedOnAt) {
      const at: string = turnedOnAt;
      await withWorker((db) => db.query(
        `INSERT INTO commitment_scan_cursors(conversation_id, organisation_id, last_created_at, last_message_id, scanned_at) VALUES ($1, $2, $3::timestamptz, NULL, now())
         ON CONFLICT (conversation_id) DO UPDATE SET last_created_at = EXCLUDED.last_created_at, last_message_id = NULL
         WHERE commitment_scan_cursors.last_created_at < EXCLUDED.last_created_at`, [conversationId, ctx.org.id, at]))
        .catch(warn("moving the scan cursor of a conversation turned back on"));
    }
    return out;
  } catch (err) {
    if (isMissingSchema(err)) { forget0048(); throw notReady(); }
    throw err;
  }
}

/**
 * The commitment labels on these messages, in a transaction the caller holds, as the person. Empty before 0048.
 *
 * Private decline labels (owner decision, 9 October 2026: phase 7c): "Noted" and "Done" are read by everyone who reads
 * the conversation (0048's rule, kept); "Declined" and "Not a commitment" only by that commitment's committer and asker,
 * so every other reader gets no label at all for that message (not "Noted" either). Enforced here in the query, before
 * and after migration 0050 (whose replaced `message_labels_select` policy says the same in the database); the
 * commitments' own row-level security already lets only those two read a declined or dismissed row. A private label
 * carries the other person's first name ("Only you and Ada see this.").
 */
/**
 * The commitment a private label is about (alias x, for label l): the one the label row names (`commitment_id`, which
 * syncLabel writes), so a party to another commitment on the same message never reads this one's state (fix review,
 * 9 October 2026; migration 0051 holds the policy to the same rule). A row without one (none is written so) falls back
 * to any declined or dismissed commitment on the message, as before.
 */
const LABEL_COMMITMENT = `(CASE WHEN l.commitment_id IS NOT NULL THEN x.id = l.commitment_id
  ELSE (x.agreement_message_id = l.message_id OR (x.agreement_message_id IS NULL AND x.source_message_id = l.message_id)) AND x.status IN ('declined', 'dismissed') END)`;

export async function labelsIn(db: Db, conversationId: string, messageIds: string[]): Promise<Map<string, MessageLabel>> {
  const out = new Map<string, MessageLabel>();
  const ids = [...new Set(messageIds.filter(isUuid))];
  if (!ids.length || !isUuid(conversationId) || !(await schema0048Ready(db))) return out;
  const rows = await db.query<{ message_id: string; state: MessageLabelState; other: string | null }>(
    `SELECT l.message_id, l.state, party.other
     FROM message_labels l
     LEFT JOIN LATERAL (
       SELECT CASE WHEN x.committer_membership_id = app_membership_id(x.organisation_id) THEN ap.display_name ELSE cp.display_name END AS other
       FROM commitments x
       JOIN memberships cm ON cm.id = x.committer_membership_id JOIN profiles cp ON cp.id = cm.user_id
       LEFT JOIN memberships am ON am.id = x.asker_membership_id LEFT JOIN profiles ap ON ap.id = am.user_id
       WHERE l.state IN ('declined', 'dismissed') AND x.organisation_id = l.organisation_id AND ${LABEL_COMMITMENT}
         AND app_membership_id(x.organisation_id) IN (x.committer_membership_id, x.asker_membership_id)
       ORDER BY x.created_at DESC, x.id DESC LIMIT 1) party ON true
     WHERE l.conversation_id = $1 AND l.message_id = ANY($2::uuid[]) AND l.kind = 'commitment'
       AND (l.state IN ('noted', 'done') OR EXISTS (
         SELECT 1 FROM commitments x
         WHERE x.organisation_id = l.organisation_id AND ${LABEL_COMMITMENT}
           AND app_membership_id(x.organisation_id) IN (x.committer_membership_id, x.asker_membership_id)))`, [conversationId, ids]);
  for (const r of rows) out.set(r.message_id, messageLabel(r.state, r.other ? firstName(r.other) : null));
  return out;
}

// ---- Views --------------------------------------------------------------------------------------------------------------

type ViewRow = {
  id: string; kind: CommitmentKind; status: CommitmentStatus; conversation_id: string; source_message_id: string; agreement_message_id: string | null;
  committer_membership_id: string; asker_membership_id: string | null; title: string; due_at: string | null; due_words: string | null;
  detected_by: "claude" | "builtin"; decline_reason: string | null; expires_at: string; decided_at: string | null; done_at: string | null;
  stalled_noted_at: string | null; created_at: string;
  committer_role: string; committer_name: string; ca_name: string | null; ca_colour: string | null; ca_visor: string | null; ca_eyes: string | null;
  asker_name: string | null; aa_name: string | null; aa_colour: string | null; aa_visor: string | null; aa_eyes: string | null;
  conv_kind: string | null; conv_name: string | null;
  msg_visible: boolean; msg_at: string | null; msg_body: string | null; msg_deleted: boolean; msg_edited: boolean;
  agr_visible: boolean; agr_body: string | null; agr_deleted: boolean; agr_edited: boolean;
  task_id: string | null; task_title: string | null; task_status: string | null;
};

/** As the viewer ($1 organisation, $2 the viewer's membership): their commitments under row-level security. */
const VIEW_SQL = `
  SELECT cm.id, cm.kind, cm.status, cm.conversation_id, cm.source_message_id, cm.agreement_message_id, cm.committer_membership_id, cm.asker_membership_id,
         cm.title, cm.due_at, cm.due_words, cm.detected_by, cm.decline_reason, cm.expires_at, cm.decided_at, cm.done_at, cm.stalled_noted_at, cm.created_at,
         cmm.role AS committer_role, cp.display_name AS committer_name, ca.name AS ca_name, ca.colour AS ca_colour, ca.visor AS ca_visor, ca.eyes AS ca_eyes,
         ap.display_name AS asker_name, aa.name AS aa_name, aa.colour AS aa_colour, aa.visor AS aa_visor, aa.eyes AS aa_eyes,
         c.kind AS conv_kind, ${CONV_NAME_SQL} AS conv_name,
         (sm.id IS NOT NULL) AS msg_visible, sm.created_at AS msg_at, CASE WHEN sm.deleted_at IS NULL THEN sm.body END AS msg_body, (sm.deleted_at IS NOT NULL) AS msg_deleted,
         COALESCE(sm.edited_at > cm.created_at, false) AS msg_edited,
         (am.id IS NOT NULL) AS agr_visible, CASE WHEN am.deleted_at IS NULL THEN am.body END AS agr_body, (am.deleted_at IS NOT NULL) AS agr_deleted,
         COALESCE(am.edited_at > cm.created_at, false) AS agr_edited,
         t.id AS task_id, t.title AS task_title, t.status AS task_status
  FROM commitments cm
  JOIN memberships cmm ON cmm.id = cm.committer_membership_id JOIN profiles cp ON cp.id = cmm.user_id
  LEFT JOIN assistant_profiles ca ON ca.membership_id = cm.committer_membership_id
  LEFT JOIN memberships amm ON amm.id = cm.asker_membership_id LEFT JOIN profiles ap ON ap.id = amm.user_id
  LEFT JOIN assistant_profiles aa ON aa.membership_id = cm.asker_membership_id
  LEFT JOIN conversations c ON c.id = cm.conversation_id
  LEFT JOIN teams ct ON ct.id = c.team_id
  LEFT JOIN messages sm ON sm.id = cm.source_message_id
  LEFT JOIN messages am ON am.id = cm.agreement_message_id
  LEFT JOIN tasks t ON t.id = cm.todo_task_id`;

/**
 * An open ask its committer was never told about (inside its 60 minutes, or muted) stays out of their lists, whatever
 * became of it: they learn of it only through its inbox card.
 */
const HIDDEN_SQL = `(cm.committer_membership_id = $2 AND cm.kind = 'open_ask' AND cm.notified_at IS NULL)`;

const personOf = (id: string, name: string | null, a: { name: unknown; colour: unknown; visor: unknown; eyes: unknown }): PersonRef => ({
  membershipId: id, name: name ?? "Someone", firstName: firstName(name ?? "Someone"), assistant: toProfile(a),
});

function toView(r: ViewRow, ctx: OrgContext, o: { now: number; kinds: Map<string, string> }): CommitmentView {
  const me = ctx.membership.id;
  const slug = ctx.org.slug;
  const viewer: CommitmentView["viewer"] = r.committer_membership_id === me ? "committer" : r.asker_membership_id === me ? "asker" : "supervisor";
  const display = commitmentDisplay(r.status, r.due_at, o.now);
  const waiting = (r.status === "proposed" || r.status === "asked") && Date.parse(r.expires_at) > o.now;
  const kind = (r.conv_kind ?? o.kinds.get(r.conversation_id) ?? "channel") as CommitmentView["where"]["kind"];
  return {
    id: r.id, kind: r.kind, status: r.status, display, viewer,
    title: r.title, dueAt: r.due_at, dueWords: r.due_words, dueLabel: loopDueLabel(r.due_at, ctx.org.timezone),
    committer: personOf(r.committer_membership_id, r.committer_name, { name: r.ca_name, colour: r.ca_colour, visor: r.ca_visor, eyes: r.ca_eyes }),
    asker: r.asker_membership_id ? personOf(r.asker_membership_id, r.asker_name, { name: r.aa_name, colour: r.aa_colour, visor: r.aa_visor, eyes: r.aa_eyes }) : null,
    where: { conversationId: r.conversation_id, kind: kind === "team" || kind === "organisation" ? kind : "channel", name: r.conv_name ?? null },
    message: {
      id: r.source_message_id, at: r.msg_at ?? r.created_at,
      href: r.msg_visible ? messageHref(slug, r.conversation_id, r.source_message_id) : null,
      // Words edited after they were noted are not what was agreed to (security review, 9 October 2026): the card says
      // the message was edited and quotes nothing, so nobody reads the committer agreeing to words written later.
      quote: r.msg_visible && !r.msg_deleted && !r.msg_edited && r.msg_body ? clip(oneLine(r.msg_body), L.quoteMax) : null,
      withdrawn: r.msg_visible && r.msg_deleted,
      edited: r.msg_visible && !r.msg_deleted && r.msg_edited,
    },
    agreement: r.agreement_message_id ? {
      id: r.agreement_message_id,
      href: r.agr_visible ? messageHref(slug, r.conversation_id, r.agreement_message_id) : null,
      quote: r.agr_visible && !r.agr_deleted && !r.agr_edited && r.agr_body ? clip(oneLine(r.agr_body), L.quoteMax) : null,
      edited: r.agr_visible && !r.agr_deleted && r.agr_edited,
    } : null,
    todo: r.task_id ? { id: r.task_id, title: r.task_title ?? "", status: r.task_status ?? "", href: `/app/${slug}/tasks/${r.task_id}` } : null,
    detectedBy: r.detected_by,
    createdAt: r.created_at, decidedAt: r.decided_at, doneAt: r.done_at, expiresAt: r.expires_at,
    // The reason stays with the committer, except for an ask, whose asker is told it (security review, 9 October 2026:
    // a promise's "asker" is only who it was made to, and the committer is told nobody hears the reason).
    declineReason: viewer === "committer" || (viewer === "asker" && r.kind !== "promise") ? r.decline_reason : null,
    stalled: !!r.stalled_noted_at,
    badge: commitmentBadge(display, viewer),
    canAccept: viewer === "committer" && waiting, canDecline: viewer === "committer" && waiting, canDismiss: viewer === "committer" && waiting,
    canMarkDone: viewer === "committer" && r.status === "open",
    acceptMakesTodo: !isOrgAccount(r.committer_role),
    href: commitmentHref(slug, r.id),
  };
}

/** Views as the viewer: `where` and `params` from $3 ($1 the organisation, $2 the viewer). */
async function loadViews(db: Db, ctx: OrgContext, where: string, params: unknown[], tail: string): Promise<CommitmentView[]> {
  const rows = await db.query<ViewRow>(`${VIEW_SQL} WHERE cm.organisation_id = $1 AND NOT ${HIDDEN_SQL} AND (${where}) ${tail}`, [ctx.org.id, ctx.membership.id, ...params]);
  // The conversation's kind for one the viewer cannot read (a supervisor): its kind only, never its name or words.
  const unknown = [...new Set(rows.filter((r) => !r.conv_kind).map((r) => r.conversation_id))];
  const kinds = new Map<string, string>();
  if (unknown.length) {
    const found = await withWorker((w) => w.query<{ id: string; kind: string }>(`SELECT id, kind FROM conversations WHERE id = ANY($1::uuid[])`, [unknown])).catch(() => []);
    for (const k of found) kinds.set(k.id, k.kind);
  }
  const now = Date.now();
  return rows.map((r) => toView(r, ctx, { now, kinds }));
}

// ---- Labels and notices (worker) ----------------------------------------------------------------------------------------

type LabelRef = { id: string; organisation_id: string; conversation_id: string; source_message_id: string; agreement_message_id: string | null };

/**
 * The label on a commitment's message (the agreement for an agreed ask, else the promise or the ask), from the newest
 * live commitment on that message: noted while it waits or is open, done, declined, "not a commitment"; none when every
 * one there expired or was cancelled. An open ask has none until it is accepted (its asked person may never be told).
 * As the worker; one row per message.
 *
 * Phase 7c (owner decision, 9 October 2026): a public state wins over a private one (declined, dismissed come last), so
 * a message with an open commitment for Ada and a declined one for Ben shows "Noted" to everyone, and Ben's decline stays
 * in his own Commitments view.
 */
async function syncLabel(db: Db, c: LabelRef): Promise<void> {
  const messageId = c.agreement_message_id ?? c.source_message_id;
  const newest = await db.maybeOne<{ id: string; status: CommitmentStatus }>(
    `SELECT id, status FROM commitments
     WHERE organisation_id = $1 AND (agreement_message_id = $2 OR (agreement_message_id IS NULL AND source_message_id = $2))
       AND status NOT IN ('expired', 'cancelled') AND NOT (kind = 'open_ask' AND status NOT IN ('accepting', 'open', 'done'))
     ORDER BY (status IN ('declined', 'dismissed')) ASC, created_at DESC, id DESC LIMIT 1`, [c.organisation_id, messageId]);
  const state = newest ? labelStateOf(newest.status) : null;
  if (!state || !newest) {
    await db.query(`DELETE FROM message_labels WHERE message_id = $1 AND kind = 'commitment'`, [messageId]);
    return;
  }
  // Through the message, so a message deleted outright since leaves nothing to label.
  await db.query(
    `INSERT INTO message_labels(message_id, conversation_id, organisation_id, kind, state, commitment_id)
     SELECT m.id, m.conversation_id, m.organisation_id, 'commitment', $2, $3 FROM messages m WHERE m.id = $1
     ON CONFLICT ON CONSTRAINT message_labels_one DO UPDATE SET state = EXCLUDED.state, commitment_id = EXCLUDED.commitment_id`,
    [messageId, state, newest.id]);
}

/**
 * The committer's commitment notification, closed once it no longer needs them (expired, cancelled): marked read and its
 * words say why. Written as the recipient (notifications are updated only by their recipient). Never throws.
 */
async function closeNotice(membershipId: string, keys: string[], body: string): Promise<void> {
  try {
    const who = await withWorker((db) => db.maybeOne<{ user_id: string }>(`SELECT user_id FROM memberships WHERE id = $1`, [membershipId]));
    if (!who) return;
    await withUser(who.user_id, (db) => db.query(
      `UPDATE notifications SET read_at = COALESCE(read_at, now()), body = $3 WHERE recipient_membership_id = $1 AND deduplication_key = ANY($2::text[])`,
      [membershipId, keys, clip(body, 300)]));
  } catch (err) { warn("closing a notification")(err); }
}

/** The person's own commitment notifications, read once they act on it (as the person). */
async function readNotices(db: Db, ctx: OrgContext, id: string): Promise<void> {
  await db.query(`UPDATE notifications SET read_at = now() WHERE recipient_membership_id = $1 AND deduplication_key = ANY($2::text[]) AND read_at IS NULL`,
    [ctx.membership.id, [`commitment:${id}`, `commitment.ask:${id}`]]);
}

type NoticeRow = {
  id: string; organisation_id: string; kind: CommitmentKind; status: CommitmentStatus; conversation_id: string; source_message_id: string; agreement_message_id: string | null;
  committer_membership_id: string; asker_membership_id: string | null; title: string; due_at: string | null; decline_reason: string | null;
  expires_at: string; ask_notify_after: string | null; notified_at: string | null; decided_at: string | null; lease_until: string | null; todo_task_id: string | null;
  slug: string; timezone: string; committer_name: string; committer_role: string; asker_name: string | null; ws_name: string | null;
  src_gone: boolean; agr_gone: boolean; task_status: string | null; task_archived: boolean; muted: boolean;
};
/** One commitment with everything a transition needs, as the worker. */
const NOTICE_SQL = `
  SELECT cm.id, cm.organisation_id, cm.kind, cm.status, cm.conversation_id, cm.source_message_id, cm.agreement_message_id, cm.committer_membership_id,
         cm.asker_membership_id, cm.title, cm.due_at, cm.decline_reason, cm.expires_at, cm.ask_notify_after, cm.notified_at, cm.decided_at, cm.lease_until, cm.todo_task_id,
         o.slug, o.timezone, cp.display_name AS committer_name, cmm.role AS committer_role, ap.display_name AS asker_name, bs.assistant_name AS ws_name,
         NOT EXISTS (SELECT 1 FROM messages m WHERE m.id = cm.source_message_id AND m.deleted_at IS NULL) AS src_gone,
         (cm.agreement_message_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.id = cm.agreement_message_id AND m.deleted_at IS NULL)) AS agr_gone,
         t.status AS task_status, (t.archived_at IS NOT NULL) AS task_archived,
         (cm.asker_membership_id IS NOT NULL AND EXISTS (SELECT 1 FROM assistant_item_mutes x WHERE x.recipient_membership_id = cm.committer_membership_id
                                                         AND x.sender_membership_id = cm.asker_membership_id AND x.muted)) AS muted
  FROM commitments cm
  JOIN organisations o ON o.id = cm.organisation_id
  JOIN memberships cmm ON cmm.id = cm.committer_membership_id JOIN profiles cp ON cp.id = cmm.user_id
  LEFT JOIN memberships amm ON amm.id = cm.asker_membership_id LEFT JOIN profiles ap ON ap.id = amm.user_id
  LEFT JOIN brenda_settings bs ON bs.organisation_id = cm.organisation_id
  LEFT JOIN tasks t ON t.id = cm.todo_task_id
  WHERE cm.id = $1`;

/** The committer's "Brenda noted you said you'd …" (a proposal), once; sets notified_at. As the worker. */
async function tellCommitter(db: Db, r: NoticeRow): Promise<void> {
  const ws = toProfile({ name: r.ws_name }).name;
  const title = loopTitle(r.title);
  const askerFirst = firstName(r.asker_name ?? "Someone");
  await notify(db, {
    organisationId: r.organisation_id, recipientMembershipId: r.committer_membership_id, type: "brenda.commitment",
    title: clip(r.kind === "agreed_ask" ? W.notifications.agreed(ws, askerFirst, title) : W.notifications.commitment(ws, title), 200),
    body: isOrgAccount(r.committer_role) ? `${W.inbox.commitmentQuestionNoTodos} ${W.inbox.nothingChanges}` : W.notifications.commitmentBody,
    resourceType: "commitment", resourceId: r.id, href: commitmentInboxHref(r.slug, r.id), dedupKey: `commitment:${r.id}`,
  });
  await db.query(`UPDATE commitments SET notified_at = COALESCE(notified_at, now()) WHERE id = $1`, [r.id]);
}

// ---- Settling (worker transitions; also run at read time) -------------------------------------------------------------------

type Settled = "expired" | "delivered" | "quiet" | "cancelled" | "interrupted" | "done" | null;

/** Waiting rows past their time, asks past their grace, withdrawn sources, stuck accepts, and open ones whose to-do moved. */
const DUE_SQL = `((cm.status IN ('proposed', 'asked') AND cm.expires_at <= now())
  OR (cm.status = 'asked' AND cm.notified_at IS NULL AND cm.ask_notify_after <= now())
  OR (cm.status = 'accepting' AND cm.decided_at < now() - make_interval(mins => ${L.stuckAcceptingMinutes}) AND (cm.lease_until IS NULL OR cm.lease_until < now()))
  OR (cm.status IN ('proposed', 'asked') AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.id = cm.source_message_id AND m.deleted_at IS NULL))
  OR (cm.status IN ('proposed', 'asked') AND cm.agreement_message_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.id = cm.agreement_message_id AND m.deleted_at IS NULL))
  OR (cm.status = 'open' AND cm.todo_task_id IS NOT NULL AND EXISTS (SELECT 1 FROM tasks t WHERE t.id = cm.todo_task_id AND (t.status = 'completed' OR t.archived_at IS NOT NULL))))`;

/** DUE_SQL at a given instant ($1), for the worker's sweep (a test's clock). */
const DUE_AT_SQL = DUE_SQL.replace(/now\(\)/g, () => "$1::timestamptz");

/** Moves one commitment as far as its time and its to-do say. Safe to call any number of times; never throws past the caller's catch. */
async function settleOne(id: string, now: Date): Promise<Settled> {
  const r = await withWorker((db) => db.maybeOne<NoticeRow>(NOTICE_SQL, [id]));
  if (!r) return null;
  const t = now.getTime();
  const at = now.toISOString();
  const waiting = r.status === "proposed" || r.status === "asked";
  // A proposal or ask whose message was withdrawn before an answer: cancelled, its label gone.
  if (waiting && (r.src_gone || r.agr_gone)) {
    const moved = await withWorker(async (db) => {
      const ok = await db.maybeOne(`UPDATE commitments SET status = 'cancelled' WHERE id = $1 AND status IN ('proposed', 'asked') RETURNING id`, [id]);
      if (!ok) return false;
      await syncLabel(db, r);
      await audit(db, { organisationId: r.organisation_id, action: "commitment.cancelled", subjectType: "commitment", subjectId: id, subjectMembershipId: r.committer_membership_id, metadata: { commitmentId: id, why: "withdrawn" } });
      return true;
    });
    if (moved && r.notified_at) await closeNotice(r.committer_membership_id, [`commitment:${id}`, `commitment.ask:${id}`], W.page.withdrawn);
    return moved ? "cancelled" : null;
  }
  if (waiting && Date.parse(r.expires_at) <= t) {
    const moved = await withWorker(async (db) => {
      const ok = await db.maybeOne(`UPDATE commitments SET status = 'expired' WHERE id = $1 AND status IN ('proposed', 'asked') AND expires_at <= $2::timestamptz RETURNING id`, [id, at]);
      if (!ok) return false;
      await syncLabel(db, r);
      await audit(db, { organisationId: r.organisation_id, action: "commitment.expired", subjectType: "commitment", subjectId: id, subjectMembershipId: r.committer_membership_id, metadata: { commitmentId: id } });
      return true;
    });
    if (moved && r.notified_at) await closeNotice(r.committer_membership_id, [`commitment:${id}`, `commitment.ask:${id}`], W.errors.expired);
    return moved ? "expired" : null;
  }
  // An open ask past its grace with nobody agreeing: the asked person is told, unless they muted the asker's assistant
  // (then never: it expires quietly).
  if (r.status === "asked" && !r.notified_at && r.ask_notify_after && Date.parse(r.ask_notify_after) <= t) {
    return withWorker(async (db): Promise<Settled> => {
      if (r.muted) {
        await db.query(`UPDATE commitments SET ask_notify_after = NULL WHERE id = $1 AND status = 'asked' AND notified_at IS NULL`, [id]);
        return "quiet";
      }
      const ok = await db.maybeOne(`UPDATE commitments SET notified_at = now() WHERE id = $1 AND status = 'asked' AND notified_at IS NULL RETURNING id`, [id]);
      if (!ok) return null;
      const askerFirst = firstName(r.asker_name ?? "Someone");
      await notify(db, {
        organisationId: r.organisation_id, recipientMembershipId: r.committer_membership_id, type: "brenda.open_ask",
        title: clip(W.notifications.openAsk(askerFirst, loopTitle(r.title)), 200), body: W.notifications.openAskBody(askerFirst),
        resourceType: "commitment", resourceId: id, href: commitmentInboxHref(r.slug, id), dedupKey: `commitment.ask:${id}`,
      });
      return "delivered";
    });
  }
  // Accepted, but nothing recorded the to-do (the web process stopped in between): open without one, never a second
  // to-do; the person is told to check.
  if (r.status === "accepting" && r.decided_at && Date.parse(r.decided_at) < t - L.stuckAcceptingMinutes * 60_000 && (!r.lease_until || Date.parse(r.lease_until) < t)) {
    return withWorker(async (db): Promise<Settled> => {
      const ok = await db.maybeOne(
        `UPDATE commitments SET status = 'open', lease_until = NULL WHERE id = $1 AND status = 'accepting' AND decided_at < $2::timestamptz - make_interval(mins => $3)
           AND (lease_until IS NULL OR lease_until < $2::timestamptz) RETURNING id`, [id, at, L.stuckAcceptingMinutes]);
      if (!ok) return null;
      await syncLabel(db, r);
      await notify(db, {
        organisationId: r.organisation_id, recipientMembershipId: r.committer_membership_id, type: "brenda.commitment",
        title: clip(W.notifications.acceptInterrupted, 200), body: `“${loopTitle(r.title)}”`,
        resourceType: "commitment", resourceId: id, href: commitmentHref(r.slug, id), dedupKey: `commitment.interrupted:${id}`,
      });
      await audit(db, { organisationId: r.organisation_id, action: "commitment.interrupted", subjectType: "commitment", subjectId: id, subjectMembershipId: r.committer_membership_id, metadata: { commitmentId: id } });
      return "interrupted";
    });
  }
  // Its to-do is done: done. Its to-do was archived: cancelled.
  if (r.status === "open" && r.todo_task_id && (r.task_status === "completed" || r.task_archived)) {
    const done = r.task_status === "completed" && !r.task_archived;
    return withWorker(async (db): Promise<Settled> => {
      const ok = done
        ? await db.maybeOne(`UPDATE commitments SET status = 'done', done_at = now(), done_by = 'todo' WHERE id = $1 AND status = 'open' RETURNING id`, [id])
        : await db.maybeOne(`UPDATE commitments SET status = 'cancelled' WHERE id = $1 AND status = 'open' RETURNING id`, [id]);
      if (!ok) return null;
      await syncLabel(db, r);
      await audit(db, { organisationId: r.organisation_id, action: done ? "commitment.done" : "commitment.cancelled", subjectType: "commitment", subjectId: id, subjectMembershipId: r.committer_membership_id, metadata: { commitmentId: id, by: done ? "todo" : "todo_archived" } });
      return done ? "done" : "cancelled";
    });
  }
  return null;
}

/**
 * Settles overdue commitments this person can see before a read (at most 10), so an expired proposal reads as expired
 * and a finished to-do's commitment as done even before the worker's sweep has run. `where` and `params` from $2
 * ($1 the organisation). Never throws.
 */
async function settleFor(ctx: OrgContext, where: string, params: unknown[]): Promise<void> {
  try {
    const ids = await withUser(ctx.user.profileId, async (db) => {
      if (!(await schema0048Ready(db))) return [];
      return (await db.query<{ id: string }>(
        `SELECT cm.id FROM commitments cm WHERE cm.organisation_id = $1 AND (${where}) AND ${DUE_SQL} ORDER BY cm.created_at LIMIT 10`, [ctx.org.id, ...params])).map((r) => r.id);
    });
    const now = new Date();
    for (const id of ids) await settleOne(id, now).catch(warn(`settling ${id}`));
  } catch (err) {
    if (isMissingSchema(err)) { forget0048(); return; }
    warn("settling commitments")(err);
  }
}

/**
 * One sweep (the worker's `commitments.sweep`, at most `limit` of each kind): proposals and asks past 7 days expire (their
 * labels go), open asks past their 60 minutes reach the asked person (or, muted, never), proposals whose message was
 * withdrawn are cancelled, accepts stuck past 5 minutes open without a to-do (the person told), and open commitments
 * whose to-do was completed are done (archived: cancelled). Never throws; nothing before 0048.
 */
export async function sweepCommitments(o: { now?: Date; limit?: number } = {}): Promise<{ expired: number; done: number; cancelled: number; interrupted: number; asksDelivered: number }> {
  const now = o.now ?? new Date();
  const limit = Math.min(500, Math.max(1, Math.round(o.limit ?? 100)));
  const out = { expired: 0, done: 0, cancelled: 0, interrupted: 0, asksDelivered: 0 };
  try {
    const rows = await withWorker(async (db) => {
      if (!(await schema0048Ready(db))) return null;
      return db.query<{ id: string }>(
        `SELECT cm.id FROM commitments cm WHERE ${DUE_AT_SQL} ORDER BY cm.updated_at, cm.id LIMIT $2`, [now.toISOString(), limit]);
    });
    if (!rows) return out;
    for (const r of rows) {
      const s = await settleOne(r.id, now).catch((err) => { warn(`sweeping ${r.id}`)(err); return null; });
      if (s === "expired") out.expired++;
      else if (s === "done") out.done++;
      else if (s === "cancelled") out.cancelled++;
      else if (s === "interrupted") out.interrupted++;
      else if (s === "delivered") out.asksDelivered++;
    }
  } catch (err) {
    if (isMissingSchema(err)) forget0048();
    else warn("sweeping commitments")(err);
  }
  return out;
}

/** Whether `sweepCommitments` has anything to do now (the scheduler's per-minute check). False before 0048 and on any error. */
export async function commitmentsDue(o: { now?: Date; limit?: number } = {}): Promise<boolean> {
  const now = o.now ?? new Date();
  try {
    return await withWorker(async (db) => {
      if (!(await schema0048Ready(db))) return false;
      const r = await db.maybeOne(`SELECT 1 FROM commitments cm WHERE ${DUE_AT_SQL} LIMIT 1`, [now.toISOString()]);
      return !!r;
    });
  } catch (err) {
    if (isMissingSchema(err)) forget0048();
    else warn("checking for due commitments")(err);
    return false;
  }
}

// ---- Reading -------------------------------------------------------------------------------------------------------------

/** The scopes a person may read: their own always; their teams' when they lead one; everyone's for the owner and HR. */
async function scopesFor(db: Db, ctx: OrgContext): Promise<CommitmentScope[]> {
  const leads = await db.maybeOne(
    `SELECT 1 FROM team_members tm JOIN teams t ON t.id = tm.team_id AND t.archived_at IS NULL WHERE tm.membership_id = $1 AND tm.is_manager LIMIT 1`, [ctx.membership.id]);
  return ["mine", ...(leads ? (["team"] as const) : []), ...(isOrgAccount(ctx.membership.role) ? (["all"] as const) : [])];
}

/** A scope as SQL over `cm` ($1 the organisation, $2 the person). Team and everyone's hold only accepted ones (open, done). */
function scopeSql(scope: CommitmentScope): string {
  switch (scope) {
    case "mine": return `(cm.committer_membership_id = $2 OR cm.asker_membership_id = $2)`;
    case "team": return `(cm.committer_membership_id <> $2 AND app_manages($1, cm.committer_membership_id) AND cm.status IN ('open', 'done'))`;
    // $2 is referenced so the scope alone (settleFor) binds the same two parameters as the others.
    case "all": return `(cm.status IN ('open', 'done') AND $2::uuid IS NOT NULL)`;
  }
}

const STATUS_SQL: Record<NonNullable<CommitmentFilters["status"]>, string> = {
  waiting: `cm.status IN ('proposed', 'asked', 'accepting')`,
  open: `cm.status = 'open' AND (cm.due_at IS NULL OR cm.due_at >= now())`,
  overdue: `cm.status = 'open' AND cm.due_at < now()`,
  done: `cm.status = 'done'`, declined: `cm.status = 'declined'`, dismissed: `cm.status = 'dismissed'`,
  all: `true`,
};

const EMPTY_LIST = (scopes: CommitmentScope[] = ["mine"]): CommitmentList => ({ ready: false, scopes, items: [], nextBefore: null, counts: null, people: [] });

/**
 * A list of commitments, as the person: `mine` (they owe it, or they asked: every status), `team` (team leads: the
 * accepted ones of the people on the teams they lead) or `all` (the owner and HR: everyone's accepted ones). Filters:
 * person (a membership id, or an exact name), status (waiting, open, overdue, done, declined, dismissed, all), this
 * week (due Monday to Sunday), paged by `before` (newest first). Settles overdue ones first. 403 for a scope the person
 * may not read. Before 0048: `ready: false`, empty.
 */
export async function listCommitments(ctx: OrgContext, f: CommitmentFilters): Promise<CommitmentList> {
  const scope: CommitmentScope = f.scope === "team" || f.scope === "all" ? f.scope : "mine";
  const limit = Math.min(L.listMax, Math.max(1, Math.round(Number.isFinite(f.limit) ? (f.limit as number) : 25)));
  // Kept as written (microseconds included): the cursor is the last row's exact time (review, 9 October 2026).
  const before = f.before && !Number.isNaN(Date.parse(f.before)) ? String(f.before) : null;
  // The scope is checked before anything is settled for it (review, 9 October 2026).
  if (scope !== "mine") {
    // null before 0048: the read below answers `ready: false`.
    const allowed = await withUser(ctx.user.profileId, async (db) => (await schema0048Ready(db)) ? scopesFor(db, ctx) : null)
      .catch((err) => { if (isMissingSchema(err)) { forget0048(); return null; } throw err; });
    if (allowed && !allowed.includes(scope)) throw forbidden("You can't see those commitments.");
  }
  await settleFor(ctx, scopeSql(scope), [ctx.membership.id]);
  try {
    return await retryWithout0048(() => withUser(ctx.user.profileId, async (db): Promise<CommitmentList> => {
      if (!(await schema0048Ready(db))) return EMPTY_LIST();
      const scopes = await scopesFor(db, ctx);
      if (!scopes.includes(scope)) throw forbidden("You can't see those commitments.");
      const params: unknown[] = [];
      const p = (v: unknown) => { params.push(v); return `$${params.length + 2}`; };
      let where = scopeSql(scope);
      // The person: a membership id, or an exact name (case aside); nobody by that name reads as nothing found.
      const person = oneLine(f.person);
      let personWhere = "";
      if (person) {
        let ids: string[];
        if (isUuid(person)) ids = [person];
        else {
          ids = (await db.query<{ id: string }>(
            `SELECT m.id FROM memberships m JOIN profiles pr ON pr.id = m.user_id WHERE m.organisation_id = $1 AND lower(pr.display_name) = lower($2)`, [ctx.org.id, person])).map((r) => r.id);
        }
        if (!ids.length) return { ready: true, scopes, items: [], nextBefore: null, counts: { waiting: 0, open: 0, overdue: 0 }, people: [] };
        personWhere = ` AND cm.committer_membership_id = ANY(${p(ids)}::uuid[])`;
      }
      where += personWhere;
      const countParams = [...params];
      const status = f.status && STATUS_SQL[f.status] ? f.status : "all";
      let listWhere = `${where} AND ${STATUS_SQL[status]}`;
      if (f.thisWeek) {
        const wk = thisWeek(ctx.org.timezone);
        listWhere += ` AND cm.due_at >= ${p(wk.start)}::timestamptz AND cm.due_at < ${p(wk.end)}::timestamptz`;
      }
      if (before) listWhere += ` AND cm.created_at < ${p(before)}::timestamptz`;
      const rows = await loadViews(db, ctx, listWhere, params, `ORDER BY cm.created_at DESC, cm.id DESC LIMIT ${limit + 1}`);
      const items = rows.slice(0, limit);
      const counts = await db.one<{ waiting: number; open: number; overdue: number }>(
        `SELECT count(*) FILTER (WHERE cm.committer_membership_id = $2 AND (cm.status = 'proposed' OR (cm.status = 'asked' AND cm.notified_at IS NOT NULL)) AND cm.expires_at > now())::int AS waiting,
                count(*) FILTER (WHERE cm.status = 'open' AND (cm.due_at IS NULL OR cm.due_at >= now()))::int AS open,
                count(*) FILTER (WHERE cm.status = 'open' AND cm.due_at < now())::int AS overdue
         FROM commitments cm WHERE cm.organisation_id = $1 AND NOT ${HIDDEN_SQL} AND ${where}`, [ctx.org.id, ctx.membership.id, ...countParams]);
      const people = scope === "mine" ? [] : await db.query<{ membershipId: string; name: string }>(
        `SELECT DISTINCT cm.committer_membership_id AS "membershipId", pr.display_name AS name
         FROM commitments cm JOIN memberships m ON m.id = cm.committer_membership_id JOIN profiles pr ON pr.id = m.user_id
         WHERE cm.organisation_id = $1 AND NOT ${HIDDEN_SQL} AND ${scopeSql(scope)} ORDER BY pr.display_name LIMIT 200`, [ctx.org.id, ctx.membership.id]);
      // The next page starts after the last row's exact time (a JavaScript date keeps milliseconds only, so rows in the
      // same millisecond as the last one were skipped; review, 9 October 2026).
      const nextBefore = rows.length > limit
        ? (await db.one<{ at: string }>(`SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at FROM commitments WHERE id = $1`, [items[items.length - 1].id])).at
        : null;
      return { ready: true, scopes, items, nextBefore, counts, people };
    }));
  } catch (err) {
    if (isMissingSchema(err)) { forget0048(); return EMPTY_LIST(); }
    throw err;
  }
}

/** One commitment for its committer, its asker, or (open and done) someone who may view the committer's records; null otherwise. */
export async function getCommitment(ctx: OrgContext, id: string): Promise<CommitmentView | null> {
  if (!isUuid(id)) return null;
  await settleFor(ctx, "cm.id = $2", [id]);
  try {
    return await retryWithout0048(() => withUser(ctx.user.profileId, async (db) => {
      if (!(await schema0048Ready(db))) return null;
      return (await loadViews(db, ctx, "cm.id = $3", [id], ""))[0] ?? null;
    }));
  } catch (err) {
    if (isMissingSchema(err)) { forget0048(); return null; }
    throw err;
  }
}

const WAITING_SQL = `(cm.committer_membership_id = $2 AND (cm.status = 'proposed' OR (cm.status = 'asked' AND cm.notified_at IS NOT NULL)) AND cm.expires_at > now())`;

/**
 * What waits for this person in the Between-assistants inbox: proposals noted for them (`commitment`) and open asks they
 * were told about (`open_ask`), oldest first, at most 20; settles first. [] before 0048.
 */
export async function waitingCommitments(ctx: OrgContext): Promise<LoopInboxItem[]> {
  await settleFor(ctx, "cm.committer_membership_id = $2", [ctx.membership.id]);
  try {
    return await retryWithout0048(() => withUser(ctx.user.profileId, async (db) => {
      if (!(await schema0048Ready(db))) return [];
      const views = await loadViews(db, ctx, WAITING_SQL, [], `ORDER BY cm.created_at, cm.id LIMIT ${L.waitingMax}`);
      return views.map((v): LoopInboxItem => (v.status === "asked" ? { kind: "open_ask", commitment: v } : { kind: "commitment", commitment: v }));
    }));
  } catch (err) {
    if (isMissingSchema(err)) { forget0048(); return []; }
    throw err;
  }
}

// ---- The committer's steps ------------------------------------------------------------------------------------------------

/** The definer's word for accept, decline or dismiss, as the error the routes answer. */
function decideError(word: string): AppError | null {
  switch (word) {
    case "ok": return null;
    case "not_found": return notHere();
    case "closed": return conflict("ITEM_CLOSED", W.errors.closed);
    case "expired": return conflict("ITEM_EXPIRED", W.errors.expired);
    case "too_long": return invalid(W.errors.tooLong(L.declineReasonMax), { reason: [W.errors.tooLong(L.declineReasonMax)] });
    default: return notHere();
  }
}

async function viewOrThrow(ctx: OrgContext, id: string): Promise<CommitmentView> {
  const v = await getCommitment(ctx, id);
  if (!v) throw notHere();
  return v;
}

/** Runs one of the committer's steps as them; 503 before 0048. */
async function asCommitter<T>(ctx: OrgContext, fn: (db: Db) => Promise<T>): Promise<T> {
  try {
    return await retryWithout0048(() => withUser(ctx.user.profileId, async (db) => {
      if (!(await schema0048Ready(db))) throw notReady();
      return fn(db);
    }));
  } catch (err) {
    if (isMissingSchema(err)) { forget0048(); throw notReady(); }
    throw err;
  }
}

/**
 * Accept (the committer alone, never while someone else is signed in as them): the definer moves it to 'accepting' with
 * a two-minute lease; then the to-do is added AS THE PERSON through the same quickTodo their buttons use (owners and HR
 * hold none: it is tracked without one), with the message's link in its details; the worker records it open and linked;
 * for an ask, the person who asked is told. A to-do that could not be added still opens it, with a note saying so.
 * `title` and `dueAt` may change what the to-do (and the commitment) says. 404, 409 ITEM_CLOSED / ITEM_EXPIRED, 403,
 * 422, 503.
 */
export async function acceptCommitment(ctx: OrgContext, id: string, input: { title?: string; dueAt?: string | null }): Promise<{ commitment: CommitmentView; note: string | null }> {
  if (!isUuid(id)) throw notHere();
  notWhileImpersonated(ctx);
  let title: string | undefined;
  if (input.title !== undefined) {
    title = oneLine(input.title);
    if (!title) throw invalid("Give it a title.", { title: ["Give it a title."] });
    if (title.length > L.titleMax) throw invalid(W.errors.tooLong(L.titleMax), { title: [W.errors.tooLong(L.titleMax)] });
  }
  if (input.dueAt !== undefined && input.dueAt !== null && !isIso(input.dueAt)) throw invalid("Pick a date and time.", { dueAt: ["Pick a date and time."] });
  const row = await asCommitter(ctx, async (db) => {
    const r = await db.one<{ r: string }>(`SELECT app_commitment_decide($1, 'accept', NULL) AS r`, [id]);
    const e = decideError(r.r);
    if (e) throw e;
    await readNotices(db, ctx, id);
    return db.one<{ kind: CommitmentKind; title: string; due_at: string | null; conversation_id: string; source_message_id: string; agreement_message_id: string | null; conv_name: string | null }>(
      `SELECT cm.kind, cm.title, cm.due_at, cm.conversation_id, cm.source_message_id, cm.agreement_message_id, ${CONV_NAME_SQL} AS conv_name
       FROM commitments cm LEFT JOIN conversations c ON c.id = cm.conversation_id LEFT JOIN teams ct ON ct.id = c.team_id WHERE cm.id = $1`, [id]);
  });
  const finalTitle = title ?? row.title;
  const dueAt = input.dueAt !== undefined ? (input.dueAt === null ? null : new Date(input.dueAt).toISOString()) : row.due_at;
  let taskId: string | null = null;
  let note: string | null = null;
  if (!isOrgAccount(ctx.membership.role)) {
    const href = `${appOrigin()}${messageHref(ctx.org.slug, row.conversation_id, row.agreement_message_id ?? row.source_message_id)}`;
    try {
      const t = await quickTodo(ctx, { title: finalTitle, dueAt, description: `${finalTitle}\n\nNoted in ${row.conv_name ?? "Messages"}: ${href}` });
      taskId = t.id;
    } catch (err) {
      warn(`adding the to-do for ${id}`)(err);
      note = W.inbox.acceptedButNoTodo;
    }
  }
  await withWorker(async (db) => {
    let moved = await db.maybeOne(
      `UPDATE commitments SET status = 'open', todo_task_id = $2, title = $3, due_at = $4, lease_until = NULL WHERE id = $1 AND status = 'accepting' RETURNING id`,
      [id, taskId, finalTitle, dueAt]);
    // The sweep opened it in between (a slow to-do): link the to-do it now has.
    if (!moved && taskId) moved = await db.maybeOne(`UPDATE commitments SET todo_task_id = $2 WHERE id = $1 AND status = 'open' AND todo_task_id IS NULL RETURNING id`, [id, taskId]);
    const r = await db.maybeOne<NoticeRow>(NOTICE_SQL, [id]);
    if (!r) return;
    await syncLabel(db, r);
    if (moved && r.asker_membership_id && (r.kind === "agreed_ask" || r.kind === "open_ask")) {
      await notify(db, {
        organisationId: r.organisation_id, recipientMembershipId: r.asker_membership_id, type: "brenda.commitment_accepted",
        title: clip(W.notifications.accepted(firstName(r.committer_name), loopTitle(r.title)), 200),
        resourceType: "commitment", resourceId: id, href: commitmentHref(r.slug, id), dedupKey: `commitment.accepted:${id}`,
      });
    }
    await audit(db, { organisationId: r.organisation_id, actorMembershipId: ctx.membership.id, action: "commitment.accepted", subjectType: "commitment", subjectId: id, subjectMembershipId: ctx.membership.id, metadata: { commitmentId: id, kind: r.kind, taskId } });
  }).catch(warn(`recording the accept of ${id}`));
  await recordAction(ctx, { tool: "commitment", summary: "Accepted a commitment onto your list", outcome: "done", source: "confirm", detail: { commitmentId: id, taskId } });
  return { commitment: await viewOrThrow(ctx, id), note };
}

/** Decline (the committer alone): optional reason (≤ 280); for an ask the person who asked is told privately, with the reason. */
export async function declineCommitment(ctx: OrgContext, id: string, reason?: string | null): Promise<CommitmentView> {
  if (!isUuid(id)) throw notHere();
  notWhileImpersonated(ctx);
  const clean = oneLine(reason) || null;
  if (clean && clean.length > L.declineReasonMax) throw invalid(W.errors.tooLong(L.declineReasonMax), { reason: [W.errors.tooLong(L.declineReasonMax)] });
  await asCommitter(ctx, async (db) => {
    const r = await db.one<{ r: string }>(`SELECT app_commitment_decide($1, 'decline', $2) AS r`, [id, clean]);
    const e = decideError(r.r);
    if (e) throw e;
    await readNotices(db, ctx, id);
  });
  await withWorker(async (db) => {
    const r = await db.maybeOne<NoticeRow>(NOTICE_SQL, [id]);
    if (!r || r.status !== "declined") return;
    await syncLabel(db, r);
    if (r.asker_membership_id && (r.kind === "agreed_ask" || r.kind === "open_ask")) {
      await notify(db, {
        organisationId: r.organisation_id, recipientMembershipId: r.asker_membership_id, type: "brenda.commitment_declined",
        title: clip(W.notifications.declined(firstName(r.committer_name), loopTitle(r.title)), 200), body: clip(W.notifications.declinedBody(r.decline_reason), 300),
        resourceType: "commitment", resourceId: id, href: commitmentHref(r.slug, id), dedupKey: `commitment.declined:${id}`,
      });
    }
    await audit(db, { organisationId: r.organisation_id, actorMembershipId: ctx.membership.id, action: "commitment.declined", subjectType: "commitment", subjectId: id, subjectMembershipId: ctx.membership.id, metadata: { commitmentId: id, kind: r.kind, withReason: !!r.decline_reason } });
  }).catch(warn(`telling the asker about ${id}`));
  return viewOrThrow(ctx, id);
}

/** "Not a commitment" (the committer alone): closed, the label says so; the person who asked is NOT told. */
export async function dismissCommitment(ctx: OrgContext, id: string): Promise<CommitmentView> {
  if (!isUuid(id)) throw notHere();
  notWhileImpersonated(ctx);
  await asCommitter(ctx, async (db) => {
    const r = await db.one<{ r: string }>(`SELECT app_commitment_decide($1, 'dismiss', NULL) AS r`, [id]);
    const e = decideError(r.r);
    if (e) throw e;
    await readNotices(db, ctx, id);
  });
  await withWorker(async (db) => {
    const r = await db.maybeOne<NoticeRow>(NOTICE_SQL, [id]);
    if (!r || r.status !== "dismissed") return;
    await syncLabel(db, r);
    await audit(db, { organisationId: r.organisation_id, actorMembershipId: ctx.membership.id, action: "commitment.dismissed", subjectType: "commitment", subjectId: id, subjectMembershipId: ctx.membership.id, metadata: { commitmentId: id, kind: r.kind } });
  }).catch(warn(`labelling ${id}`));
  return viewOrThrow(ctx, id);
}

/** "Mark done" (the committer alone, on an open commitment, with or without a to-do; done already: as it is). */
export async function markCommitmentDone(ctx: OrgContext, id: string): Promise<CommitmentView> {
  if (!isUuid(id)) throw notHere();
  notWhileImpersonated(ctx);
  const moved = await asCommitter(ctx, async (db) => {
    const before = await db.maybeOne<{ status: string }>(`SELECT status FROM commitments WHERE id = $1 AND committer_membership_id = $2`, [id, ctx.membership.id]);
    const r = await db.one<{ r: string }>(`SELECT app_commitment_mark_done($1) AS r`, [id]);
    if (r.r === "not_found") throw notHere();
    if (r.r === "closed") throw conflict("ITEM_CLOSED", W.errors.closed);
    return before?.status === "open";
  });
  if (moved) {
    await withWorker(async (db) => {
      const r = await db.maybeOne<NoticeRow>(NOTICE_SQL, [id]);
      if (!r) return;
      await syncLabel(db, r);
      await audit(db, { organisationId: r.organisation_id, actorMembershipId: ctx.membership.id, action: "commitment.done", subjectType: "commitment", subjectId: id, subjectMembershipId: ctx.membership.id, metadata: { commitmentId: id, by: "person" } });
    }).catch(warn(`labelling ${id}`));
  }
  return viewOrThrow(ctx, id);
}

/** Opening its card marks it seen (the committer alone); their notification is read. */
export async function markCommitmentSeen(ctx: OrgContext, id: string): Promise<void> {
  if (!isUuid(id)) throw notHere();
  notWhileImpersonated(ctx);
  await asCommitter(ctx, async (db) => {
    const r = await db.one<{ r: string }>(`SELECT app_commitment_seen($1) AS r`, [id]);
    if (r.r === "not_found") throw notHere();
    await readNotices(db, ctx, id);
  });
}

// ---- Worker side (detection hands these over) -----------------------------------------------------------------------------

type CleanDetected = Omit<DetectedCommitment, "messageAt"> & { messageAt: string };

/** A detected row as it may be stored, or null (an id that is not one, a missing asker, a title that is empty…). */
function cleanDetected(r: DetectedCommitment, now: Date): CleanDetected | null {
  if (!r || typeof r !== "object" || !isUuid(r.conversationId) || !isUuid(r.sourceMessageId) || !isCommitmentKind(r.kind) || !isUuid(r.committerMembershipId)) return null;
  const agreement = r.agreementMessageId == null ? null : isUuid(r.agreementMessageId) ? r.agreementMessageId : undefined;
  const asker = r.askerMembershipId == null ? null : isUuid(r.askerMembershipId) ? r.askerMembershipId : undefined;
  if (agreement === undefined || asker === undefined) return null;
  if ((r.kind === "agreed_ask") !== (agreement !== null)) return null;
  if (r.kind !== "promise" && !asker) return null;
  if (asker && asker.toLowerCase() === r.committerMembershipId.toLowerCase()) return null;
  const title = clip(oneLine(r.title), L.titleMax);
  if (!title) return null;
  const dueAt = typeof r.dueAt === "string" && !Number.isNaN(Date.parse(r.dueAt)) ? new Date(r.dueAt).toISOString() : null;
  const dueWords = clip(oneLine(r.dueWords), L.dueWordsMax) || null;
  const c = Number(r.confidence);
  const confidence = Number.isFinite(c) ? Math.min(1, Math.max(0, c)) : 0;
  const messageAt = typeof r.messageAt === "string" && !Number.isNaN(Date.parse(r.messageAt)) ? new Date(r.messageAt).toISOString() : now.toISOString();
  return {
    conversationId: r.conversationId, sourceMessageId: r.sourceMessageId, agreementMessageId: agreement, kind: r.kind,
    committerMembershipId: r.committerMembershipId, askerMembershipId: asker, title, dueAt, dueWords,
    detectedBy: r.detectedBy === "claude" ? "claude" : "builtin", confidence, messageAt,
  };
}

/**
 * Stores what detection found (the worker), each row in its own transaction. Skipped: a conversation that is direct,
 * untracked or archived, or an organisation with tracking off; a message not in that conversation, or written by
 * someone else than the rules say (a promise by its committer, an ask by its asker, an agreement by its committer: a
 * message never commits someone else); a committer or asker who does not read it; a committer past 10 a day, or past
 * 3 asks a day from the same person; an open ask to someone who muted the asker's assistant. One per message and
 * committer (`commitments_one_per_message`). A proposal is labelled "Noted" and its committer told at once; an open
 * ask waits 60 minutes and has no label until it is accepted. Nothing before 0048.
 */
export async function insertDetectedCommitments(organisationId: string, rows: DetectedCommitment[], o: { now?: Date } = {}): Promise<{ created: string[]; skipped: number }> {
  const now = o.now ?? new Date();
  const created: string[] = [];
  let skipped = 0;
  if (!isUuid(organisationId) || !Array.isArray(rows) || !rows.length) return { created, skipped: Array.isArray(rows) ? rows.length : 0 };
  let org: { timezone: string; on: boolean } | null;
  try {
    org = await withWorker(async (db) => {
      if (!(await schema0048Ready(db))) return null;
      const r = await db.maybeOne<{ timezone: string; status: string; on: boolean | null }>(
        `SELECT o.timezone, o.status, bs.track_commitments AS on FROM organisations o LEFT JOIN brenda_settings bs ON bs.organisation_id = o.id WHERE o.id = $1`, [organisationId]);
      return r ? { timezone: r.timezone, on: r.status === "active" && !!r.on } : null;
    });
  } catch (err) {
    if (isMissingSchema(err)) { forget0048(); return { created, skipped: rows.length }; }
    throw err;
  }
  if (!org || !org.on) return { created, skipped: rows.length };
  const dayStart = localMidnight(todayLocal(org.timezone, now), org.timezone).toISOString();
  for (const raw of rows) {
    const r = cleanDetected(raw, now);
    if (!r) { skipped++; continue; }
    try {
      const id = await withWorker(async (db): Promise<string | null> => {
        const conv = await db.maybeOne<{ kind: string; track: boolean; archived: boolean }>(
          `SELECT kind, track_commitments AS track, (archived_at IS NOT NULL) AS archived FROM conversations WHERE id = $1 AND organisation_id = $2`, [r.conversationId, organisationId]);
        if (!conv || conv.kind === "direct" || !conv.track || conv.archived) return null;
        const msgs = await db.query<{ id: string; sender_membership_id: string; deleted: boolean }>(
          `SELECT id, sender_membership_id, (deleted_at IS NOT NULL) AS deleted FROM messages WHERE id = ANY($1::uuid[]) AND conversation_id = $2 AND organisation_id = $3`,
          [[r.sourceMessageId, ...(r.agreementMessageId ? [r.agreementMessageId] : [])], r.conversationId, organisationId]);
        const source = msgs.find((m) => m.id === r.sourceMessageId);
        const agreement = r.agreementMessageId ? msgs.find((m) => m.id === r.agreementMessageId) : null;
        if (!source || source.deleted || (r.agreementMessageId && (!agreement || agreement.deleted))) return null;
        const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
        if (r.kind === "promise" && !same(source.sender_membership_id, r.committerMembershipId)) return null;
        if (r.kind !== "promise" && !same(source.sender_membership_id, r.askerMembershipId)) return null;
        if (r.kind === "agreed_ask" && !same(agreement?.sender_membership_id, r.committerMembershipId)) return null;
        const readers = await db.one<{ committer: boolean; asker: boolean }>(
          `SELECT app_conversation_has_reader($1, $2) AS committer, ($3::uuid IS NULL OR app_conversation_has_reader($1, $3)) AS asker`,
          [r.conversationId, r.committerMembershipId, r.askerMembershipId]);
        if (!readers.committer || !readers.asker) return null;
        // One at a time per committer, so two scans cannot both pass the daily count.
        await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`commitment.insert:${r.committerMembershipId}`]);
        const counts = await db.one<{ today: number; pair: number }>(
          `SELECT count(*)::int AS today,
                  count(*) FILTER (WHERE kind IN ('open_ask', 'agreed_ask') AND asker_membership_id = $3)::int AS pair
           FROM commitments WHERE committer_membership_id = $1 AND created_at >= $2::timestamptz`, [r.committerMembershipId, dayStart, r.askerMembershipId]);
        if (counts.today >= L.proposalsPerPersonPerDay) return null;
        if (r.kind !== "promise" && counts.pair >= L.asksPerPairPerDay) return null;
        if (r.kind === "open_ask") {
          const muted = await db.maybeOne(`SELECT 1 FROM assistant_item_mutes WHERE recipient_membership_id = $1 AND sender_membership_id = $2 AND muted`, [r.committerMembershipId, r.askerMembershipId]);
          if (muted) return null;
        }
        const ins = await db.maybeOne<{ id: string }>(
          `INSERT INTO commitments(organisation_id, conversation_id, source_message_id, agreement_message_id, kind, committer_membership_id, asker_membership_id,
                                   title, due_at, due_words, status, detected_by, confidence, expires_at, ask_notify_after)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::timestamptz + make_interval(days => $15),
                   CASE WHEN $5 = 'open_ask' THEN $16::timestamptz + make_interval(mins => $17) END)
           ON CONFLICT ON CONSTRAINT commitments_one_per_message DO NOTHING RETURNING id`,
          [organisationId, r.conversationId, r.sourceMessageId, r.agreementMessageId, r.kind, r.committerMembershipId, r.askerMembershipId,
           r.title, r.dueAt, r.dueWords, r.kind === "open_ask" ? "asked" : "proposed", r.detectedBy, r.confidence,
           now.toISOString(), L.commitmentTtlDays, r.messageAt, L.openAskGraceMinutes]);
        if (!ins) return null;
        if (r.kind !== "open_ask") {
          const n = await db.one<NoticeRow>(NOTICE_SQL, [ins.id]);
          await syncLabel(db, n);
          await tellCommitter(db, n);
        }
        await audit(db, { organisationId, action: "commitment.noted", subjectType: "commitment", subjectId: ins.id, subjectMembershipId: r.committerMembershipId, metadata: { commitmentId: ins.id, kind: r.kind, detectedBy: r.detectedBy } });
        return ins.id;
      });
      if (id) created.push(id); else skipped++;
    } catch (err) {
      skipped++;
      if (isMissingSchema(err)) { forget0048(); break; }
      warn("storing a detected commitment")(err);
    }
  }
  return { created, skipped };
}

/**
 * The asked person agreed in the thread ("On it") before they were told of the open ask (or after: the same card then
 * reads as agreed): the ask becomes an agreed ask, waiting for them as a proposal, labelled "Noted" on the agreement.
 * The agreement must be theirs, in the same conversation. As the worker; false when it was no longer an open ask.
 */
export async function markAgreed(commitmentId: string, agreementMessageId: string, o: { now?: Date } = {}): Promise<boolean> {
  void o;
  if (!isUuid(commitmentId) || !isUuid(agreementMessageId)) return false;
  try {
    return await withWorker(async (db) => {
      if (!(await schema0048Ready(db))) return false;
      const ok = await db.maybeOne<{ id: string }>(
        `UPDATE commitments cm SET kind = 'agreed_ask', status = 'proposed', agreement_message_id = $2, ask_notify_after = NULL
         WHERE cm.id = $1 AND cm.status = 'asked' AND cm.kind = 'open_ask'
           AND EXISTS (SELECT 1 FROM messages m WHERE m.id = $2 AND m.conversation_id = cm.conversation_id AND m.sender_membership_id = cm.committer_membership_id
                         AND m.deleted_at IS NULL AND m.id <> cm.source_message_id)
         RETURNING cm.id`, [commitmentId, agreementMessageId]);
      if (!ok) return false;
      const n = await db.one<NoticeRow>(NOTICE_SQL, [commitmentId]);
      await syncLabel(db, n);
      if (!n.notified_at) await tellCommitter(db, n);
      await audit(db, { organisationId: n.organisation_id, action: "commitment.agreed", subjectType: "commitment", subjectId: commitmentId, subjectMembershipId: n.committer_membership_id, metadata: { commitmentId } });
      return true;
    });
  } catch (err) {
    if (isMissingSchema(err)) { forget0048(); return false; }
    throw err;
  }
}

// ---- The report and the notch ------------------------------------------------------------------------------------------------

/**
 * The end-of-day report's Commitments section, as its reader reads them (row-level security: their own, the ones they
 * asked, and the accepted ones of the people whose records they may view): made today (accepted or done, decided on
 * `localDate` in the organisation's zone, by someone other than the reader) and overdue (open, past due). Null before
 * 0048; throws on any other failure (the report says "not available").
 */
export async function commitmentsForReport(ctx: OrgContext, localDate: string): Promise<{ madeToday: CommitmentView[]; overdue: CommitmentView[] } | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) throw invalid("Not a date.");
  try {
    return await retryWithout0048(() => withUser(ctx.user.profileId, async (db) => {
      if (!(await schema0048Ready(db))) return null;
      const tz = ctx.org.timezone;
      const start = localMidnight(localDate, tz).toISOString();
      const end = localMidnight(addDays(localDate, 1), tz).toISOString();
      const madeToday = await loadViews(db, ctx,
        `cm.status IN ('open', 'done') AND cm.decided_at >= $3::timestamptz AND cm.decided_at < $4::timestamptz AND cm.committer_membership_id <> $2`,
        [start, end], `ORDER BY cm.decided_at, cm.id LIMIT 200`);
      const overdue = await loadViews(db, ctx, `cm.status = 'open' AND cm.due_at < now()`, [], `ORDER BY cm.due_at, cm.id LIMIT 200`);
      return { madeToday, overdue };
    }));
  } catch (err) {
    if (isMissingSchema(err)) { forget0048(); return null; }
    throw err;
  }
}

/**
 * What the notch shows: the commitments and open asks waiting for the person (oldest first, at most 5: the noted
 * commitment and open-ask cards), the blocks waiting on them (the blocked-on card), and how many loose ends are open
 * (the day card's link). Before 0048 `ready: false` and empty.
 */
export async function loopsForDesktop(ctx: OrgContext): Promise<DesktopLoops> {
  const looseHref = `/app/${ctx.org.slug}/home/loose-ends`;
  const none: DesktopLoops = { ready: false, commitments: [], blocks: [], looseEnds: { open: 0, href: looseHref } };
  if (!(await commitmentsReady(ctx))) return none;
  // Loaded when needed: task-blocks reads blocks only; nothing here is needed at module load.
  const { waitingBlocks } = await import("@/server/services/task-blocks");
  const [waiting, blocks, open, ws] = await Promise.all([
    waitingCommitments(ctx),
    waitingBlocks(ctx),
    withUser(ctx.user.profileId, (db) => db.one<{ n: number }>(`SELECT count(*)::int AS n FROM loose_ends WHERE membership_id = $1 AND status = 'open'`, [ctx.membership.id])),
    withUser(ctx.user.profileId, (db) => db.maybeOne<{ name: string | null }>(`SELECT assistant_name AS name FROM brenda_settings WHERE organisation_id = $1`, [ctx.org.id])),
  ]);
  const wsName = toProfile({ name: ws?.name }).name;
  return {
    ready: true,
    commitments: waiting.slice(0, L.desktopMax).flatMap((item) => {
      if (item.kind === "blocked_on") return [];
      const c = item.commitment;
      const t = loopTitle(c.title);
      const askerFirst = c.asker?.firstName ?? "Someone";
      return [{
        id: c.id, kind: item.kind,
        title: item.kind === "open_ask" ? W.inbox.openAskTitle(askerFirst, t) : c.kind === "agreed_ask" ? W.inbox.agreedTitle(wsName, askerFirst, t) : W.inbox.commitmentTitle(wsName, t),
        what: clip(c.title, L.whatMax), dueLabel: c.dueLabel,
        from: c.asker ? { name: c.asker.name } : null,
        acceptLabel: item.kind === "open_ask" ? W.inbox.takeItOn : c.acceptMakesTodo ? W.inbox.accept : W.inbox.acceptNoTodos,
        href: commitmentInboxHref(ctx.org.slug, c.id),
      }];
    }),
    blocks: blocks.slice(0, L.desktopMax).flatMap((item) => (item.kind === "blocked_on" ? [{
      id: item.block.id, title: W.inbox.blockedTitle(item.block.blocked.firstName), question: item.block.question, taskTitle: item.block.taskTitle,
      from: { name: item.block.blocked.name }, href: item.block.href,
    }] : [])),
    looseEnds: { open: open.n, href: looseHref },
  };
}
