import { describe, it, expect, vi, beforeEach } from "vitest";

// The async standup's jobs (owner decisions, 8–9 October 2026: phase 7c, contract B.9): scheduled at the day's time and
// the cutoff (moved while they still wait), each returning at once before migration 0050, idempotent, and a draft job
// that never throws after its claim (a compose failure is recorded as a failed attempt; the sweep owns retries). The
// standup service and the database are fakes (the integration tests run the real ones, the old worker's kill included).

const st = vi.hoisted(() => ({
  ready: true, jobs: [] as { type: string; payload: Record<string, unknown>; dedupKey?: string; runAt?: Date }[], moved: [] as unknown[][],
  days: [] as { teamId: string; localDate: string; postAt: string; cutoffAt: string; opened: boolean }[],
  rollupsDue: [] as { rollupId: string; cutoffAt: string }[], sweepDue: false,
  claim: null as unknown, composeError: null as Error | null, saved: [] as unknown[], failed: [] as unknown[][], sent: [] as unknown[],
  opened: { status: "opened", entryIds: [] as string[], rollupId: null as string | null }, sweep: { opened: 0, toDraft: [] as string[], rollupsDue: [] as string[], released: 0, lateNoted: 0, missed: 0, cancelled: 0 },
}));
vi.mock("@/server/db", () => {
  const db = {
    query: async (sql: string, p: unknown[] = []) => {
      if (/UPDATE jobs SET next_run_at/.test(sql)) st.moved.push(p);
      if (/FROM standup_entries/.test(sql)) return (p[0] as string[]).map((id) => ({ id, attempts: 1 }));
      return [];
    },
    maybeOne: async (sql: string) => (/FROM standup_rollups/.test(sql) ? { cutoff_at: "2026-10-09T11:00:00.000Z" } : null),
    one: async () => ({ ok: true }),
  };
  return { withWorker: async (fn: (d: typeof db) => Promise<unknown>) => fn(db), withUser: async () => { throw new Error("no"); }, withSystem: async () => { throw new Error("no"); }, getPool: () => null };
});
vi.mock("@/server/services/common", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/services/common")>()),
  enqueueJob: async (_db: unknown, type: string, payload: Record<string, unknown>, o: { dedupKey?: string; runAt?: Date } = {}) => { st.jobs.push({ type, payload, ...o }); },
}));
vi.mock("@/server/lib/schema-0050", () => ({ schema0050Ready: async () => st.ready, forget0050: () => undefined, isMissingSchema: () => false, retryWithout0050: (fn: () => unknown) => fn() }));
vi.mock("@/server/services/standup", () => ({
  standupDaysDue: async () => st.days,
  standupRollupsDue: async () => st.rollupsDue,
  standupSweepDue: async () => st.sweepDue,
  openStandupDay: async () => st.opened,
  claimStandupDraft: async () => st.claim ?? { skip: "done" },
  saveStandupDraft: async (id: string, c: unknown) => { st.saved.push([id, c]); return { delivery: "notified" }; },
  failStandupDraft: async (...a: unknown[]) => { st.failed.push(a); },
  rollupInput: async (id: string) => (id === ROLLUP ? { rollupId: ROLLUP, organisationId: "o", slug: "acme", team: { id: "t", name: "Design" }, localDate: "2026-10-09", dateLabel: "Friday 9 October", cutoffAt: "2026-10-09T11:00:00.000Z", timeZone: "Africa/Lagos", members: [{ membershipId: "a", name: "Ada Obi" }], entries: [], recipients: ["d"] } : { skip: "done" }),
  sendRollup: async (id: string, c: unknown) => { st.sent.push([id, c]); return { notified: 1, held: 0 }; },
  sweepStandups: async () => st.sweep,
}));
vi.mock("@/server/services/standup-compose", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/services/standup-compose")>()),
  standupModelFor: async () => null,
  composeStandup: async () => { if (st.composeError) throw st.composeError; return { engine: "template", texts: {}, draft: {}, blockers: [], usedModel: false }; },
}));

import { scheduleStandups } from "../../worker/schedule";
import { handlers } from "../../worker/handlers";

const TEAM = "00000000-0000-4000-8000-0000000000a2";
const ROLLUP = "00000000-0000-4000-8000-0000000000d2";
const ENTRY = "00000000-0000-4000-8000-0000000000d1";
const NOW = new Date("2026-10-09T08:29:00.000Z"); // 09:29 in Lagos
const run = (type: string, payload: Record<string, unknown>) => handlers[type](payload, { jobId: "j", attempt: 1 });

beforeEach(() => {
  st.ready = true; st.jobs = []; st.moved = []; st.days = []; st.rollupsDue = []; st.sweepDue = false; st.claim = null; st.composeError = null;
  st.saved = []; st.failed = []; st.sent = []; st.opened = { status: "opened", entryIds: [], rollupId: null };
  st.sweep = { opened: 0, toDraft: [], rollupsDue: [], released: 0, lateNoted: 0, missed: 0, cancelled: 0 };
});

describe("scheduleStandups", () => {
  it("queues the day at its post time (at most an hour ahead), moves one still waiting, and the hourly sweep", async () => {
    st.days = [
      { teamId: TEAM, localDate: "2026-10-09", postAt: "2026-10-09T08:30:00.000Z", cutoffAt: "2026-10-09T11:00:00.000Z", opened: false },
      { teamId: "00000000-0000-4000-8000-0000000000a3", localDate: "2026-10-09", postAt: "2026-10-09T10:00:00.000Z", cutoffAt: "2026-10-09T12:00:00.000Z", opened: false },
      { teamId: "00000000-0000-4000-8000-0000000000a4", localDate: "2026-10-09", postAt: "2026-10-09T08:00:00.000Z", cutoffAt: "2026-10-09T11:00:00.000Z", opened: true },
    ];
    st.rollupsDue = [{ rollupId: ROLLUP, cutoffAt: "2026-10-09T09:00:00.000Z" }];
    const r = await scheduleStandups(NOW);
    expect(r).toEqual({ opens: 1, rollups: 1, sweep: false });
    expect(st.jobs).toEqual([
      { type: "standup.open", payload: { teamId: TEAM, localDate: "2026-10-09" }, dedupKey: `standup.open:${TEAM}:2026-10-09`, runAt: new Date("2026-10-09T08:30:00.000Z") },
      { type: "standup.rollup", payload: { rollupId: ROLLUP }, dedupKey: `standup.rollup:${ROLLUP}`, runAt: new Date("2026-10-09T09:00:00.000Z") },
      { type: "standup.sweep", payload: {}, dedupKey: `standup.sweep:h${Math.floor(NOW.getTime() / 3_600_000)}` },
    ]);
    expect(st.moved).toEqual([[`standup.open:${TEAM}:2026-10-09`, new Date("2026-10-09T08:30:00.000Z")], [`standup.rollup:${ROLLUP}`, new Date("2026-10-09T09:00:00.000Z")]]);
  });

  it("queues the sweep for the minute when something is due", async () => {
    st.sweepDue = true;
    await scheduleStandups(NOW);
    expect(st.jobs.map((j) => j.dedupKey)).toEqual([`standup.sweep:${Math.floor(NOW.getTime() / 60_000)}`, `standup.sweep:h${Math.floor(NOW.getTime() / 3_600_000)}`]);
  });

  it("does nothing before migration 0050", async () => {
    st.ready = false;
    st.days = [{ teamId: TEAM, localDate: "2026-10-09", postAt: "2026-10-09T08:30:00.000Z", cutoffAt: "2026-10-09T11:00:00.000Z", opened: false }];
    expect(await scheduleStandups(NOW)).toEqual({ opens: 0, rollups: 0, sweep: false });
    expect(st.jobs).toEqual([]);
  });
});

describe("the standup jobs", () => {
  it("are all known to this worker (so a job the older worker killed is claimed back)", () => {
    for (const t of ["standup.open", "standup.draft", "standup.rollup", "standup.sweep"]) expect(typeof handlers[t], t).toBe("function");
  });

  it("standup.open opens the day, then a draft job per entry and the rollup at the cutoff", async () => {
    st.opened = { status: "opened", entryIds: [ENTRY, "not-an-id"], rollupId: ROLLUP };
    await run("standup.open", { teamId: TEAM, localDate: "2026-10-09" });
    expect(st.jobs).toEqual([
      { type: "standup.draft", payload: { entryId: ENTRY }, dedupKey: `standup.draft:${ENTRY}:1` },
      { type: "standup.rollup", payload: { rollupId: ROLLUP }, dedupKey: `standup.rollup:${ROLLUP}`, runAt: new Date("2026-10-09T11:00:00.000Z") },
    ]);
    st.jobs = [];
    await run("standup.open", { teamId: "nope", localDate: "2026-10-09" });
    st.opened = { status: "off", entryIds: [], rollupId: null };
    await run("standup.open", { teamId: TEAM, localDate: "2026-10-09" });
    expect(st.jobs).toEqual([]);
  });

  it("standup.draft saves what was composed, or records a failed attempt (never thrown), and does nothing unclaimed", async () => {
    await run("standup.draft", { entryId: ENTRY });
    expect(st.saved).toEqual([]);
    st.claim = { entryId: ENTRY, ctx: {}, team: { id: TEAM, name: "Design", projectIds: [] }, localDate: "2026-10-09", dateLabel: "", sinceLabel: "", window: { since: "", until: "" }, timeZone: "Africa/Lagos", preferences: [] };
    await run("standup.draft", { entryId: ENTRY });
    expect(st.saved).toHaveLength(1);
    st.composeError = Object.assign(new Error("relation does not exist"), { code: "42P01" });
    await expect(run("standup.draft", { entryId: ENTRY })).resolves.toBeUndefined();
    expect(st.failed).toEqual([[ENTRY, "facts_42P01", "relation does not exist"]]);
  });

  it("standup.rollup composes and sends a due rollup once; the sweep finishes what lost jobs left", async () => {
    await run("standup.rollup", { rollupId: ROLLUP });
    expect(st.sent).toHaveLength(1);
    expect((st.sent[0] as [string, { counts: unknown; noUpdate: unknown }])[1]).toMatchObject({ counts: { members: 1, posted: 0 }, noUpdate: [{ membershipId: "a", name: "Ada Obi" }] });
    st.claim = { entryId: ENTRY, ctx: {}, team: { id: TEAM, name: "Design", projectIds: [] }, localDate: "2026-10-09", dateLabel: "", sinceLabel: "", window: { since: "", until: "" }, timeZone: "Africa/Lagos", preferences: [] };
    st.sweep = { ...st.sweep, toDraft: [ENTRY], rollupsDue: [ROLLUP, "00000000-0000-4000-8000-0000000000d9"] };
    await run("standup.sweep", {});
    expect(st.saved).toHaveLength(1);
    expect(st.sent).toHaveLength(2);
  });

  it("each returns at once before migration 0050", async () => {
    st.ready = false;
    st.opened = { status: "opened", entryIds: [ENTRY], rollupId: ROLLUP };
    st.claim = { entryId: ENTRY };
    for (const [t, p] of [["standup.open", { teamId: TEAM, localDate: "2026-10-09" }], ["standup.draft", { entryId: ENTRY }], ["standup.rollup", { rollupId: ROLLUP }], ["standup.sweep", {}]] as const) await run(t, p);
    expect([st.jobs, st.saved, st.sent]).toEqual([[], [], []]);
  });
});
