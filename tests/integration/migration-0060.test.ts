/**
 * Migration 0060 (Brenda and her helpers, build 1; owner's approved brief, 12 October 2026: permission rule v2, "when you
 * hold the keys and clearly ask for a routine task, the request is the permission, and she does it. She still asks before
 * anything destructive, anything sent, anything that costs money, or anything sensitive"; contract E.1).
 *
 * On the throwaway test database only: 0058 comes from db/migrations, 0059 and 0060 wait in db/pending and are applied
 * here by hand. Checked: the order guard, idempotence (twice), every constraint and the trigger, one live job per person
 * beside one live task, and that `mac_requests` and job rows are the person's alone (owner and HR read nothing).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetTestDatabase, adminQuery, appQueryAs } from "../helpers/db";
import { buildCompany, type CompanyFixture } from "@/server/services/fixtures";
import { forget0057 } from "@/server/lib/schema-0057";
import { forget0058 } from "@/server/lib/schema-0058";
import { forget0059 } from "@/server/lib/schema-0059";
import { forget0060, schema0060Ready } from "@/server/lib/schema-0060";
import { withWorker } from "@/server/db";

const pending = (f: string) => readFileSync(join(process.cwd(), "db", "migrations", f), "utf8");
const NONCE = (n: number) => n.toString(16).padStart(32, "0");
let a: CompanyFixture;

async function insertRequest(o: { org: string; m: string; nonce: string; outcome?: string; risk?: string; by?: string; via?: string | null; lane?: string }) {
  return (await adminQuery<{ id: string }>(
    `INSERT INTO mac_requests(organisation_id, membership_id, nonce, request_text, source, requested_at, matched, lane, risk, authorised_by, confirmed_via, outcome)
     VALUES ($1, $2, $3, 'Organise my desktop', 'voice', now(), 'router', $4, $5, $6, $7, $8) RETURNING id`,
    [o.org, o.m, o.nonce, o.lane ?? "job", o.risk ?? "routine", o.by ?? "request", o.via ?? null, o.outcome ?? "pending"]))[0].id;
}

const JOB = JSON.stringify({ title: "Organise your Desktop", doing: "Organising your Desktop", goal: "Organise the files on my Desktop.", model: "sonnet", progress: { done: 0, of: 0 }, counts: {}, outputs: [], undo: { available: false, undoneAt: null } });

async function insertJob(o: { org: string; m: string; requestId: string | null; nonce: string; status?: string; by?: string; risk?: string; confirmed?: boolean }) {
  return (await adminQuery<{ id: string }>(
    `INSERT INTO assistant_tasks(organisation_id, membership_id, kind, helper, status, request_text, request_source, request_age_ms, plan_text, plan_sha256,
                                 answer_by, step_cap, authorised_by, risk, request_id, request_nonce, request_at, job, confirmed_at, confirmed_via)
     VALUES ($1, $2, 'job', 'files', $3, 'Organise my desktop', 'voice', 400, 'I''ll organise your Desktop.', repeat('a', 64), now() + interval '10 minutes', 40,
             $4, $5, $6, $7, now(), $8::jsonb, $9, $10) RETURNING id`,
    [o.org, o.m, o.status ?? "running", o.by ?? "request", o.risk ?? "routine", o.requestId, o.nonce, JOB, o.confirmed ? new Date().toISOString() : null, o.confirmed ? "button" : null]))[0].id;
}

beforeAll(async () => {
  await resetTestDatabase();
  forget0057(); forget0058(); forget0059(); forget0060();
  a = await buildCompany("a");
});

afterAll(() => { forget0059(); forget0060(); });

describe("the order guard and idempotence", () => {
  // Skipped (security audit verification, 23 October 2026): the migration now ships in db/migrations, so the test reset applies it and there is no "before" to test.
  it.skip("0060 before 0059 is refused with MIGRATION_ORDER, and changes nothing", async () => {
    await expect(adminQuery(pending("0060_helpers.sql"))).rejects.toThrow(/MIGRATION_ORDER/);
    expect((await adminQuery<{ t: string | null }>("SELECT to_regclass('public.mac_requests')::text AS t"))[0].t).toBeNull();
    expect(await withWorker((db) => schema0060Ready(db))).toBe(false);
  });

  it("after 0059 it applies, twice, and schema-0060 reads it as ready", async () => {
    await adminQuery(pending("0059_mac_help.sql"));
    await adminQuery(pending("0060_helpers.sql"));
    await adminQuery(pending("0060_helpers.sql"));
    forget0060();
    expect(await withWorker((db) => schema0060Ready(db))).toBe(true);
    const cols = await adminQuery<{ attname: string }>(`SELECT attname FROM pg_attribute WHERE attrelid = 'assistant_private'::regclass AND attname = 'check_every_task'`);
    expect(cols).toHaveLength(1);
    const kinds = await adminQuery<{ def: string }>(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'act_usage_daily_kind_check'`);
    expect(kinds[0].def).toMatch(/router.*look_now.*files.*operator/);
  });
});

describe("mac_requests (E.1)", () => {
  it("a nonce once per person; text, source, lane and outcome checked", async () => {
    const m = a.employeeCtx.membership.id, org = a.ownerCtx.org.id;
    await insertRequest({ org, m, nonce: NONCE(1) });
    await expect(insertRequest({ org, m, nonce: NONCE(1) })).rejects.toThrow(/mac_requests_once/);
    await expect(insertRequest({ org, m, nonce: "XYZ" })).rejects.toThrow(/mac_requests_nonce_check/);
    await expect(insertRequest({ org, m, nonce: NONCE(2), lane: "elsewhere" })).rejects.toThrow(/mac_requests_lane_check/);
    await expect(insertRequest({ org, m, nonce: NONCE(3), outcome: "maybe" })).rejects.toThrow(/mac_requests_outcome_check/);
  });

  it("db.ask_without_yes_violates: something that ran is routine and asked for, or the person's yes with how", async () => {
    const m = a.employeeCtx.membership.id, org = a.ownerCtx.org.id;
    await expect(insertRequest({ org, m, nonce: NONCE(10), outcome: "done", risk: "ask", by: "request" })).rejects.toThrow(/mac_requests_authorised/);
    await expect(insertRequest({ org, m, nonce: NONCE(11), outcome: "done", risk: "ask", by: "yes", via: null })).rejects.toThrow(/mac_requests_authorised/);
    await insertRequest({ org, m, nonce: NONCE(12), outcome: "done", risk: "ask", by: "yes", via: "button" });
    await insertRequest({ org, m, nonce: NONCE(13), outcome: "done", risk: "routine", by: "request" });
    // Nothing ran: refused, said no and pending need no yes.
    await insertRequest({ org, m, nonce: NONCE(14), outcome: "said_no", risk: "ask", by: "request" });
    await insertRequest({ org, m, nonce: NONCE(15), outcome: "refused", risk: "never", by: "request" });
  });

  it("db.rls_mac_requests_person_only: owner and HR read nothing, the person reads their own, nobody writes another's", async () => {
    const id = await insertRequest({ org: a.ownerCtx.org.id, m: a.employeeCtx.membership.id, nonce: NONCE(20) });
    expect(await appQueryAs(a.ownerCtx.user.profileId, "SELECT id FROM mac_requests WHERE id = $1", [id])).toHaveLength(0);
    expect(await appQueryAs(a.hrCtx.user.profileId, "SELECT id FROM mac_requests WHERE id = $1", [id])).toHaveLength(0);
    expect(await appQueryAs(a.managerCtx.user.profileId, "SELECT id FROM mac_requests WHERE id = $1", [id])).toHaveLength(0);
    expect(await appQueryAs(a.employeeCtx.user.profileId, "SELECT id FROM mac_requests WHERE id = $1", [id])).toHaveLength(1);
    await expect(appQueryAs(a.ownerCtx.user.profileId,
      `INSERT INTO mac_requests(organisation_id, membership_id, nonce, request_text, source, requested_at, matched, lane, risk, authorised_by)
       VALUES ($1, $2, $3, 'x', 'typed', now(), 'mac', 'mac', 'routine', 'request')`, [a.ownerCtx.org.id, a.employeeCtx.membership.id, NONCE(21)])).rejects.toThrow(/row-level security/);
    expect(await appQueryAs(a.ownerCtx.user.profileId, "DELETE FROM mac_requests WHERE id = $1 RETURNING id", [id])).toHaveLength(0);
  });
});

describe("jobs on assistant_tasks (E.1)", () => {
  it("db.job_without_request_violates: a running job needs its recorded request (or a yes)", async () => {
    const org = a.ownerCtx.org.id, m = a.employeeCtx.membership.id;
    await expect(insertJob({ org, m, requestId: null, nonce: NONCE(30) })).rejects.toThrow(/assistant_tasks_job_check/);
    // A job judged anything but routine, without a yes, cannot run.
    const r = await insertRequest({ org, m, nonce: NONCE(31) });
    await expect(insertJob({ org, m, requestId: r, nonce: NONCE(31), risk: "ask" })).rejects.toThrow(/assistant_tasks_running_needs_yes/);
    // With the person's yes it may.
    const j = await insertJob({ org, m, requestId: r, nonce: NONCE(31), risk: "ask", by: "yes", confirmed: true });
    await adminQuery("UPDATE assistant_tasks SET status = 'stopped', ended_at = now(), request_text = NULL WHERE id = $1", [j]);
  });

  it("db.screen_task_needs_its_yes: only a job runs on a recorded request; a screen task keeps needing the person's yes (review, 16 October 2026)", async () => {
    const org = a.ownerCtx.org.id, m = a.hrCtx.membership.id;
    const r = await insertRequest({ org, m, nonce: NONCE(35), lane: "mac" });
    const screen = (status: string, extra = "") => adminQuery(
      `INSERT INTO assistant_tasks(organisation_id, membership_id, kind, status, request_text, request_source, request_age_ms, plan_text, plan_sha256, answer_by${extra ? ", authorised_by, risk, request_id, request_nonce, request_at" : ""})
       VALUES ($1, $2, 'screen', '${status}', 'Rename these files', 'voice', 300, 'I''ll rename these files.', repeat('c', 64), now() + interval '1 minute'${extra})`, [org, m]);
    // A running screen task pointing at the person's own request, with no yes: refused by the database.
    await expect(screen("running", `, 'request', 'routine', '${r}', '${NONCE(35)}', now()`)).rejects.toThrow(/assistant_tasks_running_needs_yes|assistant_tasks_job_check/);
    // Even a proposed one may not carry a request's authorisation.
    await expect(screen("proposed", `, 'request', 'routine', '${r}', '${NONCE(35)}', now()`)).rejects.toThrow(/assistant_tasks_job_check/);
    // Without them, and without a yes, it may only be proposed (0058's rule, unchanged).
    await expect(screen("running")).rejects.toThrow(/assistant_tasks_running_needs_yes/);
    await screen("proposed");
  });

  it("db.request_of_someone_else_refused: the trigger checks the request is the person's own, with the same nonce", async () => {
    const org = a.ownerCtx.org.id;
    const bens = await insertRequest({ org, m: a.employee2Ctx.membership.id, nonce: NONCE(40) });
    await expect(insertJob({ org, m: a.employeeCtx.membership.id, requestId: bens, nonce: NONCE(40) })).rejects.toThrow(/REQUEST_NOT_THEIRS/);
    const adas = await insertRequest({ org, m: a.employeeCtx.membership.id, nonce: NONCE(41) });
    await expect(insertJob({ org, m: a.employeeCtx.membership.id, requestId: adas, nonce: NONCE(42) })).rejects.toThrow(/REQUEST_NOT_THEIRS/);
  });

  it("db.one_live_job_per_person: one live job (paused counts) beside one live task", async () => {
    const org = a.ownerCtx.org.id, m = a.managerCtx.membership.id;
    const r1 = await insertRequest({ org, m, nonce: NONCE(50) });
    const j1 = await insertJob({ org, m, requestId: r1, nonce: NONCE(50) });
    await adminQuery("UPDATE assistant_tasks SET status = 'paused', paused_at = now() WHERE id = $1", [j1]);
    const r2 = await insertRequest({ org, m, nonce: NONCE(51) });
    await expect(insertJob({ org, m, requestId: r2, nonce: NONCE(51) })).rejects.toThrow(/assistant_tasks_one_live_job/);
    // A screen task beside it is allowed.
    await adminQuery(
      `INSERT INTO assistant_tasks(organisation_id, membership_id, kind, request_text, request_source, request_age_ms, plan_text, plan_sha256, answer_by)
       VALUES ($1, $2, 'screen', 'Rename these files', 'voice', 300, 'I''ll rename these files.', repeat('b', 64), now() + interval '1 minute')`, [org, m]);
    // 'paused' only for jobs.
    await expect(adminQuery("UPDATE assistant_tasks SET status = 'paused' WHERE membership_id = $1 AND kind = 'screen'", [m])).rejects.toThrow(/assistant_tasks_job_check/);
  });

  it("job rows are the person's alone (owner and HR read nothing)", async () => {
    const rows = await adminQuery<{ id: string }>("SELECT id FROM assistant_tasks WHERE kind = 'job' AND membership_id = $1", [a.managerCtx.membership.id]);
    expect(rows.length).toBeGreaterThan(0);
    expect(await appQueryAs(a.ownerCtx.user.profileId, "SELECT id FROM assistant_tasks WHERE kind = 'job'")).toHaveLength(0);
    expect(await appQueryAs(a.hrCtx.user.profileId, "SELECT id FROM assistant_tasks WHERE kind = 'job'")).toHaveLength(0);
    expect((await appQueryAs(a.managerCtx.user.profileId, "SELECT id FROM assistant_tasks WHERE kind = 'job'")).length).toBe(rows.length);
  });

  it("check_every_task: off by default, the person's own (0047's policy)", async () => {
    await adminQuery(`INSERT INTO assistant_private(organisation_id, membership_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [a.ownerCtx.org.id, a.employeeCtx.membership.id]);
    const r = await adminQuery<{ c: boolean }>("SELECT check_every_task AS c FROM assistant_private WHERE membership_id = $1", [a.employeeCtx.membership.id]);
    expect(r[0].c).toBe(false);
    expect(await appQueryAs(a.ownerCtx.user.profileId, "UPDATE assistant_private SET check_every_task = true WHERE membership_id = $1 RETURNING membership_id", [a.employeeCtx.membership.id])).toHaveLength(0);
  });
});
