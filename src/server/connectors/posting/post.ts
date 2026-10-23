/**
 * Connected apps: posting digests, standups and reminders in a channel the workspace chose (owner decisions, 22 October
 * 2026: connectors; spec §10). A route posts only once its owner or HR turned it on (their standing consent for exactly
 * what its preview showed), in a selected channel of the workspace's own Slack or Teams connection. Each post happens at
 * most once (a claim in connector_rate_budget, released when nothing was posted); an app that refuses (Boredroom removed
 * from the channel, the channel gone) turns the route off and tells owners and HR once. Worker context. Server-only.
 *
 * Rendering (§10.3): builders make a neutral { heading, lines, link }. The chat adapter's "post" ActionSpec receives
 * `{ text, post }`: `text` is the plain rendering, `post` the neutral one, which Slack renders with `renderSlack` and
 * Teams with `renderTeams` (both escape every text, so nothing can become a mention or markup).
 */
import { withWorker, type Db } from "@/server/db";
import { resolveEntitlements } from "@/server/lib/entitlements";
import { noteMissing0061, schema0061Missing } from "@/server/lib/schema-0061";
import { localDate, localTimeOn, weekdayOf } from "@/server/lib/time";
import { CONNECTOR_WORDS } from "@/lib/connectors/words";
import { members as membersWords } from "@/lib/confirm-readback";
import { adapterFor } from "../registry";
import { httpFor } from "../http";
import { appOrigin } from "../env";
import { connectorAudit } from "../audit";
import { CONNECTION_COLUMNS, managersOf, notifyTrouble, refOf, type ConnectionRow } from "../connections";
import { ConnectorError, type Actor, type StoredSource } from "../types";
import { digestPost, personStandupPost, standupReminderPost, standupRollupPost, teamDays, type NeutralPost } from "./digest";

export const POST_MAX_CHARS = 3000;
export type PostKind = "daily_digest" | "standup" | "standup_entry" | "reminders";

// ---- Rendering ----------------------------------------------------------------------------------------------------------

/** Slack mrkdwn: `&`, `<`, `>` escaped in every text (so nothing becomes <!channel> or a mention). */
export const slackEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const clampPost = (s: string) => (s.length <= POST_MAX_CHARS ? s : `${s.slice(0, POST_MAX_CHARS - 1)}…`);
const safeHref = (h: string) => (/^https?:\/\/[^\s<>|"]+$/.test(h) ? h : null);

export function renderSlack(p: NeutralPost): string {
  const link = p.link && safeHref(p.link.href) ? `\n<${p.link.href}|${slackEscape(p.link.label).replace(/\|/g, "/")}>` : "";
  return clampPost(`*${slackEscape(p.heading)}*${p.lines.length ? `\n${p.lines.map(slackEscape).join("\n")}` : ""}${link}`);
}

export const htmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export function renderTeams(p: NeutralPost): string {
  const href = p.link ? safeHref(p.link.href) : null;
  return clampPost(`<p><strong>${htmlEscape(p.heading)}</strong></p>${p.lines.map((l) => `<p>${htmlEscape(l)}</p>`).join("")}${p.link && href ? `<p><a href="${htmlEscape(href)}">${htmlEscape(p.link.label)}</a></p>` : ""}`);
}

export function renderPlain(p: NeutralPost): string {
  return clampPost([p.heading, ...p.lines, ...(p.link ? [`${p.link.label}: ${p.link.href}`] : [])].join("\n"));
}

// ---- Building what a route posts --------------------------------------------------------------------------------------------

type RouteRow = { id: string; organisation_id: string; purpose: "daily_digest" | "standup" | "reminders"; team_id: string | null; enabled: boolean; enabled_by: string | null;
  source_id: string; source_label: string; source_external_id: string; source_kind: StoredSource["kind"]; members: number | null; selected: boolean; connection_id: string };

async function routeRow(db: Db, routeId: string): Promise<RouteRow | null> {
  return db.maybeOne<RouteRow>(
    `SELECT r.id, r.organisation_id, r.purpose, r.team_id, r.enabled, r.enabled_by, s.id AS source_id, s.label AS source_label, s.external_id AS source_external_id,
            s.kind AS source_kind, s.members, s.selected, s.connection_id
       FROM connector_channel_routes r JOIN connector_sources s ON s.id = r.source_id WHERE r.id = $1`, [routeId]);
}

/** What the route would post now: the preview the owner sees before turning it on, and what the job posts. */
export async function buildPost(db: Db, route: Pick<RouteRow, "organisation_id" | "purpose" | "team_id">, kind: PostKind, o: { date?: string; entryId?: string; rollupId?: string; now?: Date } = {}): Promise<NeutralPost | null> {
  const org = await db.maybeOne<{ name: string; slug: string; timezone: string }>(`SELECT name, slug, timezone FROM organisations WHERE id = $1`, [route.organisation_id]);
  if (!org) return null;
  const now = o.now ?? new Date();
  const date = o.date ?? localDate(now, org.timezone);
  const base = `${appOrigin()}/app/${org.slug}`;
  if (kind === "daily_digest") {
    const team = route.team_id ? await db.maybeOne<{ name: string }>(`SELECT name FROM teams WHERE id = $1`, [route.team_id]) : null;
    return digestPost(await teamDays(db, route.organisation_id, route.team_id, date, org.timezone), { date, workspace: org.name, href: `${base}/tasks`, teamName: team?.name ?? null });
  }
  if (kind === "reminders") {
    const team = route.team_id ? await db.maybeOne<{ name: string }>(`SELECT name FROM teams WHERE id = $1`, [route.team_id]) : null;
    return team ? standupReminderPost(team.name, `${base}/my-day`) : null;
  }
  if (kind === "standup") {
    const r = o.rollupId
      ? await db.maybeOne<{ content: Record<string, unknown> | null }>(`SELECT content FROM standup_rollups WHERE id = $1 AND status = 'sent'`, [o.rollupId])
      : await db.maybeOne<{ content: Record<string, unknown> | null }>(`SELECT content FROM standup_rollups WHERE team_id = $1 AND local_date = $2 AND status = 'sent'`, [route.team_id, date]);
    const c = r?.content as { team?: { name: string }; dateLabel?: string; counts?: { members: number; posted: number }; blockers?: { name: string; text: string }[] } | null;
    if (!c?.team || !c.counts) {
      if (o.rollupId || o.entryId) return null;
      // A preview before today's rollup exists: what the post looks like, from the team's name alone.
      const team = route.team_id ? await db.maybeOne<{ name: string }>(`SELECT name FROM teams WHERE id = $1`, [route.team_id]) : null;
      return team ? standupRollupPost({ team: team.name, dateLabel: date, members: 0, posted: 0, blockers: [] }, `${base}/my-day`) : null;
    }
    return standupRollupPost({ team: c.team.name, dateLabel: c.dateLabel ?? date, members: c.counts.members, posted: c.counts.posted, blockers: (c.blockers ?? []).map((b) => ({ name: b.name, text: b.text })) }, `${base}/my-day`);
  }
  if (kind === "standup_entry" && o.entryId) {
    const e = await db.maybeOne<{ name: string; yesterday_text: string | null; today_text: string | null; blocked_text: string | null; status: string }>(
      `SELECT p.display_name AS name, e.yesterday_text, e.today_text, e.blocked_text, e.status FROM standup_entries e
         JOIN memberships m ON m.id = e.membership_id JOIN profiles p ON p.id = m.user_id WHERE e.id = $1`, [o.entryId]);
    if (!e || e.status !== "posted") return null;
    return personStandupPost({ name: e.name, sections: [{ label: "Yesterday", text: e.yesterday_text }, { label: "Today", text: e.today_text }, { label: "Blocked", text: e.blocked_text }] }, `${base}/my-day`);
  }
  return null;
}

/** The route's readback ("Goes to: #design in Slack, 14 people. What they get: …"). */
export async function routeReadback(db: Db, route: RouteRow): Promise<{ to: string[]; what: string }> {
  const conn = await db.maybeOne<{ provider: string }>(`SELECT provider FROM connector_connections WHERE id = $1`, [route.connection_id]);
  const app = conn?.provider === "teams" ? "Microsoft Teams" : conn?.provider === "slack" ? "Slack" : "Test app";
  const team = route.team_id ? (await db.maybeOne<{ name: string }>(`SELECT name FROM teams WHERE id = $1`, [route.team_id]))?.name ?? null : null;
  const time = (await db.maybeOne<{ t: string }>(`SELECT to_char(COALESCE(daily_report_time, '18:00'::time), 'HH24:MI') AS t FROM brenda_settings WHERE organisation_id = $1`, [route.organisation_id]))?.t ?? "18:00";
  const what = route.purpose === "daily_digest" ? CONNECTOR_WORDS.routes.digestWhat(team, time) : route.purpose === "standup" ? CONNECTOR_WORDS.routes.standupWhat(team ?? "The team") : CONNECTOR_WORDS.routes.remindersWhat(team ?? "the team");
  return { to: [`${route.source_label} in ${app}, ${membersWords(route.members)}`], what };
}

export async function previewRoute(routeId: string, orgId: string): Promise<{ preview: NeutralPost | null; readback: { to: string[]; what: string } } | null> {
  return withWorker(async (db) => {
    const r = await routeRow(db, routeId);
    if (!r || r.organisation_id !== orgId) return null;
    const kind: PostKind = r.purpose === "standup" ? "standup" : r.purpose;
    return { preview: await buildPost(db, r, kind), readback: await routeReadback(db, r) };
  });
}

// ---- The post job -------------------------------------------------------------------------------------------------------------

const claimBucket = (routeId: string, kind: PostKind, date: string, entryId?: string) => `post:${routeId}:${kind}:${date}${entryId ? `:${entryId}` : ""}`.toLowerCase().slice(0, 120);

async function claim(db: Db, bucket: string, date: string): Promise<boolean> {
  const r = await db.maybeOne(
    `INSERT INTO connector_rate_budget(bucket, window_start, used, cap) VALUES ($1, $2::date, 1, 1)
     ON CONFLICT (bucket, window_start) DO UPDATE SET used = connector_rate_budget.used + 1 WHERE connector_rate_budget.used + 1 <= connector_rate_budget.cap
     RETURNING used`, [bucket, date]);
  return !!r;
}

export type PostOutcome = "posted" | "skipped" | "already" | "disabled";

/**
 * `connector.post`: posts one route's kind for one local date (and, for a person's standup, one entry). A re-run is a
 * no-op; a route turned off, a channel unselected, a connection not active or a plan without CONNECTORS posts nothing.
 */
export async function runPostJob(p: { routeId: string; kind: PostKind; localDate: string; entryId?: string; rollupId?: string }): Promise<PostOutcome> {
  const pre = await withWorker(async (db) => {
    if (schema0061Missing()) return null;
    const route = await routeRow(db, p.routeId);
    if (!route || !route.enabled || !route.selected) return null;
    const row = await db.maybeOne<ConnectionRow>(`SELECT ${CONNECTION_COLUMNS} FROM connector_connections c WHERE c.id = $1`, [route.connection_id]);
    if (!row || row.status !== "active" || row.kind !== "workspace") return null;
    const plan = await resolveEntitlements(db, route.organisation_id);
    if (!plan.features.CONNECTORS) return null;
    const post = await buildPost(db, route, p.kind, { date: p.localDate, entryId: p.entryId, rollupId: p.rollupId });
    if (!post) return null;
    const bucket = claimBucket(route.id, p.kind, p.localDate, p.entryId);
    if (!(await claim(db, bucket, p.localDate))) return { already: true as const };
    const actorRow = p.kind === "standup_entry" && p.entryId
      ? await db.maybeOne<{ id: string; name: string; email: string | null }>(`SELECT m.id, pr.display_name AS name, pr.email FROM standup_entries e JOIN memberships m ON m.id = e.membership_id JOIN profiles pr ON pr.id = m.user_id WHERE e.id = $1`, [p.entryId])
      : null;
    const assistant = (await db.maybeOne<{ name: string }>(`SELECT name FROM assistant_profiles WHERE membership_id = $1`, [actorRow?.id ?? route.enabled_by]).catch(() => null))?.name ?? "Brenda";
    return { route, row, post, bucket, actorRow, assistant };
  });
  if (!pre) return "skipped";
  if ("already" in pre) return "already";
  const { route, row, post, bucket, actorRow } = pre;
  const conn = refOf(row);
  const adapter = await adapterFor(conn.provider);
  const spec = adapter.actions.find((a) => a.tool === "post_to_channel" && a.name === "post");
  const release = () => withWorker((db) => db.query(`DELETE FROM connector_rate_budget WHERE bucket = $1`, [bucket])).catch(() => undefined);
  if (!spec) { await release(); return "skipped"; }
  const actor: Actor = actorRow
    ? { membershipId: actorRow.id, firstName: actorRow.name.split(/\s+/)[0] || actorRow.name, displayName: actorRow.name, email: actorRow.email, assistantName: pre.assistant, timeZone: "UTC" }
    : { membershipId: route.enabled_by ?? conn.connectedBy, firstName: "Boredroom", displayName: "Boredroom", email: null, assistantName: pre.assistant, timeZone: "UTC" };
  const source: StoredSource = { id: route.source_id, kind: route.source_kind, externalId: route.source_external_id, label: route.source_label, members: route.members };
  const input = spec.input.safeParse({ text: renderPlain(post), post });
  if (!input.success) { await release(); return "skipped"; }
  try {
    await spec.run({ conn, http: httpFor(conn, adapter), actor, input: input.data as Record<string, unknown>, item: null, source, now: new Date() });
  } catch (err) {
    const code = err instanceof ConnectorError ? err.code : "BAD_RESPONSE";
    await withWorker(async (db) => {
      await connectorAudit(db, { organisationId: conn.organisationId, connectionId: conn.id, provider: conn.provider, kind: "workspace", membershipId: actor.membershipId, action: "post.failed", outcome: "failed", errorCode: code });
      if (code === "NOT_ALLOWED" || code === "NOT_FOUND" || code === "FORBIDDEN") {
        // Boredroom can't post there any more: the route goes off and owners and HR are told once.
        await db.query(`UPDATE connector_channel_routes SET enabled = false, enabled_by = NULL, enabled_at = NULL WHERE id = $1`, [route.id]);
        await notifyTrouble(db, conn, `route:${route.id}`, CONNECTOR_WORDS.routes.cantPost(route.source_label));
      } else {
        await db.query(`DELETE FROM connector_rate_budget WHERE bucket = $1`, [bucket]);
      }
    });
    if (code === "NOT_ALLOWED" || code === "NOT_FOUND" || code === "FORBIDDEN") return "disabled";
    throw err; // RATE_LIMITED, PROVIDER_DOWN: the job retries with its backoff
  }
  await withWorker((db) => connectorAudit(db, { organisationId: conn.organisationId, connectionId: conn.id, provider: conn.provider, kind: "workspace", membershipId: actor.membershipId, action: `post.ok`, outcome: "ok" }));
  return "posted";
}

// ---- Scheduling and hooks --------------------------------------------------------------------------------------------------------

/**
 * The digests for today (worker/schedule.ts, next to the daily reports): each enabled daily_digest route posts at the
 * report time on working days, queued at most an hour ahead, once per route per local date.
 */
export async function scheduleConnectorPosts(now: Date = new Date()): Promise<{ queued: number }> {
  return withWorker(async (db) => {
    if (schema0061Missing()) return { queued: 0 };
    const routes = await db.query<{ id: string; timezone: string; working_days: number[]; report_time: string }>(
      `SELECT r.id, o.timezone, COALESCE(s.working_days, '{1,2,3,4,5}'::int[]) AS working_days, to_char(COALESCE(b.daily_report_time, '18:00'::time), 'HH24:MI') AS report_time
         FROM connector_channel_routes r JOIN organisations o ON o.id = r.organisation_id AND o.status = 'active'
         LEFT JOIN brenda_settings b ON b.organisation_id = o.id
         LEFT JOIN LATERAL (SELECT working_days FROM schedules WHERE organisation_id = o.id AND membership_id IS NULL ORDER BY effective_from DESC, created_at DESC LIMIT 1) s ON true
        WHERE r.enabled AND r.purpose = 'daily_digest' AND COALESCE(b.daily_report_enabled, true)`);
    let queued = 0;
    for (const r of routes) {
      const today = localDate(now, r.timezone);
      if (!r.working_days.includes(weekdayOf(today))) continue;
      const runAt = localTimeOn(today, r.report_time, r.timezone);
      if (runAt.getTime() > now.getTime() + 60 * 60_000 || runAt.getTime() < now.getTime() - 3 * 3600_000) continue;
      await db.query(`INSERT INTO jobs(type, payload, dedup_key, next_run_at) VALUES ('connector.post', $1, $2, $3) ON CONFLICT (dedup_key) DO NOTHING`,
        [JSON.stringify({ routeId: r.id, kind: "daily_digest", localDate: today }), `connector.post:${r.id}:daily_digest:${today}`, runAt]);
      queued++;
    }
    return { queued };
  });
}

/** Hook (services/standup.ts): a team's day opened (reminders) or its rollup was sent (standup). Never throws. */
export async function enqueueStandupPosts(e: { teamId: string; localDate: string; kind: "reminders" | "standup"; rollupId?: string; entryId?: string }): Promise<number> {
  try {
    return await withWorker(async (db) => {
      if (schema0061Missing()) return 0;
      const routes = await db.query<{ id: string }>(`SELECT id FROM connector_channel_routes WHERE team_id = $1 AND purpose = $2 AND enabled`, [e.teamId, e.kind === "reminders" ? "reminders" : "standup"]);
      const kind: PostKind = e.entryId ? "standup_entry" : e.kind;
      for (const r of routes) {
        await db.query(`INSERT INTO jobs(type, payload, dedup_key) VALUES ('connector.post', $1, $2) ON CONFLICT (dedup_key) DO NOTHING`,
          [JSON.stringify({ routeId: r.id, kind, localDate: e.localDate, ...(e.entryId ? { entryId: e.entryId } : {}), ...(e.rollupId ? { rollupId: e.rollupId } : {}) }),
            `connector.post:${r.id}:${kind}:${e.localDate}${e.entryId ? `:${e.entryId}` : ""}`]);
      }
      return routes.length;
    });
  } catch (err) {
    console.warn(`[connectors] standup post not queued: ${(err as Error)?.message?.slice(0, 120) ?? "error"}`);
    return 0;
  }
}

/** For a person's standup card: the enabled standup route's channel (readback line), or null. Under their row security. */
export async function standupChannelFor(db: Db, teamId: string): Promise<{ label: string; members: number | null; provider: string } | null> {
  if (schema0061Missing()) return null;
  return db.maybeOne<{ label: string; members: number | null; provider: string }>(
    `SELECT s.label, s.members, c.provider FROM connector_channel_routes r JOIN connector_sources s ON s.id = r.source_id JOIN connector_connections c ON c.id = s.connection_id
      WHERE r.team_id = $1 AND r.purpose = 'standup' AND r.enabled AND c.status = 'active' LIMIT 1`, [teamId]).catch((err: unknown) => { noteMissing0061(err); return null; });
}

export { managersOf };
