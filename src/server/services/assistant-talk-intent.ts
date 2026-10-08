/**
 * The built-in helper's ear for other people's assistants (owner decision, 8 October 2026: personal assistants, phase 6:
 * "I want all the bots to be able to communicate with each other"). Without the AI (no key, or past the daily limit) the
 * person can still say "Tell Ben's assistant the client moved the deadline to Friday", "Ask Ada's assistant to add
 * “Review pricing” to her to-dos", "Ask Ada's assistant to remind her at 3pm to call Josh", "Tell Brenda to put this in
 * today's team report: …" or "Anything from other assistants?", and the helper offers the same Confirm the model would
 * prepare (copilot.ts, chatBuiltin). Pure and unit-tested.
 *
 * It only recognises the shape of the sentence. Who the person is, whether the sender may send it, which task the words
 * mean and every limit are decided by the assistant-items service (planMessage, planRequest, planReportNote), as for the
 * model. A sentence that starts like a to-do ("Remind me to tell Ben's assistant …") or holds several lines is never one
 * of these (the guards the follow-up and catch-up helpers use).
 *
 * Also here, because a thread needs the same ear without the model (services/mention-processor.ts): `threadAskIntent`,
 * what "@Ben's Brenda …" asks of Ben's assistant (a change on Ben's account to hand over as a request, a line to pass
 * on, or a question for the follow-up rules), and `whenOf`, "at 3pm", "tomorrow at 9" or "on Friday" as a time.
 */
import { TO_DO } from "@/server/services/copilot-excerpt";
import { SEVERAL } from "@/server/services/follow-up-intent";
import { addDays, localDate, localTimeOn, offsetAt, weekdayOf } from "@/server/lib/time";
import { ASSISTANT_ITEM_WORDS } from "@/lib/assistant-items";

export type RequestTaskStatusWord = "todo" | "in_progress" | "blocked" | "in_review" | "completed";

/** A change on someone's own account, in the words the person used (the service resolves and validates them). */
export type RequestWords =
  | { kind: "add_todo"; title: string; due: string | null }          // due: words ("Friday", "tomorrow at 5pm")
  | { kind: "set_reminder"; text: string; when: string }
  | { kind: "task_status"; task: string; status: RequestTaskStatusWord; reason: string | null }
  | { kind: "task_comment"; task: string; text: string };

export type AssistantTalkIntent =
  | { kind: "message"; to: string; body: string }
  | { kind: "request"; to: string; request: RequestWords }
  | { kind: "report_note"; body: string | null }      // null: "What should the note say?"
  | { kind: "inbox" };

export type ThreadAskIntent =
  | { kind: "request"; request: RequestWords }
  | { kind: "relay"; body: string }
  | { kind: "question"; status: boolean; task: string | null; question: string };   // question ≤ 280

// ---- Words -------------------------------------------------------------------------------------------------------------

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const QUESTION_MAX = 280;

/** A person's name as typed: one to three words, "@" allowed in front ("@Ben", "Ben Okafor", "O'Neil"). */
const NAME = String.raw`@?[\p{L}][\p{L}\p{M}'’.-]*(?:\s+[\p{L}][\p{L}\p{M}'’.-]*){0,2}`;
/** The possessive: "Ben's", "Ben’s", "James'". */
const POSS = String.raw`(?:'s|’s|'|’)`;
/** Words that are never a person's name here. */
const NOT_A_NAME = /^(?:he|she|they|them|him|her|it|you|me|i|we|us|my|our|your|his|their|its|the|a|an|this|that|someone|somebody|anyone|everyone|everybody|nobody|people|team|my team|the team)$/i;

const DAY_NAME = String.raw`(?:mon|tues|wednes|thurs|fri|satur|sun)day`;
const TIME = String.raw`(?:\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?|noon|midday)`;
const PART = String.raw`(?:\s+(?:morning|afternoon|evening))?`;
const DAY = String.raw`(?:today|tomorrow|(?:on\s+|next\s+|this\s+)?${DAY_NAME})${PART}`;
const AMOUNT = String.raw`(?:\d{1,3}|an?|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty[\s-]?five|half\s+an)`;
/** "at 3pm", "15:00", "tomorrow (at 9)", "on Friday (at 5pm)", "in 2 hours", "today": what a reminder or a due date says. */
const WHEN = String.raw`(?:${DAY}(?:\s+at\s+${TIME})?|at\s+${TIME}(?:\s+(?:today|tomorrow|(?:on\s+)?${DAY_NAME}))?|in\s+${AMOUNT}\s+(?:minutes?|mins?|hours?|hrs?)|\d{1,2}(?::\d{2})?\s*(?:am|pm)|\d{1,2}:\d{2}|(?:the\s+)?end\s+of\s+(?:the\s+)?(?:day|week)|eod)`;

/** The task status words people use, as the status they mean. */
const STATUS_WORDS: { re: RegExp; status: RequestTaskStatusWord }[] = [
  { re: /^(?:to\s*do|todo|to-do|not\s+started)$/i, status: "todo" },
  { re: /^(?:in\s+progress|in-progress|started|doing)$/i, status: "in_progress" },
  { re: /^blocked$/i, status: "blocked" },
  { re: /^(?:in\s+review|for\s+review|review|in\s+for\s+review)$/i, status: "in_review" },
  { re: /^(?:done|complete|completed|finished)$/i, status: "completed" },
];
const STATUS = String.raw`(?:to\s*do|todo|to-do|not\s+started|in\s+progress|in-progress|started|doing|blocked|in\s+review|in\s+for\s+review|for\s+review|review|done|completed?|finished)`;
const statusOf = (w: string): RequestTaskStatusWord | null => STATUS_WORDS.find((x) => x.re.test(w.trim().replace(/\s+/g, " ")))?.status ?? null;

/** The person's sentence without the greeting and politeness in front: "Hey Max, can you please …". */
function lead(text: string, ownName?: string, polite = true): string {
  let s = text.replace(/\s+/g, " ").trim()
    .replace(/^(?:(?:hey|hi|hello|ok|okay)(?:\s+[\p{L}]+)?\s*,\s*)/iu, "");
  // "Max, put this in the report": the person's own assistant called by its name.
  if (ownName?.trim()) s = s.replace(new RegExp(`^${esc(ownName.trim())}\\s*[,:]\\s*`, "i"), "");
  // "Can you …" is how a command to one's own assistant starts; a question for someone else keeps it (`polite` false).
  return polite ? s.replace(/^(?:(?:please|can\s+you|could\s+you|would\s+you|will\s+you|kindly)\s+)+/i, "").trim() : s.trim();
}

/** Only politeness, no words of a note: "please", "thanks", "thank you", "cheers", "ta". */
const POLITE_ONLY = /^(?:please|pls|plz|thanks|thank\s+you|thx|cheers|ta)[\s.!?]*$/i;

/** Without the end of the sentence: "?", "!", "." and a trailing "please" or "for me". */
const bare = (s: string) => s.replace(/(?:\s*,)?\s+(?:please|for\s+me|thanks|thank\s+you)\s*[.!?]*$/i, "").replace(/[\s.!?]+$/, "").trim();

/** Someone's words as they will be delivered: trimmed, a trailing "please" or "thanks" dropped, the first letter capital. */
function words(s: string): string {
  const t = s.trim().replace(/^[:,–—-]\s*/, "").replace(/(?:\s*,)?\s+(?:please|thanks|thank\s+you)\s*([.!?]*)$/i, "$1").trim();
  return t ? `${t[0].toLocaleUpperCase("en-GB")}${t.slice(1)}` : t;
}

/** Quotes around a title or a task name come off: “Review pricing”, 'Landing page', "the deck". */
const unquote = (s: string) => s.trim().replace(/^["“'‘]+/, "").replace(/["”'’]+$/, "").trim();
/** A to-do's title: unquoted, the first letter capital, without a full stop at the end. */
const titleOf = (s: string) => words(unquote(bare(s)));
/** A task named in words: unquoted, without "the" in front or "task" at the end. */
const taskWords = (s: string) => unquote(bare(s)).replace(/^(?:the|a|an|our|my|his|her|their)\s+/i, "").replace(/\s+(?:task|ticket|card|job)$/i, "").trim();

const cleanName = (s: string) => s.trim().replace(/^@+/, "").trim();

// ---- Requests (a change on someone's own account) ------------------------------------------------------------------------

/**
 * What "… to add X to her to-dos", "… to remind her at 3pm to call Josh", "… to move X to in review" or "… to comment
 * on X that …" asks for. `obj` matches who it is for ("him", "her", "Ada", "Ada Obi"); `poss` whose ("her", "Ada's").
 */
function requestOf(rest: string, obj: string, poss: string): RequestWords | null {
  const r = rest.trim();
  const flags = "iu";
  // add X to her to-dos (by|for|due WHEN)
  const add = new RegExp(String.raw`^(?:add|put|create|make)\s+(.+?)\s+(?:to|on|in|into|onto)\s+${poss}\s+(?:to-?dos?|to\s+do\s+list|to-?do\s+list|todo\s+list|list|tasks?)(?:\s+(?:(?:by|for|due|before|on)\s+)?(${WHEN}))?[\s.!?]*$`, flags).exec(r);
  if (add) {
    const title = titleOf(add[1]);
    // "Add it to her to-dos": a pronoun is not a to-do's title (the model, which can see what "it" is, reads these).
    if (title && !/^(?:a|an|the)?\s*(?:to-?do|task|reminder)$/i.test(title) && !/^(?:it|this|that|these|those|them|this\s+one|that\s+one)$/i.test(title)) return { kind: "add_todo", title: title.slice(0, 200), due: add[2] ? bare(add[2]) : null };
  }
  // remind her (at 3pm | tomorrow at 9 | on Friday) to call Josh
  const remindFirst = new RegExp(String.raw`^remind\s+${obj}\s+(${WHEN})\s+to\s+(.+)$`, flags).exec(r);
  if (remindFirst) return { kind: "set_reminder", text: words(bare(remindFirst[2])).slice(0, 500), when: bare(remindFirst[1]) };
  // remind her to call Josh (at 3pm | tomorrow at 9 | on Friday)
  const remindLast = new RegExp(String.raw`^remind\s+${obj}\s+(?:to|about|of)\s+(.+?)\s+(${WHEN})[\s.!?]*$`, flags).exec(r);
  if (remindLast) return { kind: "set_reminder", text: words(bare(remindLast[1])).slice(0, 500), when: bare(remindLast[2]) };
  // comment on X that … / leave a comment on X: …
  const comment = new RegExp(String.raw`^(?:comment|add\s+a\s+comment|leave\s+a\s+comment|post\s+a\s+comment|write\s+a\s+comment)\s+on\s+(.+?)(?:\s+(?:that|saying)\s+|\s*:\s*|,\s+)(.+)$`, flags).exec(r);
  if (comment) {
    const task = taskWords(comment[1]);
    const text = words(comment[2]);
    if (task && text) return { kind: "task_comment", task: task.slice(0, 200), text: text.slice(0, 1000) };
  }
  // move / mark / set / put X (to|as|in|into) STATUS (because …)
  const move = new RegExp(String.raw`^(?:move|mark|set|put|change|switch|update)\s+(.+?)\s+(?:(?:to|as|in|into)\s+(?:the\s+)?)?(${STATUS})(?:\s+(?:column|status|stage))?(?:\s*(?:,|:|–|—|-|because|since)\s*(.+?))?[\s.!?]*$`, flags).exec(r);
  if (move) {
    const status = statusOf(move[2]);
    const task = taskWords(move[1]);
    if (status && task && !/^(?:status|it\s+as)$/i.test(task)) return { kind: "task_status", task: task.slice(0, 200), status, reason: move[3]?.trim() ? words(move[3]).slice(0, 280) : null };
  }
  return null;
}

/** Who a request or message is for: "him", "her", "them", or their name. */
const objFor = (names: string[]) => String.raw`(?:him|her|them|${names.filter(Boolean).map(esc).join("|") || "\\u0000"})`;
const possFor = (names: string[]) => String.raw`(?:his|her|their|your|${names.filter(Boolean).map((n) => `${esc(n)}${POSS}`).join("|") || "\\u0000"})`;

// ---- The helper in her own chat -------------------------------------------------------------------------------------------

const INBOX = [
  /^(?:is\s+there\s+|have\s+i\s+got\s+|got\s+)?(?:anything|any(?:thing)?\s+new|any\s+(?:new\s+)?(?:messages?|requests?|items?|news))\s+from\s+(?:(?:the\s+)?other\s+(?:people(?:'s|’s)\s+)?|any\s+(?:other\s+)?|someone(?:'s|’s)\s+)?assistants?$/i,
  /^what\s+(?:did|has)\s+.+?(?:'s|’s)\s+(?:assistant|brenda)\s+(?:brought|bring|passed\s+on|pass\s+on|sent|send)(?:\s+(?:to\s+)?me)?$/i,
  /^(?:show\s+(?:me\s+)?|open\s+|check\s+)?my\s+assistant(?:'s|’s)?\s+inbox$/i,
  /^(?:what(?:'s|’s|\s+is)\s+in\s+)?my\s+(?:assistant\s+)?inbox\s+(?:between|from)\s+assistants$/i,
  /^(?:did|has)\s+.+?\s+(?:see|seen|read)\s+my\s+(?:message|note|request)$/i,
  /^(?:are\s+there\s+|have\s+i\s+got\s+|got\s+)?any\s+(?:new\s+)?requests?\s+for\s+me$/i,
  /^(?:what(?:'s|’s|\s+is)\s+(?:waiting\s+)?)?between\s+assistants$/i,
  /^what\s+did\s+.+?\s+(?:say|answer|reply)\s+(?:to|about)\s+my\s+(?:request|message)$/i,
];

/**
 * What the person asks of other people's assistants, or null when it is not that. `workspaceAssistantName` is the
 * workspace's own assistant (the end-of-day report's), `ownAssistantName` the person's own.
 */
export function assistantTalkIntent(text: string, o: { workspaceAssistantName: string; ownAssistantName: string }): AssistantTalkIntent | null {
  const raw = String(text ?? "");
  if (!raw.trim() || SEVERAL.test(raw.trim()) || raw.length > 2000) return null;
  const s = lead(raw, o.ownAssistantName);
  if (!s) return null;
  const flags = "iu";
  const ws = o.workspaceAssistantName?.trim() || "Brenda";
  const own = o.ownAssistantName?.trim() || "";

  // A note for today's team report (before the to-do guard: "Add to the team report: …" starts like a to-do).
  const addressee = String.raw`(?:(?:tell|ask|get)\s+(?:brenda|${esc(ws)}${own ? `|${esc(own)}` : ""}|my\s+assistant|you|the\s+(?:workspace(?:'s|’s)?\s+)?assistant)\s+to\s+)?`;
  const report = String.raw`(?:(?:today(?:'s|’s)|tonight(?:'s|’s)|the|my|our|this\s+evening(?:'s|’s))\s+)?(?:(?:end[\s-]of[\s-](?:the[\s-])?day|daily|team|eod|evening)\s+)*report`;
  const note = new RegExp(String.raw`^${addressee}(?:put|add|include|note|mention)\s+(?:(?:this|that|it|a\s+note|my\s+note|the\s+following)\s+)?(?:in|into|on|to)\s+${report}(?:\s*[:,–—-]\s*(.+)|\s+that\s+(.+))?$`, flags).exec(s);
  if (note) {
    const body = (note[1] ?? note[2] ?? "").trim();
    // "Put this in the report, please": politeness alone is no note (the reply asks what it should say).
    const said = body ? words(body) : "";
    return { kind: "report_note", body: said && !POLITE_ONLY.test(said) ? said.slice(0, 500) : null };
  }
  const quotedNote = new RegExp(String.raw`^${addressee}(?:put|add|include|note|mention)\s+(["“'‘].+["”'’])\s+(?:in|into|on|to)\s+${report}[\s.!?]*$`, flags).exec(s);
  if (quotedNote) {
    const body = unquote(quotedNote[1]);
    return { kind: "report_note", body: body ? words(body).slice(0, 500) : null };
  }

  if (TO_DO.test(s) || TO_DO.test(raw.trim())) return null;
  // Only the end's punctuation and "please" go: "for me" is part of "any requests for me?".
  const b = s.replace(/(?:\s*,)?\s+please\s*[.!?]*$/i, "").replace(/[\s.!?]+$/, "").trim();
  if (INBOX.some((re) => re.test(b))) return { kind: "inbox" };

  // Someone's assistant: "Ben's assistant", "Ben's Brenda", "@Ben's Brenda".
  const assist = String.raw`(?:assistant|brenda|${esc(ws)}${own ? `|${esc(own)}` : ""})`;
  const whoOk = (who: string) => { const n = cleanName(who); return n && !NOT_A_NAME.test(n) ? n : null; };

  // A change on their account: "ask|tell Ada's assistant to add …, remind …, move …, comment …".
  const ask = new RegExp(String.raw`^(?:ask|tell|get|have)\s+(${NAME})${POSS}\s+${assist}\s+to\s+(.+)$`, flags).exec(s);
  if (ask) {
    const to = whoOk(ask[1]);
    if (!to) return null;
    const names = [to, to.split(/\s+/)[0]];
    const request = requestOf(ask[2], objFor(names), possFor(names));
    if (request) return { kind: "request", to, request };
    // "Tell Ben's assistant to …" that is not a change on his account: not one of these (the model reads it).
    return null;
  }

  // A message: "tell Ben's assistant (that) X", "let Ben's assistant know X", "pass (this) on to Ben's Brenda: X",
  // "message Ben's assistant: X".
  const patterns = [
    new RegExp(String.raw`^tell\s+(${NAME})${POSS}\s+${assist}\s*[,:]?\s+(?:that\s+)?(.+)$`, flags),
    new RegExp(String.raw`^let\s+(${NAME})${POSS}\s+${assist}\s+know\s*[,:]?\s*(?:that\s+)?(.+)$`, flags),
    new RegExp(String.raw`^pass\s+(?:(?:this|that|it|a\s+message)\s+)?on\s+to\s+(${NAME})${POSS}\s+${assist}\s*[,:]?\s*(.+)$`, flags),
    new RegExp(String.raw`^pass\s+(?:this|that|it|a\s+message)\s+to\s+(${NAME})${POSS}\s+${assist}\s*[,:]\s*(.+)$`, flags),
    new RegExp(String.raw`^(?:message|send)\s+(${NAME})${POSS}\s+${assist}\s*(?:a\s+message)?\s*[,:]?\s+(.+)$`, flags),
  ];
  for (const re of patterns) {
    const m = re.exec(s);
    if (!m) continue;
    const to = whoOk(m[1]);
    const body = words(m[2] ?? "");
    if (!to || !body || /^to\s/i.test(m[2].trim())) return null;
    return { kind: "message", to, body: body.slice(0, 1000) };
  }
  return null;
}

// ---- What a thread asks of someone else's assistant ------------------------------------------------------------------------

/** Asks about the state of someone's work: where they are, how far, done yet, blocked, what they are working on. */
const STATUS_Q = /\b(?:where|how\s+far|status|progress|update|updates|eta|done|finished|finish|working\s+on|doing|blocked|stuck|ready|complete|completed|on\s+track|behind|started)\b/i;
const PRONOUN = /^(?:it|that|this|these|those|he|she|they|him|her|them|you|things|everything|anything|stuff|work|everyone)$/i;

/**
 * What "@Ben's Brenda …" asks (the tag already taken out): a change on Ben's account (a request he must accept), a line
 * to pass on ("tell him …", "let Ben know …"), or a question (everything else). `status` is true when the question is
 * about the state of his work or names a task; then his assistant may answer from his work, else it always asks him.
 */
export function threadAskIntent(request: string, o: { ownerFirst: string; ownerName: string }): ThreadAskIntent {
  const raw = String(request ?? "").replace(/\s+/g, " ").trim();
  const s = lead(raw);
  const names = [o.ownerName?.trim(), o.ownerFirst?.trim()].filter((x): x is string => !!x);
  const obj = objFor(names);
  const flags = "iu";
  const poss = possFor(names);
  const several = !s || SEVERAL.test(s);
  const req = several ? null : requestOf(s, obj, poss);
  if (req) return { kind: "request", request: req };
  // "Ask him to add …", "tell Ben to remind himself …": the same change, asked through him.
  const through = several ? null : new RegExp(String.raw`^(?:ask|tell|get|have)\s+${obj}\s+to\s+(.+)$`, flags).exec(s);
  const req2 = through ? requestOf(through[1], obj, poss) : null;
  if (req2) return { kind: "request", request: req2 };
  // "mark X done" with no one named is a change on the owner's work too (requestOf already reads it).
  const relay = new RegExp(String.raw`^(?:tell\s+${obj}\s*[,:]?\s+(?:that\s+)?|let\s+${obj}\s+know\s*[,:]?\s*(?:that\s+)?|pass\s+(?:(?:this|that|it)\s+)?on\s+to\s+${obj}\s*[,:]?\s*)(.+)$`, flags).exec(s);
  if (relay && relay[1].trim() && !/^(?:to\s+ask|me\b)/i.test(relay[1].trim())) return { kind: "relay", body: words(relay[1]).slice(0, 1000) };
  // The owner reads the question in the tagger's words: "Can you join the client call tomorrow morning?", never the
  // imperative the request and relay forms read (visual review, 8 October 2026).
  const question = clampQuestion(words(lead(raw, undefined, false) || raw));
  const task = taskOfQuestion(bare(s), names);
  const quoted = /“[^”]{2,}”|"[^"]{2,}"|‘[^’]{2,}’/.test(s) || /\b(?:task|ticket)\b/i.test(s);
  return { kind: "question", status: STATUS_Q.test(s) || quoted || !!task, task, question };
}

function clampQuestion(q: string): string {
  if (q.length <= QUESTION_MAX) return q;
  let cut = QUESTION_MAX - 1;
  const code = q.charCodeAt(cut - 1);
  if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
  return `${q.slice(0, cut).trimEnd()}…`;
}

/** The task a question names, as words for the follow-up plan to match: "the deck", “Landing page”; null for "he", "it". */
function taskOfQuestion(q: string, names: string[]): string | null {
  const quoted = /“([^”]{2,120})”|"([^"]{2,120})"|‘([^’]{2,120})’/.exec(q);
  if (quoted) return taskWords(quoted[1] ?? quoted[2] ?? quoted[3] ?? "") || null;
  const who = String.raw`(?:he|she|they|you|we|things|${names.map(esc).join("|") || "\\u0000"})`;
  const patterns = [
    /\b(?:status|progress|update|updates|eta)\s+(?:of|on|for|with)\s+(.+)$/i,
    new RegExp(String.raw`^where(?:'s|’s|\s+is|\s+are)\s+${who}\s+(?:at\s+)?(?:on|with)\s+(.+?)$`, "iu"),
    new RegExp(String.raw`^how\s+far\s+(?:along\s+)?(?:is|are)\s+${who}\s+(?:on|with)\s+(.+?)$`, "iu"),
    /^how\s+far\s+(?:along\s+)?(?:is|are)\s+(.+?)(?:\s+along)?$/i,
    /^how(?:'s|’s|\s+is|\s+are)\s+(.+?)\s+(?:going|coming\s+along|getting\s+on|progressing)$/i,
    /^is\s+(.+?)\s+(?:done|finished|ready|complete|completed|blocked|started)(?:\s+yet)?$/i,
    new RegExp(String.raw`^(?:has|did)\s+${who}\s+(?:finish|finished|complete|completed|done|start|started)\s+(.+?)(?:\s+yet)?$`, "iu"),
    /^where(?:'s|’s|\s+is|\s+are)\s+(.+?)(?:\s+at)?$/i,
  ];
  for (const re of patterns) {
    const m = re.exec(q);
    const w = m?.[1] ? taskWords(m[1]) : "";
    if (!w || w.length < 2 || PRONOUN.test(w) || names.some((n) => n.toLowerCase() === w.toLowerCase())) continue;
    return w.slice(0, 120);
  }
  return null;
}

// ---- When ------------------------------------------------------------------------------------------------------------------

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, thirty: 30, fortyfive: 45, "half an": 0.5 };

/** An instant as ISO 8601 with the zone's offset at it: "2026-10-09T17:00:00+01:00". */
export function isoWithOffset(at: Date, timeZone: string): string {
  const off = offsetAt(at, timeZone);
  const local = new Date(Math.floor(at.getTime() / 1000) * 1000 + off).toISOString().slice(0, 19);
  const m = Math.round(off / 60_000);
  return `${local}${m < 0 ? "-" : "+"}${String(Math.floor(Math.abs(m) / 60)).padStart(2, "0")}:${String(Math.abs(m) % 60).padStart(2, "0")}`;
}

/** "3pm", "15:00", "9", "noon" as hours and minutes; 1 to 6 with no am or pm is the afternoon (a working day's "at 3"). */
function clockOf(t: string): { hour: number; minute: number } | null {
  const w = t.trim().toLowerCase().replace(/\./g, "");
  if (w === "noon" || w === "midday") return { hour: 12, minute: 0 };
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(w);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2] ?? 0);
  if (minute > 59) return null;
  if (m[3]) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (m[3] === "pm" ? 12 : 0);
  } else {
    if (hour > 23) return null;
    if (hour >= 1 && hour <= 6) hour += 12;
  }
  return { hour, minute };
}

/**
 * Words for a time as ISO 8601 with the organisation's offset, or null when they are not a time, already past, or more
 * than a year ahead: "at 3pm" and "15:00" today; "tomorrow (at 9)"; "on Friday (at 5pm)" (the next one; today when it is
 * Friday and the time is still ahead); "in 2 hours"; "today". A day alone is 17:00, its morning 09:00, afternoon 14:00,
 * evening 18:00. Read on the local clock (localTimeOn), so it holds on the days the clocks change.
 */
export function whenOf(input: string, o: { timeZone: string; now: Date }): string | null {
  const r = whenRead(input, o);
  return "at" in r ? r.at : null;
}

/** Why words are not a time to use, for the reply: already `past`, too `far` ahead (over a year), or `unreadable`. */
export type WhenProblem = "past" | "far" | "unreadable";

/**
 * What to say back when `w` is not a time to use: a time that has passed says so (never "I couldn't tell when “at
 * 3pm” is"), one over a year ahead says the limit, and words that are not a time say how to put it. `quote` renders the
 * person's words for where the reply is shown (Markdown in chat, plain in a thread).
 */
export function whenProblemWords(w: string, o: { timeZone: string; now: Date }, quote: (s: string) => string): string {
  const r = whenRead(w, o);
  if ("problem" in r && r.problem === "past") return ASSISTANT_ITEM_WORDS.refusals.inPast();
  if ("problem" in r && r.problem === "far") return ASSISTANT_ITEM_WORDS.refusals.tooFar();
  return `I couldn't tell when “${quote(w)}” is. Say a day or a time later than now, like “at 3pm”, “tomorrow at 9” or “on Friday”.`;
}

/**
 * whenOf with the reason when there is no time: "at 3pm" said at 15:50 is `past` (the reply says the time has passed,
 * never that it could not be read; review, 8 October 2026).
 */
export function whenRead(input: string, o: { timeZone: string; now: Date }): { at: string } | { problem: WhenProblem } {
  const no = { problem: "unreadable" as const };
  let w = String(input ?? "").toLowerCase().replace(/[.,!?]+$/, "").replace(/\s+/g, " ").trim()
    .replace(/^(?:by|before|due|for|until)\s+/, "").replace(/^the\s+/, "");
  if (!w) return no;
  // The end of the day is 17:00 today; the end of the week 17:00 on Friday.
  if (/^(?:end\s+of\s+(?:the\s+)?day|eod)$/.test(w)) w = "today";
  else if (/^end\s+of\s+(?:the\s+)?week$/.test(w)) w = "friday";
  const now = o.now;
  const tz = o.timeZone;
  const done = (at: Date): { at: string } | { problem: WhenProblem } => {
    if (Number.isNaN(at.getTime())) return no;
    if (at.getTime() <= now.getTime()) return { problem: "past" };
    if (at.getTime() > now.getTime() + 366 * 86_400_000) return { problem: "far" };
    return { at: isoWithOffset(at, tz) };
  };
  const rel = /^in\s+(\d{1,3}|an?|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty[\s-]?five|half\s+an)\s+(minutes?|mins?|hours?|hrs?)$/.exec(w);
  if (rel) {
    const key = rel[1].replace(/[\s-]/g, "") === "fortyfive" ? "fortyfive" : rel[1];
    const n = /^\d+$/.test(key) ? Number(key) : NUMBER_WORDS[key];
    if (!n) return no;
    const ms = n * (/^h/.test(rel[2]) ? 3_600_000 : 60_000);
    return done(new Date(Math.round((now.getTime() + ms) / 60_000) * 60_000));
  }
  const dayRe = String.raw`(today|tomorrow|(?:on\s+|next\s+|this\s+)?(?:sun|mon|tues|wednes|thurs|fri|satur)day)(?:\s+(morning|afternoon|evening))?`;
  const timeRe = String.raw`(\d{1,2}(?::\d{2})?\s*(?:am|pm)?|noon|midday)`;
  let day: string | null = null, part: string | null = null, clock: string | null = null;
  const a = new RegExp(String.raw`^(?:${dayRe})(?:\s+at\s+${timeRe})?$`).exec(w);
  const b = a ? null : new RegExp(String.raw`^(?:at\s+)?${timeRe}(?:\s+(?:${dayRe}))?$`).exec(w);
  if (a) { day = a[1]; part = a[2] ?? null; clock = a[3] ?? null; }
  else if (b) { clock = b[1]; day = b[2] ?? null; part = b[3] ?? null; }
  else return no;
  let hm = clock ? clockOf(clock) : part === "morning" ? { hour: 9, minute: 0 } : part === "afternoon" ? { hour: 14, minute: 0 } : part === "evening" ? { hour: 18, minute: 0 } : { hour: 17, minute: 0 };
  if (!hm) return no;
  // "at 9" in the evening is the morning's, said loosely: "tomorrow at 9" stays 09:00 (no am or pm: as typed).
  if (clock && part === "evening" && hm.hour < 12) hm = { ...hm, hour: hm.hour + 12 };
  const today = localDate(now, tz);
  const at = (date: string) => localTimeOn(date, `${String(hm!.hour).padStart(2, "0")}:${String(hm!.minute).padStart(2, "0")}`, tz);
  if (!day || day === "today") return done(at(today));
  if (day === "tomorrow") return done(at(addDays(today, 1)));
  const name = day.replace(/^(?:on|next|this)\s+/, "");
  const target = DAYS.indexOf(name);
  if (target < 0) return no;
  const dow = weekdayOf(today);
  let delta = (target - dow + 7) % 7;
  if (delta === 0) delta = /^next\s/.test(day) || at(today).getTime() <= now.getTime() ? 7 : 0;
  return done(at(addDays(today, delta)));
}
