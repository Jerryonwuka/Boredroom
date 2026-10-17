/**
 * Screen help on Brenda for Mac, phase 1 (owner decisions, 11 October 2026: "start building with your recommendations";
 * owner request the same day: "press the two buttons, ask Brenda a question about what I'm pointing at on my screen and
 * she helps me out with it"; contract A.6 to A.8, D.6 to D.10, G). The look route end to end, as Brenda for Mac calls it
 * (a desktop session's bearer token): the picture reaches the model on Boredroom's own key and the pilot model, every
 * action waits for the person's Confirm, owners can't tell a look happened (the log, the ledger), nothing of the picture
 * or the question is kept or logged, and every refusal of A.8.
 *
 * Local test database only (TEST_DATABASE_URL); migration 0057 waits in db/pending and is applied here by hand. The model
 * is a scripted fake that records what it was given (never a network call, never a real picture: a 40×24 test image).
 *
 * Company A (in the pilot): Olu Owner, Mary HR, David Manager, Ada Employee (the person looking), Ben Employee. The
 * workspace has its own key and model, which a look must never use.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const model = vi.hoisted(() => ({ script: [] as Record<string, unknown>[], calls: [] as Record<string, unknown>[], options: [] as Record<string, unknown>[], fail: null as Error | null }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    constructor(o: Record<string, unknown>) { model.options.push(o); }
    messages = {
      create: async (args: Record<string, unknown>) => {
        model.calls.push(structuredClone(args));
        if (model.fail) throw model.fail;
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

import { resetTestDatabase, adminQuery } from "../helpers/db";
import { buildCompany, type CompanyFixture } from "@/server/services/fixtures";
import { withSystem } from "@/server/db";
import { issueSession } from "@/server/auth";
import { startLink, approveLink, pollLink, desktopState } from "@/server/services/desktop";
import { forget0057 } from "@/server/lib/schema-0057";
import { saveActMode } from "@/server/services/act-mode";
import { chat, confirmAction, runBrendaTool, type ChatResult, type Proposal } from "@/server/services/copilot";
import { brendaOverview } from "@/server/services/brenda";
import { usageSummary } from "@/server/services/ai-usage";
import { assertLookAllowed, saveMyScreenHelp, saveScreenHelp } from "@/server/services/screen-help";
import { createConversation, createConversationSchema, getConversation } from "@/server/services/brenda-history";
import { encryptSecret, verifyPayload } from "@/server/lib/crypto";
import { naturalSpeech, resetNaturalVoiceForTests, verifySpeechToken } from "@/server/services/natural-voice";
import { NATURAL_VOICES } from "@/lib/natural-voices";
import { whyStillAsking } from "@/lib/act-mode";
import { stripImageMetadata } from "@/server/lib/image-meta";
import { POST as lookPOST } from "@/app/api/orgs/[org]/assistant/look/route";
import type { OrgContext } from "@/server/lib/api";

const JPEG = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAYACgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD6D1/WbfQ7NLm7SV43kEYEQBOSCe5HpXP/APCw9J/5977/AL4T/wCKo+Kn/IvW/wD19L/6A9eWV8rm+b4jCYh0qTVrLofWZPk+GxeGVWqne76ns2geKrHXLx7a0iuUkSMyEyqoGAQOxPrW/Xlnwr/5GG4/69W/9DSvU69fKMVUxeHVWrvdnj5xhKeExLpUtrIKKKK9M8sKKKKACiiigAooooA//9k=";
const STRIPPED = stripImageMetadata("image/jpeg", Buffer.from(JPEG, "base64"))!.toString("base64");
const MARKER = "ZEBRA-7731";
const LOOK_MODEL = "claude-look-pilot-test";
const WORKSPACE_MODEL = "claude-workspace-own-test";
const ENV_KEY = "test-env-key-not-real";
const WORKSPACE_KEY = "test-workspace-key-not-real";

const saved = { key: process.env.ANTHROPIC_API_KEY, ws: process.env.BRENDA_LOOK_WORKSPACES, model: process.env.BRENDA_LOOK_MODEL };
let a: CompanyFixture;
let owner: OrgContext, hr: OrgContext, ada: OrgContext, ben: OrgContext;
const tokens = new Map<string, string>();
const webTokens = new Map<string, string>();
type Confirm = Extract<Proposal, { kind: "confirm" }>;
const confirms = (r: { proposals: Proposal[] }) => r.proposals.filter((p): p is Confirm => p.kind === "confirm");
const usage = { input_tokens: 1000, output_tokens: 20, cache_read_input_tokens: 500, cache_creation_input_tokens: 0 };
const tool = (name: string, input: Record<string, unknown>, n = 1) => ({ content: [{ type: "tool_use", id: `tu_${name}_${n}`, name, input }], stop_reason: "tool_use", model: LOOK_MODEL, usage });
const say = (text: string) => ({ content: [{ type: "text", text }], stop_reason: "end_turn", model: LOOK_MODEL, usage });
const count = async (sql: string, params: unknown[] = []) => (await adminQuery<{ n: number }>(sql, params))[0].n;

function apply0057() {
  const pending = join(process.cwd(), "db", "pending", "0057_screen_help.sql");
  const file = existsSync(pending) ? pending : join(process.cwd(), "db", "migrations", "0057_screen_help.sql");
  return adminQuery(readFileSync(file, "utf8"));
}

async function linkDesktop(c: OrgContext, n: number): Promise<string> {
  const link = await startLink({ deviceName: `Look Mac ${n}` }, { ip: `127.0.7.${n}`, origin: "http://localhost:3000" });
  await approveLink(c.user, { userCode: link.userCode, orgSlug: c.org.slug });
  const r = await pollLink({ deviceCode: link.deviceCode }, { userAgent: "Brenda desktop/test (macos)" });
  return (r as { token: string }).token;
}

const body = (o: Record<string, unknown> = {}, question = "What is this, and why is it red?") => ({
  version: 1, source: "keys",
  image: { mediaType: "image/jpeg", data: JPEG, width: 40, height: 24 },
  pointer: { x: 12, y: 9 },
  app: { name: "Figma", bundleId: "com.figma.Desktop" },
  messages: [{ role: "user", content: question }],
  ...o,
});

/** POST /assistant/look as Brenda for Mac (the person's desktop token), or as the web (a cookie) with `web`. */
async function look(c: OrgContext, payload: unknown, o: { web?: boolean; raw?: string } = {}): Promise<{ status: number; json: Record<string, unknown> }> {
  reqState.cookie = o.web ? webTokens.get(c.membership.id) ?? null : null;
  reqState.bearer = o.web ? null : tokens.get(c.membership.id) ?? null;
  const text = o.raw ?? JSON.stringify(payload);
  const res = await lookPOST(new Request(`http://localhost:3000/api/orgs/${c.org.slug}/assistant/look`, { method: "POST", headers: { "content-type": "application/json" }, body: text }), { params: Promise.resolve({ org: c.org.slug }) });
  return { status: res.status, json: await res.json() as Record<string, unknown> };
}
const lookOk = async (c: OrgContext, payload: unknown) => {
  const r = await look(c, payload);
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return r.json as unknown as ChatResult & { spoken: string; speech: unknown };
};
const lastUser = (call: Record<string, unknown>) => {
  const msgs = call.messages as { role: string; content: unknown }[];
  return msgs.filter((m) => m.role === "user" && Array.isArray(m.content) && (m.content as { type: string }[]).some((b) => b.type === "image"));
};

beforeAll(async () => {
  await resetTestDatabase();
  await apply0057();
  forget0057();
  process.env.ANTHROPIC_API_KEY = ENV_KEY; // never sent anywhere: the SDK is the fake above
  process.env.BRENDA_LOOK_WORKSPACES = "company-a";
  process.env.BRENDA_LOOK_MODEL = LOOK_MODEL;
  a = await buildCompany("a");
  owner = a.ownerCtx; hr = a.hrCtx; ada = a.employeeCtx; ben = a.employee2Ctx;
  // The workspace's own key and model: a look must never use them; its ledger rows read as the workspace's model.
  await adminQuery(`INSERT INTO organisation_secrets(organisation_id, assistant_key_enc, assistant_model) VALUES ($1, $2, $3)`, [owner.org.id, encryptSecret(WORKSPACE_KEY), WORKSPACE_MODEL]);
  // A workspace created while it is offered is available at once (the row, contract D.5): company-a was.
  expect(await count("SELECT count(*)::int AS n FROM screen_help_settings WHERE organisation_id = $1 AND available_from <= now()", [owner.org.id])).toBe(1);
  let n = 1;
  for (const c of [owner, hr, ada, ben, a.managerCtx]) {
    tokens.set(c.membership.id, await linkDesktop(c, n++));
    webTokens.set(c.membership.id, await withSystem((db) => issueSession(db, c.user.authUserId, { method: "password" })));
  }
});

afterAll(() => {
  for (const [k, v] of [["ANTHROPIC_API_KEY", saved.key], ["BRENDA_LOOK_WORKSPACES", saved.ws], ["BRENDA_LOOK_MODEL", saved.model]] as const) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  reqState.cookie = null; reqState.bearer = null;
});

beforeEach(async () => {
  model.script = []; model.calls = []; model.options = []; model.fail = null;
  await adminQuery("DELETE FROM auth_rate_limits WHERE bucket LIKE 'ai.burst:%'");
});

describe("the happy path (contract A.6, A.7)", () => {
  it("answers on Boredroom's own key and the pilot model, with the picture first on the last user message", async () => {
    model.script = [say("That's the Export button in Figma's right-hand panel. Pick PDF, then press Export.")];
    const r = await lookOk(ada, body({ messages: [{ role: "user", content: "What's on today?" }, { role: "assistant", content: "Two tasks.", tainted: false }, { role: "user", content: "What is this?" }] }));
    expect(r.reply).toBe("That's the Export button in Figma's right-hand panel. Pick PDF, then press Export.");
    expect(r.engine).toBe("claude");
    expect(r.tainted).toBe(true);
    expect(typeof r.spoken).toBe("string");
    expect(r).toHaveProperty("speech");
    // Boredroom's key, never the workspace's own, and the pilot model.
    expect(model.options.map((o) => o.apiKey)).toEqual([ENV_KEY]);
    expect(model.calls).toHaveLength(1);
    const call = model.calls[0];
    expect(call.model).toBe(LOOK_MODEL);
    const msgs = call.messages as { role: string; content: unknown }[];
    expect(msgs).toHaveLength(3);
    expect(msgs[0]).toEqual({ role: "user", content: "What's on today?" });
    expect(msgs[2]).toEqual({ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: STRIPPED } }, { type: "text", text: "What is this?" }] });
    // The cached prefix is unchanged; the situation says what the picture is and where the pointer is.
    const system = call.system as { text: string; cache_control?: unknown }[];
    expect(system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(system[1].text).toContain("The person pressed your look keys on their Mac: the picture in their last message is the window in front of them, in \"Figma\", 40×24 pixels");
    expect(system[1].text).toContain("Their pointer is at x=12, y=9 in the picture's own pixels");
    expect(system[1].text).toContain("Places you can point at in Boredroom: ");
    expect(system[1].text).not.toContain("asked you to remember this");
    expect(JSON.stringify(system)).not.toContain("cache_control\":{\"type\":\"ephemeral\"},{");
  });

  it("the image is re-sent on every step of the tool loop and never cached", async () => {
    model.script = [tool("get_my_day", {}), say("You have two tasks.")];
    await lookOk(ada, body());
    expect(model.calls).toHaveLength(2);
    for (const c of model.calls) {
      expect(lastUser(c)).toHaveLength(1);
      expect(JSON.stringify(c.messages)).not.toContain("cache_control");
    }
  });

  it("the Look button: no pointer, and she says the window as a whole", async () => {
    model.script = [say("It's Figma's export dialog.")];
    await lookOk(ada, body({ source: "button", pointer: null }));
    const system = model.calls[0].system as { text: string }[];
    expect(system[1].text).toContain("They pressed Look on your card, so their pointer was on you");
  });
});

describe("nothing acts from a look without the person's Confirm (contract D.7)", () => {
  it("ask mode: create_todos, remind_me, timer and clock become Confirm cards; nothing runs before the press", async () => {
    const at = new Date(Date.now() + 3 * 3600_000).toISOString();
    model.script = [
      tool("create_todos", { items: [{ title: "Export the onboarding frame" }] }, 1),
      tool("remind_me", { body: "Check the export", at }, 2),
      tool("timer", { action: "start", taskId: a.taskIds.homepage }, 3),
      tool("clock", { direction: "in" }, 4),
      say("Press Confirm to add it."),
    ];
    const tasksBefore = await count("SELECT count(*)::int AS n FROM tasks");
    const r = await lookOk(ada, body());
    const cards = confirms(r);
    expect(cards.map((c) => c.tool)).toEqual(["create_todos", "remind_me", "timer", "clock"]);
    expect(cards.every((c) => !c.why)).toBe(true); // ask mode: no line
    expect(r.actions).toEqual([]);
    expect(await count("SELECT count(*)::int AS n FROM tasks")).toBe(tasksBefore);
    expect(await count("SELECT count(*)::int AS n FROM brenda_reminders WHERE membership_id = $1", [ada.membership.id])).toBe(0);
    expect(await count("SELECT count(*)::int AS n FROM work_sessions WHERE membership_id = $1", [ada.membership.id])).toBe(0);
    expect(await count("SELECT count(*)::int AS n FROM attendance_days WHERE membership_id = $1", [ada.membership.id])).toBe(0);
    // Each token says it came from a look, and that it would have run at once without one.
    for (const c of cards) expect(verifyPayload<{ lk?: number; la?: number }>(c.token)).toMatchObject({ lk: 1, la: 1 });
    // The press runs it.
    const done = await confirmAction(ada, cards[0].token);
    expect(done.error).toBeNull();
    expect(await count("SELECT count(*)::int AS n FROM tasks")).toBe(tasksBefore + 1);
    const rem = await confirmAction(ada, cards[1].token);
    expect(rem.error).toBeNull();
    expect(await count("SELECT count(*)::int AS n FROM brenda_reminders WHERE membership_id = $1", [ada.membership.id])).toBe(1);
  });

  it("auto mode: the same cards, each with the 'looked' line", async () => {
    await saveActMode(ben, "auto");
    try {
      const at = new Date(Date.now() + 3 * 3600_000).toISOString();
      model.script = [tool("remind_me", { body: "Ben's check", at }), tool("set_status", { presence: "busy" }, 2), say("Press Confirm.")];
      const r = await lookOk(ben, body());
      const cards = confirms(r);
      expect(cards.map((c) => c.tool)).toEqual(["remind_me", "set_status"]);
      for (const c of cards) expect(c.why).toBe(whyStillAsking("looked", { name: "Brenda" }));
      expect(r.actions).toEqual([]);
      expect(await count("SELECT count(*)::int AS n FROM brenda_reminders WHERE membership_id = $1", [ben.membership.id])).toBe(0);
      expect((r as { act?: { mode: string } }).act?.mode).toBe("auto");
    } finally {
      await saveActMode(ben, "ask");
    }
  });

  it("the team report and loose-end actions are refused, and the refusal is not logged as a problem", async () => {
    model.script = [tool("team_report", {}), tool("loose_end_action", { id: "00000000-0000-4000-8000-000000000001", action: "dismiss" }, 2), say("Ask me without the look keys.")];
    const before = await count("SELECT count(*)::int AS n FROM brenda_actions WHERE membership_id = $1", [a.managerCtx.membership.id]);
    const r = await lookOk(a.managerCtx, body());
    // One tool per step: each result is the last message of the next call.
    const resultOf = (i: number) => ((model.calls[i].messages as { role: string; content: unknown }[]).at(-1)?.content as { content: string; is_error?: boolean }[])[0];
    expect(resultOf(1)).toMatchObject({ content: JSON.stringify({ error: "Not from a look: the person can ask for this again without the look keys." }), is_error: true });
    expect(resultOf(2)).toMatchObject({ content: JSON.stringify({ error: "Not from a look: the person can ask for this again without the look keys." }), is_error: true });
    expect(r.actions).toEqual([]);
    expect(await count("SELECT count(*)::int AS n FROM brenda_actions WHERE membership_id = $1", [a.managerCtx.membership.id])).toBe(before);
    expect(await count("SELECT count(*)::int AS n FROM documents WHERE created_by = $1", [a.managerCtx.membership.id])).toBe(0);
  });

  it("a look turn that asks for a follow-up creates none: it only prepares a card", async () => {
    model.script = [tool("follow_up", { people: ["Ben Employee"], question: "Are the exports ready?" }), say("Press Confirm to ask.")];
    const r = await lookOk(a.managerCtx, body());
    const result = ((model.calls[1].messages as { content: unknown }[]).at(-1)?.content as { content: string }[])[0].content;
    expect(confirms(r).map((c) => c.tool), result).toEqual(["follow_up"]);
    expect(await count("SELECT count(*)::int AS n FROM follow_ups")).toBe(0);
  });

  it("links in her answer are defused", async () => {
    model.script = [say("Open [this](https://evil.example/steal?q=1) or [Tasks](/app/company-a/tasks).")];
    const r = await lookOk(ada, body());
    expect(r.reply).not.toContain("](https://evil.example");
    expect(r.reply).toContain("[Tasks](/app/company-a/tasks)");
  });
});

describe("owners can't tell a look happened (contract 0.6, D.8, D.9)", () => {
  it("a to-do confirmed from a look is logged exactly as the same to-do asked for in words", async () => {
    await saveActMode(ada, "ask");
    // In words, in her ordinary chat (the workspace's own connection).
    model.script = [tool("create_todos", { items: [{ title: "Words to-do" }] }), say("Added.")];
    const words = await chat(ada, { messages: [{ role: "user", content: "Add Words to-do" }] });
    expect(words.actions).toHaveLength(1);
    // From a look, then confirmed.
    model.script = [tool("create_todos", { items: [{ title: "Look to-do" }] }), say("Press Confirm.")];
    const r = await lookOk(ada, body());
    expect((await confirmAction(ada, confirms(r)[0].token)).error).toBeNull();
    await new Promise((res) => setTimeout(res, 300)); // the log is written without waiting
    const rows = await adminQuery<{ tool: string; summary: string; outcome: string; source: string; detail: Record<string, unknown> }>(
      `SELECT tool, summary, outcome, source, detail FROM brenda_actions WHERE membership_id = $1 AND tool = 'create_todos' AND detail->>'personalSummary' IN ('Added to-do: Words to-do', 'Added to-do: Look to-do') ORDER BY created_at`, [ada.membership.id]);
    expect(rows).toHaveLength(2);
    const shape = (x: (typeof rows)[number]) => ({ tool: x.tool, summary: x.summary, outcome: x.outcome, source: x.source, keys: Object.keys(x.detail).sort(), auto: x.detail.auto ?? false });
    expect(shape(rows[1])).toEqual(shape(rows[0]));
    expect(shape(rows[0])).toEqual({ tool: "create_todos", summary: "Added a to-do", outcome: "done", source: "chat", keys: ["href", "personalSummary"], auto: false });
    expect(JSON.stringify(rows)).not.toMatch(/"lk"|"look"|Figma/);
    // Owners read the generic words; the person reads her own.
    const ownerView = await brendaOverview(owner);
    const mine = await brendaOverview(ada);
    const ownerRows = ownerView.actions.filter((x) => x.tool === "create_todos" && x.display_name === "Ada Employee");
    expect(ownerRows.length).toBeGreaterThanOrEqual(2);
    expect(new Set(ownerRows.map((x) => x.summary))).toEqual(new Set(["Added a to-do"]));
    expect(mine.actions.map((x) => x.summary)).toEqual(expect.arrayContaining(["Added to-do: Words to-do", "Added to-do: Look to-do"]));
  });

  it("the ledger: one ordinary chat request with the picture's tokens taken out, under the workspace's model; the real cost has no workspace and no person", async () => {
    await adminQuery("DELETE FROM ai_usage");
    await adminQuery("DELETE FROM look_usage_daily");
    model.script = [tool("get_my_day", {}), say("Two tasks.")];
    await lookOk(ada, body());
    await new Promise((res) => setTimeout(res, 300));
    const rows = await adminQuery<{ purpose: string; request_id: string; model: string; input_tokens: number; output_tokens: number; cache_read_tokens: number; membership_id: string }>(
      "SELECT purpose, request_id, model, input_tokens, output_tokens, cache_read_tokens, membership_id FROM ai_usage ORDER BY created_at");
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((x) => x.purpose))).toEqual(new Set(["chat"]));
    expect(new Set(rows.map((x) => x.request_id)).size).toBe(1);
    expect(new Set(rows.map((x) => x.model))).toEqual(new Set([WORKSPACE_MODEL]));
    // 40×24: 2 × 1 patches = 2 tokens, taken out of each step's input.
    expect(rows.map((x) => x.input_tokens)).toEqual([998, 998]);
    expect(rows.map((x) => x.cache_read_tokens)).toEqual([500, 500]);
    const daily = await adminQuery<{ model: string; looks: number; steps: number; image_tokens: string; input_tokens: string }>("SELECT model, looks, steps, image_tokens, input_tokens FROM look_usage_daily");
    expect(daily.map((d) => ({ ...d, image_tokens: Number(d.image_tokens), input_tokens: Number(d.input_tokens) }))).toEqual([{ model: LOOK_MODEL, looks: 1, steps: 2, image_tokens: 4, input_tokens: 2000 }]);
    expect(Object.keys((await adminQuery("SELECT * FROM look_usage_daily LIMIT 1"))[0]).sort()).toEqual(["cache_read_tokens", "cache_write_tokens", "day", "image_tokens", "input_tokens", "looks", "model", "output_tokens", "steps"]);
    // What owners see this month: one chat request, nothing else.
    const u = await usageSummary(owner);
    expect(u.byPurpose.map((p) => p.purpose)).toEqual(["chat"]);
    expect(u.totals.requests).toBe(1);
  });

  it("past the daily limit: 429, the model never called, no built-in answer", async () => {
    await adminQuery(`INSERT INTO ai_usage(organisation_id, membership_id, request_id, purpose, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens)
      SELECT $1, $2, gen_random_uuid(), 'chat', 'x', 1, 1, 0, 0 FROM generate_series(1, 150)`, [ben.org.id, ben.membership.id]);
    try {
      model.script = [say("never")];
      const r = await look(ben, body());
      expect(r.status).toBe(429);
      expect(r.json).toMatchObject({ code: "LOOK_LIMIT", message: "You've used today's 150 requests to Brenda, so Brenda can't look now. Try again tomorrow." });
      expect(model.calls).toHaveLength(0);
      expect(r.json).not.toHaveProperty("reply");
    } finally {
      await adminQuery("DELETE FROM ai_usage WHERE membership_id = $1", [ben.membership.id]);
    }
  });

  it("a model error: 502 with fixed words, no built-in answer, and no picture or question in any log", async () => {
    const errors: string[] = [];
    const spies = (["error", "warn", "log", "info"] as const).map((k) => vi.spyOn(console, k).mockImplementation((...args: unknown[]) => { errors.push(args.map(String).join(" ")); }));
    try {
      model.fail = Object.assign(new Error(`overloaded while reading ${MARKER} ${JPEG.slice(0, 40)}`), { status: 529 });
      const r = await look(ada, body({}, `Why is ${MARKER} red?`));
      expect(r.status).toBe(502);
      expect(r.json).toMatchObject({ code: "LOOK_FAILED", message: "Claude couldn't be reached just now, so Brenda has no answer for that." });
      expect(r.json).not.toHaveProperty("reply");
      expect(JSON.stringify(r.json)).not.toContain(MARKER);
    } finally {
      for (const s of spies) s.mockRestore();
    }
    const all = errors.join("\n");
    expect(all).toContain("[look]");
    expect(all).not.toContain(MARKER);
    expect(all).not.toContain(JPEG.slice(0, 40));
    expect(all).not.toContain(STRIPPED.slice(100, 140));
    expect(all).not.toContain("Figma");
  });
});

describe("every refusal of A.8", () => {
  it("a web session: 403 LOOK_DESKTOP_ONLY", async () => {
    const r = await look(ada, body(), { web: true });
    expect([r.status, r.json.code, r.json.message]).toEqual([403, "LOOK_DESKTOP_ONLY", "Screen help works only from Brenda for Mac."]);
  });

  it("no session at all: 401", async () => {
    reqState.cookie = null; reqState.bearer = null;
    const res = await lookPOST(new Request("http://localhost:3000/api/orgs/company-a/assistant/look", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), { params: Promise.resolve({ org: "company-a" }) });
    expect(res.status).toBe(401);
  });

  it("someone signed in as the person: 403 LOOK_IMPERSONATED", async () => {
    const sessionId = (await adminQuery<{ id: string }>("SELECT id FROM auth_sessions WHERE user_id = $1 AND kind = 'desktop' LIMIT 1", [ada.user.authUserId]))[0].id;
    const as = { ...ada, user: { ...ada.user, sessionId, impersonation: { id: "00000000-0000-4000-8000-0000000000ad", adminEmail: "support@boredroom.test" } } };
    await expect(assertLookAllowed(as)).rejects.toMatchObject({ status: 403, code: "LOOK_IMPERSONATED", message: "Screen help is off while someone else is signed in as you." });
    await expect(assertLookAllowed({ ...ada, user: { ...ada.user, sessionId } })).resolves.toBeTruthy();
  });

  it("switched off: 403 LOOK_SWITCHED_OFF; allowed again: it answers", async () => {
    await saveScreenHelp(owner, { allowed: false });
    try {
      const r = await look(ada, body());
      expect([r.status, r.json.code, r.json.message]).toEqual([403, "LOOK_SWITCHED_OFF", "Your workspace has switched off screen help."]);
      expect((await desktopState(ada)).look).toMatchObject({ ready: true, eligible: true, available: false, reason: "switched_off" });
    } finally {
      await saveScreenHelp(owner, { allowed: true });
    }
    model.script = [say("Fine.")];
    await lookOk(ada, body());
  });

  it("in its notice: 403 LOOK_NOT_YET with the date", async () => {
    await adminQuery("UPDATE screen_help_settings SET available_from = timestamptz '2099-03-05 12:00:00+00' WHERE organisation_id = $1", [owner.org.id]);
    try {
      const r = await look(ada, body());
      expect([r.status, r.json.code, r.json.message]).toEqual([403, "LOOK_NOT_YET", "Screen help starts in this workspace on 5 March 2099."]);
      expect((await desktopState(ada)).look).toMatchObject({ available: false, reason: "notice", availableFrom: "2099-03-05T12:00:00.000Z" });
    } finally {
      await saveScreenHelp(owner, { startNow: true });
    }
    expect((await desktopState(ada)).look).toMatchObject({ available: true, reason: null, availableFrom: null });
  });

  it("not in the pilot: 403 LOOK_NOT_AVAILABLE", async () => {
    process.env.BRENDA_LOOK_WORKSPACES = "someone-else";
    try {
      const r = await look(ada, body());
      expect([r.status, r.json.code, r.json.message]).toEqual([403, "LOOK_NOT_AVAILABLE", "Screen help isn't offered in this workspace."]);
      expect((await desktopState(ada)).look).toMatchObject({ eligible: false, available: false, reason: "not_offered" });
    } finally {
      process.env.BRENDA_LOOK_WORKSPACES = "company-a";
    }
  });

  it("without Boredroom's own key: 503 LOOK_UNAVAILABLE, even with the workspace's own key", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const r = await look(ada, body());
      expect([r.status, r.json.code, r.json.message]).toEqual([503, "LOOK_UNAVAILABLE", "Screen help isn't set up on this Boredroom yet."]);
      expect(model.calls).toHaveLength(0);
    } finally {
      process.env.ANTHROPIC_API_KEY = ENV_KEY;
    }
  });

  it("never-look apps: the fixed list, the workspace's and the person's own: 409 with the rule's name", async () => {
    const fixed = await look(ada, body({ app: { name: "Not Slack", bundleId: "com.tinyspeck.slackmacgap" } }));
    expect([fixed.status, fixed.json.code, fixed.json.message]).toEqual([409, "LOOK_NEVER_LOOK", "I never look at Slack."]);
    await saveScreenHelp(owner, { neverLook: [{ name: "Excel", bundleId: "com.microsoft.Excel" }] });
    const ws = await look(ada, body({ app: { name: "Microsoft Excel", bundleId: "com.microsoft.Excel" } }));
    expect([ws.status, ws.json.code, ws.json.message]).toEqual([409, "LOOK_NEVER_LOOK", "I never look at Excel."]);
    await saveMyScreenHelp(ada, { neverLook: [{ name: "Notion", bundleId: null }] });
    const you = await look(ada, body({ app: { name: "Notion", bundleId: "notion.id" } }));
    expect([you.status, you.json.code, you.json.message]).toEqual([409, "LOOK_NEVER_LOOK", "I never look at Notion."]);
    // Ben has no such list of his own.
    model.script = [say("It's Notion.")];
    await lookOk(ben, body({ app: { name: "Notion", bundleId: "notion.id" } }));
    expect(model.calls).toHaveLength(1);
    // The Mac gets both lists with their source.
    expect((await desktopState(ada)).look.neverLook).toEqual([{ name: "Excel", bundleId: "com.microsoft.Excel", source: "workspace" }, { name: "Notion", bundleId: null, source: "you" }]);
  });

  it("during a call (in one, or one ringing): 409 LOOK_ON_CALL", async () => {
    const [call] = await adminQuery<{ id: string }>(`INSERT INTO calls(id, organisation_id, conversation_id, conversation_kind, kind, room_name, started_by, state, answered_at)
      SELECT x.id, $1, gen_random_uuid(), 'direct', 'direct', 'call-' || x.id::text, $2, 'active', now() FROM (SELECT gen_random_uuid() AS id) x RETURNING id`, [owner.org.id, ben.membership.id]);
    try {
      await adminQuery(`INSERT INTO call_participants(call_id, organisation_id, membership_id, role, state, joined_at, first_joined_at, rang_at) VALUES ($1, $2, $3, 'invitee', 'joined', now(), now(), now())`, [call.id, owner.org.id, ada.membership.id]);
      const joined = await look(ada, body());
      expect([joined.status, joined.json.code, joined.json.message]).toEqual([409, "LOOK_ON_CALL", "I don't look at the screen during a Boredroom call."]);
      await adminQuery("UPDATE call_participants SET state = 'ringing', rang_at = now(), joined_at = NULL, first_joined_at = NULL WHERE call_id = $1", [call.id]);
      const ringing = await look(ada, body());
      expect(ringing.json.code).toBe("LOOK_ON_CALL");
      // A ring older than 30 seconds is over.
      await adminQuery("UPDATE call_participants SET rang_at = now() - interval '2 minutes' WHERE call_id = $1", [call.id]);
      model.script = [say("Fine.")];
      await lookOk(ada, body());
    } finally {
      await adminQuery("DELETE FROM call_participants WHERE call_id = $1", [call.id]);
      await adminQuery("DELETE FROM calls WHERE id = $1", [call.id]);
    }
  });

  it("a body over 4,000,000 bytes: 413 with the look's words", async () => {
    const r = await look(ada, null, { raw: JSON.stringify(body({ pad: "x".repeat(4_000_001) })) });
    expect([r.status, r.json.code, r.json.message]).toEqual([413, "PAYLOAD_TOO_LARGE", "That picture is too large. Try a smaller window."]);
    expect(model.calls).toHaveLength(0);
  });

  it("a bad body: 422 LOOK_INVALID with no field errors and nothing from it", async () => {
    const r = await look(ada, body({ image: { mediaType: "image/jpeg", data: JPEG, width: 41, height: 24 } }, `Why ${MARKER}?`));
    expect([r.status, r.json.code, r.json.message]).toEqual([422, "LOOK_INVALID", "That picture couldn't be read. Look again."]);
    expect(r.json.fieldErrors).toBeUndefined();
    expect(JSON.stringify(r.json)).not.toContain(MARKER);
  });
});

describe("Past chats and everything else keep no picture and no look (contract D.10, G)", () => {
  it("Past chats keep the question, her answer and look: { app }, never an image", async () => {
    model.script = [say(`It's the ${MARKER} export panel.`)];
    const r = await lookOk(ada, body({}, `What is ${MARKER}?`));
    const input = createConversationSchema.parse({ messages: [
      { role: "user", content: `What is ${MARKER}?`, look: { app: "Figma" }, image: { data: JPEG } },
      { role: "assistant", content: r.reply, tainted: true, look: { app: "Figma" } },
    ] });
    const saved = await createConversation(ada, input);
    const conv = await getConversation(ada, saved.id);
    expect(conv?.messages[0]).toEqual({ role: "user", content: `What is ${MARKER}?`, look: { app: "Figma" } });
    expect(conv?.messages[1]).not.toHaveProperty("look");
    expect(JSON.stringify(conv)).not.toContain("/9j/");
    const [raw] = await adminQuery<{ messages: unknown }>("SELECT messages FROM brenda_conversations WHERE id = $1", [saved.id]);
    expect(JSON.stringify(raw.messages)).not.toContain("/9j/");
  });

  it(`the marker (${MARKER}) of a look's question and answer lives only in Past chats: nothing the reports, standups, follow-ups, loose ends or commitments read holds it`, async () => {
    const cols = await adminQuery<{ table_name: string; column_name: string }>(
      `SELECT c.table_name, c.column_name FROM information_schema.columns c JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema
       WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE' AND c.data_type IN ('text', 'jsonb', 'json', 'character varying', 'citext')`);
    const holding: string[] = [];
    for (const c of cols) {
      const n = await count(`SELECT count(*)::int AS n FROM "${c.table_name}" WHERE "${c.column_name}"::text LIKE $1`, [`%${MARKER}%`]);
      if (n) holding.push(`${c.table_name}.${c.column_name}`);
    }
    // Only the person's own Past chats (the message and its title): no action, log, audit row, notification, report,
    // standup, follow-up, loose end, commitment or usage row holds it, so nothing those features read or send can.
    expect(holding.sort()).toEqual(["brenda_conversations.messages", "brenda_conversations.preview", "brenda_conversations.title"]);
  });
});

describe("pointing inside Boredroom (contract D.12)", () => {
  it("open_page keeps a known point key the person has, and strips an unknown one", async () => {
    const good = await runBrendaTool(ada, "open_page", { path: "/todos?point=todos-add", label: "To-dos" });
    expect(good.out).toEqual({ offered: true });
    expect(good.proposals).toEqual([{ kind: "open", href: "/app/company-a/todos?point=todos-add", label: "To-dos" }]);
    const bad = await runBrendaTool(ada, "open_page", { path: "/tasks?status=open&point=nope", label: "Tasks" });
    expect(bad.out).toEqual({ offered: true, note: "That point key doesn't exist; the page opens without pointing." });
    expect(bad.proposals).toEqual([{ kind: "open", href: "/app/company-a/tasks?status=open", label: "Tasks" }]);
    // A place Ada doesn't have (staff can't invite) is not pointed at either.
    const notHers = await runBrendaTool(ada, "open_page", { path: "/people?point=people-invite", label: "People" });
    expect(notHers.proposals).toEqual([{ kind: "open", href: "/app/company-a/people", label: "People" }]);
  });

  it("get_policy says how screen help works where it is offered", async () => {
    const r = await runBrendaTool(ada, "get_policy", {});
    // Phase 2 (owner request and permission rule, 12 October 2026; contract D.14): the policy's words changed.
    expect((r.out as { screen: unknown }).screen).toEqual({ recorded: false, screenHelp: "Brenda for Mac sees the screen the person's pointer is on only when they hold her keys or press Look, and does things on their Mac only when they ask and say yes; nothing is kept, and the workspace can't see it or whether it was used." });
  });
});

// Review, 11 October 2026: her answer describes the screen, and a workspace's own ElevenLabs key keeps every generation in
// that workspace's History (which its owners and HR can read), so a look's answer is offered in a natural voice only on
// Boredroom's own key; otherwise the Mac's own voice says it. No request reaches ElevenLabs here: fetch refuses everything.
describe("her spoken answer never goes through the workspace's own ElevenLabs key", () => {
  const savedVoiceKey = process.env.ELEVENLABS_API_KEY;
  beforeAll(async () => {
    vi.stubGlobal("fetch", async () => { throw new TypeError("no network in this test"); });
    process.env.ELEVENLABS_API_KEY = "test-env-voice-key-not-real";
    resetNaturalVoiceForTests();
    await adminQuery(`INSERT INTO assistant_profiles(membership_id, organisation_id, natural_voice, updated_at) VALUES ($1, $2, $3, now())
      ON CONFLICT (membership_id) DO UPDATE SET natural_voice = $3, updated_at = now()`, [ada.membership.id, ada.org.id, NATURAL_VOICES[0].id]);
  });
  afterAll(async () => {
    await adminQuery("DELETE FROM organisation_voice_secrets WHERE organisation_id = $1", [ada.org.id]);
    await adminQuery("UPDATE assistant_profiles SET natural_voice = NULL WHERE membership_id = $1", [ada.membership.id]);
    if (savedVoiceKey === undefined) delete process.env.ELEVENLABS_API_KEY; else process.env.ELEVENLABS_API_KEY = savedVoiceKey;
    resetNaturalVoiceForTests();
    vi.unstubAllGlobals();
  });

  it("on Boredroom's own key: offered, with a token that may be said only on Boredroom's key", async () => {
    model.script = [say("That's the Export button.")];
    const r = await lookOk(ada, body());
    const speech = r.speech as { token: string; text: string } | null;
    expect(speech).not.toBeNull();
    expect(verifySpeechToken(ada, speech!.token, speech!.text)).toEqual({ boredroomKeyOnly: true });
  });

  it("with the workspace's own key: no offer (the Mac's own voice), and an earlier look's token is refused on that key", async () => {
    model.script = [say("That's the Export button.")];
    const before = (await lookOk(ada, body())).speech as { token: string; text: string };
    await adminQuery(`INSERT INTO organisation_voice_secrets(organisation_id, key_enc, key_hint) VALUES ($1, $2, 'test') ON CONFLICT (organisation_id) DO UPDATE SET key_enc = $2`,
      [ada.org.id, encryptSecret("test-org-voice-key-not-real-0000")]);
    model.script = [say("That's the Export button.")];
    const r = await lookOk(ada, body());
    expect(r.speech).toBeNull();
    await expect(naturalSpeech(ada, { token: before.token, text: before.text, speed: "normal", as: "base64" }, new AbortController().signal))
      .rejects.toMatchObject({ code: "VOICE_UNAVAILABLE" });
  });
});
