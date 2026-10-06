/**
 * Brenda, the workspace agent (owner decision, 3 October 2026; spec "Brenda for Boredroom"): a conversation that gets
 * things done. It looks things up (the person's day, who is working
 * or clocked in, tasks and people by name) and it acts: adds to-dos, assigns tasks, clocks in and out, runs the
 * timer, sends messages, creates teams, invites people, sets the work status. Every action runs as the signed-in
 * person through the same services as the buttons do, so row-level security, role checks, audit entries and
 * notifications are exactly what a click would produce: the agent can do nothing the person could not.
 *
 * Round two (owner decision, 5 October 2026: "Brenda does the work for you"): she arranges the person's day, writes and
 * files documents (Docs), answers HR and policy questions from the organisation's real rules and shared documents and
 * never from guesses, and gives team leads and organisation accounts a summary of what got done.
 *
 * Engines: Claude with tools when a key is configured (Settings, AI assistant, or ANTHROPIC_API_KEY). Without one, a
 * built-in helper answers and only *offers* actions as buttons, since it cannot read intent well enough to act.
 */
import { z } from "zod";
import type { OrgContext } from "@/server/lib/api";
import { withUser, withSystem } from "@/server/db";
import { resolveAssistant, planBuiltin, matchPerson, type AssistantConnection } from "@/server/services/assistant";
import { assignableMembers, quickTodo, updateTask, completeTask, setDailyPlan } from "@/server/services/tasks";
import { myDay, teamStatus, tasksView, policyView } from "@/server/services/views";
import { myClock, attendanceBoard, clockIn, clockOut, scheduleFor } from "@/server/services/attendance";
import { currentSession, startSession, pauseSession, resumeSession, stopSession } from "@/server/services/sessions";
import { inbox, openDirect, peopleToMessage, sendMessage } from "@/server/services/messaging";
import { createTeam, createInvitation } from "@/server/services/orgs";
import { setMyPresence } from "@/server/services/profile";
import { searchWorkspace } from "@/server/services/search";
import { addComment } from "@/server/services/tasks";
import { submitTask } from "@/server/services/evidence";
import { briefing, createReminder, listReminders, cancelReminder, recordAction, brendaSettings } from "@/server/services/brenda";
import { listDocs, getDoc, createDoc, updateDoc, DOC_VISIBILITIES, type DocSummary, type DocVisibility } from "@/server/services/docs";
import { workSummary, SUMMARY_PERIODS, isSummaryPeriod } from "@/server/services/work-summary";
import { teamReportNow } from "@/server/services/daily-report";
import { signPayload, verifyPayload, sha256 } from "@/server/lib/crypto";
import { conflict, forbidden, invalid } from "@/server/lib/errors";
import { isPresence } from "@/lib/presence";
import { todayLocal, localParts, offsetAt } from "@/server/lib/time";

export const chatSchema = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(4000) })).min(1).max(30),
});

/** Something the agent did, shown as a done line with an optional link. */
export type Action = { kind: string; summary: string; href?: string };
/** Something offered as a button (the built-in helper, and page links from either engine). */
export type Proposal =
  | { kind: "todo"; title: string; description: string | null; dueAt: string | null; assigneeMembershipId: string | null; assigneeName: string | null; estimateMinutes: number | null }
  | { kind: "clock_in" } | { kind: "clock_out" }
  | { kind: "start_timer"; taskId: string; taskTitle: string }
  | { kind: "open"; href: string; label: string }
  /** A consequential action Brenda prepared; it runs only when the person presses Confirm (owner decision, 3 October 2026). */
  | { kind: "confirm"; token: string; summary: string; tool: string };

export type ChatResult = { reply: string; engine: "claude" | "builtin"; actions: Action[]; proposals: Proposal[]; note: string | null };

type Role = OrgContext["membership"]["role"];
type Page = { label: string; path: string; what: string; roles: Role[] };

const ALL: Role[] = ["owner", "hr", "manager", "employee"];
const ORG: Role[] = ["owner", "hr"];
const LEADS: Role[] = ["owner", "hr", "manager"];
const WORKERS: Role[] = ["manager", "employee"];

/** Every page, what it is for and who has it. The model uses this to point people to the right place. */
const PAGES: Page[] = [
  { label: "Dashboard", path: "/dashboard", what: "the organisation right now: attendance, who is working, delivery", roles: ORG },
  { label: "My Day", path: "/my-day", what: "your to-dos for today and the timer", roles: WORKERS },
  { label: "Clock in", path: "/clock", what: "clock in before work and out after; your attendance history", roles: WORKERS },
  { label: "Attendance", path: "/attendance", what: "who has clocked in today, who is late, the month view", roles: LEADS },
  { label: "Workroom", path: "/workroom", what: "who is working now, on what, for how long", roles: LEADS },
  { label: "Messages", path: "/messages", what: "channels per team, direct threads, ask for an update with the task attached", roles: ALL },
  { label: "Tasks", path: "/tasks", what: "every task: open, waiting for a check, done", roles: ALL },
  { label: "Docs", path: "/docs", what: "documents: notes, SOPs, meeting notes, reports, the handbook; private, for a team or for everyone", roles: ALL },
  { label: "People and teams", path: "/people", what: "join code, invitations, teams and their leads", roles: ORG },
  { label: "Reviews", path: "/reviews", what: "submitted work, time corrections and capture exceptions waiting for a decision", roles: LEADS },
  { label: "Recordings", path: "/recordings", what: "screen recordings, playback grants", roles: LEADS },
  { label: "Timesheets", path: "/timesheets", what: "confirmed hours per day, corrections, CSV export", roles: ALL },
  { label: "Projects", path: "/projects", what: "projects and their members", roles: LEADS },
  { label: "Settings", path: "/settings", what: "working hours, recording rules and the monitoring notice, AI assistant, grants", roles: ORG },
  { label: "Audit", path: "/audit", what: "who did what and when", roles: ORG },
  { label: "Notifications", path: "/notifications", what: "assignments, review requests and decisions", roles: ALL },
  { label: "Your profile", path: "/profile", what: "your picture, name, title, status; Recording and privacy: the monitoring notice in full and whether you agreed to it", roles: ALL },
];

function pagesFor(role: Role) { return PAGES.filter((p) => p.roles.includes(role)); }

export async function chat(ctx: OrgContext, input: z.infer<typeof chatSchema>): Promise<ChatResult> {
  const conn = await resolveAssistant(ctx.org.id);
  if (conn) {
    try { return await chatWithClaude(ctx, conn, input.messages); }
    catch (err) { const r = await chatBuiltin(ctx, input.messages); return { ...r, note: `Claude could not be reached (${describeError(err)}); the built-in helper answered instead.` }; }
  }
  return chatBuiltin(ctx, input.messages);
}

function describeError(err: unknown): string {
  const e = err as { status?: number; message?: string };
  if (e?.status === 401) return "the API key was rejected";
  if (e?.status === 429) return "rate limit or credit limit reached";
  if (e?.status === 404) return "the configured model was not found";
  if (/credit balance/i.test(e?.message ?? "")) return "the Anthropic account has run out of credits; add credits at console.anthropic.com";
  return (e?.message ?? String(err)).slice(0, 140);
}

// ---- Tools --------------------------------------------------------------------

type Person = { membership_id: string; display_name: string; role: string; teams: string | null };
type ToolCtx = { ctx: OrgContext; base: string; actions: Action[]; proposals: Proposal[]; people: Person[]; mode: "chat" | "confirm" };

/**
 * When Brenda acts at once and when she asks (spec section 8). Reading, the person's own clock, timer, to-dos, status,
 * comments, progress and reminders are low-risk and reversible: she just does them. Anything that lands on someone
 * else, goes out to a group, or sends an email waits for a Confirm press: assigning or reassigning work, creating a
 * task for someone else, changing a task the person does not hold, submitting for review, messaging a team or
 * everyone, creating a team, inviting someone, changing someone else's document, sharing a document with everyone.
 *
 * The prepared action travels inside the signed token, and the confirm endpoint accepts tokens of up to 8,000
 * characters; anything longer is refused here, before a Confirm button is shown that could not work.
 */
const CONFIRM_TTL = 15 * 60;
const CONFIRM_TOKEN_MAX = 8000;
function askFirst(t: ToolCtx, tool: string, input: Record<string, unknown>, summary: string) {
  const token = signPayload({ k: "brenda", o: t.ctx.org.id, m: t.ctx.membership.id, tool, input }, CONFIRM_TTL);
  if (token.length > CONFIRM_TOKEN_MAX) return { error: "That is too long to prepare for a Confirm button. Make it shorter, or do it on the page itself (offer the link)." };
  t.proposals.push({ kind: "confirm", token, summary, tool });
  return { needsConfirmation: true, summary, note: "Not done yet. A Confirm button is shown to the person; tell them what will happen and that it runs when they confirm." };
}

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object" as const, properties, required });
const str = (description: string) => ({ type: "string", description });

const TOOLS = [
  // Reading
  { name: "get_my_day", description: "The person's own day: clock status, running timer, planned to-dos, other assigned work, what they finished today and hours so far. Staff and team leads only.", input_schema: obj({}) },
  { name: "get_team_status", description: "Who is working right now, on what, and their open and blocked tasks. Team leads see their teams; organisation accounts see everyone.", input_schema: obj({}) },
  { name: "get_attendance", description: "Who has clocked in today, who is late and who has not clocked in. Team leads and organisation accounts.", input_schema: obj({}) },
  { name: "list_people", description: "Everyone in the organisation with their id, role and teams. Use it to resolve a name before assigning, messaging or inviting.", input_schema: obj({}) },
  { name: "list_tasks", description: "Tasks the person can see, with ids, status, assignee and due date. Staff see their own; leads their team's; organisation accounts everyone's.", input_schema: obj({ status: { type: "string", enum: ["open", "check", "done", "all"], description: "open by default" } }) },
  { name: "search", description: "Find tasks, people, projects and teams by name.", input_schema: obj({ q: str("Words from the name") }, ["q"]) },
  // Acting
  { name: "get_briefing", description: "What is waiting for the person today, from real data: clock and timer, tasks due today and tomorrow, overdue tasks, their work waiting for someone's check, work waiting for their review, assignments they handed out that nobody picked up, and reminders due today. Use it for 'what's waiting for me', 'what should I work on', 'what did I get done' style questions.", input_schema: obj({}) },
  { name: "get_task", description: "One task in full: details, assignee, reviewer, due date, estimate, tracked time, progress, latest comments and status history.", input_schema: obj({ taskId: str("Task id") }, ["taskId"]) },
  { name: "create_todos", description: "Create tasks. With no assignee they are the person's own to-dos (staff and team leads). A team lead or organisation account may name an assignee (exact name from list_people); a task for someone else waits for the person to confirm. Returns what was created or prepared.", input_schema: obj({ items: { type: "array", items: obj({ title: str("Short imperative title, at most 120 characters"), description: str("Detail, or omit"), due: str("ISO 8601 with offset, or omit"), assignee: str("Exact team member name, or omit"), estimateMinutes: { type: "integer" } }, ["title"]) } }, ["items"]) },
  { name: "assign_task", description: "Hand an existing task to someone (team leads and organisation accounts, within their scope). Use a task id from list_tasks or search and a membership id from list_people. Waits for confirmation.", input_schema: obj({ taskId: str("Task id"), assigneeMembershipId: str("Membership id of the new assignee") }, ["taskId", "assigneeMembershipId"]) },
  { name: "update_task", description: "Change a task: title, details, due date, estimate, priority, status (todo, in_progress, or blocked with a reason) or progress percentage. Changes to a task the person does not hold wait for confirmation.", input_schema: obj({ taskId: str("Task id"), title: str("New title, or omit"), details: str("What a finished result looks like, or omit"), due: str("ISO 8601 with offset, 'none' to clear, or omit"), estimateMinutes: { type: "integer" }, priority: { type: "string", enum: ["low", "normal", "high", "urgent"] }, status: { type: "string", enum: ["todo", "in_progress", "blocked"] }, reason: str("Required when blocking"), progressPercent: { type: "integer", minimum: 0, maximum: 100 } }, ["taskId"]) },
  { name: "add_comment", description: "Add a comment to a task's discussion; the assignee and reviewer are notified.", input_schema: obj({ taskId: str("Task id"), body: str("The comment") }, ["taskId", "body"]) },
  { name: "submit_for_review", description: "Send one of the person's own tasks for review with a progress note (no files; files are attached on the task page). Waits for confirmation.", input_schema: obj({ taskId: str("Task id"), note: str("What was delivered and where to look") }, ["taskId", "note"]) },
  { name: "remind_me", description: "Set a personal reminder delivered as a notification at the given time, optionally about a task.", input_schema: obj({ body: str("What to remind them of, e.g. 'Call Josh'"), at: str("ISO 8601 with offset"), taskId: str("Task id, or omit") }, ["body", "at"]) },
  { name: "list_reminders", description: "The person's upcoming reminders.", input_schema: obj({}) },
  { name: "cancel_reminder", description: "Cancel one of the person's reminders by id (from list_reminders).", input_schema: obj({ reminderId: str("Reminder id") }, ["reminderId"]) },
  { name: "complete_task", description: "Mark one of the person's own tasks done (it goes to their team lead for a check when one exists).", input_schema: obj({ taskId: str("Task id"), note: str("What was done, or omit") }, ["taskId"]) },
  { name: "clock", description: "Clock the person in or out. Staff and team leads only.", input_schema: obj({ direction: { type: "string", enum: ["in", "out"] } }, ["direction"]) },
  { name: "timer", description: "Run the person's timer: start on one of their tasks, pause, resume, or stop (with an outcome). Staff and team leads only.", input_schema: obj({ action: { type: "string", enum: ["start", "pause", "resume", "stop"] }, taskId: str("For start: the task id"), outcome: { type: "string", enum: ["continue_later", "blocked", "ready_for_review", "completed"], description: "For stop; continue_later by default" }, note: str("For stop, or omit") }, ["action"]) },
  { name: "send_message", description: "Send a message as the person: to someone by name (a direct thread, sent at once), to a team channel by team name, or to everyone. Use it whenever they say 'message X', 'tell X', 'ping X', 'let X know' or 'ask X'; the words after the name (often after a colon) are the message. Optionally attach a task by id.", input_schema: obj({ to: str("A person's exact name, a team name, or 'everyone'"), body: str("The message"), taskId: str("Task id to attach, or omit") }, ["to", "body"]) },
  { name: "create_team", description: "Create a team (organisation accounts only).", input_schema: obj({ name: str("Team name") }, ["name"]) },
  { name: "invite_person", description: "Invite someone by email; they get an invitation email (organisation accounts only; waits for confirmation). role: employee (staff) or manager (team lead); team by exact name, optional.", input_schema: obj({ email: str("Email address"), role: { type: "string", enum: ["employee", "manager", "hr"] }, team: str("Exact team name, or omit") }, ["email", "role"]) },
  { name: "set_status", description: "Set the person's own work status.", input_schema: obj({ presence: { type: "string", enum: ["active", "away", "busy", "offline"] } }, ["presence"]) },
  { name: "plan_day", description: "Set the order of the person's My Day list for today: their own open task ids, first to last (tasks left out drop off today's plan but stay assigned). Staff and team leads only.", input_schema: obj({ taskIds: { type: "array", items: { type: "string" }, description: "Task ids in the order to work on them" } }, ["taskIds"]) },
  // Documents
  { name: "list_docs", description: "Documents the person can read (their own, their team's and the organisation's, such as a handbook, SOPs or meeting notes), newest first, or the best matches for q. Returns ids, titles, folders, who can read each and a short excerpt; read_doc gives the text.", input_schema: obj({ q: str("Words to search titles and text for, or omit to list"), folder: str("A folder name to narrow to, or omit") }) },
  { name: "read_doc", description: "One document's text (markdown) by id from list_docs.", input_schema: obj({ docId: str("Document id") }, ["docId"]) },
  { name: "create_doc", description: "Write and save a new document as the person: a note, SOP, report, meeting notes, a policy draft. body is the whole document in markdown. Private unless they ask to share. 'team' shares it with one team (exact name, or the person's own team when they are on one). 'organisation' lets everyone read it: it is saved as a private draft at once and shared with everyone when the person confirms. Returns the path for open_page.", input_schema: obj({ title: str("Title, at most 200 characters"), body: str("The document in markdown"), folder: str("Folder such as 'Meeting notes' or 'SOPs', or omit"), visibility: { type: "string", enum: [...DOC_VISIBILITIES], description: "private by default" }, team: str("Exact team name when visibility is team, or omit") }, ["title", "body"]) },
  { name: "update_doc", description: "Change a document by id: a new title, new text (body replaces it all) or text added to the end (append), a folder ('none' takes it out of its folder), or who can read it. The person's own document changes at once; someone else's (owner and HR only), or sharing with the whole organisation, waits for confirmation.", input_schema: obj({ docId: str("Document id"), title: str("New title, or omit"), body: str("Markdown replacing the whole text, or omit"), append: str("Markdown to add at the end, or omit"), folder: str("Folder name, 'none', or omit"), visibility: { type: "string", enum: [...DOC_VISIBILITIES] }, team: str("Exact team name when visibility is team, or omit") }, ["docId"]) },
  // HR and management
  { name: "get_policy", description: "The organisation's rules from real data: working days and hours, the grace period before someone counts as late, the time zone, the current monitoring notice (what is recorded, the recording mode, how long recordings are kept) and whether the person has agreed to screen recording (asked once, the first time they start a recorded session), what Brenda may do automatically, and who the owner and HR are. Rules not held here (leave, pay, conduct, benefits) may be in an organisation document: search list_docs.", input_schema: obj({}) },
  { name: "work_summary", description: "What got done in a period, per person: hours tracked, tasks completed, tasks sent for review, open, blocked and overdue tasks, days clocked in and days late. Team leads see themselves and their teams, organisation accounts everyone who holds work, staff only themselves.", input_schema: obj({ period: { type: "string", enum: [...SUMMARY_PERIODS], description: "today; week (Monday to today); month (the 1st to today); last_week; last_month" }, person: str("Exact name from list_people to narrow to one person, or omit") }, ["period"]) },
  { name: "team_report", description: "Today's end-of-day team report, written now from real data and saved privately to the person's Docs (folder Daily reports): per person, confirmed hours, what they finished and sent for review, what is in progress, anything overdue or blocked, attendance, and what needs their attention. Returns the headline and the path for open_page; once today's end-of-day report has gone out, returns that one. Team leads get their teams, the owner and HR the whole organisation; staff are refused.", input_schema: obj({}) },
  { name: "open_page", description: "Offer a link to a page (a path from the page list, a document path such as /docs/<id>, or a task, person, project or team href from search).", input_schema: obj({ path: str("Path such as /tasks or /tasks/<id>"), label: str("Link text") }, ["path", "label"]) },
];

const uuid = (v: unknown) => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
/** Who can read a document, in words. */
const audience = (d: DocSummary) => d.visibility === "organisation" ? "everyone" : d.visibility === "team" ? `the ${d.teamName ?? ""} team`.replace("  ", " ") : "only the writer";

async function runTool(t: ToolCtx, name: string, input: Record<string, unknown>): Promise<unknown> {
  const { ctx, base } = t;
  const role = ctx.membership.role;
  const people = async () => { if (!t.people.length) t.people = await peopleToMessage(ctx); return t.people; };
  const done = (kind: string, summary: string, href?: string) => { t.actions.push({ kind, summary, href }); void recordAction(ctx, { tool: name, summary, outcome: t.mode === "confirm" ? "confirmed" : "done", source: t.mode === "confirm" ? "confirm" : "chat", detail: { href } }); return { done: true, summary }; };
  const confirmMode = t.mode === "confirm";
  // A team by its exact name; with no name, the person's own team when they are on exactly one.
  const teamNamed = async (wanted: unknown): Promise<{ id: string; name: string } | { error: string }> => {
    const teams = await withUser(ctx.user.profileId, (db) => db.query<{ id: string; name: string; mine: boolean }>(
      `SELECT t.id, t.name, EXISTS (SELECT 1 FROM team_members tm WHERE tm.team_id = t.id AND tm.membership_id = $2) AS mine FROM teams t WHERE t.organisation_id = $1 AND t.archived_at IS NULL ORDER BY t.name`, [ctx.org.id, ctx.membership.id]));
    const n = typeof wanted === "string" ? wanted.trim().toLowerCase() : "";
    const mine = teams.filter((x) => x.mine);
    const hit = n ? teams.find((x) => x.name.toLowerCase() === n) : mine.length === 1 ? mine[0] : undefined;
    if (hit) return { id: hit.id, name: hit.name };
    return { error: `${n ? `No team called "${String(wanted).trim()}".` : "Which team should see it?"} Teams: ${teams.map((x) => x.name).join(", ") || "none yet"}.` };
  };
  switch (name) {
    case "get_my_day": {
      if (!WORKERS.includes(role)) return { error: "Organisation accounts have no day of their own; use get_team_status or get_attendance." };
      const [d, c] = await Promise.all([myDay(ctx), myClock(ctx)]);
      const row = (x: { id: string; title: string; status: string; priority: string; due_at: string | null; estimate_minutes: number | null; project_name: string; tracked_seconds: number }) => ({ id: x.id, title: x.title, status: x.status, priority: x.priority, due: x.due_at, estimateMinutes: x.estimate_minutes, project: x.project_name, trackedSeconds: x.tracked_seconds });
      return { today: d.today, clock: c.status, workingDay: c.workingDay, workStarts: c.schedule.start_local, workEnds: c.schedule.end_local, timerRunning: c.timerOpen, hoursSoFarSeconds: d.todaySeconds, planned: d.planned.map(row), ownTodos: d.ownTodos.map(row), fromLeads: d.fromLeads.map(row), overdue: d.overdue.map(row), doneToday: d.doneToday.map((x) => x.title) };
    }
    case "get_team_status": {
      if (role === "employee") return { error: "Staff cannot see other people's activity." };
      const s = await teamStatus(ctx);
      return { now: s.serverNow, people: s.rows.map((r) => ({ membershipId: r.membership_id, name: r.display_name, teams: r.teams, working: r.session_state ? { state: r.session_state, task: r.task_title, since: r.started_at } : null, todaySeconds: r.today_seconds, openTasks: r.open_tasks, blockedTasks: r.blocked_tasks, inReview: r.in_review_tasks })) };
    }
    case "get_attendance": {
      if (role === "employee") return { error: "Staff see only their own clock (get_my_day)." };
      const a = await attendanceBoard(ctx);
      return { today: a.today, counts: a.counts, people: a.people.map((p) => ({ membershipId: p.membership_id, name: p.display_name, teams: p.teams, clockedInAt: p.clock_in_at, clockedOutAt: p.clock_out_at, lateSeconds: p.late_seconds })) };
    }
    case "list_people": {
      const ps = await people();
      return { you: { membershipId: ctx.membership.id, name: ctx.user.displayName, role }, people: ps.map((p) => ({ membershipId: p.membership_id, name: p.display_name, role: p.role, teams: p.teams })) };
    }
    case "list_tasks": {
      const status = ["open", "check", "done", "all"].includes(String(input.status)) ? (input.status as "open" | "check" | "done" | "all") : "open";
      const v = await tasksView(ctx, { status });
      return { tasks: v.tasks.slice(0, 60).map((x) => ({ id: x.id, title: x.title, status: x.status, assignee: x.assignee_name, assigneeMembershipId: x.assignee_membership_id, due: x.due_at, project: x.project_name })) };
    }
    case "search": {
      const r = await searchWorkspace(ctx, String(input.q ?? "").slice(0, 120) || " ");
      return { hits: r.hits.map((h) => ({ kind: h.kind, id: h.id, title: h.title, hint: h.hint, href: h.href.replace(base, "") })) };
    }
    case "get_briefing": return briefing(ctx);
    case "get_task": {
      const taskId = uuid(input.taskId); if (!taskId) return { error: "taskId must be a task id." };
      const { taskDetail } = await import("@/server/services/views");
      const d = await taskDetail(ctx, taskId);
      if (!d) return { error: "That task is not visible to you." };
      const x = d.task;
      return { id: x.id, title: x.title, details: x.expected_output, status: x.status, priority: x.priority, project: x.project_name, assignee: x.assignee_name, assigneeMembershipId: x.assignee_membership_id, reviewer: x.reviewer_name, createdBy: x.created_by_name, due: x.due_at, estimateMinutes: x.estimate_minutes, trackedSeconds: x.tracked_seconds, progressPercent: x.progress_percent, blockedReason: x.blocked_reason, comments: d.comments.slice(-6).map((c) => ({ by: c.author_name, at: c.created_at, body: c.body })), history: d.history.slice(-6).map((h) => ({ from: h.from_status, to: h.to_status, by: h.actor_name, at: h.occurred_at, reason: h.reason })) };
    }
    case "create_todos": {
      const items = Array.isArray(input.items) ? (input.items as Record<string, unknown>[]).slice(0, 15) : [];
      const isOrg = ORG.includes(role);
      const pool = role === "employee" ? [] : (await assignableMembers(ctx)).map((p) => ({ id: p.id, display_name: p.display_name }));
      const plan: { title: string; description: string | null; due: string | null; est: number | null; person: { id: string; display_name: string } | null }[] = [];
      for (const it of items) {
        const title = String(it.title ?? "").trim().slice(0, 200);
        if (!title) continue;
        let person: { id: string; display_name: string } | null = null;
        if (it.assignee) {
          if (role === "employee") return { error: "Staff add to-dos for themselves only; ask your team lead to hand work to someone else." };
          person = matchPerson(String(it.assignee), pool);
          if (!person) return { error: `"${it.assignee}" is not someone you can assign to. People: ${pool.map((p) => p.display_name).join(", ") || "nobody yet"}.` };
        } else if (isOrg) return { error: "Organisation accounts hand tasks to someone; name who it is for." };
        const due = typeof it.due === "string" && !Number.isNaN(Date.parse(it.due)) ? new Date(it.due).toISOString() : null;
        const est = typeof it.estimateMinutes === "number" && it.estimateMinutes > 0 ? Math.round(it.estimateMinutes) : null;
        plan.push({ title, description: typeof it.description === "string" && it.description.trim() ? it.description.trim().slice(0, 4000) : null, due, est, person });
      }
      if (!plan.length) return { error: "Give each to-do a title." };
      const forOthers = plan.filter((p) => p.person);
      if (forOthers.length && !confirmMode) {
        return askFirst(t, name, input, plan.length === 1 ? `Create “${plan[0].title}” for ${plan[0].person?.display_name ?? "you"}${plan[0].due ? `, due ${new Date(plan[0].due).toLocaleString("en-GB", { timeZone: ctx.org.timezone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}` : `Create ${plan.length} tasks: ${plan.map((p) => `${p.title}${p.person ? ` (${p.person.display_name})` : ""}`).join("; ")}`);
      }
      const created: { id: string; title: string; assignee: string | null }[] = [];
      for (const p of plan) {
        const r = await quickTodo(ctx, { title: p.title, description: p.description, dueAt: p.due, assigneeMembershipId: p.person?.id ?? null, estimateMinutes: p.est });
        const id = (r as { id?: string }).id ?? "";
        created.push({ id, title: p.title, assignee: p.person?.display_name ?? null });
        done("todo", `${p.person ? "Created" : "Added to-do"}: ${p.title}${p.person ? ` for ${p.person.display_name}` : ""}`, id ? `${base}/tasks/${id}` : undefined);
      }
      return { created };
    }
    case "assign_task": {
      const taskId = uuid(input.taskId), to = uuid(input.assigneeMembershipId);
      if (!taskId || !to) return { error: "taskId and assigneeMembershipId must be ids from list_tasks and list_people." };
      const task = await withUser(ctx.user.profileId, (db) => db.maybeOne<{ version: number; title: string }>(`SELECT version, title FROM tasks WHERE id = $1 AND organisation_id = $2`, [taskId, ctx.org.id]));
      if (!task) return { error: "That task is not visible to you." };
      const who = (await people()).find((p) => p.membership_id === to);
      if (!confirmMode) return askFirst(t, name, input, `Assign “${task.title}” to ${who?.display_name ?? "them"}`);
      await updateTask(ctx, taskId, { expectedVersion: task.version, assigneeMembershipId: to });
      return done("assign", `Assigned "${task.title}" to ${who?.display_name ?? "them"}`, `${base}/tasks/${taskId}`);
    }
    case "update_task": {
      const taskId = uuid(input.taskId); if (!taskId) return { error: "taskId must be a task id." };
      const task = await withUser(ctx.user.profileId, (db) => db.maybeOne<{ version: number; title: string; assignee_membership_id: string }>(`SELECT version, title, assignee_membership_id FROM tasks WHERE id = $1 AND organisation_id = $2`, [taskId, ctx.org.id]));
      if (!task) return { error: "That task is not visible to you." };
      const patch: Record<string, unknown> = {};
      const changes: string[] = [];
      if (typeof input.title === "string" && input.title.trim()) { patch.title = input.title.trim().slice(0, 200); changes.push(`title to “${patch.title}”`); }
      if (typeof input.details === "string" && input.details.trim()) { patch.expectedOutput = input.details.trim().slice(0, 4000); changes.push("details"); }
      if (input.due === "none") { patch.dueAt = null; changes.push("no due date"); }
      else if (typeof input.due === "string" && !Number.isNaN(Date.parse(input.due))) { patch.dueAt = new Date(input.due).toISOString(); changes.push(`due ${new Date(input.due).toLocaleString("en-GB", { timeZone: ctx.org.timezone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`); }
      if (typeof input.estimateMinutes === "number" && input.estimateMinutes > 0) { patch.estimateMinutes = Math.round(input.estimateMinutes); changes.push(`estimate ${Math.round(input.estimateMinutes)} min`); }
      if (["low", "normal", "high", "urgent"].includes(String(input.priority))) { patch.priority = input.priority; changes.push(`priority ${input.priority}`); }
      if (["todo", "in_progress", "blocked"].includes(String(input.status))) { patch.status = input.status; if (input.reason) patch.reason = String(input.reason).slice(0, 2000); changes.push(`status ${String(input.status).replace("_", " ")}`); }
      if (typeof input.progressPercent === "number") { patch.progressPercent = Math.max(0, Math.min(100, Math.round(input.progressPercent))); changes.push(`${patch.progressPercent}% done`); }
      if (!changes.length) return { error: "Say what to change." };
      const summary = `Update “${task.title}”: ${changes.join(", ")}`;
      if (task.assignee_membership_id !== ctx.membership.id && !confirmMode) return askFirst(t, name, input, summary);
      await updateTask(ctx, taskId, { expectedVersion: task.version, ...patch } as Parameters<typeof updateTask>[2]);
      return done("update", summary.replace(/^Update/, "Updated"), `${base}/tasks/${taskId}`);
    }
    case "add_comment": {
      const taskId = uuid(input.taskId); const body = String(input.body ?? "").trim().slice(0, 4000);
      if (!taskId || !body) return { error: "taskId and body are required." };
      await addComment(ctx, taskId, body);
      return done("comment", `Commented: “${body.length > 80 ? `${body.slice(0, 77)}…` : body}”`, `${base}/tasks/${taskId}`);
    }
    case "submit_for_review": {
      const taskId = uuid(input.taskId); const note = String(input.note ?? "").trim().slice(0, 4000);
      if (!taskId) return { error: "taskId must be a task id." };
      const task = await withUser(ctx.user.profileId, (db) => db.maybeOne<{ title: string; assignee_membership_id: string; reviewer_name: string | null }>(`SELECT t.title, t.assignee_membership_id, pr.display_name AS reviewer_name FROM tasks t LEFT JOIN memberships mr ON mr.id = t.reviewer_membership_id LEFT JOIN profiles pr ON pr.id = mr.user_id WHERE t.id = $1 AND t.organisation_id = $2`, [taskId, ctx.org.id]));
      if (!task) return { error: "That task is not visible to you." };
      if (task.assignee_membership_id !== ctx.membership.id) return { error: "Only the person holding a task submits it for review." };
      if (!confirmMode) return askFirst(t, name, input, `Send “${task.title}” for review${task.reviewer_name ? ` to ${task.reviewer_name}` : ""}${note ? ` with the note “${note.length > 60 ? `${note.slice(0, 57)}…` : note}”` : ""}`);
      await submitTask(ctx, taskId, { note, links: [], fileIds: [] });
      return done("submit", `Sent “${task.title}” for review`, `${base}/tasks/${taskId}`);
    }
    case "remind_me": {
      const body = String(input.body ?? "").trim().slice(0, 500);
      if (!body || typeof input.at !== "string" || Number.isNaN(Date.parse(input.at))) return { error: "body and at (ISO 8601 with offset) are required." };
      const r = await createReminder(ctx, { body, remindAt: new Date(input.at).toISOString(), taskId: uuid(input.taskId) });
      return done("reminder", `Reminder set for ${new Date(r.remind_at).toLocaleString("en-GB", { timeZone: ctx.org.timezone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}: ${body}`, `${base}/notifications`);
    }
    case "list_reminders": return { reminders: (await listReminders(ctx)).map((r) => ({ id: r.id, body: r.body, at: r.remind_at, taskId: r.task_id })) };
    case "cancel_reminder": {
      const id = uuid(input.reminderId); if (!id) return { error: "reminderId must be an id from list_reminders." };
      const r = await cancelReminder(ctx, id);
      return done("reminder_cancel", `Cancelled the reminder: ${r.body}`);
    }
    case "complete_task": {
      const taskId = uuid(input.taskId);
      if (!taskId) return { error: "taskId must be a task id." };
      const before = await withUser(ctx.user.profileId, (db) => db.maybeOne<{ title: string }>(`SELECT title FROM tasks WHERE id = $1 AND organisation_id = $2`, [taskId, ctx.org.id]));
      const r = await completeTask(ctx, taskId, { note: String(input.note ?? "").slice(0, 2000) });
      const title = (r as { title?: string }).title ?? before?.title;
      return done("complete", `Marked done${title ? `: ${title}` : ""}`, `${base}/tasks/${taskId}`);
    }
    case "clock": {
      if (!WORKERS.includes(role)) return { error: "Organisation accounts do not clock in." };
      if (input.direction === "out") { await clockOut(ctx); return done("clock_out", "Clocked out", `${base}/clock`); }
      await clockIn(ctx); return done("clock_in", "Clocked in", `${base}/clock`);
    }
    case "timer": {
      if (!WORKERS.includes(role)) return { error: "Organisation accounts have no timers." };
      const cur = await currentSession(ctx);
      const s = cur.session;
      if (input.action === "start") {
        const taskId = uuid(input.taskId); if (!taskId) return { error: "taskId must be one of the person's task ids." };
        if (s) return { error: `A timer is already running on "${s.taskTitle}". Stop or pause it first.` };
        await startSession(ctx, { taskId, captureMode: "none" });
        return done("timer_start", "Started the timer", `${base}/my-day`);
      }
      if (!s) return { error: "No timer is running." };
      if (input.action === "pause") { await pauseSession(ctx, s.id, s.version); return done("timer_pause", `Paused the timer on "${s.taskTitle}"`, `${base}/my-day`); }
      if (input.action === "resume") { await resumeSession(ctx, s.id, s.version); return done("timer_resume", `Resumed the timer on "${s.taskTitle}"`, `${base}/my-day`); }
      const outcome = ["continue_later", "blocked", "ready_for_review", "completed"].includes(String(input.outcome)) ? (input.outcome as "continue_later" | "blocked" | "ready_for_review" | "completed") : "continue_later";
      await stopSession(ctx, s.id, { expectedVersion: s.version, outcome, note: String(input.note ?? "").slice(0, 2000) });
      return done("timer_stop", `Stopped the timer on "${s.taskTitle}" (${outcome.replace(/_/g, " ")})`, `${base}/my-day`);
    }
    case "send_message": {
      const to = String(input.to ?? "").trim(), body = String(input.body ?? "").trim().slice(0, 4000);
      if (!to || !body) return { error: "to and body are required." };
      const taskId = uuid(input.taskId);
      let conversationId: string | null = null, label = to;
      if (/^(everyone|all|organisation|organization)$/i.test(to)) { conversationId = (await inbox(ctx)).channels.find((c) => c.kind === "organisation")?.id ?? null; label = "everyone"; }
      else {
        const box = await inbox(ctx);
        const channel = box.channels.find((c) => c.kind === "team" && c.title.toLowerCase() === to.toLowerCase());
        if (channel) { conversationId = channel.id; label = `#${channel.title}`; }
        else {
          const person = matchPerson(to, (await people()).map((p) => ({ id: p.membership_id, display_name: p.display_name })));
          if (!person) return { error: `Nobody called "${to}". People: ${(await people()).map((p) => p.display_name).join(", ")}.` };
          conversationId = await openDirect(ctx, person.id); label = person.display_name;
        }
      }
      if (!conversationId) return { error: "That conversation could not be opened." };
      if (label === "everyone" || label.startsWith("#")) { if (!confirmMode) return askFirst(t, name, input, `Message ${label === "everyone" ? "everyone" : label}: “${body.length > 80 ? `${body.slice(0, 77)}…` : body}”`); }
      await sendMessage(ctx, { conversationId, body, taskId });
      return done("message", `Sent to ${label}: “${body.length > 80 ? `${body.slice(0, 77)}…` : body}”`, `${base}/messages?c=${conversationId}`);
    }
    case "create_team": {
      if (!ORG.includes(role)) return { error: "Only organisation accounts create teams." };
      const teamName = String(input.name ?? "").trim().slice(0, 120); if (!teamName) return { error: "A team needs a name." };
      if (!confirmMode) return askFirst(t, name, input, `Create the team ${teamName}`);
      const r = await createTeam(ctx, teamName);
      const id = (r as { id?: string }).id;
      return done("team", `Created the team ${teamName}`, id ? `${base}/teams/${id}` : `${base}/people?tab=teams`);
    }
    case "invite_person": {
      if (!ORG.includes(role)) return { error: "Only organisation accounts invite people." };
      const email = String(input.email ?? "").trim().toLowerCase();
      const r = ["employee", "manager", "hr"].includes(String(input.role)) ? (input.role as "employee" | "manager" | "hr") : "employee";
      let teamId: string | null = null;
      if (input.team) {
        const teams = await withUser(ctx.user.profileId, (db) => db.query<{ id: string; name: string }>(`SELECT id, name FROM teams WHERE organisation_id = $1 AND archived_at IS NULL`, [ctx.org.id]));
        const team = teams.find((x) => x.name.toLowerCase() === String(input.team).trim().toLowerCase());
        if (!team) return { error: `No team called "${input.team}". Teams: ${teams.map((x) => x.name).join(", ") || "none yet"}.` };
        teamId = team.id;
      }
      if (!confirmMode) return askFirst(t, name, input, `Invite ${email} as ${r === "manager" ? "team lead" : r === "hr" ? "HR administrator" : "staff"}${input.team ? ` in ${input.team}` : ""} (sends an email)`);
      await createInvitation(ctx, { email, role: r, teamId }, { send: true });
      return done("invite", `Invited ${email} as ${r === "manager" ? "team lead" : r === "hr" ? "HR administrator" : "staff"}${input.team ? ` in ${input.team}` : ""}; the email is on its way`, `${base}/people?tab=invitations`);
    }
    case "set_status": {
      if (!isPresence(input.presence)) return { error: "presence must be active, away, busy or offline." };
      await setMyPresence(ctx.user, input.presence);
      return done("status", `Status set to ${input.presence === "busy" ? "do not disturb" : input.presence}`);
    }
    case "plan_day": {
      if (!WORKERS.includes(role)) return { error: "Organisation accounts have no day plan." };
      const ids = Array.isArray(input.taskIds) ? [...new Set((input.taskIds as unknown[]).map(uuid).filter((x): x is string => !!x))].slice(0, 50) : [];
      if (!ids.length) return { error: "taskIds must be the person's task ids, first to last." };
      const own = await withUser(ctx.user.profileId, (db) => db.query<{ id: string; title: string }>(
        `SELECT id, title FROM tasks WHERE organisation_id = $1 AND assignee_membership_id = $2 AND id = ANY($3::uuid[]) AND archived_at IS NULL AND status <> 'completed'`, [ctx.org.id, ctx.membership.id, ids]));
      const titles = new Map(own.map((x) => [x.id, x.title]));
      const order = ids.filter((id) => titles.has(id));
      if (!order.length) return { error: "None of those are the person's open tasks." };
      await setDailyPlan(ctx, { localDate: todayLocal(ctx.org.timezone), taskIds: order });
      const r = done("plan", `Arranged today: ${order.map((id, i) => `${i + 1}. ${titles.get(id)}`).join("; ")}`.slice(0, 480), `${base}/my-day`);
      return { ...r, skipped: ids.length - order.length || undefined };
    }
    case "list_docs": {
      const r = await listDocs(ctx, { q: typeof input.q === "string" ? input.q : undefined, folder: typeof input.folder === "string" && input.folder.trim() ? input.folder : undefined, limit: 30 });
      return { docs: r.docs.map((d) => ({ id: d.id, title: d.title, folder: d.folder, readBy: audience(d), by: d.createdBy.name, updated: d.updatedAt, excerpt: d.excerpt, youCanEdit: d.canEdit, path: `/docs/${d.id}` })), folders: r.folders };
    }
    case "read_doc": {
      const id = uuid(input.docId); if (!id) return { error: "docId must be a document id from list_docs." };
      const d = await getDoc(ctx, id);
      if (!d) return { error: "That document is not shared with the person, or it was archived." };
      const CAP = 12_000;
      return { id: d.id, title: d.title, folder: d.folder, readBy: audience(d), by: d.createdBy.name, updated: d.updatedAt, youCanEdit: d.canEdit, path: `/docs/${d.id}`, text: d.body.slice(0, CAP), ...(d.body.length > CAP ? { truncated: `Only the first ${CAP} of ${d.body.length} characters are shown; the rest is on the page.` } : {}) };
    }
    case "create_doc": {
      const title = String(input.title ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
      if (!title) return { error: "A document needs a title." };
      const body = typeof input.body === "string" ? input.body : "";
      const visibility: DocVisibility = (DOC_VISIBILITIES as readonly string[]).includes(String(input.visibility)) ? (input.visibility as DocVisibility) : "private";
      const team = visibility === "team" ? await teamNamed(input.team) : null;
      if (team && "error" in team) return team;
      const folder = typeof input.folder === "string" && input.folder.trim() ? input.folder : null;
      // Everyone-can-read waits for Confirm; the draft is kept meanwhile (privately), so nothing written is lost and the
      // confirmation carries only the share, not the whole text.
      const shareLater = visibility === "organisation" && !confirmMode;
      const doc = await createDoc(ctx, { title, body, folder, visibility: shareLater ? "private" : visibility, teamId: team?.id ?? null });
      const path = `/docs/${doc.id}`;
      if (shareLater) {
        done("doc", `Saved a private draft: ${title}`, `${base}${path}`);
        return { ...askFirst(t, "update_doc", { docId: doc.id, visibility: "organisation" }, `Share “${title}” with everyone at ${ctx.org.name}`), savedAsPrivateDraft: true, docId: doc.id, path };
      }
      return { ...done("doc", `Saved “${title}”${team ? ` for ${team.name}` : visibility === "organisation" ? " for everyone" : " (only you can see it)"}`, `${base}${path}`), docId: doc.id, path };
    }
    case "update_doc": {
      const id = uuid(input.docId); if (!id) return { error: "docId must be a document id from list_docs." };
      const d = await getDoc(ctx, id);
      if (!d) return { error: "That document is not shared with the person, or it was archived." };
      if (!d.canEdit) return { error: `Only ${d.createdBy.name}, who wrote “${d.title}”, or the organisation owner or HR can change it. Offer to write a new document, or to message ${d.createdBy.name}.` };
      if (typeof input.body === "string" && typeof input.append === "string") return { error: "Give body (replaces the text) or append (adds to the end), not both." };
      const patch: Parameters<typeof updateDoc>[2] = {};
      const changes: string[] = [];
      if (typeof input.title === "string" && input.title.trim()) { patch.title = input.title.replace(/\s+/g, " ").trim().slice(0, 200); changes.push(`title to “${patch.title}”`); }
      if (typeof input.body === "string") { patch.body = input.body; changes.push("new text"); }
      if (typeof input.append === "string" && input.append.trim()) { patch.appendBody = input.append; changes.push("added to the end"); }
      if (typeof input.folder === "string") { const f = input.folder.trim(); patch.folder = !f || /^(none|no folder)$/i.test(f) ? null : f; changes.push(patch.folder ? `into ${patch.folder}` : "out of its folder"); }
      const vis = (DOC_VISIBILITIES as readonly string[]).includes(String(input.visibility)) ? (input.visibility as DocVisibility) : input.team ? "team" : null;
      let share: string | null = null;
      if (vis === "team") { const tm = await teamNamed(input.team); if ("error" in tm) return tm; patch.visibility = "team"; patch.teamId = tm.id; share = `shared with ${tm.name}`; }
      else if (vis === "private") { patch.visibility = "private"; share = "private to the writer"; }
      else if (vis === "organisation") { patch.visibility = "organisation"; share = `shared with everyone at ${ctx.org.name}`; }
      if (share && (vis !== d.visibility || (vis === "team" && patch.teamId !== d.teamId))) changes.push(share);
      if (!changes.length) return { error: share ? `It is already ${share}.` : "Say what to change." };
      const mine = d.createdBy.membershipId === ctx.membership.id;
      const href = `${base}/docs/${id}`;
      if (!confirmMode && !mine) return askFirst(t, name, input, `Change “${d.title}” by ${d.createdBy.name}: ${changes.join(", ")}`);
      if (!confirmMode && vis === "organisation" && d.visibility !== "organisation") {
        // The person's own edits run now; only the share with everyone waits.
        const rest = { ...patch }; delete rest.visibility; delete rest.teamId;
        const others = changes.filter((c) => c !== share);
        let alsoDone: string | undefined;
        if (others.length) { await updateDoc(ctx, id, rest); alsoDone = done("doc_update", `Updated “${d.title}”: ${others.join(", ")}`, href).summary; }
        return { ...askFirst(t, name, { docId: id, visibility: "organisation" }, `Share “${patch.title ?? d.title}” with everyone at ${ctx.org.name}`), ...(alsoDone ? { alsoDone } : {}), path: `/docs/${id}` };
      }
      await updateDoc(ctx, id, patch);
      return { ...done("doc_update", `Updated “${d.title}”${mine ? "" : ` by ${d.createdBy.name}`}: ${changes.join(", ")}`, href), path: `/docs/${id}` };
    }
    case "get_policy": {
      const [p, org, ps] = await Promise.all([
        policyView(ctx),
        withUser(ctx.user.profileId, async (db) => ({
          schedule: await scheduleFor(db, ctx.org.id, ctx.org.timezone),
          brenda: await brendaSettings(db, ctx.org.id),
          agreed: ORG.includes(role) && ctx.org.current_policy_id ? await db.one<{ members: number; agreed: number }>(
            `SELECT (SELECT count(*) FROM memberships WHERE organisation_id = $1 AND status = 'active')::int AS members,
                    (SELECT count(*) FROM policy_acknowledgements WHERE organisation_id = $1 AND policy_id = $2)::int AS agreed`, [ctx.org.id, ctx.org.current_policy_id]) : null,
        })),
        people(),
      ]);
      const s = org.schedule;
      const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      const [sh, sm] = s.start_local.split(":").map(Number);
      const lateFrom = sh * 60 + sm + s.clock_grace_minutes;
      const RECORDING: Record<string, string> = {
        disabled: "Off: nobody can record their screen.",
        optional: "On: staff and team leads get a Record screen button while a timer runs, and recording is their choice.",
        required_on_designated_tasks: "On, and required while working on tasks marked as recording required; optional otherwise.",
      };
      const askable = [...(ORG.includes(role) ? [{ name: ctx.user.displayName, role }] : []), ...ps.filter((x) => x.role === "owner" || x.role === "hr").map((x) => ({ name: x.display_name, role: x.role }))];
      return {
        workSchedule: { workingDays: [...s.working_days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => DAYS[d]), starts: s.start_local.slice(0, 5), ends: s.end_local.slice(0, 5), graceMinutes: s.clock_grace_minutes, lateAfter: `${String(Math.floor(lateFrom / 60) % 24).padStart(2, "0")}:${String(lateFrom % 60).padStart(2, "0")}`, timeZone: s.timezone },
        monitoringNotice: p.policy ? { version: p.policy.version, screenRecording: RECORDING[p.policy.recording_mode] ?? p.policy.recording_mode, recordingsKeptForDays: p.policy.retention_days, notice: p.policy.notice_text, inForceSince: p.policy.effective_at } : null,
        // Nobody signs the notice off (owner decision, 5 October 2026): people agree to recording once, when they first record.
        youAgreedToRecording: p.agreedAt ? { at: p.agreedAt } : "Not yet. You are asked once, the first time you start a recorded session.",
        ...(org.agreed ? { agreedToRecording: `${org.agreed.agreed} of ${org.agreed.members} people so far` } : {}),
        // The end-of-day team report goes to supervisors at the time set in Settings, in the organisation's time zone.
        brendaMay: { clockPeopleInAutomatically: org.brenda.autoClockIn, sendReminders: org.brenda.reminders, sendDailyTeamReport: org.brenda.dailyReportEnabled ? `at ${org.brenda.dailyReportTime}` : false },
        whoToAsk: askable.map((x) => `${x.name} (${x.role === "owner" ? "organisation owner" : "HR"})`),
        notHeldHere: "Leave, pay, benefits, conduct and other rules are not stored as settings. Search the organisation's documents (list_docs, e.g. 'handbook', 'leave') before saying they are not written down.",
      };
    }
    case "work_summary": {
      if (!isSummaryPeriod(input.period)) return { error: `period must be one of ${SUMMARY_PERIODS.join(", ")}.` };
      let membershipId: string | null = null;
      if (typeof input.person === "string" && input.person.trim()) {
        const self = { id: ctx.membership.id, display_name: ctx.user.displayName };
        const who = matchPerson(input.person, [self, ...(await people()).map((p) => ({ id: p.membership_id, display_name: p.display_name }))]);
        if (!who) return { error: `Nobody called "${input.person}". People: ${(await people()).map((p) => p.display_name).join(", ")}.` };
        if (role === "employee" && who.id !== ctx.membership.id) return { error: "Staff see a summary of their own work only; their team lead sees the team's." };
        membershipId = who.id;
      }
      const w = await workSummary(ctx, { period: input.period, membershipId });
      return {
        period: w.period, from: w.from, to: w.to, scope: w.scope, workingDaysSoFar: w.workingDays, totals: w.totals,
        people: w.people.map((p) => ({ name: p.name, teams: p.teams, hoursTracked: p.trackedHours, tasksCompleted: p.tasksCompleted, completed: p.completedTitles, sentForReview: p.submittedForReview, sentTitles: p.submittedTitles, openTasks: p.openTasks, blocked: p.blockedTasks, overdue: p.overdueOpen, overdueTitles: p.overdueTitles, daysClockedIn: p.daysClockedIn, daysLate: p.daysLate })),
      };
    }
    case "team_report": {
      // Lands only on the person asking (a private document, no notification or email), so it needs no Confirm.
      const r = await teamReportNow(ctx);
      if (r.status === "refused") return { error: r.message };
      if (r.status === "nothing") return { nothing: true, note: r.message };
      const path = `/docs/${r.docId}`;
      // Shown, not logged again: the service writes the action log itself (the Settings button runs it too).
      t.actions.push({ kind: "doc", summary: r.status === "existing" ? `Today's team report: ${r.title}` : `Saved ${r.title} (only you can see it)`, href: `${base}${path}` });
      return { done: true, docId: r.docId, path, title: r.title, headline: r.headline, endOfDayReport: r.endOfDay };
    }
    case "open_page": {
      const path = String(input.path ?? "").trim();
      if (!/^\/[A-Za-z0-9\-_/?=&]*$/.test(path)) return { error: "path must be a workspace path such as /tasks" };
      t.proposals.push({ kind: "open", href: `${base}${path}`, label: String(input.label ?? "Open").slice(0, 80) });
      return { offered: true };
    }
    default: return { error: `unknown tool ${name}` };
  }
}

// ---- Claude ---------------------------------------------------------------------

async function chatWithClaude(ctx: OrgContext, conn: AssistantConnection, messages: { role: "user" | "assistant"; content: string }[]): Promise<ChatResult> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: conn.apiKey, maxRetries: 2, timeout: 90_000 });
  const role = ctx.membership.role;
  const base = `/app/${ctx.org.slug}`;
  const t: ToolCtx = { ctx, base, actions: [], proposals: [], people: [], mode: "chat" };
  const today = todayLocal(ctx.org.timezone);
  const weekday = new Date(`${today}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
  // The current local time and offset, so "in two hours" or "at 3" resolve without asking.
  const now = new Date();
  const lp = localParts(now, ctx.org.timezone);
  const off = Math.round(offsetAt(now, ctx.org.timezone) / 60000);
  const offset = `${off < 0 ? "-" : "+"}${String(Math.floor(Math.abs(off) / 60)).padStart(2, "0")}:${String(Math.abs(off) % 60).padStart(2, "0")}`;
  const clockNow = `${String(lp.hour).padStart(2, "0")}:${String(lp.minute).padStart(2, "0")}`;
  const roleLabel: Record<Role, string> = { owner: "organisation owner", hr: "HR administrator", manager: "team lead", employee: "staff member" };
  const team = role === "manager" ? await assignableMembers(ctx) : [];
  // Two parts: the rules, the same for everyone and cached with the tool list (prompt caching cuts the time and cost of
  // every step), then who, when and where, which changes per person and per minute.
  const rules = [
    "You are Brenda, the AI teammate inside Boredroom, a work tracker for remote teams. You understand the person's work and help get it done. You do the work for them: you arrange their day, keep their tasks moving, write and file their documents, answer their questions about how the organisation works, and tell team leads what got done.",
    "When the person asks for something to be done, do it with the tools, then tell them in plain words what you did. Their own work you just do: their to-dos, clock, timer, status, comments, progress, reminders, day plan and their own documents. Some tools return needsConfirmation instead of doing the work (anything that lands on someone else, goes to a group, or sends an email): then nothing has happened yet; say in one sentence what will happen and that it runs when they press Confirm. Ask one short question only when the request is ambiguous (two people with the same name, no task named) or a detail you need is missing (an email address, a time). Do the action the person names and no other: 'message' or 'tell' someone is send_message, not a review submission or a comment; offer the alternative in words if it seems better. Look names and ids up with list_people, list_tasks, search or get_briefing before acting; never invent an id.",
    "Base reminders, priorities and summaries on what the tools return, never on assumptions. For 'what's waiting for me', 'what should I work on' or 'what did I get done', call get_briefing first.",
    "You act as the person, with their permissions: what they cannot do, you cannot do, and the tool will say so; pass that on plainly and say who can. Never claim something happened unless the tool returned done.",
    "Always answer the question itself from the tools (who, what, how many, or that there is nothing). When a page helps, also call open_page; its link appears below your reply.",
    "Resolve relative times and dates against the current time given below (\"in two hours\", \"at 3\", \"tomorrow morning\") and give ISO 8601 datetimes with the offset given below; 17:00 local when only a day is given; never ask the person what time it is. Dictated messages contain filler and mistakes: read through them.",
    "Arranging the day ('arrange my day', 'plan my tasks', 'what order should I do things in'): call get_my_day, and get_briefing for anything overdue or waiting on them. Plan the tasks they hold that are todo or in_progress (a blocked task cannot be worked on and one in review is waiting for someone else: mention them, do not plan them). Order them: overdue and the earliest deadline first, then priority (urgent, high, normal, low), then the shortest estimate. Fit them one after another into the rest of today's working hours (from now, or from workStarts if the day has not begun, until workEnds), allowing the estimate less the time already tracked, or 60 minutes for a task with no estimate. For each task that fits, call update_task with due set to its planned finish time today and priority high when it is overdue or due today (leave urgent as it is); their own tasks change at once. Never move a deadline later: a task that is overdue or due before its planned finish keeps its due date (it simply goes first). Then save the order with plan_day. Tasks that do not fit stay as they are; say which. If today is not a working day (workingDay false) or the working hours are over, say so and ask before planning anything. Reply with the plan as a short numbered list, one line per task with its time. Organisation accounts hold no tasks: offer work_summary or the team's status instead.",
    "Writing ('write', 'draft', 'take notes', 'make an SOP', 'put together a report'): write it properly, as markdown, in plain British English: a clear title, short sections with headings, lists where they help, complete enough to use as it is, never placeholder text. Save it with create_doc: private unless they ask to share it; a folder that fits (Meeting notes, SOPs, Reports, Policies). Then say in one sentence where it is saved and who can read it, and call open_page with its path (/docs/<id>). If create_doc returns needsConfirmation, the draft is already saved privately and is shared with everyone only when they press Confirm; say so. To change a document, find it with list_docs, read it with read_doc, then call update_doc (append adds to the end; body rewrites it). Documents are markdown; your replies are not.",
    "Questions about how this organisation works (working hours, lateness, monitoring and screen recording, leave, pay, conduct, the handbook): call get_policy, and search the organisation's documents with list_docs and read_doc the one that answers it. Answer only from what they say, and name the document you used. If the answer is not there, say plainly that it is not written down in Boredroom and suggest who to ask (whoToAsk from get_policy). Never invent a policy, a number, an entitlement or a date. Questions that are not about this organisation (how to write a good update, what a term means, how to approach a task) you answer from your own knowledge.",
    "Team leads and organisation accounts asking what the team got done, who is behind, or for a weekly summary: call work_summary (week runs from Monday to today; use last_week on a Monday morning) and report the facts per person: hours tracked, what was completed and sent for review, what is overdue or blocked. 'Behind' means overdue or blocked work, not fewer hours. Mention lateness only when asked about attendance. Offer to save a summary worth keeping as a document.",
    "Today's team report ('send me today's report', 'the daily report', 'how did my team do today'): call team_report. It saves the report privately to their Docs; reply with its headline, say it is in their Docs under Daily reports, and call open_page with its path. If it returns nothing, say there is nothing to report yet. You also send this report to team leads, the owner and HR at the end of every working day, at the time set in Settings. Staff do not write or submit a daily report: if one asks how to, say there is none to write, their to-dos and timer are the record, and offer what they got done today (work_summary).",
    "Do not narrate your steps (no \"let me check\"); call the tools you need, then write one reply. Answer in one to four short sentences of plain English. No headings, no bullet lists, no markdown; the one exception is a plan or a summary, which may be a short numbered list (1. 2. 3.), one line per item. Nothing here is a productivity score, and you never rank or judge people.",
  ].join("\n");
  const situation = [
    `You are working for ${ctx.user.displayName}, a ${roleLabel[role]} at ${ctx.org.name}. It is now ${weekday} ${today}, ${clockNow} in the ${ctx.org.timezone} timezone (UTC${offset}).`,
    `Pages in this workspace for this person (paths are relative to the workspace): ${pagesFor(role).map((p) => `${p.label} (${p.path}): ${p.what}`).join("; ")}.`,
    role === "owner" || role === "hr" ? "Organisation accounts do not clock in, have no to-dos and no timers, and do not give reviews; they supervise, assign, message, create teams and invite people." : role === "manager" ? `The person is a team lead and may add to-dos for these team members: ${team.map((p) => p.display_name).join(", ") || "nobody yet"}; they may also assign existing tasks to them.` : "The person is staff: every to-do is their own; they cannot see other people's activity or assign work.",
  ].join("\n");
  const system = [
    { type: "text" as const, text: rules, cache_control: { type: "ephemeral" as const } },
    { type: "text" as const, text: situation },
  ];

  type Msg = Parameters<typeof client.messages.create>[0]["messages"][number];
  const thread: Msg[] = messages.slice(-20).map((m) => ({ role: m.role, content: m.content }));
  // The reply is what she writes once she has what she needs: the final text, or the text that comes with a link
  // (open_page needs no answer back, so the loop ends there without another call). Text written alongside other tool
  // calls is usually a preamble ("I'll find that task first") and is kept only as a fallback.
  let reply = "", fallback = "";
  for (let step = 0; step < 10; step++) {
    const t0 = Date.now();
    const res = await client.messages.create({ model: conn.model, max_tokens: 8000, system, tools: TOOLS, messages: thread });
    if (process.env.BRENDA_DEBUG) console.log("[brenda]", step, `${Date.now() - t0}ms`, res.stop_reason, res.content.map((b) => b.type === "tool_use" ? `tool:${b.name}` : b.type).join(","), `cached ${res.usage.cache_read_input_tokens ?? 0}`);
    if (res.stop_reason === "refusal") { reply = "I can't help with that one."; break; }
    const text = res.content.filter((b) => b.type === "text").map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    const uses = res.content.filter((b) => b.type === "tool_use");
    if (uses.length === 0 || res.stop_reason !== "tool_use") { reply = text; break; }
    const linkOnly = uses.every((u) => u.type === "tool_use" && u.name === "open_page");
    if (linkOnly) reply = text; else if (text) fallback = text;
    thread.push({ role: "assistant", content: res.content });
    const results = [];
    for (const u of uses) {
      if (u.type !== "tool_use") continue;
      let out: unknown;
      let failed = false;
      const t1 = Date.now();
      try { out = await runTool(t, u.name, (u.input ?? {}) as Record<string, unknown>); }
      catch (err) { failed = true; out = { error: ((err as { message?: string }).message ?? String(err)).slice(0, 300) }; }
      const isError = failed || (!!out && typeof out === "object" && "error" in (out as Record<string, unknown>));
      if (isError && ACTION_TOOLS.has(u.name)) void recordAction(ctx, { tool: u.name, summary: String((out as { error?: string }).error ?? "Refused").slice(0, 300), outcome: failed ? "failed" : "refused" });
      if (process.env.BRENDA_DEBUG) console.log("[brenda]   ", u.name, `${Date.now() - t1}ms`);
      results.push({ type: "tool_result" as const, tool_use_id: u.id, content: JSON.stringify(out).slice(0, 20_000), ...(isError ? { is_error: true } : {}) });
    }
    thread.push({ role: "user", content: results });
    if (linkOnly && text) break;
  }
  reply ||= fallback;
  return { reply: reply || (t.actions.length ? "Done." : "I could not work that one out. Try asking in a different way."), engine: "claude", actions: t.actions, proposals: t.proposals, note: null };
}

/** For the smoke script: run one tool as the person, in chat mode (gated tools prepare) or confirm mode (they run). */
export async function runBrendaTool(ctx: OrgContext, name: string, input: Record<string, unknown>, mode: "chat" | "confirm" = "chat") {
  const t: ToolCtx = { ctx, base: `/app/${ctx.org.slug}`, actions: [], proposals: [], people: [], mode };
  const out = await runTool(t, name, input);
  return { out, actions: t.actions, proposals: t.proposals };
}

const ACTION_TOOLS = new Set(["create_todos", "assign_task", "update_task", "add_comment", "submit_for_review", "remind_me", "cancel_reminder", "complete_task", "clock", "timer", "send_message", "create_team", "invite_person", "set_status", "plan_day", "create_doc", "update_doc"]);

/** Runs an action Brenda prepared, once the person pressed Confirm. The token is signed, expires and is bound to them. */
export async function confirmAction(ctx: OrgContext, token: string): Promise<{ actions: Action[]; error: string | null }> {
  const p = verifyPayload<{ k: string; o: string; m: string; tool: string; input: Record<string, unknown>; exp: number }>(token);
  if (!p || p.k !== "brenda") throw invalid("That confirmation is not valid. Ask Brenda again.");
  if (p.exp * 1000 < Date.now()) throw invalid("That confirmation expired. Ask Brenda again.");
  if (p.o !== ctx.org.id || p.m !== ctx.membership.id) throw forbidden("That confirmation belongs to someone else.");
  if (!ACTION_TOOLS.has(p.tool)) throw invalid("That action cannot be confirmed.");
  // Each Confirm runs once: a second press (or a retried request) would otherwise send the message or append the text
  // again. The claim lives in the idempotency store, which outlives the token; it is released when nothing was done.
  const claim = [ctx.user.profileId, "brenda-confirm", sha256(token)];
  const claimed = await withSystem((db) => db.maybeOne(
    `INSERT INTO idempotency_keys(actor_user_id, route, key, request_hash) VALUES ($1, $2, $3, $3) ON CONFLICT (actor_user_id, route, key) DO NOTHING RETURNING id`, claim));
  if (!claimed) throw conflict("ALREADY_CONFIRMED", "That was already done. Ask Brenda again if you need it once more.");
  const release = () => withSystem((db) => db.query(`DELETE FROM idempotency_keys WHERE actor_user_id = $1 AND route = $2 AND key = $3`, claim));
  const t: ToolCtx = { ctx, base: `/app/${ctx.org.slug}`, actions: [], proposals: [], people: [], mode: "confirm" };
  let out: { error?: string };
  try { out = await runTool(t, p.tool, p.input) as { error?: string }; }
  catch (err) { if (!t.actions.length) await release(); throw err; }
  if (out && out.error) { if (!t.actions.length) await release(); void recordAction(ctx, { tool: p.tool, summary: out.error.slice(0, 300), outcome: "refused", source: "confirm" }); return { actions: [], error: out.error }; }
  return { actions: t.actions, error: null };
}

// ---- Built-in helper: answers, and offers actions as buttons -------------------------------------

const STOP = new Set(["where", "what", "when", "which", "there", "here", "does", "this", "that", "with", "from", "have", "your", "mine", "find", "show", "open", "page", "want", "need", "about", "into", "some", "them", "they", "will", "would", "could", "should", "please", "change", "make", "know"]);
const ACTION = /\b(need to|have to|should|must|remind me|todo|to do|finish|send|write|fix|prepare|call|review|update|design|build|ask|tell)\b/i;

async function chatBuiltin(ctx: OrgContext, messages: { role: "user" | "assistant"; content: string }[]): Promise<ChatResult> {
  const last = messages[messages.length - 1]?.content ?? "";
  const role = ctx.membership.role;
  const base = `/app/${ctx.org.slug}`;
  const lc = last.toLowerCase();
  const pages = pagesFor(role);
  const out = (reply: string, proposals: Proposal[]): ChatResult => ({ reply, engine: "builtin", actions: [], proposals, note: null });

  if (WORKERS.includes(role) && /\bclock\b/.test(lc) && /\b(in|out)\b/.test(lc)) {
    const isOut = /\bout\b/.test(lc);
    return out(`Press the button below to clock ${isOut ? "out" : "in"}. Your clock page keeps the history.`, [{ kind: isOut ? "clock_out" : "clock_in" }, { kind: "open", href: `${base}/clock`, label: "Your clock" }]);
  }

  if (/\b(waiting|what should i|brief|attention|due today|overdue)\b/.test(lc)) {
    const b = await briefing(ctx);
    const parts = [
      b.dueToday.length ? `${b.dueToday.length} task${b.dueToday.length === 1 ? "" : "s"} due today` : null,
      b.overdue.length ? `${b.overdue.length} overdue` : null,
      b.waitingForYourReview.length ? `${b.waitingForYourReview.length} waiting for your review` : null,
      b.assignmentsNotPickedUp.length ? `${b.assignmentsNotPickedUp.length} assignment${b.assignmentsNotPickedUp.length === 1 ? "" : "s"} nobody has picked up` : null,
      b.remindersToday.length ? `${b.remindersToday.length} reminder${b.remindersToday.length === 1 ? "" : "s"} today` : null,
    ].filter(Boolean);
    const first = b.overdue[0] ?? b.dueToday[0] ?? null;
    return out(parts.length ? `You have ${parts.join(", ")}.${first ? ` Start with “${first.title}”.` : ""}` : "Nothing is waiting on you right now.", [
      ...(first && WORKERS.includes(role) && !b.timer ? [{ kind: "start_timer" as const, taskId: first.id, taskTitle: first.title }] : []),
      ...(b.waitingForYourReview.length ? [{ kind: "open" as const, href: `${base}/reviews`, label: "Reviews" }] : []),
      { kind: "open", href: `${base}/tasks`, label: "Tasks" },
    ]);
  }

  const words = lc.split(/[^a-z]+/).filter((w) => w.length > 3 && !STOP.has(w));
  const matched = pages.map((p) => { const label = p.label.toLowerCase(), what = p.what.toLowerCase(); const score = words.reduce((n, w) => n + (label.includes(w) ? 3 : 0) + (what.includes(w) ? 1 : 0), 0); return { p, score }; })
    .filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 3).map((x) => x.p);

  if (ACTION.test(last) && WORKERS.includes(role) && !/\b(where|how|what|who|which)\b/i.test(last.slice(0, 12))) {
    const people = role === "manager" ? await assignableMembers(ctx) : [];
    const items = planBuiltin(last, { people, today: todayLocal(ctx.org.timezone), timezone: ctx.org.timezone });
    const proposals: Proposal[] = items.map((it) => ({ kind: "todo", title: it.title, description: it.description, dueAt: it.dueAt, assigneeMembershipId: it.assigneeMembershipId, assigneeName: it.assigneeName, estimateMinutes: it.estimateMinutes }));
    if (proposals.length) return out(`I read ${proposals.length} to-do${proposals.length === 1 ? "" : "s"} in that. Check the titles and add the ones you want. (Connect Claude under Settings, AI assistant, and the assistant will add them itself.)`, proposals);
  }

  if (/\b(who|team|working|clocked|attendance|late)\b/.test(lc) && role !== "employee") {
    const a = await attendanceBoard(ctx);
    const inNow = a.people.filter((p) => p.clock_in_at && !p.clock_out_at).map((p) => p.display_name);
    return out(`${a.counts.in + a.counts.out} clocked in today${a.counts.late ? `, ${a.counts.late} late` : ""}, ${a.counts.not_in} not yet. ${inNow.length ? `In right now: ${inNow.slice(0, 8).join(", ")}${inNow.length > 8 ? " and more" : ""}.` : ""}`.trim(), [{ kind: "open", href: `${base}/attendance`, label: "Attendance" }, { kind: "open", href: `${base}/workroom`, label: "Workroom" }]);
  }

  if (WORKERS.includes(role) && /\b(my day|today|to-?dos?|tasks?|plan)\b/.test(lc)) {
    const d = await myDay(ctx);
    const open = [...d.planned, ...d.ownTodos, ...d.fromLeads];
    return out(open.length ? `You have ${open.length} open to-do${open.length === 1 ? "" : "s"} today${d.overdue.length ? `, ${d.overdue.length} overdue` : ""}. First up: ${open.slice(0, 3).map((x) => x.title).join("; ")}.` : "Nothing is on your list yet. Tell me what you are working on and I will draft the to-dos.", [...open.slice(0, 1).map((x) => ({ kind: "start_timer" as const, taskId: x.id, taskTitle: x.title })), { kind: "open", href: `${base}/my-day`, label: "My Day" }]);
  }

  if (matched.length) return out(matched.map((p) => `${p.label} is for ${p.what}.`).join(" "), matched.map((p) => ({ kind: "open", href: `${base}${p.path}`, label: p.label })));

  const r = await searchWorkspace(ctx, last.slice(0, 120));
  if (r.hits.length) return out(`I found ${r.hits.length} thing${r.hits.length === 1 ? "" : "s"} matching that.`, r.hits.slice(0, 5).map((h) => ({ kind: "open", href: h.href, label: `${h.title}${h.hint ? ` (${h.hint})` : ""}` })));

  return out(`I can point you to a page, tell you ${role === "employee" ? "what is on your day" : "who is working or clocked in"}, or turn a note into to-dos. The AI is not connected yet, so I only offer; connect Claude under Settings, AI assistant, and the assistant will do the work itself: to-dos, assignments, messages, clocking, invitations.`, pages.slice(0, 4).map((p) => ({ kind: "open", href: `${base}${p.path}`, label: p.label })));
}
