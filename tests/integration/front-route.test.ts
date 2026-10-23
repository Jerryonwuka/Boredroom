/**
 * Brenda's front desk on the server, end to end (Brenda and her helpers, build 1; owner's approved brief, 12 October
 * 2026; permission rule v2 the same day, verbatim: "when you hold the keys and clearly ask for a routine task, the
 * request is the permission, and she does it. She still asks before anything destructive, anything sent, anything that
 * costs money, or anything sensitive"; contract B.4, B.5, E, J, K.5, M.2, N.2, O, R.9).
 *
 * As Brenda for Mac calls it (a desktop session's bearer token): before 0060 nothing new answers; then the router's gates
 * (web session, staleness, a nonce used twice, a body that can't be read, today's limit), every lane of the brief's
 * everyday table with a scripted model (never a picture to the router), the record written after the answer, the model's
 * errors in words people can act on; the Mac's own records (upserts, never a downgrade, the typed text never kept); the
 * person's "Check with me before every task" (theirs alone; their own to-dos then wait for Confirm); the one-trip Mac
 * context; the first short line's offer; and looks from a front-capable Mac (the quick model, think harder, their own
 * to-do at once with Undo, never propose_task).
 *
 * Local throwaway database only (TEST_DATABASE_URL): 0059 and 0060 wait in db/pending and are applied here by hand. The
 * model is a scripted fake (never a network call); pictures are 40×24 test images.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type Msg = { content: Record<string, unknown>[]; stop_reason: string; model?: string; usage?: Record<string, number> };
const model = vi.hoisted(() => ({ msgs: [] as Msg[], act: [] as Msg[], calls: [] as { kind: "create" | "stream" | "beta"; args: Record<string, unknown> }[], fail: [] as Error[] }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    constructor(_o: Record<string, unknown>) { void _o; }
    messages = {
      create: async (args: Record<string, unknown>) => {
        model.calls.push({ kind: "create", args: structuredClone(args) });
        const f = model.fail.shift();
        if (f) throw f;
        const next = model.msgs.shift();
        if (!next) throw Object.assign(new Error("the fake model has nothing more to say"), { status: 500 });
        return next;
      },
      stream: (args: Record<string, unknown>) => {
        model.calls.push({ kind: "stream", args: structuredClone(args) });
        const next = model.msgs.shift();
        const fail = model.fail.shift();
        async function* events() {
          if (fail) throw fail;
          if (!next) throw Object.assign(new Error("nothing"), { status: 500 });
          for (const [index, b] of next.content.entries()) {
            if (b.type !== "text") continue;
            for (const piece of String(b.text).match(/[\s\S]{1,7}/g) ?? []) yield { type: "content_block_delta", index, delta: { type: "text_delta", text: piece } };
          }
        }
        const it = events();
        return { [Symbol.asyncIterator]: () => it, finalMessage: async () => { if (fail) throw fail; if (!next) throw Object.assign(new Error("nothing"), { status: 500 }); return next; } };
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

const reqState = vi.hoisted(() => ({ cookie: null as string | null, bearer: null as string | null }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "boredroom_session" && reqState.cookie ? { name, value: reqState.cookie } : undefined) }),
  headers: async () => new Headers(reqState.bearer ? { authorization: `Bearer ${reqState.bearer}` } : {}),
}));

import pg from "pg";
import { resetTestDatabase, adminQuery, appQueryAs } from "../helpers/db";
import { buildCompany, type CompanyFixture } from "@/server/services/fixtures";
import { withSystem } from "@/server/db";
import { issueSession } from "@/server/auth";
import { startLink, approveLink, pollLink, desktopState } from "@/server/services/desktop";
import { forget0057 } from "@/server/lib/schema-0057";
import { forget0058 } from "@/server/lib/schema-0058";
import { forget0059 } from "@/server/lib/schema-0059";
import { forget0060 } from "@/server/lib/schema-0060";
import { readNdjson, type NdjsonLine } from "@/server/lib/ndjson";
import { macContext } from "@/server/lib/mac-context";
import { frontGate, settleFrontWrites } from "@/server/services/front";
import { listActivity } from "@/server/services/assistant-activity";
import type { OrgContext } from "@/server/lib/api";
import { POST as frontPOST, GET as frontGET } from "@/app/api/orgs/[org]/assistant/front/route";
import { POST as recordPOST } from "@/app/api/orgs/[org]/assistant/front/record/route";
import { POST as linePOST } from "@/app/api/orgs/[org]/assistant/front/line/route";
import { GET as permGET, PUT as permPUT } from "@/app/api/orgs/[org]/brenda/mac-permission/route";
import { GET as jobsGET } from "@/app/api/orgs/[org]/brenda/jobs/route";
import { DELETE as requestDELETE } from "@/app/api/orgs/[org]/brenda/activity/requests/[id]/route";
import { POST as lookPOST } from "@/app/api/orgs/[org]/assistant/look/route";

const JPEG = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAYACgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD6D1/WbfQ7NLm7SV43kEYEQBOSCe5HpXP/APCw9J/5977/AL4T/wCKo+Kn/IvW/wD19L/6A9eWV8rm+b4jCYh0qTVrLofWZPk+GxeGVWqne76ns2geKrHXLx7a0iuUkSMyEyqoGAQOxPrW/Xlnwr/5GG4/69W/9DSvU69fKMVUxeHVWrvdnj5xhKeExLpUtrIKKKK9M8sKKKKACiiigAooooA//9k=";
const LOOK_MODEL = "claude-look-pilot-test";
const usage = { input_tokens: 600, output_tokens: 20, cache_read_input_tokens: 300, cache_creation_input_tokens: 0 };
const tool = (name: string, input: Record<string, unknown>, o: { model?: string; id?: string } = {}): Msg => ({ content: [{ type: "tool_use", id: o.id ?? `tu_${name}_${Math.random().toString(36).slice(2, 7)}`, name, input }], stop_reason: "tool_use", model: o.model ?? "claude-haiku-5-5", usage });
const say = (text: string, m = LOOK_MODEL): Msg => ({ content: [{ type: "text", text }], stop_reason: "end_turn", model: m, usage });
const blank = { app: "", app2: "", url: "", folder: { source: "none", name: "" }, words: [], kinds: [], since_days: 0, pick: "none", text: "", level: 0, change: "none", side: "none", on: false };
const doOnMac = (...actions: Record<string, unknown>[]) => tool("do_on_mac", { actions: actions.map((x) => ({ ...blank, ...x })) });
const seam = (name: string, value: unknown) => { if (process.env.ACT_SEAM_DIR) writeFileSync(join(process.env.ACT_SEAM_DIR, name), typeof value === "string" ? value : JSON.stringify(value)); };
const ndjsonOf = (lines: NdjsonLine[]) => lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
const pending = (f: string) => readFileSync(join(process.cwd(), "db", "migrations", f), "utf8");

const saved = { key: process.env.ANTHROPIC_API_KEY, ws: process.env.BRENDA_LOOK_WORKSPACES, look: process.env.BRENDA_LOOK_MODEL };
let a: CompanyFixture;
let ada: OrgContext, ben: OrgContext, owner: OrgContext;
const tokens = new Map<string, string>();
const webTokens = new Map<string, string>();
const logs: string[] = [];
let nonceN = 1;
const nonce = () => (nonceN++).toString(16).padStart(32, "a");

async function linkDesktop(c: OrgContext, n: number): Promise<string> {
  const link = await startLink({ deviceName: `Front Mac ${n}` }, { ip: `127.0.9.${n}`, origin: "http://localhost:3000" });
  await approveLink(c.user, { userCode: link.userCode, orgSlug: c.org.slug });
  return ((await pollLink({ deviceCode: link.deviceCode }, { userAgent: "Brenda desktop/test (macos)" })) as { token: string }).token;
}
function as(c: OrgContext, web = false) {
  reqState.cookie = web ? webTokens.get(c.membership.id) ?? null : null;
  reqState.bearer = web ? null : tokens.get(c.membership.id) ?? null;
}
const abilities = { useMac: true, fileWork: true, accessibility: true, clickConsent: true, screenRecording: true };
function body(text: string, o: { nonce?: string; ageMs?: number; via?: "voice" | "typed"; pictures?: boolean; abilities?: Partial<typeof abilities>; messages?: { role: string; content: string }[] } = {}) {
  return {
    version: 1,
    request: { text, via: o.via ?? "voice", ageMs: o.ageMs ?? 412, nonce: o.nonce ?? nonce(), at: new Date().toISOString() },
    context: {
      front: { name: "Figma", bundleId: "com.figma.Desktop" }, running: ["Figma", "Slack", "Safari"],
      files: [{ source: "finder_selection", name: "IMG_2041.HEIC", kind: "image", bytes: 2_210_000 }],
      folders: [{ source: "named", name: "desktop" }, { source: "added", name: "Projects" }],
      abilities: { ...abilities, ...(o.abilities ?? {}) }, pictures: o.pictures ?? true,
    },
    messages: o.messages ?? [{ role: "user", content: text }],
  };
}
async function call<P extends Record<string, string>>(handler: (req: Request, ctx: { params: Promise<P> }) => Promise<Response>, method: string, path: string, params: P, payload?: unknown) {
  const res = await handler(new Request(`http://localhost:3000${path}`, { method, headers: payload === undefined ? {} : { "content-type": "application/json" }, body: payload === undefined ? undefined : JSON.stringify(payload) }), { params: Promise.resolve(params) });
  const type = res.headers.get("content-type") ?? "";
  if (type.startsWith("application/x-ndjson")) return { status: res.status, lines: await readNdjson(res), json: null as Record<string, unknown> | null };
  const text = await res.text();
  return { status: res.status, lines: [] as NdjsonLine[], json: text ? JSON.parse(text) as Record<string, unknown> : null };
}
const front = (c: OrgContext, payload: unknown, web = false) => { as(c, web); return call(frontPOST, "POST", `/api/orgs/${c.org.slug}/assistant/front`, { org: c.org.slug }, payload); };
const record = (c: OrgContext, records: unknown[]) => { as(c); return call(recordPOST, "POST", `/api/orgs/${c.org.slug}/assistant/front/record`, { org: c.org.slug }, { version: 1, records }); };
const route = (r: { lines: NdjsonLine[] }) => r.lines.find((l) => l.t === "route") as Record<string, unknown> | undefined;
const requestRow = async (c: OrgContext, n: string) => (await adminQuery<Record<string, unknown>>("SELECT * FROM mac_requests WHERE membership_id = $1 AND nonce = $2", [c.membership.id, n]))[0];

beforeAll(async () => {
  for (const k of ["error", "warn", "log", "info"] as const) vi.spyOn(console, k).mockImplementation((...args: unknown[]) => { logs.push(args.map((x) => (typeof x === "string" ? x : x instanceof Error ? x.message : JSON.stringify(x))).join(" ")); });
  await resetTestDatabase();
  forget0057(); forget0058(); forget0059(); forget0060();
  process.env.ANTHROPIC_API_KEY = "test-env-key-not-real"; // never sent anywhere: the SDK is the fake above
  process.env.BRENDA_LOOK_WORKSPACES = "company-a";
  process.env.BRENDA_LOOK_MODEL = LOOK_MODEL;
  a = await buildCompany("a");
  ada = a.employeeCtx; ben = a.employee2Ctx; owner = a.ownerCtx;
  let n = 1;
  for (const c of [owner, a.hrCtx, ada, ben, a.managerCtx]) {
    tokens.set(c.membership.id, await linkDesktop(c, n++));
    webTokens.set(c.membership.id, await withSystem((db) => issueSession(db, c.user.authUserId, { method: "password" })));
  }
});

afterAll(() => {
  for (const [k, v] of [["ANTHROPIC_API_KEY", saved.key], ["BRENDA_LOOK_WORKSPACES", saved.ws], ["BRENDA_LOOK_MODEL", saved.look]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  reqState.cookie = null; reqState.bearer = null;
  forget0059(); forget0060();
  vi.restoreAllMocks();
});

beforeEach(async () => {
  model.msgs = []; model.act = []; model.calls = []; model.fail = [];
  await adminQuery("DELETE FROM auth_rate_limits WHERE bucket LIKE 'ai.burst:%'");
});

// Skipped (security audit verification, 23 October 2026): the migration now ships in db/migrations, so the test reset applies it and there is no "before" to test.
describe.skip("before 0060: nothing new answers, nothing breaks (contract E.2)", () => {
  it("the front desk 503s, the record says not ready, Jobs and the switch say not ready, the desktop state's front is not ready", async () => {
    expect(await front(ada, body("Open the Q3 deck"))).toMatchObject({ status: 503, json: { code: "FRONT_NOT_READY", message: "This needs a database update first." } });
    expect((await record(ada, [{}])).json).toEqual({ saved: 0, ready: false });
    as(ada, true);
    expect((await call(jobsGET, "GET", "/x", { org: "company-a" })).json).toEqual({ ready: false, jobs: [] });
    expect((await call(permGET, "GET", "/x", { org: "company-a" })).json).toEqual({ ready: false, checkEveryTask: false, impersonated: false });
    expect((await call(permPUT, "PUT", "/x", { org: "company-a" }, { checkEveryTask: true })).json).toMatchObject({ code: "FRONT_NOT_READY" });
    const s = await desktopState(ada);
    expect(s.look.front).toEqual({ ready: false, checkEvery: false });
    expect(model.calls).toEqual([]);
  });

  it("then 0059 and 0060 are applied by hand", async () => {
    await adminQuery(pending("0059_mac_help.sql"));
    await adminQuery(pending("0060_helpers.sql"));
    forget0059(); forget0060();
    const s = await desktopState(ada);
    expect(s.look.front).toEqual({ ready: true, checkEvery: false });
  });
});

describe("the router's gates (contract B.4, 0.5)", () => {
  it("front.route.refuses_web_session: 403 FRONT_DESKTOP_ONLY, the model never asked", async () => {
    expect(await front(ada, body("Open the Q3 deck"), true)).toMatchObject({ status: 403, json: { code: "FRONT_DESKTOP_ONLY" } });
    expect(model.calls).toEqual([]);
  });
  it("front.route.refuses_impersonated: 403 FRONT_IMPERSONATED", async () => {
    as(ada);
    const mc = await macContext("company-a");
    const imp = { ...mc, ctx: { ...mc.ctx, user: { ...mc.ctx.user, impersonation: { id: "00000000-0000-4000-8000-0000000000ad", adminEmail: "support@boredroom.test" } } } };
    expect(() => frontGate(imp)).toThrow(expect.objectContaining({ code: "FRONT_IMPERSONATED" }));
  });
  it("front.route.refuses_stale_request (> 30 s) and an unreadable body, nothing from it in the answer", async () => {
    expect(await front(ada, body("Open the Q3 deck", { ageMs: 31_000 }))).toMatchObject({ status: 409, json: { code: "FRONT_STALE" } });
    const bad = body("Open the Q3 deck ZEBRA-4410");
    bad.messages = [{ role: "user", content: "something else" }];
    const r = await front(ada, bad);
    expect(r).toMatchObject({ status: 422, json: { code: "FRONT_INVALID", message: "That request couldn't be read." } });
    expect(JSON.stringify(r.json)).not.toContain("ZEBRA");
    expect(model.calls).toEqual([]);
  });
  it("front.route.refuses_reused_nonce: 409 FRONT_REPLAY once the request is recorded", async () => {
    const n = nonce();
    model.msgs = [doOnMac({ kind: "mute" })];
    expect((await front(ada, body("Mute the sound", { nonce: n }))).status).toBe(200);
    await settleFrontWrites();
    expect(await front(ada, body("Mute the sound", { nonce: n }))).toMatchObject({ status: 409, json: { code: "FRONT_REPLAY" } });
    expect(model.calls).toHaveLength(1);
  });
  it("front.route.never_sees_pictures: one Haiku call, forced tool, no thinking, text only, the rules cached", async () => {
    model.msgs = [doOnMac({ kind: "open_file", words: ["Q3"], kinds: ["presentation"], pick: "ask" })];
    const r = await front(ada, body("Open the Q3 deck"));
    seam("server-front-route-mac.ndjson", ndjsonOf(r.lines));
    expect(r.status).toBe(200);
    const args = model.calls[0].args;
    expect(args).toMatchObject({ model: "claude-haiku-5-5", max_tokens: 1024, thinking: { type: "disabled" }, output_config: { effort: "low" }, tool_choice: { type: "any", disable_parallel_tool_use: true } });
    expect((args.system as { cache_control?: unknown }[])[0].cache_control).toEqual({ type: "ephemeral" });
    expect(JSON.stringify(args.messages)).not.toMatch(/"type":"image"|base64/);
    expect(args.temperature).toBeUndefined();
    const last = (args.messages as { content: string }[]).at(-1)!.content;
    expect(last).toContain("Their words (voice): \"Open the Q3 deck\"");
  });
  it("today's limit: 429 AI_LIMIT before the model is asked", async () => {
    await adminQuery(`INSERT INTO ai_usage(organisation_id, membership_id, purpose, model, request_id, input_tokens, output_tokens)
                      SELECT $1, $2, 'chat', 'x', gen_random_uuid(), 1, 1 FROM generate_series(1, 150)`, [ben.org.id, ben.membership.id]);
    const r = await front(ben, body("Open the Q3 deck"));
    expect(r).toMatchObject({ status: 429, json: { code: "AI_LIMIT" } });
    expect(String(r.json?.message)).toContain("Simple things like “open Figma” still work.");
    expect(model.calls).toEqual([]);
    await adminQuery("DELETE FROM ai_usage WHERE membership_id = $1", [ben.membership.id]);
  });
});

describe("the brief's everyday table through the router (B.5, with a scripted model)", () => {
  it("Open the Q3 deck: a Mac search, routine; recorded as pending until the Mac says what happened", async () => {
    const n = nonce();
    model.msgs = [doOnMac({ kind: "open_file", words: ["Q3"], kinds: ["presentation"], pick: "ask" })];
    const r = await front(ada, body("Open the Q3 deck", { nonce: n }));
    expect(r.lines.map((l) => l.t)).toEqual(["route", "done"]);
    expect(route(r)).toMatchObject({ lane: "mac", risk: "routine", actions: [{ kind: "open_file", words: ["Q3"], kinds: ["presentation"], pick: "ask" }] });
    await settleFrontWrites();
    expect(await requestRow(ada, n)).toMatchObject({ lane: "mac", matched: "router", risk: "routine", authorised_by: "request", outcome: "pending", request_text: "Open the Q3 deck", source: "voice" });
  });
  it("Go to stripe.com opens (banking and payment pages too); Turn off Wi-Fi asks", async () => {
    model.msgs = [doOnMac({ kind: "open_url", url: "stripe.com" })];
    expect(route(await front(ada, body("Go to stripe.com please")))).toMatchObject({ lane: "mac", risk: "routine", actions: [{ url: "https://stripe.com/" }] });
    model.msgs = [doOnMac({ kind: "wifi", on: false })];
    expect(route(await front(ada, body("Can you turn off the wifi")))).toMatchObject({ lane: "mac", risk: "ask" });
  });
  it("Remind me at 3 to call Ada: their own reminder, at once, with Undo", async () => {
    const at = new Date(Date.now() + 3 * 3600_000).toISOString();
    model.msgs = [tool("remind_me", { body: "Call Ada", at })];
    const r = await front(ada, body("Remind me at 3 to call Ada"));
    expect(route(r)).toEqual({ t: "route", lane: "boredroom" });
    const done = r.lines.at(-1)!.result as { actions: { kind: string; summary: string; undo?: unknown }[]; proposals: unknown[]; reply: string; spoken: string };
    seam("server-front-route-boredroom.ndjson", ndjsonOf(r.lines));
    expect(done.actions).toHaveLength(1);
    expect(done.actions[0]).toMatchObject({ kind: "reminder" });
    expect(done.actions[0].summary).toMatch(/^Reminder set for .*: Call Ada$/);
    expect(done.actions[0].undo).toBeTruthy();
    expect(done.proposals).toEqual([]);
    expect(await adminQuery("SELECT 1 FROM brenda_reminders WHERE membership_id = $1 AND body = 'Call Ada'", [ada.membership.id])).toHaveLength(1);
  });
  it("Organise my desktop: a job token, the doing line said, nothing started yet", async () => {
    model.msgs = [tool("start_job", { helper: "files", title: "Organise your Desktop", doing: "Organising your Desktop", goal: "Organise the files on my Desktop." })];
    const r = await front(ada, body("Organise my desktop"));
    seam("server-front-route-job.ndjson", ndjsonOf(r.lines));
    const l = route(r) as { lane: string; job: { token: string; needs: unknown; helper: string }; say: string };
    expect(l).toMatchObject({ lane: "job", say: "Organising your Desktop.", job: { helper: "files", title: "Organise your Desktop", needs: { consent: false, yes: false } } });
    expect(l.job.token.length).toBeGreaterThan(40);
    expect(await adminQuery("SELECT 1 FROM assistant_tasks WHERE kind = 'job'")).toHaveLength(0);
  });
  it("Add this to my to-dos for Friday: a look (the router never sees the picture); without one, Use my screen", async () => {
    model.msgs = [tool("look", { lane: "now" })];
    const r = await front(ada, body("Add this to my to-dos for Friday"));
    seam("server-front-route-look.ndjson", ndjsonOf(r.lines));
    expect(route(r)).toEqual({ t: "route", lane: "look", look: { lane: "now" } });
    model.msgs = [tool("look", { lane: "think" })];
    expect(route(await front(ada, body("Explain this to me", { pictures: false })))).toEqual({ t: "route", lane: "look", look: { lane: "now" }, screen: true });
  });
  it("an unclear request: one short question; a switch that is off: enable; a bad address: refused, fixed words", async () => {
    model.msgs = [tool("ask", { question: "Which deck do you mean?" })];
    const ask = await front(ada, body("Open that thing"));
    seam("server-front-route-ask.ndjson", ndjsonOf(ask.lines));
    expect(route(ask)).toEqual({ t: "route", lane: "ask", question: "Which deck do you mean?" });
    model.msgs = [doOnMac({ kind: "open_app", app: "Figma" })];
    const en = await front(ada, body("Open Figma", { abilities: { useMac: false } }));
    seam("server-front-route-enable.ndjson", ndjsonOf(en.lines));
    expect(route(en)).toEqual({ t: "route", lane: "enable", which: "mac" });
    const n = nonce();
    model.msgs = [doOnMac({ kind: "open_url", url: "https://google.com/url?q=https://evil.example" })];
    const ref = await front(ada, body("Go to that link", { nonce: n }));
    seam("server-front-route-refused.ndjson", ndjsonOf(ref.lines));
    expect(route(ref)).toEqual({ t: "route", lane: "refused", reason: "bad_url", message: "I can't open that address. Only ordinary web pages, never downloads of apps or scripts." });
    await settleFrontWrites();
    expect(await requestRow(ada, n)).toMatchObject({ outcome: "refused", risk: "never" });
    // Review, 16 October 2026: the Mac can't turn the refused row into a routine one that ran.
    expect((await record(ada, [{ nonce: n, text: "Go to that link", via: "voice", at: new Date().toISOString(), matched: "mac", lane: "mac", risk: "routine", authorisedBy: "request", confirmedVia: null,
      actions: [{ kind: "open_url", outcome: "done", words: "Opened google.com" }], outcome: "done", summary: "Opened google.com", undo: { available: false } }])).json).toEqual({ saved: 0, ready: true });
    expect(await requestRow(ada, n)).toMatchObject({ outcome: "refused", risk: "never" });
  });
  it("Message Ada that I'm done: the Boredroom chat; the person's own chat answers", async () => {
    model.msgs = [tool("boredroom", { why: "sends" }), say("I can send that once you confirm.", "claude-chat")];
    const r = await front(ada, body("Message Ben that I'm done"));
    expect(route(r)).toEqual({ t: "route", lane: "boredroom" });
    expect(r.lines.at(-1)).toMatchObject({ t: "done", result: { reply: "I can send that once you confirm.", engine: "claude" } });
  });
  it("a refusal from the model is 'I can't help with that one.'", async () => {
    model.msgs = [{ content: [], stop_reason: "refusal", model: "claude-haiku-5-5", usage }];
    expect(route(await front(ada, body("Do something awful")))).toEqual({ t: "route", lane: "ask", question: "I can't help with that one." });
  });
});

describe("the model's errors, in words people can act on (contract L.2, O.3)", () => {
  it("out of credit: 503 AI_NO_CREDIT; busy twice: 503 AI_BUSY after one retry; anything else: 502 AI_FAILED; only codes logged", async () => {
    logs.length = 0;
    model.fail = [Object.assign(new Error("Your credit balance is too low to access the Anthropic API."), { status: 400 })];
    expect(await front(ada, body("Organise my desktop"))).toMatchObject({ status: 503, json: { code: "AI_NO_CREDIT", message: "Boredroom's AI account has run out of credit. Simple things like “open Figma” still work." } });
    model.fail = [Object.assign(new Error("overloaded"), { status: 529 }), Object.assign(new Error("overloaded"), { status: 529 })];
    expect(await front(ada, body("Organise my desktop"))).toMatchObject({ status: 503, json: { code: "AI_BUSY" } });
    model.fail = [Object.assign(new Error("overloaded"), { status: 529 })];
    model.msgs = [doOnMac({ kind: "mute" })];
    expect((await front(ada, body("Mute it"))).status).toBe(200);
    model.fail = [new TypeError("fetch failed")];
    expect(await front(ada, body("Organise my desktop"))).toMatchObject({ status: 502, json: { code: "AI_FAILED" } });
    expect(logs.join("\n")).not.toMatch(/Organise|desktop|credit balance/);
  }, 20_000);
});

describe("the Mac's own records (contract E.3)", () => {
  const rec = (o: Record<string, unknown> = {}) => ({
    nonce: nonce(), text: "Open Figma", via: "voice", at: new Date().toISOString(), matched: "mac", lane: "mac", risk: "routine", authorisedBy: "request", confirmedVia: null,
    actions: [{ kind: "open_app", outcome: "done", words: "Opened Figma" }], outcome: "done", summary: "Opened Figma", undo: { available: false }, ...o,
  });
  it("front.record: saved for the person alone; replayed records are upserts", async () => {
    const r1 = rec();
    expect((await record(ada, [r1])).json).toEqual({ saved: 1, ready: true });
    expect((await record(ada, [{ ...r1, outcome: "undone" }])).json).toEqual({ saved: 1, ready: true });
    expect(await requestRow(ada, r1.nonce)).toMatchObject({ outcome: "undone", matched: "mac", lane: "mac", summary: "Opened Figma" });
    expect(await appQueryAs(owner.user.profileId, "SELECT id FROM mac_requests WHERE membership_id = $1", [ada.membership.id])).toHaveLength(0);
  });
  it("a router-made row keeps its words and takes the Mac's outcome; an ask answered yes keeps how", async () => {
    const n = nonce();
    model.msgs = [doOnMac({ kind: "wifi", on: false })];
    await front(ada, body("Turn off the wifi", { nonce: n }));
    await settleFrontWrites();
    // The Mac can't downgrade the server's ask: a 'done' authorised by the request alone is refused. Since review, 16
    // October 2026 the record itself is refused (422): Wi-Fi off asks first, whatever the record says of itself.
    expect(await record(ada, [rec({ nonce: n, text: "something else", matched: "mac", risk: "routine", actions: [{ kind: "wifi", outcome: "done", words: "Wi-Fi is off" }], summary: "Wi-Fi is off" })])).toMatchObject({ status: 422, json: { code: "FRONT_INVALID" } });
    expect(await requestRow(ada, n)).toMatchObject({ outcome: "pending", risk: "ask" });
    expect((await record(ada, [rec({ nonce: n, text: "something else", risk: "ask", authorisedBy: "yes", confirmedVia: "button", actions: [{ kind: "wifi", outcome: "done", words: "Wi-Fi is off" }], summary: "Wi-Fi is off" })])).json).toEqual({ saved: 1, ready: true });
    expect(await requestRow(ada, n)).toMatchObject({ request_text: "Turn off the wifi", matched: "router", outcome: "done", authorised_by: "yes", confirmed_via: "button", risk: "ask" });
  });
  it("bad records are skipped (and alone: 422); a typed text is never kept", async () => {
    expect(await record(ada, [rec({ at: "2020-01-01T00:00:00Z" })])).toMatchObject({ status: 422, json: { code: "FRONT_INVALID" } });
    expect(await record(ada, [rec({ risk: "ask", outcome: "done" })])).toMatchObject({ status: 422 });
    expect(await record(ada, [rec({ actions: [{ kind: "type_text", outcome: "done", words: "running five minutes late" }] })])).toMatchObject({ status: 422 });
    // Review, 16 October 2026: what ran sets the floor. Emptying the Trash or Wi-Fi off "routine, on the request" is
    // refused; with the person's yes (and how) it is kept; Wi-Fi on stays routine.
    expect(await record(ada, [rec({ text: "Empty the Trash", actions: [{ kind: "empty_trash", outcome: "done", words: "The Trash is empty" }] })])).toMatchObject({ status: 422 });
    expect(await record(ada, [rec({ text: "Wifi off", actions: [{ kind: "wifi", outcome: "done", words: "Wi-Fi is off" }] })])).toMatchObject({ status: 422 });
    expect((await record(ada, [rec({ text: "Empty the Trash", risk: "ask", authorisedBy: "yes", confirmedVia: "voice", actions: [{ kind: "empty_trash", outcome: "done", words: "The Trash is empty" }] })])).json).toEqual({ saved: 1, ready: true });
    expect((await record(ada, [rec({ text: "Wifi on", actions: [{ kind: "wifi", outcome: "done", words: "Wi-Fi is on" }] })])).json).toEqual({ saved: 1, ready: true });
    // An ask-first action that didn't run (said no) needs no yes.
    expect((await record(ada, [rec({ text: "Empty the Trash", outcome: "said_no", actions: [{ kind: "empty_trash", outcome: "said_no", words: "" }] })])).json).toEqual({ saved: 1, ready: true });
    const ok = rec({ actions: [{ kind: "type_text", outcome: "done", words: "Typed into Mail" }] });
    expect((await record(ada, [ok, rec({ nonce: "zz" })])).json).toEqual({ saved: 1, ready: true });
    as(ada, true);
    expect(await call(recordPOST, "POST", "/x", { org: "company-a" }, { version: 1, records: [rec()] })).toMatchObject({ status: 403, json: { code: "FRONT_DESKTOP_ONLY" } });
  });
  it("Activity › On your Mac lists the person's requests with their words; Forget deletes one", async () => {
    const r1 = rec({ text: "Hide everything", summary: "Hid everything", actions: [{ kind: "hide_all", outcome: "done", words: "Hid everything" }] });
    await record(ada, [r1]);
    const page = await listActivity(ada, { kind: "mac" });
    const item = page.items.find((i) => i.asked === "Hide everything");
    expect(item).toMatchObject({ tool: "mac_request", summary: "Hid everything", source: "mac" });
    expect((await listActivity(owner, { kind: "mac" })).items.some((i) => i.asked === "Hide everything")).toBe(false);
    as(ada, true);
    const id = item!.id.replace(/^request:/, "");
    expect((await call(requestDELETE, "DELETE", "/x", { org: "company-a", id })).json).toEqual({ forgotten: true });
    expect((await call(requestDELETE, "DELETE", "/x", { org: "company-a", id })).status).toBe(404);
  });
});

describe("Check with me before every task (decision 9; contract F.3, N.2)", () => {
  it("off by default; the person's own; the desktop state carries it; their own reminder then waits for Confirm", async () => {
    as(ada, true);
    expect((await call(permGET, "GET", "/x", { org: "company-a" })).json).toEqual({ ready: true, checkEveryTask: false, impersonated: false });
    expect((await call(permPUT, "PUT", "/x", { org: "company-a" }, { checkEveryTask: true })).json).toEqual({ ready: true, checkEveryTask: true, impersonated: false });
    // Owners and HR change only their own.
    as(owner, true);
    expect((await call(permGET, "GET", "/x", { org: "company-a" })).json).toMatchObject({ checkEveryTask: false });
    expect((await desktopState(ada)).look.front).toEqual({ ready: true, checkEvery: true });
    model.msgs = [doOnMac({ kind: "open_app", app: "Figma" })];
    expect(route(await front(ada, body("Open Figma for me")))).toMatchObject({ lane: "mac", risk: "ask" });
    model.msgs = [tool("remind_me", { body: "Call Ada", at: new Date(Date.now() + 3600_000).toISOString() })];
    const r = await front(ada, body("Remind me in an hour to call Ada"));
    const done = r.lines.at(-1)!.result as { actions: unknown[]; proposals: { kind: string }[]; reply: string };
    expect(done.actions).toEqual([]);
    expect(done.proposals).toMatchObject([{ kind: "confirm" }]);
    model.msgs = [tool("start_job", { helper: "files", title: "Organise your Desktop", doing: "Organising your Desktop", goal: "Organise the files on my Desktop." })];
    expect(route(await front(ada, body("Organise my desktop")))).toMatchObject({ lane: "job", job: { needs: { yes: true } } });
    as(ada, true);
    await call(permPUT, "PUT", "/x", { org: "company-a" }, { checkEveryTask: false });
  });
});

describe("the one-trip Mac context (contract K.5.1)", () => {
  it("one query to the database for the whole context once 0060 is known; the same answers as the ordinary reads", async () => {
    as(ada);
    const slow = await macContext("company-a"); // warms every cache
    const sql: string[] = [];
    const orig = pg.Client.prototype.query;
    pg.Client.prototype.query = function (this: pg.Client, ...args: unknown[]) {
      sql.push(typeof args[0] === "string" ? args[0] : "");
      return (orig as (...x: unknown[]) => unknown).apply(this, args);
    } as typeof orig;
    let fast;
    try { fast = await macContext("company-a"); } finally { pg.Client.prototype.query = orig; }
    expect(fast.fast).toBe(true);
    expect(sql).toHaveLength(1);
    expect(sql[0]).toMatch(/^BEGIN;/);
    expect(sql[0]).toMatch(/COMMIT$/);
    expect({ ...fast, fast: true, burstHits: 0 }).toMatchObject({ ...slow, fast: true, burstHits: 0, allowance: { ...slow.allowance } });
    expect(fast.desktop).toBe(true);
    expect(fast.look.front).toEqual(slow.look.front);
  });
  it("the front route's database work before its answer is that one query, the nonce's replay check included (K.5; integration, 16 October 2026)", async () => {
    as(ada);
    await macContext("company-a"); // every cache warm
    const n = nonce();
    model.msgs = [doOnMac({ kind: "mute" })];
    const sql: string[] = [];
    const orig = pg.Client.prototype.query;
    pg.Client.prototype.query = function (this: pg.Client, ...args: unknown[]) {
      const q = args[0] as unknown;
      sql.push(typeof q === "string" ? q : String((q as { text?: string })?.text ?? ""));
      return (orig as (...x: unknown[]) => unknown).apply(this, args);
    } as typeof orig;
    let r;
    try { r = await front(ada, body("Mute the sound", { nonce: n })); } finally { pg.Client.prototype.query = orig; }
    expect(r.status).toBe(200);
    expect(sql).toHaveLength(1);
    expect(sql[0]).toMatch(/FROM mac_requests r, me WHERE r\.membership_id = me\.mid AND r\.nonce = '[0-9a-f]{32}'/);
    await settleFrontWrites();
    // The same nonce again: refused from the same one query.
    sql.length = 0;
    pg.Client.prototype.query = function (this: pg.Client, ...args: unknown[]) { sql.push(""); return (orig as (...x: unknown[]) => unknown).apply(this, args); } as typeof orig;
    try { expect(await front(ada, body("Mute the sound", { nonce: n }))).toMatchObject({ status: 409, json: { code: "FRONT_REPLAY" } }); } finally { pg.Client.prototype.query = orig; }
    expect(sql).toHaveLength(1);
    expect(model.calls).toHaveLength(1);
  });
  it("a web session reads as not the Mac's; the warm-up GET answers 204", async () => {
    as(ada, true);
    expect((await macContext("company-a")).desktop).toBe(false);
    as(ada);
    const r = await frontGET(new Request("http://localhost:3000/api/orgs/company-a/assistant/front"), { params: Promise.resolve({ org: "company-a" }) });
    expect(r.status).toBe(204);
  });
});

describe("the first short line's offer (contract M.2)", () => {
  it("only the fixed lines; never anything else", async () => {
    as(ada);
    expect((await call(linePOST, "POST", "/x", { org: "company-a" }, { text: "Say: I resign." })).json).toEqual({ speech: null });
    expect((await call(linePOST, "POST", "/x", { org: "company-a" }, { text: "Opening Figma." })).status).toBe(200);
  });
});

// ---- Looks from a front-capable Mac (contract J) ---------------------------------------------------------------------------

const pic = (pointer: { x: number; y: number } | null = { x: 12, y: 9 }) => ({ mediaType: "image/jpeg", data: JPEG, width: 40, height: 24, pointer });
const v2 = (question: string, o: Record<string, unknown> = {}) => ({
  version: 2, source: "keys", request: { text: question, via: "voice", ageMs: 900 }, screen: pic(), crop: pic({ x: 20, y: 12 }),
  display: { widthPt: 1512, heightPt: 982, scale: 2 }, app: { name: "Figma", bundleId: "com.figma.Desktop" }, hidden: [],
  abilities: { useMac: true, fileWork: true, busy: null, plans: 1, accessibility: true }, files: [], messages: [{ role: "user", content: question }], front: 1, lane: "auto", ...o,
});
async function look(c: OrgContext, payload: unknown) {
  as(c);
  return call(lookPOST, "POST", "/x", { org: c.org.slug }, payload);
}

describe("looks from a front-capable Mac (contract J; decision 0b.4)", () => {
  it("look.front.lanes: 'What does this error mean?' goes straight to the stronger model after 'Let me look properly.'", async () => {
    model.msgs = [say("It means the file is locked.")];
    const r = await look(ada, v2("What does this error mean?"));
    expect(r.status).toBe(200);
    const says = r.lines.filter((l) => l.t === "say").map((l) => l.text);
    expect(says[0]).toBe("Let me look properly.");
    expect(model.calls[0].args.model).toBe(LOOK_MODEL);
    expect((model.calls[0].args.tools as { name: string }[]).map((t) => t.name)).not.toContain("propose_task");
  });
  it("K.5.1 (review, 16 October 2026): the look route's checks are the one-trip context; 'Let me look properly.' comes before any other read", async () => {
    as(ada);
    await macContext("company-a"); // every cache warm
    model.msgs = [say("It means the file is locked.")];
    const sql: { q: string; said: boolean; model: number }[] = [];
    const orig = pg.Client.prototype.query;
    let said = false;
    pg.Client.prototype.query = function (this: pg.Client, ...args: unknown[]) {
      const q = args[0] as unknown;
      sql.push({ q: typeof q === "string" ? q : String((q as { text?: string })?.text ?? ""), said, model: model.calls.length });
      return (orig as (...x: unknown[]) => unknown).apply(this, args);
    } as typeof orig;
    let r;
    try {
      as(ada);
      const res = await lookPOST(new Request("http://localhost:3000/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(v2("What does this error mean?")) }), { params: Promise.resolve({ org: "company-a" }) });
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let text = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        text += dec.decode(value);
        if (text.includes("Let me look properly.")) said = true;
      }
      r = text.split("\n").filter(Boolean).map((l) => JSON.parse(l) as NdjsonLine);
    } finally { pg.Client.prototype.query = orig; }
    expect(r.filter((l) => l.t === "say")[0]?.text).toBe("Let me look properly.");
    // Before the route answers at all: the one-trip context (BEGIN … COMMIT), nothing else.
    // Before "Let me look properly.": the one-trip context, then (side by side) the line's natural-voice offer and the
    // ledger's model; before, about twenty round trips one after another (the integrator's count, 16 October 2026).
    const beforeSaid = sql.filter((x) => !x.said);
    const context = beforeSaid.filter((x) => /^BEGIN;/.test(x.q) && /COMMIT$/.test(x.q));
    expect(context).toHaveLength(1);
    expect(beforeSaid.filter((x) => /^BEGIN/.test(x.q)).length).toBeLessThanOrEqual(3);
    // None of the old preamble's reads (the session's kind, screen help's state, "Check with me", 0060's readiness).
    expect(sql.some((x) => /check_every_task AS c FROM assistant_private/.test(x.q))).toBe(false);
    expect(sql.some((x) => /SELECT kind FROM auth_sessions WHERE id = \$1/.test(x.q))).toBe(false);
    expect(sql.some((x) => /FROM screen_help_settings s WHERE organisation_id = \$1/.test(x.q))).toBe(false);
    seam("server-look-one-trip.json", { statementsBeforeThinkLine: beforeSaid.length, statementsBeforeModel: sql.filter((x) => x.model === 0).length });
  });
  it("a quick question on claude-haiku-5-5; think_harder hands the same thread to the stronger model", async () => {
    model.msgs = [tool("think_harder", { why: "small_print" }), say("That's the export setting.")];
    const r = await look(ada, v2("How do I export in Figma?"));
    expect(model.calls.map((c) => c.args.model)).toEqual(["claude-haiku-5-5", LOOK_MODEL]);
    expect((model.calls[0].args.tools as { name: string }[]).map((t) => t.name).slice(-1)).toEqual(["think_harder"]);
    expect((model.calls[1].args.tools as { name: string }[]).map((t) => t.name)).not.toContain("think_harder");
    expect(r.lines.filter((l) => l.t === "say").map((l) => l.text)[0]).toBe("Let me look properly.");
    expect(JSON.stringify(model.calls[1].args.messages)).not.toContain("think_harder");
  });
  it("look.front.no_mac_tools and J.4: their own to-do from a look runs at once with Undo; with Check with me on, a Confirm card", async () => {
    model.msgs = [tool("create_todos", { items: [{ title: "Review the homepage" }] }, { model: "claude-haiku-5-5" }), say("Added it.", "claude-haiku-5-5")];
    const r = await look(ada, v2("Add this to my to-dos for Friday", { lane: "now" }));
    const done = r.lines.at(-1)!.result as { actions: { undo?: unknown; summary: string }[]; proposals: unknown[] };
    expect(done.actions).toHaveLength(1);
    expect(done.actions[0].summary).toBe("Added to-do: Review the homepage");
    expect(done.actions[0].undo).toBeTruthy();
    expect(done.proposals).toEqual([]);
    for (const c of model.calls) expect((c.args.tools as { name: string }[]).map((t) => t.name)).not.toEqual(expect.arrayContaining(["propose_task", "do_on_mac", "start_job"]));
    as(ada, true);
    await call(permPUT, "PUT", "/x", { org: "company-a" }, { checkEveryTask: true });
    model.calls = [];
    model.msgs = [tool("create_todos", { items: [{ title: "Review the pricing page" }] }, { model: "claude-haiku-5-5" }), say("I'll add it when you confirm.", "claude-haiku-5-5")];
    const r2 = await look(ada, v2("Add this to my to-dos", { lane: "now" }));
    const d2 = r2.lines.at(-1)!.result as { actions: unknown[]; proposals: { kind: string }[] };
    expect(d2.actions).toEqual([]);
    expect(d2.proposals).toMatchObject([{ kind: "confirm" }]);
    as(ada, true);
    await call(permPUT, "PUT", "/x", { org: "company-a" }, { checkEveryTask: false });
  });
  it("without `front` (today's Mac) the look is phase 3's: the pilot model and propose_task for an instruction", async () => {
    model.msgs = [say("Sure.")];
    const r = await look(ada, v2("Rename these files", { front: undefined, lane: undefined }));
    expect(r.status).toBe(200);
    expect(model.calls[0].args.model).toBe(LOOK_MODEL);
    expect((model.calls[0].args.tools as { name: string }[]).map((t) => t.name)).toContain("propose_task");
  });
});

describe("logs (contract R.7)", () => {
  it("never carry the person's words, a name or a nonce", () => {
    const all = logs.join("\n");
    expect(all).not.toMatch(/Open the Q3 deck|Call Ada|Organise my desktop|IMG_2041/);
  });
});
