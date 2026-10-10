/**
 * Async standup, option B (owner decisions, 8–9 October 2026: phase 7c). A team lead (or the owner, or HR) switches
 * standup on per team; at its time each member's own assistant drafts their update from their own work; the person
 * edits, posts (always their own press: their approved words as theirs, sent by their assistant) or skips the day; at
 * the cutoff the lead gets one rollup (who posted, the blockers they named, who has no update, neutrally); quiet hours
 * hold the notices; a late post is noted; the day closes; a lost or killed job is finished by the sweep.
 *
 * Company A (company-a, Africa/Lagos): Grace Owner, Mary HR (also on Design), David Lead (leads Design: Ada Obi, Ben
 * Okafor, Olu Ade, whose assistant is Max, Femi Ojo, and Sam Lee, who switched standup off for himself), Kemi Sales
 * (leads Sales and Research), Tunde Ops and Ada on Ops (no lead: Grace switched it on), Ife Research on Research.
 * Company B (Europe/London) for the clock change. Drafts through the brain's composeStandup with the template (no
 * model). Local test database only (TEST_DATABASE_URL on localhost).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { resetTestDatabase, adminQuery } from "../helpers/db";
import { buildCompany, createVerifiedUser, joinViaInvitation, type CompanyFixture } from "@/server/services/fixtures";
import { createTeam, setTeamMember } from "@/server/services/orgs";
import { completeTask, createTask, quickTodo, updateTask } from "@/server/services/tasks";
import { startSession, stopSession } from "@/server/services/sessions";
import { setBlock } from "@/server/services/task-blocks";
import { saveMyAssistant } from "@/server/services/assistant-profile";
import { saveQuietHours } from "@/server/services/routines";
import { savePersonalAbility, saveWorkspaceAbility } from "@/server/services/abilities";
import { openChannel } from "@/server/services/messaging";
import { localDate, localParts, addDays, weekdayOf } from "@/server/lib/time";
import { withUser } from "@/server/db";
import * as S from "@/server/services/standup";
import { composeRollup, composeStandup } from "@/server/services/standup-compose";
import { handlers } from "../../worker/handlers";
import { claimKilledJobs } from "../../worker/schedule";
import { STANDUP_WORDS, standupPostBody } from "@/lib/standup";
import type { OrgContext } from "@/server/lib/api";

delete process.env.ANTHROPIC_API_KEY;

const LAGOS = "Africa/Lagos";
let a: CompanyFixture;
let owner: OrgContext, mary: OrgContext, david: OrgContext, ada: OrgContext, ben: OrgContext, olu: OrgContext, femi: OrgContext, sam: OrgContext;
let kemi: OrgContext, tunde: OrgContext, ife: OrgContext;
let design: string, sales: string, ops: string, research: string;
let designChannel: string;
let today: string;
let davidTask: string, adaTodo: string;
const entry: Record<string, string> = {};
let designRollup: string;

const id = (c: OrgContext) => c.membership.id;
const pad = (n: number) => String(n).padStart(2, "0");
const hm = (d: Date) => { const p = localParts(d, LAGOS); return `${pad(p.hour)}:${pad(p.minute)}`; };
const impersonated = (c: OrgContext): OrgContext => ({ ...c, user: { ...c.user, impersonation: { id: "x", adminEmail: "admin@boredroom.test" } } });
const count = async (table: string, where = "true", params: unknown[] = []) => (await adminQuery<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`, params))[0].n;
const notifications = (membershipId: string, type: string) => adminQuery<{ title: string; body: string | null; href: string | null; resource_id: string | null; read_at: string | null }>(
  "SELECT title, body, href, resource_id, read_at FROM notifications WHERE recipient_membership_id = $1 AND type = $2 ORDER BY created_at, id", [membershipId, type]);
const entryOf = async (teamId: string, c: OrgContext, date = today) =>
  (await adminQuery<{ id: string; status: string; reason: string | null; notify_at: string | null; notified_at: string | null }>(
    "SELECT id, status, reason, notify_at, notified_at FROM standup_entries WHERE team_id = $1 AND membership_id = $2 AND local_date = $3", [teamId, id(c), date]))[0];
const allDays = [0, 1, 2, 3, 4, 5, 6];

/** One draft as the worker does it: claimed, composed with the template, saved (or the claim's skip). */
async function draft(entryId: string, now = new Date()): Promise<string> {
  const c = await S.claimStandupDraft(entryId, now);
  if ("skip" in c) return c.skip;
  const composed = await composeStandup(c, { model: null });
  return (await S.saveStandupDraft(entryId, composed, now)).delivery;
}
async function quietNow(c: OrgContext) {
  const now = Date.now();
  await saveQuietHours(c, { enabled: true, start: hm(new Date(now - 3_600_000)), end: hm(new Date(now + 3_600_000)), days: allDays });
}
async function blockedTask(c: OrgContext, taskId: string, reason: string) {
  let [r] = await adminQuery<{ status: string; version: number }>("SELECT status, version FROM tasks WHERE id = $1", [taskId]);
  if (r.status !== "in_progress") { await updateTask(c, taskId, { expectedVersion: r.version, status: "in_progress" }); [r] = await adminQuery("SELECT status, version FROM tasks WHERE id = $1", [taskId]); }
  await updateTask(c, taskId, { expectedVersion: r.version, status: "blocked", reason });
}

beforeAll(async () => {
  await resetTestDatabase();
  a = await buildCompany("a", { names: { owner: "Grace Owner", hr: "Mary HR", manager: "David Lead", employee: "Ada Obi", employee2: "Ben Okafor" } });
  owner = a.ownerCtx; mary = a.hrCtx; david = a.managerCtx; ada = a.employeeCtx; ben = a.employee2Ctx;
  design = a.teamId;
  const join = async (email: string, name: string, role: "employee" | "manager", team: string | null, code: string) =>
    joinViaInvitation(mary, await createVerifiedUser(email, name), role, team, code);
  olu = await join("olu@company-a.test", "Olu Ade", "employee", design, "EMP-003");
  femi = await join("femi@company-a.test", "Femi Ojo", "employee", design, "EMP-004");
  sam = await join("sam@company-a.test", "Sam Lee", "employee", design, "EMP-005");
  sales = (await createTeam(owner, "Sales")).id;
  ops = (await createTeam(owner, "Ops")).id;
  research = (await createTeam(owner, "Research")).id;
  kemi = await join("kemi@company-a.test", "Kemi Sales", "manager", sales, "MGR-002");
  await setTeamMember(owner, sales, id(kemi), { isManager: true });
  await setTeamMember(owner, research, id(kemi), { isManager: true });
  tunde = await join("tunde@company-a.test", "Tunde Ops", "employee", ops, "EMP-006");
  await setTeamMember(owner, ops, id(ada), { isManager: false });
  ife = await join("ife@company-a.test", "Ife Research", "employee", research, "EMP-007");
  await setTeamMember(owner, design, id(mary), { isManager: false });
  await saveMyAssistant(olu, { name: "Max", colour: "blue", visor: "band", eyes: "round" });
  await savePersonalAbility(sam, { key: "standup", on: false });
  designChannel = await openChannel(david, design);
  today = localDate(new Date(), LAGOS);
  // A draft only carries work every reader of #Design can already see (fix review, 9 October 2026): the fixture's
  // "Website relaunch" is not Design's working project, so the members who joined since are put on it.
  for (const c of [olu, femi, sam]) {
    await adminQuery("INSERT INTO project_members(organisation_id, project_id, membership_id, access_role) VALUES ($1, $2, $3, 'contributor') ON CONFLICT DO NOTHING",
      [owner.org.id, a.projectId, id(c)]);
  }

  // Ada's work: a finished meeting, time on the homepage, then blocked on Ben; and a private to-do of her own.
  let [m] = await adminQuery<{ version: number }>("SELECT version FROM tasks WHERE id = $1", [a.taskIds.meeting]);
  await updateTask(ada, a.taskIds.meeting, { expectedVersion: m.version, status: "in_progress" });
  await completeTask(ada, a.taskIds.meeting, { note: "Notes shared" });
  const s = await startSession(ada, { taskId: a.taskIds.homepage });
  await stopSession(ada, s.id, { expectedVersion: s.version, note: "", outcome: "continue_later" });
  await adminQuery("ALTER TABLE session_intervals DISABLE TRIGGER session_intervals_immutable");
  await adminQuery("UPDATE session_intervals SET started_at = ended_at - interval '90 minutes' WHERE session_id = $1", [s.id]);
  await adminQuery("ALTER TABLE session_intervals ENABLE TRIGGER session_intervals_immutable");
  await blockedTask(ada, a.taskIds.homepage, "Waiting for the logos");
  await setBlock(ada, a.taskIds.homepage, { waitingOn: id(ben), question: "Can you send the logo SVGs?" });
  // Her own to-do in her personal project (one in her team's working project counts as work, contract B.3).
  const personal = await withUser(ada.user.profileId, (db) => db.one<{ id: string }>(`SELECT app_create_personal_project($1, $2, $3) AS id`, [ada.org.id, id(ada), "Ada Obi's to-dos"]));
  adaTodo = (await quickTodo(ada, { title: "Buy birthday cake", projectId: personal.id })).id;
  [m] = await adminQuery<{ version: number }>("SELECT version FROM tasks WHERE id = $1", [adaTodo]);
  await updateTask(ada, adaTodo, { expectedVersion: m.version, status: "in_progress" });
  // Ben's own work (never in Ada's draft) and David's, blocked.
  [m] = await adminQuery<{ version: number }>("SELECT version FROM tasks WHERE id = $1", [a.taskIds.second]);
  await updateTask(ben, a.taskIds.second, { expectedVersion: m.version, status: "in_progress" });
  davidTask = (await createTask(owner, { projectId: a.projectId, title: "Brand guidelines", expectedOutput: "A PDF of the guidelines.", assigneeMembershipId: id(david), reviewerMembershipId: null, category: "work", priority: "normal", estimateMinutes: 60, dueAt: null, addToMyDay: false })).id;
  await blockedTask(david, davidTask, "Waiting for brand fonts");
});

describe("a team's standup settings", () => {
  it("off by default, every member reads them, with who receives the rollup", async () => {
    const v = await S.standupSettings(ada, design);
    expect(v).toMatchObject({ ready: true, teamId: design, teamName: "Design", enabled: false, time: "09:30", cutoff: "12:00", days: [1, 2, 3, 4, 5], timeZone: LAGOS, canEdit: false, offered: true, leads: ["David Lead"], noLead: false });
    expect((await S.standupSettings(david, design)).canEdit).toBe(true);
  });

  it("the lead, the owner and HR change them; staff and another team's lead cannot", async () => {
    expect(await S.saveStandupSettings(david, design, { time: "08:30" })).toMatchObject({ time: "08:30", enabled: false });
    expect(await S.saveStandupSettings(owner, design, { cutoff: "11:30" })).toMatchObject({ time: "08:30", cutoff: "11:30" });
    expect(await S.saveStandupSettings(mary, design, { days: [1, 3, 5] })).toMatchObject({ days: [1, 3, 5] });
    await expect(S.saveStandupSettings(ada, design, { enabled: true })).rejects.toMatchObject({ status: 403, message: STANDUP_WORDS.errors.forbidden });
    await expect(S.saveStandupSettings(kemi, design, { enabled: true })).rejects.toMatchObject({ status: 403 });
    await expect(S.saveStandupSettings(impersonated(david), design, { enabled: true })).rejects.toMatchObject({ status: 403 });
    expect(await count("audit_events", "action = 'standup.settings_changed'")).toBe(3);
  });

  it("checks the times and the days", async () => {
    await expect(S.saveStandupSettings(david, design, { time: "11:10", cutoff: "11:30" })).rejects.toMatchObject({ status: 400, message: STANDUP_WORDS.errors.gap });
    await expect(S.saveStandupSettings(david, design, { time: "9:30" })).rejects.toMatchObject({ status: 400 });
    await expect(S.saveStandupSettings(david, design, { days: [] })).rejects.toMatchObject({ status: 400 });
    await expect(S.saveStandupSettings(david, design, { days: [7] })).rejects.toMatchObject({ status: 400 });
    await expect(S.saveStandupSettings(david, "11111111-1111-4111-8111-111111111111", { enabled: true })).rejects.toMatchObject({ status: 404 });
  });

  it("switching one on while the workspace does not offer standup: 409 STANDUP_NOT_OFFERED; recorded who switched it on", async () => {
    await saveWorkspaceAbility(owner, { key: "standup", offered: false });
    await expect(S.saveStandupSettings(kemi, sales, { enabled: true })).rejects.toMatchObject({ status: 409, code: "STANDUP_NOT_OFFERED", message: STANDUP_WORDS.errors.notOffered });
    expect((await S.standupSettings(kemi, sales)).offered).toBe(false);
    await saveWorkspaceAbility(owner, { key: "standup", offered: true });
    const tomorrow = (weekdayOf(today) + 1) % 7;
    expect(await S.saveStandupSettings(kemi, sales, { enabled: true, days: [tomorrow] })).toMatchObject({ enabled: true, days: [tomorrow] });
    expect(await adminQuery("SELECT enabled_by FROM team_standups WHERE team_id = $1", [sales])).toEqual([{ enabled_by: id(kemi) }]);
    // A team with no lead: the rollup goes to whoever switched it on while they are the owner or HR.
    expect(await S.saveStandupSettings(owner, ops, { enabled: true, time: "00:00", cutoff: "23:59", days: allDays })).toMatchObject({ enabled: true, leads: ["Grace Owner"], noLead: false });
    // Design: all day, every day, for the rest of this file.
    expect(await S.saveStandupSettings(david, design, { enabled: true, time: "00:00", cutoff: "23:59", days: allDays })).toMatchObject({ enabled: true });
  });
});

describe("the day opens", () => {
  it("a standup.open killed by the old worker is reclaimed and runs: one draft per member, never owners, HR or anyone who switched it off", async () => {
    const [job] = await adminQuery<{ id: string }>(
      "INSERT INTO jobs(type, payload, state, attempts, last_error, finished_at) VALUES ('standup.open', $1, 'dead', 1, 'no handler for job type standup.open', now()) RETURNING id",
      [JSON.stringify({ teamId: design, localDate: today })]);
    const got = await claimKilledJobs("test-worker:7c", Object.keys(handlers));
    const mine = got.find((j) => j.id === job.id);
    expect(mine).toMatchObject({ type: "standup.open", attempts: 2 });
    await handlers[mine!.type](mine!.payload as Record<string, unknown>, { jobId: mine!.id, attempt: mine!.attempts });
    const rows = await adminQuery<{ membership_id: string; status: string }>("SELECT membership_id, status FROM standup_entries WHERE team_id = $1 AND local_date = $2", [design, today]);
    expect(rows.map((r) => r.membership_id).sort()).toEqual([id(ada), id(ben), id(olu), id(david), id(femi)].sort());
    expect(rows.every((r) => r.status === "drafting")).toBe(true);
    for (const [k, c] of Object.entries({ ada, ben, olu, david, femi })) entry[k] = (await entryOf(design, c)).id;
    designRollup = (await adminQuery<{ id: string }>("SELECT id FROM standup_rollups WHERE team_id = $1 AND local_date = $2", [design, today]))[0].id;
  });

  it("twice: exists, one row each", async () => {
    const again = await S.openStandupDay(design, today, new Date());
    expect(again).toMatchObject({ status: "exists", rollupId: designRollup });
    expect(await count("standup_entries", "team_id = $1 AND local_date = $2", [design, today])).toBe(5);
    expect(await count("standup_rollups", "team_id = $1", [design])).toBe(1);
  });

  it("past the cutoff the day is recorded as missed and never drafted; a day that is not one of its days is off", async () => {
    const yesterday = addDays(today, -1);
    expect(await S.openStandupDay(design, yesterday, new Date())).toMatchObject({ status: "missed", entryIds: [] });
    expect(await adminQuery("SELECT status, reason FROM standup_rollups WHERE team_id = $1 AND local_date = $2", [design, yesterday])).toEqual([{ status: "skipped", reason: "missed" }]);
    expect(await count("standup_entries", "local_date = $1", [yesterday])).toBe(0);
    expect(await S.openStandupDay(sales, today, new Date())).toEqual({ status: "off", entryIds: [], rollupId: null });
    expect(await count("standup_rollups", "team_id = $1", [sales])).toBe(0);
  });
});

describe("drafting", () => {
  it("the facts are the person's own: Ada's finished work, time and blocker, never her private to-do or Ben's work", async () => {
    expect(await draft(entry.ada)).toBe("notified");
    const v = (await S.getStandupEntry(ada, entry.ada))!;
    expect(v).toMatchObject({ status: "ready", engine: "template", edited: false, team: { name: "Design" }, postTo: { name: "#Design", conversationId: designChannel } });
    const all = `${v.texts!.yesterday}\n${v.texts!.today}\n${v.texts!.blocked}`;
    expect(v.texts!.yesterday).toContain("Client kickoff meeting");
    expect(v.texts!.yesterday).toMatch(/Logged 1h 30m/);
    expect(v.texts!.blocked).toContain("Homepage design");
    expect(v.texts!.blocked).toContain("waiting on Ben Okafor");
    expect(all).not.toContain("Buy birthday cake");
    expect(all).not.toContain("Pricing page copy");
    expect(v.draft!.sections.yesterday.flatMap((l) => l.refs).some((r) => r.kind === "task" && r.id === a.taskIds.meeting)).toBe(true);
    expect(await adminQuery("SELECT blockers FROM standup_entries WHERE id = $1", [entry.ada])).toEqual([{ blockers: [expect.objectContaining({ taskId: a.taskIds.homepage, onMembershipId: id(ben), onName: "Ben Okafor" })] }]);
    // Her notice, once.
    const n = await notifications(id(ada), "brenda.standup");
    expect(n).toEqual([expect.objectContaining({ title: "Your standup for Design is ready", resource_id: entry.ada, href: `/app/company-a/home/standup?e=${entry.ada}` })]);
    expect(await draft(entry.ada)).toBe("done");
    expect(await notifications(id(ada), "brenda.standup")).toHaveLength(1);
  });

  it("a live lease is busy; three failed attempts end failed and the person is told once", async () => {
    const c = await S.claimStandupDraft(entry.femi, new Date());
    expect("skip" in c).toBe(false);
    expect(await S.claimStandupDraft(entry.femi, new Date())).toEqual({ skip: "busy" });
    await S.failStandupDraft(entry.femi, "facts_unreadable", "boom");
    expect(await entryOf(design, femi)).toMatchObject({ status: "drafting" });
    for (let i = 0; i < 2; i++) {
      expect("skip" in (await S.claimStandupDraft(entry.femi, new Date()))).toBe(false);
      await S.failStandupDraft(entry.femi, "facts_unreadable", "boom");
    }
    expect(await entryOf(design, femi)).toMatchObject({ status: "failed", reason: "facts_unreadable" });
    expect(await notifications(id(femi), "brenda.standup_failed")).toEqual([expect.objectContaining({ title: "Your standup for Design couldn't be drafted" })]);
    expect(await S.claimStandupDraft(entry.femi, new Date())).toEqual({ skip: "done" });
  });

  it("quiet hours hold the notice; the sweep keeps it while still quiet and releases it after", async () => {
    await quietNow(ben);
    expect(await draft(entry.ben)).toBe("held");
    expect(await notifications(id(ben), "brenda.standup")).toEqual([]);
    expect((await entryOf(design, ben)).notified_at).toBeNull();
    // Due by its time, still quiet: moved to the end of the quiet hours again.
    await adminQuery("UPDATE standup_entries SET notify_at = now() - interval '1 minute' WHERE id = $1", [entry.ben]);
    await S.sweepStandups(new Date());
    expect(await notifications(id(ben), "brenda.standup")).toEqual([]);
    expect(Date.parse((await entryOf(design, ben)).notify_at!)).toBeGreaterThan(Date.now());
    await saveQuietHours(ben, { enabled: false });
    await adminQuery("UPDATE standup_entries SET notify_at = now() - interval '1 minute' WHERE id = $1", [entry.ben]);
    expect((await S.sweepStandups(new Date())).released).toBeGreaterThanOrEqual(1);
    expect(await notifications(id(ben), "brenda.standup")).toHaveLength(1);
    // Olu and David drafted as usual.
    expect(await draft(entry.olu)).toBe("notified");
    expect(await draft(entry.david)).toBe("notified");
  });
});

describe("the person's steps", () => {
  it("edit: ok, too long, all empty; their words lose the drafted links", async () => {
    const v = await S.editStandup(ada, entry.ada, { today: "- Finish the hero images\r\n\n\n\n- Review the copy\t " });
    expect(v).toMatchObject({ edited: true, texts: { today: "- Finish the hero images\n\n- Review the copy" } });
    await expect(S.editStandup(ada, entry.ada, { today: "x".repeat(1201) })).rejects.toMatchObject({ status: 400, message: STANDUP_WORDS.errors.tooLong });
    await expect(S.editStandup(ada, entry.ada, { yesterday: "", today: " ", blocked: "" })).rejects.toMatchObject({ status: 400, message: STANDUP_WORDS.errors.empty });
    await expect(S.editStandup(ben, entry.ada, { today: "Mine now" })).rejects.toMatchObject({ status: 404 });
    await expect(S.editStandup(impersonated(ada), entry.ada, { today: "x" })).rejects.toMatchObject({ status: 403, message: STANDUP_WORDS.errors.onlyPerson("Ada") });
    // David edits his blocker away before posting.
    expect(await S.editStandup(david, entry.david, { blocked: "- Nothing" })).toMatchObject({ texts: { blocked: "- Nothing" } });
  });

  it("post: one via_assistant message in #Design with the approved words, the log, and never twice", async () => {
    await expect(S.postStandup(impersonated(ada), entry.ada)).rejects.toMatchObject({ status: 403 });
    await expect(S.postStandup(ben, entry.ada)).rejects.toMatchObject({ status: 404 });
    const before = (await S.getStandupEntry(ada, entry.ada))!;
    const r = await S.postStandup(ada, entry.ada);
    expect(r.already).toBeUndefined();
    expect(r.entry).toMatchObject({ status: "posted", posted: { late: false, messageId: r.message.id } });
    expect(r.message).toMatchObject({ conversationId: designChannel, href: `/app/company-a/messages?c=${designChannel}#m-${r.message.id}` });
    const msgs = await adminQuery<{ id: string; body: string; author_kind: string; sender_membership_id: string }>(
      "SELECT id, body, author_kind, sender_membership_id FROM messages WHERE conversation_id = $1", [designChannel]);
    expect(msgs).toEqual([{ id: r.message.id, body: standupPostBody({ dateLabel: before.dateLabel, sinceLabel: before.sinceLabel, texts: before.texts! }), author_kind: "via_assistant", sender_membership_id: id(ada) }]);
    expect(msgs[0].body.startsWith(`Standup, ${before.dateLabel}\n`)).toBe(true);
    expect(await adminQuery("SELECT tool, outcome, source FROM brenda_actions WHERE membership_id = $1 AND tool = 'standup_post'", [id(ada)])).toEqual([{ tool: "standup_post", outcome: "done", source: "confirm" }]);
    expect(await count("audit_events", "action = 'standup.posted' AND subject_id = $1", [entry.ada])).toBe(1);
    // A second press reads the first post.
    const again = await S.postStandup(ada, entry.ada);
    expect(again).toMatchObject({ already: true, message: { id: r.message.id } });
    expect(await count("messages", "conversation_id = $1", [designChannel])).toBe(1);
    await expect(S.editStandup(ada, entry.ada, { today: "Too late" })).rejects.toMatchObject({ status: 409, code: "STANDUP_CLOSED" });
    // Two presses at once: one message.
    const both = await Promise.all([S.postStandup(david, entry.david), S.postStandup(david, entry.david)]);
    expect(both.filter((x) => x.already)).toHaveLength(1);
    expect(await count("messages", "conversation_id = $1 AND sender_membership_id = $2", [designChannel, id(david)])).toBe(1);
  });

  it("skip, undo before the cutoff, skip again", async () => {
    expect(await S.skipStandup(ben, entry.ben)).toMatchObject({ status: "skipped", canUnskip: true });
    expect(await S.skipStandup(ben, entry.ben)).toMatchObject({ status: "skipped" });
    expect(await S.unskipStandup(ben, entry.ben)).toMatchObject({ status: "ready" });
    expect(await S.skipStandup(ben, entry.ben)).toMatchObject({ status: "skipped" });
    await expect(S.skipStandup(ada, entry.ada)).rejects.toMatchObject({ status: 409, code: "STANDUP_CLOSED" });
    await expect(S.unskipStandup(olu, entry.olu)).rejects.toMatchObject({ status: 409, code: "STANDUP_CLOSED" });
  });

  it("seen: marks the person's own; anyone else's reads not found", async () => {
    expect(await S.markStandupSeen(olu, entry.olu)).toEqual({ ok: true });
    expect((await S.getStandupEntry(olu, entry.olu))!.seen).toBe(true);
    await expect(S.markStandupSeen(ada, entry.olu)).rejects.toMatchObject({ status: 404 });
  });

  it("standupToday: the person's entries in every team, nobody else's", async () => {
    const t = await S.standupToday(olu);
    expect(t).toMatchObject({ ready: true, off: false });
    expect(t.entries.map((e) => e.id)).toEqual([entry.olu]);
    expect(t.entries[0]).toMatchObject({ leads: ["David Lead"], postTo: { name: "#Design", members: expect.any(Number) }, timeZone: LAGOS });
    expect((await S.standupToday(sam)).off).toBe(true);
  });
});

describe("Ops: no lead, leaving the team, an archived channel, switching it off", () => {
  let adaOps: string, tundeOps: string, opsRollup: string;
  it("opens and drafts; the rollup would go to the owner who switched it on", async () => {
    // (The sweep in the quiet-hours test may have opened it already: it opens any day due.)
    const r = await S.openStandupDay(ops, today, new Date());
    expect(["opened", "exists"]).toContain(r.status);
    opsRollup = r.rollupId!;
    adaOps = (await entryOf(ops, ada)).id;
    tundeOps = (await entryOf(ops, tunde)).id;
    for (const e of [adaOps, tundeOps]) expect(await draft(e)).toBe("notified");
    expect((await S.standupToday(ada)).entries.map((e) => e.team.name).sort()).toEqual(["Design", "Ops"]);
    expect((await S.getStandupEntry(ada, adaOps))!.leads).toEqual(["Grace Owner"]);
    // Someone who joins later that day gets no draft, however often the day is opened again.
    const lola = await joinViaInvitation(mary, await createVerifiedUser("lola@company-a.test", "Lola Late"), "employee", ops, "EMP-008");
    expect((await S.openStandupDay(ops, today, new Date())).status).toBe("exists");
    expect(await entryOf(ops, lola)).toBeUndefined();
  });

  it("left the team: 409 STANDUP_NOT_IN_TEAM", async () => {
    await setTeamMember(owner, ops, id(tunde), { isManager: false, remove: true });
    await expect(S.postStandup(tunde, tundeOps)).rejects.toMatchObject({ status: 409, code: "STANDUP_NOT_IN_TEAM", message: "You're no longer in Ops." });
  });

  it("an archived channel: 409 CONVERSATION_ARCHIVED, nothing posted", async () => {
    const conv = await openChannel(ada, ops);
    await adminQuery("UPDATE conversations SET archived_at = now() WHERE id = $1", [conv]);
    await expect(S.postStandup(ada, adaOps)).rejects.toMatchObject({ status: 409, code: "CONVERSATION_ARCHIVED" });
    expect(await count("messages", "conversation_id = $1", [conv])).toBe(0);
    expect((await entryOf(ops, ada)).status).toBe("ready");
    await adminQuery("UPDATE conversations SET archived_at = NULL WHERE id = $1", [conv]);
  });

  it("the team switched off: 409 STANDUP_OFF; through its switch, today's drafts cancelled and the rollup skipped", async () => {
    await adminQuery("UPDATE team_standups SET enabled = false WHERE team_id = $1", [ops]);
    await expect(S.postStandup(ada, adaOps)).rejects.toMatchObject({ status: 409, code: "STANDUP_OFF" });
    await adminQuery("UPDATE team_standups SET enabled = true WHERE team_id = $1", [ops]);
    await S.saveStandupSettings(owner, ops, { enabled: false });
    expect(await entryOf(ops, ada)).toMatchObject({ status: "cancelled", reason: "off" });
    expect(await adminQuery("SELECT status, reason FROM standup_rollups WHERE id = $1", [opsRollup])).toEqual([{ status: "skipped", reason: "off" }]);
    await expect(S.postStandup(ada, adaOps)).rejects.toMatchObject({ status: 409, code: "STANDUP_CLOSED" });
  });

  it("the workspace no longer offering standup: 409 STANDUP_OFF for a post and an edit", async () => {
    // As the switch reads (its own PATCH, which also ends today's days at once, is the abilities suite's).
    await adminQuery("UPDATE brenda_settings SET abilities_off = '{standup}' WHERE organisation_id = $1", [owner.org.id]);
    await expect(S.postStandup(olu, entry.olu)).rejects.toMatchObject({ status: 409, code: "STANDUP_OFF" });
    await expect(S.editStandup(olu, entry.olu, { today: "x" })).rejects.toMatchObject({ status: 409, code: "STANDUP_OFF" });
    await adminQuery("UPDATE brenda_settings SET abilities_off = '{}' WHERE organisation_id = $1", [owner.org.id]);
  });
});

describe("the cutoff and the rollup", () => {
  it("undo after the cutoff: 409 STANDUP_TOO_LATE", async () => {
    // The cutoff, brought to now.
    await adminQuery("UPDATE standup_rollups SET cutoff_at = clock_timestamp() WHERE id = $1", [designRollup]);
    await expect(S.unskipStandup(ben, entry.ben)).rejects.toMatchObject({ status: 409, code: "STANDUP_TOO_LATE", message: "The rollup has gone; you can still write in #Design." });
  });

  it("at the cutoff: who posted with links, blockers only from posted words, everyone else under No update the same way, to the lead only, held for his quiet hours", async () => {
    await quietNow(david);
    const input = await S.rollupInput(designRollup, new Date());
    if ("skip" in input) throw new Error(`skipped: ${input.skip}`);
    expect(input.recipients).toEqual([id(david)]);
    expect(input.members.map((m) => m.name)).toEqual(["Ada Obi", "Ben Okafor", "David Lead", "Femi Ojo", "Olu Ade", "Sam Lee"]);
    const content = composeRollup(input);
    expect(await S.sendRollup(designRollup, content, new Date())).toEqual({ notified: 0, held: 1 });
    const [row] = await adminQuery<{ status: string; content: import("@/lib/standup").StandupRollupContent }>("SELECT status, content FROM standup_rollups WHERE id = $1", [designRollup]);
    expect(row.status).toBe("sent");
    expect(row.content.counts).toEqual({ members: 6, posted: 2 });
    expect(row.content.posted.map((p) => p.name)).toEqual(["Ada Obi", "David Lead"]);
    expect(row.content.posted.every((p) => p.messageId && p.conversationId === designChannel)).toBe(true);
    expect(row.content.blockers).toEqual([expect.objectContaining({ membershipId: id(ada), name: "Ada Obi", onName: "Ben Okafor", taskId: a.taskIds.homepage })]);
    expect(row.content.noUpdate).toEqual([
      { membershipId: id(ben), name: "Ben Okafor" }, { membershipId: id(femi), name: "Femi Ojo" },
      { membershipId: id(olu), name: "Olu Ade" }, { membershipId: id(sam), name: "Sam Lee" },
    ]);
    expect(row.content.timeZone).toBe(LAGOS);
    expect(await adminQuery("SELECT membership_id, notified_at FROM standup_rollup_recipients WHERE rollup_id = $1", [designRollup])).toEqual([{ membership_id: id(david), notified_at: null }]);
    expect(await notifications(id(david), "brenda.standup_rollup")).toEqual([]);
    // Nobody else reads it; David does.
    await expect(S.getStandupRollup(ada, designRollup)).rejects.toMatchObject({ status: 404 });
    expect(await S.getStandupRollup(david, designRollup)).toMatchObject({ status: "sent", team: { name: "Design" }, seen: false });
    // A second send does nothing.
    expect(await S.sendRollup(designRollup, content, new Date())).toEqual({ notified: 0, held: 0 });
  });

  it("released after his quiet hours, once", async () => {
    await saveQuietHours(david, { enabled: false });
    await adminQuery("UPDATE standup_rollup_recipients SET notify_at = now() - interval '1 minute' WHERE rollup_id = $1", [designRollup]);
    await S.sweepStandups(new Date());
    const n = await notifications(id(david), "brenda.standup_rollup");
    expect(n).toEqual([expect.objectContaining({ title: "Design standup: 2 of 6 posted", resource_id: designRollup, href: `/app/company-a/home/standup?r=${designRollup}` })]);
    expect(n[0].body).toContain("Blocked: Ada on Ben (homepage design).");
    expect(n[0].body).toContain("No update: Ben, Femi, Olu, Sam.");
    expect(await S.markRollupSeen(david, designRollup)).toEqual({ ok: true });
    expect((await S.standupToday(david)).rollups[0]).toMatchObject({ id: designRollup, seen: true });
  });

  it("a late post is noted in the rollup, with no second notification", async () => {
    const r = await S.postStandup(olu, entry.olu);
    expect(r.entry.posted).toMatchObject({ late: true });
    expect((await S.sweepStandups(new Date())).lateNoted).toBe(1);
    const [row] = await adminQuery<{ content: import("@/lib/standup").StandupRollupContent }>("SELECT content FROM standup_rollups WHERE id = $1", [designRollup]);
    expect(row.content.late).toEqual([expect.objectContaining({ membershipId: id(olu), name: "Olu Ade", messageId: r.message.id })]);
    expect(await notifications(id(david), "brenda.standup_rollup")).toHaveLength(1);
    // Olu's message says it was sent by her assistant, as hers.
    expect(await adminQuery("SELECT author_kind, sender_membership_id FROM messages WHERE id = $1", [r.message.id])).toEqual([{ author_kind: "via_assistant", sender_membership_id: id(olu) }]);
  });

  it("the day ends: what was still open is missed", async () => {
    await adminQuery("UPDATE team_standups SET enabled = false WHERE team_id IN ($1, $2)", [design, ops]);
    const r = await S.sweepStandups(new Date(Date.now() + 26 * 3_600_000));
    expect(r.missed).toBeGreaterThanOrEqual(1);
    expect(await entryOf(design, femi)).toMatchObject({ status: "missed" });
    expect((await entryOf(design, ben)).status).toBe("skipped");
    expect((await entryOf(design, ada)).status).toBe("posted");
  });
});

describe("the sweep alone, and the clock change", () => {
  it("with every job gone, the sweep opens the day, drafts it and, at the cutoff, sends the rollup", async () => {
    await S.saveStandupSettings(kemi, research, { enabled: true, time: "00:00", cutoff: "23:59", days: allDays });
    await adminQuery("DELETE FROM jobs WHERE type LIKE 'standup.%'");
    expect(await S.standupSweepDue(new Date())).toBe(true);
    await handlers["standup.sweep"]({}, { jobId: "00000000-0000-0000-0000-000000000000", attempt: 1 });
    const e = await entryOf(research, ife);
    expect(e.status).toBe("ready");
    expect(await notifications(id(ife), "brenda.standup")).toHaveLength(1);
    await adminQuery("UPDATE standup_rollups SET cutoff_at = now() - interval '1 second' WHERE team_id = $1 AND local_date = $2", [research, today]);
    await handlers["standup.sweep"]({}, { jobId: "00000000-0000-0000-0000-000000000000", attempt: 1 });
    expect(await adminQuery("SELECT status FROM standup_rollups WHERE team_id = $1 AND local_date = $2", [research, today])).toEqual([{ status: "sent" }]);
    expect(await notifications(id(kemi), "brenda.standup_rollup")).toEqual([expect.objectContaining({ title: "Research standup: 0 of 2 posted" })]);
  });

  it("a day on the clock change (Europe/London) opens at 09:30 local", async () => {
    const b = await buildCompany("b");
    await adminQuery("UPDATE organisations SET timezone = 'Europe/London' WHERE id = $1", [b.ownerCtx.org.id]);
    const lead = { ...b.managerCtx, org: { ...b.managerCtx.org, timezone: "Europe/London" } };
    await S.saveStandupSettings(lead, b.teamId, { enabled: true, time: "09:30", cutoff: "12:00", days: allDays });
    // Sunday 25 October 2026: the clocks go back at 02:00, so 09:30 is 09:30 UTC; the day before it was 08:30 UTC.
    expect((await S.openStandupDay(b.teamId, "2026-10-25", new Date("2026-10-25T09:30:00Z"))).status).toBe("opened");
    expect((await S.openStandupDay(b.teamId, "2026-10-24", new Date("2026-10-24T08:30:00Z"))).status).toBe("opened");
    const rows = await adminQuery<{ local_date: string; post_at: string; cutoff_at: string }>(
      "SELECT local_date::text AS local_date, post_at, cutoff_at FROM standup_rollups WHERE team_id = $1 ORDER BY local_date", [b.teamId]);
    expect(rows).toEqual([
      { local_date: "2026-10-24", post_at: "2026-10-24T08:30:00.000Z", cutoff_at: "2026-10-24T11:00:00.000Z" },
      { local_date: "2026-10-25", post_at: "2026-10-25T09:30:00.000Z", cutoff_at: "2026-10-25T12:00:00.000Z" },
    ]);
    // Before its post time (a job queued for an older time): not yet.
    expect((await S.openStandupDay(b.teamId, "2026-10-26", new Date("2026-10-26T08:00:00Z"))).status).toBe("off");
  });
});
