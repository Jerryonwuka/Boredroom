/**
 * The shared risk classifier (Brenda and her helpers, build 1; contract D). The same table and vectors as the Mac's
 * risk.rs: the server classifies the router's output and every job tool call from what it can see (names, kinds,
 * addresses, the person's switch); the Mac classifies again right before running, with what only it sees (paths, the
 * focused element, the running apps, quarantine). Either side's `ask` asks; neither side ever downgrades.
 *
 * Permission rule v2 (owner, 12 October 2026; replaces "always confirm"), verbatim: "when you hold the keys and clearly
 * ask for a routine task, the request is the permission, and she does it. She still asks before anything destructive,
 * anything sent, anything that costs money, or anything sensitive." So: `routine` runs from the person's own request;
 * `ask` waits for their recorded yes; `never` never runs. "Check with me before every task" (default off, decision 9)
 * makes a routine request or job start ask too, but never the steps of a job they already said yes to, and never
 * `find_files` (it only shows a list and changes nothing).
 *
 * Client-safe and pure.
 */
import type { AskKind } from "@/lib/act";

export type RiskClass = "routine" | "ask" | "never";
const RANK: Readonly<Record<RiskClass, number>> = { routine: 0, ask: 1, never: 2 };

/** Every kind the classifier knows (D.2): the direct actions (Wi-Fi split by on/off), file calls, Boredroom tools, job starts. */
export const RISK_KINDS = [
  "open_app", "open_url", "open_folder", "open_file", "reveal_file", "find_files", "switch_app", "hide_app", "hide_others", "hide_all", "show_all",
  "minimise", "arrange", "fill", "half", "quit_app", "volume", "mute", "unmute", "screenshot", "copy_selection", "type_text", "wifi_on", "wifi_off", "empty_trash",
  // Owner report, 28 October 2026: a new tab or window in a browser, and a web search (routine at base).
  "new_tab", "new_window", "search_web",
  "files.list", "files.read", "files.make_folder", "files.move", "files.copy", "files.rename", "files.organise", "files.rename_by_date", "files.convert",
  "files.write", "files.open", "files.trash",
  "bd.remind_me", "bd.create_todos", "bd.timer", "bd.sends",
  "job.files", "job.operator",
] as const;
export type RiskKind = (typeof RISK_KINDS)[number];

/** The base class of each kind that does not start routine, with the ask kind its card uses (D.2). */
const BASE_ASK: Readonly<Partial<Record<RiskKind, AskKind>>> = { wifi_off: "other", empty_trash: "delete", "files.trash": "delete", "bd.sends": "send" };

export const RISK_FACTS = [
  "installer", "quarantined", "outside_apps", "secret", "never_look", "secure_field", "own", "finder", "bad_url", "outside_allowed",
  "hidden_or_system", "recently_changed", "cross_volume", "others_todo",
] as const;
export type RiskFact = (typeof RISK_FACTS)[number];

const FILE_CHANGES: readonly RiskKind[] = ["files.move", "files.copy", "files.rename", "files.trash", "files.organise", "files.rename_by_date"];
const EVERY_FILE: readonly RiskKind[] = RISK_KINDS.filter((k) => k.startsWith("files."));

/** What each fact raises a kind to, and the kinds it applies to (D.3, in the table's order). */
export const FACT_RULES: readonly { fact: RiskFact; raises: RiskClass; applies: readonly RiskKind[] }[] = [
  // The browser a page, a tab or a search opens in is an app like any other (owner report, 28 October 2026).
  { fact: "installer", raises: "never", applies: ["open_app", "open_file", "files.open", "open_url", "new_tab", "new_window", "search_web"] },
  { fact: "quarantined", raises: "never", applies: ["open_app", "switch_app", "open_url", "new_tab", "new_window", "search_web"] },
  { fact: "outside_apps", raises: "never", applies: ["open_app", "open_url", "new_tab", "new_window", "search_web"] },
  { fact: "secret", raises: "never", applies: ["open_file", "reveal_file", "files.read", "files.open", "files.convert"] },
  { fact: "never_look", raises: "never", applies: ["type_text", "copy_selection", "files.read"] },
  { fact: "secure_field", raises: "never", applies: ["type_text", "copy_selection"] },
  { fact: "own", raises: "never", applies: ["quit_app", "hide_app", "type_text", "copy_selection"] },
  { fact: "finder", raises: "never", applies: ["quit_app"] },
  { fact: "bad_url", raises: "never", applies: ["open_url", "search_web"] },
  { fact: "outside_allowed", raises: "never", applies: EVERY_FILE },
  { fact: "hidden_or_system", raises: "never", applies: FILE_CHANGES },
  { fact: "recently_changed", raises: "never", applies: FILE_CHANGES },
  { fact: "cross_volume", raises: "never", applies: ["files.move"] },
  { fact: "others_todo", raises: "ask", applies: ["bd.create_todos"] },
];

export type Classified = { class: RiskClass; reason: RiskFact | "base" | "check_every"; askKind: AskKind | null };

/** One action, job call or tool: its base class raised by each true fact that applies to it (D.1). */
export function classify(kind: RiskKind, facts: readonly RiskFact[] | Partial<Record<RiskFact, boolean>> = []): Classified {
  const on = new Set<RiskFact>(Array.isArray(facts) ? facts : (Object.entries(facts).filter(([, v]) => v).map(([k]) => k as RiskFact)));
  const baseAsk = BASE_ASK[kind];
  let out: Classified = baseAsk ? { class: "ask", reason: "base", askKind: baseAsk } : { class: "routine", reason: "base", askKind: null };
  for (const r of FACT_RULES) {
    if (!on.has(r.fact) || !r.applies.includes(kind)) continue;
    if (RANK[r.raises] > RANK[out.class]) out = { class: r.raises, reason: r.fact, askKind: r.raises === "ask" ? (baseAsk ?? "other") : null };
  }
  return out;
}

/**
 * A request (or a job start): the highest class of its items, and `ask` (reason `check_every`) when that is routine and
 * "Check with me before every task" is on, unless every item only finds files (D.1).
 */
export function classifyRequest(items: readonly { kind: RiskKind; facts?: readonly RiskFact[] }[], checkEvery: boolean): Classified {
  let out: Classified = { class: "routine", reason: "base", askKind: null };
  for (const it of items) {
    const c = classify(it.kind, it.facts ?? []);
    if (RANK[c.class] > RANK[out.class]) out = c;
  }
  if (out.class === "routine" && checkEvery && items.length && !items.every((i) => i.kind === "find_files")) return { class: "ask", reason: "check_every", askKind: "other" };
  return out;
}

/** A step inside a job the person already said yes to (or that their request started): never re-asks for Check with me. */
export const classifyJobStep = (kind: RiskKind, facts: readonly RiskFact[] = []): Classified => classify(kind, facts);

/** The Wi-Fi action's kind by its `on`. */
export const riskKindOfAction = (kind: string, on?: boolean): RiskKind | null =>
  kind === "wifi" ? (on ? "wifi_on" : "wifi_off") : (RISK_KINDS as readonly string[]).includes(kind) ? (kind as RiskKind) : null;

/** The shared vectors (D.6): Rust's risk::VECTORS is the same list. */
export type RiskVector =
  | { kind: RiskKind; facts: RiskFact[]; want: RiskClass; reason: Classified["reason"]; askKind?: AskKind }
  | { request: RiskKind[]; checkEvery: boolean; want: RiskClass; reason: Classified["reason"] }
  | { step: RiskKind; checkEvery: boolean; want: RiskClass; reason: Classified["reason"] };

export const RISK_VECTORS: readonly RiskVector[] = [
  { kind: "open_app", facts: [], want: "routine", reason: "base" },
  { kind: "open_app", facts: ["never_look"], want: "routine", reason: "base" },
  { kind: "open_app", facts: ["installer"], want: "never", reason: "installer" },
  { kind: "open_app", facts: ["quarantined"], want: "never", reason: "quarantined" },
  { kind: "open_url", facts: [], want: "routine", reason: "base" },
  { kind: "open_url", facts: ["bad_url"], want: "never", reason: "bad_url" },
  { kind: "open_file", facts: ["secret"], want: "never", reason: "secret" },
  { kind: "new_tab", facts: [], want: "routine", reason: "base" },
  { kind: "search_web", facts: ["bad_url"], want: "never", reason: "bad_url" },
  { kind: "open_url", facts: ["quarantined"], want: "never", reason: "quarantined" },
  { kind: "switch_app", facts: ["never_look"], want: "routine", reason: "base" },
  { kind: "quit_app", facts: ["never_look"], want: "routine", reason: "base" },
  { kind: "quit_app", facts: ["own"], want: "never", reason: "own" },
  { kind: "quit_app", facts: ["finder"], want: "never", reason: "finder" },
  { kind: "type_text", facts: [], want: "routine", reason: "base" },
  { kind: "type_text", facts: ["secure_field"], want: "never", reason: "secure_field" },
  { kind: "type_text", facts: ["never_look"], want: "never", reason: "never_look" },
  { kind: "copy_selection", facts: ["never_look"], want: "never", reason: "never_look" },
  { kind: "screenshot", facts: [], want: "routine", reason: "base" },
  { kind: "wifi_on", facts: [], want: "routine", reason: "base" },
  { kind: "wifi_off", facts: [], want: "ask", reason: "base", askKind: "other" },
  { kind: "empty_trash", facts: [], want: "ask", reason: "base", askKind: "delete" },
  { kind: "files.move", facts: [], want: "routine", reason: "base" },
  { kind: "files.move", facts: ["outside_allowed"], want: "never", reason: "outside_allowed" },
  { kind: "files.move", facts: ["recently_changed"], want: "never", reason: "recently_changed" },
  { kind: "files.move", facts: ["cross_volume"], want: "never", reason: "cross_volume" },
  { kind: "files.trash", facts: [], want: "ask", reason: "base", askKind: "delete" },
  { kind: "files.read", facts: ["secret"], want: "never", reason: "secret" },
  { kind: "files.convert", facts: ["secret"], want: "never", reason: "secret" },
  { kind: "bd.remind_me", facts: [], want: "routine", reason: "base" },
  { kind: "bd.create_todos", facts: ["others_todo"], want: "ask", reason: "others_todo" },
  { kind: "bd.sends", facts: [], want: "ask", reason: "base", askKind: "send" },
  { request: ["open_app"], checkEvery: true, want: "ask", reason: "check_every" },
  { request: ["open_app", "empty_trash"], checkEvery: false, want: "ask", reason: "base" },
  { request: ["files.trash"], checkEvery: true, want: "ask", reason: "base" },
  { request: ["find_files"], checkEvery: true, want: "routine", reason: "base" },
  { request: ["job.files"], checkEvery: true, want: "ask", reason: "check_every" },
  { step: "files.move", checkEvery: true, want: "routine", reason: "base" },
];

/** A vector's outcome through this file (the tests iterate RISK_VECTORS through it). */
export function runVector(v: RiskVector): Classified {
  if ("request" in v) return classifyRequest(v.request.map((kind) => ({ kind })), v.checkEvery);
  if ("step" in v) return classifyJobStep(v.step);
  return classify(v.kind, v.facts);
}
