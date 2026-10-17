/**
 * The one HTML the server ever makes from a model's words (Brenda for Mac, phase 2: file work; owner request, 12 October
 * 2026: "help you work on a file"; contract D.9). A file job asked for as Word or PDF is written by the model as
 * Markdown; this turns it into a small, fixed HTML document that the Mac converts (macOS's textutil for Word, WebKit for
 * PDF). Every piece of text is escaped: no tag, attribute, link or script from the model or the file can reach the page.
 * Headings 1 to 3 (deeper ones read as 3), paragraphs, bullet and numbered lists, bold, italic, inline code, fenced code
 * and simple tables; links become their words followed by the address in brackets, as text. Pure; no I/O.
 */

export const DOC_STYLE = [
  "@page { size: A4; margin: 20mm 18mm; }",
  "body { font-family: Inter, -apple-system, BlinkMacSystemFont, \"Helvetica Neue\", Arial, sans-serif; font-size: 11pt; line-height: 1.4; color: #111; margin: 0; }",
  "h1 { font-size: 18pt; margin: 0 0 10pt; } h2 { font-size: 14pt; margin: 14pt 0 6pt; } h3 { font-size: 12pt; margin: 12pt 0 4pt; }",
  "p { margin: 0 0 8pt; } ul, ol { margin: 0 0 8pt 18pt; padding: 0; } li { margin: 0 0 3pt; }",
  "code { font-family: \"SF Mono\", Menlo, Consolas, monospace; font-size: 9.5pt; background: #f2f2f2; padding: 0 2pt; }",
  "pre { background: #f2f2f2; padding: 8pt; white-space: pre-wrap; margin: 0 0 8pt; } pre code { background: none; padding: 0; }",
  "table { border-collapse: collapse; margin: 0 0 8pt; } th, td { border: 1px solid #ccc; padding: 3pt 6pt; text-align: left; vertical-align: top; } th { background: #f2f2f2; }",
].join("\n");

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Inline Markdown in one line: code spans first (their insides are only escaped), then links as text, bold and italic. */
export function inlineHtml(text: string): string {
  const parts = text.split(/(`[^`]+`)/g);
  return parts.map((p) => {
    if (/^`[^`]+`$/.test(p)) return `<code>${escapeHtml(p.slice(1, -1))}</code>`;
    // Links and pictures read as their words and their address, as text.
    let s = p.replace(/!?\[([^\]]*)\]\(([^)\s]*)[^)]*\)/g, (_m, words: string, href: string) => (words && href ? `${words} (${href})` : words || href));
    s = escapeHtml(s);
    s = s.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "<strong>$1</strong>").replace(/__(?=\S)([\s\S]*?\S)__/g, "<strong>$1</strong>");
    s = s.replace(/(^|[^*\w])\*(?=\S)([^*]*?\S)\*(?!\*)/g, "$1<em>$2</em>").replace(/(^|[^_\w])_(?=\S)([^_]*?\S)_(?![_\w])/g, "$1<em>$2</em>");
    return s;
  }).join("");
}

const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d{1,9}[.)]\s+(.*)$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE = /^\s{0,3}(```|~~~)/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

const cells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

/** The body's HTML for a Markdown text. */
export function markdownBody(markdown: string): string {
  const lines = String(markdown ?? "").replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) out.push(`<p>${inlineHtml(para.join(" "))}</p>`);
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (FENCE.test(line)) {
      flushPara();
      const fence = line.trim().slice(0, 3);
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence)) code.push(lines[i++]);
      out.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }
    if (!line.trim()) { flushPara(); continue; }
    const h = HEADING.exec(line);
    if (h) {
      flushPara();
      const level = Math.min(3, h[1].length);
      out.push(`<h${level}>${inlineHtml(h[2])}</h${level}>`);
      continue;
    }
    if (line.trim().startsWith("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      flushPara();
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(cells(lines[i++]));
      i--;
      out.push(`<table><thead><tr>${head.map((c) => `<th>${inlineHtml(c)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${head.map((_, k) => `<td>${inlineHtml(r[k] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
      continue;
    }
    const b = BULLET.exec(line);
    const n = b ? null : NUMBERED.exec(line);
    if (b || n) {
      flushPara();
      const tag = b ? "ul" : "ol";
      const re = b ? BULLET : NUMBERED;
      const items: string[] = [];
      while (i < lines.length) {
        const m = re.exec(lines[i]);
        if (m) { items.push(m[1]); i++; continue; }
        // A wrapped item's next line (indented, not blank, not another block) belongs to it.
        if (items.length && /^\s{2,}\S/.test(lines[i]) && !BULLET.test(lines[i]) && !NUMBERED.test(lines[i])) { items[items.length - 1] += ` ${lines[i].trim()}`; i++; continue; }
        break;
      }
      i--;
      out.push(`<${tag}>${items.map((it) => `<li>${inlineHtml(it)}</li>`).join("")}</${tag}>`);
      continue;
    }
    para.push(line.trim());
  }
  flushPara();
  return out.join("\n");
}

/** A whole document: the fixed stylesheet and the escaped body. `title` is escaped too. */
export function markdownToHtml(markdown: string, title = "Document"): string {
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(String(title).slice(0, 120))}</title><style>\n${DOC_STYLE}\n</style></head><body>\n${markdownBody(markdown)}\n</body></html>\n`;
}
