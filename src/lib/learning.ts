/**
 * "What Brenda has learned" (owner decision, 28 October 2026: "I want her to learn from the person's usage and
 * interaction with her and interact with the person based on that"). Phase 7c's "How I like things done" holds what the
 * person TOLD their assistant; this holds what she noticed from how they use her: the formats they choose, the apps and
 * browsers they ask for on their Mac, how long they like replies, when they are usually about, how they answer her
 * Confirm cards. At most 12 habits a person, each one short plain sentence ("Prefers PDF for reports", "Uses Brave for
 * browsing", "Likes short replies", "Usually starts around 08:30").
 *
 * The rules (owner decision, 28 October 2026), kept twice: in the learning model's prompt and here, on the server, over
 * whatever the model returns (`learnedProblem`):
 * - work style and tool preferences only; never health, religion, politics, sexuality, ethnicity, trade unions, money,
 *   family or private life, and never anything about another person;
 * - never a judgement, a rating or a measure of how much or how well someone works; never used to monitor or report;
 * - never a permission or an instruction (the same check as a preference: "act without asking" is refused);
 * - private to the person: owners, HR and leads never see it (migration 0067's row security), and while someone else is
 *   signed in as them nothing is shown or recorded;
 * - their own stated preferences always win, and a learned habit never changes a Confirm rule or what she may do.
 *
 * Client-safe: imports only lib/preferences (itself import-free).
 */
import { cleanPreference, preferenceProblem } from "@/lib/preferences";

export const LEARNING_LIMITS = {
  /** Active habits a person. */
  max: 12,
  /** Characters in a habit's sentence. */
  chars: 120,
  /** A signal's words. */
  signalChars: 200,
  /** Signals are kept this many days, then the worker's purge deletes them. */
  keepDays: 30,
  /** Learn after this many of the person's turns since the last time, at most once an hour… */
  everyTurns: 15,
  minGapMinutes: 60,
  /** …or once a day when they used her at least this many times since. */
  dailyMinTurns: 5,
  dailyHours: 24,
  /** What one run reads: the newest signals, at most. */
  signalsPerRun: 150,
  /** Below this confidence (0–100) a habit is not kept. */
  minConfidence: 30,
} as const;

export const LEARNED_KINDS = ["format", "app", "length", "tone", "timing", "workflow", "other"] as const;
export type LearnedKind = (typeof LEARNED_KINDS)[number];
export const isLearnedKind = (v: unknown): v is LearnedKind => (LEARNED_KINDS as readonly unknown[]).includes(v);

export type LearnedHabit = { id: string; body: string; kind: LearnedKind; confidence: number; evidence: number; lastSeen: string; createdAt: string };
/**
 * The Settings card's view. `ready` false before 0067 ("coming"); `hidden` while someone else is signed in as the person;
 * `enabled`: the person's switch (on by default).
 */
export type LearnedList = { ready: boolean; hidden: boolean; enabled: boolean; items: LearnedHabit[]; max: number };

// ---- What may be learned (the server's second guard over the model's answer) --------------------------------------------

/** Special-category and private-life subjects (owner decision, 28 October 2026): never learned. */
const SENSITIVE = new RegExp(String.raw`\b(?:${[
  // health
  "health", "ill(?:ness)?", "sick", "disab\\w*", "medic\\w*", "doctor", "hospital", "therap\\w*", "pregnan\\w*", "diagnos\\w*", "symptom\\w*",
  "mental", "anxiety", "depress\\w*", "adhd", "autis\\w*", "diet\\w*", "allerg\\w*", "medication", "clinic", "period(?:s)? pain", "migraine\\w*",
  // religion and belief
  "relig\\w*", "pray\\w*", "church", "mosque", "synagogue", "temple", "faith", "christian\\w*", "muslim\\w*", "islam\\w*", "jewish", "hindu\\w*", "ramadan", "sabbath", "god",
  // politics and unions
  "politic\\w*", "election\\w*", "vot(?:e|es|ed|ing)", "party member\\w*", "union\\w*", "strike\\w*", "protest\\w*",
  // sexuality, gender identity, ethnicity
  "sexual\\w*", "gay", "lesbian", "bisexual", "trans(?:gender)?", "queer", "dating", "ethnic\\w*", "race", "racial", "nationality", "immigra\\w*", "visa",
  // money and finances
  "financ\\w*", "salary", "salaries", "debt\\w*", "loan\\w*", "mortgage", "bank\\w*", "money", "pay ?day", "wage\\w*", "bonus\\w*", "tax(?:es)?", "invest\\w*", "crypto\\w*",
  // family and private life
  "family", "child(?:ren)?", "kids?", "son", "daughter", "wife", "husband", "partner'?s?", "spouse", "boyfriend", "girlfriend", "mother", "father", "mum", "mom", "dad", "parent\\w*",
  "school run", "nanny", "childcare", "divorce\\w*", "wedding", "funeral", "bereave\\w*",
].join("|")})\b`, "i");

/** Another person: a third-person pronoun or a relationship word. A habit is about the person and their tools only. */
const OTHER_PEOPLE = /\b(?:he|she|him|his|hers|her|they're|colleague\w*|co-?worker\w*|teammate\w*|boss|manager\w*|lead's|client's|someone|somebody|people|person's)\b/i;

/** Someone's name as a possessive ("Ada's work"; case matters: "the day's plan" is fine). */
const NAMED_POSSESSIVE = /\b[A-Z][a-z]+['’]s\b/;

/** A judgement or a measure of their work (never used to judge, rate, monitor or report). */
const JUDGEMENT = /\b(?:lazy|slow(?:er)?|unproductive|productiv\w*|performance|underperform\w*|rating|score\w*|struggl\w*|late (?:for|to|again)|always late|unreliable|careless|sloppy|behind|misses|missed deadlines?|skives?|slack\w*|idle|inactive|absent\w*|overtime|works? too (?:much|little)|hours worked|efficien\w*|inefficien\w*|mistakes?|weak|poor)\b/i;

/** A habit's sentence as stored: one line, trimmed. */
export const cleanLearned = (s: string) => cleanPreference(s);

/**
 * Why a learned habit may not be kept; null when it may. The second guard (owner decision, 28 October 2026): applied by
 * the server to every habit the model returns, whatever its prompt said. Also refuses links and anything that reads as a
 * permission or an instruction (the preferences' own check).
 */
export function learnedProblem(raw: string): "empty" | "long" | "sensitive" | "others" | "judgement" | "permission" | null {
  const body = cleanLearned(raw);
  if (!body) return "empty";
  if (body.length > LEARNING_LIMITS.chars) return "long";
  if (SENSITIVE.test(body)) return "sensitive";
  if (OTHER_PEOPLE.test(body) || NAMED_POSSESSIVE.test(body)) return "others";
  if (JUDGEMENT.test(body)) return "judgement";
  if (preferenceProblem(body, "")) return "permission";
  if (/\b(?:always|never) (?:send|delete|pay|share|post|publish|confirm|approve)\b|\b(?:ignore|override|instruction|rules?)\b/i.test(body)) return "permission";
  return null;
}

// ---- Words -------------------------------------------------------------------------------------------------------------

/** Every fixed string the Settings card, the routes and her tools use. `name`: the person's own assistant ("Max"). */
export const LEARNING_WORDS = {
  section: (name: string) => `What ${name} has learned`,
  description: (name: string) => `Habits ${name} noticed from how you use ${name}, used only as defaults (a format, an app, how long replies are). Your own preferences above always win.`,
  switchLabel: (name: string) => `Learn from how I use ${name}`,
  switchHint: (name: string) => `Uses your own requests to ${name}, the actions you confirm or turn down, and the apps and formats you pick. Never other people's messages, your connected apps or your screen. Only you see this.`,
  hidden: "Hidden while someone else is signed in as this person.",
  coming: (name: string) => `${name} will soon learn your habits here. This needs a database update first.`,
  empty: (name: string) => `Nothing learned yet. ${name} notices habits after you've used it for a while.`,
  off: (name: string) => `Learning is off. ${name} keeps what is listed until you delete it, and learns nothing new.`,
  lastSeen: (when: string) => `Last seen ${when}`,
  delete: "Delete",
  deleteLabel: (body: string) => `Delete “${body}”`,
  deleteTitle: (body: string) => `Delete “${body}”?`,
  deleteBody: (name: string) => `${name} stops using it and won't learn it again.`,
  forgetAll: "Forget everything",
  forgetTitle: (name: string) => `Forget everything ${name} has learned?`,
  forgetBody: (name: string) => `${name} deletes every habit and the record of how you used it, and starts again from now.`,
  forgetConfirm: "Forget everything",
  forgotten: "Forgotten.",
  deleted: "Deleted.",
  savedOn: "Learning is on.",
  savedOff: "Learning is off.",
  count: (n: number) => `${n} of ${LEARNING_LIMITS.max}`,
  errors: {
    notFound: "That habit isn't on your list.",
    impersonated: "What was learned is only changed by the person themselves.",
    notReady: "This needs a database update first.",
  },
} as const;
