/**
 * Brenda in connected apps (owner decisions, 22 October 2026: connectors; spec §9, §16.3). No model: the tools are driven
 * through copilot's own runBrendaTool and confirmAction (the real askFirst, Confirm cards and Undo), with the fake
 * provider answering in-process. Reads are quoted and taint; private steps run at once with Undo (and become a card in a
 * tainted turn); shared steps are cards with the exact readback whose Confirm runs the call; logs are private for a
 * person's own connection; and the refusals hold.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetTestDatabase, adminQuery, appQueryAs } from "../helpers/db";
import { buildCompany, type CompanyFixture } from "@/server/services/fixtures";
import { forget0061 } from "@/server/lib/schema-0061";
import { applyConnectorsMigration, connectFake } from "@/server/connectors/testing";
import { runSync, refreshSources } from "@/server/connectors/sync";
import { setAdapterForTests, stubAdapter } from "@/server/connectors/registry";
import { fakeServer } from "@/server/connectors/adapters/fake";
import { confirmAction, runBrendaTool } from "@/server/services/copilot";
import { undoAction } from "@/server/services/undo";
import { localDate } from "@/server/lib/time";
import { BRENDA_CONNECTOR_WORDS } from "@/lib/connectors/words";
import type { ProviderAdapter } from "@/server/connectors/types";

let a: CompanyFixture;
let personal: string;
let workspace: string;
const saved = process.env.CONNECTORS_FAKE;
const out = (r: { out: unknown }) => r.out as Record<string, unknown>;

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
  await adminQuery(`UPDATE connector_sources SET selected = true WHERE connection_id = $1`, [workspace]);
  await runSync(workspace, "issues");
});
afterAll(() => { forget0061(); setAdapterForTests("jira", null); if (saved === undefined) delete process.env.CONNECTORS_FAKE; else process.env.CONNECTORS_FAKE = saved; });

const itemId = async (conn: string, ext: string) => (await adminQuery<{ id: string }>(`SELECT id FROM connector_items WHERE connection_id = $1 AND external_id = $2`, [conn, ext]))[0].id;

describe("reading", () => {
  it("connected_apps names what is connected and does not taint", async () => {
    const r = await runBrendaTool(a.employeeCtx, "connected_apps", {});
    expect(r.tainted).toBe(false);
    expect(JSON.stringify(out(r))).toContain("Test app");
  });

  it("my_calendar and my_work_items answer quoted blocks and taint; a read row is the person's alone", async () => {
    const cal = await runBrendaTool(a.employeeCtx, "my_calendar", {});
    expect(cal.tainted).toBe(true);
    expect(String(out(cal).block)).toMatch(/^<connected_items note="Quoted data/);
    expect(String(out(cal).block)).toContain("“Design review”");
    const work = await runBrendaTool(a.employeeCtx, "my_work_items", {});
    expect(String(out(work).block)).toContain("Test app TEST-1");
    const rows = await appQueryAs(a.owner.profileId, `SELECT count(*)::int AS n FROM brenda_actions WHERE source = 'read' AND membership_id = $1`, [a.employeeCtx.membership.id]);
    expect(rows[0].n).toBe(0);
  });

  it("find_in_apps and read_app_item; another person's personal item is not found", async () => {
    const f = await runBrendaTool(a.employeeCtx, "find_in_apps", { q: "TEST-2" });
    expect(String(out(f).block)).toContain("TEST-2");
    const id = await itemId(personal, "i-2");
    const d = await runBrendaTool(a.employeeCtx, "read_app_item", { itemId: id });
    expect(String(out(d).block)).toContain("description:");
    const other = await runBrendaTool(a.employee2Ctx, "read_app_item", { itemId: id });
    expect(out(other).error).toBe(BRENDA_CONNECTOR_WORDS.noItem);
  });
});

describe("private steps", () => {
  it("a private block runs at once with Undo, logged privately; Undo removes it", async () => {
    const day = localDate(new Date(), a.employeeCtx.org.timezone);
    const r = await runBrendaTool(a.employeeCtx, "calendar_action", { action: "block", title: "Deep work", date: day, start: "16:00", end: "17:00" });
    expect(out(r).done).toBe(true);
    expect(fakeServer.blocks.size).toBe(1);
    const undo = r.actions[0].undo;
    expect(undo?.token).toBeTruthy();
    const rows = await adminQuery<{ source: string }>(`SELECT source FROM brenda_actions WHERE tool = 'calendar_action' AND membership_id = $1`, [a.employeeCtx.membership.id]);
    expect(rows.map((x) => x.source)).toEqual(["private"]);
    expect((await appQueryAs(a.owner.profileId, `SELECT count(*)::int AS n FROM brenda_actions WHERE tool = 'calendar_action'`))[0].n).toBe(0);
    await undoAction(a.employeeCtx, undo!.token);
    expect(fakeServer.blocks.size).toBe(0);
    const undoRow = await adminQuery<{ source: string }>(`SELECT source FROM brenda_actions WHERE tool = 'undo' AND membership_id = $1`, [a.employeeCtx.membership.id]);
    expect(undoRow.map((x) => x.source)).toEqual(["private"]);
  });

  it("in a tainted turn the same block is a Confirm card, and its press runs it", async () => {
    const day = localDate(new Date(), a.employeeCtx.org.timezone);
    const r = await runBrendaTool(a.employeeCtx, "calendar_action", { action: "block", title: "Focus", date: day, start: "17:00", end: "17:30" }, "chat", { tainted: true });
    expect(out(r).needsConfirmation).toBe(true);
    expect(fakeServer.blocks.size).toBe(0);
    const card = r.proposals.find((p) => p.kind === "confirm");
    expect(card && card.kind === "confirm" ? card.readback?.to : null).toEqual(["Only you"]);
    const pressed = await confirmAction(a.employeeCtx, (card as { token: string }).token);
    expect(pressed.error).toBeNull();
    expect(fakeServer.blocks.size).toBe(1);
  });

  it("hiding an item runs at once and only the person sees it", async () => {
    const id = await itemId(personal, "i-1");
    const r = await runBrendaTool(a.employeeCtx, "hide_app_item", { itemId: id, hidden: true });
    expect(out(r).done).toBe(true);
    expect((await appQueryAs(a.owner.profileId, `SELECT count(*)::int AS n FROM connector_item_hides`))[0].n).toBe(0);
  });
});

describe("shared steps", () => {
  it("posting in a channel is always a card with the exact readback; the press posts the person's words, signed", async () => {
    const r = await runBrendaTool(a.employeeCtx, "post_to_channel", { channel: "test", text: "Release is out" });
    expect(out(r).needsConfirmation).toBe(true);
    expect(fakeServer.posts).toHaveLength(0);
    const card = r.proposals.find((p) => p.kind === "confirm") as { token: string; summary: string; detail: string; readback: { to: string[]; what: string } };
    expect(card.summary).toBe("Post in #test on Test app");
    expect(card.readback.to).toEqual(["#test in Test app, 3 people"]);
    expect(card.readback.what).toBe("Your words, posted by the Boredroom app, signed “Ada via Brenda”");
    expect(card.detail).toBe("Release is out\n\nFrom Ada via Brenda");
    const pressed = await confirmAction(a.employeeCtx, card.token);
    expect(pressed.error).toBeNull();
    expect(fakeServer.posts).toEqual([{ channel: "C-TEST", text: "Release is out\n\nFrom Ada via Brenda" }]);
    const log = await adminQuery<{ source: string; summary: string }>(`SELECT source, summary FROM brenda_actions WHERE tool = 'post_to_channel'`);
    expect(log).toEqual([{ source: "confirm", summary: "Posted in a connected channel" }]);
  });

  it("cancelling an issue is destructive: a card in every mode", async () => {
    const id = await itemId(personal, "i-2");
    const r = await runBrendaTool(a.employeeCtx, "work_item_action", { action: "set_state", itemId: id, state: "cancelled" });
    expect(out(r).needsConfirmation).toBe(true);
    expect(fakeServer.issues.get("i-2")?.state).toBe("open");
  });

  it("only staff posting in channels the workspace chose: anything else lists the channels", async () => {
    const r = await runBrendaTool(a.employeeCtx, "post_to_channel", { channel: "general", text: "hi" });
    expect(String(out(r).error)).toContain("#test");
    expect(r.tainted).toBe(true);
  });
});

describe("refusals", () => {
  it("Jira through the workspace's connection: connect your own", async () => {
    const jira: ProviderAdapter = { ...stubAdapter("jira"), configured: () => true, workspaceActs: false, actions: [] };
    setAdapterForTests("jira", jira);
    const conn = (await adminQuery<{ id: string }>(`INSERT INTO connector_connections(organisation_id, provider, kind, connected_by, external_account_id, external_tenant_id) VALUES ($1, 'jira', 'workspace', $2, 'site', 'site') RETURNING id`, [a.ownerCtx.org.id, a.ownerCtx.membership.id]))[0].id;
    const item = (await adminQuery<{ id: string }>(`INSERT INTO connector_items(organisation_id, connection_id, visibility, provider, kind, external_id, external_key, title) VALUES ($1, $2, 'workspace', 'jira', 'issue', '10001', 'PROJ-7', 'A Jira issue') RETURNING id`, [a.ownerCtx.org.id, conn]))[0].id;
    const r = await runBrendaTool(a.employeeCtx, "work_item_action", { action: "comment", itemId: item, text: "On it" });
    expect(out(r).error).toBe(BRENDA_CONNECTOR_WORDS.needOwnConnection("Jira"));
  });

  it("someone else's item; an action that isn't offered", async () => {
    const id = await itemId(personal, "i-1");
    expect(out(await runBrendaTool(a.employee2Ctx, "hide_app_item", { itemId: id, hidden: true })).error).toBe(BRENDA_CONNECTOR_WORDS.noItem);
    expect(String(out(await runBrendaTool(a.employeeCtx, "calendar_action", { action: "delete_everything" })).error)).toContain("Choose block");
  });

  it("at most 20 shared actions an hour", async () => {
    for (let i = 0; i < 20; i++) await adminQuery(`INSERT INTO connector_audit(organisation_id, connection_id, provider, kind, membership_id, action, outcome) VALUES ($1, $2, 'fake', 'workspace', $3, 'act.shared', 'ok')`, [a.ownerCtx.org.id, workspace, a.managerCtx.membership.id]);
    const r = await runBrendaTool(a.managerCtx, "post_to_channel", { channel: "#test", text: "one more" });
    expect(String(out(r).error)).toContain("a lot of changes");
  });

  it("in a thread every connector tool is refused", async () => {
    const r = await runBrendaTool(a.employeeCtx, "my_calendar", {}, "chat", { shared: { conversationId: "00000000-0000-0000-0000-000000000001" } });
    expect(String(out(r).error)).toContain("your own chat");
  });

  it("impersonated: acting refuses", async () => {
    const imp = { ...a.employeeCtx, user: { ...a.employeeCtx.user, impersonation: { id: "x", adminEmail: "s@example.com" } } };
    expect(out(await runBrendaTool(imp, "hide_app_item", { itemId: await itemId(personal, "i-1"), hidden: false })).error).toBe(BRENDA_CONNECTOR_WORDS.impersonated);
  });
});
