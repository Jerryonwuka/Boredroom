import { config } from "dotenv"; config({ path: [".env.local"], quiet: true });
import { getPool } from "../src/server/db";
import { contextFor } from "../src/server/services/fixtures";
import { chat } from "../src/server/services/copilot";
import { searchWorkspace } from "../src/server/services/search";

/** Exercises the workspace assistant and search against the seeded workspace, as staff, a lead and the owner. */
async function main() {
  const { Client } = await import("pg");
  const admin = new Client({ connectionString: process.env.DATABASE_ADMIN_URL }); await admin.connect();
  const who = async (email: string) => {
    const r = (await admin.query("SELECT p.id, p.auth_user_id, p.email, p.display_name FROM profiles p WHERE p.email = $1", [email])).rows[0];
    return contextFor({ profileId: r.id, authUserId: r.auth_user_id, email: r.email, displayName: r.display_name, password: "" }, "company-a");
  };
  const ada = await who("ada@company-a.test"); const david = await who("david@company-a.test"); const owner = await who("owner@company-a.test");
  const ask = (name: string, ctx: Parameters<typeof chat>[0], content: string) => [name, async () => { const r = await chat(ctx, { messages: [{ role: "user", content }] }); return `${r.engine}: ${r.reply.slice(0, 110)} [did: ${r.actions.map((a) => a.kind).join(",") || "-"}; offered: ${r.proposals.map((p) => p.kind).join(",") || "-"}]`; }] as const;
  const checks = [
    ["search ada 'a'", async () => (await searchWorkspace(ada, "a")).hits.map((h) => h.kind).join(",")],
    ["search owner 'design'", async () => (await searchWorkspace(owner, "design")).hits.length],
    ask("ada: clock in", ada, "clock me in"),
    ask("ada: my day", ada, "what is on my day?"),
    ask("ada: to-dos", ada, "I need to finish the logo export by Friday and then update the brand deck"),
    ask("david: who is working", david, "who is working right now?"),
    ask("owner: where are settings", owner, "where do I change the schedule?"),
    ask("owner: attendance", owner, "who has clocked in today?"),
  ] as const;
  let failed = 0;
  for (const [name, fn] of checks) {
    try { console.log("ok  ", name, "→", await fn()); } catch (e) { failed++; console.log("FAIL", name, (e as Error).message); }
  }
  await admin.end(); await getPool().end();
  process.exit(failed ? 1 : 0);
}
main();
