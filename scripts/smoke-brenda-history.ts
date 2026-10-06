import { config } from "dotenv"; config({ path: [".env.local"], quiet: true });
import { getPool, withSystem, withUser } from "../src/server/db";
import { contextFor } from "../src/server/services/fixtures";
import {
  listConversations, getConversation, createConversation, updateConversation, deleteConversation, parseConversationBody,
  createConversationSchema, updateConversationSchema, CONVERSATION_LIMITS, CREATE_ROUTE, type ConversationSummary, type Conversation,
} from "../src/server/services/brenda-history";
import { issueSession, signOut } from "../src/server/auth";
import type { BrendaMsg } from "../src/components/app/brenda-chat";

/**
 * Brenda's past chats (owner decision, 5 October 2026) against the seeded test workspace (company-a). Ada keeps,
 * lists, reads, changes and deletes her conversations; Ben (staff), David (team lead) and the owner can neither read,
 * change nor delete hers (404, and row-level security hides the row even from a raw query), and nor can an
 * administrator signed in as her (impersonation); the limits hold (the newest 200 messages are kept, 8,000 characters
 * a message, about 512 KB a save, links stay inside Boredroom; a long summary is shortened instead); Confirm tokens are
 * never stored. Saves from two places do not write over each other: a save from an older copy is refused (409) with
 * the conversation as it is now, two at once from one copy let one through, and the chat's carry-over (`rebase` in
 * components/app/brenda-chat.tsx) puts the second window's exchange and marks after the first's. Then the same over HTTP
 * when the app is running (pnpm dev), where deleting also removes the kept reply to the save that created it.
 * Removes what it creates: every conversation whose title starts "History smoke".
 */
const BASE = process.env.SMOKE_BASE ?? "http://localhost:3000";
const PREFIX = "History smoke";
const TOKEN = "smoke-token-".padEnd(64, "x");

type Msg = Record<string, unknown> & { role: "user" | "assistant"; content: string };

async function main() {
  const { Client } = await import("pg");
  const admin = new Client({ connectionString: process.env.DATABASE_ADMIN_URL }); await admin.connect();
  const who = async (email: string) => {
    const r = (await admin.query("SELECT p.id, p.auth_user_id, p.email, p.display_name FROM profiles p WHERE p.email = $1", [email])).rows[0];
    return contextFor({ profileId: r.id, authUserId: r.auth_user_id, email: r.email, displayName: r.display_name, password: "" }, "company-a");
  };
  const ada = await who("ada@company-a.test"); const ben = await who("ben@company-a.test");
  const david = await who("david@company-a.test"); const owner = await who("owner@company-a.test");
  const org = ada.org.id;
  const cleanup = () => admin.query("DELETE FROM brenda_conversations WHERE organisation_id = $1 AND title LIKE $2", [org, `${PREFIX}%`]);
  await cleanup(); // anything left by an interrupted run

  let failed = 0;
  const check = async (name: string, fn: () => Promise<unknown>) => {
    try { console.log("ok  ", name, "→", JSON.stringify(await fn() ?? null).slice(0, 220)); } catch (e) { failed++; console.log("FAIL", name, (e as Error).message); }
  };
  const expect = (cond: boolean, msg: string) => { if (!cond) throw new Error(msg); };
  /** The call must fail with this HTTP status (404, 422). */
  const refused = async (fn: () => Promise<unknown>, status: number) => {
    try { await fn(); } catch (e) {
      const s = (e as { status?: number }).status;
      expect(s === status, `expected ${status}, got ${s ?? "an error"}: ${(e as Error).message}`);
      return `${s} ${(e as Error).message}`;
    }
    throw new Error(`expected ${status}, but it was allowed`);
  };
  /** The call must be refused as a save from an older copy (409 VERSION_CONFLICT); returns the conversation sent back. */
  const conflictOf = async (fn: () => Promise<unknown>) => {
    try { await fn(); } catch (e) {
      const err = e as { status?: number; code?: string; details?: { conversation?: Conversation } };
      expect(err.status === 409 && err.code === "VERSION_CONFLICT" && !!err.details?.conversation, `expected 409 VERSION_CONFLICT, got ${err.status ?? "an error"} ${err.code ?? ""}: ${(e as Error).message}`);
      return { code: err.code!, conversation: err.details!.conversation! };
    }
    throw new Error("expected 409, but it was saved");
  };
  /** What the service receives after the route has parsed the body. */
  const parse = (body: unknown) => createConversationSchema.parse(body);
  const parseUpdate = (body: unknown) => updateConversationSchema.parse(body);

  const exchange = (q: string, a: string, extra: Record<string, unknown> = {}): Msg[] => [{ role: "user", content: q }, { role: "assistant", content: a, engine: "claude", note: null, ...extra }];
  const first = exchange(`${PREFIX}: who is working right now?`, "Ben is working on the homepage.", {
    actions: [{ kind: "todo", summary: "Added to-do: call Josh", href: `/app/company-a/my-day` }],
    proposals: [
      { kind: "confirm", token: TOKEN, summary: "Message Ben: are you free at 3?", tool: "send_message" },
      { kind: "confirm", token: TOKEN, summary: "Assign the logo to Ben", tool: "create_task", done: "Done" },
      { kind: "todo", title: "Call Josh", description: null, dueAt: null, assigneeMembershipId: null, assigneeName: null, estimateMinutes: 15 },
      { kind: "open", href: "/app/company-a/workroom", label: "Workroom" },
    ],
  });

  // ---- The service ----------------------------------------------------------------------------------------
  let mine!: ConversationSummary;
  await check("Ada keeps a conversation, named after the first thing she asked", async () => {
    mine = await createConversation(ada, parse({ messages: first }));
    expect(mine.title === `${PREFIX}: who is working right now?` && mine.messageCount === 2 && mine.preview === "Ben is working on the homepage.", JSON.stringify(mine));
    return mine;
  });
  await check("Confirm tokens are stripped; summaries, done labels, actions and other proposals are kept", async () => {
    const c = (await getConversation(ada, mine.id))!;
    expect(!JSON.stringify(c.messages).includes(TOKEN), "a token was stored");
    const raw = (await admin.query("SELECT messages::text AS m FROM brenda_conversations WHERE id = $1", [mine.id])).rows[0].m as string;
    expect(!raw.includes(TOKEN) && !raw.includes('"token"'), "a token is in the row");
    const p = c.messages[1].proposals!;
    expect(p[0].kind === "confirm" && p[0].summary === "Message Ben: are you free at 3?" && !("token" in p[0]) && !p[0].done, JSON.stringify(p[0]));
    expect(p[1].kind === "confirm" && p[1].done === "Done", JSON.stringify(p[1]));
    expect(p[2].kind === "todo" && p[3].kind === "open" && c.messages[1].actions?.[0].href === "/app/company-a/my-day", JSON.stringify(c.messages[1]));
    return p.map((x) => x.kind);
  });
  await check("the list has it first, without the messages", async () => {
    const list = await listConversations(ada);
    expect(list[0]?.id === mine.id && !("messages" in list[0]), JSON.stringify(list[0]));
    return { count: list.length, first: list[0].title };
  });
  await check("a later exchange replaces the messages and keeps the title", async () => {
    await new Promise((r) => setTimeout(r, 20));
    const next = [...first, ...exchange("And David?", "David is paused on the brand review.")];
    const s = await updateConversation(ada, mine.id, parse({ messages: next }));
    expect(s.messageCount === 4 && s.title === mine.title && s.preview === "David is paused on the brand review." && s.updatedAt > mine.updatedAt, JSON.stringify(s));
    mine = s; return s;
  });
  await check("a given title replaces it", async () => {
    const c = (await getConversation(ada, mine.id))!;
    const s = await updateConversation(ada, mine.id, parse({ title: `${PREFIX}: renamed`, messages: c.messages }));
    expect(s.title === `${PREFIX}: renamed`, s.title); mine = s; return s.title;
  });

  // ---- Saves from two places (each save names the copy it was made from) -------------------------------------
  await check("a save from the copy it was made from goes through, and each save moves updatedAt on (two in a row too)", async () => {
    const c = (await getConversation(ada, mine.id))!;
    const s1 = await updateConversation(ada, mine.id, parseUpdate({ messages: c.messages, expectedUpdatedAt: c.updatedAt }));
    const s2 = await updateConversation(ada, mine.id, parseUpdate({ messages: c.messages, expectedUpdatedAt: s1.updatedAt }));
    expect(s1.updatedAt > c.updatedAt && s2.updatedAt > s1.updatedAt, JSON.stringify([c.updatedAt, s1.updatedAt, s2.updatedAt]));
    mine = s2; return [c.updatedAt, s1.updatedAt, s2.updatedAt];
  });
  await check("a save from an older copy is refused (409 VERSION_CONFLICT) with the conversation as it is now; nothing is written", async () => {
    const before = (await getConversation(ada, mine.id))!;
    const older = new Date(Date.parse(before.updatedAt) - 1000).toISOString();
    const r = await conflictOf(() => updateConversation(ada, mine.id, parseUpdate({ messages: exchange("Write over it?", "No."), expectedUpdatedAt: older })));
    expect(r.conversation.id === mine.id && r.conversation.updatedAt === before.updatedAt && JSON.stringify(r.conversation.messages) === JSON.stringify(before.messages), JSON.stringify(r.conversation).slice(0, 200));
    const after = (await getConversation(ada, mine.id))!;
    expect(after.updatedAt === before.updatedAt && after.messageCount === before.messageCount, "it was written");
    return { code: r.code, current: r.conversation.updatedAt, messages: r.conversation.messages.length };
  });
  await check("two saves from the same copy at once: one goes through, the other is refused (409)", async () => {
    const c = (await getConversation(ada, mine.id))!;
    const save = (q: string) => updateConversation(ada, mine.id, parseUpdate({ messages: [...c.messages, ...exchange(q, "Noted.")], expectedUpdatedAt: c.updatedAt }));
    const out = await Promise.allSettled([save("From one window"), save("From another window")]);
    const saved = out.filter((r): r is PromiseFulfilledResult<ConversationSummary> => r.status === "fulfilled");
    const refusedNow = out.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(saved.length === 1 && refusedNow.length === 1 && (refusedNow[0].reason as { status?: number }).status === 409, JSON.stringify(out.map((r) => (r.status === "fulfilled" ? "saved" : (r.reason as Error).message))));
    mine = saved[0].value; return out.map((r) => (r.status === "fulfilled" ? "saved" : (r.reason as { status?: number }).status));
  });
  await check("a save that names no copy (an older client, the notch today) still replaces it", async () => {
    const c = (await getConversation(ada, mine.id))!;
    const s = await updateConversation(ada, mine.id, parse({ messages: c.messages }));
    expect(s.updatedAt > c.updatedAt && s.messageCount === c.messageCount, JSON.stringify(s)); mine = s; return s.updatedAt;
  });
  await check("two windows carry one chat on: the second's save is refused, and the chat puts its exchange and its Added after the first's", async () => {
    const { rebase } = await import("../src/components/app/brenda-chat");
    const c = (await getConversation(ada, mine.id))!;
    const base = c.messages as BrendaMsg[];
    const a = [...base, ...exchange("A: is anyone late?", "Nobody is late.")] as BrendaMsg[];
    const sa = await updateConversation(ada, mine.id, parseUpdate({ messages: a, expectedUpdatedAt: c.updatedAt }));
    // Window B, from the same copy: the to-do Brenda offered in her first reply added, and one more exchange.
    const b = [...base.map((m, i) => (i === 1 ? { ...m, proposals: m.proposals?.map((p, j) => (j === 2 ? { ...p, done: "Added" } : p)) } : m)), ...exchange("B: and David?", "David is on the brand review.")] as BrendaMsg[];
    const r = await conflictOf(() => updateConversation(ada, mine.id, parseUpdate({ messages: b, expectedUpdatedAt: c.updatedAt })));
    const carried = rebase(b, base, r.conversation.messages as BrendaMsg[]);
    expect(!!carried && !carried.lost, `not carried over: ${JSON.stringify(carried)?.slice(0, 120)}`);
    const sb = await updateConversation(ada, mine.id, parseUpdate({ messages: carried!.messages, expectedUpdatedAt: r.conversation.updatedAt }));
    const now = (await getConversation(ada, mine.id))!;
    const tail = now.messages.slice(-4).map((m) => m.content).join(" | ");
    expect(tail === "A: is anyone late? | Nobody is late. | B: and David? | David is on the brand review." && sb.updatedAt > sa.updatedAt, tail);
    const p = now.messages[1].proposals?.[2];
    expect(p?.kind === "todo" && p.done === "Added", JSON.stringify(p));
    mine = sb; return { messages: now.messageCount, tail };
  });
  await check("the carry-over keeps theirs where both windows marked the same offer (and says so), and carries nothing onto a copy it does not follow", async () => {
    const { rebase } = await import("../src/components/app/brenda-chat");
    const base = [...exchange("q1", "a1", { proposals: [{ kind: "clock_in" }] }), ...exchange("q2", "a2")] as BrendaMsg[];
    const mark = (list: BrendaMsg[], done: string) => list.map((m, i) => (i === 1 ? { ...m, proposals: m.proposals?.map((p) => ({ ...p, done })) } : m));
    const ours = [...mark(base, "Clocked in"), ...exchange("q3", "a3")] as BrendaMsg[];
    const theirs = [...mark(base, "Not done"), ...exchange("q4", "a4")] as BrendaMsg[];
    const both = rebase(ours, base, theirs);
    expect(!!both && both.lost && both.messages[1].proposals?.[0].done === "Not done" && both.messages.map((m) => m.content).join() === "q1,a1,q2,a2,q4,a4,q3,a3", JSON.stringify(both));
    // The server keeps the newest 200: theirs may have lost base's oldest messages; ours still goes after it.
    const trimmed = rebase([...base, ...exchange("q3", "a3")] as BrendaMsg[], base, [...base.slice(2), ...exchange("q4", "a4")] as BrendaMsg[]);
    expect(trimmed?.messages.map((m) => m.content).join() === "q2,a2,q4,a4,q3,a3" && !trimmed.lost, JSON.stringify(trimmed));
    // This chat's own save landed but its answer was lost; the next save is refused over it: it is not added twice.
    const own = rebase([...base, ...exchange("q3", "a3"), ...exchange("q5", "a5")] as BrendaMsg[], base, [...base, ...exchange("q3", "a3"), ...exchange("q4", "a4")] as BrendaMsg[]);
    expect(own?.messages.map((m) => m.content).join() === "q1,a1,q2,a2,q3,a3,q4,a4,q5,a5" && !own.lost, JSON.stringify(own));
    const unrelated = rebase(ours, base, exchange("something", "else") as BrendaMsg[]);
    const rewritten = rebase(exchange("q1", "changed") as BrendaMsg[], base, theirs);
    expect(unrelated === null && rewritten === null, JSON.stringify({ unrelated, rewritten }));
    return { lost: both!.lost, trimmed: trimmed!.messages.length };
  });

  // ---- Nobody else ------------------------------------------------------------------------------------------
  for (const [name, ctx] of [["Ben (staff)", ben], ["David (team lead)", david], ["the owner", owner]] as const) {
    await check(`${name} cannot read, list, change or delete Ada's conversation (404)`, async () => {
      expect((await getConversation(ctx, mine.id)) === null, "can read it");
      expect(!(await listConversations(ctx)).some((c) => c.id === mine.id), "sees it in the list");
      return [
        await refused(() => updateConversation(ctx, mine.id, parse({ messages: exchange("hijack", "no") })), 404),
        await refused(() => deleteConversation(ctx, mine.id), 404),
      ].map((s) => s.slice(0, 3));
    });
  }
  await check("row-level security hides the row from the owner even in a raw query, and Ben cannot write one as Ada", async () => {
    const seen = await withUser(owner.user.profileId, (db) => db.query("SELECT id FROM brenda_conversations WHERE id = $1", [mine.id]));
    const changed = await withUser(owner.user.profileId, (db) => db.query("UPDATE brenda_conversations SET title = 'x' WHERE id = $1 RETURNING id", [mine.id]));
    const gone = await withUser(owner.user.profileId, (db) => db.query("DELETE FROM brenda_conversations WHERE id = $1 RETURNING id", [mine.id]));
    let insert = "allowed";
    try {
      await withUser(ben.user.profileId, (db) => db.query("INSERT INTO brenda_conversations(organisation_id, membership_id, title, messages) VALUES ($1, $2, $3, '[]')", [org, ada.membership.id, `${PREFIX}: forged`]));
    } catch (e) { insert = (e as { code?: string }).code ?? "error"; }
    expect(seen.length === 0 && changed.length === 0 && gone.length === 0 && insert === "42501", JSON.stringify({ seen: seen.length, changed: changed.length, gone: gone.length, insert }));
    expect(!!(await getConversation(ada, mine.id)), "Ada lost her conversation");
    return { seen: seen.length, insert };
  });
  await check("while an administrator is signed in as Ada, her past chats are closed (empty list, nothing to read, 403 to save or delete)", async () => {
    const asAdmin = { ...ada, user: { ...ada.user, impersonation: { id: "00000000-0000-4000-8000-000000000001", adminEmail: "support@boredroom.test" } } };
    expect((await listConversations(asAdmin)).length === 0, "the list shows her chats");
    expect((await getConversation(asAdmin, mine.id)) === null, "can read it");
    const out = [
      await refused(() => createConversation(asAdmin, parse({ messages: exchange(`${PREFIX}: as an administrator`, "no") })), 403),
      await refused(() => updateConversation(asAdmin, mine.id, parse({ messages: exchange("hijack", "no") })), 403),
      await refused(() => deleteConversation(asAdmin, mine.id), 403),
    ];
    const c = await getConversation(ada, mine.id);
    expect(!!c && c.messageCount === mine.messageCount, "Ada's conversation changed");
    return out.map((s) => s.slice(0, 3));
  });

  // ---- Limits -----------------------------------------------------------------------------------------------
  await check("past 200 messages, the newest 200 are kept", async () => {
    const many: Msg[] = Array.from({ length: 125 }, (_, i) => exchange(`${PREFIX}: question ${i}`, `answer ${i}`)).flat();
    const s = await createConversation(ada, parse({ messages: many }));
    const c = (await getConversation(ada, s.id))!;
    expect(s.messageCount === CONVERSATION_LIMITS.messages && c.messages[0].content === `${PREFIX}: question 25` && c.messages.at(-1)!.content === "answer 124", JSON.stringify({ count: s.messageCount, first: c.messages[0].content }));
    expect(s.title === `${PREFIX}: question 25`, `title from the kept messages: ${s.title}`);
    await deleteConversation(ada, s.id);
    return { sent: many.length, kept: s.messageCount };
  });
  await check("a summary or note longer than 2,000 characters is shortened, not refused (the conversation is still kept)", async () => {
    const long = "s".repeat(2500);
    const s = await createConversation(ada, parse({ messages: exchange(`${PREFIX}: long summary`, "ok", { note: long, actions: [{ kind: "todo", summary: long }], proposals: [{ kind: "confirm", token: TOKEN, summary: long, tool: "create_todos" }] }) }));
    const m = (await getConversation(ada, s.id))!.messages[1];
    const p = m.proposals![0];
    const lengths = [m.actions![0].summary.length, p.kind === "confirm" ? p.summary.length : -1, m.note?.length ?? -1];
    expect(lengths.every((n) => n === 2000) && m.actions![0].summary.endsWith("…"), JSON.stringify(lengths));
    await deleteConversation(ada, s.id);
    return lengths;
  });
  await check("bad saves are refused (422): too long a message, too long a title, no messages, a link out of Boredroom", async () => {
    const bad = [
      { messages: exchange(`${PREFIX}: long`, "x".repeat(CONVERSATION_LIMITS.content + 1)) },
      { title: "t".repeat(CONVERSATION_LIMITS.title + 1), messages: exchange(`${PREFIX}: t`, "a") },
      { messages: [] },
      { messages: exchange(`${PREFIX}: href`, "a", { actions: [{ kind: "x", summary: "s", href: "https://evil.example" }] }) },
      { messages: exchange(`${PREFIX}: href`, "a", { proposals: [{ kind: "open", href: "//evil.example", label: "x" }] }) },
    ];
    const out = [];
    for (const body of bad) {
      const req = new Request(`${BASE}/x`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      out.push(await refused(() => parseConversationBody(req, createConversationSchema), 422));
    }
    return out.map((s) => s.slice(0, 3));
  });
  await check("a save over 512 KB is refused (422) before it is parsed", async () => {
    const body = JSON.stringify({ messages: Array.from({ length: 70 }, (_, i) => exchange(`${PREFIX}: ${i}`, "y".repeat(7900))).flat() });
    expect(body.length > CONVERSATION_LIMITS.bodyBytes, `only ${body.length} bytes`);
    const declared = new Request(`${BASE}/x`, { method: "POST", headers: { "content-type": "application/json" }, body });
    // A streamed body declares no length: the limit holds while it is read.
    const stream = new Request(`${BASE}/x`, { method: "POST", headers: { "content-type": "application/json" }, body: new Blob([body]).stream(), duplex: "half" } as RequestInit & { duplex: "half" });
    return [await refused(() => parseConversationBody(declared, createConversationSchema), 422), await refused(() => parseConversationBody(stream, createConversationSchema), 422)].map((s) => s.slice(0, 40));
  });
  await check("not an id, or an id that is nobody's, is 404", async () => [
    (await getConversation(ada, "not-an-id")) === null,
    await refused(() => updateConversation(ada, "00000000-0000-4000-8000-000000000000", parse({ messages: exchange("a", "b") })), 404),
    await refused(() => deleteConversation(ada, "not-an-id"), 404),
  ].map(String).map((s) => s.slice(0, 5)));

  // ---- Deleting ---------------------------------------------------------------------------------------------
  await check("Ada deletes it for good; afterwards it is 404", async () => {
    const r = await deleteConversation(ada, mine.id);
    const row = (await admin.query("SELECT 1 FROM brenda_conversations WHERE id = $1", [mine.id])).rowCount;
    expect(r.deleted && row === 0 && (await getConversation(ada, mine.id)) === null, "still there");
    return [r, await refused(() => deleteConversation(ada, mine.id), 404)];
  });

  // ---- The API routes, over HTTP, when the app is running ---------------------------------------------------
  const up = await fetch(`${BASE}/api/health`).then((r) => r.status < 500, () => false);
  if (!up) console.log("skip  API routes: nothing answering at", BASE, "(start pnpm dev to include them)");
  else {
    const tokens = {
      ada: await withSystem((db) => issueSession(db, ada.user.authUserId, { method: "password", userAgent: "smoke-brenda-history" })),
      ben: await withSystem((db) => issueSession(db, ben.user.authUserId, { method: "password", userAgent: "smoke-brenda-history" })),
      owner: await withSystem((db) => issueSession(db, owner.user.authUserId, { method: "password", userAgent: "smoke-brenda-history" })),
    };
    const call = async (as: keyof typeof tokens | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
      const raw = typeof body === "string" ? body : body === undefined ? undefined : JSON.stringify(body);
      const res = await fetch(`${BASE}/api/orgs/company-a/brenda/conversations${path}`, { method, headers: { ...(raw ? { "content-type": "application/json" } : {}), ...(as ? { authorization: `Bearer ${tokens[as]}` } : {}), ...headers }, body: raw });
      return { status: res.status, json: await res.json().catch(() => null) as Record<string, unknown> | null };
    };
    const status = <R extends { status: number; json: unknown }>(r: R, want: number): R => { expect(r.status === want, `expected ${want}, got ${r.status}: ${JSON.stringify(r.json).slice(0, 200)}`); return r; };
    let api!: ConversationSummary;
    await check("API: signed out is 401", async () => status(await call(null, "GET", ""), 401).status);
    // The app sends every save with an Idempotency-Key, as the browser's api() does.
    const key = `smoke-brenda-history-${Date.now()}`;
    const kept = async (id: string) => (await admin.query("SELECT count(*)::int AS n FROM idempotency_keys WHERE route = $1 AND response_body ->> 'id' = $2", [CREATE_ROUTE, id])).rows[0].n as number;
    await check("API: POST keeps a conversation (201); a retry with the same key gets the same one", async () => {
      api = status(await call("ada", "POST", "", { messages: first }, { "idempotency-key": key }), 201).json as unknown as ConversationSummary;
      expect(api.messageCount === 2 && api.title.startsWith(PREFIX), JSON.stringify(api));
      const again = status(await call("ada", "POST", "", { messages: first }, { "idempotency-key": key }), 201).json as unknown as ConversationSummary;
      expect(again.id === api.id && (await kept(api.id)) === 1, `retry made ${again.id}, kept replies ${await kept(api.id)}`);
      return api;
    });
    await check("API: GET lists it first; GET [id] reads it without tokens", async () => {
      const list = status(await call("ada", "GET", ""), 200).json as { conversations: ConversationSummary[] };
      expect(list.conversations[0]?.id === api.id, JSON.stringify(list.conversations[0]));
      const c = status(await call("ada", "GET", `/${api.id}`), 200).json as unknown as Conversation;
      expect(c.messages.length === 2 && !JSON.stringify(c).includes(TOKEN), "token came back"); return list.conversations.length;
    });
    await check("API: PUT replaces the messages (200)", async () => {
      const s = status(await call("ada", "PUT", `/${api.id}`, { messages: [...first, ...exchange("More", "Sure.")] }), 200).json as unknown as ConversationSummary;
      expect(s.messageCount === 4 && s.title === api.title, JSON.stringify(s)); return s.messageCount;
    });
    await check("API: a PUT from the copy it last saw goes through; one from an older copy is 409 VERSION_CONFLICT with the chat as it is now", async () => {
      const c = status(await call("ada", "GET", `/${api.id}`), 200).json as unknown as Conversation;
      const next = status(await call("ada", "PUT", `/${api.id}`, { messages: [...c.messages, ...exchange("Again", "Sure.")], expectedUpdatedAt: c.updatedAt }), 200).json as unknown as ConversationSummary;
      const r = status(await call("ada", "PUT", `/${api.id}`, { messages: [...c.messages, ...exchange("From an older copy", "No.")], expectedUpdatedAt: c.updatedAt }), 409);
      const now = (r.json?.details as { conversation?: Conversation } | undefined)?.conversation;
      expect(r.json?.code === "VERSION_CONFLICT" && now?.updatedAt === next.updatedAt && now.messages.length === next.messageCount && now.messages.at(-2)?.content === "Again", JSON.stringify(r.json).slice(0, 240));
      expect(!JSON.stringify(now).includes(TOKEN), "a token came back");
      return { code: r.json?.code, messages: now!.messages.length };
    });
    await check("API: Ben and the owner get 404 for Ada's conversation (read, change, delete) and do not list it", async () => {
      const out: number[] = [];
      for (const as of ["ben", "owner"] as const) {
        out.push(status(await call(as, "GET", `/${api.id}`), 404).status, status(await call(as, "PUT", `/${api.id}`, { messages: exchange("x", "y") }), 404).status, status(await call(as, "DELETE", `/${api.id}`), 404).status);
        const list = status(await call(as, "GET", ""), 200).json as { conversations: ConversationSummary[] };
        expect(!list.conversations.some((c) => c.id === api.id), `${as} lists it`);
      }
      return out;
    });
    await check("API: bad saves are 422 (over 512 KB, a message over 8,000 characters, no messages)", async () => {
      const huge = JSON.stringify({ messages: Array.from({ length: 70 }, (_, i) => exchange(`${PREFIX}: ${i}`, "y".repeat(7900))).flat() });
      return [
        status(await call("ada", "POST", "", huge), 422).json?.message,
        status(await call("ada", "PUT", `/${api.id}`, { messages: exchange("a", "x".repeat(8001)) }), 422).json?.code,
        status(await call("ada", "POST", "", { messages: [] }), 422).json?.code,
      ];
    });
    await check("API: DELETE removes it (200), with the kept reply to the save that created it; afterwards it is 404", async () => {
      const r = status(await call("ada", "DELETE", `/${api.id}`), 200);
      expect(r.json?.deleted === true, JSON.stringify(r.json));
      expect((await kept(api.id)) === 0, "the reply naming it is still kept");
      return [status(await call("ada", "GET", `/${api.id}`), 404).status, status(await call("ada", "DELETE", `/${api.id}`), 404).status];
    });
    // Once more on a fresh connection if the pool hands back one the database has dropped meanwhile.
    for (const t of Object.values(tokens)) await signOut(t).catch(() => signOut(t));
  }

  await cleanup();
  const left = (await admin.query("SELECT count(*)::int AS n FROM brenda_conversations WHERE organisation_id = $1 AND title LIKE $2", [org, `${PREFIX}%`])).rows[0].n;
  if (left) { failed++; console.log("FAIL cleanup left", left, "conversations"); }
  console.log(failed ? `${failed} failed` : "all passed");
  await admin.end(); await getPool().end();
  process.exit(failed ? 1 : 0);
}
main();
