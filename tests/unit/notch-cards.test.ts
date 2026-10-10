// The notch's notification cards (owner decision, 9 October 2026: notch notifications, "A plus the grafts"). Loads
// desktop/src/notify-cards.js as Node sees it (module.exports) and checks the contract's promises: every type's template,
// family, group and word; every template drawn with its facts, without them and without the state it reads, never
// throwing and never empty; headlines the cards write in 30 characters or fewer, even for 200-character names; other
// people's words escaped and only Boredroom paths in data-href; one main action and at most one orange button per card;
// the summary, its wash, the pager's footer, the bar and the hold time's words.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

type Assistant = { name: string; colour: string; visor: string; eyes: string; face: { hi: string; mid: string; edge: string } };
type FaceOptions = { who?: Assistant; mood?: string; small?: boolean; cls?: string; look?: [number, number]; label?: string };
type Env = {
  esc: (s: unknown) => string; face: (o?: FaceOptions) => string; me: Assistant; ws: Assistant; assistantOf: (p: unknown) => Assistant;
  firstName: (s: unknown) => string; displayName: string; workspaceName: string; now: number; boredroomPath: (h: unknown) => string | null;
  state: Record<string, unknown>; busy: boolean; canStart: boolean; unreadTotal?: number;
};
type Info = { template: string; family: string; group: string; waits: boolean; word?: string; words?: number };
type Sender = { key: string; label: string; who: Assistant | null; mood: string };
type Notice = Info & { id: string; type: string; word: string; at: number; sender: Sender; line: string; facts: unknown };
type Card = Record<string, unknown> & { kind: string };
type BarParts = { lead: string; text: string; trail: string; wide: boolean };
type NotifyCardsApi = {
  classify: (type: string, facts: unknown) => Info;
  notice: (n: unknown, env: Env) => Notice;
  cardInfo: (c: Card, env: Env) => Info;
  card: (c: Card, env: Env, opts?: Record<string, unknown>) => string;
  summary: (notices: Notice[], env: Env) => string;
  done: (count: number, env: Env, o?: { left?: number }) => string;
  nav: (p: { index: number; seen: Set<string>; readable?: boolean }, notices: Notice[], env?: Env) => string;
  bar: (model: unknown, env: Env) => BarParts;
  barModel: (notices: Notice[], env?: Env) => { kind: string; total?: number; needYou?: number } | null;
  strip: (model: unknown, env: Env) => string;
  mix: (counts: Record<string, number>) => string;
  words: (c: Card, env: Env) => number;
};

const file = fileURLToPath(new URL("../../desktop/src/notify-cards.js", import.meta.url));
const NC = createRequire(import.meta.url)(file) as NotifyCardsApi;

// ---- a stub of what main.js passes (noticeEnv) ------------------------------------------------------------------------

const FACE = { hi: "#ffffff", mid: "#ececf0", edge: "#c9cad1" };
const look = (name: string, colour: string, mid: string): Assistant => ({ name, colour, visor: "bean", eyes: "pill", face: { hi: "#ffffff", mid, edge: "#999999" } });
const BRENDA: Assistant = { name: "Brenda", colour: "white", visor: "bean", eyes: "pill", face: FACE };
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
const assistantOf = (p: unknown): Assistant => (p && typeof p === "object" && typeof (p as Assistant).name === "string" ? (p as Assistant) : BRENDA);
// main.js's boredroomPath: a path inside Boredroom only.
const boredroomPath = (h: unknown) => (typeof h === "string" && /^\/(?![/\\])[^\s\\]{0,2000}$/.test(h) ? h : null);
const NOW = new Date(2026, 9, 9, 15, 30).getTime();
const env = (o: Partial<Env> = {}): Env => ({
  esc,
  face: (f = {}) => `<span class="face ${f.small ? "small" : ""} ${f.mood ?? ""} ${f.cls ?? ""}" data-who="${esc(f.who?.name ?? "me")}"></span>`,
  me: look("Brenda", "pink", "#ff8cc0"), ws: BRENDA, assistantOf, firstName: (s) => String(s ?? "").trim().split(/\s+/)[0] ?? "",
  displayName: "Jeremiah Onwuka", workspaceName: "Khronocorp", now: NOW, boredroomPath, state: {}, busy: false, canStart: true, ...o,
});
const E = env();

// ---- the running example ----------------------------------------------------------------------------------------------

const person = (n: number, name: string, a: Assistant) => ({ membershipId: `m-${n}`, name, assistant: a });
const ADA = person(1, "Ada Obi", look("Nova", "purple", "#a88cff"));
const BEN = person(2, "Ben Okafor", look("Max", "blue", "#74a3ff"));
const ABA = person(3, "Aba Mensah", look("King Jay", "yellow", "#ffd54a"));
const OLU = person(4, "Olu Adeyemi", look("Brenda", "teal", "#4ccfc3"));
const FABRO = person(5, "Fabro Fashio", look("Brenda", "green", "#62d48f"));
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const later = (h: number) => new Date(NOW + h * 3_600_000).toISOString();
const W = "/app/khronocorp";
const N = (id: string, type: string, facts: unknown, o: Record<string, unknown> = {}) => ({ id, type, title: `${type} title`, body: `${type} body`, href: `${W}/x/${id}`, resource_id: `r-${id}`, created_at: ago(2), facts, ...o });

const F = {
  message: (from = ADA) => ({ v: 1, kind: "message", from, preview: "Can we push standup to 10:30? The Aba call ran over.", where: null, direct: true, task: null }),
  comment: (from = BEN) => ({ v: 1, kind: "comment", from, preview: "Copy is done.", task: "Landing page" }),
  mention: (from = BEN) => ({ v: 1, kind: "mention", from, preview: "@Jeremiah can you check the hero copy before 3?", where: "Landing page" }),
  answer: (subject = ABA) => ({ v: 1, kind: "answer", subject, question: "What is Aba working on?", task: null, status: "answered", result: { key: "not_started", label: "Not started" }, time: { todaySeconds: 0, weekSeconds: 840 }, openTasks: 3, engine: "claude", href: `${W}/f/1` }),
  batch: () => ({ v: 1, kind: "batch", counts: { total: 6, answered: 4, replied: 1, noReply: 1, declined: 0, failed: 0 } }),
  report: (people = [FABRO]) => ({ v: 1, kind: "report", localDate: "2026-10-08", source: "facts", trackedSeconds: 0, finished: 0, overdue: 8, blocked: 0, missing: { count: 2, people }, late: { count: 1, people: [{ ...ABA, minutes: 22 }] } }),
  snapshot: () => ({ v: 1, kind: "report", localDate: "2026-10-08", source: "snapshot", trackedSeconds: null, finished: 3, overdue: 8, blocked: 1, missing: null, late: null }),
  review: (by = OLU, title = "Brand guide") => ({ v: 1, kind: "review", decision: "approved", task: { id: "t2", title }, by, revision: 2, daysEarly: -2, note: null }),
  outcome: (from = ADA) => ({ v: 1, kind: "request", from, status: "done", expiresAt: null, note: null, result: "Added “Review pricing” to your to-dos", request: { kind: "add_todo", title: "Review pricing", taskTitle: null, fromStatus: null, toStatus: null, dueAt: later(30), at: null, text: null } }),
  request: (from = BEN, kind = "task_status") => ({ v: 1, kind: "request", from, status: "delivered", expiresAt: later(72), note: "Waiting on Aba's product photos.", result: null,
    request: { kind, title: "Review pricing", taskTitle: "Checkout flow", fromStatus: "in_progress", toStatus: "in_review", dueAt: later(30), at: later(3), text: "The client approved the copy." } }),
  commitment: (o: Record<string, unknown> = {}) => ({ v: 1, kind: "commitment", title: "Send Ada the deck", dueAt: later(3), dueLabel: "today", status: "open", overdue: false, asker: ADA, committer: BEN, canMarkDone: true, href: `${W}/le/1`, ...o }),
  reminder: () => ({ v: 1, kind: "reminder", text: "Call the printer", at: ago(0), setAt: ago(60 * 24), taskTitle: "Aba proofs" }),
  assignment: (by = OLU, title = "Pricing page") => ({ v: 1, kind: "assignment", task: { id: "t3", title, project: "Website relaunch", dueAt: later(24 * 5), estimateMinutes: 240, priority: "high", status: "todo" }, by, canStart: true }),
  routine: () => ({ v: 1, kind: "routine", name: "Friday roundup", lead: "6 things still owed.", sections: [{ id: "owed_to_you", label: "owed to you", count: 4 }, { id: "overdue", label: "overdue", count: 2 }] }),
  rollup: () => ({ v: 1, kind: "rollup", team: "Design", posted: 4, members: 6, blockers: 1, noUpdate: [ABA, FABRO], late: [] }),
  // Calls (phase 8): the server's `call` facts (src/server/services/notice-facts.ts, contract C.7).
  call: (o: Record<string, unknown> = {}) => ({ v: 1, kind: "call", callId: "ca110000-0000-4000-8000-000000000001", from: { ...ADA, membershipId: "b1a00000-0000-4000-8000-000000000001" }, where: null, direct: true, at: ago(4), live: false, callBack: { membershipId: "b1a00000-0000-4000-8000-000000000001" }, ...o }),
};

/** Every notification kind with its facts, as `{ kind: "notification", n }`. */
const withFacts: Record<string, Card> = {
  message: { kind: "notification", n: N("1", "message.direct", F.message()) },
  comment: { kind: "notification", n: N("2", "task.comment", F.comment()) },
  mention: { kind: "notification", n: N("3", "message.mention", F.mention()) },
  reply: { kind: "notification", n: N("4", "brenda.mention_private", null, { body: "Only visible to you. Ben is in." }) },
  answer: { kind: "notification", n: N("5", "brenda.followup_answer", F.answer()) },
  batch: { kind: "notification", n: N("6", "brenda.followup_batch", F.batch()) },
  report: { kind: "notification", n: N("7", "brenda.daily_report", F.report()) },
  snapshot: { kind: "notification", n: N("7s", "brenda.daily_report", F.snapshot()) },
  approved: { kind: "notification", n: N("8", "review.approved", F.review()) },
  outcome: { kind: "notification", n: N("9", "assistant.outcome", F.outcome()) },
  taken: { kind: "notification", n: N("9t", "brenda.commitment_accepted", F.commitment()) },
  confirm: { kind: "notification", n: N("10", "brenda.mention_confirm", null) },
  reminder: { kind: "notification", n: N("11", "brenda.reminder", F.reminder()) },
  assigned: { kind: "notification", n: N("12", "task.assigned", F.assignment()) },
  due: { kind: "notification", n: N("13", "brenda.commitment_due", F.commitment()) },
  overdue: { kind: "notification", n: N("14", "brenda.commitment_due", F.commitment({ overdue: true, dueAt: ago(60 * 26) })) },
  routine: { kind: "notification", n: N("15", "brenda.routine", F.routine()) },
  rollup: { kind: "notification", n: N("16", "brenda.standup_rollup", F.rollup()) },
  clockin: { kind: "notification", n: N("17", "brenda.clock_in", null) },
  missed: { kind: "notification", n: N("17m", "call.missed", F.call()) },
  missedLive: { kind: "notification", n: N("17l", "call.missed", F.call({ where: "#Design", direct: false, live: true, callBack: null })) },
  recap: { kind: "notification", n: N("17r", "call.recap", null, { title: "Notes from your call with Ada", body: "We agreed the pricing page ships on Friday." }) },
  nudge: { kind: "notification", n: N("18", "brenda.nudge", null) },
  unknown: { kind: "notification", n: N("19", "billing.renewal", null) },
};
/** The cards main.js builds from the desktop state's lists. */
const reqW = { id: "r-20", kind: "request", title: "Ben's Max asks you to accept", lines: ["Task: “Checkout flow”", "Move it to In review"], note: "Soon, please.", sender: BEN, createdAt: ago(1), expiresAt: later(72), href: `${W}/i/20` };
const fromState: Record<string, Card> = {
  request: { kind: "item", phase: "open", n: N("20", "assistant.request", F.request()), w: reqW },
  requestNoFacts: { kind: "item", phase: "open", n: N("21", "assistant.request", null), w: reqW },
  requestNoNotification: { kind: "item", phase: "open", n: null, w: reqW },
  itemMessage: { kind: "item", phase: "open", n: N("22", "assistant.message", null), w: { id: "m1", kind: "message", body: "Can you check the images?", sender: OLU, canReply: true, tidied: false } },
  update: { kind: "item_update", n: N("23", "assistant.reply", null), u: { id: "u1", kind: "reply", title: "Ben replied", body: "“They still fit.”", status: "delivered", other: BEN, at: ago(1), href: `${W}/i/u1` } },
  updateDone: { kind: "item_update", n: N("24", "assistant.outcome", null), u: { id: "u2", kind: "request", title: "Ada accepted", body: "Added it.", status: "done", other: ADA, at: ago(1), href: `${W}/i/u2` } },
  ask: { kind: "followup_ask", phase: "ask", n: N("25", "brenda.followup_ask", null), w: { id: "a1", title: "Olu wants an update", question: "Where are you on it?", taskTitle: "Landing page", asker: OLU, deadlineAt: later(4) }, choice: null },
  askTeam: { kind: "followup_ask", phase: "ask", n: null, w: { id: "a2", title: "Team report", question: "", taskTitle: null, asker: null } },
  answerState: { kind: "followup_answer", n: N("26", "brenda.followup_answer", null), a: { id: "f1", title: "King Jay answered", status: "expired", subject: ABA, answer: "No reply by 19:41.", engine: "template", href: `${W}/f/1` } },
  noted: { kind: "loop", lk: "commitment", phase: "open", n: N("27", "brenda.commitment", null), w: { id: "c1", kind: "commitment", title: "Deck to Ada by Friday", what: "send the deck", dueLabel: "Fri 9 Oct, 17:00", from: null, acceptLabel: "Add to my to-dos", href: `${W}/le/c1` } },
  openAsk: { kind: "loop", lk: "commitment", phase: "open", n: N("28", "brenda.open_ask", null), w: { id: "c2", kind: "open_ask", title: "Review the pricing page", what: "Can someone review it?", dueLabel: "", from: ADA, acceptLabel: null, href: `${W}/le/c2` } },
  block: { kind: "loop", lk: "block", phase: "open", n: N("29", "brenda.blocked_on", null), w: { id: "b1", title: "Ben is blocked on you", taskTitle: "Checkout flow", question: "Which provider?", from: BEN, href: `${W}/t/9` } },
  standup: { kind: "standup", phase: "open", n: N("30", "brenda.standup", null), w: { id: "e1", team: { id: "t", name: "Design" }, sinceLabel: "", texts: { yesterday: "Hero copy\nReviews", today: "Checkout", blocked: "" }, postTo: { name: "#design", members: 6 }, href: `${W}/s/e1` } },
  rollupState: { kind: "standup_rollup", n: N("31", "brenda.standup_rollup", null), w: { id: "ro1", team: { name: "Design" }, content: { counts: { members: 6, posted: 4 }, blockers: [{ name: "Ben", text: "photos" }], noUpdate: [{ name: "Aba Mensah" }], late: [] }, href: `${W}/s/ro1` } },
  routineState: { kind: "routine", n: N("32", "brenda.routine", null), runs: [{ id: "run1", title: "What's still owed", lead: "5 things are still owed.", lines: [{ text: "Ben hasn't answered", href: null }], href: `${W}/r/1` }] },
  bundle: { kind: "routine", n: N("33", "brenda.routine_bundle", null, { body: "Morning brief, What's still owed" }), runs: [] },
};
/** What is left when the state does not carry what a card reads (an older server, or something answered meanwhile). */
const missingState: Record<string, Card> = {
  item: { kind: "item", phase: "open", n: N("40", "assistant.request", null), w: null },
  itemNoSender: { kind: "item", phase: "open", n: null, w: { id: "x", kind: "message", body: "hi" } },
  update: { kind: "item_update", n: N("41", "assistant.outcome", null), u: null },
  ask: { kind: "followup_ask", phase: "ask", n: null, w: undefined },
  loop: { kind: "loop", lk: "commitment", phase: "open", n: N("42", "brenda.commitment", null), w: {} },
  block: { kind: "loop", lk: "block", n: null, w: null },
  standup: { kind: "standup", phase: "open", n: N("43", "brenda.standup", null), w: { team: null } },
  rollup: { kind: "standup_rollup", n: null, w: { content: null } },
  routine: { kind: "routine", n: null, runs: null },
  nothing: { kind: "notification", n: null },
  stranger: { kind: "home" },
};

const generatedHeadlines = (html: string) => [...html.matchAll(/<h3 class="nc-hl"[^>]*>([\s\S]*?)<\/h3>/g)].map((m) => m[1].replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">"));
const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;
const notices = (cards: Card[], e = E) => cards.map((c) => NC.notice(c.n, e));

describe("NotifyCards.classify", () => {
  const table: [string, string, string, string, boolean][] = [
    ["message.direct", "message", "talk", "people", false], ["assistant.message", "message", "talk", "people", false], ["assistant.reply", "message", "talk", "people", false],
    ["task.comment", "message", "talk", "people", false], ["message.mention", "mention", "talk", "people", false],
    ["brenda.mention_reply", "reply", "talk", "people", false], ["brenda.mention_private", "reply", "talk", "people", false], ["assistant.tagged", "reply", "talk", "people", false], ["assistant.thread_reply", "reply", "talk", "people", false],
    ["brenda.followup_answer", "answer", "talk", "people", false], ["brenda.followup_batch", "answer", "talk", "people", false],
    ["brenda.daily_report", "report", "plain", "report", false],
    ["review.approved", "together", "good", "good", false], ["brenda.commitment_accepted", "together", "good", "good", false], ["brenda.block_answered", "together", "good", "good", false],
    ["assistant.request", "request", "needs", "ask", true], ["brenda.followup_ask", "ask", "needs", "ask", true], ["brenda.commitment", "commitment", "needs", "ask", true], ["brenda.open_ask", "commitment", "needs", "ask", true],
    ["brenda.blocked_on", "blocked", "needs", "ask", true], ["brenda.standup", "standup", "needs", "ask", true],
    ["brenda.mention_confirm", "confirm", "needs", "ask", true], ["brenda.replan", "confirm", "needs", "ask", true], ["review.requested", "confirm", "needs", "ask", true], ["adjustment.requested", "confirm", "needs", "ask", true],
    ["brenda.reminder", "reminder", "needs", "time", false], ["task.assigned", "assignment", "needs", "time", false], ["brenda.commitment_due", "due", "needs", "time", false],
    ["brenda.nudge", "plain", "needs", "time", false], ["brenda.commitment_stalled", "plain", "needs", "time", false], ["task.blocked", "plain", "needs", "time", false], ["review.changes_requested", "plain", "needs", "time", false],
    ["brenda.routine", "routine", "plain", "report", false], ["brenda.routine_bundle", "routine", "plain", "report", false], ["brenda.standup_rollup", "rollup", "plain", "report", false],
    ["brenda.clock_in", "clockin", "good", "good", false],
    // Calls (owner decisions, 8 October 2026: phase 8): a missed call has its own card, a call's notes the plain one.
    ["call.missed", "call", "talk", "people", false], ["call.recap", "plain", "plain", "report", false],
    // Screen recording is gone (phase 8): an old capture exception still unread draws the plain card.
    ["capture.exception", "plain", "plain", "report", false],
    ["review.question", "plain", "talk", "people", false], ["brenda.commitment_declined", "plain", "talk", "people", false], ["brenda.block_not_me", "plain", "talk", "people", false],
    ["brenda.routine_failed", "plain", "plain", "report", false], ["brenda.standup_failed", "plain", "plain", "report", false],
    ["billing.renewal", "plain", "plain", "report", false], ["", "plain", "plain", "report", false],
  ];
  it.each(table)("%s is %s, %s, %s", (type, template, family, group, waits) => {
    expect(NC.classify(type, null)).toMatchObject({ template, family, group, waits });
  });
  it("words a request outcome by what happened, and a commitment due by whether it is late", () => {
    expect(NC.classify("assistant.outcome", F.outcome())).toMatchObject({ template: "together", family: "good", word: "accepted" });
    expect(NC.classify("assistant.outcome", { ...F.outcome(), status: "declined" })).toMatchObject({ template: "plain", family: "talk", group: "people" });
    expect(NC.classify("assistant.outcome", null).template).toBe("plain");
    expect(NC.classify("brenda.commitment_due", F.commitment({ overdue: true })).word).toBe("overdue");
    expect(NC.classify("brenda.commitment_due", F.commitment()).word).toBe("due");
  });
  it("looks a type up on its own keys only", () => {
    for (const t of ["__proto__", "constructor", "toString", "hasOwnProperty"]) expect(NC.classify(t, null)).toMatchObject({ template: "plain", family: "plain", group: "report" });
  });
});

describe("NotifyCards.card", () => {
  const all: [string, Card][] = [
    ...Object.entries(withFacts),
    ...Object.entries(withFacts).map(([k, c]): [string, Card] => [`${k} without facts`, { ...c, n: { ...(c.n as object), facts: null } }]),
    ...Object.entries(fromState).map(([k, c]): [string, Card] => [`state ${k}`, c]),
    ...Object.entries(missingState).map(([k, c]): [string, Card] => [`missing ${k}`, c]),
  ];
  it.each(all)("%s: draws a whole card, one main action, one orange button at most", (_, c) => {
    const html = NC.card(c, E);
    expect(html.startsWith('<section class="nc')).toBe(true);
    expect(html).toContain('id="nc-hl"');
    expect(html).toMatch(/<div class="actions">[\s\S]*<\/div><\/section>$/);
    expect(count(html, / data-main/g)).toBe(1);
    expect(count(html, /class="btn [^"]*\baccent\b/g)).toBeLessThanOrEqual(1);
    const info = NC.cardInfo(c, E);
    expect(html).toContain(`data-template="${info.template}"`);
    expect(info.words).toBeGreaterThan(0);
  });

  it("picks the template from the facts and the state, and the plain card when they are missing", () => {
    const t = (c: Card) => NC.cardInfo(c, E).template;
    expect(t(withFacts.message)).toBe("message");
    expect(t(withFacts.approved)).toBe("together");
    expect(t(withFacts.overdue)).toBe("due");
    expect(t({ ...withFacts.message, n: { ...(withFacts.message.n as object), facts: null } })).toBe("plain");
    expect(t({ ...withFacts.assigned, n: { ...(withFacts.assigned.n as object), facts: null } })).toBe("plain");
    expect(t(fromState.request)).toBe("request");
    expect(t(fromState.requestNoFacts)).toBe("request");
    expect(t(fromState.updateDone)).toBe("together");
    expect(t(fromState.block)).toBe("blocked");
    expect(t(missingState.item)).toBe("plain");
    // A request the state doesn't carry can't be accepted from the notch: the plain card, as before.
    expect(t({ kind: "notification", n: N("50", "assistant.request", F.request()) })).toBe("plain");
  });

  it("keeps the family of the kind on its plain card", () => {
    const together = { kind: "notification", n: N("51", "review.approved", null) };
    expect(NC.cardInfo(together, E)).toMatchObject({ template: "plain", family: "good" });
    expect(NC.card(together, E)).toContain('class="face  happy ');
  });

  it("never throws on malformed facts or state", () => {
    const bad: Card[] = [
      { kind: "notification", n: N("60", "message.direct", { v: 1, kind: "message", from: { name: 42 }, preview: { x: 1 } }) },
      { kind: "notification", n: N("61", "brenda.daily_report", { v: 1, kind: "report", localDate: "yesterday", source: "facts", trackedSeconds: "lots", missing: { count: "2", people: "everyone" }, late: [] }) },
      { kind: "notification", n: N("62", "task.assigned", { v: 1, kind: "assignment", task: { title: ["x"] } }) },
      { kind: "notification", n: N("63", "brenda.routine", { v: 1, kind: "routine", sections: "many" }) },
      { kind: "notification", n: N("64", "brenda.followup_answer", { v: 2, kind: "answer" }) },
      { kind: "notification", n: { id: "65" } },
      { kind: "notification", n: N("66", "message.direct", Object.defineProperty({ v: 1, kind: "message" }, "from", { get() { throw new Error("boom"); }, enumerable: true })) },
      { kind: "item", phase: "open", n: null, w: { kind: "request", sender: { name: "" } } },
      { kind: "standup", phase: "open", n: null, w: { team: { name: "Design" }, texts: { yesterday: 5 }, postTo: null } },
    ];
    for (const c of bad) {
      let html = "";
      expect(() => { html = NC.card(c, E); }).not.toThrow();
      expect(html).toContain('id="nc-hl"');
      expect(count(html, / data-main/g)).toBe(1);
    }
    expect(() => NC.card(null as unknown as Card, E)).not.toThrow();
    expect(() => NC.card(withFacts.message, {} as Env)).not.toThrow();
  });

  it("writes headlines of 30 characters or fewer, in their short forms for 200-character names", () => {
    const long = "Bartholomew".repeat(19).slice(0, 200);
    const L = (p: typeof ADA) => ({ ...p, name: `${long} ${p.name}` });
    const title = "A very long task title that goes on and on ".repeat(5).slice(0, 200);
    const cards: Card[] = [
      ...Object.values(withFacts), ...Object.values(fromState),
      { kind: "notification", n: N("70", "message.direct", F.message(L(ADA))) },
      { kind: "notification", n: N("71", "task.comment", F.comment(L(BEN))) },
      { kind: "notification", n: N("72", "message.mention", F.mention(L(BEN))) },
      { kind: "notification", n: N("73", "review.approved", F.review(L(OLU), title)) },
      { kind: "notification", n: N("74", "assistant.outcome", F.outcome(L(ADA))) },
      { kind: "notification", n: N("75", "brenda.commitment_accepted", F.commitment({ committer: L(BEN) })) },
      { kind: "notification", n: N("76", "task.assigned", F.assignment(L(OLU), title)) },
      { kind: "notification", n: N("77", "brenda.daily_report", F.report([L(FABRO)])) },
      { kind: "notification", n: N("77c", "call.missed", F.call({ from: L(ADA) })) },
      { kind: "notification", n: N("78", "brenda.daily_report", { ...F.report(), localDate: "2026-10-07", trackedSeconds: 3600 * 9999 }) },
      ...["add_todo", "task_status", "task_comment", "set_reminder", "other"].map((k): Card => ({ ...fromState.request, n: N(`79${k}`, "assistant.request", F.request(L(BEN), k)), w: { ...reqW, sender: L(BEN) } })),
      { ...fromState.itemMessage, w: { ...(fromState.itemMessage.w as object), sender: L(OLU) } },
      { ...fromState.update, u: { ...(fromState.update.u as object), other: L(BEN) } },
      { ...fromState.ask, w: { ...(fromState.ask.w as object), asker: L(OLU), taskTitle: title } },
    ];
    let seen = 0;
    for (const c of cards) {
      for (const h of generatedHeadlines(NC.card(c, E))) { seen += 1; expect([...h].length, h).toBeLessThanOrEqual(30); }
    }
    expect(seen).toBeGreaterThan(20);
    expect(generatedHeadlines(NC.card({ kind: "notification", n: N("80", "message.direct", F.message(L(ADA))) }, E))).toEqual(["New message"]);
  });

  it("escapes other people's words and opens only Boredroom paths", () => {
    const evil = "<script>alert(1)</script>";
    const villain = { membershipId: "m-9", name: `${evil} Smith`, assistant: look(`${evil}`, "pink", "#ff8cc0") };
    const cards: Card[] = [
      { kind: "notification", n: N("90", "message.direct", { ...F.message(villain), preview: evil, where: evil }, { title: evil, body: evil, href: "javascript:alert(1)" }) },
      { kind: "notification", n: N("91", "message.mention", { ...F.mention(villain), preview: `@Jeremiah ${evil}` }, { href: "//evil.example/x" }) },
      { kind: "notification", n: N("92", "review.approved", { ...F.review(villain, evil), note: evil }, { href: "https://evil.example" }) },
      { kind: "notification", n: N("93", "billing.renewal", null, { title: evil, body: evil, href: "javascript:alert(1)" }) },
      { kind: "notification", n: N("94", "brenda.daily_report", F.report([villain])) },
      { kind: "notification", n: N("94c", "call.missed", F.call({ from: villain, where: evil, direct: false, live: true }), { href: "javascript:alert(1)" }) },
      { kind: "notification", n: N("94d", "call.missed", F.call({ from: villain, live: false, callId: `"><script>`, callBack: { membershipId: evil } })) },
      { ...fromState.request, n: N("95", "assistant.request", { ...F.request(villain), note: evil }), w: { ...reqW, sender: villain, note: evil, lines: [evil] } },
      { ...fromState.noted, w: { ...(fromState.noted.w as object), title: evil, what: evil, href: "javascript:alert(1)" } },
      { ...fromState.standup, w: { ...(fromState.standup.w as object), texts: { yesterday: evil, today: evil, blocked: evil }, href: "javascript:alert(1)" } },
    ];
    for (const c of cards) {
      const html = NC.card(c, E, { more: 2 });
      expect(html).not.toContain("<script>");
      expect(html).not.toMatch(/data-href="(?!\/(?![/\\]))/);
      expect(html).not.toContain("javascript:");
    }
    expect(NC.card(cards[0], E)).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    // The viewer's own @name is lit, in the escaped text, and nothing else is.
    expect(NC.card(cards[1], E)).toContain('<span class="at">@Jeremiah</span> &lt;script&gt;');
    const s = NC.summary(notices(cards.slice(0, 5)), E);
    expect(s).not.toContain("<script>");
  });

  it("draws main.js's options: a result, a slot, its own actions, +N waiting, the pager's footer, the acted state", () => {
    const result = NC.card(fromState.request, E, { result: { title: "Couldn't be done: <b>nope</b>", sub: "Max lets Ben know.", tone: "bad", actions: '<button class="btn primary" data-act="close" data-main>OK</button>' } });
    expect(result).toContain('class="nc-hl wrap full bad"');
    expect(result).toContain("&lt;b&gt;nope&lt;/b&gt;");
    expect(result).not.toContain("ai-accept");
    const slot = NC.card(fromState.ask, E, { slot: '<div class="choices"></div>', actions: '<button data-act="fu-send" data-main>Send</button>' });
    expect(slot).toMatch(/<div class="choices"><\/div><div class="actions"><button data-act="fu-send" data-main>Send<\/button><\/div>/);
    expect(NC.card(withFacts.message, E, { more: 2 })).toContain('<span class="nc-more"><span class="n">+2</span>waiting</span>');
    const acted = NC.card(withFacts.approved, E, { done: "Done", nav: '<div class="nc-nav"></div>' });
    expect(acted).toContain('<section class="nc acted"');
    expect(acted).toMatch(/<span class="nc-done">.*Done<\/span><\/div><div class="nc-nav"><\/div><\/section>$/);
  });

  it("disables the card's own buttons while a press is in flight", () => {
    const html = NC.card(fromState.request, env({ busy: true }));
    expect(count(html, /<button [^>]*disabled/g)).toBe(2);
  });

  it("offers Start timer only when the task and the person can start it", () => {
    expect(NC.card(withFacts.assigned, E)).toContain('data-act="start"');
    expect(NC.card(withFacts.assigned, env({ canStart: false }))).not.toContain('data-act="start"');
  });
});

describe("review fixes (9 October 2026)", () => {
  it("brings an open ask with the asker's own face, a noted commitment with the workspace's", () => {
    expect(NC.card(fromState.openAsk, E)).toMatch(/<div class="nc-by"><span class="nc-pair"><span class="face[^"]*alert[^"]*" data-who="Nova">/);
    expect(NC.card(fromState.noted, E)).toMatch(/<div class="nc-by"><span class="nc-pair"><span class="face[^"]*" data-who="Brenda">/);
  });
  it("leaves out the quote when the headline already says it", () => {
    const echo = { ...fromState.noted, w: { ...(fromState.noted.w as Record<string, unknown>), what: "send the deck to Ada by Friday" } };
    expect(NC.card(echo, E)).not.toContain("nc-quote");
    expect(NC.card(fromState.openAsk, E)).toContain("Can someone review it?");
  });
  it("labels the comment a request would post as the person's own, in their colour", () => {
    const c = { ...fromState.request, n: N("20c", "assistant.request", F.request(BEN, "task_comment")) };
    const html = NC.card(c, E);
    expect(html).toContain("Posted as your comment:");
    expect(html).toContain('<p class="nc-quote" style="--q:#ff8cc0">The client approved the copy.</p>');
    expect(html).toContain('<p class="nc-quote" style="--q:#74a3ff">Soon, please.</p>');
  });
});

describe("NotifyCards.notice", () => {
  it("names who brought it, in the mood of the news", () => {
    const n = (c: Card) => NC.notice(c.n, E);
    expect(n(withFacts.message).sender).toMatchObject({ key: "m-1", label: "Ada", mood: "" });
    expect(n(withFacts.report).sender).toMatchObject({ key: "ws", label: "Team", mood: "sad" });
    expect(n(withFacts.answer).sender).toMatchObject({ key: "m-3", label: "Aba", mood: "gulp" });
    expect(n(withFacts.approved).sender).toMatchObject({ key: "m-4", label: "Olu", mood: "happy" });
    expect(n(withFacts.reminder).sender).toMatchObject({ key: "me", label: "You", mood: "alert" });
    expect(n(withFacts.overdue).sender.mood).toBe("sad");
    expect(n(withFacts.message).line).toBe("Can we push standup to 10:30? The Aba call ran over.");
    expect(n(withFacts.report).line).toBe("No hours logged on Thursday");
  });
});

describe("the summary, its wash and the pager's footer", () => {
  const eight: Card[] = [fromState.request, withFacts.reminder, withFacts.message, withFacts.mention, withFacts.answer, withFacts.approved, withFacts.report, { kind: "notification", n: N("100", "message.direct", F.message(FABRO)) }];
  const list = notices(eight);

  it("says hello, counts, and lines up six senders then +N", () => {
    const state = { assistantItems: { ready: true, waiting: [reqW], updates: [] } };
    const s = NC.summary(notices(eight, env({ state })), env({ state }));
    expect(s).toContain("Hey <b>Jeremiah</b>, you have");
    expect(s).toContain('<span class="n">8</span><span class="w">notifications</span>');
    expect(count(s, /class="nc-mate"/g)).toBe(7);
    expect(s).toContain('<span class="nc-more-n">+1</span><b>more</b>');
    expect(s).toContain('<i class="count">2</i><b>Ben</b><span>2 updates</span>');
    expect(s).toMatch(/data-family="needs" aria-label="2 need you\. Show them"><i class="dot"><\/i><span class="n">2<\/span>need you/);
    expect(s).toContain("1</span>approved");
    expect(count(s, / data-main/g)).toBe(1);
    expect(count(s, /class="btn [^"]*\baccent\b/g)).toBe(1);
  });
  it("is singular for one, and says hello without a name", () => {
    const s = NC.summary(list.slice(0, 1), env({ displayName: "" }));
    expect(s).toContain("Hey, you have");
    expect(s).toContain('<span class="w">notification</span>');
  });
  it("splits the wash in proportion, leaving out kinds with none", () => {
    const stops = (g: string) => [...g.matchAll(/(-?[\d.]+)%/g)].map((m) => Number(m[1]));
    const g = NC.mix({ needs: 2, talk: 3, plain: 2, good: 1 });
    expect(g.startsWith("linear-gradient(90deg, rgb(var(--needs) / .36) 0%")).toBe(true);
    const p = stops(g);
    expect(p[0]).toBe(0);
    expect(p[p.length - 1]).toBe(100);
    expect(p.every((v, i) => i === 0 || v >= p[i - 1])).toBe(true);
    const two = NC.mix({ needs: 0, talk: 1, plain: 0, good: 1 });
    expect(two).not.toContain("--needs");
    expect(two).not.toContain("--plain");
    expect(stops(two).at(-1)).toBe(100);
    expect(NC.mix({ talk: 4 })).toBe("linear-gradient(90deg, rgb(var(--talk) / .36) 0% 100%)");
    expect(g).toMatch(/^linear-gradient\(90deg, [a-z0-9 ()./%,-]+\)$/);
  });
  it("draws the footer: dots in each kind's colour, the position, Finish on the last, ‹ off on the first", () => {
    const first = NC.nav({ index: 0, seen: new Set() }, list);
    expect(first).toContain("<b>1</b> of 8");
    expect(first).toMatch(/data-act="pg-prev"[^>]*disabled/);
    expect(first).toContain(">Next<svg");
    const last = NC.nav({ index: 7, seen: new Set(list.map((x) => x.id)) }, list);
    expect(last).toContain('title="Finish">Finish</button>');
    expect(last).not.toMatch(/data-act="pg-prev"[^>]*disabled/);
    expect(count(last, /<i class="past"/g)).toBe(7);
    const twenty = Array.from({ length: 20 }, (_, i) => ({ ...list[i % 8], id: `x${i}` }));
    const many = NC.nav({ index: 15, seen: new Set() }, twenty);
    expect(count(many, /<i class/g)).toBe(12);
    expect(many).toContain("<b>16</b> of 20");
    expect(many).toContain('<i class="on" style="--kind:var(--talk-dot)">');
  });
  it("ends on All caught up", () => {
    expect(NC.done(8, E)).toContain("8 read. I'll fold away in a moment.");
    expect(NC.done(0, E)).toContain("Nothing left");
    expect(count(NC.done(3, E), / data-main/g)).toBe(1);
  });
  // Review, 9 October 2026: paging never reads an ask, so with asks left the end card does not claim the person is caught up.
  it("says what still needs the person instead of All caught up when asks are left", () => {
    const d = NC.done(6, E, { left: 2 });
    expect(d).not.toContain("All caught up");
    expect(d).toContain("2 still need you");
    expect(d).toContain("6 read. They wait in the bar.");
    expect(d).toContain('data-family="needs"');
    expect(NC.done(0, E, { left: 1 })).toContain("1 still needs you");
  });
  it("offers Mark all read only while it would read something", () => {
    const asks = notices([fromState.request, fromState.standup]);
    expect(asks.every((x) => x.group === "ask")).toBe(true);
    expect(NC.summary(asks, E)).not.toContain('data-act="pg-all"');
    expect(NC.summary(list, E)).toContain('data-act="pg-all"');
    expect(NC.nav({ index: 0, seen: new Set(), readable: false }, asks)).not.toContain('data-act="pg-all"');
    expect(NC.nav({ index: 0, seen: new Set() }, asks)).toContain('data-act="pg-all"');
  });
  it("counts every unread one past the 20 the state carries", () => {
    const s = NC.summary(list, env({ unreadTotal: 35 }));
    expect(s).toContain('<span class="n">35</span>');
    expect(s).toContain('<span class="nc-more-n">+28</span>');
    expect(NC.barModel(list.slice(0, 1), env({ unreadTotal: 35 }))).toMatchObject({ kind: "many", total: 35 });
  });
});

describe("the bar", () => {
  const list = notices([withFacts.message, withFacts.mention, withFacts.reminder, fromState.request, withFacts.report]);
  it("names the newest one or two by name, with the count", () => {
    const one = NC.bar(NC.barModel(list.slice(0, 2)), E);
    expect(one.wide).toBe(true);
    expect(one.text).toMatch(/^<b>(Ada|Ben)<\/b>&ensp;/);
    expect(one.trail).toBe('<span class="count">2</span>');
    expect(one.lead).toContain("var(--talk-dot)");
    expect(NC.bar(NC.barModel(list.slice(2, 3)), E).text).toBe("<b>Brenda</b>&ensp;Call the printer");
  });
  it("counts three or more, and how many need you, with faces", () => {
    const model = NC.barModel(list);
    expect(model).toMatchObject({ kind: "many", total: 5, needYou: 2 });
    const many = NC.bar(model, E);
    expect(many.text).toBe('<span class="nc-big-n">5 new</span>, <span class="nc-acc">2 need you</span>');
    expect(count(many.trail, /class="face/g)).toBe(3);
    expect(NC.strip(model, E)).toContain('data-act="nc-inbox" aria-label="5 new, 2 need you. Show them"');
  });
  it("gives a request's own line, not the sender's name again", () => {
    expect(NC.notice(fromState.request.n, E).line).toBe("Waiting on Aba's product photos.");
    const bare = { ...N("20b", "assistant.request", { ...F.request(), note: null }) };
    expect(NC.notice(bare, E).line).toBe("asks to move a task: Checkout flow");
  });
  it("says who is waiting on you", () => {
    const w = NC.bar({ kind: "waiting", who: BEN.assistant, label: "Ben", count: 1 }, E);
    expect(w.text).toBe("<b>Ben</b> is waiting on you");
    expect(w.lead).toContain("alert");
  });
  it("has nothing to say about nothing, and never says All clear", () => {
    expect(NC.barModel([])).toBeNull();
    expect(NC.bar(null, E)).toMatchObject({ text: "", wide: false });
    expect(NC.strip(null, E)).toBe("");
    for (const m of [NC.barModel(list), NC.barModel(list.slice(0, 1))]) expect(NC.bar(m, E).text).not.toContain("All clear");
  });
});

describe("NotifyCards.words", () => {
  it("counts the words on the card that a person reads", () => {
    // "New message from Ada" and the 11 words of the message.
    expect(NC.words(withFacts.message, E)).toBe(15);
    expect(NC.words(withFacts.message, E)).toBe(NC.cardInfo(withFacts.message, E).words);
    // A result card counts its own words, not the card's.
    expect(NC.words(withFacts.reminder, E)).toBeGreaterThan(3);
  });
});

describe("notify-cards.js", () => {
  it("is valid JavaScript for the page (node --check)", () => {
    expect(() => execFileSync(process.execPath, ["--check", file])).not.toThrow();
  });
});
