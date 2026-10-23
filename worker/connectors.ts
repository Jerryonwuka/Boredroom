/**
 * Connected apps in the worker (owner decisions, 22 October 2026: connectors; spec §5.6, §6, §7, §10). The schedule
 * (every 15 seconds, from scheduleMaintenance) queues due syncs (at most 30 a tick), early token refreshes, the hourly
 * purge, the people-and-plans sweep, webhook renewals, providers' periodic obligations and today's digests; the handlers
 * run one bounded job each. Every handler returns at once before migration 0061. Jobs carry ids only, never a token.
 */
import { withWorker, type Db } from "../src/server/db";
import type { Handler } from "./handlers";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STREAM = /^[a-z_]{2,30}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** No query (owner request, 23 October 2026: realtime plan, phase 0): false only after a query found 0061's tables missing. */
async function ready(): Promise<boolean> {
  const { schema0061Missing } = await import("../src/server/lib/schema-0061");
  return !schema0061Missing();
}

const queue = (db: Db, type: string, payload: Record<string, unknown>, dedupKey: string, runAt?: Date) =>
  db.query(`INSERT INTO jobs(type, payload, dedup_key, next_run_at) VALUES ($1, $2, $3, COALESCE($4, now())) ON CONFLICT (dedup_key) DO NOTHING`,
    [type, JSON.stringify(payload), dedupKey, runAt ?? null]);

// ---- The schedule ------------------------------------------------------------------------------------------------------------

/** `sweep: false`: outside every working window (worker night mode, owner request, 23 October 2026), no connector.sweep. */
export async function scheduleConnectors(now: Date = new Date(), opts: { sweep?: boolean } = {}): Promise<{ syncs: number; refreshes: number }> {
  if (!(await ready())) return { syncs: 0, refreshes: 0 };
  const five = Math.floor(now.getTime() / 300_000);
  const ten = Math.floor(now.getTime() / 600_000);
  const hour = Math.floor(now.getTime() / 3_600_000);
  const out = await withWorker(async (db) => {
    const due = await db.query<{ connection_id: string; stream: string }>(
      `SELECT s.connection_id, s.stream FROM connector_sync_state s JOIN connector_connections c ON c.id = s.connection_id
        WHERE s.next_run_at <= $1::timestamptz AND c.status = 'active' AND (c.backoff_until IS NULL OR c.backoff_until <= $1::timestamptz)
          AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.type = 'connector.sync' AND j.state IN ('pending', 'running')
                            AND j.payload->>'connectionId' = s.connection_id::text AND j.payload->>'stream' = s.stream)
        ORDER BY s.next_run_at LIMIT 30`, [now]);
    for (const d of due) await queue(db, "connector.sync", { connectionId: d.connection_id, stream: d.stream }, `connector.sync:${d.connection_id}:${d.stream}:${five}`);
    // Rotating refresh tokens are used well inside their lifetimes even when nobody is looking (§6).
    const expiring = await db.query<{ connection_id: string }>(
      `SELECT t.connection_id FROM connector_tokens t JOIN connector_connections c ON c.id = t.connection_id
        WHERE c.status = 'active' AND t.expires_at IS NOT NULL AND t.expires_at < $1::timestamptz + interval '15 minutes' AND t.refresh_enc IS NOT NULL LIMIT 30`, [now]);
    for (const e of expiring) await queue(db, "connector.refresh", { connectionId: e.connection_id }, `connector.refresh:${e.connection_id}:${ten}`);
    await queue(db, "connector.purge", {}, `connector.purge:${hour}`);
    if (opts.sweep !== false) await queue(db, "connector.sweep", {}, `connector.sweep:${ten}`);
    await queue(db, "connector.webhook_renew", {}, `connector.webhook_renew:${hour}`);
    await queue(db, "connector.maintenance", {}, `connector.maintenance:${hour}`);
    return { syncs: due.length, refreshes: expiring.length };
  });
  const { scheduleConnectorPosts } = await import("../src/server/connectors/posting/post");
  await scheduleConnectorPosts(now).catch((err) => console.error("[worker] connector posts schedule", (err as Error).message));
  return out;
}

// ---- The handlers --------------------------------------------------------------------------------------------------------------

const sync: Handler = async (payload) => {
  const connectionId = String(payload.connectionId ?? "");
  const stream = String(payload.stream ?? "");
  if (!UUID.test(connectionId) || !STREAM.test(stream) || !(await ready())) return;
  const { runSync } = await import("../src/server/connectors/sync");
  const continuation = typeof payload.continuation === "number" ? payload.continuation : 0;
  const r = await runSync(connectionId, stream, { continuation, full: payload.full === true });
  if (r.error) console.warn(`[worker] connector sync ${stream}: ${r.error}`);
};

const item: Handler = async (payload) => {
  const connectionId = String(payload.connectionId ?? "");
  const kind = payload.kind === "event" || payload.kind === "issue" || payload.kind === "page" ? payload.kind : null;
  const externalId = typeof payload.externalId === "string" ? payload.externalId.slice(0, 300) : "";
  if (!UUID.test(connectionId) || !kind || !externalId || !(await ready())) return;
  const { refreshItem } = await import("../src/server/connectors/sync");
  await refreshItem(connectionId, kind, externalId).catch((err: unknown) => console.warn(`[worker] connector item: ${(err as { code?: string })?.code ?? "error"}`));
};

const sources: Handler = async (payload) => {
  const connectionId = String(payload.connectionId ?? "");
  if (!UUID.test(connectionId) || !(await ready())) return;
  const { refreshSources } = await import("../src/server/connectors/sync");
  await refreshSources(connectionId);
};

const refresh: Handler = async (payload) => {
  const connectionId = String(payload.connectionId ?? "");
  if (!UUID.test(connectionId) || !(await ready())) return;
  const { refreshTokens } = await import("../src/server/connectors/tokens");
  await refreshTokens(connectionId, { aheadMs: 15 * 60_000 }).catch((err: unknown) => console.warn(`[worker] connector refresh: ${(err as { code?: string })?.code ?? "error"}`));
};

/** Revoke at the app (best effort, one retry), delete webhooks at the app, then the tokens and the connection. */
const revoke: Handler = async (payload) => {
  const connectionId = String(payload.connectionId ?? "");
  if (!UUID.test(connectionId) || !(await ready())) return;
  const [{ loadConnection, refOf }, { loadTokens }, { adapterFor }, { httpFor }] = await Promise.all([
    import("../src/server/connectors/connections"), import("../src/server/connectors/tokens"), import("../src/server/connectors/registry"), import("../src/server/connectors/http")]);
  const pre = await withWorker(async (db) => {
    const row = await loadConnection(db, connectionId);
    if (!row || row.status !== "disconnecting") return null;
    const tokens = await loadTokens(db, connectionId);
    const hooks = await db.query<{ id: string; external_id: string | null }>(`SELECT id, external_id FROM connector_webhooks WHERE connection_id = $1`, [connectionId]);
    return { row, tokens, hooks };
  });
  if (!pre) return;
  const conn = refOf(pre.row);
  try {
    const adapter = await adapterFor(conn.provider);
    const http = httpFor(conn, adapter, {
      token: async () => (pre.tokens ? { accessToken: pre.tokens.accessToken, expiresAt: null } : null),
      refresh: async () => { throw new Error("no refresh while disconnecting"); },
      backoff: async () => undefined,
    });
    for (const h of pre.hooks) {
      if (h.external_id && adapter.deleteWebhook) await adapter.deleteWebhook({ conn, http, externalId: h.external_id }).catch(() => undefined);
    }
    if (pre.tokens && adapter.revoke) {
      for (let i = 0; i < 2; i++) {
        try { await adapter.revoke({ conn, http, tokens: pre.tokens }); break; } catch { /* best effort, once more */ }
      }
    }
  } catch { /* an adapter that can't load still lets the connection go */ }
  await withWorker(async (db) => {
    await db.query(`DELETE FROM connector_tokens WHERE connection_id = $1`, [connectionId]);
    await db.query(`DELETE FROM connector_connections WHERE id = $1 AND status = 'disconnecting'`, [connectionId]);
  });
};

/** Registers the adapter's webhooks for a new connection (Jira dynamic, Asana handshake). */
const webhooks: Handler = async (payload) => {
  const connectionId = String(payload.connectionId ?? "");
  if (!UUID.test(connectionId) || !(await ready())) return;
  const [{ loadConnection, refOf }, { adapterFor }, { httpFor }, { hookUrlFor }] = await Promise.all([
    import("../src/server/connectors/connections"), import("../src/server/connectors/registry"), import("../src/server/connectors/http"), import("../src/server/connectors/env")]);
  const row = await withWorker((db) => loadConnection(db, connectionId));
  if (!row || row.status !== "active") return;
  const conn = refOf(row);
  const adapter = await adapterFor(conn.provider);
  if (!adapter.registerWebhooks) return;
  // Hooks only where the workspace chose (security fix, 22 October 2026); this job runs again when the choice changes.
  const selected = await withWorker((db) => db.query<{ kind: import("../src/server/connectors/types").SourceKind; external_id: string; label: string }>(
    `SELECT kind, external_id, label FROM connector_sources WHERE connection_id = $1 AND selected AND NOT archived`, [conn.id]));
  const made = await adapter.registerWebhooks({
    conn, http: httpFor(conn, adapter), selected: selected.map((s) => ({ kind: s.kind, externalId: s.external_id, label: s.label })),
    hookUrl: (hookId) => hookUrlFor(conn.provider, hookId),
    newHook: () => withWorker((db) => db.one<{ id: string }>(`INSERT INTO connector_webhooks(connection_id, provider, status) VALUES ($1, $2, 'pending') RETURNING id`, [conn.id, conn.provider])).then((r) => r.id),
  });
  await withWorker(async (db) => {
    for (const h of made.slice(0, 20)) {
      if (!UUID.test(h.hookId)) continue;
      await db.query(
        `UPDATE connector_webhooks SET external_id = $2, expires_at = $3, status = CASE WHEN provider = 'asana' AND secret_enc IS NULL THEN status ELSE 'active' END, updated_at = now()
          WHERE id = $1 AND connection_id = $4`, [h.hookId, String(h.externalId).slice(0, 300), h.expiresAt, conn.id]);
    }
  });
};

/** Renews webhooks expiring within 5 days (Jira's 30-day dynamic webhooks); Asana's silent for 24 hours are re-created. */
const webhookRenew: Handler = async () => {
  if (!(await ready())) return;
  const [{ loadConnection, refOf }, { adapterFor }, { httpFor }] = await Promise.all([
    import("../src/server/connectors/connections"), import("../src/server/connectors/registry"), import("../src/server/connectors/http")]);
  const rows = await withWorker((db) => db.query<{ id: string; connection_id: string; external_id: string | null; provider: string; stale: boolean }>(
    `SELECT w.id, w.connection_id, w.external_id, w.provider, (w.provider = 'asana' AND COALESCE(w.last_event_at, w.created_at) < now() - interval '24 hours') AS stale
       FROM connector_webhooks w JOIN connector_connections c ON c.id = w.connection_id AND c.status = 'active'
      WHERE (w.expires_at IS NOT NULL AND w.expires_at < now() + interval '5 days')
         OR (w.provider = 'asana' AND COALESCE(w.last_event_at, w.created_at) < now() - interval '24 hours') LIMIT 20`));
  for (const w of rows) {
    const row = await withWorker((db) => loadConnection(db, w.connection_id));
    if (!row) continue;
    const conn = refOf(row);
    const adapter = await adapterFor(conn.provider);
    const http = httpFor(conn, adapter);
    try {
      if (w.stale) {
        await withWorker((db) => db.query(`DELETE FROM connector_webhooks WHERE id = $1`, [w.id]));
        await withWorker((db) => queue(db, "connector.webhooks", { connectionId: conn.id }, `connector.webhooks:${conn.id}:renew:${Math.floor(Date.now() / 3_600_000)}`));
      } else if (w.external_id && adapter.renewWebhook) {
        const until = await adapter.renewWebhook({ conn, http, externalId: w.external_id });
        await withWorker((db) => db.query(`UPDATE connector_webhooks SET expires_at = $2, updated_at = now() WHERE id = $1`, [w.id, until]));
      }
    } catch (err) {
      await withWorker((db) => db.query(`UPDATE connector_webhooks SET status = 'failed', updated_at = now() WHERE id = $1`, [w.id]));
      console.warn(`[worker] connector webhook renewal: ${(err as { code?: string })?.code ?? "error"}`);
    }
  }
};

const post: Handler = async (payload) => {
  const routeId = String(payload.routeId ?? "");
  const kind = ["daily_digest", "standup", "standup_entry", "reminders"].includes(String(payload.kind)) ? (payload.kind as "daily_digest" | "standup" | "standup_entry" | "reminders") : null;
  const localDate = String(payload.localDate ?? "");
  if (!UUID.test(routeId) || !kind || !DATE.test(localDate) || !(await ready())) return;
  const entryId = typeof payload.entryId === "string" && UUID.test(payload.entryId) ? payload.entryId : undefined;
  const rollupId = typeof payload.rollupId === "string" && UUID.test(payload.rollupId) ? payload.rollupId : undefined;
  const { runPostJob } = await import("../src/server/connectors/posting/post");
  await runPostJob({ routeId, kind, localDate, entryId, rollupId });
};

/** Providers' periodic obligations (Atlassian personal data reporting), each at most once per its window. */
const maintenance: Handler = async () => {
  if (!(await ready())) return;
  const [{ PROVIDER_IDS, adapterFor }, { CONNECTION_COLUMNS, refOf }, { httpFor }] = await Promise.all([
    import("../src/server/connectors/registry"), import("../src/server/connectors/connections"), import("../src/server/connectors/http")]);
  for (const id of PROVIDER_IDS) {
    let adapter;
    try { adapter = await adapterFor(id); } catch { continue; }
    if (!adapter.maintenance?.length || !adapter.configured(process.env)) continue;
    for (const m of adapter.maintenance) {
      const windowMs = Math.max(1, m.everyHours) * 3_600_000;
      const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);
      const bucket = `maint:${id}:${m.name}`.toLowerCase().replace(/[^a-z0-9_:.-]/g, "_").slice(0, 120);
      const claimed = await withWorker((db) => db.maybeOne(
        `INSERT INTO connector_rate_budget(bucket, window_start, used, cap) VALUES ($1, $2, 1, 1) ON CONFLICT (bucket, window_start) DO NOTHING RETURNING used`, [bucket, windowStart]));
      if (!claimed) continue;
      const rows = await withWorker((db) => db.query<import("../src/server/connectors/connections").ConnectionRow>(
        `SELECT ${CONNECTION_COLUMNS} FROM connector_connections c WHERE c.provider = $1 AND c.status = 'active' LIMIT 500`, [id]));
      const connections = rows.map(refOf);
      try {
        await m.run({
          connections, now: new Date(),
          httpFor: (conn) => httpFor(conn, adapter),
          accounts: () => withWorker((db) => db.query<{ externalUserId: string; tenantId: string | null; updatedAt: string; connectionId: string }>(
            `SELECT x.external_user_id AS "externalUserId", x.tenant_id AS "tenantId", max(x.updated_at)::text AS "updatedAt", min(x.connection_id::text) AS "connectionId" FROM (
               SELECT ci.external_user_id, ci.external_tenant_id AS tenant_id, ci.created_at AS updated_at, ci.connection_id FROM connector_identities ci WHERE ci.provider = $1
               UNION ALL
               SELECT i.assignee_external_id, c.external_tenant_id, i.updated_at, i.connection_id FROM connector_items i JOIN connector_connections c ON c.id = i.connection_id
                WHERE i.provider = $1 AND i.assignee_external_id IS NOT NULL) x
             GROUP BY x.external_user_id, x.tenant_id LIMIT 20000`, [id])),
          eraseAccount: (externalUserId) => withWorker(async (db) => {
            await db.query(`DELETE FROM connector_identities WHERE provider = $1 AND external_user_id = $2`, [id, externalUserId]);
            await db.query(`UPDATE connector_items SET assignee_external_id = NULL, assignee_label = NULL WHERE provider = $1 AND assignee_external_id = $2`, [id, externalUserId]);
          }),
        });
      } catch (err) {
        console.warn(`[worker] connector maintenance ${id}/${m.name}: ${(err as { code?: string })?.code ?? "error"}`);
      }
    }
  }
};

/** Retention (§3): what is gone, past or expired goes. */
export async function purgeConnectors(db: Db): Promise<void> {
  await db.query(`DELETE FROM connector_items WHERE gone_at IS NOT NULL AND gone_at < now() - interval '7 days'`);
  await db.query(`DELETE FROM connector_items WHERE kind = 'event' AND ends_at < now() - interval '30 days'`);
  await db.query(`DELETE FROM connector_items WHERE kind = 'issue' AND state IN ('done', 'cancelled') AND COALESCE(provider_updated_at, synced_at) < now() - interval '30 days'`);
  await db.query(`DELETE FROM connector_oauth_states WHERE expires_at < now() - interval '1 day'`);
  await db.query(`DELETE FROM connector_webhook_deliveries WHERE received_at < now() - interval '3 days'`);
  await db.query(`DELETE FROM connector_rate_budget WHERE window_start < now() - interval '2 days'`);
  // The app role may not delete audit rows (0061 revokes it): only the definer function, which keeps 400 days.
  await db.query(`SELECT app_connector_audit_purge()`);
}

const purge: Handler = async () => {
  if (!(await ready())) return;
  await withWorker((db) => purgeConnectors(db));
};

/**
 * People and plans (§5.6.3, §5.6.4): a person who left loses their personal connections; a workspace connection made by
 * them with an owner-bound adapter needs reconnecting (owners and HR told); a workspace whose plan lost CONNECTORS has its
 * connections paused, and resumed when it has it again.
 */
export async function sweepConnectors(now: Date = new Date()): Promise<{ disconnected: number; ownerLeft: number; paused: number; resumed: number }> {
  const [{ CONNECTION_COLUMNS, disconnectIn, markNeedsReauth, pauseForPlan, refOf }, { adapterFor }, { resolveEntitlements }] = await Promise.all([
    import("../src/server/connectors/connections"), import("../src/server/connectors/registry"), import("../src/server/lib/entitlements")]);
  type Row = import("../src/server/connectors/connections").ConnectionRow;
  const left = await withWorker((db) => db.query<Row>(
    `SELECT ${CONNECTION_COLUMNS} FROM connector_connections c JOIN memberships m ON m.id = c.membership_id
      WHERE c.kind = 'personal' AND c.status <> 'disconnecting' AND m.status <> 'active' LIMIT 100`));
  for (const r of left) await withWorker((db) => disconnectIn(db, r, r.membership_id!, { reason: "left" }));
  const orphaned = await withWorker((db) => db.query<Row & { name: string }>(
    `SELECT ${CONNECTION_COLUMNS}, p.display_name AS name FROM connector_connections c JOIN memberships m ON m.id = c.connected_by JOIN profiles p ON p.id = m.user_id
      WHERE c.kind = 'workspace' AND c.status = 'active' AND m.status <> 'active' LIMIT 100`));
  let ownerLeft = 0;
  for (const r of orphaned) {
    const adapter = await adapterFor(r.provider).catch(() => null);
    if (!adapter?.ownerBound) continue;
    await markNeedsReauth(refOf(r), "OWNER_LEFT", { name: r.name });
    ownerLeft++;
  }
  const orgs = await withWorker((db) => db.query<{ organisation_id: string }>(`SELECT DISTINCT organisation_id FROM connector_connections WHERE status IN ('active', 'needs_reauth', 'paused') LIMIT 500`));
  let paused = 0, resumed = 0;
  for (const o of orgs) {
    await withWorker(async (db) => {
      const plan = await resolveEntitlements(db, o.organisation_id);
      const n = await pauseForPlan(db, o.organisation_id, !!plan.features.CONNECTORS);
      if (plan.features.CONNECTORS) resumed += n; else paused += n;
    });
  }
  void now;
  return { disconnected: left.length, ownerLeft, paused, resumed };
}

const sweep: Handler = async () => {
  if (!(await ready())) return;
  const r = await sweepConnectors();
  if (r.disconnected || r.ownerLeft || r.paused || r.resumed) console.log(`[worker] connectors: ${r.disconnected} disconnected (left), ${r.ownerLeft} need reconnecting, ${r.paused} paused, ${r.resumed} resumed`);
};

export const connectorHandlers: Record<string, Handler> = {
  "connector.sync": sync,
  "connector.item": item,
  "connector.sources": sources,
  "connector.refresh": refresh,
  "connector.revoke": revoke,
  "connector.webhooks": webhooks,
  "connector.webhook_renew": webhookRenew,
  "connector.post": post,
  "connector.maintenance": maintenance,
  "connector.purge": purge,
  "connector.sweep": sweep,
};
