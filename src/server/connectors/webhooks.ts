/**
 * Connected apps: webhooks (owner decisions, 22 October 2026: connectors; spec §7). A delivery is trusted for one thing
 * only: which connection should look again, with Boredroom's own tokens. The raw body (at most 1 MiB) is verified by the
 * adapter (signatures on the raw bytes, constant-time comparisons, replay windows); a failure answers 401 with no body
 * and nothing else happens. Deliveries are deduplicated; the work is queued for the worker and the answer is quick.
 *
 * Verified before any database work (owner request, 23 October 2026: realtime plan, phase 0, item 5): unsigned junk at
 * night used to wake Neon, because a schema check ran first. Providers whose secret is in the environment (Slack,
 * GitHub, Linear, Jira) never touch the database for a delivery that doesn't verify; Asana, whose secret is per hook and
 * stored, checks the headers' shape first and looks its secret up only for a well-formed delivery. The first database
 * touch logs the wake tag `webhook:<provider>` (no ids, no addresses). Server-only.
 */
import { withWorker, type Db } from "@/server/db";
import { readCappedBytes } from "@/server/lib/api";
import { noteMissing0061 } from "@/server/lib/schema-0061";
import { wakeTagOnce } from "@/server/lib/wake-tag";
import { CONNECTOR_ERRORS } from "@/lib/connectors/words";
import { PROVIDER_LABELS } from "@/lib/connectors/types";
import { adapterFor } from "./registry";
import { openToken, sealToken, webhookAad } from "./crypto";
import { CONNECTION_COLUMNS, disconnectIn, notifyTrouble, refOf, type ConnectionRow } from "./connections";
import type { ProviderAdapter, ProviderId, WebhookRoute } from "./types";

export const WEBHOOK_MAX_BYTES = 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ROUTES = 50;

const empty = (status: number) => new Response(null, { status });

/** The sealed secret of a registered hook (Asana's handshake secret), opened; null when unknown or not sealed yet. */
async function secretFor(db: Db, provider: ProviderId, hookId: string): Promise<string | null> {
  if (!UUID.test(hookId)) return null;
  const r = await db.maybeOne<{ secret_enc: string | null }>(`SELECT secret_enc FROM connector_webhooks WHERE id = $1 AND provider = $2`, [hookId, provider]);
  return r?.secret_enc ? openToken(r.secret_enc, webhookAad(hookId)) : null;
}

/** Seals a handshake secret into a pending hook that has none yet (once). */
async function saveSecret(db: Db, provider: ProviderId, hookId: string, secret: string): Promise<boolean> {
  if (!UUID.test(hookId) || !secret || secret.length > 500) return false;
  const r = await db.maybeOne(
    `UPDATE connector_webhooks SET secret_enc = $3, status = 'active', last_event_at = now(), updated_at = now()
      WHERE id = $1 AND provider = $2 AND status = 'pending' AND secret_enc IS NULL RETURNING id`, [hookId, provider, sealToken(secret, webhookAad(hookId))]);
  return !!r;
}

/** The live connections a route names (worker context). */
async function connectionsFor(db: Db, provider: ProviderId, r: WebhookRoute): Promise<ConnectionRow[]> {
  if (r.by === "tenant") {
    return db.query<ConnectionRow>(`SELECT ${CONNECTION_COLUMNS} FROM connector_connections c WHERE c.provider = $1 AND c.external_tenant_id = $2 AND c.status IN ('active', 'needs_reauth') LIMIT 200`, [provider, String(r.tenantId).slice(0, 200)]);
  }
  if (r.by === "account") {
    return db.query<ConnectionRow>(
      `SELECT ${CONNECTION_COLUMNS} FROM connector_connections c WHERE c.provider = $1 AND c.status IN ('active', 'needs_reauth')
         AND (c.external_account_id = $2 OR c.id IN (SELECT connection_id FROM connector_identities WHERE provider = $1 AND external_user_id = $2)) LIMIT 200`,
      [provider, String(r.accountId).slice(0, 200)]);
  }
  const id = String(r.webhookId).slice(0, 200);
  const asUuid = UUID.test(id) ? id : null;
  if (r.ours) {
    // Boredroom's own hook id only (security fix, 22 October 2026): a provider's hook ids repeat across tenants (Jira's are
    // small numbers per site), so a delivery from one tenant never reaches another's connection.
    if (!asUuid) return [];
    const matched = Array.isArray(r.matched) ? r.matched.map((x) => String(x).slice(0, 200)).slice(0, 20) : null;
    await db.query(`UPDATE connector_webhooks SET last_event_at = now() WHERE provider = $1 AND id = $2::uuid`, [provider, asUuid]);
    return db.query<ConnectionRow>(
      `SELECT ${CONNECTION_COLUMNS} FROM connector_connections c JOIN connector_webhooks w ON w.connection_id = c.id
        WHERE w.provider = $1 AND w.id = $2::uuid AND ($3::text[] IS NULL OR w.external_id = ANY($3::text[])) AND c.status IN ('active', 'needs_reauth') LIMIT 1`,
      [provider, asUuid, matched]);
  }
  await db.query(`UPDATE connector_webhooks SET last_event_at = now() WHERE provider = $1 AND (external_id = $2 OR id = $3::uuid)`, [provider, id, asUuid]);
  return db.query<ConnectionRow>(
    `SELECT ${CONNECTION_COLUMNS} FROM connector_connections c JOIN connector_webhooks w ON w.connection_id = c.id
      WHERE w.provider = $1 AND (w.external_id = $2 OR w.id = $3::uuid) AND c.status IN ('active', 'needs_reauth') LIMIT 200`, [provider, id, asUuid]);
}

/** What one verified route asks for: a re-fetch of one item, a sync of the connection's streams, or a disconnect. */
async function apply(db: Db, adapter: ProviderAdapter, route: WebhookRoute, now: Date): Promise<number> {
  const rows = await connectionsFor(db, adapter.id, route);
  const minute = Math.floor(now.getTime() / 60_000);
  let queued = 0;
  for (const row of rows) {
    if ("revoked" in route && route.revoked) {
      // A removal from before this connection was made is an old (or replayed) delivery: it changes nothing (security
      // fix, 22 October 2026).
      const at = "at" in route && typeof route.at === "string" ? Date.parse(route.at) : NaN;
      if (!Number.isNaN(at) && at < Date.parse(row.created_at)) continue;
      // The app says Boredroom was removed: disconnected here too, and the right people told.
      await disconnectIn(db, row, row.connected_by, { reason: "revoked" });
      await notifyTrouble(db, refOf(row), "revoked", CONNECTOR_ERRORS.REVOKED(PROVIDER_LABELS[row.provider]));
      queued++;
      continue;
    }
    if (row.status !== "active") continue;
    if (route.externalId && route.kind) {
      const ext = String(route.externalId).slice(0, 300);
      await db.query(`INSERT INTO jobs(type, payload, dedup_key) VALUES ('connector.item', $1, $2) ON CONFLICT (dedup_key) DO NOTHING`,
        [JSON.stringify({ connectionId: row.id, kind: route.kind, externalId: ext }), `connector.item:${row.id}:${route.kind}:${ext}:${minute}`]);
      queued++;
      continue;
    }
    for (const s of adapter.streams) {
      await db.query(`INSERT INTO jobs(type, payload, dedup_key) VALUES ('connector.sync', $1, $2) ON CONFLICT (dedup_key) DO NOTHING`,
        [JSON.stringify({ connectionId: row.id, stream: s.name, reason: "webhook" }), `connector.sync:${row.id}:${s.name}:hook:${minute}`]);
      queued++;
    }
  }
  return queued;
}

/**
 * POST /api/connectors/webhooks/[provider] (and Asana's /asana/[hook]). 401 with no body when verification fails; the
 * adapter's own reply (Slack's url_verification, Asana's handshake) when it has one; otherwise 200 once queued.
 */
export async function handleWebhook(provider: ProviderId, req: Request, hookId?: string, now: Date = new Date()): Promise<Response> {
  let adapter: ProviderAdapter;
  try { adapter = await adapterFor(provider); } catch { return empty(404); }
  if (!adapter.webhook || !adapter.configured(process.env)) return empty(404);
  let raw: Uint8Array;
  try { raw = await readCappedBytes(req, WEBHOOK_MAX_BYTES); } catch { return empty(413); }
  const url = new URL(req.url);
  const touch = wakeTagOnce(`webhook:${provider}`);
  // Only through these does verification reach the database (a stored per-hook secret). A database without 0061 has no
  // hooks: no secret, nothing saved (schema-0061.ts).
  const lookup = async <T>(fn: (db: Db) => Promise<T>, none: T): Promise<T> => {
    touch();
    try { return await withWorker(fn); } catch (err) { if (noteMissing0061(err)) return none; throw err; }
  };
  let verified: Awaited<ReturnType<NonNullable<ProviderAdapter["webhook"]>["verify"]>>;
  try {
    verified = await adapter.webhook.verify({
      raw, headers: req.headers, url,
      secretFor: (id) => lookup((db) => secretFor(db, provider, hookId ?? id), null),
      saveSecret: (id, secret) => lookup((db) => saveSecret(db, provider, hookId ?? id, secret), false),
    });
  } catch {
    return empty(401);
  }
  if (!verified.ok) return empty(401);
  if (verified.reply) return verified.reply;
  const deliveryId = String(verified.deliveryId ?? "").slice(0, 200);
  if (!deliveryId) return empty(401);
  let body: unknown = null;
  try { body = JSON.parse(new TextDecoder().decode(raw)); } catch { body = null; }
  let routes: WebhookRoute[] = [];
  try { routes = (adapter.webhook.route({ body, headers: req.headers, url, ...(hookId ? { hookId } : {}) }) ?? []).slice(0, MAX_ROUTES); } catch { routes = []; }
  touch();
  try {
    await withWorker(async (db) => {
      const fresh = await db.maybeOne(
        `INSERT INTO connector_webhook_deliveries(provider, delivery_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING delivery_id`, [provider, deliveryId]);
      if (!fresh) return;
      for (const r of routes) await apply(db, adapter, r, now);
    });
  } catch (err) {
    // Before 0061 (a database restored to before it): answered 200 and dropped, as the guard did.
    if (noteMissing0061(err)) return empty(200);
    throw err;
  }
  return empty(200);
}
