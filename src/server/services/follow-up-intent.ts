/**
 * The built-in helper's ear for follow-ups (owner decision, 8 October 2026: personal assistants, phase 4). Without the AI
 * (no key, or past the daily limit) the person can still say "Follow up with Ben on the landing page", "Where is Ada on
 * the invoice task?", "Ask my team where they are on this week's tasks" or "Any answers on my follow-ups?", and the
 * helper offers the same Confirm the model would prepare (copilot.ts, chatBuiltin). Pure and unit-tested.
 *
 * It only recognises the shape of the sentence; who the people are, which team, which task and whether the person may
 * ask at all is decided by planFollowUps (services/follow-ups), as for the model. A sentence that starts like a to-do
 * ("Remind me to follow up with Ben") is never a follow-up (the TO_DO guard the catch-up helper uses).
 */
import { TO_DO } from "@/server/services/copilot-excerpt";

/**
 * `question` is null: what the person typed is an instruction to their own assistant ("Follow up with Ben on the
 * pricing page"), never words to show the person asked, so planFollowUps writes the natural question ("Where are you on
 * “Pricing page copy”?", "What are you working on?") from the task it resolves (visual review, 8 October 2026: Ben was
 * shown "Follow up with Ben on pricing page copy" as the question about himself).
 */
export type FollowUpIntent = { kind: "ask"; people: string[]; team: string | null; task: string | null; question: null } | { kind: "status" };

// Who: one or more people ("Ben", "Ben and Ada", "Ben, Ada & Ifeoma"), a team ("my team", "the Design team"), or
// "everyone on Design". The "everyone on|in X" form comes first, so its "on" is not read as the start of the task.
const WHO = String.raw`((?:everyone|everybody|all|people)\s+(?:on|in)\s+(?:the\s+)?[^,?]+?|.+?)`;
const PRONOUN = String.raw`(?:he|she|they|it)(?:'s|'re|’s|’re|\s+is|\s+are)?`;
const DOING = String.raw`(?:\s+(?:doing|getting\s+on|going|progressing|coming\s+along|at))?`;

/** Each pattern gives who ($1) and, when there is one, what it is about ($2). Order matters: the first match wins. */
const PATTERNS: { re: RegExp; who: number; what: number | null }[] = [
  // follow up on the landing page with Ben
  { re: new RegExp(String.raw`^follow[\s-]?up\s+(?:on|about|regarding)\s+(.+?)\s+with\s+${WHO}$`, "i"), who: 2, what: 1 },
  // follow up with Ben (on|about|regarding the landing page)
  { re: new RegExp(String.raw`^follow[\s-]?up\s+with\s+${WHO}(?:\s+(?:on|about|regarding|re|over)\s+(.+))?$`, "i"), who: 1, what: 2 },
  // ask / check (in) with Ben where he is on X; ask my team where they are on this week's tasks
  { re: new RegExp(String.raw`^(?:ask\s+with|check(?:\s+in)?\s+with|ask)\s+${WHO}\s+(?:where|how)\s+${PRONOUN}${DOING}(?:\s+(?:on|with)\s+(.+))?$`, "i"), who: 1, what: 2 },
  // ask Ben for an update (on X)
  { re: new RegExp(String.raw`^(?:ask|check(?:\s+in)?\s+with)\s+${WHO}\s+for\s+(?:an?\s+)?(?:update|status|progress\s+update|progress)(?:\s+(?:on|about|with)\s+(.+))?$`, "i"), who: 1, what: 2 },
  // check in with Ben (about X)
  { re: new RegExp(String.raw`^check(?:\s+in)?\s+with\s+${WHO}(?:\s+(?:on|about|regarding)\s+(.+))?$`, "i"), who: 1, what: 2 },
  // where is / where's / where are Ben (and Ada) (at) on/with the invoice (task)
  { re: new RegExp(String.raw`^where(?:'s|’s|\s+is|\s+are|'re|’re)\s+${WHO}(?:\s+at)?\s+(?:on|with)\s+(.+)$`, "i"), who: 1, what: 2 },
  // how is / how's Ben doing (on|with X)
  { re: new RegExp(String.raw`^how(?:'s|’s|\s+is|\s+are)\s+${WHO}\s+(?:doing|getting\s+on|going|progressing|coming\s+along)(?:\s+(?:on|with)\s+(.+))?$`, "i"), who: 1, what: 2 },
  // what is / what's Ben working on (today)
  { re: new RegExp(String.raw`^what(?:'s|’s|\s+is|\s+are|'re|’re)\s+${WHO}\s+(?:working\s+on|busy\s+with|doing)(?:\s+(?:today|now|right\s+now|this\s+week))?$`, "i"), who: 1, what: null },
];

/** "Any answers on my follow-ups?", "my follow-ups", "what did Ben's assistant say?" */
const STATUS = [
  /^(?:(?:are\s+there\s+|got\s+|have\s+i\s+got\s+)?any|what(?:'s|’s|\s+are)?(?:\s+the)?)\s+(?:new\s+)?(?:answers?|updates?|news|replies)\s+(?:on|to|from|for|about)\s+my\s+follow[\s-]?ups?$/i,
  /^(?:show\s+(?:me\s+)?|open\s+|check\s+|how\s+are\s+|what\s+about\s+)?my\s+follow[\s-]?ups?(?:\s+so\s+far)?$/i,
  /^what\s+did\s+.+?(?:'s|’s)\s+assistant\s+(?:say|answer|reply)$/i,
  /^any\s+(?:answers?|replies)(?:\s+yet)?\s+(?:to|on)\s+(?:my|the)\s+follow[\s-]?ups?$/i,
];

/** Words that point at someone without naming them, or that name nobody: never a person to ask. */
const NOT_A_NAME = /^(?:he|she|they|them|him|her|it|you|me|i|we|us|myself|yourself|someone|somebody|anyone|anybody|everyone|everybody|nobody|people|all|the|a|an|this|that|these|those|my|our|your|his|their|its|things|stuff|work|everything|anything|life)$/i;
/** A first word that starts a description, not a name ("the landing page", "my report"). */
const NOT_A_NAME_START = /^(?:the|a|an|this|that|these|those|my|our|your|his|her|their|its|some|any|it|you)\b/i;

/** The team a "who" names, or null when it names people. */
function teamOf(who: string): string | null {
  const w = who.trim();
  if (/^(?:(?:my|our|the)\s+)?teams?$/i.test(w)) return "my team";
  const everyone = /^(?:everyone|everybody|all|people)\s+(?:on|in)\s+(?:the\s+)?(.+?)(?:\s+team)?$/i.exec(w);
  if (everyone) return /^(?:my|our)\s+team$/i.test(everyone[1]) ? "my team" : everyone[1].trim();
  const named = /^(?:(?:the|my|our)\s+)?(.+?)\s+team$/i.exec(w);
  if (named) return named[1].trim();
  const prefixed = /^team\s+(.+)$/i.exec(w);
  return prefixed ? prefixed[1].trim() : null;
}

/** People's names out of "Ben", "Ben and Ada", "Ben, Ada & Ifeoma", "@Ben", "Ben's assistant"; null when one is not a name. */
function peopleOf(who: string): string[] | null {
  const parts = who.split(/\s*,\s*(?:and\s+)?|\s+and\s+|\s*&\s*/i).map((p) => p.trim().replace(/^@+/, "").replace(/(?:'s|’s)\s+(?:assistant|brenda)$/i, "").trim()).filter(Boolean);
  if (!parts.length || parts.length > 25) return null;
  for (const p of parts) {
    const words = p.split(/\s+/);
    if (words.length > 3 || NOT_A_NAME.test(p) || NOT_A_NAME_START.test(p)) return null;
    if (!words.every((w) => /^[\p{L}][\p{L}\p{M}'’.-]*$/u.test(w))) return null;
  }
  return parts;
}

/** Words that stand for all of someone's work, not one task: "this week's tasks", "their tasks", "today's work", "it". */
const ANY_WORK = /^(?:it|that|this|everything|anything|things|stuff|work|tasks?)$|^(?:(?:this|last|next)\s+week(?:'s|’s)?|today(?:'s|’s)?|their|his|her|my|our|your|the)\s+(?:tasks?|work|jobs?|things|stuff|list|to-?dos?)$/i;

const DAY = String.raw`(?:mon|tues|wednes|thurs|fri|satur|sun)day`;
const PART = String.raw`(?:\s+(?:morning|afternoon|evening|night))?`;
/** One time after "by", "before", "until", "on", "this" or "next": "Friday", "5pm", "end of the day", "next week". */
const WHEN = String.raw`(?:${DAY}${PART}|tomorrow${PART}|tonight|today|noon|midday|morning|afternoon|evening|week(?:end)?|month|end\s+of\s+(?:the\s+)?(?:day|week|month)|eod|eow|cob|\d{1,2}(?::\d{2})?\s*(?:am|pm)?)`;
/**
 * Times at the end of the task words, said for when it is wanted, not what it is about: "the invoice tomorrow", "the
 * budget by Friday", "the deck before 5pm", "the launch this week". Each piece starts with its own word, so the pattern
 * never has two ways to read the same words (no runaway backtracking).
 */
const WHEN_TAIL = new RegExp(String.raw`(?:\s+(?:(?:by|before|until|on|this|next)\s+(?:the\s+)?${WHEN}|(?:tomorrow|today)${PART}|tonight|asap|eod|eow|cob))+$`, "i");

/** What it is about, as words for planFollowUps to match against shared work; null for "their tasks", "it", "everything". */
function taskOf(what: string | undefined): string | null {
  if (!what) return null;
  const w = what.trim()
    // When it is wanted is not what it is about: "the invoice tomorrow", "the budget by Friday", "the deck by 5pm".
    .replace(WHEN_TAIL, "")
    .replace(/\s+(?:today|now|right\s+now|this\s+week|so\s+far|at\s+the\s+moment)$/i, "")
    .replace(/^(?:the|a|an)\s+/i, "")
    .trim();
  if (!w || ANY_WORK.test(w)) return null;
  const words = w.replace(/\s+(?:task|ticket|job)$/i, "").trim();
  return words && !ANY_WORK.test(words) ? words : null;
}

/** The person's sentence without the politeness around it: "Hey Max, can you please follow up with Ben for me?" */
function core(text: string): string {
  return text.replace(/\s+/g, " ").trim()
    .replace(/[?.!\s]+$/, "")
    .replace(/^(?:(?:hey|hi|hello|ok|okay)(?:\s+[\p{L}]+)?\s*,\s*)/iu, "")
    .replace(/^(?:(?:please|can\s+you|could\s+you|would\s+you|will\s+you|kindly)\s+)+/i, "")
    .replace(/(?:\s*,)?\s+(?:for\s+me|please)$/i, "")
    .trim();
}

/**
 * More than one thing written at once: a pasted to-do list ("Follow up with Ben about the invoice\nSend the deck to
 * Ada"), items after semicolons or list marks. Never one follow-up: the to-do path reads those (correctness review,
 * 8 October 2026: the task words swallowed every other line).
 */
// Exported for the helper's ear for other people's assistants (assistant-talk-intent.ts; owner decision, 8 October
// 2026: personal assistants, phase 6), which holds itself to the same rule.
export const SEVERAL = /[\r\n\u2028\u2029;]|(?:^|\s)[-*•]\s|(?:^|\s)\d+[.)]\s/;

/** What a follow-up sentence asks for, or null when it is not one. */
export function followUpIntent(text: string): FollowUpIntent | null {
  if (SEVERAL.test(text.trim())) return null;
  const typed = text.replace(/\s+/g, " ").trim();
  if (!typed || TO_DO.test(typed)) return null;
  const t = core(typed);
  if (!t || TO_DO.test(t)) return null;
  if (STATUS.some((re) => re.test(t))) return { kind: "status" };
  for (const p of PATTERNS) {
    const m = p.re.exec(t);
    if (!m) continue;
    const who = (m[p.who] ?? "").trim();
    if (!who) continue;
    const task = taskOf(p.what ? m[p.what] : undefined);
    const question = null;
    const team = teamOf(who);
    if (team) return { kind: "ask", people: [], team, task, question };
    const people = peopleOf(who);
    if (people) return { kind: "ask", people, team: null, task, question };
  }
  return null;
}
