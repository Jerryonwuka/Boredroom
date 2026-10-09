/**
 * The cheap first look for commitments and loose ends (owner decisions, 8 October 2026: phase 7b, "Brenda keeps the loops
 * closed", second part). Before any model sees a message, fixed rules read it: does it promise work ("I'll send the deck
 * Thursday"), ask a named person for work ("Ben, can you fix the login bug by Friday?"), or agree to an ask someone just
 * made of the writer ("On it")? Each gets a score from 0 to 1; only messages at or above LOOP_LIMITS.prefilterMin (0.35)
 * go on to the model, and without the model only those at or above LOOP_LIMITS.builtinAccept (0.7) are kept, with the
 * work and the date read from the words here (`what`, `dueWords`).
 *
 * Pure: no database, no clock of its own, no model (tests/unit/commitment-prefilter.test.ts). Used by the workspace's
 * scan of tracked group conversations (commitment-detect.ts, the worker) and by the person's own loose-ends scan
 * (loose-end-detect.ts, as the person). Nothing here decides anything on its own: a score only says whether a message is
 * worth a closer look, and every person it names is one of the conversation's current readers (`readers`), never the
 * writer.
 *
 * Decisions recorded here (phase 7b, 8 October 2026):
 * - an agreement ("On it", "np", "ok") is often shorter than the 6-character floor, so the floor applies only to promises
 *   and asks;
 * - a courtesy "thanks"/"thank you"/"cheers" at either end of a message is politeness, not a negative ("Ben, can you
 *   review it by Friday? Thanks"); "thanks for …" elsewhere still is;
 * - a trailing vocative ("Can you send it by Friday, Ben?") names the addressee as a leading one does;
 * - an agreement that carries a negative ("Sure, I'll try") loses 0.4 as a promise does, so the built-in path never takes
 *   a "maybe" for a yes (the model still sees it when it scores 0.35 or more).
 *
 * Review, 9 October 2026 (the built-in path labels "Noted" for the whole channel, so it must not over-reach):
 * - "let me know …" is a request, not a promise; a state ("I will be out of office tomorrow", "I'm going to be late",
 *   "I'll be working from home") is not a promise in any of its long forms either;
 * - a promise or an agreement that is negated ("I will not be able to …", "I don't think I'll make it", "Ok but I can't
 *   do it until next week", "Yes, but Ada is better placed") loses 0.4 (NEGATED, REFUSAL);
 * - words in quotes that themselves promise or ask (`Ben said "I'll send the deck Thursday"`) and inline code are
 *   someone else's words: they are left out;
 * - on a tie an agreement wins, then a promise, then an ask (`signals[0]` is the reading the built-in path takes), so
 *   "Sure, I'll fix it by Friday" in reply to an ask is that ask agreed, not a second, separate promise;
 * - the built-in title is turned to the reader's side: in a promise "you"/"your" become the person it was made to, in
 *   an ask "me"/"my"/"I" become the person who asked ("Approve Ben's leave request", "Share the budget numbers with Ben").
 */
import { LOOP_LIMITS } from "@/lib/commitments";

export type PrefilterInput = {
  id: string; body: string; authorMembershipId: string; at: string;
  conversationKind: "direct" | "team" | "organisation" | "channel";
  /** message_mentions kind 'person' membership ids. */
  mentions: string[];
  /** The message this one replies to; `mentions` (optional) are its own person mentions. */
  replyTo: { id: string; authorMembershipId: string; body: string; at?: string; mentions?: string[] } | null;
  /** The newest earlier message in the conversation. */
  previous: { id: string; authorMembershipId: string; body: string; at: string; mentions?: string[] } | null;
};
/** A conversation's current reader (active member), with their display name. */
export type Reader = { membershipId: string; name: string };
export type PrefilterSignal = "promise" | "ask" | "agreement";
export type PrefilterResult = {
  score: number; signals: PrefilterSignal[];
  /** Who the message is addressed to (membership id); never the writer. */
  addressee: string | null;
  /** Built-in extraction (no model): the date words as written, and the work as a short imperative ("Send the deck"). */
  dueWords: string | null; what: string | null;
  /** For an agreement: the message it agrees to (the reply-to or the previous message), and who asked. */
  agreesTo?: { id: string; askerMembershipId: string } | null;
};

/** How far a message is read. */
const MAX_READ = 2000;
/** An agreement answers an ask made at most this long before it (unless it replies to it). */
const AGREE_WINDOW_MS = 30 * 60_000;
/** An agreement is a whole short message. */
const AGREE_MAX_CHARS = 80;

export const PROMISE = /\b(?:i'll|i will|i'm going to|i am going to|i'm gonna|i shall|let me|leave it with me|i'm on it|consider it done|i can (?:do|send|share|get|take|look at|handle|finish|fix|review|write|prepare|draft|update|check))\b/i;
export const AGREE = /^(?:ok(?:ay)?|sure|yes|yep|yeah|will do|on it|i'm on it|no problem|np|got it|consider it done|leave it with me|absolutely|of course|can do|i can do (?:it|that)|i'll do (?:it|that)|sounds good,? (?:i'll|will))\b/i;
export const ASK = /\b(?:can you|could you|would you|will you|can u|could u|pls|please|would you mind|are you able to|i need you to|need you to|make sure (?:you|to))\b/i;
const DATE_SRC = String.raw`\b(?:today|tonight|tomorrow|tmrw|eod|eow|cob|asap|end of (?:the )?(?:day|week|month)|this (?:morning|afternoon|evening|week)|next (?:week|month|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:rs(?:day)?)?|fri(?:day)?)|(?:by|on|before|until) (?:mon|tue|wed|thu|fri|sat|sun)[a-z]*|(?:mon|tues|wednes|thurs|fri|satur|sun)day|\d{1,2}(?:st|nd|rd|th)? (?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*|\d{1,2}(?::\d{2})? ?(?:am|pm))\b`;
export const DATE = new RegExp(DATE_SRC, "i");
const DATE_ALL = new RegExp(DATE_SRC, "gi");
const STATE = String.raw`(?:there|back|in|out|late|off|away|online|offline|around|free|busy|right back|on leave|on holiday|travell?ing|working (?:from home|remotely)|wfh|ooo|out of (?:the )?office|in the office|unavailable|available|at (?:home|the office))`;
export const NEGATIVE = new RegExp(String.raw`\b(?:(?:i'll|i will|i'm going to|i am going to|i'm gonna|i shall) be ${STATE}|i'll see|i'll think|i'll try|i'll let you know|let me know|if i|maybe|might|perhaps|i'd|i would|i wish|did you|have you|thank(?:s| you)|i'll never)\b`, "i");
/** A promise or an agreement said the other way round ("I will not be able to", "I don't think I'll make it"). */
export const NEGATED = /\b(?:not|never|can't|cannot|can not|won't|unable|don't think|doubt|no way)\b/i;
/** An agreement that is really a refusal or a hand-off ("Ok but I can't …", "Yes, but Ada is better placed"). */
const REFUSAL = /\b(?:but|however|though|although|except|unless)\b/i;
/** A courtesy at either end of a message ("Thanks, …", "… Thanks!", "cheers"): politeness, not a negative. */
const COURTESY = /^(?:thanks|thank you|thx|cheers)\b[\s,.!:;-]*|[\s,.!:;-]*\b(?:thanks|thank you|thx|cheers)(?: (?:so much|a lot|in advance))?[\s.!]*$/gi;
/** A greeting before a name ("Hey Ben, …"). */
const GREETING = /^(?:hi|hey|hello|ok|okay|so|and|also|right|morning|yo)$/i;

/**
 * One reading of a message: NFKC, curly quotes straight, quoted lines (">"), code blocks (```) and inline code (`…`) out,
 * words in double quotes that themselves promise or ask out (someone else's words), single spaces. Case kept.
 */
function clean(body: string): string {
  const s = String(body ?? "").slice(0, MAX_READ).normalize("NFKC")
    .replace(/```[\s\S]*?(?:```|$)/g, " ")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/[‘’ʼ`´]/g, "'").replace(/[“”«»„]/g, "\"")
    .replace(/"([^"\n]{1,400})"/g, (all, inner: string) => (PROMISE.test(inner) || ASK.test(inner) || AGREE.test(inner.trim()) ? " " : all));
  return s.split(/\r\n?|\n/).filter((l) => !/^\s*>/.test(l)).join(" ").replace(/\s+/g, " ").trim();
}

/** The text the rules read: lower case NFKC, ’ → ', quoted lines and code blocks out, whitespace collapsed, at most 2,000 characters. */
export function normaliseForPrefilter(body: string): string {
  return clean(body).toLowerCase();
}

/** Lower case, accents set aside, single spaces: how names are compared. */
const fold = (s: string) => String(s ?? "").normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();

/** The one reader called `full` (a whole display name) or `first` (a first name of at least 3 letters); null when none or several. */
function readerNamed(words: { full?: string | null; first?: string | null }, readers: Reader[], not: string): string | null {
  const others = readers.filter((r) => r.membershipId !== not);
  if (words.full) {
    const want = fold(words.full);
    const hit = others.filter((r) => fold(r.name) === want);
    if (hit.length === 1) return hit[0].membershipId;
    if (hit.length > 1) return null;
  }
  if (words.first && [...words.first].filter((c) => /\p{L}/u.test(c)).length >= 3) {
    const want = fold(words.first);
    const hit = others.filter((r) => fold(r.name).split(" ")[0] === want);
    if (hit.length === 1) return hit[0].membershipId;
  }
  return null;
}

const LEADING_VOCATIVE = /^@?([a-z][a-z'-]{1,30})(?: ([a-z][a-z'-]{1,30}))?[,:]/;
const TRAILING_VOCATIVE = /,\s*@?([a-z][a-z'-]{1,30})(?: ([a-z][a-z'-]{1,30}))?\s*[?.!]*$/;

/** A name said at the start ("Ben, …", "Hey Ben, …", "Ben Okafor: …") or at the end ("…, Ben?"), as one reader. */
function vocative(text: string, readers: Reader[], writer: string): string | null {
  const t = fold(text);
  const lead = LEADING_VOCATIVE.exec(t);
  if (lead) {
    const [, a, b] = lead;
    const hit = b ? readerNamed({ full: `${a} ${b}`, first: GREETING.test(a) ? b : null }, readers, writer) : readerNamed({ first: a }, readers, writer);
    if (hit) return hit;
  }
  const tail = TRAILING_VOCATIVE.exec(t);
  if (tail) {
    const [, a, b] = tail;
    const hit = b ? readerNamed({ full: `${a} ${b}` }, readers, writer) : readerNamed({ first: a }, readers, writer);
    if (hit) return hit;
  }
  return null;
}

type Context = { authorMembershipId: string; body: string; mentions?: string[] };

/**
 * Who a message is addressed to, first match wins: a person mention; a vocative that names one reader; in a direct
 * thread the other person; for an ask or an agreement, the author of the message it replies to. Never the writer.
 */
function addresseeOf(m: Context, readers: Reader[], o: { otherInDirect?: string | null; replyAuthor?: string | null; askOrAgree: boolean }): string | null {
  const writer = m.authorMembershipId;
  const mention = (m.mentions ?? []).find((id) => id && id !== writer);
  if (mention) return mention;
  const named = vocative(clean(m.body), readers, writer);
  if (named) return named;
  if (o.otherInDirect && o.otherInDirect !== writer) return o.otherInDirect;
  if (o.askOrAgree && o.replyAuthor && o.replyAuthor !== writer) return o.replyAuthor;
  return null;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, Math.round(n * 100) / 100));
const withoutCourtesy = (s: string) => s.replace(COURTESY, " ").trim();

/** The ask score of a message on its own (used for the message an agreement answers). */
function askScore(text: string, hasAddressee: boolean): number {
  if (!ASK.test(text)) return 0;
  const plain = withoutCourtesy(text);
  return clamp01((hasAddressee ? 0.45 : 0.2) + (DATE.test(text) ? 0.2 : 0) + (/\?\s*$/.test(plain) ? 0.1 : 0) - (NEGATIVE.test(plain) ? 0.4 : 0));
}

/** The first date words in the message, as written (one line, at most 60 characters), or null. */
function dateWords(text: string): string | null {
  const m = DATE.exec(text);
  return m ? m[0].replace(/\s+/g, " ").trim().slice(0, LOOP_LIMITS.dueWordsMax) : null;
}

/** "Ben" from "Ben Okafor"; null for nothing usable. */
const firstOf = (name: string | null | undefined) => {
  const f = String(name ?? "").trim().split(/\s+/)[0] ?? "";
  return /\p{L}/u.test(f) ? f : null;
};

/**
 * The work turned to the reader's side (review, 9 October 2026). A promise is read by its writer: "you"/"your" were the
 * person it was made to ("Share the numbers with you" → "Share the numbers with Ben", or "them"). An ask is read by the
 * person asked: "me"/"my"/"mine"/"I" were the person asking ("Approve my leave request" → "Approve Ben's leave request").
 */
function fromReadersSide(text: string, signal: PrefilterSignal, names: { writer?: string | null; addressee?: string | null }): string {
  if (signal === "promise") {
    const who = firstOf(names.addressee);
    return text.replace(/\byourselves\b|\byourself\b/gi, who ?? "them")
      .replace(/\byours\b/gi, who ? `${who}'s` : "theirs")
      .replace(/\byour\b/gi, who ? `${who}'s` : "their")
      .replace(/\byou\b/gi, who ?? "them");
  }
  if (signal === "ask") {
    const who = firstOf(names.writer);
    return text.replace(/\bmyself\b/gi, who ?? "them")
      .replace(/\bmine\b/gi, who ? `${who}'s` : "theirs")
      .replace(/\bmy\b/gi, who ? `${who}'s` : "their")
      .replace(/\bme\b/gi, who ?? "them")
      .replace(/\bI'm\b/g, who ? `${who} is` : "they are")
      .replace(/\bI've\b/g, who ? `${who} has` : "they have")
      .replace(/\bI\b/g, who ?? "they");
  }
  return text;
}

/**
 * The work in the message's own words, after its trigger ("I'll", "can you") to the end of the sentence, with the date
 * words and any leading "to", "just" or "also" taken out, first letter capitalised, at most 120 characters; null when
 * fewer than two words are left. "I'll send the deck Thursday" → "Send the deck".
 */
export function builtinTitle(body: string, signal: PrefilterSignal, names: { writer?: string | null; addressee?: string | null } = {}): string | null {
  if (signal === "agreement") return null;
  const text = clean(body);
  const re = signal === "promise" ? PROMISE : ASK;
  const m = re.exec(text);
  if (!m) return null;
  let rest = text.slice(m.index + m[0].length);
  // "please" in an ask may come after the work ("send it please"): the work is then what came before it.
  if (signal === "ask" && /^(?:pls|please)$/i.test(m[0]) && !/\p{L}/u.test(rest.split(/[.!?;]/)[0] ?? "")) rest = text.slice(0, m.index);
  rest = rest.split(/[.!?;\n]|\s[-–—]\s/)[0] ?? "";
  rest = rest.replace(DATE_ALL, " ").replace(/\b(?:please|pls|thanks|thank you|for me|asap)\b/gi, " ").replace(/\s+/g, " ").trim();
  rest = rest.replace(/^(?:,\s*)?(?:to|just|also|quickly|then|go ahead and|definitely)\s+/i, "").replace(/^(?:to|just|also)\s+/i, "");
  // Dangling words left where a date was ("… by", "… on").
  for (let i = 0; i < 3; i++) rest = rest.replace(/[\s,]+(?:by|on|before|until|for|at|and|so|then|the)$/i, "").trim();
  rest = rest.replace(/^[,:\s-]+|[,:\s-]+$/g, "").trim();
  if (rest.split(/\s+/).filter((w) => /\p{L}/u.test(w)).length < 2) return null;
  rest = fromReadersSide(rest, signal, names);
  const clipped = rest.length > LOOP_LIMITS.whatMax ? `${rest.slice(0, LOOP_LIMITS.whatMax - 1).trimEnd()}…` : rest;
  return `${clipped[0].toLocaleUpperCase("en-GB")}${clipped.slice(1)}`;
}

/**
 * Scores one message (contract B.1). promise = 0.5 + 0.2 (a date) + 0.1 (two words or more after the trigger) − 0.4 (a
 * negative) − 0.2 (it ends with "?"); ask = 0.45 with an addressee (0.2 without) + 0.2 (a date) + 0.1 ("?") − 0.4 (a
 * negative); agreement = 0.6 when the whole short message agrees and the message it replies to (or the one before it,
 * within 30 minutes) is someone else's ask of the writer scoring 0.45 or more, + 0.2 when that ask had a date. The
 * score is the highest of the three; `signals` are those at 0.35 or more.
 */
export function prefilter(m: PrefilterInput, readers: Reader[], o: { otherInDirect?: string | null } = {}): PrefilterResult {
  const none: PrefilterResult = { score: 0, signals: [], addressee: null, dueWords: null, what: null, agreesTo: null };
  const text = normaliseForPrefilter(m.body);
  if (!text) return none;
  const writer = m.authorMembershipId;
  const otherInDirect = m.conversationKind === "direct" ? (o.otherInDirect ?? null) : null;
  const short = text.replace(/[^\p{L}\p{N}]+/gu, "").length < LOOP_LIMITS.minMessageChars;
  const negative = NEGATIVE.test(withoutCourtesy(text));
  const negated = NEGATED.test(text);
  const hasDate = DATE.test(text);
  const question = /\?\s*$/.test(withoutCourtesy(text));

  // Promise.
  let promise = 0;
  const pm = !short ? PROMISE.exec(text) : null;
  if (pm) {
    const after = text.slice(pm.index + pm[0].length).split(/[.!?;]/)[0] ?? "";
    const words = after.split(/\s+/).filter((w) => /\p{L}/u.test(w)).length;
    promise = clamp01(0.5 + (hasDate ? 0.2 : 0) + (words >= 2 ? 0.1 : 0) - (negative || negated ? 0.4 : 0) - (question ? 0.2 : 0));
  }

  // Ask.
  const replyAuthor = m.replyTo?.authorMembershipId ?? null;
  const addressee = addresseeOf({ authorMembershipId: writer, body: m.body, mentions: m.mentions }, readers, { otherInDirect, replyAuthor, askOrAgree: true });
  const ask = short ? 0 : askScore(text, !!addressee);

  // Agreement: the whole short message agrees to someone else's recent ask of the writer.
  let agreement = 0;
  let agreesTo: PrefilterResult["agreesTo"] = null;
  let askOf: { body: string } | null = null;
  if (text.length <= AGREE_MAX_CHARS && AGREE.test(text)) {
    const at = Date.parse(m.at);
    const prev = m.previous && Number.isFinite(at) && at - Date.parse(m.previous.at) <= AGREE_WINDOW_MS && at >= Date.parse(m.previous.at) ? m.previous : null;
    const ctx = m.replyTo && m.replyTo.authorMembershipId !== writer ? m.replyTo : prev && prev.authorMembershipId !== writer ? prev : null;
    if (ctx) {
      const ctxText = normaliseForPrefilter(ctx.body);
      // Who that message asked: its mention or vocative, or (in a direct thread) the writer of this one.
      const asked = addresseeOf({ authorMembershipId: ctx.authorMembershipId, body: ctx.body, mentions: ctx.mentions }, readers,
        { otherInDirect: m.conversationKind === "direct" ? writer : null, replyAuthor: null, askOrAgree: true });
      const s = askScore(ctxText, !!asked);
      if (asked === writer && s >= 0.45) {
        agreement = clamp01(0.6 + (DATE.test(ctxText) ? 0.2 : 0) - (negative || negated || REFUSAL.test(text) ? 0.4 : 0));
        agreesTo = { id: ctx.id, askerMembershipId: ctx.authorMembershipId };
        askOf = { body: ctx.body };
      }
    }
  }

  const score = Math.max(promise, ask, agreement);
  if (score <= 0) return none;
  // Stable sort: on a tie an agreement comes first, then a promise, then an ask (as `top`).
  const signals = ([["agreement", agreement], ["promise", promise], ["ask", ask]] as [PrefilterSignal, number][])
    .filter(([, s]) => s >= LOOP_LIMITS.prefilterMin).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const top: PrefilterSignal = agreement >= promise && agreement >= ask && agreement > 0 ? "agreement" : promise >= ask ? "promise" : "ask";
  const original = clean(m.body);
  const nameOf = (id: string | null | undefined) => (id ? readers.find((r) => r.membershipId === id)?.name ?? null : null);
  const what = top === "agreement"
    ? (askOf && agreesTo ? builtinTitle(askOf.body, "ask", { writer: nameOf(agreesTo.askerMembershipId) }) : null)
    : builtinTitle(m.body, top, { writer: nameOf(writer), addressee: nameOf(top === "promise" ? (addressee ?? otherInDirect) : addressee) });
  const due = dateWords(original) ?? (top === "agreement" && askOf ? dateWords(clean(askOf.body)) : null);
  return {
    score, signals,
    addressee: top === "agreement" ? (agreesTo?.askerMembershipId ?? null) : addressee,
    dueWords: due, what, agreesTo,
  };
}
