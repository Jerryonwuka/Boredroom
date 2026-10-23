/**
 * Google Calendar (calendars + chat group; owner decisions, 22 October 2026: connectors; spec §8.1). Personal only: each
 * person's own primary calendar, private to them. Reads a window (yesterday to 14 days ahead) every 10 minutes in their
 * working hours; never stores descriptions, locations or who the guests are (a count only). Acting, by risk class (§9.2):
 * a private block of their own time and moving an event without guests happen when they ask (with Undo); inviting,
 * answering an invitation and moving an event with guests are shared (Confirm); cancelling is destructive (Confirm).
 *
 * Also holds the calendar ActionSpecs both calendars share (`calendarActions`): the same risk classes, refusals and exact
 * readbacks (§9.5) for Google and Outlook, each with its own requests (calendars + chat group, 22 October 2026: one place
 * for the words, so the two calendars can't drift apart). Server-only.
 */
// CONTRACT REQUEST (22 October 2026): `fetchItem` gets no time zone, so an all-day event fetched on its own (a webhook
// nudge or an item re-read) is dated in UTC until the next windowed sync rewrites it in the person's zone. Passing the
// person's `timeZone` to fetchItem (as SyncInput has it) would close that gap. Not blocking: calendars have no webhooks
// in v1 and the framework re-reads calendar items only through sync.
import { z } from "zod";
import { env, envAll } from "../env";
import { localDate, localMidnight, addDays, isValidTimeZone } from "@/server/lib/time";
import { APP_READBACK } from "@/lib/connectors/words";
import {
  ConnectorError,
  type ActInput,
  type ActionSpec,
  type HttpResponse,
  type NormalisedItem,
  type ProviderAdapter,
  type ProviderHttp,
  type StoredItem,
  type TokenSet,
} from "../types";

// ---- Calendar words shared by Google Calendar and Outlook Calendar ----------------------------------------------------

const zoneOr = (tz: string) => (tz && isValidTimeZone(tz) ? tz : "UTC");

function parts(iso: string, tz: string): { weekday: string; day: string; month: string; hm: string; ymd: string } {
  const d = new Date(iso);
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: zoneOr(tz), weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value])) as Record<string, string>;
  return { weekday: p.weekday, day: p.day, month: p.month, hm: `${p.hour}:${p.minute}`, ymd: localDate(d, zoneOr(tz)) };
}

/** "Thursday 23 October". */
export function dayWords(iso: string, tz: string): string {
  const p = parts(iso, tz);
  return `${p.weekday} ${p.day} ${p.month}`;
}
/** "14:00". */
export function timeWords(iso: string, tz: string): string {
  return parts(iso, tz).hm;
}
/** "14:00–15:00". */
export function rangeWords(startIso: string, endIso: string, tz: string): string {
  return `${timeWords(startIso, tz)}–${timeWords(endIso, tz)}`;
}
/** "Thursday 23 October 14:00–15:00" (or across midnight: "Thursday 23 October 23:00 – Friday 24 October 01:00"). */
export function whenWords(startIso: string, endIso: string, tz: string): string {
  const s = parts(startIso, tz);
  const e = parts(endIso, tz);
  return s.ymd === e.ymd ? `${s.weekday} ${s.day} ${s.month} ${s.hm}–${e.hm}` : `${s.weekday} ${s.day} ${s.month} ${s.hm} – ${e.weekday} ${e.day} ${e.month} ${e.hm}`;
}

const iso = z.string().datetime({ offset: true });
const timed = <T extends { startsAt: string; endsAt: string }>(o: T) => {
  const ms = Date.parse(o.endsAt) - Date.parse(o.startsAt);
  return ms > 0 && ms <= 24 * 3600_000;
};
export const BlockInput = z.object({ title: z.string().trim().min(1).max(120), startsAt: iso, endsAt: iso }).refine(timed, "times");
export const MoveInput = z.object({ startsAt: iso, endsAt: iso }).refine(timed, "times");
export const InviteInput = z.object({ title: z.string().trim().min(1).max(120), startsAt: iso, endsAt: iso, guests: z.array(z.string().trim().toLowerCase().email().max(254)).min(1).max(20) }).refine(timed, "times");
export const RsvpInput = z.object({ response: z.enum(["accept", "tentative", "decline"]), note: z.string().trim().max(300).optional() });
export const CancelInput = z.object({ note: z.string().trim().max(300).optional() });
export type BlockIn = z.infer<typeof BlockInput>;
export type MoveIn = z.infer<typeof MoveInput>;
export type InviteIn = z.infer<typeof InviteInput>;
export type RsvpIn = z.infer<typeof RsvpInput>;
export type CancelIn = z.infer<typeof CancelInput>;

const RSVP_WORDS = {
  accept: { verb: "Accept", lower: "accept", done: "Accepted" },
  tentative: { verb: "Tentatively accept", lower: "tentatively accept", done: "Tentatively accepted" },
  decline: { verb: "Decline", lower: "decline", done: "Declined" },
} as const;

/** What each calendar does over its own API; the shared specs build the cards around it. */
export type CalendarOps = {
  /** "Google Calendar" | "Outlook Calendar". */
  app: string;
  /** Whether a cancellation carries the person's note to the guests (Outlook yes; Google no). */
  cancelSendsNote: boolean;
  block(c: ActInput<BlockIn>): Promise<{ eventId: string; version: string | null; item: NormalisedItem | null }>;
  /** Undo a block: refuses (NOT_FOUND or CONFLICT) when it was removed or edited since. */
  unblock(c: { http: ProviderHttp; data: Record<string, unknown> }): Promise<void>;
  move(c: ActInput<MoveIn>, item: StoredItem, notify: boolean): Promise<{ version: string | null; item: NormalisedItem | null }>;
  /** Undo a private move: back to where it was, unless it changed since. */
  moveBack(c: { http: ProviderHttp; data: Record<string, unknown> }): Promise<void>;
  invite(c: ActInput<InviteIn>): Promise<NormalisedItem | null>;
  /** The organiser's name or address for the rsvp readback (resolved from the app), or null. */
  organiser(c: ActInput<unknown>, item: StoredItem): Promise<string | null>;
  rsvp(c: ActInput<RsvpIn>, item: StoredItem): Promise<void>;
  cancel(c: ActInput<CancelIn>, item: StoredItem, guests: number): Promise<void>;
};

const needItem = (c: ActInput<unknown>): StoredItem => {
  if (!c.item || c.item.kind !== "event") throw new ConnectorError("NOT_FOUND", "no event");
  return c.item;
};
const organises = (i: StoredItem) => i.response === null || i.response === "organiser";
const you = (c: ActInput<unknown>) => APP_READBACK.as.yourAccount(c.conn.accountLabel);

/** The five calendar actions (§8.1, §8.2, §9.2, §9.5) over one calendar's requests. */
export function calendarActions(ops: CalendarOps): ActionSpec[] {
  const block: ActionSpec<BlockIn> = {
    name: "block", tool: "calendar_action", kinds: ["personal"], input: BlockInput,
    async prepare(c) {
      const tz = c.actor.timeZone;
      return {
        risk: "private",
        summary: APP_READBACK.block.summary(rangeWords(c.input.startsAt, c.input.endsAt, tz), c.input.title),
        readback: { to: [APP_READBACK.block.to()], what: APP_READBACK.block.what(ops.app, whenWords(c.input.startsAt, c.input.endsAt, tz)) },
        appearsAs: "you",
      };
    },
    async run(c) {
      const r = await ops.block(c);
      return { summary: `Blocked ${rangeWords(c.input.startsAt, c.input.endsAt, c.actor.timeZone)} for “${c.input.title}”`, item: r.item, undo: { kind: "block", data: { eventId: r.eventId, version: r.version } } };
    },
    async undo(c) { await ops.unblock(c); },
  };

  const move: ActionSpec<MoveIn> = {
    name: "move", tool: "calendar_action", kinds: ["personal"], input: MoveInput,
    async prepare(c) {
      const i = needItem(c);
      // Only events the person organises: a guest can't move someone else's meeting (owner decisions, 22 October 2026).
      if (!organises(i)) throw new ConnectorError("NOT_ALLOWED", "only events you organise can be moved");
      const guests = i.guests ?? 0;
      const what = APP_READBACK.move.what(i.title, whenWords(c.input.startsAt, c.input.endsAt, c.actor.timeZone));
      return guests > 0
        ? { risk: "shared", summary: APP_READBACK.move.summary(i.title), readback: { to: [APP_READBACK.move.to(guests)], what }, appearsAs: you(c), people: guests }
        : { risk: "private", summary: APP_READBACK.move.summary(i.title), readback: { to: [APP_READBACK.block.to()], what }, appearsAs: "you" };
    },
    async run(c) {
      const i = needItem(c);
      if (!organises(i)) throw new ConnectorError("NOT_ALLOWED", "only events you organise can be moved");
      const guests = i.guests ?? 0;
      const r = await ops.move(c, i, guests > 0);
      const undo = guests === 0 && i.startsAt && i.endsAt ? { kind: "move", data: { eventId: i.externalId, startsAt: i.startsAt, endsAt: i.endsAt, version: r.version } } : null;
      return { summary: `Moved “${i.title}” to ${whenWords(c.input.startsAt, c.input.endsAt, c.actor.timeZone)}`, item: r.item, undo };
    },
    async undo(c) { await ops.moveBack(c); },
  };

  const invite: ActionSpec<InviteIn> = {
    name: "invite", tool: "calendar_action", kinds: ["personal"], input: InviteInput,
    async prepare(c) {
      const n = c.input.guests.length;
      return {
        risk: "shared",
        summary: APP_READBACK.invite.summary(n, c.input.title),
        readback: { to: c.input.guests.map((g) => APP_READBACK.invite.to(g, ops.app)), what: APP_READBACK.invite.what(c.input.title, whenWords(c.input.startsAt, c.input.endsAt, c.actor.timeZone)) },
        appearsAs: you(c), people: n,
      };
    },
    async run(c) {
      const item = await ops.invite(c);
      const n = c.input.guests.length;
      return { summary: `Invited ${n} ${n === 1 ? "person" : "people"} to “${c.input.title}”`, item };
    },
  };

  const rsvp: ActionSpec<RsvpIn> = {
    name: "rsvp", tool: "calendar_action", kinds: ["personal"], input: RsvpInput,
    async prepare(c) {
      const i = needItem(c);
      if (i.response === "organiser") throw new ConnectorError("NOT_ALLOWED", "the person organises this event");
      const w = RSVP_WORDS[c.input.response];
      const organiser = await ops.organiser(c, i);
      const at = i.startsAt ? `${dayWords(i.startsAt, c.actor.timeZone)} at ${timeWords(i.startsAt, c.actor.timeZone)}` : "its day";
      return {
        risk: "shared",
        summary: APP_READBACK.rsvp.summary(w.verb, i.title),
        ...(c.input.note ? { detail: c.input.note } : {}),
        readback: { to: [APP_READBACK.rsvp.to(organiser)], what: APP_READBACK.rsvp.what(w.lower, i.title, at, !!c.input.note) },
        appearsAs: you(c), people: 1,
      };
    },
    async run(c) {
      const i = needItem(c);
      if (i.response === "organiser") throw new ConnectorError("NOT_ALLOWED", "the person organises this event");
      await ops.rsvp(c, i);
      return { summary: `${RSVP_WORDS[c.input.response].done} “${i.title}”` };
    },
  };

  const cancel: ActionSpec<CancelIn> = {
    name: "cancel", tool: "calendar_action", kinds: ["personal"], input: CancelInput,
    async prepare(c) {
      const i = needItem(c);
      if (!organises(i)) throw new ConnectorError("NOT_ALLOWED", "only events you organise can be cancelled");
      const guests = i.guests ?? 0;
      const day = i.startsAt ? dayWords(i.startsAt, c.actor.timeZone) : "its day";
      const noteDropped = !!c.input.note && guests > 0 && !ops.cancelSendsNote;
      return {
        risk: "destructive",
        summary: APP_READBACK.cancel.summary(i.title),
        ...(c.input.note && guests > 0 && ops.cancelSendsNote ? { detail: c.input.note } : {}),
        readback: {
          to: [APP_READBACK.cancel.toCalendar, ...(guests ? [APP_READBACK.cancel.toGuests(guests)] : [])],
          // Honest about a note the app can't carry (Google sends no message with a cancellation).
          what: `${APP_READBACK.cancel.what(i.title, day)}${noteDropped ? `. ${ops.app} can't send your note with it` : ""}`,
        },
        appearsAs: you(c), people: guests,
      };
    },
    async run(c) {
      const i = needItem(c);
      if (!organises(i)) throw new ConnectorError("NOT_ALLOWED", "only events you organise can be cancelled");
      await ops.cancel(c, i, i.guests ?? 0);
      return { summary: `Cancelled “${i.title}”` };
    },
  };

  return [block, move, invite, rsvp, cancel];
}

/** The calendar window (§6): yesterday 00:00 to 14 days ahead, in the person's zone. */
export function calendarWindow(now: Date, timeZone: string): { from: Date; to: Date } {
  const tz = zoneOr(timeZone);
  const day = localDate(now, tz);
  return { from: localMidnight(addDays(day, -1), tz), to: localMidnight(addDays(day, 14), tz) };
}

// ---- Google ------------------------------------------------------------------------------------------------------------

const API = "https://www.googleapis.com/calendar/v3";
const EVENTS = `${API}/calendars/primary/events`;
const READ_SCOPE = "https://www.googleapis.com/auth/calendar.events.owned.readonly";
const ACT_SCOPE = "https://www.googleapis.com/auth/calendar.events.owned";
export const GOOGLE_SCOPES = { read: ["openid", "email", READ_SCOPE], act: ["openid", "email", READ_SCOPE, ACT_SCOPE] } as const;
const ENV = ["GOOGLE_CALENDAR_CLIENT_ID", "GOOGLE_CALENDAR_CLIENT_SECRET"] as const;

/** Only what Boredroom keeps (§8.1): no description, location or attendee details (attendees for `self` and a count). */
const EVENT_FIELDS = "id,status,summary,start,end,attendees(self,responseStatus,resource,organizer),organizer(self),transparency,hangoutLink,conferenceData(entryPoints(entryPointType)),htmlLink,updated,eventType";
export const LIST_FIELDS = `items(${EVENT_FIELDS}),nextPageToken`;

type GDate = { date?: string; dateTime?: string; timeZone?: string };
export type GoogleEvent = {
  id: string; status?: string; summary?: string; start?: GDate; end?: GDate;
  attendees?: { self?: boolean; responseStatus?: string; resource?: boolean; organizer?: boolean; email?: string; displayName?: string; comment?: string }[];
  organizer?: { self?: boolean; email?: string; displayName?: string }; transparency?: string; hangoutLink?: string;
  conferenceData?: { entryPoints?: { entryPointType?: string }[] }; htmlLink?: string; updated?: string; eventType?: string;
};

const RESPONSE: Record<string, NormalisedItem["response"]> = { accepted: "accepted", tentative: "tentative", declined: "declined", needsAction: "needs_action" };
const SKIPPED_TYPES = new Set(["workingLocation", "birthday"]);

function when(d: GDate | undefined, tz: string): { at: string; allDay: boolean } | null {
  if (!d) return null;
  if (d.dateTime && !Number.isNaN(Date.parse(d.dateTime))) return { at: new Date(d.dateTime).toISOString(), allDay: false };
  if (d.date && /^\d{4}-\d{2}-\d{2}$/.test(d.date)) return { at: localMidnight(d.date, zoneOr(tz)).toISOString(), allDay: true };
  return null;
}

/** One Google event as an item; "gone" when cancelled; null when it isn't kept (working location, birthdays, unreadable). */
export function googleEventItem(e: GoogleEvent, tz: string): NormalisedItem | "gone" | null {
  if (!e || typeof e.id !== "string") return null;
  if (e.status === "cancelled") return "gone";
  if (e.eventType && SKIPPED_TYPES.has(e.eventType)) return null;
  const s = when(e.start, tz);
  const en = when(e.end, tz);
  if (!s || !en) return null;
  const attendees = Array.isArray(e.attendees) ? e.attendees : [];
  const self = attendees.find((a) => a?.self);
  const response: NormalisedItem["response"] = e.organizer?.self ? "organiser" : self ? RESPONSE[self.responseStatus ?? ""] ?? null : "organiser";
  const online = !!e.hangoutLink || !!e.conferenceData?.entryPoints?.some((p) => p?.entryPointType === "video");
  return {
    kind: "event", externalId: e.id, title: typeof e.summary === "string" && e.summary.trim() ? e.summary : "(No title)",
    startsAt: s.at, endsAt: en.at, allDay: s.allDay, busy: e.transparency !== "transparent", response, online,
    guests: attendees.filter((a) => a && !a.self && !a.resource).length,
    url: typeof e.htmlLink === "string" ? e.htmlLink : null, providerUpdatedAt: e.updated ?? null, mine: true,
  };
}

const dateTime = (isoValue: string) => ({ dateTime: new Date(isoValue).toISOString() });
const eventUrl = (id: string) => `${EVENTS}/${encodeURIComponent(id)}`;

async function getEvent(http: ProviderHttp, id: string, fields = EVENT_FIELDS): Promise<GoogleEvent> {
  return (await http.request<GoogleEvent>({ url: eventUrl(id), query: { fields } })).body;
}

/** The event as it is now, and whether it is still the version Boredroom left (for Undo). */
async function stillAsLeft(http: ProviderHttp, data: Record<string, unknown>): Promise<GoogleEvent> {
  const e = await getEvent(http, String(data.eventId ?? ""), "id,status,updated");
  if (e.status === "cancelled") throw new ConnectorError("NOT_FOUND", "event gone");
  if (typeof data.version === "string" && e.updated !== data.version) throw new ConnectorError("CONFLICT", "event changed since");
  return e;
}

const googleOps: CalendarOps = {
  app: "Google Calendar",
  cancelSendsNote: false,
  async block(c) {
    const r = await c.http.request<GoogleEvent>({
      method: "POST", url: EVENTS, query: { sendUpdates: "none" },
      json: { summary: c.input.title, start: dateTime(c.input.startsAt), end: dateTime(c.input.endsAt), visibility: "private", transparency: "opaque", extendedProperties: { private: { boredroom: "block" } } },
    });
    const item = googleEventItem(r.body, c.actor.timeZone);
    return { eventId: r.body.id, version: r.body.updated ?? null, item: item && item !== "gone" ? item : null };
  },
  async unblock({ http, data }) {
    await stillAsLeft(http, data);
    await http.request({ method: "DELETE", url: eventUrl(String(data.eventId)), query: { sendUpdates: "none" }, expect: "none" });
  },
  async move(c, item, notify) {
    const r = await c.http.request<GoogleEvent>({ method: "PATCH", url: eventUrl(item.externalId), query: { sendUpdates: notify ? "all" : "none" }, json: { start: dateTime(c.input.startsAt), end: dateTime(c.input.endsAt) } });
    const it = googleEventItem(r.body, c.actor.timeZone);
    return { version: r.body.updated ?? null, item: it && it !== "gone" ? it : null };
  },
  async moveBack({ http, data }) {
    await stillAsLeft(http, data);
    await http.request({ method: "PATCH", url: eventUrl(String(data.eventId)), query: { sendUpdates: "none" }, json: { start: dateTime(String(data.startsAt)), end: dateTime(String(data.endsAt)) } });
  },
  async invite(c) {
    const r = await c.http.request<GoogleEvent>({
      method: "POST", url: EVENTS, query: { sendUpdates: "all" },
      json: { summary: c.input.title, start: dateTime(c.input.startsAt), end: dateTime(c.input.endsAt), attendees: c.input.guests.map((email) => ({ email })) },
    });
    const it = googleEventItem(r.body, c.actor.timeZone);
    return it && it !== "gone" ? it : null;
  },
  async organiser(c, item) {
    const e = await getEvent(c.http, item.externalId, "organizer(displayName,email,self)");
    const o = e.organizer;
    const name = (o?.displayName ?? "").trim() || (o?.email ?? "").trim();
    return name ? name.replace(/\s+/g, " ").slice(0, 120) : null;
  },
  async rsvp(c, item) {
    // Google's guidance: a guest answers by patching their own attendee entry; the whole list is sent back as it is,
    // with only `self` changed (Google ignores changes a guest may not make).
    const e = await getEvent(c.http, item.externalId, "attendees");
    const attendees = Array.isArray(e.attendees) ? e.attendees : [];
    if (!attendees.some((a) => a?.self)) throw new ConnectorError("NOT_ALLOWED", "not a guest of this event");
    const status = c.input.response === "accept" ? "accepted" : c.input.response === "tentative" ? "tentative" : "declined";
    const next = attendees.map((a) => (a?.self ? { ...a, responseStatus: status, ...(c.input.note ? { comment: c.input.note } : {}) } : a));
    await c.http.request({ method: "PATCH", url: eventUrl(item.externalId), query: { sendUpdates: "all" }, json: { attendees: next } });
  },
  async cancel(c, item, guests) {
    await c.http.request({ method: "DELETE", url: eventUrl(item.externalId), query: { sendUpdates: guests > 0 ? "all" : "none" }, expect: "none" });
  },
};

type GoogleErrorBody = { error?: { code?: number; status?: string; errors?: { reason?: string }[] } | string; error_description?: string };

/** Google's error bodies (403 usageLimits, non-organiser) as fixed codes; null leaves it to the status mapping. */
export function interpretGoogle(res: HttpResponse<unknown>): ConnectorError | null {
  if (res.status < 400) return null;
  const b = (res.body ?? {}) as GoogleErrorBody;
  const err = typeof b.error === "object" && b.error ? b.error : null;
  const reasons = (err?.errors ?? []).map((e) => e?.reason ?? "");
  if (reasons.includes("dailyLimitExceeded")) return new ConnectorError("RATE_LIMITED", "google daily limit", 3600);
  if (reasons.some((r) => r === "rateLimitExceeded" || r === "userRateLimitExceeded" || r === "quotaExceeded")) return new ConnectorError("RATE_LIMITED", "google usage limit", 60);
  if (reasons.includes("forbiddenForNonOrganizer")) return new ConnectorError("NOT_ALLOWED", "google: only the organiser");
  if (reasons.includes("insufficientPermissions") || err?.status === "PERMISSION_DENIED") return new ConnectorError("FORBIDDEN", "google: scope missing");
  return null;
}

/** Google's short scope names in a token answer, as Boredroom asked for them. */
function googleScopes(scope: unknown): string[] | null {
  if (typeof scope !== "string") return null;
  const alias: Record<string, string> = { "https://www.googleapis.com/auth/userinfo.email": "email", "https://www.googleapis.com/auth/userinfo.profile": "profile" };
  return [...new Set(scope.split(/\s+/).filter(Boolean).map((s) => alias[s] ?? s))];
}

export function parseGoogleToken(body: unknown, now: Date): TokenSet {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.error === "string") throw new ConnectorError(b.error === "invalid_grant" ? "REAUTH_REQUIRED" : "BAD_RESPONSE", `google token error ${b.error.slice(0, 40)}`);
  if (typeof b.access_token !== "string" || !b.access_token) throw new ConnectorError("BAD_RESPONSE", "google token missing");
  return {
    accessToken: b.access_token,
    refreshToken: typeof b.refresh_token === "string" && b.refresh_token ? b.refresh_token : null,
    tokenType: typeof b.token_type === "string" ? b.token_type : "bearer",
    expiresAt: typeof b.expires_in === "number" ? new Date(now.getTime() + b.expires_in * 1000) : null,
    refreshExpiresAt: typeof b.refresh_token_expires_in === "number" ? new Date(now.getTime() + b.refresh_token_expires_in * 1000) : null,
    scopes: googleScopes(b.scope),
  };
}

export const adapter: ProviderAdapter = {
  id: "google_calendar",
  category: "calendar",
  kinds: ["personal"],
  hosts: ["www.googleapis.com", "oauth2.googleapis.com"],
  linkHosts: ["calendar.google.com", "www.google.com", "meet.google.com"],
  env: ENV,
  configured: (e) => envAll(ENV, e ?? process.env),
  oauth: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    clientId: () => env("GOOGLE_CALENDAR_CLIENT_ID"),
    clientSecret: () => env("GOOGLE_CALENDAR_CLIENT_SECRET"),
    // Google still wants the secret from web clients alongside PKCE (spec §2).
    clientAuth: "body",
    tokenBody: "form",
    pkce: "S256",
    scopeSeparator: " ",
    scopes: ({ act }) => [...(act ? GOOGLE_SCOPES.act : GOOGLE_SCOPES.read)],
    authorizeParams: (c) => ({ access_type: "offline", include_granted_scopes: "true", prompt: "consent", nonce: c.nonce }),
    parseToken: parseGoogleToken,
    refresh: "reusable",
  },
  async identify({ http, tokens }) {
    let claims = (tokens.facts?.idTokenClaims ?? null) as Record<string, unknown> | null;
    if (!claims || typeof claims.sub !== "string") {
      // No id_token (it is checked by the framework when there is one): Google's own userinfo with the fresh token.
      claims = (await http.request<Record<string, unknown>>({ url: "https://www.googleapis.com/oauth2/v3/userinfo" })).body;
    }
    const sub = typeof claims?.sub === "string" ? claims.sub : "";
    const email = typeof claims?.email === "string" ? claims.email : null;
    if (!sub) throw new ConnectorError("BAD_RESPONSE", "google: no account id");
    return { externalAccountId: sub, externalTenantId: null, accountLabel: email ?? "Google Calendar", identity: { externalUserId: sub, email } };
  },
  ownerBound: false,
  workspaceActs: false,
  streams: [
    { name: "events", kinds: ["event"], every: { workingMinutes: 10, offMinutes: 60 }, perRun: { pages: 3, items: 750, ms: 15_000 }, fullEveryMinutes: 10 },
  ],
  async sync({ conn, http, now, timeZone, sink, deadline }) {
    if (conn.kind !== "personal") return { cursor: null, more: false };
    const { from, to } = calendarWindow(now, timeZone);
    const seen: string[] = [];
    const gone: string[] = [];
    let pageToken: string | undefined;
    let pages = 0;
    let complete = false;
    let lastStart: string | null = null;
    for (;;) {
      const r = await http.request<{ items?: GoogleEvent[]; nextPageToken?: string }>({
        url: EVENTS,
        query: { timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: true, orderBy: "startTime", maxResults: 250, fields: LIST_FIELDS, pageToken },
      });
      pages++;
      const items: NormalisedItem[] = [];
      for (const e of r.body?.items ?? []) {
        const it = googleEventItem(e, timeZone);
        if (it === "gone") { gone.push(e.id); continue; }
        if (!it) continue;
        items.push(it);
        seen.push(it.externalId);
        lastStart = it.startsAt ?? lastStart;
      }
      if (items.length) await sink.upsert(items);
      pageToken = typeof r.body?.nextPageToken === "string" ? r.body.nextPageToken : undefined;
      if (!pageToken) { complete = true; break; }
      if (pages >= 3 || seen.length >= 750 || Date.now() > deadline) break;
    }
    if (gone.length) await sink.gone("event", gone);
    // A windowed re-list (§6). Cut short, only the part before the last start seen is known to be complete.
    if (complete) await sink.reconcileWindow("event", from, to, seen);
    else if (lastStart && Date.parse(lastStart) > from.getTime()) await sink.reconcileWindow("event", from, new Date(lastStart), seen);
    return { cursor: null, more: false };
  },
  async fetchItem({ http, kind, externalId }) {
    if (kind !== "event") return null;
    try {
      // All-day dates read as UTC here (no zone to hand); the next windowed sync writes them in the person's zone.
      const it = googleEventItem(await getEvent(http, externalId), "UTC");
      return it && it !== "gone" ? it : null;
    } catch (err) {
      if (err instanceof ConnectorError && err.code === "NOT_FOUND") return null;
      throw err;
    }
  },
  actions: calendarActions(googleOps),
  interpret: interpretGoogle,
  async revoke({ http, tokens }) {
    await http.request({ method: "POST", url: "https://oauth2.googleapis.com/revoke", auth: "none", form: { token: tokens.refreshToken ?? tokens.accessToken }, expect: "none" });
  },
};

