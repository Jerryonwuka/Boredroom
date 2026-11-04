/**
 * The Browser helper on the server, end to end (owner decisions, 4 November 2026: phase 2, "go with your
 * recommendations"; permission rule v2): before migration 0070 the router doesn't offer browser jobs; with it, a browser
 * job starts only from the router's token for the person's own request (Brenda in Chrome connected on that Mac); its loop
 * runs to done; a click that pays is asked about alone, held until the person's yes for exactly that call, and comes back
 * without asking the model again; a result for an asked call without that yes ends the job; a no ends it; the Files
 * helper's step and the Browser helper's never take each other's jobs; costs go to the 'web' kind. Scripted model only.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type Msg = { content: Record<string, unknown>[]; stop_reason: string; model?: string; usage?: Record<string, number> };
const model = vi.hoisted(() => ({ msgs: [] as Msg[], act: [] as Msg[], calls: [] as { kind: "create" | "beta"; args: Record<string, unknown> }[] }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    constructor(_o: Record<string, unknown>) { void _o; }
    messages = {
      create: async (args: Record<string, unknown>) => {
        model.calls.push({ kind: "create", args: structuredClone(args) });
        const next = model.msgs.shift();
        if (!next) throw Object.assign(new Error("nothing"), { status: 500 });
        return next;
      },
    };
    beta = { messages: { create: async (args: Record<string, unknown>) => {
      model.calls.push({ kind: "beta", args: structuredClone(args) });
      const next = model.act.shift();
      if (!next) throw Object.assign(new Error("nothing"), { status: 500 });
      return next;
    } } };
  },
}));
const reqState = vi.hoisted(() => ({ bearer: null as string | null }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(reqState.bearer ? { authorization: `Bearer ${reqState.bearer}` } : {}),
}));

import { resetTestDatabase, adminQuery } from "../helpers/db";
import { buildCompany, type CompanyFixture } from "@/server/services/fixtures";
import { startLink, approveLink, pollLink } from "@/server/services/desktop";
import { forget0057 } from "@/server/lib/schema-0057";
import { forget0058 } from "@/server/lib/schema-0058";
import { forget0059 } from "@/server/lib/schema-0059";
import { forget0060 } from "@/server/lib/schema-0060";
import { forget0070 } from "@/server/lib/schema-0070";
import { readNdjson, type NdjsonLine } from "@/server/lib/ndjson";
import { settleFrontWrites } from "@/server/services/front";
import { webCallSha } from "@/server/services/jobs";
import type { OrgContext } from "@/server/lib/api";
import type { ActMessage } from "@/server/services/act-model";
import { POST as frontPOST } from "@/app/api/orgs/[org]/assistant/front/route";
import { POST as jobsPOST } from "@/app/api/orgs/[org]/assistant/jobs/route";
import { POST as filesStepPOST } from "@/app/api/orgs/[org]/assistant/jobs/[id]/step/route";
import { POST as webStepPOST } from "@/app/api/orgs/[org]/assistant/jobs/[id]/web-step/route";
import { POST as stepAnswerPOST } from "@/app/api/orgs/[org]/assistant/act/[id]/step-answer/route";

const usage = { input_tokens: 1000, output_tokens: 40, cache_read_input_tokens: 500, cache_creation_input_tokens: 0 };
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const SONNET = "claude-sonnet-5-5";
const turn = (...calls: [string, Record<string, unknown>, string][]): Msg => ({
  content: [{ type: "thinking", thinking: "Opening the invoices page", signature: "s" }, ...calls.map(([name, input, id]) => ({ type: "tool_use", id, name, input }))],
  stop_reason: "tool_use", model: SONNET, usage,
});

const saved = { key: process.env.ANTHROPIC_API_KEY, ws: process.env.BRENDA_LOOK_WORKSPACES, helper: process.env.BRENDA_HELPER_MODEL };
let a: CompanyFixture;
let ada: OrgContext;
const tokens = new Map<string, string>();
let nonceN = 1;
const nonce = () => (nonceN++).toString(16).padStart(32, "c");
const org = { org: "company-a" };

async function call<P extends Record<string, string>>(handler: (req: Request, ctx: { params: Promise<P> }) => Promise<Response>, params: P, payload: unknown) {
  const res = await handler(new Request("http://localhost:3000/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }), { params: Promise.resolve(params) });
  if ((res.headers.get("content-type") ?? "").startsWith("application/x-ndjson")) return { status: res.status, lines: await readNdjson(res), json: {} as Record<string, unknown> };
  const text = await res.text();
  return { status: res.status, lines: [] as NdjsonLine[], json: (text ? JSON.parse(text) : {}) as Record<string, unknown> };
}
const as = (c: OrgContext) => { reqState.bearer = tokens.get(c.membership.id) ?? null; };

/** A router turn that starts a browser job, from a Mac whose Chrome is (or isn't) connected. */
async function routed(c: OrgContext, o: { browser?: boolean; helper?: "web" | "files" } = {}) {
  const helper = o.helper ?? "web";
  const input = helper === "web"
    ? { helper, title: "Find the invoice", doing: "Finding the invoice", goal: "Find last month's invoice in my Stripe dashboard." }
    : { helper, title: "Organise your Desktop", doing: "Organising your Desktop", goal: "Organise the files on my Desktop." };
  model.msgs.push({ content: [{ type: "tool_use", id: "tu_r", name: "start_job", input }], stop_reason: "tool_use", model: "claude-haiku-5-5", usage });
  as(c);
  const text = helper === "web" ? "Find last month's invoice in Stripe" : "Organise my desktop";
  const r = await call(frontPOST, org, {
    version: 1, request: { text, via: "typed", ageMs: 300, nonce: nonce(), at: new Date().toISOString() },
    context: { front: null, running: [], files: [], folders: [], abilities: { useMac: true, fileWork: true, accessibility: true, clickConsent: true, screenRecording: true, browser: o.browser ?? true }, pictures: false },
    messages: [{ role: "user", content: text }],
  });
  await settleFrontWrites();
  return r.lines.find((l) => l.t === "route") as Record<string, unknown>;
}
async function startWeb(c: OrgContext): Promise<string> {
  const line = await routed(c);
  expect(line.lane, JSON.stringify(line)).toBe("job");
  as(c);
  const r = await call(jobsPOST, org, { version: 1, token: (line.job as { token: string }).token });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return (r.json.job as { id: string }).id;
}
async function step(c: OrgContext, id: string, payload: Record<string, unknown>, handler = webStepPOST) {
  as(c);
  await adminQuery("UPDATE assistant_tasks SET last_step_at = last_step_at - interval '2 seconds' WHERE id = $1 AND last_step_at IS NOT NULL", [id]);
  return call(handler, { ...org, id }, { version: 1, ...payload });
}
const row = async (id: string) => (await adminQuery<Record<string, unknown>>("SELECT * FROM assistant_tasks WHERE id = $1", [id]))[0];
const START = { profile: "ada@example.com" };

beforeAll(async () => {
  await resetTestDatabase();
  forget0057(); forget0058(); forget0059(); forget0060(); forget0070();
  process.env.ANTHROPIC_API_KEY = "test-env-key-not-real";
  process.env.BRENDA_LOOK_WORKSPACES = "company-a";
  process.env.BRENDA_HELPER_MODEL = SONNET;
  a = await buildCompany("a");
  ada = a.employeeCtx;
  const link = await startLink({ deviceName: "Web Mac" }, { ip: "127.0.20.1", origin: "http://localhost:3000" });
  await approveLink(ada.user, { userCode: link.userCode, orgSlug: ada.org.slug });
  tokens.set(ada.membership.id, ((await pollLink({ deviceCode: link.deviceCode }, { userAgent: "Brenda desktop/test (macos)" })) as { token: string }).token);
});
afterAll(() => {
  for (const [k, v] of [["ANTHROPIC_API_KEY", saved.key], ["BRENDA_LOOK_WORKSPACES", saved.ws], ["BRENDA_HELPER_MODEL", saved.helper]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  reqState.bearer = null;
  forget0070();
});
beforeEach(async () => {
  model.msgs = []; model.act = []; model.calls = [];
  await adminQuery("DELETE FROM auth_rate_limits WHERE bucket LIKE 'ai.burst:%'");
  await adminQuery(`UPDATE assistant_tasks SET status = 'stopped', end_reason = 'stopped', ended_at = now(), request_text = NULL, confirm_text = NULL, pending_ask = NULL, approved_ask = NULL, step_started_at = NULL, paused_at = NULL
                    WHERE status IN ('proposed', 'running', 'asking', 'paused')`);
});

describe("before migration 0070", () => {
  it("the router doesn't offer a browser job: it says the database needs an update", async () => {
    expect(await routed(ada)).toMatchObject({ lane: "refused", reason: "not_ready", message: "Working in Chrome needs a database update first." });
  });
});

describe("with 0070", () => {
  beforeAll(async () => {
    const sql = readFileSync(join(process.cwd(), "db", "pending", "0070_browser_helper.sql"), "utf8");
    await adminQuery(sql);
    await adminQuery(sql); // idempotent
    forget0070();
  });

  it("Brenda in Chrome not connected on that Mac: the notch offers to connect it", async () => {
    expect(await routed(ada, { browser: false })).toMatchObject({ lane: "enable", which: "browser" });
  });

  it("the loop: open and read, then a pay click asked alone, the yes for exactly that call, the held call back, then done", async () => {
    const id = await startWeb(ada);
    expect(await row(id)).toMatchObject({ helper: "web", step_cap: 40, status: "running", authorised_by: "request" });
    model.act = [turn(["open_tab", { url: "https://dashboard.stripe.com/invoices" }, "tu_o"], ["read_page", { tab: "t1", find: "" }, "tu_r"])];
    const s0 = await step(ada, id, { step: 0, transcript: null, results: [], start: START });
    expect(s0.status, JSON.stringify(s0.json)).toBe(200);
    expect(s0.json).toMatchObject({ status: "act", calls: [{ id: "tu_o", name: "open_tab", input: { url: "https://dashboard.stripe.com/invoices" } }, { id: "tu_r", name: "read_page", input: { tab: "t1", find: "" } }], approved: null, note: "Opening the invoices page", step: 1 });
    expect(JSON.stringify(model.calls.at(-1)!.args.messages)).toContain("ada@example.com");
    let transcript = s0.json.append as ActMessage[];

    const pay = { tab: "t1", ref: "e9", effect: "pay" };
    model.act = [turn(["click", pay, "tu_pay"])];
    const s1 = await step(ada, id, { step: 1, transcript, results: [
      { id: "tu_o", name: "open_tab", ok: true, out: { tab: "t1", url: "https://dashboard.stripe.com/invoices", title: "Invoices" } },
      { id: "tu_r", name: "read_page", ok: true, out: { url: "https://dashboard.stripe.com/invoices", text: "Pay £42.00", elements: [{ ref: "e9", role: "button", name: "Pay £42.00" }] } },
    ] });
    const callSha256 = webCallSha({ name: "click", input: pay });
    expect(s1.json).toMatchObject({ status: "ask", ask: { kind: "pay", call: { id: "tu_pay", name: "click", input: pay }, callSha256, what: `pay ${callSha256}` } });
    transcript = [...transcript, ...(s1.json.append as ActMessage[])];
    expect(await row(id)).toMatchObject({ status: "asking", pending_ask: { kind: "pay", callSha256 } });

    // While it asks nothing runs; then the yes, bound to exactly that call.
    expect((await step(ada, id, { step: s1.json.step, transcript, results: [{ id: "tu_pay", name: "click", ok: true, out: {} }] })).json).toMatchObject({ code: "ACT_STEP_ASK" });
    as(ada);
    expect((await call(stepAnswerPOST, { ...org, id }, { version: 1, answer: "yes", via: "button", askSha256: sha(`pay ${callSha256}`) })).json).toEqual({ status: "running" });
    const before = model.calls.length;
    const s2 = await step(ada, id, { step: s1.json.step, transcript, results: [], askAnswered: true });
    expect(s2.json).toMatchObject({ status: "act", calls: [{ id: "tu_pay", name: "click", input: pay }], approved: { callSha256 }, append: [] });
    expect(model.calls.length).toBe(before);

    model.act = [turn(["finished", { summary: "I paid last month's invoice." }, "tu_f"])];
    const s3 = await step(ada, id, { step: s1.json.step, transcript, results: [{ id: "tu_pay", name: "click", ok: true, out: { url: "https://dashboard.stripe.com/invoices/paid", title: "Paid", navigated: true } }] });
    expect(s3.json).toMatchObject({ status: "finished", summary: "I paid last month's invoice.", outputs: [] });
    expect(await row(id)).toMatchObject({ status: "done", step_yeses: 1, request_text: null });
    expect(await adminQuery("SELECT kind FROM act_usage_daily WHERE kind = 'web'")).toEqual([{ kind: "web" }]);
  });

  it("a result for an asked call without the person's yes ends the job", async () => {
    const id = await startWeb(ada);
    model.act = [turn(["open_tab", { url: "https://example.com" }, "tu_o"])];
    const s0 = await step(ada, id, { step: 0, transcript: null, results: [], start: START });
    // A Mac that ran a send click on its own: the transcript the server holds says the last turn asked nothing, so build
    // one where it did, as a Mac would only after a yes.
    model.act = [turn(["click", { tab: "t1", ref: "e2", effect: "send" }, "tu_send"])];
    const s1 = await step(ada, id, { step: 1, transcript: s0.json.append, results: [{ id: "tu_o", name: "open_tab", ok: true, out: { tab: "t1" } }] });
    expect(s1.json).toMatchObject({ status: "ask" });
    const transcript = [...(s0.json.append as ActMessage[]), ...(s1.json.append as ActMessage[])];
    await adminQuery("UPDATE assistant_tasks SET status = 'running', pending_ask = NULL WHERE id = $1", [id]);
    const r = await step(ada, id, { step: s1.json.step, transcript, results: [{ id: "tu_send", name: "click", ok: true, out: {} }] });
    expect(r.json).toMatchObject({ code: "JOB_CALL" });
    expect(await row(id)).toMatchObject({ status: "failed" });
  });

  it("a no ends it, and the call never comes back", async () => {
    const id = await startWeb(ada);
    model.act = [turn(["click", { tab: "t1", ref: "e1", effect: "delete" }, "tu_del"])];
    const s0 = await step(ada, id, { step: 0, transcript: null, results: [], start: START });
    const what = (s0.json.ask as { what: string }).what;
    as(ada);
    expect((await call(stepAnswerPOST, { ...org, id }, { version: 1, answer: "no", via: "button", askSha256: sha(what) })).json).toEqual({ status: "stopped" });
    expect(await row(id)).toMatchObject({ status: "stopped", end_reason: "said_no" });
  });

  it("the Files helper's step and the Browser helper's never take each other's jobs", async () => {
    const web = await startWeb(ada);
    expect((await step(ada, web, { step: 0, transcript: null, results: [], start: { candidates: [], folders: [{ ref: "f1", source: "named", name: "desktop", title: "Desktop" }] }, undo: false }, filesStepPOST)).json).toMatchObject({ code: "ACT_INVALID" });
    await adminQuery("UPDATE assistant_tasks SET status = 'stopped', ended_at = now() WHERE id = $1", [web]);
    const line = await routed(ada, { helper: "files" });
    as(ada);
    const files = ((await call(jobsPOST, org, { version: 1, token: (line.job as { token: string }).token })).json.job as { id: string }).id;
    expect((await step(ada, files, { step: 0, transcript: null, results: [], start: START })).json).toMatchObject({ code: "ACT_INVALID" });
  });
});
