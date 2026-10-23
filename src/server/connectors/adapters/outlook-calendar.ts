/**
 * Outlook Calendar, Microsoft 365 and personal Microsoft accounts (calendars + chat group; owner decisions, 22 October
 * 2026: connectors; spec §8.2). Personal only: each person's own calendar, private to them. Reads a window (yesterday to
 * 14 days ahead) through Graph's calendarView every 10 minutes in their working hours; keeps a guest count, never names,
 * bodies or locations. Acting uses the same risk classes and readbacks as Google Calendar (`calendarActions`): a private
 * block and moving an event without guests happen when asked (Undo); invitations, answers and moves with guests wait
 * for Confirm; cancelling is destructive. Outlook sends the invitations, answers and cancellations itself. Server-only.
 */
import { localMidnight } from "@/server/lib/time";
import { calendarActions, calendarWindow, type CalendarOps } from "./google-calendar";
import { GRAPH, GRAPH_HOST, LOGIN_HOST, MS_ENV, fromGraphTime, graphMe, graphPages, interpretGraph, msConfigured, msOAuth, tenantOf, toGraphTime } from "./microsoft";
import { ConnectorError, type NormalisedItem, type ProviderAdapter, type ProviderHttp } from "../types";

export const OUTLOOK_SCOPES = {
  read: ["openid", "profile", "email", "offline_access", "User.Read", "Calendars.ReadBasic"],
  act: ["openid", "profile", "email", "offline_access", "User.Read", "Calendars.ReadBasic", "Calendars.ReadWrite"],
} as const;

/** Every time comes back in UTC (the readers convert to the person's zone). */
const PREFER = { Prefer: 'outlook.timezone="UTC"' } as const;
export const EVENT_SELECT = "id,subject,start,end,isAllDay,showAs,responseStatus,isOrganizer,isCancelled,isOnlineMeeting,webLink,lastModifiedDateTime,changeKey,attendees";

type GraphTime = { dateTime?: string | null; timeZone?: string | null };
export type GraphEvent = {
  id: string; subject?: string | null; start?: GraphTime; end?: GraphTime; isAllDay?: boolean; showAs?: string | null;
  responseStatus?: { response?: string | null } | null; isOrganizer?: boolean; isCancelled?: boolean; isOnlineMeeting?: boolean;
  webLink?: string | null; lastModifiedDateTime?: string | null; changeKey?: string | null;
  attendees?: { type?: string | null; emailAddress?: { address?: string | null; name?: string | null } | null }[] | null;
  organizer?: { emailAddress?: { address?: string | null; name?: string | null } | null } | null;
};

const RESPONSE: Record<string, NormalisedItem["response"]> = {
  organizer: "organiser", accepted: "accepted", tentativelyAccepted: "tentative", declined: "declined", notResponded: "needs_action", none: "needs_action",
};

/** The calendar date an all-day event's midnight (in whatever zone Outlook keeps it) falls on: the nearest UTC midnight. */
const allDayDate = (iso: string) => new Date(Math.round(Date.parse(iso) / 86_400_000) * 86_400_000).toISOString().slice(0, 10);

/** One Outlook event as an item; "gone" when cancelled; null when unreadable. `self`: the person's own address (left out of the guest count). */
export function outlookEventItem(e: GraphEvent, tz: string, self: string | null): NormalisedItem | "gone" | null {
  if (!e || typeof e.id !== "string") return null;
  if (e.isCancelled) return "gone";
  let startsAt = fromGraphTime(e.start);
  let endsAt = fromGraphTime(e.end);
  if (!startsAt || !endsAt) return null;
  const allDay = !!e.isAllDay;
  if (allDay) {
    startsAt = localMidnight(allDayDate(startsAt), tz).toISOString();
    endsAt = localMidnight(allDayDate(endsAt), tz).toISOString();
  }
  const me = (self ?? "").trim().toLowerCase();
  const guests = (Array.isArray(e.attendees) ? e.attendees : []).filter((a) => a && a.type !== "resource" && (a.emailAddress?.address ?? "").trim().toLowerCase() !== me).length;
  const response: NormalisedItem["response"] = e.isOrganizer ? "organiser" : RESPONSE[e.responseStatus?.response ?? ""] ?? null;
  return {
    kind: "event", externalId: e.id, title: typeof e.subject === "string" && e.subject.trim() ? e.subject : "(No title)",
    startsAt, endsAt, allDay, busy: !(e.showAs === "free" || e.showAs === "workingElsewhere"), response, online: !!e.isOnlineMeeting,
    guests, url: typeof e.webLink === "string" ? e.webLink : null, providerUpdatedAt: e.lastModifiedDateTime ?? null, mine: true,
  };
}

const eventUrl = (id: string) => `${GRAPH}/me/events/${encodeURIComponent(id)}`;
const asItem = (e: GraphEvent, tz: string, self: string | null) => {
  const it = outlookEventItem(e, tz, self);
  return it && it !== "gone" ? it : null;
};

/** The event as it is now, and whether it is still the version Boredroom left (for Undo). */
async function stillAsLeft(http: ProviderHttp, data: Record<string, unknown>): Promise<void> {
  const e = (await http.request<GraphEvent>({ url: eventUrl(String(data.eventId ?? "")), query: { $select: "id,changeKey,isCancelled" }, headers: PREFER })).body;
  if (e.isCancelled) throw new ConnectorError("NOT_FOUND", "event gone");
  if (typeof data.version === "string" && e.changeKey !== data.version) throw new ConnectorError("CONFLICT", "event changed since");
}

const outlookOps: CalendarOps = {
  app: "Outlook Calendar",
  cancelSendsNote: true,
  async block(c) {
    // A private block (owner decisions, 22 October 2026): private sensitivity, shown as busy, no attendees, no invitations.
    const r = await c.http.request<GraphEvent>({ method: "POST", url: `${GRAPH}/me/events`, headers: PREFER, json: { subject: c.input.title, start: toGraphTime(c.input.startsAt), end: toGraphTime(c.input.endsAt), sensitivity: "private", showAs: "busy" } });
    return { eventId: r.body.id, version: r.body.changeKey ?? null, item: asItem(r.body, c.actor.timeZone, c.conn.accountLabel) };
  },
  async unblock({ http, data }) {
    await stillAsLeft(http, data);
    await http.request({ method: "DELETE", url: eventUrl(String(data.eventId)), expect: "none" });
  },
  async move(c, item) {
    // Outlook tells the attendees itself when the organiser changes the time.
    const r = await c.http.request<GraphEvent>({ method: "PATCH", url: eventUrl(item.externalId), headers: PREFER, json: { start: toGraphTime(c.input.startsAt), end: toGraphTime(c.input.endsAt) } });
    return { version: r.body?.changeKey ?? null, item: r.body?.id ? asItem(r.body, c.actor.timeZone, c.conn.accountLabel) : null };
  },
  async moveBack({ http, data }) {
    await stillAsLeft(http, data);
    await http.request({ method: "PATCH", url: eventUrl(String(data.eventId)), headers: PREFER, json: { start: toGraphTime(String(data.startsAt)), end: toGraphTime(String(data.endsAt)) } });
  },
  async invite(c) {
    const r = await c.http.request<GraphEvent>({
      method: "POST", url: `${GRAPH}/me/events`, headers: PREFER,
      json: { subject: c.input.title, start: toGraphTime(c.input.startsAt), end: toGraphTime(c.input.endsAt), attendees: c.input.guests.map((address) => ({ emailAddress: { address }, type: "required" })) },
    });
    return asItem(r.body, c.actor.timeZone, c.conn.accountLabel);
  },
  async organiser(c, item) {
    const e = (await c.http.request<GraphEvent>({ url: eventUrl(item.externalId), query: { $select: "organizer" } })).body;
    const name = (e.organizer?.emailAddress?.name ?? "").trim() || (e.organizer?.emailAddress?.address ?? "").trim();
    return name ? name.replace(/\s+/g, " ").slice(0, 120) : null;
  },
  async rsvp(c, item) {
    const verb = c.input.response === "accept" ? "accept" : c.input.response === "tentative" ? "tentativelyAccept" : "decline";
    await c.http.request({ method: "POST", url: `${eventUrl(item.externalId)}/${verb}`, json: { ...(c.input.note ? { comment: c.input.note } : {}), sendResponse: true }, expect: "none" });
  },
  async cancel(c, item, guests) {
    // A meeting with attendees is cancelled (they're told, with the note); an event with nobody else is just deleted.
    if (guests > 0) await c.http.request({ method: "POST", url: `${eventUrl(item.externalId)}/cancel`, json: c.input.note ? { comment: c.input.note } : {}, expect: "none" });
    else await c.http.request({ method: "DELETE", url: eventUrl(item.externalId), expect: "none" });
  },
};

export const adapter: ProviderAdapter = {
  id: "outlook_calendar",
  category: "calendar",
  kinds: ["personal"],
  hosts: [GRAPH_HOST, LOGIN_HOST],
  linkHosts: ["outlook.office365.com", "outlook.office.com", "outlook.live.com"],
  env: MS_ENV,
  configured: msConfigured,
  oauth: msOAuth("common", ({ act }) => [...(act ? OUTLOOK_SCOPES.act : OUTLOOK_SCOPES.read)]),
  async identify({ http, tokens }) {
    const me = await graphMe(http);
    const label = (me.mail ?? "").trim() || (me.userPrincipalName ?? "").trim() || "Outlook Calendar";
    return { externalAccountId: me.id, externalTenantId: tenantOf(tokens.facts), accountLabel: label, identity: { externalUserId: me.id, email: label.includes("@") ? label : null } };
  },
  ownerBound: false,
  workspaceActs: false,
  streams: [
    { name: "events", kinds: ["event"], every: { workingMinutes: 10, offMinutes: 60 }, perRun: { pages: 5, items: 500, ms: 15_000 }, fullEveryMinutes: 10 },
  ],
  async sync({ conn, http, now, timeZone, sink, deadline }) {
    if (conn.kind !== "personal") return { cursor: null, more: false };
    const { from, to } = calendarWindow(now, timeZone);
    const r = await graphPages<GraphEvent>(http, `${GRAPH}/me/calendarView`, {
      query: { startDateTime: from.toISOString(), endDateTime: to.toISOString(), $select: EVENT_SELECT, $orderby: "start/dateTime", $top: 100 },
      headers: PREFER, maxPages: 5, maxItems: 500, deadline,
    });
    const items: NormalisedItem[] = [];
    const gone: string[] = [];
    for (const e of r.items) {
      const it = outlookEventItem(e, timeZone, conn.accountLabel);
      if (it === "gone") gone.push(e.id);
      else if (it) items.push(it);
    }
    if (items.length) await sink.upsert(items);
    if (gone.length) await sink.gone("event", gone);
    const seen = items.map((i) => i.externalId);
    // A windowed re-list (§6). Cut short, only the part before the last start seen is known to be complete.
    if (r.done) await sink.reconcileWindow("event", from, to, seen);
    else {
      const last = items.reduce<string | null>((m, i) => (i.startsAt && (!m || i.startsAt > m) ? i.startsAt : m), null);
      if (last && Date.parse(last) > from.getTime()) await sink.reconcileWindow("event", from, new Date(last), seen);
    }
    return { cursor: null, more: false };
  },
  async fetchItem({ conn, http, kind, externalId }) {
    if (kind !== "event") return null;
    try {
      const e = (await http.request<GraphEvent>({ url: eventUrl(externalId), query: { $select: EVENT_SELECT }, headers: PREFER })).body;
      // All-day dates read as UTC here (no zone to hand); the next windowed sync writes them in the person's zone.
      return asItem(e, "UTC", conn.accountLabel);
    } catch (err) {
      if (err instanceof ConnectorError && err.code === "NOT_FOUND") return null;
      throw err;
    }
  },
  actions: calendarActions(outlookOps),
  interpret: interpretGraph,
  // No revoke: Microsoft has no per-app endpoint. Disconnecting deletes the tokens; the card says where to remove the app.
};
