/**
 * The morning opener (owner decision, 8 October 2026: phase 7a, "Brenda keeps the loops closed"). On the person's first
 * visit of the day, her page and the notch open with what is waiting (requests, overdue tasks, answers to their
 * follow-ups, messages from other assistants, reviews for leads) and three to six one-tap actions fitted to those counts,
 * instead of the generic suggestion chips; a quiet day gets a short calm line. Built from data the person can already
 * read, with no model call (services/opener.ts reads it; this file is what the page, the notch and the tests share).
 *
 * A figure that could not be read is "not available", never 0. Link actions open the page; ask actions fill the box and
 * never send (owner decision, 5 October 2026).
 *
 * Phase 7c (owner decisions, 8–9 October 2026: the abilities catalogue): the opener itself can be switched off (the
 * server then answers no opener and the page shows its usual chips), and an action whose ability is switched off for
 * the person is left out ("What did I miss?" needs catch-up; `OPENER_ACTION_ABILITY`).
 *
 * Client-safe: imports only types (lib/abilities).
 */
import type { AbilityKey } from "@/lib/abilities";

export type OpenerCountKey = "requests" | "overdue" | "answers" | "items" | "reviews";
export type OpenerCount = { key: OpenerCountKey; value: number | null; /** "2 requests waiting" | "Overdue tasks: not available" */ label: string; href: string };
export type OpenerIcon = "inbox" | "alert" | "reply" | "message" | "clipboard" | "list" | "users" | "calendar";
export type OpenerAction = { id: string; kind: "link" | "ask"; label: string; href?: string; prompt?: string; icon: OpenerIcon };
export type Opener = { v: 1; localDate: string; counts: OpenerCount[]; actions: OpenerAction[]; calm: string | null; firstVisit: boolean | null };
export type OpenerRole = "owner" | "hr" | "manager" | "employee";

export const OPENER_WORDS = {
  heading: "Here's where things stand",
  calm: "Nothing is waiting on you. A good day to get ahead.",
  notAvailable: "not available",
} as const;

/** The order the counts (and their actions) come in. */
export const OPENER_ORDER: readonly OpenerCountKey[] = ["requests", "overdue", "reviews", "answers", "items"];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const base = (slug: string) => `/app/${slug}`;

const COUNT: Record<OpenerCountKey, { label: (n: number) => string; missing: string; path: string }> = {
  requests: { label: (n) => `${plural(n, "request")} waiting`, missing: "Requests", path: "/home/assistants" },
  overdue: { label: (n) => plural(n, "overdue task"), missing: "Overdue tasks", path: "/tasks?status=open" },
  reviews: { label: (n) => `${plural(n, "review")} waiting`, missing: "Reviews", path: "/reviews" },
  answers: { label: (n) => `${plural(n, "answer")} to your follow-ups`, missing: "Answers to your follow-ups", path: "/home/assistants/sent" },
  items: { label: (n) => `${plural(n, "message")} from assistants`, missing: "Messages from assistants", path: "/home/assistants" },
};

/** One count with its words and its page; `null` reads "{Thing}: not available". */
export function openerCount(key: OpenerCountKey, value: number | null, slug: string): OpenerCount {
  const c = COUNT[key];
  const v = value === null || !Number.isFinite(value) ? null : Math.max(0, Math.round(value));
  return { key, value: v, label: v === null ? `${c.missing}: ${OPENER_WORDS.notAvailable}` : c.label(v), href: `${base(slug)}${c.path}` };
}

/** The calm line when every count that could be read is 0 (and at least one could); null otherwise. */
export function openerCalm(counts: OpenerCount[]): string | null {
  const known = counts.filter((c) => c.value !== null);
  return known.length && known.every((c) => c.value === 0) ? OPENER_WORDS.calm : null;
}

type Default = Omit<OpenerAction, "kind"> & { kind: "ask" };
const ASK = {
  planDay: { id: "plan_day", kind: "ask", label: "Plan my day", prompt: "Arrange my tasks for today in the order I should do them, and tell me why.", icon: "list" },
  missed: { id: "missed", kind: "ask", label: "What did I miss?", prompt: "What did I miss in Messages? Catch me up.", icon: "inbox" },
  dueToday: { id: "due_today", kind: "ask", label: "What's due today?", prompt: "What's waiting for me today?", icon: "calendar" },
  whoWorking: { id: "who_working", kind: "ask", label: "Who's working?", prompt: "Who is working right now, and on what?", icon: "users" },
  weekSummary: { id: "week_summary", kind: "ask", label: "Week summary", prompt: "Summarise what the team got done this week.", icon: "clipboard" },
} as const satisfies Record<string, Default>;

/** Staff get their own day; team leads, the owner and HR the team's (contract E.1). */
export const OPENER_DEFAULTS: Record<OpenerRole, readonly Default[]> = {
  employee: [ASK.planDay, ASK.missed, ASK.dueToday],
  manager: [ASK.whoWorking, ASK.missed, ASK.weekSummary],
  owner: [ASK.whoWorking, ASK.missed, ASK.weekSummary],
  hr: [ASK.whoWorking, ASK.missed, ASK.weekSummary],
};

/** The ability a default action needs (phase 7c): an action whose ability is off for the person is left out. */
export const OPENER_ACTION_ABILITY: Readonly<Record<string, AbilityKey>> = { missed: "catch_up" };

export const OPENER_MIN_ACTIONS = 3;
export const OPENER_MAX_ACTIONS = 6;

/**
 * The opener's one-tap actions, 3 to 6: first one per count above 0 (requests, overdue, reviews, answers, messages from
 * assistants, in that order), then the role's defaults until there are 3. `off` (phase 7c): the abilities switched off
 * for the person; a default that needs one is left out (so there may be two). Pure (tests/unit/opener-actions.test.ts).
 */
export function openerActions(counts: OpenerCount[], role: OpenerRole, slug: string, opts: { off?: readonly AbilityKey[] } = {}): OpenerAction[] {
  const off = new Set(opts.off ?? []);
  const n = (key: OpenerCountKey) => counts.find((c) => c.key === key)?.value ?? 0;
  const out: OpenerAction[] = [];
  const href = (path: string) => `${base(slug)}${path}`;
  for (const key of OPENER_ORDER) {
    const v = n(key);
    if (!(v > 0)) continue;
    switch (key) {
      case "requests": out.push({ id: "requests", kind: "link", label: `Answer ${plural(v, "request")}`, href: href(COUNT.requests.path), icon: "inbox" }); break;
      case "overdue": out.push({ id: "overdue", kind: "ask", label: `Plan my ${plural(v, "overdue task")}`, prompt: "Look at my overdue tasks and help me follow up on each one.", icon: "alert" }); break;
      case "reviews": out.push({ id: "reviews", kind: "link", label: `Review ${plural(v, "item")}`, href: href(COUNT.reviews.path), icon: "clipboard" }); break;
      case "answers": out.push({ id: "answers", kind: "link", label: `Read ${plural(v, "answer")}`, href: href(COUNT.answers.path), icon: "reply" }); break;
      case "items": out.push({ id: "items", kind: "link", label: `See ${plural(v, "message")} from assistants`, href: href(COUNT.items.path), icon: "message" }); break;
    }
  }
  for (const d of OPENER_DEFAULTS[role] ?? OPENER_DEFAULTS.employee) {
    if (out.length >= OPENER_MIN_ACTIONS) break;
    const needs = OPENER_ACTION_ABILITY[d.id];
    if (needs && off.has(needs)) continue;
    if (!out.some((a) => a.id === d.id)) out.push({ ...d });
  }
  return out.slice(0, OPENER_MAX_ACTIONS);
}
