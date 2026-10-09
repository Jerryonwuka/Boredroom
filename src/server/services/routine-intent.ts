/**
 * Routines in the built-in helper's words (owner decision, 8 October 2026: phase 7a, routines): "Every Friday at 4pm,
 * send me what's still owed", "Every weekday at 9, brief me", "Every Friday at 4pm, chase stalled tasks on my team",
 * "What routines do I have?", "Pause my Friday roundup". Pure, so every phrasing is unit-tested
 * (tests/unit/routine-intent.test.ts). The helper runs the same copilot tools as Claude does (create_routine,
 * list_routines, update_routine), so the person gets the same Confirm card, preview and consent lines.
 *
 * A routine needs both what it does and how often: "brief me" alone is a question for today, never a routine, and a note
 * of things to do ("remind me every Friday to …") is not one either. Pausing, turning on or deleting needs a name that
 * reads as a routine's ("my Friday roundup", "the morning brief routine"), so "stop my timer" stays the timer's.
 *
 * Phase 7b (owner decisions, 8 October 2026): "Every evening, check for loose ends", "Every weekday at 6pm find my loose
 * ends" set up the loose_ends template (17:30 when no time is said); without a cadence, "any loose ends?" is the helper's
 * loop intent (loop-intent.ts), never a routine.
 */
import type { Cadence, RoutineTemplate } from "@/lib/routines";

export type RoutineIntent =
  | { kind: "create"; template: RoutineTemplate; cadence: Cadence; time: string; teams: string[] | null }
  | { kind: "list" } | { kind: "pause" | "turn_on" | "delete"; name: string };

/** When a template runs if the words give no time (contract I.4). */
export const DEFAULT_TIMES: Record<RoutineTemplate, string> = { morning_brief: "09:00", still_owed: "16:00", afternoon_check: "15:00", chase_stalled: "16:00", loose_ends: "17:30" };

const DAY_WORDS: [RegExp, number][] = [
  [/^sun(?:day)?s?$/, 0], [/^mon(?:day)?s?$/, 1], [/^tue(?:s|sday)?s?$/, 2], [/^wed(?:s|nesday)?s?$/, 3],
  [/^thu(?:r|rs|rsday)?s?$/, 4], [/^fri(?:day)?s?$/, 5], [/^sat(?:urday)?s?$/, 6],
];
const DAY = String.raw`(?:sun|mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat)(?:day)?s?|(?:tues|wednes|thurs|satur)days?`;
const dayOf = (w: string): number | null => { for (const [re, n] of DAY_WORDS) if (re.test(w)) return n; return null; };

/** Lower case, straight quotes, single spaces, no trailing punctuation. */
function norm(text: string): string {
  return text.toLowerCase().replace(/[’‘`]/g, "'").replace(/[“”]/g, "\"").replace(/\s+/g, " ").replace(/[.!?]+\s*$/, "").trim();
}

/** "1st", "15th", "31" → 1, 15, 31; anything else null. */
const ordinal = (s: string | undefined): number | null => {
  const n = Number(String(s ?? "").replace(/(?:st|nd|rd|th)$/, ""));
  return Number.isInteger(n) && n >= 1 && n <= 31 ? n : null;
};

/** How often, or null when the words name no cadence. */
export function cadenceOf(t: string): Cadence | null {
  if (/\b(?:on\s+the\s+)?last\s+day\s+of\s+(?:the|every|each)\s+month\b/.test(t)) return { kind: "monthly", day: 0 };
  const m1 = /\bon\s+the\s+(\d{1,2}(?:st|nd|rd|th)?)\s+of\s+(?:every|each|the)\s+month\b/.exec(t)
    ?? /\b(?:every|each)\s+month\s+on\s+the\s+(\d{1,2}(?:st|nd|rd|th)?)\b/.exec(t)
    ?? /\bmonthly\s+on\s+the\s+(\d{1,2}(?:st|nd|rd|th)?)\b/.exec(t);
  if (m1) { const d = ordinal(m1[1]); if (d) return { kind: "monthly", day: d }; }
  if (/\b(?:every|each)\s+month\b|\bmonthly\b/.test(t)) return { kind: "monthly", day: 1 };
  if (/\b(?:every|each)\s+(?:week|working\s+)?day\b.*\bexcept\b/.test(t)) return null;
  if (/\b(?:every|each)\s+weekday\b|\bon\s+weekdays\b|\bweekdays\b|\b(?:every|each)\s+working\s+day\b|\bmonday\s+to\s+friday\b/.test(t)) return { kind: "weekdays" };
  // "every Monday and Thursday", "every fri", "on Fridays", "every week on Friday".
  const list = new RegExp(String.raw`\b(?:every|each|on)\s+(?:week\s+on\s+)?((?:${DAY})(?:\s*(?:,|and|&|\+)\s*(?:${DAY}))*)\b`).exec(t);
  if (list) {
    const days = [...new Set(list[1].split(/\s*(?:,|\band\b|&|\+)\s*/).map((w) => dayOf(w.trim())).filter((d): d is number => d !== null))].sort((a, b) => a - b);
    if (days.length) return { kind: "weekly", days };
  }
  if (/\b(?:every|each)\s+(?:day|morning|afternoon|evening)\b|\bdaily\b/.test(t)) return { kind: "daily" };
  return null;
}

/**
 * The time of day ("at 4pm", "at 16:00", "at 9", "at 9:30am", "at noon"), "HH:MM", or null when none is given.
 * A bare hour from 1 to 7 is in the afternoon, except for a morning brief (`morning`).
 */
export function timeOf(t: string, morning = false): string | null {
  if (/\b(?:at\s+)?noon\b|\bmidday\b/.test(t)) return "12:00";
  if (/\bat\s+midnight\b/.test(t)) return "00:00";
  const m = /\bat\s+(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?(?![\d:])/.exec(t) ?? /\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)(?![a-z])/.exec(t) ?? /\b(\d{1,2})[:](\d{2})\b/.exec(t);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ap = (m[3] ?? "").replace(/\./g, "");
  if (!Number.isInteger(h) || h > 23 || min > 59) return null;
  if (ap === "am") { if (h > 12 || h === 0) return null; if (h === 12) h = 0; }
  else if (ap === "pm") { if (h > 12 || h === 0) return null; if (h < 12) h += 12; }
  else if (!m[2] && h >= 1 && h <= 7 && !morning) h += 12;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** What the routine does, and for a chase which teams ("my team": null, the teams the person leads). */
function templateOf(t: string): { template: RoutineTemplate; teams: string[] | null } | null {
  const chase = /\bchase\s+(?:the\s+|all\s+)?(?:stalled|stuck)\s+(?:tasks?|work)(?:\s+(?:on|in|for)\s+(.+?))?(?=\s*(?:,|$|\bevery\b|\beach\b|\bat\b|\bon\s+(?:the\s+)?(?:\d|last|week|mon|tue|wed|thu|fri|sat|sun))|$)/.exec(t)
    ?? /\bchase\s+(my\s+teams?)\b/.exec(t);
  if (chase) {
    const raw = (chase[1] ?? "").trim();
    if (!raw || /^(?:my|our)\s+teams?$|^my\s+team'?s$/.test(raw)) return { template: "chase_stalled", teams: null };
    const who = raw.replace(/^the\s+/, "").replace(/\s+(?:team|channel)$/, "").trim();
    return { template: "chase_stalled", teams: who ? [who] : null };
  }
  // Phase 7b: "check for loose ends", "find my loose ends", "look for loose ends" (before the roundup: never "still owed").
  if (/\bloose[\s-]+ends?\b/.test(t)) return { template: "loose_ends", teams: null };
  if (/\bwhat'?s\s+still\s+owed\b|\bwhat\s+is\s+still\s+owed\b|\bstill\s+owed\b|\bround-?\s?up\b/.test(t)) return { template: "still_owed", teams: null };
  if (/\bafternoon\s+check\b|\bcheck\s+(?:on\s+|what'?s\s+|what\s+is\s+)?blocked\s+on\s+me\b/.test(t)) return { template: "afternoon_check", teams: null };
  if (/\bbrief\s+me\b|\bmorning\s+brief(?:ing)?\b|\bwhat'?s\s+waiting\b|\bwhat\s+is\s+waiting\b|\bsend\s+me\s+(?:a|my|the)\s+brief(?:ing)?\b/.test(t)) return { template: "morning_brief", teams: null };
  return null;
}

/** Words that name something of the person's that is not a routine ("stop my timer"). */
const NOT_A_ROUTINE = /^(?:timer|clock|session|recording|status|reminders?|notifications?|messages?|music|work|day|tasks?|to-?dos?|alarm)$/;
/**
 * A name that reads as a routine's: the word itself, a template's words, or when it runs. Not "check-in": "cancel my
 * check-in reminder" is about a reminder, never the afternoon check (review, 8 October 2026).
 */
const ROUTINE_LIKE = new RegExp(String.raw`\broutines?\b|\bbrief(?:ing)?\b|\bround-?\s?up\b|\bstill\s+owed\b|\bafternoon\s+check\b|\bchase\b|\bstalled\b|\bsummary\b|\bdigest\b|\bloose[\s-]+ends?\b|\b(?:morning|weekly|daily|monthly|weekday)\b|\b(?:${DAY})\b`);
export const looksLikeRoutine = (name: string) => !NOT_A_ROUTINE.test(name.trim()) && ROUTINE_LIKE.test(name);

/** The routine's name as the person said it: "Friday roundup" from "my friday roundup routine". */
const nameOf = (s: string) => s.trim().replace(/^(?:my|the)\s+/, "").replace(/\s+routine$/, "").replace(/["']/g, "").trim();

/** What a sentence asks about routines, or null when it is not about one. */
export function routineIntent(text: string): RoutineIntent | null {
  const t = norm(String(text ?? "")).slice(0, 400);
  if (!t) return null;
  // A note of things to do or a reminder is never a routine ("remind me every Friday to send the invoice").
  if (/^(?:please\s+)?(?:remind\s+me|i\s+need\s+to|i\s+have\s+to|add|create\s+(?:a\s+)?(?:task|to-?do))\b/.test(t)) return null;
  const core = t.replace(/^(?:(?:hey|hi|ok|okay)\b[,]?\s*)?(?:(?:please|can\s+you|could\s+you|would\s+you|will\s+you)\s+)*/, "").trim();

  // Pause, turn on, delete: "pause my Friday roundup", "turn on my morning brief", "delete my Friday roundup routine".
  const del = /^(?:delete|remove|get\s+rid\s+of|cancel)\s+(?:my|the)\s+(.+?)$/.exec(core);
  if (del) {
    const raw = del[1];
    const name = nameOf(raw);
    if (name && (/\broutine$/.test(raw) || looksLikeRoutine(name))) return { kind: "delete", name };
    return null;
  }
  const pause = /^(?:pause|stop|turn\s+off|switch\s+off|disable|mute)\s+(?:my|the)\s+(.+?)$/.exec(core);
  if (pause) {
    const name = nameOf(pause[1]);
    if (name && (/\broutine$/.test(pause[1]) || looksLikeRoutine(name))) return { kind: "pause", name };
    return null;
  }
  const on = /^(?:turn\s+on|switch\s+on|resume|enable|restart|unpause|start)\s+(?:my|the)\s+(.+?)(?:\s+again)?$/.exec(core);
  if (on) {
    const name = nameOf(on[1]);
    if (name && (/\broutine$/.test(on[1]) || looksLikeRoutine(name))) return { kind: "turn_on", name };
    return null;
  }

  if (/\b(?:what|which)\s+routines\s+(?:do\s+i\s+have|have\s+i\s+(?:got|set\s+up)|are\s+(?:there|on|set\s+up))\b|^(?:show\s+(?:me\s+)?|list\s+|see\s+)?(?:all\s+)?my\s+routines$|\blist\s+(?:all\s+)?(?:my\s+)?routines\b|^routines$/.test(core)) return { kind: "list" };

  const what = templateOf(core);
  if (!what) return null;
  const cadence = cadenceOf(core);
  if (!cadence) return null;
  const time = timeOf(core, what.template === "morning_brief") ?? DEFAULT_TIMES[what.template];
  return { kind: "create", template: what.template, cadence, time, teams: what.teams };
}
