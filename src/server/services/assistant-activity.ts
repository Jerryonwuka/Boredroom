/**
 * "What Max did" (owner decision, 8 October 2026: personal assistants, phase 3): one place where a person sees everything
 * their own assistant did or read for them, newest first: her actions (`brenda_actions`: done, confirmed, refused,
 * failed) and the conversations she read to catch them up (source 'read', migration 0037, written by
 * server/services/catch-up). Reached from her page and from Settings → Your assistant.
 *
 * Always personal, whatever the role: owners and HR keep their organisation-wide view of her actions in Settings →
 * Brenda (`brendaOverview`), but what she read for someone is theirs alone (row-level security hides it from owners and
 * HR too). While an administrator is signed in as the person, the reads are left out here as well (review,
 * 8 October 2026: decision 4).
 *
 * Act without asking (owner decision, 8 October 2026): a row the assistant wrote when the person asked in their own chat
 * and nobody pressed Confirm carries `detail.auto = true`; the list reads it as `auto` ("done without asking"). Undoing
 * one is a row of its own (tool 'undo'), whose words for owners and HR are generic.
 */
import { z } from "zod";
import { withUser } from "@/server/db";
import type { OrgContext } from "@/server/lib/api";
import { invalid } from "@/server/lib/errors";
import { retryWithout0037, schema0037Ready } from "@/server/lib/schema-0037";
import { schema0058Ready } from "@/server/lib/schema-0058";
import { schema0060Ready } from "@/server/lib/schema-0060";
import { actOutcome, actSummary, type ConfirmVia, type EndReason } from "@/lib/act";

// "mac" (phase 2, owner request 12 October 2026; contract D.11): what she did on the person's Mac, only for them.
export const ACTIVITY_KINDS = ["all", "actions", "reads", "problems", "mac"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];
export type ActivityItem = {
  id: string; tool: string; summary: string;
  outcome: "done" | "confirmed" | "refused" | "failed";
  /** "mac": a task on the person's Mac (phase 2), whose id is "task:<uuid>" and whose tool is mac_screen, mac_file or (phase 3) mac_plan. */
  source: "chat" | "confirm" | "automatic" | "read" | "mac" | "private";
  /** The page it is about (detail.href) when it is inside this workspace; else null. */
  href: string | null;
  createdAt: string;
  /** Done without a Confirm press because the person chose Act without asking (detail.auto; 8 October 2026). */
  auto?: boolean;
  /** A task on the Mac: how the person said yes (null: they never did), and whether it is still going. */
  detail?: { via: ConfirmVia | null; live: boolean };
  /**
   * Brenda and her helpers (owner brief, 12 October 2026; contract N.3): a request the person made on their Mac (id
   * "request:<uuid>", tool mac_request): their own words, shown as "You asked: “…”" above what she did.
   */
  asked?: string;
};
export type ActivityPage = { items: ActivityItem[]; nextCursor: string | null; readsAvailable: boolean; readsHidden: boolean };

// ---- How a row reads ------------------------------------------------------------------------------------------------

/**
 * What she set out to do, as the person reads it ("add 2 to-dos", "clock you out"), for a row that did not go through
 * (review, 8 October 2026): its words used to be the tool's error alone, written for the model, with no sign of what she
 * tried.
 */
export function attemptOf(tool: string, input: Record<string, unknown> = {}): string {
  const n = Array.isArray(input.items) ? input.items.length : 0;
  switch (tool) {
    case "create_todos": return n > 1 ? `add ${n} to-dos` : "add a to-do";
    case "assign_task": return "hand a task to someone";
    case "update_task": return "change a task";
    case "add_comment": return "comment on a task";
    case "submit_for_review": return "send a task for review";
    case "remind_me": return "set a reminder";
    case "cancel_reminder": return "cancel a reminder";
    case "complete_task": return "mark a task done";
    case "clock": return input.direction === "out" ? "clock you out" : input.direction === "in" ? "clock you in" : "clock you in or out";
    case "timer": return input.action === "start" ? "start your timer" : input.action === "pause" ? "pause your timer" : input.action === "resume" ? "resume your timer" : input.action === "stop" ? "stop your timer" : "run your timer";
    case "send_message": return "send a message";
    case "create_team": return "create a team";
    case "invite_person": return "invite someone";
    case "set_status": return "set your status";
    case "plan_day": return "arrange your day";
    case "create_doc": return "save a document";
    case "update_doc": return "change a document";
    case "mark_read": return "mark conversations as read";
    case "team_report": return "write the team report";
    // Follow-ups between assistants (owner decision, 8 October 2026: personal assistants, phase 4).
    case "follow_up": return "follow up with someone";
    // Assistants talk to each other (owner decision, 8 October 2026: personal assistants, phase 6).
    case "pass_message": return "pass a message to someone's assistant";
    case "hand_over_request": return "send a request to someone's assistant";
    case "add_report_note": return "add a note to the team report";
    case "assistant_inbox": return "check what other assistants brought you";
    case "respond_to_item": return "answer something another assistant brought you";
    case "follow_up_status": return "check your follow-ups";
    // Loose ends and commitments (phase 7b, owner decisions 8 October 2026; review, 9 October 2026).
    case "loose_ends": return "look for your loose ends";
    case "loose_end_action": return input.action === "todo" ? "make a loose end a to-do" : input.action === "remind" ? "set a reminder for a loose end"
      : input.action === "hand_over" ? "hand a loose end to someone's assistant" : input.action === "follow_up" ? "schedule a follow-up on a loose end"
      : input.action === "dismiss" ? "set a loose end aside" : "act on a loose end";
    case "commitments": return "check commitments";
    case "respond_to_commitment": return input.action === "accept" ? "accept a commitment" : input.action === "decline" ? "decline a commitment"
      : input.action === "dismiss" ? "mark something as not a commitment" : input.action === "done" ? "mark a commitment done" : "answer a commitment";
    case "set_blocked_on": return "say who a task is blocked on";
    case "respond_to_block": return input.action === "not_me" ? "say a blocked task isn't yours" : "answer a blocked task";
    case "waiting_on": return "check who is waiting on whom";
    // The async standup and "How I like things done" (owner decisions, 8–9 October 2026: phase 7c).
    case "standup": return "read your standup";
    // A skip attempt reads like any other step on a draft: owners and HR read these rows and may receive the rollup,
    // where a skip and silence read the same (fix review, 9 October 2026).
    case "standup_action": return input.action === "post" ? "post your standup" : "act on your standup";
    case "remember_preference": return "remember a preference";
    case "forget_preference": return "forget a preference";
    default: return "do that";
  }
}

/**
 * Tools whose words name who the person messages or which of their conversations: a row about them says only what kind
 * of thing she did, so owners and HR (who see her actions organisation-wide in Settings → Brenda) never read the
 * person's private channel names, who they message or what they wrote. The person's own fuller words live in the row's
 * detail (`personalSummary`) and show only on their own Activity page (review, 8 October 2026).
 */
// Follow-ups too (owner decision, 8 October 2026: personal assistants, phase 4): who someone asked about, and what their
// own assistant shared about them (follow_up_answer, logged on the subject's side), are theirs; owners and HR see that a
// follow-up happened in Audit, never its words.
// Phase 6 (owner decision, 8 October 2026: assistants talk to each other): who someone passed a message or a request to,
// and why it didn't go ("Ben isn't taking messages from your assistant right now" would reveal Ben's mute), are theirs
// too; the tool names and the log kinds the done lines use are both listed.
export const PRIVATE_TOOLS: ReadonlySet<string> = new Set(["send_message", "mark_read", "read_conversation", "search_messages", "list_conversations", "follow_up", "follow_up_status", "follow_up_answer",
  "pass_message", "hand_over_request", "add_report_note", "assistant_inbox", "respond_to_item", "assistant_message", "assistant_request", "assistant_report_note", "assistant_respond",
  // Act without asking (owner decision, 8 October 2026): an Undo's own words ("Undid: Sent Ben …") are the person's; the
  // row's summary for owners and HR says only what kind of thing was undone ("Undid a message").
  "undo",
  // Loose ends, commitments and "blocked on whom" (phase 7b; security review, 9 October 2026): their refusals name the
  // person and can reveal a mute ("Ben isn't taking messages from your assistant right now"), and their words are other
  // people's. Owners and HR read only what kind of thing was tried.
  "loose_ends", "loose_end_action", "commitments", "respond_to_commitment", "set_blocked_on", "respond_to_block", "waiting_on",
  // "How I like things done" (owner decisions, 8–9 October 2026: phase 7c): what the person asked their assistant to
  // remember is theirs alone (owners and HR never see it), so a refusal says only what kind of thing was tried.
  "remember_preference", "forget_preference", "preference",
  // The async standup (fix review, 9 October 2026): a refusal's words can say a draft was skipped or name the team.
  "standup", "standup_action",
  // Connected apps (owner decisions, 22 October 2026: connectors): what she read or tried in someone's apps is theirs.
  "connected_apps", "my_calendar", "my_work_items", "find_in_apps", "read_app_item", "track_app_item", "hide_app_item",
  "calendar_action", "work_item_action", "notion_action", "post_to_channel", "connector"]);

/**
 * What owners and HR read in Settings › Brenda's log for an action her done line describes (owner decision 1, 11 October
 * 2026: screen help; contract D.8): generic words for every action, look or not ("Added a to-do", "Set a reminder"), so
 * the log never shows what a person asked for, and so a look's action reads exactly as the same action asked for in
 * words (generic words only for looks would themselves give a look away). The person's own Activity page keeps the full
 * words (`personalSummary` in the row's detail). Call sites that already give their own `logged` words keep them.
 */
export const OWNER_WORDS: Readonly<Record<string, string>> = Object.freeze({
  todo: "Added a to-do",
  assign: "Assigned a task",
  update: "Changed a task",
  comment: "Commented on a task",
  submit: "Sent a task for review",
  reminder: "Set a reminder",
  reminder_cancel: "Cancelled a reminder",
  complete: "Marked a task done",
  clock_in: "Clocked in",
  clock_out: "Clocked out",
  timer_start: "Started the timer",
  timer_pause: "Paused the timer",
  timer_resume: "Resumed the timer",
  timer_stop: "Stopped the timer",
  team: "Created a team",
  invite: "Sent an invitation",
  status: "Set the work status",
  plan: "Arranged the day",
  doc: "Saved a document",
  doc_update: "Changed a document",
});
/** A to-do the person made for someone else (copilot's create_todos passes it as its `logged`). */
export const OWNER_WORDS_TODO_FOR_SOMEONE = "Created a task for a teammate";
export const OWNER_WORDS_OTHER = "Did something they asked for";

/** The owner-visible words for a done line's kind (OWNER_WORDS), or "Did something they asked for". */
export function ownerWords(kind: string): string {
  return Object.hasOwn(OWNER_WORDS, kind) ? OWNER_WORDS[kind] : OWNER_WORDS_OTHER;
}

/** The model-facing words of the tainted-turn refusal (copilot.ts TAINT_ERROR), recognised in rows logged before this change. */
const TAINTED = /^Not done: you read other people's messages/;

/**
 * A row that did not go through, in the person's words: "Didn't add 2 to-dos: you had just read messages, so ask again",
 * "Couldn't clock you in: …". `error` is the tool's own words (left out for PRIVATE_TOOLS, which may list the person's
 * conversations); `tainted`: refused because she had just read other people's messages. `leadOnly` (review, 11 October
 * 2026): a look's refusal or failure, whose error may quote what she read from the picture, keeps only the lead words.
 */
export function problemSummary(tool: string, outcome: "refused" | "failed", error: string, opts: { input?: Record<string, unknown>; tainted?: boolean; leadOnly?: boolean } = {}): string {
  const lead = `${outcome === "failed" ? "Couldn't" : "Didn't"} ${attemptOf(tool, opts.input)}`;
  if (opts.tainted || TAINTED.test(error)) return `${lead}: you had just read messages, so ask again`;
  const why = error.replace(/\s+/g, " ").trim();
  if (PRIVATE_TOOLS.has(tool) || opts.leadOnly || !why) return lead;
  return `${lead}: ${why.length > 240 ? `${why.slice(0, 239).trimEnd()}…` : why}`;
}

/**
 * How a logged row reads. `personal`: the person's own Activity page, which shows the fuller words kept for them in the
 * detail; otherwise (Settings → Brenda, seen by owners and HR) the row's summary. A row that did not go through and was
 * logged before its words said what she tried (review, 8 October 2026) is put into the same words here.
 */
export function rowSummary(r: { tool: string; summary: string; outcome: string; personalSummary?: string | null }, personal: boolean): string {
  if (personal && r.personalSummary) return r.personalSummary;
  if ((r.outcome === "refused" || r.outcome === "failed") && !/^(?:Didn't|Couldn't) /.test(r.summary)) return problemSummary(r.tool, r.outcome, r.summary);
  return r.summary;
}

const LIMIT_DEFAULT = 30;
const LIMIT_MAX = 50;

/** `?kind=…&cursor=…&limit=…` on the Activity route: kind defaults to all, limit to 30 (1 to 50). */
export const activityQuerySchema: z.ZodType<{ kind: ActivityKind; cursor?: string; limit: number }> = z.object({
  kind: z.enum(ACTIVITY_KINDS).default("all"),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(LIMIT_MAX).default(LIMIT_DEFAULT),
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;

/**
 * The cursor is the last row's exact time (microseconds: two rows a microsecond apart must not share a page boundary)
 * and id, base64url-encoded. It means nothing outside this list.
 */
const encodeCursor = (at: string, id: string) => Buffer.from(`${at}|${id}`, "utf8").toString("base64url");
function decodeCursor(cursor: string): { at: string; id: string } {
  let text = "";
  try { text = Buffer.from(cursor, "base64url").toString("utf8"); } catch { /* checked below */ }
  const cut = text.lastIndexOf("|");
  const at = text.slice(0, cut);
  const id = text.slice(cut + 1);
  if (cut < 0 || !STAMP.test(at) || Number.isNaN(Date.parse(at)) || !UUID.test(id)) throw invalid("That page link is not valid.");
  return { at, id };
}

const KIND_SQL: Record<ActivityKind, string> = {
  all: "",
  actions: "AND a.source <> 'read' AND a.outcome IN ('done', 'confirmed')",
  reads: "AND a.source = 'read'",
  problems: "AND a.outcome IN ('refused', 'failed')",
  mac: "AND false",
};

type RequestActivityRow = { id: string; request_text: string; lane: string; outcome: string; summary: string | null; confirmed_via: ConfirmVia | null; job_title: string | null; created_at: string; stamp: string };

/** The outcome line of a request on the Mac (S.9): what she did, "Started a job: …", "You said no", "Undone". */
export function requestOutcomeWords(r: Pick<RequestActivityRow, "lane" | "outcome" | "summary" | "job_title">): string {
  if (r.outcome === "undone") return "Undone";
  if (r.outcome === "said_no") return "You said no";
  if (r.lane === "job" && r.job_title) return `Started a job: ${r.job_title}`;
  if (r.summary?.trim()) return r.summary.trim();
  switch (r.outcome) {
    case "pending": return "In progress";
    case "refused": return "Couldn't do that";
    case "failed": return "Couldn't finish";
    case "stopped": return "Stopped";
    default: return r.lane === "look" ? "Looked at your screen" : r.lane === "ask" ? "Asked what you meant" : "Done";
  }
}

/** A request on the person's Mac as an Activity row (contract N.3). */
export function requestActivityItem(r: Omit<RequestActivityRow, "stamp">, base: string): ActivityItem {
  return {
    id: `request:${r.id}`, tool: "mac_request", summary: requestOutcomeWords(r),
    outcome: r.outcome === "failed" ? "failed" : r.outcome === "refused" || r.outcome === "said_no" ? "refused" : "done",
    source: "mac", href: r.lane === "job" ? `${base}home/jobs` : null, createdAt: r.created_at,
    detail: { via: r.confirmed_via ?? null, live: r.outcome === "pending" }, asked: r.request_text,
  };
}

type TaskActivityRow = { id: string; kind: "screen" | "file" | "plan"; plan_text: string; summary: string | null; end_reason: EndReason | null; ended_at: string | null; confirmed_via: ConfirmVia | null; created_at: string; stamp: string };

/** A task on the person's Mac as an Activity row (phase 2; contract D.11). A plan (phase 3, contract D.6) is mac_plan. */
export function taskActivityItem(r: Omit<TaskActivityRow, "stamp">): ActivityItem {
  const live = !r.ended_at;
  return {
    id: `task:${r.id}`, tool: r.kind === "file" ? "mac_file" : r.kind === "plan" ? "mac_plan" : "mac_screen",
    summary: actSummary({ end_reason: live ? null : r.end_reason, plan: r.plan_text, summary: r.summary, live, kind: r.kind }),
    outcome: live ? "done" : actOutcome(r.end_reason), source: "mac", href: null, createdAt: r.created_at,
    detail: { via: r.confirmed_via ?? null, live },
  };
}

/** The person's own activity, newest first, paged by an opaque cursor. Always personal, whatever the role. */
export async function listActivity(ctx: OrgContext, opts: { kind?: ActivityKind; cursor?: string | null; limit?: number } = {}): Promise<ActivityPage> {
  const kind: ActivityKind = opts.kind && (ACTIVITY_KINDS as readonly string[]).includes(opts.kind) ? opts.kind : "all";
  const limit = Math.min(LIMIT_MAX, Math.max(1, Math.round(Number.isFinite(opts.limit) ? (opts.limit as number) : LIMIT_DEFAULT)));
  const after = opts.cursor ? decodeCursor(opts.cursor) : null;
  const readsHidden = !!ctx.user.impersonation;
  const base = `/app/${ctx.org.slug}/`;
  return retryWithout0037(() => withUser(ctx.user.profileId, async (db) => {
    const readsAvailable = await schema0037Ready(db);
    // Reads exist only once 0037 is applied, and are not shown while someone else is signed in as the person.
    if (kind === "reads" && (!readsAvailable || readsHidden)) return { items: [], nextCursor: null, readsAvailable, readsHidden };
    const params: unknown[] = [ctx.org.id, ctx.membership.id];
    // Changes the person made to her settings themself (tool 'settings': the organisation's Brenda settings, the workspace
    // assistant's look) stay in Settings → Brenda's log; they are not something their assistant did (review, 8 October 2026).
    // Connected apps (owner decisions, 22 October 2026): 'private' rows (what she did in the person's own apps) are hidden
    // while someone else is signed in as them, exactly as 'read' rows.
    let where = `a.organisation_id = $1 AND a.membership_id = $2 AND a.tool <> 'settings' ${KIND_SQL[kind]} ${readsHidden ? "AND a.source NOT IN ('read', 'private')" : ""}`;
    if (after) {
      params.push(after.at, after.id);
      where += ` AND (a.created_at, a.id) < ($3::timestamptz, $4::uuid)`;
    }
    params.push(limit + 1);
    const rows = await db.query<{ id: string; tool: string; summary: string; outcome: ActivityItem["outcome"]; source: ActivityItem["source"]; href: string | null; personal_summary: string | null; auto: boolean; created_at: string; stamp: string }>(
      `SELECT a.id, a.tool, a.summary, a.outcome, a.source, a.detail->>'href' AS href, a.detail->>'personalSummary' AS personal_summary,
              COALESCE((a.detail->>'auto') = 'true', false) AS auto, a.created_at,
              to_char(a.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || 'Z' AS stamp
       FROM brenda_actions a
       WHERE ${where}
       ORDER BY a.created_at DESC, a.id DESC LIMIT $${params.length}`, params);
    // Tasks on the person's Mac (phase 2, owner request 12 October 2026; contract D.11): theirs alone (row-level security),
    // never while someone else is signed in as them, nothing before 0058. Merged with her actions by time.
    let tasks: TaskActivityRow[] = [];
    if ((kind === "all" || kind === "mac") && !readsHidden && (await schema0058Ready(db))) {
      const tp: unknown[] = [ctx.org.id, ctx.membership.id];
      let tw = `t.organisation_id = $1 AND t.membership_id = $2`;
      if (after) { tp.push(after.at, after.id); tw += ` AND (t.created_at, t.id) < ($3::timestamptz, $4::uuid)`; }
      tp.push(limit + 1);
      tasks = await db.query<TaskActivityRow>(
        `SELECT t.id, t.kind, t.plan_text, t.summary, t.end_reason, t.ended_at, t.confirmed_via, t.created_at,
                to_char(t.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || 'Z' AS stamp
         FROM assistant_tasks t WHERE ${tw} AND t.kind <> 'job' ORDER BY t.created_at DESC, t.id DESC LIMIT $${tp.length}`, tp);
    }
    // Requests on the person's Mac (Brenda and her helpers, owner brief 12 October 2026; contract N.3): theirs alone, kept
    // 30 days, never while someone else is signed in as them, nothing before 0060. Jobs themselves are on the Jobs page.
    let requests: RequestActivityRow[] = [];
    if ((kind === "all" || kind === "mac") && !readsHidden && (await schema0060Ready(db))) {
      const rp: unknown[] = [ctx.org.id, ctx.membership.id];
      let rw = `q.organisation_id = $1 AND q.membership_id = $2`;
      if (after) { rp.push(after.at, after.id); rw += ` AND (q.created_at, q.id) < ($3::timestamptz, $4::uuid)`; }
      rp.push(limit + 1);
      requests = await db.query<RequestActivityRow>(
        `SELECT q.id, q.request_text, q.lane, q.outcome, q.summary, q.confirmed_via, t.job ->> 'title' AS job_title, q.created_at,
                to_char(q.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || 'Z' AS stamp
         FROM mac_requests q LEFT JOIN assistant_tasks t ON t.id = q.job_id
         WHERE ${rw} ORDER BY q.created_at DESC, q.id DESC LIMIT $${rp.length}`, rp);
    }
    type Merged = { at: string; id: string; item: () => ActivityItem };
    const merged: Merged[] = [
      ...rows.map((r): Merged => ({ at: r.stamp, id: r.id, item: () => ({
        id: r.id, tool: r.tool, summary: rowSummary({ ...r, personalSummary: r.personal_summary }, true), outcome: r.outcome, source: r.source,
        href: typeof r.href === "string" && r.href.startsWith(base) && !r.href.includes("//") ? r.href : null,
        createdAt: r.created_at,
        ...(r.auto ? { auto: true } : {}),
      }) })),
      ...tasks.map((r): Merged => ({ at: r.stamp, id: r.id, item: () => taskActivityItem(r) })),
      ...requests.map((r): Merged => ({ at: r.stamp, id: r.id, item: () => requestActivityItem(r, base) })),
    ].sort((x, y) => (x.at === y.at ? (x.id < y.id ? 1 : x.id > y.id ? -1 : 0) : x.at < y.at ? 1 : -1));
    const page = merged.slice(0, limit);
    const items: ActivityItem[] = page.map((m) => m.item());
    const last = page[page.length - 1];
    return { items, nextCursor: merged.length > limit && last ? encodeCursor(last.at, last.id) : null, readsAvailable, readsHidden };
  }));
}
