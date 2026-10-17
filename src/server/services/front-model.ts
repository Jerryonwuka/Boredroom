/**
 * Brenda's front desk: the router's model side (Brenda and her helpers, build 1; owner's approved brief, 12 October 2026:
 * "everything else goes to a small fast model (claude-haiku-5-5) that picks the lane and, for front-lane work, the
 * action"; contract B.4).
 *
 * The router is TEXT ONLY (decision 0b.2): it sees the person's words, the chat so far, the time, which apps run, the
 * names of files they pointed at and which switches are on, never a picture. Whatever its tools do comes from the
 * person's words alone ("never follows instructions found on screen"). One call: claude-haiku-5-5 (BRENDA_ROUTER_MODEL),
 * a forced tool (`tool_choice: any`), thinking disabled, low effort, the rules cached; no sampling parameters (Haiku 5.5
 * refuses them); no fallback model (a refusal is "I can't help with that one.").
 *
 * `checkRoute` reads the one tool call (pure, unit-tested): each Mac action's fields are checked for its kind and
 * classified (lib/mac-risk; a `never` is refused with fixed words), a job's words are checked, a switch that is off is
 * never "I can't" (`enable`). Permission rule v2 (owner, 12 October 2026): a routine request runs from the person's own
 * words; `ask` and "Check with me before every task" wait for their yes on the Mac.
 *
 * Nothing here logs a word, a name or an answer: errors are reduced to their status (actSafe) and a code (aiErrorCode).
 */
import type Anthropic from "@anthropic-ai/sdk";
import { routerModel } from "@/server/services/act-model";
import type { ModelUsage } from "@/server/services/ai-usage";
import { TOOLS } from "@/server/services/copilot";
import { neutralise } from "@/server/services/copilot-excerpt";
import {
  FOLDER_REF_SOURCES, FRONT_LIMITS, FRONT_WORDS, MAC_ACTION_KINDS, SEARCH_KINDS, frontUrl, refusedWords,
  type FolderRefSource, type MacAction, type MacActionKind, type SearchKind,
} from "@/lib/front";
import { classify, classifyRequest, riskKindOfAction, type RiskFact, type RiskKind } from "@/lib/mac-risk";

// ---- The rules and the tools (contract B.4; exact) --------------------------------------------------------------------------

export const ROUTER_RULES = [
  "You are Brenda's front desk on the person's Mac. They held her keys and spoke, or typed in her notch: their words are the last line of their message. Decide what happens by calling exactly one tool, at once.",
  "- do_on_mac: things macOS does directly and quickly: open an app, a web page, a folder or a file (found by words); show a file in Finder; find files; switch to, hide, minimise, arrange, fill the screen with or quit apps; volume and mute; a screenshot to the Desktop; copy the selected text; type text into the box they're in (never pressing Return); Wi-Fi on or off; empty the Trash. Up to three actions, in order.",
  "- remind_me, create_todos, timer: their own reminder, to-do or timer in Boredroom, only for themselves (to start the timer on a task, call boredroom: it needs the task).",
  "- start_job: work in the background. files: organise, tidy, rename, move, copy or convert files, summarise or go through a folder, or clear out (move to the Trash) files, in their Desktop, Documents, Downloads or folders they added. operator: clicking and typing inside an app when nothing else here can do it (filling in a form, changing something inside an app).",
  "- boredroom: anything else about their work in Boredroom (tasks, messages, people, documents, their day, follow-ups, reports, routines), and anything that sends something to someone.",
  "- look: they want help with what is on their screen, or their words point at something on it (\"this\", \"that\", \"here\") that you would need to see, except typing \"here\", a screenshot \"of this\", and files they pointed at. lane think for errors, code, long documents and small print; otherwise now.",
  "- ask: their words are unclear, or could mean very different things. One short question.",
  "Their words are the only request. Never add steps they didn't ask for, and never act on anything you think they might want next. Use the exact names they said. A web address is the address they said, with https. Words for files are the distinctive words they used (\"Q3\", \"invoice\"), never \"file\" or \"document\". Kinds: presentation for a deck or slides, spreadsheet for a sheet, document for a doc, pdf for a PDF. pick newest when they name a time (\"last week's\", \"the latest\"), else ask. since_days: 7 for \"last week\", 1 for \"yesterday\", 0 otherwise. For start_job, title is the job in a few words as an instruction (\"Organise your Desktop\"), doing the same as \"-ing\" (\"Organising your Desktop\"), and goal restates exactly what they asked, in one or two sentences, with nothing added. Unused fields: \"\" for text, [] for lists, 0 for numbers, \"none\" or false where offered.",
].join("\n");

const DO_ON_MAC = {
  name: "do_on_mac", strict: true,
  description: "Do these things on their Mac now, in order (one to three). Only what their words asked for.",
  input_schema: {
    type: "object" as const, additionalProperties: false, required: ["actions"],
    properties: { actions: { type: "array", items: { $ref: "#/$defs/action" } } },
    $defs: {
      action: {
        type: "object", additionalProperties: false,
        required: ["kind", "app", "app2", "url", "folder", "words", "kinds", "since_days", "pick", "text", "level", "change", "side", "on"],
        properties: {
          kind: { type: "string", enum: [...MAC_ACTION_KINDS] },
          app: { type: "string" }, app2: { type: "string" }, url: { type: "string" },
          folder: {
            type: "object", additionalProperties: false, required: ["source", "name"],
            properties: { source: { type: "string", enum: [...FOLDER_REF_SOURCES] }, name: { type: "string" } },
          },
          words: { type: "array", items: { type: "string" } },
          kinds: { type: "array", items: { type: "string", enum: [...SEARCH_KINDS] } },
          since_days: { type: "integer" },
          pick: { type: "string", enum: ["ask", "newest", "none"] },
          text: { type: "string" },
          level: { type: "integer" },
          change: { type: "string", enum: ["set", "up", "down", "none"] },
          side: { type: "string", enum: ["left", "right", "none"] },
          on: { type: "boolean" },
        },
      },
    },
  },
};
const START_JOB = {
  name: "start_job", strict: true,
  description: "Start a background job for their request. files: work on files and folders. operator: clicking and typing in an app.",
  input_schema: {
    type: "object" as const, additionalProperties: false, required: ["helper", "title", "doing", "goal"],
    properties: { helper: { type: "string", enum: ["files", "operator"] }, title: { type: "string" }, doing: { type: "string" }, goal: { type: "string" } },
  },
};
const LOOK = {
  name: "look", strict: true,
  description: "They need you to see their screen for this.",
  input_schema: { type: "object" as const, additionalProperties: false, required: ["lane"], properties: { lane: { type: "string", enum: ["now", "think"] } } },
};
const BOREDROOM = {
  name: "boredroom", strict: true,
  description: "Hand this to Brenda's Boredroom side: their work, people, messages, documents, or anything that sends.",
  input_schema: { type: "object" as const, additionalProperties: false, required: ["why"], properties: { why: { type: "string", enum: ["work", "sends", "question", "other"] } } },
};
const ASK = {
  name: "ask", strict: true,
  description: "Ask them one short question because their words are unclear.",
  input_schema: { type: "object" as const, additionalProperties: false, required: ["question"], properties: { question: { type: "string" } } },
};
/** Their own to-dos, reminders and timer: the chat's own tools, copied by name so their schemas never drift. */
export const QUICK_TOOLS = ["remind_me", "create_todos", "timer"] as const;
export type QuickTool = (typeof QUICK_TOOLS)[number];
const byName = (name: string) => {
  const t = (TOOLS as readonly { name: string }[]).find((x) => x.name === name);
  if (!t) throw new Error(`front-model: the chat has no ${name} tool`);
  return t;
};
export const ROUTER_TOOLS = [DO_ON_MAC, START_JOB, LOOK, BOREDROOM, ASK, ...QUICK_TOOLS.map(byName)];

// ---- The situation (contract B.4; exact, uncached) --------------------------------------------------------------------------

export type RouterAbilities = { useMac: boolean; fileWork: boolean; accessibility: boolean; clickConsent: boolean; screenRecording: boolean };
export type RouterFile = { source: string; name: string; kind: string; bytes: number };
export type RouterFolder = { source: "named" | "added" | "pointed"; name: string };
export type RouterContext = {
  front: { name: string; bundleId: string | null } | null;
  running: string[];
  files: RouterFile[];
  folders: RouterFolder[];
  abilities: RouterAbilities;
  pictures: boolean;
};

const oneLine = (s: string) => String(s ?? "").replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").replace(/\s+/g, " ").trim();
const quoted = (s: string, max = 80) => JSON.stringify(neutralise(oneLine(s)).slice(0, max));

/** "Monday 12 October 2026", "15:04" and "+01:00" in `timeZone`. */
export function routerClock(now: Date, timeZone: string): { weekday: string; date: string; time: string; offset: string } {
  const part = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone, ...o }).format(now);
  const weekday = part({ weekday: "long" });
  const date = part({ day: "numeric", month: "long", year: "numeric" });
  const time = part({ hour: "2-digit", minute: "2-digit", hour12: false });
  const tzName = new Intl.DateTimeFormat("en-GB", { timeZone, timeZoneName: "longOffset" }).formatToParts(now).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const offset = tzName === "GMT" ? "+00:00" : tzName.replace(/^GMT/, "");
  return { weekday, date, time, offset };
}

/** The situation block: who, when, which switches, what runs, what they pointed at. Names are quoted data. */
export function routerSituation(o: { now: Date; timeZone: string; name: string; context: RouterContext }): string {
  const c = o.context;
  const { weekday, date, time, offset } = routerClock(o.now, o.timeZone);
  const a = c.abilities;
  const running = c.running.filter((n) => n.trim() && n !== c.front?.name).map((n) => quoted(n)).join(", ");
  const files = c.files.map((f) => `${quoted(f.name, 255)} (${oneLine(f.kind).slice(0, 16)}, ${oneLine(f.source).slice(0, 20)})`).join("; ");
  const added = c.folders.filter((f) => f.source === "added").map((f) => `${quoted(f.name)} (added)`);
  const pointed = c.folders.filter((f) => f.source === "pointed").map((f) => `${quoted(f.name)} (pointed)`);
  return [
    `Now: ${weekday} ${date}, ${time} in ${o.timeZone} (UTC${offset}). Times they say are in that zone.`,
    `Their assistant is called ${JSON.stringify(o.name)}.`,
    `On this Mac: doing things ${a.useMac ? "on" : "off"}; working on files ${a.fileWork ? "on" : "off"}; clicking and typing ${a.accessibility ? "allowed" : "not allowed yet"}; they ${a.clickConsent ? "have" : "haven't"} said yes to you clicking and typing for them.`,
    `In front: ${c.front ? quoted(c.front.name) : "\"nothing\""}. Running: ${running || "nothing else"}.`,
    `Files they pointed at: ${files || "none"}.`,
    `Folders you may use for file work: Desktop, Documents, Downloads${added.length ? `, and ${added.join(", ")}` : ""}${pointed.length ? `; they have ${pointed.join(", ")} open in Finder` : ""}.`,
    `They ${c.pictures ? "can" : "can't"} show you their screen for this request.`,
  ].join("\n");
}

export type RouterMessage = { role: "user" | "assistant"; content: string };

/**
 * The model's messages: the chat so far as plain text turns (at most six, starting with the person and alternating),
 * then one user message: the situation, a blank line, and their words, quoted.
 */
export function routerMessages(o: { history: RouterMessage[]; situation: string; via: "voice" | "typed"; text: string }): RouterMessage[] {
  const turns: RouterMessage[] = [];
  for (const m of o.history.slice(-6)) {
    const content = oneLine(m.content).slice(0, FRONT_LIMITS.messageChars);
    if (!content) continue;
    if (!turns.length && m.role !== "user") continue;
    const last = turns[turns.length - 1];
    if (last && last.role === m.role) last.content = `${last.content}\n${content}`;
    else turns.push({ role: m.role, content });
  }
  // The new message is the person's: an earlier turn of theirs right before it is folded in front of the situation.
  if (turns.length && turns[turns.length - 1].role === "user") turns.pop();
  turns.push({ role: "user", content: `${o.situation}\n\nTheir words (${o.via}): ${JSON.stringify(o.text)}` });
  return turns;
}

// ---- The call --------------------------------------------------------------------------------------------------------------------

export type RouterRun = { content: Record<string, unknown>[]; stopReason: string | null; model: string; usage: ModelUsage };

/** One Haiku call, forced to call one tool, no thinking, low effort, the rules cached. Text only. */
export async function runRouter(client: Anthropic, messages: RouterMessage[]): Promise<RouterRun> {
  const model = routerModel();
  const res = await client.messages.create({
    model, max_tokens: 1024,
    thinking: { type: "disabled" },
    output_config: { effort: "low" },
    tool_choice: { type: "any", disable_parallel_tool_use: true },
    system: [{ type: "text", text: ROUTER_RULES, cache_control: { type: "ephemeral" } }],
    tools: ROUTER_TOOLS,
    messages,
  } as never) as unknown as { content: Record<string, unknown>[]; stop_reason: string | null; model?: string; usage?: ModelUsage };
  return { content: Array.isArray(res.content) ? res.content : [], stopReason: res.stop_reason ?? null, model: res.model ?? model, usage: res.usage ?? null };
}

// ---- Reading the call (contract B.4 "Validating the call"; pure) ------------------------------------------------------------

export type RouteDecision =
  | { lane: "mac"; actions: MacAction[]; risk: "routine" | "ask" }
  | { lane: "quick"; tool: QuickTool; input: Record<string, unknown> }
  | { lane: "job"; helper: "files" | "operator"; title: string; doing: string; goal: string; checkEvery: boolean; consent: boolean }
  | { lane: "look"; look: "now" | "think" }
  | { lane: "look_screen" }
  | { lane: "boredroom"; why: string }
  | { lane: "ask"; question: string }
  | { lane: "enable"; which: "mac" | "files" | "accessibility" }
  | { lane: "refused"; reason: string; message: string };

const APP_RE = /^[^/\n\r\u0000-\u001f]{1,80}$/;
const WORD_RE = /^[\p{L}\p{N} ._-]{1,40}$/u;
const NEEDS_FILES: readonly MacActionKind[] = ["open_file", "reveal_file", "find_files"];
const NEEDS_AX: readonly MacActionKind[] = ["minimise", "fill", "half", "arrange", "copy_selection", "type_text"];

const str = (v: unknown) => (typeof v === "string" ? v : "");
const app = (v: unknown, optional = false): string | null => {
  const s = oneLine(str(v));
  if (!s) return optional ? "" : null;
  return APP_RE.test(s) ? s : null;
};
const LINK_RE = /:\/\/|\bwww\.|\bmailto:|\]\(/i;

/** One action checked for the fields its kind uses (C's "Params"), the rest emptied; null when it can't be read. */
export function cleanMacAction(raw: unknown): MacAction | { refused: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const kind = (MAC_ACTION_KINDS as readonly unknown[]).includes(r.kind) ? (r.kind as MacActionKind) : null;
  if (!kind) return null;
  const a: MacAction = { kind, app: "", app2: "", url: "", folder: { source: "none", name: "" }, words: [], kinds: [], since_days: 0, pick: "none", text: "", level: 0, change: "none", side: "none", on: false };
  const folderOf = (): MacAction["folder"] | null => {
    const f = r.folder as Record<string, unknown> | undefined;
    const source = (FOLDER_REF_SOURCES as readonly unknown[]).includes(f?.source) ? (f!.source as FolderRefSource) : "none";
    const name = oneLine(str(f?.name)).slice(0, 255);
    if (source !== "none" && (!name || /[/\u0000-\u001f]/.test(name))) return null;
    return { source, name: source === "none" ? "" : name };
  };
  switch (kind) {
    case "open_app": case "switch_app": case "hide_app": case "quit_app": {
      const v = app(r.app); if (!v) return null; a.app = v; break;
    }
    case "minimise": case "fill": {
      const v = app(r.app, true); if (v === null) return null; a.app = v; break;
    }
    case "half": {
      const v = app(r.app); if (!v || (r.side !== "left" && r.side !== "right")) return null; a.app = v; a.side = r.side; break;
    }
    case "arrange": {
      const v = app(r.app), w = app(r.app2); if (!v || !w) return null; a.app = v; a.app2 = w; break;
    }
    case "open_url": {
      const u = frontUrl(str(r.url).trim());
      if (!u) return { refused: "bad_url" };
      a.url = u; break;
    }
    case "open_folder": {
      const f = folderOf(); if (!f || f.source === "none") return null; a.folder = f; break;
    }
    case "open_file": case "reveal_file": case "find_files": {
      const words = Array.isArray(r.words) ? r.words.map((w) => oneLine(str(w))).filter(Boolean) : [];
      if (words.length > FRONT_LIMITS.words || words.some((w) => !WORD_RE.test(w))) return null;
      const kinds = Array.isArray(r.kinds) ? r.kinds.filter((k): k is SearchKind => (SEARCH_KINDS as readonly unknown[]).includes(k)) : [];
      if (Array.isArray(r.kinds) && kinds.length !== r.kinds.length) return null;
      const since = typeof r.since_days === "number" && Number.isInteger(r.since_days) ? r.since_days : 0;
      if (since < 0 || since > FRONT_LIMITS.sinceDaysMax) return null;
      const f = folderOf(); if (!f) return null;
      if (!words.length && !kinds.some((k) => k !== "any") && f.source === "none") return null;
      a.words = words; a.kinds = [...new Set(kinds)]; a.since_days = since; a.folder = f;
      a.pick = kind === "find_files" ? "none" : r.pick === "newest" ? "newest" : "ask";
      break;
    }
    case "volume": {
      const change = r.change === "set" || r.change === "up" || r.change === "down" ? r.change : null;
      if (!change) return null;
      a.change = change;
      if (change === "set") {
        const level = typeof r.level === "number" && Number.isInteger(r.level) ? r.level : NaN;
        if (!(level >= 0 && level <= 100)) return null;
        a.level = level;
      }
      break;
    }
    case "type_text": {
      const text = str(r.text).replace(/[\r\n\t]+/g, " ").replace(/[\u0000-\u001f\u007f]/g, "");
      if (!text.trim() || text.length > FRONT_LIMITS.typeChars) return null;
      a.text = text; break;
    }
    case "wifi": a.on = r.on === true; break;
    default: break; // hide_others, hide_all, show_all, mute, unmute, screenshot, copy_selection, empty_trash: nothing else
  }
  return a;
}

/** What `checkRoute` needs to know beyond the call: the Mac's switches, a held picture, Check with me. */
export type RouteFacts = { abilities: RouterAbilities; pictures: boolean; checkEvery: boolean };

const oneLineOk = (s: string, min: number, max: number) => s.length >= min && s.length <= max && !LINK_RE.test(s);

/** The router's one tool call, checked (B.4). Anything that isn't exactly one readable call is the "say it another way" question. */
export function checkRoute(content: unknown[], f: RouteFacts): RouteDecision {
  const uses = (content as Record<string, unknown>[]).filter((b) => b && b.type === "tool_use" && typeof b.name === "string");
  const unclear: RouteDecision = { lane: "ask", question: FRONT_WORDS.router.unclear };
  if (uses.length !== 1) return unclear;
  const name = uses[0].name as string;
  const input = (uses[0].input && typeof uses[0].input === "object" ? uses[0].input : {}) as Record<string, unknown>;
  switch (name) {
    case "do_on_mac": {
      const raw = Array.isArray(input.actions) ? input.actions : [];
      if (raw.length < 1 || raw.length > FRONT_LIMITS.actions) return unclear;
      const actions: MacAction[] = [];
      const items: { kind: RiskKind; facts: RiskFact[] }[] = [];
      for (const x of raw) {
        const a = cleanMacAction(x);
        if (!a) return unclear;
        if ("refused" in a) {
          const w = refusedWords(a.refused);
          return { lane: "refused", reason: a.refused, message: w.message };
        }
        const kind = riskKindOfAction(a.kind, a.on);
        if (!kind) return unclear;
        const c = classify(kind, []);
        if (c.class === "never") { const w = refusedWords(String(c.reason)); return { lane: "refused", reason: String(c.reason), message: w.message }; }
        actions.push(a);
        items.push({ kind, facts: [] });
      }
      // A switch that is off is never "I can't" (phase 3, owner report, 12 October 2026): the notch offers Turn it on.
      if (!f.abilities.useMac) return { lane: "enable", which: "mac" };
      if (actions.some((a) => NEEDS_FILES.includes(a.kind)) && !f.abilities.fileWork) return { lane: "enable", which: "files" };
      if (actions.some((a) => NEEDS_AX.includes(a.kind)) && !f.abilities.accessibility) return { lane: "enable", which: "accessibility" };
      const req = classifyRequest(items, f.checkEvery);
      return { lane: "mac", actions, risk: req.class === "routine" ? "routine" : "ask" };
    }
    case "remind_me": case "create_todos": case "timer": {
      // Starting the timer needs a task's id: the rules send "start my timer on …" to the Boredroom side.
      if (name === "timer" && input.action === "start") return { lane: "boredroom", why: "work" };
      return { lane: "quick", tool: name, input };
    }
    case "start_job": {
      const helper = input.helper === "files" || input.helper === "operator" ? input.helper : null;
      const title = oneLine(str(input.title)), doing = oneLine(str(input.doing)), goal = oneLine(str(input.goal));
      if (!helper || !oneLineOk(title, FRONT_LIMITS.titleMin, FRONT_LIMITS.titleMax) || !oneLineOk(doing, FRONT_LIMITS.titleMin, FRONT_LIMITS.titleMax)
        || !oneLineOk(goal, FRONT_LIMITS.goalMin, FRONT_LIMITS.goalMax)) return unclear;
      if (helper === "files" && !f.abilities.fileWork) return { lane: "enable", which: "files" };
      if (helper === "operator" && !f.abilities.useMac) return { lane: "enable", which: "mac" };
      if (helper === "operator" && !f.abilities.accessibility) return { lane: "enable", which: "accessibility" };
      const start = classifyRequest([{ kind: helper === "files" ? "job.files" : "job.operator" }], f.checkEvery);
      return { lane: "job", helper, title, doing, goal, checkEvery: start.reason === "check_every", consent: helper === "operator" && !f.abilities.clickConsent };
    }
    case "look": {
      if (!f.pictures) return { lane: "look_screen" };
      return { lane: "look", look: input.lane === "think" ? "think" : "now" };
    }
    case "boredroom": return { lane: "boredroom", why: ["work", "sends", "question", "other"].includes(str(input.why)) ? str(input.why) : "other" };
    case "ask": {
      const q = oneLine(str(input.question));
      return q.length >= FRONT_LIMITS.questionMin && q.length <= FRONT_LIMITS.questionMax ? { lane: "ask", question: q } : unclear;
    }
    default: return unclear;
  }
}
