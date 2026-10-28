/**
 * Brenda and her helpers, build 1 (owner's approved brief, 12 October 2026: the doc "Brenda and her helpers", all nine
 * decisions "Agree", "proceed to build"; contract O.2). What the server, the web pages, the tests and (as mirrored text)
 * the Mac share about her front desk and her background jobs:
 * - the 27 direct Mac actions (`MAC_ACTION_KINDS`) and the router's flat action shape (`MacAction`);
 * - the web browsers a tab, a page or a search may go to (`BROWSERS`, `isBrowserName`; owner report, 28 October 2026);
 * - the lanes and the router's streamed lines (`FrontLane`, `RouteLine`);
 * - jobs: `JobView` (what the Mac gets when a job starts), `JobItem` (the web's Jobs list), the Files helper's calls and
 *   results, and `JOB_LIMITS` (mirrored in the Mac's jobs.rs);
 * - the fixed doing and done lines (`FRONT_LINES`, `frontLineOk`: only these get a natural-voice offer);
 * - the words that send a screen question straight to the stronger model (`THINK_WORDS`, `thinkLane`);
 * - kinds of file and the folders organising makes (`FILE_KIND_EXT`, `ORGANISE_FOLDERS`, `fileKindOf`);
 * - which web pages the front desk opens (`frontUrl`: permission rule v2 opens any ordinary page the person names,
 *   banking and payment ones included, "Go to stripe.com | Now | No");
 * - every word the server sends (`FRONT_WORDS`).
 *
 * Permission rule v2 (owner, 12 October 2026; replaces "always confirm"): "when you hold the keys and clearly ask for a
 * routine task, the request is the permission, and she does it. She still asks before anything destructive, anything
 * sent, anything that costs money, or anything sensitive." The classifier is in lib/mac-risk.ts.
 *
 * Client-safe: imports only lib/act (which imports only lib/screen-help and zod-free code).
 */
import { OPEN_RUNS_EXT, neverOpenName } from "@/lib/act";

// ---- The direct Mac actions (contract C) ----------------------------------------------------------------------------------

export const MAC_ACTION_KINDS = [
  "open_app", "open_url", "open_folder", "open_file", "reveal_file", "find_files", "switch_app", "hide_app", "hide_others", "hide_all", "show_all",
  "minimise", "arrange", "fill", "half", "quit_app", "volume", "mute", "unmute", "screenshot", "copy_selection", "type_text", "wifi", "empty_trash",
  // Owner report, 28 October 2026 ("open a new tab in Brave" opened Brave and said so): a new tab or window in a browser,
  // and a web search. `app` is the browser ("" for the front one, else the Mac's default); a search's words are `text`.
  "new_tab", "new_window", "search_web",
] as const;
export type MacActionKind = (typeof MAC_ACTION_KINDS)[number];
export const isMacActionKind = (v: unknown): v is MacActionKind => (MAC_ACTION_KINDS as readonly unknown[]).includes(v);

/**
 * The web browsers people name (owner report, 28 October 2026), the same table as `BROWSERS` in the Mac's open.rs: what
 * they say and the apps' own names. Only one of these may be the `app` of an open_url, new_tab, new_window or search_web.
 */
export const BROWSERS: readonly { said: readonly string[]; names: readonly string[] }[] = [
  { said: ["safari"], names: ["Safari"] },
  { said: ["chrome", "google chrome"], names: ["Google Chrome"] },
  { said: ["brave", "brave browser"], names: ["Brave Browser"] },
  { said: ["arc"], names: ["Arc"] },
  { said: ["firefox", "mozilla firefox", "fire fox"], names: ["Firefox"] },
  { said: ["edge", "microsoft edge"], names: ["Microsoft Edge"] },
  { said: ["opera"], names: ["Opera"] },
  { said: ["vivaldi"], names: ["Vivaldi"] },
  { said: ["orion"], names: ["Orion"] },
  { said: ["zen", "zen browser"], names: ["Zen", "Zen Browser"] },
  { said: ["duckduckgo", "duck duck go"], names: ["DuckDuckGo"] },
];
/** A name as a key, as the Mac's app index reads it ("the Brave app" → "brave"). */
const appKey = (s: string) => s.normalize("NFKC").toLowerCase().trim().replace(/^(the|my)\s+/, "").replace(/\s+(app|application)$/, "").replace(/[^\p{L}\p{N}]+/gu, "");
/** Whether a name (as people say it, or the app's own) is one of `BROWSERS`. */
export function isBrowserName(name: unknown): boolean {
  const k = appKey(String(name ?? ""));
  return !!k && BROWSERS.some((b) => [...b.said, ...b.names].some((n) => appKey(n) === k));
}
/** The most a web search's words may be (characters; the Mac's open.rs `SEARCH_MAX`). */
export const SEARCH_WORDS_MAX = 200;

/** File kinds a search or a list may name (D.5; `any` is every kind). */
export const SEARCH_KINDS = ["any", "image", "screenshot", "pdf", "document", "spreadsheet", "presentation", "video", "audio", "archive", "code", "design"] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];
export const FOLDER_REF_SOURCES = ["named", "added", "pointed", "none"] as const;
export type FolderRefSource = (typeof FOLDER_REF_SOURCES)[number];

/**
 * One action as the router's do_on_mac tool gives it (strict: every field is there; the ones its kind doesn't use are
 * "", [], 0, "none" or false) and as the server passes it to the Mac after checking (contract B.4).
 */
export type MacAction = {
  kind: MacActionKind; app: string; app2: string; url: string; folder: { source: FolderRefSource; name: string };
  words: string[]; kinds: SearchKind[]; since_days: number; pick: "ask" | "newest" | "none"; text: string; level: number;
  change: "set" | "up" | "down" | "none"; side: "left" | "right" | "none"; on: boolean;
};

/** The lanes a request can take (contract B.4, O.2). */
export const FRONT_LANES = ["mac", "boredroom", "job", "look", "chat", "ask", "enable", "refused", "none"] as const;
export type FrontLane = (typeof FRONT_LANES)[number];

export type JobHelper = "files" | "operator";
export type RiskClass = "routine" | "ask" | "never";

/** A speech offer, as the speech route takes it (natural-voice.ts). */
export type FrontSpeech = { path: string; token: string; text: string } | null;

/** What a started job looks like on the Mac (contract G.2). */
export type JobView = { id: string; helper: JobHelper; title: string; doing: string; goal: string; plan: string; planSha256: string; stepCap: number; startedAt: string };

/** One line of the router's streamed answer (contract B.4). */
export type RouteLine =
  | { t: "route"; lane: "mac"; actions: MacAction[]; risk: "routine" | "ask" }
  | { t: "route"; lane: "job"; job: { helper: JobHelper; title: string; doing: string; goal: string; token: string; needs: { consent: boolean; yes: boolean } }; say: string; speech: FrontSpeech }
  | { t: "route"; lane: "look"; look: { lane: "now" | "think" }; screen?: true }
  | { t: "route"; lane: "boredroom" }
  | { t: "route"; lane: "ask"; question: string }
  | { t: "route"; lane: "enable"; which: "mac" | "files" | "accessibility" }
  | { t: "route"; lane: "refused"; reason: string; message: string }
  | { t: "done"; result: Record<string, unknown> }
  | { t: "error"; status: number; code: string; message: string };

/** The web's Jobs list (contract N.1). */
export type JobStatus = "running" | "asking" | "paused" | "done" | "stopped" | "said_no" | "expired" | "failed";
export type JobItem = {
  id: string; helper: JobHelper; title: string; status: JobStatus; startedAt: string; endedAt: string | null;
  progress: { done: number; of: number }; summary: string | null; outputs: { name: string; folder: string }[];
  undo: { available: boolean; undoneAt: string | null }; request: string | null;
};

// ---- The Files helper's calls and results (contract H.5 to H.7) -----------------------------------------------------------

export const FILES_TOOL_NAMES = ["list_files", "read_text", "make_folder", "move", "copy", "rename", "organise", "rename_by_date", "convert", "write_file", "trash", "open", "finished", "cannot_continue"] as const;
export type FilesToolName = (typeof FILES_TOOL_NAMES)[number];
export const CONVERT_TO = ["pdf", "docx", "txt", "rtf", "jpeg", "png"] as const;
export const WRITE_FORMATS = ["md", "txt", "csv", "docx", "pdf"] as const;
export type WriteFormat = (typeof WRITE_FORMATS)[number];
/** A call the Mac runs, as the server passes it (a write_file in docx or pdf carries the HTML the server made). */
export type FilesCall = { id: string; name: Exclude<FilesToolName, "finished" | "cannot_continue">; input: Record<string, unknown> };
/** One result the Mac sends back with its next step (each `out` at most `JOB_LIMITS.resultChars` as JSON). */
export type FilesResult = { id: string; name: string; ok: boolean; out?: unknown; error?: string | null };

// ---- Limits (contract G.8; mirrored in jobs.rs) ----------------------------------------------------------------------------

export const JOB_LIMITS = {
  filesSteps: 40,
  operatorSteps: 20,
  callsPerTurn: 8,
  refsPerCall: 500,
  listItems: 500,
  readChars: 20_000,
  jobReadChars: 300_000,
  writeChars: 200_000,
  newFiles: 10,
  changes: 2_000,
  idleMinutes: 30,
  maxHours: 24,
  askMinutes: 10,
  tokenSeconds: 120,
  bodyBytes: 4_000_000,
  resultChars: 120_000,
} as const;

/** The front desk's own limits (contract B.4, E.3). */
export const FRONT_LIMITS = {
  textChars: 1_000,
  requestAgeMs: 30_000,
  bodyBytes: 262_144,
  recordBytes: 65_536,
  records: 20,
  recordActions: 10,
  actionWords: 120,
  running: 20,
  runningChars: 80,
  files: 10,
  folders: 14,
  messages: 10,
  messageChars: 4_000,
  actions: 3,
  appChars: 80,
  words: 6,
  wordChars: 40,
  sinceDaysMax: 3_650,
  typeChars: 2_000,
  titleMin: 6,
  titleMax: 60,
  goalMin: 8,
  goalMax: 300,
  questionMin: 3,
  questionMax: 200,
  lineChars: 200,
  keepDays: 30,
} as const;

// ---- Kinds of file (contract D.5; shared with fileops.rs) -------------------------------------------------------------------

export const FILE_KIND_EXT: Readonly<Record<Exclude<SearchKind, "any" | "screenshot"> | "installer", readonly string[]>> = {
  image: ["jpg", "jpeg", "png", "heic", "heif", "gif", "webp", "tiff", "tif", "bmp", "svg", "raw", "cr2", "cr3", "nef", "arw", "dng"],
  pdf: ["pdf"],
  document: ["doc", "docx", "pages", "rtf", "rtfd", "txt", "md", "odt"],
  spreadsheet: ["xls", "xlsx", "numbers", "csv", "tsv", "ods"],
  presentation: ["ppt", "pptx", "key", "odp"],
  video: ["mov", "mp4", "m4v", "avi", "mkv", "webm"],
  audio: ["mp3", "m4a", "wav", "aiff", "aif", "aac", "flac", "ogg"],
  archive: ["zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz"],
  installer: ["dmg", "pkg", "mpkg", "iso"],
  code: ["js", "ts", "tsx", "jsx", "py", "rb", "go", "rs", "java", "c", "h", "cpp", "swift", "json", "yaml", "yml", "html", "css", "sh", "sql"],
  design: ["fig", "sketch", "psd", "ai", "xd", "afdesign", "afphoto", "indd"],
};
const SCREENSHOT_EXT = ["png", "jpg", "jpeg", "heic"];
const SCREENSHOT_PREFIXES = ["screenshot ", "screen shot ", "cleanshot "];

export type FileKindName = "screenshot" | keyof typeof FILE_KIND_EXT | "other";

/** The folder organising by kind puts each kind into (D.5, H.3). */
export const ORGANISE_FOLDERS: Readonly<Record<FileKindName, string>> = {
  screenshot: "Screenshots", image: "Images", pdf: "PDFs", document: "Documents", spreadsheet: "Spreadsheets", presentation: "Presentations",
  video: "Videos", audio: "Audio", archive: "Archives", installer: "Installers", code: "Code", design: "Design", other: "Other",
};

/** A file's kind by its name: a screenshot by its name and extension first, then the table, else "other". */
export function fileKindOf(name: string): FileKindName {
  const n = String(name ?? "").trim().toLowerCase();
  const dot = n.lastIndexOf(".");
  const ext = dot > 0 ? n.slice(dot + 1) : "";
  if (SCREENSHOT_EXT.includes(ext) && SCREENSHOT_PREFIXES.some((p) => n.startsWith(p))) return "screenshot";
  for (const [kind, exts] of Object.entries(FILE_KIND_EXT)) if (exts.includes(ext)) return kind as FileKindName;
  return "other";
}

// ---- Web pages the front desk opens (contract C.2; the Mac's open.rs front_url_ok) -------------------------------------------

const redirects = (v: string) => { const l = v.trim().toLowerCase(); return l.startsWith("http:") || l.startsWith("https:") || l.startsWith("//") || l.startsWith("www.") || l.includes("://"); };
const decodeSafe = (p: string) => { try { return decodeURIComponent(p); } catch { return p; } };
const extOf = (name: string) => { const n = name.toLowerCase(); const d = n.lastIndexOf("."); return d > 0 ? n.slice(d + 1) : ""; };

/**
 * A web page the front desk may open (owner brief, 12 October 2026: "Go to stripe.com … opens"): phase 3's rules
 * (`cleanOpenUrl`) with two changes, banking and payment hints no longer refuse, and the 170-character "shown whole" cap
 * goes (there is no yes line any more). Kept: https or http only (a bare host gets https://), at most 2,000 characters,
 * no user name or password, a host, no control characters, the last path segment not something that runs, a secret or
 * a password export, and no query or fragment value that is another address. The URL as the browser gets it, or null.
 */
export function frontUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.trim();
  if (!s || s.length > 2_000 || /[\u0000-\u0020\u007f-\u009f\u2028\u2029]/.test(s)) return null;
  // A bare host ("stripe.com", "stripe.com/pricing"): the matcher and the router add https://.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) {
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d{1,5})?(\/\S*)?$/i.test(s)) return null;
    s = `https://${s}`;
  }
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password || !u.hostname) return null;
  const path = decodeSafe(u.pathname).toLowerCase();
  const last = path.split("/").filter(Boolean).pop() ?? "";
  if (last && neverOpenName(last)) return null;
  const href = u.toString();
  if (href.length > 2_000) return null;
  const parts = [...u.searchParams.entries()].flatMap(([k, v]) => [k, v]);
  if (u.hash.length > 1) parts.push(decodeSafe(u.hash.slice(1)));
  for (const p of parts) {
    const l = p.toLowerCase();
    if (redirects(l) || l.split(/[/&=?]/).some((seg) => { const t = seg.trim(); return !!t && OPEN_RUNS_EXT.includes(extOf(t)); })) return null;
  }
  return href;
}

/** "stripe.com": what a line says about a page (the host without "www."). */
export function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./i, ""); } catch { return ""; }
}

// ---- The fixed doing and done lines (contract S.1) ---------------------------------------------------------------------------

/**
 * Every line the Mac says for a direct action; `{x}`/`{y}` a name, `{n}` a number. The server's speech offer
 * (`POST /assistant/front/line`) accepts exactly these, so a clip is only ever made of the fixed words and a name.
 */
export const FRONT_LINES = {
  doing: [
    "Opening {x}.", "Looking for {x}.", "Showing {x} in Finder.", "Switching to {x}.", "Hiding {x}.", "Hiding the others.", "Hiding everything.",
    "Showing everything.", "Minimising {x}.", "Making {x} fill the screen.", "Putting {x} on the left.", "Putting {x} on the right.",
    "Putting {x} and {y} side by side.", "Quitting {x}.", "Volume up.", "Volume down.", "Volume {n} percent.", "Muted.", "Sound's back on.",
    "Taking a screenshot.", "Copying that.", "Typing it.", "Turning Wi-Fi on.", "Turning Wi-Fi off.", "Emptying the Trash.", "Let me look properly.", "One moment.",
    // Owner report, 28 October 2026: tabs, pages in a browser, searches.
    "Opening a new tab.", "Opening a new window.", "Opening a new tab in {x}.", "Opening a new window in {x}.", "Opening {x} in {y}.",
    "Searching Google for {x}.", "Searching Google for {x} in {y}.",
  ],
  done: [
    "Opened {x}.", "Showed {x} in Finder.", "Found {n} files.", "Found one file.", "Switched to {x}.", "Hid {x}.", "Hid the other apps.", "Hid everything.",
    "Everything's back.", "Minimised {x}.", "{x} fills the screen.", "{x} is on the left.", "{x} is on the right.", "{x} and {y} are side by side.",
    "Quit {x}.", "{x} is asking about unsaved work.", "Screenshot saved to your Desktop.", "Copied.", "Typed it.", "Wi-Fi is on.", "Wi-Fi is off.",
    "The Trash is empty.", "Done.", "Okay, I won't.", "Okay, I won't click for you.", "Okay, I left them where they are.",
    // Owner report, 28 October 2026: "a new tab" only when the keys went; otherwise the page it opened ("Opened {x} in {y}.").
    "Opened a new tab in {x}.", "Opened a new window in {x}.", "Opened {x} in {y}.", "Searched Google for {x}.", "Searched Google for {x} in {y}.",
  ],
} as const;

const NAME_PART = "[\\p{L}\\p{N}.,'&+()_-](?:[\\p{L}\\p{N} .,'&+()_-]{0,58}[\\p{L}\\p{N}.,'&+()_-])?";
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const LINE_RES: { re: RegExp; n: [number, number] | null }[] = [...FRONT_LINES.doing, ...FRONT_LINES.done].map((line) => {
  const n: [number, number] | null = line.includes("{n}") ? (line.startsWith("Volume") ? [0, 100] : [2, 999]) : null;
  const re = new RegExp(`^${escapeRe(line).replace(/\\\{x\\\}|\\\{y\\\}/g, `(?:${NAME_PART})`).replace(/\\\{n\\\}/g, "(\\d{1,3})")}$`, "u");
  return { re, n };
});

/** Whether `text` is one of the fixed lines with a plain name and an in-range number (S.1). */
export function frontLineOk(text: unknown): boolean {
  if (typeof text !== "string" || !text || text.length > FRONT_LIMITS.lineChars) return false;
  // One line, one sentence: a name never carries a sentence break ("Opening Figma. Then I'll …").
  if (/[.!?]\s/.test(text.slice(0, -1))) return false;
  for (const { re, n } of LINE_RES) {
    const m = re.exec(text);
    if (!m) continue;
    if (!n) return true;
    const v = Number(m[1]);
    if (Number.isInteger(v) && v >= n[0] && v <= n[1] && String(v) === m[1]) return true;
  }
  return false;
}

// ---- Think harder (contract J.2) ---------------------------------------------------------------------------------------------

/** Whole words and phrases that send a screen question straight to the stronger model. */
export const THINK_WORDS = {
  // "airamine", "aramean": how the Mac's recogniser has heard "error mean" (review, 16 October 2026).
  words: ["error", "errors", "mean", "means", "meaning", "explain", "why", "wrong", "broken", "bug", "warning", "crash", "crashed", "failed", "fails", "airamine", "aramean"],
  phrases: ["read this", "summarise this", "summarize this", "check this", "review this", "proofread", "calculate", "translate", "is this right", "is this correct"],
} as const;

/** "think" when the words are about errors, meaning, careful reading or checking; else "now". */
export function thinkLane(text: unknown): "think" | "now" {
  const t = ` ${String(text ?? "").normalize("NFKC").toLowerCase().replace(/[‘’]/g, "'").replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim()} `;
  if (THINK_WORDS.words.some((w) => t.includes(` ${w} `))) return "think";
  if (THINK_WORDS.phrases.some((p) => t.includes(` ${p} `))) return "think";
  return "now";
}

// ---- Words (contract O.3, S.5, S.6) --------------------------------------------------------------------------------------------

export const THINK_LINE = "Let me look properly.";

export const FRONT_WORDS = {
  errors: {
    notReady: "This needs a database update first.",
    desktopOnly: "Brenda does things on your Mac only from Brenda for Mac.",
    impersonated: "Brenda doesn't do things on the Mac while someone else is signed in as you.",
    invalid: "That request couldn't be read.",
    stale: "That took too long to reach me. Ask me again.",
    replay: "I've already done that one.",
    noCredit: "Boredroom's AI account has run out of credit. Simple things like “open Figma” still work.",
    busy: "Claude is busy just now. Try again in a moment.",
    failed: "I couldn't reach Claude just now. Try again in a moment.",
    jobBusy: "I'm still on the last job. Wait for it to finish, or stop it in the notch.",
    jobToken: "That waited too long, so I didn't start it. Ask me again.",
    jobConsent: "I need your go-ahead to click and type for you first.",
    jobLive: "Stop it first.",
    jobCall: "That step couldn't be read, so I stopped.",
    jobNotFound: "That job is gone.",
    jobEnded: "That job has already ended.",
    tooLarge: "That got too big to send, so I stopped. What I did so far stays done.",
  },
  /** When a request is refused (S.5): title and sub, by reason. */
  refused: {
    bad_url: { title: "I can't open that address", sub: "Only ordinary web pages, never downloads of apps or scripts." },
    // Owner report, 28 October 2026: a page, a tab or a search goes only to a web browser.
    not_browser: { title: "That isn't a web browser", sub: "I open pages, tabs and searches only in a browser, like Safari, Chrome or Brave." },
    secret: { title: "I don't open that file", sub: "It looks like a password or key file." },
    installer: { title: "I never open that kind of file", sub: "It's an installer, a disk image, a certificate, a script or a link file." },
    own: { title: "I can't quit myself", sub: "Use Quit Brenda in the menu bar." },
    finder: { title: "Finder always stays open", sub: "" },
    never_look: { title: "I don't work in that app", sub: "It's one of the apps I never look at or work in." },
    other: { title: "I couldn't do that", sub: "" },
  } as Readonly<Record<string, { title: string; sub: string }>>,
  /** The router's own answers. */
  router: {
    unclear: "I didn't catch what to do. Say it another way?",
    refusal: "I can't help with that one.",
    useScreen: "I'll need to see your screen for that. Press Use my screen below.",
  },
  /** A job's first line (S.6 doing line) and the job's sentence. */
  jobPlan: (title: string) => `I'll ${title.charAt(0).toLowerCase()}${title.slice(1).replace(/[.!]+$/, "")}.`,
} as const;

/** The refusal line's words for a never-class reason. */
export function refusedWords(reason: string): { title: string; sub: string; message: string } {
  const w = FRONT_WORDS.refused[reason] ?? FRONT_WORDS.refused.other;
  return { ...w, message: [w.title, w.sub].filter(Boolean).join(". ").replace(/\.\.$/, ".") + (w.sub ? "" : ".") };
}
