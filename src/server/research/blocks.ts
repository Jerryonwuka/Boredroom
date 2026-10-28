/**
 * The small Markdown the research files are drawn from (owner decision, 28 October 2026: Brenda's research): a report
 * body's lines as blocks (subheadings, paragraphs, bullet and numbered lists) and a line's words as runs (plain, bold,
 * italic, a link with its address). The PDF and Word renderers draw these; nothing here is HTML, so nothing from the web
 * or the model can reach a page as markup. Pure.
 */

export type Run = { text: string; bold?: boolean; italic?: boolean; href?: string };
export type Block =
  | { type: "h3"; runs: Run[] }
  | { type: "p"; runs: Run[] }
  | { type: "ul"; items: Run[][] }
  | { type: "ol"; items: Run[][] };

const BULLET = /^\s*[-*+•]\s+(.*)$/;
const NUMBERED = /^\s*\d{1,4}[.)]\s+(.*)$/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;

/** Only web addresses become links (http and https); anything else stays words. */
export const safeHref = (href: string): string | undefined => {
  try {
    const u = new URL(href.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : undefined;
  } catch { return undefined; }
};

/** One line's runs: [words](address) links, **bold**, *italic* / _italic_, `code` as plain words. */
export function runsOf(line: string): Run[] {
  const out: Run[] = [];
  const push = (r: Run) => { if (r.text) out.push(r); };
  // Links first, then emphasis inside the plain stretches.
  const LINK = /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let at = 0;
  for (const m of line.matchAll(LINK)) {
    emphasis(line.slice(at, m.index), push);
    const href = safeHref(m[2]);
    push(href ? { text: m[1], href } : { text: m[1] });
    at = (m.index ?? 0) + m[0].length;
  }
  emphasis(line.slice(at), push);
  return out;
}

function emphasis(s: string, push: (r: Run) => void) {
  const TOKEN = /(\*\*|__)(?=\S)([\s\S]*?\S)\1|(\*|_)(?=\S)([^*_]*?\S)\3(?![\w])|`([^`]+)`/g;
  let at = 0;
  for (const m of s.matchAll(TOKEN)) {
    const idx = m.index ?? 0;
    // An underscore inside a word (snake_case) is not emphasis.
    if (m[3] === "_" && idx > 0 && /\w/.test(s[idx - 1])) continue;
    push({ text: s.slice(at, idx) });
    if (m[2] !== undefined) push({ text: m[2], bold: true });
    else if (m[4] !== undefined) push({ text: m[4], italic: true });
    else push({ text: m[5] ?? "" });
    at = idx + m[0].length;
  }
  push({ text: s.slice(at) });
}

/** A body's blocks. Blank lines end paragraphs and lists; a deeper heading reads as a subheading. */
export function blocksOf(markdown: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { type: "ul" | "ol"; items: string[] } | null = null;
  const flushPara = () => { if (para.length) { blocks.push({ type: "p", runs: runsOf(para.join(" ").replace(/\s+/g, " ").trim()) }); para = []; } };
  const flushList = () => { if (list) { blocks.push({ type: list.type, items: list.items.map(runsOf) }); list = null; } };
  for (const raw of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) { flushPara(); flushList(); continue; }
    const h = HEADING.exec(line);
    if (h) { flushPara(); flushList(); if (h[1]) blocks.push({ type: "h3", runs: runsOf(h[1]) }); continue; }
    const b = BULLET.exec(line);
    const n = b ? null : NUMBERED.exec(line);
    if (b || n) {
      flushPara();
      const type = b ? "ul" : "ol";
      if (!list || list.type !== type) { flushList(); list = { type, items: [] }; }
      list.items.push((b ?? n)![1]);
      continue;
    }
    if (list && /^\s{2,}\S/.test(raw)) { list.items[list.items.length - 1] += ` ${line.trim()}`; continue; }
    flushList();
    para.push(line.trim());
  }
  flushPara();
  flushList();
  return blocks;
}

/** A run list's plain words (for the Markdown file and tests). */
export const plainOf = (runs: Run[]) => runs.map((r) => r.text).join("");
