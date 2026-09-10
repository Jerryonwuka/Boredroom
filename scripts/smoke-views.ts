import { config } from "dotenv"; config({ path: [".env.local"], quiet: true });
import { getPool } from "../src/server/db";
import { contextFor } from "../src/server/services/fixtures";
import * as views from "../src/server/services/views";
import { currentSession } from "../src/server/services/sessions";
import { reportForDate, metrics } from "../src/server/services/reports";
import { navCounts } from "../src/server/services/workspace";
import { todayLocal, addDays } from "../src/server/lib/time";

async function main() {
  const { Client } = await import("pg");
  const admin = new Client({ connectionString: process.env.DATABASE_ADMIN_URL }); await admin.connect();
  const who = async (email: string) => {
    const r = (await admin.query("SELECT p.id, p.auth_user_id, p.email, p.display_name FROM profiles p WHERE p.email = $1", [email])).rows[0];
    return contextFor({ profileId: r.id, authUserId: r.auth_user_id, email: r.email, displayName: r.display_name, password: "" }, "company-a");
  };
  const ada = await who("ada@company-a.test"); const david = await who("david@company-a.test"); const owner = await who("owner@company-a.test");
  const today = todayLocal(ada.org.timezone);
  const checks: [string, () => Promise<unknown>][] = [
    ["navCounts", () => navCounts(ada)], ["myDay", () => views.myDay(ada)], ["currentSession", () => currentSession(ada)],
    ["listProjects", () => views.listProjects(ada)],
    ["projectDetail", async () => views.projectDetail(ada, (await views.listProjects(ada))[0].id)],
    ["taskDetail", async () => views.taskDetail(ada, (await views.myDay(ada)).assigned[0].id)],
    ["teamStatus", () => views.teamStatus(david)], ["peopleView", () => views.peopleView(owner)], ["notifications", () => views.notificationsView(ada)],
    ["auditView", () => views.auditView(owner)], ["settingsView", () => views.settingsView(owner)], ["policyView", () => views.policyView(ada)],
    ["reviewQueue", () => views.reviewQueue(david)], ["reportForDate", () => reportForDate(ada, ada.membership.id, today)],
    ["metrics", () => metrics(david, { from: addDays(today, -13), to: today })],
  ];
  let failed = 0;
  for (const [name, fn] of checks) {
    try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.log("FAIL", name, (e as Error).message); }
  }
  await admin.end(); await getPool().end();
  process.exit(failed ? 1 : 0);
}
main();
