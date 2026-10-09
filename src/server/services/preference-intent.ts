/**
 * "How I like things done" in the chat (owner decisions, 8–9 October 2026: phase 7c, contract D.3). A person's assistant
 * never learns silently: it offers to remember a preference only when the person says "remember that …", or has corrected
 * it the same way twice in this chat, and remembering always waits for their own Confirm (copilot's remember_preference,
 * the 'preference_consent' floor). "Forget that …" offers to forget one, behind the same Confirm.
 *
 * Pure, cheap and deterministic (unit-tested in tests/unit/preference-intent.test.ts), and only ever from the person's own
 * words in this chat: the user messages the client sent (the last 20), never an assistant message and never a tool
 * result, so nothing someone else wrote can become a preference. "Remember to …" is a reminder (remind_me), never a
 * preference.
 */
import { cleanPreference, PREFERENCE_LIMITS } from "@/lib/preferences";

/** "remember that I like short replies" → "I like short replies"; never "remember to …" (a reminder). */
// A question mark is accepted at the end too ("Can you remember that I sign off with —O?"), and left out of the words
// (owner decisions, 8–9 October 2026: phase 7c; the contract's pattern took only "." and "!").
const REMEMBER = /^\s*(?:please\s+)?(?:can you\s+)?remember\s+(?:that\s+)?(?!to\b)(.{3,200}?)[.!?]?\s*$/i;
/** "forget that I sign off with my initials" → the words to look for among the person's preferences. */
const FORGET = /^\s*(?:please\s+)?forget\s+(?:that\s+)?(.{3,200}?)[.!?]?\s*$/i;
/**
 * A correction of how the assistant works for the person: don't / stop / never / always / too long / shorter / call me /
 * sign off with / I prefer … ("I'd rather" read as written: the contract's "i ['’]d rather" never matched it).
 */
const CORRECTION = /\b(?:don['’]?t|do not|stop|no more|never|always|please (?:always|don['’]?t)|too (?:long|short|formal|casual|wordy)|shorter|briefer|less formal|more formal|call me|sign (?:off|it) (?:with|as)|i (?:prefer|like|want|would rather)|i['’]d rather)\b/i;
/** A correction is a short message; a long one is a request, not a style note. */
const CORRECTION_MAX = 200;

/**
 * Words that say nothing about what the correction is about: articles, pronouns and the correction cues themselves, so two
 * different corrections ("don't use emoji", "don't send the deck") never meet on "don't" alone.
 */
const STOP = new Set([
  "the", "and", "for", "with", "that", "this", "these", "those", "you", "your", "yours", "mine", "our", "ours", "them", "they", "their", "its",
  "are", "was", "were", "been", "being", "have", "has", "had", "can", "could", "would", "should", "will", "shall", "may", "might", "must",
  "please", "pls", "just", "really", "very", "also", "any", "all", "some", "more", "less", "too", "not", "don", "dont", "doesn", "didn",
  "stop", "never", "always", "again", "prefer", "like", "want", "rather", "would", "instead", "about", "from", "into", "when", "what", "how",
  "but", "then", "than", "there", "here", "okay", "yes", "thank", "thanks", "remember", "forget", "use", "using", "one", "ones",
]);

/**
 * What a preference is about: the person ("I", "my", "me") or how the assistant should write or work for them ("always",
 * "never", "keep", "use", "sign off"…). "Remember the client call is at 3" has none of these: a fact, not a preference
 * (fix review, 9 October 2026), and the helper's other answers take it.
 */
const STYLE_CUE = /\b(?:i|i['’]m|i['’]d|i['’]ll|i['’]ve|my|me|mine|myself|always|never|don['’]?t|do not|keep|use|avoid|prefer|sign(?:s|ed)? (?:off|it)|call me|write|reply|replies|answer|answers|tone|short|shorter|brief|formal|casual|emoji|bullet|bullets|format|language)\b/i;
/** A second question or clause after the words ("Forget the meeting notes, what's due today?"): not a forget request. */
const ANOTHER_ASK = /\?|[,;:]\s*(?:what|when|where|who|why|how|which|can|could|would|will|is|are|do|does|did|and then|then|also)\b/i;

/** One line: whitespace runs as one space, trimmed (lib/preferences' rule). */
const tidy = (s: string) => cleanPreference(String(s ?? ""));

/** The words to remember when the person's message is "remember that …"; null otherwise. */
export function rememberIntent(text: string): string | null {
  const m = REMEMBER.exec(String(text ?? ""));
  if (!m) return null;
  const words = tidy(m[1]);
  if (words.length < 3 || ANOTHER_ASK.test(words) || !STYLE_CUE.test(words)) return null;
  return words;
}

/** The words to look for when the person's message is "forget that …"; null otherwise. */
export function forgetIntent(text: string): string | null {
  const m = FORGET.exec(String(text ?? ""));
  if (!m) return null;
  const words = tidy(m[1]);
  if (words.length < 3 || ANOTHER_ASK.test(words)) return null;
  return words;
}

/** "Forget that …" or "forget my preference …": surely about a preference, even when none fits (then "I couldn't find it"). */
export const FORGET_SURE = /^\s*(?:please\s+)?forget\s+(?:that\b|my\s+(?:preference|rule)\b|the\s+(?:preference|rule)\b)/i;

/** A word as the keys compare it: lower case, letters only, a trailing "ing", "ed" or "s" taken off; null under 3 letters. */
function stem(w: string): string | null {
  let s = w.toLowerCase().replace(/[^\p{L}]/gu, "");
  if (!s) return null;
  if (s.length > 5 && s.endsWith("ing")) s = s.slice(0, -3);
  else if (s.length > 4 && s.endsWith("ed")) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith("s")) s = s.slice(0, -1);
  return s.length >= 3 ? s : null;
}

/** The content words of any text (the same normalisation as correctionKey), each once. */
export function contentWordsOf(text: string): string[] {
  const out = new Set<string>();
  for (const raw of String(text ?? "").normalize("NFKD").replace(/\p{M}+/gu, "").split(/[^\p{L}]+/u)) {
    if (!raw || STOP.has(raw.toLowerCase())) continue;
    const s = stem(raw);
    if (s && !STOP.has(s)) out.add(s);
  }
  return [...out];
}

/** A short message that corrects how the assistant works (CORRECTION), as its content words; null when it is not one. */
export function correctionKey(text: string): string[] | null {
  const t = String(text ?? "").trim();
  if (!t || t.length > CORRECTION_MAX || !CORRECTION.test(t)) return null;
  return contentWordsOf(t);
}

/** Jaccard similarity of two keys (0 when either is empty). */
function jaccard(a: string[], b: string[]): { shared: number; score: number } {
  const x = new Set(a), y = new Set(b);
  if (!x.size || !y.size) return { shared: 0, score: 0 };
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return { shared, score: shared / (x.size + y.size - shared) };
}

/** At most `max` characters, cut at a word boundary (no "…": a preference is the person's own words, shorter). */
export function clipAtWord(s: string, max: number = PREFERENCE_LIMITS.chars): string {
  const t = tidy(s);
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1);
  const at = cut.lastIndexOf(" ");
  return (at > 0 ? cut.slice(0, at) : t.slice(0, max)).replace(/[\s,;:–—-]+$/u, "").trim();
}

/**
 * The latest user message corrects the assistant the same way an earlier one did: their keys share at least 2 words and
 * a Jaccard of 0.5 or more. The candidate is the latest message, cleaned and clipped to 150 characters at a word. Only
 * the latest message counts as the second time ("has now said it twice"), so an old pair is never offered later.
 */
export function repeatedCorrection(userMessages: string[]): string | null {
  const msgs = userMessages.map((m) => String(m ?? ""));
  if (msgs.length < 2) return null;
  const latest = msgs[msgs.length - 1];
  const key = correctionKey(latest);
  if (!key || key.length < 2) return null;
  for (let i = msgs.length - 2; i >= 0; i--) {
    const other = correctionKey(msgs[i]);
    if (!other) continue;
    const j = jaccard(key, other);
    if (j.shared >= 2 && j.score >= 0.5) {
      const text = clipAtWord(latest);
      return text.length >= 3 ? text : null;
    }
  }
  return null;
}

/** Tokens content words leave out: anything with a digit, an "@" or a dot inside ("0803…", "ada@x.test", "x.com/notes"). */
const MARKED = /[^\s"“”'‘’(),;!?]*(?:\d|@|\w\.\w)[^\s"“”'‘’(),;!?]*/gu;
const markedOf = (s: string) => (String(s ?? "").match(MARKED) ?? []).map((t) => t.replace(/[.:]+$/u, "").toLowerCase()).filter(Boolean);

/**
 * Whether the person's own words in this chat hold every content word of `text` (a preference in their own words), and
 * every number, address or link-like token in it as written (fix review, 9 October 2026: those were not compared).
 */
export function inOwnWords(text: string, userMessages: string[]): boolean {
  const own = new Set(userMessages.flatMap((m) => contentWordsOf(m)));
  if (!contentWordsOf(text).every((w) => own.has(w))) return false;
  const said = userMessages.map((m) => String(m ?? "").toLowerCase()).join("\n");
  return markedOf(text).every((t) => said.includes(t));
}

export type PreferenceOffer = { text: string; why: "asked" | "repeated" };

/**
 * What to offer to remember now, from the person's own messages in this chat (oldest first): "remember that …" in the
 * latest message ('asked'), else the same correction twice ('repeated'). Null when it is already one of their
 * preferences (case-insensitive), or when the chat already offered it ("Should I remember …" with those words in one of
 * the assistant's messages: offered once per chat). Assistant messages are only looked at for that.
 */
export function preferenceOffer(userMessages: string[], assistantMessages: string[], existing: string[]): PreferenceOffer | null {
  const latest = userMessages[userMessages.length - 1] ?? "";
  const asked = rememberIntent(latest);
  const offer: PreferenceOffer | null = asked ? { text: clipAtWord(asked), why: "asked" } : (() => { const r = repeatedCorrection(userMessages); return r ? { text: r, why: "repeated" as const } : null; })();
  if (!offer) return null;
  const lower = offer.text.toLowerCase();
  if (existing.some((e) => tidy(e).toLowerCase() === lower)) return null;
  if (assistantMessages.some((m) => /should i remember/i.test(m) && tidy(m).toLowerCase().includes(lower))) return null;
  return offer;
}

/**
 * The preference "forget that …" points at (contract D.3/F.1): the one whose words hold the person's words, or are held by
 * them (case-insensitive; the shortest such one when several do), else the one sharing the most content words with them
 * (at least half of either's); undefined when none fits.
 */
export function matchPreference<T extends { body: string }>(items: T[], words: string): T | undefined {
  const w = tidy(words).toLowerCase().replace(/[.!?]+$/, "");
  if (w.length < 3 || !items.length) return undefined;
  const holds = items.filter((p) => p.body.toLowerCase().includes(w)).sort((a, b) => a.body.length - b.body.length);
  if (holds[0]) return holds[0];
  const held = items.filter((p) => w.includes(tidy(p.body).toLowerCase().replace(/[.!?]+$/, ""))).sort((a, b) => b.body.length - a.body.length);
  if (held[0]) return held[0];
  const key = contentWordsOf(w);
  let best: { p: T; score: number } | null = null;
  for (const p of items) {
    const other = contentWordsOf(p.body);
    const shared = other.filter((x) => key.includes(x)).length;
    const score = shared / Math.max(1, Math.min(key.length, other.length));
    if (shared && score >= 0.5 && (!best || score > best.score)) best = { p, score };
  }
  return best?.p;
}
