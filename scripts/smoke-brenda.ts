import { config } from "dotenv"; config({ path: [".env.local"], quiet: true });
import { getPool } from "../src/server/db";
import { contextFor } from "../src/server/services/fixtures";
import { runBrendaTool, confirmAction } from "../src/server/services/copilot";
import { briefing, setBrendaSettings, setBrendaPrefs, autoClockIn, brendaTick, brendaOverview, listReminders } from "../src/server/services/brenda";

/**
 * Brenda's MVP against the seeded test workspace (company-a), without calling the AI model: the briefing, the tools in
 * chat mode (own work runs, work for others is prepared), confirming a prepared action, refusing someone else's
 * token, reminders through the worker tick, automatic clock-in, and the action log. Cleans up what it creates.
 */
async function main() {
  const { Client } = await import("pg");
  const admin = new Client({ connectionString: process.env.DATABASE_ADMIN_URL }); await admin.connect();
  const who = async (email: string) => {
    const r = (await admin.query("SELECT p.id, p.auth_user_id, p.email, p.display_name FROM profiles p WHERE p.email = $1", [email])).rows[0];
    return contextFor({ profileId: r.id, authUserId: r.auth_user_id, email: r.email, displayName: r.display_name, password: "" }, "company-a");
  };
  const ada = await who("ada@company-a.test"); const david = await who("david@company-a.test"); const owner = await who("owner@company-a.test");
  const created: string[] = [];
  let failed = 0;
  const check = async (name: string, fn: () => Promise<unknown>) => {
    try { console.log("ok  ", name, "→", JSON.stringify(await fn()).slice(0, 220)); } catch (e) { failed++; console.log("FAIL", name, (e as Error).message); }
  };
  const expect = (cond: boolean, msg: string) => { if (!cond) throw new Error(msg); };

  await check("briefing as staff", async () => { const b = await briefing(ada); return { open: b.openTasks, dueToday: b.dueToday.length, overdue: b.overdue.length, clock: b.clock?.status }; });
  await check("briefing as lead", async () => { const b = await briefing(david); return { review: b.waitingForYourReview.length, notPickedUp: b.assignmentsNotPickedUp.length }; });
  await check("briefing as owner", async () => { const b = await briefing(owner); expect(b.clock === null, "owner has no clock"); return { review: b.waitingForYourReview.length }; });

  await check("staff own to-do runs at once", async () => {
    const r = await runBrendaTool(ada, "create_todos", { items: [{ title: "Brenda smoke: own to-do" }] });
    const o = r.out as { created?: { id: string }[] };
    expect(!!o.created?.length && r.proposals.length === 0, "should have created directly"); created.push(...o.created!.map((c) => c.id));
    return r.actions.map((a) => a.summary);
  });
  await check("staff cannot assign to others", async () => {
    const r = await runBrendaTool(ada, "create_todos", { items: [{ title: "x", assignee: "David" }] });
    expect(!!(r.out as { error?: string }).error, "should refuse"); return r.out;
  });
  let token = "";
  await check("lead: task for someone else is prepared, not done", async () => {
    const r = await runBrendaTool(david, "create_todos", { items: [{ title: "Brenda smoke: for Ada", assignee: ada.user.displayName }] });
    expect((r.out as { needsConfirmation?: boolean }).needsConfirmation === true && r.proposals.length === 1, "should ask first");
    token = (r.proposals[0] as { token: string }).token; return (r.proposals[0] as { summary: string }).summary;
  });
  await check("someone else cannot use the token", async () => {
    try { await confirmAction(ada, token); } catch (e) { return (e as Error).message; }
    throw new Error("token accepted for the wrong person");
  });
  await check("lead confirms: the task is created", async () => {
    const r = await confirmAction(david, token); expect(!r.error && r.actions.length === 1, r.error ?? "no action");
    const id = r.actions[0].href?.split("/").pop(); if (id) created.push(id); return r.actions[0].summary;
  });
  await check("a second Confirm on the same token does nothing", async () => {
    try { await confirmAction(david, token); } catch (e) { expect((e as { code?: string }).code === "ALREADY_CONFIRMED", (e as Error).message); return (e as Error).message; }
    throw new Error("the same confirmation ran twice");
  });
  await check("staff updates own progress at once", async () => {
    const r = await runBrendaTool(ada, "update_task", { taskId: created[0], progressPercent: 40 });
    expect(r.proposals.length === 0 && !(r.out as { error?: string }).error, JSON.stringify(r.out)); return r.actions[0]?.summary;
  });
  await check("staff comments", async () => (await runBrendaTool(ada, "add_comment", { taskId: created[0], body: "Brenda smoke comment" })).actions[0]?.summary);
  await check("submit for review is prepared", async () => {
    const r = await runBrendaTool(ada, "submit_for_review", { taskId: created[0], note: "smoke" });
    expect(r.proposals.length === 1 || !!(r.out as { error?: string }).error, "should ask first or explain"); return r.out;
  });

  await check("reminder set, delivered by the tick", async () => {
    const r = await runBrendaTool(ada, "remind_me", { body: "Brenda smoke reminder", at: new Date(Date.now() + 1000).toISOString() });
    expect(r.actions.length === 1, JSON.stringify(r.out));
    await new Promise((res) => setTimeout(res, 1500));
    const tick = await brendaTick(new Date());
    const n = (await admin.query("SELECT count(*)::int AS n FROM notifications WHERE deduplication_key LIKE 'brenda.reminder:%' AND title = 'Reminder: Brenda smoke reminder'")).rows[0].n;
    expect(n === 1, `expected 1 reminder notification, got ${n}`); return { tick, delivered: n, pending: (await listReminders(ada)).length };
  });

  await check("auto clock-in off by default", async () => { const r = await autoClockIn(ada); expect(!r.clockedIn, "should not clock in"); return r; });
  const today = (await admin.query("SELECT 1 FROM attendance_days a JOIN memberships m ON m.id = a.membership_id WHERE m.id = $1 AND a.local_date = (now() AT TIME ZONE 'UTC')::date", [ada.membership.id])).rowCount;
  await check("staff cannot change organisation settings", async () => { try { await setBrendaSettings(ada, { autoClockIn: true }); } catch (e) { return (e as Error).message; } throw new Error("allowed"); });
  await check("owner switches automatic clock-in on; person opts out; then in", async () => {
    await setBrendaSettings(owner, { autoClockIn: true });
    await setBrendaPrefs(ada, { autoClockIn: false });
    const off = await autoClockIn(ada); expect(!off.clockedIn && off.reason === "off_for_person", JSON.stringify(off));
    await setBrendaPrefs(ada, { autoClockIn: true });
    return { optedOut: off.reason, optedIn: await autoClockIn(ada) };
  });
  await check("action log", async () => { const o = await brendaOverview(owner); return o.actions.slice(0, 4).map((a) => `${a.outcome}:${a.tool}`); });

  // Clean up: archive smoke tasks, drop smoke reminders/notifications, put settings and Ada's clock back.
  if (created.length) await admin.query("UPDATE tasks SET archived_at = now() WHERE id = ANY($1::uuid[])", [created]);
  await admin.query("DELETE FROM notifications WHERE title = 'Reminder: Brenda smoke reminder'");
  await admin.query("DELETE FROM brenda_reminders WHERE body = 'Brenda smoke reminder'");
  if (!today) await admin.query("DELETE FROM attendance_days WHERE membership_id = $1 AND clocked_in_by = 'brenda' AND local_date >= (now() - interval '1 day')::date", [ada.membership.id]);
  await setBrendaSettings(owner, { autoClockIn: false });
  console.log(failed ? `${failed} failed` : "all passed");
  await admin.end(); await getPool().end();
  process.exit(failed ? 1 : 0);
}
main();
