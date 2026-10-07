/**
 * What she says out loud (owner decision, 7 October 2026: her voice, personal assistants phase 2). Her replies are
 * Markdown written to be read; spoken, they need to be short and plain. This turns a reply into one line of speakable
 * text: no Markdown, no code or tables, links as their words, and never a URL, a path, an email address, an id or a
 * token (a string of hex read aloud is noise, and an address or a token read aloud in an open office is a leak). It
 * says the opening prose (three sentences at most) and the list items as short sentences, about 400 characters in all,
 * ending at a sentence boundary; a list that does not fit ends with "And 4 more." The rest stays on the screen.
 *
 * Pure and dependency-free: the web speaks it (assistant-speech/controller) and the chat route sends it to the notch as
 * `spoken`, so both say the same words. Every rule has a test in tests/unit/assistant-speech.test.ts.
 *
 * Linear time whatever it is given (review, 7 October 2026): the server runs it on every reply, so a long unbroken run
 * (a pasted key, a base64 blob) must never stall it. Only the opening of a reply is ever said, so only its first
 * MAX_SOURCE characters are read (cut at a line end), and every pattern that could rescan the rest of a line from each
 * position has a bounded quantifier.
 */

export type SpeakableOptions = { maxChars?: number; maxSentences?: number };

/** How much of a reply is read at all: room for the first paragraph and a long list's items, far beyond 400 said. */
const MAX_SOURCE = 6000;

type Unit = { kind: "sentence" | "item" | "label"; text: string };

/** Stands in for a backslash-escaped character until the Markdown is gone (a private-use character, never typed). */
const ESC = "";
const ESCAPED = /\\([\\`*_{}[\]()<>#+\-.!|~])/g;
const PLACEHOLDER = /(\d+)/g;

// Emoji and what holds them together (variation selectors, joiners, skin tones, keycaps, flags): she would read their
// names ("smiling face with smiling eyes"), which is never what the reply meant.
const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\u{FE0E}\u{FE0F}\u{200D}\u{20E3}]/gu;

/** A URL's trailing punctuation belongs to the sentence (and a ")" to the brackets around it, unless the URL opened one). */
function giveBack(m: string): string {
  const tail = /[.,;:!?)]+$/.exec(m)?.[0] ?? "";
  const body = m.slice(0, m.length - tail.length);
  let open = (body.match(/\(/g) ?? []).length - (body.match(/\)/g) ?? []).length;
  let out = "";
  for (const c of tail) {
    if (c === ")" && open > 0) { open--; continue; }
    out += c;
  }
  return out;
}

// HTML entities: the common named ones and every numeric one (a stray "&lt;" or "&#39;" is never read as letters).
const NAMED: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…", ndash: "–", mdash: "—", middot: "·", copy: "©", reg: "®", trade: "™", euro: "€", pound: "£" };
const ENTITY = /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z]{2,8}));/g;
function entity(m: string, dec?: string, hex?: string, name?: string): string {
  if (name) return NAMED[name.toLowerCase()] ?? m;
  const code = dec ? Number(dec) : parseInt(hex ?? "", 16);
  if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return " ";
  return code === 0xa0 ? " " : String.fromCodePoint(code);
}

/** Inline Markdown to words (escaped characters stay as placeholders, so nothing here mistakes them for marks). */
function inline(s: string): string {
  return s
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/(`+)[\s\S]*?\1/g, " ") // code spans go with their content
    .replace(/<(?:(?:https?|ftp):\/\/|mailto:|www\.)[^\s>]*>/gi, " ") // autolinks
    .replace(/<[^\s<>@]{1,64}@[^\s<>]{1,255}>/g, " ")
    .replace(/<\/?[A-Za-z][\w:-]*(?:\s[^<>]*)?\/?>/g, " ") // HTML tags (the words between them stay)
    // Bracketed text holds no bracket and is read as `(?=(…))\1`, which never gives back what it took (as a possessive
    // quantifier would), so a run of unclosed brackets is not rescanned from every one of them.
    .replace(/!\[(?=([^[\]\n]{0,500}))\1\]\((?:[^()\s]|\([^()\n]{0,500}\)){0,2000}(?:\s+(?:"[^"\n]{0,500}"|'[^'\n]{0,500}'))?\)/g, " ") // images
    .replace(/!\[(?=([^[\]\n]{0,500}))\1\]\[[^\]\n]{0,500}\]/g, " ")
    .replace(/\[\^[^\]\n]{0,100}\]/g, "") // footnote marks
    .replace(/\[(?=([^[\]\n]{0,500}))\1\]\((?:[^()\s]|\([^()\n]{0,500}\)){0,2000}(?:\s+(?:"[^"\n]{0,500}"|'[^'\n]{0,500}'))?\)/g, "$1") // links: their words
    .replace(/\[(?=([^[\]\n]{1,500}))\1\]\[[^\]\n]{0,500}\]/g, "$1")
    .replace(ENTITY, entity)
    .replace(/\*+|~~/g, "") // emphasis (underscores wait until the tokens are gone: snake_case ids must stay whole)
    .replace(EMOJI, "")
    // Never read: URLs, app paths, email addresses, ids and token-like runs.
    .replace(/\b(?:https?|ftp):\/\/\S+|\bwww\.\S+|\bmailto:\S+/gi, giveBack)
    .replace(/(^|\s)\/[\w-]+(?:\/[\w%.-]*)+/g, (m, pre: string) => pre + giveBack(m))
    .replace(/[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63}){1,10}/g, "")
    // A URL with no scheme: a host (its last label letters, so "3.5/5" stays) and a path or a query ("budget.xlsx?" at
    // the end of a question stays).
    .replace(/\b[\w-]{1,63}(?:\.[\w-]{1,63}){0,10}\.[A-Za-z]{2,24}(?:\/|\?(?=\S))\S*/g, giveBack)
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "")
    .replace(/[A-Za-z0-9_\-+/=.]{20,}/g, (m) => (/\d/.test(m) ? (/\.+$/.exec(m)?.[0] ?? "") : m));
}

/** The last tidy, once escaped characters are back: no Markdown characters at all, and no gaps removals left behind. */
function finish(s: string): string {
  return s
    .replace(/_/g, " ")
    .replace(/[*`#[\]]/g, "")
    .replace(/[|<>]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\(\s*[,;:]?\s*\)/g, "")
    .replace(/\(\s+/g, "(")
    .replace(/\s+([.,;:!?…)])/g, "$1")
    .replace(/([,;:])[,;:]+/g, "$1")
    .replace(/[,;:]+(?=[.!?…])/g, "")
    .replace(/(?<!\.)\.\.(?!\.)/g, ".")
    .replace(/([!?…])\.(?!\.)/g, "$1")
    .replace(/^[\s.,;:!?…)]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** A sentence or an item ends with a full stop unless it already ends with its own punctuation. */
const ended = (s: string) => (/[.!?…:;]["'”’)]*$/.test(s) ? s : `${s.replace(/[\s,–—-]+$/, "")}.`);

const isTableSeparator = (line: string) => /^\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)+\|?$/.test(line);

/** The reply as units in document order: prose sentences, list items and labels (headings, bold lines). */
function units(source: string, restore: (s: string) => string): Unit[] {
  const out: Unit[] = [];
  type Raw = { kind: "prose" | "item" | "label"; parts: string[] };
  const raws: Raw[] = [];
  let prose: Raw | null = null;
  let item: Raw | null = null;
  let fence: string | null = null;
  let table = false;
  const end = () => { prose = null; item = null; };

  for (const raw of source.split("\n")) {
    const trimmed = raw.trim();
    const mark = /^(`{3,}|~{3,})/.exec(trimmed);
    if (fence) {
      if (mark && mark[1][0] === fence[0] && mark[1].length >= fence.length && !trimmed.slice(mark[1].length).trim()) fence = null;
      continue;
    }
    if (mark) { end(); fence = mark[1]; continue; }
    const line = trimmed.replace(/^(?:>\s?)+/, "").trim();
    if (!line) { end(); table = false; continue; }

    if (isTableSeparator(line)) {
      // The line above was the header row.
      const last: Raw | null = prose;
      if (last && last.parts[last.parts.length - 1]?.includes("|")) {
        last.parts.pop();
        if (!last.parts.length) raws.splice(raws.indexOf(last), 1);
      }
      end(); table = true; continue;
    }
    if (line.startsWith("|") || (table && line.includes("|"))) { end(); table = true; continue; }
    table = false;
    if (/^([-*_=])(?:\s*\1){2,}$/.test(line)) { end(); continue; } // rules (and setext underlines)
    if (/^\[[^\]]+\]:\s*\S/.test(line)) continue; // link reference definitions

    const heading = /^#{1,6}(?:\s+|$)(.*)$/.exec(line);
    if (heading) { end(); raws.push({ kind: "label", parts: [heading[1].replace(/\s+#+\s*$/, "")] }); continue; }

    const listed = /^(?:[-*+•]|\d{1,3}[.)])\s+(.*)$/.exec(line);
    if (listed) {
      end();
      item = { kind: "item", parts: [listed[1].replace(/^\[[ xX]\]\s+/, "")] };
      raws.push(item);
      continue;
    }
    // A line indented under a list item carries on that item.
    if (item && /^\s/.test(raw)) { item.parts.push(line); continue; }

    const bold = /^(\*\*|__)((?:(?!\1).)+)\1(:?)$/.exec(line);
    if (bold) { end(); raws.push({ kind: "label", parts: [bold[2] + bold[3]] }); continue; }

    item = null;
    if (!prose) { prose = { kind: "prose", parts: [] }; raws.push(prose); }
    prose.parts.push(line);
  }

  for (const r of raws) {
    const text = inline(r.parts.join(" "));
    if (r.kind === "prose") {
      // Split while escaped full stops are still placeholders, so "1\." is not a sentence end.
      for (const s of text.split(/(?<=[.!?…]|[.!?…]["'”’)])\s+/)) {
        const t = finish(restore(s));
        if (t) out.push({ kind: "sentence", text: ended(t) });
      }
      continue;
    }
    const t = finish(restore(text));
    if (!t) continue;
    if (r.kind === "item") out.push({ kind: "item", text: ended(t) });
    else out.push({ kind: "label", text: /[.!?…:;]$/.test(t) ? t : `${t.replace(/[\s,–—-]+$/, "")}:` });
  }
  return out;
}

/**
 * The first unit is too long on its own: cut it at its last sentence end, else its last clause mark, else a word
 * boundary, so it fits `room` with its full stop. A sentence or clause end is used only when it keeps at least half the
 * room (a cut after the first three words would lose more than a cut mid-clause).
 */
function cut(text: string, room: number): string {
  if (text.length <= room) return text;
  if (room < 2) return "";
  const limit = room - 1;
  const min = Math.floor(limit / 2);
  const before = (re: RegExp, lo: number) => [...text.matchAll(re)].map((m) => m.index ?? -1).filter((i) => i >= lo && i <= limit);
  const sentenceEnds = before(/[.!?…](?=\s)/g, min - 1);
  if (sentenceEnds.length) return text.slice(0, sentenceEnds[sentenceEnds.length - 1] + 1);
  const clauses = before(/[,;:](?=\s)/g, min);
  if (clauses.length) return `${text.slice(0, clauses[clauses.length - 1]).trimEnd()}.`;
  const spaces = before(/\s/g, 1);
  const at = spaces.length ? spaces[spaces.length - 1] : limit;
  return `${text.slice(0, at).replace(/[\s,;:–—-]+$/, "")}.`;
}

const more = (n: number) => (n > 0 ? `And ${n} more.` : "");

/** Which units are said: prose up to the sentence cap, labels only with an item of theirs, all within maxChars. */
function select(all: Unit[], maxChars: number, maxSentences: number): string {
  let sentences = 0;
  const wanted = all.filter((u) => u.kind !== "sentence" || sentences++ < maxSentences);
  const kept = wanted.filter((u, i) => u.kind !== "label" || wanted[i + 1]?.kind === "item");
  const full = kept.map((u) => u.text).join(" ");
  if (full.length <= maxChars) return full;

  const itemCount = kept.filter((u) => u.kind === "item").length;
  const out: string[] = [];
  let length = 0;
  let taken = 0;
  let label: string | null = null;
  for (const u of kept) {
    if (u.kind === "label") { label = u.text; continue; }
    const piece = label && u.kind === "item" ? `${label} ${u.text}` : u.text;
    label = null;
    const left = itemCount - taken - (u.kind === "item" ? 1 : 0);
    // Room is kept for "And N more." while items could still be left out.
    const reserve = left > 0 ? more(left).length + 1 : 0;
    if (length + (out.length ? 1 : 0) + piece.length + reserve > maxChars) {
      if (!out.length) {
        const first = cut(u.text, maxChars - reserve);
        if (first) { out.push(first); length = first.length; if (u.kind === "item") taken++; }
      }
      break;
    }
    out.push(piece);
    length += (out.length > 1 ? 1 : 0) + piece.length;
    if (u.kind === "item") taken++;
  }
  const said = [...out, more(itemCount - taken)].filter(Boolean).join(" ");
  return said.length <= maxChars ? said : cut(said, maxChars);
}

/** The first MAX_SOURCE characters, ended at the last line break in their second half (else at the last space). */
function head(text: string): string {
  if (text.length <= MAX_SOURCE) return text;
  const cut = text.slice(0, MAX_SOURCE);
  const line = cut.lastIndexOf("\n");
  if (line >= MAX_SOURCE / 2) return cut.slice(0, line);
  const space = cut.search(/\s\S*$/);
  return space >= MAX_SOURCE / 2 ? cut.slice(0, space) : cut;
}

/**
 * A reply as she says it: one line of plain text (or "" when nothing in it is speakable), at most `maxChars` (400)
 * characters and `maxSentences` (3) sentences of prose, list items as short sentences. Never Markdown, code, tables,
 * URLs, paths, email addresses, ids or tokens.
 */
export function speakable(markdown: string, opts: SpeakableOptions = {}): string {
  const maxChars = Math.max(1, Math.floor(opts.maxChars ?? 400));
  const maxSentences = Math.max(0, Math.floor(opts.maxSentences ?? 3));
  if (!markdown || !markdown.trim()) return "";
  const escaped: string[] = [];
  const source = head(markdown)
    .replace(/\r\n?/g, "\n")
    // Windows paths ("C:\Users\jane\notes.txt"), before backslashes are read as escapes.
    .replace(/\b[A-Za-z]:\\\S*/g, giveBack)
    .replaceAll(ESC, "")
    .replace(ESCAPED, (_, c: string) => { escaped.push(c); return `${ESC}${escaped.length - 1}${ESC}`; });
  const restore = (s: string) => s.replace(PLACEHOLDER, (_, n: string) => escaped[Number(n)] ?? "");
  return select(units(source, restore), maxChars, maxSentences).replace(/\s+/g, " ").trim();
}
