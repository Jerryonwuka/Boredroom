/**
 * Her identity on messages (owner decision, 8 October 2026: personal assistants, phase 3; migration 0037). A message is
 * written by the person ('person'), by the person's own assistant for them after they confirmed it ('via_assistant': her
 * send_message tool), or by the assistant itself ('assistant': only the worker writes it; reserved for phases 4 and 5).
 * Who may write which, who may change it afterwards, and what Messages, the inbox, the toasts and the notification say.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { resetTestDatabase, adminQuery, appQueryAs } from "../helpers/db";
import { buildCompany, type CompanyFixture } from "@/server/services/fixtures";
import { editMessage, inbox, incomingMessages, openChannel, openDirect, sendMessage, thread, withdrawMessage } from "@/server/services/messaging";
import { saveMyAssistant } from "@/server/services/assistant-profile";
import { notificationsView } from "@/server/services/views";
import { withWorker } from "@/server/db";

let a: CompanyFixture;
let b: CompanyFixture;
let adaBen: string; // the direct thread between Ada (whose assistant is Max) and Ben
let viaId: string; // Ada's message, sent by Max for her
let assistantId: string; // Max's own message in the Design channel, written by the worker

beforeAll(async () => {
  await resetTestDatabase();
  a = await buildCompany("a");
  b = await buildCompany("b");
  await saveMyAssistant(a.employeeCtx, { name: "Max", colour: "orange", visor: "band", eyes: "round" });
  adaBen = await openDirect(a.employeeCtx, a.employee2Ctx.membership.id);
});

describe("a message her assistant sent for her", () => {
  it("is 'via_assistant', carries her assistant, is hers, and Ben's notification says so", async () => {
    const before = new Date(Date.now() - 1000).toISOString();
    const sent = await sendMessage(a.employeeCtx, { conversationId: adaBen, body: "Can you send the landing page copy by 3?" }, { via: "assistant" });
    expect(sent.authorKind).toBe("via_assistant");
    viaId = sent.id;
    const row = (await adminQuery<{ author_kind: string; sender_membership_id: string }>("SELECT author_kind, sender_membership_id FROM messages WHERE id = $1", [sent.id]))[0];
    expect(row).toEqual({ author_kind: "via_assistant", sender_membership_id: a.employeeCtx.membership.id });

    // Before Ben opens it: his inbox and his toast feed know who sent it and through whom.
    const box = await inbox(a.employee2Ctx);
    const d = box.direct.find((c) => c.id === adaBen)!;
    expect(d).toMatchObject({ last_author_kind: "via_assistant", last_assistant_name: "Max", last_body: "Can you send the landing page copy by 3?", unread: 1, last_read_at: null });
    const incoming = await incomingMessages(a.employee2Ctx, before);
    expect(incoming.find((m) => m.id === sent.id)).toMatchObject({ author_kind: "via_assistant", assistant: { name: "Max", colour: "orange", visor: "band", eyes: "round" }, sender_name: "Ada Employee" });
    const notes = await notificationsView(a.employee2Ctx);
    expect(notes.some((n) => n.type === "message.direct" && n.title === "Ada Employee sent you a message via Max")).toBe(true);

    // In the thread it is Ada's own message for her (she can edit or withdraw it) and Ben's from her.
    const mine = (await thread(a.employeeCtx, adaBen))!.messages.find((m) => m.id === sent.id)!;
    expect(mine).toMatchObject({ author_kind: "via_assistant", mine: true, sender_name: "Ada Employee", assistant: { name: "Max", colour: "orange", visor: "band", eyes: "round" } });
    const his = (await thread(a.employee2Ctx, adaBen))!.messages.find((m) => m.id === sent.id)!;
    expect(his).toMatchObject({ author_kind: "via_assistant", mine: false, assistant: { name: "Max" } });
    // Opening it read it, as for any message.
    expect((await inbox(a.employee2Ctx)).direct.find((c) => c.id === adaBen)?.last_read_at).not.toBeNull();
  });

  it("names Brenda when the person never chose a name", async () => {
    const conv = await openDirect(a.employee2Ctx, a.managerCtx.membership.id);
    const sent = await sendMessage(a.employee2Ctx, { conversationId: conv, body: "Running ten minutes late." }, { via: "assistant" });
    const m = (await thread(a.managerCtx, conv))!.messages.find((x) => x.id === sent.id)!;
    expect(m.assistant).toEqual({ name: "Brenda", colour: "white", visor: "bean", eyes: "pill" });
    const notes = await notificationsView(a.managerCtx);
    expect(notes.some((n) => n.title === "Ben Employee sent you a message via Brenda")).toBe(true);
  });
});

describe("a message the person wrote", () => {
  it("stays 'person' with no assistant, everywhere", async () => {
    const before = new Date(Date.now() - 1000).toISOString();
    const sent = await sendMessage(a.employee2Ctx, { conversationId: adaBen, body: "Yes, on it.", replyToId: viaId });
    expect(sent.authorKind).toBe("person");
    const m = (await thread(a.employeeCtx, adaBen))!.messages.find((x) => x.id === sent.id)!;
    expect(m).toMatchObject({ author_kind: "person", assistant: null, mine: false, reply_to_id: viaId, reply_author_kind: "via_assistant", reply_assistant_name: "Max", reply_mine: true });
    const box = await inbox(a.employeeCtx);
    expect(box.direct.find((c) => c.id === adaBen)).toMatchObject({ last_author_kind: "person", last_assistant_name: null });
    const incoming = await incomingMessages(a.employeeCtx, before);
    expect(incoming.find((x) => x.id === sent.id)).toMatchObject({ author_kind: "person", assistant: null });
    const notes = await notificationsView(a.employeeCtx);
    expect(notes.some((n) => n.title === "Ben Employee sent you a message")).toBe(true);
  });

  it("an empty conversation has no last author", async () => {
    const conv = await openDirect(a.hrCtx, a.ownerCtx.membership.id);
    const box = await inbox(a.hrCtx);
    expect(box.direct.find((c) => c.id === conv)).toMatchObject({ last_author_kind: null, last_assistant_name: null, last_body: null });
  });
});

describe("who may write which", () => {
  const insert = (who: string, conv: string, org: string, sender: string, kind: string) => appQueryAs(who,
    "INSERT INTO messages(organisation_id, conversation_id, sender_membership_id, body, author_kind) VALUES ($1, $2, $3, 'Hello', $4) RETURNING id", [org, conv, sender, kind]);

  it("an ordinary insert may be the person or via their assistant, only as themself, never the assistant's own", async () => {
    const org = a.ownerCtx.org.id;
    await expect(insert(a.employee.profileId, adaBen, org, a.employeeCtx.membership.id, "assistant")).rejects.toThrow(/ASSISTANT_AUTHOR|row-level security/);
    await expect(insert(a.employee.profileId, adaBen, org, a.employee2Ctx.membership.id, "person")).rejects.toThrow(/row-level security/);
    await expect(insert(a.employee.profileId, adaBen, org, a.employee2Ctx.membership.id, "via_assistant")).rejects.toThrow(/row-level security/);
    // Another workspace cannot write into this thread at all.
    await expect(insert(b.employee.profileId, adaBen, org, b.employeeCtx.membership.id, "person")).rejects.toThrow();
    const ok = await insert(a.employee.profileId, adaBen, org, a.employeeCtx.membership.id, "via_assistant");
    expect(ok).toHaveLength(1);
    const plain = await appQueryAs(a.employee.profileId, "INSERT INTO messages(organisation_id, conversation_id, sender_membership_id, body) VALUES ($1, $2, $3, 'Plain') RETURNING author_kind", [org, adaBen, a.employeeCtx.membership.id]);
    expect(plain).toEqual([{ author_kind: "person" }]);
  });

  it("nobody but the worker changes who wrote a message, not even its sender", async () => {
    await expect(appQueryAs(a.employee.profileId, "UPDATE messages SET author_kind = 'person' WHERE id = $1", [viaId])).rejects.toThrow(/AUTHOR_KIND_FIXED/);
    await expect(appQueryAs(a.employee.profileId, "UPDATE messages SET author_kind = 'assistant' WHERE id = $1", [viaId])).rejects.toThrow(/AUTHOR_KIND_FIXED/);
    // Ben's rows are not Ada's to touch: the update matches nothing under row-level security.
    expect(await appQueryAs(a.employee2.profileId, "UPDATE messages SET author_kind = 'person' WHERE id = $1 RETURNING id", [viaId])).toHaveLength(0);
    // The guard binds the table owner too (a data fix sets app.role first).
    await expect(adminQuery("UPDATE messages SET author_kind = 'person' WHERE id = $1", [viaId])).rejects.toThrow(/AUTHOR_KIND_FIXED/);
    await withWorker((db) => db.query("UPDATE messages SET author_kind = 'person' WHERE id = $1", [viaId]));
    expect((await adminQuery<{ author_kind: string }>("SELECT author_kind FROM messages WHERE id = $1", [viaId]))[0].author_kind).toBe("person");
    await withWorker((db) => db.query("UPDATE messages SET author_kind = 'via_assistant' WHERE id = $1", [viaId]));
  });

  it("the database holds only the three kinds", async () => {
    await expect(withWorker((db) => db.query("INSERT INTO messages(organisation_id, conversation_id, sender_membership_id, body, author_kind) VALUES ($1, $2, $3, 'Beep', 'robot')",
      [a.ownerCtx.org.id, adaBen, a.employeeCtx.membership.id]))).rejects.toThrow(/messages_author_kind_check/);
  });
});

describe("an assistant's own message (written by the worker)", () => {
  it("shows with the assistant's name, is never its person's own, and only the worker changes it", async () => {
    const design = await openChannel(a.managerCtx, a.teamId);
    assistantId = (await withWorker((db) => db.one<{ id: string }>(
      "INSERT INTO messages(organisation_id, conversation_id, sender_membership_id, body, author_kind) VALUES ($1, $2, $3, 'Ada has finished the homepage draft.', 'assistant') RETURNING id",
      [a.ownerCtx.org.id, design, a.employeeCtx.membership.id]))).id;

    const forAda = (await thread(a.employeeCtx, design))!.messages.find((m) => m.id === assistantId)!;
    expect(forAda).toMatchObject({ author_kind: "assistant", mine: false, sender_membership_id: a.employeeCtx.membership.id, assistant: { name: "Max", colour: "orange" } });
    const forDavid = (await thread(a.managerCtx, design))!.messages.find((m) => m.id === assistantId)!;
    expect(forDavid).toMatchObject({ author_kind: "assistant", mine: false, assistant: { name: "Max" } });
    expect((await inbox(a.managerCtx)).channels.find((c) => c.id === design)).toMatchObject({ last_author_kind: "assistant", last_assistant_name: "Max" });

    // Its person cannot edit or withdraw it: the service finds nothing of theirs, and SQL is refused by the guard.
    await expect(editMessage(a.employeeCtx, assistantId, "Changed")).rejects.toMatchObject({ status: 404 });
    await expect(withdrawMessage(a.employeeCtx, assistantId)).rejects.toMatchObject({ status: 404 });
    await expect(appQueryAs(a.employee.profileId, "UPDATE messages SET body = 'Changed' WHERE id = $1", [assistantId])).rejects.toThrow(/ASSISTANT_AUTHOR/);
    await expect(appQueryAs(a.employee.profileId, "UPDATE messages SET deleted_at = now() WHERE id = $1", [assistantId])).rejects.toThrow(/ASSISTANT_AUTHOR/);
    expect((await adminQuery<{ body: string; deleted_at: string | null }>("SELECT body, deleted_at FROM messages WHERE id = $1", [assistantId]))[0]).toEqual({ body: "Ada has finished the homepage draft.", deleted_at: null });
    // The worker can.
    await withWorker((db) => db.query("UPDATE messages SET edited_at = now() WHERE id = $1", [assistantId]));

    // A reply quotes it by the assistant's name.
    const reply = await sendMessage(a.managerCtx, { conversationId: design, body: "Great, thanks.", replyToId: assistantId });
    const r = (await thread(a.employee2Ctx, design))!.messages.find((m) => m.id === reply.id)!;
    expect(r).toMatchObject({ reply_author_kind: "assistant", reply_assistant_name: "Max", reply_sender_name: "Ada Employee", reply_mine: false });
    expect((await thread(a.employeeCtx, design))!.messages.find((m) => m.id === reply.id)?.reply_mine).toBe(false);
  });

  it("the person still edits and withdraws what their assistant sent for them", async () => {
    await editMessage(a.employeeCtx, viaId, "Can you send the landing page copy by 4?");
    const m = (await thread(a.employee2Ctx, adaBen))!.messages.find((x) => x.id === viaId)!;
    expect(m).toMatchObject({ body: "Can you send the landing page copy by 4?", author_kind: "via_assistant", edited_at: expect.any(String), assistant: { name: "Max" } });
    await withdrawMessage(a.employeeCtx, viaId);
    const w = (await thread(a.employee2Ctx, adaBen))!.messages.find((x) => x.id === viaId)!;
    expect(w).toMatchObject({ body: "", deleted_at: expect.any(String), author_kind: "via_assistant" });
  });
});

describe("migration 0037", () => {
  it("runs twice more without error and keeps every message's author", async () => {
    const count = async () => (await adminQuery<{ author_kind: string; n: number }>("SELECT author_kind, count(*)::int AS n FROM messages GROUP BY author_kind ORDER BY author_kind"));
    const before = await count();
    expect(before.map((r) => r.author_kind)).toEqual(["assistant", "person", "via_assistant"]);
    const sql = readFileSync(join(process.cwd(), "db/migrations/0037_assistant_catch_up.sql"), "utf8");
    await adminQuery(sql);
    await adminQuery(sql);
    expect(await count()).toEqual(before);
    // The guard and the policies are still in place after the reruns.
    await expect(appQueryAs(a.employee.profileId, "UPDATE messages SET author_kind = 'person' WHERE id = $1", [viaId])).rejects.toThrow(/AUTHOR_KIND_FIXED/);
    const sent = await sendMessage(a.employeeCtx, { conversationId: adaBen, body: "Still here." }, { via: "assistant" });
    expect(sent.authorKind).toBe("via_assistant");
  });
});
