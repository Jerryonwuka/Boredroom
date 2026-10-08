/**
 * Brenda, the AI work assistant (owner decision, 3 October 2026; spec "Brenda for Boredroom", MVP).
 *
 * This module holds what Brenda knows and does outside the conversation itself (that lives in copilot.ts):
 * - what the organisation and the person allow her to do (automatic clock-in, reminders, the daily team report);
 * - the action log: every action she takes is written here, so it is visible, auditable and revocable;
 * - the briefing: "what's waiting for me today", built from real Boredroom data;
 * - personal reminders ("remind me to call Josh at 7");
 * - automatic clock-in on the first sign of work on a working day, when both the organisation and the person allow it;
 * - the scheduled nudges (due tomorrow, waiting for review, no reply to an assignment, started without a timer).
 *
 * Everything runs as the person through the same services the buttons use, so permissions are exactly theirs.
 */
import { z } from "zod";
import { withUser, withWorker, type Db } from "@/server/db";
import type { OrgContext } from "@/server/lib/api";
import { notify } from "@/server/services/common";
import { clockIn, myClock } from "@/server/services/attendance";
import { currentSession } from "@/server/services/sessions";
import { reviewQueue } from "@/server/services/views";
import { invalid, notFound, forbidden } from "@/server/lib/errors";
import { localDate, weekdayOf } from "@/server/lib/time";
import { assistantSchemaReady, readPersonalAssistant } from "@/server/services/assistant-profile";
import { rowSummary } from "@/server/services/assistant-activity";

// ---- What is allowed --------------------------------------------------------------------------------

/**
 * The organisation's switches. The daily team report (owner decision, 5 October 2026; daily-report.ts) is on by default
 * at 18:00 local time, and owners and HR get the whole organisation unless that is switched off.
 */
export type BrendaSettings = { autoClockIn: boolean; reminders: boolean; dailyReportEnabled: boolean; dailyReportTime: string; dailyReportOrgWide: boolean };
export type BrendaPrefs = { autoClockIn: boolean; reminders: boolean };

export async function brendaSettings(db: Db, orgId: string): Promise<BrendaSettings> {
  const r = await db.maybeOne<{ auto_clock_in: boolean; reminders: boolean; daily_report_enabled: boolean; daily_report_time: string; daily_report_org_wide: boolean }>(
    `SELECT auto_clock_in, reminders, daily_report_enabled, to_char(daily_report_time, 'HH24:MI') AS daily_report_time, daily_report_org_wide FROM brenda_settings WHERE organisation_id = $1`, [orgId]);
  return {
    autoClockIn: r?.auto_clock_in ?? false, reminders: r?.reminders ?? true,
    dailyReportEnabled: r?.daily_report_enabled ?? true, dailyReportTime: r?.daily_report_time ?? "18:00", dailyReportOrgWide: r?.daily_report_org_wide ?? true,
  };
}

export async function brendaPrefs(db: Db, membershipId: string): Promise<BrendaPrefs> {
  const r = await db.maybeOne<{ auto_clock_in: boolean; reminders: boolean }>(`SELECT auto_clock_in, reminders FROM brenda_member_prefs WHERE membership_id = $1`, [membershipId]);
  return { autoClockIn: r?.auto_clock_in ?? true, reminders: r?.reminders ?? true };
}

export const settingsSchema = z.object({ autoClockIn: z.boolean().optional(), reminders: z.boolean().optional() });

/** The organisation's switches, which add the daily team report to the person's own two. Times are "HH:MM", 24-hour. */
export const orgSettingsSchema = settingsSchema.extend({
  dailyReportEnabled: z.boolean().optional(),
  dailyReportTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a 24-hour time such as 18:00.").optional(),
  dailyReportOrgWide: z.boolean().optional(),
});

/** The organisation's switches (owners and HR). */
export async function setBrendaSettings(ctx: OrgContext, input: z.infer<typeof orgSettingsSchema>) {
  if (ctx.membership.role !== "owner" && ctx.membership.role !== "hr") throw forbidden("Only the organisation owner or HR can change what Brenda may do here.");
  return withUser(ctx.user.profileId, async (db) => {
    // Each change names only what it changes (Settings saves a switch the moment it moves), so two at once take turns:
    // otherwise both read the same row and the second write puts back what the first changed.
    await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`brenda_settings:${ctx.org.id}`]);
    const cur = await brendaSettings(db, ctx.org.id);
    const next: BrendaSettings = {
      autoClockIn: input.autoClockIn ?? cur.autoClockIn, reminders: input.reminders ?? cur.reminders,
      dailyReportEnabled: input.dailyReportEnabled ?? cur.dailyReportEnabled, dailyReportTime: input.dailyReportTime ?? cur.dailyReportTime, dailyReportOrgWide: input.dailyReportOrgWide ?? cur.dailyReportOrgWide,
    };
    await db.query(
      `INSERT INTO brenda_settings(organisation_id, auto_clock_in, reminders, daily_report_enabled, daily_report_time, daily_report_org_wide, updated_by, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (organisation_id) DO UPDATE SET auto_clock_in = $2, reminders = $3, daily_report_enabled = $4, daily_report_time = $5, daily_report_org_wide = $6, updated_by = $7, updated_at = now()`,
      [ctx.org.id, next.autoClockIn, next.reminders, next.dailyReportEnabled, next.dailyReportTime, next.dailyReportOrgWide, ctx.membership.id]);
    const report = next.dailyReportEnabled ? `daily team report at ${next.dailyReportTime}${next.dailyReportOrgWide ? ", whole organisation for owners and HR" : ""}` : "daily team report off";
    await logAction(db, ctx, { tool: "settings", summary: `Organisation settings: automatic clock-in ${next.autoClockIn ? "on" : "off"}, reminders ${next.reminders ? "on" : "off"}, ${report}`, outcome: "done", source: "confirm" });
    return next;
  });
}

/** The person's own switches, inside what the organisation allows. */
export async function setBrendaPrefs(ctx: OrgContext, input: z.infer<typeof settingsSchema>) {
  return withUser(ctx.user.profileId, async (db) => {
    const cur = await brendaPrefs(db, ctx.membership.id);
    const next = { autoClockIn: input.autoClockIn ?? cur.autoClockIn, reminders: input.reminders ?? cur.reminders };
    await db.query(
      `INSERT INTO brenda_member_prefs(membership_id, organisation_id, auto_clock_in, reminders, updated_at) VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (membership_id) DO UPDATE SET auto_clock_in = $3, reminders = $4, updated_at = now()`,
      [ctx.membership.id, ctx.org.id, next.autoClockIn, next.reminders]);
    return next;
  });
}

/**
 * Everything the settings and profile pages show about Brenda for this person. The log is about her actions: what she
 * read for someone to catch them up (source 'read') is theirs alone and lives on their Activity page (owner decision,
 * 8 October 2026: personal assistants, phase 3; row-level security hides it from owners and HR as well).
 */
export async function brendaOverview(ctx: OrgContext) {
  return withUser(ctx.user.profileId, async (db) => {
    const isOrg = ctx.membership.role === "owner" || ctx.membership.role === "hr";
    const [settings, prefs, actions] = await Promise.all([
      brendaSettings(db, ctx.org.id),
      brendaPrefs(db, ctx.membership.id),
      db.query<{ id: string; tool: string; summary: string; outcome: string; source: string; created_at: string; display_name: string }>(
        `SELECT a.id, a.tool, a.summary, a.outcome, a.source, a.created_at, pr.display_name
         FROM brenda_actions a JOIN memberships m ON m.id = a.membership_id JOIN profiles pr ON pr.id = m.user_id
         WHERE a.organisation_id = $1 AND a.source <> 'read' ${isOrg ? "" : "AND a.membership_id = $2"} ORDER BY a.created_at DESC LIMIT 30`, isOrg ? [ctx.org.id] : [ctx.org.id, ctx.membership.id]),
    ]);
    // The row's own summary, never the person's fuller words; a row that did not go through says what she tried.
    return { settings, prefs, actions: actions.map((a) => ({ ...a, summary: rowSummary(a, false) })) };
  });
}

// ---- The action log -----------------------------------------------------------------------------------

/**
 * One line of her log. `source` 'read' (migration 0037) is a catch-up read: what she read for the person, written by
 * server/services/catch-up only once 0037 is applied (owner decision, 8 October 2026: personal assistants, phase 3).
 */
export type ActionEntry = { tool: string; summary: string; outcome: "done" | "confirmed" | "refused" | "failed"; source?: "chat" | "confirm" | "automatic" | "read"; detail?: Record<string, unknown> };

export async function logAction(db: Db, ctx: OrgContext, e: ActionEntry) {
  await db.query(`INSERT INTO brenda_actions(organisation_id, membership_id, tool, summary, outcome, source, detail) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [ctx.org.id, ctx.membership.id, e.tool, e.summary.slice(0, 500), e.outcome, e.source ?? "chat", JSON.stringify(e.detail ?? {})]);
}

/** For callers outside a transaction (the chat loop). Never throws: a failed log must not undo a done action. */
export async function recordAction(ctx: OrgContext, e: ActionEntry) {
  try { await withUser(ctx.user.profileId, (db) => logAction(db, ctx, e)); } catch { /* logged best-effort */ }
}

// ---- The briefing -------------------------------------------------------------------------------------

type BriefTask = { id: string; title: string; status: string; due_at: string | null; assignee_name: string; progress_percent: number };

/**
 * "What's waiting for me today?" Everything here is read from the person's own data under their permissions:
 * their clock and timer, tasks due today and overdue, work waiting for their check, their own work waiting on someone
 * else's check, reminders set for today, and (for leads and organisation accounts) assignments nobody has picked up.
 */
export async function briefing(ctx: OrgContext) {
  const worker = ctx.membership.role === "employee" || ctx.membership.role === "manager";
  const [clock, session, queue, data] = await Promise.all([
    worker ? myClock(ctx) : Promise.resolve(null),
    worker ? currentSession(ctx) : Promise.resolve(null),
    ctx.membership.role === "employee" ? Promise.resolve(null) : reviewQueue(ctx),
    withUser(ctx.user.profileId, async (db) => {
      const tz = ctx.org.timezone;
      const today = localDate(new Date(), tz);
      const mine = await db.query<BriefTask & { due_local: string | null }>(
        `SELECT t.id, t.title, t.status, t.due_at, pa.display_name AS assignee_name, t.progress_percent::int AS progress_percent, (t.due_at AT TIME ZONE $3)::date::text AS due_local
         FROM tasks t JOIN memberships ma ON ma.id = t.assignee_membership_id JOIN profiles pa ON pa.id = ma.user_id
         WHERE t.organisation_id = $1 AND t.assignee_membership_id = $2 AND t.archived_at IS NULL AND t.status NOT IN ('completed')
         ORDER BY t.due_at NULLS LAST, t.created_at`, [ctx.org.id, ctx.membership.id, tz]);
      const dueToday = mine.filter((t) => t.status !== "in_review" && t.due_local === today && new Date(t.due_at!) >= new Date());
      const overdue = mine.filter((t) => t.status !== "in_review" && t.due_at && new Date(t.due_at) < new Date());
      const dueTomorrow = mine.filter((t) => t.status !== "in_review" && t.due_local && t.due_local > today && t.due_local <= addDays(today, 1));
      const waitingOnOthers = mine.filter((t) => t.status === "in_review");
      const open = mine.filter((t) => t.status !== "in_review");
      const unanswered = ctx.membership.role === "employee" ? [] : await db.query<BriefTask>(
        `SELECT t.id, t.title, t.status, t.due_at, pa.display_name AS assignee_name, t.progress_percent::int AS progress_percent
         FROM tasks t JOIN memberships ma ON ma.id = t.assignee_membership_id JOIN profiles pa ON pa.id = ma.user_id
         WHERE t.organisation_id = $1 AND t.created_by = $2 AND t.assignee_membership_id <> $2 AND t.archived_at IS NULL AND t.status = 'todo'
           AND t.created_at < now() - interval '24 hours' AND NOT EXISTS (SELECT 1 FROM work_sessions s WHERE s.task_id = t.id)
         ORDER BY t.created_at LIMIT 20`, [ctx.org.id, ctx.membership.id]);
      const reminders = await db.query<{ id: string; body: string; remind_at: string }>(
        `SELECT id, body, remind_at FROM brenda_reminders WHERE membership_id = $1 AND sent_at IS NULL AND cancelled_at IS NULL AND remind_at < now() + interval '24 hours' ORDER BY remind_at`, [ctx.membership.id]);
      return { today, open, dueToday, dueTomorrow, overdue, waitingOnOthers, unanswered, reminders };
    }),
  ]);
  const short = (t: BriefTask) => ({ id: t.id, title: t.title, status: t.status, due: t.due_at, progress: t.progress_percent });
  return {
    today: data.today,
    clock: clock ? { status: clock.status, workingDay: clock.workingDay, workStarts: clock.schedule.start_local, workEnds: clock.schedule.end_local } : null,
    timer: session?.session ? { task: session.session.taskTitle, taskId: session.session.taskId, state: session.session.state } : null,
    openTasks: data.open.length,
    dueToday: data.dueToday.map(short),
    dueTomorrow: data.dueTomorrow.map(short),
    overdue: data.overdue.map(short),
    waitingForTheirCheck: data.waitingOnOthers.map(short),
    waitingForYourReview: queue ? queue.submissions.map((s) => ({ taskId: s.task_id, title: s.title, from: s.assignee_name, submittedAt: s.submitted_at, youAreTheReviewer: s.reviewer_is_me })) : [],
    assignmentsNotPickedUp: data.unanswered.map((t) => ({ ...short(t), assignee: t.assignee_name })),
    remindersToday: data.reminders.map((r) => ({ id: r.id, body: r.body, at: r.remind_at })),
  };
}

function addDays(date: string, n: number) {
  const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}

// ---- Personal reminders -------------------------------------------------------------------------------

export const reminderSchema = z.object({ body: z.string().trim().min(1).max(500), remindAt: z.string().datetime({ offset: true }), taskId: z.string().uuid().nullable().optional() });

export async function createReminder(ctx: OrgContext, input: z.infer<typeof reminderSchema>) {
  const at = new Date(input.remindAt);
  if (at.getTime() < Date.now() - 60_000) throw invalid("That time has already passed. Pick a time later than now.", { remindAt: ["In the past."] });
  if (at.getTime() > Date.now() + 366 * 86_400_000) throw invalid("Reminders can be set up to a year ahead.", { remindAt: ["Too far ahead."] });
  return withUser(ctx.user.profileId, async (db) => {
    if (input.taskId) { const t = await db.maybeOne(`SELECT 1 FROM tasks WHERE id = $1 AND organisation_id = $2`, [input.taskId, ctx.org.id]); if (!t) throw notFound("That task is not visible to you."); }
    return db.one<{ id: string; remind_at: string }>(`INSERT INTO brenda_reminders(organisation_id, membership_id, body, remind_at, task_id) VALUES ($1, $2, $3, $4, $5) RETURNING id, remind_at`,
      [ctx.org.id, ctx.membership.id, input.body, at.toISOString(), input.taskId ?? null]);
  });
}

export async function listReminders(ctx: OrgContext) {
  return withUser(ctx.user.profileId, (db) => db.query<{ id: string; body: string; remind_at: string; task_id: string | null }>(
    `SELECT id, body, remind_at, task_id FROM brenda_reminders WHERE membership_id = $1 AND sent_at IS NULL AND cancelled_at IS NULL ORDER BY remind_at LIMIT 50`, [ctx.membership.id]));
}

export async function cancelReminder(ctx: OrgContext, id: string) {
  return withUser(ctx.user.profileId, async (db) => {
    const r = await db.query<{ body: string }>(`UPDATE brenda_reminders SET cancelled_at = now() WHERE id = $1 AND membership_id = $2 AND sent_at IS NULL AND cancelled_at IS NULL RETURNING body`, [id, ctx.membership.id]);
    if (!r.length) throw notFound("That reminder is not yours, already went off, or was cancelled.");
    return { id, body: r[0].body };
  });
}

// ---- Automatic clock-in --------------------------------------------------------------------------------

/**
 * Called when the person shows the first sign of work in Boredroom (the app is open and they interact with it).
 * Clocks them in only when all of these hold: the organisation switched automatic clock-in on, the person has not
 * switched it off, they hold work (staff or team lead), today is a working day, it is no earlier than an hour before
 * the start and before the end of the day, and they have not clocked in or out today. Logged and announced.
 */
export async function autoClockIn(ctx: OrgContext): Promise<{ clockedIn: boolean; at?: string; late?: boolean; reason?: string }> {
  if (ctx.membership.role !== "employee" && ctx.membership.role !== "manager") return { clockedIn: false, reason: "not_a_worker" };
  const allowed = await withUser(ctx.user.profileId, async (db) => ({ org: await brendaSettings(db, ctx.org.id), me: await brendaPrefs(db, ctx.membership.id) }));
  if (!allowed.org.autoClockIn) return { clockedIn: false, reason: "off_for_organisation" };
  if (!allowed.me.autoClockIn) return { clockedIn: false, reason: "off_for_person" };
  const c = await myClock(ctx);
  if (!c.workingDay) return { clockedIn: false, reason: "not_a_working_day" };
  if (c.status !== "not_in") return { clockedIn: false, reason: "already" };
  const now = Date.now();
  if (now < Date.parse(c.scheduledStartAt) - 60 * 60_000 || now >= Date.parse(c.scheduledEndAt)) return { clockedIn: false, reason: "outside_hours" };
  const r = await clockIn(ctx, undefined, { by: "brenda" });
  if (r.already) return { clockedIn: false, reason: "already" };
  const late = r.record.late_seconds > 0;
  await withUser(ctx.user.profileId, async (db) => {
    // Announced by the person's own assistant, by the name they gave it (owner decision, 7 October 2026: personal assistants).
    const { name } = await readPersonalAssistant(db, ctx.membership.id);
    await logAction(db, ctx, { tool: "auto_clock_in", summary: `Clocked you in automatically${late ? ", late" : ""}`, outcome: "done", source: "automatic", detail: { at: r.record.clock_in_at, lateSeconds: r.record.late_seconds } });
    await notify(db, { organisationId: ctx.org.id, recipientMembershipId: ctx.membership.id, type: "brenda.clock_in", title: `${name} clocked you in`, body: "Looks like you've started work. You can switch automatic clock-in off on your profile.", href: `/app/${ctx.org.slug}/clock`, dedupKey: `brenda.clock_in:${ctx.membership.id}:${c.today}` });
  });
  return { clockedIn: true, at: r.record.clock_in_at, late };
}

// ---- Scheduled nudges (worker) ---------------------------------------------------------------------------

/**
 * One pass, run every few minutes by the worker. Personal reminders that are due go out at once. The daily nudges go
 * out once per person per working day, an hour into the day, and only when both the organisation and the person keep
 * reminders on. Every nudge is built from data, deduplicated by key, and delivered as a notification.
 */
export async function brendaTick(now = new Date()) {
  return withWorker(async (db) => {
    let sent = 0;
    // Reminders and nudges name the person's own assistant (owner decision, 7 October 2026: personal assistants); before
    // migration 0035 there is no table to join, and everyone's is Brenda.
    const named = await assistantSchemaReady(db);
    const assistantJoin = (membership: string) => named ? `LEFT JOIN assistant_profiles ap ON ap.membership_id = ${membership}` : "";
    const assistantName = named ? "COALESCE(ap.name, 'Brenda')" : "'Brenda'::text";
    // Personal reminders.
    const due = await db.query<{ id: string; organisation_id: string; membership_id: string; body: string; task_id: string | null; slug: string; assistant_name: string }>(
      `SELECT r.id, r.organisation_id, r.membership_id, r.body, r.task_id, o.slug, ${assistantName} AS assistant_name FROM brenda_reminders r JOIN organisations o ON o.id = r.organisation_id
       ${assistantJoin("r.membership_id")}
       WHERE r.sent_at IS NULL AND r.cancelled_at IS NULL AND r.remind_at <= $1 ORDER BY r.remind_at LIMIT 200`, [now.toISOString()]);
    for (const r of due) {
      await notify(db, { organisationId: r.organisation_id, recipientMembershipId: r.membership_id, type: "brenda.reminder", title: `Reminder: ${r.body}`, body: `You asked ${r.assistant_name} to remind you.`, resourceType: r.task_id ? "task" : undefined, resourceId: r.task_id ?? undefined, href: r.task_id ? `/app/${r.slug}/tasks/${r.task_id}` : `/app/${r.slug}/notifications`, dedupKey: `brenda.reminder:${r.id}` });
      await db.query(`UPDATE brenda_reminders SET sent_at = now() WHERE id = $1`, [r.id]);
      sent++;
    }

    // Daily nudges, per organisation that keeps reminders on.
    const orgs = await db.query<{ id: string; slug: string; timezone: string; working_days: number[]; start_local: string }>(
      `SELECT o.id, o.slug, o.timezone, s.working_days, s.start_local::text AS start_local
       FROM organisations o
       LEFT JOIN brenda_settings b ON b.organisation_id = o.id
       JOIN LATERAL (SELECT working_days, start_local FROM schedules WHERE organisation_id = o.id AND membership_id IS NULL ORDER BY effective_from DESC, created_at DESC LIMIT 1) s ON true
       WHERE o.status = 'active' AND COALESCE(b.reminders, true)`);
    for (const org of orgs) {
      const today = localDate(now, org.timezone);
      if (!org.working_days.includes(weekdayOf(today))) continue;
      const [h, m] = org.start_local.split(":").map(Number);
      const localNow = new Intl.DateTimeFormat("en-GB", { timeZone: org.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now).split(":").map(Number);
      const minutesIn = localNow[0] * 60 + localNow[1] - (h * 60 + m);
      if (minutesIn < 60) continue; // an hour into the day, so people have settled in first
      const href = (p: string) => `/app/${org.slug}${p}`;
      const people = await db.query<{ id: string; role: string; assistant_name: string }>(
        `SELECT m.id, m.role, ${assistantName} AS assistant_name FROM memberships m LEFT JOIN brenda_member_prefs p ON p.membership_id = m.id ${assistantJoin("m.id")}
         WHERE m.organisation_id = $1 AND m.status = 'active' AND COALESCE(p.reminders, true)`, [org.id]);
      for (const person of people) {
        const key = (k: string) => `brenda.${k}:${person.id}:${today}`;
        // Due tomorrow.
        const tomorrow = await db.query<{ title: string }>(
          `SELECT title FROM tasks WHERE assignee_membership_id = $1 AND archived_at IS NULL AND status NOT IN ('completed','in_review')
             AND (due_at AT TIME ZONE $2)::date = ($3::date + 1)`, [person.id, org.timezone, today]);
        if (tomorrow.length) { await notify(db, { organisationId: org.id, recipientMembershipId: person.id, type: "brenda.nudge", title: tomorrow.length === 1 ? `“${tomorrow[0].title}” is due tomorrow` : `You have ${tomorrow.length} tasks due tomorrow`, body: tomorrow.length > 1 ? tomorrow.slice(0, 5).map((t) => t.title).join(", ") : undefined, href: href("/tasks?status=open"), dedupKey: key("due_tomorrow") }); sent++; }
        // Waiting for this person's review since yesterday or earlier.
        if (person.role !== "employee" && person.role !== "owner" && person.role !== "hr") {
          const waiting = await db.query<{ title: string }>(
            `SELECT t.title FROM tasks t JOIN LATERAL (SELECT submitted_at FROM task_submissions WHERE task_id = t.id ORDER BY revision DESC LIMIT 1) s ON true
             WHERE t.organisation_id = $1 AND t.status = 'in_review' AND t.reviewer_membership_id = $2 AND s.submitted_at < now() - interval '20 hours'`, [org.id, person.id]);
          if (waiting.length) { await notify(db, { organisationId: org.id, recipientMembershipId: person.id, type: "brenda.nudge", title: waiting.length === 1 ? `“${waiting[0].title}” has been waiting for your review since yesterday` : `${waiting.length} tasks have been waiting for your review since yesterday`, href: href("/reviews"), dedupKey: key("review_waiting") }); sent++; }
        }
        // Assignments this person handed out that nobody has picked up in a day.
        if (person.role !== "employee") {
          const quiet = await db.query<{ title: string; assignee: string }>(
            `SELECT t.title, pa.display_name AS assignee FROM tasks t JOIN memberships ma ON ma.id = t.assignee_membership_id JOIN profiles pa ON pa.id = ma.user_id
             WHERE t.organisation_id = $1 AND t.created_by = $2 AND t.assignee_membership_id <> $2 AND t.archived_at IS NULL AND t.status = 'todo'
               AND t.created_at < now() - interval '24 hours' AND NOT EXISTS (SELECT 1 FROM work_sessions s WHERE s.task_id = t.id)
               AND NOT EXISTS (SELECT 1 FROM task_comments c WHERE c.task_id = t.id AND c.author_membership_id = t.assignee_membership_id)
             ORDER BY t.created_at LIMIT 5`, [org.id, person.id]);
          if (quiet.length) { await notify(db, { organisationId: org.id, recipientMembershipId: person.id, type: "brenda.nudge", title: quiet.length === 1 ? `${quiet[0].assignee} hasn't picked up “${quiet[0].title}” yet` : `${quiet.length} tasks you assigned haven't been picked up yet`, body: quiet.length > 1 ? quiet.map((q) => `${q.title} (${q.assignee})`).join(", ") : undefined, href: href("/tasks?status=assigned"), dedupKey: key("not_picked_up") }); sent++; }
        }
        // Started a task, clocked in for a while, but no timer running.
        if (person.role === "employee" || person.role === "manager") {
          const started = await db.maybeOne<{ title: string }>(
            `SELECT t.title FROM tasks t
             WHERE t.assignee_membership_id = $1 AND t.archived_at IS NULL AND t.status = 'in_progress'
               AND EXISTS (SELECT 1 FROM attendance_days a WHERE a.membership_id = $1 AND a.local_date = $2::date AND a.clock_out_at IS NULL AND a.clock_in_at < now() - interval '30 minutes')
               AND NOT EXISTS (SELECT 1 FROM work_sessions s WHERE s.membership_id = $1 AND s.state IN ('running','paused','interrupted'))
             ORDER BY t.updated_at DESC LIMIT 1`, [person.id, today]);
          if (started) { await notify(db, { organisationId: org.id, recipientMembershipId: person.id, type: "brenda.nudge", title: `You started “${started.title}” but its timer isn't running`, body: `Start it from your to-dos, or ask ${person.assistant_name} to start it.`, href: href("/todos"), dedupKey: key("no_timer") }); sent++; }
        }
      }
    }
    return { sent };
  });
}
