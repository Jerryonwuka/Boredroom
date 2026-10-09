/**
 * The morning opener (owner decision, 8 October 2026: phase 7a, "Brenda keeps the loops closed"). On the person's first
 * visit of the day her page and the notch open with what is waiting on them and three to six one-tap actions fitted to
 * it; the morning brief routine (routine-templates.ts) delivers the same content at the time the person chose.
 *
 * Everything is read as the person through the services their own pages use (briefing, the assistant inbox, their
 * follow-ups, the review queue), in parallel, and no model is called. A read that fails gives that count `null` ("not
 * available"), never 0; a feature that is not there (before migration 0039 or 0043, a role without reviews or tasks)
 * leaves its count out. Never throws: the notch calls it on every poll and the home page on the first visit of the day.
 *
 * Phase 7c (owner decisions, 8–9 October 2026: the abilities catalogue): an action whose ability is switched off for the
 * person is left out ("What did I miss?" without catch-up), and `openerFor` answers null when the morning opener itself
 * is switched off (the route, the notch and the home page then show no opener). The morning brief routine reads the
 * same content through `morningOpener`; it is unavailable while the opener is off (services/routines).
 */
import type { OrgContext } from "@/server/lib/api";
import { localDate } from "@/server/lib/time";
import { briefing } from "@/server/services/brenda";
import { reviewQueue } from "@/server/services/views";
import { listMyFollowUps, waitingForMe } from "@/server/services/follow-ups";
import { OPENER_ORDER, openerActions as openerActionsFor, openerCalm, openerCount, type Opener, type OpenerAction, type OpenerCount, type OpenerCountKey } from "@/lib/opener";
import type { FollowUpStatus } from "@/lib/follow-ups";
import { abilitiesFor } from "@/server/services/abilities";
import { abilitiesOff, abilityOff, type AbilityKey } from "@/lib/abilities";

type Briefing = Awaited<ReturnType<typeof briefing>>;

export type OpenerTask = { id: string; title: string; due: string | null };
/** A request to accept, brought by someone's assistant (assistant_items). */
export type OpenerRequest = { id: string; from: string; fromFirst: string; assistant: string; summary: string };
/** A follow-up ask waiting for the person's reply; `from` null: the workspace's own collection for the team report. */
export type OpenerAsk = { id: string; from: string | null; fromFirst: string | null; assistant: string; question: string; taskId: string | null; taskTitle: string | null };
/** One of the person's follow-ups that was answered (or closed with an answer) since `since`. */
export type OpenerAnswer = { id: string; subject: string; subjectFirst: string; assistant: string; taskId: string | null; taskTitle: string | null; status: FollowUpStatus; answeredAt: string | null };
/** A message or reply from someone's assistant not marked as seen. `body` is their words. */
export type OpenerItem = { id: string; kind: "message" | "reply"; from: string; fromFirst: string; assistant: string; body: string | null };
export type OpenerSubmission = { taskId: string; submissionId: string | null; title: string; from: string; submittedAt: string };
export type OpenerCorrection = { id: string; from: string; taskTitle: string };

/**
 * The lists behind each count, with their ids (the morning brief routine builds its sections from these). A key that is
 * absent: left out (the feature is not there, or the role has none); null: the read failed; []: nothing.
 */
export type OpenerDetail = {
  overdue?: OpenerTask[] | null; dueToday?: OpenerTask[] | null;
  requests?: OpenerRequest[] | null; asks?: OpenerAsk[] | null;
  answers?: OpenerAnswer[] | null; items?: OpenerItem[] | null;
  submissions?: OpenerSubmission[] | null; corrections?: OpenerCorrection[] | null;
};

const DAY = 86_400_000;

/** The previous opener (or run) when given and valid, else 24 hours ago; never more than 7 days back, never ahead. */
export function openerSince(since: string | null | undefined, now: Date): Date {
  const t = since ? Date.parse(since) : Number.NaN;
  const at = Number.isFinite(t) ? t : now.getTime() - DAY;
  return new Date(Math.min(now.getTime(), Math.max(at, now.getTime() - 7 * DAY)));
}

type Settled<T> = { ok: true; v: T } | { ok: false };
const settle = <T>(what: string, p: Promise<T>): Promise<Settled<T>> =>
  p.then((v) => ({ ok: true as const, v }), (err: unknown) => {
    console.warn(`[assistant] opener: ${what} unavailable: ${(err as Error)?.message ?? err}`);
    return { ok: false as const };
  });

/** One count from its lists: left out when every list is absent, null when any failed, else their total. */
function countOf(...lists: (unknown[] | null | undefined)[]): number | null | undefined {
  if (lists.every((l) => l === undefined)) return undefined;
  if (lists.some((l) => l === null)) return null;
  return lists.reduce<number>((n, l) => n + (l?.length ?? 0), 0);
}

/** The opener's actions for these counts (pure; lib/opener); `off`: the abilities switched off for the person (phase 7c). */
export function openerActions(counts: OpenerCount[], role: OrgContext["membership"]["role"], slug: string, off: readonly AbilityKey[] = []): OpenerAction[] {
  return openerActionsFor(counts, role, slug, { off });
}

/**
 * Whether the person has the morning opener (phase 7c): false when it is switched off for them, by the workspace or by
 * themself. Never throws (a failed read: on).
 */
export async function openerOn(ctx: OrgContext): Promise<boolean> {
  return abilityOff(await abilitiesFor(ctx), "morning_opener") === null;
}

/**
 * The morning opener as the route, the notch and the home page show it: null when it is switched off for the person
 * (phase 7c); else `morningOpener`'s, without the lists behind the counts.
 */
export async function openerFor(ctx: OrgContext, o: Parameters<typeof morningOpener>[1] = {}): Promise<Opener | null> {
  if (!(await openerOn(ctx))) return null;
  const full = await morningOpener(ctx, o);
  return Object.fromEntries(Object.entries(full).filter(([k]) => k !== "detail")) as Opener;
}

export async function morningOpener(
  ctx: OrgContext,
  o: { since?: string | null; now?: Date; briefing?: Briefing; firstVisit?: boolean | null; timeZone?: string | null } = {},
): Promise<Opener & { detail: OpenerDetail }> {
  const now = o.now ?? new Date();
  const role = ctx.membership.role;
  const worker = role === "employee" || role === "manager";
  const since = openerSince(o.since, now).getTime();
  const items = await import("@/server/services/assistant-items").catch(() => null);
  const off = abilitiesOff(await abilitiesFor(ctx));
  const [brief, waiting, asks, mine, queue] = await Promise.all([
    o.briefing ? Promise.resolve({ ok: true as const, v: o.briefing }) : settle("the briefing", briefing(ctx)),
    items ? settle("the assistant inbox", items.listAssistantItems(ctx, { box: "waiting", limit: 50 })) : Promise.resolve({ ok: false as const }),
    settle("follow-ups waiting for a reply", waitingForMe(ctx)),
    settle("the person's follow-ups", listMyFollowUps(ctx, { status: "all", limit: 20 })),
    role === "manager" ? settle("the review queue", reviewQueue(ctx)) : Promise.resolve(null),
  ]);

  const detail: OpenerDetail = {};
  if (worker) {
    const task = (t: Briefing["overdue"][number]): OpenerTask => ({ id: t.id, title: t.title, due: t.due });
    detail.overdue = brief.ok ? brief.v.overdue.map(task) : null;
    detail.dueToday = brief.ok ? brief.v.dueToday.map(task) : null;
  }
  // Requests to accept and messages from other assistants (migration 0043); absent before it.
  if (!waiting.ok) { detail.requests = null; detail.items = null; }
  else if (waiting.v.ready) {
    const theirs = waiting.v.items.filter((v) => v.viewer === "recipient");
    detail.requests = theirs.filter((v) => v.kind === "request").map((v) => ({ id: v.id, from: v.sender.name, fromFirst: v.sender.firstName, assistant: v.sender.assistant.name, summary: v.request?.summary ?? "a change" }));
    detail.items = theirs.filter((v): v is typeof v & { kind: "message" | "reply" } => v.kind === "message" || v.kind === "reply")
      .map((v) => ({ id: v.id, kind: v.kind, from: v.sender.name, fromFirst: v.sender.firstName, assistant: v.sender.assistant.name, body: v.body }));
  }
  // Follow-ups (migration 0039): what waits for the person's reply, and answers to their own since the last opener.
  const followUpsAbsent = mine.ok && !mine.v.ready;
  if (!followUpsAbsent) {
    detail.asks = asks.ok ? asks.v.map((v) => ({
      id: v.id, from: v.requester?.name ?? null, fromFirst: v.requester?.firstName ?? null,
      assistant: v.requester?.assistant.name ?? v.workspaceAssistant?.name ?? "Brenda", question: v.question, taskId: v.task?.id ?? null, taskTitle: v.task?.title ?? null,
    })) : null;
    detail.answers = mine.ok ? mine.v.batches.flatMap((b) => b.items)
      .filter((v) => (v.status === "answered" || v.status === "expired" || v.status === "declined") && Date.parse(v.answeredAt ?? "") >= since)
      .map((v) => ({ id: v.id, subject: v.subject.name, subjectFirst: v.subject.firstName, assistant: v.subject.assistant.name, taskId: v.task?.id ?? null, taskTitle: v.task?.title ?? null, status: v.status, answeredAt: v.answeredAt }))
      : null;
  }
  // Reviews: a team lead's submissions to decide and time corrections; the owner and HR only what names them reviewer.
  if (role === "manager") {
    detail.submissions = queue?.ok ? queue.v.submissions.map((s) => ({ taskId: s.task_id, submissionId: s.submission_id, title: s.title, from: s.assignee_name, submittedAt: s.submitted_at })) : null;
    detail.corrections = queue?.ok ? queue.v.adjustments.map((a) => ({ id: a.id, from: a.display_name, taskTitle: a.task_title })) : null;
  } else if (role === "owner" || role === "hr") {
    detail.submissions = brief.ok
      ? brief.v.waitingForYourReview.filter((s) => s.youAreTheReviewer).map((s) => ({ taskId: s.taskId, submissionId: null, title: s.title, from: s.from, submittedAt: s.submittedAt }))
      : null;
  }

  const values: Record<OpenerCountKey, number | null | undefined> = {
    requests: countOf(detail.requests, detail.asks),
    overdue: countOf(detail.overdue),
    reviews: countOf(detail.submissions, detail.corrections),
    answers: countOf(detail.answers),
    items: countOf(detail.items),
  };
  const counts = OPENER_ORDER.filter((k) => values[k] !== undefined).map((k) => openerCount(k, values[k] ?? null, ctx.org.slug));
  return {
    // The person's own day when the caller knows their zone (routines and "seen today" use it), else the workspace's.
    v: 1, localDate: localDate(now, o.timeZone || ctx.org.timezone), counts, actions: openerActionsFor(counts, role, ctx.org.slug, { off }), calm: openerCalm(counts),
    firstVisit: o.firstVisit ?? null, detail,
  };
}
