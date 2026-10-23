/**
 * Connected apps: acting in an app (owner decisions, 22 October 2026: connectors; spec §9.3, §9.4, §9.8). Resolves the
 * item, the source, the connection and the actor; applies the workspace's policy, the connection's own switches and the
 * adapter's kinds; finds the adapter's ActionSpec; validates the input with its schema before prepare and again before
 * run (a Confirm press re-validates and re-resolves under the person's row security); audits; and upserts what came back.
 * Readbacks are built by the adapter from validated input and resolved provider data, never from the model's words.
 * Server-only.
 */
import { withUser, withWorker, type Db } from "@/server/db";
import type { OrgContext } from "@/server/lib/api";
import { BRENDA_CONNECTOR_WORDS } from "@/lib/connectors/words";
import { PROVIDER_LABELS } from "@/lib/connectors/types";
import { DEFAULT_ASSISTANT_NAME } from "@/lib/assistant-look";
import { adapterFor } from "./registry";
import { httpFor } from "./http";
import { connectorAudit } from "./audit";
import { CONNECTION_COLUMNS, policyFor, refOf, type ConnectionRow } from "./connections";
import { personZone } from "./items";
import { upsertActedItem } from "./sync";
import { ConnectorError, type ActResult, type ActionSpec, type Actor, type ConnectionRef, type ItemKind, type Prepared, type ProviderAdapter, type ProviderId, type Risk, type StoredItem, type StoredSource } from "./types";

export const SHARED_PER_HOUR = 20;
export const SHARED_PER_DAY = 100;

/** A refusal Brenda passes on in words (never provider text). */
export class ActRefusal extends Error {
  constructor(public readonly words: string) { super(words); this.name = "ActRefusal"; }
}
const refuse = (words: string): never => { throw new ActRefusal(words); };

export type Resolved = {
  conn: ConnectionRef; row: ConnectionRow; adapter: ProviderAdapter; spec: ActionSpec; actor: Actor;
  item: StoredItem | null; source: StoredSource | null; input: Record<string, unknown>;
};

type ItemDbRow = {
  id: string; connection_id: string; provider: ProviderId; kind: ItemKind; external_id: string; external_key: string | null; title: string; url: string | null; state: StoredItem["state"];
  container_label: string | null; source_external_id: string | null; assignee_external_id: string | null; starts_at: string | null; ends_at: string | null; guests: number | null; response: string | null;
  visibility: "workspace" | "personal"; membership_id: string | null; organisation_id: string;
};

export const storedOf = (r: ItemDbRow): StoredItem => ({
  id: r.id, externalId: r.external_id, externalKey: r.external_key, kind: r.kind, title: r.title, url: r.url, state: r.state, containerLabel: r.container_label,
  sourceExternalId: r.source_external_id, assigneeExternalId: r.assignee_external_id, startsAt: r.starts_at, endsAt: r.ends_at, guests: r.guests, response: r.response,
});

/** The person asking, for "Jo via Max" and the readbacks. */
export async function actorOf(ctx: OrgContext, assistantName?: string): Promise<Actor> {
  const zone = await withUser(ctx.user.profileId, (db) => personZone(db, ctx)).catch(() => ctx.org.timezone);
  const display = ctx.user.displayName || "You";
  return { membershipId: ctx.membership.id, firstName: display.split(/\s+/)[0] || display, displayName: display, email: ctx.user.email ?? null, assistantName: assistantName || DEFAULT_ASSISTANT_NAME, timeZone: zone };
}

/** An item the person can see (their row security), with its connection row (read by the worker after that check). */
export async function itemForPerson(ctx: OrgContext, itemId: string): Promise<{ item: ItemDbRow; row: ConnectionRow } | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(itemId)) return null;
  const item = await withUser(ctx.user.profileId, (db) => db.maybeOne<ItemDbRow>(
    `SELECT i.id, i.connection_id, i.provider, i.kind, i.external_id, i.external_key, i.title, i.url, i.state, i.container_label, s.external_id AS source_external_id,
            i.assignee_external_id, i.starts_at, i.ends_at, i.guests, i.response, i.visibility, i.membership_id, i.organisation_id
       FROM connector_items i LEFT JOIN connector_sources s ON s.id = i.source_id
      WHERE i.id = $1 AND i.organisation_id = $2 AND i.gone_at IS NULL`, [itemId, ctx.org.id]));
  if (!item) return null;
  if (item.visibility === "personal" && (item.membership_id !== ctx.membership.id || ctx.user.impersonation)) return null;
  const row = await withWorker((db) => db.maybeOne<ConnectionRow>(`SELECT ${CONNECTION_COLUMNS} FROM connector_connections c WHERE c.id = $1`, [item.connection_id]));
  if (!row || row.status === "disconnecting") return null;
  return { item, row };
}

/** The person's own live personal connections to a provider (their row security). */
export async function ownConnections(ctx: OrgContext, providers: ProviderId[]): Promise<ConnectionRow[]> {
  if (ctx.user.impersonation) return [];
  return withUser(ctx.user.profileId, (db) => db.query<ConnectionRow>(
    `SELECT ${CONNECTION_COLUMNS} FROM connector_connections c WHERE c.organisation_id = $1 AND c.kind = 'personal' AND c.membership_id = $2
       AND c.provider = ANY($3::text[]) AND c.status <> 'disconnecting' ORDER BY c.created_at`, [ctx.org.id, ctx.membership.id, providers]));
}

/** The workspace's live connections to a provider (members see them). */
export async function workspaceConnections(ctx: OrgContext, providers: ProviderId[]): Promise<ConnectionRow[]> {
  return withUser(ctx.user.profileId, (db) => db.query<ConnectionRow>(
    `SELECT ${CONNECTION_COLUMNS} FROM connector_connections c WHERE c.organisation_id = $1 AND c.kind = 'workspace'
       AND c.provider = ANY($2::text[]) AND c.status <> 'disconnecting' ORDER BY c.created_at`, [ctx.org.id, providers]));
}

/**
 * §9.4: which connection acts on a work item. First match wins: the person's own connection to the same app and tenant
 * with acting on (as them); the item's workspace connection when the adapter acts as the app (signed); otherwise refuse.
 */
export async function actingConnectionFor(ctx: OrgContext, found: { item: ItemDbRow; row: ConnectionRow }): Promise<ConnectionRow> {
  const app = PROVIDER_LABELS[found.row.provider];
  if (found.row.kind === "personal") {
    if (!found.row.can_act) refuse(BRENDA_CONNECTOR_WORDS.canActOff(app, "Brenda"));
    return found.row;
  }
  const own = (await ownConnections(ctx, [found.row.provider])).filter((c) => c.status === "active" && c.can_act
    && (c.external_tenant_id ?? null) === (found.row.external_tenant_id ?? null));
  if (own.length) return own[0];
  const adapter = await adapterFor(found.row.provider);
  if (adapter.workspaceActs) return found.row;
  return refuse(BRENDA_CONNECTOR_WORDS.needOwnConnection(app));
}

/** The spec an adapter offers for this tool and action, or a refusal in words. */
export function specFor(adapter: ProviderAdapter, tool: ActionSpec["tool"], name: string): ActionSpec {
  const s = adapter.actions.find((a) => a.tool === tool && a.name === name);
  if (!s) {
    if (name === "set_due") refuse(BRENDA_CONNECTOR_WORDS.noSetDue(PROVIDER_LABELS[adapter.id]));
    refuse(`${PROVIDER_LABELS[adapter.id]} can't do that from Boredroom.`);
  }
  return s!;
}

/** Policy, status, the connection's own switches and the spec's kinds. Throws ActRefusal. */
export async function checkCanAct(ctx: OrgContext, row: ConnectionRow, adapter: ProviderAdapter, spec: ActionSpec): Promise<void> {
  const app = PROVIDER_LABELS[row.provider];
  if (row.status === "needs_reauth") refuse(row.kind === "personal" ? BRENDA_CONNECTOR_WORDS.reconnectPersonal(app) : BRENDA_CONNECTOR_WORDS.reconnectWorkspace(app));
  if (row.status !== "active") refuse(BRENDA_CONNECTOR_WORDS.notConnected(app));
  const policy = await withUser(ctx.user.profileId, (db) => policyFor(db, ctx.org.id, row.provider));
  if (!policy.brendaActs) refuse(BRENDA_CONNECTOR_WORDS.actsOff(app));
  if (!spec.kinds.includes(row.kind)) refuse(row.kind === "workspace" ? BRENDA_CONNECTOR_WORDS.needOwnConnection(app) : `${app} can't do that from your own account.`);
  if (row.kind === "workspace" && !adapter.workspaceActs) refuse(BRENDA_CONNECTOR_WORDS.needOwnConnection(app));
  if (row.kind === "personal" && (!row.can_act || row.membership_id !== ctx.membership.id)) refuse(BRENDA_CONNECTOR_WORDS.canActOff(app, "Brenda"));
}

/** How many shared or destructive actions the person had done in the last hour and day (connector_audit, their own rows). */
export async function sharedActsCount(ctx: OrgContext, db?: Db): Promise<{ hour: number; day: number }> {
  const q = (d: Db) => d.one<{ hour: number; day: number }>(
    `SELECT count(*) FILTER (WHERE created_at > now() - interval '1 hour')::int AS hour, count(*)::int AS day
       FROM connector_audit WHERE organisation_id = $1 AND membership_id = $2 AND action = 'act.shared' AND outcome = 'ok' AND created_at > now() - interval '1 day'`,
    [ctx.org.id, ctx.membership.id]);
  return db ? q(db) : withWorker(q);
}

export async function checkLimits(ctx: OrgContext, risk: Risk, assistantName: string): Promise<void> {
  if (risk === "private") return;
  const n = await sharedActsCount(ctx);
  if (n.hour >= SHARED_PER_HOUR || n.day >= SHARED_PER_DAY) refuse(BRENDA_CONNECTOR_WORDS.limit(assistantName));
}

/** Validates the input with the spec's schema; a failure is words, never the schema's text about provider data. */
export function validInput(spec: ActionSpec, input: Record<string, unknown>): Record<string, unknown> {
  const r = spec.input.safeParse(input);
  if (!r.success) refuse("Some of that isn't something I can send as it is. Check the details and ask again.");
  return r.data as Record<string, unknown>;
}

export async function prepareAction(r: Resolved): Promise<Prepared> {
  const input = validInput(r.spec, r.input);
  const http = httpFor(r.conn, r.adapter);
  return r.spec.prepare({ conn: r.conn, http, actor: r.actor, input, item: r.item, source: r.source, now: new Date() });
}

/** Runs the prepared action (validated again), audits it, and upserts the item it returned. */
export async function runAction(ctx: OrgContext, r: Resolved, risk: Risk): Promise<ActResult> {
  const input = validInput(r.spec, r.input);
  const http = httpFor(r.conn, r.adapter);
  let result: ActResult;
  try {
    result = await r.spec.run({ conn: r.conn, http, actor: r.actor, input, item: r.item, source: r.source, now: new Date() });
  } catch (err) {
    await auditAct(ctx, r, risk, "failed", err instanceof ConnectorError ? err.code : "BAD_RESPONSE").catch(() => undefined);
    throw err;
  }
  await auditAct(ctx, r, risk, "ok");
  if (result.item) await upsertActedItem(r.conn, r.adapter, result.item).catch((e: unknown) => console.warn(`[connectors] acted item not stored: ${(e as Error)?.message?.slice(0, 120) ?? "error"}`));
  return result;
}

export async function auditAct(ctx: OrgContext, r: Pick<Resolved, "conn">, risk: Risk, outcome: "ok" | "refused" | "failed", code?: string): Promise<void> {
  await withWorker((db) => connectorAudit(db, {
    organisationId: r.conn.organisationId, connectionId: r.conn.id, provider: r.conn.provider, kind: r.conn.kind, membershipId: ctx.membership.id,
    action: risk === "private" ? "act.private" : "act.shared", outcome, errorCode: code ?? null,
  }, { auditEvent: "connector.acted", actorUserId: ctx.user.profileId }));
}

/** Takes back a private action (the adapter's undo) within the Undo window. */
export async function undoAdapterAction(ctx: OrgContext, connectionId: string, kind: string, data: Record<string, unknown>): Promise<void> {
  const row = await withUser(ctx.user.profileId, (db) => db.maybeOne<ConnectionRow>(
    `SELECT ${CONNECTION_COLUMNS} FROM connector_connections c WHERE c.id = $1 AND c.organisation_id = $2 AND c.status = 'active'`, [connectionId, ctx.org.id]));
  if (!row || (row.kind === "personal" && row.membership_id !== ctx.membership.id)) refuse(BRENDA_CONNECTOR_WORDS.undoMovedOn);
  const conn = refOf(row!);
  const adapter = await adapterFor(conn.provider);
  const spec = adapter.actions.find((a) => a.name === kind && a.undo);
  if (!spec?.undo) refuse(BRENDA_CONNECTOR_WORDS.undoMovedOn);
  await spec!.undo!({ conn, http: httpFor(conn, adapter), data });
  await auditAct(ctx, { conn }, "private", "ok");
}

export function sourceOf(r: { id: string; kind: StoredSource["kind"]; external_id: string; label: string; members: number | null }): StoredSource {
  return { id: r.id, kind: r.kind, externalId: r.external_id, label: r.label, members: r.members };
}
