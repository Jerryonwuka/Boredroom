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

export const ACTIVITY_KINDS = ["all", "actions", "reads", "problems"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];
export type ActivityItem = {
  id: string; tool: string; summary: string;
  outcome: "done" | "confirmed" | "refused" | "failed";
  source: "chat" | "confirm" | "automatic" | "read";
  /** The page it is about (detail.href) when it is inside this workspace; else null. */
  href: string | null;
  createdAt: string;
  /** Done without a Confirm press because the person chose Act without asking (detail.auto; 8 October 2026). */
  auto?: boolean;
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
  "standup", "standup_action"]);

/** The model-facing words of the tainted-turn refusal (copilot.ts TAINT_ERROR), recognised in rows logged before this change. */
const TAINTED = /^Not done: you read other people's messages/;

/**
 * A row that did not go through, in the person's words: "Didn't add 2 to-dos: you had just read messages, so ask again",
 * "Couldn't clock you in: …". `error` is the tool's own words (left out for PRIVATE_TOOLS, which may list the person's
 * conversations); `tainted`: refused because she had just read other people's messages.
 */
export function problemSummary(tool: string, outcome: "refused" | "failed", error: string, opts: { input?: Record<string, unknown>; tainted?: boolean } = {}): string {
  const lead = `${outcome === "failed" ? "Couldn't" : "Didn't"} ${attemptOf(tool, opts.input)}`;
  if (opts.tainted || TAINTED.test(error)) return `${lead}: you had just read messages, so ask again`;
  const why = error.replace(/\s+/g, " ").trim();
  if (PRIVATE_TOOLS.has(tool) || !why) return lead;
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
};

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
    let where = `a.organisation_id = $1 AND a.membership_id = $2 AND a.tool <> 'settings' ${KIND_SQL[kind]} ${readsHidden ? "AND a.source <> 'read'" : ""}`;
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
    const page = rows.slice(0, limit);
    const items: ActivityItem[] = page.map((r) => ({
      id: r.id, tool: r.tool, summary: rowSummary({ ...r, personalSummary: r.personal_summary }, true), outcome: r.outcome, source: r.source,
      href: typeof r.href === "string" && r.href.startsWith(base) && !r.href.includes("//") ? r.href : null,
      createdAt: r.created_at,
      ...(r.auto ? { auto: true } : {}),
    }));
    const last = page[page.length - 1];
    return { items, nextCursor: rows.length > limit && last ? encodeCursor(last.stamp, last.id) : null, readsAvailable, readsHidden };
  }));
}
