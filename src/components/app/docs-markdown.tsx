import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A small, safe Markdown renderer for Docs (owner decision, 5 October 2026: documents people and Brenda write are
 * Markdown). It never builds an HTML string: the source is parsed into blocks and inline pieces and rendered as React
 * elements, and React escapes every text node, so nothing typed into a document can become markup or script. There is
 * no dangerouslySetInnerHTML anywhere. Links keep only http, https and mailto addresses (and paths inside Boredroom);
 * anything else is shown as plain text.
 *
 * Supported: headings, paragraphs, bold, italic, strikethrough, inline code, fenced code blocks, bulleted, numbered and
 * checklist items (nested by indentation), block quotes, horizontal rules, simple tables and links (bare addresses
 * too). Nesting is capped so a hostile document cannot exhaust the stack, and every scan is bounded so a long one
 * cannot stall the page.
 *
 * `variant="chat"` is the same renderer, compact, for Brenda's replies (owner request, 7 October 2026: "if you're
 * listing things, it should not be in a paragraph; list it"): the chat's own type size (it inherits 14/20 or 16/24),
 * short paragraph gaps with line breaks kept, lists with a hanging indent, items 4 to 6px apart and their markers in the
 * secondary grey, a paragraph that is only a bold label sitting close to the list under it, headings shown as bold
 * labels, and links as `.link-inline`. Paths inside Boredroom open in the app (`onNavigate`); a path without the
 * workspace (`/tasks`) is read as one inside it (`base`).
 */

type Align = "left" | "center" | "right" | null;
type ListItem = { task: boolean | null; lines: string[] };
type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "code"; lang: string; text: string }
  | { type: "quote"; lines: string[] }
  | { type: "list"; ordered: boolean; start: number; items: ListItem[] }
  | { type: "hr" }
  | { type: "table"; align: Align[]; head: string[]; rows: string[][] };

const MAX_BLOCK_DEPTH = 6;

/** How a body is drawn: a document (Docs), or a reply in Brenda's chat (compact, links open in the app). */
type Opts = { chat: boolean; base?: string; onNavigate?: (href: string) => void };
const DOC: Opts = { chat: false };
const MAX_INLINE_DEPTH = 8;

const FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*([\w+#.-]*)[ \t]*$/;
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}>[ ]?(.*)$/;
const ITEM = /^( *)([-*+]|\d{1,9}[.)])(?:[ \t]+(.*))?$/;
const TABLE_RULE = /^ *\|? *:?-+:? *(\| *:?-+:? *)*\|? *$/;
const TASK = /^\[( |x|X)\][ \t]+/;

/** Tabs count as four spaces, so indentation compares cleanly. */
const untab = (line: string) => line.replace(/^\t+/, (t) => "    ".repeat(t.length));
const indentOf = (line: string) => line.length - line.trimStart().length;
const blank = (line: string) => line.trim() === "";

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && s[i + 1] === "|") { cur += "|"; i++; continue; }
    if (s[i] === "|") { cells.push(cur.trim()); cur = ""; continue; }
    cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}

function isTableStart(lines: string[], i: number) {
  return i + 1 < lines.length && lines[i].includes("|") && TABLE_RULE.test(lines[i + 1]) && lines[i + 1].includes("-") && splitRow(lines[i]).length === splitRow(lines[i + 1]).length;
}

/** A line that ends a paragraph because another block begins on it. */
function startsBlock(lines: string[], i: number) {
  const line = lines[i];
  return FENCE.test(line) || HEADING.test(line) || HR.test(line) || QUOTE.test(line) || (ITEM.test(line) && indentOf(line) < 4 && !!ITEM.exec(line)?.[3]) || isTableStart(lines, i);
}

function parseBlocks(input: string[]): Block[] {
  const lines = input.map(untab);
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (blank(line)) { i++; continue; }

    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1];
      const body: string[] = [];
      i++;
      while (i < lines.length) {
        const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(lines[i]);
        if (close && close[1][0] === marker[0] && close[1].length >= marker.length) { i++; break; }
        body.push(lines[i]);
        i++;
      }
      blocks.push({ type: "code", lang: fence[2], text: body.join("\n") });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) { blocks.push({ type: "heading", level: heading[1].length, text: heading[2] }); i++; continue; }

    if (HR.test(line)) { blocks.push({ type: "hr" }); i++; continue; }

    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && !blank(lines[i])) {
        const q = QUOTE.exec(lines[i]);
        // A line without ">" right after a quoted one carries the quote's paragraph on (lazy continuation).
        if (!q && (startsBlock(lines, i) || body.length === 0)) break;
        body.push(q ? q[1] : lines[i]);
        i++;
      }
      blocks.push({ type: "quote", lines: body });
      continue;
    }

    const item = ITEM.exec(line);
    // A number alone on a line ("2026.") is a sentence, not a list.
    if (item && indentOf(line) < 4 && (item[3] || !/\d/.test(item[2]))) {
      const ordered = /\d/.test(item[2]);
      const baseIndent = item[1].length;
      const items: ListItem[] = [];
      const start = ordered ? Math.min(Number.parseInt(item[2], 10), 1_000_000) : 1;
      let current: ListItem | null = null;
      let contentIndent = baseIndent + 2;
      let lastBlank = false;
      while (i < lines.length) {
        const l = lines[i];
        if (blank(l)) {
          // A blank line keeps the list going only if the next line still belongs to it.
          let j = i + 1;
          while (j < lines.length && blank(lines[j])) j++;
          if (j >= lines.length) { i = j; break; }
          const next = lines[j];
          const sibling = ITEM.exec(next);
          const belongs = indentOf(next) >= contentIndent || (!!sibling && indentOf(next) <= baseIndent + 1 && /\d/.test(sibling[2]) === ordered);
          if (!belongs) break;
          current?.lines.push("");
          lastBlank = true;
          i++;
          continue;
        }
        const m = ITEM.exec(l);
        const ind = indentOf(l);
        if (m && ind >= baseIndent && ind <= baseIndent + 1 && /\d/.test(m[2]) === ordered) {
          let text = m[3] ?? "";
          const task = TASK.exec(text);
          if (task) text = text.slice(task[0].length);
          current = { task: task ? task[1] !== " " : null, lines: [text] };
          items.push(current);
          contentIndent = ind + m[2].length + 1;
          lastBlank = false;
          i++;
          continue;
        }
        if (ind > baseIndent && current) {
          // Indented under the item: a nested list, a second paragraph or a code block that belongs to it.
          current.lines.push(l.slice(Math.min(ind, contentIndent)));
          lastBlank = false;
          i++;
          continue;
        }
        if (!lastBlank && current && !startsBlock(lines, i)) {
          current.lines.push(l.trim());
          i++;
          continue;
        }
        break;
      }
      // A blank line before the next item is spacing, not a second paragraph inside this one.
      for (const it of items) while (it.lines.length > 1 && blank(it.lines[it.lines.length - 1])) it.lines.pop();
      blocks.push({ type: "list", ordered, start, items });
      continue;
    }

    if (isTableStart(lines, i)) {
      const head = splitRow(lines[i]);
      const align: Align[] = splitRow(lines[i + 1]).map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : c.startsWith(":") ? "left" : null));
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && !blank(lines[i]) && lines[i].includes("|")) { rows.push(splitRow(lines[i])); i++; }
      blocks.push({ type: "table", align, head, rows });
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && !blank(lines[i]) && (para.length === 0 || !startsBlock(lines, i))) { para.push(lines[i]); i++; }
    blocks.push({ type: "paragraph", text: para.join("\n") });
  }
  return blocks;
}

/** Only addresses that cannot run script: http, https, mailto, and paths inside Boredroom. */
export function safeHref(raw: string): { href: string; external: boolean } | null {
  const url = raw.trim();
  if (!url || url.length > 2048) return null;
  // A path on this site. "//host" and backslashes would leave it; whitespace (which browsers strip) is refused too.
  if (/^\/(?![/\\])[^\s\\]*$/.test(url)) return { href: url, external: false };
  try {
    const u = new URL(url);
    if (u.protocol === "http:" || u.protocol === "https:") return { href: u.href, external: true };
    if (u.protocol === "mailto:") return { href: u.href, external: false };
  } catch { /* not an absolute address */ }
  return null;
}

/**
 * Where a link's "(address)" closes: the first ")" that is not part of a pair inside the address, so addresses such
 * as https://en.wikipedia.org/wiki/Mercury_(planet) survive. Bounded like CommonMark (2 KB, 32 levels); -1 when the
 * parenthesis never closes, and the "[label](" is then shown as text.
 */
function destinationEnd(text: string, from: number): number {
  const stop = Math.min(text.length, from + 2050);
  const first = text.slice(from, stop).indexOf(")");
  if (first === -1) return -1;
  if (!text.slice(from, from + first).includes("(")) return from + first; // the usual case, found natively
  let depth = 0;
  for (let j = from; j < stop; j++) {
    const ch = text[j];
    if (ch === "\\") { j++; continue; }
    if (ch === "(") { if (++depth > 32) return -1; continue; }
    if (ch === ")") { if (depth === 0) return j; depth--; }
  }
  return -1;
}

const ESCAPABLE = "\\`*_{}[]()#+-.!|~>";
const BARE_URL = /https?:\/\/[^\s<>"]*[^\s<>".,:;'!?)\]]/y;

const linkCls = "font-medium text-foreground underline decoration-border-input-hover decoration-1 underline-offset-4 transition-colors duration-75 hover:decoration-foreground";

/** In the chat, a path without the workspace ("/tasks") is one inside it ("/app/<slug>/tasks"). */
function inWorkspace(path: string, base: string | undefined) {
  if (!base || !path.startsWith("/") || path === base || path.startsWith(`${base}/`) || path.startsWith(`${base}?`) || /^\/(?:app|api)(?:[/?#]|$)/.test(path)) return path;
  return `${base}${path}`;
}

function renderLink(label: React.ReactNode, href: string, key: string, o: Opts) {
  const safe = safeHref(href);
  if (!safe) return <React.Fragment key={key}>{label}</React.Fragment>;
  const cls = o.chat ? "link-inline" : linkCls;
  if (safe.external) return <a key={key} href={safe.href} target="_blank" rel="noopener noreferrer" className={cls}>{label}</a>;
  const to = inWorkspace(safe.href, o.chat ? o.base : undefined);
  const go = o.onNavigate && to.startsWith("/") ? o.onNavigate : null;
  // A plain click opens the page in the app; a modified click (new tab, new window) is left to the browser.
  const onClick = go ? (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    go(to);
  } : undefined;
  return <a key={key} href={to} className={cls} onClick={onClick}>{label}</a>;
}

/**
 * Inline Markdown into React nodes. Closers are searched once per delimiter: when none is left after a position,
 * later openers of the same kind are taken as text without scanning again, so the work stays linear.
 * Inside a link's label (`inLink`) nothing becomes a second link: a link inside a link is invalid HTML, and the browser
 * would split it, so the server-rendered page would no longer match the one React builds.
 */
function inline(text: string, depth = 0, prefix = "i", inLink = false, o: Opts = DOC): React.ReactNode[] {
  if (depth > MAX_INLINE_DEPTH) return [text];
  const out: React.ReactNode[] = [];
  let buf = "";
  let n = 0;
  const key = () => `${prefix}-${n++}`;
  const flush = () => { if (buf) { out.push(buf); buf = ""; } };
  const noCloser = new Map<string, number>();
  let bracketClose = -2;

  const findClose = (delim: string, from: number) => {
    const known = noCloser.get(delim);
    if (known !== undefined && from >= known) return -1;
    let j = from;
    while ((j = text.indexOf(delim, j)) !== -1) {
      const before = text[j - 1];
      const after = text[j + delim.length] ?? "";
      const run = delim.length === 1 && (after === delim || before === delim);
      const intraword = delim[0] === "_" && /[\p{L}\p{N}]/u.test(after);
      if (j > from && before !== undefined && !/\s/.test(before) && before !== "\\" && !run && !intraword) return j;
      // An escaped mark ("\*") is text: the real closer may start on the very next character ("\***").
      j += before === "\\" ? 1 : delim.length;
    }
    noCloser.set(delim, from);
    return -1;
  };

  let i = 0;
  while (i < text.length) {
    const c = text[i];

    if (c === "\\" && i + 1 < text.length && ESCAPABLE.includes(text[i + 1])) { buf += text[i + 1]; i += 2; continue; }

    if (c === "\n") {
      if (buf.endsWith("  ")) { buf = buf.trimEnd(); flush(); out.push(<br key={key()} />); } else buf += "\n";
      i++;
      continue;
    }

    if (c === "`") {
      let len = 1;
      while (text[i + len] === "`") len++;
      const ticks = "`".repeat(len);
      const known = noCloser.get(ticks);
      let close = -1;
      if (known === undefined || i < known) {
        let j = i + len;
        while ((j = text.indexOf(ticks, j)) !== -1) {
          if (text[j + len] !== "`" && text[j - 1] !== "`") { close = j; break; }
          j += len;
        }
        if (close === -1) noCloser.set(ticks, i);
      }
      if (close !== -1) {
        let code = text.slice(i + len, close).replace(/\n/g, " ");
        if (code.length > 2 && code.startsWith(" ") && code.endsWith(" ")) code = code.slice(1, -1);
        flush();
        out.push(<code key={key()} className="rounded-md bg-fill-1 px-1.5 py-px font-mono text-[0.86em] text-foreground">{code}</code>);
        i = close + len;
        continue;
      }
      buf += ticks;
      i += len;
      continue;
    }

    if (c === "[" && !inLink) {
      if (bracketClose !== -1 && bracketClose < i) bracketClose = text.indexOf("]", i + 1);
      const close = bracketClose;
      if (close !== -1 && close - i <= 1000 && text[close + 1] === "(") {
        const end = destinationEnd(text, close + 2);
        if (end !== -1) {
          const inside = text.slice(close + 2, end).trim();
          const href = inside.split(/\s+/)[0]?.replace(/^<|>$/g, "") ?? "";
          const label = text.slice(i + 1, close);
          flush();
          out.push(renderLink(label ? inline(label, depth + 1, key(), true, o) : href, href, key(), o));
          i = end + 1;
          continue;
        }
      }
      buf += c;
      i++;
      continue;
    }

    if (c === "<" && !inLink && (text.startsWith("http", i + 1) || text.startsWith("mailto:", i + 1))) {
      const auto = /^<((?:https?:\/\/|mailto:)[^\s<>]{1,2000})>/.exec(text.slice(i, i + 2010));
      if (auto) { flush(); out.push(renderLink(auto[1], auto[1], key(), o)); i += auto[0].length; continue; }
      buf += c;
      i++;
      continue;
    }

    if (c === "h" && !inLink && (i === 0 || /[\s(]/.test(text[i - 1]))) {
      BARE_URL.lastIndex = i;
      const m = BARE_URL.exec(text);
      if (m && m[0].length <= 2048) { flush(); out.push(renderLink(m[0], m[0], key(), o)); i += m[0].length; continue; }
    }

    if (c === "*" || c === "_" || c === "~") {
      const double = text[i + 1] === c;
      if (c === "~" && !double) { buf += c; i++; continue; }
      const delim = double ? c + c : c;
      const next = text[i + delim.length];
      const prev = text[i - 1];
      const opens = next !== undefined && !/\s/.test(next) && !(c === "_" && prev !== undefined && /[\p{L}\p{N}]/u.test(prev));
      const close = opens ? findClose(delim, i + delim.length) : -1;
      if (close !== -1) {
        const inner = inline(text.slice(i + delim.length, close), depth + 1, key(), inLink, o);
        flush();
        if (c === "~") out.push(<del key={key()} className="text-secondary">{inner}</del>);
        else if (double) out.push(<strong key={key()} className="font-semibold text-foreground">{inner}</strong>);
        else out.push(<em key={key()} className="italic">{inner}</em>);
        i = close + delim.length;
        continue;
      }
      buf += delim;
      i += delim.length;
      continue;
    }

    buf += c;
    i++;
  }
  flush();
  return out;
}

/** v4: the first two levels in the display face (24/30 and 18/26 in the page's own scale), the rest in Inter semibold. */
const HEADING_CLS: Record<number, string> = {
  1: "mt-9 mb-3 font-display text-2xl font-normal text-foreground",
  2: "mt-8 mb-3 font-display text-lg font-normal text-foreground",
  3: "mt-7 mb-2 text-base font-semibold text-foreground",
  4: "mt-6 mb-2 text-sm font-semibold text-foreground",
  5: "mt-5 mb-2 text-sm font-semibold text-secondary",
  6: "mt-5 mb-2 text-meta font-semibold text-secondary",
};

/** A paragraph that is only a bold label ("**Done**", "**Needs attention**:"), which heads the list under it. */
const LABEL = /^(\*\*|__)(?:(?!\1)[^\n])+\1:?$/;
/** In the chat, a label sits 12px below what comes before it and 4px above its list. */
const CHAT_LABEL = "mt-3 mb-1 font-semibold text-foreground [&+ol]:mt-1 [&+ul]:mt-1";

function renderBlocks(blocks: Block[], depth: number, prefix: string, o: Opts = DOC): React.ReactNode[] {
  const chat = o.chat;
  return blocks.map((b, idx) => {
    const k = `${prefix}-${idx}`;
    switch (b.type) {
      case "heading": {
        // A reply has no headings bigger than a bold label.
        if (chat) return <p key={k} className={CHAT_LABEL}>{inline(b.text, 0, k, false, o)}</p>;
        // The document's title is the page's h1, so a "#" heading inside it is an h2, and so on down.
        const Tag = `h${Math.min(b.level + 1, 6)}` as "h2" | "h3" | "h4" | "h5" | "h6";
        return <Tag key={k} className={HEADING_CLS[b.level]}>{inline(b.text, 0, k)}</Tag>;
      }
      case "paragraph":
        if (chat) return <p key={k} className={LABEL.test(b.text.trim()) ? CHAT_LABEL : "my-2 whitespace-pre-line"}>{inline(b.text, 0, k, false, o)}</p>;
        return <p key={k} className="my-3 text-base font-normal leading-7 text-foreground">{inline(b.text, 0, k)}</p>;
      case "code":
        return (
          <div key={k} className={cn("overflow-hidden rounded-xl border border-border bg-fill-0", chat ? "my-2" : "my-4")}>
            {b.lang ? <p className="border-b border-border px-4 py-1.5 font-mono text-xs text-secondary">{b.lang}</p> : null}
            <pre className="type-code overflow-x-auto p-4 text-foreground"><code>{b.text}</code></pre>
          </div>
        );
      case "hr":
        return <hr key={k} className={cn("h-px border-0 bg-border", chat ? "my-3" : "my-8")} />;
      case "quote":
        return (
          <blockquote key={k} className={cn("border-l-2 border-border-input-hover text-secondary", chat ? "my-2 pl-3" : "my-4 pl-4")}>
            {depth >= MAX_BLOCK_DEPTH ? <p className="my-2">{b.lines.join(" ")}</p> : renderBlocks(parseBlocks(b.lines), depth + 1, k, o)}
          </blockquote>
        );
      case "list": {
        const items = b.items.map((it, j) => {
          const ik = `${k}-${j}`;
          // One line of text: rendered inline, so a tight list stays tight. Anything more is parsed as blocks.
          const simple = it.lines.length === 1;
          const content = simple || depth >= MAX_BLOCK_DEPTH
            ? inline(it.lines.join("\n"), 0, ik, false, o)
            : renderBlocks(parseBlocks(it.lines), depth + 1, ik, o);
          if (it.task !== null) {
            return (
              <li key={ik} className="flex list-none items-start gap-2.5 [&>div>p]:my-0">
                <span aria-hidden className={cn("mt-[6px] grid size-4 shrink-0 place-items-center rounded-[4px] border", it.task ? "border-foreground bg-foreground text-background" : "border-border-input-hover")}>
                  {it.task ? <svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg> : null}
                </span>
                <span className="sr-only">{it.task ? "Done: " : "To do: "}</span>
                <div className={cn("min-w-0 flex-1", it.task && "text-secondary line-through decoration-faint")}>{content}</div>
              </li>
            );
          }
          return <li key={ik} className={chat ? "pl-0.5 [&>ol]:my-1 [&>p]:my-0.5 [&>ul]:my-1" : "pl-1 [&>p]:my-1"}>{content}</li>;
        });
        const allTasks = b.items.every((it) => it.task !== null);
        // The chat's lists: its own type size, the markers hanging in the secondary grey, items about 5px apart.
        const cls = chat
          ? cn("my-2 marker:text-secondary marker:tabular-nums [&>li+li]:mt-[0.35em]", allTasks ? "pl-0" : b.ordered ? "pl-[1.6em]" : "pl-[1.25em]", b.ordered ? "list-decimal" : "list-disc")
          : cn("my-3 space-y-1.5 text-base font-normal leading-7 text-foreground marker:text-subtle", allTasks ? "pl-0" : "pl-6", b.ordered ? "list-decimal" : "list-disc");
        return b.ordered
          ? <ol key={k} start={b.start !== 1 ? b.start : undefined} className={cls}>{items}</ol>
          : <ul key={k} className={cls}>{items}</ul>;
      }
      case "table": {
        const align = (j: number) => (b.align[j] === "center" ? "text-center" : b.align[j] === "right" ? "text-right" : "text-left");
        return (
          <div key={k} className={cn("overflow-x-auto", chat ? "my-2" : "my-4")}>
            <table className="w-full border-collapse text-sm">
              <thead><tr>{b.head.map((h, j) => <th key={j} scope="col" className={cn("h-9 border-b border-border px-3 font-medium text-secondary first:pl-0", align(j))}>{inline(h, 0, `${k}-h${j}`, false, o)}</th>)}</tr></thead>
              <tbody>{b.rows.map((r, ri) => <tr key={ri}>{b.head.map((_, j) => <td key={j} className={cn("px-3 py-2.5 align-top font-normal text-foreground first:pl-0", align(j))}>{inline(r[j] ?? "", 0, `${k}-${ri}-${j}`, false, o)}</td>)}</tr>)}</tbody>
            </table>
          </div>
        );
      }
    }
  });
}

/**
 * Renders a document body, or with `variant="chat"` one of Brenda's replies. `source` is untrusted: whatever it holds is
 * shown as text, never run. In the chat, `onNavigate` opens a Boredroom path in the app (a plain click; new-tab clicks
 * stay the browser's) and `base` (the workspace, "/app/<slug>") completes a path written without it.
 */
export function Markdown({ source, className, variant = "doc", base, onNavigate }: {
  source: string; className?: string; variant?: "doc" | "chat"; base?: string; onNavigate?: (href: string) => void;
}) {
  const blocks = parseBlocks(source.replace(/\r\n?/g, "\n").split("\n"));
  const o: Opts = variant === "chat" ? { chat: true, base, onNavigate } : DOC;
  return <div className={cn("min-w-0 break-words [&>*:first-child]:mt-0 [&>*:last-child]:mb-0", className)}>{renderBlocks(blocks, 0, "b", o)}</div>;
}
