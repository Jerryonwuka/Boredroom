/**
 * Brenda for Mac, phase 3: plans end to end on the server (owner report and requests, 12 October 2026, after trying phase
 * 2: "I wanted Brenda to assist me with some things, like open an app on my desktop, and it said it can't do that, why?";
 * "Brenda is meant to assist you do anything you need it to do"; his spoken request: "look through my documents and
 * summarise them and maybe open up"; contract sections 0, B, C, D, G, H, N).
 *
 * As Brenda for Mac calls it (a desktop session's bearer token): before 0059 nothing changes (phase 2's propose_task, the
 * Mac state not kept, Set up 503, the plan routes 503); with 0059 a plan is proposed only from the person's own request in
 * a look whose model prepared any Boredroom change in the same turn; the Mac's scope comes back before any yes, and the
 * yes is to the sentence and its lines; each step runs only when it is the plan's current one; a Boredroom change that
 * reaches anyone else asks again; a folder job reads only the files counted before asking; a screen part gets only its
 * own goal; never just "I can't" (enable, setup); the database refuses a yes before the scope and a step past the first
 * without a yes; RLS; and the logs never carry a word, a name, a line, a section, a URL or a plan.
 *
 * Local test database only (TEST_DATABASE_URL); migration 0059 waits in db/pending and is applied here by hand. The model
 * is a scripted fake that records what it was given (never a network call). No Mac, no file of the person's, no click,
 * no open: the "Mac" here is this test posting what Brenda for Mac would.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type Msg = { content: Record<string, unknown>[]; stop_reason: string; model?: string; usage?: Record<string, number> };
const model = vi.hoisted(() => ({ msgs: [] as Msg[], act: [] as Msg[], calls: [] as { kind: "create" | "stream" | "beta"; args: Record<string, unknown> }[], fail: null as Error | null }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    constructor(_o: Record<string, unknown>) { void _o; }
    messages = {
      create: async (args: Record<string, unknown>) => {
        model.calls.push({ kind: "create", args: structuredClone(args) });
        if (model.fail) throw model.fail;
        const next = model.msgs.shift();
        if (!next) throw Object.assign(new Error("the fake model has nothing more to say"), { status: 500 });
        return next;
      },
      stream: (args: Record<string, unknown>) => {
        model.calls.push({ kind: "stream", args: structuredClone(args) });
        const next = model.msgs.shift();
        const fail = model.fail;
        async function* events() {
          if (fail) throw fail;
          if (!next) throw Object.assign(new Error("the fake model has nothing more to say"), { status: 500 });
          for (const [index, b] of next.content.entries()) {
            if (b.type !== "text") continue;
            yield { type: "content_block_delta", index, delta: { type: "text_delta", text: String(b.text) } };
          }
        }
        const it = events();
        return {
          [Symbol.asyncIterator]: () => it,
          finalMessage: async () => { if (fail) throw fail; if (!next) throw Object.assign(new Error("nothing"), { status: 500 }); return next; },
        };
      },
    };
    beta = {
      messages: {
        create: async (args: Record<string, unknown>) => {
          model.calls.push({ kind: "beta", args: structuredClone(args) });
          if (model.fail) throw model.fail;
          const next = model.act.shift();
          if (!next) throw Object.assign(new Error("the fake model has nothing more to say"), { status: 500 });
          return next;
        },
      },
    };
  },
}));

const reqState = vi.hoisted(() => ({ cookie: null as string | null, bearer: null as string | null }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "boredroom_session" && reqState.cookie ? { name, value: reqState.cookie } : undefined) }),
  headers: async () => new Headers(reqState.bearer ? { authorization: `Bearer ${reqState.bearer}` } : {}),
}));

import { resetTestDatabase, adminQuery, appQueryAs } from "../helpers/db";
import { buildCompany, type CompanyFixture } from "@/server/services/fixtures";
import { withSystem } from "@/server/db";
import { issueSession } from "@/server/auth";
import { startLink, approveLink, pollLink } from "@/server/services/desktop";
import { forget0057 } from "@/server/lib/schema-0057";
import { forget0058 } from "@/server/lib/schema-0058";
import { forget0059 } from "@/server/lib/schema-0059";
import { listActivity } from "@/server/services/assistant-activity";
import { purgeTasks } from "@/server/services/act";
import { sha256, signPayload } from "@/server/lib/crypto";
import { readNdjson, type NdjsonLine } from "@/server/lib/ndjson";
import { planHash, type TaskViewV2 } from "@/lib/act";
import { POST as lookPOST } from "@/app/api/orgs/[org]/assistant/look/route";
import { POST as answerPOST } from "@/app/api/orgs/[org]/assistant/act/[id]/answer/route";
import { POST as stepPOST } from "@/app/api/orgs/[org]/assistant/act/[id]/step/route";
import { POST as stepAnswerPOST } from "@/app/api/orgs/[org]/assistant/act/[id]/step-answer/route";
import { POST as stopPOST } from "@/app/api/orgs/[org]/assistant/act/[id]/stop/route";
import { POST as filePOST } from "@/app/api/orgs/[org]/assistant/act/[id]/file/route";
import { POST as scopePOST } from "@/app/api/orgs/[org]/assistant/act/[id]/scope/route";
import { POST as progressPOST } from "@/app/api/orgs/[org]/assistant/act/[id]/progress/route";
import { POST as runPOST } from "@/app/api/orgs/[org]/assistant/act/[id]/run/route";
import { POST as folderPOST } from "@/app/api/orgs/[org]/assistant/act/[id]/folder/route";
import { POST as finishPOST } from "@/app/api/orgs/[org]/assistant/act/[id]/folder/finish/route";
import { PUT as macPUT } from "@/app/api/orgs/[org]/screen-help/mac/route";
import { PUT as minePUT } from "@/app/api/orgs/[org]/screen-help/me/route";
import type { OrgContext } from "@/server/lib/api";

const JPEG = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAYACgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD6D1/WbfQ7NLm7SV43kEYEQBOSCe5HpXP/APCw9J/5977/AL4T/wCKo+Kn/IvW/wD19L/6A9eWV8rm+b4jCYh0qTVrLofWZPk+GxeGVWqne76ns2geKrHXLx7a0iuUkSMyEyqoGAQOxPrW/Xlnwr/5GG4/69W/9DSvU69fKMVUxeHVWrvdnj5xhKeExLpUtrIKKKK9M8sKKKKACiiigAooooA//9k=";
const MARKER = "QUOKKA-4417";
const ASK = `${MARKER} open Figma, then remind me at 3 to review it`;
const LOOK_MODEL = "claude-look-pilot-test";
const ACT_MODEL = "claude-act-test";
const SECRET_FILE = "Salaries KESTREL-90.pdf";
const SECTION = "OSPREY-12 notes on the salaries";
const URL_MARK = "https://heron-55.example.com/board";
const usage = { input_tokens: 1000, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const tool = (name: string, input: Record<string, unknown>, id = `tu_${name}_${Math.random().toString(36).slice(2, 7)}`): Msg => ({ content: [{ type: "tool_use", id, name, input }], stop_reason: "tool_use", model: LOOK_MODEL, usage });
const say = (text: string): Msg => ({ content: [{ type: "text", text }], stop_reason: "end_turn", model: LOOK_MODEL, usage });
const deliverSection = (markdown: string): Msg => ({ content: [{ type: "tool_use", id: "tu_ds", name: "deliver_section", input: { markdown } }], stop_reason: "tool_use", model: ACT_MODEL, usage });
const deliver = (content: string, summary: string): Msg => ({ content: [{ type: "tool_use", id: "tu_d", name: "deliver", input: { content, summary } }], stop_reason: "tool_use", model: ACT_MODEL, usage });
const count = async (sql: string, params: unknown[] = []) => (await adminQuery<{ n: number }>(sql, params))[0].n;
const seam = (name: string, value: unknown) => { if (process.env.ACT_SEAM_DIR) writeFileSync(join(process.env.ACT_SEAM_DIR, name), typeof value === "string" ? value : JSON.stringify(value)); };
const ndjsonOf = (lines: NdjsonLine[]) => lines.map((l) => JSON.stringify(l)).join("\n") + "\n";

const none = { source: "none", name: "" };
const openApp = (name: string) => ({ kind: "open", target: "app", name, url: "", folder: none, words: [], kinds: [], since_days: 0 });
const openUrl = (url: string) => ({ kind: "open", target: "url", name: "", url, folder: none, words: [], kinds: [], since_days: 0 });
const folderJob = (o: Record<string, unknown> = {}) => ({ kind: "folder", folder: { source: "named", name: "documents" }, kinds: ["any"], recursive: false, since_days: 0, words: [], job: "write a short summary of each", per_file: true, output_format: "docx", output_name: "", ...o });
const remindIn = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

const saved = { key: process.env.ANTHROPIC_API_KEY, ws: process.env.BRENDA_LOOK_WORKSPACES, model: process.env.BRENDA_LOOK_MODEL, act: process.env.BRENDA_ACT_MODEL };
let a: CompanyFixture;
let owner: OrgContext, hr: OrgContext, ada: OrgContext, ben: OrgContext;
const tokens = new Map<string, string>();
const webTokens = new Map<string, string>();
const logs: string[] = [];
/** A describe whose tests carry one plan from test to test keeps it live between them. */
let keepLive = false;

async function linkDesktop(c: OrgContext, n: number): Promise<string> {
  const link = await startLink({ deviceName: `Plan Mac ${n}` }, { ip: `127.0.7.${n}`, origin: "http://localhost:3000" });
  await approveLink(c.user, { userCode: link.userCode, orgSlug: c.org.slug });
  const r = await pollLink({ deviceCode: link.deviceCode }, { userAgent: "Brenda desktop/test (macos)" });
  return (r as { token: string }).token;
}

const pic = (pointer: { x: number; y: number } | null = { x: 12, y: 9 }) => ({ mediaType: "image/jpeg", data: JPEG, width: 40, height: 24, pointer });
const v2 = (o: Record<string, unknown> = {}, question = ASK) => ({
  version: 2, source: "keys",
  request: { text: question, via: "voice", ageMs: 900 },
  screen: pic(), crop: pic({ x: 20, y: 12 }),
  display: { widthPt: 1512, heightPt: 982, scale: 2 },
  app: { name: "Finder", bundleId: "com.apple.finder" },
  hidden: [],
  abilities: { useMac: true, fileWork: true, busy: null, plans: 1, accessibility: true },
  files: [{ source: "finder_selection", name: "Q3 report.pdf", kind: "pdf", bytes: 2104331 }, { source: "front_folder", name: "Invoices", kind: "folder", bytes: 0 }],
  messages: [{ role: "user", content: question }],
  ...o,
});

function as(c: OrgContext, web = false) {
  reqState.cookie = web ? webTokens.get(c.membership.id) ?? null : null;
  reqState.bearer = web ? null : tokens.get(c.membership.id) ?? null;
}

async function look(c: OrgContext, payload: unknown): Promise<{ status: number; lines: NdjsonLine[]; json: Record<string, unknown> | null }> {
  as(c);
  const res = await lookPOST(new Request(`http://localhost:3000/api/orgs/${c.org.slug}/assistant/look`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }), { params: Promise.resolve({ org: c.org.slug }) });
  const type = res.headers.get("content-type") ?? "";
  if (type.startsWith("application/x-ndjson")) return { status: res.status, lines: await readNdjson(res), json: null };
  return { status: res.status, lines: [], json: await res.json() as Record<string, unknown> };
}

const ROUTES = { answer: answerPOST, step: stepPOST, "step-answer": stepAnswerPOST, stop: stopPOST, file: filePOST, scope: scopePOST, progress: progressPOST, run: runPOST, folder: folderPOST, "folder/finish": finishPOST } as const;
async function act(c: OrgContext, id: string, what: keyof typeof ROUTES, payload: unknown, o: { web?: boolean } = {}): Promise<{ status: number; json: Record<string, unknown> }> {
  as(c, o.web);
  if (what === "step") await adminQuery("UPDATE assistant_tasks SET last_step_at = last_step_at - interval '2 seconds' WHERE id = $1 AND last_step_at IS NOT NULL", [id]).catch(() => undefined);
  const res = await ROUTES[what](new Request(`http://localhost:3000/api/orgs/${c.org.slug}/assistant/act/${id}/${what}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }), { params: Promise.resolve({ org: c.org.slug, id }) });
  return { status: res.status, json: await res.json() as Record<string, unknown> };
}
const yes = (c: OrgContext, t: { id: string; planSha256: string }, o: Record<string, unknown> = {}) => act(c, t.id, "answer", { version: 1, answer: "yes", via: "button", planSha256: t.planSha256, ...o });
const row = async (id: string) => (await adminQuery<Record<string, unknown>>("SELECT * FROM assistant_tasks WHERE id = $1", [id]))[0];
const errorOf = (r: { status: number; json: Record<string, unknown> }) => [r.status, r.json.code];

async function mac(c: OrgContext, payload: unknown, o: { web?: boolean } = {}) {
  as(c, o.web);
  const res = await macPUT(new Request(`http://localhost:3000/api/orgs/${c.org.slug}/screen-help/mac`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }), { params: Promise.resolve({ org: c.org.slug }) });
  return { status: res.status, json: await res.json() as Record<string, unknown> };
}
async function mine(c: OrgContext, payload: unknown) {
  as(c, true);
  const res = await minePUT(new Request(`http://localhost:3000/api/orgs/${c.org.slug}/screen-help/me`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }), { params: Promise.resolve({ org: c.org.slug }) });
  return { status: res.status, json: await res.json() as Record<string, unknown> };
}
const macState = { v: 1, binary: 3, supported: true, look: { on: true, permission: "granted" }, mac: { on: true, accessibility: "granted" }, files: { on: true, finder: "granted", folders: { documents: "granted", desktop: "granted", downloads: "granted" } }, companion: { on: true, shown: true, why: "idle" }, preview: false };

/** A plan from a v2 look whose scripted model calls (optionally) Boredroom tools first, then propose_task. */
async function proposePlan(c: OrgContext, steps: unknown[], o: { plan?: string; before?: Msg[]; body?: Record<string, unknown>; risky?: boolean; question?: string } = {}): Promise<{ task: TaskViewV2; lines: NdjsonLine[]; done: Record<string, unknown> }> {
  model.msgs = [...(o.before ?? []), tool("propose_task", { plan: o.plan ?? "I'll open Figma and remind you to review it.", risky: o.risky ?? false, steps })];
  const r = await look(c, v2(o.body ?? {}, o.question ?? ASK));
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  const p = r.lines.find((l) => l.t === "propose");
  expect(p, JSON.stringify(r.lines.filter((l) => l.t !== "text"))).toBeTruthy();
  return { task: p!.task as TaskViewV2, lines: r.lines, done: r.lines[r.lines.length - 1].result as Record<string, unknown> };
}
const appFound = (i: number, name = "Figma", bundleId = "com.figma.Desktop") => ({ i, found: { type: "app", name, bundleId, where: "Applications" } });
const filesFound = (i: number, names: string[], total = names.length) => ({ i, found: { type: "files", folder: "Documents", count: names.length, total, kinds: { pdf: names.length }, bytes: 2_000_000, nameHashes: names.map((n) => sha256(Buffer.from(n, "utf8"))) } });
const textFile = (i: number, n: number, name: string, text = `${SECTION} ${n}`) => ({ version: 1, i, n, file: { name, kind: "text", mediaType: "text/plain", text, bytes: text.length } });

beforeAll(async () => {
  for (const k of ["error", "warn", "log", "info"] as const) vi.spyOn(console, k).mockImplementation((...args: unknown[]) => { logs.push(args.map((x) => (x instanceof Error ? `${x.name} ${x.message}` : typeof x === "string" ? x : JSON.stringify(x))).join(" ")); });
  await resetTestDatabase(); // 0057 and 0058 are in db/migrations; 0059 waits in db/pending
  forget0057(); forget0058(); forget0059();
  process.env.ANTHROPIC_API_KEY = "test-env-key-not-real"; // never sent anywhere: the SDK is the fake above
  process.env.BRENDA_LOOK_WORKSPACES = "company-a";
  process.env.BRENDA_LOOK_MODEL = LOOK_MODEL;
  process.env.BRENDA_ACT_MODEL = ACT_MODEL;
  a = await buildCompany("a");
  owner = a.ownerCtx; hr = a.hrCtx; ada = a.employeeCtx; ben = a.employee2Ctx;
  let n = 1;
  for (const c of [owner, hr, ada, ben]) {
    tokens.set(c.membership.id, await linkDesktop(c, n++));
    webTokens.set(c.membership.id, await withSystem((db) => issueSession(db, c.user.authUserId, { method: "password" })));
  }
});

afterAll(() => {
  for (const [k, v] of [["ANTHROPIC_API_KEY", saved.key], ["BRENDA_LOOK_WORKSPACES", saved.ws], ["BRENDA_LOOK_MODEL", saved.model], ["BRENDA_ACT_MODEL", saved.act]] as const) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  reqState.cookie = null; reqState.bearer = null;
  vi.restoreAllMocks();
});

beforeEach(async () => {
  model.msgs = []; model.act = []; model.calls = []; model.fail = null;
  await adminQuery("DELETE FROM auth_rate_limits WHERE bucket LIKE 'ai.burst:%'");
  if (keepLive) return;
  await adminQuery(`UPDATE assistant_tasks SET status = 'stopped', end_reason = 'stopped', ended_at = now(), request_text = NULL, confirm_text = NULL, pending_ask = NULL, approved_ask = NULL, step_started_at = NULL
                    WHERE status IN ('proposed', 'running', 'asking')`);
});

// Skipped (security audit verification, 23 October 2026): the migration now ships in db/migrations, so the test reset applies it and there is no "before" to test.
describe.skip("before migration 0059 (contract 0b.9, G.2)", () => {
  it("0059 is not applied here; a Mac that runs plans gets phase 2's propose_task exactly", async () => {
    expect(await count("SELECT count(*)::int AS n FROM pg_attribute WHERE attrelid = 'assistant_tasks'::regclass AND attname = 'steps'")).toBe(0);
    model.msgs = [say("I'll ask you first.")];
    await look(ada, v2());
    const tools = model.calls[0].args.tools as { name: string; input_schema: { properties: Record<string, unknown> } }[];
    const propose = tools.find((t) => t.name === "propose_task")!;
    expect(Object.keys(propose.input_schema.properties)).toEqual(["kind", "plan", "risky", "file_source", "file_name", "output_format", "output_name"]);
    expect(tools.map((t) => t.name).slice(-3)).toEqual(["point_at", "offer_setup", "propose_task"]);
  });
  it("the Mac state is not kept, Set up on my Mac answers 503, the plan routes answer 503 ACT_NOT_READY", async () => {
    expect((await mac(ada, { version: 1, state: macState, setupSeen: null })).json).toEqual({ saved: false, ready: false });
    expect(errorOf(await mine(ada, { setup: true }))).toEqual([503, "NOT_READY"]);
    for (const what of ["scope", "progress", "run"] as const) {
      const r = await act(ada, "00000000-0000-4000-8000-000000000001", what, what === "scope" ? { version: 1, steps: [appFound(0)] } : what === "run" ? { version: 1, i: 0 } : { version: 1, i: 0, ok: true });
      expect(errorOf(r), what).toEqual([503, "ACT_NOT_READY"]);
    }
  });
});

describe("with migration 0059", () => {
  beforeAll(async () => {
    await adminQuery(readFileSync(join(process.cwd(), "db", "migrations", "0059_mac_help.sql"), "utf8"));
    // Idempotent: safe to run by hand twice.
    await adminQuery(readFileSync(join(process.cwd(), "db", "migrations", "0059_mac_help.sql"), "utf8"));
    forget0059();
  });

  describe("a plan: open Figma, then a reminder (contract D.1 to D.5)", () => {
    let task: TaskViewV2;
    beforeAll(() => { keepLive = true; });
    afterAll(() => { keepLive = false; });
    it("plan.change_must_be_this_turns: the reminder is prepared, numbered, bound to the plan, and leaves the reply's cards", async () => {
      const r = await proposePlan(ada, [openApp("Figma"), { kind: "boredroom", change: 1 }], { before: [tool("remind_me", { body: "Review the Figma file", at: remindIn(120) }, "tu_remind")] });
      task = r.task;
      seam("server-propose-plan.json", task);
      seam("server-look-propose-plan.ndjson", ndjsonOf(r.lines));
      // The plan's tool is the plan's schema; the prepared change's result names its number.
      const tools = model.calls[0].args.tools as { name: string; input_schema: { properties: Record<string, unknown> } }[];
      expect(Object.keys(tools.find((t) => t.name === "propose_task")!.input_schema.properties)).toEqual(["plan", "risky", "steps"]);
      const second = model.calls[1].args.messages as { role: string; content: { type: string; content?: string }[] }[];
      const result = JSON.parse(String(second[second.length - 1].content[0].content)) as Record<string, unknown>;
      expect(result).toMatchObject({ needsConfirmation: true, change: 1, note: "Prepared as change 1, not done. To do it as part of a plan, include {kind: \"boredroom\", change: 1} in propose_task; if you don't, the person gets a Confirm button for it." });
      expect(task).toMatchObject({ kind: "plan", v: 2, plan: "I'll open Figma and remind you to review it.", question: "Do you want me to do this?", planSha256: "", needsScope: true, lines: null, risky: false, file: null, output: null });
      expect(task.steps).toEqual([
        { i: 0, kind: "open", target: "app", name: "Figma", url: "", folder: none, words: [], kinds: [], sinceDays: 0 },
        { i: 1, kind: "boredroom", summary: expect.stringMatching(/Review the Figma file/), outward: false },
      ]);
      expect(JSON.stringify(r.lines)).not.toContain("\"token\"");
      // No separate Confirm card for the bound reminder.
      expect((r.done.proposals as { kind: string }[]).filter((p) => p.kind === "confirm")).toEqual([]);
      expect(r.done.reply).toBe("I'll open Figma and remind you to review it. Do you want me to do this?");
      const rw = await row(task.id);
      expect(rw).toMatchObject({ kind: "plan", plan_v: 2, status: "proposed", needs_scope: true, scoped_at: null, lines: null, step_index: 0, progress: [] });
      expect((rw.steps as { token?: string }[])[1].token).toMatch(/\./);
    });
    it("plan.answer.needs_scope: no yes before the scope (409, nothing changes); the database refuses it too", async () => {
      expect(errorOf(await yes(ada, { id: task.id, planSha256: planHash(task.plan, []) }))).toEqual([409, "ACT_NOT_SCOPED"]);
      expect(await row(task.id)).toMatchObject({ status: "proposed", confirmed_at: null });
      // db.yes_before_scope_violates_check
      await expect(adminQuery("UPDATE assistant_tasks SET status = 'running', confirmed_at = now(), confirmed_via = 'button' WHERE id = $1", [task.id])).rejects.toThrow(/assistant_tasks_yes_after_scope/);
      // db.step_past_first_without_yes_violates_check
      await expect(adminQuery("UPDATE assistant_tasks SET step_index = 1 WHERE id = $1", [task.id])).rejects.toThrow(/assistant_tasks_progress_needs_yes/);
    });
    it("plan.scope.runs_nothing: the scope writes the lines and the hash; nothing runs; once only", async () => {
      const reminders = await count("SELECT count(*)::int AS n FROM brenda_reminders WHERE membership_id = $1", [ada.membership.id]);
      const s = await act(ada, task.id, "scope", { version: 1, steps: [appFound(0)] });
      expect(s.status, JSON.stringify(s.json)).toBe(200);
      seam("server-scope-ready.json", s.json);
      const t = s.json.task as TaskViewV2;
      expect(s.json.status).toBe("ready");
      expect(t.lines).toEqual(["Open Figma (Applications)", expect.stringMatching(/^.*Review the Figma file.*$/)]);
      expect(t).toMatchObject({ needsScope: false, planSha256: planHash(task.plan, t.lines!) });
      expect(await count("SELECT count(*)::int AS n FROM brenda_reminders WHERE membership_id = $1", [ada.membership.id]).catch(() => 0)).toBe(reminders);
      expect(errorOf(await act(ada, task.id, "scope", { version: 1, steps: [appFound(0)] }))).toEqual([409, "ACT_SCOPED"]);
      task = t;
    });
    it("plan.answer.hash_is_sentence_and_lines: the sentence's own hash is not the yes", async () => {
      // (Checked on a copy: the real one goes on below.) A wrong hash ends a plan, as phase 2's does.
      expect(task.planSha256).not.toBe(planHash(task.plan, []));
      const y = await yes(ada, task);
      expect(y.status, JSON.stringify(y.json)).toBe(200);
      expect(y.json).toMatchObject({ status: "running", stepCap: 20 });
      // Ten minutes: no file is read.
      expect(Date.parse(y.json.deadline as string) - Date.now()).toBeGreaterThan(9 * 60_000);
      expect(Date.parse(y.json.deadline as string) - Date.now()).toBeLessThanOrEqual(10 * 60_000);
    });
    it("plan.step.order: the change can't run before the open (another person's plan)", async () => {
      const copy = await proposePlan(ben, [openApp("Figma"), { kind: "boredroom", change: 1 }], { before: [tool("remind_me", { body: "Look at it", at: remindIn(120) })] });
      await act(ben, copy.task.id, "scope", { version: 1, steps: [appFound(0)] });
      const t = (await act(ben, copy.task.id, "scope", { version: 1, steps: [appFound(0)] }));
      expect(errorOf(t)).toEqual([409, "ACT_SCOPED"]);
      const fresh = await row(copy.task.id);
      const y = await yes(ben, { id: copy.task.id, planSha256: fresh.plan_sha256 as string });
      expect(y.status).toBe(200);
      expect(errorOf(await act(ben, copy.task.id, "run", { version: 1, i: 1 }))).toEqual([409, "ACT_STEP_ORDER"]);
      expect(await row(copy.task.id)).toMatchObject({ status: "failed", end_reason: "failed", steps: null, lines: null, scope: null });
    });
    it("the open, then the reminder: the plan ends done with its summary, words, steps, lines and scope cleared", async () => {
      const p = await act(ada, task.id, "progress", { version: 1, i: 0, ok: true });
      expect(p.json).toEqual({ status: "done", planDone: false });
      expect(await row(task.id)).toMatchObject({ step_index: 1, progress: [{ i: 0, kind: "open", ok: true }] });
      const before = await count("SELECT count(*)::int AS n FROM brenda_reminders WHERE membership_id = $1", [ada.membership.id]);
      const r = await act(ada, task.id, "run", { version: 1, i: 1 });
      expect(r.status, JSON.stringify(r.json)).toBe(200);
      seam("server-run-done.json", r.json);
      expect(r.json).toMatchObject({ status: "done", planDone: true });
      expect(await count("SELECT count(*)::int AS n FROM brenda_reminders WHERE membership_id = $1", [ada.membership.id])).toBe(before + 1);
      const done = await row(task.id);
      expect(done).toMatchObject({ status: "done", end_reason: "done", request_text: null, steps: null, lines: null, scope: null, step_index: 2 });
      expect(String(done.summary)).toMatch(/^Opened Figma and /);
      expect(r.json.summary).toBe(done.summary);
      // Activity: one mac_plan row, its summary.
      const items = (await listActivity(ada, { kind: "mac" })).items;
      expect(items.find((x) => x.id === `task:${task.id}`)).toMatchObject({ tool: "mac_plan", summary: done.summary, outcome: "done", source: "mac" });
    });
  });

  describe("outward Boredroom changes ask again (contract 0.3 c, D.5.4)", () => {
    it("plan.run.outward_asks_first and plan.run.approval_is_for_one_step", async () => {
      const r = await proposePlan(ada, [{ kind: "boredroom", change: 1 }, { kind: "boredroom", change: 2 }], {
        plan: "I'll message Ben twice for you.",
        before: [tool("send_message", { to: "Ben Employee", body: "First: the deck is ready" }), tool("send_message", { to: "Ben Employee", body: "Second: see you at 3" })],
        question: `${MARKER} message Ben that the deck is ready and that I'll see him at 3`,
      });
      // Nothing to look up: the lines and the hash come with the proposal.
      expect(r.task).toMatchObject({ needsScope: false, risky: true });
      expect(r.task.lines).toHaveLength(2);
      expect(r.task.lines![0]).toMatch(/\(I'll ask again before it goes\)$/);
      // The yes is to the lines, so a message's line carries the words it sends.
      expect(r.task.lines![0]).toContain("“First: the deck is ready”");
      expect(r.task.planSha256).toBe(planHash(r.task.plan, r.task.lines!));
      expect((await yes(ada, r.task)).status).toBe(200);
      const ask = await act(ada, r.task.id, "run", { version: 1, i: 0 });
      seam("server-run-ask.json", ask.json);
      expect(ask.json).toMatchObject({ status: "ask", ask: { i: 0, kind: "send", because: "this sends something" } });
      const what = (ask.json.ask as { what: string }).what;
      // The message's own quotes become single ones inside the outer quote (integration, 12 October 2026).
      expect(what).toMatch(/^go ahead with “[^“”]+”$/);
      expect(what).toContain("‘First: the deck is ready’");
      expect((ask.json.ask as { question: string }).question).toBe(`Next I'll ${what}. Do you want me to do this?`);
      expect(await row(r.task.id)).toMatchObject({ status: "asking", pending_ask: { kind: "send", what, i: 0 } });
      expect(errorOf(await act(ada, r.task.id, "run", { version: 1, i: 0 }))).toEqual([409, "ACT_STEP_ASK"]);
      const messages = await count("SELECT count(*)::int AS n FROM messages");
      const sa = await act(ada, r.task.id, "step-answer", { version: 1, answer: "yes", via: "voice", text: "Yes, go ahead.", askSha256: sha256(Buffer.from(what, "utf8")) });
      expect(sa.json).toEqual({ status: "running" });
      const first = await act(ada, r.task.id, "run", { version: 1, i: 0 });
      expect(first.json).toMatchObject({ status: "done", planDone: false });
      expect(await count("SELECT count(*)::int AS n FROM messages")).toBe(messages + 1);
      // The yes was for that step alone: the second asks again.
      const second = await act(ada, r.task.id, "run", { version: 1, i: 1 });
      expect(second.json).toMatchObject({ status: "ask", ask: { i: 1, kind: "send" } });
      // A no stops the plan; the second message is never sent.
      const no = await act(ada, r.task.id, "step-answer", { version: 1, answer: "no", via: "button", askSha256: sha256(Buffer.from((second.json.ask as { what: string }).what, "utf8")) });
      expect(no.json).toEqual({ status: "stopped" });
      expect(await count("SELECT count(*)::int AS n FROM messages")).toBe(messages + 1);
      expect(await row(r.task.id)).toMatchObject({ status: "stopped", end_reason: "said_no", steps: null });
    });
  });

  describe("a file job and an expired change in a plan (contract D.5.3, D.5.4)", () => {
    it("open Figma, then the file job: the file the plan names, only when it is its turn; the plan ends done", async () => {
      const r = await proposePlan(ada, [openApp("Figma"), { kind: "file", file_source: "finder_selection", file_name: "Q3 report.pdf", output_format: "md", output_name: "" }], { plan: "I'll open Figma and write a summary of the Q3 report next to it." });
      const s = await act(ada, r.task.id, "scope", { version: 1, steps: [appFound(0)] });
      expect((s.json.task as TaskViewV2).lines).toEqual(["Open Figma (Applications)", "Read “Q3 report.pdf” and save “Q3 report (Brenda summary).md” next to it"]);
      expect((await yes(ada, s.json.task as TaskViewV2)).status).toBe(200);
      const body = { version: 1, i: 1, file: { source: "finder_selection", name: "Q3 report.pdf", kind: "text", mediaType: "text/plain", text: "Q3 went well.", bytes: 13 } };
      expect(errorOf(await act(ada, r.task.id, "file", { ...body, i: 0 }))).toEqual([409, "ACT_STEP_ORDER"]);
      const again = await proposePlan(ada, [openApp("Figma"), { kind: "file", file_source: "finder_selection", file_name: "Q3 report.pdf", output_format: "md", output_name: "" }], { plan: "I'll open Figma and write a summary of the Q3 report next to it." });
      const s2 = await act(ada, again.task.id, "scope", { version: 1, steps: [appFound(0)] });
      await yes(ada, s2.json.task as TaskViewV2);
      await act(ada, again.task.id, "progress", { version: 1, i: 0, ok: true });
      model.msgs = [deliver("# Q3\n\nIt went well.", "I've written a short summary of the Q3 report.")];
      const f = await act(ada, again.task.id, "file", body);
      expect(f.status, JSON.stringify(f.json)).toBe(200);
      expect(f.json).toMatchObject({ status: "done", name: "Q3 report (Brenda summary).md", planDone: true, summary: "Opened Figma and saved “Q3 report (Brenda summary).md”." });
      expect(await row(again.task.id)).toMatchObject({ status: "done", units: 1, steps: null });
    });
    it("a change whose Confirm token ran out stops the plan (409 ACT_CHANGE_EXPIRED); nothing is made", async () => {
      const r = await proposePlan(ada, [{ kind: "boredroom", change: 1 }], { plan: "I'll remind you to review it.", before: [tool("remind_me", { body: "Review it later", at: remindIn(240) })] });
      await yes(ada, r.task);
      const steps = (await row(r.task.id)).steps as { token: string }[];
      const payload = JSON.parse(Buffer.from(steps[0].token.split(".")[0], "base64url").toString("utf8")) as Record<string, unknown>;
      delete payload.exp;
      await adminQuery("UPDATE assistant_tasks SET steps = jsonb_set(steps, '{0,token}', to_jsonb($2::text)) WHERE id = $1", [r.task.id, signPayload(payload, -60)]);
      const before = await count("SELECT count(*)::int AS n FROM brenda_reminders WHERE membership_id = $1", [ada.membership.id]);
      expect(errorOf(await act(ada, r.task.id, "run", { version: 1, i: 0 }))).toEqual([409, "ACT_CHANGE_EXPIRED"]);
      expect(await count("SELECT count(*)::int AS n FROM brenda_reminders WHERE membership_id = $1", [ada.membership.id])).toBe(before);
      expect(await row(r.task.id)).toMatchObject({ status: "failed", steps: null });
    });
  });

  describe("a folder job (contract C, D.5.2, K.6)", () => {
    const NAMES = ["A.pdf", SECRET_FILE, "C.pdf"];
    async function folderPlan(o: Record<string, unknown> = {}) {
      const r = await proposePlan(ada, [folderJob(o)], { plan: "I'll read the documents in your Documents folder and write a short summary of each.", question: `${MARKER} look through my documents and summarise them` });
      const s = await act(ada, r.task.id, "scope", { version: 1, steps: [filesFound(0, NAMES, 5)] });
      expect(s.status, JSON.stringify(s.json)).toBe(200);
      const t = s.json.task as TaskViewV2;
      expect((await yes(ada, t)).status).toBe(200);
      return t;
    }
    it("the lines name the count, the kinds and the size; the yes is to them; fifteen minutes", async () => {
      const r = await proposePlan(ada, [folderJob()], { plan: "I'll read the documents in your Documents folder and write a short summary of each.", question: `${MARKER} look through my documents and summarise them` });
      expect(r.task.steps[0]).toMatchObject({ kind: "folder", output: { format: "docx", name: "Documents summary.docx" }, perFile: true });
      const s = await act(ada, r.task.id, "scope", { version: 1, steps: [filesFound(0, NAMES, 5)] });
      expect((s.json.task as TaskViewV2).lines).toEqual(["Read the newest 3 of 5 documents in Documents (PDF, 1.9 MB) and save “Documents summary.docx” there"]);
      const y = await yes(ada, s.json.task as TaskViewV2);
      expect(Date.parse(y.json.deadline as string) - Date.now()).toBeGreaterThan(14 * 60_000);
    });
    // Review, 12 October 2026 (privacy-1): a password export is never read, even if a Mac counted it.
    it("a password export is refused before any model call, even when the Mac counted it (409 ACT_FILE)", async () => {
      const r = await proposePlan(ada, [folderJob()], { plan: "I'll read the documents in your Downloads folder and write a short summary of each.", question: `${MARKER} summarise everything in Downloads` });
      const s = await act(ada, r.task.id, "scope", { version: 1, steps: [filesFound(0, ["A.pdf", "Chrome Passwords.csv", "C.pdf"])] });
      expect(s.status, JSON.stringify(s.json)).toBe(200);
      expect((await yes(ada, s.json.task as TaskViewV2)).status).toBe(200);
      const calls = model.calls.length;
      expect(errorOf(await act(ada, r.task.id, "folder", textFile(0, 0, "Chrome Passwords.csv", "site,user,password")))).toEqual([409, "ACT_FILE"]);
      expect(model.calls.length).toBe(calls);
      expect(await row(r.task.id)).toMatchObject({ status: "failed", steps: null, scope: null });
    });
    it("plan.folder.file_not_in_scope: a file it didn't count is refused (409 ACT_FILE) and the plan fails", async () => {
      const t = await folderPlan();
      model.msgs = [deliverSection("A section.")];
      const ok = await act(ada, t.id, "folder", textFile(0, 0, "A.pdf"));
      expect(ok.status, JSON.stringify(ok.json)).toBe(200);
      expect(errorOf(await act(ada, t.id, "folder", textFile(0, 1, "Not counted.pdf")))).toEqual([409, "ACT_FILE"]);
      expect(await row(t.id)).toMatchObject({ status: "failed", steps: null, scope: null });
    });
    it("a file read twice is refused", async () => {
      const t = await folderPlan();
      model.msgs = [deliverSection("A section.")];
      expect((await act(ada, t.id, "folder", textFile(0, 0, "A.pdf"))).status).toBe(200);
      expect(errorOf(await act(ada, t.id, "folder", textFile(0, 1, "A.pdf")))).toEqual([409, "ACT_FILE"]);
    });
    it("a section per file, assembled; Word as HTML; units; nothing from the files kept or logged", async () => {
      const t = await folderPlan();
      const sections: { title: string; markdown: string }[] = [];
      for (const [n, name] of NAMES.slice(0, 2).entries()) {
        model.msgs = [deliverSection(`${SECTION} ${n}`)];
        const r = await act(ada, t.id, "folder", textFile(0, n, name));
        expect(r.status, JSON.stringify(r.json)).toBe(200);
        if (n === 0) seam("server-folder-ok.json", r.json);
        expect(r.json).toEqual({ status: "ok", n, section: { title: name, markdown: `${SECTION} ${n}` } });
        sections.push(r.json.section as { title: string; markdown: string });
        // The section call: deliver_section only, the file as a titled document, the job's words.
        const call = model.calls.filter((c) => c.kind === "stream").pop()!.args;
        expect((call.tools as { name: string }[]).map((x) => x.name)).toEqual(["deliver_section"]);
        expect(String(call.system)).toContain("This part: write the section about one file, for this job: write a short summary of each.");
      }
      const f = await act(ada, t.id, "folder/finish", { version: 1, i: 0, sections, skipped: [{ name: "C.pdf", why: "too_big" }] });
      expect(f.status, JSON.stringify(f.json)).toBe(200);
      seam("server-folder-finish.json", f.json);
      expect(f.json).toMatchObject({ status: "done", format: "docx", name: "Documents summary.docx", planDone: true, summary: "Saved “Documents summary.docx”.", doc: null });
      expect(f.json.content).toBe(`# Documents summary\n\n## A.pdf\n\n${SECTION} 0\n\n## ${SECRET_FILE}\n\n${SECTION} 1\n\n## Not read\n\n- C.pdf: too big`);
      expect(String(f.json.html)).toContain("<h1>");
      const done = await row(t.id);
      expect(done).toMatchObject({ status: "done", steps: null, lines: null, scope: null });
      expect(done.units).toBe(1);
      expect(JSON.stringify(done)).not.toContain(SECTION);
      expect(JSON.stringify(done)).not.toContain(SECRET_FILE);
      expect(await count("SELECT units AS n FROM assistant_task_units WHERE task_id = $1", [t.id])).toBe(1);
    });
    it("one piece on all of them (per_file false): composed from the notes, deliver only", async () => {
      const t = await folderPlan({ per_file: false, output_format: "md", output_name: "Invoices overview.md", job: "write one overview of all of them" });
      model.msgs = [deliverSection("Note one.")];
      expect((await act(ada, t.id, "folder", textFile(0, 0, "A.pdf"))).status).toBe(200);
      model.msgs = [deliver("# Overview\n\nAll fine.", "I've written one overview of them.")];
      const f = await act(ada, t.id, "folder/finish", { version: 1, i: 0, sections: [{ title: "A.pdf", markdown: "Note one." }], skipped: [] });
      expect(f.status, JSON.stringify(f.json)).toBe(200);
      expect(f.json).toMatchObject({ status: "done", content: "# Overview\n\nAll fine.", format: "md", name: "Invoices overview.md", html: null, planDone: true });
      const call = model.calls.filter((c) => c.kind === "stream").pop()!.args;
      expect((call.tools as { name: string }[]).map((x) => x.name)).toEqual(["deliver"]);
      const content = (call.messages as { content: { type: string; title?: string; source?: { data: string } }[] }[])[0].content;
      expect(content[0]).toMatchObject({ type: "document", title: "Your notes on each file", source: { data: "## A.pdf\n\nNote one." } });
    });
    it("a private Boredroom document", async () => {
      const t = await folderPlan({ output_format: "doc" });
      model.msgs = [deliverSection("Section.")];
      expect((await act(ada, t.id, "folder", textFile(0, 0, "A.pdf"))).status).toBe(200);
      const f = await act(ada, t.id, "folder/finish", { version: 1, i: 0, sections: [{ title: "A.pdf", markdown: "Section." }], skipped: [] });
      expect(f.json).toMatchObject({ status: "done", content: "", format: "doc", name: "Documents summary", planDone: true, summary: "Saved “Documents summary” in Boredroom." });
      expect((f.json.doc as { href: string }).href).toMatch(/^\/app\/company-a\/docs\//);
    });
    it("finishing with sections for more files than it read is refused", async () => {
      const t = await folderPlan();
      model.msgs = [deliverSection("Section.")];
      await act(ada, t.id, "folder", textFile(0, 0, "A.pdf"));
      expect(errorOf(await act(ada, t.id, "folder/finish", { version: 1, i: 0, sections: [{ title: "A.pdf", markdown: "x" }, { title: "B.pdf", markdown: "y" }], skipped: [] }))).toEqual([409, "ACT_FILE"]);
    });
    it("stop between files: the next file answers 409 ACT_ENDED and nothing more is read", async () => {
      const t = await folderPlan();
      expect((await act(ada, t.id, "stop", { version: 1, why: "esc" })).json).toEqual({ status: "stopped" });
      expect(await row(t.id)).toMatchObject({ status: "stopped", steps: null, lines: null, scope: null });
      expect(errorOf(await act(ada, t.id, "folder", textFile(0, 0, "A.pdf")))).toEqual([409, "ACT_ENDED"]);
      expect(model.calls.filter((c) => c.kind === "stream" && (c.args.tools as { name: string }[])[0]?.name === "deliver_section")).toHaveLength(0);
    });
  });

  describe("a screen part in a plan (contract K.4, D.5.5)", () => {
    it("gets only its own goal, and what was done before it; finished completes the plan", async () => {
      const r = await proposePlan(ada, [openApp("Figma"), { kind: "screen", goal: "Make a new design file called Landing v2" }], { plan: "I'll open Figma and make a new design file called Landing v2." });
      const s = await act(ada, r.task.id, "scope", { version: 1, steps: [appFound(0)] });
      expect((s.json.task as TaskViewV2).lines).toEqual(["Open Figma (Applications)", "On your screen: Make a new design file called Landing v2"]);
      expect((await yes(ada, s.json.task as TaskViewV2)).status).toBe(200);
      // The screen part before the open: not its turn.
      await act(ada, r.task.id, "progress", { version: 1, i: 0, ok: true });
      model.act = [{ content: [{ type: "tool_use", id: "f1", name: "finished", input: { summary: "I made the file Landing v2." } }], stop_reason: "tool_use", model: ACT_MODEL, usage }];
      const st = await act(ada, r.task.id, "step", { version: 1, i: 1, step: 0, transcript: null, results: [], screen: { mediaType: "image/jpeg", data: JPEG, width: 40, height: 24 }, pointer: { x: 1, y: 1 }, front: { name: "Figma", bundleId: "com.figma.Desktop" } });
      expect(st.status, JSON.stringify(st.json)).toBe(200);
      expect(st.json).toMatchObject({ status: "finished", planDone: true, summary: "Opened Figma. I made the file Landing v2." });
      const call = model.calls.find((c) => c.kind === "beta")!.args;
      const msgs = call.messages as { role: string; content: unknown }[];
      expect(JSON.stringify(msgs[0])).toContain("Your part of it now: \\\"Make a new design file called Landing v2\\\". Already done before this: opened Figma. Do exactly that part, and nothing else.");
      expect(msgs[1]).toMatchObject({ role: "system", content: expect.stringMatching(/^Reminder: your part of the approved plan is: Make a new design file called Landing v2\. Only that\./) });
      expect(await row(r.task.id)).toMatchObject({ status: "done", steps: null });
    });
    it("plan.step.order for the screen part: without its index, or before the open", async () => {
      const r = await proposePlan(ada, [openApp("Figma"), { kind: "screen", goal: "Make a new design file called Landing v2" }], { plan: "I'll open Figma and make a new design file called Landing v2." });
      const s = await act(ada, r.task.id, "scope", { version: 1, steps: [appFound(0)] });
      await yes(ada, s.json.task as TaskViewV2);
      expect(errorOf(await act(ada, r.task.id, "step", { version: 1, i: 1, step: 0, transcript: null, results: [], screen: { mediaType: "image/jpeg", data: JPEG, width: 40, height: 24 } }))).toEqual([409, "ACT_STEP_ORDER"]);
      expect(model.calls.filter((c) => c.kind === "beta")).toHaveLength(0);
    });
  });

  describe("refusals and offers (contract 0.5, D.2.4, 0b.4)", () => {
    it("every route refuses a plan before its yes (403 ACT_NOT_CONFIRMED), from the web (403), and someone else's (404)", async () => {
      const r = await proposePlan(ada, [openUrl(URL_MARK)], { plan: "I'll open the board in your browser." });
      expect(r.task).toMatchObject({ needsScope: false, lines: ["Open heron-55.example.com/board in your browser"] });
      expect(errorOf(await act(ada, r.task.id, "progress", { version: 1, i: 0, ok: true }))).toEqual([403, "ACT_NOT_CONFIRMED"]);
      expect(errorOf(await act(ada, r.task.id, "run", { version: 1, i: 0 }))).toEqual([403, "ACT_NOT_CONFIRMED"]);
      expect(errorOf(await act(ada, r.task.id, "progress", { version: 1, i: 0, ok: true }, { web: true }))).toEqual([403, "ACT_DESKTOP_ONLY"]);
      expect(errorOf(await act(ben, r.task.id, "progress", { version: 1, i: 0, ok: true }))).toEqual([404, "ACT_NOT_FOUND"]);
      expect((await yes(ada, r.task)).status).toBe(200);
      // An open the Mac couldn't do ends the plan with its words.
      const p = await act(ada, r.task.id, "progress", { version: 1, i: 0, ok: false, error: "refused" });
      expect(p.json).toEqual({ status: "failed", planDone: false, summary: "Couldn't: macOS wouldn't open it" });
      expect(errorOf(await act(ada, r.task.id, "progress", { version: 1, i: 0, ok: true }))).toEqual([409, "ACT_ENDED"]);
    });
    // Review, 12 October 2026 (permission-1): every word that goes out is in the line, the ask and its hash; a change too
    // long for one line is never bound and keeps its own Confirm card.
    it("an outward change's line, ask and step hash carry its whole text", async () => {
      const body = "The launch deck is final: slides 4 to 9 changed, the pricing table is new, and the demo video opens the talk.";
      const r = await proposePlan(ada, [{ kind: "boredroom", change: 1 }], {
        plan: "I'll message Ben about the deck.",
        before: [tool("send_message", { to: "Ben Employee", body })],
        question: `${MARKER} message Ben about the deck`,
      });
      expect(r.task.lines![0]).toContain(`“${body}”`);
      expect(r.task.lines![0].endsWith("(I'll ask again before it goes)")).toBe(true);
      expect((r.task.steps[0] as { summary: string }).summary).toContain(body);
      expect((await yes(ada, r.task)).status).toBe(200);
      const ask = await act(ada, r.task.id, "run", { version: 1, i: 0 });
      const what = (ask.json.ask as { what: string }).what;
      expect(what).toContain(`‘${body}’`);
      expect(what).not.toContain("…");
      // A yes to a cut-off version is refused: the hash is over the whole of it.
      const cut = `go ahead with “${what.slice(15, 140)}…”`;
      expect(errorOf(await act(ada, r.task.id, "step-answer", { version: 1, answer: "yes", via: "button", askSha256: sha256(Buffer.from(cut, "utf8")) }))).toEqual([409, "ACT_PLAN"]);
    });
    it("a change too long to show whole stays its own Confirm card, and the model is told to propose without it", async () => {
      const before = await count("SELECT count(*)::int AS n FROM assistant_tasks");
      const body = "x ".repeat(150).trim();
      model.msgs = [
        tool("send_message", { to: "Ben Employee", body }, "tu_msg"),
        tool("propose_task", { plan: "I'll open Figma and message Ben.", risky: true, steps: [openApp("Figma"), { kind: "boredroom", change: 1 }] }, "tu_long"),
        say("That message is long, so it has its own Confirm button."),
      ];
      const r = await look(ada, v2({}, `${MARKER} open Figma and message Ben`));
      expect(r.lines.some((l) => l.t === "propose")).toBe(false);
      const msgs = model.calls[2].args.messages as { content: { content: string }[] }[];
      expect(JSON.parse(msgs[msgs.length - 1].content[0].content).error).toBe("Not proposed: change 1 is too long to show in full in the plan, and every word must be seen before the yes. Call propose_task again without it (it keeps its own Confirm button under your reply), or tell them in one sentence.");
      const result = r.lines[r.lines.length - 1].result as { proposals: { kind: string }[] };
      expect(result.proposals.filter((p) => p.kind === "confirm")).toHaveLength(1);
      expect(await count("SELECT count(*)::int AS n FROM assistant_tasks")).toBe(before);
    });
    it("plan.propose.refuses_switches_off_with_enable: the model hears which switch, the reply carries enable, no row", async () => {
      const before = await count("SELECT count(*)::int AS n FROM assistant_tasks");
      model.msgs = [tool("propose_task", { plan: "I'll open Figma.", risky: false, steps: [openApp("Figma")] }, "tu_off"), say("“Do things when I ask” is off on this Mac. Press Turn it on below.")];
      const r = await look(ada, v2({ abilities: { useMac: false, fileWork: true, busy: null, plans: 1, accessibility: true } }, `${MARKER} open Figma`));
      expect(r.lines.some((l) => l.t === "propose")).toBe(false);
      const result = r.lines[r.lines.length - 1].result as Record<string, unknown>;
      expect(result.enable).toEqual({ which: "mac" });
      const msgs = model.calls[1].args.messages as { content: { content: string }[] }[];
      expect(JSON.parse(msgs[msgs.length - 1].content[0].content).error).toBe("Not proposed yet: “Do things when I ask” is off on this Mac, and a line under your reply already says so with a Turn it on button. In one short sentence say only what you'll do once it's on (for example \"I'll open Figma as soon as you turn this on.\"); don't name the switch, don't describe the button, and never say you can't do it. Once it's on you'll ask them about this again.");
      expect(await count("SELECT count(*)::int AS n FROM assistant_tasks")).toBe(before);
    });
    it("enable for phase 2's proposals too (today's binary: no plans)", async () => {
      model.msgs = [tool("propose_task", { kind: "file", plan: "I'll summarise the Q3 report.", risky: false, file_source: "finder_selection", file_name: "Q3 report.pdf", output_format: "md", output_name: "" }), say("Turn on Work on my files first.")];
      const r = await look(ada, v2({ abilities: { useMac: true, fileWork: false, busy: null } }, `${MARKER} summarise this report`));
      expect((r.lines[r.lines.length - 1].result as Record<string, unknown>).enable).toEqual({ which: "files" });
    });
    it("offer_setup: a question about turning things on shows Set up; nothing is proposed", async () => {
      model.msgs = [{ content: [{ type: "text", text: "Press Set up and I'll walk you through it." }, { type: "tool_use", id: "tu_os", name: "offer_setup", input: { which: "files" } }], stop_reason: "tool_use", model: LOOK_MODEL, usage }];
      const r = await look(ada, v2({}, "how do I turn on the features so that I can be able to look through my documents and summarise them and maybe open up"));
      const result = r.lines[r.lines.length - 1].result as Record<string, unknown>;
      expect(result).toMatchObject({ setup: { which: "files" }, reply: "Press Set up and I'll walk you through it." });
      expect(model.calls).toHaveLength(1);
      const names = (model.calls[0].args.tools as { name: string }[]).map((x) => x.name);
      expect(names).toContain("offer_setup");
      expect(names).not.toContain("propose_task");
    });
    it("unresolved scope ends the plan with the words to say (and System Settings for a folder macOS refused)", async () => {
      const r = await proposePlan(ada, [openApp("Figma")], { plan: "I'll open Figma." });
      const s = await act(ada, r.task.id, "scope", { version: 1, steps: [{ i: 0, found: null, why: "none" }] });
      seam("server-scope-unresolved.json", s.json);
      expect(s.json).toEqual({ status: "unresolved", message: "I couldn't find an app called “Figma” on this Mac.", settings: null });
      expect(await row(r.task.id)).toMatchObject({ status: "said_no", end_reason: "unresolved", steps: null, lines: null, scope: null });
      const f = await proposePlan(ada, [folderJob()], { plan: "I'll read the documents in your Documents folder and write a summary of each." });
      expect((await act(ada, f.task.id, "scope", { version: 1, steps: [{ i: 0, found: null, why: "denied" }] })).json).toEqual({ status: "unresolved", message: "Your Mac hasn't let Brenda into Documents. Allow it in System Settings › Privacy & Security › Files and Folders, then ask me again.", settings: "files" });
    });
    it("the app the Mac found is checked again: Terminal under another name is refused", async () => {
      const r = await proposePlan(ada, [openApp("Shell")], { plan: "I'll open Shell." });
      expect((await act(ada, r.task.id, "scope", { version: 1, steps: [appFound(0, "Terminal", "com.apple.Terminal")] })).json).toEqual({ status: "unresolved", message: "I don't open Terminal. It's one of the apps I never look at or work in.", settings: null });
    });
    it("a scope that isn't what was asked (wrong type, a missing step, a path) is 422 ACT_SCOPE and the plan fails", async () => {
      for (const steps of [[{ i: 0, found: { type: "folder", name: "Applications" } }], [{ i: 0, found: { type: "app", name: "/Applications/Figma.app", bundleId: null, where: "Applications" } }]]) {
        const r = await proposePlan(ada, [openApp("Figma")], { plan: "I'll open Figma." });
        const s = await act(ada, r.task.id, "scope", { version: 1, steps });
        expect([s.status, s.json.code].join(" "), JSON.stringify(steps)).toMatch(/^422 ACT_(SCOPE|INVALID)$/);
        expect((await row(r.task.id)).status).toMatch(/^(failed|proposed)$/);
      }
    });
    it("a plan's step past the first can't be taken without a yes, even by the database", async () => {
      const r = await proposePlan(ada, [openUrl("https://example.com/")], { plan: "I'll open example.com in your browser." });
      await expect(adminQuery("UPDATE assistant_tasks SET step_index = 1 WHERE id = $1", [r.task.id])).rejects.toThrow(/assistant_tasks_progress_needs_yes/);
    });
  });

  describe("privacy (contract 0b.2, K.8)", () => {
    it("RLS: owners and HR read neither the person's plan rows nor their Mac state", async () => {
      expect((await mac(ada, { version: 1, state: macState, setupSeen: null })).json).toEqual({ saved: true, ready: true });
      const theirs = await adminQuery<{ id: string }>("SELECT id FROM assistant_tasks WHERE membership_id = $1 AND kind = 'plan' LIMIT 1", [ada.membership.id]);
      expect(theirs.length).toBe(1);
      for (const c of [owner, hr, ben]) {
        expect(await appQueryAs(c.user.profileId, "SELECT id FROM assistant_tasks WHERE id = $1", [theirs[0].id])).toEqual([]);
        expect(await appQueryAs(c.user.profileId, "SELECT screen_help_macs FROM assistant_private WHERE membership_id = $1", [ada.membership.id])).toEqual([]);
      }
      expect((await appQueryAs(ada.user.profileId, "SELECT jsonb_array_length(screen_help_macs) AS n FROM assistant_private WHERE membership_id = $1", [ada.membership.id]))[0]).toEqual({ n: 1 });
    });
    it("the purge stops a plan five minutes past its wall clock (15 minutes when it reads files)", async () => {
      const r = await proposePlan(ada, [openUrl("https://example.com/")], { plan: "I'll open example.com in your browser." });
      await yes(ada, r.task);
      await adminQuery("UPDATE assistant_tasks SET confirmed_at = now() - interval '14 minutes' WHERE id = $1", [r.task.id]);
      await purgeTasks();
      expect(await row(r.task.id)).toMatchObject({ status: "running" });
      await adminQuery("UPDATE assistant_tasks SET confirmed_at = now() - interval '16 minutes' WHERE id = $1", [r.task.id]);
      await purgeTasks();
      expect(await row(r.task.id)).toMatchObject({ status: "stopped", stopped_by: "timeout", steps: null });
      // A plan that reads files has 15 minutes: at 16 it still runs.
      const f = await proposePlan(ada, [folderJob()], { plan: "I'll read the documents in your Documents folder and write a summary of each." });
      const s = await act(ada, f.task.id, "scope", { version: 1, steps: [filesFound(0, ["A.pdf"])] });
      await yes(ada, s.json.task as TaskViewV2);
      await adminQuery("UPDATE assistant_tasks SET confirmed_at = now() - interval '16 minutes' WHERE id = $1", [f.task.id]);
      await purgeTasks();
      expect(await row(f.task.id)).toMatchObject({ status: "running" });
    });
    it("the logs carry no words, names, lines, sections, URLs or plans", () => {
      const all = logs.join("\n");
      for (const s of [MARKER, SECRET_FILE, SECTION, URL_MARK, "heron-55", "I'll open Figma", "Review the Figma file", "Documents summary", "Landing v2"]) expect(all, s).not.toContain(s);
    });
  });
});
