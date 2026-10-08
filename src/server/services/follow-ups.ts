/**
 * Follow-ups between assistants (owner decision, 8 October 2026: personal assistants, phase 4). "Instead of following
 * up with the people, the assistants follow up with each other's assistants to know what the staff are working on."
 *
 * A fixed protocol, not two models talking (review, 8 October 2026: decision 1). A follow-up is a row with a status
 * machine; the subject's "assistant" is this code. It gathers the facts the person who asked may already see
 * (follow-up-facts, under their own row-level security), decides whether those facts answer the question (recent work,
 * and the subject's choice "answer from my work" or "always ask me first"), asks the subject once only when they do not,
 * and writes the answer: with at most one model call with no tools (brain's follow-up-compose), or its template.
 *
 * pending ──T1──▶ answering ──T5──▶ answered   (answered_from facts | person)
 *    │                 ▲      └─T5──▶ expired    (answered_from deadline)
 *    │                 │      └─T5──▶ declined   (reply_choice not_now)
 *    ├──T2──▶ asking ──┤T3 reply (definer) / T4 deadline (worker)
 *    │          │
 *    ├──T6──▶ cancelled ◀─T6─┘ (requester, definer)
 *    └──T7──▶ failed  (also from asking / answering)
 *
 * Every transition is one guarded statement; a statement that returns no row means someone else moved it first, and the
 * caller stops quietly, so `processFollowUp` is safe to call any number of times, from anywhere. Transitions go through
 * the worker role (keyed by id, guarded by the expected status), except the subject's reply and the requester's cancel,
 * which are definer functions run as that person (migration 0039). Who may ask about whom is checked three times: when
 * the assistant prepares the Confirm (plan), by the insert's row-level security, and again as the requester before
 * anything is shared (processing and every answer).
 *
 * Processing feels immediate (decision 6): the Confirm inserts durable 'pending' rows and returns; the fast path runs in
 * the same web process through Next's `after()`. The worker owns deadlines, the workspace's collection before the report
 * and retries of anything stuck; reads also settle overdue rows on the spot, so expiry works before the worker restarts.
 *
 * Nothing is shared about a person's own to-dos, day plan, documents, messages or chats with their assistant. Audit rows
 * never hold the question, a note or an answer: owners and HR see that a follow-up happened, not what was said.
 *
 * Asked in a thread (owner decision, 8 October 2026: personal assistants, phase 6; migration 0043): "@Ben's Brenda,
 * where is the deck?" makes a follow-up in thread mode (thread_mode 'facts': answer from Ben's work when it can; 'ask':
 * always ask Ben, the question is not about the state of his work), linked from its mention. It is never reused by an
 * ordinary follow-up, nor reuses one; Ben's ask says his reply is posted in the thread; the asker gets no answer
 * notification (the thread reply notifies them); and after every transition the thread is brought up to date
 * (mention-processor's syncThreadFollowUp, loaded when needed, never throwing). Before 0043 none of it exists.
 */
import { after } from "next/server";
import { z } from "zod";
import { withUser, withWorker, type Db } from "@/server/db";
import type { OrgContext } from "@/server/lib/api";
import { AppError, conflict, forbidden, invalid, notFound } from "@/server/lib/errors";
import { resolveEntitlements } from "@/server/lib/entitlements";
import { forget0039, isMissingSchema, retryWithout0039, schema0039Ready } from "@/server/lib/schema-0039";
import { schema0043Ready } from "@/server/lib/schema-0043";
import { memberContext } from "@/server/lib/member-context";
import { addWorkingTime } from "@/server/lib/working-time";
import { localMidnight, localTimeOn, todayLocal } from "@/server/lib/time";
import { audit, notify } from "@/server/services/common";
import { logAction } from "@/server/services/brenda";
import { matchPerson, resolveAssistant } from "@/server/services/assistant";
import { aiAllowance } from "@/server/services/ai-usage";
import { readWorkspaceAssistant } from "@/server/services/assistant-profile";
import { gatherFacts, orgClock, type FactsScope } from "@/server/services/follow-up-facts";
import { composeFollowUpAnswer, composeTemplate, type ComposeInput, type ComposeModel } from "@/server/services/follow-up-compose";
import { followUpIntent } from "@/server/services/follow-up-intent";
import type { DesktopAssistant } from "@/server/services/desktop";
import { PALETTE, toProfile, type AssistantProfile } from "@/lib/assistant-look";
import {
  FOLLOW_UP_LIMITS, FOLLOW_UPS_NOT_READY, FOLLOW_UPS_NOT_READY_SHORT, NO_TASK_LIKE, OPEN_STATUSES, REPLY_CHOICES, SHARED_STATUSES, SKIP_REASONS,
  batchSummary, clip, deadlineLabel, factLines, factsOrNull, failureWords, firstName, isRefusalCode, refusalWords,
  type FollowUpBatchView, type FollowUpFacts, type FollowUpFailure, type FollowUpPreference, type FollowUpStatus, type FollowUpView,
  type PersonRef, type RefusalCode, type ReplyChoice,
} from "@/lib/follow-ups";

// ---- Small helpers ----------------------------------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const OPEN_SQL = `('pending', 'asking', 'answering')`;
/** A claimed row's lease: another process leaves it alone this long. */
const LEASE_SQL = `interval '2 minutes'`;
/** Claims past this many fail the row (`error`). */
const MAX_ATTEMPTS = 5;
const T_MAX = 80;
const notReady = () => new AppError(503, "NOT_READY", FOLLOW_UPS_NOT_READY_SHORT);
const isoOrNull = (v: string | Date | null | undefined) => (v ? new Date(v).toISOString() : null);
const tq = (title: string) => `“${clip(title, T_MAX)}”`;
const warn = (what: string) => (err: unknown) => console.warn(`[follow-ups] ${what}: ${(err as Error)?.message ?? String(err)}`);
const base = (slug: string) => `/app/${slug}`;
const followUpHref = (slug: string, id: string) => `${base(slug)}/home/follow-ups/${id}`;
const batchHref = (slug: string, id: string) => `${base(slug)}/home/follow-ups?batch=${id}`;
const askHref = (slug: string, id: string) => `${base(slug)}/home/follow-ups/about-you?f=${id}`;
const taskHref = (slug: string, id: string) => `${base(slug)}/tasks/${id}`;

/** Runs `fn` over `items`, `n` at a time. */
async function inPool<T>(items: T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

type Look = { name: string | null; colour: string | null; visor: string | null; eyes: string | null };
const look = (r: Record<string, unknown>, p: string): Look => ({ name: r[`${p}_name`] as string | null, colour: r[`${p}_colour`] as string | null, visor: r[`${p}_visor`] as string | null, eyes: r[`${p}_eyes`] as string | null });

// ---- Plans: who, which task, which question (no writes but refusal audits) --------------------------------------------

export type FollowUpPlanInput = { people?: string[]; team?: string | null; taskId?: string | null; task?: string | null; question?: string | null };
export type FollowUpPlan =
  | { ok: true; kind: "person" | "group"; subjects: { membershipId: string; name: string; firstName: string }[];
      team: { id: string; name: string } | null; task: { id: string; title: string } | null; question: string;
      skipped: { name: string; reason: string }[] }
  | { ok: false; error: string };

type Member = { id: string; name: string };
/** Words that mean "no particular task": "this week's tasks", "their tasks", "today's work", "it", "everything". */
const NO_TASK = /^(?:(?:this|the|last)\s+week['’]?s?\s+(?:tasks?|work)|(?:their|his|her|your|my)\s+(?:tasks?|work)|today['’]?s\s+(?:tasks?|work)|it|everything|anything|things?|stuff|work)$/i;

/**
 * The default question: their own words when they gave any, unless those words are the instruction to their own
 * assistant ("Follow up with Ben on the pricing page"), which the person asked never reads as their question (visual
 * review, 8 October 2026; the model is told the same, this holds when it does not listen).
 */
function questionOf(raw: string | null | undefined, task: { title: string } | null): string {
  const q = String(raw ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (q && followUpIntent(q)?.kind !== "ask") return clip(q, FOLLOW_UP_LIMITS.questionMax);
  return task ? clip(`Where are you on “${task.title}”?`, FOLLOW_UP_LIMITS.questionMax) : "What are you working on?";
}

/** The organisation's local midnight today, for the daily counts. */
const todayStart = (ctx: OrgContext, now = new Date()) => localMidnight(todayLocal(ctx.org.timezone, now), ctx.org.timezone);

type Checked = {
  allowed: string[];
  refused: { id: string; code: RefusalCode }[];
  reused: { id: string; subjectId: string; batchId: string }[];
  pairSkipped: string[];
  todayCount: number;
};

/**
 * Every permission and limit for these subjects (and task), as the requester. Audits each refusal (no question text).
 * `reuse` false (a follow-up asked in a thread, phase 6): an open follow-up is never reused; and an ordinary one never
 * reuses a thread's (thread_mode, once 0043 is applied).
 */
async function checkSubjects(db: Db, ctx: OrgContext, subjectIds: string[], taskId: string | null, opts: { reuse?: boolean } = {}): Promise<Checked> {
  const refusals = await db.query<{ id: string; reason: string | null }>(
    `SELECT s.id, app_follow_up_refusal($1, s.id, $2::uuid) AS reason FROM unnest($3::uuid[]) WITH ORDINALITY AS s(id, n) ORDER BY s.n`,
    [ctx.org.id, taskId, subjectIds]);
  const refused = refusals.filter((r) => r.reason).map((r) => ({ id: r.id, code: (isRefusalCode(r.reason) ? r.reason : "not_allowed") as RefusalCode }));
  for (const r of refused) {
    await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "followup.refused", subjectType: "membership", subjectId: r.id, subjectMembershipId: r.id, metadata: { reason: r.code, taskId } });
  }
  const ok = refusals.filter((r) => !r.reason).map((r) => r.id);
  const since = todayStart(ctx).toISOString();
  const ordinaryOnly = (await schema0043Ready(db)) ? "AND thread_mode IS NULL" : "";
  const [open, pairs, today] = [
    opts.reuse === false ? [] : await db.query<{ id: string; subject_membership_id: string; batch_id: string }>(
      `SELECT DISTINCT ON (subject_membership_id) id, subject_membership_id, batch_id FROM follow_ups
       WHERE organisation_id = $1 AND requester_membership_id = $2 AND status IN ${OPEN_SQL} AND task_id IS NOT DISTINCT FROM $3::uuid AND subject_membership_id = ANY($4::uuid[]) ${ordinaryOnly}
       ORDER BY subject_membership_id, created_at DESC`, [ctx.org.id, ctx.membership.id, taskId, ok]),
    await db.query<{ subject_membership_id: string; n: number }>(
      `SELECT subject_membership_id, count(*)::int AS n FROM follow_ups
       WHERE organisation_id = $1 AND requester_membership_id = $2 AND task_id IS NOT DISTINCT FROM $3::uuid AND subject_membership_id = ANY($4::uuid[]) AND created_at >= $5::timestamptz
       GROUP BY subject_membership_id`, [ctx.org.id, ctx.membership.id, taskId, ok, since]),
    await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM follow_ups WHERE organisation_id = $1 AND requester_membership_id = $2 AND created_at >= $3::timestamptz`, [ctx.org.id, ctx.membership.id, since]),
  ];
  const reused = open.map((r) => ({ id: r.id, subjectId: r.subject_membership_id, batchId: r.batch_id }));
  const reusedIds = new Set(reused.map((r) => r.subjectId));
  const pairSkipped = ok.filter((id) => !reusedIds.has(id) && (pairs.find((p) => p.subject_membership_id === id)?.n ?? 0) >= FOLLOW_UP_LIMITS.perPairTaskPerDay);
  const allowed = ok.filter((id) => !reusedIds.has(id) && !pairSkipped.includes(id));
  return { allowed, refused, reused, pairSkipped, todayCount: today.n };
}

const limitWords = (n: number, left: number) => `That's ${n} follow-up${n === 1 ? "" : "s"}; you have ${left} left today.`;
const TOO_MANY = `Ask at most ${FOLLOW_UP_LIMITS.batchMax} people at a time.`;

/**
 * Resolves names ("my team", a team name, people by name), a task (an id, or words matched against the subjects'
 * visible shared work: one hit, else an error listing up to 5 titles), checks every permission and limit and fills in
 * the default question. Writes nothing but refusal audits. Before 0039: `{ ok: false, error: FOLLOW_UPS_NOT_READY }`.
 */
export async function planFollowUps(ctx: OrgContext, input: FollowUpPlanInput): Promise<FollowUpPlan> {
  return retryWithout0039(() => withUser(ctx.user.profileId, async (db): Promise<FollowUpPlan> => {
    if (!(await schema0039Ready(db))) return { ok: false, error: FOLLOW_UPS_NOT_READY };
    const members = await db.query<Member>(
      `SELECT m.id, p.display_name AS name FROM memberships m JOIN profiles p ON p.id = m.user_id
       WHERE m.organisation_id = $1 AND m.status = 'active' ORDER BY p.display_name`, [ctx.org.id]);
    const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? "Someone";
    const chosen: string[] = [];
    const add = (id: string) => { if (!chosen.includes(id)) chosen.push(id); };
    let team: { id: string; name: string } | null = null;

    // A team: "my team" (the teams the person leads) or a team by name. The asker is never one of their own subjects.
    const teamWords = String(input.team ?? "").trim();
    if (teamWords) {
      const mine = /^(?:my|our)\s+teams?$/i.test(teamWords) || /^(?:my|our)\s+(?:people|staff|reports)$/i.test(teamWords);
      const teams = mine
        ? await db.query<{ id: string; name: string }>(
            `SELECT t.id, t.name FROM teams t JOIN team_members tm ON tm.team_id = t.id
             WHERE t.organisation_id = $1 AND t.archived_at IS NULL AND tm.membership_id = $2 AND tm.is_manager ORDER BY t.name`, [ctx.org.id, ctx.membership.id])
        : await db.query<{ id: string; name: string }>(`SELECT id, name FROM teams WHERE organisation_id = $1 AND archived_at IS NULL ORDER BY name`, [ctx.org.id]);
      let picked = teams;
      if (!mine) {
        const want = teamWords.replace(/^the\s+/i, "").replace(/\s+team$/i, "").trim().toLowerCase();
        picked = teams.filter((t) => t.name.toLowerCase() === want || t.name.toLowerCase().replace(/\s+team$/i, "") === want);
        if (!picked.length) return { ok: false, error: `There's no team called “${clip(teamWords, 60)}”. Teams: ${teams.map((t) => t.name).join(", ") || "none yet"}.` };
      }
      if (!picked.length) {
        // Owners and HR may ask any team by name (visual review, 8 October 2026).
        const any = ctx.membership.role === "owner" || ctx.membership.role === "hr";
        const example = any ? (await db.maybeOne<{ name: string }>(`SELECT name FROM teams WHERE organisation_id = $1 AND archived_at IS NULL ORDER BY name LIMIT 1`, [ctx.org.id]))?.name ?? null : null;
        return { ok: false, error: any
          ? `You don't lead a team, so there's no team to ask. Name the people, or a team${example ? `, such as ${clip(example, 60)}` : ""}.`
          : "You don't lead a team, so there's no team to ask. Name the people instead." };
      }
      if (picked.length === 1) team = picked[0];
      const ids = await db.query<{ membership_id: string }>(
        `SELECT DISTINCT tm.membership_id FROM team_members tm JOIN memberships m ON m.id = tm.membership_id
         WHERE tm.team_id = ANY($1::uuid[]) AND m.status = 'active' AND tm.membership_id <> $2`, [picked.map((t) => t.id), ctx.membership.id]);
      for (const r of ids) add(r.membership_id);
      if (!ids.length) return { ok: false, error: `Nobody else is in ${team ? team.name : "your teams"} yet.` };
    }

    // People by name (exact names from list_people, or a first name that fits one person) or by membership id.
    for (const raw of input.people ?? []) {
      const name = String(raw ?? "").trim().replace(/^@/, "");
      if (!name) continue;
      const hit = isUuid(name) ? members.find((m) => m.id.toLowerCase() === name.toLowerCase()) : (() => {
        const p = matchPerson(name, members.map((m) => ({ id: m.id, display_name: m.name })));
        return p ? { id: p.id, name: p.display_name } : null;
      })();
      if (!hit) {
        const lower = name.toLowerCase();
        const several = members.filter((m) => m.name.toLowerCase().split(/\s+/)[0] === lower.split(/\s+/)[0] || m.name.toLowerCase().includes(lower));
        if (several.length > 1) return { ok: false, error: `More than one person fits “${clip(name, 60)}”: ${several.slice(0, 5).map((m) => m.name).join(", ")}. Use the full name.` };
        return { ok: false, error: `I can't find anyone called “${clip(name, 60)}” in this workspace.` };
      }
      add(hit.id);
    }
    if (!chosen.length) return { ok: false, error: "Say who to follow up with: one or more people, or a team." };
    if (chosen.length > FOLLOW_UP_LIMITS.batchMax) return { ok: false, error: TOO_MANY };
    const group = !!teamWords || chosen.length > 1;

    // The task: an id, or words matched against the subjects' shared work that the asker can see.
    let task: { id: string; title: string } | null = null;
    if (input.taskId) {
      if (!isUuid(input.taskId)) return { ok: false, error: refusalWords("task_not_found", "", "") };
      task = await db.maybeOne<{ id: string; title: string }>(`SELECT id, title FROM tasks WHERE id = $1 AND organisation_id = $2 AND archived_at IS NULL`, [input.taskId, ctx.org.id]);
      if (!task) {
        await checkSubjects(db, ctx, chosen, input.taskId); // audits the refusal for each person named
        return { ok: false, error: refusalWords("task_not_found", "", "") };
      }
    } else {
      const words = String(input.task ?? "").trim().replace(/^["“'‘]+|["”'’]+$/g, "").replace(/^the\s+/i, "").replace(/\s+(?:task|card|job)$/i, "").trim();
      if (words && !NO_TASK.test(words)) {
        const hits = await db.query<{ id: string; title: string }>(
          `SELECT t.id, t.title FROM tasks t
           WHERE t.organisation_id = $1 AND t.archived_at IS NULL AND t.created_by <> t.assignee_membership_id
             AND (t.assignee_membership_id = ANY($2::uuid[]) OR t.reviewer_membership_id = ANY($2::uuid[]))
             AND (t.title ILIKE '%' || $3 || '%' OR (cardinality($4::text[]) > 0 AND NOT EXISTS (SELECT 1 FROM unnest($4::text[]) w WHERE t.title NOT ILIKE '%' || w || '%')))
           ORDER BY (lower(t.title) = lower($3)) DESC, (t.status <> 'completed') DESC, t.updated_at DESC LIMIT 6`,
          [ctx.org.id, chosen, words.replace(/[\\%_]/g, "\\$&"), words.toLowerCase().split(/\s+/).filter((w) => w.length > 2).map((w) => w.replace(/[\\%_]/g, "\\$&"))]);
        const exact = hits.filter((h) => h.title.toLowerCase() === words.toLowerCase());
        if (exact.length === 1 || hits.length === 1) task = exact[0] ?? hits[0];
        else if (!hits.length) {
          const who = chosen.length === 1 ? firstName(nameOf(chosen[0])) : "they";
          return { ok: false, error: `${NO_TASK_LIKE} “${clip(words, 60)}” that ${who} ${chosen.length === 1 ? "holds or checks" : "hold or check"}. Name it as it's written, or ask what ${who === "they" ? "they're" : `${who}'s`} working on.` };
        } else {
          return { ok: false, error: `“${clip(words, 60)}” fits more than one task: ${hits.slice(0, 5).map((h) => `“${clip(h.title, 60)}”`).join(", ")}. Which one?` };
        }
      }
    }

    const c = await checkSubjects(db, ctx, chosen, task?.id ?? null);
    const skipped = [
      ...c.refused.map((r) => ({ name: nameOf(r.id), reason: SKIP_REASONS[r.code] })),
      ...c.pairSkipped.map((id) => ({ name: nameOf(id), reason: SKIP_REASONS.pair_cap })),
    ];
    const asked = [...c.allowed, ...c.reused.map((r) => r.subjectId)];
    if (!asked.length) {
      if (!group && c.refused.length) { const n = nameOf(c.refused[0].id); return { ok: false, error: refusalWords(c.refused[0].code, n, firstName(n)) }; }
      if (!group && c.pairSkipped.length) return { ok: false, error: `You've already followed up with ${firstName(nameOf(c.pairSkipped[0]))} about this twice today. The answers are in Between assistants, under Sent.` };
      return { ok: false, error: `I can't ask any of them: ${skipped.map((s) => `${s.name} (${s.reason})`).join(", ")}.` };
    }
    if (c.allowed.length && c.allowed.length + c.todayCount > FOLLOW_UP_LIMITS.perRequesterPerDay) {
      return { ok: false, error: limitWords(c.allowed.length, Math.max(0, FOLLOW_UP_LIMITS.perRequesterPerDay - c.todayCount)) };
    }
    return {
      ok: true, kind: group ? "group" : "person",
      subjects: chosen.filter((id) => asked.includes(id)).map((id) => ({ membershipId: id, name: nameOf(id), firstName: firstName(nameOf(id)) })),
      team, task, question: questionOf(input.question, task), skipped,
    };
  }));
}

export type CreateFollowUpsInput = { subjectMembershipIds: string[]; teamId?: string | null; taskId?: string | null; question: string };
export type CreateFollowUpsResult = {
  batchId: string; kind: "person" | "group";
  created: { id: string; subjectMembershipId: string; subjectName: string }[];
  reused: { id: string; subjectName: string }[];
  skipped: { name: string; reason: string }[];
};

/**
 * Inserts the batch and its 'pending' rows as the requester (the insert's row-level security checks the permission once
 * more), audits `followup.requested` per row (no question text), and re-checks every permission and limit. An open
 * follow-up with the same person about the same thing is reused, not repeated. Does NOT start processing: the caller
 * calls `startFollowUps(batchId)`.
 *
 * `threadMode` (phase 6): asked in a thread by tagging someone else's assistant; written on the rows ('facts' or 'ask').
 * `reuse` false: never reuse an open follow-up (a thread's question gets its own). Before 0043 a thread mode is refused.
 */
export async function createFollowUps(ctx: OrgContext, input: CreateFollowUpsInput, opts: { threadMode?: "facts" | "ask"; reuse?: boolean } = {}): Promise<CreateFollowUpsResult> {
  const ids = [...new Set((input.subjectMembershipIds ?? []).filter(isUuid).map((s) => s.toLowerCase()))];
  if (!ids.length) throw invalid("Say who to follow up with.");
  if (ids.length > FOLLOW_UP_LIMITS.batchMax) throw invalid(TOO_MANY);
  const taskId = input.taskId && isUuid(input.taskId) ? input.taskId : null;
  if (input.taskId && !taskId) throw invalid(refusalWords("task_not_found", "", ""));
  const teamId = input.teamId && isUuid(input.teamId) ? input.teamId : null;
  // A refusal is returned out of the transaction and thrown after it commits, so its audit row stays.
  const out = await retryWithout0039(() => withUser(ctx.user.profileId, async (db): Promise<CreateFollowUpsResult | { refused: AppError }> => {
    if (!(await schema0039Ready(db))) throw notReady();
    const threadMode = opts.threadMode === "facts" || opts.threadMode === "ask" ? opts.threadMode : null;
    if (threadMode && !(await schema0043Ready(db))) throw notReady();
    // One create at a time per person, so two Confirms cannot both pass the daily count.
    await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`followup.create:${ctx.membership.id}`]);
    const names = new Map((await db.query<{ id: string; name: string }>(
      `SELECT m.id, p.display_name AS name FROM memberships m JOIN profiles p ON p.id = m.user_id WHERE m.organisation_id = $1 AND m.id = ANY($2::uuid[])`, [ctx.org.id, ids])).map((r) => [r.id, r.name]));
    const nameOf = (id: string) => names.get(id) ?? "Someone";
    const task = taskId ? await db.maybeOne<{ id: string; title: string }>(`SELECT id, title FROM tasks WHERE id = $1 AND organisation_id = $2 AND archived_at IS NULL`, [taskId, ctx.org.id]) : null;
    if (taskId && !task) throw invalid(refusalWords("task_not_found", "", ""));
    const team = teamId ? await db.maybeOne<{ id: string }>(`SELECT id FROM teams WHERE id = $1 AND organisation_id = $2`, [teamId, ctx.org.id]) : null;
    const c = await checkSubjects(db, ctx, ids, taskId, { reuse: opts.reuse });
    const skipped = [
      ...c.refused.map((r) => ({ name: nameOf(r.id), reason: SKIP_REASONS[r.code] })),
      ...c.pairSkipped.map((id) => ({ name: nameOf(id), reason: SKIP_REASONS.pair_cap })),
    ];
    const reused = c.reused.map((r) => ({ id: r.id, subjectName: nameOf(r.subjectId) }));
    const group = !!team || ids.length > 1;
    if (!c.allowed.length) {
      if (c.reused.length) return { batchId: c.reused[0].batchId, kind: group ? "group" : "person", created: [], reused, skipped } satisfies CreateFollowUpsResult;
      if (!group && c.refused.length) return { refused: forbidden(refusalWords(c.refused[0].code, nameOf(c.refused[0].id), firstName(nameOf(c.refused[0].id)))) };
      if (!group && c.pairSkipped.length) return { refused: conflict("FOLLOW_UP_LIMIT", `You've already followed up with ${firstName(nameOf(c.pairSkipped[0]))} about this twice today.`) };
      return { refused: forbidden(`I can't ask any of them: ${skipped.map((s) => `${s.name} (${s.reason})`).join(", ")}.`) };
    }
    if (c.allowed.length + c.todayCount > FOLLOW_UP_LIMITS.perRequesterPerDay) {
      return { refused: conflict("FOLLOW_UP_LIMIT", limitWords(c.allowed.length, Math.max(0, FOLLOW_UP_LIMITS.perRequesterPerDay - c.todayCount))) };
    }
    const question = questionOf(input.question, task);
    const kind = group ? "group" : "person";
    const batch = await db.one<{ id: string }>(
      `INSERT INTO follow_up_batches(organisation_id, requester_membership_id, kind, team_id, task_id, question, local_date, size)
       VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8) RETURNING id`,
      [ctx.org.id, ctx.membership.id, kind, team?.id ?? null, taskId, question, todayLocal(ctx.org.timezone), c.allowed.length]);
    const rows = threadMode
      ? await db.query<{ id: string; subject_membership_id: string }>(
        `INSERT INTO follow_ups(organisation_id, batch_id, requester_membership_id, subject_membership_id, task_id, question, thread_mode)
         SELECT $1, $2, $3, s.id, $4, $5, $7 FROM unnest($6::uuid[]) WITH ORDINALITY AS s(id, n) ORDER BY s.n
         RETURNING id, subject_membership_id`,
        [ctx.org.id, batch.id, ctx.membership.id, taskId, question, c.allowed, threadMode])
      : await db.query<{ id: string; subject_membership_id: string }>(
        `INSERT INTO follow_ups(organisation_id, batch_id, requester_membership_id, subject_membership_id, task_id, question)
         SELECT $1, $2, $3, s.id, $4, $5 FROM unnest($6::uuid[]) WITH ORDINALITY AS s(id, n) ORDER BY s.n
         RETURNING id, subject_membership_id`,
        [ctx.org.id, batch.id, ctx.membership.id, taskId, question, c.allowed]);
    for (const r of rows) {
      await audit(db, {
        organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "followup.requested", subjectType: "follow_up", subjectId: r.id,
        // No task title: the subject's team leads read this row and may not see the task (security review, 8 October
        // 2026); the Audit page names it from the id, under the reader's own row-level security.
        subjectMembershipId: r.subject_membership_id, metadata: { batchId: batch.id, taskId, kind, ...(threadMode ? { threadMode } : {}) },
      });
    }
    const created = c.allowed.map((id) => ({ id: rows.find((r) => r.subject_membership_id === id)!.id, subjectMembershipId: id, subjectName: nameOf(id) }));
    return { batchId: batch.id, kind, created, reused, skipped } satisfies CreateFollowUpsResult;
  }));
  if ("refused" in out) throw out.refused;
  return out;
}

// ---- Processing: the status machine -----------------------------------------------------------------------------------

type ProcRow = {
  id: string; organisation_id: string; batch_id: string; requester_membership_id: string | null; subject_membership_id: string; task_id: string | null;
  question: string; status: FollowUpStatus; answered_from: "facts" | "person" | "deadline" | null; capped: boolean; fresh: boolean | null;
  reply_choice: ReplyChoice | null; reply_note: string | null; replied_at: string | null; deadline_at: string | null; asked_at: string | null;
  batch_kind: "person" | "group" | "workspace"; local_date: string;
  slug: string; timezone: string; org_status: string;
  subject_status: string; subject_profile_id: string; subject_name: string; requester_name: string | null;
  preference: FollowUpPreference; report_time: string; collect_ask: boolean; task_title: string | null;
  sa_name: string | null; sa_colour: string | null; sa_visor: string | null; sa_eyes: string | null;
  ra_name: string | null; ra_colour: string | null; ra_visor: string | null; ra_eyes: string | null;
  w_name: string | null; w_colour: string | null; w_visor: string | null; w_eyes: string | null;
  /** Phase 6: asked in a thread (null before 0043, and for an ordinary follow-up), and that thread's name and kind. */
  thread_mode: "facts" | "ask" | null; thread_kind: string | null; thread_name: string | null;
};

const procSql = (ready43: boolean) => `
  SELECT f.id, f.organisation_id, f.batch_id, f.requester_membership_id, f.subject_membership_id, f.task_id, f.question, f.status,
         f.answered_from, f.capped, f.fresh, f.reply_choice, f.reply_note, f.replied_at, f.deadline_at, f.asked_at,
         b.kind AS batch_kind, b.local_date, o.slug, o.timezone, o.status AS org_status,
         sm.status AS subject_status, sp.id AS subject_profile_id, sp.display_name AS subject_name, rp.display_name AS requester_name,
         COALESCE(sa.followups, 'auto') AS preference,
         to_char(COALESCE(ws.daily_report_time, '18:00'::time), 'HH24:MI') AS report_time, COALESCE(ws.followup_collect_ask, false) AS collect_ask,
         t.title AS task_title,
         sa.name AS sa_name, sa.colour AS sa_colour, sa.visor AS sa_visor, sa.eyes AS sa_eyes,
         ra.name AS ra_name, ra.colour AS ra_colour, ra.visor AS ra_visor, ra.eyes AS ra_eyes,
         ws.assistant_name AS w_name, ws.assistant_colour AS w_colour, ws.assistant_visor AS w_visor, ws.assistant_eyes AS w_eyes,
         ${ready43
           ? `f.thread_mode, tc.kind AS thread_kind, CASE tc.kind WHEN 'organisation' THEN 'Everyone' WHEN 'team' THEN '#' || tct.name WHEN 'channel' THEN '#' || tc.title END AS thread_name`
           : "NULL::text AS thread_mode, NULL::text AS thread_kind, NULL::text AS thread_name"}
  FROM follow_ups f
  JOIN follow_up_batches b ON b.id = f.batch_id
  JOIN organisations o ON o.id = f.organisation_id
  JOIN memberships sm ON sm.id = f.subject_membership_id JOIN profiles sp ON sp.id = sm.user_id
  LEFT JOIN memberships rm ON rm.id = f.requester_membership_id LEFT JOIN profiles rp ON rp.id = rm.user_id
  LEFT JOIN assistant_profiles sa ON sa.membership_id = f.subject_membership_id
  LEFT JOIN assistant_profiles ra ON ra.membership_id = f.requester_membership_id
  LEFT JOIN brenda_settings ws ON ws.organisation_id = f.organisation_id
  LEFT JOIN tasks t ON t.id = f.task_id
  ${ready43 ? `LEFT JOIN assistant_mentions tam ON tam.follow_up_id = f.id
  LEFT JOIN conversations tc ON tc.id = tam.conversation_id
  LEFT JOIN teams tct ON tct.id = tc.team_id` : ""}
  WHERE f.id = $1`;

/** Who is who in one follow-up, with their assistants' names (R, RA, S, SA and W in the contract's words). */
type Names = { S: string; SName: string; SA: AssistantProfile; R: string | null; RName: string | null; RA: AssistantProfile | null; W: AssistantProfile };
function namesOf(r: ProcRow): Names {
  return {
    S: firstName(r.subject_name), SName: r.subject_name, SA: toProfile(look(r, "sa")),
    R: r.requester_membership_id && r.requester_name ? firstName(r.requester_name) : null, RName: r.requester_membership_id ? r.requester_name : null,
    RA: r.requester_membership_id ? toProfile(look(r, "ra")) : null,
    W: toProfile(look(r, "w")),
  };
}

async function loadProc(id: string): Promise<ProcRow | null> {
  return withWorker(async (db) => {
    if (!(await schema0039Ready(db))) return null;
    return db.maybeOne<ProcRow>(procSql(await schema0043Ready(db)), [id]);
  });
}

/**
 * A follow-up asked in a thread (phase 6): brings the thread up to date after a transition, once its transaction has
 * committed. Loaded when needed (the processor imports this file); never throws, never waits.
 */
function syncThread(r: Pick<ProcRow, "id" | "thread_mode">): void {
  if (!r.thread_mode) return;
  void import("@/server/services/mention-processor").then((m) => m.syncThreadFollowUp(r.id)).catch(warn("bringing the thread up to date"));
}

/** Where a thread follow-up was asked, in the subject's words: "#Design", "Everyone", "your chat", or "Messages" before it is linked. */
const threadWhere = (r: Pick<ProcRow, "thread_kind" | "thread_name">) => (r.thread_kind === "direct" ? "your chat" : r.thread_name ?? "Messages");
const statusNow = (id: string) => withWorker((db) => db.maybeOne<{ status: FollowUpStatus }>(`SELECT status FROM follow_ups WHERE id = $1`, [id])).then((r) => r?.status ?? null);

/** One activity row in the subject's "What … did" (their own assistant acted for them); written by the worker. */
async function logForSubject(db: Db, r: ProcRow, summary: string, personal: string) {
  await db.query(
    `INSERT INTO brenda_actions(organisation_id, membership_id, tool, summary, outcome, source, detail) VALUES ($1, $2, 'follow_up_answer', $3, 'done', 'automatic', $4::jsonb)`,
    [r.organisation_id, r.subject_membership_id, clip(summary, 500), JSON.stringify({ href: followUpHref(r.slug, r.id), personalSummary: clip(personal, 500) })]);
}

/**
 * The subject's ask, closed once it no longer needs them (cancelled, past its deadline, failed): marked read, and its
 * words say why, so the bell, the Notifications page and the notch stop offering "Reply in a tap" (visual and
 * correctness reviews, 8 October 2026). Written as the subject (notifications are updated only by their recipient);
 * a subject who has left updates nothing. Never throws.
 */
async function closeAsk(subjectProfileId: string, subjectMembershipId: string, id: string, body: string): Promise<void> {
  await withUser(subjectProfileId, (db) => db.query(
    `UPDATE notifications SET read_at = COALESCE(read_at, now()), body = $3 WHERE recipient_membership_id = $1 AND deduplication_key = $2`,
    [subjectMembershipId, `followup.ask:${id}`, clip(body, 300)])).catch(warn("closing the ask"));
}

/** Who asked, in the words the subject reads: "Olu's Max", or "today's team report" for the workspace's collection. */
const askerPhrase = (n: Names) => (n.R && n.RA ? `${n.R}'s ${n.RA.name}` : null);

function answerTitle(status: FollowUpStatus, n: Names, taskTitle: string | null): string {
  switch (status) {
    case "expired": return taskTitle ? `No reply from ${n.S} about ${tq(taskTitle)}` : `No reply from ${n.S}`;
    case "declined": return `${n.S} can't answer right now`;
    case "failed": return `Couldn't follow up with ${n.S}`;
    default: return taskTitle ? `${n.S}'s ${n.SA.name} answered about ${tq(taskTitle)}` : `${n.S}'s ${n.SA.name} answered: what ${n.S} is working on`;
  }
}

function askTitle(n: Names, taskTitle: string | null): string {
  const who = askerPhrase(n);
  if (!who) return `${n.W.name} is collecting updates for today's team report`;
  return taskTitle ? `${who} wants an update on ${tq(taskTitle)}` : `${who} wants to know what you're working on`;
}

/** T7: failed, with nothing shared. Notifies a one-person ask's requester; closes the batch when it can. */
async function fail(r: ProcRow, failure: FollowUpFailure): Promise<FollowUpStatus | null> {
  const moved = await withWorker(async (db) => {
    const ok = await db.maybeOne(`UPDATE follow_ups SET status = 'failed', failure = $2, lease_until = NULL WHERE id = $1 AND status IN ${OPEN_SQL} RETURNING id`, [r.id, failure]);
    if (!ok) return false;
    await audit(db, { organisationId: r.organisation_id, action: "followup.failed", subjectType: "follow_up", subjectId: r.id, subjectMembershipId: r.subject_membership_id, metadata: { followUpId: r.id, reason: failure } });
    // Asked in a thread (phase 6): the thread says so, not a notification.
    if (r.batch_kind === "person" && r.requester_membership_id && !r.thread_mode) {
      const n = namesOf(r);
      await notify(db, {
        organisationId: r.organisation_id, recipientMembershipId: r.requester_membership_id, type: "brenda.followup_answer",
        title: answerTitle("failed", n, r.task_title), body: failureWords(failure, n.S), resourceType: "follow_up", resourceId: r.id,
        href: followUpHref(r.slug, r.id), dedupKey: `followup.answer:${r.id}`,
      });
    }
    return true;
  });
  if (!moved) return statusNow(r.id);
  if (r.asked_at) await closeAsk(r.subject_profile_id, r.subject_membership_id, r.id, "Closed. Nothing more is needed from you.");
  await closeBatch(r.batch_id).catch(warn("closing a batch"));
  syncThread(r);
  return "failed";
}

const FAILURE_OF: Record<RefusalCode, FollowUpFailure> = {
  task_not_found: "task_gone", own_todo: "task_gone", task_not_theirs: "task_gone",
  not_member: "not_allowed", not_allowed: "not_allowed", self: "not_allowed",
};

/** The requester's context and their permission now; a failure to record when they no longer may ask. */
async function requesterNow(r: ProcRow): Promise<{ ctx: OrgContext } | { failure: FollowUpFailure }> {
  const ctx = await withWorker((db) => memberContext(db, r.organisation_id, r.requester_membership_id!));
  if (!ctx || ctx.org.status !== "active") return { failure: "not_allowed" };
  const code = await withUser(ctx.user.profileId, (db) => db.one<{ reason: string | null }>(`SELECT app_follow_up_refusal($1, $2, $3::uuid) AS reason`, [r.organisation_id, r.subject_membership_id, r.task_id]));
  if (code.reason) return { failure: FAILURE_OF[isRefusalCode(code.reason) ? code.reason : "not_allowed"] };
  return { ctx };
}

const scopeOf = (ctx: OrgContext | null): FactsScope => (ctx ? { kind: "person", profileId: ctx.user.profileId, membershipId: ctx.membership.id } : { kind: "workspace" });

/** Step 2: a claimed 'pending' row. Gather, then ask the person once (T2) or answer from their work (T1, then compose). */
async function decide(r: ProcRow, now: Date, opts: { useModel?: boolean }): Promise<FollowUpStatus | null> {
  if (r.subject_status !== "active") return fail(r, "subject_left");
  if (r.org_status !== "active") return fail(r, "not_allowed");
  let requester: OrgContext | null = null;
  if (r.requester_membership_id) {
    const who = await requesterNow(r);
    if ("failure" in who) return fail(r, who.failure);
    requester = who.ctx;
  }
  const facts = await gatherFacts(scopeOf(requester), { organisationId: r.organisation_id, subjectMembershipId: r.subject_membership_id, taskId: r.task_id, now });
  if ("gone" in facts) return fail(r, "task_gone");
  const workspace = !r.requester_membership_id;
  // Asked in a thread about something other than the state of their work (phase 6): only the person can answer it.
  const wantAsk = r.preference === "ask_first" || r.thread_mode === "ask" || (!facts.fresh && (!workspace || r.collect_ask));
  let capped = false;
  if (wantAsk) {
    const clock = await withWorker((db) => orgClock(db, r.organisation_id, now));
    const deadline = workspace
      ? new Date(localTimeOn(r.local_date, r.report_time, r.timezone).getTime() - FOLLOW_UP_LIMITS.workspaceAskLeadSeconds * 1000)
      : addWorkingTime(now, clock.schedule, FOLLOW_UP_LIMITS.replyWorkingSeconds);
    // The collection ran too late to give anyone time to reply: the report gets what their work shows.
    if (deadline.getTime() > now.getTime() + 60_000) {
      const n = namesOf(r);
      const asked = await withWorker(async (db) => {
        await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`followup.ask:${r.subject_membership_id}`]);
        // Asked enough today: by anyone (4), or by this same person (1, cancelled asks included), so one colleague
        // cannot spend everyone's asks (security review, 8 October 2026). The workspace's collection has no pair.
        const count = await db.one<{ n: number; pair: number }>(
          `SELECT count(*)::int AS n, count(*) FILTER (WHERE requester_membership_id = $3::uuid)::int AS pair
           FROM follow_ups WHERE subject_membership_id = $1 AND asked_at >= $2::timestamptz`, [r.subject_membership_id, clock.midnight.toISOString(), r.requester_membership_id]);
        if (count.n >= FOLLOW_UP_LIMITS.asksPerSubjectPerDay || (r.requester_membership_id && count.pair >= FOLLOW_UP_LIMITS.asksPerPairPerDay)) return "capped" as const;
        const moved = await db.maybeOne(
          `UPDATE follow_ups SET status = 'asking', facts = $2::jsonb, fresh = $3, asked_at = now(), deadline_at = $4::timestamptz, lease_until = NULL WHERE id = $1 AND status = 'pending' RETURNING id`,
          [r.id, JSON.stringify(facts), facts.fresh, deadline.toISOString()]);
        if (!moved) return "lost" as const;
        const by = deadlineLabel(deadline.toISOString(), r.timezone, now);
        // Asked in a thread (phase 6): the reply is posted there, for everyone in it.
        const where = threadWhere(r);
        const threadBody = r.thread_kind === "direct"
          ? `Reply in a tap or say not now. Your reply is posted in your chat with ${n.R ?? "them"}. If you don't reply by ${by}, ${n.SA.name} says so there.`
          : `Reply in a tap or say not now. Your reply is posted in ${where === "Messages" ? "the conversation" : where} for everyone there. If you don't reply by ${by}, ${n.SA.name} says so there.`;
        await notify(db, {
          organisationId: r.organisation_id, recipientMembershipId: r.subject_membership_id, type: "brenda.followup_ask",
          title: r.thread_mode ? `${n.R ?? "Someone"} asked your ${n.SA.name} in ${where}` : askTitle(n, r.task_title),
          body: r.thread_mode ? threadBody : workspace
            ? `Reply before ${by}. Your reply goes in the report your team lead, the owner and HR receive.`
            : `Reply in a tap or say not now. If you don't reply by ${by}, ${n.RA?.name ?? "they"} gets what your work shows.`,
          resourceType: "follow_up", resourceId: r.id, href: askHref(r.slug, r.id), dedupKey: `followup.ask:${r.id}`,
        });
        await audit(db, { organisationId: r.organisation_id, action: "followup.asked_person", subjectType: "follow_up", subjectId: r.id, subjectMembershipId: r.subject_membership_id, metadata: { followUpId: r.id, deadlineAt: deadline.toISOString(), workspace, ...(r.thread_mode ? { threadMode: r.thread_mode } : {}) } });
        await logForSubject(db, r, "Asked you for an update",
          workspace ? "Asked you for an update for today's team report" : r.thread_mode ? `Asked you to answer ${n.R ?? "a colleague"} in ${where}` : `Asked you for an update for ${askerPhrase(n)}`);
        return "asked" as const;
      });
      if (asked === "asked") { syncThread(r); return "asking"; }
      if (asked === "lost") return statusNow(r.id);
      capped = true;
    }
  }
  const moved = await withWorker((db) => db.maybeOne(
    `UPDATE follow_ups SET status = 'answering', answered_from = 'facts', facts = $2::jsonb, fresh = $3, capped = $4 WHERE id = $1 AND status = 'pending' RETURNING id`,
    [r.id, JSON.stringify(facts), facts.fresh, capped]));
  if (!moved) return statusNow(r.id);
  return compose({ ...r, status: "answering", answered_from: "facts", capped, fresh: facts.fresh }, now, opts, { requester, facts });
}

/**
 * Step 4: a claimed 'answering' row. Checks the requester may still ask, gathers the facts as they are now (the snapshot
 * that is actually shared), writes the answer (one model call with no tools only when everything allows it, else the
 * template), then T5 with its notification, audit and activity row, and closes the batch when it can.
 */
async function compose(r: ProcRow, now: Date, opts: { useModel?: boolean }, pre?: { requester: OrgContext | null; facts: FollowUpFacts }): Promise<FollowUpStatus | null> {
  let requester: OrgContext | null = pre?.requester ?? null;
  let facts: FollowUpFacts | null = pre?.facts ?? null;
  if (!pre) {
    if (r.subject_status !== "active") return fail(r, "subject_left");
    if (r.requester_membership_id) {
      const who = await requesterNow(r);
      if ("failure" in who) return fail(r, who.failure);
      requester = who.ctx;
    }
    const got = await gatherFacts(scopeOf(requester), { organisationId: r.organisation_id, subjectMembershipId: r.subject_membership_id, taskId: r.task_id, now });
    if ("gone" in got) return fail(r, "task_gone");
    facts = got;
  }
  if (!facts) return fail(r, "error");
  const n = namesOf(r);
  const answeredFrom = r.answered_from ?? "facts";
  const input: ComposeInput = {
    question: r.question, kind: r.task_id ? "task" : "person", answeredFrom, facts, capped: !!r.capped,
    reply: r.reply_choice ? { choice: r.reply_choice, note: r.reply_note, at: isoOrNull(r.replied_at) ?? now.toISOString() } : null,
    subject: { name: n.SName, firstName: n.S, assistantName: n.SA.name },
    requester: n.RName && n.R && n.RA ? { name: n.RName, firstName: n.R, assistantName: n.RA.name } : null,
    deadlineAt: isoOrNull(r.deadline_at), timeZone: r.timezone, now,
  };
  // The model writes only answers from the facts and answers to a person's reply, for a person who asked, with the AI
  // connected and allowance left (decision 8). Tests never reach the model (NODE_ENV test), whatever they pass.
  let model: ComposeModel | null = null;
  const replyUsable = answeredFrom === "facts" || (answeredFrom === "person" && r.reply_choice !== "not_now");
  if (opts.useModel !== false && process.env.NODE_ENV !== "test" && requester && replyUsable && requester.plan.features.AI_ASSISTANT) {
    try {
      const connection = await resolveAssistant(r.organisation_id);
      const allowance = connection ? await aiAllowance(requester) : null;
      if (connection && allowance && !(allowance.ready && allowance.remaining <= 0)) model = { ctx: requester, connection, requestId: r.batch_id };
    } catch (err) { warn("checking the AI connection")(err); }
  }
  let out: { text: string; engine: "claude" | "template" };
  try { out = await composeFollowUpAnswer(input, { model }); } catch { out = { text: composeTemplate(input), engine: "template" }; }
  const answer = clip(out.text.trim() || "No update yet.", 2000);
  const status = await withWorker(async (db) => {
    const done = await db.maybeOne<{ status: FollowUpStatus }>(
      `UPDATE follow_ups SET status = CASE WHEN answered_from = 'deadline' THEN 'expired' WHEN reply_choice = 'not_now' THEN 'declined' ELSE 'answered' END,
              facts = $2::jsonb, answer = $3, answer_engine = $4, answered_at = now(), lease_until = NULL
       WHERE id = $1 AND status = 'answering' RETURNING status`, [r.id, JSON.stringify(facts), answer, out.engine]);
    if (!done) return null;
    await audit(db, { organisationId: r.organisation_id, action: "followup.answered", subjectType: "follow_up", subjectId: r.id, subjectMembershipId: r.subject_membership_id, metadata: { followUpId: r.id, status: done.status, answeredFrom, engine: out.engine } });
    // Asked in a thread (phase 6): the thread reply notifies the asker, and the owner's activity is written with it.
    if (r.batch_kind === "person" && r.requester_membership_id && !r.thread_mode) {
      await notify(db, {
        organisationId: r.organisation_id, recipientMembershipId: r.requester_membership_id, type: "brenda.followup_answer",
        title: answerTitle(done.status, n, r.task_title), body: clip(answer, 300), resourceType: "follow_up", resourceId: r.id,
        href: followUpHref(r.slug, r.id), dedupKey: `followup.answer:${r.id}`,
      });
    }
    if (answeredFrom === "facts" && !r.thread_mode) {
      const who = askerPhrase(n);
      await logForSubject(db, r, "Answered a follow-up from your work",
        who ? `Answered ${who} ${r.task_title ? `about ${tq(r.task_title)} ` : ""}from your work` : "Answered for today's team report from your work");
    }
    return done.status;
  });
  if (!status) return statusNow(r.id);
  // No reply by the deadline: the ask the subject was sent is closed, saying what happened.
  if (status === "expired" && r.asked_at) {
    const to = askerPhrase(n);
    await closeAsk(r.subject_profile_id, r.subject_membership_id, r.id, r.thread_mode
      ? `Closed: the time to reply has passed. ${n.SA.name} said so in ${threadWhere(r)}.`
      : to ? `Closed: the time to reply has passed. ${n.RA?.name ?? to} got what your work shows.` : "Closed: the time to reply has passed. Today's team report got what your work shows.");
  }
  await closeBatch(r.batch_id).catch(warn("closing a batch"));
  syncThread(r);
  return status;
}

/** Closes a batch once every follow-up in it is closed (guarded, once), with its summary; a group's requester is told. */
async function closeBatch(batchId: string): Promise<boolean> {
  return withWorker(async (db) => {
    const c = await db.one<FollowUpBatchView["counts"]>(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE status IN ${OPEN_SQL})::int AS open,
              count(*) FILTER (WHERE status = 'answered' AND answered_from IS DISTINCT FROM 'person')::int AS answered,
              count(*) FILTER (WHERE status = 'answered' AND answered_from = 'person')::int AS replied,
              count(*) FILTER (WHERE status = 'expired')::int AS "noReply", count(*) FILTER (WHERE status = 'declined')::int AS declined,
              count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled, count(*) FILTER (WHERE status = 'failed')::int AS failed
       FROM follow_ups WHERE batch_id = $1`, [batchId]);
    if (c.open > 0 || c.total === 0) return false;
    const summary = batchSummary(c);
    const b = await db.maybeOne<{ id: string; kind: string; organisation_id: string; requester_membership_id: string | null; slug: string; team_name: string | null }>(
      `UPDATE follow_up_batches b SET completed_at = now(), summary = $2
       FROM organisations o
       WHERE b.id = $1 AND o.id = b.organisation_id AND b.completed_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM follow_ups f WHERE f.batch_id = b.id AND f.status IN ${OPEN_SQL})
       RETURNING b.id, b.kind, b.organisation_id, b.requester_membership_id, o.slug, (SELECT t.name FROM teams t WHERE t.id = b.team_id) AS team_name`, [batchId, summary]);
    if (!b) return false;
    if (b.kind === "group" && b.requester_membership_id) {
      await notify(db, {
        organisationId: b.organisation_id, recipientMembershipId: b.requester_membership_id, type: "brenda.followup_batch",
        title: b.team_name ? `Updates from ${b.team_name} are in` : `Updates from ${c.total} ${c.total === 1 ? "person" : "people"} are in`,
        body: summary, resourceType: "follow_up", resourceId: b.id, href: batchHref(b.slug, b.id), dedupKey: `followup.batch:${b.id}`,
      });
    }
    return true;
  });
}

/**
 * The one entry point: moves a follow-up as far as it can go now. Safe to call any number of times, from anywhere (the
 * web process after a Confirm or a reply, the worker, a page settling an overdue row): a row someone else holds is left
 * alone. Returns its status afterwards (null when there is no such row or 0039 is not applied).
 */
export async function processFollowUp(id: string, opts: { useModel?: boolean; now?: Date } = {}): Promise<FollowUpStatus | null> {
  if (!isUuid(id)) return null;
  const now = opts.now ?? new Date();
  try {
    let r = await loadProc(id);
    if (!r) return null;
    if (!OPEN_STATUSES.includes(r.status)) return r.status;
    let useModel = opts.useModel;
    if (r.status === "asking") {
      if (!r.deadline_at || new Date(r.deadline_at).getTime() > now.getTime()) return "asking";
      // T4: no reply by the deadline. The answer is their work, written by the template.
      const moved = await withWorker((db) => db.maybeOne(
        `UPDATE follow_ups SET status = 'answering', answered_from = 'deadline', lease_until = NULL WHERE id = $1 AND status = 'asking' AND deadline_at <= $2::timestamptz RETURNING id`, [id, now.toISOString()]));
      if (!moved) return statusNow(id);
      useModel = false;
    }
    const claim = await withWorker((db) => db.maybeOne<{ status: FollowUpStatus; attempts: number }>(
      `UPDATE follow_ups SET lease_until = now() + ${LEASE_SQL}, attempts = attempts + 1
       WHERE id = $1 AND status IN ('pending', 'answering') AND (lease_until IS NULL OR lease_until < now()) RETURNING status, attempts`, [id]));
    if (!claim) return statusNow(id);
    r = await loadProc(id);
    if (!r) return null;
    if (claim.attempts > MAX_ATTEMPTS) return fail(r, "error");
    if (r.answered_from === "deadline") useModel = false;
    return r.status === "pending" ? await decide(r, now, { useModel }) : r.status === "answering" ? await compose(r, now, { useModel }) : r.status;
  } catch (err) {
    if (isMissingSchema(err)) { forget0039(); return null; }
    throw err;
  }
}

/** Every open follow-up of a batch, 4 at a time. Never throws. */
export async function processBatch(batchId: string, opts: { useModel?: boolean; now?: Date } = {}): Promise<void> {
  if (!isUuid(batchId)) return;
  try {
    const ids = await withWorker(async (db) => {
      if (!(await schema0039Ready(db))) return null;
      return (await db.query<{ id: string }>(`SELECT id FROM follow_ups WHERE batch_id = $1 AND status IN ${OPEN_SQL} ORDER BY created_at, id`, [batchId])).map((r) => r.id);
    });
    if (!ids) return;
    await inPool(ids, 4, (id) => processFollowUp(id, opts).then(() => undefined, warn(`processing ${id}`)));
    if (!ids.length) await closeBatch(batchId);
  } catch (err) {
    if (isMissingSchema(err)) forget0039();
    else warn(`processing batch ${batchId}`)(err);
  }
}

/** The worker's chunk (at most 10): one after another, each its own short transactions, templates only. Never throws. */
export async function processFollowUpIds(ids: string[], opts: { useModel?: boolean; now?: Date } = {}): Promise<void> {
  for (const id of ids.slice(0, 50)) await processFollowUp(id, { useModel: false, ...opts }).catch(warn(`processing ${id}`));
}

/**
 * Starts a batch right after the Confirm, in this web process, once the response has gone (Next's `after()`). Outside a
 * request (a script) `after` throws, and the batch runs as an un-awaited promise instead; the worker's sweep picks up
 * anything either leaves behind.
 */
export function startFollowUps(batchId: string, opts: { useModel?: boolean } = {}): void {
  const run = () => processBatch(batchId, opts);
  try { after(run); } catch { void run(); }
}

/** The same for one follow-up (after the subject replied). */
export function startFollowUp(id: string, opts: { useModel?: boolean } = {}): void {
  const run = () => processFollowUp(id, opts).then(() => undefined, warn(`processing ${id}`));
  try { after(run); } catch { void run(); }
}

// ---- Views ------------------------------------------------------------------------------------------------------------

type ViewRow = {
  id: string; batch_id: string; requester_membership_id: string | null; subject_membership_id: string; task_id: string | null; question: string;
  status: FollowUpStatus; answered_from: FollowUpView["answeredFrom"]; facts: unknown; capped: boolean;
  reply_choice: ReplyChoice | null; reply_note: string | null; answer: string | null; answer_engine: "claude" | "template" | null; failure: FollowUpFailure | null;
  asked_at: string | null; deadline_at: string | null; replied_at: string | null; answered_at: string | null; created_at: string;
  subject_name: string; requester_name: string | null; task_title: string | null;
  sa_name: string | null; sa_colour: string | null; sa_visor: string | null; sa_eyes: string | null;
  ra_name: string | null; ra_colour: string | null; ra_visor: string | null; ra_eyes: string | null;
  thread_mode: "facts" | "ask" | null; thread_kind: string | null; thread_name: string | null;
};

/**
 * The conversation a thread follow-up was asked in, so the subject's reply card and the notch can say the reply is posted
 * there (security review, 8 October 2026). Read as the viewer: a conversation they no longer read gives no name.
 */
const viewThreadSql = (ready43: boolean) => ready43
  ? `, f.thread_mode, tc.kind AS thread_kind,
       CASE tc.kind WHEN 'organisation' THEN 'Everyone' WHEN 'team' THEN '#' || tct.name WHEN 'channel' THEN '#' || tc.title END AS thread_name
     FROM follow_ups f
     LEFT JOIN LATERAL (SELECT am.conversation_id FROM assistant_mentions am WHERE f.thread_mode IS NOT NULL AND am.follow_up_id = f.id ORDER BY am.created_at LIMIT 1) tam ON true
     LEFT JOIN conversations tc ON tc.id = tam.conversation_id
     LEFT JOIN teams tct ON tct.id = tc.team_id`
  : `, NULL::text AS thread_mode, NULL::text AS thread_kind, NULL::text AS thread_name
     FROM follow_ups f`;

const VIEW_SQL = `
  SELECT f.id, f.batch_id, f.requester_membership_id, f.subject_membership_id, f.task_id, f.question, f.status, f.answered_from, f.facts, f.capped,
         f.reply_choice, f.reply_note, f.answer, f.answer_engine, f.failure, f.asked_at, f.deadline_at, f.replied_at, f.answered_at, f.created_at,
         sp.display_name AS subject_name, rp.display_name AS requester_name, COALESCE(t.title, f.facts->'task'->>'title') AS task_title,
         sa.name AS sa_name, sa.colour AS sa_colour, sa.visor AS sa_visor, sa.eyes AS sa_eyes,
         ra.name AS ra_name, ra.colour AS ra_colour, ra.visor AS ra_visor, ra.eyes AS ra_eyes
  __FROM__
  JOIN memberships sm ON sm.id = f.subject_membership_id JOIN profiles sp ON sp.id = sm.user_id
  LEFT JOIN memberships rm ON rm.id = f.requester_membership_id LEFT JOIN profiles rp ON rp.id = rm.user_id
  LEFT JOIN assistant_profiles sa ON sa.membership_id = f.subject_membership_id
  LEFT JOIN assistant_profiles ra ON ra.membership_id = f.requester_membership_id
  LEFT JOIN tasks t ON t.id = f.task_id`;

/**
 * The follow-ups this person may read (row-level security as them), shaped for them: facts and the reply reach the
 * requester (and readers of the workspace's rows) only once there is an answer; the subject always sees what their
 * assistant shared and what they replied.
 */
async function loadViews(db: Db, ctx: OrgContext, where: string, params: unknown[], tail = "ORDER BY f.created_at DESC, f.id DESC"): Promise<FollowUpView[]> {
  const sql = VIEW_SQL.replace("__FROM__", viewThreadSql(await schema0043Ready(db)));
  const rows = await db.query<ViewRow>(`${sql} WHERE f.organisation_id = $1 AND (${where}) ${tail}`, [ctx.org.id, ...params]);
  const workspace = rows.some((r) => !r.requester_membership_id) ? await readWorkspaceAssistant(db, ctx.org.id) : null;
  return rows.map((r) => toView(r, ctx, workspace));
}

function toView(r: ViewRow, ctx: OrgContext, workspace: AssistantProfile | null): FollowUpView {
  const me = ctx.membership.id;
  const viewer: FollowUpView["viewer"] = r.requester_membership_id === me ? "requester" : r.subject_membership_id === me ? "subject" : "reader";
  const shared = SHARED_STATUSES.includes(r.status);
  const replyShared = viewer === "subject" || r.status === "answered" || r.status === "declined";
  const person = (id: string, name: string | null, p: Look): PersonRef => ({ membershipId: id, name: name ?? "Someone", firstName: firstName(name ?? "Someone"), assistant: toProfile(p) });
  return {
    id: r.id, batchId: r.batch_id, status: r.status, answeredFrom: viewer === "subject" || shared ? r.answered_from : null,
    question: r.question,
    task: r.task_id ? { id: r.task_id, title: r.task_title ?? "A task", href: taskHref(ctx.org.slug, r.task_id) } : null,
    requester: r.requester_membership_id ? person(r.requester_membership_id, r.requester_name, look(r, "ra")) : null,
    workspaceAssistant: r.requester_membership_id ? null : workspace,
    subject: person(r.subject_membership_id, r.subject_name, look(r, "sa")),
    facts: viewer === "subject" || shared ? factsOrNull(r.facts) : null,
    reply: r.reply_choice && replyShared ? { choice: r.reply_choice, note: r.reply_note, at: r.replied_at ?? r.created_at } : null,
    answer: r.answer, answerEngine: r.answer_engine, capped: !!r.capped,
    askedAt: r.asked_at, deadlineAt: r.deadline_at, repliedAt: replyShared ? r.replied_at : null, answeredAt: r.answered_at, createdAt: r.created_at,
    failure: r.failure,
    viewer,
    thread: r.thread_mode
      ? { mode: r.thread_mode, direct: r.thread_kind === "direct", where: r.thread_kind === "direct" ? `your chat with ${viewer === "subject" ? r.requester_name ?? "them" : r.subject_name}` : r.thread_name ?? "the conversation" }
      : null,
    canReply: viewer === "subject" && r.status === "asking",
    canCancel: viewer === "requester" && (r.status === "pending" || r.status === "asking"),
    href: followUpHref(ctx.org.slug, r.id),
  };
}

const OVERDUE_SQL = `((f.status = 'asking' AND f.deadline_at <= now()) OR (f.status IN ('pending', 'answering') AND COALESCE(f.lease_until, f.updated_at) < now() - ${LEASE_SQL}))`;

/**
 * Settles overdue follow-ups this person can see before a read (at most 5, templates only), so an expired ask reads as
 * expired even before the worker's sweep has run (review, 8 October 2026: decision 6).
 */
async function settle(ctx: OrgContext, where: string, params: unknown[]): Promise<void> {
  try {
    const ids = await withUser(ctx.user.profileId, async (db) => {
      if (!(await schema0039Ready(db))) return [];
      return (await db.query<{ id: string }>(
        `SELECT f.id FROM follow_ups f WHERE f.organisation_id = $1 AND (${where}) AND ${OVERDUE_SQL} ORDER BY f.created_at LIMIT 5`, [ctx.org.id, ...params])).map((r) => r.id);
    });
    for (const id of ids) await processFollowUp(id, { useModel: false }).catch(warn(`settling ${id}`));
  } catch (err) {
    if (isMissingSchema(err)) { forget0039(); return; }
    warn("settling overdue follow-ups")(err);
  }
}

/** Whether follow-ups exist here yet (migration 0039), for the routes' `ready: false` answers. */
export async function followUpsReady(ctx: OrgContext): Promise<boolean> {
  try { return await withUser(ctx.user.profileId, (db) => schema0039Ready(db)); } catch (err) { if (isMissingSchema(err)) return false; throw err; }
}

/** One follow-up, for whoever may read it (requester, subject, or a reader of the workspace's rows); null otherwise. */
export async function getFollowUp(ctx: OrgContext, id: string): Promise<FollowUpView | null> {
  if (!isUuid(id)) return null;
  await settle(ctx, "f.id = $2", [id]);
  return retryWithout0039(() => withUser(ctx.user.profileId, async (db) => {
    if (!(await schema0039Ready(db))) return null;
    return (await loadViews(db, ctx, "f.id = $2", [id]))[0] ?? null;
  }));
}

type BatchRow = { id: string; kind: FollowUpBatchView["kind"]; question: string; task_id: string | null; team_id: string | null; team_name: string | null; task_title: string | null; created_at: string; completed_at: string | null; summary: string | null; requester_membership_id: string | null };
const BATCH_SQL = `
  SELECT b.id, b.kind, b.question, b.task_id, b.team_id, tm.name AS team_name, tk.title AS task_title, b.created_at, b.completed_at, b.summary, b.requester_membership_id
  FROM follow_up_batches b LEFT JOIN teams tm ON tm.id = b.team_id LEFT JOIN tasks tk ON tk.id = b.task_id`;

function countsOf(items: FollowUpView[]): FollowUpBatchView["counts"] {
  const c = { total: items.length, open: 0, answered: 0, replied: 0, noReply: 0, declined: 0, cancelled: 0, failed: 0 };
  for (const v of items) {
    if (OPEN_STATUSES.includes(v.status)) c.open++;
    else if (v.status === "answered") { if (v.answeredFrom === "person") c.replied++; else c.answered++; }
    else if (v.status === "expired") c.noReply++;
    else if (v.status === "declined") c.declined++;
    else if (v.status === "cancelled") c.cancelled++;
    else if (v.status === "failed") c.failed++;
  }
  return c;
}

function toBatchView(b: BatchRow, items: FollowUpView[], ctx: OrgContext): FollowUpBatchView {
  const taskTitle = b.task_title ?? items.find((i) => i.task)?.task?.title ?? null;
  // The workspace's summary counts everyone in the organisation: only owners and HR read it. Anyone else who can read
  // some of its rows (the subject, a team lead) gets no summary (security review, 8 October 2026).
  const orgWide = b.kind !== "workspace" || ctx.membership.role === "owner" || ctx.membership.role === "hr";
  return {
    id: b.id, kind: b.kind, question: b.question,
    task: b.task_id ? { id: b.task_id, title: taskTitle ?? "A task", href: taskHref(ctx.org.slug, b.task_id) } : null,
    team: b.team_id && b.team_name ? { id: b.team_id, name: b.team_name } : null,
    createdAt: b.created_at, completedAt: b.completed_at, summary: orgWide ? b.summary : null,
    counts: countsOf(items), items, href: batchHref(ctx.org.slug, b.id),
  };
}

/** One batch: the requester's own, or the workspace's collection for someone who may read some of its rows. */
export async function getFollowUpBatch(ctx: OrgContext, batchId: string): Promise<FollowUpBatchView | null> {
  if (!isUuid(batchId)) return null;
  await settle(ctx, "f.batch_id = $2", [batchId]);
  return retryWithout0039(() => withUser(ctx.user.profileId, async (db) => {
    if (!(await schema0039Ready(db))) return null;
    const b = await db.maybeOne<BatchRow>(`${BATCH_SQL} WHERE b.id = $1 AND b.organisation_id = $2`, [batchId, ctx.org.id]);
    if (!b) return null;
    const items = await loadViews(db, ctx, "f.batch_id = $2", [batchId], "ORDER BY f.created_at, f.id");
    if (b.requester_membership_id !== ctx.membership.id && !items.length) return null;
    return toBatchView(b, items, ctx);
  }));
}

const pageLimit = (v: number | undefined, d: number) => Math.min(50, Math.max(1, Math.round(Number.isFinite(v) ? (v as number) : d)));
const beforeOf = (v: string | null | undefined) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);

/** The person's own follow-ups ("You asked"), a batch at a time, newest first. */
export async function listMyFollowUps(ctx: OrgContext, opts: { status?: "open" | "done" | "all"; before?: string | null; limit?: number; batchId?: string | null } = {}): Promise<{ ready: boolean; batches: FollowUpBatchView[]; nextBefore: string | null }> {
  const limit = pageLimit(opts.limit, 20);
  const before = beforeOf(opts.before);
  if (opts.batchId && !isUuid(opts.batchId)) return { ready: true, batches: [], nextBefore: null };
  await settle(ctx, opts.batchId ? "f.requester_membership_id = $2 AND f.batch_id = $3" : "f.requester_membership_id = $2", opts.batchId ? [ctx.membership.id, opts.batchId] : [ctx.membership.id]);
  return retryWithout0039(() => withUser(ctx.user.profileId, async (db) => {
    if (!(await schema0039Ready(db))) return { ready: false, batches: [], nextBefore: null };
    const params: unknown[] = [ctx.org.id, ctx.membership.id];
    let where = "b.organisation_id = $1 AND b.requester_membership_id = $2";
    if (opts.batchId) { params.push(opts.batchId); where += ` AND b.id = $${params.length}`; }
    if (before) { params.push(before); where += ` AND b.created_at < $${params.length}::timestamptz`; }
    const open = `EXISTS (SELECT 1 FROM follow_ups f WHERE f.batch_id = b.id AND f.status IN ${OPEN_SQL})`;
    if (opts.status === "open") where += ` AND ${open}`;
    if (opts.status === "done") where += ` AND NOT ${open}`;
    params.push(limit + 1);
    const rows = await db.query<BatchRow>(`${BATCH_SQL} WHERE ${where} ORDER BY b.created_at DESC, b.id DESC LIMIT $${params.length}`, params);
    const page = rows.slice(0, limit);
    const items = page.length ? await loadViews(db, ctx, "f.batch_id = ANY($2::uuid[])", [page.map((b) => b.id)], "ORDER BY f.created_at, f.id") : [];
    return {
      ready: true,
      batches: page.map((b) => toBatchView(b, items.filter((i) => i.batchId === b.id), ctx)),
      nextBefore: rows.length > limit ? page[page.length - 1].created_at : null,
    };
  }));
}

/** "Asked about you": what is waiting for the person's reply, and every follow-up about them, newest first. */
export async function listFollowUpsAboutMe(ctx: OrgContext, opts: { before?: string | null; limit?: number } = {}): Promise<{ ready: boolean; waiting: FollowUpView[]; items: FollowUpView[]; nextBefore: string | null }> {
  const limit = pageLimit(opts.limit, 20);
  const before = beforeOf(opts.before);
  await settle(ctx, "f.subject_membership_id = $2", [ctx.membership.id]);
  return retryWithout0039(() => withUser(ctx.user.profileId, async (db) => {
    if (!(await schema0039Ready(db))) return { ready: false, waiting: [], items: [], nextBefore: null };
    const waiting = await loadViews(db, ctx, "f.subject_membership_id = $2 AND f.status = 'asking'", [ctx.membership.id], "ORDER BY f.deadline_at, f.id LIMIT 10");
    const rows = await loadViews(db, ctx, `f.subject_membership_id = $2 ${before ? "AND f.created_at < $3::timestamptz" : ""}`,
      before ? [ctx.membership.id, before] : [ctx.membership.id], `ORDER BY f.created_at DESC, f.id DESC LIMIT ${limit + 1}`);
    const items = rows.slice(0, limit);
    return { ready: true, waiting, items, nextBefore: rows.length > limit ? items[items.length - 1].createdAt : null };
  }));
}

/** What waits for this person's reply (their assistant is asking them), oldest deadline first, at most 10; [] before 0039. */
export async function waitingForMe(ctx: OrgContext): Promise<FollowUpView[]> {
  await settle(ctx, "f.subject_membership_id = $2 AND f.status = 'asking'", [ctx.membership.id]);
  try {
    return await retryWithout0039(() => withUser(ctx.user.profileId, async (db) => {
      if (!(await schema0039Ready(db))) return [];
      return loadViews(db, ctx, "f.subject_membership_id = $2 AND f.status = 'asking'", [ctx.membership.id], "ORDER BY f.deadline_at, f.id LIMIT 10");
    }));
  } catch (err) {
    if (isMissingSchema(err)) return [];
    throw err;
  }
}

// ---- The subject's reply, the requester's cancel ----------------------------------------------------------------------

export const replySchema = z.object({
  choice: z.enum(REPLY_CHOICES, { error: "Pick On track, Blocked, Done, Not started or Not now." }),
  note: z.string().max(2000).nullable().optional(),
});
export const FOLLOW_UP_BODY_MAX = 4096;
const CLOSED = "This follow-up is already closed.";

/**
 * The subject's reply, in their own words (definer `app_follow_up_reply`, only while their assistant is asking them).
 * Refused while someone else is signed in as them. Marks their own ask notification read, logs it on their activity and
 * starts the answer in this process (unless `start: false`).
 */
export async function replyToFollowUp(ctx: OrgContext, id: string, input: { choice: ReplyChoice; note?: string | null }, opts: { useModel?: boolean; start?: boolean } = {}): Promise<FollowUpView> {
  if (ctx.user.impersonation) throw forbidden("Only the person can reply. It stays as it is while someone else is signed in as them.");
  if (!isUuid(id)) throw notFound("Follow-up not found.");
  if (!(REPLY_CHOICES as readonly string[]).includes(input.choice)) throw invalid("Pick an answer.", { choice: ["Pick On track, Blocked, Done, Not started or Not now."] });
  const note = input.choice === "not_now" ? null : (input.note ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim() || null;
  if (note && note.length > FOLLOW_UP_LIMITS.noteMax) throw invalid("Keep the line to 280 characters.", { note: ["Keep it to 280 characters."] });
  await retryWithout0039(() => withUser(ctx.user.profileId, async (db) => {
    if (!(await schema0039Ready(db))) throw notReady();
    const r = await db.one<{ r: string }>(`SELECT app_follow_up_reply($1, $2, $3) AS r`, [id, input.choice, note]);
    if (r.r === "not_found") throw notFound("Follow-up not found.");
    if (r.r === "closed") throw conflict("FOLLOW_UP_CLOSED", CLOSED);
    if (r.r === "bad_choice") throw invalid("Pick an answer.", { choice: ["Pick On track, Blocked, Done, Not started or Not now."] });
    if (r.r === "too_long") throw invalid("Keep the line to 280 characters.", { note: ["Keep it to 280 characters."] });
    await db.query(`UPDATE notifications SET read_at = now() WHERE recipient_membership_id = $1 AND deduplication_key = $2 AND read_at IS NULL`, [ctx.membership.id, `followup.ask:${id}`]);
    const who = await db.maybeOne<{ r_first: string | null; ra_name: string | null }>(
      `SELECT split_part(btrim(rp.display_name), ' ', 1) AS r_first, ra.name AS ra_name
       FROM follow_ups f LEFT JOIN memberships rm ON rm.id = f.requester_membership_id LEFT JOIN profiles rp ON rp.id = rm.user_id
       LEFT JOIN assistant_profiles ra ON ra.membership_id = f.requester_membership_id WHERE f.id = $1`, [id]);
    const to = who?.r_first ? `${who.r_first}'s ${toProfile({ name: who.ra_name }).name}` : null;
    await logAction(db, ctx, {
      tool: "follow_up_answer", summary: "Passed your reply on", outcome: "done", source: "automatic",
      detail: { href: followUpHref(ctx.org.slug, id), personalSummary: to ? `Passed your reply to ${to}` : "Passed your reply on for today's team report" },
    });
  }));
  if (opts.start !== false) startFollowUp(id, { useModel: opts.useModel });
  const view = await getFollowUp(ctx, id);
  if (!view) throw notFound("Follow-up not found.");
  return view;
}

/** The requester cancels while it is still open (definer `app_follow_up_cancel`); nothing more is asked or shared. */
export async function cancelFollowUp(ctx: OrgContext, id: string): Promise<FollowUpView> {
  if (!isUuid(id)) throw notFound("Follow-up not found.");
  const row = await retryWithout0039(() => withUser(ctx.user.profileId, async (db) => {
    if (!(await schema0039Ready(db))) throw notReady();
    const r = await db.one<{ r: string }>(`SELECT app_follow_up_cancel($1) AS r`, [id]);
    if (r.r === "not_found") throw notFound("Follow-up not found.");
    if (r.r === "closed") throw conflict("FOLLOW_UP_CLOSED", CLOSED);
    const ready43 = await schema0043Ready(db);
    const row = await db.one<{ batch_id: string; subject_membership_id: string; asked_at: string | null; thread_mode: "facts" | "ask" | null }>(
      `SELECT batch_id, subject_membership_id, asked_at, ${ready43 ? "thread_mode" : "NULL::text AS thread_mode"} FROM follow_ups WHERE id = $1`, [id]);
    await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "followup.cancelled", subjectType: "follow_up", subjectId: id, subjectMembershipId: row.subject_membership_id, metadata: { followUpId: id } });
    return row;
  }));
  // The subject was asked: their ask is closed and says so (the bell, Notifications and the notch stop offering a reply).
  if (row.asked_at) {
    const subject = await withWorker((db) => db.maybeOne<{ user_id: string }>(`SELECT user_id FROM memberships WHERE id = $1`, [row.subject_membership_id])).catch(() => null);
    if (subject) await closeAsk(subject.user_id, row.subject_membership_id, id, `${firstName(ctx.user.displayName)} cancelled this follow-up. Nothing more is needed from you.`);
  }
  await closeBatch(row.batch_id).catch(warn("closing a batch"));
  // Asked in a thread (phase 6): the thread says it closed.
  syncThread({ id, thread_mode: row.thread_mode });
  const view = await getFollowUp(ctx, id);
  if (!view) throw notFound("Follow-up not found.");
  return view;
}

/**
 * A thread's follow-up no longer needed (phase 6: the question that asked it was withdrawn), cancelled by Boredroom's
 * worker while it is open; the subject's ask is closed with `body` ("Olu withdrew the question."). True when it moved now.
 */
export async function cancelThreadFollowUp(id: string, body: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  try {
    const row = await withWorker(async (db) => {
      if (!(await schema0039Ready(db))) return null;
      const r = await db.maybeOne<{ batch_id: string; organisation_id: string; subject_membership_id: string; asked_at: string | null; user_id: string }>(
        `UPDATE follow_ups f SET status = 'cancelled', lease_until = NULL FROM memberships sm
         WHERE f.id = $1 AND f.status IN ${OPEN_SQL} AND sm.id = f.subject_membership_id
         RETURNING f.batch_id, f.organisation_id, f.subject_membership_id, f.asked_at, sm.user_id`, [id]);
      if (!r) return null;
      await audit(db, { organisationId: r.organisation_id, action: "followup.cancelled", subjectType: "follow_up", subjectId: id, subjectMembershipId: r.subject_membership_id, metadata: { followUpId: id, reason: "question_withdrawn" } });
      return r;
    });
    if (!row) return false;
    if (row.asked_at) await closeAsk(row.user_id, row.subject_membership_id, id, body);
    await closeBatch(row.batch_id).catch(warn("closing a batch"));
    return true;
  } catch (err) {
    if (isMissingSchema(err)) { forget0039(); return false; }
    throw err;
  }
}

// ---- The person's choice and the workspace's collection settings ------------------------------------------------------

export const preferenceSchema = z.object({ preference: z.enum(["auto", "ask_first"], { error: "Pick how your assistant answers." }) });

/** "When someone's assistant asks about your work": answer from my work (the default) or always ask me first. */
export async function followUpPreference(ctx: OrgContext): Promise<{ ready: boolean; preference: FollowUpPreference }> {
  try {
    return await retryWithout0039(() => withUser(ctx.user.profileId, async (db) => {
      if (!(await schema0039Ready(db))) return { ready: false, preference: "auto" as const };
      const r = await db.maybeOne<{ followups: string }>(`SELECT followups FROM assistant_profiles WHERE membership_id = $1`, [ctx.membership.id]);
      return { ready: true, preference: r?.followups === "ask_first" ? "ask_first" as const : "auto" as const };
    }));
  } catch (err) {
    if (isMissingSchema(err)) return { ready: false, preference: "auto" };
    throw err;
  }
}

/** Saved on its own, at once. Refused while someone else is signed in as the person. Not logged: a personal preference. */
export async function saveFollowUpPreference(ctx: OrgContext, preference: FollowUpPreference): Promise<{ preference: FollowUpPreference }> {
  if (ctx.user.impersonation) throw forbidden("Only the person can change how their assistant answers. It stays as it is while someone else is signed in as them.");
  if (preference !== "auto" && preference !== "ask_first") throw invalid("Pick how your assistant answers.", { preference: ["Pick one of the two."] });
  return retryWithout0039(() => withUser(ctx.user.profileId, async (db) => {
    if (!(await schema0039Ready(db))) throw notReady();
    // A person with no row yet gets one with the look as it is and setup still not done (as saveMySpeak does).
    const r = await db.one<{ followups: FollowUpPreference }>(
      `INSERT INTO assistant_profiles(membership_id, organisation_id, followups, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (membership_id) DO UPDATE SET followups = $3, updated_at = now() RETURNING followups`, [ctx.membership.id, ctx.org.id, preference]);
    return { preference: r.followups };
  }));
}

export type FollowUpCollectionSettings = { ready: boolean; collect: boolean; collectAsk: boolean; leadMinutes: 30 | 60 | 90 | 120 };
const LEADS = [30, 60, 90, 120] as const;
const leadOf = (v: unknown): FollowUpCollectionSettings["leadMinutes"] => (LEADS as readonly number[]).includes(Number(v)) ? (Number(v) as FollowUpCollectionSettings["leadMinutes"]) : 60;
const OFF: FollowUpCollectionSettings = { ready: false, collect: false, collectAsk: false, leadMinutes: 60 };

export const collectionSettingsSchema = z.object({
  collect: z.boolean().optional(),
  collectAsk: z.boolean().optional(),
  leadMinutes: z.union([z.literal(30), z.literal(60), z.literal(90), z.literal(120)], { error: "Pick 30 minutes, 1 hour, 1 hour 30 minutes or 2 hours." }).optional(),
});

/** The workspace's collection before the end-of-day report (members may read it). Defaults before 0039. */
export async function followUpSettings(db: Db, orgId: string): Promise<FollowUpCollectionSettings> {
  if (!(await schema0039Ready(db))) return OFF;
  const r = await db.maybeOne<{ collect: boolean; ask: boolean; minutes: number }>(
    `SELECT followup_collect AS collect, followup_collect_ask AS ask, followup_collect_minutes AS minutes FROM brenda_settings WHERE organisation_id = $1`, [orgId]);
  return { ready: true, collect: r?.collect ?? false, collectAsk: r?.ask ?? false, leadMinutes: leadOf(r?.minutes ?? 60) };
}

/** Owners and HR. Each change names only what it changes, under the same lock as the organisation's other Brenda settings. */
export async function saveFollowUpSettings(ctx: OrgContext, patch: Partial<Omit<FollowUpCollectionSettings, "ready">>): Promise<FollowUpCollectionSettings> {
  if (ctx.membership.role !== "owner" && ctx.membership.role !== "hr") throw forbidden("Only the organisation owner or HR can change how updates are collected before the report.");
  if (patch.leadMinutes !== undefined && !(LEADS as readonly number[]).includes(patch.leadMinutes)) throw invalid("Pick how long before the report.", { leadMinutes: ["Pick 30 minutes, 1 hour, 1 hour 30 minutes or 2 hours."] });
  return retryWithout0039(() => withUser(ctx.user.profileId, async (db) => {
    if (!(await schema0039Ready(db))) throw notReady();
    await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`brenda_settings:${ctx.org.id}`]);
    const cur = await followUpSettings(db, ctx.org.id);
    const next: FollowUpCollectionSettings = {
      ready: true, collect: patch.collect ?? cur.collect, collectAsk: patch.collectAsk ?? cur.collectAsk, leadMinutes: patch.leadMinutes ?? cur.leadMinutes,
    };
    await db.query(
      `INSERT INTO brenda_settings(organisation_id, followup_collect, followup_collect_ask, followup_collect_minutes, updated_by, updated_at) VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (organisation_id) DO UPDATE SET followup_collect = $2, followup_collect_ask = $3, followup_collect_minutes = $4, updated_by = $5, updated_at = now()`,
      [ctx.org.id, next.collect, next.collectAsk, next.leadMinutes, ctx.membership.id]);
    const lead = next.leadMinutes === 60 ? "1 hour" : next.leadMinutes === 90 ? "1 hour 30 minutes" : next.leadMinutes === 120 ? "2 hours" : "30 minutes";
    await logAction(db, ctx, {
      tool: "settings", outcome: "done", source: "confirm",
      summary: next.collect ? `Updates before the report: on, ${lead} before, ${next.collectAsk ? "asking people with no update today" : "from their work only"}` : "Updates before the report: off",
    });
    return next;
  }));
}

// ---- The notch -----------------------------------------------------------------------------------------------------------

export type DesktopFollowUps = {
  ready: boolean;
  /** Asks waiting for this person (status asking), oldest deadline first, max 5. */
  waiting: { id: string; title: string; question: string; taskTitle: string | null; taskHref: string | null;
             asker: { name: string; assistant: DesktopAssistant } | null;   // null: the workspace (use assistant.workspace)
             deadlineAt: string; facts: string[];
             /** Asked in a conversation (phase 6): the reply is posted in `where` for everyone there; no facts are shared. */
             thread?: { where: string; direct: boolean } | null }[];
  /** This person's follow-ups answered in the last 24 hours, newest first, max 5. */
  answered: { id: string; title: string; answer: string; status: "answered" | "expired" | "declined" | "failed";
              subject: { name: string; assistant: DesktopAssistant }; answeredAt: string; href: string;
              /** "claude": written by the AI from the facts (the notch labels it); "template" or null: Boredroom's own words. */
              engine: "claude" | "template" | null }[];
};

const forNotch = (p: AssistantProfile): DesktopAssistant => ({ name: p.name, colour: p.colour, visor: p.visor, eyes: p.eyes, face: PALETTE[p.colour].face });
const viewNames = (v: FollowUpView, w: AssistantProfile): Names => ({
  S: v.subject.firstName, SName: v.subject.name, SA: v.subject.assistant,
  R: v.requester?.firstName ?? null, RName: v.requester?.name ?? null, RA: v.requester?.assistant ?? null, W: v.workspaceAssistant ?? w,
});

/** What the notch shows of follow-ups: asks waiting for the person's reply, and answers to their own that came in today. */
export async function followUpsForDesktop(ctx: OrgContext): Promise<DesktopFollowUps> {
  const none: DesktopFollowUps = { ready: false, waiting: [], answered: [] };
  try {
    const waiting = await waitingForMe(ctx);
    return await retryWithout0039(() => withUser(ctx.user.profileId, async (db) => {
      if (!(await schema0039Ready(db))) return none;
      const workspace = await readWorkspaceAssistant(db, ctx.org.id);
      const answered = await loadViews(db, ctx,
        `f.requester_membership_id = $2 AND f.status IN ('answered', 'expired', 'declined', 'failed') AND COALESCE(f.answered_at, f.updated_at) > now() - interval '24 hours'`,
        [ctx.membership.id], "ORDER BY COALESCE(f.answered_at, f.updated_at) DESC, f.id DESC LIMIT 5");
      const tz = ctx.org.timezone;
      return {
        ready: true,
        waiting: waiting.slice(0, 5).map((v) => ({
          id: v.id,
          title: v.thread ? `${v.requester?.firstName ?? "Someone"} asked your ${v.subject.assistant.name} in ${v.thread.direct ? "your chat" : v.thread.where}` : askTitle(viewNames(v, workspace), v.task?.title ?? null),
          question: v.question,
          taskTitle: v.task?.title ?? null, taskHref: v.task?.href ?? null,
          asker: v.requester ? { name: v.requester.name, assistant: forNotch(v.requester.assistant) } : null,
          deadlineAt: v.deadlineAt ?? v.createdAt,
          // In a thread nothing from the work is shared on the person's behalf: only their reply is posted.
          facts: v.facts && !v.thread ? factLines(v.facts, { timeZone: tz, first: v.subject.firstName, forSubject: true, asker: v.requester?.name ?? null }) : [],
          thread: v.thread ? { where: v.thread.where, direct: v.thread.direct } : null,
        })),
        answered: answered.map((v) => ({
          id: v.id, title: answerTitle(v.status, viewNames(v, workspace), v.task?.title ?? null),
          answer: v.status === "failed" ? failureWords(v.failure ?? "error", v.subject.firstName) : v.answer ?? "",
          status: v.status as "answered" | "expired" | "declined" | "failed",
          subject: { name: v.subject.name, assistant: forNotch(v.subject.assistant) },
          answeredAt: v.answeredAt ?? v.createdAt, href: v.href,
          engine: v.status === "failed" ? null : v.answerEngine,
        })),
      };
    }));
  } catch (err) {
    if (isMissingSchema(err)) return none;
    throw err;
  }
}

// ---- The worker: deadlines, retries, the workspace's collection --------------------------------------------------------

/**
 * One sweep (the worker's `followup.sweep`, at most `limit` rows): asks past their deadline are answered from the
 * person's work; 'pending' rows older than a minute and 'answering' rows nobody holds are retried; batches whose
 * follow-ups are all closed are closed. Templates only. Each row is its own short transactions. Never throws.
 */
export async function sweepFollowUps(opts: { now?: Date; limit?: number } = {}): Promise<{ expired: number; retried: number; batchesClosed: number }> {
  const now = opts.now ?? new Date();
  const limit = Math.min(100, Math.max(1, opts.limit ?? 25));
  const out = { expired: 0, retried: 0, batchesClosed: 0 };
  try {
    const rows = await withWorker(async (db) => {
      if (!(await schema0039Ready(db))) return null;
      return db.query<{ id: string; status: FollowUpStatus }>(
        `SELECT id, status FROM follow_ups
         WHERE (status = 'asking' AND deadline_at <= $1::timestamptz)
            OR (status = 'pending' AND created_at < $1::timestamptz - interval '1 minute' AND (lease_until IS NULL OR lease_until < now()))
            OR (status = 'answering' AND updated_at < $1::timestamptz - interval '1 minute' AND (lease_until IS NULL OR lease_until < now()))
         ORDER BY COALESCE(deadline_at, updated_at) LIMIT $2`, [now.toISOString(), limit]);
    });
    if (!rows) return out;
    for (const r of rows) {
      const after = await processFollowUp(r.id, { useModel: false, now }).catch((err) => { warn(`sweeping ${r.id}`)(err); return null; });
      if (r.status === "asking" && after === "expired") out.expired++;
      else if (r.status !== "asking") out.retried++;
    }
    const open = await withWorker((db) => db.query<{ id: string }>(
      `SELECT b.id FROM follow_up_batches b WHERE b.completed_at IS NULL AND NOT EXISTS (SELECT 1 FROM follow_ups f WHERE f.batch_id = b.id AND f.status IN ${OPEN_SQL})
       ORDER BY b.created_at LIMIT $1`, [limit]));
    for (const b of open) if (await closeBatch(b.id).catch(() => false)) out.batchesClosed++;
  } catch (err) {
    if (isMissingSchema(err)) forget0039();
    else warn("sweeping follow-ups")(err);
  }
  return out;
}

export const WORKSPACE_QUESTION = "What did you work on today?";

/**
 * The workspace's own collection before the end-of-day report (owner decision, 8 October 2026; the worker's
 * `followup.collect`): one batch per organisation per local day, one follow-up for each person with work today (an
 * attendance record, a day plan item, confirmed time, or a status change or comment by them today; staff and team leads,
 * not exempted today), signed by the workspace's own assistant. Only inserts: the worker processes the pending rows in
 * chunks. Checked when it runs: 0039, the organisation active, the collection and the report on, still today and before
 * the report, the assistant in the plan.
 */
export async function collectWorkspaceUpdates(p: { organisationId: string; localDate: string; reportAt: Date; now?: Date }): Promise<{ status: "created" | "exists" | "off" | "not_ready" | "stale" | "plan" | "nobody"; batchId?: string; pendingIds: string[] }> {
  const now = p.now ?? new Date();
  try {
    return await withWorker(async (db) => {
      if (!(await schema0039Ready(db))) return { status: "not_ready" as const, pendingIds: [] };
      const org = await db.maybeOne<{ status: string; timezone: string; collect: boolean; report: boolean }>(
        `SELECT o.status, o.timezone, COALESCE(b.followup_collect, false) AS collect, COALESCE(b.daily_report_enabled, true) AS report
         FROM organisations o LEFT JOIN brenda_settings b ON b.organisation_id = o.id WHERE o.id = $1`, [p.organisationId]);
      if (!org || org.status !== "active" || !org.collect || !org.report) return { status: "off" as const, pendingIds: [] };
      if (p.localDate !== todayLocal(org.timezone, now) || now.getTime() >= p.reportAt.getTime()) return { status: "stale" as const, pendingIds: [] };
      if (!(await resolveEntitlements(db, p.organisationId)).features.AI_ASSISTANT) return { status: "plan" as const, pendingIds: [] };
      const pendingOf = async (batchId: string) => (await db.query<{ id: string }>(`SELECT id FROM follow_ups WHERE batch_id = $1 AND status = 'pending' ORDER BY created_at, id`, [batchId])).map((r) => r.id);
      const existing = await db.maybeOne<{ id: string }>(`SELECT id FROM follow_up_batches WHERE organisation_id = $1 AND local_date = $2::date AND kind = 'workspace'`, [p.organisationId, p.localDate]);
      if (existing) return { status: "exists" as const, batchId: existing.id, pendingIds: await pendingOf(existing.id) };
      const midnight = localMidnight(p.localDate, org.timezone).toISOString();
      const people = await db.query<{ id: string }>(
        `SELECT m.id FROM memberships m
         WHERE m.organisation_id = $1 AND m.status = 'active' AND m.role IN ('employee', 'manager')
           AND NOT EXISTS (SELECT 1 FROM workday_exemptions e WHERE e.membership_id = m.id AND e.local_date = $2::date)
           AND (EXISTS (SELECT 1 FROM attendance_days a WHERE a.membership_id = m.id AND a.local_date = $2::date)
             OR EXISTS (SELECT 1 FROM daily_plan_items d WHERE d.membership_id = m.id AND d.local_date = $2::date)
             OR EXISTS (SELECT 1 FROM session_intervals i WHERE i.membership_id = m.id AND i.confirmation_status = 'confirmed' AND COALESCE(i.ended_at, $4::timestamptz) > $3::timestamptz)
             OR EXISTS (SELECT 1 FROM task_status_history h WHERE h.organisation_id = $1 AND h.actor_membership_id = m.id AND h.occurred_at >= $3::timestamptz)
             OR EXISTS (SELECT 1 FROM task_comments c WHERE c.organisation_id = $1 AND c.author_membership_id = m.id AND c.created_at >= $3::timestamptz))
         ORDER BY m.created_at, m.id LIMIT $5`, [p.organisationId, p.localDate, midnight, now.toISOString(), FOLLOW_UP_LIMITS.workspaceMax]);
      if (!people.length) return { status: "nobody" as const, pendingIds: [] };
      const batch = await db.maybeOne<{ id: string }>(
        `INSERT INTO follow_up_batches(organisation_id, requester_membership_id, kind, question, local_date, size) VALUES ($1, NULL, 'workspace', $2, $3::date, $4)
         ON CONFLICT (organisation_id, local_date) WHERE kind = 'workspace' DO NOTHING RETURNING id`, [p.organisationId, WORKSPACE_QUESTION, p.localDate, people.length]);
      if (!batch) {
        const again = await db.one<{ id: string }>(`SELECT id FROM follow_up_batches WHERE organisation_id = $1 AND local_date = $2::date AND kind = 'workspace'`, [p.organisationId, p.localDate]);
        return { status: "exists" as const, batchId: again.id, pendingIds: await pendingOf(again.id) };
      }
      const rows = await db.query<{ id: string }>(
        `INSERT INTO follow_ups(organisation_id, batch_id, requester_membership_id, subject_membership_id, task_id, question)
         SELECT $1, $2, NULL, s.id, NULL, $3 FROM unnest($4::uuid[]) WITH ORDINALITY AS s(id, n) ORDER BY s.n RETURNING id`,
        [p.organisationId, batch.id, WORKSPACE_QUESTION, people.map((x) => x.id)]);
      await audit(db, { organisationId: p.organisationId, action: "followup.collected", subjectType: "follow_up_batch", subjectId: batch.id, metadata: { batchId: batch.id, people: rows.length } });
      return { status: "created" as const, batchId: batch.id, pendingIds: rows.map((r) => r.id) };
    });
  } catch (err) {
    if (isMissingSchema(err)) { forget0039(); return { status: "not_ready", pendingIds: [] }; }
    throw err;
  }
}

// ---- The report's Updates section (read as the recipient) ---------------------------------------------------------------

export type WorkspaceUpdate = {
  membershipId: string; name: string; status: FollowUpStatus; answeredFrom: "facts" | "person" | "deadline" | null; answer: string | null;
  reply: { choice: ReplyChoice; note: string | null } | null; facts: FollowUpFacts | null; deadlineAt: string | null;
};

/**
 * Today's collected updates for the people in a report, as its recipient reads them (row-level security: only people
 * whose records they may view). Nothing before 0039, or when the collection is off or has not run that day.
 */
export async function workspaceUpdatesFor(ctx: OrgContext, localDate: string, membershipIds: string[]): Promise<{ collectedAt: string | null; updates: WorkspaceUpdate[] }> {
  const none = { collectedAt: null, updates: [] as WorkspaceUpdate[] };
  const ids = membershipIds.filter(isUuid);
  if (!ids.length || !/^\d{4}-\d{2}-\d{2}$/.test(localDate)) return none;
  try {
    const batch = await withUser(ctx.user.profileId, async (db) => {
      if (!(await schema0039Ready(db))) return null;
      return db.maybeOne<{ id: string; created_at: string }>(`SELECT id, created_at FROM follow_up_batches WHERE organisation_id = $1 AND kind = 'workspace' AND local_date = $2::date`, [ctx.org.id, localDate]);
    });
    if (!batch) return none;
    await settle(ctx, "f.batch_id = $2 AND f.subject_membership_id = ANY($3::uuid[])", [batch.id, ids]);
    const rows = await withUser(ctx.user.profileId, (db) => db.query<{ subject_membership_id: string; name: string; status: FollowUpStatus; answered_from: WorkspaceUpdate["answeredFrom"]; answer: string | null; reply_choice: ReplyChoice | null; reply_note: string | null; facts: unknown; deadline_at: string | null }>(
      `SELECT f.subject_membership_id, p.display_name AS name, f.status, f.answered_from, f.answer, f.reply_choice, f.reply_note, f.facts, f.deadline_at
       FROM follow_ups f JOIN memberships m ON m.id = f.subject_membership_id JOIN profiles p ON p.id = m.user_id
       WHERE f.batch_id = $1 AND f.subject_membership_id = ANY($2::uuid[]) ORDER BY p.display_name, f.id`, [batch.id, ids]));
    return {
      collectedAt: batch.created_at,
      updates: rows.map((r) => ({
        membershipId: r.subject_membership_id, name: r.name, status: r.status, answeredFrom: r.answered_from, answer: r.answer,
        reply: r.reply_choice && (r.status === "answered" || r.status === "declined") ? { choice: r.reply_choice, note: r.reply_note } : null,
        facts: factsOrNull(r.facts), deadlineAt: r.deadline_at,
      })),
    };
  } catch (err) {
    if (isMissingSchema(err)) { forget0039(); return none; }
    throw err;
  }
}
