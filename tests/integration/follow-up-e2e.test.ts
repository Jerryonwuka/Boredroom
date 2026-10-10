/**
 * Follow-ups between assistants, end to end (owner decision, 8 October 2026: personal assistants, phase 4; integration
 * review, 8 October 2026). The whole protocol through the same doors the app uses: the person's assistant prepares the
 * Confirm (her tool, or the built-in helper), the Confirm press creates the follow-ups and starts the fast path in this
 * process (outside a request `after()` is not available, so it runs as the un-awaited promise the service falls back
 * to), the subject replies, the worker's handlers settle deadlines and run the workspace's collection, and the
 * end-of-day report carries the Updates. Along the way: what each side is told (notifications, the notch's state, the
 * pages' lists, the activity log, the audit trail), the realtime events, every refusal and every cap.
 *
 * Local test database only; the model is never called (the key is dropped and the service never reaches it in tests).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { resetTestDatabase, adminQuery, adminUrl } from "../helpers/db";
import { buildCompany, type CompanyFixture } from "@/server/services/fixtures";
import { addComment, createTask, quickTodo, updateTask } from "@/server/services/tasks";
import { saveMyAssistant } from "@/server/services/assistant-profile";
import { runBrendaTool, confirmAction, chatBuiltin, type Proposal } from "@/server/services/copilot";
import {
  getFollowUp, getFollowUpBatch, listFollowUpsAboutMe, listMyFollowUps, replyToFollowUp, saveFollowUpPreference, saveFollowUpSettings,
  waitingForMe, workspaceUpdatesFor,
} from "@/server/services/follow-ups";
import { desktopState } from "@/server/services/desktop";
import { teamReportNow } from "@/server/services/daily-report";
import { todayLocal } from "@/server/lib/time";
import type { OrgContext } from "@/server/lib/api";
import type { FollowUpFacts } from "@/lib/follow-ups";

delete process.env.ANTHROPIC_API_KEY;

let a: CompanyFixture;
let olu: OrgContext, mary: OrgContext, david: OrgContext, ada: OrgContext, ben: OrgContext;
let pricing: string;   // "Pricing page copy": Ben holds it (fixture)
let table: string;     // "Pricing table": Ben holds it, made by David
const TZ = "Africa/Lagos";

// ---- Helpers ------------------------------------------------------------------------------------------------------------

const confirmOf = (proposals: Proposal[]) => proposals.find((p): p is Extract<Proposal, { kind: "confirm" }> => p.kind === "confirm");
const row = async (id: string) => (await adminQuery<Record<string, unknown>>("SELECT * FROM follow_ups WHERE id = $1", [id]))[0];
const rowsOf = (batchId: string) => adminQuery<Record<string, unknown>>("SELECT * FROM follow_ups WHERE batch_id = $1 ORDER BY created_at, id", [batchId]);
const notesTo = (ctx: OrgContext, type: string) =>
  adminQuery<{ title: string; body: string | null; href: string | null; resource_id: string | null; read_at: string | null }>(
    "SELECT title, body, href, resource_id, read_at FROM notifications WHERE recipient_membership_id = $1 AND type = $2 ORDER BY created_at", [ctx.membership.id, type]);

/** Waits (at most 10 s) until nothing in the batch is still being worked on in this process (pending or answering). */
async function settled(batchId: string) {
  for (let i = 0; i < 200; i++) {
    const open = await adminQuery("SELECT 1 FROM follow_ups WHERE batch_id = $1 AND status IN ('pending', 'answering')", [batchId]);
    if (!open.length) return rowsOf(batchId);
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`batch ${batchId} did not settle`);
}

/** The person presses Confirm on what their assistant prepared; the fast path starts in this process (no `start: false`). */
async function press(ctx: OrgContext, proposals: Proposal[]) {
  const c = confirmOf(proposals);
  if (!c) throw new Error("no Confirm was prepared");
  const r = await confirmAction(ctx, c.token);
  return { ...r, card: c };
}

/** Moves every signal by this person back three days (triggers off for the move), so their work says nothing recent. */
async function ageSignals(ctx: OrgContext) {
  const m = ctx.membership.id;
  await adminQuery(`SET session_replication_role = replica;
    UPDATE task_comments SET created_at = created_at - interval '3 days' WHERE author_membership_id = '${m}';
    UPDATE task_status_history SET occurred_at = occurred_at - interval '3 days' WHERE actor_membership_id = '${m}';
    UPDATE task_submissions SET submitted_at = submitted_at - interval '3 days' WHERE submitted_by = '${m}';
    UPDATE session_intervals SET started_at = started_at - interval '3 days', ended_at = ended_at - interval '3 days' WHERE membership_id = '${m}';
    SET session_replication_role = origin;`);
}

/** The organisation's realtime channel, as the events route hears it (ids only). */
let listener: Client | null = null;
const heard: { table: string; op: string; id: string }[] = [];

beforeAll(async () => {
  await resetTestDatabase();
  a = await buildCompany("a", { names: { owner: "Olu Adeyemi", employee2: "Ben Okafor" } });
  olu = a.ownerCtx; mary = a.hrCtx; david = a.managerCtx; ada = a.employeeCtx; ben = a.employee2Ctx;
  await saveMyAssistant(olu, { name: "Max", colour: "blue", visor: "band", eyes: "round" });
  pricing = a.taskIds.second;
  table = (await createTask(david, { projectId: a.projectId, title: "Pricing table", expectedOutput: "The table, done.", assigneeMembershipId: ben.membership.id, reviewerMembershipId: david.membership.id, category: "work", priority: "normal", estimateMinutes: null, dueAt: null, addToMyDay: false })).id;
  listener = new Client({ connectionString: adminUrl() });
  await listener.connect();
  listener.on("notification", (n) => { try { heard.push(JSON.parse(n.payload ?? "{}")); } catch { /* not ours */ } });
  await listener.query(`LISTEN org_${olu.org.id.replace(/-/g, "")}`);
});

afterAll(async () => { await listener?.end().catch(() => undefined); });

// ---- 1. Answered from the facts, without disturbing the person ---------------------------------------------------------

describe("request → answered from the facts", () => {
  let batchId = "";
  let fid = "";

  it("Olu asks her Max where Ben is on the pricing page; Ben's recent comment answers it and Ben is never disturbed", async () => {
    await addComment(ben, pricing, "Copy is done, waiting on images");
    const prepared = await runBrendaTool(olu, "follow_up", { people: ["Ben Okafor"], taskId: pricing, question: "Where are you on the pricing page?" });
    expect(prepared.actions).toEqual([]);
    expect(await adminQuery("SELECT 1 FROM follow_ups")).toHaveLength(0); // nothing before the Confirm
    const r = await press(olu, prepared.proposals);
    expect(r.card.summary).toBe("Ask Ben's assistant about “Pricing page copy”? If Ben's work doesn't answer it, Ben is asked once.");
    expect(r.error).toBeNull();
    batchId = r.actions[0].followUpBatchId!;
    const [f] = await settled(batchId);
    fid = f.id as string;
    expect(f).toMatchObject({ status: "answered", answered_from: "facts", fresh: true, capped: false, answer_engine: "template", reply_choice: null, asked_at: null });
    expect(f.answer).toMatch(/^“Pricing page copy” is .+ Ben's latest update was a comment .+: “Copy is done, waiting on images”\.$/);
    expect(await notesTo(ben, "brenda.followup_ask")).toEqual([]);
  });

  it("tells Olu (bell and notch), shows her the exchange, and closes the batch once", async () => {
    const [note] = await notesTo(olu, "brenda.followup_answer");
    expect(note).toMatchObject({ title: "Ben's Brenda answered about “Pricing page copy”", resource_id: fid, href: `/app/company-a/home/follow-ups/${fid}`, read_at: null });
    expect(note.body).toContain("Copy is done, waiting on images");
    const batch = await getFollowUpBatch(olu, batchId);
    expect(batch).toMatchObject({ kind: "person", counts: { total: 1, open: 0, answered: 1 }, summary: "1 person: 1 answered from their work." });
    expect(batch!.completedAt).not.toBeNull();
    const view = batch!.items[0];
    expect(view).toMatchObject({ viewer: "requester", status: "answered", answeredFrom: "facts", requester: { name: "Olu Adeyemi", assistant: { name: "Max" } }, subject: { name: "Ben Okafor", assistant: { name: "Brenda" } }, canReply: false, canCancel: false });
    expect((view.facts as FollowUpFacts).task?.title).toBe("Pricing page copy");
    // A one-person ask is told per follow-up, never as a group too.
    expect(await notesTo(olu, "brenda.followup_batch")).toEqual([]);
    const notch = (await desktopState(olu)).followUps;
    expect(notch.answered.map((x) => x.id)).toEqual([fid]);
    expect(notch.answered[0]).toMatchObject({ status: "answered", subject: { name: "Ben Okafor" }, href: `/app/company-a/home/follow-ups/${fid}` });
  });

  it("shows Ben exactly what his assistant shared, logs it in his own activity, and audits only metadata", async () => {
    const about = await listFollowUpsAboutMe(ben);
    expect(about.waiting).toEqual([]);
    expect(about.items.map((v) => v.id)).toEqual([fid]);
    expect(about.items[0]).toMatchObject({ viewer: "subject", answeredFrom: "facts" });
    expect(about.items[0].facts).not.toBeNull();
    const logged = await adminQuery<{ summary: string; detail: { personalSummary: string } }>("SELECT summary, detail FROM brenda_actions WHERE membership_id = $1 AND tool = 'follow_up_answer'", [ben.membership.id]);
    expect(logged).toEqual([{ summary: "Answered a follow-up from your work", detail: expect.objectContaining({ personalSummary: "Answered Olu's Max about “Pricing page copy” from your work" }) }]);
    const audit = await adminQuery<{ action: string; subject_membership_id: string; metadata: Record<string, unknown> }>(
      "SELECT action, subject_membership_id, metadata FROM audit_events WHERE action LIKE 'followup.%' AND subject_id = $1::uuid ORDER BY occurred_at", [fid]);
    expect(audit.map((x) => x.action)).toEqual(["followup.requested", "followup.answered"]);
    for (const x of audit) {
      expect(x.subject_membership_id).toBe(ben.membership.id);
      expect(JSON.stringify(x.metadata)).not.toMatch(/pricing page\?|waiting on images/i);
    }
  });

  it("sent ids only on the organisation's realtime channel, for the follow-up and its batch", async () => {
    await new Promise((r) => setTimeout(r, 100));
    expect(heard.some((h) => h.table === "follow_ups" && h.id === fid && h.op === "INSERT")).toBe(true);
    expect(heard.some((h) => h.table === "follow_ups" && h.id === fid && h.op === "UPDATE")).toBe(true);
    expect(heard.some((h) => h.table === "follow_up_batches" && h.id === batchId)).toBe(true);
    expect(JSON.stringify(heard)).not.toMatch(/waiting on images|pricing page\?/i);
  });
});

// ---- 2. Asked once, replied, answered ---------------------------------------------------------------------------------------

describe("request → ask → reply → answer", () => {
  let fid = "";

  it("the built-in helper offers the same Confirm; Ben's work says nothing recent, so his assistant asks him once", async () => {
    await ageSignals(ben);
    const helper = await chatBuiltin(olu, [{ role: "user", content: "Where is Ben on the pricing page?" }]);
    expect(helper.reply).toBe("I can ask Ben's assistant about **Pricing page copy**. Press Confirm and Ben's assistant answers from Ben's work, or asks Ben once.");
    const r = await press(olu, helper.proposals);
    const [f] = await settled(r.actions[0].followUpBatchId!);
    fid = f.id as string;
    expect(f).toMatchObject({ status: "asking", fresh: false, answer: null });
    // Four working hours on the organisation's clock, never before the ask.
    expect(new Date(f.deadline_at as string).getTime()).toBeGreaterThan(new Date(f.asked_at as string).getTime());
    const [ask] = await notesTo(ben, "brenda.followup_ask");
    expect(ask).toMatchObject({ title: "Olu's Max wants an update on “Pricing page copy”", resource_id: fid, href: `/app/company-a/home/follow-ups/about-you?f=${fid}`, read_at: null });
    expect(ask.body).toMatch(/^Reply in a tap or say not now\. If you don't reply by .+, Max gets what your work shows\.$/);
  });

  it("Ben sees it waiting on his page and in his notch, with what his assistant will share; Olu sees it asking", async () => {
    expect((await waitingForMe(ben)).map((v) => v.id)).toEqual([fid]);
    const notch = (await desktopState(ben)).followUps;
    expect(notch.waiting).toHaveLength(1);
    expect(notch.waiting[0]).toMatchObject({ id: fid, title: "Olu's Max wants an update on “Pricing page copy”", taskTitle: "Pricing page copy", asker: { name: "Olu Adeyemi", assistant: { name: "Max" } } });
    expect(notch.waiting[0].facts.length).toBeGreaterThan(0);
    const mine = await getFollowUp(olu, fid);
    expect(mine).toMatchObject({ status: "asking", canCancel: true, canReply: false, facts: null, reply: null });
    // Nobody but Ben may reply.
    await expect(replyToFollowUp(olu, fid, { choice: "done" })).rejects.toMatchObject({ status: 404 });
  });

  it("Ben replies in his own words; the answer quotes them, Olu is told, the ask is read, and a second reply is refused", async () => {
    await replyToFollowUp(ben, fid, { choice: "blocked", note: "Waiting on the brand images from Ada" }); // the real fast path
    const [f] = await settled((await row(fid)).batch_id as string);
    expect(f).toMatchObject({ status: "answered", answered_from: "person", reply_choice: "blocked", reply_note: "Waiting on the brand images from Ada" });
    expect(f.answer).toMatch(/^Ben says it's blocked: “Waiting on the brand images from Ada”\. /);
    const answers = await notesTo(olu, "brenda.followup_answer");
    expect(answers.find((n) => n.resource_id === fid)).toMatchObject({ title: "Ben's Brenda answered about “Pricing page copy”" });
    expect((await notesTo(ben, "brenda.followup_ask"))[0].read_at).not.toBeNull();
    expect(await waitingForMe(ben)).toEqual([]);
    await expect(replyToFollowUp(ben, fid, { choice: "done" })).rejects.toMatchObject({ status: 409, code: "FOLLOW_UP_CLOSED" });
    const view = await getFollowUp(olu, fid);
    expect(view).toMatchObject({ reply: { choice: "blocked", note: "Waiting on the brand images from Ada" }, answeredFrom: "person" });
    // The reply never changes the task (decision 12).
    expect((await adminQuery<{ status: string }>("SELECT status FROM tasks WHERE id = $1", [pricing]))[0].status).not.toBe("blocked");
  });

  it("a third ask about the same task the same day is refused (twice a day per person and task)", async () => {
    const r = await runBrendaTool(olu, "follow_up", { people: ["Ben Okafor"], taskId: pricing, question: "And now?" });
    expect((r.out as { error?: string }).error).toBe("You've already followed up with Ben about this twice today. The answers are in Between assistants, under Sent.");
    expect(confirmOf(r.proposals)).toBeUndefined();
  });
});

// ---- 3. Asked once, no reply by the deadline, answered from the facts ---------------------------------------------------

describe("request → ask → deadline → answered from the facts", () => {
  it("David asks what Ben is working on; the worker's sweep answers from Ben's work when the deadline passes", async () => {
    const r = await press(david, (await runBrendaTool(david, "follow_up", { people: ["Ben Okafor"], question: "What are you working on?" })).proposals);
    const batchId = r.actions[0].followUpBatchId!;
    const [f] = await settled(batchId);
    expect(f).toMatchObject({ status: "asking", task_id: null });
    // The deadline passes; the worker's own job settles it, with the template.
    await adminQuery("UPDATE follow_ups SET deadline_at = now() - interval '1 minute' WHERE id = $1", [f.id]);
    const { handlers } = await import("../../worker/handlers");
    await handlers["followup.sweep"]({}, { jobId: "e2e", attempt: 1 });
    const done = await row(f.id as string);
    expect(done).toMatchObject({ status: "expired", answered_from: "deadline", answer_engine: "template", reply_choice: null });
    expect(done.answer).toMatch(/^No reply from Ben by .+\. /);
    expect(done.answer).toContain("Pricing table");
    const [note] = (await notesTo(david, "brenda.followup_answer"));
    expect(note).toMatchObject({ title: "No reply from Ben", resource_id: f.id });
    // Ben's ask is closed for him too.
    expect((await waitingForMe(ben)).map((v) => v.id)).not.toContain(f.id);
  });

  it("an expired ask settles on read even when the worker has not run", async () => {
    const r = await press(mary, (await runBrendaTool(mary, "follow_up", { people: ["Ben Okafor"], taskId: table, question: "Where is the table?" })).proposals);
    const [f] = await settled(r.actions[0].followUpBatchId!);
    expect(f.status).toBe("asking");
    await adminQuery("UPDATE follow_ups SET deadline_at = now() - interval '1 minute' WHERE id = $1", [f.id]);
    const view = await getFollowUp(mary, f.id as string);
    expect(view).toMatchObject({ status: "expired", answeredFrom: "deadline" });
    expect(view!.answer).toMatch(/^No reply from Ben by /);
  });
});

// ---- 4. Who may ask: refused in words, at the Confirm too -------------------------------------------------------------------

describe("permission refusals", () => {
  it("refuses asking about yourself, someone you share no work with, and someone's own to-do, and audits each", async () => {
    const self = await runBrendaTool(ada, "follow_up", { people: ["Ada Employee"], question: "Where am I?" });
    expect((self.out as { error?: string }).error).toBe("You can't follow up on yourself. Ask me what's on your list instead.");
    const stranger = await runBrendaTool(ada, "follow_up", { people: ["Ben Okafor"], question: "How is it going?" });
    expect((stranger.out as { error?: string }).error).toBe("You can follow up only on people in teams you lead, people you share a task with, or anyone if you're the owner or HR. Ben isn't one of them.");
    const todo = (await quickTodo(ben, { title: "Dentist" })).id;
    const own = await runBrendaTool(olu, "follow_up", { people: ["Ben Okafor"], taskId: todo, question: "Dentist?" });
    expect((own.out as { error?: string }).error).toBe("That's one of Ben's own to-dos. Assistants never share those; message Ben if you need to know.");
    const refused = await adminQuery<{ metadata: { reason: string } }>("SELECT metadata FROM audit_events WHERE action = 'followup.refused' ORDER BY occurred_at");
    expect(refused.map((x) => x.metadata.reason)).toEqual(expect.arrayContaining(["self", "not_allowed", "own_todo"]));
    expect(JSON.stringify(refused)).not.toMatch(/How is it going|Dentist\?/);
    expect(await adminQuery("SELECT 1 FROM follow_ups WHERE requester_membership_id = $1", [ada.membership.id])).toHaveLength(0);
  });

  it("checks again when Confirm is pressed: work no longer shared since the card was prepared means nothing is created", async () => {
    const shared = (await createTask(david, { projectId: a.projectId, title: "Shared review", expectedOutput: "Reviewed.", assigneeMembershipId: ada.membership.id, reviewerMembershipId: ben.membership.id, category: "work", priority: "normal", estimateMinutes: null, dueAt: null, addToMyDay: false })).id;
    const prepared = await runBrendaTool(ada, "follow_up", { people: ["Ben Okafor"], question: "What are you working on?" });
    expect(confirmOf(prepared.proposals)).toBeDefined();
    await adminQuery("UPDATE tasks SET archived_at = now() WHERE id = $1", [shared]);
    const r = await press(ada, prepared.proposals);
    expect(r.actions).toEqual([]);
    expect(r.error).toMatch(/^You can follow up only on people in teams you lead/);
    expect(await adminQuery("SELECT 1 FROM follow_ups WHERE requester_membership_id = $1", [ada.membership.id])).toHaveLength(0);
  });
});

// ---- 5. Caps -------------------------------------------------------------------------------------------------------------

describe("caps", () => {
  it("asks one person once per asker a day, and four times across everyone; past that, the answer comes from their work and says so", async () => {
    // Ben was asked by Olu (pricing), David (what he's working on) and Mary (table) today. Olu asking again is answered
    // from Ben's work only: one colleague cannot spend everyone's asks (security review, 8 October 2026).
    const again = await press(olu, (await runBrendaTool(olu, "follow_up", { people: ["Ben Okafor"], taskId: table, question: "The table?" })).proposals);
    const [f] = await settled(again.actions[0].followUpBatchId!);
    expect(f).toMatchObject({ status: "answered", answered_from: "facts", capped: true, asked_at: null });
    expect(f.answer).toMatch(/^Ben was already asked for an update today, so this comes from Ben's work only\. /);
    // Ada shares work with Ben again: her ask is the fourth today, and it reaches him.
    await adminQuery("UPDATE tasks SET archived_at = NULL WHERE title = 'Shared review' AND organisation_id = $1", [olu.org.id]);
    const fourth = await press(ada, (await runBrendaTool(ada, "follow_up", { people: ["Ben Okafor"], question: "What are you working on?" })).proposals);
    expect((await settled(fourth.actions[0].followUpBatchId!))[0]).toMatchObject({ status: "asking", capped: false });
    expect(await notesTo(ben, "brenda.followup_ask")).toHaveLength(4);
  });

  it("reuses an open follow-up instead of asking twice", async () => {
    // (Other words: the very same card prepared in the same second is the same Confirm, which only runs once.)
    const again = await press(ada, (await runBrendaTool(ada, "follow_up", { people: ["Ben Okafor"], question: "What's on your plate?" })).proposals);
    expect(again.actions[0]).toMatchObject({ summary: "Already asking Ben's assistant what Ben is working on" });
    expect(again.actions[0].followUpBatchId).toBeUndefined();
  });

  it("refuses past 30 follow-ups a day for one person, before anything is created", async () => {
    const [batch] = await adminQuery<{ id: string }>(
      "INSERT INTO follow_up_batches(organisation_id, requester_membership_id, kind, question, local_date, size) VALUES ($1, $2, 'group', 'Seeded', $3::date, 29) RETURNING id",
      [olu.org.id, mary.membership.id, todayLocal(TZ)]);
    await adminQuery(
      "INSERT INTO follow_ups(organisation_id, batch_id, requester_membership_id, subject_membership_id, task_id, question, status) SELECT $1, $2, $3, $4, $5, 'Seeded', 'cancelled' FROM generate_series(1, 28)",
      [olu.org.id, batch.id, mary.membership.id, olu.membership.id, a.taskIds.homepage]); // about another person and task: no pair cap in the way
    // Mary has asked 29 today (28 seeded and the table): two more is one too many.
    const r = await runBrendaTool(mary, "follow_up", { people: ["Ada Employee", "David Manager"], question: "Where are you?" });
    expect((r.out as { error?: string }).error).toBe("That's 2 follow-ups; you have 1 left today.");
    expect(await adminQuery("SELECT 1 FROM follow_ups WHERE requester_membership_id = $1 AND status <> 'cancelled'", [mary.membership.id])).toHaveLength(1);
  });

  it("lists the follow-ups each person asked, and only theirs", async () => {
    const olus = await listMyFollowUps(olu);
    expect(olus.batches.length).toBe(3);
    expect(olus.batches.flatMap((b) => b.items).every((v) => v.requester?.membershipId === olu.membership.id)).toBe(true);
    // Ada's one ask (the fourth Ben was sent today) is hers alone.
    const adas = await listMyFollowUps(ada);
    expect(adas.batches).toHaveLength(1);
    expect(adas.batches[0].items.every((v) => v.requester?.membershipId === ada.membership.id)).toBe(true);
  });
});

// ---- 6. The workspace's collection feeds the end-of-day report --------------------------------------------------------------

describe("the workspace's collection before the report", () => {
  it("collects through the worker's jobs, asks only who it must, and the report carries the Updates", async () => {
    const b = await buildCompany("b", { names: { employee2: "Ben Okafor" } });
    const org = b.ownerCtx.org.id;
    await adminQuery(`UPDATE organisations SET feature_overrides = COALESCE(feature_overrides, '{}'::jsonb) || '{"AI_ASSISTANT": true}'::jsonb WHERE id = $1`, [org]);
    // The report goes out at the last minute of the day, so the collection is never late in this test.
    await adminQuery(`INSERT INTO brenda_settings(organisation_id, daily_report_time) VALUES ($1, '23:59') ON CONFLICT (organisation_id) DO UPDATE SET daily_report_time = '23:59'`, [org]);
    // The owner switches it on in Settings, without asking people with no update (only "always ask me first" are asked).
    expect(await saveFollowUpSettings(b.ownerCtx, { collect: true, collectAsk: false, leadMinutes: 60 })).toEqual({ ready: true, collect: true, collectAsk: false, leadMinutes: 60 });
    await expect(saveFollowUpSettings(b.employeeCtx, { collect: false })).rejects.toMatchObject({ status: 403 });
    // Ada worked on the homepage today (and is blocked, so the report has something to say); Ben too, but he wants to be
    // asked first.
    const version = async () => (await adminQuery<{ version: number }>("SELECT version FROM tasks WHERE id = $1", [b.taskIds.homepage]))[0].version;
    await updateTask(b.employeeCtx, b.taskIds.homepage, { expectedVersion: await version(), status: "in_progress" });
    await updateTask(b.employeeCtx, b.taskIds.homepage, { expectedVersion: await version(), status: "blocked", reason: "Waiting on the brand images" });
    await addComment(b.employeeCtx, b.taskIds.homepage, "Hero layout is in Figma.");
    await addComment(b.employee2Ctx, b.taskIds.second, "Draft is half done.");
    await saveFollowUpPreference(b.employee2Ctx, "ask_first");

    const { handlers } = await import("../../worker/handlers");
    const job = { jobId: "e2e", attempt: 1 };
    await handlers["followup.collect"]({ organisationId: org, localDate: todayLocal(TZ) }, job);
    const [batch] = await adminQuery<{ id: string; kind: string; requester_membership_id: string | null }>("SELECT id, kind, requester_membership_id FROM follow_up_batches WHERE organisation_id = $1", [org]);
    expect(batch).toMatchObject({ kind: "workspace", requester_membership_id: null });
    const [chunk] = await adminQuery<{ payload: { ids: string[] } }>("SELECT payload FROM jobs WHERE type = 'followup.process' AND dedup_key = $1", [`followup.process:${batch.id}:0`]);
    await handlers["followup.process"]({ ids: chunk.payload.ids }, job);
    const rows = await adminQuery<{ subject_membership_id: string; status: string; answered_from: string | null; deadline_at: string | null }>("SELECT subject_membership_id, status, answered_from, deadline_at FROM follow_ups WHERE batch_id = $1", [batch.id]);
    const of = (ctx: OrgContext) => rows.find((r) => r.subject_membership_id === ctx.membership.id);
    expect(of(b.employeeCtx)).toMatchObject({ status: "answered", answered_from: "facts" });
    expect(of(b.employee2Ctx)).toMatchObject({ status: "asking" });
    const [ask] = await notesTo(b.employee2Ctx, "brenda.followup_ask");
    expect(ask.title).toBe("Brenda is collecting updates for today's team report");
    expect(ask.body).toMatch(/^Reply before 23:54\. Your reply goes in the report your team lead, the owner and HR receive\.$/);

    // Ben replies; the reply is written up from his own words.
    const fid = (await waitingForMe(b.employee2Ctx))[0].id;
    await replyToFollowUp(b.employee2Ctx, fid, { choice: "on_track", note: "Copy lands by https://evil.example/x tomorrow" });
    await settled(batch.id);

    // Who reads the collection: the lead and the owner see both, a colleague nobody's.
    expect((await workspaceUpdatesFor(b.managerCtx, todayLocal(TZ), [b.employeeCtx.membership.id, b.employee2Ctx.membership.id])).updates).toHaveLength(2);
    expect((await workspaceUpdatesFor(b.employeeCtx, todayLocal(TZ), [b.employee2Ctx.membership.id])).updates).toEqual([]);

    const report = await teamReportNow(b.managerCtx, { useAssistant: false });
    if (report.status !== "saved") throw new Error(`expected a saved report, got ${JSON.stringify(report)}`);
    const [{ body }] = await adminQuery<{ body: string }>("SELECT body FROM documents WHERE id = $1", [report.docId]);
    const updates = body.slice(body.indexOf("## Updates"), body.indexOf("## Needs your attention"));
    expect(updates).toMatch(/^## Updates\n\n_Brenda asked everyone's assistant for today's update at \d\d:\d\d\._\n\n/);
    expect(updates).toContain("- **Ada Employee**: ");
    expect(updates).toContain("Hero layout is in Figma.");
    // Ben's own words, quoted, with the address as code: never a link in the report.
    expect(updates).toContain("- **Ben Okafor**: Ben says it's on track: “Copy lands by `https://evil.example/x` tomorrow”.");
  });
});
