/**
 * Loose ends (owner decisions, 8 October 2026: phase 7b, "Brenda keeps the loops closed", second part). The person's
 * own assistant keeps what it found in the conversations they read (promises they made, asks of them, asks they made)
 * privately; each action goes through the path the person's own buttons use (a to-do, a reminder, an assistant request
 * the other person accepts, a follow-up made later as them), and "Not a commitment" is remembered for good.
 *
 * Company A: Grace Owner, Mary HR, David Lead (Design: Ada Nwosu, Ben Okafor), Sam Sales (leads Sales: Olu Adeyemi).
 * Local test database only (TEST_DATABASE_URL on localhost). No model (NODE_ENV test: the scan's built-in path).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { resetTestDatabase, adminQuery, appQueryAs } from "../helpers/db";
import { buildCompany, createVerifiedUser, joinViaInvitation, type CompanyFixture, type FixtureUser } from "@/server/services/fixtures";
import { createTeam, setTeamMember } from "@/server/services/orgs";
import { createChannel, openChannel, openDirect, sendMessage } from "@/server/services/messaging";
import * as LE from "@/server/services/loose-ends";
import { insertDetectedCommitments, saveCommitmentSettings } from "@/server/services/commitments";
import { scanLooseEnds } from "@/server/services/loose-end-detect";
import { LOOP_WORDS, type DetectedLooseEnd } from "@/lib/commitments";
import type { OrgContext } from "@/server/lib/api";

delete process.env.ANTHROPIC_API_KEY;

let a: CompanyFixture;
let owner: OrgContext, david: OrgContext, ada: OrgContext, ben: OrgContext, olu: OrgContext, sam: OrgContext;
let oluUser: FixtureUser;
let launch: string, salesChannel: string, adaDavid: string;
let promise: string, askedOfMe: string, iAsked: string;            // loose end ids
let promiseMsg: string, askedMsg: string, iAskedMsg: string;       // their messages

const id = (c: OrgContext) => c.membership.id;
const say = async (c: OrgContext, conversationId: string, body: string) => (await sendMessage(c, { conversationId, body }, { startMention: false })).id;
const found = (p: Pick<DetectedLooseEnd, "messageId" | "conversationId" | "kind" | "title"> & Partial<DetectedLooseEnd>): DetectedLooseEnd => ({
  contextMessageId: null, counterpartMembershipId: null, dueAt: null, dueWords: null, detectedBy: "builtin", confidence: 0.8, ...p,
});
const soon = (minutes: number) => new Date(Date.now() + minutes * 60_000);

beforeAll(async () => {
  await resetTestDatabase();
  a = await buildCompany("a", { names: { owner: "Grace Owner", hr: "Mary HR", manager: "David Lead", employee: "Ada Nwosu", employee2: "Ben Okafor" } });
  owner = a.ownerCtx; david = a.managerCtx; ada = a.employeeCtx; ben = a.employee2Ctx;
  const sales = (await createTeam(owner, "Sales")).id;
  oluUser = await createVerifiedUser("olu@company-a.test", "Olu Adeyemi");
  olu = await joinViaInvitation(a.hrCtx, oluUser, "employee", sales, "EMP-010");
  sam = await joinViaInvitation(owner, await createVerifiedUser("sam@company-a.test", "Sam Sales"), "manager", sales, "MGR-002");
  await setTeamMember(owner, sales, id(sam), { isManager: true });
  launch = (await createChannel(ada, { title: "Launch", memberIds: [id(ben)] })).id;
  salesChannel = await openChannel(sam, sales);
  adaDavid = await openDirect(ada, id(david));
  promiseMsg = await say(ada, launch, "I'll send the deck Thursday");
  askedMsg = await say(ben, launch, "Ada, can you review the pricing page by Friday?");
  iAskedMsg = await say(ada, launch, "Ben, can you fix the login bug?");
});

describe("keeping what was found", () => {
  it("as the person: promises, asks of them and asks they made, with their words read live", async () => {
    const views = await LE.insertLooseEnds(ada, [
      found({ messageId: promiseMsg, conversationId: launch, kind: "promise", title: "Send the deck", dueWords: "Thursday" }),
      found({ messageId: askedMsg, conversationId: launch, kind: "asked_of_me", counterpartMembershipId: id(ben), title: "Review the pricing page", dueWords: "by Friday" }),
      found({ messageId: iAskedMsg, conversationId: launch, kind: "i_asked", counterpartMembershipId: id(ben), title: "Fix the login bug" }),
    ], { source: "on_demand" });
    expect(views).toHaveLength(3);
    const by = (k: string) => views.find((v) => v.kind === k)!;
    promise = by("promise").id; askedOfMe = by("asked_of_me").id; iAsked = by("i_asked").id;
    expect(by("promise")).toMatchObject({
      status: "open", headline: "You said you'd “Send the deck”", counterpart: null, source: "on_demand", detectedBy: "builtin", actions: ["todo", "remind", "hand_over", "dismiss"],
      message: { id: promiseMsg, conversationId: launch, quote: "I'll send the deck Thursday", withdrawn: false, where: "#Launch", href: `/app/company-a/messages?c=${launch}#m-${promiseMsg}` },
      result: null, href: `/app/company-a/home/loose-ends?l=${promise}`,
    });
    expect(by("asked_of_me")).toMatchObject({ headline: "Ben asked you to “Review the pricing page”", counterpart: { membershipId: id(ben), firstName: "Ben" }, dueWords: "by Friday" });
    expect(by("i_asked")).toMatchObject({ headline: "You asked Ben to “Fix the login bug”", actions: ["follow_up", "hand_over", "remind", "todo", "dismiss"] });
    const list = await LE.listLooseEnds(ada);
    expect(list).toMatchObject({ ready: true, counts: { open: 3 } });
    expect(list.items.map((i) => i.id).sort()).toEqual([promise, askedOfMe, iAsked].sort());
    expect(list.lastScanAt).not.toBeNull();
    // The same again: kept once.
    expect(await LE.insertLooseEnds(ada, [found({ messageId: promiseMsg, conversationId: launch, kind: "promise", title: "Send the deck" })], { source: "routine" })).toEqual([]);
  });

  it("private: nobody else reads them, not the person asked, not her lead, not the owner, not HR", async () => {
    for (const who of [a.employee2, a.manager, a.owner, a.hr, oluUser]) {
      expect(await appQueryAs(who.profileId, "SELECT id FROM loose_ends")).toEqual([]);
      expect(await appQueryAs(who.profileId, "SELECT message_id FROM loose_end_dismissals")).toEqual([]);
    }
    for (const c of [ben, david, owner, olu]) expect((await LE.listLooseEnds(c)).items).toEqual([]);
    expect(await LE.getLooseEnd(ben, promise)).toBeNull();
    await expect(LE.dismissLooseEnd(ben, promise)).rejects.toMatchObject({ status: 404 });
    // Nothing of it in anyone's audit or activity.
    expect(await adminQuery("SELECT count(*)::int AS n FROM audit_events WHERE action LIKE 'loose_end%'")).toEqual([{ n: 0 }]);
  });

  it("only about messages the person reads: a conversation she cannot read is refused", async () => {
    const theirs = await say(sam, salesChannel, "Olu, can you send the forecast?");
    expect(await LE.insertLooseEnds(ada, [found({ messageId: theirs, conversationId: salesChannel, kind: "promise", title: "Send the forecast" })], { source: "on_demand" })).toEqual([]);
    // A message from one conversation filed under another: refused too.
    expect(await LE.insertLooseEnds(ada, [found({ messageId: theirs, conversationId: launch, kind: "promise", title: "Send the forecast" })], { source: "on_demand" })).toEqual([]);
    await expect(appQueryAs(a.employee.profileId,
      `INSERT INTO loose_ends(organisation_id, membership_id, message_id, conversation_id, kind, title, confidence, detected_by) VALUES ($1, $2, $3, $4, 'promise', 'Send the forecast', 0.9, 'builtin')`,
      [owner.org.id, id(ada), theirs, salesChannel])).rejects.toThrow(/row-level security/);
    // Nor for someone else.
    await expect(appQueryAs(a.employee.profileId,
      `INSERT INTO loose_ends(organisation_id, membership_id, message_id, conversation_id, kind, title, confidence, detected_by) VALUES ($1, $2, $3, $4, 'promise', 'Send the deck', 0.9, 'builtin')`,
      [owner.org.id, id(ben), promiseMsg, launch])).rejects.toThrow(/row-level security/);
  });
});

describe("what the person chooses", () => {
  it("make it a to-do: hers, with the message's link", async () => {
    await expect(LE.looseEndToTodo(ben, promise, { title: "Send the deck" })).rejects.toMatchObject({ status: 404 });
    const v = await LE.looseEndToTodo(ada, promise, { title: "Send the deck to Ben", dueAt: "2026-10-15T17:00:00+01:00" });
    expect(v).toMatchObject({ status: "todo", actions: [] });
    const [t] = await adminQuery<{ assignee_membership_id: string; created_by: string; title: string; expected_output: string }>(
      "SELECT assignee_membership_id, created_by, title, expected_output FROM tasks WHERE id = $1", [v.result!.taskId]);
    expect(t).toMatchObject({ assignee_membership_id: id(ada), created_by: id(ada), title: "Send the deck to Ben" });
    expect(t.expected_output).toBe(`From Messages: http://localhost:3000/app/company-a/messages?c=${launch}#m-${promiseMsg}`);
    await expect(LE.looseEndToTodo(ada, promise, { title: "Again" })).rejects.toMatchObject({ status: 409, code: "ITEM_CLOSED" });
  });

  it("remind me: a reminder for her, in the past refused", async () => {
    await expect(LE.looseEndRemind(ada, askedOfMe, { at: new Date(Date.now() - 3_600_000).toISOString() })).rejects.toMatchObject({ status: 422 });
    const v = await LE.looseEndRemind(ada, askedOfMe, { at: soon(24 * 60).toISOString() });
    expect(v.status).toBe("reminder");
    expect(await adminQuery("SELECT membership_id, body FROM brenda_reminders WHERE id = $1", [v.result!.reminderId])).toEqual([{ membership_id: id(ada), body: "Ben asked you to “Review the pricing page”" }]);
  });

  it("hand it to Ben's assistant: a request he accepts first", async () => {
    const v = await LE.looseEndHandOver(ada, iAsked, { to: id(ben), title: "Fix the login bug", note: "From our launch chat" });
    expect(v.status).toBe("handed");
    expect(await adminQuery("SELECT kind, request_kind, sender_membership_id, recipient_membership_id, status, payload->>'title' AS title, body FROM assistant_items WHERE id = $1", [v.result!.itemId]))
      .toEqual([{ kind: "request", request_kind: "add_todo", sender_membership_id: id(ada), recipient_membership_id: id(ben), status: "delivered", title: "Fix the login bug", body: "From our launch chat" }]);
    // Nothing on Ben's list until he accepts.
    expect(await adminQuery("SELECT count(*)::int AS n FROM tasks WHERE assignee_membership_id = $1 AND title = 'Fix the login bug'", [id(ben)])).toEqual([{ n: 0 }]);
  });

  it("follow up later: scheduled, then asked by the worker as the person, exactly that question of exactly that person", async () => {
    // David leads Ben, so his assistant may ask Ben's (the follow-up's own rules decide, at the time).
    const design = await openChannel(david, a.teamId);
    const msg = await say(david, design, "Ben, could you send the logo files?");
    const [v0] = await LE.insertLooseEnds(david, [found({ messageId: msg, conversationId: design, kind: "i_asked", counterpartMembershipId: id(ben), title: "Send the logo files" })], { source: "routine" });
    await expect(LE.looseEndFollowUpLater(david, v0.id, { at: soon(2).toISOString() })).rejects.toMatchObject({ status: 422 });
    await expect(LE.looseEndFollowUpLater(david, v0.id, { at: soon(61 * 24 * 60).toISOString() })).rejects.toMatchObject({ status: 422 });
    const at = soon(30);
    const v = await LE.looseEndFollowUpLater(david, v0.id, { at: at.toISOString() });
    expect(v).toMatchObject({ status: "follow_up_scheduled", result: { followUpAt: at.toISOString() } });
    expect(await LE.looseEndsDue()).toBe(false);
    expect(await LE.runDueLooseEndFollowUps()).toEqual({ asked: 0, failed: 0 });
    expect(await LE.looseEndsDue({ now: soon(31) })).toBe(true);
    expect(await LE.runDueLooseEndFollowUps({ now: soon(31) })).toEqual({ asked: 1, failed: 0 });
    const done = (await LE.getLooseEnd(david, v0.id))!;
    expect(done.status).toBe("follow_up");
    expect(await adminQuery("SELECT requester_membership_id, subject_membership_id, question, task_id FROM follow_ups WHERE id = $1", [done.result!.followUpId]))
      .toEqual([{ requester_membership_id: id(david), subject_membership_id: id(ben), question: "About “Send the logo files”: where is it?", task_id: null }]);
    expect(await adminQuery("SELECT type, payload FROM jobs WHERE dedup_key = $1", [`followup.process:loose:${v0.id}`])).toEqual([{ type: "followup.process", payload: { ids: [done.result!.followUpId] } }]);
    // Once only.
    expect(await LE.runDueLooseEndFollowUps({ now: soon(45) })).toEqual({ asked: 0, failed: 0 });
  });

  it("a follow-up the rules refuse goes back to open with their words; nothing is sent", async () => {
    // Ada and Ben are colleagues: her assistant may not follow up on him.
    const msg = await say(ada, launch, "Ben, could you share the brand fonts?");
    const [v0] = await LE.insertLooseEnds(ada, [found({ messageId: msg, conversationId: launch, kind: "i_asked", counterpartMembershipId: id(ben), title: "Share the brand fonts" })], { source: "routine" });
    await LE.looseEndFollowUpLater(ada, v0.id, { at: soon(30).toISOString() });
    const before = (await adminQuery<{ n: number }>("SELECT count(*)::int AS n FROM follow_ups"))[0].n;
    expect(await LE.runDueLooseEndFollowUps({ now: soon(31) })).toEqual({ asked: 0, failed: 1 });
    const back = (await LE.getLooseEnd(ada, v0.id))!;
    expect(back.status).toBe("open");
    expect(back.result?.error).toMatch(/^You can follow up only on/);
    expect(back.actions).toContain("follow_up");
    expect((await adminQuery<{ n: number }>("SELECT count(*)::int AS n FROM follow_ups"))[0].n).toBe(before);
    // In a direct thread, where says who it is with.
    const dmMsg = await say(ada, adaDavid, "David, can you sign off the budget?");
    const [dm] = await LE.insertLooseEnds(ada, [found({ messageId: dmMsg, conversationId: adaDavid, kind: "i_asked", counterpartMembershipId: id(david), title: "Sign off the budget" })], { source: "routine" });
    expect(dm.message.where).toBe("David Lead");
  });

  it("not a commitment: closed for good, never suggested again", async () => {
    const msg = await say(ben, launch, "Ada, can you bring snacks?");
    const [v0] = await LE.insertLooseEnds(ada, [found({ messageId: msg, conversationId: launch, kind: "asked_of_me", counterpartMembershipId: id(ben), title: "Bring snacks" })], { source: "on_demand" });
    expect(await LE.dismissLooseEnd(ada, v0.id)).toMatchObject({ status: "dismissed", actions: [] });
    expect((await LE.knownLooseEndMessages(ada, [msg, promiseMsg, iAskedMsg])).size).toBe(3);
    expect(await LE.knownLooseEndMessages(ben, [msg])).toEqual(new Set());
    // Even under another kind, a dismissed message is never kept again.
    expect(await LE.insertLooseEnds(ada, [found({ messageId: msg, conversationId: launch, kind: "promise", title: "Bring snacks" })], { source: "routine" })).toEqual([]);
    expect(await adminQuery("SELECT count(*)::int AS n FROM loose_end_dismissals WHERE membership_id = $1 AND message_id = $2", [id(ada), msg])).toEqual([{ n: 1 }]);
  });

  it("the owner holds no to-dos: the action is not offered, and refused", async () => {
    const everyone = await openChannel(owner, null);
    const msg = await say(owner, everyone, "I'll sign the contracts Friday");
    const [v0] = await LE.insertLooseEnds(owner, [found({ messageId: msg, conversationId: everyone, kind: "promise", title: "Sign the contracts" })], { source: "on_demand" });
    expect(v0.actions).toEqual(["remind", "hand_over", "dismiss"]);
    await expect(LE.looseEndToTodo(owner, v0.id, { title: "Sign the contracts" })).rejects.toMatchObject({ status: 403 });
  });

  it("captured as a commitment since: done elsewhere", async () => {
    const msg = await say(ada, launch, "I'll write the FAQ");
    const [v0] = await LE.insertLooseEnds(ada, [found({ messageId: msg, conversationId: launch, kind: "promise", title: "Write the FAQ" })], { source: "on_demand" });
    await saveCommitmentSettings(owner, { track: true });
    const r = await insertDetectedCommitments(owner.org.id, [{ conversationId: launch, sourceMessageId: msg, agreementMessageId: null, kind: "promise", committerMembershipId: id(ada), askerMembershipId: null, title: "Write the FAQ", dueAt: null, dueWords: null, detectedBy: "builtin", confidence: 0.9, messageAt: new Date().toISOString() }]);
    expect(r.created).toHaveLength(1);
    await LE.listLooseEnds(ada);
    expect((await LE.getLooseEnd(ada, v0.id))!.status).toBe("resolved");
    expect(await LE.knownLooseEndMessages(ada, [msg])).toEqual(new Set([msg]));
  });
});

describe("the scan, built in (no model)", () => {
  it("finds her promise and the ask of her, and keeps them", async () => {
    const dm = await openDirect(ben, id(ada));
    const p = await say(ada, dm, "I'll send the slides tomorrow");
    const q = await say(ben, dm, "Can you review the budget by Friday?");
    const r = await scanLooseEnds(ada, { source: "on_demand", useModel: false });
    expect(r.ready).toBe(true);
    expect(r.engine === "builtin" || r.engine === "none").toBe(true);
    const kinds = new Map(r.found.map((f) => [f.message.id, f.kind]));
    expect(kinds.get(p)).toBe("promise");
    expect(kinds.get(q)).toBe("asked_of_me");
    // Within two minutes, "Look again" waits.
    await expect(scanLooseEnds(ada, { source: "on_demand", useModel: false })).rejects.toMatchObject({ status: 429, message: LOOP_WORDS.errors.scanCooldown });
    // A second look keeps nothing twice.
    const again = await scanLooseEnds(ada, { source: "routine", useModel: false });
    expect(again.found.some((f) => f.message.id === p || f.message.id === q)).toBe(false);
  });
});
