import { config } from "dotenv"; config({ path: [".env.local"], quiet: true });
import { getPool } from "../src/server/db";
import { contextFor } from "../src/server/services/fixtures";
import { chat, confirmAction, type ChatResult } from "../src/server/services/copilot";
import { resolveAssistant } from "../src/server/services/assistant";

/**
 * Brenda end to end with the real model, against the seeded test workspace (company-a): what people actually type,
 * as staff, a team lead and the owner. Checks that Claude answered (not the built-in fallback), that her own-work actions
 * happened in the database, that work for others waits for Confirm and runs when confirmed, and that she refuses what
 * the role cannot do. Costs a few API calls.
 *
 * The AI connection: ANTHROPIC_API_KEY if set, otherwise the key of the workspace named by BRENDA_KEY_FROM (a slug),
 * held in memory for this run only. Cleans up what it creates.
 */
async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    const slug = process.env.BRENDA_KEY_FROM;
    if (!slug) throw new Error("Set ANTHROPIC_API_KEY, or BRENDA_KEY_FROM=<workspace slug> to borrow that workspace's key.");
    const { Client } = await import("pg");
    const c = new Client({ connectionString: process.env.DATABASE_ADMIN_URL }); await c.connect();
    const org = (await c.query("SELECT id FROM organisations WHERE slug = $1", [slug])).rows[0]; await c.end();
    const conn = org ? await resolveAssistant(org.id) : null;
    if (!conn) throw new Error(`No AI key on ${slug}.`);
    process.env.ANTHROPIC_API_KEY = conn.apiKey;
    process.env.ASSISTANT_MODEL ??= conn.model;
  }
  console.log("model:", process.env.ASSISTANT_MODEL ?? "(default)");

  const { Client } = await import("pg");
  const admin = new Client({ connectionString: process.env.DATABASE_ADMIN_URL }); await admin.connect();
  admin.on("error", (e) => console.log("[admin db]", e.message));
  const who = async (email: string) => {
    const r = (await admin.query("SELECT p.id, p.auth_user_id, p.email, p.display_name FROM profiles p WHERE p.email = $1", [email])).rows[0];
    return contextFor({ profileId: r.id, authUserId: r.auth_user_id, email: r.email, displayName: r.display_name, password: "" }, "company-a");
  };
  const ada = await who("ada@company-a.test"); const david = await who("david@company-a.test"); const owner = await who("owner@company-a.test");
  const started = new Date();
  // Leftovers from an interrupted earlier run.
  await admin.query("UPDATE tasks SET archived_at = now() WHERE organisation_id = $1 AND archived_at IS NULL AND created_at >= now() - interval '1 day' AND (title ILIKE '%Q4 newsletter%' OR title ILIKE '%partner FAQ%' OR title ILIKE '%brand deck%')", [ada.org.id]);
  let failed = 0;
  let last: ChatResult | null = null;
  const expect = (cond: unknown, msg: string) => { if (!cond) throw new Error(msg); };
  const say = async (ctx: typeof ada, ...turns: string[]) => {
    const messages: { role: "user" | "assistant"; content: string }[] = [];
    let r: ChatResult | null = null;
    last = null;
    for (const t of turns) {
      messages.push({ role: "user", content: t });
      r = await chat(ctx, { messages });
      messages.push({ role: "assistant", content: r.reply });
      last = r;
    }
    return r!;
  };
  const check = async (name: string, fn: () => Promise<ChatResult | unknown>) => {
    const t0 = Date.now();
    try {
      const r = await fn() as ChatResult;
      const s = (Date.now() - t0) / 1000;
      console.log(`ok   ${name} (${s.toFixed(1)}s)\n     “${r?.reply ?? ""}”${r?.actions?.length ? `\n     did: ${r.actions.map((a) => a.summary).join(" | ")}` : ""}${r?.proposals?.length ? `\n     offers: ${r.proposals.map((p) => p.kind === "confirm" ? `confirm(${p.summary})` : p.kind === "open" ? `open(${p.href})` : p.kind).join(" | ")}` : ""}`);
    } catch (e) {
      failed++;
      console.log(`FAIL ${name}: ${(e as Error).message}${last ? `\n     “${last.reply}”\n     did: ${last.actions.map((a) => a.summary).join(" | ") || "nothing"}` : ""}`);
    }
  };
  const claude = (r: ChatResult) => { expect(r.engine === "claude" && !r.note, `fell back to the built-in helper: ${r.note}`); return r; };

  // Staff
  await check("staff: what's waiting for me", async () => { const r = claude(await say(ada, "What's waiting for me today?")); expect(r.reply.length > 10, "empty reply"); return r; });
  await check("staff: add a to-do with a due date", async () => {
    const r = claude(await say(ada, "add a todo to draft the Q4 newsletter, due Friday"));
    expect(r.actions.some((a) => a.kind === "todo"), "no to-do created"); expect(!r.proposals.some((p) => p.kind === "confirm"), "own to-do should not need confirm");
    const row = (await admin.query("SELECT title, due_at FROM tasks WHERE organisation_id = $1 AND created_at >= $2 AND title ILIKE '%newsletter%'", [ada.org.id, started])).rows[0];
    expect(row, "to-do not in the database"); expect(row.due_at, "due date missing"); return r;
  });
  await check("staff: reminder", async () => {
    const r = claude(await say(ada, "remind me in 2 hours to call Josh"));
    expect(r.actions.some((a) => a.kind === "reminder"), "no reminder set");
    const row = (await admin.query("SELECT remind_at FROM brenda_reminders WHERE membership_id = $1 AND created_at >= $2", [ada.membership.id, started])).rows[0];
    const mins = (new Date(row.remind_at).getTime() - Date.now()) / 60000; expect(mins > 100 && mins < 140, `reminder at the wrong time (${mins.toFixed(0)} min from now)`);
    return r;
  });
  await check("staff: reminder at a set time", async () => {
    const r = claude(await say(ada, "remind me tomorrow at 9am to send the invoice"));
    const row = (await admin.query("SELECT remind_at FROM brenda_reminders WHERE membership_id = $1 AND created_at >= $2 AND body ILIKE '%invoice%'", [ada.membership.id, started])).rows[0];
    expect(row, "no reminder set");
    const local = new Date(row.remind_at).toLocaleString("en-GB", { timeZone: ada.org.timezone, hour: "2-digit", minute: "2-digit" });
    expect(local === "09:00", `reminder at ${local} local`); return r;
  });
  await check("staff: progress on own task, in a follow-up", async () => {
    const r = claude(await say(ada, "add a todo to write the partner FAQ", "mark the FAQ one as 40% done"));
    const row = (await admin.query("SELECT progress_percent FROM tasks WHERE organisation_id = $1 AND created_at >= $2 AND title ILIKE '%FAQ%' ORDER BY progress_percent DESC LIMIT 1", [ada.org.id, started])).rows[0];
    expect(row?.progress_percent === 40, `progress is ${row?.progress_percent}`); return r;
  });
  await check("staff: start and stop the timer", async () => {
    const r1 = claude(await say(ada, "start the timer on the partner FAQ"));
    const on = (await admin.query("SELECT 1 FROM work_sessions WHERE membership_id = $1 AND created_at >= $2", [ada.membership.id, started]).catch(() => ({ rowCount: -1 }))).rowCount;
    expect(r1.actions.some((a) => a.kind === "timer_start"), `timer not started (sessions: ${on})`);
    const r2 = claude(await say(ada, "stop my timer, I'll continue later"));
    expect(r2.actions.some((a) => a.kind === "timer_stop"), "timer not stopped"); return { ...r2, reply: `${r1.reply} / ${r2.reply}` };
  });
  await check("staff: comment on own task", async () => {
    const r = claude(await say(ada, "comment on the partner FAQ task: first draft is in the shared folder"));
    expect(r.actions.some((a) => a.kind === "comment"), "no comment added"); return r;
  });
  await check("staff: list and cancel a reminder", async () => {
    const r = claude(await say(ada, "what reminders do I have?", "cancel the Josh one"));
    const row = (await admin.query("SELECT cancelled_at FROM brenda_reminders WHERE membership_id = $1 AND created_at >= $2 AND body ILIKE '%josh%'", [ada.membership.id, started]).catch(async () => (await admin.query("SELECT 1 FROM brenda_reminders WHERE membership_id = $1 AND created_at >= $2 AND body ILIKE '%josh%'", [ada.membership.id, started])))).rows[0];
    expect(r.actions.some((a) => a.kind === "reminder_cancel"), `not cancelled (${JSON.stringify(row)})`); return r;
  });
  await check("staff: mark own task done", async () => {
    const r = claude(await say(ada, "I finished the Q4 newsletter draft, mark it done"));
    expect(r.actions.some((a) => a.kind === "complete"), "not marked done"); return r;
  });
  await check("staff: direct message to a person", async () => {
    const r = claude(await say(ada, "message David: the FAQ draft is ready for a look"));
    expect(r.actions.some((a) => a.kind === "message"), "message not sent"); return r;
  });
  await check("staff: clock in and out", async () => {
    const r1 = claude(await say(ada, "clock me in"));
    const r2 = claude(await say(ada, "clock me out"));
    expect(r1.actions.some((a) => a.kind === "clock_in") || /working day|not a working|schedule/i.test(r1.reply), "neither clocked in nor explained");
    return { ...r2, reply: `${r1.reply} / ${r2.reply}`, actions: [...r1.actions, ...r2.actions] };
  });
  await check("staff: cannot hand work to someone else", async () => {
    const r = claude(await say(ada, "create a task for David to fix the login page"));
    expect(!r.actions.length && !r.proposals.some((p) => p.kind === "confirm"), "should not create or prepare work for someone else"); return r;
  });
  await check("staff: status", async () => {
    const r = claude(await say(ada, "set me to do not disturb"));
    expect(r.actions.some((a) => a.kind === "status"), "status not set"); return r;
  });

  // Team lead
  await check("lead: who is working", async () => claude(await say(david, "who on my team is working right now?")));
  let token: string | null = null;
  await check("lead: task for a team member waits for Confirm", async () => {
    const r = claude(await say(david, "give Ada a task to review the brand deck by tomorrow at 3pm"));
    const p = r.proposals.find((x) => x.kind === "confirm"); expect(p, "no Confirm offered"); expect(!r.actions.some((a) => a.kind === "todo"), "created without confirm");
    token = p && p.kind === "confirm" ? p.token : null; return r;
  });
  await check("lead: Confirm runs it", async () => {
    expect(token, "no token from the previous step");
    const c = await confirmAction(david, token!); expect(!c.error && c.actions.length, c.error ?? "nothing done");
    const row = (await admin.query("SELECT t.title FROM tasks t JOIN memberships m ON m.id = t.assignee_membership_id WHERE t.organisation_id = $1 AND t.created_at >= $2 AND m.id = $3 AND t.title ILIKE '%brand deck%'", [ada.org.id, started, ada.membership.id])).rows[0];
    expect(row, "task for Ada not in the database"); return { reply: c.actions.map((a) => a.summary).join("; "), actions: [], proposals: [] };
  });
  await check("lead: team message waits for Confirm", async () => {
    const r = claude(await say(david, "tell my team that standup moves to 10am tomorrow"));
    expect(r.proposals.some((p) => p.kind === "confirm") || /which|team/i.test(r.reply), "neither Confirm nor a question"); return r;
  });

  await check("lead: reassign an existing task waits for Confirm", async () => {
    const r = claude(await say(david, "hand the partner FAQ task to Ben"));
    expect(r.proposals.some((p) => p.kind === "confirm"), "no Confirm offered"); return r;
  });

  // Owner
  await check("owner: who's late", async () => claude(await say(owner, "who's late today?")));
  await check("owner: invite waits for Confirm", async () => {
    const r = claude(await say(owner, "invite sam.brenda.test@company-a.test as staff"));
    expect(r.proposals.some((p) => p.kind === "confirm"), "no Confirm offered"); return r;
  });
  await check("owner: has no own to-dos", async () => {
    const r = claude(await say(owner, "add a todo for me to fix the logo"));
    expect(!r.actions.some((a) => a.kind === "todo"), "owner got a to-do of their own"); return r;
  });
  await check("owner: where is a page", async () => {
    const r = claude(await say(owner, "where do I change the work schedule?"));
    expect(r.proposals.some((p) => p.kind === "open"), "no link offered"); return r;
  });

  await check("owner: create a team waits for Confirm", async () => {
    const r = claude(await say(owner, "create a team called Brenda Test Squad"));
    expect(r.proposals.some((p) => p.kind === "confirm"), "no Confirm offered"); return r;
  });

  // Clean up.
  await admin.query("UPDATE tasks SET archived_at = now() WHERE organisation_id = $1 AND created_at >= $2", [ada.org.id, started]);
  await admin.query("DELETE FROM brenda_reminders WHERE membership_id = $1 AND created_at >= $2", [ada.membership.id, started]);
  await admin.query("DELETE FROM notifications WHERE organisation_id = $1 AND created_at >= $2", [ada.org.id, started]).catch(() => {});
  await admin.query("DELETE FROM attendance_days WHERE membership_id = $1 AND created_at >= $2", [ada.membership.id, started]).catch((e) => console.log("[cleanup] attendance:", e.message));
  await admin.query("UPDATE profiles SET presence = 'active' WHERE id = $1", [ada.user.profileId]).catch(() => {});
  console.log(failed ? `${failed} failed` : "all passed");
  await admin.end(); await getPool().end();
  process.exit(failed ? 1 : 0);
}
main();
