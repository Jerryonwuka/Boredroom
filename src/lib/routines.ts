/**
 * Routines (owner decision, 8 October 2026: phase 7a, "Brenda keeps the loops closed"). Everyone can have their own
 * assistant do a few fixed things on a schedule ("Every Friday at 4pm, send me what's still owed", "Every weekday at
 * 9, brief me", "Every Friday at 4pm, chase stalled tasks on my team"). A routine is a saved row: a built-in template,
 * its parameters, a cadence (every day, weekdays, chosen days of the week, a day of the month), a time of day in the
 * person's time zone, whether it stays quiet when there is nothing (on by default) and whether it is on. New routines
 * start paused: the person previews what it would send now (nothing is sent) and presses Enable, which is their standing
 * consent for exactly the actions the preview showed.
 *
 * Quiet hours (the same decision): the person's own times when nothing pops up, sounds or speaks on its own; routine
 * deliveries wait and arrive together when they end; notifications still collect in the bell.
 *
 * This file carries what the server, the pages, the chat and the notch share: the templates, the shapes the routes
 * answer, the limits, the markdown and plain lines of a run's output, and every fixed string the UI shows
 * (`ROUTINE_WORDS`). It imports only lib/evidence-links (itself import-free), so client components can use it. The
 * cadence math is server/lib/routine-time; the services are server/services/routines (foundation) and
 * server/services/routine-templates (what each template reads and does).
 */
import { NOT_AVAILABLE, evidenceHref, mdEscape, sourcesSuffix, type EvidenceRef } from "@/lib/evidence-links";

export type { EvidenceRef };

// ---- Templates -------------------------------------------------------------------------------------------------------

export const ROUTINE_TEMPLATES = ["morning_brief", "still_owed", "afternoon_check", "chase_stalled"] as const;
export type RoutineTemplate = (typeof ROUTINE_TEMPLATES)[number];
export const isRoutineTemplate = (v: unknown): v is RoutineTemplate => (ROUTINE_TEMPLATES as readonly unknown[]).includes(v);
/** Templates that act on other people (need lead rights while the workspace switch is on). */
export const CHASING_TEMPLATES: readonly RoutineTemplate[] = ["chase_stalled"];
export const isChasing = (t: RoutineTemplate): boolean => CHASING_TEMPLATES.includes(t);

// ---- Shapes ----------------------------------------------------------------------------------------------------------

export type Cadence =
  | { kind: "daily" } | { kind: "weekdays" }                // weekdays: Monday to Friday
  | { kind: "weekly"; days: number[] }                     // 0..6 (0 = Sunday), at least one
  | { kind: "monthly"; day: number };                      // 1..31; 0 = the last day of the month
export type CadenceKind = Cadence["kind"];
export const CADENCE_KINDS: readonly CadenceKind[] = ["daily", "weekdays", "weekly", "monthly"];
export type RoutineParams = { teamIds?: string[] | null }; // chase_stalled only; null/absent: the teams the person leads
export type PausedReason = "new" | "person" | "consent_changed" | "no_rights" | "member_gone" | "failing";
export type RunStatus = "running" | "done" | "empty" | "skipped" | "failed";
export type Delivery = "pending" | "delivered" | "held" | "silent" | "none";

export type RoutineView = {
  id: string; template: RoutineTemplate; name: string; cadence: Cadence; time: string /* "HH:MM" */;
  timezone: string; /* the effective zone, for display */ quietWhenEmpty: boolean;
  enabled: boolean; pausedReason: PausedReason | null; params: RoutineParams;
  teams: { id: string; name: string }[];         /* chase: the teams it covers now (resolved) */
  scheduleWords: string;                         /* "Every Friday at 16:00" */
  nextRunAt: string | null; lastRunAt: string | null; lastStatus: Exclude<RunStatus, "running"> | null;
  consent: { lines: string[]; at: string } | null;
  createdAt: string;
};

/** What the editor sends (POST /brenda/routines and the draft preview); PATCH sends the same fields but `template`, each optional. */
export type RoutineInput = {
  template: RoutineTemplate; name?: string; cadence: Cadence; time: string;
  quietWhenEmpty?: boolean; teamIds?: string[] | null;
};
export type RoutinePatch = Partial<Omit<RoutineInput, "template">>;

export type RoutineItem = { text: string; detail?: string | null; sources: EvidenceRef[] };
export type RoutineSection = { id: string; label: string; items: RoutineItem[]; more: number; missing: boolean };
/** `reused`: an open follow-up the person had already asked (not one the routine made, so its answer is told as usual). */
export type RoutineActionRecord = { kind: "follow_up"; text: string; done: boolean; reason?: string | null; followUpId?: string | null; taskId?: string | null; subjectMembershipId?: string | null; reused?: boolean };
export type RoutineOutput = {
  v: 1; title: string; lead: string; empty: boolean; calm: string | null;
  sections: RoutineSection[]; actions: RoutineActionRecord[]; generatedAt: string;
};
export type RoutineRunView = {
  id: string; routineId: string; routineName: string; template: RoutineTemplate; dueAt: string; startedAt: string; finishedAt: string | null;
  status: RunStatus; reason: string | null; summary: string | null; delivery: Delivery; heldUntil: string | null; deliveredAt: string | null;
  counts: Record<string, number | null>; output: RoutineOutput | null; href: string /* /app/{slug}/home/routines/{id} */;
};
export type QuietHours = { enabled: boolean; start: string | null; end: string | null; days: number[]; ownTimezone: string | null; timezone: string /* effective */ };
export type QuietState = { ready: boolean; active: boolean; until: string | null; nextStart: string | null };
/** Before migration 0046, and wherever nothing was read: never quiet. */
export const NO_QUIET: QuietState = { ready: false, active: false, until: null, nextStart: null };

/** What the routines list route answers (GET /brenda/routines). */
export type RoutineList = {
  ready: boolean; routines: RoutineView[]; limits: { perPerson: number };
  chase: { allowed: boolean; leadsOnly: boolean; teams: { id: string; name: string; lead: boolean }[] };
};
/** A preview (POST …/preview): what it would send now, and what Enable consents to. */
export type RoutinePreview = { output: RoutineOutput; consent: { hash: string; lines: string[] } };

export const ROUTINE_LIMITS = {
  perPerson: 20,            // routines a person keeps (not deleted)
  chasePerRun: 10,          // follow-ups one chase run asks at most
  stalledWorkingDays: 2,    // the owner's stalled rule
  catchUpMinutes: 120,      // a run missed by more than this is recorded as missed, not run
  maxConsecutiveFailures: 3,
  sectionItems: 10,         // items shown per section, then "and N more"
  reportedKeepDays: 30,
} as const;
export const ROUTINES_NOT_READY = "Routines need a database update first. Try again later.";

// ---- Days and times --------------------------------------------------------------------------------------------------

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
/** The order days are shown and said in: Monday first. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "1st", "2nd", "3rd", "11th", "21st", "31st". */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

/** "Monday", "Monday and Thursday", "Monday, Wednesday and Friday" (Monday first, each day once). */
export function dayList(days: readonly number[]): string {
  const set = new Set(days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6));
  const names = WEEK_ORDER.filter((d) => set.has(d)).map((d) => DAY_NAMES[d]);
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * When it runs, in words: "Every day at 09:00", "Every weekday at 09:00", "Every Friday at 16:00", "Every Monday and
 * Thursday at 08:30", "On the 1st of every month at 09:00", "On the last day of every month at 17:00". A weekly
 * routine on all seven days reads as every day.
 */
export function cadenceWords(c: Cadence, time: string): string {
  switch (c.kind) {
    case "daily": return `Every day at ${time}`;
    case "weekdays": return `Every weekday at ${time}`;
    case "weekly": {
      const days = [...new Set(c.days)].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
      return days.length >= 7 ? `Every day at ${time}` : `Every ${dayList(days)} at ${time}`;
    }
    case "monthly": return c.day === 0 ? `On the last day of every month at ${time}` : `On the ${ordinal(c.day)} of every month at ${time}`;
  }
}

/** A cadence as stored (`cadence`, `days`, `day_of_month`), or null when the columns do not make one. */
export function cadenceFrom(kind: string, days: readonly number[] | null | undefined, dayOfMonth: number | null | undefined): Cadence | null {
  switch (kind) {
    case "daily": return { kind: "daily" };
    case "weekdays": return { kind: "weekdays" };
    case "weekly": {
      const d = [...new Set((days ?? []).map(Number).filter((x) => Number.isInteger(x) && x >= 0 && x <= 6))].sort((a, b) => a - b);
      return d.length ? { kind: "weekly", days: d } : null;
    }
    case "monthly": return typeof dayOfMonth === "number" && Number.isInteger(dayOfMonth) && dayOfMonth >= 0 && dayOfMonth <= 31 ? { kind: "monthly", day: dayOfMonth } : null;
    default: return null;
  }
}

// ---- A run's output as text ------------------------------------------------------------------------------------------

const oneLine = (s: string | null | undefined) => String(s ?? "").replace(/\s+/g, " ").trim();
const itemTotal = (o: RoutineOutput) => o.sections.reduce((n, s) => n + s.items.length, 0);

/** Whether the output's actions were done (a run) or only described (a preview, "Would ask …"). */
const didAct = (o: RoutineOutput) => o.actions.some((a) => a.done || !!a.reason);

function actionSources(a: RoutineActionRecord): EvidenceRef[] {
  const refs: EvidenceRef[] = [];
  if (a.followUpId) refs.push({ kind: "follow_up", id: a.followUpId });
  if (a.taskId) refs.push({ kind: "task", id: a.taskId });
  return refs;
}

/**
 * The output as Markdown (the run page's text, a copy in her chat): the lead in bold (or the calm line when there is
 * nothing), each section with items under its bold label, "not available" for a section that could not be read, and
 * what it did. Every text is escaped; links are built from ids only (lib/evidence-links).
 *
 * ```
 * **3 things are still owed.**
 *
 * **Overdue or blocked**
 * - “Landing page” (Ben Okafor), overdue since Tue 6 Oct ([task](/app/acme/tasks/…))
 * - And 2 more.
 *
 * **What it did**
 * - Asked Ben's Brenda about “Landing page” ([follow-up](…), [task](…))
 * - Not asked: “Pricing page” (Ada): You've already followed up with Ada about this twice today.
 * ```
 */
export function routineMarkdown(o: RoutineOutput, slug: string): string {
  const head = o.empty ? (o.calm ?? o.lead) : o.lead;
  const blocks: string[] = [`**${mdEscape(head)}**`];
  for (const s of o.sections) {
    if (s.missing) { blocks.push(`**${mdEscape(s.label)}**\n- ${NOT_AVAILABLE}`); continue; }
    if (!s.items.length) continue;
    const lines = s.items.map((it) => {
      const detail = oneLine(it.detail);
      return `- ${mdEscape(it.text)}${detail ? `, ${mdEscape(detail)}` : ""}${sourcesSuffix(slug, it.sources)}`;
    });
    if (s.more > 0) lines.push(`- ${ROUTINE_WORDS.output.andMore(s.more)}`);
    blocks.push(`**${mdEscape(s.label)}**\n${lines.join("\n")}`);
  }
  if (o.actions.length) {
    const lines = o.actions.map((a) => {
      if (a.done) return `- ${mdEscape(a.text)}${sourcesSuffix(slug, actionSources(a))}`;
      // The template may already have said it all ("Not asked: “Pricing page” (Ada): {why}"): never twice.
      if (a.reason && !oneLine(a.text).includes(oneLine(a.reason))) return `- ${ROUTINE_WORDS.output.notAsked}: ${mdEscape(a.text)}: ${mdEscape(a.reason)}`;
      return `- ${mdEscape(a.text)}`;
    });
    blocks.push(`**${didAct(o) ? ROUTINE_WORDS.output.whatItDid : ROUTINE_WORDS.output.whatItWouldDo}**\n${lines.join("\n")}`);
  }
  return blocks.join("\n\n");
}

/**
 * The output as at most `max` plain lines with a link each (the notch's routine card, a notification's body): every
 * item in order ("{text}, {detail}"), "{Section}: not available" for one that could not be read, then "And {n} more."
 * in the last place when there are more than fit. Nothing to report: the calm line. Plain text (the notch escapes it).
 */
export function routinePlainLines(o: RoutineOutput, slug: string, max = 6): { text: string; href: string | null }[] {
  const limit = Math.max(1, Math.floor(max));
  if (o.empty && !o.sections.some((s) => s.missing)) return [{ text: oneLine(o.calm ?? o.lead), href: null }];
  const all: { text: string; href: string | null }[] = [];
  let hidden = 0;
  for (const s of o.sections) {
    if (s.missing) { all.push({ text: `${oneLine(s.label)}: ${NOT_AVAILABLE}`, href: null }); continue; }
    for (const it of s.items) {
      const detail = oneLine(it.detail);
      const href = it.sources.map((r) => evidenceHref(slug, r)).find((h): h is string => !!h) ?? null;
      all.push({ text: `${oneLine(it.text)}${detail ? `, ${detail}` : ""}`, href });
    }
    hidden += Math.max(0, s.more);
  }
  if (!all.length) return [{ text: oneLine(o.empty ? (o.calm ?? o.lead) : o.lead), href: null }];
  if (all.length <= limit && !hidden) return all;
  if (all.length < limit) return [...all, { text: ROUTINE_WORDS.output.andMore(hidden), href: null }];
  if (limit === 1) return all.slice(0, 1);
  const shown = all.slice(0, limit - 1);
  return [...shown, { text: ROUTINE_WORDS.output.andMore(all.length + hidden - shown.length), href: null }];
}

/** How many items the output reports (shown and "more"). */
export function outputCount(o: RoutineOutput): number {
  return itemTotal(o) + o.sections.reduce((n, s) => n + Math.max(0, s.more), 0);
}

// ---- Status words ------------------------------------------------------------------------------------------------------

export type RoutineTone = "success" | "neutral" | "warning" | "danger";
const NEEDS_YOU: readonly PausedReason[] = ["consent_changed", "no_rights", "failing"];
export const needsYou = (r: PausedReason | null | undefined): boolean => !!r && NEEDS_YOU.includes(r);

/** The routine's status badge: On (success), Paused (neutral) or Needs you (warning). Never orange (J). */
export function routineBadge(v: Pick<RoutineView, "enabled" | "pausedReason">): { label: string; tone: RoutineTone } {
  if (v.enabled) return { label: ROUTINE_WORDS.status.on, tone: "success" };
  return needsYou(v.pausedReason) ? { label: ROUTINE_WORDS.status.needsYou, tone: "warning" } : { label: ROUTINE_WORDS.status.paused, tone: "neutral" };
}

/** A run's status badge in the history: Sent, Held for quiet hours, Nothing to send, Skipped: {why}, Failed. */
export function runBadge(r: Pick<RoutineRunView, "status" | "delivery" | "reason">): { label: string; tone: RoutineTone } {
  const w = ROUTINE_WORDS.history.status;
  switch (r.status) {
    case "running": return { label: w.running, tone: "neutral" };
    case "failed": return { label: w.failed, tone: "danger" };
    case "skipped": return { label: w.skipped(skipWords(r.reason)), tone: r.reason === "missed" ? "neutral" : "warning" };
    default:
      if (r.delivery === "held") return { label: w.held, tone: "neutral" };
      if (r.delivery === "silent" || r.delivery === "none") return { label: w.silent, tone: "neutral" };
      return { label: w.delivered, tone: "success" };
  }
}

/** Why a run was skipped, in words ("it missed its time"). */
export function skipWords(reason: string | null | undefined): string {
  const words = ROUTINE_WORDS.history.skipReasons as Record<string, string>;
  return (reason && words[reason]) || words.other;
}

/** The paused line under a routine's name ("Paused until you enable it"). */
export function pausedWords(reason: PausedReason | null | undefined): string {
  return ROUTINE_WORDS.pausedReasons[reason ?? "person"];
}

// ---- Every fixed string the UI shows (contract J) ----------------------------------------------------------------------

export const ROUTINE_WORDS = {
  /** The four built-in templates: name, one-line description, default routine name (B.1). */
  templates: {
    morning_brief: { name: "Morning brief", description: "What's waiting on you: requests, overdue tasks, answers to your follow-ups and reviews.", defaultName: "Morning brief" },
    still_owed: { name: "What's still owed", description: "Open follow-ups, unanswered messages between assistants, overdue or blocked tasks and assignments nobody picked up.", defaultName: "What's still owed" },
    afternoon_check: { name: "Afternoon check", description: "Speaks only when something is blocked on you, ready for you, or due today with no progress.", defaultName: "Afternoon check" },
    chase_stalled: { name: "Chase stalled tasks", description: "Asks your team's assistants about tasks with no progress for 2 working days, then tells you who was asked.", defaultName: "Chase stalled tasks" },
  } satisfies Record<RoutineTemplate, { name: string; description: string; defaultName: string }>,
  /** The line under a paused routine's name (J.1). member_gone never shows to its owner. */
  pausedReasons: {
    new: "Paused until you enable it",
    person: "Paused",
    consent_changed: "Paused: preview and enable it again",
    no_rights: "Paused: only team leads can chase other people now",
    member_gone: "Paused",
    failing: "Paused after 3 failed runs",
  } satisfies Record<PausedReason, string>,
  status: { on: "On", paused: "Paused", needsYou: "Needs you" },
  /** Settings → Your assistant → Routines (J.1). `name`: the person's assistant ("Max"). */
  settings: {
    section: "Routines",
    description: (name: string) => `Things ${name} does for you on a schedule. New routines start paused: preview one, then enable it.`,
    add: "Add a routine",
    limitTip: `You have ${ROUTINE_LIMITS.perPerson} routines, the most you can keep.`,
    /** "Every Friday at 16:00, next Fri 9 Oct, 16:00". */
    next: (schedule: string, when: string) => `${schedule}, next ${when}`,
    actionsFor: (name: string) => `Actions for ${name}`,
    menu: { preview: "Preview", edit: "Edit", enable: "Enable", pause: "Pause", history: "History", delete: "Delete" },
    /** A deleted routine leaves Settings; what it sent stays on the Routines page (/home/routines). */
    deleteConfirm: (name: string) => `Delete “${name}”? What it sent stays on your Routines page.`,
    emptyTitle: "No routines yet",
    emptyBody: "Try a morning brief, or what's still owed on Fridays.",
    notReady: "This needs a database update first.",
    impersonated: "Only the person can change this.",
    paused: (name: string) => `“${name}” is paused.`,
    deleted: (name: string) => `“${name}” was deleted. What it sent stays on your Routines page.`,
    /** A chase whose owner can no longer chase other people (the workspace switch, a change of role or teams). */
    lostRights: "Only team leads, the owner and HR can chase other people now. Delete it, or ask a team lead to set it up.",
    lostRightsOn: "Only team leads, the owner and HR can chase other people now. It pauses at its next run.",
  },
  /** The editor (J.2, step "Set up"). */
  editor: {
    titleNew: "Add a routine",
    titleEdit: "Edit routine",
    setUp: "Set up",
    whatItDoes: "What it does",
    chaseLeadsOnly: "Only team leads, the owner and HR can chase other people.",
    name: "Name",
    howOften: "How often",
    cadence: { daily: "Every day", weekdays: "Weekdays", weekly: "Weekly", monthly: "Monthly" } satisfies Record<CadenceKind, string>,
    days: "Days",
    pickDay: "Pick at least one day.",
    dayOfMonth: "Day of the month",
    lastDay: "Last day",
    monthHint: "In shorter months it runs on the last day.",
    time: "Time",
    timeHint: (tz: string) => `In your time zone, ${tz}.`,
    teams: "Teams",
    teamsYouLead: "Teams you lead",
    pickTeam: "Name a team to chase.",
    quietWhenEmpty: "Stay quiet when there's nothing",
    afternoonQuiet: "It only speaks when something needs you.",
    cancel: "Cancel",
    save: "Save",
    teamsChangeWarning: "Changing the teams turns it off until you enable it again.",
    saved: (name: string) => `Saved “${name}”.`,
  },
  /** The preview and Enable (J.2, step "Preview"). */
  preview: {
    heading: "Preview",
    note: "What it would send now. Nothing was sent.",
    whenOn: (name: string) => `When it's on, ${name} will:`,
    notNow: "Not now",
    enable: "Enable",
    enabled: (name: string, when: string) => `“${name}” is on. Next: ${when}.`,
    /** After a refusal for lead rights: what the person can do (it can't be turned on as it is). */
    noRightsNext: "Delete this routine, or ask a team lead to set one up.",
  },
  /** A run's output (RoutineOutputView, the markdown and the plain lines). */
  output: {
    notAvailable: NOT_AVAILABLE,
    andMore: (n: number) => `And ${n} more.`,
    whatItDid: "What it did",
    whatItWouldDo: "What it would do",
    notAsked: "Not asked",
  },
  /** A routine's runs (J.2 history, the /home/routines pages). */
  history: {
    heading: "History",
    status: {
      running: "Running",
      delivered: "Sent",
      held: "Held for quiet hours",
      silent: "Nothing to send",
      skipped: (why: string) => `Skipped: ${why}`,
      failed: "Failed",
    },
    skipReasons: {
      missed: "it missed its time",
      no_rights: "only team leads can chase other people now",
      consent_changed: "it changed since you enabled it",
      member_gone: "you're no longer active here",
      stale: "it changed before it ran",
      duplicate: "it had already run",
      plan: "the assistant is turned off for this workspace",
      other: "it couldn't run then",
    },
    open: "Open",
    loadMore: "Load more",
    empty: "No runs yet.",
  },
  /** Settings → Your assistant → Quiet hours (J.3). */
  quiet: {
    section: "Quiet hours",
    description: (name: string) => `Times when ${name} doesn't interrupt you.`,
    switch: "Quiet hours",
    from: "From",
    to: "To",
    overnight: "Ends the next morning",
    on: "On",
    timezone: "Your time zone",
    workspaceTimezone: (tz: string) => `Workspace time zone (${tz})`,
    duringLead: "During quiet hours:",
    during: (name: string) => [
      "No pop-ups or sounds from the desktop app",
      `${name} doesn't read replies aloud on its own`,
      "Routines wait and arrive together when quiet hours end",
      "Notifications still collect in the bell",
    ],
    activeUntil: (time: string) => `Quiet until ${time}.`,
    save: "Save",
    saved: "Saved",
    pickDay: "Pick at least one day.",
    sameTimes: "Pick an end time different from the start.",
    notReady: "This needs a database update first.",
    impersonated: "Only the person can change this.",
  },
  /** Settings → Brenda → Routines (J.6). */
  workspace: {
    section: "Routines",
    description: "What people's assistants may do on a schedule.",
    leadsOnly: "Leads only",
    anyone: "Anyone",
    switch: "Only leads can schedule routines that chase other people",
    hint: "When on, only team leads (for their teams), the owner and HR can schedule routines that ask other people's assistants. Routines about yourself are always allowed.",
    notReady: "This needs a database update first.",
    pageNote: "Routines run as the person who set them up, within their own permissions and limits.",
    /** The workspace's rule as everyone reads it in their own Routines card (J.6: "others read"; review, 8 October 2026). */
    ruleLeadsOnly: "In this workspace only team leads, the owner and HR can schedule routines that chase other people. The owner and HR set this.",
    ruleAnyone: "In this workspace anyone can schedule a routine that chases a team they name. The owner and HR set this.",
  },
  /** The morning opener's fixed words (J.4, J.8); its counts and actions are lib/opener's. */
  opener: {
    heading: "Here's where things stand",
    goodMorning: (first: string) => `Good morning, ${first}.`,
    later: "Later",
  },
  /** The notch (J.8). */
  notch: { quietUntil: (time: string) => `Quiet until ${time}`, pill: "Routine" },
  /** Notifications the routines write (J.7), and their kinds in the bell. */
  notifications: {
    kinds: { "brenda.routine": "Routine", "brenda.routine_bundle": "Routines", "brenda.routine_failed": "Routine" } as Record<string, string>,
    title: (name: string, lead: string) => `${name}: ${lead}`,
    bundleTitle: (n: number) => `${n} routines ran during quiet hours`,
    failedTitle: (name: string) => `“${name}” couldn't run`,
    pausedTitle: (name: string) => `“${name}” is paused`,
    noRights: "Only team leads can chase other people now.",
    coverChanged: "It would now ask people it didn't name when you turned it on. Preview it and enable it again.",
    consentChanged: "It changed since you turned it on. Preview it and enable it again.",
    failing: "It failed 3 times in a row.",
    error: "Something went wrong. It will try again at its next time.",
  },
  /** The person's run pages (J.7). */
  page: {
    title: "Routines",
    description: (name: string) => `What ${name} sent you on a schedule`,
    manage: "Manage routines",
    emptyTitle: "Nothing yet",
    emptyBody: "When a routine runs, what it sent shows here.",
    ranAt: (when: string) => `Ran ${when}`,
  },
  /** Her chat (D.3): a routine paused without asking has no Undo. */
  chat: { turnOnAgain: "Turn it on again from Settings, Your assistant, Routines." },
  /** What the routes answer. */
  errors: {
    notReady: ROUTINES_NOT_READY,
    limit: `You have ${ROUTINE_LIMITS.perPerson} routines, the most you can keep. Delete one to add another.`,
    notYours: "That routine isn't one of yours.",
    runNotFound: "That run isn't one of yours.",
    consentChanged: "The routine changed since its preview. Preview it again.",
    notLead: "Only team leads, the owner and HR can schedule routines that chase other people.",
    noTeams: "Name a team to chase.",
    teamGone: "One of those teams is no longer there. Pick the teams again.",
    impersonated: "Only the person can change their routines. They stay as they are while someone else is signed in as them.",
    impersonatedQuiet: "Only the person can change their quiet hours. They stay as they are while someone else is signed in as them.",
    impersonatedOpener: "Only the person can mark this as seen.",
    settingsForbidden: "Only the organisation owner or HR can change this.",
    invalidZone: "Pick a time zone from the list.",
    time: "Use a 24-hour time such as 16:00.",
    pickDay: "Pick at least one day.",
    deleted: "That routine was deleted.",
    sayChaseLeadsOnly: "Say whether only leads can schedule routines that chase other people.",
  },
} as const;
