/**
 * The web card "{name} on your Mac" (Settings › Your assistant), phase 3 of Brenda for Mac (owner report and request,
 * 12 October 2026, after trying phase 2: "when I turned this setting on, I stopped seeing my Brenda". The old card listed
 * the Mac's switches as plain text and its only button was "Turn off on my Macs"; he pressed it thinking it turned things
 * on. Contract `companion2-spec` A.5, L.1, L.2 and M.9).
 *
 * What changed, and why:
 * - The card shows each of the person's Macs with what is on there, as Brenda for Mac last reported it to Boredroom for
 *   the person alone (owner request, 12 October 2026: "the person sees what is on; the employer still sees nothing";
 *   contract 0b.2, stored on `assistant_private.screen_help_macs`, migration 0059).
 * - Its one primary button is "Set up on my Mac", which only asks the person's Macs to open their setup card at their
 *   next poll; nothing turns on until the person presses "Turn these on" on the Mac itself (the owner's permission rule,
 *   12 October 2026; contract 0b.3).
 * - "Turn off on all my Macs…" is a quiet, clearly destructive secondary action behind a confirm.
 *
 * This module is the card's words and its pure logic (`macRows`, `setupStatus`, `checkedWords`), so the unit test can pin
 * every word and state without React. Client-safe: it imports only `lib/screen-help` (which imports only zod).
 */
import { COMPANION_SHOWN_WHYS, type CompanionWhy, type MacFolders, type MacReport, type MacState, type Permission, type ScreenHelpMine } from "@/lib/screen-help";

// ---- Words (contract M.9; `name` is the person's own assistant) ---------------------------------------------------------

/** The folders Brenda for Mac asks macOS about, in the order the card names a refused one. */
const FOLDER_NAMES: Record<keyof MacFolders, string> = { documents: "Documents", desktop: "Desktop", downloads: "Downloads" };

/** The companion's hiding reasons in the tray's short form (contract M.5); the shown reasons all read "Shown". */
const HIDDEN_WORDS: Partial<Record<CompanionWhy, string>> = {
  setting_off: "Hidden: switched off",
  screen_help_off: "Hidden: seeing your screen is off",
  signed_out: "Hidden: signed out",
  locked: "Hidden: Mac locked",
  call: "Hidden during a call",
  sharing: "Hidden: screen may be shared",
  screenshot_tool: "Hidden: taking a screenshot",
  mirrored: "Hidden: screen mirrored",
  full_screen: "Hidden: an app is full screen",
};

export const MAC_HELP_WORDS = {
  /**
   * Brenda and her helpers (owner brief, 12 October 2026; decision 9; contract N.2, S.9): the person's own "Check with me
   * before every task" (default off; owners can't change it), and the link to their private Jobs list.
   */
  checkEvery: {
    label: "Check with me before every task",
    hint: (name: string) => `${name} asks “Do you want me to do this?” before anything on your Mac, even opening an app. Off: your request is the go-ahead for routine things; ${name} still asks before deleting, sending, paying or anything to do with security. Only you can change this.`,
    saved: "Saved.",
    failed: "That couldn't be saved. Try again.",
    notReady: "This needs a database update first.",
  },
  seeJobs: "See your jobs",
  title: (name: string) => `${name} on your Mac`,
  description: (name: string) => `${name} can see your screen when you ask, do things on your Mac when you ask and say yes, and work on your files. You choose which in Brenda for Mac, on each Mac.`,
  macsLabel: "Your Macs",
  /** Before migration 0059 the card can't know what is on, so the bare list is what it can do, not "Your Macs" (review, 12 October 2026). */
  abilitiesLabel: "What it can do",
  /**
   * How to set it up on the Mac itself, in the words of the Brenda for Mac the person has (review, 12 October 2026: the
   * hint named a "Set up" tray item today's app doesn't have). `binary`: the Mac's reported LookStatus.v; today's is 2.
   */
  howTo: (name: string, binary?: number | null) => (binary !== undefined && binary !== null && binary >= 3
    ? `On your Mac, hold ⌃ ⌘ and ask, or click the Brenda for Mac icon in the menu bar and choose Set up ${name} on this Mac…`
    : "On your Mac, hold ⌃ ⌘ and ask, or click the Brenda for Mac icon in the menu bar and choose Screen help › Turn on screen help…"),
  checked: (when: string) => `Checked ${when}`,
  rows: {
    look: "Sees your screen when you ask",
    mac: "Does things when you ask",
    files: "Works on your files",
    companion: (name: string) => `${name} by your pointer`,
  },
  badges: {
    on: "On",
    off: "Off",
    screenRecording: "On, but Screen Recording isn't allowed",
    accessibility: "On; clicking and typing need Accessibility",
    finder: "On; Finder said no",
    folder: (folder: string) => `On; ${folder} isn't allowed`,
  },
  companion: {
    shown: "Shown",
    notReported: "Not reported yet",
    hidden: HIDDEN_WORDS,
  },
  /** Not in M.9 (web builder, 12 October 2026): a Mac whose macOS is too old for any of it says so, not "Off" alone. */
  unsupported: "This Mac can't use these: it needs a newer version of macOS.",
  linkedNoReport: "Hasn't checked in since this update. Open Brenda for Mac there to see what's on.",
  none: "Brenda for Mac isn't on any of your Macs yet. Install it and sign in, then set it up here.",
  setup: {
    label: "Set up",
    hint: "Opens the setup on your Mac. It asks you there before turning anything on.",
    button: "Set up on my Mac",
    pending: "Asking your Macs…",
    waiting: "Open Brenda for Mac on your Mac. The setup opens there within a minute.",
    open: (device: string) => `The setup is open on ${device}. Finish it there.`,
    done: (device: string) => `Done on ${device}.`,
    timeout: (name: string, binary?: number | null) => `Brenda for Mac hasn't opened it yet. Check it's running and signed in, or choose ${binary !== undefined && binary !== null && binary >= 3 ? `Set up ${name} on this Mac…` : "Screen help › Turn on screen help…"} from its icon in the menu bar.`,
  },
  off: {
    label: "Turn off",
    hint: "Turns off seeing your screen, doing things and working on files on every Mac you use.",
    button: "Turn off on all my Macs…",
    title: "Turn off screen help, actions and file work on all your Macs?",
    description: (name: string) => `${name} stops seeing your screen, doing things and working on files on every Mac you use, within a minute. You can set it up again any time.`,
    confirm: "Turn off",
    pending: "Turning off…",
  },
  privacy: "Only you can see this. Your workspace can't see whether you use any of it, or what's on.",
  notReady: "What's on on your Macs shows here after a database update.",
} as const;

// ---- One Mac's rows ---------------------------------------------------------------------------------------------------------

export type MacRowKey = "look" | "mac" | "files" | "companion";
/** `tone` is the badge's (On green, Off neutral, a missing permission amber); null for the companion's secondary text. */
export type MacRow = { key: MacRowKey; label: string; value: string; tone: "success" | "neutral" | "warning" | null };

const granted = (p: Permission) => p === "granted";

/**
 * The four rows for one Mac's reported state (contract A.5, M.9). Doing things and working on files need seeing the
 * screen (phase 2's 0b.5, kept in 0b.1): a Mac that reports them on with seeing off shows them Off, because that is what
 * the person gets there (web builder, 12 October 2026: the card says what is true, not what a switch remembers).
 * Screen Recording and Accessibility read as missing until macOS says granted (as the Mac's own card, A.3); Finder and the
 * folders only once macOS has said no (unknown is "not asked yet", which the Mac asks at the first file job).
 */
export function macRows(state: MacState, name: string): MacRow[] {
  const W = MAC_HELP_WORDS;
  const supported = state.supported !== false;
  const look = supported && state.look.on;
  const mac = look && state.mac.on;
  const files = look && state.files.on;
  const off = (key: MacRowKey, label: string): MacRow => ({ key, label, value: W.badges.off, tone: "neutral" });

  const lookRow: MacRow = !look ? off("look", W.rows.look)
    : granted(state.look.permission) ? { key: "look", label: W.rows.look, value: W.badges.on, tone: "success" }
    : { key: "look", label: W.rows.look, value: W.badges.screenRecording, tone: "warning" };
  const macRow: MacRow = !mac ? off("mac", W.rows.mac)
    : granted(state.mac.accessibility) ? { key: "mac", label: W.rows.mac, value: W.badges.on, tone: "success" }
    : { key: "mac", label: W.rows.mac, value: W.badges.accessibility, tone: "warning" };
  let filesRow: MacRow = off("files", W.rows.files);
  if (files) {
    const refused = state.files.folders ? (Object.keys(FOLDER_NAMES) as (keyof MacFolders)[]).find((f) => state.files.folders![f] === "denied") : undefined;
    filesRow = state.files.finder === "denied" ? { key: "files", label: W.rows.files, value: W.badges.finder, tone: "warning" }
      : refused ? { key: "files", label: W.rows.files, value: W.badges.folder(FOLDER_NAMES[refused]), tone: "warning" }
      : { key: "files", label: W.rows.files, value: W.badges.on, tone: "success" };
  }
  return [lookRow, macRow, filesRow, { key: "companion", label: W.rows.companion(name), value: companionWords(state), tone: null }];
}

/**
 * The companion's line: "Shown" for a passing reason, the tray's words for a hiding one (contract M.5). Today's binary
 * reports no reason; then a switch that is off is still a reason the card knows, and otherwise "Not reported yet".
 */
export function companionWords(state: MacState): string {
  const W = MAC_HELP_WORDS.companion;
  const why = state.companion.why;
  if (why) {
    if (COMPANION_SHOWN_WHYS.includes(why)) return W.shown; // reasons that pass in a moment (contract F)
    return W.hidden[why] ?? W.notReported;
  }
  if (!state.companion.on) return W.hidden.setting_off!;
  if (!state.look.on || state.supported === false) return W.hidden.screen_help_off!;
  if (state.companion.shown === true) return W.shown;
  return W.notReported;
}

// ---- "Checked …" ------------------------------------------------------------------------------------------------------------

const dayKey = (d: Date, timeZone?: string) => {
  try { return d.toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit", ...(timeZone ? { timeZone } : {}) }); }
  catch { return d.toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "UTC" }); }
};
const fmt = (d: Date, o: Intl.DateTimeFormatOptions, timeZone?: string) => {
  try { return d.toLocaleString("en-GB", { ...o, ...(timeZone ? { timeZone } : {}) }); }
  catch { return d.toLocaleString("en-GB", { ...o, timeZone: "UTC" }); }
};

/**
 * When a Mac last reported, after "Checked" (contract M.9): "just now" (under a minute, or a clock a little ahead),
 * "2 minutes ago" (under an hour), "today at 09:14" (the same day in the workspace's time zone), "on 10 October", and
 * "on 10 October 2025" in another year.
 */
export function checkedWords(iso: string, now: number, timeZone?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "just now";
  const ms = now - d.getTime();
  if (ms < 60_000) return "just now";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
  const today = new Date(now);
  if (dayKey(d, timeZone) === dayKey(today, timeZone)) return `today at ${fmt(d, { hour: "2-digit", minute: "2-digit", hour12: false }, timeZone)}`;
  const sameYear = fmt(d, { year: "numeric" }, timeZone) === fmt(today, { year: "numeric" }, timeZone);
  return `on ${fmt(d, { day: "numeric", month: "long", ...(sameYear ? {} : { year: "numeric" }) }, timeZone)}`;
}

// ---- After "Set up on my Mac" -------------------------------------------------------------------------------------------------

/** How long the card waits before saying the Mac hasn't opened it (contract L.2), and how long it keeps asking. */
export const SETUP_WAIT_MS = 2 * 60_000;
export const SETUP_POLL_MS = 5_000;
export const SETUP_POLL_FOR_MS = 5 * 60_000;

export type SetupStatus =
  | { kind: "idle" }
  | { kind: "waiting" }
  | { kind: "open"; device: string; reportedAt: string }
  | { kind: "done"; device: string }
  | { kind: "timeout" };

const ms = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : NaN);
const sameInstant = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && ms(a) === ms(b);

/**
 * Where the setup the person asked for has got to (contract L.2). `pressedAt`: when they pressed Set up (ms; null: they
 * haven't, nothing to say). A Mac has opened it once it reports `setupSeenAt` equal to `mine.setupAt`; it is done once that
 * Mac reports again after the card first saw it open, with seeing the screen on. `openSeen` is that first report
 * (`reportedAt` of the `open` status the card showed): the report that says the setup opened is itself later than the press,
 * so "reported after the press" alone would read done the moment it opened on a Mac where seeing was already on (web
 * builder, 12 October 2026, a gap in L.2's wording). Waiting turns to timeout after two minutes; a late open still shows.
 */
export function setupStatus(mine: Pick<ScreenHelpMine, "setupAt" | "macs">, pressedAt: number | null, now: number, openSeen?: { device: string; reportedAt: string } | null): SetupStatus {
  if (pressedAt === null || !mine.setupAt) return { kind: "idle" };
  const seen: MacReport | undefined = mine.macs.find((m) => sameInstant(m.setupSeenAt, mine.setupAt));
  if (seen) {
    const doneNow = seen.state.look.on && !!openSeen && openSeen.device === seen.device && ms(seen.reportedAt) > ms(openSeen.reportedAt);
    return doneNow ? { kind: "done", device: seen.device } : { kind: "open", device: seen.device, reportedAt: seen.reportedAt };
  }
  return now - pressedAt >= SETUP_WAIT_MS ? { kind: "timeout" } : { kind: "waiting" };
}

/** The status line's words; "" for idle. `binary`: the newest reported Brenda for Mac's (its tray's words). */
export function setupWords(status: SetupStatus, name: string, binary?: number | null): string {
  const W = MAC_HELP_WORDS.setup;
  switch (status.kind) {
    case "waiting": return W.waiting;
    case "open": return W.open(status.device);
    case "done": return W.done(status.device);
    case "timeout": return W.timeout(name, binary);
    default: return "";
  }
}

/** The newest reported Mac's Brenda for Mac (LookStatus.v), or null when none has reported. */
export function newestBinary(mine: Pick<ScreenHelpMine, "macs">): number | null {
  const newest = [...mine.macs].sort((a, b) => ms(b.reportedAt) - ms(a.reportedAt))[0];
  return newest ? newest.state.binary : null;
}

/**
 * Whether "Turn off on all my Macs…" has nothing to turn off (review, 12 October 2026: the owner pressed it thinking it
 * turned things on): every Mac has reported, and none has seeing, doing or file work on. Unknown (before 0059, or a linked
 * Mac that hasn't reported) keeps the button, as the way to turn it off from here.
 */
export function nothingToTurnOff(mine: Pick<ScreenHelpMine, "macReady" | "macs" | "linked">): boolean {
  return mine.macReady && mine.linked.length === 0 && mine.macs.length > 0 && mine.macs.every((m) => !m.state.look.on && !m.state.mac.on && !m.state.files.on);
}

/** Whether the card keeps asking Boredroom (every 5 s, for at most 5 minutes from the press, until done). */
export const setupPolling = (status: SetupStatus, pressedAt: number | null, now: number) =>
  pressedAt !== null && status.kind !== "idle" && status.kind !== "done" && now - pressedAt < SETUP_POLL_FOR_MS;
