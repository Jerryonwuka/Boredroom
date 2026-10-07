/**
 * Brenda's end-of-day team report (owner decision, 5 October 2026: the Reports page is removed; "For reports going
 * forward, Brenda will handle that automatically by sending supervisors reports of what their team did at the end of
 * every day. The time it sends reports can be set in settings.").
 *
 * Who gets one: every team lead who leads a live team (about their teams, as work-summary.ts scopes them), and the
 * owner and HR (about the whole organisation) while the organisation keeps that on. What it says, per person: confirmed
 * hours, what they finished and sent for review, what is in progress and how far along, anything overdue or blocked,
 * and attendance (late, or not clocked in on a working day); then a short list of what needs the reader's attention.
 *
 * It is built as the recipient, under their row-level security, from the same summary Brenda's work_summary tool uses,
 * so it never shows more than their own pages would. It is saved as a private document in their Docs (folder "Daily
 * reports"), announced with a notification and, when mail is set up, a short email with the link. A log row per
 * recipient per day makes the end-of-day send happen once however often the job runs. A report asked for during the day
 * (Brenda's team_report tool, the button in Settings) is saved the same way, lands only on the person asking, and is
 * refreshed on each ask until they edit it; the end-of-day run refreshes it a last time and sends it.
 *
 * Plain counts, not a score: nobody is ranked or judged.
 */
import { withUser, withWorker, type Db } from "@/server/db";
import type { OrgContext } from "@/server/lib/api";
import { resolveEntitlements } from "@/server/lib/entitlements";
import { mail, mailConfigProblem } from "@/server/lib/mail";
import { renderEmail } from "@/server/lib/emails";
import { localParts, todayLocal } from "@/server/lib/time";
import { audit, notify } from "@/server/services/common";
import { brendaSettings, logAction, type BrendaSettings } from "@/server/services/brenda";
import { resolveAssistant } from "@/server/services/assistant";
import { DOC_BODY_MAX } from "@/server/services/docs";
import { workSummary, type PersonWork, type WorkSummary } from "@/server/services/work-summary";

export const REPORT_FOLDER = "Daily reports";

// ---- Who receives it -------------------------------------------------------------------------------------

/**
 * The people who get the end-of-day report. A team lead (role manager) who leads at least one live team, which is the
 * team scope work-summary.ts gives them; and, while orgWide is on, the owner and HR, who see the whole organisation.
 */
export async function reportRecipients(db: Db, orgId: string, orgWide: boolean): Promise<{ id: string; role: string }[]> {
  return db.query<{ id: string; role: string }>(
    `SELECT m.id, m.role FROM memberships m
     WHERE m.organisation_id = $1 AND m.status = 'active' AND (
       (m.role = 'manager' AND EXISTS (SELECT 1 FROM team_members tm JOIN teams t ON t.id = tm.team_id WHERE tm.membership_id = m.id AND tm.is_manager AND t.archived_at IS NULL))
       OR ($2::boolean AND m.role IN ('owner', 'hr')))
     ORDER BY m.created_at`, [orgId, orgWide]);
}

/** Why the person cannot have a team report, or null when they can (asked for: owner and HR always may). */
async function refusalFor(ctx: OrgContext): Promise<string | null> {
  const role = ctx.membership.role;
  if (role === "owner" || role === "hr") return null;
  if (role === "employee") return "The team report is for team leads, the owner and HR. Ask me what you got done today instead, or look at your To-dos.";
  const leads = await withUser(ctx.user.profileId, (db) => db.maybeOne(
    `SELECT 1 FROM team_members tm JOIN teams t ON t.id = tm.team_id WHERE tm.membership_id = $1 AND tm.is_manager AND t.archived_at IS NULL LIMIT 1`, [ctx.membership.id]));
  return leads ? null : "You do not lead a team yet, so there is no team report to write. The owner or HR can make you the lead of a team on the People page.";
}

// ---- Building it ------------------------------------------------------------------------------------------

export type PersonDay = PersonWork & {
  inProgress: { title: string; progress: number }[];
  blocked: { title: string; reason: string | null }[];
  /** clockedInAt is null when they did not clock in; missing only on a working day the organisation clocks at all. */
  attendance: { clockedInAt: string | null; lateMinutes: number; missing: boolean };
};

export type DailyReport = {
  localDate: string; title: string; scope: WorkSummary["scope"]; people: PersonDay[]; totals: WorkSummary["totals"];
  headline: string; attention: string[]; waitingForYourReview: number;
  /** Nothing happened in the scope and nothing needs a word (attendance, overdue or blocked work, reviews): nothing is sent. */
  empty: boolean;
};

type Extra = {
  tasks: { membershipId: string; title: string; status: "in_progress" | "blocked"; progress: number; reason: string | null }[];
  attendance: { membershipId: string; clockInAt: string; lateSeconds: number }[];
  clocking: boolean; waitingForYou: number;
};

/** "Monday 5 October" for a local date. */
export function dayLabel(localDate: string): string {
  return new Date(`${localDate}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}
const hhmm = (at: Date | string, tz: string) => { const p = localParts(new Date(at), tz); return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`; };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const hours = (h: number) => h === 0 ? "no confirmed hours" : `${h} confirmed ${h === 1 ? "hour" : "hours"}`;
/** Names and titles go into markdown as text, never as markup. */
const md = (s: string) => s.replace(/[\\`*_[\]|~<>#]/g, "\\$&");
/** "a, b and c". */
function listOf(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
const sentence = (s: string) => s ? `${s[0].toUpperCase()}${s.slice(1)}` : s;

/**
 * Today's report for the person, as of now, in the organisation's time zone. Reads as them: the people are exactly
 * those work_summary shows them (a team lead's teams and themself; everyone who holds work for the owner and HR).
 * `useAssistant` false keeps Claude out of it (the smoke script); otherwise Claude writes the headline when connected.
 */
export async function buildDailyReport(ctx: OrgContext, opts: { useAssistant?: boolean } = {}): Promise<DailyReport> {
  const summary = await workSummary(ctx, { period: "today" });
  const localDate = summary.from;
  const ids = summary.people.map((p) => p.membershipId);
  // One statement for everything work_summary does not hold: in-progress and blocked work, today's clock-ins, whether
  // the organisation clocks at all today, and what is waiting for the reader's own review.
  const extra = await withUser(ctx.user.profileId, (db) => db.one<Extra>(
    `SELECT
       (SELECT COALESCE(json_agg(x ORDER BY x.updated_at DESC), '[]'::json) FROM (
          SELECT t.assignee_membership_id AS "membershipId", t.title, t.status, t.progress_percent::int AS progress, t.blocked_reason AS reason, t.updated_at
          FROM tasks t WHERE t.organisation_id = $1 AND t.assignee_membership_id = ANY($2::uuid[]) AND t.archived_at IS NULL AND t.status IN ('in_progress', 'blocked')) x) AS tasks,
       (SELECT COALESCE(json_agg(json_build_object('membershipId', a.membership_id, 'clockInAt', a.clock_in_at, 'lateSeconds', a.late_seconds)), '[]'::json)
          FROM attendance_days a WHERE a.membership_id = ANY($2::uuid[]) AND a.local_date = $3::date) AS attendance,
       app_anyone_clocked_in($1, $3::date) AS clocking,
       (SELECT count(*)::int FROM tasks t WHERE t.organisation_id = $1 AND t.status = 'in_review' AND t.reviewer_membership_id = $4 AND t.archived_at IS NULL) AS "waitingForYou"`,
    [ctx.org.id, ids, localDate, ctx.membership.id]));
  // work_summary counts today's working day when today is one; "did not clock in" is said only then, and only when
  // somebody in the organisation clocked in today (a workspace that does not use the clock is not flagged every day).
  const flagMissing = summary.workingDays > 0 && extra.clocking;
  const people: PersonDay[] = summary.people.map((p) => {
    const mine = extra.tasks.filter((t) => t.membershipId === p.membershipId);
    const att = extra.attendance.find((a) => a.membershipId === p.membershipId);
    return {
      ...p,
      inProgress: mine.filter((t) => t.status === "in_progress").map((t) => ({ title: t.title, progress: t.progress })),
      blocked: mine.filter((t) => t.status === "blocked").map((t) => ({ title: t.title, reason: t.reason?.trim() || null })),
      attendance: { clockedInAt: att?.clockInAt ?? null, lateMinutes: att && att.lateSeconds > 0 ? Math.max(1, Math.round(att.lateSeconds / 60)) : 0, missing: !att && flagMissing },
    };
  });
  // A report goes out when something happened or something needs the reader; a scope with neither sends nothing.
  // Overdue or blocked work and reviews waiting for the reader count as needing them, even on a quiet day.
  const active = people.some((p) => p.trackedSeconds > 0 || p.tasksCompleted > 0 || p.submittedForReview > 0);
  const issues = extra.waitingForYou > 0 || people.some((p) => p.attendance.lateMinutes > 0 || p.attendance.missing || p.overdueOpen > 0 || p.blocked.length > 0);
  const empty = !active && !issues;
  const attention = attentionList(people, extra.waitingForYou);
  const plain = plainHeadline(ctx, summary, people);
  const headline = opts.useAssistant === false || empty ? plain : (await assistantHeadline(ctx, summary, people, attention)) ?? plain;
  return {
    localDate, title: `Team report, ${dayLabel(localDate)}`, scope: summary.scope, people, totals: summary.totals,
    headline, attention, waitingForYourReview: extra.waitingForYou, empty,
  };
}

function attentionList(people: PersonDay[], waitingForYou: number): string[] {
  const out: string[] = [];
  for (const p of people) {
    if (p.overdueOpen) {
      const more = p.overdueOpen - p.overdueTitles.length;
      out.push(`${md(p.name)}: ${listOf(p.overdueTitles.map((t) => `“${md(t)}”`))}${more > 0 ? ` and ${plural(more, "more task")}` : ""} ${p.overdueOpen === 1 ? "is" : "are"} overdue`);
    }
    for (const b of p.blocked) out.push(`${md(p.name)}: “${md(b.title)}” is blocked${b.reason ? ` (${md(b.reason.slice(0, 160))})` : ""}`);
  }
  if (waitingForYou) out.push(`${plural(waitingForYou, "task")} ${waitingForYou === 1 ? "is" : "are"} waiting for your review`);
  const missing = people.filter((p) => p.attendance.missing).map((p) => md(p.name));
  if (missing.length) out.push(`Did not clock in: ${listOf(missing)}`);
  const late = people.filter((p) => p.attendance.lateMinutes > 0).map((p) => `${md(p.name)} (${plural(p.attendance.lateMinutes, "minute")})`);
  if (late.length) out.push(`Late: ${listOf(late)}`);
  return out;
}

function plainHeadline(ctx: OrgContext, s: WorkSummary, people: PersonDay[]): string {
  const who = s.scope === "organisation" ? `Across ${ctx.org.name}, people` : "Your team";
  const done = s.totals.tasksCompleted ? `finished ${plural(s.totals.tasksCompleted, "task")}` : "finished no tasks";
  const sent = s.totals.submittedForReview ? `, with ${plural(s.totals.submittedForReview, "task")} sent for review` : "";
  const first = `${who} logged ${hours(s.totals.trackedHours)} today and ${done}${sent}.`;
  const missing = people.filter((p) => p.attendance.missing).map((p) => p.name);
  const late = people.filter((p) => p.attendance.lateMinutes > 0).map((p) => p.name);
  const parts = [
    s.totals.overdueOpen ? `${plural(s.totals.overdueOpen, "task")} ${s.totals.overdueOpen === 1 ? "is" : "are"} overdue` : null,
    s.totals.blockedTasks ? `${plural(s.totals.blockedTasks, "task")} ${s.totals.blockedTasks === 1 ? "is" : "are"} blocked` : null,
    missing.length ? (missing.length <= 2 ? `${listOf(missing)} did not clock in` : `${missing.length} people did not clock in`) : null,
    late.length ? (late.length <= 2 ? `${listOf(late)} ${late.length === 1 ? "was" : "were"} late` : `${late.length} people were late`) : null,
  ].filter((x): x is string => !!x);
  // Semicolons between the parts: names inside them are already joined with "and".
  return `${first} ${parts.length ? `${sentence(parts.join("; "))}.` : "Nothing is overdue or blocked."}`;
}

/**
 * Claude's two sentences, or null (not connected, slow, refused or odd): the plain headline is used instead. Low effort
 * keeps it quick; a model that does not take an effort setting (the organisation picks the model) is asked again
 * without one rather than losing the headline.
 */
async function assistantHeadline(ctx: OrgContext, s: WorkSummary, people: PersonDay[], attention: string[]): Promise<string | null> {
  try {
    const conn = await resolveAssistant(ctx.org.id);
    if (!conn) return null;
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: conn.apiKey, maxRetries: 0, timeout: 12_000 });
    const facts = {
      scope: s.scope === "organisation" ? `the whole of ${ctx.org.name}` : "the reader's team",
      totals: s.totals,
      people: people.map((p) => ({ name: p.name, confirmedHours: p.trackedHours, finished: p.tasksCompleted, sentForReview: p.submittedForReview, inProgress: p.inProgress.length, overdue: p.overdueOpen, blocked: p.blockedTasks, lateMinutes: p.attendance.lateMinutes || undefined, didNotClockIn: p.attendance.missing || undefined })),
      needsAttention: attention,
    };
    const ask = (effort: boolean) => client.messages.create({
      model: conn.model,
      max_tokens: 2048,
      ...(effort ? { output_config: { effort: "low" as const } } : {}),
      system: "You write the headline of Brenda's end-of-day team report in Boredroom, a work tracker for remote teams. Write exactly two plain sentences in British English for the supervisor reading it: what the people got done today (hours and finished work), then the most important thing that needs their attention, or that nothing does. Use only the facts given; never invent, rank, praise or blame anyone. No markdown, no lists, no greeting, at most 60 words.",
      messages: [{ role: "user", content: JSON.stringify(facts) }],
    });
    const res = await ask(true).catch((err: unknown) => { if (err instanceof Anthropic.BadRequestError) return ask(false); throw err; });
    if (res.stop_reason !== "end_turn") return null;
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("").replace(/\s+/g, " ").trim();
    return text && text.length <= 420 && !/[#*`]/.test(text) ? text : null;
  } catch {
    return null;
  }
}

/** The document: Brenda's line, the headline, a section per person, then what needs attention. */
export function reportMarkdown(ctx: OrgContext, r: DailyReport, opts: { writtenAt: Date; endOfDay: boolean; reportTime: string }): string {
  const tz = ctx.org.timezone;
  const by = opts.endOfDay
    ? `_Brenda wrote this end-of-day report for you at ${hhmm(opts.writtenAt, tz)} on ${dayLabel(r.localDate)}, from what was recorded in Boredroom. Only you can read it._`
    : `_Brenda wrote this for you at ${hhmm(opts.writtenAt, tz)} on ${dayLabel(r.localDate)}, when you asked, from what was recorded in Boredroom so far. The end-of-day report at ${opts.reportTime} brings it up to date. Only you can read it._`;
  const lines = [by, "", `**${md(r.headline)}**`, ""];
  const quiet: string[] = [];
  for (const p of r.people) {
    const notes: string[] = [];
    if (p.completedTitles.length) notes.push(`- Finished: ${p.completedTitles.map(md).join(", ")}${p.tasksCompleted > p.completedTitles.length ? ` and ${plural(p.tasksCompleted - p.completedTitles.length, "more")}` : ""}`);
    if (p.submittedTitles.length) notes.push(`- Sent for review: ${p.submittedTitles.map(md).join(", ")}`);
    if (p.inProgress.length) notes.push(`- In progress: ${p.inProgress.slice(0, 8).map((t) => `${md(t.title)} (${t.progress}%)`).join(", ")}${p.inProgress.length > 8 ? ` and ${plural(p.inProgress.length - 8, "more")}` : ""}`);
    if (p.overdueOpen) notes.push(`- Overdue: ${p.overdueTitles.map(md).join(", ")}${p.overdueOpen > p.overdueTitles.length ? ` and ${plural(p.overdueOpen - p.overdueTitles.length, "more")}` : ""}`);
    if (p.blocked.length) notes.push(`- Blocked: ${p.blocked.slice(0, 5).map((b) => `${md(b.title)}${b.reason ? ` (${md(b.reason.slice(0, 160))})` : ""}`).join(", ")}`);
    const a = p.attendance;
    if (a.clockedInAt) notes.push(`- Attendance: clocked in at ${hhmm(a.clockedInAt, tz)}${a.lateMinutes ? `, ${plural(a.lateMinutes, "minute")} late` : ""}`);
    else if (a.missing) notes.push("- Attendance: did not clock in");
    if (!notes.length && !p.trackedSeconds) { quiet.push(md(p.name)); continue; }
    lines.push(`## ${md(p.name)}`, "", `${p.teams.length ? `${p.teams.map(md).join(", ")}. ` : ""}${sentence(hours(p.trackedHours))}.`, "", ...notes, "");
  }
  if (quiet.length) lines.push(`Nothing recorded today for ${listOf(quiet)}.`, "");
  lines.push("## Needs your attention", "");
  const shown = r.attention.slice(0, 10);
  if (shown.length) lines.push(...shown.map((x) => `- ${x}`), ...(r.attention.length > shown.length ? [`- And ${plural(r.attention.length - shown.length, "more item")} in the sections above`] : []));
  else lines.push("Nothing needs your attention today.");
  const body = lines.join("\n").trimEnd();
  return body.length <= DOC_BODY_MAX ? body : `${body.slice(0, DOC_BODY_MAX - 80).replace(/\n[^\n]*$/, "")}\n\n_The rest did not fit in one document._`;
}

// ---- Saving and sending -----------------------------------------------------------------------------------

export type Saved = { docId: string; title: string; headline: string; href: string; people: number };
type Outcome = { status: "sent" | "saved" | "existing" | "already_sent"; saved?: Saved } | { status: "nothing" };

/** The headline back out of a saved report (the bold line under Brenda's), for a report that is not rebuilt. */
const headlineOf = (body: string) => /^\*\*(.+)\*\*$/m.exec(body)?.[1]?.replace(/\\(.)/g, "$1") ?? "";

/**
 * Builds and saves today's report as the person. endOfDay: the scheduled send, once per day (sent_at), with a
 * notification. Otherwise the person asked: today's sent report is returned as it is, or the report so far is
 * written (or refreshed, if they have not edited it since) and lands only on them.
 */
async function deliver(ctx: OrgContext, mode: "end_of_day" | "asked", opts: { useAssistant?: boolean; reportTime: string }): Promise<Outcome> {
  const today = todayLocal(ctx.org.timezone);
  const href = (id: string) => `/app/${ctx.org.slug}/docs/${id}`;
  type Row = { id: string; doc_id: string | null; sent_at: string | null; title: string | null; body: string | null; readable: boolean };
  const rowSql = `SELECT l.id, l.doc_id, l.sent_at, d.title, d.body, (d.id IS NOT NULL AND d.archived_at IS NULL) AS readable
                  FROM brenda_report_log l LEFT JOIN documents d ON d.id = l.doc_id WHERE l.membership_id = $1 AND l.local_date = $2`;
  const existing = (row: Row): Outcome => ({ status: mode === "end_of_day" ? "already_sent" : "existing", saved: { docId: row.doc_id!, title: row.title ?? "", headline: headlineOf(row.body ?? ""), href: href(row.doc_id!), people: 0 } });
  // A cheap look first: a second run on the same day costs one query.
  const before = await withUser(ctx.user.profileId, (db) => db.maybeOne<Row>(rowSql, [ctx.membership.id, today]));
  if (before?.sent_at && (mode === "end_of_day" || before.readable)) return mode === "end_of_day" ? { status: "already_sent" } : existing(before);

  const report = await buildDailyReport(ctx, { useAssistant: opts.useAssistant });
  if (report.empty) return { status: "nothing" };
  // Asked for after the end-of-day report went out (and was archived since): it is written as the day's report, not "so far".
  const body = reportMarkdown(ctx, report, { writtenAt: new Date(), endOfDay: mode === "end_of_day" || !!before?.sent_at, reportTime: opts.reportTime });

  return withUser(ctx.user.profileId, async (db) => {
    // The day's row, created if need be and locked: two runs for the same person and day take turns here, and the
    // second sees what the first wrote.
    await db.query(`INSERT INTO brenda_report_log(organisation_id, membership_id, local_date) VALUES ($1, $2, $3) ON CONFLICT (membership_id, local_date) DO NOTHING`, [ctx.org.id, ctx.membership.id, report.localDate]);
    const row = await db.one<Row>(`${rowSql} FOR UPDATE OF l`, [ctx.membership.id, report.localDate]);
    if (row.sent_at && (mode === "end_of_day" || row.readable)) return mode === "end_of_day" ? { status: "already_sent" as const } : existing(row);
    // Refresh the report already written today, unless the person edited or archived it since (then a new one).
    const refreshed = row.doc_id ? await db.maybeOne<{ id: string }>(
      `UPDATE documents d SET title = $2, body = $3, updated_at = clock_timestamp() FROM brenda_report_log l
       WHERE l.id = $1 AND d.id = l.doc_id AND d.archived_at IS NULL AND d.updated_at = l.written_at RETURNING d.id`, [row.id, report.title, body]) : null;
    const docId = refreshed?.id ?? (await db.one<{ id: string }>(
      `INSERT INTO documents(organisation_id, created_by, title, body, folder, visibility) VALUES ($1, $2, $3, $4, $5, 'private') RETURNING id`,
      [ctx.org.id, ctx.membership.id, report.title, body, REPORT_FOLDER])).id;
    if (!refreshed) await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "document.created", subjectType: "document", subjectId: docId, subjectMembershipId: ctx.membership.id, metadata: { title: report.title, visibility: "private", teamId: null, by: "brenda", kind: "daily_report" } });
    await db.query(`UPDATE brenda_report_log SET doc_id = $2, written_at = (SELECT updated_at FROM documents WHERE id = $2), sent_at = CASE WHEN $3 THEN now() ELSE sent_at END WHERE id = $1`, [row.id, docId, mode === "end_of_day"]);
    if (mode === "end_of_day") {
      await notify(db, { organisationId: ctx.org.id, recipientMembershipId: ctx.membership.id, type: "brenda.daily_report", title: `Your team report for ${dayLabel(report.localDate)} is ready`, body: report.headline.slice(0, 300), resourceType: "document", resourceId: docId, href: href(docId), dedupKey: `brenda.daily_report:${report.localDate}` });
    }
    await logAction(db, ctx, { tool: "team_report", summary: `${mode === "end_of_day" ? "Sent you" : refreshed ? "Brought up to date" : "Wrote you"} the team report for ${dayLabel(report.localDate)}`, outcome: "done", source: mode === "end_of_day" ? "automatic" : "chat", detail: { docId, people: report.people.length } });
    return { status: mode === "end_of_day" ? "sent" as const : "saved" as const, saved: { docId, title: report.title, headline: report.headline, href: href(docId), people: report.people.length } };
  });
}

export type TeamReportNow =
  | { status: "refused"; message: string }
  | { status: "nothing"; message: string }
  | ({ status: "saved" | "existing"; endOfDay: boolean } & Saved);

/**
 * "Send me today's report now": Brenda's team_report tool and the button in Settings. Team leads of a live team, the
 * owner and HR; anyone else is refused. It lands only on the person asking (no notification, no email), so it needs no
 * confirmation. Once today's end-of-day report has gone out, that is the one returned.
 */
export async function teamReportNow(ctx: OrgContext, opts: { useAssistant?: boolean } = {}): Promise<TeamReportNow> {
  const refusal = await refusalFor(ctx);
  if (refusal) return { status: "refused", message: refusal };
  const settings = await withUser(ctx.user.profileId, (db) => brendaSettings(db, ctx.org.id));
  const r = await deliver(ctx, "asked", { useAssistant: opts.useAssistant, reportTime: settings.dailyReportTime });
  if (r.status === "nothing" || !("saved" in r) || !r.saved) return { status: "nothing", message: "Nothing has happened on your teams today yet and nothing needs you (no confirmed time, nothing finished or sent for review, nothing overdue or blocked, no late or missing clock-ins), so there is no report to write." };
  return { status: r.status === "existing" ? "existing" : "saved", endOfDay: r.status === "existing", ...r.saved };
}

// ---- The scheduled send (worker) ------------------------------------------------------------------------------

type Recipient = { org_id: string; slug: string; name: string; timezone: string; current_policy_id: string | null; status: string; membership_id: string; role: OrgContext["membership"]["role"]; employee_code: string; profile_id: string; auth_user_id: string; display_name: string; email: string; email_verified_at: string | null };

/** The recipient as a signed-in person would be, so the report is built under their own row-level security. */
async function recipientContext(db: Db, organisationId: string, membershipId: string): Promise<{ ctx: OrgContext; email: string | null } | null> {
  const r = await db.maybeOne<Recipient>(
    `SELECT o.id AS org_id, o.slug, o.name, o.timezone, o.current_policy_id, o.status, m.id AS membership_id, m.role, m.employee_code,
            p.id AS profile_id, u.id AS auth_user_id, p.display_name, u.email, u.email_verified_at
     FROM memberships m JOIN organisations o ON o.id = m.organisation_id JOIN profiles p ON p.id = m.user_id JOIN auth_users u ON u.id = p.auth_user_id
     WHERE m.id = $1 AND m.organisation_id = $2 AND m.status = 'active' AND u.status = 'active'`, [membershipId, organisationId]);
  if (!r) return null;
  return {
    ctx: {
      user: { profileId: r.profile_id, authUserId: r.auth_user_id, email: r.email, displayName: r.display_name, emailVerified: !!r.email_verified_at, sessionId: "brenda.daily_report" },
      org: { id: r.org_id, slug: r.slug, name: r.name, timezone: r.timezone, current_policy_id: r.current_policy_id, status: r.status },
      membership: { id: r.membership_id, role: r.role, employee_code: r.employee_code },
      plan: await resolveEntitlements(db, r.org_id),
    },
    email: r.email_verified_at ? r.email : null,
  };
}

export type JobResult = { status: "sent" | "already_sent" | "nothing" | "off" | "stale" | "plan" | "not_a_recipient"; docId?: string; emailed?: boolean };

/**
 * One recipient's end-of-day report (the "brenda.daily_report" job). Checked again when it runs, since things change
 * between scheduling and sending: the report still on, still today in the organisation, Brenda in the plan, the person
 * still a recipient. Re-running it is a no-op once sent. The email goes after the report is saved; a failed email does
 * not undo the report (the notification and the document are there).
 */
export async function runDailyReportJob(p: { organisationId: string; membershipId: string; localDate: string }, opts: { useAssistant?: boolean } = {}): Promise<JobResult> {
  type Pre = { skip: "off" | "stale" | "plan" | "not_a_recipient" } | { who: { ctx: OrgContext; email: string | null }; settings: BrendaSettings };
  const pre = await withWorker(async (db): Promise<Pre> => {
    const who = await recipientContext(db, p.organisationId, p.membershipId);
    if (!who || who.ctx.org.status !== "active") return { skip: "not_a_recipient" };
    const settings = await brendaSettings(db, p.organisationId);
    if (!settings.dailyReportEnabled) return { skip: "off" };
    if (p.localDate !== todayLocal(who.ctx.org.timezone)) return { skip: "stale" };
    if (!who.ctx.plan.features.AI_ASSISTANT) return { skip: "plan" };
    const recipients = await reportRecipients(db, p.organisationId, settings.dailyReportOrgWide);
    if (!recipients.some((x) => x.id === p.membershipId)) return { skip: "not_a_recipient" };
    return { who, settings };
  });
  if ("skip" in pre) return { status: pre.skip };
  const { ctx, email } = pre.who;
  const r = await deliver(ctx, "end_of_day", { useAssistant: opts.useAssistant, reportTime: pre.settings.dailyReportTime });
  if (r.status !== "sent" || !("saved" in r) || !r.saved) return { status: r.status === "nothing" ? "nothing" : "already_sent" };
  let emailed = false;
  if (email && !mailConfigProblem()) {
    const url = `${process.env.APP_ORIGIN ?? "http://localhost:3000"}${r.saved.href}`;
    try {
      await mail().send({
        to: email, category: "brenda_daily_report", subject: `${r.saved.title}: ${ctx.org.name}`,
        ...renderEmail({
          preheader: r.saved.headline,
          title: r.saved.title,
          intro: [r.saved.headline, "Brenda saved the full report, person by person, in your Docs. Only you can read it."],
          cta: { label: "Open the report", url },
          reason: `You received this because you ${ctx.membership.role === "manager" ? "lead a team" : "supervise the organisation"} at ${ctx.org.name}. The owner or HR can change the time or switch the report off in Settings.`,
        }),
      });
      emailed = true;
    } catch (err) {
      console.warn(`[daily report] email to ${ctx.membership.id} failed: ${(err as Error).message}`);
    }
  }
  return { status: "sent", docId: r.saved.docId, emailed };
}
