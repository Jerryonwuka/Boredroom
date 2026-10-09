/**
 * Async standup, option B (owner decisions, 8–9 October 2026: phase 7c). A team lead (or the owner, or HR) switches
 * standup on for a team, with a time (09:30 by default, on the organisation's clock, weekdays). At that time each
 * member's own assistant drafts their update from their real work (Yesterday or "Since Friday", Today, Blocked, each line
 * with its sources); the person gets one approval card (her page, the notch, a notification after their quiet hours) and
 * edits it, posts it or skips the day. Posting ALWAYS needs their press (a broadcast to the team channel: the act-mode
 * floor) and posts their approved words to the team's channel as them, sent by their assistant. At the cutoff (12:00 by
 * default) the lead gets one rollup: who posted (with links), the blockers they named (on whom), and who has no update,
 * listed neutrally (never chased, never shamed; a skip and silence read the same). Off for every team until switched on.
 *
 * This file is what the server, the pages, the chat, the notch and the worker share: the shapes, the limits, the words
 * (`STANDUP_WORDS`), the text a post carries and the rollup as Markdown. Every link goes through lib/evidence-links (ids
 * only). Client-safe: imports only lib/evidence-links and lib/confirm-readback (both import nothing).
 */
import { evidenceHref, mdEscape, sourcesSuffix, type EvidenceRef } from "@/lib/evidence-links";
import { members as memberWords } from "@/lib/confirm-readback";

export type { EvidenceRef };

// ---- Shapes (contract B.10) ---------------------------------------------------------------------------------------------

export type StandupSection = "yesterday" | "today" | "blocked";
export const STANDUP_SECTIONS: readonly StandupSection[] = ["yesterday", "today", "blocked"];
export type StandupStatus = "drafting" | "ready" | "posted" | "skipped" | "missed" | "failed" | "cancelled";
export const STANDUP_STATUSES: readonly StandupStatus[] = ["drafting", "ready", "posted", "skipped", "missed", "failed", "cancelled"];
export type StandupLine = { text: string; refs: EvidenceRef[] };
export type StandupDraft = { v: 1; sinceLabel: string; dateLabel: string; engine: "template" | "claude"; sections: Record<StandupSection, StandupLine[]> };
export type StandupTexts = Record<StandupSection, string>;
export type StandupBlocker = { taskId: string | null; title: string; onMembershipId: string | null; onName: string | null };

/**
 * One person's standup for one team on one day, as the person reads it. `postTo`: the team's channel ("#Design") and how
 * many read it (null: not available). `leads`: who receives the rollup. `timeZone` (phase 7c addition): the
 * organisation's, for the times on the card.
 */
export type StandupEntryView = {
  id: string; team: { id: string; name: string }; localDate: string; dateLabel: string; sinceLabel: string; status: StandupStatus;
  texts: StandupTexts | null; draft: StandupDraft | null; edited: boolean; engine: "template" | "claude" | null;
  postTo: { conversationId: string | null; name: string /* "#Design" */; members: number | null };
  leads: string[]; postAt: string; cutoffAt: string;
  posted: { at: string; messageId: string | null; href: string | null; late: boolean } | null;
  canUnskip: boolean; seen: boolean; href: string;
  timeZone?: string;
  /** Fix review, 9 October 2026: the person receives this team's rollup themself, and the other recipients' names. */
  youLead?: boolean; otherLeads?: string[];
};
/** `timeZone` (phase 7c addition): the organisation's, so a rollup's times read on its clock wherever it is shown. */
export type StandupRollupContent = {
  v: 1; team: { id: string; name: string }; localDate: string; dateLabel: string; cutoffAt: string;
  counts: { members: number; posted: number };
  posted: { membershipId: string; name: string; at: string; messageId: string | null; conversationId: string | null }[];
  blockers: { membershipId: string; name: string; text: string; taskId: string | null; onMembershipId: string | null; onName: string | null }[];
  noUpdate: { membershipId: string; name: string }[];
  late: { membershipId: string; name: string; at: string; messageId: string | null; conversationId: string | null }[];
  timeZone?: string;
};
export type StandupRollupView = {
  id: string; team: { id: string; name: string }; localDate: string; dateLabel: string; status: "open" | "sent" | "skipped"; reason: string | null;
  content: StandupRollupContent | null; seen: boolean; href: string;
  cutoffAt?: string; timeZone?: string;
};
export type StandupSettingsView = {
  ready: boolean; teamId: string; teamName: string; enabled: boolean; time: string; cutoff: string; days: number[]; timeZone: string;
  canEdit: boolean; offered: boolean; leads: string[]; noLead: boolean; updatedAt: string | null;
};
/**
 * `upcoming` (fix review, 9 October 2026): the person's teams whose standup runs later today and has not opened yet
 * ("Drafts arrive at 09:30"), so the page never says it is off while it is on.
 */
export type StandupToday = {
  ready: boolean; off: boolean; entries: StandupEntryView[]; rollups: StandupRollupView[];
  upcoming?: { teamId: string; teamName: string; time: string; cutoff: string; drafts: boolean; lead: boolean }[];
};
export type DesktopStandup = { ready: boolean; entries: StandupEntryView[] /* today's ready ones */; rollups: StandupRollupView[] /* today's sent, unseen */ };

export const STANDUP_LIMITS = { sectionMax: 1200, linesShown: 6, maxAttempts: 3, leaseSeconds: 180, minGapMinutes: 30, modelTimeoutMs: 20_000, blockersMax: 20, postMax: 4000 } as const;
export const STANDUP_DEFAULTS = { time: "09:30", cutoff: "12:00", days: [1, 2, 3, 4, 5] } as const;

// ---- Small helpers ------------------------------------------------------------------------------------------------------

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`);
const oneLine = (s: unknown) => String(s ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
const firstOf = (name: string) => oneLine(name).split(" ")[0] || oneLine(name);

/** The weekday of a local date ("2026-10-09"): 0 = Sunday … 6 = Saturday. */
export function weekdayOfDate(localDate: string): number {
  const m = DATE.exec(localDate);
  if (!m) return 0;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
}

/** "Friday 9 October" for a local date. */
export function standupDateLabel(localDate: string): string {
  const m = DATE.exec(localDate);
  if (!m) return localDate;
  return `${DAYS[weekdayOfDate(localDate)]} ${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}`;
}

/** "Yesterday" when the previous standup day is the calendar day before, else "Since Friday". */
export function standupSinceLabel(localDate: string, previousDate: string): string {
  const d = DATE.exec(localDate);
  const p = DATE.exec(previousDate);
  if (!d || !p) return STANDUP_WORDS.card.yesterday;
  const days = Math.round((Date.UTC(+d[1], +d[2] - 1, +d[3]) - Date.UTC(+p[1], +p[2] - 1, +p[3])) / 86_400_000);
  return days === 1 ? STANDUP_WORDS.card.yesterday : `Since ${DAYS[weekdayOfDate(previousDate)]}`;
}

/** "09:41": an instant on a clock (en-GB, 24-hour); a value already "HH:MM" is kept. */
export function clockOf(value: string | null | undefined, timeZone?: string | null): string {
  const v = String(value ?? "");
  if (CLOCK.test(v)) return v;
  const t = Date.parse(v);
  if (!Number.isFinite(t)) return "";
  try {
    return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: timeZone || "UTC" }).format(new Date(t));
  } catch {
    return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" }).format(new Date(t));
  }
}

/** The day's days in words: "weekdays", "every day", "Monday, Wednesday and Friday" (Monday first). */
export function standupDaysWords(days: readonly number[]): string {
  const set = [...new Set(days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))];
  if (set.length === 7) return "every day";
  if (set.length === 5 && [1, 2, 3, 4, 5].every((d) => set.includes(d))) return "weekdays";
  const names = [1, 2, 3, 4, 5, 6, 0].filter((d) => set.includes(d)).map((d) => DAYS[d]);
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Where the card and the rollup open: `/app/{slug}/home/standup?e={entry}` or `?r={rollup}`. */
export const standupEntryHref = (slug: string, id: string) => `/app/${slug}/home/standup?e=${id}`;
export const standupRollupHref = (slug: string, id: string) => `/app/${slug}/home/standup?r=${id}`;
export const standupPageHref = (slug: string) => `/app/${slug}/home/standup`;
export const teamStandupHref = (slug: string, teamId: string) => `/app/${slug}/teams/${teamId}?tab=standup`;

/**
 * One section as the person may write it: CRLF to LF, tabs and other control characters to spaces, trailing spaces on
 * each line trimmed, three or more line breaks in a row to two, trimmed (migration 0050's column checks are the floor).
 */
export function cleanSection(s: string): string {
  return String(s ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f\u0085\u2028\u2029]/g, " ")
    .split("\n").map((l) => l.replace(/\s+$/u, "")).join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The words posted to the team channel (contract B.7): the date, then each section under its heading; a section whose
 * text is empty is left out, except Blocked, which says "- Nothing". At most 4000 characters.
 *
 * ```
 * Standup, Friday 9 October
 * Since Friday:
 * - Finished "Landing page copy"
 * Today:
 * - "Hero images" (40%)
 * Blocked:
 * - Nothing
 * ```
 */
export function standupPostBody(e: { dateLabel: string; sinceLabel: string; texts: StandupTexts }): string {
  const out: string[] = [`${STANDUP_WORDS.post.heading(e.dateLabel)}`];
  const y = cleanSection(e.texts.yesterday);
  const t = cleanSection(e.texts.today);
  const b = cleanSection(e.texts.blocked);
  if (y) out.push(`${e.sinceLabel}:`, y);
  if (t) out.push(`${STANDUP_WORDS.card.today}:`, t);
  out.push(`${STANDUP_WORDS.card.blocked}:`, b || `- ${STANDUP_WORDS.empty.blocked}`);
  return clip(out.join("\n"), STANDUP_LIMITS.postMax);
}

/** The template's texts from a draft: each line as "- {text}", joined with line breaks. */
export function draftTexts(d: StandupDraft): StandupTexts {
  const lines = (s: StandupSection) => d.sections[s].map((l) => `- ${oneLine(l.text)}`).join("\n");
  return { yesterday: lines("yesterday"), today: lines("today"), blocked: lines("blocked") };
}

/**
 * A section's lines as the card and the chat show them, each with its sources: the drafted lines while the person has not
 * edited; after an edit their own lines, and a line they left exactly as drafted keeps that line's sources (fix review,
 * 9 October 2026: an edit used to drop every line's links, not only the changed ones).
 */
export function entryLines(e: Pick<StandupEntryView, "edited" | "draft" | "texts">, s: StandupSection): StandupLine[] {
  const bare = (l: string) => oneLine(String(l ?? "").replace(/^\s*[-•*]\s+/, ""));
  const drafted = e.draft?.sections?.[s] ?? [];
  if (!e.edited && e.draft) return drafted.map((l) => ({ text: bare(l.text), refs: l.refs ?? [] })).filter((l) => l.text);
  const byText = new Map<string, EvidenceRef[]>();
  for (const l of drafted) { const k = bare(l.text); if (k && !byText.has(k)) byText.set(k, l.refs ?? []); }
  return String(e.texts?.[s] ?? "").split("\n").map(bare).filter(Boolean).map((text) => ({ text, refs: byText.get(text) ?? [] }));
}

/** Whether a section's text says nothing is blocked ("Nothing", "None", "No blockers"). */
export const NOTHING_BLOCKED = /^(nothing|none|no blockers?)\.?$/i;

// ---- The rollup in words ------------------------------------------------------------------------------------------------

/** "4 of 6 posted by 12:00." / "Nobody posted by 12:00." / "Everyone posted by 12:00." */
export function rollupHeadline(c: StandupRollupContent, timeZone?: string): string {
  const at = clockOf(c.cutoffAt, c.timeZone ?? timeZone);
  const { members, posted } = c.counts;
  if (members > 0 && posted >= members) return STANDUP_WORDS.rollup.everyone(at);
  if (posted <= 0) return STANDUP_WORDS.rollup.nobody(at);
  return STANDUP_WORDS.rollup.some(posted, members, at);
}

/** The task title a blocker's words quote ("Logo files"), or null. */
function quotedTitle(text: string): string | null {
  const m = /["“]([^"”]{1,80})["”]/.exec(text);
  return m ? m[1].trim() : null;
}
/** "logo files": a title inside a sentence (its first letter lowered when the next one is lower case). */
const inSentence = (s: string) => (s.length > 1 && s[1] === s[1].toLowerCase() ? s[0].toLowerCase() + s.slice(1) : s);

/**
 * The rollup notification's body (≤ 300): "Blocked: Ben on Ada (logo files). No update: Olu, Sam." First names only;
 * nothing blocked and everyone posted: "Everyone posted, nothing blocked."
 */
export function rollupNoticeBody(c: StandupRollupContent): string {
  const parts: string[] = [];
  if (c.blockers.length) {
    const lines = c.blockers.map((b) => {
      const title = quotedTitle(b.text);
      const what = title ? ` (${inSentence(title)})` : "";
      return `${firstOf(b.name)}${b.onName ? ` on ${firstOf(b.onName)}` : ""}${what}`;
    });
    parts.push(`${STANDUP_WORDS.rollup.blocked}: ${lines.join("; ")}.`);
  }
  if (c.noUpdate.length) parts.push(`${STANDUP_WORDS.rollup.noUpdate}: ${c.noUpdate.map((p) => firstOf(p.name)).join(", ")}.`);
  if (!parts.length) parts.push(STANDUP_WORDS.rollup.allClear);
  return clip(parts.join(" "), 300);
}

const messageLink = (slug: string, m: { messageId: string | null; conversationId: string | null }) => {
  const href = m.messageId && m.conversationId ? evidenceHref(slug, { kind: "message", id: m.messageId, conversationId: m.conversationId }) : null;
  return href ? ` ([${STANDUP_WORDS.rollup.messageLink}](${href}))` : "";
};

/**
 * The rollup as Markdown (her page, the chat's rollup answer, a copy in the report). Names and words through `mdEscape`;
 * links only from ids (lib/evidence-links). A rollup that was not sent says why.
 *
 * ```
 * **Design standup, Friday 9 October**
 * 4 of 6 posted by 12:00.
 *
 * **Posted**
 * - **Ada Obi**, 09:41 ([message](…))
 *
 * **Blocked**
 * - **Ben Okafor** on **Ada Obi**: "Logo files": waiting on Ada Obi ([task](…))
 *
 * **No update**
 * - Olu Ade
 * - Sam Lee
 * ```
 */
export function rollupMarkdown(slug: string, v: StandupRollupView): string {
  const R = STANDUP_WORDS.rollup;
  const head = `**${mdEscape(R.title(v.team.name, v.dateLabel))}**`;
  const c = v.content;
  if (!c) return `${head}\n${mdEscape(v.status === "open" ? R.open(clockOf(v.cutoffAt, v.timeZone)) : R.reasons(v.reason))}`;
  const tz = c.timeZone ?? v.timeZone;
  const blocks: string[] = [`${head}\n${mdEscape(rollupHeadline(c, tz))}`];
  if (c.posted.length) blocks.push(`**${R.posted}**\n${c.posted.map((p) => `- **${mdEscape(p.name)}**, ${clockOf(p.at, tz)}${messageLink(slug, p)}`).join("\n")}`);
  if (c.blockers.length) {
    blocks.push(`**${R.blocked}**\n${c.blockers.map((b) => {
      const on = b.onName ? ` on **${mdEscape(b.onName)}**` : "";
      return `- **${mdEscape(b.name)}**${on}: ${mdEscape(b.text)}${sourcesSuffix(slug, b.taskId ? [{ kind: "task", id: b.taskId }] : [])}`;
    }).join("\n")}`);
  }
  if (c.noUpdate.length) blocks.push(`**${R.noUpdate}**\n${c.noUpdate.map((p) => `- ${mdEscape(p.name)}`).join("\n")}`);
  if (c.late.length) blocks.push(`**${mdEscape(R.late(clockOf(c.cutoffAt, tz)))}**\n${c.late.map((p) => `- **${mdEscape(p.name)}**, ${clockOf(p.at, tz)}${messageLink(slug, p)}`).join("\n")}`);
  return blocks.join("\n\n");
}

// ---- Every fixed string (contract B.4, B.7, G.1, G.2) -------------------------------------------------------------------

export const STANDUP_NOT_READY = "Standups need a database update first. Ask an owner to apply it.";
export const STANDUP_NOT_READY_SHORT = "Standups need a database update first.";

export const STANDUP_WORDS = {
  /** The approval card (B.4, G.2). `name`: the person's own assistant ("Max"); `team`: the team's name ("Design"). */
  card: {
    title: (team: string) => `Your standup for ${team}`,
    yesterday: "Yesterday",
    today: "Today",
    blocked: "Blocked",
    post: (team: string) => `Post to #${team}`,
    edit: "Edit",
    skip: "Skip today",
    undo: "Undo",
    save: "Save",
    cancel: "Cancel",
    open: "Open",
    openChannel: "Open channel",
    sources: "Sources",
    counter: (n: number) => `${n} / ${STANDUP_LIMITS.sectionMax}`,
    readback: (channel: string, members: number | null, name: string) => `Posts to ${channel} (${memberWords(members)}) as you, sent by ${name}.`,
    rollupTo: (leads: string[], at: string) => (leads.length ? `Rollup to ${listWords(leads)} at ${at}.` : "No lead: nobody receives the rollup."),
    /** The person receives the rollup themself (fix review, 9 October 2026): "Rollup to you at 10:30." */
    rollupToYou: (others: string[], at: string) => `Rollup to ${listWords(["you", ...others])} at ${at}.`,
    noLead: "No lead: nobody receives the rollup.",
    status: {
      drafting: "Drafting", ready: "Ready to post", posted: "Posted", skipped: "Skipped", missed: "No update", failed: "Couldn't draft", cancelled: "Cancelled",
    } satisfies Record<StandupStatus, string>,
    drafting: (name: string) => `${name} is drafting your standup.`,
    edited: "Edited by you",
  },
  /** The empty lines (the template's, when a section has no facts). */
  empty: { yesterday: "Nothing recorded", today: "Nothing planned yet", blocked: "Nothing" } satisfies Record<StandupSection, string>,
  /** What a press answers (the card's aria-live line, the chat's done lines). */
  results: {
    posted: (team: string, at: string) => `Posted to #${team} at ${at}`,
    skipped: "Skipped. The rollup lists you under No update, like anyone who didn't post.",
    unskipped: "Back on your list. Post it when you're ready.",
    saved: "Saved.",
    already: (team: string, at: string) => `Already posted to #${team} at ${at}`,
    failed: (name: string, team: string) => `${name} couldn't draft your standup for ${team} today. You can still write one in #${team}.`,
    missed: "The day passed without an update. Nothing was posted.",
    cancelled: "Standup was switched off for this team today.",
  },
  /** The text posted to the channel. */
  post: { heading: (dateLabel: string) => `Standup, ${dateLabel}` },
  /** The rollup (B.6, B.7, G.2). */
  rollup: {
    title: (team: string, dateLabel: string) => `${team} standup, ${dateLabel}`,
    some: (posted: number, members: number, at: string) => `${posted} of ${members} posted by ${at}.`,
    nobody: (at: string) => `Nobody posted by ${at}.`,
    everyone: (at: string) => `Everyone posted by ${at}.`,
    posted: "Posted",
    blocked: "Blocked",
    noUpdate: "No update",
    late: (at: string) => `Posted after ${at}`,
    messageLink: "message",
    allClear: "Everyone posted, nothing blocked.",
    open: (at: string) => `The rollup comes at ${at}.`,
    reasons: (reason: string | null) => ({
      off: "Standup was switched off for the day.",
      missed: "The day passed before its standup could start.",
      no_lead: "This team has no lead, so no rollup was sent.",
      empty: "Nobody was on the team that day.",
    } as Record<string, string>)[reason ?? ""] ?? "No rollup this day.",
    seen: "Seen",
  },
  /** Notifications (B.4, B.6) and their kinds in the bell. */
  notifications: {
    kinds: { "brenda.standup": "Standup", "brenda.standup_rollup": "Standup", "brenda.standup_failed": "Standup" } as Record<string, string>,
    draftTitle: (team: string) => `Your standup for ${team} is ready`,
    rollupTitle: (team: string, posted: number, members: number) => `${team} standup: ${posted} of ${members} posted`,
    failedTitle: (team: string) => `Your standup for ${team} couldn't be drafted`,
  },
  /** The team page's Standup tab (G.1). */
  settings: {
    tab: "Standup",
    title: "Async standup",
    switch: (team: string) => `Run a daily standup for ${team}`,
    switchHint: "Each person's assistant drafts their update from their own work at the time below. Nothing is posted until they press Post.",
    draftsAt: "Drafts arrive at",
    rollupAt: "Rollup at",
    rollupHint: "You get one rollup with who posted, the blockers they named and who has no update yet.",
    days: "Days",
    footnote: (tz: string) => `Times are in the organisation's time zone (${tz}). Holidays aren't known to Boredroom: untick a day, or people skip it.`,
    /** For members, who cannot untick a day (fix review, 9 October 2026). */
    footnoteMember: (tz: string) => `Times are in the organisation's time zone (${tz}). Holidays aren't known to Boredroom: skip the day on your standup card.`,
    readOn: (days: string, time: string, cutoff: string) => `On: ${days} at ${time}, rollup at ${cutoff}`,
    readOff: "Off",
    noLead: "This team has no lead, so nobody receives the rollup.",
    save: "Save",
    saved: "Saved.",
    notReady: STANDUP_NOT_READY_SHORT,
  },
  /** The /home/standup page (G.2). */
  page: {
    title: "Standup",
    description: (name: string) => `Your standup drafts from ${name}, and the rollups you receive`,
    today: "Today",
    rollups: "Rollups",
    earlier: "Last 7 days",
    emptyTitle: "No standup today",
    emptyBody: "Your team lead switches standup on for the team.",
    emptyBodyLead: "Switch it on in your team's Standup tab.",
    /** Standup is on and today's has not started yet (fix review, 9 October 2026). */
    upcomingTitle: "Standup later today",
    upcoming: (items: { teamName: string; time: string; cutoff: string; drafts: boolean; lead: boolean }[]) => items.map((u) => (u.drafts
      ? `Drafts arrive at ${u.time} (${u.teamName})${u.lead ? `, and your rollup at ${u.cutoff}` : ""}.`
      : `${u.teamName}'s rollup comes at ${u.cutoff}${u.lead ? "" : " to the team's lead"}.`)).join(" "),
    openTeam: "Open team",
  },
  /** The chat's helper (F.1). */
  chat: {
    ready: (team: string) => `Your standup for **${mdEscape(team)}** is ready to post.`,
    none: "No standup for you today. Your team lead switches it on for the team.",
    postConfirm: (channel: string, name: string) => `Press Confirm to post it to ${channel} as yours, sent by ${name}.`,
    skipConfirm: (team: string) => `Skip today's standup for ${team}? The rollup lists you under No update, like anyone who didn't post.`,
    updated: (team: string) => `Updated your standup for ${team}`,
    posted: (channel: string) => `Posted your standup to ${channel}`,
    skipped: (team: string) => `Skipped today's standup for ${team}`,
    postSummary: (channel: string) => `Post your standup to ${channel}`,
    what: (name: string) => `Your standup, as you, sent by ${name}`,
  },
  /** What the routes answer. */
  errors: {
    notReady: STANDUP_NOT_READY_SHORT,
    notFound: "That standup isn't one of yours.",
    rollupNotFound: "That rollup isn't one of yours.",
    teamNotFound: "That team isn't there.",
    closed: "This standup was skipped or its day has passed.",
    notInTeam: (team: string) => `You're no longer in ${team}.`,
    teamOff: (team: string) => `Standup is switched off for ${team}.`,
    tooLate: (team: string) => `The rollup has gone; you can still write in #${team}.`,
    onlyPerson: (first: string) => `Only ${first} can post their own standup.`,
    notOffered: "Standup is switched off for this workspace. An owner or HR can switch it on in Settings → Brenda → Abilities.",
    forbidden: "Only the team's lead, the owner or HR can change this.",
    gap: "The rollup time must be at least 30 minutes after the drafts.",
    days: "Pick at least one day.",
    time: "Use a 24-hour time such as 09:30.",
    tooLong: `Keep each part under ${STANDUP_LIMITS.sectionMax} characters.`,
    empty: "Write at least one part of your standup.",
    invalid: "Use letters, numbers and punctuation only.",
    archived: "This team's channel is archived. Restore it to post there.",
  },
} as const;

/** "David", "David and Sam", "David, Sam and Ada". */
function listWords(names: string[]): string {
  const n = names.map(oneLine).filter(Boolean);
  if (n.length <= 1) return n[0] ?? "";
  return `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
}
