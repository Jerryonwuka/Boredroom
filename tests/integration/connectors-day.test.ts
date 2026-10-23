/**
 * "From your apps" on My Day (owner decisions, 22 October 2026: connectors; spec §9.10, §11.4, §11.5, §16.3): the person's
 * own events and the items assigned to them (personal; workspace by identity or email digest; shown once; hidden ones
 * flagged), owners seeing only their own, tracking an item as a to-do with a person-only link, and the meeting state.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetTestDatabase, adminQuery, appQueryAs } from "../helpers/db";
import { buildCompany, type CompanyFixture } from "@/server/services/fixtures";
import { forget0061 } from "@/server/lib/schema-0061";
import { applyConnectorsMigration, connectFake } from "@/server/connectors/testing";
import { runSync, refreshSources } from "@/server/connectors/sync";
import { connectedDay, hideItem, meetingStateFor, trackItem } from "@/server/connectors/items";
import { emailDigest } from "@/server/connectors/identity";
import { fakeServer } from "@/server/connectors/adapters/fake";
import { withWorker } from "@/server/db";

let a: CompanyFixture;
let personal: string;
let workspace: string;
const saved = process.env.CONNECTORS_FAKE;

beforeAll(async () => {
  process.env.CONNECTORS_FAKE = "1";
  await resetTestDatabase();
  forget0061();
  a = await buildCompany("a");
  await applyConnectorsMigration(adminQuery);
  fakeServer.reset();
  personal = await connectFake(a.employeeCtx, "personal");
  workspace = await connectFake(a.ownerCtx, "workspace");
  await runSync(personal, "events");
  await runSync(personal, "issues");
  await refreshSources(workspace);
  await adminQuery(`UPDATE connector_sources SET selected = true WHERE connection_id = $1 AND kind = 'project'`, [workspace]);
  await runSync(workspace, "issues");
});
afterAll(() => { forget0061(); if (saved === undefined) delete process.env.CONNECTORS_FAKE; else process.env.CONNECTORS_FAKE = saved; });

describe("the person's day", () => {
  it("today's events and the assigned items, the same issue once (the person's own connection first)", async () => {
    const d = await connectedDay(a.employeeCtx);
    expect(d.ready && d.enabled && d.connected).toBe(true);
    expect(d.events.map((e) => e.title)).toEqual(["Design review", "Planning"]);
    expect(d.items.map((i) => i.externalKey).sort()).toEqual(["TEST-1", "TEST-2"]);
    expect(d.items.every((i) => i.visibility === "personal")).toBe(true);
    expect(d.items[0].url).toMatch(/^https:\/\/fake\.connectors\.invalid\//);
    expect(d.canTrack).toBe(true);
  });

  it("a workspace item reaches its assignee by email digest, and nobody else's day", async () => {
    await adminQuery(`INSERT INTO connector_items(organisation_id, connection_id, visibility, provider, kind, external_id, external_key, title, state, assignee_digest)
                      VALUES ($1, $2, 'workspace', 'fake', 'issue', 'ws-9', 'TEST-9', 'Ben''s thing', 'open', $3)`, [a.ownerCtx.org.id, workspace, emailDigest(a.employee2.email)]);
    const ben = await connectedDay(a.employee2Ctx);
    expect(ben.items.map((i) => i.externalKey)).toEqual(["TEST-9"]);
    expect(ben.events).toHaveLength(0);
    expect((await connectedDay(a.employeeCtx)).items.map((i) => i.externalKey)).not.toContain("TEST-9");
  });

  it("owners see only their own: none of Ada's events or items", async () => {
    const d = await connectedDay(a.ownerCtx);
    expect(d.events).toHaveLength(0);
    expect(d.items).toHaveLength(0);
    expect(d.canTrack).toBe(false);
  });

  it("hidden items come back flagged and counted", async () => {
    const id = (await connectedDay(a.employeeCtx)).items.find((i) => i.externalKey === "TEST-2")!.id;
    await hideItem(a.employeeCtx, id, true);
    const d = await connectedDay(a.employeeCtx);
    expect(d.hiddenCount).toBe(1);
    expect(d.items.find((i) => i.id === id)?.hidden).toBe(true);
    await hideItem(a.employeeCtx, id, false);
  });
});

describe("tracking", () => {
  it("a new to-do from a personal item, with a link only the person sees", async () => {
    const item = (await connectedDay(a.employeeCtx)).items.find((i) => i.externalKey === "TEST-1")!;
    const r = await trackItem(a.employeeCtx, item.id, { newTodo: {} });
    expect(r.created).toBe(true);
    const task = await adminQuery<{ title: string; assignee_membership_id: string }>(`SELECT title, assignee_membership_id FROM tasks WHERE id = $1`, [r.taskId]);
    expect(task[0]).toEqual({ title: "TEST-1 Fix the login loop", assignee_membership_id: a.employeeCtx.membership.id });
    expect((await connectedDay(a.employeeCtx)).items.find((i) => i.id === item.id)?.linkedTask?.id).toBe(r.taskId);
    // Their team lead sees the to-do (like any to-do) but not the link to the app.
    expect((await appQueryAs(a.manager.profileId, `SELECT count(*)::int AS n FROM tasks WHERE id = $1`, [r.taskId]))[0].n).toBe(1);
    expect((await appQueryAs(a.manager.profileId, `SELECT count(*)::int AS n FROM connector_task_links WHERE task_id = $1`, [r.taskId]))[0].n).toBe(0);
  });

  it("owners and HR don't track", async () => {
    await expect(trackItem(a.ownerCtx, "00000000-0000-0000-0000-000000000000", { newTodo: {} })).rejects.toMatchObject({ status: 403 });
  });
});

describe("in a meeting", () => {
  it("from the person's own events: back-to-back meetings merge; declined ones don't count", async () => {
    // Only these meetings (the fake's own may be happening now, depending on the clock).
    await adminQuery(`DELETE FROM connector_items WHERE kind = 'event' AND membership_id = $1`, [a.employeeCtx.membership.id]);
    const t0 = Date.now() - 10 * 60_000;
    const ins = (ext: string, s: number, e: number, response = "accepted") => adminQuery(
      `INSERT INTO connector_items(organisation_id, connection_id, visibility, membership_id, provider, kind, external_id, title, starts_at, ends_at, response, busy)
       VALUES ($1, $2, 'personal', $3, 'fake', 'event', $4, 'M', $5, $6, $7, true)`, [a.ownerCtx.org.id, personal, a.employeeCtx.membership.id, ext, new Date(s), new Date(e), response]);
    await ins("m1", t0, t0 + 30 * 60_000);
    await ins("m2", t0 + 30 * 60_000, t0 + 60 * 60_000);
    await ins("m3", t0, t0 + 120 * 60_000, "declined");
    const m = await withWorker((db) => meetingStateFor(db, a.employeeCtx.membership.id, new Date()));
    expect(m.active).toBe(true);
    expect(Date.parse(m.until!)).toBe(t0 + 60 * 60_000);
    expect((await withWorker((db) => meetingStateFor(db, a.employee2Ctx.membership.id, new Date()))).active).toBe(false);
  });
});
