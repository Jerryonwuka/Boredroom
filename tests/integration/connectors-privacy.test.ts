/**
 * Connected apps: privacy (owner decisions, 22 October 2026: connectors, D3; spec §15, §16.3). The heart of it: a person's
 * own connection and everything from it is theirs alone. Owners, HR, their team lead and a colleague see zero rows and a
 * zero count, can't change or delete them, and no user context ever reads a token. Workspace items reach members, a team
 * audience narrows them (owners and HR still see), and a team that is gone leaves only owners and HR.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetTestDatabase, adminQuery, appQueryAs } from "../helpers/db";
import { buildCompany, type CompanyFixture } from "@/server/services/fixtures";
import { forget0061 } from "@/server/lib/schema-0061";
import { applyConnectorsMigration, connectFake } from "@/server/connectors/testing";
import { runSync, refreshSources } from "@/server/connectors/sync";
import { connectorsView } from "@/server/connectors/connections";
import { hideItem, trackItem } from "@/server/connectors/items";
import { recordAction } from "@/server/services/brenda";
import { fakeServer } from "@/server/connectors/adapters/fake";

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
  const project = (await adminQuery<{ id: string }>(`SELECT id FROM connector_sources WHERE connection_id = $1 AND external_id = 'P-TEST'`, [workspace]))[0].id;
  await adminQuery(`UPDATE connector_sources SET selected = true WHERE id = $1`, [project]);
  await runSync(workspace, "issues");
  const item = (await adminQuery<{ id: string }>(`SELECT id FROM connector_items WHERE connection_id = $1 AND kind = 'issue' LIMIT 1`, [personal]))[0].id;
  await hideItem(a.employeeCtx, item, true);
  await trackItem(a.employeeCtx, item, { taskId: a.taskIds.homepage });
  await recordAction(a.employeeCtx, { tool: "calendar_action", summary: "Blocked 14:00–15:00", outcome: "done", source: "private" });
  await recordAction(a.employeeCtx, { tool: "my_calendar", summary: "Read your calendar", outcome: "done", source: "read" });
});
afterAll(() => { forget0061(); if (saved === undefined) delete process.env.CONNECTORS_FAKE; else process.env.CONNECTORS_FAKE = saved; });

const others = () => [["owner", a.owner.profileId], ["hr", a.hr.profileId], ["team lead", a.manager.profileId], ["colleague", a.employee2.profileId]] as const;

describe("a personal connection is its person's alone", () => {
  it("the setup made what we check (as the worker sees it)", async () => {
    const n = await adminQuery<{ items: number; events: number; hides: number; links: number; ids: number; tokens: number }>(
      `SELECT (SELECT count(*)::int FROM connector_items WHERE connection_id = $1) AS items, (SELECT count(*)::int FROM connector_items WHERE connection_id = $1 AND kind = 'event') AS events,
              (SELECT count(*)::int FROM connector_item_hides) AS hides, (SELECT count(*)::int FROM connector_task_links) AS links,
              (SELECT count(*)::int FROM connector_identities) AS ids, (SELECT count(*)::int FROM connector_tokens) AS tokens`, [personal]);
    expect(n[0]).toMatchObject({ events: 2, hides: 1, links: 1, ids: 1, tokens: 2 });
    expect(n[0].items).toBeGreaterThanOrEqual(4);
  });

  it("its person sees all of it", async () => {
    const id = a.employee.profileId;
    expect((await appQueryAs(id, `SELECT count(*)::int AS n FROM connector_connections WHERE kind = 'personal'`))[0].n).toBe(1);
    expect((await appQueryAs(id, `SELECT count(*)::int AS n FROM connector_items WHERE visibility = 'personal'`))[0].n).toBeGreaterThanOrEqual(4);
    expect((await appQueryAs(id, `SELECT count(*)::int AS n FROM connector_identities`))[0].n).toBe(1);
    expect((await appQueryAs(id, `SELECT count(*)::int AS n FROM brenda_actions WHERE source IN ('private', 'read')`))[0].n).toBe(2);
  });

  it.each(["owner", "hr", "team lead", "colleague"])("the %s sees nothing of it, not even a count", async (who) => {
    const id = others().find(([w]) => w === who)![1];
    for (const sql of [
      `SELECT count(*)::int AS n FROM connector_connections WHERE kind = 'personal'`,
      `SELECT count(*)::int AS n FROM connector_items WHERE visibility = 'personal'`,
      `SELECT count(*)::int AS n FROM connector_sources WHERE visibility = 'personal'`,
      `SELECT count(*)::int AS n FROM connector_identities`,
      `SELECT count(*)::int AS n FROM connector_item_hides`,
      `SELECT count(*)::int AS n FROM connector_task_links WHERE visibility = 'personal'`,
      `SELECT count(*)::int AS n FROM connector_audit WHERE kind = 'personal'`,
      `SELECT count(*)::int AS n FROM brenda_actions WHERE membership_id = '${a.employeeCtx.membership.id}' AND source IN ('private', 'read')`,
      `SELECT count(*)::int AS n FROM connector_tokens`,
      `SELECT count(*)::int AS n FROM connector_sync_state`,
      `SELECT count(*)::int AS n FROM connector_oauth_states`,
    ]) expect((await appQueryAs(id, sql))[0].n, sql).toBe(0);
  });

  it("the owner can't change or delete it", async () => {
    const r = await appQueryAs(a.owner.profileId, `UPDATE connector_connections SET can_act = false WHERE id = $1 RETURNING id`, [personal]);
    expect(r).toHaveLength(0);
    const d = await appQueryAs(a.owner.profileId, `DELETE FROM connector_connections WHERE id = $1 RETURNING id`, [personal]);
    expect(d).toHaveLength(0);
    const i = await appQueryAs(a.owner.profileId, `DELETE FROM connector_items WHERE connection_id = $1 RETURNING id`, [personal]);
    expect(i).toHaveLength(0);
  });

  it("no user context reads a token, the person's own included; nobody writes items or audit rows", async () => {
    expect((await appQueryAs(a.employee.profileId, `SELECT count(*)::int AS n FROM connector_tokens`))[0].n).toBe(0);
    await expect(appQueryAs(a.employee.profileId, `INSERT INTO connector_items(organisation_id, connection_id, visibility, membership_id, provider, kind, external_id, title) VALUES ($1, $2, 'personal', $3, 'fake', 'issue', 'forged', 'x')`,
      [a.ownerCtx.org.id, personal, a.employeeCtx.membership.id])).rejects.toThrow(/row-level security/);
    await expect(appQueryAs(a.employee.profileId, `INSERT INTO connector_audit(organisation_id, provider, kind, membership_id, action, outcome) VALUES ($1, 'fake', 'personal', $2, 'act.private', 'ok')`,
      [a.ownerCtx.org.id, a.employeeCtx.membership.id])).rejects.toThrow(/row-level security/);
  });

  it("the API: owners see no personal connection; while impersonated the person's own are hidden too", async () => {
    const owner = await connectorsView(a.ownerCtx);
    expect(owner.personal).toHaveLength(0);
    expect(JSON.stringify(owner)).not.toContain(personal);
    const me = await connectorsView(a.employeeCtx);
    expect(me.personal.map((p) => p.id)).toEqual([personal]);
    expect(me.workspace).toHaveLength(0); // staff get what it's for, not the full view
    expect(me.workspaceSummary.map((w) => w.id)).toEqual([workspace]);
    const imp = await connectorsView({ ...a.employeeCtx, user: { ...a.employeeCtx.user, impersonation: { id: "00000000-0000-0000-0000-000000000001", adminEmail: "support@example.com" } } });
    expect(imp.personal).toHaveLength(0);
    expect(imp.impersonating).toBe(true);
  });
});

describe("workspace connections and items", () => {
  it("members see the workspace connection; only owners and HR change it", async () => {
    for (const [, id] of others()) expect((await appQueryAs(id, `SELECT count(*)::int AS n FROM connector_connections WHERE kind = 'workspace'`))[0].n).toBe(1);
    expect(await appQueryAs(a.employee2.profileId, `UPDATE connector_connections SET can_act = false WHERE id = $1 RETURNING id`, [workspace])).toHaveLength(0);
    expect(await appQueryAs(a.hr.profileId, `UPDATE connector_connections SET can_act = false WHERE id = $1 RETURNING id`, [workspace])).toHaveLength(1);
  });

  it("everyone sees workspace items; a team audience narrows them (owners and HR still see); a team that is gone leaves owners and HR", async () => {
    const count = async (id: string) => (await appQueryAs(id, `SELECT count(*)::int AS n FROM connector_items WHERE visibility = 'workspace'`))[0].n as number;
    const all = await count(a.employee2.profileId);
    expect(all).toBeGreaterThan(0);
    const other = (await adminQuery<{ id: string }>(`INSERT INTO teams(organisation_id, name) VALUES ($1, 'Sales') RETURNING id`, [a.ownerCtx.org.id]))[0].id;
    await adminQuery(`UPDATE connector_items SET audience_team_id = $2 WHERE connection_id = $1`, [workspace, other]);
    expect(await count(a.employee2.profileId)).toBe(0);
    expect(await count(a.owner.profileId)).toBe(all);
    expect(await count(a.hr.profileId)).toBe(all);
    await adminQuery(`UPDATE connector_items SET audience_team_id = $2 WHERE connection_id = $1`, [workspace, a.teamId]);
    expect(await count(a.employee2.profileId)).toBe(all);
    await adminQuery(`UPDATE connector_items SET audience_team_id = gen_random_uuid() WHERE connection_id = $1`, [workspace]);
    expect(await count(a.employee2.profileId)).toBe(0);
    expect(await count(a.manager.profileId)).toBe(0);
    expect(await count(a.owner.profileId)).toBe(all);
    await adminQuery(`UPDATE connector_items SET audience_team_id = NULL WHERE connection_id = $1`, [workspace]);
  });

  it("channel routes and policies: members read, only owners and HR write", async () => {
    await expect(appQueryAs(a.employee.profileId, `INSERT INTO connector_policies(organisation_id, provider, brenda_acts) VALUES ($1, 'fake', false)`, [a.ownerCtx.org.id])).rejects.toThrow(/row-level security/);
    await appQueryAs(a.hr.profileId, `INSERT INTO connector_policies(organisation_id, provider, brenda_acts) VALUES ($1, 'fake', true)`, [a.ownerCtx.org.id]);
    expect((await appQueryAs(a.employee.profileId, `SELECT count(*)::int AS n FROM connector_policies`))[0].n).toBe(1);
    const channel = (await adminQuery<{ id: string }>(`UPDATE connector_sources SET selected = true WHERE connection_id = $1 AND kind = 'channel' RETURNING id`, [workspace]))[0].id;
    await expect(appQueryAs(a.manager.profileId, `INSERT INTO connector_channel_routes(organisation_id, source_id, purpose, team_id, created_by) VALUES ($1, $2, 'standup', $3, $4)`,
      [a.ownerCtx.org.id, channel, a.teamId, a.managerCtx.membership.id])).rejects.toThrow(/row-level security/);
    await appQueryAs(a.owner.profileId, `INSERT INTO connector_channel_routes(organisation_id, source_id, purpose, team_id, created_by) VALUES ($1, $2, 'standup', $3, $4)`,
      [a.ownerCtx.org.id, channel, a.teamId, a.ownerCtx.membership.id]);
    expect((await appQueryAs(a.employee.profileId, `SELECT count(*)::int AS n FROM connector_channel_routes`))[0].n).toBe(1);
    // A personal source can never be a channel route.
    await expect(appQueryAs(a.owner.profileId, `INSERT INTO connector_channel_routes(organisation_id, source_id, purpose, team_id, created_by) VALUES ($1, gen_random_uuid(), 'reminders', $2, $3)`,
      [a.ownerCtx.org.id, a.teamId, a.ownerCtx.membership.id])).rejects.toThrow(/ROUTE_CHANNEL|foreign key/);
  });
});
