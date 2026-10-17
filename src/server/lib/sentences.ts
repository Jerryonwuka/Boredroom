/**
 * Sentences as they stream in (Brenda for Mac, phase 2; owner request, 12 October 2026: "short spoken answers first,
 * streamed"; contract D.6.5). The look turn's words arrive in pieces; each complete sentence is spoken as soon as it is
 * whole, so her first sound comes after her first sentence rather than her whole answer.
 *
 * A sentence ends after ".", "!", "?" or "…" (and any closing quotes or brackets) followed by whitespace; never inside a
 * number such as 3.5 (no whitespace follows the point), and never after "e.g.", "i.e.", "etc.", "vs.", "Mr.", "Mrs.",
 * "Ms.", "Dr." or "No.". Whatever is left when the answer ends is the last sentence (`flush`). Pure; no I/O.
 */

const END = /[.!?…]+["'”’)\]]*(?=\s)/g;
const ABBREVIATIONS_ANY_CASE = ["e.g.", "i.e.", "etc.", "vs."];
const ABBREVIATIONS = ["Mr.", "Mrs.", "Ms.", "Dr.", "No."];

/** Whether the text up to and including `end` finishes with an abbreviation, so it is not a sentence end. */
function abbreviationAt(text: string, end: number): boolean {
  const before = text.slice(0, end);
  const lastWord = before.slice(before.search(/\S+$/));
  if (ABBREVIATIONS.includes(lastWord)) return true;
  const lower = lastWord.toLowerCase();
  return ABBREVIATIONS_ANY_CASE.some((a) => lower === a || lower.endsWith(`(${a}`));
}

/** The complete sentences at the start of `text` and what is left after them (not yet a whole sentence). */
export function takeSentences(text: string): { sentences: string[]; rest: string } {
  const sentences: string[] = [];
  let start = 0;
  END.lastIndex = 0;
  for (let m = END.exec(text); m; m = END.exec(text)) {
    const end = m.index + m[0].length;
    if (abbreviationAt(text, end)) continue;
    const s = text.slice(start, end).trim();
    if (s) sentences.push(s);
    start = end;
  }
  return { sentences, rest: text.slice(start) };
}

/** Every sentence of a finished text. */
export function splitSentences(text: string): string[] {
  const { sentences, rest } = takeSentences(String(text ?? ""));
  const last = rest.trim();
  return last ? [...sentences, last] : sentences;
}

/** A buffer the stream's text pieces go into: `push` returns the sentences it completed; `flush` the rest at the end. */
export class SentenceBuffer {
  private buf = "";

  push(piece: string): string[] {
    this.buf += piece;
    const { sentences, rest } = takeSentences(this.buf);
    this.buf = rest;
    return sentences;
  }

  flush(): string[] {
    const last = this.buf.trim();
    this.buf = "";
    return last ? [last] : [];
  }
}
