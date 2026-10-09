/**
 * Following a commitment through (owner decisions, 8 October 2026: phase 7b, "Brenda keeps the loops closed", second
 * part; contract C.4). Once someone accepted a commitment noted in a group chat:
 * 1. on its due date, their own assistant reminds them privately (two hours before a due time from 11:00 on, else 09:00
 *    that day, in their own time zone), never during their quiet hours (the next sweep after they end sends it), never
 *    to anyone else;
 * 2. two working days after it was due with no progress (the owner's stalled rule, routine-templates' `stalledSince`:
 *    nothing on its to-do since it was due, or no to-do at all), the person who asked is told privately (respecting their
 *    quiet hours the same way), once;
 * 3. when the workspace keeps "Post gentle follow-ups in the thread" on (off by default), the workspace's own assistant
 *    also posts one short fixed line in the thread where it was said ("A gentle nudge on this: is it still on its way?"),
 *    inside the organisation's working hours, once, while the conversation is still tracked and the committer still
 *    reads it. The note is a 'workspace' message (author kind, migration 0048), written only here, by the worker.
 *
 * Everything runs as the worker, one guarded UPDATE per step (`… AND due_reminded_at IS NULL RETURNING id`): a row
 * someone else moved is left alone, so a sweep is safe to run any number of times. Never throws; nothing before 0048. No
 * model: every word is LOOP_WORDS'.
 */
import { withWorker, type Db } from "@/server/db";
import { forget0048, isMissingSchema, schema0048Ready } from "@/server/lib/schema-0048";
import { addDays, localDate, localMidnight, localParts, localTimeOn, weekdayOf } from "@/server/lib/time";
import { personTimeZone } from "@/server/lib/routine-time";
import { personalTable } from "@/server/lib/schema-0047";
import type { WorkingSchedule } from "@/server/lib/working-time";
import { notify } from "@/server/services/common";
import { orgClock } from "@/server/services/follow-up-facts";
import { stalledSince } from "@/server/services/routine-templates";
import { firstName } from "@/lib/follow-ups";
import { LOOP_WORDS, commitmentHref, loopDueLabel, loopTitle } from "@/lib/commitments";
import type { QuietState } from "@/lib/routines";

const warn = (what: string) => (err: unknown) => console.warn(`[commitments] ${what}: ${(err as Error)?.message ?? String(err)}`);
const SWEEP_LIMIT = 50;
/**
 * Pages read in one run past rows that cannot be marked yet (progress since their due date, a committer who left the
 * conversation, a withdrawn message): without paging, 50 such rows anywhere kept every newer one from being looked at
 * (correctness review, 9 October 2026).
 */
const MAX_PAGES = 10;

// ---- Pure decisions (unit-tested) ---------------------------------------------------------------------------------------

/**
 * When the committer is reminded, on the due date in their zone: two hours before the due time when it is 11:00 or
 * later there, else 09:00 that day (a due time before 09:00 is reminded at it, never after it).
 */
export function dueReminderAt(dueAt: string, o: { timeZone: string }): Date {
  const due = new Date(dueAt);
  const p = localParts(due, o.timeZone);
  if (p.hour >= 11) return new Date(due.getTime() - 2 * 3_600_000);
  const nine = localTimeOn(localDate(due, o.timeZone), "09:00", o.timeZone);
  return nine.getTime() <= due.getTime() ? nine : due;
}

/**
 * Whether a due reminder goes now: `send` (its time has come, the person is not in quiet hours, and it is still the due
 * day in their zone), `quiet` (it waits until quiet hours end), `wait` (not yet), or `late` (the due day is over in their
 * zone: it is marked and nothing is sent; the stalled note covers what is late).
 */
export function reminderDecision(o: { now: Date; dueAt: string; timeZone: string; quiet: Pick<QuietState, "active"> }): "send" | "quiet" | "wait" | "late" {
  const at = dueReminderAt(o.dueAt, { timeZone: o.timeZone });
  if (o.now.getTime() < at.getTime()) return "wait";
  const dayEnd = localMidnight(addDays(localDate(new Date(o.dueAt), o.timeZone), 1), o.timeZone);
  if (o.now.getTime() >= dayEnd.getTime()) return "late";
  return o.quiet.active ? "quiet" : "send";
}

/** Whether `now` is inside one of the organisation's working windows (a thread follow-up is posted only then). */
export function inWorkingHours(now: Date, s: WorkingSchedule): boolean {
  const today = localDate(now, s.timezone);
  if (!s.workingDays.includes(weekdayOf(today))) return false;
  const start = localTimeOn(today, s.start, s.timezone).getTime();
  const end = localTimeOn(today, s.end, s.timezone).getTime();
  return now.getTime() >= start && now.getTime() < end;
}

/** Whether a stalled commitment is noted now: past the stalled rule and, with someone to tell, not in their quiet hours. */
export function stalledDecision(o: { now: Date; dueAt: string; since: Date; progress: boolean; asker: boolean; quiet: Pick<QuietState, "active"> }): "note" | "quiet" | "wait" {
  if (o.progress || Date.parse(o.dueAt) > o.since.getTime()) return "wait";
  return o.asker && o.quiet.active ? "quiet" : "note";
}

// ---- The sweep (worker) --------------------------------------------------------------------------------------------------

type Row = {
  id: string; organisation_id: string; slug: string; org_tz: string; conversation_id: string; source_message_id: string; agreement_message_id: string | null;
  committer_membership_id: string; asker_membership_id: string | null; title: string; due_at: string; todo_task_id: string | null;
  committer_name: string; asker_name: string | null; own_tz: string | null; due_reminded_at: string | null; stalled_noted_at: string | null;
  thread_followup_message_id: string | null;
};

const ROW_SQL = (personal: string) => `
  SELECT k.id, k.organisation_id, o.slug, o.timezone AS org_tz, k.conversation_id, k.source_message_id, k.agreement_message_id,
         k.committer_membership_id, k.asker_membership_id, k.title, k.due_at, k.todo_task_id, k.due_reminded_at, k.stalled_noted_at,
         k.thread_followup_message_id, pc.display_name AS committer_name, pa.display_name AS asker_name, own.timezone AS own_tz
  FROM commitments k JOIN organisations o ON o.id = k.organisation_id AND o.status = 'active'
  JOIN memberships mc ON mc.id = k.committer_membership_id JOIN profiles pc ON pc.id = mc.user_id
  LEFT JOIN memberships ma ON ma.id = k.asker_membership_id LEFT JOIN profiles pa ON pa.id = ma.user_id
  LEFT JOIN ${personal} own ON own.membership_id = k.committer_membership_id`;

/** Whether a person is in quiet hours now (routines.ts, loaded when needed: never quiet before 0046 or on a failure). */
async function quietNow(db: Db, membershipId: string, now: Date): Promise<Pick<QuietState, "active">> {
  try {
    const { quietStateFor } = await import("@/server/services/routines");
    return await quietStateFor(db, membershipId, now);
  } catch (err) { warn("reading quiet hours")(err); return { active: false }; }
}

/**
 * Any progress on the commitment's to-do since it was due: a status change (not the to-do being made: a commitment
 * accepted after its date has a fresh to-do), a comment, a submission, confirmed time.
 */
async function progressSince(db: Db, taskId: string, since: string): Promise<boolean> {
  const r = await db.maybeOne(
    `SELECT 1 WHERE EXISTS (SELECT 1 FROM task_status_history h WHERE h.task_id = $1 AND h.from_status IS NOT NULL AND h.occurred_at > $2::timestamptz)
        OR EXISTS (SELECT 1 FROM task_comments c WHERE c.task_id = $1 AND c.created_at > $2::timestamptz)
        OR EXISTS (SELECT 1 FROM task_submissions s WHERE s.task_id = $1 AND s.submitted_at > $2::timestamptz)
        OR EXISTS (SELECT 1 FROM session_intervals i WHERE i.task_id = $1 AND i.confirmation_status = 'confirmed' AND COALESCE(i.ended_at, now()) > $2::timestamptz)`,
    [taskId, since]);
  return !!r;
}

/**
 * One pass of the follow-through: due reminders, stalled notes, thread follow-ups, at most `limit` rows each (50).
 * Never throws; nothing before 0048.
 */
export async function runCommitmentFollowThrough(o: { now?: Date; limit?: number } = {}): Promise<{ reminded: number; stalledNoted: number; threadPosts: number }> {
  const now = o.now ?? new Date();
  const limit = Math.max(1, Math.min(200, Math.floor(o.limit ?? SWEEP_LIMIT)));
  const out = { reminded: 0, stalledNoted: 0, threadPosts: 0 };
  try {
    await withWorker(async (db) => {
      if (!(await schema0048Ready(db))) return;
      const personal = await personalTable(db);
      const at = now.toISOString();

      // 1. Due reminders: open, due within a day either side, not yet reminded.
      const due = await db.query<Row>(
        `${ROW_SQL(personal)}
         WHERE k.status = 'open' AND k.due_at IS NOT NULL AND k.due_reminded_at IS NULL
           AND k.due_at > $1::timestamptz - interval '2 days' AND k.due_at < $1::timestamptz + interval '1 day'
         ORDER BY k.due_at LIMIT $2`, [at, limit]);
      for (const r of due) {
        const tz = personTimeZone(r.own_tz, r.org_tz);
        const quiet = await quietNow(db, r.committer_membership_id, now);
        const d = reminderDecision({ now, dueAt: r.due_at, timeZone: tz, quiet });
        if (d === "wait" || d === "quiet") continue;
        const moved = await db.maybeOne(`UPDATE commitments SET due_reminded_at = $2 WHERE id = $1 AND status = 'open' AND due_reminded_at IS NULL RETURNING id`, [r.id, at]);
        if (!moved || d === "late") continue;
        await notify(db, {
          organisationId: r.organisation_id, recipientMembershipId: r.committer_membership_id, type: "brenda.commitment_due",
          title: LOOP_WORDS.notifications.due(loopTitle(r.title)), body: LOOP_WORDS.notifications.dueBody(r.asker_name ? firstName(r.asker_name) : null),
          resourceType: "commitment", resourceId: r.id, href: commitmentHref(r.slug, r.id), dedupKey: `commitment.due:${r.id}`,
        });
        out.reminded++;
      }

      // 2. Stalled notes: open, due at least a day ago (two working days is never less), not yet noted. Paged (keyset on
      // the due time and id) past the rows left as they are, at most MAX_PAGES pages a run.
      const clocks = new Map<string, Awaited<ReturnType<typeof orgClock>>>();
      let after: { due: string; id: string } | null = null;
      for (let page = 0; page < MAX_PAGES && out.stalledNoted < limit; page++) {
      const late: Row[] = await db.query<Row>(
        `${ROW_SQL(personal)}
         WHERE k.status = 'open' AND k.due_at IS NOT NULL AND k.stalled_noted_at IS NULL AND k.due_at < $1::timestamptz - interval '1 day'
           ${after ? "AND (k.due_at, k.id) > ($3::timestamptz, $4::uuid)" : ""}
         ORDER BY k.due_at, k.id LIMIT $2`, after ? [at, limit, after.due, after.id] : [at, limit]);
      if (!late.length) break;
      const lastRow: Row = late[late.length - 1];
      after = { due: new Date(lastRow.due_at).toISOString(), id: lastRow.id };
      for (const r of late) {
        let clock = clocks.get(r.organisation_id);
        if (!clock) { clock = await orgClock(db, r.organisation_id, now); clocks.set(r.organisation_id, clock); }
        const since = stalledSince(now, clock.schedule);
        if (Date.parse(r.due_at) > since.getTime()) continue;
        const progress = r.todo_task_id ? await progressSince(db, r.todo_task_id, new Date(r.due_at).toISOString()) : false;
        const quiet = r.asker_membership_id ? await quietNow(db, r.asker_membership_id, now) : { active: false };
        if (stalledDecision({ now, dueAt: r.due_at, since, progress, asker: !!r.asker_membership_id, quiet }) !== "note") continue;
        const moved = await db.maybeOne(`UPDATE commitments SET stalled_noted_at = $2 WHERE id = $1 AND status = 'open' AND stalled_noted_at IS NULL RETURNING id`, [r.id, at]);
        if (!moved) continue;
        out.stalledNoted++;
        if (r.asker_membership_id) {
          await notify(db, {
            organisationId: r.organisation_id, recipientMembershipId: r.asker_membership_id, type: "brenda.commitment_stalled",
            title: LOOP_WORDS.notifications.stalled(loopTitle(r.title)), body: LOOP_WORDS.notifications.stalledBody(firstName(r.committer_name)),
            resourceType: "commitment", resourceId: r.id, href: commitmentHref(r.slug, r.id), dedupKey: `commitment.stalled:${r.id}`,
          });
        }
      }
      if (late.length < limit) break;
      }
    });
  } catch (err) {
    if (isMissingSchema(err)) forget0048();
    else warn("following commitments through")(err);
  }
  out.threadPosts = await threadFollowUps(now, limit).catch((err) => { warn("posting thread follow-ups")(err); return 0; });
  return out;
}

/**
 * 3. Gentle follow-ups in the thread (the workspace setting, off by default), each in its own transaction with the row
 * that records it: once a commitment is noted as stalled, while it is open, the switches are on, the conversation is
 * tracked and not archived, its message is still there, the committer still reads it, inside working hours.
 */
async function threadFollowUps(now: Date, limit: number): Promise<number> {
  let posted = 0;
  const clocks = new Map<string, WorkingSchedule>();
  // Paged past the rows that cannot be posted now (outside working hours, the committer left, the message withdrawn).
  let after: { at: string; id: string } | null = null;
  for (let page = 0; page < MAX_PAGES && posted < limit; page++) {
  const cursor = after;
  const due: Row[] = await withWorker(async (db) => {
    if (!(await schema0048Ready(db))) return [] as Row[];
    return db.query<Row>(
      `${ROW_SQL(await personalTable(db))}
       JOIN brenda_settings b ON b.organisation_id = k.organisation_id AND b.track_commitments AND b.commitment_thread_followups
       JOIN conversations c ON c.id = k.conversation_id AND c.track_commitments AND c.archived_at IS NULL AND c.kind IN ('team', 'organisation', 'channel')
       WHERE k.status = 'open' AND k.stalled_noted_at IS NOT NULL AND k.thread_followup_message_id IS NULL
         ${cursor ? "AND (k.stalled_noted_at, k.id) > ($2::timestamptz, $3::uuid)" : ""}
       ORDER BY k.stalled_noted_at, k.id LIMIT $1`, cursor ? [limit, cursor.at, cursor.id] : [limit]);
  });
  if (!due.length) break;
  const lastRow: Row = due[due.length - 1];
  after = { at: new Date(lastRow.stalled_noted_at as string).toISOString(), id: lastRow.id };
  for (const r of due) {
    const ok = await withWorker(async (db) => {
      let schedule = clocks.get(r.organisation_id);
      if (!schedule) { schedule = (await orgClock(db, r.organisation_id, now)).schedule; clocks.set(r.organisation_id, schedule); }
      if (!inWorkingHours(now, schedule)) return false;
      // Claimed first, under its lock: two sweeps never post twice.
      const row = await db.maybeOne<{ id: string }>(
        `SELECT id FROM commitments WHERE id = $1 AND status = 'open' AND thread_followup_message_id IS NULL FOR UPDATE SKIP LOCKED`, [r.id]);
      if (!row) return false;
      const replyTo = r.agreement_message_id ?? r.source_message_id;
      const can = await db.maybeOne<{ ok: boolean }>(
        `SELECT app_conversation_has_reader($2, $1) AND EXISTS (SELECT 1 FROM messages m WHERE m.id = $3 AND m.conversation_id = $2 AND m.deleted_at IS NULL) AS ok`,
        [r.committer_membership_id, r.conversation_id, replyTo]);
      if (!can?.ok) return false;
      const body = LOOP_WORDS.thread.followUp(loopDueLabel(r.due_at, r.org_tz));
      const msg = await db.one<{ id: string }>(
        `INSERT INTO messages(organisation_id, conversation_id, sender_membership_id, body, reply_to_id, author_kind)
         VALUES ($1, $2, $3, $4, $5, 'workspace') RETURNING id`, [r.organisation_id, r.conversation_id, r.committer_membership_id, body, replyTo]);
      const set = await db.maybeOne(`UPDATE commitments SET thread_followup_message_id = $2 WHERE id = $1 AND status = 'open' AND thread_followup_message_id IS NULL RETURNING id`, [r.id, msg.id]);
      if (!set) throw new Error("the commitment moved while its follow-up was posted");
      return true;
    }).catch((err) => { warn(`posting the follow-up for ${r.id}`)(err); return false; });
    if (ok) posted++;
  }
  if (due.length < limit) break;
  }
  return posted;
}

/**
 * Whether a due reminder may be waiting now (the scheduler queues commitments.sweep on a 15-minute bucket when so): an
 * open commitment not yet reminded whose due time is at most two hours away, or passed within two days. Stalled notes and
 * thread follow-ups need no more than the hourly sweep (the stalled rule counts working days).
 */
export async function followThroughDue(o: { now?: Date } = {}): Promise<boolean> {
  const now = (o.now ?? new Date()).toISOString();
  try {
    return await withWorker(async (db) => {
      if (!(await schema0048Ready(db))) return false;
      const r = await db.maybeOne(
        `SELECT 1 FROM commitments k
         WHERE k.status = 'open' AND k.due_at IS NOT NULL AND k.due_reminded_at IS NULL
           AND k.due_at <= $1::timestamptz + interval '2 hours' AND k.due_at > $1::timestamptz - interval '2 days'
         LIMIT 1`, [now]);
      return !!r;
    });
  } catch (err) {
    if (isMissingSchema(err)) { forget0048(); return false; }
    throw err;
  }
}
