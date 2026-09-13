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
import { withSystem } from "@/server/db";
import { decryptSecret } from "@/server/lib/crypto";
import { assignableMembers } from "@/server/services/tasks";
import { todayLocal, localMidnight, addDays, weekdayOf } from "@/server/lib/time";

export const DEFAULT_ASSISTANT_MODEL = "claude-opus-5";

export type AssistantConnection = { apiKey: string; model: string; source: "organisation" | "environment" };

/** The organisation's own key (Settings → AI assistant) wins; the server's ANTHROPIC_API_KEY is the fallback. */
export async function resolveAssistant(orgId: string): Promise<AssistantConnection | null> {
  const row = await withSystem((db) => db.maybeOne<{ assistant_key_enc: string | null; assistant_model: string | null }>(`SELECT assistant_key_enc, assistant_model FROM organisation_secrets WHERE organisation_id = $1`, [orgId]));
  const orgKey = row?.assistant_key_enc ? decryptSecret(row.assistant_key_enc) : null;
  if (orgKey) return { apiKey: orgKey, model: row?.assistant_model || process.env.ASSISTANT_MODEL || DEFAULT_ASSISTANT_MODEL, source: "organisation" };
  if (process.env.ANTHROPIC_API_KEY) return { apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.ASSISTANT_MODEL || DEFAULT_ASSISTANT_MODEL, source: "environment" };
  return null;
}

/** Makes one tiny request with a candidate key so Settings can say "connected" only when it really works. */
export async function testAssistantKey(apiKey: string, model: string): Promise<{ model: string; reply: string }> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 30_000 });
  const res = await client.messages.create({ model, max_tokens: 40, messages: [{ role: "user", content: "Reply with one short friendly sentence confirming you are connected to Boredroom." }] });
  const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  return { model: res.model, reply: text || "Connected." };
}

export const planRequestSchema = z.object({ text: z.string().trim().min(1).max(4000) });

export type ProposedTodo = {
  title: string; description: string | null; dueAt: string | null;
  assigneeMembershipId: string | null; assigneeName: string | null;
  /** A name the note mentioned that is not on the member's team (shown so they can fix it). */
  unmatchedAssignee: string | null; estimateMinutes: number | null;
};
export type PlanResult = { items: ProposedTodo[]; engine: "claude" | "builtin"; reply: string | null; note: string | null; people: { id: string; display_name: string }[] };

type Person = { id: string; display_name: string };

/** Whether an AI connection exists for this organisation (its own key or the server's). */
export async function assistantConfigured(orgId: string): Promise<boolean> { return !!(await resolveAssistant(orgId)); }

export async function planFromText(ctx: OrgContext, input: z.infer<typeof planRequestSchema>): Promise<PlanResult> {
  const people = ctx.membership.role === "owner" || ctx.membership.role === "hr" ? [] : await assignableMembers(ctx);
  const today = todayLocal(ctx.org.timezone);
  const conn = await resolveAssistant(ctx.org.id);
  if (conn) {
    try {
      const r = await planWithClaude(conn, input.text, { people, today, timezone: ctx.org.timezone, leadName: ctx.user.displayName, isLead: people.length > 0 });
      return { items: r.items, engine: "claude", reply: r.reply, note: null, people };
    } catch (err) {
      const items = planBuiltin(input.text, { people, today, timezone: ctx.org.timezone });
      return { items, engine: "builtin", reply: null, note: `Claude could not be reached (${describeError(err)}). The built-in parser was used instead.`, people };
    }
  }
  return { items: planBuiltin(input.text, { people, today, timezone: ctx.org.timezone }), engine: "builtin", reply: null, note: null, people };
}

function describeError(err: unknown): string {
  const e = err as { status?: number; message?: string };
  if (e?.status === 401) return "the API key was rejected";
  if (e?.status === 429) return "rate limit or credit limit reached";
  if (e?.status === 404) return "the configured model was not found";
  return (e?.message ?? String(err)).slice(0, 140);
}

// ---- Claude ---------------------------------------------------------------

const ClaudeOutput = z.object({
  reply: z.string().describe("One or two friendly sentences to the person: what you understood, anything you assumed (dates, who gets what), and anything unclear. Plain text, no lists."),
  items: z.array(z.object({
    title: z.string().describe("Short imperative to-do title, at most 120 characters"),
    description: z.string().nullable().describe("Extra detail from the note that does not fit the title, or null"),
    due: z.string().nullable().describe("Deadline as ISO 8601 with timezone offset, or null when the note gives none"),
    assignee: z.string().nullable().describe("Exactly one of the listed team member names, or null when the note does not hand the item to someone"),
    estimateMinutes: z.number().int().nullable().describe("Effort estimate in minutes when the note states one, else null"),
  })),
});

async function planWithClaude(conn: AssistantConnection, text: string, opts: { people: Person[]; today: string; timezone: string; leadName: string; isLead: boolean }): Promise<{ items: ProposedTodo[]; reply: string }> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const { zodOutputFormat } = await import("@anthropic-ai/sdk/helpers/zod");
  const client = new Anthropic({ apiKey: conn.apiKey, maxRetries: 2, timeout: 60_000 });
  const names = opts.people.map((p) => p.display_name);
  const weekday = new Date(`${opts.today}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
  const system = [
    "You are the to-do assistant inside Boredroom, a work tracker. A person tells you, in speech or text, what they are working on; you turn it into clear to-dos they can start a timer on.",
    `Today is ${weekday} ${opts.today} in the ${opts.timezone} timezone. Resolve relative dates ("Friday", "tomorrow", "end of the month", "next week") against today and give ISO 8601 datetimes with the correct offset for that timezone. Use 17:00 local time when the note gives a day but no time. When no deadline is mentioned, due is null.`,
    "Write one item per distinct piece of work, in the order mentioned. Titles are short and imperative (\"Send the invoice to Acme\"), at most 120 characters. Put useful detail from the note (links, what done looks like, context) in description; otherwise null. Never invent work the note does not mention; never merge unrelated work into one item. Dictated notes contain filler and mistakes: read through them.",
    "estimateMinutes only when the note states an effort (\"about two hours\" → 120); otherwise null.",
    opts.isLead
      ? `The note is from a team lead, ${opts.leadName}. They may hand items to these team members only: ${names.join(", ")}. Set assignee to the exact listed name when the note gives the item to that person (\"ask Ada to…\", \"Ben should…\", \"for Chidi\"); when the person named is not on the list, leave assignee null and say so in the reply; when nobody is named, the lead keeps it (null).`
      : `The note is from ${opts.leadName}, a staff member. Every item is for them; set assignee to null. If the note asks someone else to do something, keep the item as a reminder for them (e.g. "Ask Ada to…").`,
    "In reply, speak directly to the person in one or two warm, plain sentences: what you set up and any assumption you made (dates, assignees). If the note contains no work at all, return an empty items list and explain in reply.",
  ].join("\n");
  const res = await client.messages.parse({
    model: conn.model,
    max_tokens: 4000,
    thinking: { type: "adaptive" },
    system,
    messages: [{ role: "user", content: text }],
    output_config: { format: zodOutputFormat(ClaudeOutput) },
  });
  const parsed = res.parsed_output;
  if (!parsed) throw new Error("the model returned no usable items");
  const items = parsed.items.slice(0, 25).map((it) => {
    const person = it.assignee ? matchPerson(it.assignee, opts.people) : null;
    const due = it.due && !Number.isNaN(Date.parse(it.due)) ? new Date(it.due).toISOString() : null;
    return { title: it.title.trim().replace(/[.!]+$/, "").slice(0, 200) || "Untitled to-do", description: it.description?.trim() || null, dueAt: due, assigneeMembershipId: person?.id ?? null, assigneeName: person?.display_name ?? null, unmatchedAssignee: it.assignee && !person ? it.assignee : null, estimateMinutes: it.estimateMinutes && it.estimateMinutes > 0 ? Math.round(it.estimateMinutes) : null };
  });
  return { items, reply: parsed.reply.trim() };
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
