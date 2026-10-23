/**
 * Notion: plain text to blocks, and Notion's markdown to an excerpt (owner decisions, 22 October 2026: connectors; spec
 * §8.4, §16.2). Pure, no network. Server-only.
 *
 * What Brenda sends is the person's plain text: paragraphs (separated by a blank line), "- " bullets and "[ ] " to-dos.
 * Notion's limits (developers.notion.com/reference/request-limits, read 22 October 2026): at most 2,000 characters in one
 * rich text item, at most 100 items in a rich text array, at most 100 blocks in one request. Every word the person sees
 * on the Confirm card reaches Notion: past the block limit the rest is folded into one last paragraph as plain lines
 * (knowledge group decision, 22 October 2026), never dropped.
 */

export const RICH_TEXT_MAX = 2000;
export const RICH_ITEMS_MAX = 100;
export const BLOCKS_MAX = 100;
/** What Boredroom keeps of a page as its excerpt (spec §8.4; the sink's own bound). */
export const EXCERPT_MAX = 20_000;

export type RichText = { type: "text"; text: { content: string } };
export type NotionBlock =
  | { object: "block"; type: "paragraph"; paragraph: { rich_text: RichText[] } }
  | { object: "block"; type: "bulleted_list_item"; bulleted_list_item: { rich_text: RichText[] } }
  | { object: "block"; type: "to_do"; to_do: { rich_text: RichText[]; checked: boolean } };

type Line = { kind: "paragraph"; text: string } | { kind: "bullet"; text: string } | { kind: "todo"; text: string; checked: boolean };

/**
 * Text as rich text items of at most 2,000 characters each (split on code points, so an emoji or an accented letter is
 * never cut in half). At most 100 items: 200,000 characters, far above anything Brenda sends (6,000).
 */
export function richText(text: string): RichText[] {
  const chars = Array.from(text);
  const out: RichText[] = [];
  for (let i = 0; i < chars.length && out.length < RICH_ITEMS_MAX; i += RICH_TEXT_MAX) {
    out.push({ type: "text", text: { content: chars.slice(i, i + RICH_TEXT_MAX).join("") } });
  }
  return out;
}

const TODO = /^(?:[-*•]\s+)?\[( |x|X)\]\s+(.*)$/;
const BULLET = /^[-*•]\s+(.*)$/;

/** The person's text as lines of three kinds; consecutive plain lines make one paragraph (their line breaks kept). */
export function parseText(text: string): Line[] {
  const out: Line[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ kind: "paragraph", text: para.join("\n") });
    para = [];
  };
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.replace(/\s+$/, "");
    const trimmed = line.trim();
    if (!trimmed) { flush(); continue; }
    const todo = TODO.exec(trimmed);
    if (todo && todo[2].trim()) { flush(); out.push({ kind: "todo", text: todo[2].trim(), checked: todo[1].toLowerCase() === "x" }); continue; }
    const bullet = BULLET.exec(trimmed);
    if (bullet && bullet[1].trim()) { flush(); out.push({ kind: "bullet", text: bullet[1].trim() }); continue; }
    para.push(line);
  }
  flush();
  return out;
}

const asText = (l: Line): string => (l.kind === "bullet" ? `- ${l.text}` : l.kind === "todo" ? `[${l.checked ? "x" : " "}] ${l.text}` : l.text);

function toBlock(l: Line): NotionBlock {
  if (l.kind === "bullet") return { object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: richText(l.text) } };
  if (l.kind === "todo") return { object: "block", type: "to_do", to_do: { rich_text: richText(l.text), checked: l.checked } };
  return { object: "block", type: "paragraph", paragraph: { rich_text: richText(l.text) } };
}

/**
 * Plain text (and an optional signature, its own last paragraph) as at most `max` blocks. Past the limit, the lines
 * that don't fit become one last paragraph of plain lines ("- " and "[ ] " kept as written), so nothing is lost.
 */
export function textToBlocks(text: string, o: { signature?: string | null; max?: number } = {}): NotionBlock[] {
  const max = Math.max(2, Math.min(BLOCKS_MAX, o.max ?? BLOCKS_MAX));
  const lines = parseText(text);
  const room = max - (o.signature ? 1 : 0);
  let kept: Line[] = lines;
  if (lines.length > room) {
    const head = lines.slice(0, room - 1);
    const rest = lines.slice(room - 1);
    // Paragraphs stay apart by a blank line, list lines one per line, as the person wrote them.
    const folded = rest.map((l, i) => (i > 0 && (l.kind === "paragraph" || rest[i - 1].kind === "paragraph") ? `\n${asText(l)}` : asText(l))).join("\n");
    kept = [...head, { kind: "paragraph", text: folded }];
  }
  const blocks = kept.map(toBlock);
  if (o.signature) blocks.push(toBlock({ kind: "paragraph", text: o.signature }));
  return blocks;
}

/** Every character of text in a list of blocks (tests, and a check that nothing was lost). */
export function blocksText(blocks: NotionBlock[]): string {
  return blocks.map((b) => {
    const rt = b.type === "paragraph" ? b.paragraph.rich_text : b.type === "bulleted_list_item" ? b.bulleted_list_item.rich_text : b.to_do.rich_text;
    return rt.map((r) => r.text.content).join("");
  }).join("\n");
}

// ---- Reading: Notion's markdown as an excerpt ------------------------------------------------------------------------------

/**
 * Notion's page markdown (GET /v1/pages/{id}/markdown) as what Boredroom keeps: `<unknown …/>` placeholders (blocks past
 * Notion's record limit, or not shared with Boredroom) become "[…]"; signed file links (temporary S3 URLs that work for
 * anyone holding them) are dropped; images keep only their alt text; at most `max` characters. Brenda's renderer
 * neutralises the rest (D6).
 */
export function cleanMarkdown(md: string, max = EXCERPT_MAX): string {
  let s = String(md ?? "").replace(/\r\n?/g, "\n");
  s = s.replace(/<unknown\b[^>]*\/?>(?:\s*<\/unknown>)?/gi, "[…]");
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_m, alt: string) => (alt.trim() ? `[image: ${alt.trim()}]` : "[image]"));
  s = s.replace(/\[([^\]]*)\]\((https?:\/\/[^)\s]*(?:X-Amz-|Signature=|Expires=)[^)\s]*)\)/gi, (_m, t: string) => (t.trim() ? `[${t.trim()}]` : "[file]"));
  s = s.replace(/https?:\/\/[^\s)"'<>]*(?:X-Amz-|Signature=|Expires=)[^\s)"'<>]*/gi, "[file]");
  s = s.replace(/\n{3,}/g, "\n\n").trim();
  return Array.from(s).slice(0, max).join("");
}
