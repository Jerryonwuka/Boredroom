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
 *
 * Updates (owner decision, 8 October 2026: personal assistants, phase 4): when the owner or HR switch on "Before the team
 * report, collect updates from everyone's assistant", the workspace's own assistant asks each person's assistant what
 * they worked on today, a set time before the report (services/follow-ups.ts, collectWorkspaceUpdates; the worker runs
 * it). The answers go in the report under "Updates", read as the recipient (workspaceUpdatesFor: only the people the
 * recipient may see the records of). Before migration 0039, or when nothing was collected, there is no such section.
 *
 * Notes from the team (owner decision, 8 October 2026: personal assistants, phase 6): anyone may tell their assistant
 * "Put this in today's team report: …"; the note goes in a "Notes from the team" section after the Updates, "From Olu
 * via Max", read as the recipient (reportNotesFor: row-level security lets only the people who may view the author's
 * records read it: their team leads, the owner and HR). A day with notes is sent even when nothing else happened. The
 * note is quoted as typed (its Markdown shown, its addresses as code). Never fails the report: anything wrong leaves the
 * section out; before migration 0043 there is none.
 *
 * Brenda keeps the loops closed (owner decision, 8 October 2026: phase 7a, the team report):
 * - "Decisions for you" comes first, right under the headline: what waits on the reader (reviews they decide, requests
 *   and follow-up asks waiting for them, time corrections for team leads, blocked tasks whose reason names them), read
 *   as the reader. A list whose read failed says "not available", never nothing. A day whose only content is decisions
 *   is sent.
 * - "Changed since yesterday" follows: newly blocked, unblocked, deadlines moved later, newly late and finished, compared
 *   with the structured snapshot the previous report was written from (brenda_report_log.snapshot, migration 0046);
 *   unchanged tasks are left out. Without an earlier report it says so; before 0046 the section is left out and no
 *   snapshot is written (server/lib/schema-0046).
 * - Every line links its source when there is one: tasks, the Reviews page, attendance, the follow-up behind an update,
 *   the note behind a note (lib/evidence-links). A figure the report could not read says "not available", never 0.
 *
 * Commitments (owner decisions, 8 October 2026: phase 7b): after "Changed since …", a "Commitments" section lists the
 * commitments accepted today by the people the reader may see (made today) and the open ones past their due date
 * (overdue, with "2 working days with no progress" once the stalled rule noted it), read as the reader
 * (commitments.ts commitmentsForReport: supervisors see only accepted ones). Each line links the commitment, the message
 * when the reader can read it, and its to-do. An overdue commitment makes the day worth sending. Left out before
 * migration 0048, and when tracking is off and there is nothing to list; a list that could not be read says "not
 * available".
 *
 * Standup (owner decisions, 8–9 October 2026: phase 7c): after "Updates", a "Standup" section lists today's standup
 * rollups the reader receives (a team lead's teams), one line per team ("**Design**: 4 of 6 posted", linked to the
 * rollup) with the blockers people named in what they posted. A blocker naming the reader also goes into "Decisions for
 * you" (Blocked tasks: "Ben is blocked on you: “Logo files” (standup)") unless that task is already there or an open
 * "blocked on you" question already brings it to them. Read as the reader (standup.ts standupForReport: only rollups they
 * receive). Left out before migration 0050 or when anything goes wrong; a standup alone does not make the day worth
 * sending.
 */
import { withUser, withWorker, type Db } from "@/server/db";
import type { OrgContext } from "@/server/lib/api";
import { resolveEntitlements } from "@/server/lib/entitlements";
import { mail, mailConfigProblem } from "@/server/lib/mail";
import { renderEmail } from "@/server/lib/emails";
import { addDays, localMidnight, localParts, todayLocal } from "@/server/lib/time";
import { forget0046, isMissingSchema, retryWithout0046, schema0046Ready } from "@/server/lib/schema-0046";
import { NOT_AVAILABLE, evidenceHref, evidenceLink, sourcesSuffix, type EvidenceRef } from "@/lib/evidence-links";
import { reviewQueue } from "@/server/services/views";
import { audit, notify } from "@/server/services/common";
import { brendaSettings, logAction, type BrendaSettings } from "@/server/services/brenda";
import { resolveAssistant } from "@/server/services/assistant";
import { aiAllowance, recordUsage, recordWorkspaceUsage, type UsageEntry } from "@/server/services/ai-usage";
import { DOC_BODY_MAX } from "@/server/services/docs";
import { workSummary, type PersonWork, type WorkSummary } from "@/server/services/work-summary";
import { readPersonalAssistant, readWorkspaceAssistant } from "@/server/services/assistant-profile";
import { DEFAULT_ASSISTANT_NAME, type AssistantProfile } from "@/lib/assistant-look";
import { waitingForMe, workspaceUpdatesFor, type WorkspaceUpdate } from "@/server/services/follow-ups";
import { composeTemplate, type ComposeInput } from "@/server/services/follow-up-compose";
import { clamp, oneLine } from "@/server/services/copilot-excerpt";
import { factsOrNull, firstName, whenLabel } from "@/lib/follow-ups";
import { loopDueLabel, type CommitmentView } from "@/lib/commitments";
import type { StandupRollupContent } from "@/lib/standup";

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

/** A task a report line links to (phase 7a: every line links its source). */
export type TaskRef = { id: string; title: string };

export type PersonDay = PersonWork & {
  inProgress: { title: string; progress: number }[];
  blocked: { title: string; reason: string | null }[];
  /** clockedInAt is null when they did not clock in; missing only on a working day the organisation clocks at all. */
  attendance: { clockedInAt: string | null; lateMinutes: number; missing: boolean };
  /**
   * The same tasks with their ids, for the links (phase 7a), read in the report's own statement in the order
   * work_summary lists the titles (work-summary.ts is not changed); the title lists stay for the headline.
   */
  taskRefs: {
    completed: TaskRef[]; submitted: TaskRef[]; overdue: TaskRef[];
    inProgress: (TaskRef & { progress: number })[]; blocked: (TaskRef & { reason: string | null })[];
  };
};

/**
 * One thing waiting on the reader (phase 7a, "Decisions for you"): plain text, its source, and the words in the text the
 * source's link goes on (`link`, a quoted title); without them the link follows the line, as "([item](…))".
 */
export type DecisionItem = { text: string; source: EvidenceRef | null; link?: string | null; /** More links after the line (phase 7b: a commitment, its message, its task). */ sources?: EvidenceRef[] };
/** One task in "Changed since yesterday": who holds it, and a word on the change ("due Thu 8 Oct → Mon 12 Oct"). */
export type ChangeItem = { taskId: string; title: string; person: string; detail: string | null };
export type ReportChanges = {
  /** The local date of the report compared with, and how the heading names it: "yesterday", "Friday", "Thursday 1 October". */
  since: string; sinceLabel: string;
  newlyBlocked: ChangeItem[]; unblocked: ChangeItem[]; slipped: ChangeItem[]; newlyLate: ChangeItem[]; finished: ChangeItem[];
  /** One of the two snapshots was cut at its limit: some changes may not be listed. */
  truncated: boolean;
};
export type SnapshotStatus = "todo" | "in_progress" | "blocked" | "in_review" | "completed";
export type SnapshotTask = { a: string /* assignee membership id */; t: string /* title, ≤200 */; s: SnapshotStatus; due: string | null; late: boolean; reason: string | null };
/**
 * The structured state a report was written from (brenda_report_log.snapshot, migration 0046): every task, as the
 * recipient sees it, assigned to the people in the report, open (to do, in progress, blocked, in review) or finished that
 * day; at most SNAPSHOT_MAX_TASKS, oldest due first, `truncated` beyond. The next report compares with it.
 */
export type ReportSnapshot = { v: 1; at: string; localDate: string; truncated: boolean; tasks: Record<string, SnapshotTask> };

export type DailyReport = {
  localDate: string; title: string; scope: WorkSummary["scope"]; people: PersonDay[]; totals: WorkSummary["totals"];
  headline: string; attention: string[]; waitingForYourReview: number;
  /**
   * Nothing happened in the scope and nothing needs a word (attendance, overdue or blocked work, reviews, decisions waiting
   * on the reader): nothing is sent.
   */
  empty: boolean;
  /**
   * What each person's assistant said when the workspace's own assistant collected today's updates (phase 4), one line
   * per person, plain text; empty when the collection is off, has not run, or before migration 0039. `id`: the follow-up
   * behind the line, for its link (phase 7a).
   */
  updates: { membershipId: string; name: string; line: string; id?: string | null }[];
  /** When the collection was made. */
  updatesAt: string | null;
  /**
   * Notes people asked their assistant to put in today's report (phase 6), oldest first, as the recipient may read them;
   * empty before migration 0043 or when there are none.
   */
  notes: { id?: string; membershipId: string; name: string; assistantName: string; body: string; at: string }[];
  /**
   * What waits on the reader (phase 7a), read as them. A list is null when its read failed ("not available"); an empty
   * list is nothing waiting.
   */
  decisions: { reviews: DecisionItem[] | null; corrections: DecisionItem[] | null; requests: DecisionItem[] | null; blocked: DecisionItem[] | null };
  /**
   * What changed since the previous report (phase 7a); "not_available" without an earlier report to compare with (or
   * when it could not be read); null before migration 0046 (the section is left out).
   */
  changes: ReportChanges | "not_available" | null;
  /** The state this report is written from, saved with it for the next one; null before migration 0046 or on a failure. */
  snapshot: ReportSnapshot | null;
  /**
   * Commitments (phase 7b): accepted today and overdue, read as the reader; a list is null when it could not be read
   * ("not available"); the whole is null (left out) before migration 0048, or when tracking is off and both are empty.
   */
  commitments?: { madeToday: DecisionItem[] | null; overdue: DecisionItem[] | null } | null;
  /**
   * Standup (phase 7c): today's rollups the reader receives, one per team, with the blockers named in what was posted;
   * null (left out) before migration 0050, when the reader receives none, or when they could not be read.
   */
  standup?: ReportStandup | null;
};

/** One team's standup in the report (phase 7c): its rollup, how many posted of how many, the blockers people named. */
export type ReportStandupTeam = { rollupId: string; team: string; posted: number; members: number; blockers: StandupRollupContent["blockers"]; href: string };
export type ReportStandup = { teams: ReportStandupTeam[] };

type Ref = { membershipId: string; id: string; title: string };
type Extra = {
  tasks: { id: string; membershipId: string; title: string; status: "in_progress" | "blocked"; progress: number; reason: string | null }[];
  attendance: { membershipId: string; clockInAt: string; lateSeconds: number }[];
  clocking: boolean; waitingForYou: number;
  completed: Ref[]; submitted: Ref[]; overdue: Ref[];
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
/**
 * Other people's words in the report (the Updates lines quote their comments and replies) as text, with any web or mail
 * address shown as code, never as a link (owner decision, 8 October 2026: personal assistants, phase 4: "outside links
 * defused"). The Docs renderer reads code spans before bare addresses, so a quoted address cannot become one.
 */
const ADDRESS = /\b(?:https?:\/\/|mailto:|www\.)[^\s<>`]*[^\s<>`.,:;'!?)\]”]/gi;
export function mdQuoted(s: string): string {
  let out = "";
  let last = 0;
  for (const m of s.matchAll(ADDRESS)) {
    out += `${md(s.slice(last, m.index))}\`${m[0].replace(/`/g, "")}\``;
    last = m.index + m[0].length;
  }
  return out + md(s.slice(last));
}
/** "a, b and c". */
function listOf(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
const sentence = (s: string) => s ? `${s[0].toUpperCase()}${s.slice(1)}` : s;

/**
 * Today's report for the person, as of now, in the organisation's time zone. Reads as them: the people are exactly
 * those work_summary shows them (a team lead's teams and themself; everyone who holds work for the owner and HR).
 * `useAssistant` false keeps Claude out of it (the smoke script); otherwise Claude writes the headline when connected.
 * `usage` says whose the model call is in the usage ledger (owner decision, 8 October 2026: personal assistants, phase 3):
 * the person's, for a report they asked for (the default), or the workspace's own, for the end-of-day send.
 */
export async function buildDailyReport(ctx: OrgContext, opts: { useAssistant?: boolean; usage?: "person" | "workspace"; requestId?: string } = {}): Promise<DailyReport> {
  const summary = await workSummary(ctx, { period: "today" });
  const localDate = summary.from;
  const tz = ctx.org.timezone;
  const ids = summary.people.map((p) => p.membershipId);
  // One statement for everything work_summary does not hold: in-progress and blocked work, today's clock-ins, whether
  // the organisation clocks at all today, what is waiting for the reader's own review, and (phase 7a) the ids of the
  // tasks work_summary lists by title, in its order and limits, for the links.
  const extra = await withUser(ctx.user.profileId, (db) => db.one<Extra>(
    `SELECT
       (SELECT COALESCE(json_agg(x ORDER BY x.updated_at DESC), '[]'::json) FROM (
          SELECT t.id, t.assignee_membership_id AS "membershipId", t.title, t.status, t.progress_percent::int AS progress, t.blocked_reason AS reason, t.updated_at
          FROM tasks t WHERE t.organisation_id = $1 AND t.assignee_membership_id = ANY($2::uuid[]) AND t.archived_at IS NULL AND t.status IN ('in_progress', 'blocked')) x) AS tasks,
       (SELECT COALESCE(json_agg(json_build_object('membershipId', a.membership_id, 'clockInAt', a.clock_in_at, 'lateSeconds', a.late_seconds)), '[]'::json)
          FROM attendance_days a WHERE a.membership_id = ANY($2::uuid[]) AND a.local_date = $3::date) AS attendance,
       app_anyone_clocked_in($1, $3::date) AS clocking,
       (SELECT count(*)::int FROM tasks t WHERE t.organisation_id = $1 AND t.status = 'in_review' AND t.reviewer_membership_id = $4 AND t.archived_at IS NULL) AS "waitingForYou",
       (SELECT COALESCE(json_agg(json_build_object('membershipId', x.m, 'id', x.id, 'title', x.title) ORDER BY x.m, x.n), '[]'::json) FROM (
          SELECT t.assignee_membership_id AS m, t.id, t.title, row_number() OVER (PARTITION BY t.assignee_membership_id ORDER BY t.completed_at DESC, t.id) AS n
          FROM tasks t WHERE t.organisation_id = $1 AND t.assignee_membership_id = ANY($2::uuid[]) AND t.status = 'completed' AND t.completed_at >= $5::timestamptz AND t.completed_at < $6::timestamptz) x WHERE x.n <= 10) AS completed,
       (SELECT COALESCE(json_agg(json_build_object('membershipId', x.m, 'id', x.id, 'title', x.title) ORDER BY x.m, x.n), '[]'::json) FROM (
          SELECT s.m, t.id, t.title, row_number() OVER (PARTITION BY s.m ORDER BY t.updated_at DESC, t.id) AS n
          FROM (SELECT DISTINCT ts.task_id, ts.submitted_by AS m FROM task_submissions ts
                WHERE ts.organisation_id = $1 AND ts.submitted_by = ANY($2::uuid[]) AND ts.submitted_at >= $5::timestamptz AND ts.submitted_at < $6::timestamptz) s
          JOIN tasks t ON t.id = s.task_id WHERE t.organisation_id = $1) x WHERE x.n <= 10) AS submitted,
       (SELECT COALESCE(json_agg(json_build_object('membershipId', x.m, 'id', x.id, 'title', x.title) ORDER BY x.m, x.n), '[]'::json) FROM (
          SELECT t.assignee_membership_id AS m, t.id, t.title, row_number() OVER (PARTITION BY t.assignee_membership_id ORDER BY t.due_at, t.id) AS n
          FROM tasks t WHERE t.organisation_id = $1 AND t.assignee_membership_id = ANY($2::uuid[]) AND t.archived_at IS NULL AND t.status IN ('todo', 'in_progress', 'blocked') AND t.due_at < now()) x WHERE x.n <= 5) AS overdue`,
    [ctx.org.id, ids, localDate, ctx.membership.id, localMidnight(localDate, tz).toISOString(), localMidnight(addDays(localDate, 1), tz).toISOString()]));
  // work_summary counts today's working day when today is one; "did not clock in" is said only then, and only when
  // somebody in the organisation clocked in today (a workspace that does not use the clock is not flagged every day).
  const flagMissing = summary.workingDays > 0 && extra.clocking;
  const refsOf = (list: Ref[], id: string): TaskRef[] => list.filter((r) => r.membershipId === id).map((r) => ({ id: r.id, title: r.title }));
  const people: PersonDay[] = summary.people.map((p) => {
    const mine = extra.tasks.filter((t) => t.membershipId === p.membershipId);
    const att = extra.attendance.find((a) => a.membershipId === p.membershipId);
    const inProgress = mine.filter((t) => t.status === "in_progress").map((t) => ({ id: t.id, title: t.title, progress: t.progress }));
    const blocked = mine.filter((t) => t.status === "blocked").map((t) => ({ id: t.id, title: t.title, reason: t.reason?.trim() || null }));
    return {
      ...p,
      inProgress: inProgress.map(({ title, progress }) => ({ title, progress })),
      blocked: blocked.map(({ title, reason }) => ({ title, reason })),
      attendance: { clockedInAt: att?.clockInAt ?? null, lateMinutes: att && att.lateSeconds > 0 ? Math.max(1, Math.round(att.lateSeconds / 60)) : 0, missing: !att && flagMissing },
      taskRefs: { completed: refsOf(extra.completed, p.membershipId), submitted: refsOf(extra.submitted, p.membershipId), overdue: refsOf(extra.overdue, p.membershipId), inProgress, blocked },
    };
  });
  // What waits on the reader, and what changed since their previous report (phase 7a), and (phase 7b) the commitments,
  // read as them side by side.
  const [decisions, compared, commitments, standup] = await Promise.all([decisionsFor(ctx, people), changesFor(ctx, localDate, people), commitmentsFor(ctx, localDate), standupFor(ctx, localDate)]);
  // A report goes out when something happened or something needs the reader; a scope with neither sends nothing.
  // Overdue or blocked work, reviews waiting for the reader and (phase 7a) any decision waiting on them count as needing
  // them, even on a quiet day; so does (phase 7b) an overdue commitment.
  const active = people.some((p) => p.trackedSeconds > 0 || p.tasksCompleted > 0 || p.submittedForReview > 0);
  const issues = extra.waitingForYou > 0 || people.some((p) => p.attendance.lateMinutes > 0 || p.attendance.missing || p.overdueOpen > 0 || p.blocked.length > 0)
    || !!commitments?.overdue?.length;
  const waiting = decisionCount(decisions);
  const empty = !active && !issues && waiting === 0;
  // Phase 7c: a blocker naming the reader in today's standup joins "Decisions for you", after the day was judged worth
  // sending (a standup alone never makes it so).
  if (standup) decisions.blocked = await withStandupBlockers(ctx, decisions.blocked, standup);
  // The model reads the plain list; the document's list links its tasks.
  const attention = attentionList(people, extra.waitingForYou, ctx.org.slug);
  const plain = plainHeadline(ctx, summary, people);
  const headline = opts.useAssistant === false || empty ? plain
    : (await assistantHeadline(ctx, summary, people, attentionList(people, extra.waitingForYou, null), waiting, opts.usage ?? "person", opts.requestId)) ?? plain;
  return {
    localDate, title: `Team report, ${dayLabel(localDate)}`, scope: summary.scope, people, totals: summary.totals,
    headline, attention, waitingForYourReview: extra.waitingForYou, empty, updates: [], updatesAt: null, notes: [],
    decisions, changes: compared.changes, snapshot: compared.snapshot, commitments, standup,
  };
}

// ---- Standup (owner decisions, 8–9 October 2026: phase 7c) ----------------------------------------------------------------

/**
 * Today's standup rollups the reader receives, read as them (standup.ts, loaded when needed). Null before 0050, when
 * there are none, or on any failure (the section is left out; it never fails the report).
 */
async function standupFor(ctx: OrgContext, localDate: string): Promise<ReportStandup | null> {
  try {
    const { standupForReport } = await import("@/server/services/standup");
    const r = await standupForReport(ctx, localDate);
    return r && r.teams.length ? { teams: r.teams } : null;
  } catch (err) {
    if (!isMissingSchema(err)) console.warn(`[daily report] standup left out: ${(err as Error)?.message ?? err}`);
    return null;
  }
}

/** The task a Blocked line names: its first quoted title ("“Logo files”: waiting on …"), else the line, clipped. */
export function blockerTitle(text: string): string {
  const m = /^\s*["“]([^"”]{1,200})["”]/.exec(text);
  return quote(m ? m[1] : text, 120);
}

/**
 * The blockers in today's standups that name the reader (pure): "Ben is blocked on you: “Logo files” (standup)", each
 * linked to its task (or the rollup), left out when its task is already in `known` (a blocked task already listed, or an
 * open "blocked on you" question), each task once.
 */
export function standupDecisions(s: ReportStandup, reader: string, known: Set<string>): DecisionItem[] {
  const out: DecisionItem[] = [];
  const seen = new Set<string>(known);
  for (const t of s.teams) {
    for (const b of t.blockers) {
      if (b.onMembershipId !== reader || b.membershipId === reader) continue;
      if (b.taskId) { if (seen.has(b.taskId)) continue; seen.add(b.taskId); }
      const title = `“${blockerTitle(b.text)}”`;
      out.push({ text: `${firstName(b.name)} is blocked on you: ${title} (standup)`, source: b.taskId ? { kind: "task", id: b.taskId } : { kind: "standup_rollup", id: t.rollupId }, link: b.taskId ? title : null });
    }
  }
  return out;
}

/**
 * "Decisions for you" → blocked tasks, with the standup's blockers that name the reader (deduplicated by task: one already
 * listed, or with an open "blocked on you" question waiting on the reader, read as them). A list that could not be read
 * stays "not available"; a failed check adds nothing.
 */
async function withStandupBlockers(ctx: OrgContext, blocked: DecisionItem[] | null, s: ReportStandup): Promise<DecisionItem[] | null> {
  if (blocked === null) return null;
  const mine = s.teams.flatMap((t) => t.blockers).filter((b) => b.onMembershipId === ctx.membership.id);
  if (!mine.length) return blocked;
  try {
    const known = new Set(blocked.map((d) => (d.source?.kind === "task" ? d.source.id ?? "" : "")).filter(Boolean));
    const ids = [...new Set(mine.map((b) => b.taskId).filter((x): x is string => !!x && UUID.test(x)))];
    if (ids.length) {
      const open = await withUser(ctx.user.profileId, (db) => db.query<{ task_id: string }>(
        `SELECT task_id FROM task_blocks WHERE organisation_id = $1 AND waiting_on_membership_id = $2 AND status = 'open' AND task_id = ANY($3::uuid[])`,
        [ctx.org.id, ctx.membership.id, ids])).catch(() => [] as { task_id: string }[]);
      for (const r of open) known.add(r.task_id);
    }
    return [...blocked, ...standupDecisions(s, ctx.membership.id, known)];
  } catch (err) {
    console.warn(`[daily report] standup blockers left out of the decisions: ${(err as Error)?.message ?? err}`);
    return blocked;
  }
}

/**
 * "## Standup" (phase 7c): one line per team, "**Design**: 4 of 6 posted ([rollup](…))", then the blockers named in what
 * was posted, "**Ben Okafor** on **Ada Obi**: “Logo files”", at most 10 a team then "And {n} more.".
 */
export function standupMarkdown(slug: string, s: ReportStandup): string[] {
  const lines = ["## Standup", ""];
  for (const t of s.teams) {
    lines.push(`- **${md(t.team)}**: ${t.posted} of ${t.members} posted${sourcesSuffix(slug, [{ kind: "standup_rollup", id: t.rollupId }])}`);
    const shown = t.blockers.slice(0, DECISIONS_SHOWN);
    for (const b of shown) {
      const on = b.onName ? ` on **${md(b.onName)}**` : "";
      lines.push(`  - Blocked: **${md(b.name)}**${on}: “${mdQuoted(blockerTitle(b.text))}”${b.taskId ? sourcesSuffix(slug, [{ kind: "task", id: b.taskId }]) : ""}`);
    }
    if (t.blockers.length > shown.length) lines.push(`  - And ${t.blockers.length - shown.length} more.`);
  }
  return lines;
}

// ---- Commitments (owner decisions, 8 October 2026: phase 7b) ------------------------------------------------------------

/** "you" for the reader, else the first name. */
const whoFor = (p: { membershipId: string; name: string; firstName?: string } | null, reader: string) => (!p ? null : p.membershipId === reader ? "you" : (p.firstName || firstName(p.name)));

/**
 * The report's lines for commitments (pure): made today, "“Send the deck” (Ben Okafor), due Thu 9 Oct, 17:00, asked by
 * Olu"; overdue, "“Fix the login bug” (Ada Employee), was due Tue 6 Oct, 17:00, 2 working days with no progress". Each
 * links the commitment, then the message when the reader can read it (made today) or the to-do (overdue).
 */
export function commitmentLines(views: CommitmentView[], o: { reader: string; timeZone: string; overdue: boolean }): DecisionItem[] {
  return views.map((v) => {
    const due = v.dueAt ? (v.dueLabel ?? loopDueLabel(v.dueAt, o.timeZone)) : null;
    const asker = whoFor(v.asker, o.reader);
    const text = o.overdue
      ? `“${quote(v.title, 120)}” (${v.committer.name})${due ? `, was due ${due}` : ""}${v.stalled ? ", 2 working days with no progress" : ""}`
      : `“${quote(v.title, 120)}” (${v.committer.name})${due ? `, due ${due}` : ""}${asker ? `, asked by ${asker}` : ""}`;
    const sources: EvidenceRef[] = [{ kind: "commitment", id: v.id }];
    if (!o.overdue && v.message.href) sources.push({ kind: "message", id: v.message.id, conversationId: v.where.conversationId });
    if (v.todo) sources.push({ kind: "task", id: v.todo.id });
    if (o.overdue && v.message.href && !v.todo) sources.push({ kind: "message", id: v.message.id, conversationId: v.where.conversationId });
    return { text, source: null, sources };
  });
}

/**
 * The commitments made today and overdue, read as the reader (commitments.ts, loaded when needed). Null before 0048, or
 * when tracking is off and there is nothing to list; a failed read is "not available" for both lists. Never throws.
 */
async function commitmentsFor(ctx: OrgContext, localDate: string): Promise<DailyReport["commitments"]> {
  try {
    const svc = await import("@/server/services/commitments");
    const read = await svc.commitmentsForReport(ctx, localDate);
    if (!read) return null;
    if (!read.madeToday.length && !read.overdue.length) {
      const settings = await withUser(ctx.user.profileId, (db) => svc.commitmentSettings(db, ctx.org.id)).catch(() => null);
      if (!settings?.track) return null;
    }
    const o = { reader: ctx.membership.id, timeZone: ctx.org.timezone };
    return { madeToday: commitmentLines(read.madeToday, { ...o, overdue: false }), overdue: commitmentLines(read.overdue, { ...o, overdue: true }) };
  } catch (err) {
    if (isMissingSchema(err)) return null;
    console.warn(`[daily report] commitments not available: ${(err as Error)?.message ?? err}`);
    return { madeToday: null, overdue: null };
  }
}

/**
 * "## Commitments" (phase 7b): made today, then overdue, at most 10 each then "And {n} more.", each line linked; a list
 * that could not be read says so; nothing in either says so.
 */
export function commitmentsMarkdown(slug: string, c: NonNullable<DailyReport["commitments"]>): string[] {
  const lines = ["## Commitments", ""];
  const groups: [string, DecisionItem[] | null][] = [["Made today", c.madeToday], ["Overdue", c.overdue]];
  for (const [label, items] of groups) {
    if (items === null) { lines.push(`**${label}**`, `- ${sentence(NOT_AVAILABLE)}.`, ""); continue; }
    if (!items.length) continue;
    const shown = items.slice(0, DECISIONS_SHOWN);
    lines.push(`**${label}**`, ...shown.map((x) => `- ${mdQuoted(x.text)}${sourcesSuffix(slug, x.sources ?? (x.source ? [x.source] : []))}`));
    if (items.length > shown.length) lines.push(`- And ${items.length - shown.length} more.`);
    lines.push("");
  }
  if (lines.length === 2) lines.push("Nothing was made today and nothing is overdue.", "");
  while (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

// ---- Decisions for you (owner decision, 8 October 2026: phase 7a, the team report) ------------------------------------

const DECISION_TEXT_MAX = 160;
const decisionCount = (d: DailyReport["decisions"]) => [d.reviews, d.requests, d.corrections, d.blocked].reduce((n, l) => n + (l?.length ?? 0), 0);
const quote = (s: string, max = DECISION_TEXT_MAX) => clamp(oneLine(s), max);

/**
 * What waits on the reader, read as them (their own pages show the same): submissions they review (organisation accounts
 * only those naming them as the reviewer; team leads also their people's), time corrections (team leads: organisation
 * accounts do not decide them), requests to accept and follow-up asks waiting for their reply, and blocked tasks in the
 * report whose reason names them. A read that fails makes its list null ("not available"); it never fails the report.
 */
async function decisionsFor(ctx: OrgContext, people: PersonDay[], now: Date = new Date()): Promise<DailyReport["decisions"]> {
  const tz = ctx.org.timezone;
  const role = ctx.membership.role;
  const failed = (what: string) => (err: unknown) => { console.warn(`[daily report] ${what} not available: ${(err as Error)?.message ?? err}`); return null; };
  const queue = reviewQueue(ctx).then((q) => ({
    reviews: q.submissions.filter((s) => s.reviewer_is_me || role === "manager").map((s): DecisionItem => {
      const title = `“${s.title}”`;
      return { text: `Review ${title} from ${s.assignee_name}, sent ${whenLabel(s.submitted_at, tz, now)}`, source: { kind: "task", id: s.task_id }, link: title };
    }),
    corrections: role !== "manager" ? [] : q.adjustments.map((a): DecisionItem => ({ text: `Time correction from ${a.display_name} on “${a.task_title}”`, source: { kind: "time_correction", id: a.id } })),
  }), failed("reviews"));
  const requests = (async (): Promise<DecisionItem[]> => {
    const { waitingItems } = await import("@/server/services/assistant-items");
    const [items, asks] = await Promise.all([waitingItems(ctx), waitingForMe(ctx)]);
    return [
      ...items.filter((i) => i.kind === "request" && i.viewer === "recipient" && i.request).map((i): DecisionItem => ({ text: `${i.sender.name} asks you to accept: ${quote(i.request!.summary, 200)}`, source: { kind: "assistant_item", id: i.id } })),
      ...asks.map((f): DecisionItem => {
        const who = f.requester ? `${f.requester.name}'s ${f.requester.assistant.name}` : (f.workspaceAssistant?.name ?? DEFAULT_ASSISTANT_NAME);
        return { text: `${who} asks: “${quote(f.question)}”`, source: { kind: "follow_up", id: f.id } };
      }),
    ];
  })().catch(failed("requests"));
  const blocked = (async (): Promise<DecisionItem[]> => {
    const named = people.flatMap((p) => p.membershipId === ctx.membership.id ? [] : p.taskRefs.blocked.filter((b) => b.reason).map((b) => ({ p, b })));
    if (!named.length) return [];
    // The same rule as the afternoon check's "blocked on you" (routine-templates.ts): the full name, or the first name
    // when it is at least 3 letters, as a whole word.
    const { namesPerson } = await import("@/server/services/routine-templates");
    return named.filter(({ b }) => namesPerson(b.reason!, ctx.user.displayName)).map(({ p, b }): DecisionItem => {
      const title = `“${b.title}”`;
      return { text: `${title} (${p.name}) is blocked: ${quote(b.reason!)}`, source: { kind: "task", id: b.id }, link: title };
    });
  })().catch(failed("blocked tasks"));
  const [q, r, b] = await Promise.all([queue, requests, blocked]);
  return { reviews: q?.reviews ?? null, corrections: q?.corrections ?? null, requests: r, blocked: b };
}

// ---- Changed since yesterday (owner decision, 8 October 2026: phase 7a, the team report) ------------------------------

/** A snapshot holds at most this many tasks (oldest due first) and stays well inside the column's 256 KB check. */
export const SNAPSHOT_MAX_TASKS = 500;
const SNAPSHOT_MAX_BYTES = 200_000;
/** A previous report older than this is not compared with ("not available"). */
export const CHANGES_MAX_DAYS = 7;
const SNAPSHOT_STATUSES: readonly SnapshotStatus[] = ["todo", "in_progress", "blocked", "in_review", "completed"];
const OPEN: readonly SnapshotStatus[] = ["todo", "in_progress", "blocked", "in_review"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isoOrNull = (v: unknown): string | null => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);

/** A stored snapshot, checked field by field; null when it is not one (an entry that is not a task is dropped). */
export function snapshotOf(raw: unknown): ReportSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const at = isoOrNull(r.at);
  if (r.v !== 1 || !at || typeof r.localDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r.localDate) || !r.tasks || typeof r.tasks !== "object") return null;
  const tasks: Record<string, SnapshotTask> = {};
  for (const [id, v] of Object.entries(r.tasks as Record<string, unknown>)) {
    const x = v as Record<string, unknown> | null;
    if (!UUID.test(id) || !x || typeof x !== "object" || typeof x.a !== "string" || typeof x.t !== "string" || !SNAPSHOT_STATUSES.includes(x.s as SnapshotStatus)) continue;
    tasks[id] = { a: x.a, t: x.t, s: x.s as SnapshotStatus, due: isoOrNull(x.due), late: x.late === true, reason: typeof x.reason === "string" ? x.reason : null };
  }
  return { v: 1, at, localDate: r.localDate, truncated: r.truncated === true, tasks };
}

/** Drops the latest-due tasks until the snapshot fits its byte budget (titles may be long and not ASCII). */
function fitSnapshot(s: ReportSnapshot): ReportSnapshot {
  const entries = Object.entries(s.tasks);
  let size = Buffer.byteLength(JSON.stringify(s));
  if (size <= SNAPSHOT_MAX_BYTES) return s;
  while (entries.length && size > SNAPSHOT_MAX_BYTES) {
    const [id, t] = entries.pop()!;
    size -= Buffer.byteLength(JSON.stringify({ [id]: t })) - 1;
  }
  return { ...s, truncated: true, tasks: Object.fromEntries(entries) };
}

const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Thu 8 Oct" in the time zone; with the time ("Thu 8 Oct 17:00") when asked. */
function dayShort(iso: string, tz: string, withTime = false): string {
  const p = localParts(new Date(iso), tz);
  const day = `${SHORT_DAYS[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()]} ${p.day} ${SHORT_MONTHS[p.month - 1]}`;
  return withTime ? `${day} ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}` : day;
}
/** "due Thu 8 Oct → Mon 12 Oct"; the times too when the deadline moved within one day. */
function dueMoved(before: string, after: string, tz: string): string {
  const sameDay = dayShort(before, tz) === dayShort(after, tz);
  return `due ${dayShort(before, tz, sameDay)} → ${dayShort(after, tz, sameDay)}`;
}
const weekdayName = (localDate: string) => new Date(`${localDate}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * What changed between the previous report's snapshot and now (pure; owner decision, 8 October 2026: phase 7a). Only the
 * tasks in `now` (those the reader sees now) are compared; a task can be in more than one group; unchanged tasks are left
 * out. "not_available" without a previous snapshot, or one from today or more than CHANGES_MAX_DAYS before.
 * - newly blocked: blocked now and not before (or new);
 * - unblocked: blocked before, now to do, in progress or in review (finished counts as finished);
 * - slipped: open now with a deadline later than before;
 * - newly late: open and past its deadline now, not before (or new);
 * - finished: done now and not before (or new: everything done in `now` was done after the previous report).
 * A task missing from a previous snapshot that was cut at its limit is not taken as new (it may have been cut off).
 */
export function changesSince(prev: ReportSnapshot | null, now: ReportSnapshot, o: { names?: Record<string, string>; timeZone?: string } = {}): ReportChanges | "not_available" {
  if (!prev) return "not_available";
  const gap = daysBetween(prev.localDate, now.localDate);
  if (!(gap >= 1 && gap <= CHANGES_MAX_DAYS)) return "not_available";
  const tz = o.timeZone ?? "UTC";
  const out: ReportChanges = {
    since: prev.localDate, sinceLabel: gap === 1 ? "yesterday" : gap <= 6 ? weekdayName(prev.localDate) : dayLabel(prev.localDate),
    newlyBlocked: [], unblocked: [], slipped: [], newlyLate: [], finished: [], truncated: prev.truncated || now.truncated,
  };
  for (const [taskId, n] of Object.entries(now.tasks)) {
    const p = prev.tasks[taskId] ?? null;
    if (!p && prev.truncated && n.s !== "completed") continue;
    const item = (detail: string | null = null): ChangeItem => ({ taskId, title: n.t, person: o.names?.[n.a] ?? "Someone", detail });
    const open = OPEN.includes(n.s);
    if (n.s === "blocked" && p?.s !== "blocked") out.newlyBlocked.push(item());
    if (p?.s === "blocked" && open && n.s !== "blocked") out.unblocked.push(item());
    if (open && p?.due && n.due && Date.parse(n.due) > Date.parse(p.due)) out.slipped.push(item(dueMoved(p.due, n.due, tz)));
    if (open && n.late && !p?.late) out.newlyLate.push(item(n.due ? `due ${dayShort(n.due, tz)}` : null));
    if (n.s === "completed" && p?.s !== "completed") out.finished.push(item());
  }
  return out;
}

type SnapRow = { id: string; a: string; t: string; s: SnapshotStatus; due: string | null; late: boolean; reason: string | null };

/**
 * Today's snapshot and the comparison with the previous report's, read as the reader in one transaction: the previous
 * snapshot (their own log row), then every task the report covers and, of the previous snapshot's tasks, those finished
 * since it was written but not today (finished last night, or over a weekend). Null and null before migration 0046; a
 * failure leaves "not available" and no snapshot (it never fails the report).
 */
async function changesFor(ctx: OrgContext, localDate: string, people: PersonDay[]): Promise<Pick<DailyReport, "changes" | "snapshot">> {
  const ids = people.map((p) => p.membershipId);
  const names = Object.fromEntries(people.map((p) => [p.membershipId, p.name]));
  try {
    return await retryWithout0046(() => withUser(ctx.user.profileId, async (db) => {
      if (!(await schema0046Ready(db))) return { changes: null, snapshot: null };
      const row = await db.maybeOne<{ local_date: string; snapshot: unknown }>(
        `SELECT local_date::text AS local_date, snapshot FROM brenda_report_log
         WHERE membership_id = $1 AND local_date < $2::date AND snapshot IS NOT NULL ORDER BY local_date DESC LIMIT 1`, [ctx.membership.id, localDate]);
      const stored = row ? snapshotOf(row.snapshot) : null;
      // One more than a week old is not compared with (changesSince says "not available"): nothing of it is read.
      const prev = stored && daysBetween(row!.local_date, localDate) <= CHANGES_MAX_DAYS ? { ...stored, localDate: row!.local_date } : null;
      const read = await db.one<{ tasks: SnapRow[]; finished: Omit<SnapRow, "s" | "due" | "late" | "reason">[]; at: string }>(
        `SELECT
           (SELECT COALESCE(json_agg(json_build_object('id', x.id, 'a', x.a, 't', x.t, 's', x.s, 'due', x.due, 'late', x.late, 'reason', x.reason) ORDER BY x.due NULLS LAST, x.c, x.id), '[]'::json) FROM (
              SELECT t.id, t.assignee_membership_id AS a, left(t.title, 200) AS t, t.status AS s, t.due_at AS due, t.created_at AS c,
                     (t.status IN ('todo', 'in_progress', 'blocked') AND t.due_at < now()) AS late,
                     CASE WHEN t.status = 'blocked' THEN left(NULLIF(btrim(t.blocked_reason), ''), 120) END AS reason
              FROM tasks t WHERE t.organisation_id = $1 AND t.assignee_membership_id = ANY($2::uuid[]) AND t.archived_at IS NULL
                AND (t.status IN ('todo', 'in_progress', 'blocked', 'in_review') OR (t.status = 'completed' AND t.completed_at >= $3::timestamptz))
              ORDER BY t.due_at NULLS LAST, t.created_at, t.id LIMIT ${SNAPSHOT_MAX_TASKS + 1}) x) AS tasks,
           (SELECT COALESCE(json_agg(json_build_object('id', t.id, 'a', t.assignee_membership_id, 't', left(t.title, 200))), '[]'::json)
              FROM tasks t WHERE $5::timestamptz IS NOT NULL AND t.organisation_id = $1 AND t.id = ANY($4::uuid[]) AND t.assignee_membership_id = ANY($2::uuid[])
                AND t.archived_at IS NULL AND t.status = 'completed' AND t.completed_at > $5::timestamptz AND t.completed_at < $3::timestamptz) AS finished,
           now() AS at`,
        [ctx.org.id, ids, localMidnight(localDate, ctx.org.timezone).toISOString(), prev ? Object.keys(prev.tasks) : [], prev?.at ?? null]);
      const tasks: Record<string, SnapshotTask> = {};
      for (const t of read.tasks.slice(0, SNAPSHOT_MAX_TASKS)) tasks[t.id] = { a: t.a, t: t.t, s: t.s, due: isoOrNull(t.due), late: !!t.late, reason: t.reason ?? null };
      const snapshot = fitSnapshot({ v: 1, at: new Date(read.at).toISOString(), localDate, truncated: read.tasks.length > SNAPSHOT_MAX_TASKS, tasks });
      // Finished since the previous report but not today: compared as finished, not kept (the snapshot is today's).
      const compare: ReportSnapshot = { ...snapshot, tasks: { ...snapshot.tasks } };
      for (const f of read.finished) if (!compare.tasks[f.id]) compare.tasks[f.id] = { a: f.a, t: f.t, s: "completed", due: null, late: false, reason: null };
      return { changes: changesSince(prev, compare, { names, timeZone: ctx.org.timezone }), snapshot };
    }));
  } catch (err) {
    if (isMissingSchema(err)) { forget0046(); return { changes: null, snapshot: null }; }
    console.warn(`[daily report] changes not available: ${(err as Error)?.message ?? err}`);
    return { changes: "not_available", snapshot: null };
  }
}

// ---- Notes from the team (owner decision, 8 October 2026: personal assistants, phase 6) -------------------------------

/** A note in the report is at most this long (the note itself holds at most 500 characters). */
export const NOTE_MAX = 500;

/**
 * Today's notes for the team report, read as the recipient (row-level security: the authors whose records they may
 * view). Loaded when needed. Never fails the report: anything wrong (before 0043, a hiccup) leaves the section out.
 */
async function reportNotes(ctx: OrgContext, localDate: string): Promise<DailyReport["notes"]> {
  try {
    const { reportNotesFor } = await import("@/server/services/assistant-items");
    return await reportNotesFor(ctx, localDate);
  } catch (err) {
    console.warn(`[daily report] notes left out: ${(err as Error)?.message ?? err}`);
    return [];
  }
}

// ---- Updates collected by the workspace's assistant (owner decision, 8 October 2026: personal assistants, phase 4) ----

/** The question the workspace's collection asks (services/follow-ups.ts), for a line written here from its facts. */
const UPDATE_QUESTION = "What did you work on today?";
/** One person's line in the report is at most this long (the document-size guard still holds the whole). */
export const UPDATE_LINE_MAX = 400;

/**
 * One person's update as a line: the answer their assistant gave; for one still open when the report is written, the
 * same template the answer would use, from the facts gathered so far (a reply that came in but is not written up yet,
 * a reply still due, or no reply by the deadline); "No update yet." when nothing was gathered.
 */
export function updateLine(u: WorkspaceUpdate, timeZone: string, now: Date = new Date()): string {
  if (u.answer?.trim()) return clamp(oneLine(u.answer), UPDATE_LINE_MAX);
  const facts = factsOrNull(u.facts);
  if (!facts) return u.status === "failed" || u.status === "cancelled" ? "No update." : "No update yet.";
  const first = firstName(u.name);
  const base: Omit<ComposeInput, "answeredFrom" | "reply"> = {
    question: UPDATE_QUESTION, kind: "person", facts, capped: false,
    subject: { name: u.name, firstName: first, assistantName: "" }, requester: null,
    deadlineAt: u.deadlineAt, timeZone, now,
  };
  const due = u.deadlineAt ? Date.parse(u.deadlineAt) : NaN;
  let line: string;
  if (u.reply && u.reply.choice !== "not_now") line = composeTemplate({ ...base, answeredFrom: "person", reply: { ...u.reply, at: now.toISOString() } });
  // Still due (a report asked for while the collection runs): said as it is, never "no reply" before the time is up.
  else if (u.status === "asking" && due > now.getTime()) line = `${first} hasn't replied yet, the reply is due by ${whenLabel(u.deadlineAt!, timeZone, now)}. ${composeTemplate({ ...base, answeredFrom: "facts", reply: null })}`;
  else if (u.status === "asking" || u.answeredFrom === "deadline") line = composeTemplate({ ...base, answeredFrom: "deadline", reply: null });
  // Being answered (a reply is in but not yet written up, and not shown until it is): what their work shows.
  else line = composeTemplate({ ...base, answeredFrom: "facts", reply: null });
  return clamp(oneLine(line), UPDATE_LINE_MAX);
}

/**
 * Today's collected updates for the people in the report, read as the recipient. Never fails the report: anything wrong
 * here (before 0039, a hiccup) leaves the section out.
 */
async function reportUpdates(ctx: OrgContext, r: DailyReport): Promise<Pick<DailyReport, "updates" | "updatesAt">> {
  if (!r.people.length) return { updates: [], updatesAt: null };
  try {
    const u = await workspaceUpdatesFor(ctx, r.localDate, r.people.map((p) => p.membershipId));
    const now = new Date();
    // The follow-up behind each line, for its link (phase 7a).
    return { updatesAt: u.collectedAt, updates: u.updates.map((x) => ({ membershipId: x.membershipId, name: x.name, line: updateLine(x, ctx.org.timezone, now), id: x.id ?? null })) };
  } catch (err) {
    console.warn(`[daily report] updates left out: ${(err as Error)?.message ?? err}`);
    return { updates: [], updatesAt: null };
  }
}

/**
 * What needs the reader's attention, as markdown lines. With the workspace's slug (the document) the tasks link to their
 * pages and the review and attendance lines to theirs (phase 7a); without it (the model's facts) it is text only.
 */
function attentionList(people: PersonDay[], waitingForYou: number, slug: string | null): string[] {
  const out: string[] = [];
  const refsOr = (refs: TaskRef[] | undefined, titles: string[]) => (slug && refs?.length ? refs : titles.map((title) => ({ id: "", title })));
  for (const p of people) {
    if (p.overdueOpen) {
      const shown = refsOr(p.taskRefs?.overdue, p.overdueTitles);
      const more = p.overdueOpen - shown.length;
      out.push(`${md(p.name)}: ${listOf(shown.map((t) => taskMd(slug, t)))}${more > 0 ? ` and ${plural(more, "more task")}` : ""} ${p.overdueOpen === 1 ? "is" : "are"} overdue`);
    }
    const blocked = slug && p.taskRefs?.blocked.length ? p.taskRefs.blocked : p.blocked.map((b) => ({ ...b, id: "" }));
    for (const b of blocked) out.push(`${md(p.name)}: ${taskMd(slug, b)} is blocked${b.reason ? ` (${mdQuoted(clamp(oneLine(b.reason), 160))})` : ""}`);
  }
  if (waitingForYou) out.push(`${plural(waitingForYou, "task")} ${waitingForYou === 1 ? "is" : "are"} waiting for your review${slug ? sourcesSuffix(slug, [{ kind: "review" }]) : ""}`);
  const attendance = slug ? sourcesSuffix(slug, [{ kind: "attendance" }]) : "";
  const missing = people.filter((p) => p.attendance.missing).map((p) => md(p.name));
  if (missing.length) out.push(`Did not clock in: ${listOf(missing)}${attendance}`);
  const late = people.filter((p) => p.attendance.lateMinutes > 0).map((p) => `${md(p.name)} (${plural(p.attendance.lateMinutes, "minute")})`);
  if (late.length) out.push(`Late: ${listOf(late)}${attendance}`);
  return out;
}

/**
 * A task in the document: its title in quotes, linked to its page when there is one (lib/evidence-links escapes the
 * label); the quoted, escaped title alone otherwise (no slug, no id).
 */
function taskMd(slug: string | null, t: { id: string; title: string }): string {
  const label = `“${t.title}”`;
  return slug && t.id && evidenceHref(slug, { kind: "task", id: t.id }) ? evidenceLink(slug, { kind: "task", id: t.id }, label) : `“${md(t.title)}”`;
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
async function assistantHeadline(ctx: OrgContext, s: WorkSummary, people: PersonDay[], attention: string[], waitingOnReader: number, usage: "person" | "workspace", requestId?: string): Promise<string | null> {
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
      // Decisions waiting on the reader (phase 7a): reviews, requests, time corrections, blocked tasks naming them.
      ...(waitingOnReader ? { decisionsWaitingForTheReader: waitingOnReader } : {}),
    };
    const ask = (effort: boolean) => client.messages.create({
      model: conn.model,
      max_tokens: 2048,
      ...(effort ? { output_config: { effort: "low" as const } } : {}),
      system: "You write the headline of Brenda's end-of-day team report in Boredroom, a work tracker for remote teams. Write exactly two plain sentences in British English for the supervisor reading it: what the people got done today (hours and finished work), then the most important thing that needs their attention, or that nothing does. Use only the facts given; never invent, rank, praise or blame anyone. No markdown, no lists, no greeting, at most 60 words.",
      messages: [{ role: "user", content: JSON.stringify(facts) }],
    });
    const res = await ask(true).catch((err: unknown) => { if (err instanceof Anthropic.BadRequestError) return ask(false); throw err; });
    // Only the response that came back is recorded (a refused first try returned none); never throws.
    const entry: UsageEntry = { purpose: "report", model: res.model ?? conn.model, usage: res.usage, ...(requestId ? { requestId } : {}) };
    await (usage === "workspace" ? recordWorkspaceUsage(ctx.org.id, entry) : recordUsage(ctx, entry));
    if (res.stop_reason !== "end_turn") return null;
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("").replace(/\s+/g, " ").trim();
    return text && text.length <= 420 && !/[#*`]/.test(text) ? text : null;
  } catch {
    return null;
  }
}

/** " ([note](…))": a source under a word of the line's own; "" when it has no page. */
function linkSuffix(slug: string, ref: EvidenceRef, label: string): string {
  return evidenceHref(slug, ref) ? ` (${evidenceLink(slug, ref, label)})` : "";
}

/** One decision as a markdown line's text: its quoted title linked in place, or the link after it. */
function decisionMd(slug: string, d: DecisionItem): string {
  const at = d.link && d.source && evidenceHref(slug, d.source) ? d.text.indexOf(d.link) : -1;
  if (at >= 0) return `${mdQuoted(d.text.slice(0, at))}${evidenceLink(slug, d.source!, d.link!)}${mdQuoted(d.text.slice(at + d.link!.length))}`;
  return `${mdQuoted(d.text)}${d.source ? sourcesSuffix(slug, [d.source]) : ""}`;
}

/** Items shown per kind in "Decisions for you", then "And 3 more reviews". */
export const DECISIONS_SHOWN = 10;

/**
 * "## Decisions for you" (owner decision, 8 October 2026: phase 7a): reviews, requests, time corrections, blocked tasks
 * naming the reader, each linked to its source; a list that could not be read says so; nothing reads "Nothing is
 * waiting on you."
 */
export function decisionsMarkdown(slug: string, d: DailyReport["decisions"]): string[] {
  const lines = ["## Decisions for you", ""];
  const groups: { label: string; one: string; many: string; items: DecisionItem[] | null; page: EvidenceRef | null }[] = [
    { label: "Reviews", one: "review", many: "reviews", items: d.reviews, page: { kind: "review" } },
    { label: "Requests", one: "request", many: "requests", items: d.requests, page: null },
    { label: "Time corrections", one: "time correction", many: "time corrections", items: d.corrections, page: { kind: "time_correction" } },
    { label: "Blocked tasks", one: "blocked task", many: "blocked tasks", items: d.blocked, page: null },
  ];
  for (const g of groups) {
    if (g.items === null) { lines.push(`- ${g.label}: ${NOT_AVAILABLE}`); continue; }
    const shown = g.items.slice(0, DECISIONS_SHOWN);
    lines.push(...shown.map((x) => `- ${decisionMd(slug, x)}`));
    const more = g.items.length - shown.length;
    if (more > 0) lines.push(`- And ${plural(more, `more ${g.one}`, `more ${g.many}`)}${g.page ? sourcesSuffix(slug, [g.page]) : ""}`);
  }
  if (lines.length === 2) lines.push("Nothing is waiting on you.");
  return lines;
}

/** Links shown per group in "Changed since yesterday", then "and 3 more". */
export const CHANGES_SHOWN = 8;

/**
 * "## Changed since yesterday" (owner decision, 8 October 2026: phase 7a): one line per kind of change, its tasks linked
 * with who holds them; kinds with nothing are left out.
 */
export function changesMarkdown(slug: string, c: ReportChanges | "not_available"): string[] {
  if (c === "not_available") return ["## Changed since yesterday", "", `${sentence(NOT_AVAILABLE)}: there is no earlier report to compare with.`];
  const lines = [`## Changed since ${c.sinceLabel}`, ""];
  const groups: [string, ChangeItem[]][] = [["Newly blocked", c.newlyBlocked], ["Unblocked", c.unblocked], ["Deadline moved later", c.slipped], ["Newly late", c.newlyLate], ["Finished", c.finished]];
  for (const [label, items] of groups) {
    if (!items.length) continue;
    const shown = items.slice(0, CHANGES_SHOWN).map((i) => `${taskMd(slug, { id: i.taskId, title: i.title })} (${md(i.person)}${i.detail ? `, ${md(i.detail)}` : ""})`);
    lines.push(`- **${label}**: ${shown.join(", ")}${items.length > CHANGES_SHOWN ? ` and ${items.length - CHANGES_SHOWN} more` : ""}`);
  }
  if (lines.length === 2) lines.push(`Nothing changed since ${c.sinceLabel}.`);
  if (c.truncated) lines.push("", "_Some changes may not be listed._");
  return lines;
}

/**
 * The document: the author's line, the headline, a section per person, then what needs attention. The author is the
 * assistant who wrote it (owner decision, 7 October 2026: personal assistants): the workspace's own assistant for the
 * end-of-day report, the asker's own for a report they asked for; Brenda when nobody says.
 */
export function reportMarkdown(ctx: OrgContext, r: DailyReport, opts: { writtenAt: Date; endOfDay: boolean; reportTime: string; author?: string; workspaceName?: string }): string {
  const tz = ctx.org.timezone;
  const slug = ctx.org.slug;
  const author = opts.author ?? DEFAULT_ASSISTANT_NAME;
  const by = opts.endOfDay
    ? `_${author} wrote this end-of-day report for you at ${hhmm(opts.writtenAt, tz)} on ${dayLabel(r.localDate)}, from what was recorded in Boredroom. Only you can read it._`
    : `_${author} wrote this for you at ${hhmm(opts.writtenAt, tz)} on ${dayLabel(r.localDate)}, when you asked, from what was recorded in Boredroom so far. The end-of-day report at ${opts.reportTime} brings it up to date. Only you can read it._`;
  const lines = [by, "", `**${md(r.headline)}**`, ""];
  // Phase 7a: what waits on the reader first, then what changed since their previous report, then the people.
  if (r.decisions) lines.push(...decisionsMarkdown(slug, r.decisions), "");
  if (r.changes) lines.push(...changesMarkdown(slug, r.changes), "");
  // Phase 7b: the commitments made today and overdue, after the changes.
  if (r.commitments) lines.push(...commitmentsMarkdown(slug, r.commitments), "");
  // Attendance links to its page for those who may read everyone's (team leads and organisation accounts).
  const role = ctx.membership.role;
  const attendance = role === "manager" || role === "owner" || role === "hr" ? sourcesSuffix(slug, [{ kind: "attendance" }]) : "";
  const quiet: string[] = [];
  for (const p of r.people) {
    const notes: string[] = [];
    // Each title links its task (phase 7a); a title without its id (read a moment apart) is shown as text.
    const refs = p.taskRefs;
    const tasks = (shown: TaskRef[] | undefined, titles: string[]) => (shown?.length ? shown : titles.map((title) => ({ id: "", title }))).map((t) => taskMd(slug, t));
    const completed = tasks(refs?.completed, p.completedTitles);
    if (completed.length) notes.push(`- Finished: ${completed.join(", ")}${p.tasksCompleted > completed.length ? ` and ${plural(p.tasksCompleted - completed.length, "more")}` : ""}`);
    const submitted = tasks(refs?.submitted, p.submittedTitles);
    if (submitted.length) notes.push(`- Sent for review: ${submitted.join(", ")}`);
    const inProgress = refs?.inProgress.length ? refs.inProgress : p.inProgress.map((t) => ({ ...t, id: "" }));
    if (inProgress.length) notes.push(`- In progress: ${inProgress.slice(0, 8).map((t) => `${taskMd(slug, t)} (${t.progress}%)`).join(", ")}${inProgress.length > 8 ? ` and ${plural(inProgress.length - 8, "more")}` : ""}`);
    if (p.overdueOpen) {
      const overdue = tasks(refs?.overdue, p.overdueTitles);
      notes.push(`- Overdue: ${overdue.join(", ")}${p.overdueOpen > overdue.length ? ` and ${plural(p.overdueOpen - overdue.length, "more")}` : ""}`);
    }
    const blocked = refs?.blocked.length ? refs.blocked : p.blocked.map((b) => ({ ...b, id: "" }));
    if (blocked.length) notes.push(`- Blocked: ${blocked.slice(0, 5).map((b) => `${taskMd(slug, b)}${b.reason ? ` (${mdQuoted(clamp(oneLine(b.reason), 160))})` : ""}`).join(", ")}${blocked.length > 5 ? ` and ${plural(blocked.length - 5, "more")}` : ""}`);
    const a = p.attendance;
    if (a.clockedInAt) notes.push(`- Attendance: clocked in at ${hhmm(a.clockedInAt, tz)}${a.lateMinutes ? `, ${plural(a.lateMinutes, "minute")} late` : ""}${attendance}`);
    else if (a.missing) notes.push(`- Attendance: did not clock in${attendance}`);
    if (!notes.length && !p.trackedSeconds) { quiet.push(md(p.name)); continue; }
    lines.push(`## ${md(p.name)}`, "", `${p.teams.length ? `${p.teams.map(md).join(", ")}. ` : ""}${sentence(hours(p.trackedHours))}.`, "", ...notes, "");
  }
  if (quiet.length) lines.push(`Nothing recorded today for ${listOf(quiet)}.`, "");
  // What each person's assistant said when the workspace's own assistant collected today's updates (phase 4), each
  // linked to the follow-up it came from (phase 7a).
  if (r.updates?.length) {
    const asker = opts.workspaceName ?? DEFAULT_ASSISTANT_NAME;
    lines.push("## Updates", "", `_${md(asker)} asked everyone's assistant for today's update${r.updatesAt ? ` at ${hhmm(r.updatesAt, tz)}` : ""}._`, "",
      ...r.updates.map((u) => `- **${md(u.name)}**: ${mdQuoted(clamp(oneLine(u.line), UPDATE_LINE_MAX))}${u.id ? sourcesSuffix(slug, [{ kind: "follow_up", id: u.id }]) : ""}`), "");
  }
  // Phase 7c: today's standup rollups the reader receives, after the Updates and before the notes.
  if (r.standup?.teams.length) lines.push(...standupMarkdown(slug, r.standup), "");
  // What people asked their assistant to put in today's report (phase 6), in their own words, quoted as typed, each
  // linked to the note (phase 7a).
  if (r.notes?.length) {
    lines.push("## Notes from the team", "",
      ...r.notes.map((x) => `- **${md(x.name)}** via ${md(x.assistantName)}, ${hhmm(x.at, tz)}: “${mdQuoted(clamp(oneLine(x.body), NOTE_MAX))}”${linkSuffix(slug, { kind: "assistant_item", id: x.id ?? null }, "note")}`), "");
  }
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

/** The headline back out of a saved report (the bold line under the author's), for a report that is not rebuilt. */
const headlineOf = (body: string) => /^\*\*(.+)\*\*$/m.exec(body)?.[1]?.replace(/\\(.)/g, "$1") ?? "";

/**
 * Builds and saves today's report as the person. endOfDay: the scheduled send, once per day (sent_at), with a
 * notification. Otherwise the person asked: today's sent report is returned as it is, or the report so far is
 * written (or refreshed, if they have not edited it since) and lands only on them.
 */
async function deliver(ctx: OrgContext, mode: "end_of_day" | "asked", opts: { useAssistant?: boolean; reportTime: string; author: string; workspaceName: string; requestId?: string }): Promise<Outcome> {
  const today = todayLocal(ctx.org.timezone);
  const href = (id: string) => `/app/${ctx.org.slug}/docs/${id}`;
  type Row = { id: string; doc_id: string | null; sent_at: string | null; title: string | null; body: string | null; readable: boolean };
  const rowSql = `SELECT l.id, l.doc_id, l.sent_at, d.title, d.body, (d.id IS NOT NULL AND d.archived_at IS NULL) AS readable
                  FROM brenda_report_log l LEFT JOIN documents d ON d.id = l.doc_id WHERE l.membership_id = $1 AND l.local_date = $2`;
  const existing = (row: Row): Outcome => ({ status: mode === "end_of_day" ? "already_sent" : "existing", saved: { docId: row.doc_id!, title: row.title ?? "", headline: headlineOf(row.body ?? ""), href: href(row.doc_id!), people: 0 } });
  // A cheap look first: a second run on the same day costs one query.
  const before = await withUser(ctx.user.profileId, (db) => db.maybeOne<Row>(rowSql, [ctx.membership.id, today]));
  if (before?.sent_at && (mode === "end_of_day" || before.readable)) return mode === "end_of_day" ? { status: "already_sent" } : existing(before);

  // The end-of-day send is the workspace's own job in the usage ledger; a report asked for is the person's.
  const report = await buildDailyReport(ctx, { useAssistant: opts.useAssistant, usage: mode === "end_of_day" ? "workspace" : "person", requestId: opts.requestId });
  // Notes from the team (phase 6), read as the recipient: a day with notes is sent even when nothing else happened.
  report.notes = await reportNotes(ctx, report.localDate);
  if (report.notes.length) report.empty = false;
  if (report.empty) return { status: "nothing" };
  // The updates the workspace's assistant collected today, read as the recipient (phase 4); none before 0039 or when off.
  Object.assign(report, await reportUpdates(ctx, report));
  // Asked for after the end-of-day report went out (and was archived since): it is written as the day's report, not "so far".
  const body = reportMarkdown(ctx, report, { writtenAt: new Date(), endOfDay: mode === "end_of_day" || !!before?.sent_at, reportTime: opts.reportTime, author: opts.author, workspaceName: opts.workspaceName });

  const written = await withUser(ctx.user.profileId, async (db) => {
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
    // The state this report was written from, for tomorrow's "Changed since yesterday" (phase 7a): a report asked for
    // during the day refreshes it, the end-of-day send writes the last one. Under a savepoint: a snapshot that cannot be
    // saved is logged and left as it was, never failing the report.
    if (report.snapshot && (await schema0046Ready(db))) {
      await db.query("SAVEPOINT report_snapshot");
      try {
        await db.query(`UPDATE brenda_report_log SET snapshot = $2::jsonb WHERE id = $1`, [row.id, JSON.stringify(report.snapshot)]);
        await db.query("RELEASE SAVEPOINT report_snapshot");
      } catch (err) {
        await db.query("ROLLBACK TO SAVEPOINT report_snapshot");
        if (isMissingSchema(err)) forget0046();
        console.warn(`[daily report] snapshot not saved: ${(err as Error)?.message ?? err}`);
      }
    }
    if (mode === "end_of_day") {
      await notify(db, { organisationId: ctx.org.id, recipientMembershipId: ctx.membership.id, type: "brenda.daily_report", title: `Your team report for ${dayLabel(report.localDate)} is ready`, body: report.headline.slice(0, 300), resourceType: "document", resourceId: docId, href: href(docId), dedupKey: `brenda.daily_report:${report.localDate}` });
    }
    await logAction(db, ctx, { tool: "team_report", summary: `${mode === "end_of_day" ? "Sent you" : refreshed ? "Brought up to date" : "Wrote you"} the team report for ${dayLabel(report.localDate)}`, outcome: "done", source: mode === "end_of_day" ? "automatic" : "chat", detail: { docId, people: report.people.length } });
    return { status: mode === "end_of_day" ? "sent" as const : "saved" as const, saved: { docId, title: report.title, headline: report.headline, href: href(docId), people: report.people.length } };
  });
  // The notes it carried are in a report now (one asked for early included): their authors can no longer withdraw them
  // (review, 8 October 2026).
  if ((written.status === "sent" || written.status === "saved") && report.notes.length) {
    const { markNotesInReport } = await import("@/server/services/assistant-items");
    await markNotesInReport(report.notes.map((n) => n.id ?? "").filter(Boolean));
  }
  return written;
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
export async function teamReportNow(ctx: OrgContext, opts: { useAssistant?: boolean; requestId?: string } = {}): Promise<TeamReportNow> {
  const refusal = await refusalFor(ctx);
  if (refusal) return { status: "refused", message: refusal };
  // An asked-for report is one of the person's daily requests (review, 8 October 2026). Inside a chat turn (requestId) it
  // is that turn's, already allowed; asked for on its own (Settings) and past the limit, the plain headline is used.
  if (opts.useAssistant !== false && !opts.requestId) {
    const a = await aiAllowance(ctx).catch(() => null);
    if (a?.ready && a.remaining <= 0) opts = { ...opts, useAssistant: false };
  }
  // A report the person asked for is signed by their own assistant (owner decision, 7 October 2026: personal assistants).
  // The Updates section is signed by the workspace's own assistant, which collected them (phase 4).
  const { settings, personal, workspace } = await withUser(ctx.user.profileId, async (db) => ({ settings: await brendaSettings(db, ctx.org.id), personal: await readPersonalAssistant(db, ctx.membership.id), workspace: await readWorkspaceAssistant(db, ctx.org.id) }));
  const r = await deliver(ctx, "asked", { useAssistant: opts.useAssistant, reportTime: settings.dailyReportTime, author: personal.name, workspaceName: workspace.name, requestId: opts.requestId });
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
  type Pre = { skip: "off" | "stale" | "plan" | "not_a_recipient" } | { who: { ctx: OrgContext; email: string | null }; settings: BrendaSettings; workspace: AssistantProfile };
  const pre = await withWorker(async (db): Promise<Pre> => {
    const who = await recipientContext(db, p.organisationId, p.membershipId);
    if (!who || who.ctx.org.status !== "active") return { skip: "not_a_recipient" };
    const settings = await brendaSettings(db, p.organisationId);
    if (!settings.dailyReportEnabled) return { skip: "off" };
    if (p.localDate !== todayLocal(who.ctx.org.timezone)) return { skip: "stale" };
    if (!who.ctx.plan.features.AI_ASSISTANT) return { skip: "plan" };
    const recipients = await reportRecipients(db, p.organisationId, settings.dailyReportOrgWide);
    if (!recipients.some((x) => x.id === p.membershipId)) return { skip: "not_a_recipient" };
    // The end-of-day report goes out on its own, so the workspace's own assistant signs it (owner decision, 7 October
    // 2026: personal assistants).
    return { who, settings, workspace: await readWorkspaceAssistant(db, p.organisationId) };
  });
  if ("skip" in pre) return { status: pre.skip };
  const { ctx, email } = pre.who;
  const r = await deliver(ctx, "end_of_day", { useAssistant: opts.useAssistant, reportTime: pre.settings.dailyReportTime, author: pre.workspace.name, workspaceName: pre.workspace.name });
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
          intro: [r.saved.headline, `${pre.workspace.name} saved the full report, person by person, in your Docs. Only you can read it.`],
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
