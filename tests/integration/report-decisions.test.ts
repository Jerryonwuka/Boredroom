/**
 * Brenda keeps the loops closed (owner decision, 8 October 2026: phase 7a, the team report). The end-of-day report opens
 * with "Decisions for you" (what waits on the reader, read as them, each line linked to its source), then "Changed since
 * yesterday", compared with the snapshot the previous report was written from (brenda_report_log.snapshot, migration
 * 0046): newly blocked, unblocked, deadlines moved later, newly late and finished, each once, unchanged tasks left out.
 *
 * Local test database only (TEST_DATABASE_URL, embedded PostgreSQL on localhost). No model: the key is dropped and the
 * reports are written with `useAssistant: false`.
 *
 * Company A: Ada Owner (owner), Mary HR, David Manager (leads Design: Olu Adeyemi and Ben Okafor); Sam Sales leads Sales
 * (Sid). Africa/Lagos.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { resetTestDatabase, adminQuery } from "../helpers/db";
import { buildCompany, createVerifiedUser, joinViaInvitation, type CompanyFixture } from "@/server/services/fixtures";
import { createTeam, setTeamMember } from "@/server/services/orgs";
import { createTask, updateTask } from "@/server/services/tasks";
import { reviewSubmission, submitTask } from "@/server/services/evidence";
import { requestAdjustment } from "@/server/services/reports";
import { planRequest, sendAssistantItem } from "@/server/services/assistant-items";
import { saveMyAssistant } from "@/server/services/assistant-profile";
import { buildDailyReport, teamReportNow, snapshotOf } from "@/server/services/daily-report";
import { localDate, todayLocal } from "@/server/lib/time";
import type { OrgContext } from "@/server/lib/api";

delete process.env.ANTHROPIC_API_KEY;

let a: CompanyFixture;
let ada: OrgContext, david: OrgContext, olu: OrgContext, ben: OrgContext, sam: OrgContext, sid: OrgContext;
const t: Record<"homepage" | "meeting" | "pricing" | "brand" | "launch" | "press", string> = { homepage: "", meeting: "", pricing: "", brand: "", launch: "", press: "" };
let requestId = "", submissionId = "";
const slug = () => a.slug;
const id = (c: OrgContext) => c.membership.id;
const today = () => todayLocal(a.ownerCtx.org.timezone);
const taskLink = (taskId: string, title: string) => `[“${title}”](/app/${slug()}/tasks/${taskId})`;
const version = async (taskId: string) => (await adminQuery<{ version: number }>("SELECT version FROM tasks WHERE id = $1", [taskId]))[0].version;
const move = async (c: OrgContext, taskId: string, status: "in_progress" | "blocked", reason?: string) => updateTask(c, taskId, { expectedVersion: await version(taskId), status, ...(reason ? { reason } : {}) });
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
const bodyOf = async (docId: string) => (await adminQuery<{ body: string }>("SELECT body FROM documents WHERE id = $1", [docId]))[0].body;
const section = (body: string, heading: string) => { const from = body.indexOf(`## ${heading}`); if (from < 0) return ""; const next = body.indexOf("\n## ", from + 3); return body.slice(from, next < 0 ? undefined : next); };
async function report(c: OrgContext): Promise<string> {
  const r = await teamReportNow(c, { useAssistant: false });
  if (r.status !== "saved" && r.status !== "existing") throw new Error(`expected a report, got ${JSON.stringify(r)}`);
  return bodyOf(r.docId);
}
const work = (title: string, assignee: OrgContext, dueAt: string | null = null) => createTask(david, {
  projectId: a.projectId, title, expectedOutput: "Done and linked.", assigneeMembershipId: id(assignee), reviewerMembershipId: id(david),
  category: "work", priority: "normal", estimateMinutes: 60, dueAt, addToMyDay: false,
});

beforeAll(async () => {
  await resetTestDatabase();
  a = await buildCompany("a", { names: { owner: "Ada Owner", employee: "Olu Adeyemi", employee2: "Ben Okafor" } });
  ada = a.ownerCtx; david = a.managerCtx; olu = a.employeeCtx; ben = a.employee2Ctx;
  await saveMyAssistant(olu, { name: "Max", colour: "blue", visor: "band", eyes: "round" });
  const sales = await createTeam(ada, "Sales");
  sam = await joinViaInvitation(ada, await createVerifiedUser("sam@company-a.test", "Sam Sales"), "manager", sales.id, "MGR-002");
  await setTeamMember(ada, sales.id, id(sam), { isManager: true });
  sid = await joinViaInvitation(a.hrCtx, await createVerifiedUser("sid@company-a.test", "Sid Seller"), "employee", sales.id, "EMP-010");

  t.homepage = a.taskIds.homepage; t.meeting = a.taskIds.meeting; t.pricing = a.taskIds.second;
  t.brand = (await work("Brand assets", ben)).id;
  t.launch = (await work("Launch checklist", olu, inDays(2))).id;
  t.press = (await work("Press kit", ben, inDays(1))).id;
  // Olu is blocked, waiting on David (his lead); Ben is on the brand assets and sent the pricing copy for review.
  await move(olu, t.homepage, "in_progress");
  await move(olu, t.homepage, "blocked", "Waiting on David for the brand images");
  await move(ben, t.brand, "in_progress");
  submissionId = (await submitTask(ben, t.pricing, { note: "Copy is in the doc.", links: [], fileIds: [] })).submissionId;
  // Ben asks David's assistant to add a to-do, and asks for a time correction on his copy.
  const plan = await planRequest(ben, { to: "David Manager", request: { kind: "add_todo", title: "Pricing review" } });
  if (!plan.ok) throw new Error(`refused: ${plan.error}`);
  requestId = (await sendAssistantItem(ben, { kind: "request", recipientMembershipId: id(david), payload: plan.payload })).id;
  const start = new Date(Date.now() - 40 * 60_000);
  await requestAdjustment(ben, { taskId: t.pricing, localDate: localDate(start, a.ownerCtx.org.timezone), originalIntervalIds: [], proposedIntervals: [{ startedAt: start.toISOString(), endedAt: new Date(Date.now() - 10 * 60_000).toISOString() }], reason: "Forgot the timer" });
});

describe("Decisions for you", () => {
  it("opens David's report with what waits on him, each line linked to its source", async () => {
    const body = await report(david);
    const decisions = section(body, "Decisions for you");
    expect(body.indexOf("## Decisions for you")).toBeLessThan(body.indexOf("## Ben Okafor"));
    expect(body.indexOf("**")).toBeLessThan(body.indexOf("## Decisions for you"));
    expect(decisions).toMatch(new RegExp(`\\n- Review \\[“Pricing page copy”\\]\\(/app/${slug()}/tasks/${t.pricing}\\) from Ben Okafor, sent \\d\\d:\\d\\d\\n`));
    expect(decisions).toContain(`- Ben Okafor asks you to accept: add the to-do “Pricing review” ([item](/app/${slug()}/home/assistants/items/${requestId}))`);
    expect(decisions).toContain(`- Time correction from Ben Okafor on “Pricing page copy” ([time correction](/app/${slug()}/reviews?tab=corrections))`);
    expect(decisions).toContain(`- ${taskLink(t.homepage, "Homepage design")} (Olu Adeyemi) is blocked: Waiting on David for the brand images`);
    expect(decisions).not.toContain("not available");
  });

  it("gives organisation accounts only the reviews naming them, and no time corrections", async () => {
    const built = await buildDailyReport(ada, { useAssistant: false });
    expect(built.decisions.reviews).toEqual([]);
    expect(built.decisions.corrections).toEqual([]);
    // Ada is not named in Olu's reason: nothing blocked on her.
    expect(built.decisions.blocked).toEqual([]);
    const decisions = section(await report(ada), "Decisions for you");
    expect(decisions).toBe("## Decisions for you\n\nNothing is waiting on you.\n");
  });

  it("links every task in the people's sections and what needs attention", async () => {
    const body = await report(david);
    expect(section(body, "Olu Adeyemi")).toContain(`- Blocked: ${taskLink(t.homepage, "Homepage design")} (Waiting on David for the brand images)`);
    expect(section(body, "Ben Okafor")).toContain(`- In progress: ${taskLink(t.brand, "Brand assets")} (0%)`);
    expect(section(body, "Ben Okafor")).toContain(`- Sent for review: ${taskLink(t.pricing, "Pricing page copy")}`);
    expect(section(body, "Needs your attention")).toContain(`- Olu Adeyemi: ${taskLink(t.homepage, "Homepage design")} is blocked (Waiting on David for the brand images)`);
    expect(section(body, "Needs your attention")).toContain(`- 1 task is waiting for your review ([review](/app/${slug()}/reviews?tab=submissions))`);
  });

  it("sends a report whose only content is a decision", async () => {
    // Nothing happened on Sales today; Sid's request to Sam is the only thing, and it is enough.
    const plan = await planRequest(sid, { to: "Sam Sales", request: { kind: "add_todo", title: "Call the client" } });
    if (!plan.ok) throw new Error(`refused: ${plan.error}`);
    const item = await sendAssistantItem(sid, { kind: "request", recipientMembershipId: id(sam), payload: plan.payload });
    const body = await report(sam);
    expect(section(body, "Decisions for you")).toContain(`- Sid Seller asks you to accept: add the to-do “Call the client” ([item](/app/${slug()}/home/assistants/items/${item.id}))`);
  });
});

describe("Changed since yesterday", () => {
  it("says there is nothing to compare with on the first report, and saves the state it was written from", async () => {
    const body = await report(david);
    expect(section(body, "Changed since yesterday")).toBe("## Changed since yesterday\n\nNot available: there is no earlier report to compare with.\n");
    expect(body.indexOf("## Changed since yesterday")).toBeGreaterThan(body.indexOf("## Decisions for you"));
    expect(body.indexOf("## Changed since yesterday")).toBeLessThan(body.indexOf("## Ben Okafor"));
    const [row] = await adminQuery<{ snapshot: unknown }>("SELECT snapshot FROM brenda_report_log WHERE membership_id = $1 AND local_date = $2::date", [id(david), today()]);
    const snap = snapshotOf(row.snapshot);
    expect(snap).toMatchObject({ v: 1, localDate: today(), truncated: false });
    expect(snap!.tasks[t.homepage]).toEqual({ a: id(olu), t: "Homepage design", s: "blocked", due: expect.any(String), late: false, reason: "Waiting on David for the brand images" });
    expect(snap!.tasks[t.pricing]).toMatchObject({ a: id(ben), s: "in_review" });
    expect(Object.keys(snap!.tasks).sort()).toEqual(Object.values(t).sort());
  });

  it("the next day lists each change once and leaves the unchanged out", async () => {
    // The report above becomes yesterday's (its row moves back a day), then the day's work happens.
    await adminQuery("UPDATE brenda_report_log SET local_date = local_date - 1 WHERE membership_id = $1 AND local_date = $2::date", [id(david), today()]);
    await move(ben, t.brand, "blocked", "Waiting on the printer");
    await move(olu, t.homepage, "in_progress");
    await updateTask(david, t.launch, { expectedVersion: await version(t.launch), dueAt: inDays(6) });
    await adminQuery("UPDATE tasks SET due_at = now() - interval '2 hours' WHERE id = $1", [t.press]);
    await reviewSubmission(david, submissionId, { decision: "approved", note: "" });

    const body = await report(david);
    const changed = section(body, "Changed since yesterday");
    expect(changed).toContain(`- **Newly blocked**: ${taskLink(t.brand, "Brand assets")} (Ben Okafor)\n`);
    expect(changed).toContain(`- **Unblocked**: ${taskLink(t.homepage, "Homepage design")} (Olu Adeyemi)\n`);
    expect(changed).toMatch(new RegExp(`- \\*\\*Deadline moved later\\*\\*: \\[“Launch checklist”\\]\\(/app/${slug()}/tasks/${t.launch}\\) \\(Olu Adeyemi, due \\w{3} \\d{1,2} \\w{3} → \\w{3} \\d{1,2} \\w{3}\\)\\n`));
    expect(changed).toMatch(new RegExp(`- \\*\\*Newly late\\*\\*: \\[“Press kit”\\]\\(/app/${slug()}/tasks/${t.press}\\) \\(Ben Okafor, due \\w{3} \\d{1,2} \\w{3}\\)\\n`));
    expect(changed).toContain(`- **Finished**: ${taskLink(t.pricing, "Pricing page copy")} (Ben Okafor)`);
    for (const title of ["Brand assets", "Homepage design", "Launch checklist", "Press kit", "Pricing page copy"]) expect(changed.split(`“${title}”`).length - 1).toBe(1);
    expect(changed).not.toContain("Client kickoff meeting");
    expect(changed).not.toContain("_Some changes may not be listed._");
    // What was decided is no longer waiting: the review is done and Olu is no longer blocked on David.
    const decisions = section(body, "Decisions for you");
    expect(decisions).not.toContain("Review ");
    expect(decisions).not.toContain("is blocked");
    // Today's snapshot replaces nothing of yesterday's: two rows, one each.
    expect(await adminQuery("SELECT local_date FROM brenda_report_log WHERE membership_id = $1 AND snapshot IS NOT NULL", [id(david)])).toHaveLength(2);
  });

  it("asked again the same day, compares with the same earlier report and refreshes today's snapshot", async () => {
    await move(ben, t.brand, "in_progress");
    const changed = section(await report(david), "Changed since yesterday");
    // Blocked and unblocked since the report it compares with: no longer a change.
    expect(changed).not.toContain("Brand assets");
    const [row] = await adminQuery<{ snapshot: unknown }>("SELECT snapshot FROM brenda_report_log WHERE membership_id = $1 AND local_date = $2::date", [id(david), today()]);
    expect(snapshotOf(row.snapshot)!.tasks[t.brand].s).toBe("in_progress");
  });

  it("names the weekday of an older report, and says nothing about one more than a week old", async () => {
    const older = async (days: number) => {
      await adminQuery("UPDATE brenda_report_log SET local_date = $3::date WHERE membership_id = $1 AND local_date < $2::date", [id(david), today(), localDate(new Date(Date.now() - days * 86_400_000), a.ownerCtx.org.timezone)]);
      return (await buildDailyReport(david, { useAssistant: false })).changes;
    };
    const three = await older(3);
    expect(three !== null && three !== "not_available" && three.sinceLabel).toMatch(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/);
    expect(await older(8)).toBe("not_available");
  });
});
