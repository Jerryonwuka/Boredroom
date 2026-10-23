/**
 * Connected apps: connections, policies, sources and channel routes for the screens (owner decisions, 22 October 2026:
 * connectors; spec §4.2, §4.3, §5.6, §10.1, §11). Reads run as the person under row security (`withUser`): a personal
 * connection is visible only to its person, so owners and HR never see one, nor a count. Writes a person makes go
 * through the same row security and the guard triggers (only can_read, can_act and settings; only selected and audience);
 * what only Boredroom may do (status, purges, audit) runs in the system context after the caller's right was read under
 * their own. Server-only.
 */
import { withSystem, withUser, withWorker, type Db } from "@/server/db";
import type { OrgContext } from "@/server/lib/api";
import { AppError, forbidden, invalid, notFound, rateLimited } from "@/server/lib/errors";
import { requireFeature as requireFeatureOf } from "@/server/lib/entitlements";
import { notify } from "@/server/services/common";
import { schema0061Missing } from "@/server/lib/schema-0061";
import { CATALOGUE, entryOf } from "@/lib/connectors/catalogue";
import { CONNECTOR_WORDS, BRENDA_CONNECTOR_WORDS, CONNECTOR_ERRORS } from "@/lib/connectors/words";
import { PROVIDER_LABELS, PROVIDER_SLUGS, type CatalogueCard, type ConnectionView, type ConnectorsView, type PolicyView, type RoutePurpose, type RouteView, type SourceView, type WorkspaceConnectionSummary } from "@/lib/connectors/types";
import { adapterFor } from "./registry";
import { connectorAudit } from "./audit";
import { notReadyError } from "./errors";
import { appOrigin, googleTesting, redirectUriFor, webhookUrl } from "./env";
import type { ConnectionKind, ConnectionRef, ProviderId } from "./types";

// ---- Rows --------------------------------------------------------------------------------------------------------------

export type ConnectionRow = {
  id: string; organisation_id: string; provider: ProviderId; kind: ConnectionKind; membership_id: string | null; connected_by: string;
  status: "active" | "needs_reauth" | "paused" | "disconnecting"; external_account_id: string; external_tenant_id: string | null; account_label: string | null;
  scopes: string[]; can_read: boolean; can_act: boolean; settings: Record<string, unknown>;
  last_sync_at: string | null; last_ok_at: string | null; last_error_code: string | null; last_error_at: string | null; error_count: number; backoff_until: string | null; created_at: string;
};

/** Every column a connection row is read with (`c` is the table's alias). */
export const CONNECTION_COLUMNS = `c.id, c.organisation_id, c.provider, c.kind, c.membership_id, c.connected_by, c.status, c.external_account_id,
  c.external_tenant_id, c.account_label, c.scopes, c.can_read, c.can_act, c.settings, c.last_sync_at, c.last_ok_at, c.last_error_code,
  c.last_error_at, c.error_count, c.backoff_until, c.created_at`;

export function refOf(r: ConnectionRow): ConnectionRef {
  return {
    id: r.id, organisationId: r.organisation_id, provider: r.provider, kind: r.kind, membershipId: r.membership_id, connectedBy: r.connected_by,
    externalAccountId: r.external_account_id, externalTenantId: r.external_tenant_id, accountLabel: r.account_label,
    scopes: r.scopes ?? [], settings: r.settings ?? {}, canRead: r.can_read, canAct: r.can_act,
  };
}

/** A connection by id, as the worker reads it (no row security). */
export async function loadConnection(db: Db, id: string): Promise<ConnectionRow | null> {
  return db.maybeOne<ConnectionRow>(`SELECT ${CONNECTION_COLUMNS} FROM connector_connections c WHERE c.id = $1`, [id]);
}

// ---- Gates -------------------------------------------------------------------------------------------------------------

/** 0061 is applied (503 CONNECTORS_NOT_READY otherwise) and the plan has CONNECTORS (402). */
export async function requireConnectors(ctx: OrgContext): Promise<void> {
  if (schema0061Missing()) throw notReadyError();
  requireFeatureOf(ctx.plan, "CONNECTORS");
}

export async function connectorsReady(): Promise<boolean> {
  return !schema0061Missing();
}

export const isManager = (ctx: Pick<OrgContext, "membership">) => ctx.membership.role === "owner" || ctx.membership.role === "hr";
export const impersonating = (ctx: Pick<OrgContext, "user">) => !!ctx.user.impersonation;

/**
 * Security fix, 22 October 2026: a Control Center operator signed in as an owner may look but never change what the
 * workspace allows (policies, sources, posting routes, workspace connections), since those are the workspace's own
 * consent and the audit would name the owner.
 */
function refuseImpersonated(ctx: Pick<OrgContext, "user">): void {
  if (impersonating(ctx)) throw forbidden(CONNECTOR_WORDS.impersonatedManage);
}

// ---- Policies ----------------------------------------------------------------------------------------------------------

const DEFAULT_POLICY = { personalAllowed: true, brendaReads: true, brendaActs: true };

export async function policiesIn(db: Db, orgId: string): Promise<Map<ProviderId, PolicyView>> {
  const rows = await db.query<{ provider: ProviderId; personal_allowed: boolean; brenda_reads: boolean; brenda_acts: boolean }>(
    `SELECT provider, personal_allowed, brenda_reads, brenda_acts FROM connector_policies WHERE organisation_id = $1`, [orgId]);
  const out = new Map<ProviderId, PolicyView>();
  for (const e of CATALOGUE) out.set(e.id, { provider: e.id, ...DEFAULT_POLICY });
  for (const r of rows) out.set(r.provider, { provider: r.provider, personalAllowed: r.personal_allowed, brendaReads: r.brenda_reads, brendaActs: r.brenda_acts });
  return out;
}

export async function policyFor(db: Db, orgId: string, provider: ProviderId): Promise<PolicyView> {
  return (await policiesIn(db, orgId)).get(provider) ?? { provider, ...DEFAULT_POLICY };
}

export async function setPolicy(ctx: OrgContext, provider: ProviderId, patch: { personalAllowed?: boolean; brendaReads?: boolean; brendaActs?: boolean }): Promise<PolicyView> {
  if (!isManager(ctx)) throw forbidden();
  refuseImpersonated(ctx);
  return withUser(ctx.user.profileId, async (db) => {
    const cur = await policyFor(db, ctx.org.id, provider);
    const next = { ...cur, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => typeof v === "boolean")) } as PolicyView;
    await db.query(
      `INSERT INTO connector_policies(organisation_id, provider, personal_allowed, brenda_reads, brenda_acts, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (organisation_id, provider) DO UPDATE SET personal_allowed = EXCLUDED.personal_allowed, brenda_reads = EXCLUDED.brenda_reads,
         brenda_acts = EXCLUDED.brenda_acts, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [ctx.org.id, provider, next.personalAllowed, next.brendaReads, next.brendaActs, ctx.membership.id]);
    return next;
  });
}

// ---- Views -------------------------------------------------------------------------------------------------------------

export async function actScopesGranted(r: Pick<ConnectionRow, "provider" | "kind" | "scopes">): Promise<boolean> {
  try {
    const a = await adapterFor(r.provider);
    const want = a.oauth.scopes({ kind: r.kind, act: true });
    const have = new Set(r.scopes ?? []);
    return want.every((s) => have.has(s));
  } catch {
    return false;
  }
}

/** Settings the screens may show: only plain flags the adapters chose to expose under `public`. */
function publicSettings(s: Record<string, unknown>): Record<string, unknown> {
  const p = s?.public;
  return p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
}

export async function viewOf(r: ConnectionRow, o: { selectedSources?: number } = {}): Promise<ConnectionView> {
  return {
    id: r.id, provider: r.provider, kind: r.kind, status: r.status, accountLabel: r.account_label, canRead: r.can_read, canAct: r.can_act,
    lastSyncAt: r.last_sync_at, lastOkAt: r.last_ok_at, errorCode: r.last_error_code, errorAt: r.last_error_at, backoffUntil: r.backoff_until,
    createdAt: r.created_at, ...(o.selectedSources !== undefined ? { selectedSources: o.selectedSources } : {}),
    settings: publicSettings(r.settings), actScopesGranted: await actScopesGranted(r),
  };
}

async function configuredMap(): Promise<Map<ProviderId, boolean>> {
  const m = new Map<ProviderId, boolean>();
  await Promise.all(CATALOGUE.map(async (e) => {
    try { m.set(e.id, (await adapterFor(e.id)).configured(process.env)); } catch { m.set(e.id, false); }
  }));
  return m;
}

/** GET /connectors: what the viewer may see (§4.3). */
export async function connectorsView(ctx: OrgContext): Promise<ConnectorsView> {
  const manage = isManager(ctx);
  const imp = impersonating(ctx);
  const enabled = !!ctx.plan.features.CONNECTORS;
  const base = { ready: true, enabled, canManage: manage, impersonating: imp, assistantName: "Brenda" };
  const configured = await configuredMap();
  const catalogue: CatalogueCard[] = [];
  for (const e of CATALOGUE) {
    const ok = configured.get(e.id) ?? false;
    // A provider without its variables: "Not set up yet" for owners only; hidden from everyone else.
    if (!ok && ctx.membership.role !== "owner") continue;
    if (e.id === "fake" && !ok) continue;
    catalogue.push({
      entry: e, configured: ok,
      ...(manage ? {
        redirectUrl: redirectUriFor(e.id), ...(e.setup.webhookPath ? { webhookUrl: webhookUrl(PROVIDER_SLUGS[e.id]) } : {}),
        ...(e.setup.extraUrls?.length ? { extraUrls: e.setup.extraUrls.map((x) => ({ label: x.label, url: `${appOrigin()}${x.path}` })) } : {}),
      } : {}),
      ...(e.id === "google_calendar" && googleTesting() ? { googleTesting: true } : {}),
    });
  }
  const profiles = await import("@/server/services/assistant-profile").then((m) => m.assistantProfiles(ctx)).catch(() => null);
  const assistantName = profiles?.personal.name ?? "Brenda";
  const workspaceAssistantName = profiles?.workspace.name ?? "Brenda";
  return withUser(ctx.user.profileId, async (db) => {
    const [policies, rows, sourceCounts, routes, teams] = await Promise.all([
      policiesIn(db, ctx.org.id),
      db.query<ConnectionRow>(`SELECT ${CONNECTION_COLUMNS} FROM connector_connections c WHERE c.organisation_id = $1 AND c.status <> 'disconnecting' ORDER BY c.created_at`, [ctx.org.id]),
      db.query<{ connection_id: string; n: number }>(
        `SELECT s.connection_id, count(*)::int AS n FROM connector_sources s WHERE s.organisation_id = $1 AND s.visibility = 'workspace' AND s.selected GROUP BY s.connection_id`, [ctx.org.id]),
      routesIn(db, ctx.org.id),
      db.query<{ id: string; name: string }>(`SELECT id, name FROM teams WHERE organisation_id = $1 AND archived_at IS NULL ORDER BY name`, [ctx.org.id]),
    ]);
    const counts = new Map(sourceCounts.map((r) => [r.connection_id, r.n]));
    const workspaceRows = rows.filter((r) => r.kind === "workspace");
    // Row security already hides everyone else's personal connections; impersonation hides the person's own too.
    const personalRows = imp ? [] : rows.filter((r) => r.kind === "personal" && r.membership_id === ctx.membership.id);
    const workspace = manage ? await Promise.all(workspaceRows.map((r) => viewOf(r, { selectedSources: counts.get(r.id) ?? 0 }))) : [];
    const workspaceSummary: WorkspaceConnectionSummary[] = workspaceRows.map((r) => ({ id: r.id, provider: r.provider, status: r.status, accountLabel: r.account_label, sources: counts.get(r.id) ?? 0 }));
    const personal = await Promise.all(personalRows.map((r) => viewOf(r)));
    return {
      ...base, assistantName, workspaceAssistantName,
      catalogue, policies: [...policies.values()], workspace, workspaceSummary, personal, routes, teams,
    };
  });
}

/** The view for a database before 0061: everything off, words say why. */
export function notReadyView(ctx: OrgContext): ConnectorsView {
  return { ready: false, enabled: !!ctx.plan.features.CONNECTORS, canManage: isManager(ctx), impersonating: impersonating(ctx), catalogue: [], policies: [], workspace: [], workspaceSummary: [], personal: [], routes: [], teams: [], assistantName: "Brenda" };
}

// ---- One connection the caller may manage -----------------------------------------------------------------------------

/**
 * The connection `id` when the caller may manage it, read under their own row security: their own personal connection
 * (never while impersonated), or a workspace connection for owners and HR. Anything else is 404 (a personal connection
 * of someone else is invisible, so it is "not found", never "forbidden").
 */
export async function manageableConnection(ctx: OrgContext, id: string): Promise<ConnectionRow> {
  const row = await withUser(ctx.user.profileId, (db) => db.maybeOne<ConnectionRow>(
    `SELECT ${CONNECTION_COLUMNS} FROM connector_connections c WHERE c.id = $1 AND c.organisation_id = $2 AND c.status <> 'disconnecting'`, [id, ctx.org.id]));
  if (!row) throw notFound();
  if (row.kind === "personal") {
    if (row.membership_id !== ctx.membership.id) throw notFound();
    if (impersonating(ctx)) throw forbidden(CONNECTOR_WORDS.personal.impersonated);
  } else if (!isManager(ctx)) throw forbidden(CONNECTOR_WORDS.workspaceOnly);
  return row;
}

/** PATCH: can_read, can_act, settings (under the guard trigger). Turning on acting without its scopes asks for consent. */
export async function updateConnection(ctx: OrgContext, id: string, patch: { canRead?: boolean; canAct?: boolean; settings?: Record<string, unknown> }): Promise<ConnectionView | { needsConsent: true }> {
  const row = await manageableConnection(ctx, id);
  if (row.kind === "workspace") refuseImpersonated(ctx);
  if (patch.canAct === true && !row.can_act && !(await actScopesGranted(row))) return { needsConsent: true };
  const settings = patch.settings ? { ...row.settings, public: { ...publicSettings(row.settings), ...patch.settings } } : null;
  const updated = await withUser(ctx.user.profileId, (db) => db.one<ConnectionRow>(
    `UPDATE connector_connections c SET can_read = COALESCE($3, c.can_read), can_act = COALESCE($4, c.can_act), settings = COALESCE($5::jsonb, c.settings)
     WHERE c.id = $1 AND c.organisation_id = $2 RETURNING ${CONNECTION_COLUMNS}`,
    [id, ctx.org.id, patch.canRead ?? null, patch.canAct ?? null, settings ? JSON.stringify(settings) : null]));
  return viewOf(updated);
}

// ---- Disconnecting ----------------------------------------------------------------------------------------------------

/**
 * Marks the connection `disconnecting`, deletes what Boredroom copied (items, sources and their routes, identities, sync
 * state; hides and links go with the items), audits, and queues `connector.revoke` (the worker revokes at the app,
 * deletes webhooks, tokens and the row). System context; the caller's right was read under their own row security.
 */
export async function disconnectIn(db: Db, row: ConnectionRow, actorMembershipId: string, o: { actorUserId?: string | null; reason?: string } = {}): Promise<void> {
  await db.query(`UPDATE connector_connections SET status = 'disconnecting' WHERE id = $1`, [row.id]);
  await db.query(`DELETE FROM connector_items WHERE connection_id = $1`, [row.id]);
  await db.query(`DELETE FROM connector_sources WHERE connection_id = $1`, [row.id]);
  await db.query(`DELETE FROM connector_identities WHERE connection_id = $1`, [row.id]);
  await db.query(`DELETE FROM connector_sync_state WHERE connection_id = $1`, [row.id]);
  await connectorAudit(db, { organisationId: row.organisation_id, connectionId: row.id, provider: row.provider, kind: row.kind, membershipId: row.kind === "personal" ? row.membership_id! : actorMembershipId, action: o.reason ? `disconnect.${o.reason}` : "disconnect.ok", outcome: "ok" },
    { auditEvent: "connector.disconnected", actorUserId: o.actorUserId ?? null });
  await db.query(`INSERT INTO jobs(type, payload, dedup_key) VALUES ('connector.revoke', $1, $2) ON CONFLICT (dedup_key) DO NOTHING`,
    [JSON.stringify({ connectionId: row.id }), `connector.revoke:${row.id}`]);
}

export async function disconnect(ctx: OrgContext, id: string): Promise<{ ok: true }> {
  const row = await manageableConnection(ctx, id);
  if (row.kind === "workspace") refuseImpersonated(ctx);
  await withSystem((db) => disconnectIn(db, row, ctx.membership.id, { actorUserId: ctx.user.profileId }));
  return { ok: true };
}

// ---- Trouble: reconnecting, notifications ----------------------------------------------------------------------------

const settingsHref = (slug: string, kind: ConnectionKind) => (kind === "personal" ? `/app/${slug}/settings?section=assistant#connections` : `/app/${slug}/settings?section=connectors`);

/** Owners and HR (active) of an organisation. */
export async function managersOf(db: Db, orgId: string): Promise<string[]> {
  return (await db.query<{ id: string }>(`SELECT id FROM memberships WHERE organisation_id = $1 AND status = 'active' AND role IN ('owner', 'hr')`, [orgId])).map((r) => r.id);
}

/**
 * Tells whoever looks after a connection: its person (personal) or owners and HR (workspace), at most once a day per
 * connection per kind of trouble (`dedupKey`). Worker context.
 */
export async function notifyTrouble(db: Db, conn: Pick<ConnectionRef, "id" | "organisationId" | "provider" | "kind" | "membershipId">, kind: string, title: string): Promise<void> {
  const org = await db.maybeOne<{ slug: string }>(`SELECT slug FROM organisations WHERE id = $1`, [conn.organisationId]);
  if (!org) return;
  const day = new Date().toISOString().slice(0, 10);
  const recipients = conn.kind === "personal" ? (conn.membershipId ? [conn.membershipId] : []) : await managersOf(db, conn.organisationId);
  for (const r of recipients) {
    await notify(db, {
      organisationId: conn.organisationId, recipientMembershipId: r, type: "connector.trouble", title,
      href: settingsHref(org.slug, conn.kind), dedupKey: `connector:${conn.id}:${kind}:${day}`,
    });
  }
}

/** Status `needs_reauth` with the code, and the right people told. Worker context. */
export async function markNeedsReauth(conn: ConnectionRef, code: "REAUTH_REQUIRED" | "REVOKED" | "OWNER_LEFT", o: { name?: string } = {}): Promise<void> {
  await withWorker(async (db) => {
    const r = await db.maybeOne<{ id: string }>(
      `UPDATE connector_connections SET status = 'needs_reauth', last_error_code = $2, last_error_at = now(), error_count = error_count + 1
       WHERE id = $1 AND status IN ('active', 'needs_reauth') RETURNING id`, [conn.id, code]);
    if (!r) return;
    const app = PROVIDER_LABELS[conn.provider];
    const title = code === "OWNER_LEFT" ? CONNECTOR_ERRORS.OWNER_LEFT(app, { name: o.name })
      : conn.kind === "personal" ? `Your ${app} needs reconnecting` : `${app} needs reconnecting`;
    await notifyTrouble(db, conn, "reauth", title);
  });
}

// ---- Sync now ------------------------------------------------------------------------------------------------------------

/** "Check now": every stream of the connection at once, at most once per 2 minutes per connection (429 otherwise). */
export async function syncNow(ctx: OrgContext, id: string, now: Date = new Date()): Promise<{ queued: true }> {
  const row = await manageableConnection(ctx, id);
  if (row.status === "paused") throw new AppError(409, "CONNECTORS_PAUSED", CONNECTOR_ERRORS.PAUSED(PROVIDER_LABELS[row.provider]));
  const bucket = Math.floor(now.getTime() / 120_000);
  const queued = await withSystem(async (db) => {
    const streams = await db.query<{ stream: string }>(`SELECT stream FROM connector_sync_state WHERE connection_id = $1`, [row.id]);
    let n = 0;
    for (const s of streams) {
      const r = await db.maybeOne(
        `INSERT INTO jobs(type, payload, dedup_key) VALUES ('connector.sync', $1, $2) ON CONFLICT (dedup_key) DO NOTHING RETURNING id`,
        [JSON.stringify({ connectionId: row.id, stream: s.stream, reason: "now" }), `connector.sync:${row.id}:${s.stream}:now:${bucket}`]);
      if (r) n++;
    }
    // An app with nothing to sync (Slack, Teams: channels only; integration fix, 22 October 2026): "Check now" re-reads
    // its channels instead, so the button never answers "checked recently" when nothing was queued at all.
    if (!streams.length) {
      const r = await db.maybeOne(
        `INSERT INTO jobs(type, payload, dedup_key) VALUES ('connector.sources', $1, $2) ON CONFLICT (dedup_key) DO NOTHING RETURNING id`,
        [JSON.stringify({ connectionId: row.id }), `connector.sources:${row.id}:now:${bucket}`]);
      if (r) n++;
    }
    return n;
  });
  if (!queued && row.status === "active") throw rateLimited(CONNECTOR_WORDS.limits.syncSoon);
  return { queued: true };
}

// ---- Sources ---------------------------------------------------------------------------------------------------------------

type SourceRow = { id: string; kind: SourceView["kind"]; label: string; selected: boolean; audience_team_id: string | null; members: number | null; is_private: boolean | null; archived: boolean };
const sourceView = (r: SourceRow): SourceView => ({ id: r.id, kind: r.kind, label: r.label, selected: r.selected, audienceTeamId: r.audience_team_id, members: r.members, isPrivate: r.is_private, archived: r.archived });

const sourcesRefreshedAt = new Map<string, number>();

/** The connection's sources; `refresh` re-reads them from the app (at most once a minute per connection). */
export async function listSources(ctx: OrgContext, id: string, o: { refresh?: boolean } = {}): Promise<{ sources: SourceView[] }> {
  const row = await manageableConnection(ctx, id);
  if (o.refresh) {
    const last = sourcesRefreshedAt.get(row.id) ?? 0;
    if (Date.now() - last < 60_000) throw rateLimited(CONNECTOR_WORDS.limits.sourcesSoon);
    sourcesRefreshedAt.set(row.id, Date.now());
    const { refreshSources } = await import("./sync");
    await refreshSources(row.id);
  }
  const rows = await withUser(ctx.user.profileId, (db) => db.query<SourceRow>(
    `SELECT id, kind, label, selected, audience_team_id, members, is_private, archived FROM connector_sources WHERE connection_id = $1 ORDER BY archived, label`, [row.id]));
  return { sources: rows.map(sourceView) };
}

/**
 * PUT sources: the selected ones (each with an audience team for workspace sources, or everyone), under the caller's row
 * security and the guard; then, in the system context, items take their source's new audience, an unselected source's
 * items are deleted, and a sync is queued.
 */
export async function setSources(ctx: OrgContext, id: string, selected: { id: string; audienceTeamId?: string | null }[]): Promise<{ sources: SourceView[] }> {
  const row = await manageableConnection(ctx, id);
  if (row.kind === "workspace") refuseImpersonated(ctx);
  if (selected.length > 200) throw invalid("Choose at most 200.");
  const wanted = new Map(selected.map((s) => [s.id, s.audienceTeamId ?? null]));
  await withUser(ctx.user.profileId, async (db) => {
    const all = await db.query<{ id: string; selected: boolean; audience_team_id: string | null; visibility: string }>(
      `SELECT id, selected, audience_team_id, visibility FROM connector_sources WHERE connection_id = $1`, [row.id]);
    for (const s of all) {
      const on = wanted.has(s.id);
      const audience = on && s.visibility === "workspace" ? wanted.get(s.id) ?? null : null;
      if (s.selected === on && s.audience_team_id === audience) continue;
      await db.query(`UPDATE connector_sources SET selected = $2, audience_team_id = $3 WHERE id = $1`, [s.id, on, audience]);
    }
    for (const sid of wanted.keys()) if (!all.some((s) => s.id === sid)) throw notFound("That isn't one of this connection's sources.");
  });
  await withSystem(async (db) => {
    await db.query(
      `UPDATE connector_items i SET audience_team_id = s.audience_team_id FROM connector_sources s
        WHERE s.id = i.source_id AND s.connection_id = $1 AND i.visibility = 'workspace' AND i.audience_team_id IS DISTINCT FROM s.audience_team_id`, [row.id]);
    await db.query(`DELETE FROM connector_items i USING connector_sources s WHERE s.id = i.source_id AND s.connection_id = $1 AND NOT s.selected`, [row.id]);
    await db.query(`UPDATE connector_sync_state SET next_run_at = now(), full_resync = true WHERE connection_id = $1`, [row.id]);
    // Asana's hooks follow the selection (security fix, 22 October 2026): registered on what is chosen now, removed from
    // what no longer is. (Jira's one hook per connection already filters by project in the sink.)
    if (row.provider === "asana" && row.kind === "workspace") {
      await db.query(`INSERT INTO jobs(type, payload, dedup_key) VALUES ('connector.webhooks', $1, $2) ON CONFLICT (dedup_key) DO NOTHING`,
        [JSON.stringify({ connectionId: row.id }), `connector.webhooks:${row.id}:sources:${Date.now()}`]);
    }
    await connectorAudit(db, { organisationId: row.organisation_id, connectionId: row.id, provider: row.provider, kind: row.kind, membershipId: ctx.membership.id, action: "sources.set", outcome: "ok" });
  });
  return listSources(ctx, id);
}

// ---- Channel routes ----------------------------------------------------------------------------------------------------

export async function routesIn(db: Db, orgId: string): Promise<RouteView[]> {
  const rows = await db.query<{ id: string; purpose: RoutePurpose; team_id: string | null; source_id: string; label: string; provider: ProviderId; enabled: boolean; enabled_at: string | null }>(
    `SELECT r.id, r.purpose, r.team_id, r.source_id, s.label, c.provider, r.enabled, r.enabled_at
       FROM connector_channel_routes r JOIN connector_sources s ON s.id = r.source_id JOIN connector_connections c ON c.id = s.connection_id
      WHERE r.organisation_id = $1 AND c.status <> 'disconnecting' ORDER BY r.purpose, r.created_at`, [orgId]);
  return rows.map((r) => ({ id: r.id, purpose: r.purpose, teamId: r.team_id, sourceId: r.source_id, sourceLabel: r.label, provider: r.provider, enabled: r.enabled, enabledAt: r.enabled_at }));
}

/** PUT routes: choose (or remove, with a null source) the channel for a purpose; a change saves the route off. */
export async function setRoute(ctx: OrgContext, input: { purpose: RoutePurpose; teamId: string | null; sourceId: string | null }): Promise<{ routes: RouteView[] }> {
  if (!isManager(ctx)) throw forbidden();
  refuseImpersonated(ctx);
  if (input.purpose !== "daily_digest" && !input.teamId) throw invalid("Choose a team for standups and reminders.");
  await withUser(ctx.user.profileId, async (db) => {
    const zero = "00000000-0000-0000-0000-000000000000";
    if (!input.sourceId) {
      await db.query(`DELETE FROM connector_channel_routes WHERE organisation_id = $1 AND purpose = $2 AND COALESCE(team_id, $3::uuid) = COALESCE($4::uuid, $3::uuid)`,
        [ctx.org.id, input.purpose, zero, input.teamId]);
      return;
    }
    try {
      await db.query(
        `INSERT INTO connector_channel_routes(organisation_id, source_id, purpose, team_id, enabled, created_by)
         VALUES ($1, $2, $3, $4, false, $5)
         ON CONFLICT (organisation_id, purpose, COALESCE(team_id, '00000000-0000-0000-0000-000000000000'::uuid))
         DO UPDATE SET source_id = EXCLUDED.source_id, enabled = CASE WHEN connector_channel_routes.source_id = EXCLUDED.source_id THEN connector_channel_routes.enabled ELSE false END,
           enabled_by = CASE WHEN connector_channel_routes.source_id = EXCLUDED.source_id THEN connector_channel_routes.enabled_by END,
           enabled_at = CASE WHEN connector_channel_routes.source_id = EXCLUDED.source_id THEN connector_channel_routes.enabled_at END`,
        [ctx.org.id, input.sourceId, input.purpose, input.teamId, ctx.membership.id]);
    } catch (err) {
      if ((err as { code?: string })?.code === "23514" || /ROUTE_CHANNEL/.test((err as Error)?.message ?? "")) throw invalid("Choose one of the workspace's selected channels.");
      if ((err as { code?: string })?.code === "23503") throw invalid("That team isn't in this workspace.");
      throw err;
    }
  });
  return { routes: await withUser(ctx.user.profileId, (db) => routesIn(db, ctx.org.id)) };
}

/** Turn a route on (the workspace's standing consent for exactly what its preview showed) or off. Audited, ids only. */
export async function setRouteEnabled(ctx: OrgContext, id: string, enabled: boolean): Promise<RouteView> {
  if (!isManager(ctx)) throw forbidden();
  // Turning a route off stays possible (it only stops posting); turning one on is the workspace's consent.
  if (enabled) refuseImpersonated(ctx);
  const r = await withUser(ctx.user.profileId, (db) => db.maybeOne<{ id: string; provider: ProviderId; connection_id: string }>(
    `UPDATE connector_channel_routes r SET enabled = $3, enabled_by = CASE WHEN $3 THEN $4::uuid END, enabled_at = CASE WHEN $3 THEN now() END
       FROM connector_sources s JOIN connector_connections c ON c.id = s.connection_id
      WHERE r.id = $1 AND r.organisation_id = $2 AND s.id = r.source_id RETURNING r.id, c.provider, c.id AS connection_id`,
    [id, ctx.org.id, enabled, ctx.membership.id]));
  if (!r) throw notFound();
  await withSystem((db) => connectorAudit(db, { organisationId: ctx.org.id, connectionId: r.connection_id, provider: r.provider, kind: "workspace", membershipId: ctx.membership.id, action: enabled ? "route.enabled" : "route.disabled", outcome: "ok" },
    { auditEvent: enabled ? "connector.route_enabled" : "connector.route_disabled", actorUserId: ctx.user.profileId }));
  const all = await withUser(ctx.user.profileId, (db) => routesIn(db, ctx.org.id));
  return all.find((x) => x.id === id)!;
}

// ---- Plan lapse, people leaving ---------------------------------------------------------------------------------------------

/** Worker: pauses connections of workspaces whose plan lost CONNECTORS, and resumes them when it returns. */
export async function pauseForPlan(db: Db, orgId: string, hasFeature: boolean): Promise<number> {
  const rows = hasFeature
    ? await db.query(`UPDATE connector_connections SET status = 'active', last_error_code = NULL WHERE organisation_id = $1 AND status = 'paused' RETURNING id`, [orgId])
    : await db.query(`UPDATE connector_connections SET status = 'paused' WHERE organisation_id = $1 AND status IN ('active', 'needs_reauth') RETURNING id`, [orgId]);
  return rows.length;
}

/** Words for a provider's entry and kind (the screens and Brenda). */
export function labelOf(id: ProviderId): string {
  return PROVIDER_LABELS[id];
}

export const removeAtOf = (id: ProviderId) => entryOf(id).removeAt;
export { BRENDA_CONNECTOR_WORDS };
