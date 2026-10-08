/**
 * The end-of-day team report's Updates section (owner decision, 8 October 2026: personal assistants, phase 4). When the
 * workspace's own assistant has collected today's updates from everyone's assistant, the report says what each one
 * answered, under "## Updates", read as the recipient; without a collection there is no such section and nothing else
 * in the report changes.
 *
 * No test calls the model: the key from .env.local is dropped, the report is written with `useAssistant: false` and the
 * collection is processed with `useModel: false` (as the worker does).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { resetTestDatabase, adminQuery } from "../helpers/db";
import { buildCompany, type CompanyFixture } from "@/server/services/fixtures";
import { addComment, updateTask } from "@/server/services/tasks";
import { mdQuoted, teamReportNow, updateLine } from "@/server/services/daily-report";
import { collectWorkspaceUpdates, processFollowUpIds } from "@/server/services/follow-ups";
import { localTimeOn, todayLocal } from "@/server/lib/time";
import type { FollowUpFacts } from "@/lib/follow-ups";

delete process.env.ANTHROPIC_API_KEY;

let a: CompanyFixture;
const TZ = "Africa/Lagos";
const bodyOf = async (docId: string) => (await adminQuery<{ body: string }>("SELECT body FROM documents WHERE id = $1", [docId]))[0].body;

beforeAll(async () => {
  await resetTestDatabase();
  a = await buildCompany("a");
  // The AI teammate is in the plan, and the report goes out at the last minute of the day, so the collection is never late.
  await adminQuery(`UPDATE organisations SET feature_overrides = COALESCE(feature_overrides, '{}'::jsonb) || '{"AI_ASSISTANT": true}'::jsonb WHERE id = $1`, [a.ownerCtx.org.id]);
  await adminQuery(`INSERT INTO brenda_settings(organisation_id, daily_report_time) VALUES ($1, '23:59') ON CONFLICT (organisation_id) DO UPDATE SET daily_report_time = '23:59'`, [a.ownerCtx.org.id]);
  // Work today: Ada is blocked on the homepage (so the report has something to say), Ben comments on his copy.
  const version = async () => (await adminQuery<{ version: number }>("SELECT version FROM tasks WHERE id = $1", [a.taskIds.homepage]))[0].version;
  await updateTask(a.employeeCtx, a.taskIds.homepage, { expectedVersion: await version(), status: "in_progress" });
  await updateTask(a.employeeCtx, a.taskIds.homepage, { expectedVersion: await version(), status: "blocked", reason: "Waiting on the brand images" });
  await addComment(a.employee2Ctx, a.taskIds.second, "First draft of the copy is in the doc.");
});

describe("the Updates section", () => {
  it("is not there without a collection", async () => {
    const r = await teamReportNow(a.managerCtx, { useAssistant: false });
    if (r.status !== "saved") throw new Error(`expected a saved report, got ${JSON.stringify(r)}`);
    const body = await bodyOf(r.docId);
    expect(body).toContain("## Needs your attention");
    expect(body).not.toContain("## Updates");
  });

  it("holds each person's answer once the workspace's assistant has collected them", async () => {
    const today = todayLocal(TZ);
    await adminQuery("UPDATE brenda_settings SET followup_collect = true WHERE organisation_id = $1", [a.ownerCtx.org.id]);
    const c = await collectWorkspaceUpdates({ organisationId: a.ownerCtx.org.id, localDate: today, reportAt: localTimeOn(today, "23:59", TZ) });
    expect(c.status).toBe("created");
    const subjects = await adminQuery<{ subject_membership_id: string }>("SELECT subject_membership_id FROM follow_ups WHERE batch_id = $1", [c.batchId]);
    expect(subjects.map((s) => s.subject_membership_id)).toEqual(expect.arrayContaining([a.employeeCtx.membership.id, a.employee2Ctx.membership.id]));
    await processFollowUpIds(c.pendingIds, { useModel: false });
    // Both worked today, and the collection does not ask anyone (its second option is off): answered from their work.
    const statuses = await adminQuery<{ status: string; answered_from: string; answer_engine: string }>("SELECT status, answered_from, answer_engine FROM follow_ups WHERE batch_id = $1 AND subject_membership_id = ANY($2::uuid[])", [c.batchId, [a.employeeCtx.membership.id, a.employee2Ctx.membership.id]]);
    expect(statuses).toEqual([{ status: "answered", answered_from: "facts", answer_engine: "template" }, { status: "answered", answered_from: "facts", answer_engine: "template" }]);
    expect(await adminQuery("SELECT 1 FROM notifications WHERE type = 'brenda.followup_ask'")).toHaveLength(0);

    const r = await teamReportNow(a.managerCtx, { useAssistant: false });
    if (r.status !== "saved") throw new Error(`expected a saved report, got ${JSON.stringify(r)}`);
    const body = await bodyOf(r.docId);
    expect(body).toMatch(/\n## Updates\n\n_Brenda asked everyone's assistant for today's update at \d\d:\d\d\._\n\n/);
    const updates = body.slice(body.indexOf("## Updates"), body.indexOf("## Needs your attention"));
    expect(body.indexOf("## Updates")).toBeLessThan(body.indexOf("## Needs your attention"));
    expect(updates).toMatch(/\n- \*\*Ada Employee\*\*: .*“Homepage design” \(blocked\)/);
    expect(updates).toMatch(/\n- \*\*Ben Employee\*\*: .*“Pricing page copy” \(not started\)/);
    // The owner reads the same lines.
    const owner = await teamReportNow(a.ownerCtx, { useAssistant: false });
    if (owner.status !== "saved") throw new Error(`expected a saved report, got ${JSON.stringify(owner)}`);
    expect(await bodyOf(owner.docId)).toContain("- **Ada Employee**: ");
  });
});

describe("updateLine", () => {
  const facts: FollowUpFacts = {
    v: 1, kind: "person", gatheredAt: new Date().toISOString(), freshSince: new Date().toISOString(), fresh: false, timeVisible: true,
    time: { todaySeconds: 3600, weekSeconds: 7200 }, timer: null, lastUpdate: null,
    openTasks: [{ id: "t", title: "Landing page", status: "in_progress", progressPercent: 60, dueAt: null, overdue: false, blockedReason: null }], openMore: 0, completedToday: [],
  };
  const base = { membershipId: "m", name: "Ben Okafor", answeredFrom: null, answer: null, reply: null, facts, deadlineAt: null } as const;
  const now = new Date("2026-10-08T16:00:00Z");

  it("is the answer when there is one, one line, at most 400 characters", () => {
    expect(updateLine({ ...base, status: "answered", answeredFrom: "facts", answer: "Ben is on it.\nSecond line." }, TZ, now)).toBe("Ben is on it. Second line.");
    expect(updateLine({ ...base, status: "answered", answeredFrom: "facts", answer: "x".repeat(500) }, TZ, now)).toHaveLength(400);
  });

  it("writes the line from the facts for one still open, never 'no reply' before the time is up", () => {
    expect(updateLine({ ...base, status: "asking", deadlineAt: "2026-10-08T22:54:00Z" }, TZ, now)).toBe("Ben hasn't replied yet, the reply is due by 23:54. Open: “Landing page” (in progress, 60%). Logged today: 1 h.");
    expect(updateLine({ ...base, status: "asking", deadlineAt: "2026-10-08T15:54:00Z" }, TZ, now)).toBe("No reply from Ben by 16:54. Open: “Landing page” (in progress, 60%). Logged today: 1 h.");
    expect(updateLine({ ...base, status: "answering", answeredFrom: "person", reply: { choice: "blocked", note: "Waiting on images" } }, TZ, now)).toBe("Ben says it's blocked: “Waiting on images”. Open: “Landing page” (in progress, 60%). Logged today: 1 h.");
    expect(updateLine({ ...base, status: "answering", answeredFrom: "person" }, TZ, now)).toBe("Open: “Landing page” (in progress, 60%). Logged today: 1 h.");
    expect(updateLine({ ...base, status: "answering", answeredFrom: "deadline", deadlineAt: "2026-10-08T15:54:00Z" }, TZ, now)).toBe("No reply from Ben by 16:54. Open: “Landing page” (in progress, 60%). Logged today: 1 h.");
    expect(updateLine({ ...base, status: "pending", facts: null }, TZ, now)).toBe("No update yet.");
    expect(updateLine({ ...base, status: "failed", facts: null }, TZ, now)).toBe("No update.");
  });
});

describe("mdQuoted", () => {
  it("keeps other people's words as text and their addresses as code, never a link", () => {
    expect(mdQuoted("Ben says it's done: “see https://evil.example/x_y?a=1 and *this*”.")).toBe("Ben says it's done: “see `https://evil.example/x_y?a=1` and \\*this\\*”.");
    expect(mdQuoted("Mail mailto:a@b.c or www.example.com, `now`")).toBe("Mail `mailto:a@b.c` or `www.example.com`, \\`now\\`");
    expect(mdQuoted("[click](https://x.example)")).toBe("\\[click\\](`https://x.example`)");
  });
});

describe("the worker", () => {
  it("queues the collection at the report time less the lead on a working day, moves it with the settings, and not once the report has gone", async () => {
    const { scheduleFollowUpCollection } = await import("../../worker/schedule");
    const org = a.ownerCtx.org.id;
    await adminQuery("UPDATE brenda_settings SET daily_report_time = '17:00', followup_collect = true, followup_collect_minutes = 60 WHERE organisation_id = $1", [org]);
    const thursday = new Date("2026-10-08T14:30:00Z"); // Thu 8 Oct 15:30 in Lagos: the 16:00 collection is within the hour
    const job = () => adminQuery<{ next_run_at: Date; payload: Record<string, unknown> }>("SELECT next_run_at, payload FROM jobs WHERE type = 'followup.collect' AND dedup_key = $1", [`followup.collect:${org}:2026-10-08`]);
    expect(await scheduleFollowUpCollection({ now: thursday, organisationId: org })).toEqual({ queued: 1 });
    expect(await job()).toHaveLength(1);
    expect((await job())[0].payload).toEqual({ organisationId: org, localDate: "2026-10-08" });
    expect(new Date((await job())[0].next_run_at).toISOString()).toBe("2026-10-08T15:00:00.000Z");
    // The report moves to 17:30 and the lead to 30 minutes: the waiting job moves to 17:00 (16:00 UTC), still one job.
    await adminQuery("UPDATE brenda_settings SET daily_report_time = '17:30', followup_collect_minutes = 30 WHERE organisation_id = $1", [org]);
    await scheduleFollowUpCollection({ now: thursday, organisationId: org });
    expect(await job()).toHaveLength(1);
    expect(new Date((await job())[0].next_run_at).toISOString()).toBe("2026-10-08T16:00:00.000Z");
    // More than an hour ahead, after the report, on a Saturday, or switched off: nothing is queued.
    expect(await scheduleFollowUpCollection({ now: new Date("2026-10-09T13:00:00Z"), organisationId: org })).toEqual({ queued: 0 });
    expect(await scheduleFollowUpCollection({ now: new Date("2026-10-09T17:00:00Z"), organisationId: org })).toEqual({ queued: 0 });
    expect(await scheduleFollowUpCollection({ now: new Date("2026-10-10T15:30:00Z"), organisationId: org })).toEqual({ queued: 0 });
    await adminQuery("UPDATE brenda_settings SET followup_collect = false WHERE organisation_id = $1", [org]);
    expect(await scheduleFollowUpCollection({ now: new Date("2026-10-12T15:30:00Z"), organisationId: org })).toEqual({ queued: 0 });
  });

  it("the collect job inserts the day's batch and hands its rows to followup.process; the process job answers them without the model", async () => {
    const { handlers } = await import("../../worker/handlers");
    const { scheduleFollowUpSweep } = await import("../../worker/schedule");
    const b = await buildCompany("b");
    const org = b.ownerCtx.org.id;
    await adminQuery(`UPDATE organisations SET feature_overrides = COALESCE(feature_overrides, '{}'::jsonb) || '{"AI_ASSISTANT": true}'::jsonb WHERE id = $1`, [org]);
    await adminQuery(`INSERT INTO brenda_settings(organisation_id, daily_report_time, followup_collect) VALUES ($1, '23:59', true) ON CONFLICT (organisation_id) DO UPDATE SET daily_report_time = '23:59', followup_collect = true`, [org]);
    await addComment(b.employeeCtx, b.taskIds.homepage, "Layout is in Figma.");
    await addComment(b.employee2Ctx, b.taskIds.second, "Copy draft started.");
    const ctx = { jobId: "test", attempt: 1 };
    await handlers["followup.collect"]({ organisationId: org, localDate: todayLocal(TZ) }, ctx);
    const [batch] = await adminQuery<{ id: string }>("SELECT id FROM follow_up_batches WHERE organisation_id = $1 AND kind = 'workspace'", [org]);
    const process = await adminQuery<{ dedup_key: string; payload: { ids: string[] } }>("SELECT dedup_key, payload FROM jobs WHERE type = 'followup.process' AND dedup_key LIKE $1", [`followup.process:${batch.id}:%`]);
    expect(process.map((j) => j.dedup_key)).toEqual([`followup.process:${batch.id}:0`]);
    const subjects = await adminQuery<{ id: string; subject_membership_id: string }>("SELECT id, subject_membership_id FROM follow_ups WHERE batch_id = $1", [batch.id]);
    expect(subjects.map((s) => s.subject_membership_id)).toEqual(expect.arrayContaining([b.employeeCtx.membership.id, b.employee2Ctx.membership.id]));
    expect([...process[0].payload.ids].sort()).toEqual(subjects.map((s) => s.id).sort());
    // The sweep is queued for this minute only when something is due (integration review, 8 October 2026): rows just
    // made are not; the hourly sweep is queued either way.
    const minute = Math.floor(Date.now() / 60_000);
    expect(await scheduleFollowUpSweep()).toEqual({ queued: true, due: false });
    expect(await adminQuery("SELECT 1 FROM jobs WHERE type = 'followup.sweep' AND dedup_key = $1", [`followup.sweep:${minute}`])).toHaveLength(0);
    expect(await adminQuery("SELECT 1 FROM jobs WHERE type = 'followup.sweep' AND dedup_key = $1", [`followup.sweep:h${Math.floor(minute / 60)}`])).toHaveLength(1);
    // A row left pending for more than a minute with nobody holding it is due.
    // (Triggers off for the move: set_updated_at would stamp it now again.)
    await adminQuery(`SET session_replication_role = replica; UPDATE follow_ups SET updated_at = now() - interval '2 minutes' WHERE id = '${subjects[0].id}'; SET session_replication_role = origin;`);
    expect(await scheduleFollowUpSweep()).toEqual({ queued: true, due: true });
    expect(await adminQuery("SELECT 1 FROM jobs WHERE type = 'followup.sweep' AND dedup_key LIKE 'followup.sweep:%' AND dedup_key NOT LIKE 'followup.sweep:h%'")).toHaveLength(1);
    await handlers["followup.process"]({ ids: process[0].payload.ids }, ctx);
    const done = await adminQuery<{ status: string; answer_engine: string }>("SELECT status, answer_engine FROM follow_ups WHERE batch_id = $1", [batch.id]);
    expect(done.every((r) => r.status === "answered" && r.answer_engine === "template")).toBe(true);
    // Running the collect job again changes nothing; junk payloads are ignored; the sweep runs clean.
    await handlers["followup.collect"]({ organisationId: org, localDate: todayLocal(TZ) }, ctx);
    expect(await adminQuery("SELECT 1 FROM follow_up_batches WHERE organisation_id = $1", [org])).toHaveLength(1);
    await handlers["followup.collect"]({ organisationId: "nope", localDate: "today" }, ctx);
    await handlers["followup.process"]({ ids: ["nope", 3] }, ctx);
    await handlers["followup.sweep"]({}, ctx);
  });
});
