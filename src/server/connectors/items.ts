/**
 * Connected apps on the person's own day (owner decisions, 22 October 2026: connectors; spec §9.10, §11.4, §11.5). Every
 * read runs as the person under row security: their own calendar events and personal items, and the workspace's items
 * assigned to them (by their identity in the app or their email's keyed digest). Owners and HR see only their own here
 * too. Nothing in this file is ever read for anyone else's view, a report, a score, presence or attendance (D4).
 * Server-only.
 */
import { withSystem, withUser, type Db } from "@/server/db";
import type { OrgContext } from "@/server/lib/api";
import { forbidden, invalid, notFound } from "@/server/lib/errors";
import { noteMissing0061, schema0061Missing } from "@/server/lib/schema-0061";
import { addDays, localDate, localMidnight } from "@/server/lib/time";
import { personTimeZone } from "@/server/lib/routine-time";
import { quickTodo } from "@/server/services/tasks";
import { startSession } from "@/server/services/sessions";
import { BRENDA_CONNECTOR_WORDS } from "@/lib/connectors/words";
import { PROVIDER_LABELS, type ConnectedDayView, type DayEvent, type DayItem, type ItemKind, type ItemState, type ProviderId } from "@/lib/connectors/types";
import { emailDigest, assignedToSql } from "./identity";
import { impersonating } from "./connections";
import { hostAllowed } from "./http";

export type MeetingState = { ready: boolean; active: boolean; until: string | null };
export const NO_MEETING: MeetingState = { ready: false, active: false, until: null };

/** The person's zone: their own (assistant profile) or the workspace's. */
export async function personZone(db: Db, ctx: Pick<OrgContext, "org" | "membership">): Promise<string> {
  const r = await db.maybeOne<{ own: string | null }>(`SELECT timezone AS own FROM assistant_profiles WHERE membership_id = $1`, [ctx.membership.id]).catch(() => null);
  return personTimeZone(r?.own ?? null, ctx.org.timezone);
}

type EventRow = { id: string; provider: ProviderId; title: string; starts_at: string; ends_at: string; all_day: boolean | null; online: boolean | null; response: string | null; busy: boolean | null };

/**
 * Whether the person is in a meeting now, from their own events only: busy, not all-day, not declined, started and not
 * ended; back-to-back meetings merge (`until` is the last one's end). Used only on the person's own surfaces (D4).
 */
export async function meetingStateFor(db: Db, membershipId: string, now: Date = new Date()): Promise<MeetingState> {
  if (schema0061Missing()) return NO_MEETING;
  const rows = await db.query<{ starts_at: string; ends_at: string }>(
    `SELECT starts_at, ends_at FROM connector_items i JOIN connector_connections c ON c.id = i.connection_id AND c.status = 'active'
      WHERE i.membership_id = $1 AND i.kind = 'event' AND i.gone_at IS NULL AND COALESCE(i.busy, true) AND NOT COALESCE(i.all_day, false)
        AND COALESCE(i.response, 'accepted') <> 'declined' AND i.ends_at > $2::timestamptz AND i.starts_at < $2::timestamptz + interval '12 hours'
      ORDER BY i.starts_at`, [membershipId, now]).catch((err: unknown) => { noteMissing0061(err); throw err; });
  const current = rows.find((r) => Date.parse(r.starts_at) <= now.getTime() && Date.parse(r.ends_at) > now.getTime());
  if (!current) return { ready: true, active: false, until: null };
  let until = Date.parse(current.ends_at);
  for (const r of rows) {
    if (Date.parse(r.starts_at) <= until + 60_000 && Date.parse(r.ends_at) > until) until = Date.parse(r.ends_at);
  }
  return { ready: true, active: true, until: new Date(until).toISOString() };
}

/** The person's own meeting state in their own context (assistant profiles, desktop state). Never throws. */
export async function myMeetingState(ctx: OrgContext, now: Date = new Date()): Promise<MeetingState> {
  if (schema0061Missing() || impersonating(ctx)) return NO_MEETING;
  try { return await withUser(ctx.user.profileId, (db) => meetingStateFor(db, ctx.membership.id, now)); }
  catch (err) { noteMissing0061(err); return NO_MEETING; }
}

/** Today's busy times, times only (Brenda's situation line: never titles there). */
export async function busyBlocks(ctx: OrgContext, now: Date = new Date()): Promise<{ start: string; end: string }[]> {
  return withUser(ctx.user.profileId, async (db) => {
    const tz = await personZone(db, ctx);
    const day = localDate(now, tz);
    const from = localMidnight(day, tz);
    const to = localMidnight(addDays(day, 1), tz);
    const rows = await db.query<{ starts_at: string; ends_at: string }>(
      `SELECT i.starts_at, i.ends_at FROM connector_items i JOIN connector_connections c ON c.id = i.connection_id AND c.status = 'active' AND c.can_read
        WHERE i.membership_id = $1 AND i.kind = 'event' AND i.gone_at IS NULL AND COALESCE(i.busy, true) AND NOT COALESCE(i.all_day, false)
          AND COALESCE(i.response, 'accepted') <> 'declined' AND i.starts_at < $3 AND i.ends_at > $2 ORDER BY i.starts_at LIMIT 30`, [ctx.membership.id, from, to]);
    const merged: { start: number; end: number }[] = [];
    for (const r of rows) {
      const s = Date.parse(r.starts_at), e = Date.parse(r.ends_at);
      const last = merged[merged.length - 1];
      if (last && s <= last.end) last.end = Math.max(last.end, e);
      else merged.push({ start: s, end: e });
    }
    return merged.map((m) => ({ start: new Date(m.start).toISOString(), end: new Date(m.end).toISOString() }));
  });
}

type ItemRow = {
  id: string; provider: ProviderId; kind: ItemKind; subtype: string | null; external_id: string; external_key: string | null; title: string; state_label: string | null; state: ItemState | null;
  due_on: string | null; due_at: string | null; url: string | null; container_label: string | null; visibility: "workspace" | "personal"; hidden: boolean; updated: string;
};

const LINK_HOSTS: Partial<Record<ProviderId, string[]>> = {};
/** An item's link is shown only when it is https on its adapter's link hosts (checked again here, at display). */
async function safeUrl(provider: ProviderId, url: string | null): Promise<string | null> {
  if (!url) return null;
  let hosts = LINK_HOSTS[provider];
  if (!hosts) {
    try { hosts = [...(await (await import("./registry")).adapterFor(provider)).linkHosts]; } catch { hosts = []; }
    LINK_HOSTS[provider] = hosts;
  }
  return hostAllowed(url, hosts) ? url : null;
}

/** GET …/connectors/day: the person's events and assigned items for one day (§11.4). */
export async function connectedDay(ctx: OrgContext, date?: string | null, now: Date = new Date()): Promise<ConnectedDayView> {
  const enabled = !!ctx.plan.features.CONNECTORS;
  const empty = (ready: boolean, day: string): ConnectedDayView => ({ ready, enabled, date: day, connected: false, hasCalendar: false, events: [], items: [], hiddenCount: 0, attention: [], canTrack: false, meeting: { active: false, until: null } });
  if (schema0061Missing()) return empty(false, date ?? localDate(now, ctx.org.timezone));
  if (!enabled || impersonating(ctx)) return empty(true, date ?? localDate(now, ctx.org.timezone));
  const digest = emailDigest(ctx.user.email);
  // A database without 0061 fails here (schema-0061.ts) and answers "not ready".
  const out = await withUser(ctx.user.profileId, async (db) => {
    const tz = await personZone(db, ctx);
    const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : localDate(now, tz);
    const from = localMidnight(day, tz);
    const to = localMidnight(addDays(day, 1), tz);
    const conns = await db.query<{ id: string; provider: ProviderId; kind: "workspace" | "personal"; status: string; can_read: boolean }>(
      `SELECT id, provider, kind, status, can_read FROM connector_connections
        WHERE organisation_id = $1 AND status <> 'disconnecting' AND (kind = 'workspace' OR membership_id = $2)`, [ctx.org.id, ctx.membership.id]);
    const personal = conns.filter((c) => c.kind === "personal");
    // Workspace connections with chosen sources this person may see (row security), for "connected" below.
    const fed = new Set((await db.query<{ connection_id: string }>(
      `SELECT DISTINCT connection_id FROM connector_sources WHERE organisation_id = $1 AND visibility = 'workspace' AND selected AND NOT archived`, [ctx.org.id])).map((r) => r.connection_id));
    const events = await db.query<EventRow>(
      `SELECT i.id, i.provider, i.title, i.starts_at, i.ends_at, i.all_day, i.online, i.response, i.busy
         FROM connector_items i JOIN connector_connections c ON c.id = i.connection_id AND c.status = 'active' AND c.can_read
        WHERE i.membership_id = $1 AND i.kind = 'event' AND i.gone_at IS NULL AND i.starts_at < $3 AND i.ends_at > $2
          AND COALESCE(i.response, 'accepted') <> 'declined'
        ORDER BY COALESCE(i.all_day, false) DESC, i.starts_at LIMIT 60`, [ctx.membership.id, from, to]);
    const items = await db.query<ItemRow>(
      `SELECT i.id, i.provider, i.kind, i.subtype, i.external_id, i.external_key, i.title, i.state_label, i.state, i.due_on, i.due_at, i.url, i.container_label, i.visibility,
              EXISTS (SELECT 1 FROM connector_item_hides h WHERE h.membership_id = $2 AND h.item_id = i.id) AS hidden,
              COALESCE(i.provider_updated_at, i.synced_at) AS updated
         FROM connector_items i JOIN connector_connections c ON c.id = i.connection_id AND c.status = 'active' AND (c.kind = 'workspace' OR c.can_read)
        WHERE i.organisation_id = $1 AND i.kind = 'issue' AND i.gone_at IS NULL AND COALESCE(i.state, 'open') IN ('open', 'in_progress')
          AND ${assignedToSql("i", "$2", "$3")}
        ORDER BY (i.visibility = 'personal') DESC, i.due_on NULLS LAST, i.due_at NULLS LAST, updated DESC LIMIT 120`, [ctx.org.id, ctx.membership.id, digest]);
    const links = items.length ? await db.query<{ item_id: string; task_id: string; title: string }>(
      `SELECT l.item_id, l.task_id, t.title FROM connector_task_links l JOIN tasks t ON t.id = l.task_id AND t.archived_at IS NULL
        WHERE l.membership_id = $1 AND l.item_id = ANY($2::uuid[]) ORDER BY l.created_at DESC`, [ctx.membership.id, items.map((i) => i.id)]) : [];
    const meeting = await meetingStateFor(db, ctx.membership.id, now);
    // Opening My Day checks the calendar again when the last check is more than 2 minutes old (at most once a minute).
    const stale = personal.length ? await db.query<{ connection_id: string }>(
      `SELECT s.connection_id FROM connector_sync_state s JOIN connector_connections c ON c.id = s.connection_id
        WHERE c.membership_id = $1 AND c.status = 'active' AND s.stream = 'events' AND (s.last_run_at IS NULL OR s.last_run_at < now() - interval '2 minutes')`, [ctx.membership.id]).catch(() => []) : [];
    return { day, conns, fed, events, items, links, meeting, stale };
  }).catch((err: unknown) => { if (noteMissing0061(err)) return null; throw err; });
  if (!out) return empty(false, date ?? localDate(now, ctx.org.timezone));
  if (out.stale.length) {
    const bucket = Math.floor(now.getTime() / 60_000);
    await withSystem(async (db) => {
      for (const s of out.stale) {
        await db.query(`INSERT INTO jobs(type, payload, dedup_key) VALUES ('connector.sync', $1, $2) ON CONFLICT (dedup_key) DO NOTHING`,
          [JSON.stringify({ connectionId: s.connection_id, stream: "events", reason: "day" }), `connector.sync:${s.connection_id}:events:day:${bucket}`]);
      }
    }).catch(() => undefined);
  }
  const linkOf = new Map<string, { id: string; title: string }>();
  for (const l of out.links) if (!linkOf.has(l.item_id)) linkOf.set(l.item_id, { id: l.task_id, title: l.title });
  const nowMs = now.getTime();
  const events: DayEvent[] = out.events.map((e) => ({
    id: e.id, provider: e.provider, title: e.title, startsAt: e.starts_at, endsAt: e.ends_at, allDay: !!e.all_day, online: !!e.online, response: e.response,
    now: !e.all_day && Date.parse(e.starts_at) <= nowMs && Date.parse(e.ends_at) > nowMs,
  }));
  // The same issue through the person's own connection and the workspace's: shown once, the person's own first.
  const seen = new Set<string>();
  const items: DayItem[] = [];
  for (const i of out.items) {
    const key = `${i.provider}:${i.external_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      id: i.id, provider: i.provider, kind: i.kind, subtype: i.subtype, externalKey: i.external_key, title: i.title, stateLabel: i.state_label, state: i.state,
      dueOn: i.due_on, dueAt: i.due_at, url: await safeUrl(i.provider, i.url), containerLabel: i.container_label, visibility: i.visibility, hidden: i.hidden,
      linkedTask: linkOf.get(i.id) ?? null,
    });
    if (items.length >= 50) break;
  }
  // Fix, 22 October 2026: only connections that put something on My Day count (a workspace's Slack or Teams never does,
  // nor Notion): the person's calendar or work apps, and the workspace's work apps with chosen sources.
  const CALENDARS: ProviderId[] = ["google_calendar", "outlook_calendar", "fake"];
  const WORK: ProviderId[] = ["linear", "jira", "github", "asana", "fake"];
  const live = out.conns.filter((c) => c.status !== "paused");
  const hasCalendar = live.some((c) => c.kind === "personal" && CALENDARS.includes(c.provider));
  const feedsWork = live.some((c) => WORK.includes(c.provider) && (c.kind === "personal" || out.fed.has(c.id)));
  return {
    ready: true, enabled, date: out.day, connected: hasCalendar || feedsWork || events.length > 0 || items.length > 0, hasCalendar, events, items, hiddenCount: items.filter((i) => i.hidden).length,
    attention: out.conns.filter((c) => c.kind === "personal" && c.status === "needs_reauth").map((c) => ({ provider: c.provider, kind: c.kind })),
    canTrack: ctx.membership.role === "employee" || ctx.membership.role === "manager",
    meeting: { active: out.meeting.active, until: out.meeting.until },
  };
}

/** One item the person can see (their row security decides), or 404. */
export async function visibleItem(ctx: OrgContext, itemId: string): Promise<{ id: string; provider: ProviderId; kind: ItemKind; external_key: string | null; title: string; visibility: "workspace" | "personal"; connection_id: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(itemId)) throw notFound();
  const r = await withUser(ctx.user.profileId, (db) => db.maybeOne<{ id: string; provider: ProviderId; kind: ItemKind; external_key: string | null; title: string; visibility: "workspace" | "personal"; connection_id: string }>(
    `SELECT i.id, i.provider, i.kind, i.external_key, i.title, i.visibility, i.connection_id FROM connector_items i
      WHERE i.id = $1 AND i.organisation_id = $2 AND i.gone_at IS NULL`, [itemId, ctx.org.id]));
  if (!r || (r.visibility === "personal" && impersonating(ctx))) throw notFound(BRENDA_CONNECTOR_WORDS.noItem);
  return r;
}

/** Hide an item from the person's own My Day, or show it again. Only they see this. */
export async function hideItem(ctx: OrgContext, itemId: string, hidden: boolean): Promise<{ ok: true; changed: boolean }> {
  if (impersonating(ctx)) throw forbidden(BRENDA_CONNECTOR_WORDS.impersonated);
  const item = await visibleItem(ctx, itemId);
  const rows = await withUser(ctx.user.profileId, (db) => hidden
    ? db.query(`INSERT INTO connector_item_hides(membership_id, organisation_id, item_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING item_id`, [ctx.membership.id, ctx.org.id, item.id])
    : db.query(`DELETE FROM connector_item_hides WHERE membership_id = $1 AND item_id = $2 RETURNING item_id`, [ctx.membership.id, item.id]));
  return { ok: true, changed: rows.length > 0 };
}

export type TrackInput = { taskId?: string; newTodo?: { title?: string }; startTimer?: boolean };

/**
 * Track an item as a to-do (§11.5): link it to one of the person's own open to-dos, or make a new one (their team lead
 * sees it like any to-do), and optionally start its timer. The link itself is checked by the database (the item theirs
 * to link, the to-do theirs and open) and is private to them when the item is.
 */
export async function trackItem(ctx: OrgContext, itemId: string, input: TrackInput): Promise<{ taskId: string; linked: true; linkId: string | null; created: boolean; session?: unknown }> {
  if (impersonating(ctx)) throw forbidden(BRENDA_CONNECTOR_WORDS.impersonated);
  if (ctx.membership.role !== "employee" && ctx.membership.role !== "manager") throw forbidden(BRENDA_CONNECTOR_WORDS.staffOnly);
  const item = await visibleItem(ctx, itemId);
  if (item.kind !== "issue") throw invalid("Only issues and tasks can be tracked as to-dos.");
  let taskId = input.taskId ?? null;
  let created = false;
  if (!taskId) {
    if (!input.newTodo) throw invalid("Choose a to-do, or make a new one.");
    const title = (input.newTodo.title?.trim() || `${item.external_key ? `${item.external_key} ` : ""}${item.title}`).replace(/\s+/g, " ").slice(0, 200);
    const t = await quickTodo(ctx, { title, description: `From ${PROVIDER_LABELS[item.provider]}${item.external_key ? `: ${item.external_key}` : ""}.` });
    taskId = t.id;
    created = true;
  } else {
    const own = await withUser(ctx.user.profileId, (db) => db.maybeOne(
      `SELECT 1 FROM tasks WHERE id = $1 AND organisation_id = $2 AND assignee_membership_id = $3 AND archived_at IS NULL AND status <> 'completed'`, [taskId, ctx.org.id, ctx.membership.id]));
    if (!own) throw notFound(BRENDA_CONNECTOR_WORDS.noSuchTask);
  }
  const link = await withUser(ctx.user.profileId, (db) => db.maybeOne<{ id: string }>(
    `INSERT INTO connector_task_links(organisation_id, item_id, task_id, membership_id, visibility) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (item_id, task_id) DO NOTHING RETURNING id`, [ctx.org.id, item.id, taskId, ctx.membership.id, item.visibility]));
  let session: unknown;
  if (input.startTimer) session = await startSession(ctx, { taskId: taskId! });
  return { taskId: taskId!, linked: true, linkId: link?.id ?? null, created, ...(session ? { session } : {}) };
}

/** Undo a link (the to-do and any timer stay). */
export async function unlinkItem(ctx: OrgContext, linkId: string): Promise<boolean> {
  const rows = await withUser(ctx.user.profileId, (db) => db.query(`DELETE FROM connector_task_links WHERE id = $1 AND membership_id = $2 RETURNING id`, [linkId, ctx.membership.id]));
  return rows.length > 0;
}

/** The items linked to these tasks that the viewer may see (their own links, and workspace links they can see both ends of). */
export async function linksFor(ctx: OrgContext, taskIds: string[]): Promise<Map<string, { itemId: string; provider: ProviderId; key: string | null; title: string }[]>> {
  const out = new Map<string, { itemId: string; provider: ProviderId; key: string | null; title: string }[]>();
  if (!taskIds.length || schema0061Missing()) return out;
  const rows = await withUser(ctx.user.profileId, async (db) => {
    return db.query<{ task_id: string; item_id: string; provider: ProviderId; external_key: string | null; title: string }>(
      `SELECT l.task_id, i.id AS item_id, i.provider, i.external_key, i.title FROM connector_task_links l JOIN connector_items i ON i.id = l.item_id
        WHERE l.task_id = ANY($1::uuid[]) AND i.gone_at IS NULL`, [taskIds]);
  }).catch((err: unknown) => { noteMissing0061(err); return []; });
  for (const r of rows) {
    const list = out.get(r.task_id) ?? [];
    list.push({ itemId: r.item_id, provider: r.provider, key: r.external_key, title: r.title });
    out.set(r.task_id, list);
  }
  return out;
}
