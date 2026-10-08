/**
 * Every line has a source (owner decision, 8 October 2026: phase 7a, "Brenda keeps the loops closed"). A line in the
 * end-of-day team report, a routine's output, the morning opener, a catch-up answer or a follow-up answer links to the
 * task, message, document, follow-up or item behind it when there is one, and a figure that could not be read says
 * "not available", never 0.
 *
 * This is the one helper for those links: the paths are built here from ids only (a slug and UUIDs checked against
 * fixed patterns; anything else gives no link), so nothing a person typed can become a link, and the labels are fixed
 * words. Markdown text goes through `mdEscape`, the set copilot-excerpt's `mdText` escapes plus the characters a link
 * or a heading could start with. It imports nothing, so client components, the server and the worker can all use it.
 * (`server/services/evidence.ts` is a different thing: the files people attach to their work.)
 */

export type EvidenceKind = "task" | "message" | "conversation" | "doc" | "follow_up" | "assistant_item" | "review" | "time_correction" | "routine_run" | "attendance";
/** `id`: the thing's own id (a message's id for `message`); `conversationId`: the conversation a message is in. */
export type EvidenceRef = { kind: EvidenceKind; id?: string | null; conversationId?: string | null };

export const NOT_AVAILABLE = "not available";

/** The link's label, in a line's "([task](…), [message](…))". */
export const EVIDENCE_WORDS: Record<EvidenceKind, string> = {
  task: "task", message: "message", conversation: "conversation", doc: "doc", follow_up: "follow-up", assistant_item: "item",
  review: "review", time_correction: "time correction", routine_run: "run", attendance: "attendance",
};

const SLUG = /^[a-z0-9-]{1,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const okId = (v: string | null | undefined): v is string => typeof v === "string" && UUID.test(v);

/**
 * The page behind a source, inside the workspace (`/app/{slug}/…`), or null when the slug or an id it needs is not one
 * (a link is never built from anything else). Reviews, time corrections and attendance are pages, not one thing.
 */
export function evidenceHref(slug: string, ref: EvidenceRef): string | null {
  if (typeof slug !== "string" || !SLUG.test(slug) || !ref || typeof ref !== "object") return null;
  const base = `/app/${slug}`;
  switch (ref.kind) {
    case "task": return okId(ref.id) ? `${base}/tasks/${ref.id}` : null;
    case "message": return okId(ref.id) && okId(ref.conversationId) ? `${base}/messages?c=${ref.conversationId}#m-${ref.id}` : null;
    case "conversation": return okId(ref.id) ? `${base}/messages?c=${ref.id}` : null;
    case "doc": return okId(ref.id) ? `${base}/docs/${ref.id}` : null;
    case "follow_up": return okId(ref.id) ? `${base}/home/follow-ups/${ref.id}` : null;
    case "assistant_item": return okId(ref.id) ? `${base}/home/assistants/items/${ref.id}` : null;
    case "review": return `${base}/reviews?tab=submissions`;
    case "time_correction": return `${base}/reviews?tab=corrections`;
    case "routine_run": return okId(ref.id) ? `${base}/home/routines/${ref.id}` : null;
    case "attendance": return `${base}/attendance`;
    default: return null;
  }
}

/**
 * Text shown as typed inside Markdown: one line (every run of whitespace one space), and every character that could
 * start emphasis, code, a link, a table cell, a heading or HTML escaped. The set of copilot-excerpt's `mdText` plus
 * ( ) # < >.
 */
export function mdEscape(s: string): string {
  return String(s ?? "").replace(/\s+/g, " ").trim().replace(/[\\`*_[\]~|()#<>]/g, "\\$&");
}

/** "[label](href)", or the escaped label alone when the source has no page. */
export function evidenceLink(slug: string, ref: EvidenceRef, label: string): string {
  const href = evidenceHref(slug, ref);
  const text = mdEscape(label);
  return href ? `[${text}](${href})` : text;
}

/**
 * The sources at the end of a line: " ([task](…), [message](…))", at most `max` of them, each page once; "" when none
 * of them has a page.
 */
export function sourcesSuffix(slug: string, refs: EvidenceRef[] | null | undefined, max = 3): string {
  const seen = new Set<string>();
  const links: string[] = [];
  for (const ref of refs ?? []) {
    if (links.length >= Math.max(0, max)) break;
    const href = ref ? evidenceHref(slug, ref) : null;
    if (!href || seen.has(href)) continue;
    seen.add(href);
    links.push(`[${EVIDENCE_WORDS[ref.kind]}](${href})`);
  }
  return links.length ? ` (${links.join(", ")})` : "";
}

const readable = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n);

/** "3 tasks", "1 task", or "not available" when the figure could not be read (never "0 tasks" for that). */
export function countWords(n: number | null | undefined, one: string, many = `${one}s`): string {
  if (!readable(n)) return NOT_AVAILABLE;
  return `${n} ${n === 1 ? one : many}`;
}

/** "3", or "not available" when the figure could not be read. */
export function countOrNA(n: number | null | undefined): string {
  return readable(n) ? String(n) : NOT_AVAILABLE;
}
