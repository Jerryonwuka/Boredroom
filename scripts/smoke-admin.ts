import { config } from "dotenv"; config({ path: [".env.local"], quiet: true });
import { getPool, withSystem } from "../src/server/db";
import * as orgs from "../src/server/admin/organisations";
import * as users from "../src/server/admin/users";
import * as billing from "../src/server/admin/billing";
import * as marketing from "../src/server/admin/marketing";
import * as ops from "../src/server/admin/ops";
import { launchState, joinWaitlist } from "../src/server/admin/launch";
import { allSettings } from "../src/server/admin/settings";

/** Exercises every Control Center read model and the safe write paths against the database. */
async function main() {
  const checks: [string, () => Promise<unknown>][] = [
    ["settings", () => allSettings(true)], ["launchState", () => launchState()],
    ["dashboardMetrics", () => ops.dashboardMetrics()], ["usageOverview", () => ops.usageOverview(30)], ["liveActivity", () => ops.liveActivity()], ["storageOverview", () => ops.storageOverview()],
    ["systemOverview", () => ops.systemOverview()], ["auditLog", () => ops.auditLog()], ["listAdmins", () => ops.listAdmins()], ["globalSearch", () => ops.globalSearch("a")], ["impersonations", () => ops.impersonations()],
    ["listOrganisations", () => orgs.listOrganisations({ status: "all" })], ["listOrganisations expiring", () => orgs.listOrganisations({ status: "expiring", q: "co" })],
    ["organisationDetail", async () => orgs.organisationDetail((await orgs.listOrganisations()).rows[0].id)],
    ["listUsers", () => users.listUsers({ q: "a" })], ["userDetail", async () => users.userDetail((await users.listUsers()).rows[0].auth_user_id)],
    ["listPlans", () => billing.listPlans()], ["listSubscriptions", () => billing.listSubscriptions({ status: "expiring", within: 30 })], ["expiryBuckets", () => billing.expiryBuckets()], ["listPayments", () => billing.listPayments()], ["paymentMetrics", () => billing.paymentMetrics()],
    ["marketingMetrics", () => marketing.marketingMetrics()], ["listContacts", () => marketing.listContacts()], ["listSegments", () => marketing.listSegments()], ["listTemplates", () => marketing.listTemplates()], ["listCampaigns", () => marketing.listCampaigns()], ["listAutomations", () => marketing.listAutomations()], ["emailLog", () => marketing.emailLog()],
    ["audienceSql all kinds", async () => { for (const kind of ["all", "waitlist", "users", "free", "paid", "trial", "expiring"]) { const a = marketing.audienceSql({ kind }); await withSystem((db) => db.one(`SELECT count(*)::int AS n ${a.sql}`, a.params)); } }],
    ["segment rules", async () => { const a = marketing.audienceSql({ kind: "segment" }, [{ field: "account_age_days", op: "gte", value: 1 }, { field: "expires_within_days", op: "lte", value: 30 }, { field: "inactive_days", op: "gte", value: 7 }, { field: "plan", op: "eq", value: "free" }, { field: "status", op: "neq", value: "unsubscribed" }]); return withSystem((db) => db.one(`SELECT count(*)::int AS n ${a.sql}`, a.params)); }],
    ["joinWaitlist (idempotent)", () => joinWaitlist({ firstName: "Smoke", lastName: "Test", email: "smoke-test@example.com", company: "Smoke Co", companySize: "6-20", role: "Ops", interest: "checking", source: "smoke", website: "" }, "127.0.0.1")],
    ["renderTemplate", async () => { const t = (await marketing.listTemplates())[0]; return marketing.renderTemplate(t, { first_name: "Ada" }).subject; }],
    ["expireSubscriptions", () => marketing.expireSubscriptions()], ["runScheduledAutomations", () => marketing.runScheduledAutomations()],
  ];
  let failed = 0;
  for (const [name, fn] of checks) {
    try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.log("FAIL", name, (e as Error).message); }
  }
  await getPool().end();
  process.exit(failed ? 1 : 0);
}
main();
