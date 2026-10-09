/**
 * The built-in routine templates (owner decision, 8 October 2026: phase 7a, routines): what a person's own assistant does
 * on a schedule they set. Four templates, fixed code and no model:
 * - morning_brief: what is waiting on the person (the morning opener's content), with links;
 * - still_owed (the Friday roundup): open follow-ups, unanswered messages and requests between assistants (sent and
 *   received), overdue or blocked tasks, assignments nobody picked up; silent when there is nothing (by default);
 * - afternoon_check: speaks only when something is blocked on the person, ready for them, or due today with no progress,
 *   and reports each thing once (routine_reported_items, migration 0046);
 * - chase_stalled: tasks with no progress for 2 working days (the owner's stalled rule) on the teams the person leads,
 *   each asked about once through a follow-up to the assignee's assistant (phase 4), then who was asked;
 * - loose_ends (owner decisions, 8 October 2026: phase 7b): the person's loose ends found since its last run (promises
 *   they made, asks of them, asks they made that never became a to-do, reminder, follow-up or commitment), privately.
 *   The one template that may use the model, bounded: its scan (loose-end-detect.ts, loaded when needed) makes at most one
 *   call a run, one of the person's daily requests, and nothing here touches the model or its SDK itself.
 *
 * Phase 7b also adds to the Friday roundup (still_owed) the person's open loose ends and their overdue commitments (left
 * out before migration 0048), and to the chase a stall it already asked about once ("stalled a second time"): its
 * follow-up's answer then carries a new due date suggested to the lead (follow-ups.ts; a Confirm, never automatic).
 *
 * Every read runs as the person, through the services their own pages use, so a routine never sees more than they do. A
 * read that fails makes its section "not available" (never 0) and the run still completes; a feature that is not there
 * (before 0039 or 0043, a role without it) leaves its section out. Other people's words (comments, notes, reasons,
 * questions, message text) appear only clipped, in an item's detail, never in its text's first words or in an action.
 *
 * Consent (contract D.2, D.3): the person's Enable press, after the preview, is their standing yes for exactly what
 * consentLines says, and a run does nothing else. The only actions any template takes are the chase's follow-ups, made
 * with createFollowUps as the person, within every follow-up permission and limit (refusals are recorded and the run goes
 * on), and the loose-ends scan's own rows (the person's, private). This file never prepares or presses a Confirm and
 * never calls a model itself (tests/unit/routine-guard.test.ts). `preview` makes the same reads and writes nothing: no
 * follow-ups, no scan, no dedupe keys.
 */
import { withUser } from "@/server/db";
import type { OrgContext } from "@/server/lib/api";
import { AppError } from "@/server/lib/errors";
import { addDays, localDate, localMidnight } from "@/server/lib/time";
import { workingDaySeconds, workingTimeBefore, type WorkingSchedule } from "@/server/lib/working-time";
import { reviewQueue } from "@/server/services/views";
import { createFollowUps, listMyFollowUps, waitingForMe } from "@/server/services/follow-ups";
import { orgClock } from "@/server/services/follow-up-facts";
import { morningOpener, openerSince, type OpenerDetail } from "@/server/services/opener";
import { clamp, oneLine } from "@/server/services/copilot-excerpt";
import { OPEN_STATUSES, firstName, whenLabel, type FollowUpView } from "@/lib/follow-ups";
import { toProfile } from "@/lib/assistant-look";
import { ROUTINE_LIMITS, ROUTINE_WORDS, type Cadence, type RoutineActionRecord, type RoutineItem, type RoutineOutput, type RoutineParams, type RoutineSection, type RoutineTemplate } from "@/lib/routines";
import type { EvidenceRef } from "@/lib/evidence-links";
import type { AssistantItemView } from "@/lib/assistant-items";
import type { LooseEndKind, LooseEndView } from "@/lib/commitments";

/**
 * Who a chase covered when the person pressed Enable (review, 8 October 2026): the team ids and the people's membership
 * ids, sorted. A run asks about nobody outside it; a run that would cover anyone else pauses for a new Enable.
 */
export type ChaseCover = { teams: string[]; people: string[] };
export type RoutineRow = {
  id: string; organisationId: string; membershipId: string; template: RoutineTemplate; name: string; params: RoutineParams;
  cadence: Cadence; time: string; quietWhenEmpty: boolean; enabled: boolean;
  consent: { hash: string; lines: string[]; at: string; cover?: ChaseCover | null } | null;
};
export type TemplateResult = {
  output: RoutineOutput; empty: boolean; counts: Record<string, number | null>;
  /** What the run did (the chase's follow-ups); in a preview, what it would do (done false). */
  actions: RoutineActionRecord[];
  /** Keys to record as reported (run mode only; [] in a preview). */
  reportedKeys: string[];
  /** The run spent a model call (the loose-ends scan; review, 9 October 2026): recorded as the run's used_model. */
  usedModel?: boolean;
};
/**
 * `timeZone`: the person's own (routines run on their clock; the worker's claim and the preview pass it), for "today"
 * and the times in the words. Without it, the organisation's.
 */
type Opts = { mode: "preview" | "run"; now?: Date; runId?: string; since?: string | null; timeZone?: string | null };

/** Each template's name, one-line description and default name (lib/routines' words). */
export const TEMPLATE_WORDS: Record<RoutineTemplate, { name: string; description: string; defaultName: string }> = ROUTINE_WORDS.templates;

// ---- Small helpers -------------------------------------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
/** A draft's preview runs under the nil id (routines.ts): it has reported nothing. */
const NIL = "00000000-0000-0000-0000-000000000000";
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** Other people's words: one line, at most 140 characters. */
const theirWords = (s: string | null | undefined) => (s && s.trim() ? clamp(oneLine(s), 140) : null);
/** A title inside a line: one line, at most 120 characters, in curly quotes. */
const q = (title: string) => `“${clamp(oneLine(title), 120)}”`;
const andList = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const task = (id: string | null | undefined): EvidenceRef[] => (id ? [{ kind: "task", id }] : []);
const warn = (what: string) => (err: unknown) => console.warn(`[routines] ${what}: ${(err as Error)?.message ?? err}`);

/** A read that may fail: null (its section reads "not available") instead of a throw. */
async function attempt<T>(what: string, fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch (err) { warn(`${what} unavailable`)(err); return null; }
}

/**
 * A section from its items: `undefined` leaves it out (the feature is not there), `null` is "not available". Empty ones
 * are dropped from the output (the counts keep them as 0).
 */
type Draft = { id: string; label: string; items: RoutineItem[] | null | undefined };

function build(p: { title: string; lead: (n: number) => string; calm: string; drafts: Draft[]; actions?: RoutineActionRecord[]; now: Date; forceEmpty?: boolean }): { output: RoutineOutput; empty: boolean; counts: Record<string, number | null> } {
  const max = ROUTINE_LIMITS.sectionItems;
  const present = p.drafts.filter((d): d is Draft & { items: RoutineItem[] | null } => d.items !== undefined);
  const counts: Record<string, number | null> = {};
  for (const d of present) counts[d.id] = d.items ? d.items.length : null;
  const sections: RoutineSection[] = present
    .filter((d) => d.items === null || d.items.length > 0)
    .map((d) => ({ id: d.id, label: d.label, items: (d.items ?? []).slice(0, max), more: d.items ? Math.max(0, d.items.length - max) : 0, missing: d.items === null }));
  const total = present.reduce((n, d) => n + (d.items?.length ?? 0), 0);
  const missing = sections.some((s) => s.missing);
  // A figure that could not be read is never a calm "nothing" (principle 3): a run with a missing section is sent.
  const empty = p.forceEmpty ?? (total === 0 && !missing && !(p.actions ?? []).length);
  const lead = empty ? p.calm : total === 0 ? "Some of this could not be read just now." : p.lead(total);
  return {
    output: { v: 1, title: p.title, lead, empty, calm: empty ? p.calm : null, sections, actions: p.actions ?? [], generatedAt: p.now.toISOString() },
    empty, counts,
  };
}

/** The zone a run's "today" and times are in: the person's own when given, else the organisation's. */
const zoneFor = (ctx: OrgContext, o: Pick<Opts, "timeZone">) => o.timeZone || ctx.org.timezone;
/** "Wed 7 Oct 16:02", or "16:02" today, in that zone. */
const whenOf = (tz: string, now: Date) => (iso: string | null | undefined) => (iso ? whenLabel(iso, tz, now) : "");

// ---- Whose words name whom ---------------------------------------------------------------------------------------------

/** Lower case, accents set aside (NFD without combining marks), single spaces. */
const fold = (s: string) => s.normalize("NFKD").replace(/\p{M}+/gu, "").toLocaleLowerCase("en-GB").replace(/\s+/g, " ").trim();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Whether a blocked reason names the person: their full display name, or their first name when it has at least 3
 * letters, as a whole word, ignoring case and accents ("Ben" is in "waiting on ben" and "@Ben", never in "Benefits").
 * The end-of-day report's "Decisions for you" uses the same rule (daily-report.ts imports it).
 */
export function namesPerson(reason: string | null | undefined, displayName: string): boolean {
  const text = fold(String(reason ?? ""));
  const full = fold(String(displayName ?? ""));
  if (!text || !full) return false;
  const first = full.split(" ")[0] ?? "";
  const words = [full, ...([...first].filter((ch) => /\p{L}/u.test(ch)).length >= 3 && first !== full ? [first] : [])];
  return words.some((w) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(w)}(?![\\p{L}\\p{N}])`, "u").test(text));
}

/**
 * Where "no progress for 2 working days" starts (the owner's stalled rule, 8 October 2026): two working days of the
 * organisation's schedule before now, counting working hours only. Monday 10:00 with 09:00 to 17:00 hours is Thursday
 * 10:00 (an hour on Monday, Friday's eight, seven on Thursday).
 */
export function stalledSince(now: Date, schedule: WorkingSchedule): Date {
  return workingTimeBefore(now, schedule, ROUTINE_LIMITS.stalledWorkingDays * workingDaySeconds(schedule));
}

// ---- Consent -------------------------------------------------------------------------------------------------------------

const PEOPLE_SHOWN = 8;
const peopleWords = (people: string[]) => {
  const sorted = [...people].sort((a, b) => a.localeCompare(b, "en-GB"));
  return sorted.length > PEOPLE_SHOWN ? `${sorted.slice(0, PEOPLE_SHOWN).join(", ")} and ${sorted.length - PEOPLE_SHOWN} more` : sorted.join(", ");
};

/**
 * What the routine does each time, in the words shown at Enable and stored with the consent (contract C.5). Enabling is
 * the person's standing yes for exactly these lines. `teams`: for a chase, the teams it covers now with their people.
 */
export function consentLines(r: Pick<RoutineRow, "template" | "params" | "quietWhenEmpty">, o: { assistantName: string; teams: { id: string; name: string; people: string[] }[] }): string[] {
  const alone = "Nothing goes to anyone else.";
  switch (r.template) {
    case "morning_brief": return ["Send you a brief at the time set: what's waiting on you, with links.", alone];
    // Phase 7b: the roundup also lists the person's loose ends and overdue commitments (the lines are not in the consent
    // hash, so an enabled routine stays on).
    case "still_owed": return [
      "Send you what's still owed: follow-ups, messages between assistants, overdue or blocked tasks, assignments nobody picked up, your loose ends and overdue commitments.",
      ...(r.quietWhenEmpty ? ["Stay quiet when there's nothing."] : []), alone,
    ];
    case "afternoon_check": return ["Tell you only when something is blocked on you, ready for you, or due today with no progress, and each thing once.", alone];
    // Phase 7b (owner decisions, 8 October 2026): the one template that may use the model, at most once a run.
    case "loose_ends": return [
      "Look through the conversations you can read for promises you made, things asked of you and things you asked of others that never became a to-do, reminder, follow-up or commitment.",
      "Uses at most 1 of your daily assistant requests a run when the AI is on; without it, only the clearest ones.",
      ...(r.quietWhenEmpty ? ["Stay quiet when there's nothing new."] : []),
      "Send you what it found, privately. Nothing goes to anyone else, and nothing is added to your lists until you choose.",
    ];
    default: {
      const teams = o.teams.map((t) => `${t.name}${t.people.length ? ` (${peopleWords(t.people)})` : ""}`);
      const who = teams.length ? `people on ${andList(teams)}` : "people on the teams you lead";
      return [
        `Each time, ask the assistants of ${who} about their tasks with no progress for ${ROUTINE_LIMITS.stalledWorkingDays} working days: at most ${ROUTINE_LIMITS.chasePerRun} a run, within your daily follow-up limit.`,
        "Their assistant answers from their work, or asks them once. Nothing on their tasks changes.",
        "Send you who was asked.",
      ];
    }
  }
}

// ---- Running a template ----------------------------------------------------------------------------------------------

export async function runTemplate(ctx: OrgContext, r: RoutineRow, o: Opts): Promise<TemplateResult> {
  const now = o.now ?? new Date();
  switch (r.template) {
    case "morning_brief": return morningBrief(ctx, o, now);
    case "still_owed": return stillOwed(ctx, o, now);
    case "afternoon_check": return afternoonCheck(ctx, r, o, now);
    case "chase_stalled": return chaseStalled(ctx, r, o, now);
    case "loose_ends": return looseEnds(ctx, r, o, now);
    default: throw new AppError(422, "INVALID_INPUT", "That routine's template is not one Boredroom knows.");
  }
}

// ---- Morning brief (C.1) ---------------------------------------------------------------------------------------------------

/** The opener's lists as the brief's sections (also what the notch and the web opener count). */
export function briefSections(d: OpenerDetail, when: (iso: string | null | undefined) => string): Draft[] {
  const join = <T>(a: T[] | null | undefined, b: T[] | null | undefined) => (a === undefined && b === undefined ? undefined : a === null || b === null ? null : [...(a ?? []), ...(b ?? [])]);
  const map = <T>(xs: T[] | null | undefined, f: (x: T) => RoutineItem) => (xs === undefined ? undefined : xs === null ? null : xs.map(f));
  const requests = map(d.requests, (x) => ({ text: `${x.fromFirst} asks you to accept: ${x.summary}`, sources: [{ kind: "assistant_item", id: x.id }] }));
  const asks = map(d.asks, (x) => ({
    text: x.fromFirst ? `${x.fromFirst}'s ${x.assistant} asks${x.taskTitle ? ` about ${q(x.taskTitle)}` : ""}` : `${x.assistant} asks for today's team report`,
    detail: theirWords(x.question) ? `“${theirWords(x.question)}”` : null, sources: [{ kind: "follow_up", id: x.id }, ...task(x.taskId)],
  }));
  const answerWords = (s: string) => (s === "expired" ? "no reply, answered from their work" : s === "declined" ? "can't answer right now" : "answered");
  const submissions = map(d.submissions, (x) => ({ text: `Review ${q(x.title)} from ${x.from}`, detail: x.submittedAt ? `sent ${when(x.submittedAt)}` : null, sources: task(x.taskId) }));
  const corrections = map(d.corrections, (x) => ({ text: `Time correction from ${x.from} on ${q(x.taskTitle)}`, sources: [{ kind: "time_correction", id: x.id }] }));
  return [
    { id: "overdue", label: "Overdue", items: map(d.overdue, (x) => ({ text: q(x.title), detail: x.due ? `was due ${when(x.due)}` : null, sources: task(x.id) })) },
    { id: "due_today", label: "Due today", items: map(d.dueToday, (x) => ({ text: q(x.title), detail: x.due ? `due ${when(x.due)}` : null, sources: task(x.id) })) },
    { id: "requests", label: "Requests waiting for you", items: join(requests, asks) },
    { id: "answers", label: "Answers to your follow-ups", items: map(d.answers, (x) => ({ text: `${x.subjectFirst} on ${x.taskTitle ? q(x.taskTitle) : "what they're working on"}: ${answerWords(x.status)}`, sources: [{ kind: "follow_up", id: x.id }, ...task(x.taskId)] })) },
    { id: "items", label: "From other assistants", items: map(d.items, (x) => ({ text: x.kind === "reply" ? `${x.fromFirst} replied to your message` : `${x.fromFirst} passed you a message`, detail: theirWords(x.body) ? `“${theirWords(x.body)}”` : null, sources: [{ kind: "assistant_item", id: x.id }] })) },
    { id: "reviews", label: "Reviews waiting for you", items: join(submissions, corrections) },
  ];
}

async function morningBrief(ctx: OrgContext, o: Opts, now: Date): Promise<TemplateResult> {
  const since = openerSince(o.since ?? null, now).toISOString();
  const opener = await morningOpener(ctx, { since, now, timeZone: o.timeZone });
  const b = build({
    title: "Morning brief", calm: "Nothing is waiting on you this morning.", now,
    lead: (n) => (n === 1 ? "1 thing is waiting on you." : `${n} things are waiting on you.`),
    drafts: briefSections(opener.detail, whenOf(zoneFor(ctx, o), now)),
  });
  return { ...b, actions: [], reportedKeys: [] };
}

// ---- What's still owed (C.2) -----------------------------------------------------------------------------------------------

type OwedTask = { id: string; title: string; status: string; due_at: string | null; blocked_reason: string | null; assignee_name: string; mine: boolean };

async function stillOwed(ctx: OrgContext, o: Opts, now: Date): Promise<TemplateResult> {
  const role = ctx.membership.role;
  const when = whenOf(zoneFor(ctx, o), now);
  const items = await import("@/server/services/assistant-items");
  // The tasks and the assignments nobody picked up in one transaction, as the person (review, 8 October 2026: the whole
  // briefing, with its review queue, was read only for the latter; the query is the briefing's own).
  const [mine, sent, waiting, asks, loose, owedCommitments, taskReads] = await Promise.all([
    attempt("open follow-ups", () => listMyFollowUps(ctx, { status: "open", limit: 50 })),
    attempt("sent items", () => items.listAssistantItems(ctx, { box: "sent", status: "open", limit: 50 })),
    attempt("items waiting", () => items.listAssistantItems(ctx, { box: "waiting", limit: 50 })),
    attempt("asks waiting", () => waitingForMe(ctx)),
    // Phase 7b: the person's open loose ends (no scan) and their overdue commitments; both `ready: false` before 0048.
    attempt("loose ends", async () => (await import("@/server/services/loose-ends")).listLooseEnds(ctx, { status: "open", limit: 50 })),
    attempt("overdue commitments", async () => (await import("@/server/services/commitments")).listCommitments(ctx, { scope: "mine", status: "overdue", limit: 50 })),
    withUser(ctx.user.profileId, async (db) => ({
      tasks: await db.query<OwedTask>(
        `SELECT t.id, t.title, t.status, t.due_at, t.blocked_reason, p.display_name AS assignee_name, (t.assignee_membership_id = $2) AS mine
         FROM tasks t JOIN memberships m ON m.id = t.assignee_membership_id JOIN profiles p ON p.id = m.user_id
         WHERE t.organisation_id = $1 AND t.archived_at IS NULL
           AND (t.status = 'blocked' OR (t.status NOT IN ('completed', 'in_review') AND t.due_at < now()))
           AND (t.assignee_membership_id = $2 OR app_manages($1, t.assignee_membership_id) OR app_has_role($1, 'owner', 'hr'))
         ORDER BY (t.status = 'blocked') DESC, t.due_at NULLS LAST, t.created_at LIMIT 50`, [ctx.org.id, ctx.membership.id]) as OwedTask[] | null,
      unanswered: role === "employee" ? undefined : await db.query<{ id: string; title: string; assignee_name: string }>(
        `SELECT t.id, t.title, pa.display_name AS assignee_name
         FROM tasks t JOIN memberships ma ON ma.id = t.assignee_membership_id JOIN profiles pa ON pa.id = ma.user_id
         WHERE t.organisation_id = $1 AND t.created_by = $2 AND t.assignee_membership_id <> $2 AND t.archived_at IS NULL AND t.status = 'todo'
           AND t.created_at < now() - interval '24 hours' AND NOT EXISTS (SELECT 1 FROM work_sessions s WHERE s.task_id = t.id)
         ORDER BY t.created_at LIMIT 20`, [ctx.org.id, ctx.membership.id]) as { id: string; title: string; assignee_name: string }[] | null | undefined,
    })).catch((err) => { warn("overdue or blocked tasks unavailable")(err); return { tasks: null, unanswered: role === "employee" ? undefined : null }; }),
  ]);
  const tasks = taskReads.tasks;

  const followUpsReady = !mine || mine.ready;
  const fu = (v: FollowUpView): RoutineItem => {
    const about = v.task ? `about ${q(v.task.title)}` : "about what they're working on";
    return { text: v.status === "asking" ? `Waiting for ${v.subject.firstName}'s reply ${about}` : `${v.subject.firstName} hasn't answered ${about} yet`, sources: [{ kind: "follow_up", id: v.id }, ...task(v.task?.id)] };
  };
  const followUps = !followUpsReady ? undefined : mine ? mine.batches.flatMap((b) => b.items).filter((v) => OPEN_STATUSES.includes(v.status)).map(fu) : null;

  const sentItems = sent === null ? null : !sent.ready ? undefined : sent.items
    .filter((v) => (v.kind === "request" && (v.status === "delivered" || v.status === "seen")) || (v.kind === "message" && v.status === "delivered"))
    .map((v): RoutineItem => {
      const first = v.recipient?.firstName ?? "They";
      return v.kind === "request"
        ? { text: `${first} hasn't answered your request: ${v.request?.summary ?? "a change"}`, sources: [{ kind: "assistant_item", id: v.id }] }
        : { text: `${first} hasn't seen your message yet`, sources: [{ kind: "assistant_item", id: v.id }] };
    });

  const theirs = (v: AssistantItemView): RoutineItem => (v.kind === "request"
    ? { text: `You haven't answered ${v.sender.firstName}'s request: ${v.request?.summary ?? "a change"}`, sources: [{ kind: "assistant_item", id: v.id }] }
    : { text: `${v.sender.firstName}'s ${v.kind === "reply" ? "reply" : "message"} isn't marked as seen`, sources: [{ kind: "assistant_item", id: v.id }] });
  const itemsAbsent = waiting !== null && !waiting.ready;
  const receivedItems = waiting === null ? null : itemsAbsent ? [] : waiting.items.filter((v) => v.viewer === "recipient").map(theirs);
  const askItems = !followUpsReady ? [] : asks === null ? null : asks.map((v): RoutineItem => ({
    text: v.requester ? `${v.requester.firstName}'s ${v.requester.assistant.name} is waiting for your reply` : `${v.workspaceAssistant?.name ?? "Brenda"} is waiting for your reply for today's team report`,
    detail: theirWords(v.question) ? `“${theirWords(v.question)}”` : null, sources: [{ kind: "follow_up", id: v.id }, ...task(v.task?.id)],
  }));
  const received = itemsAbsent && !followUpsReady ? undefined : receivedItems === null || askItems === null ? null : [...receivedItems, ...askItems];

  const owed = tasks === null ? null : tasks.map((t): RoutineItem => {
    const who = t.mine ? "" : ` (${t.assignee_name})`;
    return t.status === "blocked"
      ? { text: `${q(t.title)}${who} is blocked`, detail: theirWords(t.blocked_reason), sources: task(t.id) }
      : { text: `${q(t.title)}${who}, overdue since ${when(t.due_at)}`, sources: task(t.id) };
  });

  const notPickedUp = taskReads.unanswered === undefined ? undefined : taskReads.unanswered === null ? null
    : taskReads.unanswered.map((t): RoutineItem => ({ text: `${q(t.title)} for ${t.assignee_name || "someone"}, not started`, sources: task(t.id) }));

  // Phase 7b: left out before 0048 (`ready: false`), "not available" when the read failed.
  const looseItems = loose === null ? null : !loose.ready ? undefined : loose.items.map(looseEndItem);
  const commitmentItems = owedCommitments === null ? null : !owedCommitments.ready ? undefined : owedCommitments.items
    .filter((v) => v.viewer === "committer" && v.display === "overdue")
    .map((v): RoutineItem => ({
      text: `${q(v.title)}${v.asker ? ` for ${v.asker.firstName}` : ""}`, detail: v.dueLabel ? `was due ${v.dueLabel}` : null,
      sources: [{ kind: "commitment", id: v.id }, ...(v.message.href ? [{ kind: "message" as const, id: v.message.id, conversationId: v.where.conversationId }] : [])],
    }));

  const b = build({
    title: "What's still owed", calm: "Nothing is still owed.", now,
    lead: (n) => (n === 1 ? "1 thing is still owed." : `${n} things are still owed.`),
    drafts: [
      { id: "follow_ups", label: "Follow-ups waiting for an answer", items: followUps },
      { id: "sent", label: "Waiting on others' assistants", items: sentItems },
      { id: "received", label: "Waiting on you", items: received },
      { id: "tasks", label: "Overdue or blocked", items: owed },
      { id: "not_picked_up", label: "Nobody has picked up", items: notPickedUp },
      { id: "loose_ends", label: "Loose ends", items: looseItems },
      { id: "commitments", label: "Your overdue commitments", items: commitmentItems },
    ],
  });
  return { ...b, actions: [], reportedKeys: [] };
}

/** A loose end as a routine's line: its headline, its date, and links to the message and the loose end. */
function looseEndItem(v: LooseEndView): RoutineItem {
  return {
    text: clamp(oneLine(v.headline), 200), detail: v.dueLabel ? `due ${v.dueLabel}` : null,
    sources: [{ kind: "message", id: v.message.id, conversationId: v.message.conversationId }, { kind: "loose_end", id: v.id }],
  };
}

// ---- Afternoon check (C.3) -----------------------------------------------------------------------------------------------

/** Which of `keys` this routine already reported (foundation's helper, read as the worker; loaded when needed). */
async function alreadyReported(routineId: string, keys: string[]): Promise<Set<string>> {
  if (!isUuid(routineId) || routineId === NIL || !keys.length) return new Set();
  const { reportedKeys } = await import("@/server/services/routines");
  return new Set(await reportedKeys(routineId, keys));
}

type Keyed = { key: string; item: RoutineItem };

async function afternoonCheck(ctx: OrgContext, r: RoutineRow, o: Opts, now: Date): Promise<TemplateResult> {
  // "Today" is the person's own day: the routine runs at their time, in their zone (review, 8 October 2026).
  const tz = zoneFor(ctx, o);
  const role = ctx.membership.role;
  const when = whenOf(tz, now);
  const today = localDate(now, tz);
  const dayStart = localMidnight(today, tz).toISOString();
  const dayEnd = localMidnight(addDays(today, 1), tz).toISOString();
  const items = await import("@/server/services/assistant-items");
  const [blocked, waiting, asks, queue, due] = await Promise.all([
    attempt("blocked tasks", () => withUser(ctx.user.profileId, (db) => db.query<{ id: string; title: string; blocked_reason: string | null; assignee_name: string; changed_at: string | null }>(
      `SELECT t.id, t.title, t.blocked_reason, p.display_name AS assignee_name,
              (SELECT max(h.occurred_at) FROM task_status_history h WHERE h.task_id = t.id) AS changed_at
       FROM tasks t JOIN memberships m ON m.id = t.assignee_membership_id JOIN profiles p ON p.id = m.user_id
       WHERE t.organisation_id = $1 AND t.status = 'blocked' AND t.archived_at IS NULL AND t.assignee_membership_id <> $2
         AND t.blocked_reason IS NOT NULL AND btrim(t.blocked_reason) <> ''
       ORDER BY t.updated_at DESC LIMIT 200`, [ctx.org.id, ctx.membership.id]))),
    attempt("items waiting", () => items.listAssistantItems(ctx, { box: "waiting", kind: "request", limit: 50 })),
    attempt("asks waiting", () => waitingForMe(ctx)),
    attempt("the review queue", () => reviewQueue(ctx)),
    role === "employee" || role === "manager"
      ? attempt("today's tasks", () => withUser(ctx.user.profileId, (db) => db.query<{ id: string; title: string; due_at: string }>(
        `SELECT t.id, t.title, t.due_at FROM tasks t
         WHERE t.organisation_id = $1 AND t.assignee_membership_id = $2 AND t.archived_at IS NULL AND t.status NOT IN ('in_review', 'completed')
           AND t.due_at >= $3::timestamptz AND t.due_at < $4::timestamptz
           AND NOT EXISTS (SELECT 1 FROM task_status_history h WHERE h.task_id = t.id AND h.occurred_at >= $3::timestamptz)
           AND NOT EXISTS (SELECT 1 FROM task_comments c WHERE c.task_id = t.id AND c.author_membership_id = $2 AND c.created_at >= $3::timestamptz)
           AND NOT EXISTS (SELECT 1 FROM task_submissions s WHERE s.task_id = t.id AND s.submitted_at >= $3::timestamptz)
           AND NOT EXISTS (SELECT 1 FROM session_intervals i WHERE i.task_id = t.id AND i.confirmation_status = 'confirmed' AND COALESCE(i.ended_at, now()) >= $3::timestamptz)
           AND NOT EXISTS (SELECT 1 FROM work_sessions w WHERE w.task_id = t.id AND w.state = 'running')
         ORDER BY t.due_at, t.id LIMIT 50`, [ctx.org.id, ctx.membership.id, dayStart, dayEnd])))
      : Promise.resolve(undefined),
  ]);

  const blockedOnYou: Keyed[] | null = blocked === null ? null : blocked.filter((t) => namesPerson(t.blocked_reason, ctx.user.displayName)).map((t) => ({
    key: `blocked:${t.id}:${t.changed_at ? new Date(t.changed_at).toISOString() : "none"}`,
    item: { text: `${q(t.title)} (${t.assignee_name}) is blocked on you`, detail: theirWords(t.blocked_reason), sources: task(t.id) },
  }));
  const requests: Keyed[] | null | undefined = waiting === null ? null : !waiting.ready ? undefined : waiting.items
    .filter((v) => v.kind === "request" && v.viewer === "recipient")
    .map((v) => ({ key: `request:${v.id}`, item: { text: `${v.sender.firstName} asks you to accept: ${v.request?.summary ?? "a change"}`, sources: [{ kind: "assistant_item", id: v.id }] } }));
  const askKeyed: Keyed[] | null = asks === null ? null : asks.map((v) => ({
    key: `ask:${v.id}`,
    item: {
      text: v.requester ? `${v.requester.firstName}'s ${v.requester.assistant.name} is waiting for your reply` : `${v.workspaceAssistant?.name ?? "Brenda"} is waiting for your reply for today's team report`,
      detail: theirWords(v.question) ? `“${theirWords(v.question)}”` : null, sources: [{ kind: "follow_up", id: v.id }, ...task(v.task?.id)],
    },
  }));
  const reviews: Keyed[] | null = queue === null ? null : [
    ...queue.submissions.filter((s) => s.reviewer_is_me || role === "manager").map((s) => ({
      key: `review:${s.submission_id}`, item: { text: `Review ${q(s.title)} from ${s.assignee_name}`, detail: `sent ${when(s.submitted_at)}`, sources: task(s.task_id) },
    })),
    ...(role === "manager" ? queue.adjustments.map((a) => ({ key: `correction:${a.id}`, item: { text: `Time correction from ${a.display_name} on ${q(a.task_title)}`, sources: [{ kind: "time_correction", id: a.id }] as EvidenceRef[] } })) : []),
  ];
  const dueKeyed: Keyed[] | null | undefined = due === undefined ? undefined : due === null ? null : due.map((t) => ({
    key: `due:${t.id}:${today}`, item: { text: q(t.title), detail: `due ${when(t.due_at)}`, sources: task(t.id) },
  }));

  const onYou: Keyed[] | null = blockedOnYou === null || askKeyed === null || requests === null ? null : [...blockedOnYou, ...(requests ?? []), ...askKeyed];
  const all = [...(onYou ?? []), ...(reviews ?? []), ...(dueKeyed ?? [])];
  const reported = await alreadyReported(r.id, all.map((k) => k.key));
  const fresh = (xs: Keyed[] | null | undefined) => (xs === undefined ? undefined : xs === null ? null : xs.filter((x) => !reported.has(x.key)));
  const drafts = [
    { id: "blocked_on_you", label: "Blocked on you", keyed: fresh(onYou) },
    { id: "ready_for_you", label: "Ready for you", keyed: fresh(reviews) },
    { id: "due_no_progress", label: "Due today, no progress yet", keyed: fresh(dueKeyed) },
  ];
  const b = build({
    title: "Afternoon check", calm: "Nothing needs you this afternoon.", now,
    lead: (n) => (n === 1 ? "1 thing needs you." : `${n} things need you.`),
    drafts: drafts.map((d) => ({ id: d.id, label: d.label, items: d.keyed === undefined ? undefined : d.keyed === null ? null : d.keyed.map((x) => x.item) })),
  });
  // Each thing once: only what this run reports is recorded (and only when it runs for real).
  const keys = o.mode === "run" ? drafts.flatMap((d) => (d.keyed ?? []).slice(0, ROUTINE_LIMITS.sectionItems).map((x) => x.key)) : [];
  return { ...b, actions: [], reportedKeys: keys };
}

// ---- Chase stalled tasks on my team (C.4) ----------------------------------------------------------------------------------

type StalledRow = { id: string; title: string; assignee_membership_id: string; assignee_name: string; assistant_name: string | null; created_at: string; last_signal_at: string | null; total: number };

/** The stalls a chase has already asked about (its `chase:{taskId}:{ISO}` keys), as task ids and times, for its query. */
async function chasedStalls(routineId: string): Promise<{ taskIds: string[]; ats: string[] }> {
  if (!isUuid(routineId) || routineId === NIL) return { taskIds: [], ats: [] };
  const { reportedKeysLike } = await import("@/server/services/routines");
  const taskIds: string[] = [];
  const ats: string[] = [];
  for (const k of await reportedKeysLike(routineId, "chase:")) {
    const m = /^chase:([0-9a-f-]{36}):(.+)$/i.exec(k);
    if (!m || !isUuid(m[1]) || Number.isNaN(Date.parse(m[2]))) continue;
    taskIds.push(m[1]); ats.push(m[2]);
  }
  return { taskIds, ats };
}

/** The live teams a chase covers: the ones named, or the ones the person leads. */
export async function chaseTeams(ctx: OrgContext, teamIds: string[] | null | undefined): Promise<{ id: string; name: string }[]> {
  const ids = Array.isArray(teamIds) ? teamIds.filter(isUuid) : null;
  return withUser(ctx.user.profileId, (db) => db.query<{ id: string; name: string }>(
    `SELECT t.id, t.name FROM teams t
     WHERE t.organisation_id = $1 AND t.archived_at IS NULL
       AND CASE WHEN $2::uuid[] IS NULL
                THEN EXISTS (SELECT 1 FROM team_members tm WHERE tm.team_id = t.id AND tm.membership_id = $3 AND tm.is_manager)
                ELSE t.id = ANY($2::uuid[]) END
     ORDER BY t.name`, [ctx.org.id, ids, ctx.membership.id]));
}

/** The people on each team (active members, the person left out), by display name, for the consent lines. */
export async function teamPeople(ctx: OrgContext, teamIds: string[]): Promise<Map<string, string[]>> {
  const ids = teamIds.filter(isUuid);
  if (!ids.length) return new Map();
  const rows = await withUser(ctx.user.profileId, (db) => db.query<{ team_id: string; name: string }>(
    `SELECT tm.team_id, p.display_name AS name FROM team_members tm JOIN memberships m ON m.id = tm.membership_id AND m.status = 'active' JOIN profiles p ON p.id = m.user_id
     WHERE tm.team_id = ANY($1::uuid[]) AND tm.membership_id <> $2 ORDER BY p.display_name`, [ids, ctx.membership.id]));
  const out = new Map<string, string[]>();
  for (const r of rows) out.set(r.team_id, [...(out.get(r.team_id) ?? []), r.name]);
  return out;
}

async function chaseStalled(ctx: OrgContext, r: RoutineRow, o: Opts, now: Date): Promise<TemplateResult> {
  const preview = o.mode !== "run";
  const when = whenOf(zoneFor(ctx, o), now);
  // A run asks about nobody outside what its Enable showed (review, 8 October 2026): the teams and people kept with the
  // consent. The claim pauses a routine whose cover grew; this is the floor if anything changed since the claim.
  const cover = !preview ? r.consent?.cover ?? null : null;
  const teams = (await chaseTeams(ctx, r.params?.teamIds ?? null)).filter((t) => !cover || cover.teams.includes(t.id));
  const where = teams.length === 1 ? teams[0].name : "your teams";
  const title = `Stalled tasks on ${where}`;
  const calm = `Nothing has stalled on ${where}.`;
  // The stalls this routine already asked about (phase 7b: a task among them stalled again is "stalled a second time").
  let chasedBefore = new Set<string>();
  const stalled = !teams.length ? [] as StalledRow[] : await attempt("stalled tasks", async () => {
    // Stalls already asked about are left out before the limit, not after it (review, 8 October 2026: with 100 older
    // ones chased, newer stalls were never reached). A key holds the signal time to the millisecond.
    const [clock, chased] = await Promise.all([withUser(ctx.user.profileId, (db) => orgClock(db, ctx.org.id, now)), chasedStalls(r.id)]);
    chasedBefore = new Set(chased.taskIds.map((id) => id.toLowerCase()));
    const since = stalledSince(now, clock.schedule).toISOString();
    return withUser(ctx.user.profileId, (db) => db.query<StalledRow>(
      `WITH people AS (
         SELECT DISTINCT tm.membership_id FROM team_members tm JOIN teams tt ON tt.id = tm.team_id
         WHERE tt.organisation_id = $1 AND tt.archived_at IS NULL AND tm.team_id = ANY($2::uuid[]) AND tm.membership_id <> $3),
       signals AS (
         SELECT t.id, t.title, t.assignee_membership_id, p.display_name AS assignee_name, ap.name AS assistant_name, t.created_at,
                GREATEST(
                  (SELECT max(h.occurred_at) FROM task_status_history h WHERE h.task_id = t.id),
                  (SELECT max(c.created_at) FROM task_comments c WHERE c.task_id = t.id),
                  (SELECT max(s.submitted_at) FROM task_submissions s WHERE s.task_id = t.id),
                  (SELECT max(COALESCE(i.ended_at, now())) FROM session_intervals i WHERE i.task_id = t.id AND i.confirmation_status = 'confirmed')
                ) AS last_signal_at
         FROM tasks t JOIN memberships m ON m.id = t.assignee_membership_id AND m.status = 'active' JOIN profiles p ON p.id = m.user_id
         LEFT JOIN assistant_profiles ap ON ap.membership_id = t.assignee_membership_id
         WHERE t.organisation_id = $1 AND t.archived_at IS NULL AND t.status IN ('todo', 'in_progress')
           AND t.assignee_membership_id IN (SELECT membership_id FROM people)
           AND ($5::uuid[] IS NULL OR t.assignee_membership_id = ANY($5::uuid[]))
           AND t.created_by <> t.assignee_membership_id
           AND t.created_at < $4::timestamptz
           AND NOT EXISTS (SELECT 1 FROM work_sessions w WHERE w.task_id = t.id AND w.state IN ('running', 'paused', 'interrupted'))),
       open AS (
         SELECT s.* FROM signals s
         WHERE (s.last_signal_at IS NULL OR s.last_signal_at <= $4::timestamptz)
           AND NOT EXISTS (SELECT 1 FROM unnest($6::uuid[], $7::timestamptz[]) AS c(task_id, at)
                           WHERE c.task_id = s.id AND abs(extract(epoch FROM COALESCE(s.last_signal_at, s.created_at) - c.at)) < 0.001))
       SELECT open.*, (count(*) OVER ())::int AS total FROM open
       ORDER BY COALESCE(last_signal_at, created_at), id LIMIT 100`,
      [ctx.org.id, teams.map((t) => t.id), ctx.membership.id, since, cover ? cover.people : null, chased.taskIds, chased.ats]));
  });

  const keyOf = (t: StalledRow) => `chase:${t.id}:${new Date(t.last_signal_at ?? t.created_at).toISOString()}`;
  // One stall is chased once, whatever the cadence; a task that moved and stalled again has a new key.
  const reported = stalled ? await alreadyReported(r.id, stalled.map(keyOf)) : new Set<string>();
  const open = (stalled ?? []).filter((t) => !reported.has(keyOf(t)));
  const take = open.slice(0, ROUTINE_LIMITS.chasePerRun);
  const leftOut = open.slice(ROUTINE_LIMITS.chasePerRun);
  const theirAssistant = (t: StalledRow) => `${firstName(t.assignee_name)}'s ${toProfile({ name: t.assistant_name }).name}`;
  // Owner decisions, 8 October 2026 (phase 7b): a task this routine already chased for an earlier stall is stalled a
  // second time (the query leaves out the stall already asked about, so any earlier key of the task is another stall).
  const again = (t: StalledRow) => chasedBefore.has(t.id.toLowerCase());
  const REPLAN_DETAIL = "stalled before; the answer will suggest a new due date";
  const since = (t: StalledRow) => `no progress since ${when(t.last_signal_at ?? t.created_at)}${again(t) ? `; ${REPLAN_DETAIL}` : ""}`;

  const actions: RoutineActionRecord[] = [];
  const keys: string[] = [];
  if (preview) {
    for (const t of take) actions.push({ kind: "follow_up", text: `Would ask ${theirAssistant(t)} about ${q(t.title)}`, done: false, reason: null, followUpId: null, taskId: t.id, subjectMembershipId: t.assignee_membership_id, ...(again(t) ? { replan: true } : {}) });
  } else {
    for (const t of take) {
      const record = (done: boolean, reason: string | null, followUpId: string | null, reused = false) => {
        // A refusal's words go in `reason`; the output says "Not asked: {text}: {reason}" (lib/routines).
        actions.push({ kind: "follow_up", text: done ? `Asked ${theirAssistant(t)} about ${q(t.title)}` : `${q(t.title)} (${firstName(t.assignee_name)})`, done, reason, followUpId, taskId: t.id, subjectMembershipId: t.assignee_membership_id, ...(reused ? { reused: true } : {}), ...(again(t) ? { replan: true } : {}) });
        if (done) keys.push(keyOf(t));
      };
      try {
        const res = await createFollowUps(ctx, { subjectMembershipIds: [t.assignee_membership_id], teamId: null, taskId: t.id, question: "" });
        const made = res.created[0]?.id ?? null;
        const reused = made ? null : res.reused[0]?.id ?? null;
        if (made) record(true, null, made);
        else if (reused) record(true, null, reused, true);
        else record(false, res.skipped[0]?.reason ?? "Nobody was asked.", null);
      } catch (err) {
        // Every refusal (the follow-up permission, the daily caps, the subject's own rules) is said and the run goes on.
        if (err instanceof AppError && (err.status < 500 || err.status === 503)) record(false, err.message, null);
        else { warn(`chasing ${t.id}`)(err); record(false, "Something went wrong. It will try again next time.", null); }
      }
    }
  }

  const byTask = new Map(actions.map((a) => [a.taskId, a]));
  const asked = take.filter((t) => byTask.get(t.id)?.done);
  const notAsked = take.filter((t) => !preview && !byTask.get(t.id)?.done);
  const drafts: Draft[] = stalled === null
    ? [{ id: "stalled", label: preview ? "Stalled" : "Asked", items: null }]
    : preview
      ? [
        { id: "stalled", label: "Stalled", items: take.map((t) => ({ text: `${q(t.title)} (${t.assignee_name})`, detail: since(t), sources: task(t.id) })) },
        { id: "left_out", label: `Over this run's limit of ${ROUTINE_LIMITS.chasePerRun}`, items: leftOut.map((t) => ({ text: `${q(t.title)} (${t.assignee_name})`, sources: task(t.id) })) },
      ]
      : [
        { id: "asked", label: "Asked", items: asked.map((t) => ({ text: `${theirAssistant(t)}, about ${q(t.title)}`, ...(again(t) ? { detail: REPLAN_DETAIL } : {}), sources: [...task(t.id), ...(byTask.get(t.id)?.followUpId ? [{ kind: "follow_up" as const, id: byTask.get(t.id)!.followUpId }] : [])] })) },
        { id: "not_asked", label: "Not asked", items: notAsked.map((t) => ({ text: `${q(t.title)} (${firstName(t.assignee_name)}): ${byTask.get(t.id)?.reason ?? "not asked"}`, sources: task(t.id) })) },
        { id: "left_out", label: `Over this run's limit of ${ROUTINE_LIMITS.chasePerRun}`, items: leftOut.map((t) => ({ text: `${q(t.title)} (${t.assignee_name})`, sources: task(t.id) })) },
      ];
  // Every stall not yet asked about, not only the 100 read (the window count, before the limit).
  const stalledCount = Math.max(open.length, stalled?.[0]?.total ?? 0);
  const b = build({
    title, calm, now, actions, drafts,
    lead: () => preview
      ? `${plural(stalledCount, "task has", "tasks have")} stalled. It would ask about ${take.length === stalledCount ? (stalledCount === 1 ? "it" : "all of them") : `${take.length} of them`}.`
      : asked.length ? `Asked about ${plural(asked.length, "stalled task")}.` : `${plural(stalledCount, "task has", "tasks have")} stalled; none could be asked about.`,
    forceEmpty: stalled !== null && stalledCount === 0 ? true : undefined,
  });
  return {
    ...b, actions, reportedKeys: preview ? [] : keys,
    counts: { ...b.counts, stalled: stalled === null ? null : stalledCount, asked: preview ? 0 : asked.length, not_asked: preview ? 0 : notAsked.length },
  };
}

// ---- Loose ends (owner decisions, 8 October 2026: phase 7b) --------------------------------------------------------------

const LOOSE_SECTIONS: { kind: LooseEndKind; id: string; label: string }[] = [
  { kind: "promise", id: "promise", label: "Promises you made" },
  { kind: "asked_of_me", id: "asked_of_me", label: "Asked of you" },
  { kind: "i_asked", id: "i_asked", label: "You asked others" },
];

/**
 * The person's loose ends (contract D.2). A run looks through the days since its previous run (at least 1, at most 14;
 * 3 the first time) with loose-end-detect's scan, as the person, at most one model call (one of their daily requests),
 * and reports what it found that no earlier run reported (`loose:{id}`), by kind. A preview lists the loose ends open now:
 * no scan, no model, nothing written.
 */
async function looseEnds(ctx: OrgContext, r: RoutineRow, o: Opts, now: Date): Promise<TemplateResult> {
  const preview = o.mode !== "run";
  const title = TEMPLATE_WORDS.loose_ends.name;
  let views: LooseEndView[] | null | undefined;
  let usedModel = false;
  if (preview) {
    const list = await attempt("open loose ends", async () => (await import("@/server/services/loose-ends")).listLooseEnds(ctx, { status: "open", limit: 50 }));
    views = list === null ? null : !list.ready ? undefined : list.items;
  } else {
    const since = o.since ? Date.parse(o.since) : NaN;
    const days = Number.isFinite(since) ? Math.max(1, Math.min(14, Math.ceil((now.getTime() - since) / 86_400_000))) : 3;
    const { scanLooseEnds } = await import("@/server/services/loose-end-detect");
    const scan = await attempt("loose ends", () => scanLooseEnds(ctx, { days, source: "routine", useModel: true, maxModelCalls: 1, now }));
    views = scan === null ? null : !scan.ready ? undefined : scan.found;
    usedModel = !!scan && scan.engine === "claude";
  }
  const keyOf = (v: LooseEndView) => `loose:${v.id}`;
  const reported = !preview && views ? await alreadyReported(r.id, views.map(keyOf)) : new Set<string>();
  const fresh = views ? views.filter((v) => v.status === "open" && !reported.has(keyOf(v))) : views;
  const drafts: Draft[] = LOOSE_SECTIONS.map((s) => ({ id: s.id, label: s.label, items: fresh === undefined ? undefined : fresh === null ? null : fresh.filter((v) => v.kind === s.kind).map(looseEndItem) }));
  const b = build({
    title, now, drafts,
    calm: preview ? "No loose ends are open." : "No new loose ends.",
    lead: (n) => (preview ? (n === 1 ? "1 loose end is open." : `${n} loose ends are open.`) : (n === 1 ? "Found 1 loose end." : `Found ${n} loose ends.`)),
  });
  // Each loose end once: only what this run reports is recorded (and only when it runs for real).
  const keys = preview || !fresh ? [] : LOOSE_SECTIONS.flatMap((s) => fresh.filter((v) => v.kind === s.kind).slice(0, ROUTINE_LIMITS.sectionItems).map(keyOf));
  return { ...b, actions: [], reportedKeys: keys, usedModel };
}
