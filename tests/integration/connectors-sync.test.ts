/**
 * Connected apps: syncing in the worker (owner decisions, 22 October 2026: connectors; spec §6, §16.3). Scheduling and
 * dedupe, bounded runs with continuations, cursors, window and open reconciliation, 429 backoff, refusals to refresh
 * (the person told, nobody else), people leaving, plans lapsing, and the retention purge.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetTestDatabase, adminQuery } from "../helpers/db";
import { buildCompany, type CompanyFixture } from "@/server/services/fixtures";
import { forget0061 } from "@/server/lib/schema-0061";
import { applyConnectorsMigration, connectFake, fixture, mockProviders, type ProviderMock } from "@/server/connectors/testing";
import { refreshSources, runSync } from "@/server/connectors/sync";
import { syncNow } from "@/server/connectors/connections";
import { refreshTokens, saveTokens } from "@/server/connectors/tokens";
import { setAdapterForTests, stubAdapter } from "@/server/connectors/registry";
import { fakeServer } from "@/server/connectors/adapters/fake";
import { scheduleConnectors, purgeConnectors, sweepConnectors } from "../../worker/connectors";
import { withWorker } from "@/server/db";
import type { NormalisedItem, ProviderAdapter } from "@/server/connectors/types";

let a: CompanyFixture;
let mock: ProviderMock;
const saved = process.env.CONNECTORS_FAKE;

/** A scripted Asana stand-in: pages of issues from a mocked API, with a cursor. */
const pages: Record<string, { items: NormalisedItem[]; next: string | null }> = {};
const testAsana: ProviderAdapter = {
  ...stubAdapter("asana"), hosts: ["app.asana.com"], linkHosts: ["app.asana.com"], env: ["X"], configured: () => true,
  oauth: { ...stubAdapter("asana").oauth, tokenUrl: "https://app.asana.com/-/oauth_token", clientId: () => "c", clientSecret: () => "s", refresh: "reusable",
    parseToken: (b, now) => { const x = b as Record<string, unknown>; if (x.error) throw new Error("e"); return { accessToken: String(x.access_token), refreshToken: null, tokenType: "bearer", expiresAt: new Date(now.getTime() + 3600_000), refreshExpiresAt: null, scopes: null }; } },
  streams: [{ name: "issues", kinds: ["issue"], every: { workingMinutes: 15, offMinutes: 120 }, perRun: { pages: 1, items: 50, ms: 15_000 }, fullEveryMinutes: 360 }],
  async sync({ http, cursor, sink, full }) {
    const r = await http.request<{ data: NormalisedItem[]; next: string | null }>({ url: "https://app.asana.com/api/1.0/tasks", query: { offset: cursor ?? "start" } });
    await sink.upsert(r.body.data);
    if (full && !r.body.next) await sink.reconcileOpen("issue", Object.values(pages).flatMap((p) => p.items).filter((i) => i.state !== "done").map((i) => i.externalId));
    return { cursor: r.body.next, more: !!r.body.next };
  },
};
const task = (id: string, o: Partial<NormalisedItem> = {}): NormalisedItem => ({ kind: "issue", subtype: "task", externalId: id, title: `Task ${id}`, state: "open", mine: true, url: `https://app.asana.com/0/0/${id}`, providerUpdatedAt: "2026-10-22T08:00:00Z", ...o });

async function asanaConnection(membershipId: string): Promise<string> {
  const id = (await adminQuery<{ id: string }>(
    `INSERT INTO connector_connections(organisation_id, provider, kind, membership_id, connected_by, external_account_id) VALUES ($1, 'asana', 'personal', $2, $2, $3) RETURNING id`,
    [a.ownerCtx.org.id, membershipId, `asana-${membershipId}`]))[0].id;
  await adminQuery(`INSERT INTO connector_sync_state(connection_id, stream) VALUES ($1, 'issues')`, [id]);
  await withWorker((db) => saveTokens(db, id, a.ownerCtx.org.id, { accessToken: "asana-token-secret", refreshToken: "asana-refresh-secret", tokenType: "bearer", expiresAt: new Date(Date.now() + 3600_000), refreshExpiresAt: null, scopes: null }));
  return id;
}

beforeAll(async () => {
  process.env.CONNECTORS_FAKE = "1";
  await resetTestDatabase();
  forget0061();
  a = await buildCompany("a");
  await applyConnectorsMigration(adminQuery);
  fakeServer.reset();
  setAdapterForTests("asana", testAsana);
  pages.start = { items: [task("1"), task("2")], next: "p2" };
  pages.p2 = { items: [task("3", { url: "https://evil.example.com/phish", assigneeEmail: "Ada@Example.com", title: "x".repeat(900) })], next: null };
  mock = mockProviders({
    "GET https://app.asana.com/api/1.0/tasks": (req) => { const p = pages[req.url.searchParams.get("offset") ?? "start"]; return { json: { data: p.items, next: p.next } }; },
  });
});
afterAll(() => { mock.restore(); setAdapterForTests("asana", null); forget0061(); if (saved === undefined) delete process.env.CONNECTORS_FAKE; else process.env.CONNECTORS_FAKE = saved; });

describe("scheduling", () => {
  it("queues due streams once (dedupe), and only for active connections", async () => {
    const id = await connectFake(a.employeeCtx, "personal");
    await adminQuery(`DELETE FROM jobs WHERE type = 'connector.sync'`);
    await adminQuery(`UPDATE connector_sync_state SET next_run_at = now() - interval '1 minute' WHERE connection_id = $1`, [id]);
    await scheduleConnectors();
    await scheduleConnectors();
    const jobs = await adminQuery<{ payload: { connectionId: string; stream: string } }>(`SELECT payload FROM jobs WHERE type = 'connector.sync' AND state = 'pending'`);
    expect(jobs.filter((j) => j.payload.connectionId === id).map((j) => j.payload.stream).sort()).toEqual(["events", "issues"]);
    expect(JSON.stringify(jobs)).not.toMatch(/token/i);
    await adminQuery(`DELETE FROM jobs WHERE type = 'connector.sync'`);
    await adminQuery(`SELECT set_config('app.role', 'worker', false); UPDATE connector_connections SET backoff_until = now() + interval '1 hour' WHERE id = '${id}'`);
    await scheduleConnectors();
    expect(await adminQuery(`SELECT 1 FROM jobs WHERE type = 'connector.sync' AND payload->>'connectionId' = $1`, [id])).toHaveLength(0);
    await adminQuery(`SELECT set_config('app.role', 'worker', false); UPDATE connector_connections SET backoff_until = NULL WHERE id = '${id}'`);
  });
});

describe("a bounded run", () => {
  it("one page per run, the cursor saved, the continuation queued; the sink clamps, drops foreign links and digests emails", async () => {
    const id = await asanaConnection(a.employee2Ctx.membership.id);
    const first = await runSync(id, "issues");
    expect(first).toMatchObject({ ran: true, items: 2, more: true });
    const st = await adminQuery<{ cursor: string; full_resync: boolean }>(`SELECT cursor, full_resync FROM connector_sync_state WHERE connection_id = $1`, [id]);
    expect(st[0]).toEqual({ cursor: "p2", full_resync: false });
    expect(await adminQuery(`SELECT 1 FROM jobs WHERE type = 'connector.sync' AND payload->>'connectionId' = $1 AND (payload->>'continuation')::int = 1`, [id])).toHaveLength(1);
    const second = await runSync(id, "issues", { continuation: 1, full: true });
    expect(second).toMatchObject({ items: 1, more: false });
    const three = await adminQuery<{ url: string | null; title: string; assignee_digest: string | null; visibility: string; membership_id: string }>(`SELECT url, title, assignee_digest, visibility, membership_id FROM connector_items WHERE connection_id = $1 AND external_id = '3'`, [id]);
    expect(three[0].url).toBeNull();
    expect(three[0].title).toHaveLength(500);
    expect(three[0].assignee_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(three)).not.toContain("Ada@Example.com");
    expect(three[0]).toMatchObject({ visibility: "personal", membership_id: a.employee2Ctx.membership.id });
  });

  it("open reconciliation marks what left the open set as gone; a window reconcile does the same for events", async () => {
    const id = (await adminQuery<{ id: string }>(`SELECT id FROM connector_connections WHERE provider = 'asana' LIMIT 1`))[0].id;
    pages.start = { items: [task("1")], next: null };
    pages.p2 = { items: [], next: null };
    await adminQuery(`UPDATE connector_sync_state SET full_resync = true WHERE connection_id = $1`, [id]);
    await runSync(id, "issues");
    const gone = await adminQuery<{ external_id: string }>(`SELECT external_id FROM connector_items WHERE connection_id = $1 AND gone_at IS NOT NULL ORDER BY external_id`, [id]);
    expect(gone.map((g) => g.external_id)).toEqual(["2", "3"]);
    const fake = (await adminQuery<{ id: string }>(`SELECT id FROM connector_connections WHERE provider = 'fake' AND kind = 'personal'`))[0].id;
    await runSync(fake, "events");
    await adminQuery(`INSERT INTO connector_items(organisation_id, connection_id, visibility, membership_id, provider, kind, external_id, title, starts_at, ends_at)
                      VALUES ($1, $2, 'personal', $3, 'fake', 'event', 'stale-event', 'Old', now() + interval '1 hour', now() + interval '2 hours')`, [a.ownerCtx.org.id, fake, a.employeeCtx.membership.id]);
    await runSync(fake, "events");
    expect((await adminQuery<{ gone: boolean }>(`SELECT gone_at IS NOT NULL AS gone FROM connector_items WHERE external_id = 'stale-event'`))[0].gone).toBe(true);
  });

  it("a 429 sets the backoff and no request is made until it passes", async () => {
    const id = (await adminQuery<{ id: string }>(`SELECT id FROM connector_connections WHERE provider = 'asana' LIMIT 1`))[0].id;
    mock.set("GET https://app.asana.com/api/1.0/tasks", { status: 429, headers: { "retry-after": "600" }, json: {} });
    const r = await runSync(id, "issues");
    expect(r.error).toBe("RATE_LIMITED");
    const c = await adminQuery<{ secs: number; code: string }>(`SELECT extract(epoch FROM backoff_until - now())::int AS secs, last_error_code AS code FROM connector_connections WHERE id = $1`, [id]);
    expect(c[0].code).toBe("RATE_LIMITED");
    expect(c[0].secs).toBeGreaterThan(500);
    const before = mock.calls.length;
    expect(await runSync(id, "issues")).toMatchObject({ ran: false, skipped: "backoff" });
    expect(mock.calls.length).toBe(before);
    await adminQuery(`SELECT set_config('app.role', 'worker', false); UPDATE connector_connections SET backoff_until = NULL WHERE id = '${id}'`);
    mock.set("GET https://app.asana.com/api/1.0/tasks", (req) => { const p = pages[req.url.searchParams.get("offset") ?? "start"]; return { json: { data: p.items, next: p.next } }; });
  });

  it("a refused refresh: needs reconnecting, and only the person is told", async () => {
    const id = (await adminQuery<{ id: string }>(`SELECT id FROM connector_connections WHERE provider = 'asana' LIMIT 1`))[0].id;
    mock.set("POST https://app.asana.com/-/oauth_token", { status: 400, json: { error: "invalid_grant" } });
    await expect(refreshTokens(id, { force: true })).rejects.toMatchObject({ code: "REAUTH_REQUIRED" });
    expect((await adminQuery<{ status: string }>(`SELECT status FROM connector_connections WHERE id = $1`, [id]))[0].status).toBe("needs_reauth");
    const notes = await adminQuery<{ recipient_membership_id: string; title: string }>(`SELECT recipient_membership_id, title FROM notifications WHERE type = 'connector.trouble'`);
    expect(notes.map((n) => n.recipient_membership_id)).toEqual([a.employee2Ctx.membership.id]);
    expect(notes[0].title).toBe("Your Asana needs reconnecting");
  });
});

describe("an app with nothing to sync (Slack, Teams)", () => {
  // Integration fixes, 22 October 2026: such an app's card said "Checking for the first time…" for ever, and its
  // "Check now" always answered "checked recently" because no stream was there to queue.
  it("reading its channels is its check, and Check now queues that instead of refusing", async () => {
    mock.set("GET https://slack.com/api/conversations.list", { json: { ...fixture<Record<string, unknown>>("slack/conversations.list.page1.json"), response_metadata: { next_cursor: "" } } });
    const id = (await adminQuery<{ id: string }>(
      `INSERT INTO connector_connections(organisation_id, provider, kind, connected_by, external_account_id, external_tenant_id) VALUES ($1, 'slack', 'workspace', $2, 'T9TK3CUKW', 'T9TK3CUKW') RETURNING id`,
      [a.ownerCtx.org.id, a.ownerCtx.membership.id]))[0].id;
    await withWorker((db) => saveTokens(db, id, a.ownerCtx.org.id, { accessToken: "slack-token-secret", refreshToken: null, tokenType: "bot", expiresAt: null, refreshExpiresAt: null, scopes: null }));
    expect(await refreshSources(id)).toBe(2);
    const row = (await adminQuery<{ last_sync_at: string | null; last_ok_at: string | null }>(`SELECT last_sync_at, last_ok_at FROM connector_connections WHERE id = $1`, [id]))[0];
    expect(row.last_sync_at).not.toBeNull();
    expect(row.last_ok_at).not.toBeNull();
    await adminQuery(`DELETE FROM jobs WHERE type = 'connector.sources'`);
    const now = new Date();
    await expect(syncNow(a.ownerCtx, id, now)).resolves.toEqual({ queued: true });
    expect(await adminQuery(`SELECT 1 FROM jobs WHERE type = 'connector.sources' AND payload->>'connectionId' = $1`, [id])).toHaveLength(1);
    // Twice in the same two minutes: the second press is the usual "checked recently".
    await expect(syncNow(a.ownerCtx, id, now)).rejects.toMatchObject({ status: 429 });
    await adminQuery(`DELETE FROM jobs WHERE type = 'connector.sources'`);
  });
});

describe("people, plans and retention", () => {
  it("a person who leaves loses their personal connections", async () => {
    const id = (await adminQuery<{ id: string }>(`SELECT id FROM connector_connections WHERE provider = 'asana' LIMIT 1`))[0].id;
    await adminQuery(`SELECT set_config('app.role', 'worker', false); UPDATE memberships SET status = 'revoked', revoked_at = now() WHERE id = '${a.employee2Ctx.membership.id}'`);
    const r = await sweepConnectors();
    expect(r.disconnected).toBe(1);
    const row = await adminQuery<{ status: string }>(`SELECT status FROM connector_connections WHERE id = $1`, [id]);
    expect(row[0].status).toBe("disconnecting");
    expect((await adminQuery<{ n: number }>(`SELECT count(*)::int AS n FROM connector_items WHERE connection_id = $1`, [id]))[0].n).toBe(0);
    expect(await adminQuery(`SELECT 1 FROM jobs WHERE type = 'connector.revoke' AND payload->>'connectionId' = $1`, [id])).toHaveLength(1);
  });

  it("a plan without CONNECTORS pauses connections (no sync), and they resume when it returns", async () => {
    const fake = (await adminQuery<{ id: string }>(`SELECT id FROM connector_connections WHERE provider = 'fake' AND kind = 'personal'`))[0].id;
    await adminQuery(`UPDATE organisations SET feature_overrides = feature_overrides || '{"CONNECTORS": false}'::jsonb WHERE id = $1`, [a.ownerCtx.org.id]);
    await sweepConnectors();
    expect((await adminQuery<{ status: string }>(`SELECT status FROM connector_connections WHERE id = $1`, [fake]))[0].status).toBe("paused");
    expect(await runSync(fake, "events")).toMatchObject({ ran: false, skipped: "paused" });
    await adminQuery(`UPDATE organisations SET feature_overrides = feature_overrides - 'CONNECTORS' WHERE id = $1`, [a.ownerCtx.org.id]);
    await sweepConnectors();
    expect((await adminQuery<{ status: string }>(`SELECT status FROM connector_connections WHERE id = $1`, [fake]))[0].status).toBe("active");
  });

  it("the purge keeps the retention windows", async () => {
    const fake = (await adminQuery<{ id: string }>(`SELECT id FROM connector_connections WHERE provider = 'fake' AND kind = 'personal'`))[0].id;
    await adminQuery(`INSERT INTO connector_items(organisation_id, connection_id, visibility, membership_id, provider, kind, external_id, title, starts_at, ends_at)
                      VALUES ($1, $2, 'personal', $3, 'fake', 'event', 'old-event', 'Old', now() - interval '40 days', now() - interval '40 days')`, [a.ownerCtx.org.id, fake, a.employeeCtx.membership.id]);
    await adminQuery(`UPDATE connector_items SET gone_at = now() - interval '8 days' WHERE external_id = 'stale-event'`);
    await withWorker((db) => purgeConnectors(db));
    expect(await adminQuery(`SELECT 1 FROM connector_items WHERE external_id IN ('old-event', 'stale-event')`)).toHaveLength(0);
    expect((await adminQuery<{ n: number }>(`SELECT count(*)::int AS n FROM connector_items WHERE connection_id = $1 AND kind = 'event' AND gone_at IS NULL`, [fake]))[0].n).toBe(2);
  });
});
