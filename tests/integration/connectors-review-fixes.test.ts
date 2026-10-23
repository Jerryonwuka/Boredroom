/**
 * Connected apps: the review fixes against the database (security findings, 22 October 2026). On a throwaway database
 * with migration 0061 applied by the test, the fake provider answering in-process, no model:
 * - security-3: a shared standup goes to the team's connected-app channel only when the person's press named it;
 * - security-4: workspace sources are seen by owners and HR, and otherwise only when selected and for the reader's team;
 * - security-5: a Confirm press runs only what the card showed;
 * - security-7: someone signed in as an owner from the Control Center can look but not change;
 * - security-9: a to-do made from an app's item reads as other people's words;
 * - security-6: Jira deliveries reach only the connection whose hook URL they came to; GitHub replays change nothing.
 */
import { createHash, createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleWebhook } from "@/server/connectors/webhooks";
import { resetTestDatabase, adminQuery, appQueryAs } from "../helpers/db";
import { buildCompany, type CompanyFixture } from "@/server/services/fixtures";
import { forget0061 } from "@/server/lib/schema-0061";
import { applyConnectorsMigration, connectFake } from "@/server/connectors/testing";
import { refreshSources, runSync } from "@/server/connectors/sync";
import { disconnect, setPolicy, setRoute, setRouteEnabled, setSources } from "@/server/connectors/connections";
import { trackItem } from "@/server/connectors/items";
import { fakeServer } from "@/server/connectors/adapters/fake";
import { confirmAction, runBrendaTool } from "@/server/services/copilot";
import { openChannel } from "@/server/services/messaging";
import { createTeam } from "@/server/services/orgs";
import * as S from "@/server/services/standup";
import { composeStandup } from "@/server/services/standup-compose";
import { localDate } from "@/server/lib/time";
import { BRENDA_CONNECTOR_WORDS, CONNECTOR_WORDS } from "@/lib/connectors/words";
import type { OrgContext } from "@/server/lib/api";

delete process.env.ANTHROPIC_API_KEY;

let a: CompanyFixture;
let workspace: string;
let personal: string;
let channel: string;
let project: string;
let otherTeam: string;
const saved = process.env.CONNECTORS_FAKE;
const out = (r: { out: unknown }) => r.out as Record<string, unknown>;
const imp = (c: OrgContext): OrgContext => ({ ...c, user: { ...c.user, impersonation: { id: "00000000-0000-0000-0000-000000000001", adminEmail: "support@example.com" } } } as OrgContext);

beforeAll(async () => {
  process.env.CONNECTORS_FAKE = "1";
  await resetTestDatabase();
  forget0061();
  a = await buildCompany("a", { names: { owner: "Grace Owner", hr: "Mary HR", manager: "David Lead", employee: "Ada Obi", employee2: "Ben Okafor" } });
  await applyConnectorsMigration(adminQuery);
  fakeServer.reset();
  workspace = await connectFake(a.ownerCtx, "workspace");
  personal = await connectFake(a.employeeCtx, "personal");
  await refreshSources(workspace);
  channel = (await adminQuery<{ id: string }>(`SELECT id FROM connector_sources WHERE connection_id = $1 AND kind = 'channel'`, [workspace]))[0].id;
  project = (await adminQuery<{ id: string }>(`SELECT id FROM connector_sources WHERE connection_id = $1 AND kind = 'project'`, [workspace]))[0].id;
  otherTeam = (await createTeam(a.ownerCtx, "Sales")).id;
  await setSources(a.ownerCtx, workspace, [{ id: channel }]);
  await runSync(personal, "issues");
});
afterAll(() => { forget0061(); if (saved === undefined) delete process.env.CONNECTORS_FAKE; else process.env.CONNECTORS_FAKE = saved; });

describe("security-4: who sees a workspace's sources", () => {
  const visible = async (who: string) => (await appQueryAs(who, `SELECT external_id FROM connector_sources WHERE connection_id = $1 ORDER BY external_id`, [workspace])).map((r) => (r as { external_id: string }).external_id);

  it("owners and HR see every source; others only the selected ones", async () => {
    expect(await visible(a.owner.profileId)).toEqual(["C-TEST", "P-TEST"]);
    expect(await visible(a.hr.profileId)).toEqual(["C-TEST", "P-TEST"]);
    expect(await visible(a.employee.profileId)).toEqual(["C-TEST"]);
  });

  it("a source for one team is seen only by that team (and owners and HR); Brenda can't post there for anyone else", async () => {
    await setSources(a.ownerCtx, workspace, [{ id: channel, audienceTeamId: otherTeam }]);
    expect(await visible(a.employee.profileId)).toEqual([]);
    expect(await visible(a.owner.profileId)).toEqual(["C-TEST", "P-TEST"]);
    const r = await runBrendaTool(a.employeeCtx, "post_to_channel", { channel: "test", text: "hello" });
    expect(out(r).error).toBe(BRENDA_CONNECTOR_WORDS.noChannel([]));
    await setSources(a.ownerCtx, workspace, [{ id: channel }]);
    expect(await visible(a.employee.profileId)).toEqual(["C-TEST"]);
  });
});

describe("security-5: a Confirm press runs only what the card showed", () => {
  it("a press without the card's digest, or after the channel changed, posts nothing", async () => {
    fakeServer.posts.length = 0;
    const bare = await runBrendaTool(a.employeeCtx, "post_to_channel", { channel: "test", text: "Release is out" }, "confirm");
    expect(out(bare).error).toBe(BRENDA_CONNECTOR_WORDS.changedSinceCard);
    const r = await runBrendaTool(a.employeeCtx, "post_to_channel", { channel: "test", text: "Release is out" });
    const card = r.proposals.find((p) => p.kind === "confirm") as { token: string };
    // The channel's member count changes between the card and the press: the card's readback no longer holds.
    await adminQuery(`SELECT set_config('app.role', 'worker', false); UPDATE connector_sources SET members = 40 WHERE id = '${channel}'`);
    const pressed = await confirmAction(a.employeeCtx, card.token);
    expect(pressed.error).toBe(BRENDA_CONNECTOR_WORDS.changedSinceCard);
    expect(fakeServer.posts).toHaveLength(0);
    await adminQuery(`SELECT set_config('app.role', 'worker', false); UPDATE connector_sources SET members = 3 WHERE id = '${channel}'`);
    const again = await runBrendaTool(a.employeeCtx, "post_to_channel", { channel: "test", text: "Release is out" });
    expect((await confirmAction(a.employeeCtx, (again.proposals.find((p) => p.kind === "confirm") as { token: string }).token)).error).toBeNull();
    expect(fakeServer.posts).toHaveLength(1);
  });
});

describe("security-7: signed in as an owner from the Control Center", () => {
  it("policies, sources, routes and the workspace's connections can't be changed; turning a route off still can", async () => {
    const words = CONNECTOR_WORDS.impersonatedManage;
    await expect(setPolicy(imp(a.ownerCtx), "fake", { brendaActs: false })).rejects.toMatchObject({ status: 403, message: words });
    await expect(setSources(imp(a.ownerCtx), workspace, [{ id: channel }, { id: project }])).rejects.toMatchObject({ status: 403, message: words });
    await expect(setRoute(imp(a.ownerCtx), { purpose: "daily_digest", teamId: null, sourceId: channel })).rejects.toMatchObject({ status: 403, message: words });
    const route = (await setRoute(a.ownerCtx, { purpose: "daily_digest", teamId: null, sourceId: channel })).routes[0];
    await expect(setRouteEnabled(imp(a.ownerCtx), route.id, true)).rejects.toMatchObject({ status: 403, message: words });
    await setRouteEnabled(a.ownerCtx, route.id, true);
    expect((await setRouteEnabled(imp(a.ownerCtx), route.id, false)).enabled).toBe(false);
    await expect(disconnect(imp(a.ownerCtx), workspace)).rejects.toMatchObject({ status: 403, message: words });
    expect((await adminQuery(`SELECT 1 FROM connector_connections WHERE id = $1 AND status = 'active'`, [workspace]))).toHaveLength(1);
  });
});

describe("security-9: a to-do made from an app's item", () => {
  it("reads as other people's words in Brenda's turn; the person's own to-do doesn't", async () => {
    const item = (await adminQuery<{ id: string }>(`SELECT id FROM connector_items WHERE connection_id = $1 AND external_id = 'i-1'`, [personal]))[0].id;
    const made = await trackItem(a.employeeCtx, item, { newTodo: {} });
    expect((await runBrendaTool(a.employeeCtx, "get_task", { taskId: made.taskId })).othersWords).toBe(true);
    expect((await runBrendaTool(a.employeeCtx, "get_my_day", {})).othersWords).toBe(true);
    // plan_day reads titles back: with the app's to-do it's other people's words, with only the person's own it isn't.
    const own = (await adminQuery<{ id: string }>(`SELECT id FROM tasks WHERE assignee_membership_id = $1 AND id <> $2 AND status <> 'completed' AND archived_at IS NULL LIMIT 1`, [a.employeeCtx.membership.id, made.taskId]))[0].id;
    expect((await runBrendaTool(a.employeeCtx, "plan_day", { taskIds: [own] }, "confirm")).othersWords).toBe(false);
    expect((await runBrendaTool(a.employeeCtx, "plan_day", { taskIds: [own, made.taskId] }, "confirm")).othersWords).toBe(true);
  });
});

describe("security-3: a shared standup leaves Boredroom only by the person's own press", () => {
  let ada: string, ben: string;
  beforeAll(async () => {
    await openChannel(a.managerCtx, a.teamId);
    const today = localDate(new Date(), a.ownerCtx.org.timezone);
    await S.saveStandupSettings(a.managerCtx, a.teamId, { enabled: true, time: "00:00", cutoff: "23:59", days: [0, 1, 2, 3, 4, 5, 6] });
    const day = await S.openStandupDay(a.teamId, today, new Date());
    [ada, ben] = await Promise.all([a.employeeCtx, a.employee2Ctx].map(async (c) =>
      (await adminQuery<{ id: string }>("SELECT id FROM standup_entries WHERE rollup_id = $1 AND membership_id = $2", [day.rollupId, c.membership.id]))[0].id));
    for (const e of [ada, ben]) {
      const c = await S.claimStandupDraft(e, new Date());
      if ("skip" in c) throw new Error(`not claimed: ${c.skip}`);
      await S.saveStandupDraft(e, await composeStandup(c, { model: null }), new Date());
    }
    const route = (await setRoute(a.ownerCtx, { purpose: "standup", teamId: a.teamId, sourceId: channel })).routes.find((r) => r.purpose === "standup")!;
    await setRouteEnabled(a.ownerCtx, route.id, true);
  });
  const queued = async (entryId: string) => (await adminQuery(`SELECT 1 FROM jobs WHERE type = 'connector.post' AND payload->>'entryId' = $1`, [entryId])).length;

  it("the card names the channel; Post without the tick shares in Boredroom only", async () => {
    const view = await S.getStandupEntry(a.employeeCtx, ada);
    expect(view?.alsoTo).toEqual({ label: "#test", app: "Test app", members: 3 });
    await S.postStandup(a.employeeCtx, ada);
    expect(await queued(ada)).toBe(0);
  });

  it("with the tick (the channel the card showed), it goes there too; a different channel name posts nothing outside", async () => {
    await S.postStandup(a.employee2Ctx, ben, { alsoTo: "#test" });
    expect(await queued(ben)).toBe(1);
  });
});

describe("security-6: webhooks", () => {
  const env = {
    ATLASSIAN_CLIENT_ID: "atl-client", ATLASSIAN_CLIENT_SECRET: "atl-secret",
    GITHUB_APP_ID: "123456", GITHUB_APP_SLUG: "boredroom-test", GITHUB_APP_CLIENT_ID: "Iv23testclient", GITHUB_APP_CLIENT_SECRET: "gh-secret",
    GITHUB_APP_PRIVATE_KEY: "not-used-here", GITHUB_APP_WEBHOOK_SECRET: "gh-webhook-secret",
  };
  const before: Record<string, string | undefined> = {};
  let b: CompanyFixture;
  beforeAll(async () => {
    for (const [k, v] of Object.entries(env)) { before[k] = process.env[k]; process.env[k] = v; }
    b = await buildCompany("b");
  });
  afterAll(() => { for (const [k, v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const jiraJwt = () => {
    const now = Math.floor(Date.now() / 1000);
    const input = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ iat: now, exp: now + 180, iss: "atl-client" })}`;
    return `Bearer ${input}.${createHmac("sha256", "atl-secret").update(input).digest("base64url")}`;
  };
  async function jiraConnection(c: CompanyFixture, site: string) {
    const conn = (await adminQuery<{ id: string }>(`INSERT INTO connector_connections(organisation_id, provider, kind, connected_by, external_account_id, external_tenant_id) VALUES ($1, 'jira', 'workspace', $2, $3, $3) RETURNING id`, [c.ownerCtx.org.id, c.ownerCtx.membership.id, site]))[0].id;
    // Both sites' Jira gave their hook the same small id.
    const hook = (await adminQuery<{ id: string }>(`INSERT INTO connector_webhooks(connection_id, provider, status, external_id) VALUES ($1, 'jira', 'active', '1000') RETURNING id`, [conn]))[0].id;
    return { conn, hook };
  }

  it("Jira: a delivery reaches only the connection whose hook URL it came to, never another site's with the same webhook id", async () => {
    const siteA = await jiraConnection(a, "cloud-a");
    const siteB = await jiraConnection(b, "cloud-b");
    await adminQuery(`DELETE FROM jobs WHERE type LIKE 'connector.%'`);
    const body = JSON.stringify({ webhookEvent: "jira:issue_updated", matchedWebhookIds: [1000], issue: { id: "10101" } });
    const send = (q: string, id: string) => handleWebhook("jira", new Request(`http://localhost:3000/api/connectors/webhooks/jira${q}`, { method: "POST", body, headers: { authorization: jiraJwt(), "x-atlassian-webhook-identifier": id } }));
    expect((await send(`?hook=${siteB.hook}`, "w-1")).status).toBe(200);
    const items = await adminQuery<{ c: string }>(`SELECT payload->>'connectionId' AS c FROM jobs WHERE type = 'connector.item'`);
    expect(items.map((x) => x.c)).toEqual([siteB.conn]);
    // Without Boredroom's hook id (an old registration, or a forged URL): nothing for anyone.
    await adminQuery(`DELETE FROM jobs WHERE type LIKE 'connector.%'`);
    expect((await send("", "w-2")).status).toBe(200);
    expect(await adminQuery(`SELECT 1 FROM jobs WHERE type = 'connector.item'`)).toHaveLength(0);
    expect(siteA.conn).not.toBe(siteB.conn);
  });

  it("GitHub: the same signed body under a new delivery header is the same delivery; an old removal leaves a newer connection alone", async () => {
    const conn = (await adminQuery<{ id: string }>(`INSERT INTO connector_connections(organisation_id, provider, kind, connected_by, external_account_id, external_tenant_id) VALUES ($1, 'github', 'workspace', $2, 'installation:42', '42') RETURNING id`, [b.ownerCtx.org.id, b.ownerCtx.membership.id]))[0].id;
    const body = JSON.stringify({ action: "suspend", installation: { id: 42, suspended_at: "2026-01-01T09:00:00Z", updated_at: "2026-01-01T09:00:00Z" }, sender: { id: 7002 } });
    const sig = `sha256=${createHmac("sha256", "gh-webhook-secret").update(body).digest("hex")}`;
    const send = (delivery: string) => handleWebhook("github", new Request("http://localhost:3000/api/connectors/webhooks/github", { method: "POST", body, headers: { "x-hub-signature-256": sig, "x-github-event": "installation", "x-github-delivery": delivery } }));
    expect((await send("first")).status).toBe(200);
    expect((await send("second-under-a-new-header")).status).toBe(200);
    // The suspension is older than this connection: it stays connected.
    expect((await adminQuery<{ status: string }>(`SELECT status FROM connector_connections WHERE id = $1`, [conn]))[0].status).toBe("active");
    const ids = await adminQuery<{ delivery_id: string }>(`SELECT delivery_id FROM connector_webhook_deliveries WHERE provider = 'github'`);
    expect(ids.map((r) => r.delivery_id)).toEqual([`body:${createHash("sha256").update(body).digest("hex")}`]);
  });
});
