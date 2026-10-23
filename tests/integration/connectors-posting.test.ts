/**
 * Posting to a workspace's channels (owner decisions, 22 October 2026: connectors; spec §10, §16.3): routes are chosen
 * and turned on only by owners and HR; the digest never carries hours, clock times, lateness, attendance, assistants'
 * updates or notes; each route posts once a day; an app that refuses turns the route off and tells owners and HR; the
 * standup rollup never names who didn't share.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetTestDatabase, adminQuery } from "../helpers/db";
import { buildCompany, type CompanyFixture } from "@/server/services/fixtures";
import { forget0061 } from "@/server/lib/schema-0061";
import { applyConnectorsMigration, connectFake } from "@/server/connectors/testing";
import { refreshSources } from "@/server/connectors/sync";
import { setRoute, setRouteEnabled } from "@/server/connectors/connections";
import { previewRoute, renderSlack, renderTeams, runPostJob } from "@/server/connectors/posting/post";
import { standupRollupPost } from "@/server/connectors/posting/digest";
import { fakeServer } from "@/server/connectors/adapters/fake";
import { localDate } from "@/server/lib/time";
import { clockIn } from "@/server/services/attendance";

let a: CompanyFixture;
let workspace: string;
let channel: string;
const saved = process.env.CONNECTORS_FAKE;

beforeAll(async () => {
  process.env.CONNECTORS_FAKE = "1";
  await resetTestDatabase();
  forget0061();
  a = await buildCompany("a");
  await applyConnectorsMigration(adminQuery);
  fakeServer.reset();
  workspace = await connectFake(a.ownerCtx, "workspace");
  await refreshSources(workspace);
  channel = (await adminQuery<{ id: string }>(`UPDATE connector_sources SET selected = true WHERE connection_id = $1 AND kind = 'channel' RETURNING id`, [workspace]))[0].id;
  // A day with everything the digest must leave out: a clock-in, a finished task, a blocked one, an assistant's update.
  await clockIn(a.employeeCtx).catch(() => undefined);
  await adminQuery(`UPDATE tasks SET status = 'completed', completed_at = now() WHERE id = $1`, [a.taskIds.homepage]);
  await adminQuery(`UPDATE tasks SET status = 'blocked', blocked_reason = 'Waiting on the client' WHERE id = $1`, [a.taskIds.second]);
});
afterAll(() => { forget0061(); if (saved === undefined) delete process.env.CONNECTORS_FAKE; else process.env.CONNECTORS_FAKE = saved; });

describe("routes", () => {
  it("only owners and HR choose and turn them on; a new route is saved off", async () => {
    await expect(setRoute(a.employeeCtx, { purpose: "daily_digest", teamId: null, sourceId: channel })).rejects.toMatchObject({ status: 403 });
    const r = await setRoute(a.hrCtx, { purpose: "daily_digest", teamId: null, sourceId: channel });
    expect(r.routes).toHaveLength(1);
    expect(r.routes[0].enabled).toBe(false);
    await expect(setRouteEnabled(a.managerCtx, r.routes[0].id, true)).rejects.toMatchObject({ status: 403 });
    expect((await setRouteEnabled(a.ownerCtx, r.routes[0].id, true)).enabled).toBe(true);
    const audit = await adminQuery(`SELECT 1 FROM audit_events WHERE action = 'connector.route_enabled'`);
    expect(audit).toHaveLength(1);
  });

  it("an unselected channel can't be a route", async () => {
    const other = (await adminQuery<{ id: string }>(`UPDATE connector_sources SET selected = false WHERE connection_id = $1 AND kind = 'project' RETURNING id`, [workspace]))[0].id;
    await expect(setRoute(a.ownerCtx, { purpose: "standup", teamId: a.teamId, sourceId: other })).rejects.toMatchObject({ status: 422 });
  });
});

describe("the digest", () => {
  it("says what was finished and blocked, with first names, and never hours, times, lateness, attendance or notes", async () => {
    const route = (await adminQuery<{ id: string }>(`SELECT id FROM connector_channel_routes WHERE purpose = 'daily_digest'`))[0].id;
    const p = await previewRoute(route, a.ownerCtx.org.id);
    const text = [p!.preview!.heading, ...p!.preview!.lines].join("\n");
    expect(text).toContain("- Homepage design (Ada)");
    expect(text).toContain("- Blocked: Pricing page copy (Ben)");
    expect(text).not.toMatch(/\b\d{1,2}:\d{2}\b/);
    expect(text).not.toMatch(/hour|late|clock|attend|idle|minutes|Waiting on the client|note/i);
    expect(p!.readback.to).toEqual(["#test in Test app, 3 people"]);
  });

  it("posts once per route per day; escaping keeps mentions and markup out", async () => {
    const route = (await adminQuery<{ id: string }>(`SELECT id FROM connector_channel_routes WHERE purpose = 'daily_digest'`))[0].id;
    const today = localDate(new Date(), a.ownerCtx.org.timezone);
    expect(await runPostJob({ routeId: route, kind: "daily_digest", localDate: today })).toBe("posted");
    expect(await runPostJob({ routeId: route, kind: "daily_digest", localDate: today })).toBe("already");
    expect(fakeServer.posts).toHaveLength(1);
    expect(fakeServer.posts[0].text).toContain("Homepage design (Ada)");
    const slack = renderSlack({ heading: "<!channel> & co", lines: ["@here <b>x</b>"], link: { label: "Open|now", href: "https://boredroom.test/app/a" } });
    expect(slack).toBe("*&lt;!channel&gt; &amp; co*\n@here &lt;b&gt;x&lt;/b&gt;\n<https://boredroom.test/app/a|Open/now>");
    expect(renderTeams({ heading: "<script>", lines: ["a & b"] })).toBe("<p><strong>&lt;script&gt;</strong></p><p>a &amp; b</p>");
  });

  it("an app that refuses turns the route off and tells owners and HR once", async () => {
    const route = (await adminQuery<{ id: string }>(`SELECT id FROM connector_channel_routes WHERE purpose = 'daily_digest'`))[0].id;
    await adminQuery(`SELECT set_config('app.role', 'worker', false); UPDATE connector_sources SET external_id = 'C-GONE' WHERE id = '${channel}'`);
    const tomorrow = "2099-01-01";
    expect(await runPostJob({ routeId: route, kind: "daily_digest", localDate: tomorrow })).toBe("disabled");
    expect((await adminQuery<{ enabled: boolean }>(`SELECT enabled FROM connector_channel_routes WHERE id = $1`, [route]))[0].enabled).toBe(false);
    const notes = await adminQuery<{ recipient_membership_id: string; title: string }>(`SELECT recipient_membership_id, title FROM notifications WHERE type = 'connector.trouble' ORDER BY recipient_membership_id`);
    expect(notes.map((n) => n.recipient_membership_id).sort()).toEqual([a.ownerCtx.membership.id, a.hrCtx.membership.id].sort());
    expect(notes[0].title).toBe("Boredroom can't post in #test any more. Choose another channel in Settings › Connectors.");
  });
});

describe("standups", () => {
  // Security fix, 22 October 2026: counts only in a channel; a person's words leave Boredroom only by their own press.
  it("the rollup counts who shared and who is blocked; never names, words, or who didn't share", () => {
    const p = standupRollupPost({ team: "Design", dateLabel: "Thursday 22 October", members: 6, posted: 4, blockers: [{ name: "Ada Employee", text: "Waiting for the logo files" }] }, "https://boredroom.test/app/a/my-day");
    expect(p.heading).toBe("Design standup, Thursday 22 October: 4 of 6 shared.");
    expect(p.lines).toEqual(["1 person blocked: the details are in Boredroom."]);
    expect(JSON.stringify(p)).not.toMatch(/Ada|logo|Ben|didn't|no update/i);
  });
});
