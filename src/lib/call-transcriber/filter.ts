/**
 * What a person's own device wrote down, made into one clean line before it is sent (owner decisions, 8 October 2026:
 * phase 8, Brenda's notes on calls; contract E.3). Pure and unit-tested.
 *
 * One line (control characters become spaces, runs of spaces one), at most 1000 characters. Whisper makes words up from
 * silence and noise; those lines are dropped: empty, only punctuation, only a bracketed or parenthesised tag
 * ("[BLANK_AUDIO]", "(music)"), and the phrases it is known to invent ("Thank you.", "Thanks for watching!", "Thank you for
 * watching.", "you", "Bye.") when they are the whole line. A phrase repeated three or more times in a row (another
 * Whisper habit) is kept once.
 */
import { NOTES_LIMITS } from "@/lib/call-notes";

/** The exact lines Whisper invents from silence (compared case-sensitively and as the whole line, after trimming). */
export const MADE_UP_LINES: readonly string[] = ["Thank you.", "Thanks for watching!", "Thank you for watching.", "you", "Bye."];

const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g;
/** Only punctuation, symbols and spaces. */
const ONLY_PUNCTUATION = /^[\p{P}\p{S}\s]*$/u;
/** Only tags: "[BLANK_AUDIO]", "(music)", "[Music] (applause)". */
const ONLY_TAGS = /^(?:\s*(?:\[[^\]]*\]|\([^)]*\)))+\s*$/;

/** Cuts at `max` characters without splitting a character's two halves (an emoji). */
function cut(s: string, max: number): string {
  if (s.length <= max) return s;
  let end = max;
  const code = s.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return s.slice(0, end).trimEnd();
}

/**
 * A phrase of 1 to 12 words said three or more times in a row, kept once: "I think I think I think we should" →
 * "I think we should". Words are compared without case and trailing punctuation.
 */
export function collapseRepeats(text: string): string {
  const words = text.split(" ");
  if (words.length < 3) return text;
  const norm = (w: string) => w.toLowerCase().replace(/[\p{P}]+$/u, "");
  const out: string[] = [];
  let i = 0;
  while (i < words.length) {
    let done = false;
    for (let n = Math.min(12, Math.floor((words.length - i) / 3)); n >= 1; n--) {
      const phrase = words.slice(i, i + n).map(norm);
      let reps = 1;
      while (i + (reps + 1) * n <= words.length && words.slice(i + reps * n, i + (reps + 1) * n).map(norm).every((w, k) => w === phrase[k])) reps++;
      if (reps >= 3) {
        // Keep the last repetition (its punctuation ends the phrase as it was said last).
        out.push(...words.slice(i + (reps - 1) * n, i + reps * n));
        i += reps * n;
        done = true;
        break;
      }
    }
    if (!done) { out.push(words[i]); i++; }
  }
  return out.join(" ");
}

/** One line as it may be sent, or null when there is nothing worth keeping. */
export function cleanLine(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.replace(CONTROL, " ").replace(/\s+/g, " ").trim();
  if (!s) return null;
  if (ONLY_PUNCTUATION.test(s) || ONLY_TAGS.test(s)) return null;
  if (MADE_UP_LINES.includes(s)) return null;
  s = collapseRepeats(s);
  s = cut(s, NOTES_LIMITS.lineMax);
  return s || null;
}
