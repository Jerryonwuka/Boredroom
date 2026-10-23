/**
 * Connected apps: syncing (owner decisions, 22 October 2026: connectors; spec §6). One `connector.sync` job runs one
 * stream of one connection for a bounded time (the stream's `perRun`, at most ~15 seconds), saves its cursor and, with
 * `more`, queues its continuation. Everything an adapter returns goes through the sink, which validates and clamps it,
 * keeps links only on the adapter's `linkHosts`, keeps an assignee's email only as a keyed digest, sets visibility,
 * person and audience from the connection and its source, skips rows that haven't changed, and enforces the size bounds.
 * Failures are fixed codes on the connection (never provider text) with backoff. Worker context. Server-only.
 */
import { withWorker, type Db } from "@/server/db";
import { schema0061Missing } from "@/server/lib/schema-0061";
import { resolveEntitlements } from "@/server/lib/entitlements";
import { personTimeZone } from "@/server/lib/routine-time";
import { localParts } from "@/server/lib/time";
import { adapterFor } from "./registry";
import { httpFor, hostAllowed } from "./http";
import { emailDigest } from "./identity";
import { connectorAudit } from "./audit";
import { CONNECTION_COLUMNS, loadConnection, markNeedsReauth, notifyTrouble, pauseForPlan, refOf, type ConnectionRow } from "./connections";
import { ConnectorError, type ConnectionRef, type ItemKind, type NormalisedItem, type ProviderAdapter, type SourceInfo, type StreamSpec, type SyncSink } from "./types";

export const OPEN_ITEMS_MAX = { personal: 500, workspace: 2000 } as const;
export const PAGES_MAX = 500;
const DEFAULT_PER_RUN = { pages: 5, items: 500, ms: 15_000 };
const EXCERPT_MAX = 20_000;

const ISO = (v: unknown): string | null => (typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
const DATE = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const cut = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  // Control characters out (a title is one line), then the length.
  const s = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  return s ? s.slice(0, max) : null;
};
const oneLine = (v: unknown, max: number) => cut(typeof v === "string" ? v.replace(/\s+/g, " ") : v, max);

// ---- The sink ------------------------------------------------------------------------------------------------------------

type SinkContext = { conn: ConnectionRef; adapter: ProviderAdapter; sources: Map<string, { id: string; audience: string | null }>; kinds: ItemKind[]; seen: { n: number } };

/**
 * One item as a row, or null (dropped: invalid, or from a source not selected). A workspace item must come from a
 * selected source (security fix, 22 October 2026): one with no source, or only unselected ones, is never stored, since
 * it would otherwise be visible to the whole workspace. An item in several containers (`sourceCandidates`) keeps its
 * stored source while that is still among them and selected (`prefer`), else the one it was listed from, else the first
 * selected one, so its audience never jumps to another source's.
 */
export function rowOf(item: NormalisedItem, c: Pick<SinkContext, "conn" | "adapter" | "sources"> & { prefer?: string | null }): Record<string, unknown> | null {
  if (!item || typeof item !== "object") return null;
  const kind = item.kind;
  if (kind !== "event" && kind !== "issue" && kind !== "page") return null;
  if (kind === "event" && c.conn.kind !== "personal") return null; // events are personal only (D4)
  const externalId = cut(item.externalId, 300);
  if (!externalId) return null;
  const startsAt = ISO(item.startsAt);
  const endsAt = ISO(item.endsAt);
  if (kind === "event" && (!startsAt || !endsAt || Date.parse(endsAt) < Date.parse(startsAt))) return null;
  let sourceId: string | null = null;
  let audience: string | null = null;
  if (c.conn.kind === "workspace") {
    const candidates = [...new Set([...(Array.isArray(item.sourceCandidates) ? item.sourceCandidates : []), ...(item.sourceExternalId ? [item.sourceExternalId] : [])]
      .filter((x): x is string => typeof x === "string" && !!x))];
    const order = [
      ...(c.prefer && candidates.includes(c.prefer) ? [c.prefer] : []),
      ...(item.sourceExternalId ? [item.sourceExternalId] : []),
      ...candidates,
    ];
    const key = order.find((k) => c.sources.has(k));
    if (!key) return null; // only what the workspace chose to share
    const s = c.sources.get(key)!;
    sourceId = s.id;
    audience = s.audience;
  }
  const url = typeof item.url === "string" && item.url.length <= 1000 && hostAllowed(item.url, c.adapter.linkHosts) ? item.url : null;
  const priority = typeof item.priority === "number" && Number.isInteger(item.priority) && item.priority >= 0 && item.priority <= 4 ? item.priority : null;
  const states = ["open", "in_progress", "done", "cancelled"];
  const responses = ["accepted", "tentative", "declined", "needs_action", "organiser"];
  const subtypes = ["issue", "pull_request", "task", "page", "row"];
  const email = typeof item.assigneeEmail === "string" && item.assigneeEmail.includes("@") && item.assigneeEmail.length <= 320 ? item.assigneeEmail : null;
  return {
    source_id: sourceId, audience_team_id: audience, kind, subtype: item.subtype && subtypes.includes(item.subtype) ? item.subtype : null,
    external_id: externalId, external_key: oneLine(item.externalKey, 60), url, title: oneLine(item.title, 500) ?? "(untitled)",
    state: item.state && states.includes(item.state) ? item.state : null, state_label: oneLine(item.stateLabel, 80), priority,
    container_label: oneLine(item.containerLabel, 200), assignee_external_id: oneLine(item.assigneeExternalId, 200), assignee_label: oneLine(item.assigneeLabel, 200),
    assignee_digest: email ? emailDigest(email) : null, mine: c.conn.kind === "personal" ? !!item.mine : false,
    due_on: DATE(item.dueOn), due_at: ISO(item.dueAt), starts_at: startsAt, ends_at: endsAt, all_day: typeof item.allDay === "boolean" ? item.allDay : null,
    busy: typeof item.busy === "boolean" ? item.busy : null, response: item.response && responses.includes(item.response) ? item.response : null,
    online: typeof item.online === "boolean" ? item.online : null, guests: typeof item.guests === "number" && item.guests >= 0 ? Math.min(32767, Math.floor(item.guests)) : null,
    excerpt: cut(item.excerpt, EXCERPT_MAX), provider_updated_at: ISO(item.providerUpdatedAt),
  };
}

const COLS = ["source_id", "audience_team_id", "kind", "subtype", "external_id", "external_key", "url", "title", "state", "state_label", "priority", "container_label",
  "assignee_external_id", "assignee_label", "assignee_digest", "mine", "due_on", "due_at", "starts_at", "ends_at", "all_day", "busy", "response", "online", "guests", "excerpt", "provider_updated_at"] as const;

export async function upsertItems(db: Db, conn: ConnectionRef, rows: Record<string, unknown>[]): Promise<number> {
  if (!rows.length) return 0;
  // One statement per row keeps the parameters simple; runs are bounded (perRun.items).
  let n = 0;
  for (const r of rows) {
    const values = COLS.map((k) => r[k] ?? null);
    const params = [conn.organisationId, conn.id, conn.kind, conn.kind === "personal" ? conn.membershipId : null, conn.provider, ...values];
    const placeholders = params.map((_, i) => `$${i + 1}`).join(", ");
    const res = await db.query(
      `INSERT INTO connector_items(organisation_id, connection_id, visibility, membership_id, provider, ${COLS.join(", ")})
       VALUES (${placeholders})
       ON CONFLICT (connection_id, kind, external_id) DO UPDATE SET ${COLS.filter((k) => k !== "kind" && k !== "external_id").map((k) => `${k} = EXCLUDED.${k}`).join(", ")},
         synced_at = now(), gone_at = NULL
       WHERE connector_items.provider_updated_at IS DISTINCT FROM EXCLUDED.provider_updated_at OR connector_items.provider_updated_at IS NULL
          OR connector_items.gone_at IS NOT NULL OR connector_items.source_id IS DISTINCT FROM EXCLUDED.source_id
          OR connector_items.audience_team_id IS DISTINCT FROM EXCLUDED.audience_team_id
       RETURNING id`, params);
    n += res.length;
  }
  return n;
}

/** The size bounds (§3): open items per connection, pages per connection, the most recently updated kept. */
export async function enforceBounds(db: Db, conn: ConnectionRef): Promise<void> {
  const openMax = OPEN_ITEMS_MAX[conn.kind];
  await db.query(
    `DELETE FROM connector_items WHERE id IN (
       SELECT id FROM connector_items WHERE connection_id = $1 AND kind = 'issue' AND gone_at IS NULL AND COALESCE(state, 'open') IN ('open', 'in_progress')
        ORDER BY COALESCE(provider_updated_at, synced_at) DESC OFFSET $2)`, [conn.id, openMax]);
  await db.query(
    `DELETE FROM connector_items WHERE id IN (
       SELECT id FROM connector_items WHERE connection_id = $1 AND kind = 'page' ORDER BY COALESCE(provider_updated_at, synced_at) DESC OFFSET $2)`, [conn.id, PAGES_MAX]);
}

/** The source each of these items is stored under now ("kind:externalId" → the source's external id). */
async function storedSources(db: Db, connectionId: string, items: Pick<NormalisedItem, "kind" | "externalId">[]): Promise<Map<string, string>> {
  const keys = items.map((i) => `${i.kind}:${i.externalId}`).slice(0, 2000);
  if (!keys.length) return new Map();
  const rows = await db.query<{ k: string; source: string }>(
    `SELECT i.kind || ':' || i.external_id AS k, s.external_id AS source FROM connector_items i JOIN connector_sources s ON s.id = i.source_id
      WHERE i.connection_id = $1 AND (i.kind || ':' || i.external_id) = ANY($2::text[])`, [connectionId, keys]);
  return new Map(rows.map((r) => [r.k, r.source]));
}

function makeSink(c: SinkContext): SyncSink {
  const allowed = (k: ItemKind) => c.kinds.includes(k);
  return {
    async upsert(items) {
      const list = (Array.isArray(items) ? items : []).filter((i) => i && allowed(i.kind));
      const prefer = c.conn.kind === "workspace" && list.some((i) => Array.isArray(i.sourceCandidates) && i.sourceCandidates.length > 1)
        ? await withWorker((db) => storedSources(db, c.conn.id, list)) : new Map<string, string>();
      const rows = list.map((i) => rowOf(i, { ...c, prefer: prefer.get(`${i.kind}:${i.externalId}`) ?? null })).filter((r): r is Record<string, unknown> => !!r);
      c.seen.n += rows.length;
      await withWorker((db) => upsertItems(db, c.conn, rows));
    },
    async gone(kind, externalIds) {
      if (!allowed(kind) || !externalIds.length) return;
      await withWorker((db) => db.query(`UPDATE connector_items SET gone_at = now() WHERE connection_id = $1 AND kind = $2 AND external_id = ANY($3::text[]) AND gone_at IS NULL`, [c.conn.id, kind, externalIds.slice(0, 5000)]));
    },
    async reconcileWindow(kind, from, to, seen) {
      if (!allowed(kind)) return;
      await withWorker((db) => db.query(
        `UPDATE connector_items SET gone_at = now() WHERE connection_id = $1 AND kind = $2 AND gone_at IS NULL
           AND starts_at >= $3 AND starts_at < $4 AND NOT (external_id = ANY($5::text[]))`, [c.conn.id, kind, from, to, seen.slice(0, 20000)]));
    },
    async reconcileOpen(kind, open) {
      if (!allowed(kind)) return;
      await withWorker((db) => db.query(
        `UPDATE connector_items SET gone_at = now() WHERE connection_id = $1 AND kind = $2 AND gone_at IS NULL
           AND COALESCE(state, 'open') IN ('open', 'in_progress') AND NOT (external_id = ANY($3::text[]))`, [c.conn.id, kind, open.slice(0, 20000)]));
    },
  };
}

// ---- Cadence -------------------------------------------------------------------------------------------------------------

/** In the person's working window: 07:00 to 20:00 on Monday to Friday in their zone (spec §6's default). */
export function inWorkingWindow(now: Date, timeZone: string): boolean {
  const p = localParts(now, timeZone);
  const weekday = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  return weekday >= 1 && weekday <= 5 && p.hour >= 7 && p.hour < 20;
}

/** When the stream runs next: its working or off-hours interval, ±10% jitter. */
export function nextRunAt(spec: StreamSpec, now: Date, timeZone: string, kind: ConnectionRef["kind"], rand: () => number = Math.random): Date {
  const working = kind === "workspace" || inWorkingWindow(now, timeZone);
  const minutes = Math.max(1, working ? spec.every.workingMinutes : spec.every.offMinutes);
  const jitter = 1 + (rand() * 0.2 - 0.1);
  return new Date(now.getTime() + minutes * 60_000 * jitter);
}

/** Exponential backoff for a failing connection: 1, 2, 4 … 60 minutes. */
export const backoffMinutes = (errorCount: number) => Math.min(60, 2 ** Math.max(0, Math.min(6, errorCount)));

async function zoneOf(db: Db, conn: ConnectionRef): Promise<string> {
  const r = await db.maybeOne<{ org_tz: string; own: string | null }>(
    `SELECT o.timezone AS org_tz, ap.timezone AS own FROM organisations o
       LEFT JOIN assistant_profiles ap ON ap.membership_id = $2 WHERE o.id = $1`, [conn.organisationId, conn.membershipId]).catch(() => null);
  return personTimeZone(r?.own ?? null, r?.org_tz ?? "UTC");
}

// ---- Running one stream ---------------------------------------------------------------------------------------------------

export type SyncOutcome = { ran: boolean; items: number; more: boolean; error?: string; skipped?: string };

/**
 * Runs one stream of one connection now. Skips (without error) a connection that isn't active, is backing off, or whose
 * workspace's plan lost CONNECTORS (then paused). Never throws for a provider's failure: the code goes on the connection.
 */
export async function runSync(connectionId: string, stream: string, o: { now?: Date; continuation?: number; full?: boolean } = {}): Promise<SyncOutcome> {
  const now = o.now ?? new Date();
  const pre = await withWorker(async (db) => {
    if (schema0061Missing()) return { skip: "not_ready" as const };
    const row = await loadConnection(db, connectionId);
    if (!row) return { skip: "gone" as const };
    if (row.status !== "active") return { skip: row.status };
    const plan = await resolveEntitlements(db, row.organisation_id);
    if (!plan.features.CONNECTORS) { await pauseForPlan(db, row.organisation_id, false); return { skip: "paused" as const }; }
    if (row.backoff_until && Date.parse(row.backoff_until) > now.getTime()) return { skip: "backoff" as const };
    const state = await db.maybeOne<{ cursor: string | null; full_resync: boolean; last_full_at: string | null }>(
      `SELECT cursor, full_resync, last_full_at FROM connector_sync_state WHERE connection_id = $1 AND stream = $2`, [connectionId, stream]);
    const sources = await db.query<{ id: string; kind: SourceInfo["kind"]; external_id: string; label: string; members: number | null; is_private: boolean | null; archived: boolean; audience_team_id: string | null }>(
      `SELECT id, kind, external_id, label, members, is_private, archived, audience_team_id FROM connector_sources WHERE connection_id = $1 AND selected AND NOT archived`, [connectionId]);
    return { row, state, sources, timeZone: await zoneOf(db, refOf(row)) };
  });
  if ("skip" in pre) return { ran: false, items: 0, more: false, skipped: pre.skip };
  const { row, state, sources, timeZone } = pre;
  const conn = refOf(row);
  const adapter = await adapterFor(conn.provider);
  const spec = adapter.streams.find((s) => s.name === stream);
  if (!spec || !adapter.sync) return { ran: false, items: 0, more: false, skipped: "no_stream" };
  if (!conn.canRead) return { ran: false, items: 0, more: false, skipped: "read_off" };
  const perRun = { ...DEFAULT_PER_RUN, ...spec.perRun };
  // A continuation carries on the chain it belongs to (its cursor, and whether the chain is a full reconciliation); only
  // the chain's first run decides.
  const continuing = (o.continuation ?? 0) > 0;
  const full = continuing ? !!o.full : !!state?.full_resync || !state?.last_full_at || now.getTime() - Date.parse(state.last_full_at) > spec.fullEveryMinutes * 60_000;
  const http = httpFor(conn, adapter);
  const seen = { n: 0 };
  const started = Date.now();
  try {
    // The adapter's calls run outside any transaction; each sink call is its own short one.
    const sink = makeSink({ conn, adapter, sources: new Map(sources.map((s) => [s.external_id, { id: s.id, audience: s.audience_team_id }])), kinds: spec.kinds, seen });
    const r = await adapter.sync({
      conn, http, stream, cursor: full && !continuing ? null : state?.cursor ?? null, full, now, timeZone, sink,
      selected: sources.map((s) => ({ kind: s.kind, externalId: s.external_id, label: s.label, members: s.members, isPrivate: s.is_private ?? undefined, archived: s.archived })),
      deadline: started + Math.min(perRun.ms, 30_000),
    });
    const result = await withWorker(async (db) => {
      await enforceBounds(db, conn);
      const more = !!r.more && (o.continuation ?? 0) < 50;
      const cursor = typeof r.cursor === "string" ? r.cursor.slice(0, 4000) : null;
      await db.query(
        `INSERT INTO connector_sync_state(connection_id, stream, cursor, full_resync, next_run_at, last_run_at, last_ok_at, last_full_at, last_error_code, items_last_run)
         VALUES ($1, $2, $3, false, $4, now(), now(), CASE WHEN $5 THEN now() END, NULL, $6)
         ON CONFLICT (connection_id, stream) DO UPDATE SET cursor = EXCLUDED.cursor, full_resync = false, next_run_at = EXCLUDED.next_run_at,
           last_run_at = now(), last_ok_at = now(), last_full_at = CASE WHEN $5 AND NOT $7 THEN now() ELSE connector_sync_state.last_full_at END,
           last_error_code = NULL, items_last_run = EXCLUDED.items_last_run`,
        [connectionId, stream, cursor, more ? now : nextRunAt(spec, now, timeZone, conn.kind), full, seen.n, more]);
      await db.query(`UPDATE connector_connections SET last_sync_at = now(), last_ok_at = now(), last_error_code = NULL, last_error_at = NULL, error_count = 0 WHERE id = $1 AND status = 'active'`, [connectionId]);
      if (more) {
        const step = (o.continuation ?? 0) + 1;
        await db.query(`INSERT INTO jobs(type, payload, dedup_key) VALUES ('connector.sync', $1, $2) ON CONFLICT (dedup_key) DO NOTHING`,
          [JSON.stringify({ connectionId, stream, continuation: step, full }), `connector.sync:${connectionId}:${stream}:cont:${now.getTime()}:${step}`]);
      }
      return { more };
    });
    return { ran: true, items: seen.n, more: result.more };
  } catch (err) {
    const code = err instanceof ConnectorError ? err.code : "BAD_RESPONSE";
    if (!(err instanceof ConnectorError)) console.warn(`[connectors] ${conn.provider} sync failed: ${(err as Error)?.message?.slice(0, 200) ?? "error"}`);
    await recordSyncFailure(conn, row, stream, code, err instanceof ConnectorError ? err.retryAfterSeconds : undefined, now);
    return { ran: true, items: seen.n, more: false, error: code };
  }
}

/** A failed run: the code on the connection and its stream, backoff, and (for reconnecting) the right people told. */
async function recordSyncFailure(conn: ConnectionRef, row: ConnectionRow, stream: string, code: string, retryAfter: number | undefined, now: Date): Promise<void> {
  if (code === "REAUTH_REQUIRED" || code === "REVOKED") {
    await markNeedsReauth(conn, code === "REVOKED" ? "REVOKED" : "REAUTH_REQUIRED");
  }
  await withWorker(async (db) => {
    const minutes = code === "RATE_LIMITED" ? Math.max(1, Math.ceil((retryAfter ?? backoffMinutes(row.error_count) * 60) / 60)) : backoffMinutes(row.error_count);
    const until = new Date(now.getTime() + minutes * 60_000);
    await db.query(
      `UPDATE connector_connections SET last_error_code = $2, last_error_at = now(), error_count = error_count + 1,
              backoff_until = CASE WHEN $2 IN ('RATE_LIMITED', 'PROVIDER_DOWN', 'BAD_RESPONSE', 'TOO_LARGE') THEN GREATEST(COALESCE(backoff_until, now()), $3) ELSE backoff_until END
        WHERE id = $1`, [conn.id, /^[A-Z_]{2,40}$/.test(code) ? code : "BAD_RESPONSE", until]);
    await db.query(`UPDATE connector_sync_state SET last_run_at = now(), last_error_code = $3, next_run_at = $4 WHERE connection_id = $1 AND stream = $2`,
      [conn.id, stream, code.slice(0, 40), until]);
    await connectorAudit(db, { organisationId: conn.organisationId, connectionId: conn.id, provider: conn.provider, kind: conn.kind, membershipId: conn.kind === "personal" ? conn.membershipId! : conn.connectedBy, action: "sync.failed", outcome: "failed", errorCode: code });
  });
}

// ---- Sources, one item -----------------------------------------------------------------------------------------------------

/** Re-reads a connection's sources from the app (worker): new ones added unselected, gone ones archived. */
export async function refreshSources(connectionId: string): Promise<number> {
  const row = await withWorker((db) => loadConnection(db, connectionId));
  if (!row || row.status !== "active") return 0;
  const conn = refOf(row);
  const adapter = await adapterFor(conn.provider);
  if (!adapter.sources) return 0;
  let list: SourceInfo[];
  try { list = (await adapter.sources({ conn, http: httpFor(conn, adapter) })).slice(0, 1000); }
  catch (err) {
    const code = err instanceof ConnectorError ? err.code : "BAD_RESPONSE";
    if (code === "REAUTH_REQUIRED" || code === "REVOKED") await markNeedsReauth(conn, code === "REVOKED" ? "REVOKED" : "REAUTH_REQUIRED");
    await withWorker((db) => db.query(`UPDATE connector_connections SET last_error_code = $2, last_error_at = now() WHERE id = $1`, [conn.id, code]));
    return 0;
  }
  const kinds = ["channel", "team", "project", "repo", "calendar", "page"];
  return withWorker(async (db) => {
    const seen: string[] = [];
    for (const s of list) {
      const externalId = cut(s.externalId, 300);
      const label = oneLine(s.label, 200);
      if (!externalId || !label || !kinds.includes(s.kind)) continue;
      seen.push(`${s.kind}:${externalId}`);
      await db.query(
        `INSERT INTO connector_sources(organisation_id, connection_id, visibility, membership_id, kind, external_id, label, members, is_private, archived, seen_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
         ON CONFLICT (connection_id, kind, external_id) DO UPDATE SET label = EXCLUDED.label, members = EXCLUDED.members, is_private = EXCLUDED.is_private,
           archived = EXCLUDED.archived, seen_at = now()`,
        [conn.organisationId, conn.id, conn.kind, conn.kind === "personal" ? conn.membershipId : null, s.kind, externalId, label,
          typeof s.members === "number" && s.members >= 0 ? Math.floor(s.members) : null, typeof s.isPrivate === "boolean" ? s.isPrivate : null, !!s.archived]);
    }
    await db.query(`UPDATE connector_sources SET archived = true, selected = false WHERE connection_id = $1 AND NOT ((kind || ':' || external_id) = ANY($2::text[]))`, [conn.id, seen]);
    // An app with no streams (Slack, Teams; integration fix, 22 October 2026): reading its channels is its check, so the
    // card says "Last checked …" rather than "Checking for the first time…" for ever.
    if (!adapter.streams.length) {
      await db.query(`UPDATE connector_connections SET last_sync_at = now(), last_ok_at = now(), last_error_code = NULL, last_error_at = NULL, error_count = 0 WHERE id = $1 AND status = 'active'`, [conn.id]);
    }
    return seen.length;
  });
}

/** One item again (a webhook named it): upserted, or gone when the app no longer has it. */
export async function refreshItem(connectionId: string, kind: ItemKind, externalId: string): Promise<"upserted" | "gone" | "skipped"> {
  const pre = await withWorker(async (db) => {
    const row = await loadConnection(db, connectionId);
    if (!row || row.status !== "active") return null;
    const sources = await db.query<{ id: string; external_id: string; audience_team_id: string | null }>(
      `SELECT id, external_id, audience_team_id FROM connector_sources WHERE connection_id = $1 AND selected AND NOT archived`, [connectionId]);
    return { row, sources };
  });
  if (!pre) return "skipped";
  const conn = refOf(pre.row);
  const adapter = await adapterFor(conn.provider);
  if (!adapter.fetchItem || !conn.canRead) return "skipped";
  const item = await adapter.fetchItem({ conn, http: httpFor(conn, adapter), kind, externalId }).catch((err: unknown) => {
    if (err instanceof ConnectorError && err.code === "NOT_FOUND") return null;
    throw err;
  });
  return withWorker(async (db) => {
    if (!item) {
      await db.query(`UPDATE connector_items SET gone_at = now() WHERE connection_id = $1 AND kind = $2 AND external_id = $3 AND gone_at IS NULL`, [connectionId, kind, externalId]);
      return "gone" as const;
    }
    const prefer = conn.kind === "workspace" ? (await storedSources(db, conn.id, [item])).get(`${item.kind}:${item.externalId}`) ?? null : null;
    const r = rowOf(item, { conn, adapter, prefer, sources: new Map(pre.sources.map((s) => [s.external_id, { id: s.id, audience: s.audience_team_id }])) });
    if (!r) {
      // A workspace item that no longer belongs to any selected source leaves Boredroom (security fix, 22 October 2026).
      if (conn.kind === "workspace") {
        await db.query(`UPDATE connector_items SET gone_at = now() WHERE connection_id = $1 AND kind = $2 AND external_id = $3 AND gone_at IS NULL`, [connectionId, kind, externalId]);
        return "gone" as const;
      }
      return "skipped" as const;
    }
    // A personal connection's item that is no longer the person's: it leaves their day.
    if (conn.kind === "personal" && !r.mine && kind === "issue") {
      await db.query(`UPDATE connector_items SET gone_at = now() WHERE connection_id = $1 AND kind = $2 AND external_id = $3`, [connectionId, kind, externalId]);
      return "gone" as const;
    }
    await upsertItems(db, conn, [r]);
    return "upserted" as const;
  });
}

/** Upserts an item an action returned (worker context), when it belongs to a selected source or a personal connection. */
export async function upsertActedItem(conn: ConnectionRef, adapter: ProviderAdapter, item: NormalisedItem): Promise<void> {
  await withWorker(async (db) => {
    const sources = await db.query<{ id: string; external_id: string; audience_team_id: string | null }>(
      `SELECT id, external_id, audience_team_id FROM connector_sources WHERE connection_id = $1 AND selected AND NOT archived`, [conn.id]);
    const r = rowOf(item, { conn, adapter, sources: new Map(sources.map((s) => [s.external_id, { id: s.id, audience: s.audience_team_id }])) });
    if (r) await upsertItems(db, conn, [r]);
  });
}

/** Connections whose rows a list of ids names (worker), as refs. */
export async function connectionsByIds(ids: string[]): Promise<ConnectionRef[]> {
  if (!ids.length) return [];
  const rows = await withWorker((db) => db.query<ConnectionRow>(`SELECT ${CONNECTION_COLUMNS} FROM connector_connections c WHERE c.id = ANY($1::uuid[])`, [ids]));
  return rows.map(refOf);
}

export { notifyTrouble };
