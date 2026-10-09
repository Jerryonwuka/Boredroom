/**
 * Commitments, the database's own rules (owner decisions, 8 October 2026: phase 7b; migration 0048), tried directly as
 * the app role (`appQueryAs`) and as the table owner, past every service: only Boredroom's worker writes commitments,
 * labels, scan cursors and re-plan proposals; the committer's own steps refuse everyone else with the same word as a
 * missing row; a supervisor reads only accepted (open) and done commitments, another team's lead reads nothing, the asker
 * reads every status; a 'workspace' message is the worker's alone to write or change; and who owes what, and where it
 * was said, never changes, even for the owner role. Phase 7c (owner decision, 9 October 2026; migration 0050): a
 * "Declined" or "Not a commitment" label is read only by that commitment's committer and asker.
 *
 * Company A: Grace Owner, Mary HR, David Lead (Design: Ada, Ben), Sam Sales (leads Sales: Olu Adeyemi). Local test
 * database only (TEST_DATABASE_URL on localhost). No model.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { resetTestDatabase, adminQuery, appQueryAs } from "../helpers/db";
import { buildCompany, createVerifiedUser, joinViaInvitation, type CompanyFixture, type FixtureUser } from "@/server/services/fixtures";
import { createTeam, setTeamMember } from "@/server/services/orgs";
import { openChannel, sendMessage } from "@/server/services/messaging";
import { withWorker } from "@/server/db";
import * as C from "@/server/services/commitments";
import type { DetectedCommitment } from "@/lib/commitments";
import type { OrgContext } from "@/server/lib/api";

delete process.env.ANTHROPIC_API_KEY;

let a: CompanyFixture;
let owner: OrgContext, david: OrgContext, ada: OrgContext, ben: OrgContext, olu: OrgContext;
let samUser: FixtureUser, oluUser: FixtureUser;
let design: string;
let proposed: string, open: string, declined: string, dismissed: string, workspaceMsg: string;

const id = (c: OrgContext) => c.membership.id;
const say = async (c: OrgContext, body: string, replyToId?: string) => (await sendMessage(c, { conversationId: design, body, replyToId: replyToId ?? null }, { startMention: false })).id;
const det = (p: Pick<DetectedCommitment, "sourceMessageId" | "kind" | "committerMembershipId"> & Partial<DetectedCommitment>): DetectedCommitment => ({
  conversationId: design, agreementMessageId: null, askerMembershipId: null, title: "Send the deck", dueAt: null, dueWords: null, detectedBy: "builtin", confidence: 0.9, messageAt: new Date().toISOString(), ...p,
});
const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();
const refused = (p: Promise<unknown>) => expect(p).rejects.toThrow();

beforeAll(async () => {
  await resetTestDatabase();
  a = await buildCompany("a", { names: { owner: "Grace Owner", hr: "Mary HR", manager: "David Lead", employee: "Ada Nwosu", employee2: "Ben Okafor" } });
  owner = a.ownerCtx; david = a.managerCtx; ada = a.employeeCtx; ben = a.employee2Ctx;
  const sales = (await createTeam(owner, "Sales")).id;
  oluUser = await createVerifiedUser("olu@company-a.test", "Olu Adeyemi");
  olu = await joinViaInvitation(a.hrCtx, oluUser, "employee", sales, "EMP-010");
  samUser = await createVerifiedUser("sam@company-a.test", "Sam Sales");
  const sam = await joinViaInvitation(owner, samUser, "manager", sales, "MGR-002");
  await setTeamMember(owner, sales, id(sam), { isManager: true });
  await C.saveCommitmentSettings(owner, { track: true });
  design = await openChannel(david, a.teamId);
  // Four agreed asks of Ben by Ada, left in four states.
  const make = async (title: string) => {
    const ask = await say(ada, `Ben, can you ${title.toLowerCase()}?`);
    const ok = await say(ben, "On it", ask);
    return (await C.insertDetectedCommitments(owner.org.id, [det({ sourceMessageId: ask, agreementMessageId: ok, kind: "agreed_ask", committerMembershipId: id(ben), askerMembershipId: id(ada), title })])).created[0];
  };
  proposed = await make("Send the deck");
  open = await make("Fix the login bug");
  declined = await make("Share the fonts");
  const d = await say(ben, "I'll tidy the icons");
  dismissed = (await C.insertDetectedCommitments(owner.org.id, [det({ sourceMessageId: d, kind: "promise", committerMembershipId: id(ben), title: "Tidy the icons" })])).created[0];
  await C.acceptCommitment(ben, open, {});
  await C.declineCommitment(ben, declined, "Not mine");
  await C.dismissCommitment(ben, dismissed);
  // The workspace assistant's follow-up in the thread: only the worker writes one.
  workspaceMsg = (await withWorker((db) => db.one<{ id: string }>(
    `INSERT INTO messages(organisation_id, conversation_id, sender_membership_id, body, author_kind) VALUES ($1, $2, $3, $4, 'workspace') RETURNING id`,
    [owner.org.id, design, id(ben), "A gentle nudge on “Fix the login bug”: is it still on its way?"]))).id;
});

describe("only Boredroom's worker writes them", () => {
  it("no person inserts or changes a commitment, a label, a cursor or a re-plan", async () => {
    for (const who of [a.employee2, a.owner, a.manager]) {
      await refused(appQueryAs(who.profileId,
        `INSERT INTO commitments(organisation_id, conversation_id, source_message_id, kind, committer_membership_id, title, status, detected_by, confidence, expires_at)
         VALUES ($1, $2, gen_random_uuid(), 'promise', $3, 'Anything', 'open', 'builtin', 1, now() + interval '1 day')`, [owner.org.id, design, id(ben)]));
      expect(await appQueryAs(who.profileId, `UPDATE commitments SET title = 'Changed' WHERE id = $1 RETURNING id`, [open])).toEqual([]);
      await refused(appQueryAs(who.profileId, `DELETE FROM commitments WHERE id = $1`, [open]));
      await refused(appQueryAs(who.profileId, `INSERT INTO message_labels(message_id, conversation_id, organisation_id, state) VALUES ($1, $2, $3, 'done')`, [workspaceMsg, design, owner.org.id]));
      expect(await appQueryAs(who.profileId, `UPDATE message_labels SET state = 'done' RETURNING message_id`)).toEqual([]);
      expect(await appQueryAs(who.profileId, `DELETE FROM message_labels RETURNING message_id`)).toEqual([]);
      await refused(appQueryAs(who.profileId, `INSERT INTO commitment_scan_cursors(conversation_id, organisation_id, last_created_at) VALUES ($1, $2, now())`, [design, owner.org.id]));
      expect(await appQueryAs(who.profileId, `SELECT * FROM commitment_scan_cursors`)).toEqual([]);
      await refused(appQueryAs(who.profileId,
        `INSERT INTO replan_proposals(organisation_id, task_id, lead_membership_id, proposed_due_at) VALUES ($1, $2, $3, now())`, [owner.org.id, a.taskIds.homepage, id(david)]));
    }
    expect(await adminQuery("SELECT title FROM commitments WHERE id = $1", [open])).toEqual([{ title: "Fix the login bug" }]);
    expect(await adminQuery("SELECT count(*)::int AS n FROM message_labels")).toEqual([{ n: 4 }]);
  });

  it("the committer's steps refuse everyone else with the word a missing row gets", async () => {
    for (const who of [a.employee, a.owner, a.manager, a.hr]) {
      expect(await appQueryAs(who.profileId, `SELECT app_commitment_decide($1, 'accept', NULL) AS r`, [proposed])).toEqual([{ r: "not_found" }]);
      expect(await appQueryAs(who.profileId, `SELECT app_commitment_decide($1, 'decline', 'no') AS r`, [proposed])).toEqual([{ r: "not_found" }]);
      expect(await appQueryAs(who.profileId, `SELECT app_commitment_seen($1) AS r`, [proposed])).toEqual([{ r: "not_found" }]);
      expect(await appQueryAs(who.profileId, `SELECT app_commitment_mark_done($1) AS r`, [open])).toEqual([{ r: "not_found" }]);
    }
    expect(await appQueryAs(null, `SELECT app_commitment_decide($1, 'accept', NULL) AS r`, [proposed])).toEqual([{ r: "not_found" }]);
    expect(await appQueryAs(a.employee2.profileId, `SELECT app_commitment_decide($1, 'maybe', NULL) AS r`, [proposed])).toEqual([{ r: "bad_decision" }]);
    expect(await appQueryAs(a.employee2.profileId, `SELECT app_commitment_decide($1, 'decline', $2) AS r`, [proposed, "x".repeat(281)])).toEqual([{ r: "too_long" }]);
    expect(await appQueryAs(a.employee2.profileId, `SELECT app_commitment_decide($1, 'accept', NULL) AS r`, [declined])).toEqual([{ r: "closed" }]);
    expect(await appQueryAs(a.employee2.profileId, `SELECT app_commitment_mark_done($1) AS r`, [proposed])).toEqual([{ r: "closed" }]);
    expect(await adminQuery("SELECT status FROM commitments WHERE id = $1", [proposed])).toEqual([{ status: "proposed" }]);
  });
});

describe("who reads what", () => {
  const all = () => [proposed, open, declined, dismissed].sort();

  it("the committer and the asker read every status", async () => {
    expect(ids(await appQueryAs(a.employee2.profileId, `SELECT id FROM commitments`))).toEqual(all());
    expect(ids(await appQueryAs(a.employee.profileId, `SELECT id FROM commitments`))).toEqual([proposed, open, declined].sort());
  });

  it("a supervisor (the team lead, the owner, HR) reads only open and done ones", async () => {
    for (const who of [a.manager, a.owner, a.hr]) {
      expect(ids(await appQueryAs(who.profileId, `SELECT id FROM commitments`))).toEqual([open]);
    }
    expect((await C.listCommitments(david, { scope: "team" })).items.map((i) => i.id)).toEqual([open]);
    expect((await C.listCommitments(owner, { scope: "all" })).items.map((i) => i.id)).toEqual([open]);
    // The decline's reason never reaches a supervisor, nor do the words of a message they cannot read.
    const v = (await C.listCommitments(owner, { scope: "all" })).items[0];
    expect(v).toMatchObject({ viewer: "supervisor", declineReason: null, message: { quote: null, href: null }, where: { kind: "team", name: null } });
  });

  it("another team's lead and a colleague read nothing", async () => {
    for (const who of [samUser, oluUser]) {
      expect(await appQueryAs(who.profileId, `SELECT id FROM commitments`)).toEqual([]);
      expect(await appQueryAs(who.profileId, `SELECT message_id FROM message_labels`)).toEqual([]);
    }
    expect(await C.getCommitment(olu, open)).toBeNull();
  });

  it("labels: Noted for every reader of the conversation; Declined and Not a commitment for its two people only", async () => {
    // Proposed and open: noted (on the "On it"); declined (Ada asked Ben); the promise Ben marked not a commitment (no
    // asker). Phase 7c (owner decision, 9 October 2026): the private labels are read only by the committer and asker.
    expect((await appQueryAs(a.employee2.profileId, `SELECT state FROM message_labels ORDER BY state`)).map((r) => r.state)).toEqual(["declined", "dismissed", "noted", "noted"]);
    expect((await appQueryAs(a.employee.profileId, `SELECT state FROM message_labels ORDER BY state`)).map((r) => r.state)).toEqual(["declined", "noted", "noted"]);
    expect((await appQueryAs(a.manager.profileId, `SELECT state FROM message_labels ORDER BY state`)).map((r) => r.state)).toEqual(["noted", "noted"]);
    for (const who of [a.owner, a.hr, samUser, oluUser]) expect(await appQueryAs(who.profileId, `SELECT state FROM message_labels`)).toEqual([]);
  });
});

describe("the workspace assistant's own message", () => {
  it("cannot be written or changed by anyone but the worker", async () => {
    await expect(appQueryAs(a.employee2.profileId,
      `INSERT INTO messages(organisation_id, conversation_id, sender_membership_id, body, author_kind) VALUES ($1, $2, $3, 'Fake nudge', 'workspace')`,
      [owner.org.id, design, id(ben)])).rejects.toThrow(/ASSISTANT_AUTHOR|row-level security/);
    await expect(appQueryAs(a.employee2.profileId, `UPDATE messages SET body = 'Edited' WHERE id = $1`, [workspaceMsg])).rejects.toThrow(/ASSISTANT_AUTHOR/);
    await expect(appQueryAs(a.employee2.profileId, `UPDATE messages SET author_kind = 'person' WHERE id = $1`, [workspaceMsg])).rejects.toThrow(/AUTHOR_KIND_FIXED/);
    // A person's own message cannot become the workspace's.
    const mine = await say(ben, "Morning all");
    await expect(appQueryAs(a.employee2.profileId, `UPDATE messages SET author_kind = 'workspace' WHERE id = $1`, [mine])).rejects.toThrow(/AUTHOR_KIND_FIXED/);
    expect(await adminQuery("SELECT body, author_kind FROM messages WHERE id = $1", [workspaceMsg])).toEqual([{ body: "A gentle nudge on “Fix the login bug”: is it still on its way?", author_kind: "workspace" }]);
  });

  it("reads as the workspace's assistant, never its sender's, and is nobody's to edit", async () => {
    const { thread } = await import("@/server/services/messaging");
    const t = await thread(ben, design);
    const m = t!.messages.find((x) => x.id === workspaceMsg)!;
    expect(m).toMatchObject({ author_kind: "workspace", mine: false, assistant: { name: "Brenda" } });
    const { editMessage, withdrawMessage } = await import("@/server/services/messaging");
    await expect(editMessage(ben, workspaceMsg, "Edited")).rejects.toMatchObject({ status: 404 });
    await expect(withdrawMessage(ben, workspaceMsg)).rejects.toMatchObject({ status: 404 });
  });
});

describe("what never changes", () => {
  it("who owes what, and where it was said, even for the table owner; the status only moves forward", async () => {
    await expect(adminQuery(`UPDATE commitments SET committer_membership_id = $2 WHERE id = $1`, [open, id(ada)])).rejects.toThrow(/COMMITMENT_FIXED/);
    await expect(adminQuery(`UPDATE commitments SET asker_membership_id = $2 WHERE id = $1`, [open, id(david)])).rejects.toThrow(/COMMITMENT_FIXED/);
    await expect(adminQuery(`UPDATE commitments SET source_message_id = gen_random_uuid() WHERE id = $1`, [open])).rejects.toThrow(/COMMITMENT_FIXED/);
    await expect(adminQuery(`UPDATE commitments SET expires_at = now() WHERE id = $1`, [open])).rejects.toThrow(/COMMITMENT_FIXED/);
    await expect(adminQuery(`UPDATE commitments SET kind = 'promise' WHERE id = $1`, [open])).rejects.toThrow(/COMMITMENT_FIXED/);
    await expect(adminQuery(`UPDATE commitments SET status = 'proposed' WHERE id = $1`, [open])).rejects.toThrow(/COMMITMENT_TRANSITION/);
    await expect(adminQuery(`UPDATE commitments SET status = 'open' WHERE id = $1`, [declined])).rejects.toThrow(/COMMITMENT_TRANSITION/);
    await expect(adminQuery(`UPDATE commitments SET status = 'done' WHERE id = $1`, [proposed])).rejects.toThrow(/COMMITMENT_TRANSITION/);
    // Shape checks: done needs when and how.
    await expect(withWorker((db) => db.query(`UPDATE commitments SET status = 'done' WHERE id = $1`, [open]))).rejects.toThrow(/commitments_done_shape_check/);
  });
});
