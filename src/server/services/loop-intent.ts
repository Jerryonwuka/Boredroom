/**
 * Loose ends, commitments and blocked on whom in the built-in helper's words (owner decisions, 8 October 2026: phase
 * 7b, "Brenda keeps the loops closed", second part): "Any loose ends?", "Did I promise anything?", "Show my loose ends",
 * "My commitments", "What has my team committed to?", "Who is waiting on whom?", "I'm blocked on Ada for the logo files".
 * Pure, so every phrasing is unit-tested (tests/unit/loop-intent.test.ts). The helper runs the same copilot tools as
 * Claude does (loose_ends, commitments, waiting_on, set_blocked_on), so the person gets the same reads, refusals and
 * Confirm card.
 *
 * Not loop intents: a routine ("every evening, check for loose ends" is routine-intent's), a reminder or a to-do
 * ("remind me to …", "add a to-do"), another assistant ("tell Ben's assistant …") or a follow-up ("follow up with Ben").
 */

export type LoopIntent =
  | { kind: "loose_ends"; scan: boolean; days: number | null }
  | { kind: "commitments"; scope: "mine" | "team" | "all"; status: "open" | "overdue" | "all" }
  | { kind: "waiting_on" }
  | { kind: "blocked_on"; who: string; task: string | null; question: string | null };

/** Lower case, straight quotes, single spaces, no trailing full stop or exclamation. */
function norm(text: string): string {
  return String(text ?? "").toLowerCase().replace(/[’‘`]/g, "'").replace(/[“”]/g, "\"").replace(/\s+/g, " ").replace(/[.!]+\s*$/, "").trim();
}

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14 };

/** How far back: "the last 3 days", "past two days", "last week" (7), "today" (1), "this week" (7); null when not said. */
export function daysOf(t: string): number | null {
  const m = /\b(?:last|past|previous)\s+(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen)\s+days?\b/.exec(t);
  if (m) {
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1]];
    return n ? Math.max(1, Math.min(14, n)) : null;
  }
  if (/\b(?:last|past)\s+(?:two|2)\s+weeks?\b|\bfortnight\b/.test(t)) return 14;
  if (/\b(?:last|past|this)\s+week\b/.test(t)) return 7;
  if (/\b(?:last|past)\s+day\b|\btoday\b/.test(t)) return 1;
  if (/\byesterday\b/.test(t)) return 2;
  return null;
}

/** A sentence that is something else: a routine (a cadence), a reminder or a to-do, another assistant, a follow-up. */
const ELSEWHERE = [
  /\b(?:every|each)\s+(?:day|morning|afternoon|evening|night|weekday|week|month|mon|tue|wed|thu|fri|sat|sun)/,
  /\b(?:daily|weekly|monthly|on\s+weekdays)\b/,
  /^(?:please\s+)?(?:remind\s+me|add\s+(?:a\s+)?(?:to-?do|task)|create\s+(?:a\s+)?(?:to-?do|task)|i\s+need\s+to|i\s+have\s+to)\b/,
  /\b(?:tell|ask|let)\s+\S+(?:'s)?\s+assistant\b/,
  /\bfollow\s+up\s+(?:with|on)\b/,
];

/** A person's name in the helper's words: one to three words of letters, not a pronoun. */
const NAME = String.raw`([a-z][a-z'-]{1,30}(?:\s+[a-z][a-z'-]{1,30}){0,2}?)`;
const NOT_A_NAME = /^(?:me|myself|you|him|her|them|us|someone|somebody|anyone|anybody|whom|who|it|this|that|the|a|an)$/;
const clean = (s: string | undefined | null) => (s ?? "").replace(/^["'\s]+|["'\s?.,!:;]+$/g, "").trim();
/** A question as typed: quotes and loose punctuation off the ends, its "?" kept. */
const cleanQuestion = (s: string | undefined | null) => (s ?? "").replace(/^["'\s]+|["'\s.,!:;]+$/g, "").trim();
const sentence = (s: string) => (s ? `${s[0].toUpperCase()}${s.slice(1)}` : s);

/** "I'm blocked on Ada for the logo files", "blocked on Ben: can you send the copy?", "mark Landing page blocked waiting on Ada". */
function blockedOn(raw: string, t: string): LoopIntent | null {
  // The task named first: "mark Landing page (as) blocked, waiting on Ada …", "Landing page is blocked on Ada …".
  const marked = /^(?:please\s+)?(?:mark|set|put)\s+(?:the\s+task\s+)?(.+?)\s+(?:as\s+)?blocked\b[\s,;-]*(?:(?:it's|it is|i'm|i am|we're|we are)\s+)?(?:waiting|blocked)\s+(?:on|for)\s+(.+)$/.exec(t)
    ?? /^(?:the\s+task\s+)?(.+?)\s+is\s+blocked\s+(?:on|by)\s+(.+)$/.exec(t);
  let task: string | null = null;
  let rest: string;
  if (marked) { task = clean(marked[1]); rest = marked[2]; }
  else {
    const m = /^(?:i'm|i am|we're|we are|i've been|i have been|currently)?\s*(?:blocked|stuck|waiting)\s+(?:on|by)\s+(.+)$/.exec(t);
    if (!m) return null;
    rest = m[1];
  }
  const who = new RegExp(String.raw`^@?${NAME}(?=\s*(?:$|[:,;?-]|\s+(?:for|to|about|on|re|regarding|with|because|so)\b))`).exec(rest);
  if (!who || NOT_A_NAME.test(who[1]) || /^whom?\b/.test(who[1])) return null;
  const after = rest.slice(who[0].length).replace(/^\s*[:,;-]\s*/, "").trim();
  // Words after "for/about" are what they need; after a colon, the question itself.
  const need = /^(?:for|about|re|regarding)\s+(.+)$/.exec(after);
  const onTask = !task ? /^on\s+(?:the\s+task\s+)?(.+?)(?:\s*[:,;-]\s*(.+))?$/.exec(after) : null;
  if (onTask) task = clean(onTask[1]);
  let question = need ? cleanQuestion(need[1]) : onTask ? cleanQuestion(onTask[2]) : cleanQuestion(after);
  // The question as typed (its case kept), from the original text when it can be found there. What they need ("for the
  // logo files") becomes the question to that person: "I'm waiting on you for the logo files."
  if (question) {
    const at = raw.toLowerCase().lastIndexOf(question);
    if (at >= 0) question = raw.slice(at, at + question.length);
    question = need ? `I'm waiting on you for ${question.replace(/[.!]+$/, "")}.` : sentence(question);
    if (question.length > 500) question = question.slice(0, 500);
  }
  const whoText = (() => { const at = raw.toLowerCase().indexOf(who[1]); return at >= 0 ? raw.slice(at, at + who[1].length) : who[1]; })();
  const taskText = task ? (() => { const at = raw.toLowerCase().indexOf(task); return at >= 0 ? raw.slice(at, at + task.length) : task; })() : null;
  return { kind: "blocked_on", who: clean(whoText), task: taskText ? clean(taskText) || null : null, question: question || null };
}

/** What a sentence asks about loose ends, commitments or who waits on whom; null when it is not one of these. */
export function loopIntent(text: string): LoopIntent | null {
  const raw = String(text ?? "").replace(/[’‘`]/g, "'").replace(/[“”]/g, "\"").replace(/\s+/g, " ").replace(/[.!]+\s*$/, "").trim().slice(0, 400);
  const t = norm(raw).slice(0, 400);
  if (!t) return null;
  if (ELSEWHERE.some((re) => re.test(t))) return null;
  const core = t.replace(/^(?:(?:hey|hi|ok|okay|so)\b[,]?\s*)?(?:(?:please|can\s+you|could\s+you|would\s+you)\s+)*/, "").trim();

  // Who waits on whom (before "blocked on": "who is blocked on whom?").
  if (/\bwho(?:'s|\s+is|\s+are)?\s+(?:waiting|blocked)\s+on\s+(?:who|whom)\b|\bwho(?:'s|\s+is)\s+blocking\s+(?:who|whom)\b|\bwhat\s+(?:are|is)\s+(?:we|the\s+team|my\s+team)\s+waiting\s+on\b|\bwho\s+am\s+i\s+(?:blocking|holding\s+up)\b|\bwho(?:'s|\s+is)\s+(?:waiting|blocked)\s+on\s+me\b|\bwaiting[- ]on\s+(?:list|view|page)\b|\bwho\s+(?:are\s+)?(?:we|they)\s+waiting\s+(?:on|for)\b/.test(core)) return { kind: "waiting_on" };

  // Blocked on someone.
  const b = blockedOn(raw.replace(/^(?:(?:hey|hi|ok|okay|so)\b[,]?\s*)?(?:(?:please|can you|could you|would you)\s+)*/i, ""), core);
  if (b) return b;

  // Loose ends.
  if (/\bloose[\s-]+ends?\b/.test(core)) {
    const show = /^(?:show|list|open|see|view|display)\b/.test(core) && !/\b(?:find|look|check|scan|search|new|any)\b/.test(core);
    return { kind: "loose_ends", scan: !show, days: daysOf(core) };
  }
  if (/\bdid\s+i\s+promise\b|\bwhat\s+(?:did|have)\s+i\s+promised?\b|\bwhat\s+did\s+i\s+say\s+i(?:'d|\s+would|'ll|\s+will)\s+do\b|\bwhat\s+(?:have|did)\s+(?:people|others|they|anyone|colleagues)\s+(?:asked|ask)\s+me\s+to\s+do\b|\bwhat\s+(?:have\s+i\s+been|was\s+i)\s+asked\s+to\s+do\b|\b(?:anything|what)\s+(?:do\s+)?i\s+owe\s+(?:people|anyone|someone|colleagues)\b|\bdo\s+i\s+owe\s+anyone\s+anything\b|\bany(?:thing|one)\s+waiting\s+on\s+a\s+reply\s+from\s+me\b/.test(core)) {
    return { kind: "loose_ends", scan: true, days: daysOf(core) };
  }

  // Commitments.
  if (/\bcommit(?:ted|ments?)\b/.test(core)) {
    const status: "open" | "overdue" | "all" = /\boverdue\b|\blate\b/.test(core) ? "overdue" : /\bopen\b|\boutstanding\b/.test(core) ? "open" : "all";
    if (/\b(?:everyone'?s|everybody'?s|all)\s+commitments\b|\bcommitments\s+(?:across|in)\s+the\s+(?:workspace|organisation|organization|company)\b|\bwhat\s+has\s+everyone\s+committed\s+to\b/.test(core)) return { kind: "commitments", scope: "all", status };
    if (/\b(?:my\s+)?team(?:'s)?\s+commitments\b|\bwhat\s+(?:has|have)\s+(?:my|our|the)\s+team\s+committed\s+to\b|\bcommitments\s+(?:of|on|for|from)\s+(?:my|our|the)\s+team\b/.test(core)) return { kind: "commitments", scope: "team", status };
    if (/\b(?:my|our)\s+(?:(?:open|overdue|outstanding)\s+)?commitments\b|\bwhat\s+(?:have|did)\s+i\s+commit(?:ted)?\s+to\b|\bcommitments\s+(?:of\s+)?mine\b|\bam\s+i\s+committed\s+to\b/.test(core)) return { kind: "commitments", scope: "mine", status };
  }
  return null;
}
