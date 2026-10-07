/**
 * Brenda's past chats (owner decision, 5 October 2026): every conversation with her is kept, so the person can come
 * back to it and carry on, and can delete it for good.
 *
 * Private to the person: rows live in brenda_conversations under row-level security
 * (db/migrations/0029_brenda_conversations.sql), so only the member who had the conversation can read, change or
 * delete it; for anyone else, the owner and HR included, it does not exist (404). The chat saves the whole
 * conversation after each exchange; the newest 200 messages are kept. Confirm tokens are removed before anything is
 * stored: a prepared action can only be confirmed in the conversation it was offered in, while its token is fresh,
 * and a restored one reads as expired.
 *
 * Someone signed in as the person is someone else too: while a Boredroom administrator is impersonating them (support),
 * past chats are closed: the list is empty, a conversation is not there, and nothing is saved or deleted in their name.
 *
 * One conversation can be open in more than one place (two tabs, the drawer and Brenda's page, the notch), and each save
 * replaces it whole, so a save says which copy it was made from: the updatedAt its last save or read returned
 * (`expectedUpdatedAt`). When the conversation has been saved from somewhere else since, nothing is written and the
 * answer is 409 with the conversation as it is now, so the chat can carry its own change onto that copy instead of
 * writing over it. Every save moves updatedAt on by at least a millisecond, so no two saves share one.
 */
import { z } from "zod";
import { withSystem, withUser } from "@/server/db";
import { parseBody, type OrgContext } from "@/server/lib/api";
import { conflict, forbidden, invalid, notFound } from "@/server/lib/errors";

/** The idempotency route name of a new conversation's save (api/orgs/[org]/brenda/conversations, POST). */
export const CREATE_ROUTE = "brenda.conversations.create";

export const CONVERSATION_LIMITS = {
  /** Messages kept per conversation; older ones are dropped from the front. */
  messages: 200,
  /** Characters per message. */
  content: 8000,
  title: 200,
  /** A save larger than this is refused. */
  bodyBytes: 512 * 1024,
  /** Conversations the list shows, newest first. */
  list: 100,
} as const;

const text = (max: number) => z.string().max(max);
/**
 * Words Brenda wrote about what she did or offered (a summary, a note), shortened to fit rather than refused: one long
 * summary (fifteen to-dos with long titles, say) would otherwise make every later save of the conversation fail.
 */
const told = (max: number) => z.string().transform((s) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s));
const href = z.string().max(2000).regex(/^\/(?!\/)/, "Links stay inside Boredroom.");
const done = text(80).optional();

const actionSchema = z.object({ kind: text(80), summary: told(2000), href: href.optional() });
// The kinds of Proposal (server/services/copilot.ts), each with the label it was marked with ("Added", "Not done").
const proposalSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("todo"), title: text(500), description: text(4000).nullable(), dueAt: text(60).nullable(),
    assigneeMembershipId: z.string().uuid().nullable(), assigneeName: text(200).nullable(), estimateMinutes: z.number().int().min(0).max(100_000).nullable(), done,
  }),
  z.object({ kind: z.literal("clock_in"), done }),
  z.object({ kind: z.literal("clock_out"), done }),
  z.object({ kind: z.literal("start_timer"), taskId: z.string().uuid(), taskTitle: text(500), done }),
  z.object({ kind: z.literal("open"), href, label: text(200), done }),
  // The token is accepted so a client may send the conversation as it holds it; it is never stored.
  z.object({ kind: z.literal("confirm"), token: text(8000).optional(), summary: told(2000), tool: text(80), done }),
]);

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: text(CONVERSATION_LIMITS.content),
  actions: z.array(actionSchema).max(50).optional(),
  proposals: z.array(proposalSchema).max(20).optional(),
  engine: text(40).optional(),
  note: told(2000).nullable().optional(),
});

/** The whole conversation, oldest first; past the limit only the newest messages are kept. */
const messagesSchema = z.array(messageSchema).min(1).transform((ms) => ms.slice(-CONVERSATION_LIMITS.messages));

export const createConversationSchema = z.object({ title: z.string().trim().min(1).max(CONVERSATION_LIMITS.title).optional(), messages: messagesSchema });
export const updateConversationSchema = createConversationSchema.extend({
  /**
   * The updatedAt of the copy this save was made from; a save from an older copy is refused (409). Left out (an older
   * client), the save replaces whatever is there.
   */
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
});

type ParsedMessage = z.infer<typeof messageSchema>;
type StoredProposal = Exclude<NonNullable<ParsedMessage["proposals"]>[number], { kind: "confirm" }> | { kind: "confirm"; summary: string; tool: string; done?: string };
/** A message as stored and returned: a confirm proposal keeps its summary and done label, never its token. */
export type StoredMessage = Omit<ParsedMessage, "proposals"> & { proposals?: StoredProposal[] };

export type ConversationSummary = { id: string; title: string; preview: string; messageCount: number; createdAt: string; updatedAt: string };
export type Conversation = ConversationSummary & { messages: StoredMessage[] };

/**
 * Reads a save, refusing one over the size limit (422) before it is parsed: by its declared length, and while it is
 * read, for a body that declares none.
 */
export async function parseConversationBody<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  const max = CONVERSATION_LIMITS.bodyBytes;
  const tooLarge = () => invalid(`That conversation is too large to save (the limit is ${max / 1024} KB).`);
  if (Number(req.headers.get("content-length") ?? "0") > max) throw tooLarge();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = req.body?.getReader();
  for (let r = await reader?.read(); r && !r.done; r = await reader!.read()) {
    size += r.value.byteLength;
    if (size > max) { await reader!.cancel(); throw tooLarge(); }
    chunks.push(r.value);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return parseBody(new Request(req.url, { method: req.method, headers: { "content-type": req.headers.get("content-type") ?? "" }, body: raw }), schema);
}

/** Removes every Confirm token: what is stored can be shown again, never confirmed again. */
export function stripTokens(messages: ParsedMessage[]): StoredMessage[] {
  return messages.map((m) => (m.proposals ? {
    ...m,
    proposals: m.proposals.map((p): StoredProposal => (p.kind === "confirm" ? { kind: "confirm", summary: p.summary, tool: p.tool, ...(p.done ? { done: p.done } : {}) } : p)),
  } : m));
}

/**
 * The first thing the person asked, on one line; what the list calls the conversation when the chat names none. With
 * nothing asked yet it is a "New chat", not "Chat with Brenda": a stored title must not go stale when the person renames
 * their assistant (owner decision, 7 October 2026: personal assistants).
 */
export function conversationTitle(messages: { role: string; content: string }[]) {
  const first = messages.find((m) => m.role === "user" && m.content.trim())?.content.replace(/\s+/g, " ").trim() ?? "";
  if (!first) return "New chat";
  return first.length > CONVERSATION_LIMITS.title ? `${first.slice(0, CONVERSATION_LIMITS.title - 1).trimEnd()}…` : first;
}

/** An administrator signed in as the person: past chats stay closed to them. */
const impersonated = (ctx: OrgContext) => !!ctx.user.impersonation;
const closed = () => forbidden("Past chats are private to the person. They stay closed while someone else is signed in as them.");

const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

type Row = { id: string; title: string; preview: string | null; message_count: number; created_at: Date | string; updated_at: Date | string };
const SUMMARY = `id, title, preview, message_count, created_at, updated_at`;
const iso = (v: Date | string) => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());

/**
 * The last message as one plain line for the list. Brenda's replies are light Markdown (owner request, 7 October 2026:
 * lists, not paragraphs), so the marks go: bold and italic, list markers, headings, code ticks, links (their words
 * stay). A label alone on its line ("**Overdue**") gets a colon; list items are joined with semicolons and the last
 * one ends with a full stop: "2 overdue: Landing page copy, due 17:00; Homepage design, due Fri." Escaped marks
 * (`\*`) come out as the character itself.
 */
export function plainPreview(text: string): string {
  const ESC = "\u0000";
  const escaped: string[] = [];
  const lines = text.replace(/\\([\\`*_[\]~|#+\-.!()])/g, (_, c: string) => { escaped.push(c); return `${ESC}${escaped.length - 1}${ESC}`; })
    .split("\n").map((raw) => {
      let line = raw.trim();
      const item = /^([-*+]|\d{1,3}[.)])\s+/.test(line);
      line = line.replace(/^#{1,6}\s+/, "").replace(/^([-*+]|\d{1,3}[.)])\s+/, "");
      const label = !item && /^(\*\*|__)[^*_]+(\*\*|__):?$/.test(line);
      line = line.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\*\*|__|~~|`/g, "").replace(/(^|[^\w])[*_](?=\S)|(?<=\S)[*_](?=[^\w]|$)/g, "$1").trim();
      return { line: label && !line.endsWith(":") ? `${line}:` : line, item };
    }).filter((l) => l.line);
  const out = lines.map((l, i) => {
    if (/[.!?:;,…]$/.test(l.line)) return l.line;
    if (l.item) return `${l.line}${lines[i + 1]?.item ? ";" : "."}`;
    return i < lines.length - 1 ? `${l.line}.` : l.line;
  }).join(" ");
  return out.replace(new RegExp(`${ESC}(\\d+)${ESC}`, "g"), (_, n: string) => escaped[Number(n)] ?? "").replace(/\s+/g, " ").trim();
}

const summary = (r: Row): ConversationSummary => ({
  id: r.id, title: r.title, preview: plainPreview(r.preview ?? ""), messageCount: r.message_count, createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
});

/** The person's conversations in this organisation, the most recently active first. */
export async function listConversations(ctx: OrgContext): Promise<ConversationSummary[]> {
  if (impersonated(ctx)) return [];
  const rows = await withUser(ctx.user.profileId, (db) => db.query<Row>(
    `SELECT ${SUMMARY} FROM brenda_conversations WHERE organisation_id = $1 AND membership_id = $2 ORDER BY updated_at DESC LIMIT ${CONVERSATION_LIMITS.list}`,
    [ctx.org.id, ctx.membership.id]));
  return rows.map(summary);
}

/** One conversation with its messages; null when it is not the person's (or not an id at all). */
export async function getConversation(ctx: OrgContext, id: string): Promise<Conversation | null> {
  if (!isUuid(id) || impersonated(ctx)) return null;
  const row = await withUser(ctx.user.profileId, (db) => db.maybeOne<Row & { messages: StoredMessage[] }>(
    `SELECT ${SUMMARY}, messages FROM brenda_conversations WHERE id = $1 AND organisation_id = $2 AND membership_id = $3`,
    [id, ctx.org.id, ctx.membership.id]));
  return row ? { ...summary(row), messages: row.messages } : null;
}

export async function createConversation(ctx: OrgContext, input: z.infer<typeof createConversationSchema>): Promise<ConversationSummary> {
  if (impersonated(ctx)) throw closed();
  const row = await withUser(ctx.user.profileId, (db) => db.one<Row>(
    `INSERT INTO brenda_conversations(organisation_id, membership_id, title, messages) VALUES ($1, $2, $3, $4::jsonb) RETURNING ${SUMMARY}`,
    [ctx.org.id, ctx.membership.id, input.title ?? conversationTitle(input.messages), JSON.stringify(stripTokens(input.messages))]));
  return summary(row);
}

/**
 * Replaces the messages (and the title, when one is given). With expectedUpdatedAt, a save from a copy that has been
 * saved over since is refused with 409 VERSION_CONFLICT, whose details carry the conversation as it is now.
 */
export async function updateConversation(ctx: OrgContext, id: string, input: z.infer<typeof updateConversationSchema>): Promise<ConversationSummary> {
  if (impersonated(ctx)) throw closed();
  if (!isUuid(id)) throw notFound("Conversation not found.");
  const row = await withUser(ctx.user.profileId, async (db) => {
    // The row as it is now, locked until this save commits, so two saves from the same copy cannot both pass the check.
    const cur = await db.maybeOne<Row>(
      `SELECT ${SUMMARY} FROM brenda_conversations WHERE id = $1 AND organisation_id = $2 AND membership_id = $3 FOR UPDATE`, [id, ctx.org.id, ctx.membership.id]);
    if (!cur) throw notFound("Conversation not found.");
    // Both sides went through the same timestamp parser (millisecond ISO strings), so compare instants, not text.
    if (input.expectedUpdatedAt && Date.parse(input.expectedUpdatedAt) !== Date.parse(iso(cur.updated_at))) {
      const { messages } = await db.one<{ messages: StoredMessage[] }>(`SELECT messages FROM brenda_conversations WHERE id = $1`, [id]);
      throw conflict("VERSION_CONFLICT", "This chat was saved from somewhere else since it was opened here.", { conversation: { ...summary(cur), messages } satisfies Conversation });
    }
    return db.one<Row>(
      `UPDATE brenda_conversations SET messages = $2::jsonb, title = COALESCE($3, title), updated_at = greatest(now(), updated_at + interval '1 millisecond')
       WHERE id = $1 RETURNING ${SUMMARY}`,
      [id, JSON.stringify(stripTokens(input.messages)), input.title ?? null]);
  });
  return summary(row);
}

/**
 * Deletes it for good. The reply to the save that created it is kept for a day against a retried request
 * (server/lib/api.ts, `idempotent`), and it names the conversation (its title and the start of the last message), so
 * it goes too.
 */
export async function deleteConversation(ctx: OrgContext, id: string): Promise<{ id: string; deleted: true }> {
  if (impersonated(ctx)) throw closed();
  if (!isUuid(id)) throw notFound("Conversation not found.");
  const row = await withUser(ctx.user.profileId, (db) => db.maybeOne<{ id: string }>(
    `DELETE FROM brenda_conversations WHERE id = $1 AND organisation_id = $2 AND membership_id = $3 RETURNING id`, [id, ctx.org.id, ctx.membership.id]));
  if (!row) throw notFound("Conversation not found.");
  await withSystem((db) => db.query(
    `DELETE FROM idempotency_keys WHERE actor_user_id = $1 AND route = $2 AND response_body ->> 'id' = $3`, [ctx.user.profileId, CREATE_ROUTE, row.id]));
  return { id: row.id, deleted: true };
}
