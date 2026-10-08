/**
 * Before migration 0043 (owner decision, 8 October 2026: personal assistants, phase 6; integration review, 8 October
 * 2026): the code ships before the database update (a deploy, the running dev server), so every entry point must degrade
 * and say so, and phases 4 and 5 must behave exactly as before. The test schema here is built from every migration
 * except 0043.
 *
 * Local test database only (TEST_DATABASE_URL, embedded PostgreSQL on localhost). No model.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import { adminQuery, adminUrl } from "../helpers/db";
import { buildCompany, type CompanyFixture } from "@/server/services/fixtures";
import { saveMyAssistant } from "@/server/services/assistant-profile";
import { runBrendaTool, chatBuiltin, confirmAction, type Proposal } from "@/server/services/copilot";
import {
  acceptItem, assistantItemsForDesktop, assistantTalkPreferences, listAssistantItems, listMutes, reportNoteSettings, setMute, sweepAssistantItems, waitingItems,
  reportNotesFor,
} from "@/server/services/assistant-items";
import { desktopState } from "@/server/services/desktop";
import { openChannel, sendMessage, thread, type SendInput } from "@/server/services/messaging";
import { processMention } from "@/server/services/mention-processor";
import { teamReportNow } from "@/server/services/daily-report";
import { withUser } from "@/server/db";
import { ASSISTANT_TALK_NOT_READY } from "@/lib/assistant-items";
import type { OrgContext } from "@/server/lib/api";

delete process.env.ANTHROPIC_API_KEY;

let a: CompanyFixture;
let david: OrgContext, olu: OrgContext, ben: OrgContext;
let design: string;
const id = (c: OrgContext) => c.membership.id;
type Token = NonNullable<SendInput["mentions"]>[number];
const confirmOf = (proposals: Proposal[]) => proposals.find((p): p is Extract<Proposal, { kind: "confirm" }> => p.kind === "confirm");

/** As resetTestDatabase, but stopping before 0043. */
async function schemaBefore0043() {
  const c = new Client({ connectionString: adminUrl() });
  await c.connect();
  try {
    await c.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT USAGE ON SCHEMA public TO PUBLIC;");
    await c.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    const dir = join(process.cwd(), "db", "migrations");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql") && f < "0043").sort()) {
      await c.query("BEGIN");
      await c.query(readFileSync(join(dir, file), "utf8"));
      await c.query("INSERT INTO schema_migrations(name) VALUES ($1)", [file]);
      await c.query("COMMIT");
    }
  } finally { await c.end(); }
  await adminQuery("UPDATE plans SET max_users = NULL WHERE code = 'free'");
}

beforeAll(async () => {
  await schemaBefore0043();
  expect(await adminQuery("SELECT to_regclass('public.assistant_items') AS t")).toEqual([{ t: null }]);
  a = await buildCompany("a", { names: { owner: "Ada Owner", employee: "Olu Adeyemi", employee2: "Ben Okafor" } });
  david = a.managerCtx; olu = a.employeeCtx; ben = a.employee2Ctx;
  await saveMyAssistant(olu, { name: "Max", colour: "blue", visor: "band", eyes: "round" });
  design = await openChannel(david, a.teamId);
});

describe("phase 6 says it needs the update", () => {
  it("her five tools answer in words, and the built-in helper says the same", async () => {
    for (const [tool, input] of [
      ["pass_message", { to: "Ben Okafor", body: "Hello" }],
      ["hand_over_request", { to: "Ben Okafor", kind: "add_todo", title: "Review pricing" }],
      ["add_report_note", { body: "We shipped." }],
      ["assistant_inbox", {}],
      ["respond_to_item", { itemId: "00000000-0000-4000-8000-000000000000", action: "seen" }],
    ] as const) {
      const r = await runBrendaTool(olu, tool, input);
      expect(r.out, tool).toMatchObject({ error: ASSISTANT_TALK_NOT_READY });
      expect(confirmOf(r.proposals), tool).toBeUndefined();
    }
    const helper = await chatBuiltin(olu, [{ role: "user", content: "Tell Ben's assistant the client moved the deadline to Friday" }]);
    expect(helper.reply).toContain(ASSISTANT_TALK_NOT_READY);
    expect(confirmOf(helper.proposals)).toBeUndefined();
  });

  it("the service reads answer ready: false and the steps answer 503", async () => {
    expect(await listAssistantItems(ben, { box: "waiting" })).toEqual({ ready: false, items: [], nextBefore: null });
    expect(await waitingItems(ben)).toEqual([]);
    expect(await listMutes(ben)).toMatchObject({ ready: false, mutes: [] });
    expect(await assistantTalkPreferences(ben)).toMatchObject({ ready: false, allowThreadReplies: true });
    expect(await withUser(ben.user.profileId, (db) => reportNoteSettings(db, ben.org.id))).toMatchObject({ ready: false, enabled: true });
    expect(await reportNotesFor(david, "2026-10-08")).toEqual([]);
    await expect(acceptItem(ben, "00000000-0000-4000-8000-000000000000")).rejects.toMatchObject({ status: 503, code: "NOT_READY" });
    await expect(setMute(ben, id(olu), true)).rejects.toMatchObject({ status: 503 });
    expect(await sweepAssistantItems()).toEqual({ expired: 0, interrupted: 0, notesSettled: 0 });
  });

  it("the notch gets ready: false and the rest of its state", async () => {
    expect(await assistantItemsForDesktop(ben)).toEqual({ ready: false, waiting: [], updates: [] });
    const s = await desktopState(ben);
    expect((s as unknown as { assistantItems: unknown }).assistantItems).toEqual({ ready: false, waiting: [], updates: [] });
    expect(s.followUps).toBeTruthy();
  });

  it("the worker's schedule queues nothing and its job returns at once", async () => {
    const { scheduleAssistantItemSweep, scheduleMentionSweep } = await import("../../worker/schedule");
    expect(await scheduleAssistantItemSweep()).toEqual({ queued: false, due: false });
    await expect(scheduleMentionSweep()).resolves.toBeTruthy();
    const { handlers } = await import("../../worker/handlers");
    await expect(handlers["assistant_item.sweep"]({}, { jobId: "test", attempt: 1 })).resolves.toBeUndefined();
  });
});

describe("phases 4 and 5 as before", () => {
  it("Messages offers no one else's assistant and drops such a token; @Max still answers", async () => {
    const t = (await thread(olu, design))!;
    expect(t.taggable).toEqual([]);
    const other = await sendMessage(david, { conversationId: design, body: "@Ben's Brenda where is the deck?", mentions: [{ kind: "others_assistant", membershipId: id(ben), label: "@Ben's Brenda" } as unknown as Token] }, { startMention: false });
    expect(other.mentionId ?? null).toBeNull();
    const own = await sendMessage(olu, { conversationId: design, body: "@Max what's on my list?", mentions: [{ kind: "assistant", label: "@Max" } as Token] }, { startMention: false });
    expect(own.mentionId).toBeTruthy();
    expect(await processMention(own.mentionId!, { useModel: false })).toBeTruthy();
    const replyOf = (await adminQuery<{ status: string }>("SELECT status FROM assistant_mentions WHERE id = $1", [own.mentionId]))[0];
    expect(["answered", "private", "waiting_confirm", "refused"]).toContain(replyOf.status);
  });

  it("a follow-up is asked and confirmed as before", async () => {
    const r = await runBrendaTool(david, "follow_up", { people: ["Ben Okafor"], question: "Where are you on the pricing page?" });
    const card = confirmOf(r.proposals);
    expect(card).toBeTruthy();
    const done = await confirmAction(david, card!.token, { start: false });
    expect(done.error).toBeNull();
    expect((await adminQuery<{ n: number }>("SELECT count(*)::int AS n FROM follow_ups"))[0].n).toBe(1);
  });

  it("the team report has no Notes section", async () => {
    const r = await teamReportNow(david, { useAssistant: false });
    expect(JSON.stringify(r)).not.toContain("Notes from the team");
  });
});
