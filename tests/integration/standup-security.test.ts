/**
 * Standups and preferences, the database's own rules (owner decisions, 8–9 October 2026: phase 7c; migration 0050),
 * tried directly as the app role (`appQueryAs`) and as the table owner, past every service: a person's standup is read
 * only by them (their lead never reads a draft); a rollup and its recipients only by the recipients; only Boredroom's
 * worker inserts or changes entries, rollups and recipients; the person's steps answer 'not_found' for anyone else's id;
 * the posted mark refuses a message that is not theirs, not via their assistant or not in their team's channel; whose
 * standup it is never changes, a posted one is kept as posted, the status moves only along its machine (even for the
 * owner role); team settings are written only by the team's lead, the owner and HR; and preferences are the person's
 * alone (owners, HR and leads read nothing).
 *
 * Company A (Africa/Lagos): Grace Owner, Mary HR, David Lead (leads Design: Ada Obi, Ben Okafor), Kemi Sales (leads
 * Sales). Local test database only (TEST_DATABASE_URL on localhost). No model.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { resetTestDatabase, adminQuery, appQueryAs } from "../helpers/db";
import { buildCompany, createVerifiedUser, joinViaInvitation, type CompanyFixture } from "@/server/services/fixtures";
import { createTeam, setTeamMember } from "@/server/services/orgs";
import { openChannel, sendMessage } from "@/server/services/messaging";
import { withWorker } from "@/server/db";
import { addPreference } from "@/server/services/preferences";
import * as S from "@/server/services/standup";
import { composeRollup, composeStandup } from "@/server/services/standup-compose";
import { localDate } from "@/server/lib/time";
import type { OrgContext } from "@/server/lib/api";

delete process.env.ANTHROPIC_API_KEY;

let a: CompanyFixture;
let owner: OrgContext, mary: OrgContext, david: OrgContext, ada: OrgContext, ben: OrgContext, kemi: OrgContext;
let design: string, sales: string, designChannel: string, salesChannel: string;
let adaEntry: string, benEntry: string, rollup: string, today: string;

const id = (c: OrgContext) => c.membership.id;
const refused = (p: Promise<unknown>) => expect(p).rejects.toThrow();
const word = async (who: string | null, sql: string, params: unknown[]) => ((await appQueryAs(who, sql, params))[0] as { w: string }).w;

async function draft(entryId: string) {
  const c = await S.claimStandupDraft(entryId, new Date());
  if ("skip" in c) throw new Error(`not claimed: ${c.skip}`);
  await S.saveStandupDraft(entryId, await composeStandup(c, { model: null }), new Date());
}

beforeAll(async () => {
  await resetTestDatabase();
  a = await buildCompany("a", { names: { owner: "Grace Owner", hr: "Mary HR", manager: "David Lead", employee: "Ada Obi", employee2: "Ben Okafor" } });
  owner = a.ownerCtx; mary = a.hrCtx; david = a.managerCtx; ada = a.employeeCtx; ben = a.employee2Ctx;
  design = a.teamId;
  sales = (await createTeam(owner, "Sales")).id;
  kemi = await joinViaInvitation(mary, await createVerifiedUser("kemi@company-a.test", "Kemi Sales"), "manager", sales, "MGR-002");
  await setTeamMember(owner, sales, id(kemi), { isManager: true });
  await setTeamMember(owner, sales, id(ada), { isManager: false });
  designChannel = await openChannel(david, design);
  salesChannel = await openChannel(kemi, sales);
  today = localDate(new Date(), "Africa/Lagos");
  await S.saveStandupSettings(david, design, { enabled: true, time: "00:00", cutoff: "23:59", days: [0, 1, 2, 3, 4, 5, 6] });
  const day = await S.openStandupDay(design, today, new Date());
  rollup = day.rollupId!;
  [adaEntry, benEntry] = await Promise.all([ada, ben].map(async (c) =>
    (await adminQuery<{ id: string }>("SELECT id FROM standup_entries WHERE rollup_id = $1 AND membership_id = $2", [rollup, id(c)]))[0].id));
  await draft(adaEntry);
  await draft(benEntry);
  await S.postStandup(ada, adaEntry);
  await adminQuery("UPDATE standup_rollups SET cutoff_at = clock_timestamp() WHERE id = $1", [rollup]);
  const input = await S.rollupInput(rollup, new Date());
  if ("skip" in input) throw new Error(input.skip);
  await S.sendRollup(rollup, composeRollup(input), new Date());
  await addPreference(ada, "Keep replies to three lines.");
});

describe("who reads what", () => {
  it("a standup: only its person; the lead, the owner, HR and a colleague read nothing", async () => {
    expect((await appQueryAs(a.employee.profileId, "SELECT id FROM standup_entries")).map((r) => r.id)).toEqual([adaEntry]);
    expect((await appQueryAs(a.employee2.profileId, "SELECT id FROM standup_entries")).map((r) => r.id)).toEqual([benEntry]);
    for (const who of [a.owner, a.hr]) expect(await appQueryAs(who.profileId, "SELECT id FROM standup_entries")).toEqual([]);
    expect((await appQueryAs(a.manager.profileId, "SELECT id FROM standup_entries")).map((r) => r.id)).not.toContain(adaEntry);
    expect(await S.getStandupEntry(david, adaEntry)).toBeNull();
    expect(await appQueryAs(null, "SELECT id FROM standup_entries")).toEqual([]);
  });

  it("a rollup and its recipients: only the recipients; Ada reads no rollup", async () => {
    expect((await appQueryAs(a.manager.profileId, "SELECT id FROM standup_rollups")).map((r) => r.id)).toEqual([rollup]);
    expect((await appQueryAs(a.manager.profileId, "SELECT membership_id FROM standup_rollup_recipients")).map((r) => r.membership_id)).toEqual([id(david)]);
    for (const who of [a.employee, a.employee2, a.owner, a.hr]) {
      expect(await appQueryAs(who.profileId, "SELECT id FROM standup_rollups")).toEqual([]);
      expect(await appQueryAs(who.profileId, "SELECT rollup_id FROM standup_rollup_recipients")).toEqual([]);
    }
    await expect(S.getStandupRollup(ada, rollup)).rejects.toMatchObject({ status: 404 });
  });

  it("a team's settings: every member reads them", async () => {
    for (const who of [a.employee, a.owner, a.hr]) expect((await appQueryAs(who.profileId, "SELECT team_id FROM team_standups")).map((r) => r.team_id)).toEqual([design]);
  });
});

describe("only Boredroom's worker writes the standup tables", () => {
  it("no person inserts, changes or deletes an entry, a rollup or a recipient", async () => {
    for (const who of [a.employee, a.manager, a.owner]) {
      await refused(appQueryAs(who.profileId,
        "INSERT INTO standup_entries(organisation_id, team_id, rollup_id, membership_id, local_date) VALUES ($1, $2, $3, $4, $5::date + 1)",
        [owner.org.id, design, rollup, id(ada), today]));
      expect(await appQueryAs(who.profileId, "UPDATE standup_entries SET today_text = 'changed' RETURNING id")).toEqual([]);
      await refused(appQueryAs(who.profileId, "DELETE FROM standup_entries"));
      await refused(appQueryAs(who.profileId, "INSERT INTO standup_rollups(organisation_id, team_id, local_date, post_at, cutoff_at) VALUES ($1, $2, $3::date + 1, now(), now() + interval '1 hour')",
        [owner.org.id, design, today]));
      expect(await appQueryAs(who.profileId, "UPDATE standup_rollups SET reason = 'x' RETURNING id")).toEqual([]);
      await refused(appQueryAs(who.profileId, "DELETE FROM standup_rollups"));
      await refused(appQueryAs(who.profileId, "INSERT INTO standup_rollup_recipients(rollup_id, organisation_id, membership_id, notify_at) VALUES ($1, $2, $3, now())", [rollup, owner.org.id, id(who === a.employee ? ada : david)]));
      expect(await appQueryAs(who.profileId, "UPDATE standup_rollup_recipients SET seen_at = now() RETURNING rollup_id")).toEqual([]);
    }
    expect(await adminQuery("SELECT today_text <> 'changed' AS kept FROM standup_entries WHERE id = $1", [adaEntry])).toEqual([{ kept: true }]);
  });

  it("the person's steps answer not_found for anyone else's id, and for nobody", async () => {
    for (const who of [a.employee2.profileId, a.manager.profileId, a.owner.profileId, null]) {
      for (const fn of ["app_standup_skip", "app_standup_unskip", "app_standup_seen", "app_standup_post_check"]) {
        expect(await word(who, `SELECT ${fn}($1) AS w`, [adaEntry])).toBe("not_found");
      }
      expect(await word(who, "SELECT app_standup_edit($1, 'x', NULL, NULL) AS w", [adaEntry])).toBe("not_found");
      expect(await word(who, "SELECT app_standup_mark_posted($1, gen_random_uuid()) AS w", [adaEntry])).toBe("not_found");
    }
    for (const who of [a.employee.profileId, a.owner.profileId]) expect(await word(who, "SELECT app_standup_rollup_seen($1) AS w", [rollup])).toBe("not_found");
    expect(await word(a.manager.profileId, "SELECT app_standup_rollup_seen($1) AS w", [rollup])).toBe("ok");
  });

  it("the posted mark refuses a forged message: someone else's, the person's own words, another team's channel", async () => {
    const bens = (await sendMessage(ben, { conversationId: designChannel, body: "Mine" }, { startMention: false })).id;
    const own = (await sendMessage(ada, { conversationId: designChannel, body: "My own words" }, { startMention: false })).id;
    const other = (await sendMessage(ada, { conversationId: salesChannel, body: "Via Max" }, { via: "assistant", startMention: false })).id;
    expect(await word(a.employee2.profileId, "SELECT app_standup_mark_posted($1, $2) AS w", [benEntry, bens])).toBe("bad_message");
    expect(await word(a.employee2.profileId, "SELECT app_standup_mark_posted($1, $2) AS w", [benEntry, own])).toBe("bad_message");
    // Ben's via-assistant message in a channel that is not his team's (Ada's in Sales) and Ada's in the wrong place.
    expect(await word(a.employee2.profileId, "SELECT app_standup_mark_posted($1, $2) AS w", [benEntry, other])).toBe("bad_message");
    const benOther = await withWorker((db) => db.one<{ id: string }>(
      "INSERT INTO messages(organisation_id, conversation_id, sender_membership_id, body, author_kind) VALUES ($1, $2, $3, 'x', 'via_assistant') RETURNING id", [owner.org.id, salesChannel, id(ben)]));
    expect(await word(a.employee2.profileId, "SELECT app_standup_mark_posted($1, $2) AS w", [benEntry, benOther.id])).toBe("bad_message");
    expect(await adminQuery("SELECT status FROM standup_entries WHERE id = $1", [benEntry])).toEqual([{ status: "ready" }]);
    // His own via-assistant message in his team's channel is the one that would do.
    expect(await word(a.employee2.profileId, "SELECT app_standup_post_check($1) AS w", [benEntry])).toBe("ok");
  });
});

describe("the guard holds for every role", () => {
  it("whose standup, which team and which day never change", async () => {
    await expect(adminQuery("UPDATE standup_entries SET membership_id = $2 WHERE id = $1", [benEntry, id(ada)])).rejects.toThrow(/STANDUP_FIXED/);
    await expect(adminQuery("UPDATE standup_entries SET local_date = local_date - 1 WHERE id = $1", [benEntry])).rejects.toThrow(/STANDUP_FIXED/);
    await expect(adminQuery("UPDATE team_standups SET team_id = $2 WHERE team_id = $1", [design, sales])).rejects.toThrow(/STANDUP_FIXED|foreign key/);
  });

  it("a posted standup is kept as it was posted", async () => {
    await expect(adminQuery("UPDATE standup_entries SET today_text = 'rewritten' WHERE id = $1", [adaEntry])).rejects.toThrow(/STANDUP_POSTED/);
    await expect(adminQuery("UPDATE standup_entries SET status = 'skipped', posted_at = NULL WHERE id = $1", [adaEntry])).rejects.toThrow(/STANDUP_POSTED/);
    // What is not the post itself may still move (the late note).
    await adminQuery("UPDATE standup_entries SET seen_at = now() WHERE id = $1", [adaEntry]);
  });

  it("the status moves only along its machine", async () => {
    await expect(adminQuery("UPDATE standup_entries SET status = 'drafting' WHERE id = $1", [benEntry])).rejects.toThrow(/STANDUP_TRANSITION/);
    await expect(adminQuery("UPDATE standup_entries SET status = 'failed' WHERE id = $1", [benEntry])).rejects.toThrow(/STANDUP_TRANSITION/);
    await adminQuery("UPDATE standup_entries SET status = 'missed' WHERE id = $1", [benEntry]);
    await expect(adminQuery("UPDATE standup_entries SET status = 'ready' WHERE id = $1", [benEntry])).rejects.toThrow(/STANDUP_TRANSITION/);
  });
});

describe("team settings", () => {
  it("a member's write is refused; the lead, the owner and HR may; another team's lead may not", async () => {
    expect(await appQueryAs(a.employee.profileId, "UPDATE team_standups SET enabled = false WHERE team_id = $1 RETURNING team_id", [design])).toEqual([]);
    await refused(appQueryAs(a.employee.profileId, "INSERT INTO team_standups(team_id, organisation_id) VALUES ($1, $2)", [sales, owner.org.id]));
    expect(await appQueryAs(kemi.user.profileId, "UPDATE team_standups SET post_time = '08:00' WHERE team_id = $1 RETURNING team_id", [design])).toEqual([]);
    for (const who of [a.manager, a.owner, a.hr]) {
      expect(await appQueryAs(who.profileId, "UPDATE team_standups SET post_time = '07:00' WHERE team_id = $1 RETURNING team_id", [design])).toEqual([{ team_id: design }]);
    }
    expect(await appQueryAs(kemi.user.profileId, "INSERT INTO team_standups(team_id, organisation_id) VALUES ($1, $2) RETURNING team_id", [sales, owner.org.id])).toEqual([{ team_id: sales }]);
    await refused(appQueryAs(a.owner.profileId, "DELETE FROM team_standups WHERE team_id = $1", [sales]));
    // The rollup must stay at least 30 minutes after the drafts, for every writer.
    await expect(adminQuery("UPDATE team_standups SET cutoff_time = '07:10' WHERE team_id = $1", [design])).rejects.toThrow(/team_standups_times_check/);
  });
});

describe("preferences", () => {
  it("only the person reads and writes them; owners, HR and leads read nothing; the worker reads them", async () => {
    expect((await appQueryAs(a.employee.profileId, "SELECT body FROM assistant_preferences")).map((r) => r.body)).toEqual(["Keep replies to three lines."]);
    for (const who of [a.owner, a.hr, a.manager, a.employee2]) {
      expect(await appQueryAs(who.profileId, "SELECT body FROM assistant_preferences")).toEqual([]);
      expect(await appQueryAs(who.profileId, "UPDATE assistant_preferences SET body = 'x' RETURNING id")).toEqual([]);
      expect(await appQueryAs(who.profileId, "DELETE FROM assistant_preferences RETURNING id")).toEqual([]);
      await refused(appQueryAs(who.profileId, "INSERT INTO assistant_preferences(organisation_id, membership_id, body) VALUES ($1, $2, 'Be rude')", [owner.org.id, id(ada)]));
    }
    expect(await withWorker((db) => db.query("SELECT body FROM assistant_preferences WHERE membership_id = $1", [id(ada)]))).toEqual([{ body: "Keep replies to three lines." }]);
    expect(await withWorker((db) => db.query("UPDATE assistant_preferences SET body = 'x' WHERE membership_id = $1 RETURNING id", [id(ada)]))).toEqual([]);
  });

  it("at most 16 for any writer; whose it is never changes", async () => {
    await adminQuery("INSERT INTO assistant_preferences(organisation_id, membership_id, body) SELECT $1, $2, 'Preference ' || g FROM generate_series(1, 15) g", [owner.org.id, id(ada)]);
    await expect(adminQuery("INSERT INTO assistant_preferences(organisation_id, membership_id, body) VALUES ($1, $2, 'One more')", [owner.org.id, id(ada)])).rejects.toThrow(/PREFERENCES_FULL/);
    await expect(adminQuery("UPDATE assistant_preferences SET membership_id = $2 WHERE membership_id = $1", [id(ada), id(ben)])).rejects.toThrow(/PREFERENCE_FIXED/);
    await expect(adminQuery("INSERT INTO assistant_preferences(organisation_id, membership_id, body) VALUES ($1, $2, ' padded ')", [owner.org.id, id(ben)])).rejects.toThrow(/assistant_preferences_body_check/);
  });
});
