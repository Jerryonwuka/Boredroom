/**
 * Brenda's abilities (owner decisions, 8–9 October 2026: phase 7c, the abilities catalogue). Every ability built so far
 * stays on until someone switches it off; owners and HR choose what the workspace offers, each person what their own
 * assistant does for them; a switched-off ability is refused in the services with one sentence and where to switch it
 * on, its reads are empty, its routine templates unavailable (and a run skipped with the routine left on), and the
 * existing switches stay the source of truth, surfaced on the cards as they are.
 *
 * Company A (company-a, Africa/Lagos): Grace Owner, Mary HR, David Lead (leads Design: Ada Obi, Ben Okafor, Olu Ade,
 * whose assistant is Max). Local test database only (TEST_DATABASE_URL on localhost). No model.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { resetTestDatabase, adminQuery } from "../helpers/db";
import { buildCompany, createVerifiedUser, joinViaInvitation, type CompanyFixture } from "@/server/services/fixtures";
import { saveMyAssistant, saveMySpeak, assistantProfiles, readAssistantProfiles } from "@/server/services/assistant-profile";
import { saveActMode } from "@/server/services/act-mode";
import { saveCommitmentSettings } from "@/server/services/commitments";
import * as A from "@/server/services/abilities";
import * as LE from "@/server/services/loose-ends";
import * as R from "@/server/services/routines";
import * as S from "@/server/services/standup";
import { createFollowUps, planFollowUps } from "@/server/services/follow-ups";
import { listAssistantItems, sendAssistantItem } from "@/server/services/assistant-items";
import { morningOpener, openerOn } from "@/server/services/opener";
import { desktopState } from "@/server/services/desktop";
import { openChannel, sendMessage, thread } from "@/server/services/messaging";
import { claimMention } from "@/server/services/mentions";
import { withUser } from "@/server/db";
import { localDate } from "@/server/lib/time";
import { ABILITY_KEYS, ABILITY_WORDS, type AbilityKey } from "@/lib/abilities";
import { mentionNote } from "@/lib/mentions";
import type { RoutineInput } from "@/lib/routines";
import type { OrgContext } from "@/server/lib/api";

delete process.env.ANTHROPIC_API_KEY;

let a: CompanyFixture;
let owner: OrgContext, mary: OrgContext, david: OrgContext, ada: OrgContext, ben: OrgContext, olu: OrgContext;
let design: string;
let brief: string; // Olu's morning brief, enabled
const SOME_ID = "11111111-1111-4111-8111-111111111111";
const id = (c: OrgContext) => c.membership.id;
const impersonated = (c: OrgContext): OrgContext => ({ ...c, user: { ...c.user, impersonation: { id: "x", adminEmail: "admin@boredroom.test" } } });
const card = async (c: OrgContext, key: AbilityKey) => (await A.abilitiesView(c)).cards.find((x) => x.key === key)!;
const offWs = (title: string) => ({ status: 403, code: "ABILITY_OFF", message: ABILITY_WORDS.refusal(title, "workspace", "") });
const offMine = (title: string, name: string) => ({ status: 403, code: "ABILITY_OFF", message: ABILITY_WORDS.refusal(title, "personal", name) });
async function workspace(key: AbilityKey, offered: boolean) { await A.saveWorkspaceAbility(owner, { key, offered }); }
async function enableNew(ctx: OrgContext, input: RoutineInput) {
  const v = await R.createRoutine(ctx, input);
  const p = await R.previewRoutine(ctx, v.id);
  return R.enableRoutine(ctx, v.id, { consentHash: p.consent.hash });
}
/** Claims the routine's run now, as the worker does. */
async function claimNow(routineId: string) {
  const [r] = await adminQuery<{ next_run_at: string }>("UPDATE routines SET next_run_at = now() WHERE id = $1 RETURNING next_run_at", [routineId]);
  return R.claimRun({ routineId, dueAt: r.next_run_at, now: new Date() });
}

beforeAll(async () => {
  await resetTestDatabase();
  a = await buildCompany("a", { names: { owner: "Grace Owner", hr: "Mary HR", manager: "David Lead", employee: "Ada Obi", employee2: "Ben Okafor" } });
  owner = a.ownerCtx; mary = a.hrCtx; david = a.managerCtx; ada = a.employeeCtx; ben = a.employee2Ctx;
  design = a.teamId;
  olu = await joinViaInvitation(mary, await createVerifiedUser("olu@company-a.test", "Olu Ade"), "employee", design, "EMP-003");
  await saveMyAssistant(olu, { name: "Max", colour: "blue", visor: "band", eyes: "round" });
  brief = (await enableNew(olu, { template: "morning_brief", cadence: { kind: "daily" }, time: "09:00" })).id;
});

describe("the catalogue", () => {
  it("defaults: every new ability on, commitments off until an owner or HR turns it on, acting asks first", async () => {
    const v = await A.abilitiesView(olu);
    expect(v).toMatchObject({ ready: true, canEditWorkspace: false, impersonated: false });
    expect(v.cards.map((c) => c.key)).toEqual([...ABILITY_KEYS]);
    expect(v.cards.find((c) => c.key === "catch_up")).toMatchObject({
      title: "Catch-up", icon: "Inbox", what: expect.stringMatching(/^Max reads the conversations you're in/),
      workspace: { kind: "switch", offered: true }, personal: { kind: "switch", on: true }, effective: true, state: "On",
    });
    expect(v.cards.find((c) => c.key === "commitments")).toMatchObject({
      what: expect.stringMatching(/^Brenda notes promises/),
      workspace: { kind: "existing", on: false, href: "/app/company-a/settings?section=brenda#commitments" },
      personal: { kind: "none", label: "Set by your workspace" }, effective: false, state: "Off until an owner or HR turns it on",
    });
    expect(v.cards.find((c) => c.key === "act")).toMatchObject({
      workspace: { kind: "existing", on: true, href: "/app/company-a/settings?section=brenda#act-mode" },
      personal: { kind: "existing", on: false, href: "/app/company-a/settings?section=assistant#permissions" }, state: "Asks first", effective: false,
    });
    expect(v.cards.find((c) => c.key === "mentions")).toMatchObject({
      workspace: { kind: "existing", on: true, href: "/app/company-a/settings?section=brenda#mentions" }, personal: { kind: "switch", on: true },
      also: [{ scope: "personal", on: true, label: "Let people tag Max", href: "/app/company-a/settings?section=assistant#assistant-talk" }],
    });
    expect(v.cards.find((c) => c.key === "routines")!.templates).toEqual([
      { template: "morning_brief", label: "Morning brief", available: true, needs: "Morning opener" },
      { template: "still_owed", label: "What's still owed", available: true, needs: null },
      { template: "afternoon_check", label: "Afternoon check", available: true, needs: null },
      { template: "chase_stalled", label: "Chase stalled tasks", available: true, needs: "Follow-ups" },
      { template: "loose_ends", label: "Loose ends", available: true, needs: "Loose ends" },
    ]);
    expect(v.cards.find((c) => c.key === "standup")).toMatchObject({ state: "No team runs one yet", teamsOn: 0, effective: true });
    expect(v.cards.find((c) => c.key === "voice")).toMatchObject({ workspace: { kind: "switch", offered: true }, personal: { kind: "existing", on: true, label: "When Max speaks", href: "/app/company-a/settings?section=assistant#voice" } });
    expect((await A.abilitiesView(owner)).canEditWorkspace).toBe(true);
    expect(await A.abilitiesFor(olu)).toEqual({ ready: true, workspaceOff: [], personalOff: [] });
  });

  it("the existing switches are surfaced as they are", async () => {
    await saveCommitmentSettings(owner, { track: true });
    await saveMySpeak(olu, { speak: "never" });
    await saveActMode(olu, "auto");
    await S.saveStandupSettings(david, design, { enabled: true });
    const v = await A.abilitiesView(olu);
    expect(v.cards.find((c) => c.key === "commitments")).toMatchObject({ workspace: { on: true }, state: "On", effective: true });
    expect(v.cards.find((c) => c.key === "voice")!.personal).toMatchObject({ kind: "existing", on: false });
    expect(v.cards.find((c) => c.key === "act")).toMatchObject({ personal: { on: true }, state: "On", effective: true });
    expect(v.cards.find((c) => c.key === "standup")).toMatchObject({ state: "On in 1 team", teamsOn: 1 });
    await saveActMode(olu, "ask");
    await saveMySpeak(olu, { speak: "voice" });
  });

  it("the workspace's switches: owners and HR only, audited; existing switches' keys are changed in their own cards", async () => {
    await expect(A.saveWorkspaceAbility(david, { key: "catch_up", offered: false })).rejects.toMatchObject({ status: 403 });
    await expect(A.saveWorkspaceAbility(impersonated(owner), { key: "catch_up", offered: false })).rejects.toMatchObject({ status: 403 });
    await expect(A.saveWorkspaceAbility(owner, { key: "act", offered: false })).rejects.toMatchObject({ status: 400, message: "Change this one in its own card below." });
    await expect(A.saveWorkspaceAbility(owner, { key: "mentions", offered: false })).rejects.toMatchObject({ status: 400 });
    await expect(A.saveWorkspaceAbility(owner, { key: "nonsense" as AbilityKey, offered: false })).rejects.toMatchObject({ status: 400 });
    const v = await A.saveWorkspaceAbility(mary, { key: "catch_up", offered: false });
    expect(v.cards.find((c) => c.key === "catch_up")).toMatchObject({ workspace: { kind: "switch", offered: false } });
    expect(await adminQuery("SELECT metadata FROM audit_events WHERE action = 'brenda.ability_changed'")).toEqual([{ metadata: { ability: "catch_up", offered: false } }]);
    await workspace("catch_up", true);
    expect(await adminQuery("SELECT abilities_off FROM brenda_settings WHERE organisation_id = $1", [owner.org.id])).toEqual([{ abilities_off: [] }]);
  });

  it("the person's own switches: their own keys only, never while someone else is signed in as them, not audited", async () => {
    await expect(A.savePersonalAbility(impersonated(olu), { key: "catch_up", on: false })).rejects.toMatchObject({ status: 403 });
    await expect(A.savePersonalAbility(olu, { key: "voice", on: false })).rejects.toMatchObject({ status: 400 });
    await expect(A.savePersonalAbility(olu, { key: "commitments", on: false })).rejects.toMatchObject({ status: 400 });
    const audits = async () => (await adminQuery<{ n: number }>("SELECT count(*)::int AS n FROM audit_events"))[0].n;
    const before = await audits();
    const v = await A.savePersonalAbility(olu, { key: "catch_up", on: false });
    expect(v.cards.find((c) => c.key === "catch_up")).toMatchObject({ personal: { kind: "switch", on: false }, state: "Off", effective: false });
    expect(await audits()).toBe(before);
    // Only Olu's: Ben's is on.
    expect((await card(ben, "catch_up")).state).toBe("On");
    await expect(A.requireAbility(olu, "catch_up")).rejects.toMatchObject(offMine("Catch-up", "Max"));
    await A.requireAbility(ben, "catch_up");
    await A.savePersonalAbility(olu, { key: "catch_up", on: true });
  });
});

describe("switched off for the workspace", () => {
  it("catch-up: the refusal names where it is switched on, and the opener leaves out \"What did I miss?\"", async () => {
    await workspace("catch_up", false);
    await expect(A.requireAbility(olu, "catch_up")).rejects.toMatchObject(offWs("Catch-up"));
    expect((await card(olu, "catch_up")).state).toBe("Off for this workspace");
    expect((await morningOpener(david)).actions.map((x) => x.id)).not.toContain("missed");
    await workspace("catch_up", true);
    expect((await morningOpener(david)).actions.map((x) => x.id)).toContain("missed");
  });

  it("loose ends: the list empty with who switched it off, every action and keeping a scan refused", async () => {
    await workspace("loose_ends", false);
    expect(await LE.listLooseEnds(olu)).toEqual({ ready: true, items: [], counts: { open: 0 }, lastScanAt: null, off: "workspace" });
    await expect(LE.looseEndToTodo(olu, SOME_ID, { title: "x" })).rejects.toMatchObject(offWs("Loose ends"));
    await expect(LE.dismissLooseEnd(olu, SOME_ID)).rejects.toMatchObject(offWs("Loose ends"));
    await expect(LE.insertLooseEnds(olu, [], { source: "on_demand" })).rejects.toMatchObject(offWs("Loose ends"));
    expect((await R.listRoutines(olu)).unavailableBecause).toEqual({ loose_ends: "loose_ends" });
    await workspace("loose_ends", true);
    expect((await LE.listLooseEnds(olu)).off).toBeNull();
  });

  it("follow-ups: planning says why, creating answers 403", async () => {
    await workspace("follow_ups", false);
    expect(await planFollowUps(olu, { people: [id(ben)] })).toEqual({ ok: false, error: ABILITY_WORDS.refusal("Follow-ups", "workspace", "") });
    await expect(createFollowUps(olu, { subjectMembershipIds: [id(ben)], question: "Where are you?" })).rejects.toMatchObject(offWs("Follow-ups"));
    expect((await R.listRoutines(david)).unavailable).toContain("chase_stalled");
    await workspace("follow_ups", true);
  });

  it("messages and requests between assistants: sending refused, the inbox still answers", async () => {
    await workspace("assistant_talk", false);
    await expect(sendAssistantItem(olu, { kind: "message", recipientMembershipId: id(ben), body: "The deck is in Drive." })).rejects.toMatchObject(offWs("Messages and requests between assistants"));
    expect((await listAssistantItems(ben, { box: "waiting" })).ready).toBe(true);
    await workspace("assistant_talk", true);
    expect((await sendAssistantItem(olu, { kind: "message", recipientMembershipId: id(ben), body: "The deck is in Drive." })).kind).toBe("message");
  });

  it("routines: refused to set up and change, pausing still works, and a run is skipped with the routine left on", async () => {
    await workspace("routines", false);
    const list = await R.listRoutines(olu);
    expect(list.off).toBe("workspace");
    await expect(R.createRoutine(olu, { template: "still_owed", cadence: { kind: "daily" }, time: "16:00" })).rejects.toMatchObject(offWs("Routines"));
    await expect(R.updateRoutine(olu, brief, { time: "08:00" })).rejects.toMatchObject(offWs("Routines"));
    await expect(R.previewRoutine(olu, brief)).rejects.toMatchObject(offWs("Routines"));
    expect(await claimNow(brief)).toEqual({ skip: "ability_off" });
    expect(await adminQuery("SELECT enabled, last_status FROM routines WHERE id = $1", [brief])).toEqual([{ enabled: true, last_status: "skipped" }]);
    expect(await adminQuery("SELECT status, reason FROM routine_runs WHERE routine_id = $1 ORDER BY started_at DESC LIMIT 1", [brief])).toEqual([{ status: "skipped", reason: "ability_off" }]);
    await workspace("routines", true);
  });

  it("the morning opener: none on the web or the notch, its routine template unavailable and its run skipped", async () => {
    await workspace("morning_opener", false);
    expect(await openerOn(olu)).toBe(false);
    expect((await desktopState(olu)).opener).toBeNull();
    const list = await R.listRoutines(olu);
    expect(list.unavailable).toContain("morning_brief");
    expect(list.unavailableBecause).toEqual({ morning_brief: "morning_opener" });
    await expect(R.createRoutine(olu, { template: "morning_brief", cadence: { kind: "weekdays" }, time: "08:00" })).rejects.toMatchObject(offWs("Morning opener"));
    expect(await claimNow(brief)).toEqual({ skip: "ability_off" });
    expect((await adminQuery<{ enabled: boolean }>("SELECT enabled FROM routines WHERE id = $1", [brief]))[0].enabled).toBe(true);
    await workspace("morning_opener", true);
    expect(await openerOn(olu)).toBe(true);
    expect((await desktopState(olu)).opener).not.toBeNull();
  });

  it("voice: the profiles read voice false and never speaking; the notch says so", async () => {
    await workspace("voice", false);
    const p = await withUser(olu.user.profileId, (db) => readAssistantProfiles(db, olu));
    expect(p).toMatchObject({ voice: false, speak: "never" });
    expect((await assistantProfiles(olu)).voice).toBe(false);
    expect((await desktopState(olu)).assistant).toMatchObject({ voice: false, speak: "never" });
    expect((await desktopState(olu)).abilities.off).toEqual(["voice"]);
    await workspace("voice", true);
    const back = await withUser(olu.user.profileId, (db) => readAssistantProfiles(db, olu));
    expect(back.voice).toBeUndefined();
    expect(back.speak).toBe("voice");
  });

  it("standup: no day opens; switching it off ends today's at once", async () => {
    await S.saveStandupSettings(david, design, { time: "00:00", cutoff: "23:59", days: [0, 1, 2, 3, 4, 5, 6] });
    const today = localDate(new Date(), "Africa/Lagos");
    const day = await S.openStandupDay(design, today, new Date());
    expect(day.status).toBe("opened");
    await workspace("standup", false);
    expect(await adminQuery("SELECT DISTINCT status, reason FROM standup_entries WHERE rollup_id = $1", [day.rollupId])).toEqual([{ status: "cancelled", reason: "off" }]);
    expect(await adminQuery("SELECT status, reason FROM standup_rollups WHERE id = $1", [day.rollupId])).toEqual([{ status: "skipped", reason: "off" }]);
    await adminQuery("DELETE FROM standup_entries WHERE rollup_id = $1", [day.rollupId]);
    await adminQuery("DELETE FROM standup_rollups WHERE id = $1", [day.rollupId]);
    expect((await S.openStandupDay(design, today, new Date())).status).toBe("off");
    expect((await card(olu, "standup")).state).toBe("Off for this workspace");
    await workspace("standup", true);
  });
});

describe("switched off by the person", () => {
  it("only for them, in the person's words", async () => {
    await A.savePersonalAbility(olu, { key: "loose_ends", on: false });
    expect((await LE.listLooseEnds(olu)).off).toBe("personal");
    expect((await LE.listLooseEnds(ben)).off).toBeNull();
    await expect(LE.looseEndToTodo(olu, SOME_ID, { title: "x" })).rejects.toMatchObject(offMine("Loose ends", "Max"));
    await A.savePersonalAbility(olu, { key: "loose_ends", on: true });
    await A.savePersonalAbility(olu, { key: "follow_ups", on: false });
    expect(await planFollowUps(olu, { people: [id(ben)] })).toEqual({ ok: false, error: ABILITY_WORDS.refusal("Follow-ups", "personal", "Max") });
    expect((await planFollowUps(david, { people: [id(olu)] })).ok).toBe(true);
    await A.savePersonalAbility(olu, { key: "follow_ups", on: true });
    expect((await desktopState(olu)).abilities.off).toEqual([]);
  });

  it("@mentions of their own assistant: a private note 'off_ability', and the composer told to stop suggesting it", async () => {
    await A.savePersonalAbility(olu, { key: "mentions", on: false });
    const conv = await openChannel(olu, design);
    const sent = await sendMessage(olu, { conversationId: conv, body: "@Max what's left on the homepage?", mentions: [{ kind: "assistant", label: "@Max" }] }, { startMention: false });
    expect(sent.mentionId).toBeTruthy();
    expect(await claimMention(sent.mentionId!)).toBeNull();
    expect(await adminQuery("SELECT status FROM assistant_mentions WHERE id = $1", [sent.mentionId])).toEqual([{ status: "refused" }]);
    expect(await adminQuery("SELECT kind, note_code FROM assistant_mention_private WHERE mention_id = $1", [sent.mentionId])).toEqual([{ kind: "note", note_code: "off_ability" }]);
    expect(mentionNote("off_ability", "Max")).toBe("You switched off @Max in Messages. Switch it on in Settings → Your assistant → Abilities.");
    expect((await thread(olu, conv))!.ownAssistantOff).toBe(true);
    expect((await thread(ben, conv))!.ownAssistantOff).toBe(false);
    await A.savePersonalAbility(olu, { key: "mentions", on: true });
    expect((await thread(olu, conv))!.ownAssistantOff).toBe(false);
  });

  it("standup: no draft for them (and Settings says Off)", async () => {
    await A.savePersonalAbility(ada, { key: "standup", on: false });
    expect((await card(ada, "standup")).state).toBe("Off");
    expect((await S.standupToday(ada)).off).toBe(true);
    await A.savePersonalAbility(ada, { key: "standup", on: true });
  });
});
