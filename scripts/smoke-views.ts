import { config } from "dotenv"; config({ path: [".env.local"], quiet: true });
import { getPool } from "../src/server/db";
import { contextFor } from "../src/server/services/fixtures";
import * as views from "../src/server/services/views";
import { currentSession } from "../src/server/services/sessions";
import { timesheetForDate, recentDays, exportTimesheetsCsv } from "../src/server/services/reports";
import { navCounts } from "../src/server/services/workspace";
import { todayLocal } from "../src/server/lib/time";

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
    ["navCounts", () => navCounts(ada)], ["myDay", () => views.myDay(ada)], ["currentSession", async () => { const r = await currentSession(ada); if (r.recording === undefined) throw new Error("no recording rules"); return r; }],
    ["listProjects", () => views.listProjects(ada)],
    ["projectDetail", async () => views.projectDetail(ada, (await views.listProjects(ada))[0].id)],
    ["taskDetail", async () => views.taskDetail(ada, (await views.myDay(ada)).assigned[0].id)],
    ["teamStatus", () => views.teamStatus(david)], ["peopleView", () => views.peopleView(owner)], ["notifications", () => views.notificationsView(ada)],
    ["auditView", () => views.auditView(owner)], ["settingsView", () => views.settingsView(owner)], ["policyView", () => views.policyView(ada)],
    ["reviewQueue", () => views.reviewQueue(david)], ["orgDashboard", () => views.orgDashboard(owner)],
    // The staff daily report left on 6 October 2026 (owner decision): Timesheets and the export read confirmed time.
    ["timesheetForDate", () => timesheetForDate(ada, ada.membership.id, today)], ["recentDays", () => recentDays(ada, ada.membership.id, today)],
    ["exportTimesheetsCsv", async () => {
      const started = new Date();
      try {
        const r = await exportTimesheetsCsv(david, { from: today, to: today });
        if (!r.csv.startsWith("organisation,employee_id,employee_name,local_date,timezone,project,task,confirmed_seconds\r\n")) throw new Error("unexpected CSV header");
        return r;
      } finally {
        // The export is audited; this check's own entry is removed so the run leaves nothing behind.
        await admin.query("DELETE FROM audit_events WHERE action = 'export.timesheets' AND actor_membership_id = $1 AND occurred_at >= $2", [david.membership.id, started]);
      }
    }],
  ];
  let failed = 0;
  for (const [name, fn] of checks) {
    try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.log("FAIL", name, (e as Error).message); }
  }
  await admin.end(); await getPool().end();
  process.exit(failed ? 1 : 0);
}
main();
