/**
 * The to-do assistant: turns a typed or dictated note ("finish the logo export by Friday, then ask Ada to
 * update the brand deck") into proposed to-dos. It only proposes; the member confirms in the browser and each
 * accepted item is created through the normal to-do path (so leads' hand-outs still notify the assignee).
 *
 * Two engines:
 *  - Claude (Anthropic API) when ANTHROPIC_API_KEY is configured: model-based extraction with a strict output schema.
 *  - Built-in parser otherwise: sentence splitting plus simple date, estimate and name matching. Weaker, but
 *    works offline and costs nothing. The response says which engine produced the proposals.
 */
import { z } from "zod";
import type { OrgContext } from "@/server/lib/api";
import { assignableMembers } from "@/server/services/tasks";
import { todayLocal, localMidnight, addDays, weekdayOf } from "@/server/lib/time";

export const planRequestSchema = z.object({ text: z.string().trim().min(1).max(4000) });

export type ProposedTodo = {
  title: string; description: string | null; dueAt: string | null;
  assigneeMembershipId: string | null; assigneeName: string | null;
  /** A name the note mentioned that is not on the member's team (shown so they can fix it). */
  unmatchedAssignee: string | null; estimateMinutes: number | null;
};
export type PlanResult = { items: ProposedTodo[]; engine: "claude" | "builtin"; note: string | null; people: { id: string; display_name: string }[] };

type Person = { id: string; display_name: string };

export function assistantConfigured() { return !!process.env.ANTHROPIC_API_KEY; }

export async function planFromText(ctx: OrgContext, input: z.infer<typeof planRequestSchema>): Promise<PlanResult> {
  const people = ctx.membership.role === "owner" || ctx.membership.role === "hr" ? [] : await assignableMembers(ctx);
  const today = todayLocal(ctx.org.timezone);
  if (assistantConfigured()) {
    try {
      const items = await planWithClaude(input.text, { people, today, timezone: ctx.org.timezone, leadName: ctx.user.displayName });
      return { items, engine: "claude", note: null, people };
    } catch (err) {
      const items = planBuiltin(input.text, { people, today, timezone: ctx.org.timezone });
      return { items, engine: "builtin", note: `The AI assistant could not be reached (${(err as Error).message.slice(0, 120)}). The built-in parser was used instead.`, people };
    }
  }
  return { items: planBuiltin(input.text, { people, today, timezone: ctx.org.timezone }), engine: "builtin", note: null, people };
}

// ---- Claude ---------------------------------------------------------------

const ClaudeOutput = z.object({
  items: z.array(z.object({
    title: z.string().describe("Short imperative to-do title, at most 120 characters"),
    description: z.string().nullable().describe("Extra detail from the note that does not fit the title, or null"),
    due: z.string().nullable().describe("Deadline as ISO 8601 with timezone offset, or null when the note gives none"),
    assignee: z.string().nullable().describe("Exactly one of the listed team member names, or null when the note does not hand the item to someone"),
    estimateMinutes: z.number().int().nullable().describe("Effort estimate in minutes when the note states one, else null"),
  })),
});

async function planWithClaude(text: string, opts: { people: Person[]; today: string; timezone: string; leadName: string }): Promise<ProposedTodo[]> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const { zodOutputFormat } = await import("@anthropic-ai/sdk/helpers/zod");
  const client = new Anthropic();
  const names = opts.people.map((p) => p.display_name);
  const system = [
    "You turn a worker's spoken or typed note about their work into a list of to-dos for a work tracker.",
    `Today is ${opts.today} in the ${opts.timezone} timezone; resolve relative dates ("Friday", "tomorrow", "end of the month") against it and use 17:00 local time when the note gives a day but no time.`,
    "One item per distinct piece of work, in the order mentioned. Keep titles short and imperative. Do not invent work that the note does not mention.",
    names.length
      ? `The note is from a team lead (${opts.leadName}). They may hand items to these team members only: ${names.join(", ")}. Set assignee to the exact listed name when the note clearly gives the item to that person; otherwise null (the lead keeps it).`
      : "The note is from a staff member; every item is for them. Set assignee to null.",
  ].join("\n");
  const res = await client.messages.parse({
    model: process.env.ASSISTANT_MODEL ?? "claude-opus-5",
    max_tokens: 4000,
    thinking: { type: "adaptive" },
    system,
    messages: [{ role: "user", content: text }],
    output_config: { format: zodOutputFormat(ClaudeOutput) },
  });
  const parsed = res.parsed_output;
  if (!parsed) throw new Error("The assistant returned no usable items.");
  return parsed.items.slice(0, 25).map((it) => {
    const person = it.assignee ? matchPerson(it.assignee, opts.people) : null;
    const due = it.due && !Number.isNaN(Date.parse(it.due)) ? new Date(it.due).toISOString() : null;
    return { title: cleanTitle(it.title).slice(0, 200) || "Untitled to-do", description: it.description?.trim() || null, dueAt: due, assigneeMembershipId: person?.id ?? null, assigneeName: person?.display_name ?? null, unmatchedAssignee: it.assignee && !person ? it.assignee : null, estimateMinutes: it.estimateMinutes && it.estimateMinutes > 0 ? Math.round(it.estimateMinutes) : null };
  });
}

// ---- Built-in parser ------------------------------------------------------

const FILLER = /^(?:ok(?:ay)?|so|um+|uh+|right|well|and|then|also|hi|hello|thanks|thank you)$/i;
const FILLER_PREFIX = /^(?:ok(?:ay)?|so|um+|uh+|right|well|and|then|also|next|first|second|third|finally|after that|basically|actually|yeah|yes)[,\s]+/i;
const LEAD_IN = /^(?:(?:i|we)(?:'m going to| am going to|'ll need to| will need to|'ll have to| will have to| have to| need to| want to| should| must| got to| gotta| plan to| will|'ll|'m| am)|need to|have to|todo|to do|task|please|can you|could you|remind me to|make sure to|make sure i|don't forget to|do not forget to|i also need to|also)\s*[:\-]?\s*/i;
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export function planBuiltin(text: string, opts: { people: Person[]; today: string; timezone: string }): ProposedTodo[] {
  const parts = splitNote(text);
  const items: ProposedTodo[] = [];
  for (const raw of parts) {
    let s = raw.trim();
    if (!s || FILLER.test(s)) continue;
    let person: Person | null = null;
    let unmatched: string | null = null;
    if (opts.people.length) { const r = extractAssignee(s, opts.people); s = r.text; person = r.person; unmatched = r.unmatched; }
    const est = extractEstimate(s); s = est.text;
    const due = extractDue(s, opts.today, opts.timezone); s = due.text;
    const title = cleanTitle(s);
    if (title.length < 3) continue;
    items.push({ title: title.slice(0, 200), description: null, dueAt: due.iso, assigneeMembershipId: person?.id ?? null, assigneeName: person?.display_name ?? null, unmatchedAssignee: unmatched, estimateMinutes: est.minutes });
    if (items.length >= 25) break;
  }
  return items;
}

function splitNote(text: string): string[] {
  return text
    .replace(/\r/g, "")
    .split(/\n+|(?<=[.;!?])\s+|\s*(?:,\s*)?(?:and then|then|after that|and also|also)\s+|\s*;\s*/i)
    .flatMap((p) => p.split(/^\s*(?:[-*•]|\d+[.)])\s*/m))
    .map((p) => p.trim())
    .filter(Boolean);
}

function extractAssignee(s: string, people: Person[]): { text: string; person: Person | null; unmatched: string | null } {
  const name = "([A-Z][\\w'-]+(?:\\s+[A-Z][\\w'-]+)?)";
  const patterns: { re: RegExp; text: (m: RegExpMatchArray) => string; name: (m: RegExpMatchArray) => string }[] = [
    { re: new RegExp(`^(?:ask|tell|get|have|let)\\s+${name}\\s+(?:to|for)\\s+(.+)$`, "i"), text: (m) => m[2], name: (m) => m[1] },
    { re: new RegExp(`^(?:assign|give|hand)\\s+(.+?)\\s+to\\s+${name}\\s*$`, "i"), text: (m) => m[1], name: (m) => m[2] },
    { re: new RegExp(`^${name}\\s+(?:should|will|can|needs? to|has to|must|is going to|to|:)\\s+(.+)$`), text: (m) => m[2], name: (m) => m[1] },
    { re: new RegExp(`^(.+?)\\s*[,-]?\\s+(?:for|to|by)\\s+${name}\\s*$`), text: (m) => m[1], name: (m) => m[2] },
    { re: new RegExp(`^${name}\\s*[:-]\\s*(.+)$`), text: (m) => m[2], name: (m) => m[1] },
  ];
  for (const p of patterns) {
    const m = s.match(p.re);
    if (!m) continue;
    const candidate = p.name(m);
    if (/^(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|eod|noon)$/i.test(candidate)) continue;
    const person = matchPerson(candidate, people);
    if (person) return { text: p.text(m), person, unmatched: null };
    // A capitalised word that is not a team member is kept in the title, unless it clearly names a person ("ask Bob to").
    if (/^(?:ask|tell|get|have|let|assign|give|hand)/i.test(s)) return { text: p.text(m), person: null, unmatched: candidate };
  }
  return { text: s, person: null, unmatched: null };
}

export function matchPerson(name: string, people: Person[]): Person | null {
  const n = name.trim().toLowerCase();
  if (!n) return null;
  const exact = people.filter((p) => p.display_name.toLowerCase() === n);
  if (exact.length === 1) return exact[0];
  const first = people.filter((p) => p.display_name.toLowerCase().split(/\s+/)[0] === n.split(/\s+/)[0]);
  if (first.length === 1) return first[0];
  const contains = people.filter((p) => p.display_name.toLowerCase().includes(n) || n.includes(p.display_name.toLowerCase()));
  return contains.length === 1 ? contains[0] : null;
}

function extractEstimate(s: string): { text: string; minutes: number | null } {
  const m = s.match(/\(?\b(?:about|around|roughly|approx\.?|~)?\s*(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)\b\)?/i);
  if (!m) return { text: s, minutes: null };
  const n = Number(m[1]);
  const minutes = /^h/i.test(m[2]) ? Math.round(n * 60) : Math.round(n);
  if (!minutes) return { text: s, minutes: null };
  return { text: (s.slice(0, m.index) + s.slice((m.index ?? 0) + m[0].length)).replace(/\s{2,}/g, " ").trim(), minutes };
}

function extractDue(s: string, today: string, tz: string): { text: string; iso: string | null } {
  const at = (date: string, hour: number, minute = 0) => new Date(localMidnight(date, tz).getTime() + (hour * 60 + minute) * 60_000).toISOString();
  const time = s.match(/\b(?:at|by|before)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  let hour = 17, minute = 0, timeSpan: [number, number] | null = null;
  if (time && (time[3] || Number(time[1]) <= 23)) {
    hour = Number(time[1]) % 12 + (time[3]?.toLowerCase() === "pm" ? 12 : 0);
    if (!time[3] && Number(time[1]) > 12) hour = Number(time[1]);
    if (!time[3] && Number(time[1]) <= 6) hour += 12; // "by 3" on a workday means 15:00
    minute = Number(time[2] ?? 0);
    timeSpan = [time.index ?? 0, (time.index ?? 0) + time[0].length];
  }
  const dayRe = /\b(?:(?:by|before|on|until|due|for|until)\s+)?(today|tonight|tomorrow|end of (?:the )?day|eod|end of (?:the )?week|this week|next week|end of (?:the )?month|this month|(?:next\s+|this\s+|on\s+|by\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)|in\s+(\d+)\s+days?)\b/i;
  const m = s.match(dayRe);
  let date: string | null = null;
  if (m) {
    const w = m[1].toLowerCase();
    const dow = weekdayOf(today);
    if (w === "today" || w === "tonight" || w.startsWith("end of the day") || w.startsWith("end of day") || w === "eod") date = today;
    else if (w === "tomorrow") date = addDays(today, 1);
    else if (w.includes("week") && !w.includes("next")) date = addDays(today, ((5 - dow) + 7) % 7 || 0); // this Friday
    else if (w === "next week") date = addDays(today, ((1 - dow) + 7) % 7 || 7); // next Monday
    else if (w.includes("month")) { const [y, mo] = today.split("-").map(Number); const last = new Date(Date.UTC(y, mo, 0)).getUTCDate(); date = `${today.slice(0, 8)}${String(last).padStart(2, "0")}`; }
    else if (m[2]) { const target = WEEKDAYS.indexOf(m[2].toLowerCase()); let delta = (target - dow + 7) % 7; if (delta === 0) delta = 7; date = addDays(today, delta); }
    else if (m[3]) date = addDays(today, Number(m[3]));
  } else if (timeSpan) date = today;
  if (!date) return { text: s, iso: null };
  let out = s;
  const cuts = [m ? [m.index ?? 0, (m.index ?? 0) + m[0].length] : null, timeSpan].filter(Boolean) as [number, number][];
  cuts.sort((a, b) => b[0] - a[0]);
  for (const [a, b] of cuts) out = out.slice(0, a) + " " + out.slice(b);
  return { text: out.replace(/\s{2,}/g, " ").trim(), iso: at(date, hour, minute) };
}

export function cleanTitle(s: string): string {
  let t = s.trim().replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, "");
  for (let i = 0; i < 4; i++) t = t.replace(FILLER_PREFIX, "").replace(LEAD_IN, "");
  t = t.replace(/\s{2,}/g, " ").trim().replace(/[.!?]+$/, "");
  return t ? t[0].toUpperCase() + t.slice(1) : "";
}
