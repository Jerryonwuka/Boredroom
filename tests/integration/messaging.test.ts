/**
 * Messaging: direct threads across teams, team and organisation channels, unread counts, task references,
 * withdrawing, and tenancy (a channel never leaks outside its team or organisation).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { resetTestDatabase, adminQuery, appQueryAs } from "../helpers/db";
import { buildCompany, type CompanyFixture } from "@/server/services/fixtures";
import { inbox, openDirect, openChannel, thread, sendMessage, withdrawMessage, peopleToMessage } from "@/server/services/messaging";
import { navCounts } from "@/server/services/workspace";
import { notificationsView } from "@/server/services/views";

let a: CompanyFixture;
let b: CompanyFixture;

beforeAll(async () => {
  await resetTestDatabase();
  a = await buildCompany("a");
  b = await buildCompany("b");
});

describe("channels", () => {
  it("everyone sees the organisation channel; team channels only appear for team members", async () => {
    const ada = await inbox(a.employeeCtx);
    expect(ada.channels.map((c) => c.title)).toEqual(["Everyone", "Design"]);
    const hr = await inbox(a.hrCtx);
    expect(hr.channels.map((c) => c.title)).toEqual(["Everyone"]);
    expect(hr.direct).toEqual([]);
  });

  it("a team lead posts in the team channel; teammates read it, HR outside the team cannot open it", async () => {
    const design = await openChannel(a.managerCtx, a.teamId);
    await sendMessage(a.managerCtx, { conversationId: design, body: "Stand-up moved to 10:00 tomorrow." });
    const seenByAda = await thread(a.employeeCtx, design);
    expect(seenByAda?.messages.map((m) => m.body)).toEqual(["Stand-up moved to 10:00 tomorrow."]);
    expect(seenByAda?.messages[0].sender_name).toBe("David Manager");
    expect(seenByAda?.conversation.people.map((p) => p.display_name).sort()).toEqual(["Ada Employee", "Ben Employee", "David Manager"]);
    expect(await thread(a.hrCtx, design)).toBeNull();
    await expect(openChannel(a.hrCtx, a.teamId)).rejects.toMatchObject({ code: "42501" });
    await expect(sendMessage(a.hrCtx, { conversationId: design, body: "Sneaking in" })).rejects.toMatchObject({ status: 404 });
  });

  it("another organisation cannot read the Everyone channel", async () => {
    const everyone = await openChannel(a.ownerCtx, null);
    await sendMessage(a.ownerCtx, { conversationId: everyone, body: "Welcome aboard, all." });
    expect(await thread(b.ownerCtx, everyone)).toBeNull();
    expect(await appQueryAs(b.owner.profileId, `SELECT id FROM messages WHERE conversation_id = $1`, [everyone])).toEqual([]);
    expect((await thread(a.employee2Ctx, everyone))?.messages.map((m) => m.body)).toEqual(["Welcome aboard, all."]);
  });
});

describe("direct messages", () => {
  it("HR (outside the Design team) messages Ada; Ada is notified, sees one unread, and the count clears on opening", async () => {
    const people = await peopleToMessage(a.hrCtx);
    expect(people.map((p) => p.display_name)).toEqual(["Ada Employee", "Ben Employee", "David Manager", "Olu Owner"]);
    const conv = await openDirect(a.hrCtx, a.employeeCtx.membership.id);
    expect(await openDirect(a.employeeCtx, a.hrCtx.membership.id)).toBe(conv);
    const before = (await navCounts(a.employeeCtx)).messages; // the unopened "Everyone" post from the owner
    const hrBefore = (await navCounts(a.hrCtx)).messages;
    await sendMessage(a.hrCtx, { conversationId: conv, body: "Hi Ada, how far with the onboarding forms?" });
    expect((await navCounts(a.employeeCtx)).messages).toBe(before + 1);
    expect((await navCounts(a.hrCtx)).messages).toBe(hrBefore); // your own message is never unread for you
    const box = await inbox(a.employeeCtx);
    const d = box.direct.find((c) => c.id === conv)!;
    expect(d.title).toBe("Mary HR");
    expect(d.subtitle).toBe("HR");
    expect(d.unread).toBe(1);
    expect(d.last_body).toBe("Hi Ada, how far with the onboarding forms?");
    const notes = await notificationsView(a.employeeCtx);
    expect(notes.some((n) => n.type === "message.direct" && n.title.startsWith("Mary HR sent you a message") && n.href?.includes(`c=${conv}`))).toBe(true);
    const t = await thread(a.employeeCtx, conv);
    expect(t?.conversation.subtitle).toBe("HR");
    expect(t?.messages[0].mine).toBe(false);
    expect((await navCounts(a.employeeCtx)).messages).toBe(before);
    await sendMessage(a.employeeCtx, { conversationId: conv, body: "Done, sent them this morning." });
    const hrView = await thread(a.hrCtx, conv);
    expect(hrView?.conversation.title).toBe("Ada Employee");
    expect(hrView?.conversation.subtitle).toBe("Staff, Design");
    expect(hrView?.messages.map((m) => [m.sender_name, m.mine])).toEqual([["Mary HR", true], ["Ada Employee", false]]);
  });

  it("nobody else can read a direct thread, not even the team lead or the owner", async () => {
    const conv = await openDirect(a.hrCtx, a.employeeCtx.membership.id);
    expect(await thread(a.managerCtx, conv)).toBeNull();
    expect(await thread(a.ownerCtx, conv)).toBeNull();
    expect(await appQueryAs(a.manager.profileId, `SELECT id FROM messages WHERE conversation_id = $1`, [conv])).toEqual([]);
    await expect(sendMessage(a.employee2Ctx, { conversationId: conv, body: "Hello?" })).rejects.toMatchObject({ status: 404 });
  });

  it("you cannot message yourself or someone in another organisation", async () => {
    await expect(openDirect(a.employeeCtx, a.employeeCtx.membership.id)).rejects.toMatchObject({ status: 422 });
    await expect(openDirect(a.employeeCtx, b.employeeCtx.membership.id)).rejects.toMatchObject({ status: 404 });
  });
});

describe("asking about a task", () => {
  it("a message can point at a task the sender can see; the thread shows its title and status", async () => {
    const conv = await openDirect(a.managerCtx, a.employeeCtx.membership.id);
    await sendMessage(a.managerCtx, { conversationId: conv, body: "How far with “Homepage design”?", taskId: a.taskIds.homepage });
    const t = await thread(a.employeeCtx, conv);
    expect(t?.messages.at(-1)).toMatchObject({ task_id: a.taskIds.homepage, task_title: "Homepage design", task_status: "todo" });
    const notes = await notificationsView(a.employeeCtx);
    expect(notes.some((n) => n.title === "David Manager sent you a message about “Homepage design”")).toBe(true);
    // A task from another organisation is not visible, so it cannot be attached.
    const bConv = await openDirect(b.ownerCtx, b.employeeCtx.membership.id);
    await expect(sendMessage(b.ownerCtx, { conversationId: bConv, body: "About this", taskId: a.taskIds.homepage })).rejects.toMatchObject({ status: 422 });
  });
});

describe("withdrawing", () => {
  it("the sender can withdraw their own message; others cannot; the thread keeps the line", async () => {
    const conv = await openDirect(a.employeeCtx, a.employee2Ctx.membership.id);
    const m = await sendMessage(a.employeeCtx, { conversationId: conv, body: "Wrong thread, ignore." });
    await expect(withdrawMessage(a.employee2Ctx, m.id)).rejects.toMatchObject({ status: 404 });
    await withdrawMessage(a.employeeCtx, m.id);
    const t = await thread(a.employee2Ctx, conv);
    expect(t?.messages[0]).toMatchObject({ body: "", deleted_at: expect.any(String) });
    const row = (await adminQuery<{ deleted_at: string | null }>(`SELECT deleted_at FROM messages WHERE id = $1`, [m.id]))[0];
    expect(row.deleted_at).not.toBeNull();
    const box = await inbox(a.employee2Ctx);
    expect(box.direct.find((c) => c.id === conv)?.last_body).toBe("");
    // Withdrawn messages do not count as unread.
    expect(box.direct.find((c) => c.id === conv)?.unread).toBe(0);
  });
});
