/**
 * Migration 0061 (connected apps; owner decisions, 22 October 2026: connectors). On the throwaway test database only:
 * 0061 is in db/migrations (the reset applies it) and is applied again here by hand. Checked: the order guard, idempotence (twice), the constraints
 * (kinds per provider, a personal connection's owner, events personal only, https links, audiences only on workspace
 * rows, the link check trigger, the guard triggers), `brenda_actions` accepting 'private', and the plan flag.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetTestDatabase, adminQuery, appQueryAs } from "../helpers/db";
import { buildCompany, type CompanyFixture } from "@/server/services/fixtures";
import { forget0061 } from "@/server/lib/schema-0061";

// 0061 moved to db/migrations (the test reset applies it); its guards that asked the database are gone (owner request,
// 23 October 2026: realtime plan, phase 0), so "not ready" is no longer a state to test here (tests/unit/schema-0061.test.ts).
const sql = () => readFileSync(join(process.cwd(), "db", "migrations", "0061_connectors.sql"), "utf8");
let a: CompanyFixture;

async function conn(o: { provider?: string; kind?: string; membership?: string | null; by?: string; account?: string; tenant?: string | null }) {
  return (await adminQuery<{ id: string }>(
    `INSERT INTO connector_connections(organisation_id, provider, kind, membership_id, connected_by, external_account_id, external_tenant_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [a.ownerCtx.org.id, o.provider ?? "linear", o.kind ?? "personal", o.membership === undefined ? a.employeeCtx.membership.id : o.membership, o.by ?? a.employeeCtx.membership.id, o.account ?? `acc-${Math.random()}`, o.tenant ?? null]))[0].id;
}

beforeAll(async () => {
  await resetTestDatabase();
  forget0061();
  a = await buildCompany("a");
});
afterAll(() => forget0061());

describe("order and idempotence", () => {
  it("applies twice on top of the reset's own run", async () => {
    await adminQuery(sql());
    await adminQuery(sql());
    const ok = await adminQuery<{ ok: boolean }>(`SELECT to_regclass('public.connector_connections') IS NOT NULL AND to_regclass('public.connector_tokens') IS NOT NULL AS ok`);
    expect(ok[0].ok).toBe(true);
    const tables = await adminQuery<{ n: number }>(`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'connector\\_%'`);
    expect(tables[0].n).toBe(15);
  });

  it("refuses without 0060 (MIGRATION_ORDER), changing nothing", async () => {
    await adminQuery(`ALTER TABLE mac_requests RENAME TO mac_requests_away`);
    try { await expect(adminQuery(sql())).rejects.toThrow(/MIGRATION_ORDER/); }
    finally { await adminQuery(`ALTER TABLE mac_requests_away RENAME TO mac_requests`); }
  });

  it("every plan gains CONNECTORS; brenda_actions accepts 'private'", async () => {
    const plans = await adminQuery<{ ok: boolean }>(`SELECT bool_and((features->>'CONNECTORS')::boolean) AS ok FROM plans`);
    expect(plans[0].ok).toBe(true);
    await adminQuery(`INSERT INTO brenda_actions(organisation_id, membership_id, tool, summary, outcome, source) VALUES ($1, $2, 'my_calendar', 'x', 'done', 'private')`, [a.ownerCtx.org.id, a.employeeCtx.membership.id]);
    await expect(adminQuery(`INSERT INTO brenda_actions(organisation_id, membership_id, tool, summary, outcome, source) VALUES ($1, $2, 'x', 'x', 'done', 'secret')`, [a.ownerCtx.org.id, a.employeeCtx.membership.id])).rejects.toThrow(/brenda_actions_source_check/);
  });
});

describe("constraints", () => {
  it("calendars personal only; Slack and Teams workspace only; a personal connection is its person's", async () => {
    await expect(conn({ provider: "google_calendar", kind: "workspace", membership: null, by: a.ownerCtx.membership.id })).rejects.toThrow(/connector_connections_kind_allowed/);
    await expect(conn({ provider: "slack", kind: "personal" })).rejects.toThrow(/connector_connections_kind_allowed/);
    await expect(conn({ kind: "personal", membership: a.employeeCtx.membership.id, by: a.ownerCtx.membership.id })).rejects.toThrow(/connector_connections_owner_check/);
    await expect(conn({ kind: "workspace", membership: a.employeeCtx.membership.id })).rejects.toThrow(/connector_connections_owner_check/);
    await expect(conn({ provider: "dropbox" })).rejects.toThrow(/connector_connections_provider_check/);
    expect(await conn({ provider: "google_calendar" })).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("one live connection per person, app and account", async () => {
    await conn({ account: "same" });
    await expect(conn({ account: "same" })).rejects.toThrow(/connector_connections_personal_one/);
  });

  it("items: events personal only with times; https links; audiences only on workspace rows", async () => {
    const personal = await conn({});
    const workspace = await conn({ kind: "workspace", membership: null, by: a.ownerCtx.membership.id, provider: "linear", account: "org-1" });
    const item = (o: Record<string, unknown>) => adminQuery(
      `INSERT INTO connector_items(organisation_id, connection_id, visibility, membership_id, audience_team_id, provider, kind, external_id, title, url, starts_at, ends_at)
       VALUES ($1, $2, $3, $4, $5, 'linear', $6, $7, 'T', $8, $9, $10)`,
      [a.ownerCtx.org.id, o.conn, o.visibility, o.membership ?? null, o.team ?? null, o.kind ?? "issue", o.ext ?? `x-${Math.random()}`, o.url ?? null, o.starts ?? null, o.ends ?? null]);
    await expect(item({ conn: workspace, visibility: "workspace", kind: "event", starts: new Date(), ends: new Date() })).rejects.toThrow(/connector_items_events_personal/);
    await expect(item({ conn: personal, visibility: "personal", membership: a.employeeCtx.membership.id, kind: "event" })).rejects.toThrow(/connector_items_event_times/);
    await expect(item({ conn: personal, visibility: "personal", membership: a.employeeCtx.membership.id, url: "http://linear.app/x" })).rejects.toThrow(/connector_items_url_check/);
    await expect(item({ conn: personal, visibility: "personal", membership: a.employeeCtx.membership.id, team: a.teamId })).rejects.toThrow(/connector_items_audience_check/);
    await expect(item({ conn: personal, visibility: "workspace", membership: a.employeeCtx.membership.id })).rejects.toThrow(/connector_items_visibility_owner/);
    await item({ conn: workspace, visibility: "workspace", team: a.teamId, url: "https://linear.app/x" });
  });

  it("the guard: outside the server's contexts only can_read, can_act and settings change", async () => {
    const id = await conn({});
    await expect(appQueryAs(a.employee.profileId, `UPDATE connector_connections SET status = 'paused' WHERE id = $1`, [id])).rejects.toThrow(/CONNECTION_FIELDS/);
    const r = await appQueryAs(a.employee.profileId, `UPDATE connector_connections SET can_act = true WHERE id = $1 RETURNING can_act`, [id]);
    expect(r[0].can_act).toBe(true);
  });

  it("a task link must be honest: the person's own item and their own open task", async () => {
    const personal = await conn({});
    const item = (await adminQuery<{ id: string }>(
      `INSERT INTO connector_items(organisation_id, connection_id, visibility, membership_id, provider, kind, external_id, title) VALUES ($1, $2, 'personal', $3, 'linear', 'issue', 'L-1', 'T') RETURNING id`,
      [a.ownerCtx.org.id, personal, a.employeeCtx.membership.id]))[0].id;
    await expect(appQueryAs(a.employee2.profileId, `INSERT INTO connector_task_links(organisation_id, item_id, task_id, membership_id, visibility) VALUES ($1, $2, $3, $4, 'personal')`,
      [a.ownerCtx.org.id, item, a.taskIds.second, a.employee2Ctx.membership.id])).rejects.toThrow(/LINK_ITEM/);
    await expect(appQueryAs(a.employee.profileId, `INSERT INTO connector_task_links(organisation_id, item_id, task_id, membership_id, visibility) VALUES ($1, $2, $3, $4, 'personal')`,
      [a.ownerCtx.org.id, item, a.taskIds.second, a.employeeCtx.membership.id])).rejects.toThrow(/LINK_TASK/);
    const ok = await appQueryAs(a.employee.profileId, `INSERT INTO connector_task_links(organisation_id, item_id, task_id, membership_id, visibility) VALUES ($1, $2, $3, $4, 'personal') RETURNING id`,
      [a.ownerCtx.org.id, item, a.taskIds.homepage, a.employeeCtx.membership.id]);
    expect(ok).toHaveLength(1);
  });
});
