/**
 * Connected apps: the review fixes (security and experience findings, 22 October 2026). Pure pieces only: the sink's
 * choice of source for a workspace item, the Confirm card's digest, the standup rollup's channel words, the hook URLs and
 * the setup copy. No database, no network.
 */
import { describe, expect, it } from "vitest";
import { rowOf } from "@/server/connectors/sync";
import { planDigest } from "@/server/connectors/brenda/tools";
import { standupRollupPost } from "@/server/connectors/posting/digest";
import { hookUrlFor } from "@/server/connectors/env";
import { CATALOGUE } from "@/lib/connectors/catalogue";
import { BRENDA_CONNECTOR_WORDS, CONNECT_FAILURE, CONNECT_FAILURE_CODES, CONNECTOR_WORDS } from "@/lib/connectors/words";
import { readFileSync } from "node:fs";
import type { ConnectionRef, NormalisedItem, ProviderAdapter } from "@/server/connectors/types";

const conn = (kind: "workspace" | "personal"): ConnectionRef => ({
  id: "11111111-1111-4111-8111-111111111111", organisationId: "22222222-2222-4222-8222-222222222222", provider: "asana", kind,
  membershipId: kind === "personal" ? "33333333-3333-4333-8333-333333333333" : null, connectedBy: "33333333-3333-4333-8333-333333333333",
  externalAccountId: "1", externalTenantId: "9", accountLabel: null, scopes: [], settings: {}, canRead: true, canAct: false,
});
const adapter = { linkHosts: ["app.asana.com"] } as unknown as ProviderAdapter;
const task = (o: Partial<NormalisedItem> = {}): NormalisedItem => ({ kind: "issue", externalId: "1203000000000001", title: "Book the venue", ...o });
const sources = new Map([
  ["P-TEAM", { id: "s-team", audience: "team-design" }],
  ["P-ALL", { id: "s-all", audience: null }],
]);

describe("security-2: a workspace item is stored only under a selected source", () => {
  it("no source, or only unselected ones: dropped (never stored for the whole workspace)", () => {
    expect(rowOf(task({ sourceExternalId: null }), { conn: conn("workspace"), adapter, sources })).toBeNull();
    expect(rowOf(task({ sourceExternalId: "P-OTHER", sourceCandidates: ["P-OTHER", "P-ELSE"] }), { conn: conn("workspace"), adapter, sources })).toBeNull();
  });

  it("a personal connection's item needs no source", () => {
    expect(rowOf(task({ sourceExternalId: null, mine: true }), { conn: conn("personal"), adapter, sources })).toMatchObject({ source_id: null, audience_team_id: null, mine: true });
  });

  it("in several projects: the stored one while still selected, else the one listed from, else the first selected", () => {
    const multi = task({ sourceExternalId: "P-ALL", sourceCandidates: ["P-ALL", "P-TEAM"] });
    expect(rowOf(multi, { conn: conn("workspace"), adapter, sources, prefer: "P-TEAM" })).toMatchObject({ source_id: "s-team", audience_team_id: "team-design" });
    expect(rowOf(multi, { conn: conn("workspace"), adapter, sources, prefer: null })).toMatchObject({ source_id: "s-all", audience_team_id: null });
    expect(rowOf(task({ sourceExternalId: "P-GONE", sourceCandidates: ["P-GONE", "P-TEAM"] }), { conn: conn("workspace"), adapter, sources })).toMatchObject({ source_id: "s-team" });
    // A stored source no longer among its projects is not kept.
    expect(rowOf(task({ sourceExternalId: "P-ALL", sourceCandidates: ["P-ALL"] }), { conn: conn("workspace"), adapter, sources, prefer: "P-TEAM" })).toMatchObject({ source_id: "s-all" });
  });
});

describe("security-5: a Confirm press runs only what its card showed", () => {
  const plan = (o: { guests?: number; label?: string; people?: number | null } = {}) => ({
    personal: true,
    resolved: { conn: { id: "c1" }, item: { id: "i1" }, source: null } as never,
    prepared: {
      risk: (o.guests ? "shared" : "private") as "shared" | "private", summary: "Move “Design review”", place: o.label,
      readback: { to: [o.guests ? `The ${o.guests} guests, who get the new time` : "Only you"], what: "“Design review” moves to 15:00" },
      appearsAs: "you", people: o.people ?? null,
    },
  });
  it("the same card gives the same digest; a guest added, a renamed place or a new member count changes it", () => {
    expect(planDigest(plan())).toBe(planDigest(plan()));
    expect(planDigest(plan({ guests: 1 }))).not.toBe(planDigest(plan()));
    expect(planDigest(plan({ label: "#design" }))).not.toBe(planDigest(plan({ label: "#design-old" })));
    expect(planDigest(plan({ people: 12 }))).not.toBe(planDigest(plan({ people: 40 })));
    expect(BRENDA_CONNECTOR_WORDS.changedSinceCard).toMatch(/nothing was done/);
  });
});

describe("security-3: the standup rollup in a channel is counts only", () => {
  it("how many shared and how many are blocked; never names or words", () => {
    const p = standupRollupPost({ team: "Design", dateLabel: "Thursday 22 October", members: 6, posted: 4, blockers: [{ name: "Ada Obi", text: "Waiting on legal about the NDA" }, { name: "Ada Obi", text: "Another" }, { name: "Ben Okafor", text: "No laptop" }] }, "https://boredroom.test/app/acme/my-day");
    expect(p.heading).toBe("Design standup, Thursday 22 October: 4 of 6 shared.");
    expect(p.lines).toEqual(["2 people blocked: the details are in Boredroom."]);
    expect(JSON.stringify(p)).not.toMatch(/Ada|Ben|legal|laptop/);
    expect(standupRollupPost({ team: "Design", dateLabel: "x", members: 6, posted: 6, blockers: [] }, "https://x.test").lines).toEqual([]);
  });
});

describe("security-6: hook URLs carry Boredroom's own hook id", () => {
  const env = { APP_ORIGIN: "https://boredroom.test" } as unknown as NodeJS.ProcessEnv;
  it("Jira's in ?hook=, Asana's in the path, others none", () => {
    const id = "66666666-6666-4666-8666-666666666666";
    expect(hookUrlFor("jira", id, env)).toBe(`https://boredroom.test/api/connectors/webhooks/jira?hook=${id}`);
    expect(hookUrlFor("asana", id, env)).toBe(`https://boredroom.test/api/connectors/webhooks/asana/${id}`);
    expect(hookUrlFor("github", id, env)).toBe("https://boredroom.test/api/connectors/webhooks/github");
  });
});

describe("security-1: GitHub's connect failure has its own words", () => {
  it("install_not_admin is a fixed code with fixed words", () => {
    expect(CONNECT_FAILURE_CODES).toContain("install_not_admin");
    expect(CONNECT_FAILURE.install_not_admin("GitHub")).toMatch(/owner of that GitHub organisation/);
  });
});

describe("experience fixes: setup copy", () => {
  it("every provider names its console; GitHub's Setup URL is a real URL entry, not a placeholder; the App asks for Members: read", () => {
    for (const e of CATALOGUE) expect(e.setup.console.length).toBeGreaterThan(3);
    const gh = CATALOGUE.find((e) => e.id === "github")!;
    expect(gh.setup.steps.join(" ")).not.toContain("<APP_ORIGIN>");
    expect(gh.setup.extraUrls).toEqual([{ label: "Setup URL", path: "/api/connectors/github/setup" }]);
    expect(gh.setup.steps.join(" ")).toMatch(/Members read only/);
  });
  it("Notion: the Developer portal and a public connection; nobody says 'then restart' alone", () => {
    const n = CATALOGUE.find((e) => e.id === "notion")!;
    expect(n.setup.console).toContain("app.notion.com/developers/connections");
    expect(n.setup.steps[0]).toMatch(/public connection/);
    for (const e of CATALOGUE) expect(e.setup.steps.join(" ")).not.toMatch(/then restart/i);
    expect(CONNECTOR_WORDS.workspace.restart).toMatch(/Restart Boredroom/);
  });
  it("the workspace cards take the assistant's name; Notion's copy too", () => {
    expect(CONNECTOR_WORDS.workspace.brendaReads("Linear", "Max")).toBe("Let Max read Linear");
    expect(CONNECTOR_WORDS.workspace.chatActs("Max")).toMatch(/^Let people ask Max to post/);
    const n = CATALOGUE.find((e) => e.id === "notion")!;
    expect(`${n.workspace!.what} ${n.workspace!.note}`).not.toMatch(/Brenda/);
  });
  it("staff are never told the workspace failed to set apps up", () => {
    expect(CONNECTOR_WORDS.personal.nothingOffered).toBe("No apps are available to connect yet.");
  });
  it("the Slack manifest turns token rotation on under settings, not oauth_config", () => {
    const m = readFileSync("docs/connectors/slack-manifest.yaml", "utf8");
    const settings = m.slice(m.indexOf("\nsettings:"));
    const oauth = m.slice(m.indexOf("\noauth_config:"), m.indexOf("\nsettings:"));
    expect(settings).toMatch(/\n  token_rotation_enabled: true/);
    expect(oauth).not.toMatch(/token_rotation_enabled/);
  });
});
