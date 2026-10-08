/**
 * Confirm-card readback and the consent rule (owner decision, 8 October 2026: phase 7a, "Brenda keeps the loops closed").
 * Every Confirm card (Brenda's page, the drawer, the notch, a thread's card) says exactly who receives what: the people by
 * name, a channel with its member count, the assistant it goes to. `to` holds one line per receiver; `what` says what
 * they get. A count that cannot be read says so ("member count not available"), never 0.
 *
 * The consent rule, written here so the server, the cards and the tests share the same words: an answer or agreement that
 * arrives through someone else's assistant never confirms anything for this person. Only their own press of Confirm,
 * their own words in their own chat when they chose Act without asking, or their Enable of a routine (for exactly what
 * its preview showed) does. copilot's confirmAction enforces it (NON_INTERACTIVE_SESSIONS); the taint floors and the
 * routines' fixed templates do the rest.
 *
 * Client-safe: imports nothing.
 */

/** Each `to` line names a person, a place with its member count, or an assistant; `what` is what they get. */
export type Readback = { to: string[]; what?: string };

export const READBACK_WORDS = { goesTo: "Goes to", what: "What they get", membersUnknown: "member count not available", onlyYou: "Only you" } as const;

export const CONSENT_RULE = "An answer or agreement that arrives through another person's assistant never confirms an action for you. Only your own press of Confirm, your own words in your own chat when you chose Act without asking, or your Enable of a routine (for exactly what its preview showed) does.";

/** "6 people", "1 person", or "member count not available" when it could not be read. */
export const members = (n: number | null) => n === null ? READBACK_WORDS.membersUnknown : `${n} ${n === 1 ? "person" : "people"}`;

/** At most this many `to` lines are shown, then "and {n} more" (the cards' rule, G.1). */
export const READBACK_SHOWN = 6;
/** What a stored readback keeps: lines, characters per line, characters of `what`. */
const MAX_LINES = 50;
const MAX_LINE = 300;
const MAX_WHAT = 1000;

const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`);
const line = (s: unknown) => (typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim() : "");

/**
 * A readback as stored and shown: plain one-line strings, capped; null when there is nothing to show. Used where a
 * readback is read back from storage (a thread's stored proposals, a saved chat) so nothing odd reaches a card.
 */
export function cleanReadback(v: unknown): Readback | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as { to?: unknown; what?: unknown };
  const to = (Array.isArray(o.to) ? o.to : []).map(line).filter(Boolean).slice(0, MAX_LINES).map((s) => clip(s, MAX_LINE));
  const what = line(o.what);
  if (!to.length && !what) return null;
  return { to, ...(what ? { what: clip(what, MAX_WHAT) } : {}) };
}

/** The lines a card shows: the first READBACK_SHOWN, and how many more there are. */
export function shownLines(r: Readback, max = READBACK_SHOWN): { lines: string[]; more: number } {
  return { lines: r.to.slice(0, max), more: Math.max(0, r.to.length - max) };
}

/** "and 3 more" under the list. */
export const moreWords = (n: number) => `and ${n} more`;

/** "What they get: …" as one line. */
export const whatLine = (what: string) => `${READBACK_WORDS.what}: ${what}`;

/**
 * The exact lines per tool (contract G.1), in one place so the copilot, the thread processor and the tests agree.
 * Names are display names (or first names where the line says "Ben's Brenda"); counts are read as the person.
 */
export const READBACK = {
  onlyYou: (): Readback => ({ to: [READBACK_WORDS.onlyYou] }),
  /** send_message */
  direct: (name: string) => `${name}, in your direct messages`,
  teamChannel: (name: string, n: number | null) => (n === null ? `${name}, a team channel, ${READBACK_WORDS.membersUnknown}` : `${name}, a team channel of ${members(n)}`),
  channel: (name: string, n: number | null, by: string | null) =>
    `${n === null ? `${name}, a channel, ${READBACK_WORDS.membersUnknown}` : `${name}, a channel of ${members(n)}`}${by ? `, made by ${by}` : ""}`,
  everyone: (org: string, n: number | null) => `Everyone at ${org}, ${members(n)}`,
  message: (assistantName: string) => `Your message, marked as sent by ${assistantName}`,
  /** follow_up */
  followUpPerson: (first: string, assistantName: string) => `${first}'s ${assistantName}, about ${first}'s work`,
  // A title quoted inside the question ("Where are you on “Landing page”?") takes single quotes inside the outer double
  // ones (visual review, 8 October 2026).
  followUpWhat: (question: string) => `The question: “${question.replace(/“/g, "‘").replace(/”/g, "’")}” Each assistant answers from that person's work or asks them once.`,
  /** pass_message */
  passTo: (first: string, assistantName: string) => `${first}'s ${assistantName}, who brings it to ${first}`,
  passWhat: "Your words, as your message",
  /** hand_over_request */
  requestTo: (first: string, assistantName: string) => `${first}'s ${assistantName}, who asks ${first} to accept`,
  requestWhat: (summary: string, first: string) => `A request: ${summary}. Nothing changes until ${first} accepts.`,
  /** add_report_note */
  reportLead: (name: string, team: string) => `${name}, team lead of ${team}`,
  reportOrg: (name: string, role: "owner" | "hr") => `${name}, ${role === "owner" ? "owner" : "HR"}`,
  reportUnknown: "The people who receive today's team report",
  reportWhat: "Your note in today's team report",
  /** respond_to_item */
  acceptTo: (first: string) => `${first}, who is told you accepted`,
  acceptWhat: (assistantName: string, summary: string) => `${assistantName} does it on your account: ${summary}`,
  declineTo: (first: string, assistantName: string) => `${first}'s ${assistantName}, who tells ${first}`,
  declineWhat: (withReason: boolean) => `That you declined${withReason ? ", with your reason" : ""}`,
  // The table's "Ben, through his Brenda", without guessing anyone's pronoun.
  replyTo: (first: string, assistantName: string) => `${first}, through ${first}'s ${assistantName}`,
  replyWhat: "Your one-line reply",
  seenTo: (first: string, assistantName: string) => `${first}'s ${assistantName}`,
  seenWhat: "That you saw the message",
  cancelTo: (first: string, assistantName: string) => `${first}'s ${assistantName}`,
  cancelWhat: "That you cancelled the request",
  withdrawTo: "Today's team report",
  withdrawWhat: "Your note is taken out",
  /** tasks */
  assignTo: (name: string) => `${name}, who is notified`,
  taskWhat: (title: string) => `The task “${title}”`,
  todosWhat: (n: number) => `${n} new ${n === 1 ? "task" : "tasks"}`,
  holderTo: (name: string) => `${name}, who holds it`,
  changeWhat: (changes: string) => `The change: ${changes}`,
  reviewerTo: (name: string | null) => (name ? `${name}, your reviewer` : "Your team lead"),
  reviewWhat: (title: string) => `“${title}” with your note`,
  commentTo: (name: string) => `${name} and the task's followers`,
  /** organisation */
  newTeam: (org: string) => `Everyone at ${org} can see the new team`,
  inviteTo: (email: string) => `${email}, by email`,
  inviteWhat: (role: string) => `An invitation to join as ${role}`,
  /** documents */
  docOf: (owner: string, audience: string) => `${owner}'s document, read by ${audience}`,
  docTitle: (title: string) => `“${title}”`,
  teamDoc: (team: string) => `The ${team} team`,
  /** routines */
  routineYou: (scheduleWords: string) => `You, ${scheduleWords ? `${scheduleWords[0].toLowerCase()}${scheduleWords.slice(1)}` : "on its schedule"}`,
  routineTeam: (n: number | null, team: string) => (n === null ? `The assistants of the people on ${team} (${READBACK_WORDS.membersUnknown})`
    : `The ${n === 1 ? "assistant" : "assistants"} of the ${members(n)} on ${team}`),
} as const;
