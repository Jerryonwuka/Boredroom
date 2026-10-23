/**
 * Quiet heartbeats, migration 0062 (owner request, 23 October 2026: realtime plan, phase 0, item 3), on the throwaway
 * test database only: it waits in db/pending and is applied here by hand. Before it, a heartbeat sends a change
 * notification (every visible page in the organisation refreshed every 30 seconds); after it, a heartbeat is silent and
 * a start, a pause, a resume and a stop still notify. Applies twice.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetTestDatabase, adminQuery, adminUrl } from "../helpers/db";
import { buildCompany, type CompanyFixture } from "@/server/services/fixtures";
import { heartbeat, pauseSession, resumeSession, startSession, stopSession } from "@/server/services/sessions";

const sql = () => readFileSync(join(process.cwd(), "db", "migrations", "0062_quiet_heartbeats.sql"), "utf8");
let a: CompanyFixture;
let listener: Client;
let got: { table: string; op: string; id: string }[] = [];

/** Notifications arrive after COMMIT; a short wait collects them. */
async function collect<T>(fn: () => Promise<T>): Promise<{ result: T; events: { table: string; op: string }[] }> {
  got = [];
  const result = await fn();
  await new Promise((r) => setTimeout(r, 150));
  return { result, events: got.filter((e) => e.table === "work_sessions").map((e) => ({ table: e.table, op: e.op })) };
}

beforeAll(async () => {
  await resetTestDatabase();
  a = await buildCompany("a");
  listener = new Client({ connectionString: adminUrl() });
  await listener.connect();
  listener.on("notification", (m) => { try { got.push(JSON.parse(m.payload ?? "{}")); } catch { /* not ours */ } });
  await listener.query(`LISTEN "org_${a.employeeCtx.org.id.replace(/-/g, "")}"`);
});
afterAll(async () => { await listener?.end(); });

// Skipped (security audit verification, 23 October 2026): the migration now ships in db/migrations, so the test reset applies it and there is no "before" to test.
describe.skip("before 0062", () => {
  it("a heartbeat notifies (today's behaviour)", async () => {
    const s = (await collect(() => startSession(a.employeeCtx, { taskId: a.taskIds.homepage }))).result;
    try {
      const hb = await collect(() => heartbeat(a.employeeCtx, s.id));
      expect(hb.events).toEqual([{ table: "work_sessions", op: "UPDATE" }]);
    } finally {
      await stopSession(a.employeeCtx, s.id, { expectedVersion: s.version, note: "", outcome: "continue_later" });
    }
  });
});

describe("after 0062", () => {
  beforeAll(async () => {
    await adminQuery(sql());
    await adminQuery(sql()); // idempotent
  });

  it("two triggers: insert, and update only when the state or the version changes", async () => {
    const t = await adminQuery<{ tgname: string; def: string }>(
      `SELECT tgname, pg_get_triggerdef(oid) AS def FROM pg_trigger WHERE tgrelid = 'work_sessions'::regclass AND tgname LIKE 'work_sessions_notify%' ORDER BY tgname`);
    expect(t.map((r) => r.tgname)).toEqual(["work_sessions_notify", "work_sessions_notify_insert"]);
    expect(t[0].def).toMatch(/AFTER UPDATE/);
    expect(t[0].def).toMatch(/old\.state IS DISTINCT FROM new\.state/i);
    expect(t[0].def).toMatch(/old\.version IS DISTINCT FROM new\.version/i);
    expect(t[1].def).toMatch(/AFTER INSERT/);
  });

  it("a start notifies; heartbeats are silent; pause, resume and stop notify", async () => {
    const started = await collect(() => startSession(a.employeeCtx, { taskId: a.taskIds.homepage }));
    expect(started.events).toContainEqual({ table: "work_sessions", op: "INSERT" });
    const s = started.result;
    for (let i = 0; i < 3; i++) {
      const hb = await collect(() => heartbeat(a.employeeCtx, s.id));
      expect(hb.events).toEqual([]);
    }
    const paused = await collect(() => pauseSession(a.employeeCtx, s.id, s.version));
    expect(paused.events).toEqual([{ table: "work_sessions", op: "UPDATE" }]);
    const resumed = await collect(() => resumeSession(a.employeeCtx, s.id, paused.result.version));
    expect(resumed.events).toEqual([{ table: "work_sessions", op: "UPDATE" }]);
    const stopped = await collect(() => stopSession(a.employeeCtx, s.id, { expectedVersion: resumed.result.version, note: "", outcome: "continue_later" }));
    expect(stopped.events).toEqual([{ table: "work_sessions", op: "UPDATE" }]);
  });

  it("a heartbeat still moves last_heartbeat_at (only the notification went)", async () => {
    const s = await startSession(a.employeeCtx, { taskId: a.taskIds.homepage });
    await adminQuery(`UPDATE work_sessions SET last_heartbeat_at = now() - interval '1 minute' WHERE id = $1`, [s.id]);
    await heartbeat(a.employeeCtx, s.id);
    const r = await adminQuery<{ fresh: boolean }>(`SELECT last_heartbeat_at > now() - interval '5 seconds' AS fresh FROM work_sessions WHERE id = $1`, [s.id]);
    expect(r[0].fresh).toBe(true);
    await stopSession(a.employeeCtx, s.id, { expectedVersion: s.version, note: "", outcome: "continue_later" });
  });
});
