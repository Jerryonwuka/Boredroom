/**
 * Screen help on Brenda for Mac, phase 1: the integrator's end-to-end check (owner decisions, 11 October 2026: "start
 * building with your recommendations"; owner request the same day: "press the two buttons, ask Brenda a question about
 * what I'm pointing at on my screen and she helps me out with it"; contract 0.6, A.6 to A.8, D.6 to D.10, G).
 *
 * One look driven the way Brenda for Mac sends it (Ada's desktop token, a picture with her pointer, the chat so far), with
 * a SYNTHETIC picture: a made-up "Ledgerly" window drawn here in a block font ("INVOICE 4471 OVERDUE"), never a screenshot.
 * The model is a scripted fake (no network). Then everything owners and HR read, and every background reader of the
 * day's work, is asked directly: the usage figures, Settings › Brenda's log, the audit log, their notifications and
 * notch, the end-of-day report, the work summary, the team's standup (Ada's draft and the rollup), commitments, loose
 * ends and follow-ups. None of it may say a look happened, name the app, quote the question or hold the picture; the
 * to-do Ada confirmed is an ordinary to-do, logged as the same to-do asked for in words. A scan of every text and binary
 * column proves the picture is stored nowhere and the question only in Ada's own Past chats. Last, a workspace switched
 * to Not allowed refuses the next look before the model is asked.
 *
 * Local test database only (TEST_DATABASE_URL); migration 0057 waits in db/pending and is applied here by hand.
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const model = vi.hoisted(() => ({ script: [] as Record<string, unknown>[], calls: [] as Record<string, unknown>[], options: [] as Record<string, unknown>[] }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    constructor(o: Record<string, unknown>) { model.options.push(o); }
    messages = {
      create: async (args: Record<string, unknown>) => {
        model.calls.push(structuredClone(args));
        const next = model.script.shift();
        if (!next) throw Object.assign(new Error("the fake model has nothing more to say"), { status: 500 });
        return next;
      },
    };
  },
}));

const reqState = vi.hoisted(() => ({ cookie: null as string | null, bearer: null as string | null }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "boredroom_session" && reqState.cookie ? { name, value: reqState.cookie } : undefined) }),
  headers: async () => new Headers(reqState.bearer ? { authorization: `Bearer ${reqState.bearer}` } : {}),
}));

import { Client } from "pg";
import { resetTestDatabase, adminQuery, adminUrl, appQueryAs } from "../helpers/db";
import { buildCompany, type CompanyFixture } from "@/server/services/fixtures";
import { withSystem } from "@/server/db";
import { issueSession } from "@/server/auth";
import { startLink, approveLink, pollLink, desktopState } from "@/server/services/desktop";
import { forget0057 } from "@/server/lib/schema-0057";
import { brendaOverview } from "@/server/services/brenda";
import { usageSummary } from "@/server/services/ai-usage";
import { listActivity } from "@/server/services/assistant-activity";
import { auditView } from "@/server/services/views";
import { buildDailyReport } from "@/server/services/daily-report";
import { workSummary } from "@/server/services/work-summary";
import * as S from "@/server/services/standup";
import { composeRollup, composeStandup } from "@/server/services/standup-compose";
import { listCommitments } from "@/server/services/commitments";
import { scanWorkspaceCommitments } from "@/server/services/commitment-detect";
import { scanLooseEnds } from "@/server/services/loose-end-detect";
import { listLooseEnds } from "@/server/services/loose-ends";
import { listMyFollowUps } from "@/server/services/follow-ups";
import { createConversation, createConversationSchema, getConversation } from "@/server/services/brenda-history";
import { stripImageMetadata } from "@/server/lib/image-meta";
import { localDate } from "@/server/lib/time";
import { POST as lookPOST } from "@/app/api/orgs/[org]/assistant/look/route";
import { POST as confirmPOST } from "@/app/api/orgs/[org]/brenda/confirm/route";
import { PUT as settingsPUT } from "@/app/api/orgs/[org]/screen-help/route";
import type { OrgContext } from "@/server/lib/api";

// ---- The synthetic picture ------------------------------------------------------------------------------------------

/** A 5×7 block font for the few letters the made-up window shows. */
const FONT: Record<string, string[]> = {
  A: [" ### ", "#   #", "#   #", "#####", "#   #", "#   #", "#   #"], C: [" ####", "#    ", "#    ", "#    ", "#    ", "#    ", " ####"],
  D: ["#### ", "#   #", "#   #", "#   #", "#   #", "#   #", "#### "], E: ["#####", "#    ", "#    ", "#### ", "#    ", "#    ", "#####"],
  G: [" ####", "#    ", "#    ", "#  ##", "#   #", "#   #", " ####"], I: ["#####", "  #  ", "  #  ", "  #  ", "  #  ", "  #  ", "#####"],
  L: ["#    ", "#    ", "#    ", "#    ", "#    ", "#    ", "#####"], N: ["#   #", "##  #", "# # #", "#  ##", "#   #", "#   #", "#   #"],
  O: [" ### ", "#   #", "#   #", "#   #", "#   #", "#   #", " ### "], P: ["#### ", "#   #", "#   #", "#### ", "#    ", "#    ", "#    "],
  R: ["#### ", "#   #", "#   #", "#### ", "# #  ", "#  # ", "#   #"], U: ["#   #", "#   #", "#   #", "#   #", "#   #", "#   #", " ### "],
  V: ["#   #", "#   #", "#   #", "#   #", "#   #", " # # ", "  #  "], W: ["#   #", "#   #", "#   #", "# # #", "# # #", "## ##", "#   #"],
  Y: ["#   #", "#   #", " # # ", "  #  ", "  #  ", "  #  ", "  #  "], 1: ["  #  ", " ##  ", "  #  ", "  #  ", "  #  ", "  #  ", " ### "],
  4: ["   # ", "  ## ", " # # ", "#  # ", "#####", "   # ", "   # "], 7: ["#####", "    #", "   # ", "  #  ", " #   ", " #   ", " #   "],
};

const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

/** A made-up app window (title bar, side panel, an invoice row with a red OVERDUE badge and a PAY NOW button) as a PNG. */
function syntheticWindow(w: number, h: number): Buffer {
  const px = Buffer.alloc(w * h * 3);
  const fill = (x0: number, y0: number, x1: number, y1: number, rgb: [number, number, number]) => {
    for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) px.set(rgb, (y * w + x) * 3);
  };
  const text = (s: string, x: number, y: number, scale: number, rgb: [number, number, number]) => {
    [...s].forEach((ch, i) => (FONT[ch] ?? []).forEach((row, ry) => [...row].forEach((on, rx) => {
      if (on === "#") fill(x + (i * 6 + rx) * scale, y + ry * scale, x + (i * 6 + rx + 1) * scale, y + (ry + 1) * scale, rgb);
    })));
  };
  fill(0, 0, w, h, [245, 245, 247]);
  fill(0, 0, w, 28, [228, 228, 232]);
  for (const [i, c] of ([[0, [255, 95, 87]], [1, [254, 188, 46]], [2, [40, 200, 64]]] as const)) fill(10 + i * 16, 10, 20 + i * 16, 20, [...c] as [number, number, number]);
  text("LEDGERLY", 200, 8, 2, [60, 60, 66]);
  fill(0, 28, 110, h, [232, 232, 236]);
  text("INVOICE", 10, 48, 2, [90, 90, 96]);
  fill(130, 50, w - 20, 90, [255, 255, 255]);
  text("INVOICE 4471", 140, 63, 2, [30, 30, 34]);
  fill(362, 54, w - 14, 86, [229, 72, 77]);
  text("OVERDUE", 370, 63, 2, [255, 255, 255]);
  fill(140, 230, 260, 262, [255, 108, 2]);
  text("PAY NOW", 152, 239, 2, [255, 255, 255]);
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) px.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const W = 480, H = 300;
const PNG = syntheticWindow(W, H);
const PNG64 = PNG.toString("base64");
const SENT64 = stripImageMetadata("image/png", PNG)!.toString("base64");
const IMAGE_TOKENS = Math.ceil(W / 28) * Math.ceil(H / 28); // 18 × 11 = 198
const MARKER = "QUOKKA-2291";
const APP = { name: "Ledgerly", bundleId: "com.example.ledgerly" };
const QUESTION = `Why is this red? ${MARKER}`;
/** Everything that would give the look away: the question's marker, the app, the picture, and words about looking. */
const TELLS = [MARKER, "Ledgerly", "ledgerly", PNG64.slice(60, 100), SENT64.slice(120, 160), "screen help", "Screen help", "looked at", "Looked at", "look keys"];

// ---- Fixtures ---------------------------------------------------------------------------------------------------------

const saved = { key: process.env.ANTHROPIC_API_KEY, ws: process.env.BRENDA_LOOK_WORKSPACES, model: process.env.BRENDA_LOOK_MODEL };
let a: CompanyFixture;
let owner: OrgContext, hr: OrgContext, david: OrgContext, ada: OrgContext, ben: OrgContext;
let adaToken = "";
const web = new Map<string, string>();
const usage = { input_tokens: 2400, output_tokens: 40, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 };
const tool = (name: string, input: Record<string, unknown>) => ({ content: [{ type: "tool_use", id: `tu_${name}`, name, input }], stop_reason: "tool_use", model: "claude-opus-5-5", usage });
const say = (text: string) => ({ content: [{ type: "text", text }], stop_reason: "end_turn", model: "claude-opus-5-5", usage });
const count = async (sql: string, params: unknown[] = []) => (await adminQuery<{ n: number }>(sql, params))[0].n;
const tellsIn = (v: unknown) => { const s = typeof v === "string" ? v : JSON.stringify(v); return TELLS.filter((t) => s.includes(t)); };

function apply0057() {
  const pending = join(process.cwd(), "db", "pending", "0057_screen_help.sql");
  const file = existsSync(pending) ? pending : join(process.cwd(), "db", "migrations", "0057_screen_help.sql");
  return adminQuery(readFileSync(file, "utf8"));
}

type Handler = (req: Request, ctx: { params: Promise<{ org: string }> }) => Promise<Response>;
/** A route as Brenda for Mac calls it (the desktop token) or, with `cookie`, as the web does. */
async function call(handler: Handler, path: string, body: unknown, o: { bearer?: string; cookie?: string; method?: string } = {}): Promise<{ status: number; json: Record<string, unknown> }> {
  reqState.bearer = o.bearer ?? null;
  reqState.cookie = o.cookie ?? null;
  const res = await handler(new Request(`http://localhost:3000/api/orgs/company-a${path}`, { method: o.method ?? "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ org: "company-a" }) });
  return { status: res.status, json: await res.json() as Record<string, unknown> };
}
const lookBody = (question = QUESTION) => ({
  version: 1, source: "keys",
  image: { mediaType: "image/png", data: PNG64, width: W, height: H },
  pointer: { x: 402, y: 70 },
  app: APP,
  messages: [{ role: "user", content: "What's on today?" }, { role: "assistant", content: "Two tasks and a review.", tainted: false }, { role: "user", content: question }],
});

beforeAll(async () => {
  await resetTestDatabase();
  await apply0057();
  forget0057();
  process.env.ANTHROPIC_API_KEY = "test-env-key-not-real"; // never sent anywhere: the SDK is the fake above
  process.env.BRENDA_LOOK_WORKSPACES = "company-a";
  delete process.env.BRENDA_LOOK_MODEL; // the pilot's default, claude-opus-5-5
  if (process.env.LOOK_E2E_PNG_OUT) writeFileSync(process.env.LOOK_E2E_PNG_OUT, PNG); // the integrator's report shows what was sent
  a = await buildCompany("a");
  owner = a.ownerCtx; hr = a.hrCtx; david = a.managerCtx; ada = a.employeeCtx; ben = a.employee2Ctx;
  const link = await startLink({ deviceName: "Ada's Mac" }, { ip: "127.0.9.1", origin: "http://localhost:3000" });
  await approveLink(ada.user, { userCode: link.userCode, orgSlug: ada.org.slug });
  adaToken = ((await pollLink({ deviceCode: link.deviceCode }, { userAgent: "Brenda desktop/test (macos)" })) as { token: string }).token;
  for (const c of [owner, hr, ben]) web.set(c.membership.id, await withSystem((db) => issueSession(db, c.user.authUserId, { method: "password" })));
  // Ada's team runs standups every day, so one is composed after the look.
  await S.saveStandupSettings(david, a.teamId, { enabled: true, time: "00:00", cutoff: "23:59", days: [0, 1, 2, 3, 4, 5, 6] });
});

afterAll(() => {
  for (const [k, v] of [["ANTHROPIC_API_KEY", saved.key], ["BRENDA_LOOK_WORKSPACES", saved.ws], ["BRENDA_LOOK_MODEL", saved.model]] as const) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  reqState.cookie = null; reqState.bearer = null;
});

beforeEach(async () => {
  model.script = []; model.calls = []; model.options = [];
  await adminQuery("DELETE FROM auth_rate_limits WHERE bucket LIKE 'ai.burst:%'");
});

// ---- The look --------------------------------------------------------------------------------------------------------

let startedAt = "";
const logged: string[] = [];

describe("one look, as Brenda for Mac sends it", () => {
  it("the synthetic picture reaches Claude on Boredroom's key, with the pointer; the to-do waits for Confirm; the press runs it", async () => {
    startedAt = (await adminQuery<{ t: string }>("SELECT now()::text AS t"))[0].t;
    const spies = (["error", "warn", "log", "info", "debug"] as const).map((k) => vi.spyOn(console, k).mockImplementation((...args: unknown[]) => { logged.push(args.map(String).join(" ")); }));
    try {
      model.script = [tool("create_todos", { items: [{ title: "Chase invoice 4471" }] }), say(`That's the red OVERDUE badge on invoice 4471 (${MARKER}). Press Confirm and I'll add a to-do to chase it.`)];
      const tasksBefore = await count("SELECT count(*)::int AS n FROM tasks");
      const r = await call(lookPOST as Handler, "/assistant/look", lookBody(), { bearer: adaToken });
      expect(r.status, JSON.stringify(r.json)).toBe(200);
      expect(r.json).toMatchObject({ engine: "claude", tainted: true, actions: [] });
      const proposals = r.json.proposals as { kind: string; tool?: string; token?: string }[];
      expect(proposals.map((p) => [p.kind, p.tool])).toEqual([["confirm", "create_todos"]]);
      expect(await count("SELECT count(*)::int AS n FROM tasks")).toBe(tasksBefore);

      // Boredroom's own key and the pilot model; the picture first on the last user message, with the question.
      expect(model.options.map((o) => o.apiKey)).toEqual(["test-env-key-not-real"]);
      expect(model.calls).toHaveLength(2);
      for (const c of model.calls) {
        expect(c.model).toBe("claude-opus-5-5");
        const last = (c.messages as { role: string; content: unknown }[]).filter((m) => m.role === "user" && Array.isArray(m.content) && (m.content as { type: string }[]).some((b) => b.type === "image"));
        expect(last).toHaveLength(1);
        expect(last[0].content).toEqual([{ type: "image", source: { type: "base64", media_type: "image/png", data: SENT64 } }, { type: "text", text: QUESTION }]);
      }
      const situation = (model.calls[0].system as { text: string }[])[1].text;
      expect(situation).toContain(`the picture in their last message is the window in front of them, in "Ledgerly", ${W}×${H} pixels`);
      expect(situation).toContain("Their pointer is at x=402, y=70 in the picture's own pixels");

      // Ada presses Confirm in the notch.
      const pressed = await call(confirmPOST as Handler, "/brenda/confirm", { token: proposals[0].token }, { bearer: adaToken });
      expect(pressed.status, JSON.stringify(pressed.json)).toBe(200);
      expect(pressed.json.error).toBeNull();
      expect(await count("SELECT count(*)::int AS n FROM tasks")).toBe(tasksBefore + 1);

      // Past chats, as the notch saves them: the question with look: { app }, her answer; a stray picture is dropped.
      const conv = await createConversation(ada, createConversationSchema.parse({ messages: [
        { role: "user", content: "What's on today?" }, { role: "assistant", content: "Two tasks and a review.", tainted: false },
        { role: "user", content: QUESTION, look: { app: APP.name }, image: { mediaType: "image/png", data: PNG64 } },
        { role: "assistant", content: String(r.json.reply), tainted: true },
      ] }));
      const back = await getConversation(ada, conv.id);
      expect(back?.messages[2]).toEqual({ role: "user", content: QUESTION, look: { app: "Ledgerly" } });
      expect(JSON.stringify(back)).not.toContain(PNG64.slice(60, 100));
      await new Promise((res) => setTimeout(res, 400)); // the log rows and the ledger are written without waiting
    } finally {
      for (const s of spies) s.mockRestore();
    }
    // Nothing of the question, the app or the picture in any log line.
    expect(tellsIn(logged.join("\n"))).toEqual([]);
  });
});

describe("afterwards, owners and HR see nothing about it", () => {
  it("usage: one ordinary chat request, the picture's tokens taken out; the real cost has no workspace and no person", async () => {
    for (const viewer of [owner, hr]) {
      const u = await usageSummary(viewer);
      expect(u.byPurpose.map((p) => p.purpose)).toEqual(["chat"]);
      expect(u.totals.requests).toBe(1);
      expect(tellsIn(u)).toEqual([]);
    }
    const rows = await adminQuery<Record<string, unknown>>("SELECT * FROM ai_usage ORDER BY created_at");
    expect(rows.map((x) => [x.purpose, x.membership_id, Number(x.input_tokens)])).toEqual([["chat", ada.membership.id, 2400 - IMAGE_TOKENS], ["chat", ada.membership.id, 2400 - IMAGE_TOKENS]]);
    expect(new Set(rows.map((x) => x.request_id)).size).toBe(1);
    expect(tellsIn(rows)).toEqual([]);
    const daily = await adminQuery<Record<string, unknown>>("SELECT * FROM look_usage_daily");
    expect(daily).toHaveLength(1);
    expect(Object.keys(daily[0]).sort()).toEqual(["cache_read_tokens", "cache_write_tokens", "day", "image_tokens", "input_tokens", "looks", "model", "output_tokens", "steps"]);
    expect(daily[0]).toMatchObject({ model: "claude-opus-5-5", looks: 1, steps: 2 });
    expect(Number(daily[0].image_tokens)).toBe(IMAGE_TOKENS * 2);
    // Only Boredroom's worker reads it: not the owner, not HR, not Ada.
    for (const who of [a.owner, a.hr, a.employee]) expect(await appQueryAs(who.profileId, "SELECT * FROM look_usage_daily")).toEqual([]);
  });

  it("Settings › Brenda's log: the to-do reads exactly as one asked for in words; Ada alone reads her own words", async () => {
    for (const viewer of [owner, hr]) {
      const o = await brendaOverview(viewer);
      const hers = o.actions.filter((x) => x.display_name === "Ada Employee");
      expect(hers.map((x) => ({ tool: x.tool, summary: x.summary, outcome: x.outcome, source: x.source, auto: x.auto }))).toEqual([{ tool: "create_todos", summary: "Added a to-do", outcome: "done", source: "chat", auto: false }]);
      expect(tellsIn(o.actions)).toEqual([]);
      expect(JSON.stringify(o.actions)).not.toContain("Chase invoice 4471");
    }
    const [row] = await adminQuery<{ detail: Record<string, unknown>; summary: string }>("SELECT summary, detail FROM brenda_actions WHERE membership_id = $1 AND tool = 'create_todos'", [ada.membership.id]);
    expect(row.summary).toBe("Added a to-do");
    expect(Object.keys(row.detail).sort()).toEqual(["href", "personalSummary"]);
    expect((await listActivity(ada)).items.map((x) => x.summary)).toContain("Added to-do: Chase invoice 4471");
  });

  it("the audit log, their notifications and their notch hold nothing about it", async () => {
    for (const viewer of [owner, hr]) {
      expect(tellsIn(await auditView(viewer))).toEqual([]);
      expect(tellsIn(await desktopState(viewer))).toEqual([]);
    }
    expect(await count("SELECT count(*)::int AS n FROM notifications WHERE recipient_membership_id = ANY($1::uuid[]) AND created_at >= $2::timestamptz",
      [[owner.membership.id, hr.membership.id, david.membership.id], startedAt])).toBe(0);
    expect(await count("SELECT count(*)::int AS n FROM audit_events WHERE occurred_at >= $1::timestamptz AND (action LIKE '%look%' OR action LIKE '%screen%')", [startedAt])).toBe(0);
  });

  it("the end-of-day report and the work summary say nothing about it", async () => {
    for (const viewer of [owner, hr, david]) {
      expect(tellsIn(await buildDailyReport(viewer, { useAssistant: false }))).toEqual([]);
      expect(tellsIn(await workSummary(viewer, { period: "today", membershipId: ada.membership.id }))).toEqual([]);
    }
  });

  it("the team's standup: Ada's draft and the rollup her lead reads say nothing about it", async () => {
    const today = localDate(new Date(), owner.org.timezone);
    const day = await S.openStandupDay(a.teamId, today, new Date());
    expect(day.status).toBe("opened");
    const entries = await adminQuery<{ id: string; membership_id: string }>("SELECT id, membership_id FROM standup_entries WHERE rollup_id = $1", [day.rollupId]);
    for (const e of entries) {
      const claim = await S.claimStandupDraft(e.id, new Date());
      if ("skip" in claim) throw new Error(`not claimed: ${claim.skip}`);
      const composed = await composeStandup(claim, { model: null });
      expect(tellsIn(composed)).toEqual([]);
      await S.saveStandupDraft(e.id, composed, new Date());
    }
    await adminQuery("UPDATE standup_rollups SET cutoff_at = clock_timestamp() WHERE id = $1", [day.rollupId]);
    const input = await S.rollupInput(day.rollupId!, new Date());
    if ("skip" in input) throw new Error(input.skip);
    expect(tellsIn(input)).toEqual([]);
    expect(tellsIn(composeRollup(input))).toEqual([]);
  });

  it("commitments, loose ends and follow-ups: nothing found, nothing created", async () => {
    const scan = await scanWorkspaceCommitments(owner.org.id, { useModel: false });
    expect(scan.created).toBe(0);
    // The widest list each of them may read (the whole workspace, else their teams, else their own).
    const widest = async (viewer: OrgContext) => {
      for (const scope of ["all", "team", "mine"] as const) {
        try { return await listCommitments(viewer, { scope }); } catch (err) { if ((err as { status?: number }).status !== 403) throw err; }
      }
      return null;
    };
    for (const viewer of [owner, hr, david, ada]) expect(tellsIn(await widest(viewer))).toEqual([]);
    const loose = await scanLooseEnds(ada, { useModel: false });
    expect(tellsIn(loose)).toEqual([]);
    expect(tellsIn(await listLooseEnds(ada, { status: "all" }))).toEqual([]);
    expect(await count("SELECT count(*)::int AS n FROM follow_ups")).toBe(0);
    for (const viewer of [owner, hr, david]) expect(tellsIn(await listMyFollowUps(viewer, { status: "all" }))).toEqual([]);
  });

  it("stored nowhere: no column of any table holds the picture; the question and the app only in Ada's own Past chats", async () => {
    const db = new Client({ connectionString: adminUrl() });
    await db.connect();
    const holding = new Map<string, string[]>();
    try {
      const cols = (await db.query<{ table_name: string; column_name: string; data_type: string }>(
        `SELECT c.table_name, c.column_name, c.data_type FROM information_schema.columns c
         JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema
         WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE' AND c.data_type IN ('text', 'jsonb', 'json', 'character varying', 'citext', 'bytea')`)).rows;
      const idat = PNG.subarray(41, 81); // a slice of the picture's own compressed data
      const needles = [["marker", MARKER], ["app", "Ledgerly"], ["bundle id", APP.bundleId], ["picture", PNG64.slice(60, 100)], ["picture as sent", SENT64.slice(120, 160)]] as const;
      for (const c of cols) {
        const q = `"${c.table_name}"."${c.column_name}"`;
        let found: string[];
        if (c.data_type === "bytea") {
          const r = await db.query<{ hit: boolean }>(`SELECT COALESCE(bool_or(position($1::bytea in ${q}) > 0), false) AS hit FROM "${c.table_name}"`, [idat]);
          found = r.rows[0].hit ? ["picture bytes"] : [];
        } else {
          const r = await db.query<Record<string, boolean>>(`SELECT ${needles.map((_, i) => `COALESCE(bool_or(${q}::text LIKE $${i + 1}), false) AS n${i}`).join(", ")} FROM "${c.table_name}"`,
            needles.map(([, needle]) => `%${needle}%`));
          found = needles.filter((_, i) => r.rows[0][`n${i}`]).map(([label]) => label);
        }
        if (found.length) holding.set(`${c.table_name}.${c.column_name}`, found);
      }
    } finally {
      await db.end();
    }
    // The chat's title is its first question ("What's on today?"); the preview is its last message.
    expect(Object.fromEntries(holding)).toEqual({
      "brenda_conversations.messages": ["marker", "app"],
      "brenda_conversations.preview": ["marker"],
    });
    // Ada's Past chats are hers alone: no owner, HR or lead reads them.
    for (const who of [a.owner, a.hr, a.manager]) expect(await appQueryAs(who.profileId, "SELECT id FROM brenda_conversations")).toEqual([]);
  }, 120_000);
});

describe("Not allowed", () => {
  it("a workspace switched to Not allowed refuses the next look before the model is asked; staff can't switch it", async () => {
    const staff = await call(settingsPUT as Handler, "/screen-help", { allowed: true }, { cookie: web.get(ben.membership.id), method: "PUT" });
    expect([staff.status, staff.json.message]).toEqual([403, "Only the organisation owner or HR can change screen help."]);

    const off = await call(settingsPUT as Handler, "/screen-help", { allowed: false }, { cookie: web.get(owner.membership.id), method: "PUT" });
    expect(off.status, JSON.stringify(off.json)).toBe(200);
    expect(off.json).toMatchObject({ allowed: false, available: false, reason: "switched_off" });
    expect((await desktopState(ada)).look).toMatchObject({ ready: true, eligible: true, available: false, reason: "switched_off" });

    model.script = [say("never")];
    const refused = await call(lookPOST as Handler, "/assistant/look", lookBody("And this one?"), { bearer: adaToken });
    expect([refused.status, refused.json.code, refused.json.message]).toEqual([403, "LOOK_SWITCHED_OFF", "Your workspace has switched off screen help."]);
    expect(model.calls).toHaveLength(0);
    expect(model.options).toHaveLength(0);

    // HR allows it again: the next look is answered.
    const on = await call(settingsPUT as Handler, "/screen-help", { allowed: true }, { cookie: web.get(hr.membership.id), method: "PUT" });
    expect(on.json).toMatchObject({ allowed: true, available: true, reason: null });
    model.script = [say("It's the invoice list.")];
    const again = await call(lookPOST as Handler, "/assistant/look", lookBody("And this one?"), { bearer: adaToken });
    expect(again.status, JSON.stringify(again.json)).toBe(200);
    expect(model.calls).toHaveLength(1);
  });
});

// Review, 11 October 2026: a refused or failed action from a look was logged with the tool's own error, which quotes what
// the model typed into the tool, read from the picture ('"Dr Patel" is not someone you can assign to'). Owners and HR read
// those rows in Settings › Brenda's log, so a look's refusal keeps only the lead words ("Didn't add a to-do").
describe("a look's refused action in the owners' log", () => {
  it("is logged with the lead words only: nothing the model read from the picture", async () => {
    const link = await startLink({ deviceName: "David's Mac" }, { ip: "127.0.9.2", origin: "http://localhost:3000" });
    await approveLink(david.user, { userCode: link.userCode, orgSlug: david.org.slug });
    const davidToken = ((await pollLink({ deviceCode: link.deviceCode }, { userAgent: "Brenda desktop/test (macos)" })) as { token: string }).token;
    model.script = [tool("create_todos", { items: [{ title: "Chase invoice 4471", assignee: `Dr ${MARKER}` }] }), say("I can't find that person in your workspace.")];
    const r = await call(lookPOST as Handler, "/assistant/look", lookBody("Add a to-do for the doctor named here to chase this"), { bearer: davidToken });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    // The model was told why (its tool result), so it could say so: only the log is kept to the lead words.
    const results = (model.calls[1].messages as { content: unknown }[]).flatMap((m) => (Array.isArray(m.content) ? m.content as { type: string; content?: string }[] : [])).filter((b) => b.type === "tool_result");
    expect((JSON.parse(String(results[0].content)) as { error: string }).error).toContain(`"Dr ${MARKER}" is not someone you can assign to`);
    await new Promise((res) => setTimeout(res, 400)); // the log row is written without waiting
    const rows = await adminQuery<{ summary: string; outcome: string; detail: unknown }>("SELECT summary, outcome, detail FROM brenda_actions WHERE membership_id = $1 AND tool = 'create_todos'", [david.membership.id]);
    expect(rows.map((x) => [x.summary, x.outcome])).toEqual([["Didn't add a to-do", "refused"]]);
    expect(tellsIn(rows)).toEqual([]);
    for (const viewer of [owner, hr]) {
      const o = await brendaOverview(viewer);
      const his = o.actions.filter((x) => x.tool === "create_todos" && x.outcome === "refused");
      expect(his.map((x) => x.summary)).toEqual(["Didn't add a to-do"]);
      expect(tellsIn(o.actions.filter((x) => x.tool === "create_todos"))).toEqual([]);
    }
  });
});
