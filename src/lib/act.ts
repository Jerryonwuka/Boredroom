/**
 * Brenda for Mac, phase 2: doing things on the person's Mac, only when they ask and say yes (owner request and permission
 * rule, 12 October 2026: "Brenda cannot take any action except I explicitly give an instruction … if it's a core task,
 * Brenda should confirm, do you want me to do this? And then I'll say, yes, I need you to do this").
 *
 * What the server, the web pages and the tests share (contract section 0, D.7 to D.11, D.16, E.6): the yes grammar (the
 * same rules and vectors as the Mac's own yes.rs), the plan's checks, the fixed question, the apps Brenda never works in
 * (FIXED_NO_ACT, the same table as the Mac's guard.rs), the shortcuts that need their own yes, the limits, how a task
 * counts against the daily limit, how a task reads in the person's Activity, the canonical JSON the transcript hash is
 * taken over, and every fixed word the routes answer with. It imports only lib/screen-help (which imports only zod), so
 * client components can use it.
 */
import { FIXED_NEVER_LOOK, neverLookMatch } from "@/lib/screen-help";

// ---- Limits (contract 0b, D.7 to D.10) ---------------------------------------------------------------------------------------

export const ACT_LIMITS = {
  /** Model calls per screen task (0b.8). */
  stepCap: 20,
  /** How long a proposal waits for the person's answer on the server (the Mac waits 60 s; 15 s for the network). */
  answerSeconds: 75,
  /** Wall clock from the yes. */
  screenMinutes: 10,
  fileMinutes: 5,
  /** A look request's words must be this fresh when they propose a task. */
  requestAgeMs: 30_000,
  /** Every act request body. */
  bodyBytes: 4_000_000,
  /** Actions in one model turn. */
  maxActions: 8,
  typeChars: 2_000,
  keyChars: 64,
  scrollMax: 20,
  waitSeconds: 10,
  /** The plan: one sentence. */
  planMin: 12,
  planMax: 200,
  request: 4_000,
  confirmText: 200,
  /** An ask_before step. */
  what: 160,
  reason: 300,
  summary: 500,
  resultText: 2_000,
  /** A step screenshot (decoded bytes and each edge). */
  stepImageBytes: 262_144,
  stepImageEdge: 2_000,
  /** Extra model calls inside one step request when a turn is refused (D.8.5). */
  extraCalls: 2,
  /** The gap between two steps of one task. */
  stepGapMs: 500,
  /** A step claim older than this may be taken again (the Mac retried after a dropped answer). */
  claimSeconds: 120,
  /** Ended rows stay this long in the person's Activity (0b.15). */
  keepDays: 30,
  /** The file job (D.9). */
  fileTextChars: 400_000,
  fileBytes: 2_621_440,
  contentChars: 200_000,
  outputName: 120,
  fileName: 255,
  filesPerLook: 10,
  // Phase 3 (owner report and requests, 12 October 2026; contract G.3): plans, opening things and folder work.
  /** A plan's steps, and how many of each (0b.8). */
  planSteps: 6,
  planOpens: 3,
  planChanges: 4,
  /** Search words of an open or folder step. */
  words: 6,
  wordChars: 40,
  urlChars: 2_000,
  /** The longest address a line shows whole (review, 12 October 2026: the yes covers everything that opens). */
  urlShown: 170,
  appName: 80,
  goalMin: 8,
  goalMax: 200,
  jobMin: 3,
  jobMax: 120,
  sinceDaysMax: 3_650,
  /** The lines under a plan's sentence. */
  lines: 8,
  lineChars: 200,
  /** A folder job (0b.7). */
  folderFiles: 25,
  folderBytes: 104_857_600,
  folderFileText: 200_000,
  folderText: 1_000_000,
  sectionChars: 12_000,
  sectionsChars: 300_000,
  /** A plan's wall clock when it reads files (10 minutes otherwise: screenMinutes). */
  planMinutes: 15,
  scopeBody: 64_000,
  setupFreshMinutes: 15,
  /** A prepared Boredroom change must have this long left on its Confirm token to join a plan. */
  changeMinutesLeft: 10,
  /** A folder job's request bodies. */
  folderFileBody: 4_000_000,
  folderFinishBody: 2_000_000,
} as const;

/** The fixed question after every proposal and every outward step (contract 0.1, A.6). */
export const ACT_QUESTION = "Do you want me to do this?";

// ---- Kinds and shapes --------------------------------------------------------------------------------------------------------

// "job" (Brenda and her helpers, owner brief 12 October 2026; migration 0060): a background job (the Files helper or the
// Mac operator), started by the person's recorded request; "paused" while their Mac sleeps.
export const ACT_KINDS = ["screen", "file", "plan", "job"] as const;
export type ActKind = (typeof ACT_KINDS)[number];
export const FILE_SOURCES = ["pointer", "front_document", "finder_selection", "dropped"] as const;
export type FileSource = (typeof FILE_SOURCES)[number];
export const OUTPUT_FORMATS = ["md", "txt", "csv", "docx", "pdf", "doc"] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];
/** The kinds a file can be read as on the Mac (B.9.2). */
export const FILE_KINDS = ["text", "pdf", "word", "spreadsheet", "image", "other"] as const;
export type FileKind = (typeof FILE_KINDS)[number];
export const TASK_STATUSES = ["proposed", "running", "asking", "paused", "done", "stopped", "said_no", "expired", "failed"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const END_REASONS = ["done", "stopped", "said_no", "unclear", "expired", "cap", "time", "size", "limit", "failed", "cannot", "unresolved"] as const;
export type EndReason = (typeof END_REASONS)[number];
export const CONFIRM_VIAS = ["button", "voice", "typed"] as const;
export type ConfirmVia = (typeof CONFIRM_VIAS)[number];
/** How a no can arrive (D.7.2): the three ways of a yes, plus the Mac's own ends of a proposal. */
export const NO_VIAS = ["button", "voice", "typed", "timeout", "esc", "unresolved"] as const;
export type NoVia = (typeof NO_VIAS)[number];
export const STOP_WHYS = ["esc", "keys", "talk_keys", "button", "tray", "locked", "signout", "quit", "call", "share", "display", "paused_timeout", "offline", "too_big", "time", "busy"] as const;
export type StopWhy = (typeof STOP_WHYS)[number];
export const ASK_KINDS = ["send", "submit", "delete", "pay", "share", "publish", "sign_in", "accept_terms", "overwrite", "quit", "other"] as const;
export type AskKind = (typeof ASK_KINDS)[number];

/** What a proposal looks like on the Mac (contract B.6.1). A plan is a TaskViewV2. */
export type TaskView = {
  id: string;
  kind: Exclude<ActKind, "plan">;
  plan: string;
  question: typeof ACT_QUESTION;
  planSha256: string;
  answerBy: string;
  risky: boolean;
  stepCap: number;
  file: { source: FileSource; name: string } | null;
  output: { format: OutputFormat; name: string } | null;
};

/** A step that needs its own yes (contract D.7.3). */
export type StepAsk = { kind: AskKind; what: string; question: string; because: string };

/** Why each kind of outward step waits (contract A.7.3). */
export const BECAUSE: Readonly<Record<AskKind, string>> = Object.freeze({
  send: "this sends something",
  submit: "this submits a form",
  delete: "this deletes something",
  pay: "this pays for something",
  share: "this shares something",
  publish: "this publishes something",
  sign_in: "this signs in",
  accept_terms: "this accepts terms",
  overwrite: "this replaces a file",
  quit: "this quits an app",
  other: "this can't be undone",
});

export const stepQuestion = (what: string) => `Next I'll ${what}. ${ACT_QUESTION}`;

// ---- The yes grammar (contract 0.5; identical in desktop/src-tauri/src/yes.rs) -----------------------------------------------

export type Verdict = "yes" | "no" | "unclear";

const YES_WORDS = new Set(["yes", "yeah", "yep", "yup", "sure", "ok", "okay", "alright", "correct", "absolutely", "definitely", "certainly"]);
const TAILS: readonly string[][] = [
  "do it", "do that", "do this", "go ahead", "go for it", "go on", "carry on", "continue", "proceed", "please do", "please do it",
  "i need you to do this", "i need you to do that", "i need you to do it", "i want you to do this", "i want you to do that",
  "i want you to do it", "thats right", "thats fine",
  // Review, 12 October 2026: everyday yeses that were refused.
  "go", "you can do it", "you can do that", "you can do this", "you can go ahead", "you can",
].map((t) => t.split(" "));
const THANKS: readonly string[][] = [["please"], ["thanks"], ["thank", "you"]];
/** "now" may close a yes ("yes, do it now"), before any thanks. */
const NOW: readonly string[][] = [["now"], ["right", "now"]];
const NO_FIRST = new Set(["no", "nope", "nah", "dont", "stop", "cancel", "never"]);
const NO_PHRASES = new Set(["not now", "never mind", "leave it", "no thanks", "no thank you", "not yet", "dont do it", "dont"]);
// "and" is not here: the grammar allows it only between two TAIL phrases ("go ahead and do it"), so "yes and also rename the
// folder" still fails (review, 12 October 2026).
const BLOCK = new Set(["no", "nope", "nah", "not", "dont", "never", "stop", "wait", "cancel", "hold", "hang", "but", "except", "instead", "actually", "only",
  "first", "before", "after", "rather", "change", "different", "wrong", "maybe", "later", "if", "unless", "or", "why", "what", "how", "which", "who", "where", "when"]);
const FILLERS = new Set(["um", "uh", "er", "erm", "hmm", "so", "well", "oh"]);

/** Steps 1 and 3 of the grammar, and step 5's two spellings: the words as tokens. */
export function yesTokens(text: string): string[] {
  const s = String(text ?? "").normalize("NFKC").toLowerCase().replace(/[‘’‛′]/g, "'").replace(/[“”‟″]/g, "\"");
  return s.replace(/[^a-z0-9' ]/g, " ").replace(/\s+/g, " ").trim().split(" ").filter(Boolean)
    .map((t) => (t === "don't" ? "dont" : t === "that's" ? "thats" : t));
}

const startsWith = (tokens: string[], at: number, phrase: readonly string[]) => phrase.length > 0 && phrase.every((p, i) => tokens[at + i] === p);

/** Every end position reachable from `at` by one of `phrases`, or by none of them when optional. */
function after(tokens: string[], at: number, phrases: readonly (readonly string[])[], optional: boolean): number[] {
  const out = optional ? [at] : [];
  for (const p of phrases) if (startsWith(tokens, at, p)) out.push(at + p.length);
  return out;
}

/**
 * Step 9: YES_WORD+ ["please"] [TAIL [["and"] TAIL]] ["now"] [THANKS], or ["please"] TAIL [["and"] TAIL] ["now"] [THANKS],
 * covering every token.
 */
function matchesYes(tokens: string[]): boolean {
  const n = tokens.length;
  const ends = (starts: number[], phrases: readonly (readonly string[])[], optional: boolean) => [...new Set(starts.flatMap((s) => after(tokens, s, phrases, optional)))];
  // One or two TAIL phrases, "and" only between them.
  const tails = (starts: number[], optional: boolean) => {
    const one = ends(starts, TAILS, false);
    const two = ends(ends(one, [["and"]], true), TAILS, false);
    return [...new Set([...(optional ? starts : []), ...one, ...two])];
  };
  // Form A.
  let yes = 0;
  while (yes < n && YES_WORDS.has(tokens[yes])) yes++;
  if (yes > 0) {
    // Any split of the leading yes words is fine: YES_WORD+ is at least one of them.
    const starts: number[] = [];
    for (let k = 1; k <= yes; k++) starts.push(k);
    const a = ends(ends(tails(ends(starts, [["please"]], true), true), NOW, true), THANKS, true);
    if (a.includes(n)) return true;
  }
  // Form B.
  const b = ends(ends(tails(ends([0], [["please"]], true), false), NOW, true), THANKS, true);
  return b.includes(n);
}

/** Steps 1 to 5: the tokens with her name (all its words, in order), "brenda" and "hey" taken out wherever they stand, and fillers off both ends. */
function answerTokens(raw: string, assistantName?: string | null): string[] {
  const all = yesTokens(raw);
  const nameTokens = yesTokens(assistantName ?? "");
  const t: string[] = [];
  for (let i = 0; i < all.length;) {
    if (nameTokens.length && startsWith(all, i, nameTokens)) { i += nameTokens.length; continue; }
    if (all[i] === "brenda" || all[i] === "hey") { i++; continue; }
    t.push(all[i]);
    i++;
  }
  while (t.length && FILLERS.has(t[0])) t.shift();
  while (t.length && FILLERS.has(t[t.length - 1])) t.pop();
  return t;
}

/**
 * Whether the person's words are a clear yes to the question they were asked (contract 0.5). Anything that is not a
 * clear yes is treated as no by every caller: "unclear" never starts anything.
 */
export function verdict(text: string, assistantName?: string | null): Verdict {
  const raw = String(text ?? "").normalize("NFKC");
  if (raw.includes("?") || raw.includes("？")) return "unclear";
  // Steps 4 and 5: her name is a form of address wherever it stands ("Yes, Brenda"; review, 12 October 2026).
  const t = answerTokens(raw, assistantName);
  if (!t.length || t.length > 10) return "unclear";
  if (NO_PHRASES.has(t.join(" ")) || NO_FIRST.has(t[0])) return "no";
  if (t.some((w) => BLOCK.has(w))) return "unclear";
  return matchesYes(t) ? "yes" : "unclear";
}

/**
 * Whether an unclear answer is a new request (contract 0.5; the same rule as yes.rs `is_new_request`): four or more words
 * that do not start with a no and are not a yes the grammar missed (review, 12 October 2026). A no is a no: nothing
 * happens and nothing new is looked at.
 */
export function isNewRequest(text: string, assistantName?: string | null): boolean {
  const t = answerTokens(String(text ?? "").normalize("NFKC"), assistantName);
  if (!t.length) return false;
  if (NO_FIRST.has(t[0]) || [...NO_PHRASES].some((p) => startsWith(t, 0, p.split(" ")))) return false;
  if (YES_WORDS.has(t[0]) && !t.some((w) => BLOCK.has(w))) return false;
  return t.length >= 4;
}

// ---- Is it an instruction? (permission rule a; review, 12 October 2026) ----------------------------------------------------------

/** Verbs of doing something on a Mac or with a file (their stems; "summarised", "renaming" and "renames" match too). */
const ACTION_VERBS = [
  "rename", "move", "copy", "duplicate", "delete", "remove", "trash", "organise", "organize", "sort", "tidy", "clean", "arrange", "group", "file", "archive",
  "make", "create", "write", "draft", "compose", "rewrite", "redraft", "shorten", "expand", "edit", "fix", "correct", "proofread", "format", "reformat",
  "summarise", "summarize", "translate", "convert", "turn", "transcribe", "extract", "pull", "list", "compile", "collect", "gather", "combine", "merge", "split",
  "save", "export", "import", "print", "fill", "type", "enter", "click", "press", "tap", "select", "drag", "drop", "scroll", "open", "close", "quit",
  "send", "reply", "forward", "email", "message", "post", "publish", "share", "upload", "download", "attach", "submit", "book", "schedule", "add", "put",
  "insert", "replace", "change", "update", "set", "mark", "tag", "label", "highlight", "bold", "underline", "number", "resize", "crop", "rotate", "compress",
  "zip", "unzip", "prepare", "generate", "produce", "build", "do", "handle", "finish", "complete", "finalise", "finalize", "redo", "undo", "go", "navigate",
  "search", "find", "bookmark", "download", "reorder", "rearrange", "check", "tick", "untick", "uncheck", "pay", "buy", "order", "sign", "accept", "approve",
  // Phase 3 (owner request, 12 October 2026: "Brenda is meant to assist you do anything you need it to do"; contract D.7).
  "help", "assist", "launch", "start", "show", "play", "read", "review", "remind", "get", "fetch", "grab", "bring", "load",
  // Brenda and her helpers (owner brief, 12 October 2026; contract B.3): the front desk's verbs, the same on the Mac (intent.rs).
  "hide", "unhide", "minimise", "minimize", "maximise", "maximize", "switch", "mute", "unmute", "empty", "take", "capture", "screenshot", "paste",
  "tile", "raise", "lower", "increase", "decrease", "pause", "resume", "skip",
  // Review, 16 October 2026: "volume down a bit" read as a question; now it goes to the router (the same in intent.rs).
  "volume",
];
/** Two-word verbs of doing (phase 3, contract D.7): "look through my documents", "look over this folder". */
const ACTION_PAIRS: readonly [string, string][] = [["look", "through"], ["look", "over"], ["sort", "through"]];
const pairAt = (t: string[], i: number) => ACTION_PAIRS.some(([a, b]) => t[i] === a && t[i + 1] === b);
/** Phrases that ask someone to do something ("can you", "I need you to", "please"). */
const REQUEST_MARKERS = [
  "can you", "could you", "would you", "will you", "can u", "please", "i need you", "i want you", "id like you", "i would like you", "i'd like you",
  "help me", "lets", "let's", "go ahead and", "make sure", "i need", "i want", "id like", "i would like", "for me",
];

function verbStemAt(word: string): boolean {
  const w = word.replace(/'/g, "");
  return ACTION_VERBS.some((v) => w === v || w === `${v}s` || w === `${v}d` || w === `${v}ed` || w === `${v}ing` || (v.endsWith("e") && (w === `${v.slice(0, -1)}ing` || w === `${v}d`))
    || (/[^aeiou][aeiou][bdglmnprt]$/.test(v) && (w === `${v}${v.slice(-1)}ed` || w === `${v}${v.slice(-1)}ing`)));
}

/** Words a question starts with ("what does this say", "is this a PDF"); "do" only before a person ("do you know…"). */
const QUESTION_START = new Set(["what", "whats", "why", "how", "who", "whos", "where", "wheres", "when", "which", "whose", "is", "isnt", "are", "arent", "was", "were",
  "does", "doesnt", "did", "didnt", "am", "has", "hasnt", "have", "havent", "should", "shall"]);
const PEOPLE = new Set(["you", "u", "i", "we", "they", "it", "he", "she"]);
/** Set aside before reading: fillers and openers that carry no meaning of their own. */
const OPENERS = new Set(["brenda", "hey", "ok", "okay", "so", "now", "just", "um", "uh", "er", "erm", "hmm", "well", "oh", "right", "alright", "and", "then"]);

/**
 * Whether the person's own words ask Brenda to DO something (permission rule a: "Brenda cannot take any action except I
 * explicitly give an instruction"): an imperative ("Rename these files", "Brenda, summarise this PDF"), or a request form
 * ("can you…", "I need you to…", "please…"), with a verb of doing. A plain question ("what does this email say?", "how do
 * I export this?", "do you know what this is?") is not one, so no task is offered for it, whatever the screen or a file
 * says (review, 12 October 2026). Deterministic; it reads only the person's words, never the screen.
 */
export function isInstruction(text: string, assistantName?: string | null): boolean {
  const raw = String(text ?? "").normalize("NFKC").toLowerCase().replace(/[‘’‛′]/g, "'");
  const all = raw.replace(/[^a-z0-9' ]/g, " ").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const name = yesTokens(assistantName ?? "");
  const t: string[] = [];
  for (let i = 0; i < all.length;) {
    if (name.length && startsWith(all, i, name)) { i += name.length; continue; }
    if (!t.length && OPENERS.has(all[i])) { i++; continue; }
    if (all[i] === "brenda") { i++; continue; }
    t.push(all[i]);
    i++;
  }
  const joined = ` ${t.join(" ")} `;
  // "Slack and Figma side by side" asks for windows to be arranged, verb or not (review, 16 October 2026; intent.rs too).
  const sideBySide = joined.includes(" side by side ");
  if (!t.length || !(t.some(verbStemAt) || t.some((_, i) => pairAt(t, i)) || sideBySide)) return false;
  const asks = REQUEST_MARKERS.some((m) => joined.includes(` ${m} `));
  // A question ("what…", "is…", "do you…") is an instruction only in a request form ("what can you…" is not one).
  if (QUESTION_START.has(t[0]) || (t[0] === "do" && PEOPLE.has(t[1] ?? ""))) return false;
  if (asks) return true;
  // A question mark with no request form: a question.
  if (/[?？]/.test(raw)) return false;
  // An imperative: one of the first three words is a verb of doing ("rename these", "right, rename these").
  return sideBySide || t.slice(0, 3).some((w, i) => ACTION_VERBS.includes(w.replace(/'/g, "")) || pairAt(t, i));
}

// ---- The plan (contract 0.4) ---------------------------------------------------------------------------------------------------

/**
 * The model's plan as it is shown and hashed, or null when it is not one: one sentence of 12 to 200 characters starting
 * "I'll ", no line breaks, no links, no question mark; any "Do you want me…" the model wrote is removed first, and a
 * full stop is added when the sentence has no ending of its own.
 */
export function cleanPlan(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.normalize("NFC").replace(/[‘’]/g, "'").trim();
  s = s.replace(/\s*do you want me\b[\s\S]*$/i, "").trim();
  if (!s) return null;
  if (/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(s)) return null;
  if (/[?？]/.test(s)) return null;
  if (/:\/\/|\bwww\.|\bmailto:|\]\(/i.test(s)) return null;
  if (!s.startsWith("I'll ")) return null;
  if (!/[.!…]$/.test(s)) s = `${s}.`;
  // One sentence: no sentence end followed by a new sentence inside it ("… files. Then I'll …").
  if (/[.!…]\s+["“(]?[A-Z]/.test(s.slice(0, -1))) return null;
  if (s.length < ACT_LIMITS.planMin || s.length > ACT_LIMITS.planMax) return null;
  return s;
}

// ---- Output names (contract D.7.1) -------------------------------------------------------------------------------------------

const EXT: Readonly<Record<Exclude<OutputFormat, "doc">, string>> = { md: ".md", txt: ".txt", csv: ".csv", docx: ".docx", pdf: ".pdf" };
const BAD_NAME = /[/\\:\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

/** The output's file name (or, for a Boredroom document, its title): the model's when it is plain, else "<stem> (Brenda summary).<ext>". */
export function outputNameOf(fileName: string, outputName: string, format: OutputFormat): string {
  const want = String(outputName ?? "").replace(/\s+/g, " ").trim();
  if (format === "doc") {
    if (want && want.length <= ACT_LIMITS.outputName && !BAD_NAME.test(want) && !want.startsWith(".")) return want;
  } else if (want && want.length <= ACT_LIMITS.outputName && !BAD_NAME.test(want) && !want.startsWith(".") && want.toLowerCase().endsWith(EXT[format]) && want.length > EXT[format].length) {
    return want;
  }
  const base = String(fileName ?? "").replace(/\s+/g, " ").trim().replace(/[/\\:\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, "");
  const dot = base.lastIndexOf(".");
  const stem0 = (dot > 0 ? base.slice(0, dot) : base).trim() || "File";
  const suffix = ` (Brenda summary)${format === "doc" ? "" : EXT[format]}`;
  const stem = stem0.length + suffix.length > ACT_LIMITS.outputName ? stem0.slice(0, ACT_LIMITS.outputName - suffix.length).trimEnd() : stem0;
  return `${stem.replace(/^\.+/, "") || "File"}${suffix}`;
}

// ---- Where Brenda never works (contract B.7, the same table as guard.rs) ------------------------------------------------------

/** Apps beyond the never-look list that Brenda never works in, by bundle id (best known; confirm installed ones with mdls). */
export const NO_ACT_EXTRA: readonly { name: string; bundleId: string }[] = [
  { name: "Terminal", bundleId: "com.apple.Terminal" },
  { name: "iTerm", bundleId: "com.googlecode.iterm2" },
  { name: "Warp", bundleId: "dev.warp.Warp-Stable" },
  { name: "Ghostty", bundleId: "com.mitchellh.ghostty" },
  { name: "Alacritty", bundleId: "org.alacritty" },
  { name: "kitty", bundleId: "net.kovidgoyal.kitty" },
  { name: "Script Editor", bundleId: "com.apple.ScriptEditor2" },
  { name: "Automator", bundleId: "com.apple.Automator" },
  { name: "Shortcuts", bundleId: "com.apple.shortcuts" },
  { name: "Activity Monitor", bundleId: "com.apple.ActivityMonitor" },
  { name: "Disk Utility", bundleId: "com.apple.DiskUtility" },
  { name: "Installer", bundleId: "com.apple.installer" },
  { name: "Migration Assistant", bundleId: "com.apple.MigrateAssistant" },
  // Launchers that type into themselves while another app stays in front (review, 12 October 2026).
  { name: "Spotlight", bundleId: "com.apple.Spotlight" },
  { name: "Raycast", bundleId: "com.raycast.macos" },
  { name: "Alfred", bundleId: "com.runningwithcrayons.Alfred" },
  { name: "Alfred 3", bundleId: "com.runningwithcrayons.Alfred-3" },
  { name: "Alfred Preferences", bundleId: "com.runningwithcrayons.Alfred-Preferences" },
  { name: "LaunchBar", bundleId: "at.obdev.LaunchBar" },
  { name: "System Events", bundleId: "com.apple.SystemEvents" },
  { name: "Script Menu", bundleId: "com.apple.ScriptMenuApp" },
];

/** Every bundle id of FIXED_NO_ACT: the fixed never-look list's, then the extra ones. */
export const FIXED_NO_ACT: readonly string[] = [...FIXED_NEVER_LOOK.flatMap((f) => f.bundleIds), ...NO_ACT_EXTRA.map((a) => a.bundleId)];

/** The app's name when Brenda never works in it (the fixed never-look list or NO_ACT_EXTRA), else null. */
export function noActMatch(app: { name: string; bundleId: string | null } | null | undefined): string | null {
  if (!app) return null;
  const fixed = neverLookMatch(app);
  if (fixed) return fixed.name;
  const id = String(app.bundleId ?? "").trim().toLowerCase();
  const name = String(app.name ?? "").trim().toLowerCase();
  const hit = NO_ACT_EXTRA.find((a) => (id && a.bundleId.toLowerCase() === id) || (name && a.name.toLowerCase() === name));
  return hit ? hit.name : null;
}

/** Host or path pieces of banking and payment pages (a heuristic; the consent says so). The same list as guard.rs. */
export const PAYMENT_HINTS: readonly string[] = ["bank", "banking", "paypal", "checkout", "/pay", "payment", "billing", "wallet", "stripe.com", "revolut", "wise.com", "monzo",
  "starling", "chase.com", "barclays", "hsbc", "lloyds", "natwest", "santander", "wellsfargo", "bankofamerica", "citi.com", "americanexpress", "venmo", "cash.app",
  "coinbase", "binance", "kraken", "flutterwave", "paystack", "opay", "palmpay", "kuda", "gtbank", "zenithbank", "firstbanknigeria", "accessbankplc", "ubagroup",
  "moniepoint", "fidelitybank", "stanbicibtc", "ecobank"];

// ---- Shortcuts that send, delete or quit (contract 0.6 layer 2) ----------------------------------------------------------------

const CMD = new Set(["cmd", "command", "super", "meta", "win", "windows"]);
const SHIFT = new Set(["shift"]);

/**
 * The verb of a `key` action that sends, deletes or quits without its own yes (⌘Return, ⌘Enter, ⌘⇧D, ⌘⌫, ⇧⌘⌫, ⌥⌘⌫,
 * ⌘Q), or null. Read generously: Return or Enter with Command sends, Backspace or Delete with Command deletes, Q with
 * Command quits, whatever other modifiers come with them.
 */
export function shortcutVerb(keyText: unknown): "send" | "delete" | "quit" | null {
  if (typeof keyText !== "string") return null;
  for (const combo of keyText.trim().split(/\s+/)) {
    const parts = combo.toLowerCase().split("+").map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) continue;
    const key = parts[parts.length - 1];
    const mods = parts.slice(0, -1);
    if (!mods.some((m) => CMD.has(m))) continue;
    if (["return", "enter", "kp_enter"].includes(key)) return "send";
    if (["backspace", "delete", "back_space"].includes(key)) return "delete";
    if (key === "q") return "quit";
    if (key === "d" && mods.some((m) => SHIFT.has(m))) return "send";
  }
  return null;
}

// ---- Counting (contract 0b.13, D.10) ------------------------------------------------------------------------------------------

/** Requests a task counts in the person's daily limit: a screen task 1 per 2 steps; a file job 1 per 25,000 tokens (at least 1). */
export function actUnits(kind: ActKind, o: { steps?: number; inputTokens?: number; outputTokens?: number }): number {
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
  if (kind === "screen") return Math.ceil(n(o.steps) / 2);
  // A plan (phase 3, contract D.6): its computer-use steps as a screen task's, plus its file reading as a file job's, when it read any.
  if (kind === "plan") return Math.ceil(n(o.steps) / 2) + (n(o.inputTokens) + n(o.outputTokens) > 0 ? Math.max(1, Math.ceil((n(o.inputTokens) + n(o.outputTokens)) / 25_000)) : 0);
  return Math.max(1, Math.ceil((n(o.inputTokens) + n(o.outputTokens)) / 25_000));
}

// ---- Canonical JSON (contract D.7.3) -------------------------------------------------------------------------------------------

/**
 * JSON with every object's keys sorted (JavaScript's string order), arrays in order and primitives as JSON.stringify
 * writes them: the transcript's hash does not depend on how the Mac re-serialised it.
 */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") {
    const s = JSON.stringify(v);
    return s === undefined ? "null" : s;
  }
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined || typeof x === "function" ? "null" : canonicalJson(x))).join(",")}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => o[k] !== undefined && typeof o[k] !== "function").sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
}

// ---- Activity (contract D.11, E.6) ------------------------------------------------------------------------------------------

type ActRowWords = { end_reason: EndReason | null; plan: string; summary: string | null; live?: boolean; kind?: ActKind };

/** How a task reads in the person's Activity. */
export function actSummary(r: ActRowWords): string {
  if (r.live || !r.end_reason) return `In progress: ${r.plan}`;
  switch (r.end_reason) {
    case "done": return r.summary?.trim() || r.plan;
    case "stopped": case "cap": case "time": case "size": case "limit": return `Stopped: ${r.plan}`;
    case "said_no": return `You said no: ${r.plan}`;
    case "unclear": return `No clear yes: ${r.plan}`;
    case "expired": return `No answer: ${r.plan}`;
    case "unresolved": return r.kind === "plan" ? `Couldn't find it: ${r.plan}` : `File not found: ${r.plan}`;
    case "failed": case "cannot": return `Couldn't finish: ${r.plan}`;
    default: return r.plan;
  }
}

/** Its outcome in the Activity list (live rows read as done-in-progress: the list shows them as "In progress"). */
export function actOutcome(endReason: EndReason | null): "done" | "refused" | "failed" {
  if (!endReason || endReason === "done") return "done";
  if (endReason === "failed" || endReason === "cannot") return "failed";
  return "refused";
}

// ---- Words (contract D.6.6, D.16, E.6) ----------------------------------------------------------------------------------------

/** "“Do things when I ask” is off" or "“Do things when I ask” and “Work on my files” are off". */
function switchesAre(label: string | readonly string[]): string {
  const ls = (typeof label === "string" ? [label] : [...label]).filter(Boolean).map((l) => `“${l}”`);
  return ls.length > 1 ? `${ls.slice(0, -1).join(", ")} and ${ls[ls.length - 1]} are off` : `${ls[0] ?? "a switch"} is off`;
}

export const ACT_WORDS = {
  question: ACT_QUESTION,
  /** What the model is told when a proposal is refused (D.6.6); `name` is the person's assistant. */
  notProposed: {
    macOff: (name: string) => `they haven't turned on “Let ${name} use my Mac”`,
    filesOff: (name: string) => `they haven't turned on “Let ${name} work on files”`,
    busy: "you're still working on another task for them",
    file: "that isn't one of the files you were given",
    app: (app: string) => `you never do things in ${app}`,
    plan: "the sentence must start \"I'll\" and say exactly what you'll do in one sentence",
    switchedOff: "this workspace has switched it off",
    /** Review, 12 October 2026: their words are a question, not an instruction (rule a). */
    notAsked: "they asked a question, not for something to be done",
    unavailable: "it isn't available from here",
    alone: "Not proposed: propose on its own, after anything else.",
    told: (reason: string) => `Not proposed: ${reason}. Tell them in one sentence, and help in words.`,
    // Phase 3 (owner report, 12 October 2026: "it said it can't do that, why?"; contract D.2.4, M.8): never just "I can't".
    forbidden: (app: string) => `you never open ${app}`,
    url: "that address isn't one you open (only ordinary web pages short enough to show them whole, never banking or payment pages, links that pass on to another address, or downloads)",
    installer: "you never open installers, updaters or apps that erase",
    folder: "that isn't a folder they named or pointed at",
    change: "that change wasn't prepared in this reply, or can't be part of a plan",
    /** Review, 12 October 2026: a change whose words don't fit whole in one line keeps its own Confirm card. */
    changeLong: (n: number) => `Not proposed: change ${n} is too long to show in full in the plan, and every word must be seen before the yes. Call propose_task again without it (it keeps its own Confirm button under your reply), or tell them in one sentence.`,
    steps: "a plan has one to six steps: at most three opens, one screen part, one folder or file job and four Boredroom changes",
    /**
     * A switch that is off on this Mac: the turn's result carries `enable`, and the notch shows a fixed line naming the
     * switch with Turn it on. Review, 12 October 2026: the model named the switch too, so the line said it twice; now it
     * says only what it will do once the switch is on, and leaves naming the switch to the fixed line.
     */
    switchOff: (label: string | readonly string[]) => `Not proposed yet: ${switchesAre(label)} on this Mac, and a line under your reply already says so with a Turn it on button. In one short sentence say only what you'll do once it's on (for example "I'll open Figma as soon as you turn this on."); don't name the switch, don't describe the button, and never say you can't do it. Once it's on you'll ask them about this again.`,
    accessibility: (name: string) => `Not proposed yet: ${name} needs Accessibility on this Mac to click and type, and a line under your reply already says so with an Allow it button. In one short sentence say only what you'll do once it's allowed; don't name the setting, don't describe the button, and never say you can't do it. Then you'll ask them again.`,
  },
  /** The labels of the Mac's switches, as the setup card names them (contract M.1). */
  switches: { mac: "Do things when I ask", files: "Work on my files" } as Readonly<Record<"mac" | "files", string>>,
  /** What scope answers when something can't be found or opened (contract D.3, M.8). */
  scope: {
    appNone: (name: string) => `I couldn't find an app called “${name}” on this Mac.`,
    forbidden: (name: string) => `I don't open ${name}. It's one of the apps I never look at or work in.`,
    quarantined: (name: string) => `I don't open ${name} yet: it came from the internet and hasn't been opened before. Open it once yourself first.`,
    outside: (name: string) => `I only open apps from your Applications folders, and ${name} isn't in one.`,
    fileNone: (where: string) => `I couldn't find anything like that in ${where}.`,
    runs: "That's an installer, a disk image, a certificate, a script or a link file, and I never open those.",
    installer: (name: string) => `I don't open ${name}: it installs, updates or erases things, and I never open those.`,
    fileForbidden: "That file opens in an app I never work in, so I don't open it.",
    denied: (where: string) => `Your Mac hasn't let Brenda into ${where}. Allow it in System Settings › Privacy & Security › Files and Folders, then ask me again.`,
    folderNone: (where: string) => `There's nothing I can read in ${where}.`,
    gone: "I couldn't find that folder.",
    timeout: "That took too long to find on your Mac, so I stopped. Try naming the folder.",
  },
  /** An open step the Mac couldn't do (`Couldn't: …`; contract M.8). */
  progress: { gone: "the thing to open was gone", refused: "macOS wouldn't open it", failed: "it didn't open" } as Readonly<Record<"gone" | "refused" | "failed", string>>,
  errors: {
    desktopOnly: "Brenda does things on your Mac only from Brenda for Mac.",
    impersonated: "Brenda doesn't do things on the Mac while someone else is signed in as you.",
    switchedOff: "Your workspace has switched off on-screen actions and file work.",
    notConfirmed: "I haven't heard a yes for that, so I won't do it.",
    notFound: "That task is gone.",
    ended: "That task has already ended.",
    plan: "That isn't what I asked you about, so I won't do it.",
    stepAsk: "I'm waiting for your answer about the next step.",
    stepStale: "I lost my place in that task, so I stopped.",
    transcript: "That task's steps didn't match, so I stopped it.",
    file: "That isn't the file you said yes to, so I stopped.",
    onCall: "I don't work on your screen during a Boredroom call.",
    expired: "That waited too long, so I won't do it. Ask me again.",
    tooLarge: "This task got too big to send, so I stopped. What I did so far stays done.",
    answer: "I didn't catch a clear yes, so I won't do it.",
    invalid: "That step couldn't be read, so I stopped.",
    stepCap: "That took more steps than I'm allowed, so I stopped.",
    limit: (limit: number, name: string) => `You've used today's ${limit} requests to ${name}, so ${name} can't carry on. Try again tomorrow.`,
    failed: "Claude couldn't be reached just now, so I stopped.",
    notReady: "This needs a database update first.",
    unavailable: "This isn't set up on this Boredroom yet.",
    declined: "Claude declined that step, so I stopped.",
    noStep: "I couldn't get a step I could run, so I stopped.",
    fileFailed: "I couldn't make that file.",
    /** The file job ran out of room (review, 12 October 2026). */
    fileTooLong: "That would be too long for one file. Ask me for part of it, or for something shorter.",
    wait: "One step at a time. Try again in a moment.",
    /** A step whose front app is one Brenda never works in (integration, 12 October 2026: the server checks it too). */
    forbiddenApp: (app: string) => `I never work in ${app}, so I stopped.`,
    // Phase 3 (contract H.3).
    notScoped: "That isn't ready to ask about yet.",
    scoped: "That was already looked up.",
    scope: "What I found couldn't be read, so I won't do it.",
    stepOrder: "That step isn't next, so I stopped.",
    changeExpired: "That change waited too long, so I stopped. Ask me again.",
    /** A Boredroom change in a plan that couldn't be made (the tool's own words follow when it has them). */
    changeFailed: "I couldn't make that change in Boredroom, so I stopped. What I did before that stays done.",
  },
  /** What the step loop tells the model (D.7.4, D.8.5). */
  model: {
    askedYes: (what: string) => `The person said yes to: ${what}. Do exactly that step next, and nothing more.`,
    askedFirst: "Not executed: you asked first; wait for the answer.",
    earlierFailed: "Not executed: an earlier computer action in this turn failed.",
    otherRefused: "Not executed: another action in this turn was refused.",
    tooMany: (max: number) => `Not executed: too many actions in one turn; send at most ${max}.`,
    outward: (verb: string) => `Not executed: this step would ${verb}. Call ask_before first, naming exactly this step.`,
    invalid: "Not executed: that action couldn't be read. Check its inputs against the tool's description.",
    alone: "Call finished (or cannot_continue) alone, after checking with a screenshot.",
    noTool: "I wasn't sure what to do next.",
  },
  /** The person's Activity page (E.6). `name`: their assistant. */
  activity: {
    filter: "On your Mac",
    via: { button: "you pressed Yes", voice: "you said yes", typed: "you typed yes" } as Readonly<Record<ConfirmVia, string>>,
    noAnswer: "no answer",
    inProgress: "in progress",
    onYourMac: "on your Mac",
    forget: "Forget",
    forgetLabel: (summary: string) => `Forget: ${summary}`,
    forgotten: "Forgotten.",
    // Brenda and her helpers (owner brief, 12 October 2026; contract S.9): the request is the record now.
    note: (name: string) => `What you asked ${name} to do on your Mac, and what ${name} did, shows only here, only to you, for 30 days. Pictures, file contents and where your files are are never kept.`,
  },
} as const;

// ---- Phase 3: plans, opening things, folder work (owner report and requests, 12 October 2026; contract B, C, D, G.3) ---------
//
// The owner, 12 October 2026, after trying phase 2: "I wanted Brenda to assist me with some things, like open an app on my
// desktop, and it said it can't do that, why?" and "Brenda is meant to assist you do anything you need it to do". A plan is
// one sentence and up to six steps in order (open, folder, file, screen, boredroom), under one yes; the lines Boredroom writes
// under the sentence say exactly what each step will touch, and the yes is to the sentence and the lines (`planHash`). The
// permission rule is unchanged: nothing happens unless the person asks, hears exactly this, and says yes; a Boredroom change
// that reaches anyone else asks again when the plan reaches it.

export const PLAN_STEP_KINDS = ["open", "folder", "file", "screen", "boredroom"] as const;
export type PlanStepKind = (typeof PLAN_STEP_KINDS)[number];
export const OPEN_TARGETS = ["app", "url", "folder", "file", "recent", "reveal"] as const;
export type OpenTarget = (typeof OPEN_TARGETS)[number];
/** The folders the person can name (contract C.1). */
export const NAMED_FOLDERS = ["home", "desktop", "documents", "downloads", "pictures", "movies", "music"] as const;
export type NamedFolder = (typeof NAMED_FOLDERS)[number];
export const FOLDER_SOURCES = ["named", "front_folder", "finder_selection", "none"] as const;
export type FolderRef = { source: (typeof FOLDER_SOURCES)[number]; name: string };
export const FIND_KINDS = ["pdf", "word", "text", "spreadsheet", "image", "any"] as const;
export type FindKind = (typeof FIND_KINDS)[number];

/** A named folder's title ("Documents"), as in a file name; the home folder's is "Home". */
export const FOLDER_TITLES: Readonly<Record<NamedFolder, string>> = { home: "Home", desktop: "Desktop", documents: "Documents", downloads: "Downloads", pictures: "Pictures", movies: "Movies", music: "Music" };

/** A plan step as the Mac sees it (contract H.2.1): never a Confirm token. */
export type PlanStepView =
  | { i: number; kind: "open"; target: OpenTarget; name: string; url: string; folder: FolderRef; words: string[]; kinds: FindKind[]; sinceDays: number }
  | { i: number; kind: "folder"; folder: FolderRef; kinds: FindKind[]; recursive: boolean; sinceDays: number; words: string[]; perFile: boolean; job: string; output: { format: OutputFormat; name: string } }
  | { i: number; kind: "file"; file: { source: FileSource; name: string }; output: { format: OutputFormat; name: string } }
  | { i: number; kind: "screen"; goal: string }
  | { i: number; kind: "boredroom"; summary: string; outward: boolean };

/** A plan step as the server keeps it (contract D.2.5): a Boredroom change also has its tool, its Confirm token and its ask. */
export type PlanStep = Exclude<PlanStepView, { kind: "boredroom" }>
  | { i: number; kind: "boredroom"; tool: string; token: string; summary: string; readback: { to: string[]; what?: string } | null; outward: boolean; askKind: AskKind };

/** A plan as the Mac sees it (contract H.2.1). `planSha256` is "" and `lines` null until the scope came back. */
export type TaskViewV2 = {
  id: string; kind: "plan"; v: 2; plan: string; question: typeof ACT_QUESTION; planSha256: string; answerBy: string; risky: boolean; stepCap: number;
  needsScope: boolean; lines: string[] | null; file: null; output: null; steps: PlanStepView[];
};

/** What Brenda for Mac found for a step before asking (contract H.2.2): names and counts, never a path. */
export type Found =
  | { type: "app"; name: string; bundleId: string | null; where: string }
  | { type: "files"; folder: string; count: number; total: number; kinds: Partial<Record<"pdf" | "word" | "text" | "spreadsheet" | "image", number>>; bytes: number; nameHashes: string[] }
  | { type: "file"; name: string; kind: string; where: string; modified: string; lastUsed: string | null; others: number }
  | { type: "folder"; name: string };
export const FOUND_WHYS = ["none", "denied", "forbidden", "quarantined", "outside", "runs", "timeout", "gone"] as const;
export type FoundWhy = (typeof FOUND_WHYS)[number];

/**
 * Which steps Brenda for Mac looks up before asking (contract B.1, C.1, D.3): every open but a web page (the app, the
 * folder, the file found by its name or by words), and a folder job (the files in the folder). Rust uses the same rule.
 */
export function stepNeedsScope(step: Pick<PlanStepView, "kind"> & { target?: OpenTarget }): boolean {
  return (step.kind === "open" && step.target !== "url") || step.kind === "folder";
}
/** The `found.type` a scope-needing step reports. */
export function foundTypeOf(step: Pick<PlanStepView, "kind"> & { target?: OpenTarget }): Found["type"] | null {
  if (step.kind === "folder") return "files";
  if (step.kind !== "open") return null;
  return step.target === "app" ? "app" : step.target === "folder" ? "folder" : step.target === "url" ? null : "file";
}

/** Boredroom tools whose prepared change may be a step of a plan (contract D.1.4). Never routines, preferences, standups, teams or invitations. */
export const PLAN_TOOLS: readonly string[] = ["create_todos", "remind_me", "cancel_reminder", "timer", "clock", "set_status", "plan_day", "complete_task", "update_task",
  "add_comment", "submit_for_review", "assign_task", "send_message", "pass_message", "hand_over_request", "follow_up", "create_doc", "update_doc", "add_report_note",
  "respond_to_item", "mark_read"];
const OUTWARD_TOOLS: readonly string[] = ["send_message", "pass_message", "hand_over_request", "follow_up", "submit_for_review", "assign_task", "add_comment", "add_report_note", "respond_to_item", "update_doc"];

/**
 * Whether a Boredroom change reaches anyone else, and so asks again when the plan reaches it (contract D.2.5, 0.3 c): the
 * outward tools, or a readback naming anyone but "Only you". `send` for the first four, `submit` for submit_for_review,
 * `share` for the rest.
 */
export function outwardChange(tool: string, readback: { to?: readonly string[] } | null | undefined): { outward: boolean; askKind: AskKind } {
  const others = (readback?.to ?? []).some((t) => String(t).trim() && String(t).trim() !== "Only you");
  const outward = OUTWARD_TOOLS.includes(tool) || others;
  const i = OUTWARD_TOOLS.indexOf(tool);
  const askKind: AskKind = tool === "submit_for_review" ? "submit" : i >= 0 && i < 4 ? "send" : "share";
  return { outward, askKind };
}

/**
 * Opening one of these runs something: refused by `open` and by computer use (contract B.2; the same list as the Mac's
 * guard.rs RUNS_EXT). `.app` is decided by the app rule, not by its extension.
 */
export const OPEN_RUNS_EXT: readonly string[] = ["pkg", "mpkg", "dmg", "mobileconfig", "prefpane", "kext", "osax",
  // Review, 12 October 2026: every disk image mounts, and certificates and provisioning profiles open an import.
  "iso", "img", "cdr", "sparseimage", "sparsebundle", "toast", "udif", "cer", "crt", "der", "p7b", "p7c", "provisionprofile", "mobileprovision",
  "command", "tool", "sh", "zsh", "bash", "csh", "ksh", "fish", "py", "pl", "rb", "php", "js", "scpt", "scptd", "applescript", "workflow", "terminal", "action", "jar", "shortcut",
  "webloc", "inetloc", "fileloc"];
/** Password managers whose exports carry their name (the same list as the Mac's guard.rs PASSWORD_BRANDS). */
export const PASSWORD_BRANDS: readonly string[] = ["1password", "bitwarden", "lastpass", "dashlane", "keeper", "nordpass", "enpass", "keepass", "roboform", "protonpass", "proton pass", "proton_pass"];
/**
 * A password export by its name (review, 12 October 2026: "Passwords.csv", "Chrome Passwords.csv", Bitwarden's and
 * LastPass's exports were read by a folder job and sent to the model): any name with "password" in it, or a password
 * manager's name with "export", "backup" or "vault". The same rule as the Mac's guard.rs `password_export`.
 */
export function passwordExportName(name: string): boolean {
  const l = String(name ?? "").toLowerCase();
  return l.includes("password") || (["export", "backup", "vault"].some((w) => l.includes(w)) && PASSWORD_BRANDS.some((b) => l.includes(b)));
}
/** Apps that install, uninstall, update or erase, by whole words of a name or by bundle id (the Mac's guard.rs `installer_like`). */
export const INSTALLER_WORDS: readonly string[] = ["install", "installer", "installers", "uninstall", "uninstaller", "updater", "autoupdate", "erase"];
export const INSTALLER_IDS: readonly string[] = ["installassistant", "installer", "uninstall", "updater", "autoupdate", "diskimagemounter", "eraseassistant"];
export function installerLike(names: readonly string[], bundleId: string | null | undefined): boolean {
  const byName = names.some((n) => String(n ?? "").toLowerCase().split(/[^\p{L}\p{N}]+/u).some((w) => INSTALLER_WORDS.includes(w)));
  const id = String(bundleId ?? "").toLowerCase();
  return byName || (!!id && INSTALLER_IDS.some((w) => id.includes(w)));
}
/** Never listed, opened or read (contract B.2; the same list as the Mac's), and any name starting ".env". */
export const SECRET_EXT: readonly string[] = ["kdbx", "kdb", "1pux", "1pif", "opvault", "agilekeychain", "keychain", "keychain-db", "p12", "pfx", "pem", "key", "ovpn", "gpg", "pgp", "asc", "psafe3"];
/** Everyday names for apps (contract I.4.3; the same table as the Mac's open.rs). */
export const APP_ALIASES: Readonly<Record<string, string>> = {
  "vs code": "Visual Studio Code", vscode: "Visual Studio Code", code: "Visual Studio Code", word: "Microsoft Word", excel: "Microsoft Excel",
  powerpoint: "Microsoft PowerPoint", outlook: "Microsoft Outlook", onenote: "Microsoft OneNote", chrome: "Google Chrome", edge: "Microsoft Edge",
  notes: "Notes", calendar: "Calendar", mail: "Mail", music: "Music", photos: "Photos", preview: "Preview", finder: "Finder",
};

const extOf = (name: string) => { const n = name.toLowerCase(); const d = n.lastIndexOf("."); return d > 0 ? n.slice(d + 1) : ""; };
/** A file name Brenda never opens or reads: something that runs, or a secret. */
export function neverOpenName(name: string): "runs" | "secret" | null {
  const n = String(name ?? "").trim();
  if (n.toLowerCase().startsWith(".env")) return "secret";
  const e = extOf(n);
  if (OPEN_RUNS_EXT.includes(e)) return "runs";
  if (SECRET_EXT.includes(e)) return "secret";
  if (passwordExportName(n)) return "secret";
  return null;
}

/**
 * The address as a plan's line shows it, and as the person says yes to it (review, 12 October 2026: the line showed only
 * the host and part of the path, so a query or fragment could hide a form submission, a download or a redirect):
 * everything after "https://", without "www." and a lone trailing "/". The same as the Mac's open.rs `url_shown`.
 */
export function urlShown(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const port = u.port ? `:${u.port}` : "";
    const path = u.pathname === "/" ? "" : u.pathname;
    return `${u.protocol === "http:" ? "http://" : ""}${host}${port}${path}${u.search}${u.hash}`;
  } catch {
    return null;
  }
}
/** A query or fragment value that is another address: a redirector would open a page the line doesn't name. */
const redirects = (v: string) => { const l = v.trim().toLowerCase(); return l.startsWith("http:") || l.startsWith("https:") || l.startsWith("//") || l.startsWith("www.") || l.includes("://"); };

/**
 * A web page Brenda may open (contract B.1): https or http only, no user name or password in it, at most 2,000
 * characters and short enough for its line to show it whole (`urlShown`, 170), no banking or payment hint in its host,
 * path, query or fragment, no redirect to another address in its query or fragment, and not a download of something
 * that runs. The URL as the browser will get it, or null. The same rules as the Mac's open.rs `url_ok`.
 */
export function cleanOpenUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s || s.length > ACT_LIMITS.urlChars || /[\u0000-\u0020\u007f-\u009f\u2028\u2029]/.test(s)) return null;
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password || !u.hostname) return null;
  const host = u.hostname.toLowerCase();
  const path = decodeSafe(u.pathname).toLowerCase();
  if (PAYMENT_HINTS.some((h) => (h.startsWith("/") ? path.includes(h) : host.includes(h) || path.includes(h)))) return null;
  const last = path.split("/").filter(Boolean).pop() ?? "";
  if (last && neverOpenName(last)) return null;
  const href = u.toString();
  const shown = urlShown(href);
  if (!shown || [...shown].length > ACT_LIMITS.urlShown) return null;
  // The query and the fragment, decoded, are read too.
  const parts = [...u.searchParams.entries()].flatMap(([k, v]) => [k, v]);
  if (u.hash.length > 1) parts.push(decodeSafe(u.hash.slice(1)));
  for (const p of parts) {
    const l = p.toLowerCase();
    if (redirects(l) || PAYMENT_HINTS.some((h) => l.includes(h)) || l.split(/[/&=?]/).some((seg) => { const t = seg.trim(); return !!t && OPEN_RUNS_EXT.includes(extOf(t)); })) return null;
  }
  return href;
}
const decodeSafe = (p: string) => { try { return decodeURIComponent(p); } catch { return p; } };

/** "figma.com/files/recent", at most 60 characters: what a line says about a web page. */
export function hostAndPath(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./i, "");
    const path = u.pathname === "/" ? "" : decodeSafe(u.pathname).replace(/\/$/, "");
    return clip(`${host}${path}`, 60);
  } catch {
    return clip(url, 60);
  }
}

const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`);
const oneLineOf = (s: string) => String(s ?? "").replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim();

/** A folder's title for a file name and a line: a named folder's own ("Documents"), else the folder's name. */
export function folderTitle(f: FolderRef): string {
  if (f.source === "named") return FOLDER_TITLES[f.name as NamedFolder] ?? f.name;
  return f.name;
}

/** The new file's name (or a Boredroom document's title) of a folder job: the model's when it is plain, else "{Folder} summary.{ext}" (contract C.3). */
export function folderOutputNameOf(folderName: string, outputName: string, format: OutputFormat): string {
  const want = String(outputName ?? "").replace(/\s+/g, " ").trim();
  if (format === "doc") {
    if (want && want.length <= ACT_LIMITS.outputName && !BAD_NAME.test(want) && !want.startsWith(".")) return want;
  } else if (want && want.length <= ACT_LIMITS.outputName && !BAD_NAME.test(want) && !want.startsWith(".") && want.toLowerCase().endsWith(EXT[format]) && want.length > EXT[format].length) {
    return want;
  }
  const base = String(folderName ?? "").replace(/\s+/g, " ").trim().replace(/[/\\:\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, "").replace(/^\.+/, "") || "Folder";
  const suffix = ` summary${format === "doc" ? "" : EXT[format]}`;
  const stem = base.length + suffix.length > ACT_LIMITS.outputName ? base.slice(0, ACT_LIMITS.outputName - suffix.length).trimEnd() : base;
  return `${stem}${suffix}`;
}

export type Need = "mac" | "files" | "accessibility";
/**
 * What a step needs switched on, on this Mac (contract D.2.2): opening needs "Do things when I ask", and finding a file by
 * words also "Work on my files"; folder and file jobs need "Work on my files"; a screen part needs "Do things" and, when the
 * Mac said Accessibility isn't allowed, Accessibility. A Boredroom change needs nothing on the Mac.
 */
export function needsOf(step: Pick<PlanStepView, "kind"> & { target?: OpenTarget; words?: string[] }, o: { accessibility?: boolean } = {}): Need[] {
  switch (step.kind) {
    case "open": return step.target === "recent" || ((step.target === "file" || step.target === "reveal") && (step.words?.length ?? 0) > 0) ? ["mac", "files"] : ["mac"];
    case "folder": case "file": return ["files"];
    case "screen": return o.accessibility === false ? ["mac", "accessibility"] : ["mac"];
    default: return [];
  }
}
/** The first unmet need of a whole plan, in the order mac, files, accessibility; null when everything is on. */
export function firstUnmet(steps: (Pick<PlanStepView, "kind"> & { target?: OpenTarget; words?: string[] })[], on: { useMac: boolean; fileWork: boolean; accessibility?: boolean }): Need | null {
  return allUnmet(steps, on)[0] ?? null;
}
/**
 * Every unmet need of a whole plan, in the order mac, files, accessibility (review, 12 October 2026: one Turn it on
 * covers the whole request, instead of one setup per switch). Accessibility comes with "Do things" from the same setup,
 * so it is listed only when "Do things" is already on.
 */
export function allUnmet(steps: (Pick<PlanStepView, "kind"> & { target?: OpenTarget; words?: string[] })[], on: { useMac: boolean; fileWork: boolean; accessibility?: boolean }): Need[] {
  const needs = new Set(steps.flatMap((s) => needsOf(s, { accessibility: on.accessibility })));
  const out: Need[] = [];
  if (needs.has("mac") && !on.useMac) out.push("mac");
  if (needs.has("files") && !on.fileWork) out.push("files");
  if (needs.has("accessibility") && on.useMac) out.push("accessibility");
  return out;
}

// ---- SHA-256 over UTF-8 (pure, so lib/act stays usable in the browser; the server's crypto gives the same) ----------------------

const K256 = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152,
  0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb,
  0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c,
  0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];

/** The SHA-256 of a string's UTF-8 bytes, in lower-case hex. */
export function sha256Utf8(text: string): string {
  const msg = new TextEncoder().encode(text);
  const bitLen = msg.length * 8;
  const padded = new Uint8Array(((msg.length + 9 + 63) >> 6) << 6);
  padded.set(msg);
  padded[msg.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
  view.setUint32(padded.length - 4, bitLen >>> 0);
  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K256[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }
  return h.map((x) => x.toString(16).padStart(8, "0")).join("");
}

/**
 * What the person's yes to a plan is to (contract D.4): the sentence and the lines under it. With no lines it equals phase
 * 2's hash of the sentence. The same on the Mac (plan.rs `plan_hash`).
 */
export const planHash = (plan: string, lines: readonly string[]) => sha256Utf8(plan + lines.map((l) => `\n${l}`).join(""));

// ---- The lines under a plan's sentence, and its summary (contract M.8) ---------------------------------------------------

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "8 October" this year, "8 October 2025" otherwise, from YYYY-MM-DD (no time zone). */
export function dayWords(ymd: string | null | undefined, now: Date = new Date()): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd ?? ""));
  if (!m) return "";
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return "";
  return `${d} ${MONTHS[mo - 1]}${y === now.getUTCFullYear() ? "" : ` ${y}`}`;
}

/** "under 1 MB", "4.2 MB", "38 MB". */
export function sizeWords(bytes: number): string {
  const mb = Math.max(0, Number(bytes) || 0) / 1_048_576;
  if (mb < 1) return "under 1 MB";
  return mb < 10 ? `${(Math.round(mb * 10) / 10).toString()} MB` : `${Math.round(mb)} MB`;
}

const KIND_WORDS: readonly [keyof Extract<Found, { type: "files" }>["kinds"], string][] = [["pdf", "PDF"], ["word", "Word"], ["text", "text"], ["spreadsheet", "Excel"], ["image", "pictures"]];
/** "documents" (no pictures), "pictures" (only pictures) or "files"; singular for one. */
function nounOf(kinds: Extract<Found, { type: "files" }>["kinds"], n: number): string {
  const pics = kinds.image ?? 0;
  const noun = pics === 0 ? "document" : pics === n ? "picture" : "file";
  return n === 1 ? noun : `${noun}s`;
}

const q = (s: string, max = 80) => `“${clip(oneLineOf(s), max)}”`;
/** The display name of a found or named folder ("Documents", "your home folder", or its own name). */
function whereOfFolder(f: FolderRef): string {
  if (f.source === "named") return f.name === "home" ? "your home folder" : FOLDER_TITLES[f.name as NamedFolder] ?? f.name;
  if (f.source === "none") return "your Desktop, Documents and Downloads folders";
  return q(f.name);
}

/**
 * The lines Boredroom writes under a plan's sentence, one per step, from the steps and what Brenda for Mac found (contract
 * M.8): exactly what each step will touch. Names are clipped to 80 characters and lines to 200.
 */
export function planLines(steps: readonly (PlanStepView | PlanStep)[], found: Readonly<Record<number, Found | undefined>>, now: Date = new Date()): string[] {
  return steps.map((s) => clip(lineOf(s, found[s.i], now), ACT_LIMITS.lineChars));
}

function lineOf(s: PlanStepView | PlanStep, f: Found | undefined, now: Date): string {
  switch (s.kind) {
    case "open": {
      // The whole address (review, 12 October 2026): the Mac checks this line names it before asking.
      if (s.target === "url") return `Open ${urlShown(s.url) ?? hostAndPath(s.url)} in your browser`;
      if (s.target === "app") return f?.type === "app" ? `Open ${clip(oneLineOf(f.name), 80)} (${clip(oneLineOf(f.where), 80)})` : `Open ${clip(oneLineOf(s.name), 80)}`;
      if (s.target === "folder") {
        if (s.folder.source === "named") return s.folder.name === "home" ? "Open your home folder" : `Open your ${FOLDER_TITLES[s.folder.name as NamedFolder] ?? s.folder.name} folder`;
        return `Open the ${q(f?.type === "folder" ? f.name : s.folder.name)} folder`;
      }
      if (f?.type !== "file") return `Open ${q(s.name || s.words.join(" "))}`;
      const where = clip(oneLineOf(f.where), 80);
      if (s.target === "reveal") return `Show ${q(f.name)} in Finder (${where})`;
      // One file opens: the others are only counted (review, 12 October 2026: "and 2 more like it" read as three).
      const of = (newest: string) => (f.others > 0 ? ` (${newest} of ${f.others + 1} like it)` : "");
      if (s.target === "recent") return f.lastUsed ? `Open ${q(f.name)} from ${where}, last opened ${dayWords(f.lastUsed, now)}${of("the most recently opened")}` : `Open ${q(f.name)} from ${where}, changed ${dayWords(f.modified, now)}${of("the newest")}`;
      return `Open ${q(f.name)} from ${where}, changed ${dayWords(f.modified, now)}${of("the newest")}`;
    }
    case "folder": {
      const where = f?.type === "files" ? clip(oneLineOf(f.folder), 80) : whereOfFolder(s.folder);
      if (f?.type !== "files") return `Read the files in ${where} and save ${q(s.output.name, 120)} there`;
      const noun = nounOf(f.kinds, f.count);
      const count = f.total > f.count ? `the newest ${f.count} of ${f.total} ${nounOf(f.kinds, f.total)}` : `the ${f.count} ${noun}`;
      const kinds = KIND_WORDS.filter(([k]) => (f.kinds[k] ?? 0) > 0).map(([, w]) => w);
      const saved = s.output.format === "doc" ? `save ${q(s.output.name, 120)} in Boredroom` : `save ${q(s.output.name, 120)} there`;
      return `Read ${count} in ${where} (${[...kinds, sizeWords(f.bytes)].join(", ")}) and ${saved}`;
    }
    case "file":
      return s.output.format === "doc" ? `Read ${q(s.file.name)} and save ${q(s.output.name, 120)} in Boredroom` : `Read ${q(s.file.name)} and save ${q(s.output.name, 120)} next to it`;
    case "screen":
      return `On your screen: ${oneLineOf(s.goal)}`;
    case "boredroom":
      return `${oneLineOf(s.summary)}${s.outward ? " (I'll ask again before it goes)" : ""}`;
  }
}

/** "a, b and c". */
const andList = (xs: string[]) => (xs.length <= 1 ? xs[0] ?? "" : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const lowerFirst = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s);
const upperFirst = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * What a plan did, in one or two sentences (contract M.8): each completed step in order ("opened Figma", "saved “Documents
 * summary.docx”", a Boredroom change's own done line), then a screen part's own summary as its own sentence; at most 500.
 * `done`: the completed steps' indices; `words`: a Boredroom change's done line or a screen part's summary, by index.
 */
export function planSummary(steps: readonly (PlanStepView | PlanStep)[], found: Readonly<Record<number, Found | undefined>>, done: readonly number[], words: Readonly<Record<number, string | undefined>>): string {
  const { parts, screen } = donePartsOf(steps, found, done, words);
  const first = parts.length ? `${upperFirst(andList(parts))}.` : "";
  const second = screen ? (/[.!…]$/.test(screen) ? screen : `${screen}.`) : "";
  return clip([first, second].filter(Boolean).join(" ") || "Done.", ACT_LIMITS.summary);
}

/** What the steps done so far did, for a plan's screen part ("Already done before this: opened Figma; set a reminder…"). */
export function planDoneParts(steps: readonly (PlanStepView | PlanStep)[], found: Readonly<Record<number, Found | undefined>>, done: readonly number[], words: Readonly<Record<number, string | undefined>>): string[] {
  const { parts, screen } = donePartsOf(steps, found, done, words);
  return screen ? [...parts, screen] : parts;
}

function donePartsOf(steps: readonly (PlanStepView | PlanStep)[], found: Readonly<Record<number, Found | undefined>>, done: readonly number[], words: Readonly<Record<number, string | undefined>>): { parts: string[]; screen: string } {
  const parts: string[] = [];
  let screen = "";
  for (const s of steps) {
    if (!done.includes(s.i)) continue;
    const f = found[s.i];
    switch (s.kind) {
      case "open":
        if (s.target === "app") parts.push(`opened ${clip(oneLineOf(f?.type === "app" ? f.name : s.name), 80)}`);
        else if (s.target === "url") { try { parts.push(`opened ${new URL(s.url).hostname.replace(/^www\./i, "")}`); } catch { parts.push("opened the page"); } }
        else if (s.target === "folder") parts.push(s.folder.source === "named" ? (s.folder.name === "home" ? "opened your home folder" : `opened your ${FOLDER_TITLES[s.folder.name as NamedFolder] ?? s.folder.name} folder`) : `opened ${q(f?.type === "folder" ? f.name : s.folder.name)}`);
        else if (s.target === "reveal") parts.push(`showed ${q(f?.type === "file" ? f.name : s.name)} in Finder`);
        else parts.push(`opened ${q(f?.type === "file" ? f.name : s.name)}`);
        break;
      case "folder": case "file":
        parts.push(s.output.format === "doc" ? `saved ${q(s.output.name, 120)} in Boredroom` : `saved ${q(s.output.name, 120)}`);
        break;
      case "boredroom": {
        const w = oneLineOf(words[s.i] ?? s.summary).replace(/[.!]+$/, "");
        if (w) parts.push(lowerFirst(w));
        break;
      }
      case "screen":
        screen = oneLineOf(words[s.i] ?? "");
        break;
    }
  }
  return { parts, screen };
}
