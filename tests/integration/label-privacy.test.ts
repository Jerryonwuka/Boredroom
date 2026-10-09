/**
 * Private decline labels (owner decision, 9 October 2026: phase 7c). A commitment label "Declined" or "Not a commitment"
 * is read only by that commitment's committer and asker; every other reader of the conversation reads no label at all
 * for that message (not "Noted" either). "Noted" and "Done" stay visible to every reader. Enforced in the data layer: the
 * label query (commitments.ts labelsIn) and migration 0050's replaced `message_labels_select` policy agree, so a raw
 * SELECT under row-level security reads exactly what a thread shows. A message with an open commitment and a declined
 * one shows "Noted" to everyone.
 *
 * Company A (Africa/Lagos): Grace Owner, Mary HR, David Lead (leads Design: Ada Obi, Ben Okafor, Olu Ade). Local test
 * database only (TEST_DATABASE_URL on localhost). No model.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { resetTestDatabase, appQueryAs } from "../helpers/db";
import { buildCompany, createVerifiedUser, joinViaInvitation, type CompanyFixture, type FixtureUser } from "@/server/services/fixtures";
import { openChannel, sendMessage, thread } from "@/server/services/messaging";
import { withUser, withWorker } from "@/server/db";
import * as C from "@/server/services/commitments";
import { LOOP_WORDS, type DetectedCommitment, type MessageLabel } from "@/lib/commitments";
import type { OrgContext } from "@/server/lib/api";

delete process.env.ANTHROPIC_API_KEY;

let a: CompanyFixture;
let owner: OrgContext, david: OrgContext, ada: OrgContext, ben: OrgContext, olu: OrgContext;
let oluUser: FixtureUser;
let design: string;
let declinedOk: string, dismissedMsg: string, notedMsg: string, doneMsg: string, mixedMsg: string;

const id = (c: OrgContext) => c.membership.id;
const say = async (c: OrgContext, body: string, replyToId?: string) => (await sendMessage(c, { conversationId: design, body, replyToId: replyToId ?? null }, { startMention: false })).id;
const det = (p: Pick<DetectedCommitment, "sourceMessageId" | "kind" | "committerMembershipId"> & Partial<DetectedCommitment>): DetectedCommitment => ({
  conversationId: design, agreementMessageId: null, askerMembershipId: null, title: "Something", dueAt: null, dueWords: null, detectedBy: "builtin", confidence: 0.9, messageAt: new Date().toISOString(), ...p,
});
const insert = async (d: DetectedCommitment) => (await C.insertDetectedCommitments(owner.org.id, [d])).created[0];
const labelOn = async (c: OrgContext, messageId: string): Promise<MessageLabel | null> =>
  (await thread(c, design))!.messages.find((m) => m.id === messageId)!.commitment_label;
const rawStates = async (u: { profileId: string }) =>
  Object.fromEntries((await appQueryAs(u.profileId, "SELECT message_id, state FROM message_labels")).map((r) => [r.message_id, r.state]));

beforeAll(async () => {
  await resetTestDatabase();
  a = await buildCompany("a", { names: { owner: "Grace Owner", hr: "Mary HR", manager: "David Lead", employee: "Ada Obi", employee2: "Ben Okafor" } });
  owner = a.ownerCtx; david = a.managerCtx; ada = a.employeeCtx; ben = a.employee2Ctx;
  oluUser = await createVerifiedUser("olu@company-a.test", "Olu Ade");
  olu = await joinViaInvitation(a.hrCtx, oluUser, "employee", a.teamId, "EMP-003");
  await C.saveCommitmentSettings(owner, { track: true });
  design = await openChannel(david, a.teamId);

  // Ada asks Ben; Ben agrees, then declines.
  const ask = await say(ada, "Ben, can you share the brand fonts?");
  declinedOk = await say(ben, "On it", ask);
  await C.declineCommitment(ben, await insert(det({ sourceMessageId: ask, agreementMessageId: declinedOk, kind: "agreed_ask", committerMembershipId: id(ben), askerMembershipId: id(ada), title: "Share the brand fonts" })), "Not mine");
  // Olu's promise, which she says is not a commitment.
  dismissedMsg = await say(olu, "I'll tidy the icons");
  await C.dismissCommitment(olu, await insert(det({ sourceMessageId: dismissedMsg, kind: "promise", committerMembershipId: id(olu), title: "Tidy the icons" })));
  // Ben's two promises: one taken on (noted), one done.
  notedMsg = await say(ben, "I'll send the deck Thursday");
  await C.acceptCommitment(ben, await insert(det({ sourceMessageId: notedMsg, kind: "promise", committerMembershipId: id(ben), title: "Send the deck" })), {});
  doneMsg = await say(ben, "I'll fix the login bug");
  const fix = await insert(det({ sourceMessageId: doneMsg, kind: "promise", committerMembershipId: id(ben), title: "Fix the login bug" }));
  await C.acceptCommitment(ben, fix, {});
  await C.markCommitmentDone(ben, fix);
  // One message, two commitments of Ada's: her promise taken on, and David's ask she agreed to there and then declined
  // (the declined one is the newer: a public state still wins).
  const davidAsk = await say(david, "Ada, can you review the copy?");
  mixedMsg = await say(ada, "Sure, and I'll send the slides Friday", davidAsk);
  await C.acceptCommitment(ada, await insert(det({ sourceMessageId: mixedMsg, kind: "promise", committerMembershipId: id(ada), title: "Send the slides" })), {});
  await C.declineCommitment(ada, await insert(det({ sourceMessageId: davidAsk, agreementMessageId: mixedMsg, kind: "agreed_ask", committerMembershipId: id(ada), askerMembershipId: id(david), title: "Review the copy" })), "No time");
});

describe("Declined and Not a commitment: the two people only", () => {
  it("Ben (who declined) and Ada (who asked) read Declined, marked private with the other's name", async () => {
    expect(await labelOn(ben, declinedOk)).toEqual({ state: "declined", text: "Declined", private: true, other: "Ada" });
    expect(await labelOn(ada, declinedOk)).toEqual({ state: "declined", text: "Declined", private: true, other: "Ben" });
    expect(LOOP_WORDS.label.privateHint("Ada")).toBe("Only you and Ada see this.");
  });

  it("David and Olu, readers but not parties, read no label at all for it (not Noted either)", async () => {
    expect(await labelOn(david, declinedOk)).toBeNull();
    expect(await labelOn(olu, declinedOk)).toBeNull();
  });

  it("Olu reads her own Not a commitment (only she, there being no asker); nobody else does", async () => {
    expect(await labelOn(olu, dismissedMsg)).toEqual({ state: "dismissed", text: "Not a commitment", private: true, other: null });
    expect(LOOP_WORDS.label.privateHint(null)).toBe("Only you see this.");
    for (const c of [ada, ben, david]) expect(await labelOn(c, dismissedMsg)).toBeNull();
  });
});

describe("Noted and Done: every reader", () => {
  it("visible to every reader of the conversation, never private", async () => {
    for (const c of [ada, ben, david, olu]) {
      expect(await labelOn(c, notedMsg)).toEqual({ state: "noted", text: "Noted", private: false });
      expect(await labelOn(c, doneMsg)).toEqual({ state: "done", text: "Done", private: false });
    }
  });

  it("an open commitment and a declined one on one message: Noted for everyone, its two people included", async () => {
    expect(await withWorker((db) => db.query("SELECT state FROM message_labels WHERE message_id = $1", [mixedMsg]))).toEqual([{ state: "noted" }]);
    for (const c of [ada, ben, david, olu]) expect(await labelOn(c, mixedMsg)).toEqual({ state: "noted", text: "Noted", private: false });
  });
});

describe("the database agrees", () => {
  it("a raw SELECT under row-level security reads what the thread shows", async () => {
    expect(await rawStates(a.employee2)).toEqual({ [declinedOk]: "declined", [notedMsg]: "noted", [doneMsg]: "done", [mixedMsg]: "noted" });
    expect(await rawStates(a.employee)).toEqual({ [declinedOk]: "declined", [notedMsg]: "noted", [doneMsg]: "done", [mixedMsg]: "noted" });
    expect(await rawStates(oluUser)).toEqual({ [dismissedMsg]: "dismissed", [notedMsg]: "noted", [doneMsg]: "done", [mixedMsg]: "noted" });
    expect(await rawStates(a.manager)).toEqual({ [notedMsg]: "noted", [doneMsg]: "done", [mixedMsg]: "noted" });
    // The owner and HR do not read the channel: nothing.
    for (const u of [a.owner, a.hr]) expect(await rawStates(u)).toEqual({});
    // The worker reads them all.
    expect((await withWorker((db) => db.query("SELECT state FROM message_labels"))).length).toBe(5);
  });

  it("the label query hides a decline from a non-party even where the policy would not (before 0050 it is the only guard)", async () => {
    const asDavid = await withUser(david.user.profileId, (db) => C.labelsIn(db, design, [declinedOk, notedMsg]));
    expect([...asDavid.keys()]).toEqual([notedMsg]);
  });
});
