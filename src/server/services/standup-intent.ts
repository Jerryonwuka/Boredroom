/**
 * The async standup in the built-in helper (owner decisions, 8–9 October 2026: phase 7c, contract F.1): what it
 * understands ("what's in my standup?", "post my standup", "skip my standup today", "who hasn't posted?") and the words it
 * answers with. Pure (unit-tested in tests/unit/standup-intent.test.ts); copilot's chatBuiltin reads the person's standup
 * as them (standupToday) and prepares the same Confirm cards as hers: posting always waits for the person's press, and the
 * helper never skips the day on its own either (a Confirm card).
 *
 * Other people's words (task titles in a draft, names and blockers in a lead's rollup) are shown as typed: never Markdown,
 * never a link (mdText); the links are the server's own (lib/evidence-links, lib/standup rollupMarkdown).
 */
import { mdText } from "@/server/services/copilot-excerpt";
import { sourcesSuffix } from "@/lib/evidence-links";
import { STANDUP_SECTIONS, entryLines, rollupMarkdown, type StandupEntryView, type StandupRollupView, type StandupSection } from "@/lib/standup";

export type StandupIntent = "show" | "post" | "skip" | "rollup";

const POST = /\bpost\s+(?:my\s+)?(?:today['’]?s\s+)?stand-?up\b/i;
const SKIP = /\bskip\s+(?:my\s+)?(?:today['’]?s\s+)?stand-?up\b|\bno\s+stand-?up\s+(?:from\s+me\s+)?today\b/i;
// "Who hasn't posted?" only when the message is about the standup (fix review, 9 October 2026: "Who posted in #design
// today?" is a Messages question).
const ROLLUP = /\bstand-?up\s+(?:rollup|summary)\b/i;
const WHO_POSTED = /\bwho\s+(?:has(?:n['’]t| not)\s+|hasn['’]t\s+|didn['’]t\s+|did not\s+)?posted\b/i;
const ABOUT_STANDUP = /\bstand-?ups?\b/i;
// "My standup", "today's standup", not a meeting called standup ("today's standup meeting agenda").
const SHOW = /\b(?:my|today['’]?s)\s+stand-?up\b(?!\s+(?:meeting|call|agenda|notes|room|slot|time|invite)\b)|\bstand-?up\s+draft\b/i;

/** What the person asks about their standup; null when it is not about it. Post and skip before show ("post my standup"). */
export function standupIntent(text: string): StandupIntent | null {
  const t = String(text ?? "");
  if (t.length > 300) return null;
  if (POST.test(t)) return "post";
  if (SKIP.test(t)) return "skip";
  if (ROLLUP.test(t) || (WHO_POSTED.test(t) && ABOUT_STANDUP.test(t))) return "rollup";
  if (SHOW.test(t)) return "show";
  return null;
}

/** "Since Friday", "Today", "Blocked": the card's headings for a draft. */
export function sectionLabel(e: Pick<StandupEntryView, "sinceLabel">, s: StandupSection): string {
  return s === "yesterday" ? e.sinceLabel || "Yesterday" : s === "today" ? "Today" : "Blocked";
}


/**
 * One entry's three sections as bold labels over lists, each drafted line with its sources (a line the person rewrote
 * carries none). Plain text from the draft or the texts, shown as typed.
 */
export function entryLists(e: StandupEntryView, slug: string): string {
  const parts: string[] = [];
  for (const s of STANDUP_SECTIONS) {
    // A drafted line keeps its sources, also after an edit when the person left it as drafted (lib/standup entryLines).
    const lines = entryLines(e, s).map((l) => `- ${mdText(l.text)}${sourcesSuffix(slug, l.refs ?? [], 3)}`);
    parts.push(`**${mdText(sectionLabel(e, s))}**\n${lines.length ? lines.join("\n") : "- Nothing"}`);
  }
  return parts.join("\n\n");
}

/** "09:41" on the organisation's clock. */
const hhmm = (iso: string, timeZone: string) => new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));

/** The helper's line for an entry that is not ready to post (posted, skipped, the day passed, failed, still drafting). */
export function entryStateWords(e: StandupEntryView, o: { timeZone: string; name: string }): string {
  const team = `**${mdText(e.team.name)}**`;
  switch (e.status) {
    case "posted": return `You posted your standup for ${team}${e.posted?.at ? ` at ${hhmm(e.posted.at, o.timeZone)}` : ""}.`;
    case "skipped": return `You skipped today's standup for ${team}. The rollup lists you under No update, like anyone who didn't post.`;
    case "missed": return `The day for your ${team} standup has passed.`;
    case "cancelled": return `Today's standup for ${team} was called off.`;
    case "failed": return `${mdText(o.name)} couldn't draft your standup for ${team} today. You can still write one in ${mdText(e.postTo.name)}.`;
    case "drafting": return `${mdText(o.name)} is still drafting your standup for ${team}.`;
    default: return `Your standup for ${team} is ready to post.`;
  }
}

/** Fixed words of the helper's standup answers. */
export const STANDUP_HELPER_WORDS = {
  none: "No standup for you today. Your team lead switches it on for the team.",
  noneReady: "Nothing is waiting to post in your standups today.",
  postLead: (team: string, channel: string, name: string) => `Your standup for **${mdText(team)}** is ready. Press Confirm to post it to ${mdText(channel)} as yours, sent by ${mdText(name)}.`,
  showLead: (team: string) => `Your standup for **${mdText(team)}** is ready to post.`,
  skipLead: (team: string) => `Skip today's standup for ${mdText(team)}? The rollup lists you under No update, like anyone who didn't post.`,
  noRollup: "No standup rollup for you today. A team's lead receives it at the rollup time.",
  rollupLead: (n: number) => (n === 1 ? "Here is today's standup rollup." : `Here are today's ${n} standup rollups.`),
  rollupOpen: "Today's rollup isn't ready yet: it arrives at the rollup time.",
} as const;

/** A sent rollup's lines for the helper (lib/standup's own Markdown, which escapes names and makes the links). */
export function rollupLines(slug: string, v: StandupRollupView): string {
  return v.content ? rollupMarkdown(slug, v) : `**${mdText(v.team.name)}**: ${STANDUP_HELPER_WORDS.rollupOpen}`;
}
