/**
 * Brenda's research report, from the model's last turn to its structure and its Markdown (owner decision, 28 October
 * 2026: "Brenda, research X and give me a PDF when you're done"). Pure: no I/O.
 *
 * - Sources come from the API itself, never from the model's words: each `web_search_result_location` citation on a text
 *   block (its URL and page title) is a numbered source in the order first cited, and the cited text gets its numbers
 *   ("… [1][3]"); pages the model fetched (`web_fetch_tool_result`, their URL and document title) follow, numbered on.
 *   A URL is listed once. Only http and https addresses are kept.
 * - The report's words are the text written after the last tool result (what came before is the model thinking aloud
 *   between searches); with none after it, every text block.
 * - The Markdown the model wrote is read into a title (its first # heading, else the topic), a summary (## Summary), key
 *   findings (the list under ## Key findings), and the other ## sections in order. A ## Sources section it wrote itself is
 *   dropped: the numbered list above replaces it. The file's Markdown is then written from that structure, so the PDF,
 *   Word and Markdown files all say the same thing.
 */
import { safeHref } from "@/server/research/blocks";
import { RESEARCH_LIMITS, type ResearchReport, type ResearchSection, type ResearchSource } from "@/lib/research";

type Citation = { type?: string; url?: string | null; title?: string | null };
type Block = { type?: string; text?: string; citations?: Citation[] | null; content?: unknown };

const TOOL_RESULT = new Set(["web_search_tool_result", "web_fetch_tool_result", "server_tool_use", "bash_code_execution_tool_result", "code_execution_tool_result", "text_editor_code_execution_tool_result"]);
const oneLine = (s: string, max: number) => s.replace(/[\p{Cc}\u2028\u2029]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** The sources and the report's text with citation numbers, from a turn's content blocks. */
export function sourcesAndText(content: readonly Block[]): { text: string; sources: ResearchSource[] } {
  const sources: ResearchSource[] = [];
  const byUrl = new Map<string, number>();
  const numberOf = (url: string, title: string) => {
    const href = safeHref(url);
    if (!href) return null;
    const known = byUrl.get(href);
    if (known) return known;
    if (sources.length >= 200) return null;
    const n = sources.length + 1;
    sources.push({ n, url: href, title: oneLine(title || new URL(href).hostname, 300) || href });
    byUrl.set(href, n);
    return n;
  };
  let lastTool = -1;
  content.forEach((b, i) => { if (b?.type && TOOL_RESULT.has(b.type)) lastTool = i; });
  const after = content.slice(lastTool + 1).filter((b) => b?.type === "text");
  const texts = after.length ? after : content.filter((b) => b?.type === "text");
  let text = "";
  for (const b of texts) {
    const nums = new Set<number>();
    for (const c of b.citations ?? []) {
      if (c?.type === "web_search_result_location" && typeof c.url === "string") {
        const n = numberOf(c.url, String(c.title ?? ""));
        if (n) nums.add(n);
      }
    }
    const t = String(b.text ?? "");
    text += nums.size ? `${t.replace(/\s+$/, "")} ${[...nums].sort((a, z) => a - z).map((n) => `[${n}]`).join("")}${/\s$/.test(t) ? t.match(/\s+$/)![0] : ""}` : t;
  }
  // Pages it read, after the cited results.
  for (const b of content) {
    if (b?.type !== "web_fetch_tool_result") continue;
    const r = b.content as { type?: string; url?: string; content?: { title?: string | null } } | null;
    if (r?.type === "web_fetch_result" && typeof r.url === "string") numberOf(r.url, String(r.content?.title ?? ""));
  }
  return { text: text.trim(), sources };
}

const SUMMARY = /^(summary|executive summary|in short|overview)$/i;
const FINDINGS = /^(key findings|findings|key points|main findings)$/i;
const SOURCES = /^(sources|references|bibliography|citations)$/i;

/** The report's structure from its Markdown and sources. */
export function structureOf(markdown: string, sources: ResearchSource[], o: { topic: string; writtenAt: string }): ResearchReport {
  let title = "";
  const sections: { heading: string; lines: string[] }[] = [];
  const intro: string[] = [];
  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const h1 = /^\s{0,3}#\s+(.*?)\s*#*\s*$/.exec(line);
    if (h1 && !title && !sections.length) { title = h1[1]; continue; }
    const h2 = /^\s{0,3}##\s+(.*?)\s*#*\s*$/.exec(line);
    if (h2) { sections.push({ heading: h2[1].replace(/[*_]/g, "").trim(), lines: [] }); continue; }
    (sections.length ? sections[sections.length - 1].lines : intro).push(line);
  }
  const body = (lines: string[]) => lines.join("\n").replace(/^\n+|\n+$/g, "").trim();
  let summary = "";
  let keyFindings: string[] = [];
  const rest: ResearchSection[] = [];
  for (const s of sections) {
    if (SOURCES.test(s.heading)) continue;
    if (!summary && SUMMARY.test(s.heading)) { summary = body(s.lines); continue; }
    if (!keyFindings.length && FINDINGS.test(s.heading)) {
      const items = s.lines.map((l) => /^\s*(?:[-*+•]|\d{1,3}[.)])\s+(.*)$/.exec(l)?.[1]?.trim()).filter((x): x is string => !!x);
      if (items.length) { keyFindings = items.slice(0, 20); continue; }
    }
    const b = body(s.lines);
    if (b || s.heading) rest.push({ heading: oneLine(s.heading, 200) || "Notes", body: b });
  }
  if (!summary && body(intro)) summary = body(intro);
  else if (body(intro)) rest.unshift({ heading: "Background", body: body(intro) });
  return {
    title: oneLine(title.replace(/[*_]/g, ""), 200) || oneLine(o.topic, 200),
    summary, keyFindings, sections: rest, sources, writtenAt: o.writtenAt, topic: o.topic,
  };
}

const dateWords = (iso: string, tz: string) => {
  try { return new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "long", year: "numeric" }).format(new Date(iso)); }
  catch { return iso.slice(0, 10); }
};

/** The report's one-line byline ("Boredroom research, 28 October 2026"). */
export const bylineOf = (r: Pick<ResearchReport, "writtenAt">, tz = "UTC") => `Boredroom research, ${dateWords(r.writtenAt, tz)}`;

/** The file's Markdown, written from the structure (the Markdown download, and what is stored). */
export function markdownOf(r: ResearchReport, tz = "UTC"): string {
  const out: string[] = [`# ${r.title}`, "", `_${bylineOf(r, tz)}. The question: ${oneLine(r.topic, 500)}_`, ""];
  if (r.summary) out.push("## Summary", "", r.summary, "");
  if (r.keyFindings.length) out.push("## Key findings", "", ...r.keyFindings.map((k) => `- ${k}`), "");
  for (const s of r.sections) out.push(`## ${s.heading}`, "", ...(s.body ? [s.body, ""] : []));
  if (r.sources.length) out.push("## Sources", "", ...r.sources.map((s) => `${s.n}. [${s.title.replace(/[[\]]/g, "")}](${s.url})`), "");
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim().concat("\n").slice(0, RESEARCH_LIMITS.markdownChars);
}

/** Everything a finished turn gives: the structure and the Markdown. */
export function buildReport(content: readonly Block[], o: { topic: string; writtenAt: string; timeZone?: string }): { report: ResearchReport; markdown: string } | null {
  const { text, sources } = sourcesAndText(content);
  if (!text) return null;
  const report = structureOf(text, sources, o);
  if (!report.summary && !report.sections.length && !report.keyFindings.length) return null;
  return { report, markdown: markdownOf(report, o.timeZone) };
}
