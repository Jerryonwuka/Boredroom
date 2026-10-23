/**
 * Notion (knowledge group; owner decisions, 22 October 2026: connectors; spec §2, §8.4, §9.5, §14.4). Pages as knowledge
 * Brenda reads (policies, specs), and three changes others will see (a new page, text at the end of a page, a comment),
 * always behind a Confirm card. Server-only.
 *
 * Facts used (developers.notion.com, read 22 October 2026):
 * - OAuth: a public integration; authorise at /v1/oauth/authorize with `owner=user` (Notion's own page picker); the token
 *   endpoint takes JSON with HTTP Basic client authentication and answers `access_token`, `refresh_token`, `bot_id`,
 *   `workspace_id`, `workspace_name`, `owner.user` (no `scope`, `expires_in` not documented: a 401 refreshes once). The
 *   refresh grant answers a new pair (treated as rotating). Revocation: POST /v1/oauth/revoke `{ token }`, Basic auth.
 * - Capabilities are set once on the integration (read content, insert content, insert comments, user information
 *   without email), not per request: there are no scopes to ask for, so Boredroom enforces "can make changes" itself.
 * - `Notion-Version: 2026-03-11` on every API call: `archived` became `in_trash`; appending blocks takes a `position`
 *   object (`{ type: "end" }`).
 * - Limits: about 3 requests a second per connection (180 a minute; 600 on Business and Enterprise), 429 `rate_limited`
 *   with Retry-After (and `additional_data.retry_after`), 529 `service_overload` handled the same way; 2,000 characters
 *   per rich text item, 100 blocks per request, 500 KB per payload.
 * - No webhooks in v1 (D12): syncing polls, hourly.
 */
import { z } from "zod";
import { APP_READBACK } from "@/lib/connectors/words";
import { env, envAll } from "../env";
import { ConnectorError, type ActInput, type ActionSpec, type HttpRequest, type HttpResponse, type NormalisedItem, type Prepared, type ProviderAdapter, type ProviderHttp, type SourceInfo, type StoredItem, type SyncInput, type SyncResult, type TokenSet } from "../types";
import { EXCERPT_MAX, cleanMarkdown, richText, textToBlocks } from "./notion-blocks";

export const NOTION_VERSION = "2026-03-11";
export const NOTION_HOST = "api.notion.com";
const API = `https://${NOTION_HOST}/v1`;
const ENV = ["NOTION_CLIENT_ID", "NOTION_CLIENT_SECRET"] as const;

/** Search pages of 100 at most (spec §8.4: sources read at most 10 pages of 100; the reconciliation the same). */
const LIST_PAGE = 100;
const LIST_PAGES_MAX = 10;
/** The changed-pages pass reads search pages of 50, so a run that stops early resumes cheaply. */
const PASS_PAGE = 50;
/** Pages kept per connection (the sink's PAGES_MAX): a pass stops after this many. */
const PASS_MAX = 500;
/** Watermark overlap: Notion's last_edited_time is rounded to the minute. */
const OVERLAP_MS = 2 * 60_000;
/** The ids-only reconciliation (deleted, trashed or unshared pages leave Boredroom): weekly (spec §6). */
const RECONCILE_EVERY_MS = 7 * 24 * 3600_000;
/** Walking up a page's parents to find its shared root: at most this many steps. */
const MAX_DEPTH = 12;
/** Leave this much of a run's time for saving (the job's deadline is a soft limit). */
const DEADLINE_MARGIN_MS = 4000;

// ---- Calls -------------------------------------------------------------------------------------------------------------

/** Every Notion call carries Notion-Version (spec §8.4, §16.2). */
function call<T>(http: ProviderHttp, req: HttpRequest): Promise<HttpResponse<T>> {
  return http.request<T>({ ...req, headers: { ...(req.headers ?? {}), "Notion-Version": NOTION_VERSION } });
}

/** A Notion id in one form: lower case with dashes (Notion accepts both; parents and search use dashes). */
export function nid(id: unknown): string {
  const s = String(id ?? "").trim().toLowerCase();
  const hex = s.replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/.test(hex)) return s;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
const isId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);
const pathId = (id: string) => {
  const n = nid(id);
  if (!isId(n)) throw new ConnectorError("NOT_FOUND", "not a Notion id");
  return n;
};

type RichTextIn = { plain_text?: string; text?: { content?: string } };
const plain = (rt: unknown): string => (Array.isArray(rt) ? (rt as RichTextIn[]).map((r) => r?.plain_text ?? r?.text?.content ?? "").join("") : "");

type ParentIn = { type?: string; page_id?: string; data_source_id?: string; database_id?: string; block_id?: string; workspace?: boolean };
export type NotionObject = {
  object?: string; id?: string; url?: string; in_trash?: boolean; archived?: boolean; is_archived?: boolean;
  last_edited_time?: string; parent?: ParentIn; database_parent?: ParentIn; properties?: Record<string, { type?: string; title?: unknown }>; title?: unknown;
};
type ListAnswer = { results?: NotionObject[]; next_cursor?: string | null; has_more?: boolean };

/** A page's title (its one `title` property) or a data source's title. */
export function titleOf(o: NotionObject): string {
  if (o.object === "data_source" || o.object === "database") return plain(o.title).trim() || "Untitled";
  for (const p of Object.values(o.properties ?? {})) if (p?.type === "title") return plain(p.title).trim() || "Untitled";
  return "Untitled";
}

const gone = (o: NotionObject) => o.in_trash === true || o.archived === true || o.is_archived === true;

/** A partial search result (only `object` and `id`, as Notion documents) read in full; null when it can't be opened. */
async function complete(http: ProviderHttp, o: NotionObject): Promise<NotionObject | null> {
  if (o.parent && o.last_edited_time) return o;
  const path = o.object === "data_source" ? "data_sources" : "pages";
  try {
    const r = await call<NotionObject>(http, { url: `${API}/${path}/${pathId(String(o.id))}`, ...(path === "pages" ? { query: { filter_properties: "title" } } : {}) });
    return r.body?.id ? { ...r.body, object: o.object } : null;
  } catch (err) {
    if (err instanceof ConnectorError && (err.code === "NOT_FOUND" || err.code === "FORBIDDEN")) return null;
    throw err;
  }
}

async function search(http: ProviderHttp, o: { filter?: "page" | "data_source"; after?: string | null; size: number }): Promise<ListAnswer> {
  const r = await call<ListAnswer>(http, {
    method: "POST", url: `${API}/search`, query: { filter_properties: "title" },
    json: {
      sort: { timestamp: "last_edited_time", direction: "descending" }, page_size: o.size,
      ...(o.filter ? { filter: { property: "object", value: o.filter } } : {}),
      ...(o.after ? { start_cursor: o.after } : {}),
    },
  });
  return r.body ?? {};
}

// ---- Where a page sits: its shared root ------------------------------------------------------------------------------------

type RefType = "page" | "data_source" | "database" | "block" | "workspace";
type Ref = { type: RefType; id: string };
const keyOf = (r: Ref) => `${r.type}:${r.id}`;
const candidate = (r: Ref) => r.type === "page" || r.type === "data_source";

export function parentRef(p: ParentIn | undefined | null): Ref {
  switch (p?.type) {
    case "page_id": return { type: "page", id: nid(p.page_id) };
    case "data_source_id": return { type: "data_source", id: nid(p.data_source_id) };
    case "database_id": return { type: "database", id: nid(p.database_id) };
    case "block_id": return { type: "block", id: nid(p.block_id) };
    // "workspace", and anything newer (e.g. "agent_id"): the top.
    default: return { type: "workspace", id: "" };
  }
}

/**
 * What Boredroom knows of the tree within one run: each object's parent (from search answers for free, otherwise one call
 * per object, remembered). A data source's parent is its database's parent (`database_parent`). An object the
 * connection can't open answers 404: it is above what was shared.
 */
export class NotionTree {
  private readonly parents = new Map<string, Ref | null>();
  readonly titles = new Map<string, string>();
  calls = 0;
  constructor(private readonly http: ProviderHttp) {}

  learn(o: NotionObject): void {
    // Search may answer partial objects (only `object` and `id`): nothing to learn from those.
    if (!o?.id || (o.object !== "page" && o.object !== "data_source") || !o.parent) return;
    const id = nid(o.id);
    const ref: Ref = { type: o.object === "page" ? "page" : "data_source", id };
    this.parents.set(keyOf(ref), parentRef(o.object === "data_source" ? (o.database_parent ?? o.parent) : o.parent));
    this.titles.set(id, titleOf(o));
  }

  knows(r: Ref): boolean { return this.parents.has(keyOf(r)); }

  /** The parent, or null when the connection can't open `r`. */
  async parentOf(r: Ref): Promise<Ref | null> {
    const k = keyOf(r);
    if (this.parents.has(k)) return this.parents.get(k)!;
    const path = r.type === "page" ? `pages/${r.id}` : r.type === "data_source" ? `data_sources/${r.id}` : r.type === "database" ? `databases/${r.id}` : `blocks/${r.id}`;
    let found: Ref | null;
    try {
      this.calls++;
      const res = await call<NotionObject>(this.http, { url: `${API}/${path}`, ...(r.type === "page" ? { query: { filter_properties: "title" } } : {}) });
      const o = res.body ?? {};
      if (gone(o)) found = null;
      else {
        found = parentRef(r.type === "data_source" ? (o.database_parent ?? o.parent) : o.parent);
        if (candidate(r)) this.titles.set(r.id, titleOf({ ...o, object: r.type }));
      }
    } catch (err) {
      if (err instanceof ConnectorError && (err.code === "NOT_FOUND" || err.code === "FORBIDDEN")) found = null;
      else throw err;
    }
    this.parents.set(k, found);
    return found;
  }

  /**
   * The page or data source at the top of what the connection can open above `start` (the shared root, which is what
   * `sources` lists), or the first selected one met on the way up. Null when `start` itself can't be opened.
   */
  async rootOf(start: Ref, selected?: ReadonlySet<string>): Promise<string | null> {
    let cur = start;
    let best: string | null = null;
    for (let depth = 0; depth < MAX_DEPTH; depth++) {
      if (candidate(cur) && selected?.has(cur.id)) return cur.id;
      const p = await this.parentOf(cur);
      if (p === null) return best;
      if (candidate(cur)) best = cur.id;
      if (p.type === "workspace") return best;
      cur = p;
    }
    return best;
  }

  /** The nearest page, data source or the workspace above a block or a database (null: can't be opened). */
  async nearest(r: Ref): Promise<Ref | null> {
    let cur: Ref | null = r;
    for (let depth = 0; cur && depth < MAX_DEPTH; depth++) {
      if (cur.type !== "block" && cur.type !== "database") return cur;
      cur = await this.parentOf(cur);
    }
    return null;
  }
}

// ---- Items ---------------------------------------------------------------------------------------------------------------

const LINK_HOSTS = ["www.notion.so", "notion.so"] as const;

export function pageItem(o: NotionObject, extra: { excerpt?: string | null; sourceExternalId?: string | null; containerLabel?: string | null } = {}): NormalisedItem {
  const parent = parentRef(o.parent);
  return {
    kind: "page", subtype: parent.type === "data_source" || parent.type === "database" ? "row" : "page",
    externalId: nid(o.id), title: titleOf({ ...o, object: "page" }),
    url: typeof o.url === "string" ? o.url : null,
    providerUpdatedAt: o.last_edited_time ?? null, mine: false,
    excerpt: extra.excerpt ?? null, sourceExternalId: extra.sourceExternalId ?? null, containerLabel: extra.containerLabel ?? null,
  };
}

type MarkdownAnswer = { markdown?: string; truncated?: boolean };

async function pageMarkdown(http: ProviderHttp, id: string, max: number): Promise<string | null> {
  const r = await call<MarkdownAnswer>(http, { url: `${API}/pages/${pathId(id)}/markdown`, timeoutMs: 20_000 });
  if (typeof r.body?.markdown !== "string") return null;
  return cleanMarkdown(r.body.markdown, max);
}

// ---- Sync ----------------------------------------------------------------------------------------------------------------

/**
 * The `pages` stream's cursor (≤ 4,000 characters), JSON:
 * - `since`: pages edited at or after it are fetched again (the newest edit of the last finished pass, less 2 minutes);
 * - `top`, `after`, `skip`, `n`: a pass in progress (its newest edit; Notion's start_cursor for the search page being
 *   worked through, and how many of its results are done; pages done in the pass);
 * - `rec`: when the ids-only reconciliation last finished.
 */
export type NotionCursor = { v: 1; since: string | null; top: string | null; after: string | null; skip: number; n: number; rec: string | null };
const FRESH: NotionCursor = { v: 1, since: null, top: null, after: null, skip: 0, n: 0, rec: null };

export function readCursor(raw: string | null): NotionCursor {
  if (!raw) return { ...FRESH };
  try {
    const c = JSON.parse(raw) as Partial<NotionCursor>;
    if (c?.v !== 1) return { ...FRESH };
    const iso = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : null);
    return {
      v: 1, since: iso(c.since), top: iso(c.top), after: typeof c.after === "string" && c.after.length <= 200 ? c.after : null,
      skip: Number.isInteger(c.skip) && c.skip! >= 0 && c.skip! < PASS_PAGE ? c.skip! : 0, n: Number.isInteger(c.n) && c.n! >= 0 ? c.n! : 0, rec: iso(c.rec),
    };
  } catch {
    return { ...FRESH };
  }
}
const writeCursor = (c: NotionCursor) => JSON.stringify(c);

export async function syncPages(c: SyncInput): Promise<SyncResult> {
  const { conn, http, sink, now } = c;
  const workspace = conn.kind === "workspace";
  const selected = new Set(c.selected.map((s) => nid(s.externalId)));
  const labels = new Map(c.selected.map((s) => [nid(s.externalId), s.label]));
  // A workspace shares only what its owners chose: nothing chosen, nothing to read (choosing later starts a full pass).
  if (workspace && !selected.size) return { cursor: null, more: false };
  const spec = adapter.streams[0];
  const cur = readCursor(c.cursor);
  const tree = new NotionTree(http);
  const outOfTime = () => Date.now() > c.deadline - DEADLINE_MARGIN_MS;
  let searches = 0;
  let fetched = 0;

  // 1. The ids-only reconciliation, between passes: weekly, and on a full run. Every page the connection can still open
  //    stays; the rest (deleted, trashed, unshared) leaves Boredroom. Only a complete listing reconciles.
  if (!cur.after && (c.full || !cur.rec || now.getTime() - Date.parse(cur.rec) > RECONCILE_EVERY_MS)) {
    const ids: string[] = [];
    let after: string | null = null;
    let complete = false;
    for (let i = 0; i < LIST_PAGES_MAX && !outOfTime(); i++) {
      const page = await search(http, { filter: "page", after, size: LIST_PAGE });
      for (const o of page.results ?? []) {
        tree.learn(o);
        if (o.object === "page" && o.id && !gone(o)) ids.push(nid(o.id));
      }
      if (!page.has_more || !page.next_cursor) { complete = true; break; }
      after = page.next_cursor;
    }
    if (complete) {
      await sink.reconcileOpen("page", ids);
      cur.rec = now.toISOString();
    }
  }

  // 2. The pass: pages newest edit first, until one older than `since` (or the end), each fetched as markdown.
  const items: NormalisedItem[] = [];
  const goneIds: string[] = [];
  const flush = async () => {
    if (items.length) await sink.upsert(items.splice(0));
    if (goneIds.length) await sink.gone("page", goneIds.splice(0));
  };
  const finish = async (): Promise<SyncResult> => {
    await flush();
    // The next pass starts from this pass's newest edit (less the overlap), never earlier than the last one did.
    const fromTop = cur.top ? Date.parse(cur.top) - OVERLAP_MS : null;
    const kept = cur.since ? Date.parse(cur.since) : null;
    const next = fromTop === null ? kept : kept === null ? fromTop : Math.max(fromTop, kept);
    const since = next === null ? null : new Date(next).toISOString();
    return { cursor: writeCursor({ v: 1, since, top: null, after: null, skip: 0, n: 0, rec: cur.rec }), more: false };
  };
  const pause = async (after: string | null, skip: number): Promise<SyncResult> => {
    await flush();
    return { cursor: writeCursor({ ...cur, after, skip }), more: true };
  };

  let after = cur.after;
  let skip = cur.skip;
  let resumed = !!after;
  for (;;) {
    if (searches >= spec.perRun.pages || outOfTime()) return pause(after, skip);
    let page: ListAnswer;
    try {
      searches++;
      page = await search(http, { filter: "page", after, size: PASS_PAGE });
    } catch (err) {
      // A start_cursor Notion no longer accepts: the pass starts again from the newest edit (once).
      if (resumed && err instanceof ConnectorError && (err.code === "NOT_ALLOWED" || err.code === "BAD_RESPONSE")) {
        resumed = false; after = null; skip = 0; cur.top = null; cur.n = 0;
        continue;
      }
      throw err;
    }
    resumed = false;
    const results = page.results ?? [];
    if (!after && !cur.top) cur.top = results.find((o) => o.object === "page" && o.last_edited_time)?.last_edited_time ?? null;
    for (let i = skip; i < results.length; i++) {
      if (results[i].object !== "page" || !results[i].id) continue;
      const id = nid(results[i].id);
      if (cur.n >= PASS_MAX) return finish();
      if (fetched >= spec.perRun.items || outOfTime()) return pause(after, i);
      const o = await complete(http, results[i]);
      if (!o) { cur.n++; goneIds.push(id); continue; }
      tree.learn(o);
      if (cur.since && o.last_edited_time && Date.parse(o.last_edited_time) < Date.parse(cur.since)) return finish();
      cur.n++;
      if (gone(o)) { goneIds.push(id); continue; }
      let source: string | null = null;
      if (workspace) {
        source = await tree.rootOf({ type: "page", id }, selected);
        if (!source || !selected.has(source)) { goneIds.push(id); continue; }
      }
      let excerpt: string | null;
      fetched++;
      try {
        excerpt = await pageMarkdown(http, id, EXCERPT_MAX);
      } catch (err) {
        if (err instanceof ConnectorError && err.code === "NOT_FOUND") { goneIds.push(id); continue; }
        if (err instanceof ConnectorError && err.code === "FORBIDDEN") excerpt = null;
        else throw err;
      }
      const parent = parentRef(o.parent);
      const container = workspace ? labels.get(source!) ?? null : candidate(parent) ? tree.titles.get(parent.id) ?? null : null;
      items.push(pageItem(o, { excerpt, sourceExternalId: source, containerLabel: container }));
    }
    await flush();
    if (!page.has_more || !page.next_cursor) return finish();
    after = page.next_cursor;
    skip = 0;
  }
}

// ---- Acting --------------------------------------------------------------------------------------------------------------

/** As whom it appears (spec §9.5): the workspace's integration, signed; a person's own Notion, the integration there. */
const appearsAs = (c: ActInput<unknown>) => (c.conn.kind === "workspace" ? APP_READBACK.as.workspaceApp(c.actor.firstName, c.actor.assistantName) : APP_READBACK.as.notionPersonal);
/** The signature line on what a workspace connection adds, exactly as the card shows it (spec §9.5, §8.4). */
export const signatureOf = (c: ActInput<unknown>) => (c.conn.kind === "workspace" ? `From ${c.actor.firstName} via ${c.actor.assistantName}` : null);
const sent = (c: ActInput<unknown>, text: string) => {
  const sig = signatureOf(c);
  return sig ? `${text}\n\n${sig}` : text;
};

function needPage(c: ActInput<unknown>): StoredItem {
  if (!c.item) throw new ConnectorError("NOT_FOUND", "no page");
  if (c.item.kind !== "page") throw new ConnectorError("NOT_ALLOWED", "not a Notion page");
  return c.item;
}

const TEXT = z.string().trim().min(1).max(6000);

const createPage: ActionSpec<{ title: string; text: string }> = {
  name: "create_page", tool: "notion_action", kinds: ["workspace", "personal"],
  input: z.object({ title: z.string().trim().min(1).max(200), text: TEXT }),
  async prepare(c): Promise<Prepared> {
    const parent = needPage(c);
    const as = appearsAs(c);
    return {
      risk: "shared", summary: APP_READBACK.create_page.summary(parent.title), detail: sent(c, c.input.text),
      readback: { to: [APP_READBACK.create_page.to(parent.title)], what: APP_READBACK.create_page.what(c.input.title, as) }, appearsAs: as, place: parent.title,
    };
  },
  async run(c) {
    const parent = needPage(c);
    const r = await call<NotionObject>(c.http, {
      method: "POST", url: `${API}/pages`,
      json: {
        parent: { page_id: pathId(parent.externalId) },
        properties: { title: { title: richText(c.input.title) } },
        children: textToBlocks(c.input.text, { signature: signatureOf(c) }),
      },
    });
    const page = r.body ?? {};
    // A workspace page takes its parent's source (and so its audience); without one it waits for the next sync.
    const source = c.conn.kind === "workspace" ? c.item?.sourceExternalId ?? null : null;
    const item = page.id && (c.conn.kind === "personal" || source)
      ? pageItem({ ...page, object: "page" }, { excerpt: sent(c, c.input.text), sourceExternalId: source, containerLabel: c.conn.kind === "workspace" ? parent.containerLabel : parent.title })
      : null;
    return { summary: `Added “${c.input.title}” under “${parent.title}” in Notion`, href: typeof page.url === "string" ? page.url : null, item };
  },
};

const append: ActionSpec<{ text: string }> = {
  name: "append", tool: "notion_action", kinds: ["workspace", "personal"], input: z.object({ text: TEXT }),
  async prepare(c): Promise<Prepared> {
    const page = needPage(c);
    const as = appearsAs(c);
    return {
      risk: "shared", summary: APP_READBACK.append.summary(page.title), detail: sent(c, c.input.text),
      readback: { to: [APP_READBACK.append.to(page.title)], what: APP_READBACK.append.what(as) }, appearsAs: as, place: page.title,
    };
  },
  async run(c) {
    const page = needPage(c);
    await call(c.http, {
      method: "PATCH", url: `${API}/blocks/${pathId(page.externalId)}/children`,
      json: { children: textToBlocks(c.input.text, { signature: signatureOf(c) }), position: { type: "end" } },
    });
    return { summary: `Added to “${page.title}” in Notion` };
  },
};

const pageComment: ActionSpec<{ text: string }> = {
  name: "page_comment", tool: "notion_action", kinds: ["workspace", "personal"], input: z.object({ text: TEXT }),
  async prepare(c): Promise<Prepared> {
    const page = needPage(c);
    const as = appearsAs(c);
    return {
      risk: "shared", summary: APP_READBACK.page_comment.summary(page.title), detail: sent(c, c.input.text),
      readback: { to: [APP_READBACK.page_comment.to(page.title)], what: APP_READBACK.page_comment.what(as) }, appearsAs: as, place: page.title,
    };
  },
  async run(c) {
    const page = needPage(c);
    await call(c.http, { method: "POST", url: `${API}/comments`, json: { parent: { page_id: pathId(page.externalId) }, rich_text: richText(sent(c, c.input.text)) } });
    return { summary: `Commented on “${page.title}” in Notion` };
  },
};

// ---- Tokens and errors ---------------------------------------------------------------------------------------------------

/** Notion's token answer (code exchange and refresh). Never puts a token in an error. */
export function parseToken(body: unknown, now: Date): TokenSet {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const err = typeof b.error === "string" ? b.error : b.object === "error" && typeof b.code === "string" ? b.code : null;
  if (err) throw new ConnectorError(err === "invalid_grant" || err === "unauthorized" ? "REAUTH_REQUIRED" : "BAD_RESPONSE", `notion token error ${err.replace(/[^a-z_]/gi, "").slice(0, 40)}`);
  if (typeof b.access_token !== "string" || !b.access_token) throw new ConnectorError("BAD_RESPONSE", "notion token missing");
  const owner = (b.owner && typeof b.owner === "object" ? b.owner : {}) as { type?: string; user?: { id?: string; name?: string | null } };
  const expiresIn = typeof b.expires_in === "number" && b.expires_in > 0 ? b.expires_in : null;
  const facts: Record<string, unknown> = {};
  if (typeof b.bot_id === "string") facts.botId = b.bot_id;
  if (typeof b.workspace_id === "string") facts.workspaceId = b.workspace_id;
  if (typeof b.workspace_name === "string") facts.workspaceName = b.workspace_name;
  if (owner.type === "user" && typeof owner.user?.id === "string") {
    facts.ownerUserId = owner.user.id;
    if (typeof owner.user.name === "string") facts.ownerName = owner.user.name;
  }
  return {
    accessToken: b.access_token, refreshToken: typeof b.refresh_token === "string" && b.refresh_token ? b.refresh_token : null, tokenType: "bearer",
    expiresAt: expiresIn ? new Date(now.getTime() + expiresIn * 1000) : null, refreshExpiresAt: null, scopes: null, facts,
  };
}

/** Notion's error bodies (`{ object: "error", status, code, message }`) as fixed codes; the message is never kept. */
export function interpret(res: HttpResponse<unknown>): ConnectorError | null {
  if (res.status < 400) return null;
  const b = (res.body && typeof res.body === "object" ? res.body : {}) as { code?: string; additional_data?: { retry_after?: string | number; rate_limit_reason?: string } };
  const code = typeof b.code === "string" ? b.code : "";
  if (code === "rate_limited" || code === "service_overload" || res.status === 529) {
    if (b.additional_data?.rate_limit_reason === "public_api_request_blocked") return new ConnectorError("FORBIDDEN", "notion blocked requests");
    const s = Number(b.additional_data?.retry_after);
    return new ConnectorError("RATE_LIMITED", "notion rate limited", Number.isFinite(s) && s > 0 ? Math.ceil(s) : undefined);
  }
  switch (code) {
    case "unauthorized": return new ConnectorError("REAUTH_REQUIRED", "notion refused the token");
    case "restricted_resource": return new ConnectorError("FORBIDDEN", "notion restricted resource");
    case "object_not_found": return new ConnectorError("NOT_FOUND", "notion object not found");
    case "conflict_error": return new ConnectorError("CONFLICT", "notion conflict");
    case "validation_error": case "invalid_request": return new ConnectorError("NOT_ALLOWED", "notion refused the request");
    case "invalid_json": case "invalid_request_url": case "missing_version": return new ConnectorError("BAD_RESPONSE", "notion could not read the request");
    default: return null;
  }
}

// ---- The adapter ---------------------------------------------------------------------------------------------------------

export const adapter: ProviderAdapter = {
  id: "notion",
  category: "knowledge",
  kinds: ["workspace", "personal"],
  hosts: [NOTION_HOST],
  linkHosts: LINK_HOSTS,
  env: ENV,
  configured: (e) => envAll(ENV, e ?? process.env),
  oauth: {
    authorizeUrl: `${API}/oauth/authorize`,
    tokenUrl: `${API}/oauth/token`,
    clientId: () => env("NOTION_CLIENT_ID"),
    clientSecret: () => env("NOTION_CLIENT_SECRET"),
    clientAuth: "basic",
    tokenBody: "json",
    pkce: "none",
    scopeSeparator: " ",
    // Capabilities are fixed on the integration (spec §14.4), not asked per request: no scopes, for reading or acting.
    scopes: () => [],
    authorizeParams: () => ({ owner: "user" }),
    parseToken,
    refresh: "rotating",
  },
  /**
   * From the token answer (no call needed). Knowledge group decision, 22 October 2026: the connection's account id is the
   * Notion workspace (workspace connections) or the workspace and the person's Notion user (personal), not `bot_id`, so
   * "Change pages" (a reconnect through Notion's picker) always matches the connection it reconnects, whoever's
   * authorisation Notion issues; the bot id stays in Notion.
   */
  async identify({ kind, tokens }) {
    const f = tokens.facts ?? {};
    const workspaceId = typeof f.workspaceId === "string" ? nid(f.workspaceId) : "";
    if (!workspaceId) throw new ConnectorError("BAD_RESPONSE", "notion answered no workspace");
    const workspaceName = (typeof f.workspaceName === "string" && f.workspaceName.trim()) || "Notion";
    if (kind === "workspace") return { externalAccountId: workspaceId, externalTenantId: workspaceId, accountLabel: workspaceName };
    const userId = typeof f.ownerUserId === "string" ? nid(f.ownerUserId) : "";
    if (!userId) throw new ConnectorError("BAD_RESPONSE", "notion answered no user");
    const name = typeof f.ownerName === "string" && f.ownerName.trim() ? f.ownerName.trim() : null;
    return {
      externalAccountId: `${workspaceId}:${userId}`, externalTenantId: workspaceId,
      accountLabel: name ? `${name} in ${workspaceName}` : workspaceName,
      identity: { externalUserId: userId, email: null },
    };
  },
  ownerBound: false,
  workspaceActs: true,
  /**
   * The top of what was shared with the connection (Notion's picker): pages and data sources whose parent the connection
   * can't open. Search with no query, newest edit first, at most 10 pages of 100.
   */
  async sources({ http }) {
    const tree = new NotionTree(http);
    const all: NotionObject[] = [];
    let after: string | null = null;
    for (let i = 0; i < LIST_PAGES_MAX; i++) {
      const page = await search(http, { after, size: LIST_PAGE });
      for (const r of page.results ?? []) {
        if ((r.object !== "page" && r.object !== "data_source") || !r.id) continue;
        all.push(r);
      }
      if (!page.has_more || !page.next_cursor) break;
      after = page.next_cursor;
    }
    // Partial results (only `object` and `id`) read in full, within the same budget of lookups.
    let lookups = 0;
    const listed: NotionObject[] = [];
    for (const r of all) {
      const o = r.parent ? r : lookups++ < 30 ? await complete(http, r) : null;
      if (!o || gone(o)) continue;
      tree.learn(o);
      listed.push(o);
    }
    const out: SourceInfo[] = [];
    for (const o of listed) {
      let p = parentRef(o.object === "data_source" ? (o.database_parent ?? o.parent) : o.parent);
      // Pages inside a column or a toggle, and databases: up to the nearest page (a few calls, at most 30 a listing).
      if ((p.type === "block" || p.type === "database") && lookups < 30) {
        const before = tree.calls;
        p = (await tree.nearest(p)) ?? { type: "workspace", id: "" };
        lookups += tree.calls - before;
      }
      const top = p.type === "workspace" || p.type === "block" || p.type === "database" || !tree.knows(p);
      if (!top) continue;
      const title = titleOf(o);
      out.push({ kind: "page", externalId: nid(o.id), label: o.object === "data_source" ? `${title} (database)` : title, members: null });
    }
    return out;
  },
  streams: [
    // Spec §6, §8.4: hourly; a run reads at most 10 search pages and fetches at most 50 pages' text in ~15 seconds. A full
    // run (on connecting, when the chosen pages change, and monthly) fetches every page again; the weekly reconciliation
    // in between lists ids only (the cursor's `rec`).
    { name: "pages", kinds: ["page"], every: { workingMinutes: 60, offMinutes: 60 }, perRun: { pages: 10, items: 50, ms: 15_000 }, fullEveryMinutes: 30 * 24 * 60 },
  ],
  sync: (c) => syncPages(c),
  async fetchItem({ conn, http, kind, externalId }) {
    if (kind !== "page") return null;
    let page: NotionObject;
    try { page = (await call<NotionObject>(http, { url: `${API}/pages/${pathId(externalId)}`, query: { filter_properties: "title" } })).body ?? {}; }
    catch (err) { if (err instanceof ConnectorError && err.code === "NOT_FOUND") return null; throw err; }
    if (!page.id || gone(page)) return null;
    page = { ...page, object: "page" };
    const tree = new NotionTree(http);
    tree.learn(page);
    const source = conn.kind === "workspace" ? await tree.rootOf({ type: "page", id: nid(page.id) }) : null;
    const excerpt = await pageMarkdown(http, externalId, EXCERPT_MAX).catch((err: unknown) => {
      if (err instanceof ConnectorError && (err.code === "NOT_FOUND" || err.code === "FORBIDDEN")) return null;
      throw err;
    });
    return pageItem(page, { excerpt, sourceExternalId: source, containerLabel: source ? tree.titles.get(source) ?? null : null });
  },
  async fetchText({ http, kind, externalId, maxChars }) {
    if (kind !== "page") return null;
    return pageMarkdown(http, externalId, Math.max(1, Math.min(maxChars, 200_000)));
  },
  actions: [createPage, append, pageComment],
  interpret,
  /** POST /v1/oauth/revoke with the client's Basic credentials (developers.notion.com/reference/revoke-token). */
  async revoke({ http, tokens }) {
    const basic = Buffer.from(`${env("NOTION_CLIENT_ID")}:${env("NOTION_CLIENT_SECRET")}`).toString("base64");
    await call(http, { method: "POST", url: `${API}/oauth/revoke`, auth: "header", headers: { authorization: `Basic ${basic}` }, json: { token: tokens.accessToken }, expect: "none" });
  },
  // About 3 requests a second per connection (spec §8.4).
  limits: { spacingMs: 350 },
};
