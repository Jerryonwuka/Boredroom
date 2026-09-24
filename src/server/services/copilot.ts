/**
 * The workspace agent: a conversation that gets things done. It looks things up (the person's day, who is working
 * or clocked in, tasks and people by name) and it acts: adds to-dos, assigns tasks, clocks in and out, runs the
 * timer, sends messages, creates teams, invites people, sets the work status. Every action runs as the signed-in
 * person through the same services as the buttons do, so row-level security, role checks, audit entries and
 * notifications are exactly what a click would produce: the agent can do nothing the person could not.
 *
 * Engines: Claude with tools when a key is configured (Settings, AI assistant, or ANTHROPIC_API_KEY). Without one, a
 * built-in helper answers and only *offers* actions as buttons, since it cannot read intent well enough to act.
 */
import { z } from "zod";
import type { OrgContext } from "@/server/lib/api";
import { withUser } from "@/server/db";
import { resolveAssistant, planBuiltin, matchPerson, type AssistantConnection } from "@/server/services/assistant";
import { assignableMembers, quickTodo, updateTask, completeTask } from "@/server/services/tasks";
import { myDay, teamStatus, tasksView } from "@/server/services/views";
import { myClock, attendanceBoard, clockIn, clockOut } from "@/server/services/attendance";
import { currentSession, startSession, pauseSession, resumeSession, stopSession } from "@/server/services/sessions";
import { inbox, openDirect, peopleToMessage, sendMessage } from "@/server/services/messaging";
import { createTeam, createInvitation } from "@/server/services/orgs";
import { setMyPresence } from "@/server/services/profile";
import { searchWorkspace } from "@/server/services/search";
import { isPresence } from "@/lib/presence";
import { todayLocal } from "@/server/lib/time";

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
  | { kind: "open"; href: string; label: string };

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
  { label: "My Day", path: "/my-day", what: "your to-dos for today, the timer, the assistant, the daily report", roles: WORKERS },
  { label: "Clock in", path: "/clock", what: "clock in before work and out after; your attendance history", roles: WORKERS },
  { label: "Attendance", path: "/attendance", what: "who has clocked in today, who is late, the month view", roles: LEADS },
  { label: "Workroom", path: "/workroom", what: "who is working now, on what, for how long", roles: LEADS },
  { label: "Messages", path: "/messages", what: "channels per team, direct threads, ask for an update with the task attached", roles: ALL },
  { label: "Tasks", path: "/tasks", what: "every task: open, waiting for a check, done", roles: ALL },
  { label: "People and teams", path: "/people", what: "join code, invitations, teams and their leads", roles: ORG },
  { label: "Reviews", path: "/reviews", what: "submissions, time corrections and exemptions waiting for a decision", roles: LEADS },
  { label: "Recordings", path: "/recordings", what: "screen recordings, playback grants", roles: LEADS },
  { label: "Timesheets", path: "/timesheets", what: "confirmed hours per day, corrections, CSV export", roles: ALL },
  { label: "Reports", path: "/reports", what: "daily reports and hours per person and team", roles: LEADS },
  { label: "Projects", path: "/projects", what: "projects and their members", roles: LEADS },
  { label: "Policy", path: "/policy", what: "the monitoring notice: what is recorded and who has acknowledged it", roles: ALL },
  { label: "Settings", path: "/settings", what: "recording, AI assistant, schedule, policy, grants", roles: ORG },
  { label: "Audit", path: "/audit", what: "who did what and when", roles: ORG },
  { label: "Notifications", path: "/notifications", what: "assignments, review requests and decisions", roles: ALL },
  { label: "Your profile", path: "/profile", what: "your picture, name, title, status", roles: ALL },
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
  return (e?.message ?? String(err)).slice(0, 140);
}

// ---- Tools --------------------------------------------------------------------

type Person = { membership_id: string; display_name: string; role: string; teams: string | null };
type ToolCtx = { ctx: OrgContext; base: string; actions: Action[]; proposals: Proposal[]; people: Person[] };

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
  { name: "create_todos", description: "Create to-dos now. Staff to-dos are their own; a team lead may name an assignee from their team (exact name from list_people). Returns what was created.", input_schema: obj({ items: { type: "array", items: obj({ title: str("Short imperative title, at most 120 characters"), description: str("Detail, or omit"), due: str("ISO 8601 with offset, or omit"), assignee: str("Exact team member name, or omit"), estimateMinutes: { type: "integer" } }, ["title"]) } }, ["items"]) },
  { name: "assign_task", description: "Hand an existing task to someone (team leads and organisation accounts, within their scope). Use a task id from list_tasks or search and a membership id from list_people.", input_schema: obj({ taskId: str("Task id"), assigneeMembershipId: str("Membership id of the new assignee") }, ["taskId", "assigneeMembershipId"]) },
  { name: "complete_task", description: "Mark one of the person's own tasks done (it goes to their team lead for a check when one exists).", input_schema: obj({ taskId: str("Task id"), note: str("What was done, or omit") }, ["taskId"]) },
  { name: "clock", description: "Clock the person in or out. Staff and team leads only.", input_schema: obj({ direction: { type: "string", enum: ["in", "out"] } }, ["direction"]) },
  { name: "timer", description: "Run the person's timer: start on one of their tasks, pause, resume, or stop (with an outcome). Staff and team leads only.", input_schema: obj({ action: { type: "string", enum: ["start", "pause", "resume", "stop"] }, taskId: str("For start: the task id"), outcome: { type: "string", enum: ["continue_later", "blocked", "ready_for_review", "completed"], description: "For stop; continue_later by default" }, note: str("For stop, or omit") }, ["action"]) },
  { name: "send_message", description: "Send a message: to a person by exact name (a direct thread), to a team channel by team name, or to everyone. Optionally attach a task by id.", input_schema: obj({ to: str("A person's exact name, a team name, or 'everyone'"), body: str("The message"), taskId: str("Task id to attach, or omit") }, ["to", "body"]) },
  { name: "create_team", description: "Create a team (organisation accounts only).", input_schema: obj({ name: str("Team name") }, ["name"]) },
  { name: "invite_person", description: "Invite someone by email; they get an invitation email (organisation accounts only). role: employee (staff) or manager (team lead); team by exact name, optional.", input_schema: obj({ email: str("Email address"), role: { type: "string", enum: ["employee", "manager", "hr"] }, team: str("Exact team name, or omit") }, ["email", "role"]) },
  { name: "set_status", description: "Set the person's own work status.", input_schema: obj({ presence: { type: "string", enum: ["active", "away", "busy", "offline"] } }, ["presence"]) },
  { name: "open_page", description: "Offer a link to a page (a path from the page list, or a task, person, project or team href from search).", input_schema: obj({ path: str("Path such as /tasks or /tasks/<id>"), label: str("Link text") }, ["path", "label"]) },
];

const uuid = (v: unknown) => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : null;

async function runTool(t: ToolCtx, name: string, input: Record<string, unknown>): Promise<unknown> {
  const { ctx, base } = t;
  const role = ctx.membership.role;
  const people = async () => { if (!t.people.length) t.people = await peopleToMessage(ctx); return t.people; };
  const done = (kind: string, summary: string, href?: string) => { t.actions.push({ kind, summary, href }); return { done: true, summary }; };
  switch (name) {
    case "get_my_day": {
      if (!WORKERS.includes(role)) return { error: "Organisation accounts have no day of their own; use get_team_status or get_attendance." };
      const [d, c] = await Promise.all([myDay(ctx), myClock(ctx)]);
      const row = (x: { id: string; title: string; status: string; due_at: string | null; project_name: string; tracked_seconds: number }) => ({ id: x.id, title: x.title, status: x.status, due: x.due_at, project: x.project_name, trackedSeconds: x.tracked_seconds });
      return { today: d.today, clock: c.status, workingDay: c.workingDay, workStarts: c.schedule.start_local, workEnds: c.schedule.end_local, timerRunning: c.timerOpen, hoursSoFarSeconds: d.todaySeconds, planned: d.planned.map(row), ownTodos: d.ownTodos.map(row), fromLeads: d.fromLeads.map(row), overdue: d.overdue.map(row), doneToday: d.doneToday.map((x) => x.title), report: d.report?.status ?? null };
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
    case "create_todos": {
      if (!WORKERS.includes(role)) return { error: "Organisation accounts have no to-dos; a team lead adds them for their team." };
      const items = Array.isArray(input.items) ? (input.items as Record<string, unknown>[]).slice(0, 15) : [];
      const team = role === "manager" ? await assignableMembers(ctx) : [];
      const created: { id: string; title: string; assignee: string | null }[] = [];
      for (const it of items) {
        const title = String(it.title ?? "").trim().slice(0, 200);
        if (!title) continue;
        const person = it.assignee && team.length ? matchPerson(String(it.assignee), team) : null;
        if (it.assignee && team.length && !person) return { error: `"${it.assignee}" is not on the team. People: ${team.map((p) => p.display_name).join(", ")}.`, created };
        const due = typeof it.due === "string" && !Number.isNaN(Date.parse(it.due)) ? new Date(it.due).toISOString() : null;
        const est = typeof it.estimateMinutes === "number" && it.estimateMinutes > 0 ? Math.round(it.estimateMinutes) : null;
        const r = await quickTodo(ctx, { title, description: typeof it.description === "string" && it.description.trim() ? it.description.trim().slice(0, 4000) : null, dueAt: due, assigneeMembershipId: person?.id ?? null, estimateMinutes: est });
        const id = (r as { id?: string }).id ?? "";
        created.push({ id, title, assignee: person?.display_name ?? null });
        done("todo", `Added to-do: ${title}${person ? ` for ${person.display_name}` : ""}`, id ? `${base}/tasks/${id}` : undefined);
      }
      return { created };
    }
    case "assign_task": {
      const taskId = uuid(input.taskId), to = uuid(input.assigneeMembershipId);
      if (!taskId || !to) return { error: "taskId and assigneeMembershipId must be ids from list_tasks and list_people." };
      const task = await withUser(ctx.user.profileId, (db) => db.maybeOne<{ version: number; title: string }>(`SELECT version, title FROM tasks WHERE id = $1 AND organisation_id = $2`, [taskId, ctx.org.id]));
      if (!task) return { error: "That task is not visible to you." };
      const who = (await people()).find((p) => p.membership_id === to);
      await updateTask(ctx, taskId, { expectedVersion: task.version, assigneeMembershipId: to });
      return done("assign", `Assigned "${task.title}" to ${who?.display_name ?? "them"}`, `${base}/tasks/${taskId}`);
    }
    case "complete_task": {
      const taskId = uuid(input.taskId);
      if (!taskId) return { error: "taskId must be a task id." };
      const r = await completeTask(ctx, taskId, { note: String(input.note ?? "").slice(0, 2000) });
      const title = (r as { title?: string }).title;
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
      await sendMessage(ctx, { conversationId, body, taskId });
      return done("message", `Sent to ${label}: “${body.length > 80 ? `${body.slice(0, 77)}…` : body}”`, `${base}/messages?c=${conversationId}`);
    }
    case "create_team": {
      if (!ORG.includes(role)) return { error: "Only organisation accounts create teams." };
      const name = String(input.name ?? "").trim().slice(0, 120); if (!name) return { error: "A team needs a name." };
      const r = await createTeam(ctx, name);
      const id = (r as { id?: string }).id;
      return done("team", `Created the team ${name}`, id ? `${base}/teams/${id}` : `${base}/people?tab=teams`);
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
      await createInvitation(ctx, { email, role: r, teamId }, { send: true });
      return done("invite", `Invited ${email} as ${r === "manager" ? "team lead" : r === "hr" ? "HR administrator" : "staff"}${input.team ? ` in ${input.team}` : ""}; the email is on its way`, `${base}/people?tab=invitations`);
    }
    case "set_status": {
      if (!isPresence(input.presence)) return { error: "presence must be active, away, busy or offline." };
      await setMyPresence(ctx.user, input.presence);
      return done("status", `Status set to ${input.presence === "busy" ? "do not disturb" : input.presence}`);
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
  const t: ToolCtx = { ctx, base, actions: [], proposals: [], people: [] };
  const today = todayLocal(ctx.org.timezone);
  const weekday = new Date(`${today}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
  const roleLabel: Record<Role, string> = { owner: "organisation owner", hr: "HR administrator", manager: "team lead", employee: "staff member" };
  const team = role === "manager" ? await assignableMembers(ctx) : [];
  const system = [
    `You are the assistant inside Boredroom, a work tracker for remote teams, and you get things done. You are working for ${ctx.user.displayName}, a ${roleLabel[role]} at ${ctx.org.name}. Today is ${weekday} ${today} in the ${ctx.org.timezone} timezone.`,
    "When the person asks for something to be done, do it with the tools, then tell them in plain words what you did. Do not ask for confirmation for ordinary work: adding to-dos, assigning tasks, clocking, the timer, messages, teams, invitations, status. Ask one short question only when the request is ambiguous (two people with the same name, no task named) or when a detail you need is missing (an email address). Look names and ids up with list_people, list_tasks or search before acting; never invent an id.",
    "You act as the person, with their permissions: what they cannot do, you cannot do, and the tool will say so; pass that on plainly and say who can. Never claim something happened unless the tool returned done.",
    `Pages in this workspace for this person (paths are relative to the workspace): ${pagesFor(role).map((p) => `${p.label} (${p.path}): ${p.what}`).join("; ")}. When the answer is a place, call open_page for it.`,
    role === "owner" || role === "hr" ? "Organisation accounts do not clock in, have no to-dos and no timers, and do not give reviews; they supervise, assign, message, create teams and invite people." : role === "manager" ? `The person is a team lead and may add to-dos for these team members: ${team.map((p) => p.display_name).join(", ") || "nobody yet"}; they may also assign existing tasks to them.` : "The person is staff: every to-do is their own; they cannot see other people's activity or assign work.",
    "Resolve relative dates against today and give ISO 8601 datetimes with the correct offset for the timezone; 17:00 local when only a day is given. Dictated messages contain filler and mistakes: read through them.",
    "Answer in one to four short sentences of plain English. No headings, no bullet lists, no markdown. Nothing here is a productivity score, and you never rank or judge people.",
  ].join("\n");

  type Msg = Parameters<typeof client.messages.create>[0]["messages"][number];
  const thread: Msg[] = messages.slice(-20).map((m) => ({ role: m.role, content: m.content }));
  let reply = "";
  for (let step = 0; step < 10; step++) {
    const res = await client.messages.create({ model: conn.model, max_tokens: 1500, system, tools: TOOLS, messages: thread });
    const text = res.content.filter((b) => b.type === "text").map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    const uses = res.content.filter((b) => b.type === "tool_use");
    if (text) reply = text;
    if (uses.length === 0 || res.stop_reason !== "tool_use") break;
    thread.push({ role: "assistant", content: res.content });
    const results = [];
    for (const u of uses) {
      if (u.type !== "tool_use") continue;
      let out: unknown;
      try { out = await runTool(t, u.name, (u.input ?? {}) as Record<string, unknown>); }
      catch (err) { out = { error: ((err as { message?: string }).message ?? String(err)).slice(0, 300) }; }
      results.push({ type: "tool_result" as const, tool_use_id: u.id, content: JSON.stringify(out).slice(0, 20_000) });
    }
    thread.push({ role: "user", content: results });
  }
  return { reply: reply || (t.actions.length ? "Done." : "I could not work that one out. Try asking in a different way."), engine: "claude", actions: t.actions, proposals: t.proposals, note: null };
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
