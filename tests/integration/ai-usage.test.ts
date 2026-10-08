/**
 * The usage ledger and the limits (owner decision, 8 October 2026: personal assistants, phase 3; migration 0037). Every
 * model call is a row: people write and read their own, the worker any, owners and HR read their organisation's, nobody
 * changes one. A person's daily requests are counted in the organisation's own day, the limit holds before the model is
 * called, bursts are held per minute, and owners and HR see this month's totals.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetTestDatabase, adminQuery, appQueryAs } from "../helpers/db";
import { buildCompany, type CompanyFixture } from "@/server/services/fixtures";
import {
  AI_BURST_MESSAGE, AI_DAILY_REQUEST_LIMIT, aiAllowance, checkAiBurst, newRequestId, recordUsage, recordWorkspaceUsage, usageSummary,
} from "@/server/services/ai-usage";
import { chat } from "@/server/services/copilot";
import { saveMyAssistant } from "@/server/services/assistant-profile";
import { withWorker } from "@/server/db";
import { addDays, localMidnight, todayLocal } from "@/server/lib/time";

let a: CompanyFixture;
let b: CompanyFixture;
const saved = { key: process.env.ANTHROPIC_API_KEY, base: process.env.ANTHROPIC_BASE_URL };
const insertRow = "INSERT INTO ai_usage(organisation_id, membership_id, purpose, model) VALUES ($1, $2, 'chat', 'claude-test')";

beforeAll(async () => {
  delete process.env.ANTHROPIC_API_KEY;
  await resetTestDatabase();
  a = await buildCompany("a");
  b = await buildCompany("b");
  await adminQuery("DELETE FROM organisation_secrets WHERE organisation_id IN ($1, $2)", [a.ownerCtx.org.id, b.ownerCtx.org.id]);
});

afterAll(() => {
  if (saved.key === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = saved.key;
  if (saved.base === undefined) delete process.env.ANTHROPIC_BASE_URL; else process.env.ANTHROPIC_BASE_URL = saved.base;
});

describe("who writes and reads the ledger", () => {
  it("a person writes their own rows only; the worker writes the workspace's", async () => {
    const org = a.ownerCtx.org.id;
    await appQueryAs(a.employee.profileId, insertRow, [org, a.employeeCtx.membership.id]);
    await expect(appQueryAs(a.employee.profileId, insertRow, [org, a.employee2Ctx.membership.id])).rejects.toThrow(/row-level security/);
    await expect(appQueryAs(a.employee.profileId, insertRow, [org, null])).rejects.toThrow(/row-level security/);
    await expect(appQueryAs(a.owner.profileId, insertRow, [org, null])).rejects.toThrow(/row-level security/);
    await expect(appQueryAs(b.employee.profileId, insertRow, [org, b.employeeCtx.membership.id])).rejects.toThrow();
    await withWorker((db) => db.query(insertRow, [org, null]));
    await appQueryAs(a.employee2.profileId, insertRow, [org, a.employee2Ctx.membership.id]);
    await appQueryAs(b.employee.profileId, insertRow, [b.ownerCtx.org.id, b.employeeCtx.membership.id]);
  });

  it("staff read their own; owners and HR their organisation's; nobody another organisation's", async () => {
    const all = "SELECT membership_id FROM ai_usage ORDER BY created_at";
    expect(await appQueryAs(a.employee.profileId, all)).toEqual([{ membership_id: a.employeeCtx.membership.id }]);
    expect(await appQueryAs(a.manager.profileId, all)).toEqual([]);
    for (const who of [a.owner, a.hr]) {
      const rows = await appQueryAs(who.profileId, all);
      expect(rows.map((r) => r.membership_id).sort(), who.email).toEqual([a.employeeCtx.membership.id, a.employee2Ctx.membership.id, null].sort());
    }
    expect(await appQueryAs(b.owner.profileId, all)).toEqual([{ membership_id: b.employeeCtx.membership.id }]);
  });

  it("nobody changes or deletes a row, not even their own", async () => {
    await expect(appQueryAs(a.employee.profileId, "UPDATE ai_usage SET input_tokens = 0")).rejects.toThrow(/permission denied/);
    await expect(appQueryAs(a.owner.profileId, "DELETE FROM ai_usage")).rejects.toThrow(/permission denied/);
    await expect(withWorker((db) => db.query("DELETE FROM ai_usage"))).rejects.toThrow(/permission denied/);
  });
});

describe("recording a model call", () => {
  it("maps the API's usage block, missing counts as nought", async () => {
    const requestId = newRequestId();
    await recordUsage(a.managerCtx, { purpose: "chat", model: "claude-opus-5-5", requestId, usage: { input_tokens: 1200, output_tokens: 340, cache_read_input_tokens: 9000, cache_creation_input_tokens: null } });
    await recordUsage(a.managerCtx, { purpose: "chat", model: "claude-opus-5-5", requestId, usage: { input_tokens: 80, output_tokens: undefined } });
    await recordUsage(a.managerCtx, { purpose: "plan", model: "claude-opus-5-5", usage: null });
    const rows = await adminQuery<{ request_id: string; purpose: string; model: string; input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_write_tokens: number }>(
      "SELECT request_id, purpose, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens FROM ai_usage WHERE membership_id = $1 ORDER BY created_at", [a.managerCtx.membership.id]);
    expect(rows.map((r) => ({ purpose: r.purpose, model: r.model, input_tokens: r.input_tokens, output_tokens: r.output_tokens, cache_read_tokens: r.cache_read_tokens, cache_write_tokens: r.cache_write_tokens }))).toEqual([
      { purpose: "chat", model: "claude-opus-5-5", input_tokens: 1200, output_tokens: 340, cache_read_tokens: 9000, cache_write_tokens: 0 },
      { purpose: "chat", model: "claude-opus-5-5", input_tokens: 80, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 },
      { purpose: "plan", model: "claude-opus-5-5", input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 },
    ]);
    expect(rows[0].request_id).toBe(requestId);
    expect(rows[1].request_id).toBe(requestId);
    expect(rows[2].request_id).not.toBe(requestId);
  });

  it("never throws, whatever it is handed", async () => {
    await expect(recordUsage(a.managerCtx, { purpose: "chat", model: "m".repeat(200), usage: { input_tokens: -5, output_tokens: Number.NaN } })).resolves.toBeUndefined();
    await expect(recordUsage(a.managerCtx, { purpose: "bogus" as never, model: "", usage: { input_tokens: 1e12 }, requestId: "not-a-uuid" })).resolves.toBeUndefined();
    const last = await adminQuery<{ purpose: string; model: string; input_tokens: number }>("SELECT purpose, model, input_tokens FROM ai_usage WHERE membership_id = $1 ORDER BY created_at DESC LIMIT 2", [a.managerCtx.membership.id]);
    expect(last).toEqual([{ purpose: "other", model: "unknown", input_tokens: 2_147_483_647 }, { purpose: "chat", model: "m".repeat(100), input_tokens: 0 }]);
    // Someone from another workspace cannot be recorded against this one: refused, and swallowed.
    await expect(recordUsage({ ...b.employeeCtx, org: a.ownerCtx.org }, { purpose: "chat", model: "x", usage: null })).resolves.toBeUndefined();
    expect(await adminQuery("SELECT 1 FROM ai_usage WHERE membership_id = $1 AND organisation_id = $2", [b.employeeCtx.membership.id, a.ownerCtx.org.id])).toEqual([]);
  });

  it("records the workspace's own jobs with no person", async () => {
    await recordWorkspaceUsage(a.ownerCtx.org.id, { purpose: "report", model: "claude-opus-5-5", usage: { input_tokens: 5000, output_tokens: 400 } });
    const rows = await adminQuery<{ membership_id: string | null; purpose: string; input_tokens: number }>("SELECT membership_id, purpose, input_tokens FROM ai_usage WHERE organisation_id = $1 AND purpose = 'report'", [a.ownerCtx.org.id]);
    expect(rows).toEqual([{ membership_id: null, purpose: "report", input_tokens: 5000 }]);
  });
});

describe("the daily limit", () => {
  it("counts distinct chat, planner and asked-for report requests since the organisation's midnight, the person's own", async () => {
    const ctx = a.employee2Ctx;
    const me = ctx.membership.id;
    const before = await aiAllowance(ctx);
    expect(before).toMatchObject({ ready: true, used: 1, limit: AI_DAILY_REQUEST_LIMIT, remaining: AI_DAILY_REQUEST_LIMIT - 1 });
    const tz = ctx.org.timezone;
    expect(before.resetsAt).toBe(localMidnight(addDays(todayLocal(tz), 1), tz).toISOString());
    // One turn of three model calls is one request, and a report written within that turn shares it; a report asked for
    // on its own counts (review, 8 October 2026); a summary and a test do not.
    const turn = newRequestId();
    for (let i = 0; i < 3; i++) await recordUsage(ctx, { purpose: "chat", model: "m", usage: null, requestId: turn });
    await recordUsage(ctx, { purpose: "report", model: "m", usage: null, requestId: turn });
    await recordUsage(ctx, { purpose: "plan", model: "m", usage: null });
    for (const purpose of ["summary", "test", "other"] as const) await recordUsage(ctx, { purpose, model: "m", usage: null });
    // Yesterday in the organisation's own day does not count; nor does a colleague's.
    await adminQuery("INSERT INTO ai_usage(organisation_id, membership_id, purpose, model, created_at) VALUES ($1, $2, 'chat', 'm', $3)", [ctx.org.id, me, new Date(localMidnight(todayLocal(tz), tz).getTime() - 60_000).toISOString()]);
    await recordUsage(a.employeeCtx, { purpose: "chat", model: "m", usage: null });
    expect(await aiAllowance(ctx)).toMatchObject({ ready: true, used: 3, remaining: AI_DAILY_REQUEST_LIMIT - 3 });
  });

  it("at 150 there are none left, and chat() answers with the built-in helper without calling the model", async () => {
    const ctx = a.employee2Ctx;
    await saveMyAssistant(ctx, { name: "Juno", colour: "teal", visor: "screen", eyes: "square" });
    await adminQuery(
      `INSERT INTO ai_usage(organisation_id, membership_id, purpose, model) SELECT $1, $2, 'chat', 'm' FROM generate_series(1, $3::int)`,
      [ctx.org.id, ctx.membership.id, AI_DAILY_REQUEST_LIMIT - 3]);
    expect(await aiAllowance(ctx)).toMatchObject({ used: 150, remaining: 0 });
    // A key that would fail at once if it were used, pointed at a port nobody listens on: if the limit did not hold, the
    // note would say Claude could not be reached.
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-not-a-key";
    process.env.ANTHROPIC_BASE_URL = "http://127.0.0.1:9";
    try {
      const r = await chat(ctx, { messages: [{ role: "user", content: "What's waiting for me today?" }] });
      expect(r.engine).toBe("builtin");
      expect(r.note).toMatch(/today's 150 requests/);
      expect(r.note).toContain("Juno");
      // Nothing more was recorded: the model was never called.
      expect((await aiAllowance(ctx)).used).toBe(150);
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_BASE_URL;
    }
    // Someone else's day is untouched.
    expect((await aiAllowance(a.employeeCtx)).remaining).toBeGreaterThan(0);
  });
});

describe("this month, for owners and HR", () => {
  it("adds up requests and tokens, by purpose, the people who asked most and the workspace's jobs", async () => {
    const s = await usageSummary(a.ownerCtx);
    const rows = await adminQuery<{ membership_id: string | null; request_id: string; purpose: string; input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_write_tokens: number; created_at: string }>(
      "SELECT membership_id, request_id, purpose, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, created_at FROM ai_usage WHERE organisation_id = $1", [a.ownerCtx.org.id]);
    const tz = a.ownerCtx.org.timezone;
    const today = todayLocal(tz);
    const month = rows.filter((r) => Date.parse(r.created_at) >= localMidnight(`${today.slice(0, 7)}-01`, tz).getTime());
    const sum = (k: "input_tokens" | "output_tokens" | "cache_read_tokens" | "cache_write_tokens", rs = month) => rs.reduce((n, r) => n + Number(r[k]), 0);
    expect(s).toMatchObject({ ready: true, from: `${today.slice(0, 7)}-01`, to: today, dailyLimit: 150 });
    expect(s.totals).toEqual({ requests: new Set(month.map((r) => r.request_id)).size, calls: month.length, inputTokens: sum("input_tokens"), outputTokens: sum("output_tokens"), cacheReadTokens: sum("cache_read_tokens"), cacheWriteTokens: sum("cache_write_tokens") });
    expect(s.byPurpose.map((p) => p.purpose)).toEqual(expect.arrayContaining(["chat", "plan", "report", "summary", "test", "other"]));
    for (let i = 1; i < s.byPurpose.length; i++) expect(s.byPurpose[i - 1].requests).toBeGreaterThanOrEqual(s.byPurpose[i].requests);
    expect(s.byPurpose[0]).toMatchObject({ purpose: "chat" });
    const report = s.byPurpose.find((p) => p.purpose === "report")!;
    expect(report).toMatchObject({ calls: 2, inputTokens: 5000, outputTokens: 400 });
    expect(s.workspace).toMatchObject({ calls: 2, inputTokens: 5000, outputTokens: 400 });
    expect(s.topPeople[0]).toMatchObject({ membershipId: a.employee2Ctx.membership.id, name: "Ben Employee" });
    expect(s.topPeople[0].requests).toBeGreaterThanOrEqual(150);
    expect(s.topPeople.length).toBeLessThanOrEqual(5);
    expect(s.topPeople.find((p) => p.membershipId === a.managerCtx.membership.id)?.tokens).toBe(1200 + 340 + 80 + 2_147_483_647);
    expect(s.topPeople.every((p) => p.membershipId)).toBe(true);
    // HR sees the same; another organisation sees only its own.
    expect((await usageSummary(a.hrCtx)).totals).toEqual(s.totals);
    expect((await usageSummary(b.ownerCtx)).totals).toMatchObject({ calls: 1, requests: 1 });
  });

  it("is for owners and HR only", async () => {
    await expect(usageSummary(a.employeeCtx)).rejects.toMatchObject({ status: 403 });
    await expect(usageSummary(a.managerCtx)).rejects.toMatchObject({ status: 403 });
  });
});

describe("bursts", () => {
  it("the 21st request within a minute is refused with plain words", async () => {
    // Keep clear of a minute's edge, so all 21 land in one window.
    const into = Date.now() % 60_000;
    if (into > 50_000) await new Promise((r) => setTimeout(r, 60_500 - into));
    for (let i = 0; i < 20; i++) await checkAiBurst(a.employeeCtx);
    await expect(checkAiBurst(a.employeeCtx)).rejects.toMatchObject({ status: 429, code: "RATE_LIMITED", message: AI_BURST_MESSAGE });
    // Per person: a colleague is not held up.
    await expect(checkAiBurst(a.employee2Ctx)).resolves.toBeUndefined();
  });
});
