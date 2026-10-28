/**
 * "What Brenda has learned" (owner decision, 28 October 2026: "I want her to learn from the person's usage and
 * interaction with her and interact with the person based on that"), against a local database, with a scripted model (no
 * network, no key):
 * - before migration 0067 (it waits in db/pending): nothing is recorded or learned, the list says it is coming, changes
 *   answer 503, and her chat still answers;
 * - with 0067 applied here by hand: her chat, a Confirm press, a "Not now" and a Mac task's answer record the person's
 *   own signals (never anyone else's); a learning run reads them with the scripted model, keeps only what passes the
 *   second guard and records its tokens for the workspace with no person; a run is due after enough turns and happens
 *   right after the turn; the habits reach her situation after the stated preferences, quoted;
 * - row security: the owner, HR, the lead and a teammate read nothing; impersonation sees and records nothing;
 * - the switch off stops recording and learning; delete one (not learned again), forget everything, forget_preference
 *   with a learned id (behind Confirm), learned_habits, and the 30-day purge.
 *
 * Company A (Africa/Lagos): Grace Owner, Mary HR, David Lead, Ada Obi (whose assistant is Max), Ben Okafor. Local test
 * database only (TEST_DATABASE_URL on localhost).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// A scripted model: each call takes the next answer and keeps what it was sent (no network, no key).
const model = vi.hoisted(() => ({ script: [] as Record<string, unknown>[], sent: [] as { model: string; system: unknown; messages: { role: string; content: unknown }[]; tools: unknown; tool_choice?: unknown }[] }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    static BadRequestError = class extends Error {};
    messages = {
      create: async (req: { model: string; system: unknown; messages: { role: string; content: unknown }[]; tools?: unknown; tool_choice?: unknown }) => {
        model.sent.push({ model: req.model, system: req.system, messages: req.messages, tools: req.tools ?? null, tool_choice: req.tool_choice });
        const next = model.script.shift();
        if (!next) throw new Error("the fake model has nothing more to say");
        return next;
      },
    };
  },
}));

import { resetTestDatabase, adminQuery, appQueryAs } from "../helpers/db";
import { buildCompany, type CompanyFixture } from "@/server/services/fixtures";
import { saveMyAssistant } from "@/server/services/assistant-profile";
import { addPreference } from "@/server/services/preferences";
import * as L from "@/server/services/learning";
import { forget0067 } from "@/server/lib/schema-0067";
import { LEARNING_SYSTEM } from "@/server/services/learning-prompt";
import { chat, confirmAction, runBrendaTool, type Proposal } from "@/server/services/copilot";
import type { OrgContext } from "@/server/lib/api";

const saved = { key: process.env.ANTHROPIC_API_KEY, auto: process.env.BRENDA_LEARNING_AUTORUN, model: process.env.BRENDA_LEARNING_MODEL };
let a: CompanyFixture;
let ada: OrgContext, ben: OrgContext;
const id = (c: OrgContext) => c.membership.id;
const impersonated = (c: OrgContext): OrgContext => ({ ...c, user: { ...c.user, impersonation: { id: "x", adminEmail: "admin@boredroom.test" } } as OrgContext["user"] });
const usage = { input_tokens: 900, output_tokens: 120, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const say = (text: string) => ({ content: [{ type: "text", text }], stop_reason: "end_turn", model: "claude-test", usage });
const habits = (list: { id?: string; text: string; kind?: string; confidence?: number; evidence?: number; seen?: boolean }[]) => ({
  content: [{ type: "tool_use", id: "tu_save", name: "save_habits", input: { habits: list.map((h) => ({ id: h.id ?? "", text: h.text, kind: h.kind ?? "other", confidence: h.confidence ?? 80, evidence: h.evidence ?? 3, seen: h.seen ?? true })) } }],
  stop_reason: "tool_use", model: "claude-haiku-5-5", usage,
});
type Confirm = Extract<Proposal, { kind: "confirm" }>;
const confirmOf = (r: { proposals: Proposal[] }) => r.proposals.find((p): p is Confirm => p.kind === "confirm");
const signalsOf = (c: OrgContext) => adminQuery<{ kind: string; channel: string; detail: string }>(`SELECT kind, channel, detail FROM assistant_signals WHERE membership_id = $1 ORDER BY created_at, detail`, [id(c)]);
const learnedOf = (c: OrgContext) => adminQuery<{ id: string; body: string; dismissed: boolean }>(`SELECT id, body, dismissed_at IS NOT NULL AS dismissed FROM assistant_learned WHERE membership_id = $1 ORDER BY body`, [id(c)]);
async function turn(c: OrgContext, content: string) {
  const r = await chat(c, { messages: [{ role: "user", content }] });
  await L.settleLearning();
  return r;
}

beforeAll(async () => {
  await resetTestDatabase();
  // 0067 is applied now (owner, 28 October 2026: "apply 0066 and 0067"), so the reset database has it: take its tables
  // and guard away to start from a database without it, as before.
  await adminQuery("DROP TABLE IF EXISTS assistant_learned, assistant_signals, assistant_learning CASCADE; DROP FUNCTION IF EXISTS assistant_learned_guard();");
  forget0067();
  a = await buildCompany("a", { names: { owner: "Grace Owner", hr: "Mary HR", manager: "David Lead", employee: "Ada Obi", employee2: "Ben Okafor" } });
  ada = a.employeeCtx; ben = a.employee2Ctx;
  await saveMyAssistant(ada, { name: "Max", colour: "blue", visor: "band", eyes: "round" });
  process.env.ANTHROPIC_API_KEY = "";
  delete process.env.BRENDA_LEARNING_AUTORUN;
  delete process.env.BRENDA_LEARNING_MODEL;
});

afterAll(() => {
  for (const [k, v] of [["ANTHROPIC_API_KEY", saved.key], ["BRENDA_LEARNING_AUTORUN", saved.auto], ["BRENDA_LEARNING_MODEL", saved.model]] as const) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

describe("before migration 0067", () => {
  it("records and learns nothing, says it is coming, refuses changes, and her chat still answers", async () => {
    const r = await turn(ada, "what's on my plate today?");
    expect(r.engine).toBe("builtin");
    expect(await L.listLearned(ada)).toEqual({ ready: false, hidden: false, enabled: true, items: [], max: 12 });
    expect(await L.learnedForModel(ada)).toEqual([]);
    await expect(L.setLearning(ada, false)).rejects.toMatchObject({ status: 503, code: "NOT_READY" });
    await expect(L.forgetAllLearned(ada)).rejects.toMatchObject({ status: 503 });
    await expect(L.deleteLearned(ada, "00000000-0000-4000-8000-000000000001")).rejects.toMatchObject({ status: 503 });
    expect(await L.purgeSignals()).toEqual({ deleted: 0 });
    process.env.ANTHROPIC_API_KEY = "test-key";
    expect(await L.learnNow(ada, { force: true })).toEqual({ ran: false });
    process.env.ANTHROPIC_API_KEY = "";
    const r2 = await runBrendaTool(ada, "learned_habits", {});
    expect(r2.out).toMatchObject({ error: expect.stringContaining("database update") });
    expect(await adminQuery(`SELECT to_regclass('public.assistant_signals') AS t`)).toEqual([{ t: null }]);
  });

  it("then 0067 applies cleanly, twice", async () => {
    const sql = readFileSync(join(process.cwd(), "db", "migrations", "0067_learned_habits.sql"), "utf8");
    await adminQuery(sql);
    await adminQuery(sql);
    forget0067();
    const def = await adminQuery<{ d: string }>(`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'ai_usage_purpose_check'`);
    for (const p of ["chat", "call_recap", "standup", "learning"]) expect(def[0].d).toContain(`'${p}'`);
    expect(await L.listLearned(ada)).toEqual({ ready: true, hidden: false, enabled: true, items: [], max: 12 });
  });
});

describe("signals: the person's own use, nobody else's", () => {
  it("a chat turn records their words (a correction marked), not before they say anything, and only theirs", async () => {
    await turn(ada, "what's on my plate today?");
    await turn(ada, "shorter please");
    await turn(ben, "what's on my plate today?");
    expect(await signalsOf(ada)).toEqual([
      { kind: "request", channel: "chat", detail: "what's on my plate today?" },
      { kind: "correction", channel: "chat", detail: "shorter please" },
    ]);
    expect((await signalsOf(ben)).map((s) => s.detail)).toEqual(["what's on my plate today?"]);
    const st = await adminQuery<{ turns_since: number; enabled: boolean }>(`SELECT turns_since, enabled FROM assistant_learning WHERE membership_id = $1`, [id(ada)]);
    expect(st).toEqual([{ turns_since: 2, enabled: true }]);
  });

  it("a Confirm card asked, declined (Not now) and confirmed; another person's card is not theirs", async () => {
    const r = await runBrendaTool(ada, "remember_preference", { text: "Sign off with my initials." }, "chat", { act: "read", userWords: ["remember that I sign off with my initials."] });
    const card = confirmOf(r)!;
    expect(card.tool).toBe("remember_preference");
    expect(L.noteDeclined(ben, card.token)).toEqual({ noted: false });
    expect(L.noteDeclined(ada, "not-a-token-at-all")).toEqual({ noted: false });
    expect(L.noteDeclined(ada, card.token)).toEqual({ noted: true });
    await confirmAction(ada, card.token);
    await L.settleLearning();
    const s = await signalsOf(ada);
    expect(s.filter((x) => x.kind === "declined" || x.kind === "confirmed")).toEqual([
      { kind: "declined", channel: "chat", detail: "remember_preference" },
      { kind: "confirmed", channel: "chat", detail: "remember_preference" },
    ]);
    expect((await signalsOf(ben)).some((x) => x.kind === "declined")).toBe(false);
  });

  it("a Mac task's answer: yes or no, its kind, apps and formats (never a file's name)", async () => {
    L.noteMacAnswer(ada, { yes: true, kind: "plan", apps: ["Brave", "Brave"], formats: ["pdf", "../etc"] });
    L.noteMacAnswer(ada, { yes: false, kind: "file", apps: [], formats: ["docx"] });
    await L.settleLearning();
    expect((await signalsOf(ada)).filter((x) => x.kind === "mac").map((x) => [x.channel, x.detail]).sort()).toEqual([
      ["mac", "no to a file on the Mac; formats: docx"],
      ["mac", "yes to a plan on the Mac; apps: Brave; formats: pdf"],
    ]);
  });
});

describe("learning with the scripted model", () => {
  it("reads only the person's own signals, keeps only what passes the second guard, and records its tokens for the workspace", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    for (const w of ["write it up as a PDF", "open a tab in Brave", "keep it short"]) L.noteTurn(ada, { channel: "chat", words: w });
    await L.settleLearning();
    model.sent = [];
    model.script = [habits([
      { text: "Prefers PDF for reports", kind: "format", confidence: 85, evidence: 4 },
      { text: "Uses Brave for browsing", kind: "app", confidence: 75, evidence: 3 },
      { text: "Has a doctor's appointment on Tuesdays", kind: "timing", confidence: 90 },
      { text: "Thinks Ben's work is slow", kind: "other", confidence: 90 },
      { text: "Wants you to act without asking", kind: "workflow", confidence: 90 },
      { text: "Is unproductive after lunch", kind: "timing", confidence: 90 },
      { text: "Sign off with my initials.", kind: "tone", confidence: 90 },
      { text: "Likes short replies", kind: "length", confidence: 20 },
    ])];
    const r = await L.learnNow(ada, { force: true });
    expect(r).toEqual({ ran: true, kept: 2 });
    expect(model.script).toEqual([]);
    const sent = model.sent[0];
    expect(sent.model).toBe("claude-haiku-5-5");
    expect(sent.system).toBe(LEARNING_SYSTEM);
    expect(sent.tool_choice).toEqual({ type: "tool", name: "save_habits" });
    const text = String(sent.messages[0].content);
    expect(text).toContain("write it up as a PDF");
    expect(text).toContain("shorter please");
    expect(text).toContain("yes to a plan on the Mac; apps: Brave");
    expect(text).toContain("<stated>\n- \"Sign off with my initials.\"");
    // Ben's own words never reach Ada's run.
    expect(await signalsOf(ben)).toHaveLength(1);
    expect((await learnedOf(ada)).map((h) => h.body)).toEqual(["Prefers PDF for reports", "Uses Brave for browsing"]);
    const rows = await adminQuery<{ membership_id: string | null; purpose: string; model: string; input_tokens: number }>(`SELECT membership_id, purpose, model, input_tokens FROM ai_usage WHERE purpose = 'learning'`);
    expect(rows).toEqual([{ membership_id: null, purpose: "learning", model: "claude-haiku-5-5", input_tokens: 900 }]);
    const st = await adminQuery<{ turns_since: number; ran: boolean }>(`SELECT turns_since, last_run_at IS NOT NULL AS ran FROM assistant_learning WHERE membership_id = $1`, [id(ada)]);
    expect(st).toEqual([{ turns_since: 0, ran: true }]);
    // Not due again straight away: no model call.
    expect(await L.learnNow(ada)).toEqual({ ran: false });
  });

  it("keeps a habit by its id, drops what the model dropped, and caps at 12", async () => {
    const [pdf] = (await learnedOf(ada)).filter((h) => h.body.startsWith("Prefers PDF"));
    L.noteTurn(ada, { channel: "chat", words: "as a PDF again please" });
    await L.settleLearning();
    model.script = [habits([
      { id: pdf.id, text: "Prefers PDF for reports and summaries", kind: "format", confidence: 95, evidence: 6 },
      ...Array.from({ length: 14 }, (_, i) => ({ text: `Wants to-dos titled with verb ${i}`, kind: "workflow", confidence: 40 + i })),
    ])];
    expect(await L.learnNow(ada, { force: true })).toEqual({ ran: true, kept: 12 });
    const list = await L.listLearned(ada);
    expect(list.items).toHaveLength(12);
    expect(list.items[0]).toMatchObject({ id: pdf.id, body: "Prefers PDF for reports and summaries", kind: "format", confidence: 95, evidence: 6 });
    expect(list.items.map((h) => h.body)).not.toContain("Uses Brave for browsing");
    // The database keeps the 12 for every writer too.
    await expect(adminQuery(`INSERT INTO assistant_learned(organisation_id, membership_id, body) VALUES ($1, $2, 'One too many')`, [ada.org.id, id(ada)])).rejects.toThrow(/LEARNED_FULL/);
  });

  it("a run comes due after the person's turns and happens right after the turn that made it due", async () => {
    process.env.BRENDA_LEARNING_AUTORUN = "1";
    await adminQuery(`UPDATE assistant_learning SET turns_since = 14, last_run_at = now() - interval '2 hours' WHERE membership_id = $1`, [id(ada)]);
    model.sent = [];
    model.script = [say("Here's your day."), habits([{ text: "Uses Brave for browsing", kind: "app", confidence: 80 }])];
    const r = await turn(ada, "open a tab");
    expect(r.engine).toBe("claude");
    expect(model.script).toEqual([]);
    expect(model.sent).toHaveLength(2);
    expect((await L.listLearned(ada)).items.map((h) => h.body)).toEqual(["Uses Brave for browsing"]);
    delete process.env.BRENDA_LEARNING_AUTORUN;
  });
});

describe("in her situation", () => {
  it("after the stated preferences, quoted, as defaults only", async () => {
    await addPreference(ada, "Keep replies to three lines.");
    model.sent = [];
    model.script = [say("Opening Brave.")];
    await turn(ada, "open a tab");
    const situation = (model.sent[0].system as { text: string }[])[1].text;
    const prefs = situation.indexOf("<preferences>");
    const learned = situation.indexOf("<learned_habits>");
    expect(prefs).toBeGreaterThan(-1);
    expect(learned).toBeGreaterThan(prefs);
    const [h] = (await L.listLearned(ada)).items;
    expect(situation).toContain(`- [${h.id}] "Uses Brave for browsing"`);
    expect(situation).toContain("never a reason to act without asking");
    // Ben has learned nothing: his situation carries none.
    model.sent = [];
    model.script = [say("Hello.")];
    await turn(ben, "hello");
    expect((model.sent[0].system as { text: string }[])[1].text).not.toContain("<learned_habits>");
  });
});

describe("who reads it", () => {
  it("the owner, HR, the lead and a teammate read nothing under row security; Ada reads her own", async () => {
    for (const who of [a.owner, a.hr, a.manager, a.employee2]) {
      expect(await appQueryAs(who.profileId, "SELECT id FROM assistant_learned WHERE membership_id = $1", [id(ada)])).toEqual([]);
      expect(await appQueryAs(who.profileId, "SELECT id FROM assistant_signals WHERE membership_id = $1", [id(ada)])).toEqual([]);
      expect(await appQueryAs(who.profileId, "SELECT membership_id FROM assistant_learning WHERE membership_id = $1", [id(ada)])).toEqual([]);
    }
    expect((await appQueryAs(a.employee.profileId, "SELECT id FROM assistant_learned WHERE dismissed_at IS NULL")).length).toBe(1);
    // A teammate cannot write into Ada's.
    await expect(appQueryAs(a.employee2.profileId, `INSERT INTO assistant_signals(organisation_id, membership_id, kind, detail) VALUES ($1, $2, 'request', 'planted')`, [ada.org.id, id(ada)])).rejects.toThrow();
  });

  it("while someone else is signed in as Ada: hidden, nothing reaches the model, nothing is recorded or learned, nothing changes", async () => {
    const as = impersonated(ada);
    const before = (await signalsOf(ada)).length;
    expect(await L.listLearned(as)).toEqual({ ready: true, hidden: true, enabled: true, items: [], max: 12 });
    expect(await L.learnedForModel(as)).toEqual([]);
    L.noteTurn(as, { channel: "chat", words: "planted by an admin" });
    L.noteAnswer(as, "send_message", "declined");
    L.noteMacAnswer(as, { yes: true, kind: "plan", apps: ["Chrome"], formats: [] });
    await L.settleLearning();
    expect((await signalsOf(ada)).length).toBe(before);
    expect(await L.learnNow(as, { force: true })).toEqual({ ran: false });
    const [h] = (await L.listLearned(ada)).items;
    await expect(L.deleteLearned(as, h.id)).rejects.toMatchObject({ status: 403 });
    await expect(L.forgetAllLearned(as)).rejects.toMatchObject({ status: 403 });
    await expect(L.setLearning(as, false)).rejects.toMatchObject({ status: 403 });
    expect((await runBrendaTool(as, "learned_habits", {})).out).toMatchObject({ error: expect.any(String) });
  });
});

describe("the person's control", () => {
  it("learned_habits lists them for her", async () => {
    const r = await runBrendaTool(ada, "learned_habits", {});
    expect(r.out).toMatchObject({ learning: "on", count: 1, habits: [{ habit: "Uses Brave for browsing", kind: "app" }] });
  });

  it("the switch off: signals deleted, nothing more recorded or learned; on again records", async () => {
    process.env.ANTHROPIC_API_KEY = "";
    const off = await L.setLearning(ada, false);
    expect(off.enabled).toBe(false);
    expect(off.items).toHaveLength(1);
    expect(await signalsOf(ada)).toEqual([]);
    await turn(ada, "write it up");
    L.noteAnswer(ada, "send_message", "declined");
    await L.settleLearning();
    expect(await signalsOf(ada)).toEqual([]);
    expect(await L.learnNow(ada, { force: true })).toEqual({ ran: false });
    expect((await runBrendaTool(ada, "learned_habits", {})).out).toMatchObject({ learning: "off" });
    expect((await L.setLearning(ada, true)).enabled).toBe(true);
    await turn(ada, "write it up");
    expect((await signalsOf(ada)).map((s) => s.detail)).toEqual(["write it up"]);
  });

  it("forget_preference with a learned habit's id waits for Confirm, then deletes it; it is not learned again", async () => {
    const [h] = (await L.listLearned(ada)).items;
    const r = await runBrendaTool(ada, "forget_preference", { id: h.id }, "chat", { act: "read" });
    const card = confirmOf(r)!;
    expect(card.summary).toBe("Forget: “Uses Brave for browsing”");
    expect(r.actions).toEqual([]);
    expect((await L.listLearned(ada)).items).toHaveLength(1);
    const done = await confirmAction(ada, card.token);
    expect(done.error).toBeNull();
    expect(done.actions[0].summary).toBe("Forgot: “Uses Brave for browsing”");
    expect((await L.listLearned(ada)).items).toEqual([]);
    expect(await learnedOf(ada)).toEqual([{ id: h.id, body: "Uses Brave for browsing", dismissed: true }]);
    // The model offers it again: refused, because the person removed it.
    process.env.ANTHROPIC_API_KEY = "test-key";
    model.script = [habits([{ text: "uses brave for browsing", kind: "app", confidence: 90 }, { text: "Likes short replies", kind: "length", confidence: 70 }])];
    expect(await L.learnNow(ada, { force: true })).toEqual({ ran: true, kept: 1 });
    expect((await L.listLearned(ada)).items.map((x) => x.body)).toEqual(["Likes short replies"]);
  });

  it("delete one from Settings, then forget everything", async () => {
    const [h] = (await L.listLearned(ada)).items;
    await expect(L.deleteLearned(ben, h.id)).rejects.toMatchObject({ status: 404 });
    expect(await L.deleteLearned(ada, h.id)).toEqual({ deleted: true, body: "Likes short replies" });
    await expect(L.deleteLearned(ada, h.id)).rejects.toMatchObject({ status: 404 });
    const after = await L.forgetAllLearned(ada);
    expect(after).toEqual({ ready: true, hidden: false, enabled: true, items: [], max: 12 });
    expect(await learnedOf(ada)).toEqual([]);
    expect(await signalsOf(ada)).toEqual([]);
    // Nothing from before "Forget everything" is read again: with no new signals there is nothing to learn.
    model.script = [];
    expect(await L.learnNow(ada, { force: true })).toEqual({ ran: false });
  });

  it("the 30-day purge deletes old signals only", async () => {
    L.noteTurn(ada, { channel: "chat", words: "fresh one" });
    await L.settleLearning();
    await adminQuery(`INSERT INTO assistant_signals(organisation_id, membership_id, kind, detail, created_at) VALUES ($1, $2, 'request', 'old one', now() - interval '31 days')`, [ada.org.id, id(ada)]);
    expect(await L.purgeSignals()).toEqual({ deleted: 1 });
    expect((await signalsOf(ada)).map((s) => s.detail)).toEqual(["fresh one"]);
  });
});
