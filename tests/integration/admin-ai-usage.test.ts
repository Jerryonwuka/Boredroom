/**
 * The Control Center's AI usage (owner request, 27 October 2026: "which company is spending more tokens, how many AI bots,
 * how many Brendas they have"). Read from the usage ledger, natural voice's counters and Brenda for Mac's platform-wide
 * tables: per company, most tokens first, with assistants, people and an estimated cost; one company's drill-down by
 * purpose, model and person, names only when asked for.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { resetTestDatabase, adminQuery } from "../helpers/db";
import { buildCompany, type CompanyFixture } from "@/server/services/fixtures";
import { aiUsageForOrg, aiUsageOverview } from "@/server/admin/ai-usage";
import { estimateUsd } from "@/lib/ai-pricing";

let a: CompanyFixture;
let b: CompanyFixture;
let cId: string;

const row = (org: string, membership: string | null, purpose: string, model: string, input: number, output: number, opts: { request?: string; cacheRead?: number; cacheWrite?: number; at?: string } = {}) =>
  adminQuery(`INSERT INTO ai_usage(organisation_id, membership_id, request_id, purpose, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, created_at)
    VALUES ($1, $2, COALESCE($3::uuid, gen_random_uuid()), $4, $5, $6, $7, $8, $9, COALESCE($10::timestamptz, now()))`,
    [org, membership, opts.request ?? null, purpose, model, input, output, opts.cacheRead ?? 0, opts.cacheWrite ?? 0, opts.at ?? null]);

beforeAll(async () => {
  await resetTestDatabase();
  a = await buildCompany("a");
  b = await buildCompany("b");
  // A third company with nobody in it yet and no usage.
  [{ id: cId }] = await adminQuery<{ id: string }>(`INSERT INTO organisations(name, slug) VALUES ('Quiet Ltd', 'quiet-ltd') RETURNING id`);
  const A = a.ownerCtx.org.id, B = b.ownerCtx.org.id;
  // Company A: Ada's chat turn with two model calls (one request), Ben's standup, the company's own report.
  const turn = "00000000-0000-4000-8000-000000000001";
  await row(A, a.employeeCtx.membership.id, "chat", "claude-opus-5-5", 1000, 200, { request: turn, cacheRead: 5000, cacheWrite: 100 });
  await row(A, a.employeeCtx.membership.id, "chat", "claude-opus-5-5", 1200, 300, { request: turn });
  await row(A, a.employee2Ctx.membership.id, "standup", "claude-sonnet-5-5", 400, 100);
  await row(A, null, "report", "claude-opus-5-5", 3000, 500);
  // Company B: far more tokens, one person.
  await row(B, b.employeeCtx.membership.id, "chat", "claude-opus-5-5", 90_000, 10_000);
  // Outside every period: ignored.
  await row(B, b.employeeCtx.membership.id, "chat", "claude-opus-5-5", 9_000_000, 9, { at: "2020-01-01T00:00:00Z" });
  // Natural voice for A; Ada set her assistant up.
  await adminQuery(`INSERT INTO voice_usage_daily(organisation_id, membership_id, day, key_source, characters, utterances) VALUES ($1, $2, CURRENT_DATE, 'environment', 640, 4)`, [A, a.employeeCtx.membership.id]);
  await adminQuery(`INSERT INTO assistant_profiles(membership_id, organisation_id, name, setup_done_at) VALUES ($1, $2, 'Max', now())
    ON CONFLICT (membership_id) DO UPDATE SET setup_done_at = now()`, [a.employeeCtx.membership.id, A]);
});

describe("all companies", () => {
  it("most tokens first, with requests, people, assistants, voice and an estimated cost; a company with nothing still listed", async () => {
    const u = await aiUsageOverview("7d");
    expect(u.ready.ai).toBe(true);
    expect(u.orgs.map((o) => o.id)).toEqual([b.ownerCtx.org.id, a.ownerCtx.org.id, cId]);
    const A = u.orgs.find((o) => o.id === a.ownerCtx.org.id)!;
    expect(A).toMatchObject({
      requests: 3, calls: 4, inputTokens: 5600, outputTokens: 1100, cacheReadTokens: 5000, cacheWriteTokens: 100, totalTokens: 11_800,
      people: 2, members: 5, assistants: 6, setUp: 1, voiceCharacters: 640, voiceUtterances: 4,
    });
    const expected = estimateUsd("claude-opus-5-5", { inputTokens: 5200, outputTokens: 1000, cacheReadTokens: 5000, cacheWriteTokens: 100 })
      + estimateUsd("claude-sonnet-5-5", { inputTokens: 400, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 });
    expect(A.costUsd).toBeCloseTo(expected, 10);
    const C = u.orgs.find((o) => o.id === cId)!;
    expect(C).toMatchObject({ requests: 0, totalTokens: 0, costUsd: 0, members: 0, assistants: 1, people: 0 });
    expect(u.totals).toMatchObject({ requests: 4, totalTokens: 11_800 + 100_000, orgsUsing: 2, people: 3, assistants: 13, voiceCharacters: 640 });
    expect(u.byDay.reduce((n, d) => n + d.tokens, 0)).toBe(111_800);
    expect(u.unpriced).toEqual([]);
  });

  it("Brenda for Mac only as platform totals (no company): looks, tasks and the front desk apart", async () => {
    const [t] = await adminQuery<{ ok: boolean }>(`SELECT to_regclass('public.look_usage_daily') IS NOT NULL AND to_regclass('public.act_usage_daily') IS NOT NULL AS ok`);
    if (!t.ok) return;
    await adminQuery(`INSERT INTO look_usage_daily(day, model, looks, steps, image_tokens, input_tokens, output_tokens) VALUES ((now() AT TIME ZONE 'UTC')::date, 'claude-opus-5-5', 3, 5, 900, 4000, 300)`);
    await adminQuery(`INSERT INTO act_usage_daily(day, model, kind, tasks, steps, input_tokens, output_tokens) VALUES ((now() AT TIME ZONE 'UTC')::date, 'claude-sonnet-5-5', 'screen', 2, 6, 1000, 100)`);
    const u = await aiUsageOverview("month");
    expect(u.mac?.looks).toMatchObject({ looks: 3, steps: 5, imageTokens: 900, totalTokens: 4300 });
    expect(u.mac?.tasks).toMatchObject({ tasks: 2, steps: 6, totalTokens: 1100 });
    // Never added to a company.
    expect(u.totals.totalTokens).toBe(111_800);
  });
});

describe("one company", () => {
  it("by purpose (requests counted once), by model, the people who asked most and the company's own jobs", async () => {
    const d = await aiUsageForOrg(a.ownerCtx.org.id, "30d", { names: true });
    expect(d.totals).toMatchObject({ requests: 3, people: 2, totalTokens: 11_800, voiceCharacters: 640, voicePeople: 1 });
    expect(d.byPurpose.map((p) => [p.purpose, p.requests, p.calls])).toEqual([["chat", 1, 2], ["report", 1, 1], ["standup", 1, 1]]);
    expect(d.byModel.map((m) => m.model)).toEqual(["claude-opus-5-5", "claude-sonnet-5-5"]);
    expect(d.topPeople.map((p) => [p.name, p.requests])).toEqual([[a.employee.displayName, 1], [a.employee2.displayName, 1]]);
    expect(d.topPeople[0].membershipId).toBe(a.employeeCtx.membership.id);
    expect(d.workspace).toMatchObject({ requests: 1, calls: 1, totalTokens: 3500 });
    expect(d.org).toMatchObject({ members: 5, assistants: 6, setUp: 1, workspaceAssistant: "Brenda" });
  });

  it("without names: nobody is named", async () => {
    const d = await aiUsageForOrg(a.ownerCtx.org.id, "30d", { names: false });
    expect(d.topPeople.every((p) => p.name === null && p.role === null)).toBe(true);
  });

  it("an unknown company is a 404", async () => {
    await expect(aiUsageForOrg("00000000-0000-4000-8000-0000000000ff", "month", { names: false })).rejects.toMatchObject({ status: 404 });
  });
});
