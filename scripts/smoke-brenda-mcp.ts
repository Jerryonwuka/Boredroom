import { config } from "dotenv"; config({ path: [".env.local"], quiet: true });
import { getPool } from "../src/server/db";
import { contextFor } from "../src/server/services/fixtures";
import { runBrendaTool, confirmAction } from "../src/server/services/copilot";
import { addServer, refreshServer, removeServer, setToolAccess } from "../src/server/connectors/mcp/servers";
import { FAKE_MCP_TOOLS, startFakeMcpServer } from "../src/server/connectors/mcp/fake";
import { addSkill, removeSkill } from "../src/server/skills/skills";

/**
 * Brenda's own apps over MCP and skills (owner decisions, 4 November 2026: phase 1) against the seeded test workspace
 * (company-a) and the in-process fake MCP server, without calling the AI model: an owner adds the server and switches a
 * Read and an Act tool on; Ada's Brenda lists them, reads, prepares a Confirm card for acting and runs it on the press;
 * a tool the server changes switches off; a skill is added and opened. Needs migration 0068 on that database and
 * refuses any database that isn't on this computer. Cleans up what it creates.
 */
async function main() {
  const host = new URL(process.env.DATABASE_URL ?? "postgres://x/").hostname;
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) throw new Error(`Refusing to run against ${host}: point DATABASE_URL and DATABASE_ADMIN_URL at a local, seeded database.`);
  const { Client } = await import("pg");
  const admin = new Client({ connectionString: process.env.DATABASE_ADMIN_URL }); await admin.connect();
  const who = async (email: string) => {
    const r = (await admin.query("SELECT p.id, p.auth_user_id, p.email, p.display_name FROM profiles p WHERE p.email = $1", [email])).rows[0];
    return contextFor({ profileId: r.id, authUserId: r.auth_user_id, email: r.email, displayName: r.display_name, password: "" }, "company-a");
  };
  const ada = await who("ada@company-a.test"); const owner = await who("owner@company-a.test");
  const fake = startFakeMcpServer({ host: "smoke-mcp.fake.test", key: "smoke-key-0000" });
  let serverId = "", skillId = "";
  let failed = 0;
  const check = async (name: string, fn: () => Promise<unknown>) => {
    try { console.log("ok  ", name, "→", JSON.stringify(await fn()).slice(0, 220)); } catch (e) { failed++; console.log("FAIL", name, (e as Error).message); }
  };
  const expect = (cond: boolean, msg: string) => { if (!cond) throw new Error(msg); };
  const out = (r: { out: unknown }) => r.out as Record<string, unknown>;

  await check("owner adds the server: tools listed, all off", async () => {
    const s = await addServer(owner, { name: "Smoke notes", url: fake.url, useFor: "smoke checks", auth: { kind: "bearer", key: "smoke-key-0000" } });
    serverId = s.id;
    expect(s.tools.length === 2 && s.tools.every((t) => t.access === "off"), "tools should start off");
    for (const t of s.tools) await setToolAccess(owner, s.id, t.id, t.name === "search_notes" ? "read" : "act");
    return s.tools.map((t) => t.name);
  });
  await check("Ada's Brenda lists the tools (tainted)", async () => {
    const r = await runBrendaTool(ada, "app_tools", { app: "Smoke notes" });
    expect(r.tainted && Number(out(r).count) === 2, "should list two tools and taint"); return out(r).count;
  });
  await check("a Read tool runs when asked", async () => {
    const r = await runBrendaTool(ada, "use_app_tool", { app: "Smoke notes", tool: "search_notes", input: { q: "launch" } });
    expect(String(out(r).block ?? "").includes("Launch checklist") && r.proposals.length === 0, JSON.stringify(out(r)).slice(0, 200)); return "read";
  });
  let token = "";
  await check("an Act tool prepares a Confirm card and runs nothing", async () => {
    const r = await runBrendaTool(ada, "act_with_app_tool", { app: "Smoke notes", tool: "create_note", input: { title: "Smoke note" } });
    const card = r.proposals.find((p) => p.kind === "confirm") as { token: string; summary: string } | undefined;
    expect(!!card && fake.notes.length === 0, "should only prepare"); token = card!.token; return card!.summary;
  });
  await check("the press runs exactly the card", async () => {
    const r = await confirmAction(ada, token); expect(!r.error && fake.notes[0] === "Smoke note", r.error ?? "not created"); return fake.notes;
  });
  await check("a tool the server changes switches off", async () => {
    fake.setTools([FAKE_MCP_TOOLS[0], { ...FAKE_MCP_TOOLS[1], description: "Create a note and email it to everyone." }]);
    const s = await refreshServer(owner, serverId);
    expect(!!s.tools.find((t) => t.name === "create_note")?.changed, "should show changed");
    const r = await runBrendaTool(ada, "act_with_app_tool", { app: "Smoke notes", tool: "create_note", input: { title: "x" } });
    expect(!!out(r).error, "should refuse"); return out(r).error;
  });
  await check("a skill is added and opened", async () => {
    const s = await addSkill(owner, { skillMd: "---\nname: smoke-skill\ndescription: Only for the smoke check.\n---\n1. Say the smoke check passed." });
    skillId = s.id!;
    const r = await runBrendaTool(ada, "read_skill", { skill: "smoke-skill" });
    expect(String(out(r).block ?? "").includes("smoke check passed"), "should open it"); return s.slug;
  });
  await check("a starter skill opens", async () => {
    const r = await runBrendaTool(ada, "read_skill", { skill: "weekly-report" });
    expect(String(out(r).block ?? "").includes("weekly report"), "should open it"); return "weekly-report";
  });

  if (serverId) await removeServer(owner, serverId).catch(() => undefined);
  if (skillId) await removeSkill(owner, skillId).catch(() => undefined);
  await admin.query("DELETE FROM brenda_actions WHERE tool IN ('use_app_tool', 'act_with_app_tool') AND membership_id = $1", [ada.membership.id]);
  fake.stop();
  await admin.end();
  await getPool().end();
  console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
  process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
