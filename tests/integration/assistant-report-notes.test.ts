/**
 * Notes for the team report (owner decision, 8 October 2026: personal assistants, phase 6). "Tell Brenda to put this in
 * today's team report": after the person's Confirm, the note goes in today's end-of-day report, from them ("From Olu via
 * Max"), in a "Notes from the team" section that only the report's existing audience reads (their team lead, the owner
 * and HR); the person can withdraw it until the report is written; owners and HR can switch notes off; three a day each.
 *
 * Local test database only (TEST_DATABASE_URL, embedded PostgreSQL on localhost). No model.
 *
 * Company A: Ada Owner (owner), Mary HR, David Manager (leads Design: Olu and Ben), Olu Adeyemi (Max), Ben Okafor; and
 * Sam Sales, who leads Sales (Sid). The report is at 23:59 here, so today's notes are still open.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { resetTestDatabase, adminQuery, appQueryAs } from "../helpers/db";
import { buildCompany, createVerifiedUser, joinViaInvitation, type CompanyFixture } from "@/server/services/fixtures";
import { createTeam, setTeamMember } from "@/server/services/orgs";
import { saveMyAssistant } from "@/server/services/assistant-profile";
import { setBrendaSettings } from "@/server/services/brenda";
import { runBrendaTool, confirmAction, type Proposal, type Action } from "@/server/services/copilot";
import { buildDailyReport, reportMarkdown, teamReportNow } from "@/server/services/daily-report";
import {
  getAssistantItem, listAssistantItems, planReportNote, reportNoteSettings, reportNotesFor, saveReportNoteSettings, sendAssistantItem, sweepAssistantItems, withdrawReportNote,
} from "@/server/services/assistant-items";
import { withUser } from "@/server/db";
import { todayLocal } from "@/server/lib/time";
import type { OrgContext } from "@/server/lib/api";

delete process.env.ANTHROPIC_API_KEY;

let a: CompanyFixture;
let ada: OrgContext, mary: OrgContext, david: OrgContext, olu: OrgContext, ben: OrgContext, sam: OrgContext;
const id = (c: OrgContext) => c.membership.id;
const org = () => a.ownerCtx.org.id;
const today = () => todayLocal(a.ownerCtx.org.timezone);
const confirmOf = (proposals: Proposal[]) => proposals.find((p): p is Extract<Proposal, { kind: "confirm" }> => p.kind === "confirm");
const itemIdOf = (x: Action | undefined) => (x as (Action & { assistantItemId?: string }) | undefined)?.assistantItemId ?? "";
const note = (c: OrgContext, body: string) => sendAssistantItem(c, { kind: "report_note", body });
const readers = async (itemId: string) => {
  const out: string[] = [];
  for (const [name, c] of Object.entries({ ada, mary, david, olu, ben, sam })) if (await getAssistantItem(c, itemId)) out.push(name);
  return out.sort();
};
/** A note made by admin with its report's time already passed (the report has been written). */
async function pastNote(from: OrgContext, body: string): Promise<string> {
  const r = await adminQuery<{ id: string }>(
    `INSERT INTO assistant_items(organisation_id, kind, sender_membership_id, recipient_membership_id, body, report_date, expires_at)
     VALUES ($1, 'report_note', $2, NULL, $3, $4::date, now() - interval '1 minute') RETURNING id`, [org(), id(from), body, today()]);
  return r[0].id;
}

beforeAll(async () => {
  await resetTestDatabase();
  a = await buildCompany("a", { names: { owner: "Ada Owner", employee: "Olu Adeyemi", employee2: "Ben Okafor" } });
  ada = a.ownerCtx; mary = a.hrCtx; david = a.managerCtx; olu = a.employeeCtx; ben = a.employee2Ctx;
  await saveMyAssistant(olu, { name: "Max", colour: "blue", visor: "band", eyes: "round" });
  const sales = await createTeam(ada, "Sales");
  sam = await joinViaInvitation(ada, await createVerifiedUser("sam@company-a.test", "Sam Sales"), "manager", sales.id, "MGR-002");
  await setTeamMember(ada, sales.id, id(sam), { isManager: true });
  await joinViaInvitation(mary, await createVerifiedUser("sid@company-a.test", "Sid Seller"), "employee", sales.id, "EMP-010");
  await setBrendaSettings(ada, { dailyReportTime: "23:59", dailyReportEnabled: true });
});

describe("adding a note", () => {
  let itemId = "";

  it("her chat prepares a Confirm with the note and the report's time; the press adds it, from her", async () => {
    const body = "The client moved the deadline to Friday.";
    const r = await runBrendaTool(olu, "add_report_note", { body });
    const c = confirmOf(r.proposals);
    expect(c).toMatchObject({ tool: "add_report_note", summary: "Add this note to today's team report? The people who receive it read it at 23:59, or sooner if they ask for the report early, from you. You can withdraw it until a report with it is written." });
    expect(c?.detail).toBe(body);
    expect(await adminQuery("SELECT 1 FROM assistant_items WHERE kind = 'report_note'")).toEqual([]);
    const done = await confirmAction(olu, c!.token);
    expect(done.error).toBeNull();
    itemId = itemIdOf(done.actions[0]);
    expect(done.actions[0]).toMatchObject({ kind: "assistant_report_note", summary: "Added your note to today's team report" });
    const v = await getAssistantItem(olu, itemId);
    expect(v).toMatchObject({ kind: "report_note", status: "delivered", viewer: "sender", recipient: null, body, badge: { label: "Goes in at 23:59", tone: "neutral" }, canWithdraw: true });
    expect(v!.report).toMatchObject({ date: today(), open: true });
    // Report notes notify nobody.
    expect(await adminQuery("SELECT 1 FROM notifications WHERE resource_id = $1", [itemId])).toEqual([]);
    expect((await listAssistantItems(olu, { box: "sent", kind: "report_note" })).items.map((x) => x.id)).toEqual([itemId]);
  });

  it("only the report's audience reads it: her team lead, the owner and HR; not a peer, not another team's lead", async () => {
    expect(await readers(itemId)).toEqual(["ada", "david", "mary", "olu"]);
    expect(await getAssistantItem(david, itemId)).toMatchObject({ viewer: "reader", canWithdraw: false, canMute: false });
    expect(await appQueryAs(ben.user.profileId, "SELECT id FROM assistant_items WHERE kind = 'report_note'")).toEqual([]);
    expect(await appQueryAs(sam.user.profileId, "SELECT id FROM assistant_items WHERE kind = 'report_note'")).toEqual([]);
    expect((await reportNotesFor(david, today())).map((n) => n.body)).toEqual(["The client moved the deadline to Friday."]);
    expect(await reportNotesFor(david, today())).toEqual([expect.objectContaining({ membershipId: id(olu), name: "Olu Adeyemi", assistantName: "Max" })]);
    expect(await reportNotesFor(sam, today())).toEqual([]);
    expect((await reportNotesFor(ada, today())).length).toBe(1);
  });

  it("the lead's report has a Notes from the team section with it; another lead's does not", async () => {
    // The report as the lead asks for it now (the same build and save as the end-of-day send, read as him).
    const mine = await teamReportNow(david, { useAssistant: false });
    expect(mine.status).toBe("saved");
    const [doc] = await adminQuery<{ body: string }>("SELECT body FROM documents WHERE id = $1", [(mine as { docId: string }).docId]);
    expect(doc.body).toContain("## Notes from the team");
    expect(doc.body).toMatch(/- \*\*Olu Adeyemi\*\* via Max, \d{2}:\d{2}: “The client moved the deadline to Friday\.”/);
    // Sam leads Sales: nothing happened there today and he reads no note, so there is no report for him at all.
    const theirs = await teamReportNow(sam, { useAssistant: false });
    expect(theirs.status).toBe("nothing");
    // The section's Markdown, from the record: other people's words shown as typed, never as markup.
    const built = await buildDailyReport(david, { useAssistant: false });
    const md = reportMarkdown(david, { ...built, notes: await reportNotesFor(david, today()), empty: false }, { writtenAt: new Date(), endOfDay: true, reportTime: "23:59", author: "Brenda", workspaceName: "Brenda" });
    expect(md).toContain("## Notes from the team");
  });

  it("withdrawn before the report: gone from the audience and from the report; the author still sees it", async () => {
    const v = await note(olu, "Ignore this one.");
    expect(await readers(v.id)).toEqual(["ada", "david", "mary", "olu"]);
    await expect(withdrawReportNote(ben, v.id)).rejects.toMatchObject({ status: 404 });
    await expect(withdrawReportNote(david, v.id)).rejects.toMatchObject({ status: 404 });
    const out = await withdrawReportNote(olu, v.id);
    expect(out).toMatchObject({ status: "withdrawn", badge: { label: "Withdrawn" }, canWithdraw: false });
    expect(await readers(v.id)).toEqual(["olu"]);
    expect((await reportNotesFor(david, today())).map((n) => n.body)).not.toContain("Ignore this one.");
    await expect(withdrawReportNote(olu, v.id)).rejects.toMatchObject({ status: 409 });
  });
});

describe("limits and switches", () => {
  it("three a day each, 500 characters each", async () => {
    for (let i = 1; i <= 3; i++) await note(ben, `Ben's note ${i}`);
    expect(await planReportNote(ben, { body: "A fourth" })).toEqual({ ok: false, code: "limit_notes", error: "You've added 3 notes to today's team report. Tell your team lead directly." });
    await expect(note(ben, "A fourth")).rejects.toMatchObject({ status: 409, code: "ASSISTANT_ITEM_LIMIT" });
    expect(await planReportNote(mary, { body: "x".repeat(501) })).toEqual({ ok: false, code: "invalid", error: "Keep the note to 500 characters." });
    expect(await planReportNote(mary, { body: "x".repeat(500) })).toMatchObject({ ok: true, reportTime: "23:59" });
  });

  it("owners and HR switch notes off; then nobody can add one", async () => {
    await expect(saveReportNoteSettings(david, { enabled: false })).rejects.toMatchObject({ status: 403 });
    await expect(saveReportNoteSettings(mary, { enabled: false })).resolves.toEqual({ ready: true, enabled: false });
    expect(await withUser(olu.user.profileId, (db) => reportNoteSettings(db, org()))).toEqual({ ready: true, enabled: false });
    expect(await planReportNote(david, { body: "Hello" })).toEqual({ ok: false, code: "notes_off", error: "Notes for the team report are switched off in this workspace." });
    const logged = await adminQuery<{ summary: string }>("SELECT summary FROM brenda_actions WHERE membership_id = $1 AND tool = 'settings' ORDER BY created_at DESC LIMIT 1", [id(mary)]);
    expect(logged).toEqual([{ summary: "Notes for the team report: off" }]);
    await saveReportNoteSettings(ada, { enabled: true });
  });

  it("no report, no notes; after the report's time, too late", async () => {
    await setBrendaSettings(ada, { dailyReportEnabled: false });
    expect(await planReportNote(david, { body: "Hello" })).toEqual({ ok: false, code: "report_off", error: "The end-of-day team report is off in this workspace, so there's nothing to add a note to." });
    await setBrendaSettings(ada, { dailyReportEnabled: true, dailyReportTime: "00:00" });
    expect(await planReportNote(david, { body: "Hello" })).toEqual({ ok: false, code: "too_late", error: "Today's team report has already been written. Tell your team lead directly." });
    await expect(note(david, "Hello")).rejects.toMatchObject({ status: 409, code: "TOO_LATE" });
    // Nor can a note be forced in as the app (row-level security checks the time too).
    await expect(appQueryAs(david.user.profileId,
      `INSERT INTO assistant_items(organisation_id, kind, sender_membership_id, body, report_date, expires_at) VALUES ($1, 'report_note', $2, 'Forced', $3::date, now() + interval '1 hour')`, [org(), id(david), today()]))
      .rejects.toThrow(/row-level security/);
    await setBrendaSettings(ada, { dailyReportTime: "23:59" });
  });
});

describe("a note nobody would read (review, 8 October 2026)", () => {
  it("is refused when nobody else receives a report that covers the author", async () => {
    // Organisation-wide off: the owner's note has no reader (she leads no team); David's still goes to nobody above him.
    await setBrendaSettings(ada, { dailyReportOrgWide: false });
    try {
      expect(await planReportNote(ada, { body: "Hello" })).toEqual({ ok: false, code: "no_reader", error: "Nobody receives a team report that covers your work, so the note wouldn't be read. Tell the person directly." });
      await expect(note(ada, "Hello")).rejects.toMatchObject({ status: 422, details: { reason: "no_reader" } });
      // Nor forced in as the app (migration 0044: the insert policy asks the same).
      await expect(appQueryAs(ada.user.profileId,
        `INSERT INTO assistant_items(organisation_id, kind, sender_membership_id, body, report_date, expires_at) VALUES ($1, 'report_note', $2, 'Forced', $3::date, app_report_cutoff($1, $3::date))`, [org(), id(ada), today()]))
        .rejects.toThrow(/row-level security/);
      // Olu's lead still reads his.
      expect(await planReportNote(olu, { body: "Hello" })).toMatchObject({ ok: true });
    } finally {
      await setBrendaSettings(ada, { dailyReportOrgWide: true });
    }
  });
});

describe("after the report's time", () => {
  const later = () => new Date(Date.now() + 61 * 60_000); // past the time the reports have to carry it

  it("withdrawing is too late; the report that carries it marks it In the report", async () => {
    const past = await pastNote(olu, "Written before the report.");
    await expect(withdrawReportNote(olu, past)).rejects.toMatchObject({ status: 409, code: "TOO_LATE", message: "Today's report has already been written, so the note stays in it." });
    const r = await teamReportNow(david, { useAssistant: false });
    expect(r.status === "saved" || r.status === "existing").toBe(true);
    expect(await getAssistantItem(olu, past)).toMatchObject({ status: "done", badge: { label: "In the report", tone: "success" }, canWithdraw: false });
    expect(await getAssistantItem(david, past)).toMatchObject({ status: "done" });
  });

  it("a note no report carried is not sent once the reports have had their time (never In the report)", async () => {
    const past = await pastNote(olu, "Nobody wrote a report after this.");
    // Still going in while the reports are being written.
    expect(await getAssistantItem(olu, past)).toMatchObject({ status: "delivered" });
    const swept = await sweepAssistantItems({ now: later() });
    expect(swept.notesSettled).toBeGreaterThanOrEqual(1);
    expect(await getAssistantItem(olu, past)).toMatchObject({ status: "expired", badge: { label: "Not sent" } });
  });

  it("with notes switched off by then, the note is not sent", async () => {
    const past = await pastNote(olu, "Late thought.");
    await saveReportNoteSettings(ada, { enabled: false });
    await sweepAssistantItems({ now: later() });
    expect(await getAssistantItem(olu, past)).toMatchObject({ status: "expired", badge: { label: "Not sent" } });
    expect(await getAssistantItem(david, past)).toBeNull();
    await saveReportNoteSettings(ada, { enabled: true });
  });
});
