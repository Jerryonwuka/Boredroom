import { config } from "dotenv"; config({ path: [".env.local"], quiet: true });
import { getPool } from "../src/server/db";
import { approveLink, listDevices, revokeDevice } from "../src/server/services/desktop";

/**
 * The Brenda desktop link against the running app (pnpm dev) and the seeded test workspace: the app asks for a code,
 * Ada approves it, the app claims a desktop session and reads its state with the bearer token; then Ada unlinks it
 * and the token stops working.
 */
const BASE = process.env.SMOKE_BASE ?? "http://localhost:3000";
async function main() {
  const { Client } = await import("pg");
  const admin = new Client({ connectionString: process.env.DATABASE_ADMIN_URL }); await admin.connect();
  const r = (await admin.query("SELECT p.id, p.auth_user_id, p.email, p.display_name FROM profiles p WHERE p.email = 'ada@company-a.test'")).rows[0];
  const ada = { profileId: r.id, authUserId: r.auth_user_id, email: r.email, displayName: r.display_name, emailVerified: true, sessionId: "smoke" };
  const post = (path: string, body: unknown, token?: string) => fetch(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  let failed = 0;
  const step = async (name: string, fn: () => Promise<unknown>) => { try { console.log("ok  ", name, "→", JSON.stringify(await fn()).slice(0, 200)); } catch (e) { failed++; console.log("FAIL", name, (e as Error).message); } };

  let link: { deviceCode: string; userCode: string; verifyUrl: string } = { deviceCode: "", userCode: "", verifyUrl: "" };
  let token = "";
  await step("app asks for a code", async () => { const res = await post("/api/desktop/link", { deviceName: "Smoke test Mac" }); link = await res.json(); if (!res.ok) throw new Error(JSON.stringify(link)); return { userCode: link.userCode, verifyUrl: link.verifyUrl }; });
  await step("poll before approval is pending", async () => { const res = await post("/api/desktop/link/poll", { deviceCode: link.deviceCode }); const j = await res.json(); if (j.status !== "pending") throw new Error(JSON.stringify(j)); return j; });
  await step("Ada approves for company-a", async () => approveLink(ada, { userCode: link.userCode.toLowerCase().replace("-", ""), orgSlug: "company-a" }));
  await step("poll returns the token once", async () => { const res = await post("/api/desktop/link/poll", { deviceCode: link.deviceCode }); const j = await res.json(); if (j.status !== "approved") throw new Error(JSON.stringify(j)); token = j.token; return { workspace: j.workspace, displayName: j.displayName }; });
  await step("second poll is refused", async () => { const res = await post("/api/desktop/link/poll", { deviceCode: link.deviceCode }); if (res.status !== 410) throw new Error(`status ${res.status}`); return res.status; });
  await step("desktop state with the bearer token", async () => {
    const res = await fetch(`${BASE}/api/orgs/company-a/brenda/desktop`, { headers: { authorization: `Bearer ${token}` } });
    const j = await res.json(); if (!res.ok) throw new Error(JSON.stringify(j));
    return { me: j.me.displayName, clock: j.clock?.status, timer: !!j.timer, open: j.briefing.openTasks, notifications: j.notifications.length };
  });
  await step("a POST with the token works (presence)", async () => { const res = await post("/api/orgs/company-a/brenda/presence", {}, token); const j = await res.json(); if (!res.ok) throw new Error(JSON.stringify(j)); return j; });
  await step("the computer is listed, then unlinked", async () => { const d = await listDevices(ada); const mine = d.find((x) => x.device_name === "Smoke test Mac"); if (!mine) throw new Error("not listed"); await revokeDevice(ada, mine.id); return d.length; });
  await step("the token no longer works", async () => { const res = await fetch(`${BASE}/api/orgs/company-a/brenda/desktop`, { headers: { authorization: `Bearer ${token}` } }); if (res.status !== 401) throw new Error(`status ${res.status}`); return res.status; });
  await step("a wrong code is refused", async () => { try { await approveLink(ada, { userCode: "ZZZZ-ZZZZ", orgSlug: "company-a" }); } catch (e) { return (e as Error).message; } throw new Error("accepted"); });

  console.log(failed ? `${failed} failed` : "all passed");
  await admin.end(); await getPool().end();
  process.exit(failed ? 1 : 0);
}
main();
