/**
 * Calls in the browser (owner decisions, 8 October 2026: phase 8, calls): typed fetch helpers for the calls routes
 * (contract C.4) and the small pure rules the call screens share, kept here so they are unit-tested
 * (tests/unit/calls-client.test.ts) and never import `livekit-client` (only `call-engine.ts` does). Client-safe: no
 * server imports; the words come from `src/lib/calls.ts`.
 */
import { api, isApiFailure } from "@/lib/api-client";
import { PALETTE, type AssistantProfile } from "@/lib/assistant-look";
import { CALL_LIMITS, CALL_WORDS, type CallConnection, type CallHistoryList, type CallsNow, type CallView, type CallWhere, type LiveCallSummary } from "@/lib/calls";

// ---- The routes (contract C.4). Every mutation carries an Idempotency-Key (api() adds one). ----

export type StartAnswer = { call: CallView; existing: boolean; connection: CallConnection | null };
export type JoinAnswer = { call: CallView; connection: CallConnection };

export function callsApi(orgSlug: string) {
  const base = `/api/orgs/${encodeURIComponent(orgSlug)}/calls`;
  const post = <T>(path: string, body: unknown = {}) => api<T>(`${base}${path}`, { method: "POST", body });
  return {
    now: (signal?: AbortSignal) => api<CallsNow>(`${base}/now`, { signal }),
    history: (f: { filter?: "all" | "missed"; before?: string | null; limit?: number } = {}) => {
      const q = new URLSearchParams();
      if (f.filter === "missed") q.set("filter", "missed");
      if (f.before) q.set("before", f.before);
      if (f.limit) q.set("limit", String(f.limit));
      const qs = q.toString();
      return api<CallHistoryList>(`${base}${qs ? `?${qs}` : ""}`);
    },
    live: (conversationId?: string, signal?: AbortSignal) => api<{ live: LiveCallSummary[] }>(`${base}/live${conversationId ? `?conversation=${encodeURIComponent(conversationId)}` : ""}`, { signal }),
    view: (id: string, signal?: AbortSignal) => api<{ call: CallView }>(`${base}/${id}`, { signal }),
    start: (input: { conversationId: string } | { to: string }) => post<StartAnswer>("", input),
    join: (id: string, o: { leaveOther?: boolean } = {}) => post<JoinAnswer>(`/${id}/join`, { leaveOther: o.leaveOther === true }),
    accept: (id: string, o: { leaveOther?: boolean } = {}) => post<{ call: CallView }>(`/${id}/accept`, { leaveOther: o.leaveOther === true }),
    decline: (id: string, message?: string | null) => post<{ call: CallView; messageId: string | null }>(`/${id}/decline`, { message: message?.trim() ? message.trim() : null }),
    leave: (id: string) => post<{ call: CallView }>(`/${id}/leave`),
    end: (id: string) => post<{ call: CallView }>(`/${id}/end`),
    // A heartbeat is cheap and frequent: no retries (the next one comes in 15 s).
    heartbeat: (id: string) => api<{ state: "ok" | "left" | "ended" }>(`${base}/${id}/heartbeat`, { method: "POST", body: {}, retries: 0 }),
  };
}
export type CallsApi = ReturnType<typeof callsApi>;

/** The calls tables whose changes the call components refetch on (contract C.8). */
export const CALL_EVENT_TABLES: ReadonlySet<string> = new Set(["calls", "call_participants", "call_note_consents"]);

/** What a failed call request says to the person: the contract's words by code, else the server's own message. */
export function callErrorWords(err: unknown): string {
  if (isApiFailure(err)) {
    const e = err.error;
    switch (e.code) {
      case "NOT_READY": return CALL_WORDS.notReady;
      case "CALLS_NOT_CONFIGURED": return CALL_WORDS.notConfigured;
      case "NOT_FOUND": return CALL_WORDS.errors.notFound;
      case "CALL_ENDED": return CALL_WORDS.errors.ended;
      case "CALL_FULL": return CALL_WORDS.errors.full;
      case "CALL_NOT_HERE": return CALL_WORDS.errors.notHere;
      case "IN_ANOTHER_CALL": return CALL_WORDS.errors.inAnotherCall;
      case "ALREADY_ANSWERED": return CALL_WORDS.errors.answered;
      default: return e.message || "That didn't go through. Try again.";
    }
  }
  return "Can't reach the server. Check your connection and try again.";
}
/** A 409 IN_ANOTHER_CALL's other call, when the server named it (details `{ callId, where }`). */
export function otherCallOf(err: unknown): { callId: string; where: CallWhere | null } | null {
  if (!isApiFailure(err) || err.error.code !== "IN_ANOTHER_CALL") return null;
  const d = err.error.details as { callId?: unknown; where?: unknown } | undefined;
  return typeof d?.callId === "string" ? { callId: d.callId, where: (d.where as CallWhere | undefined) ?? null } : null;
}
export const isNotFoundOrGone = (err: unknown) => isApiFailure(err) && (err.error.status === 401 || err.error.status === 404);

// ---- Pure rules (unit-tested) ----

/**
 * The tiles' grid (contract D.6): 1 fills; 2 side by side (stacked on a phone); 3–4 two by two; 5–9 three by three;
 * more: 9 a page with ‹ ›. `narrow` is a screen 640px wide or less.
 */
export function gridShape(count: number, narrow = false): { cols: number; rows: number; perPage: number; pages: number } {
  const n = Math.max(1, Math.floor(count));
  if (n === 1) return { cols: 1, rows: 1, perPage: 1, pages: 1 };
  if (n === 2) return narrow ? { cols: 1, rows: 2, perPage: 2, pages: 1 } : { cols: 2, rows: 1, perPage: 2, pages: 1 };
  if (n <= 4) return { cols: 2, rows: 2, perPage: 4, pages: 1 };
  if (n <= 9) return { cols: 3, rows: 3, perPage: 9, pages: 1 };
  return { cols: 3, rows: 3, perPage: 9, pages: Math.ceil(n / 9) };
}

/** The tiles on one page of the grid (0-based page, clamped). */
export function pageOf<T>(items: readonly T[], page: number, perPage: number): { items: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(items.length / perPage));
  const p = Math.min(Math.max(0, Math.floor(page)), pages - 1);
  return { items: items.slice(p * perPage, p * perPage + perPage), page: p, pages };
}

/**
 * Where the incoming-call card goes (contract D.4): the top-right corner under the top bar on a wide screen, the bottom
 * edge on a phone (640px or less); inside the open modal dialog when there is one, so it stays clickable (everything
 * outside a modal dialog is inert).
 */
export function overlayPlacement(viewportWidth: number, dialogOpen: boolean): { edge: "corner" | "bottom"; host: "dialog" | "body" } {
  return { edge: viewportWidth <= 640 ? "bottom" : "corner", host: dialogOpen ? "dialog" : "body" };
}

/** The localStorage key every tab stamps while it is visible: `{ tab, at }` (contract D.3). */
export const LAST_VISIBLE_KEY = "boredroom-last-visible";
export type VisibleStamp = { tab: string; at: number };
/** A visible tab refreshes its stamp this often; a stamp older than `staleMs` means no tab is in view any more. */
export const STAMP_EVERY_MS = 2_000;
const STAMP_STALE_MS = 60_000;

export function readStamp(raw: string | null): VisibleStamp | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<VisibleStamp> | number | null;
    // An older build wrote only a number (Date.now()): nobody owns it.
    if (typeof v === "number") return Number.isFinite(v) ? { tab: "", at: v } : null;
    if (!v || typeof v !== "object") return null;
    return typeof v.tab === "string" && typeof v.at === "number" && Number.isFinite(v.at) ? { tab: v.tab, at: v.at } : null;
  } catch { return null; }
}

/**
 * Which tab rings (contract D.3): the tab in view always does; with none in view, the tab most recently in view (its own
 * stamp); and when that stamp is long stale (its tab was closed) or missing, any tab, so a ring is never lost. A tab in
 * view refreshes the stamp every 2 s, so a hidden tab never rings alongside a visible one.
 */
export function shouldThisTabRing(o: { visible: boolean; tab: string; stamp: VisibleStamp | null; now: number }): boolean {
  if (o.visible) return true;
  if (!o.stamp) return true;
  if (o.stamp.tab === o.tab) return true;
  return o.now - o.stamp.at > STAMP_STALE_MS;
}

/** The ring sound repeats every 2.5 s for at most the ring's 30 s (contract D.3). */
export const RING_EVERY_MS = 2_500;
export function ringStillDue(rangAt: string, now: number, skewMs = 0): boolean {
  const at = Date.parse(rangAt);
  return Number.isFinite(at) && now + skewMs < at + CALL_LIMITS.ringMs;
}

/**
 * The 2px ring around a person's face in calls (owner default, 8 October 2026): their assistant's colour, the sphere's
 * middle shade; White uses its rim, so the ring still shows on a light canvas.
 */
export function assistantRingColour(a: Pick<AssistantProfile, "colour"> | null | undefined): string {
  const p = PALETTE[a?.colour ?? "white"] ?? PALETTE.white;
  return a?.colour === "white" || !a ? p.sphere.rim : p.sphere.mid;
}

/** Seconds a call has run, on the server's clock (`skewMs` = server − this device), from its answer (or its start). */
export function callElapsedSeconds(from: string | null, now: number, skewMs = 0): number {
  if (!from) return 0;
  const at = Date.parse(from);
  return Number.isFinite(at) ? Math.max(0, Math.floor((now + skewMs - at) / 1000)) : 0;
}
export const skewOf = (serverNow: string | null | undefined, localNow: number) => {
  const s = serverNow ? Date.parse(serverNow) : NaN;
  return Number.isFinite(s) ? s - localNow : 0;
};

/** "Call with Ada" / "#Design call" (a stage title); "On a call with Ada" / "On a call in #Design" (the dock). */
export function callTitle(where: CallWhere): string {
  if (!where.name) return "Call";
  return where.kind === "direct" ? `Call with ${where.name}` : `${where.name} call`;
}
export function onCallWith(where: CallWhere): string {
  if (!where.name) return "On a call";
  return where.kind === "direct" ? `On a call with ${where.name}` : `On a call in ${where.name}`;
}

/** "Today, 14:05", "Yesterday, 09:30", "Mon 6 Oct, 16:20" (commas, never middle dots), in the given time zone. */
export function callWhen(iso: string, now: Date = new Date(), timeZone?: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const day = (x: Date) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(x);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" }).format(d);
  if (day(d) === day(now)) return `Today, ${time}`;
  if (day(d) === day(new Date(now.getTime() - 86_400_000))) return `Yesterday, ${time}`;
  const date = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", day: "numeric", month: "short" }).format(d).replace(",", "");
  return `${date}, ${time}`;
}

/**
 * When a live call started, for "Started …" mid-sentence (fix review, 10 October 2026): "14:05" today, "yesterday, 23:50",
 * "Mon 6 Oct, 16:20", in the organisation's time zone, so the server's and the browser's words agree.
 */
export function startedWhen(iso: string, now: Date = new Date(), timeZone?: string): string {
  const w = callWhen(iso, now, timeZone);
  return w.replace(/^Today, /, "").replace(/^Yesterday, /, "yesterday, ");
}

/** A tile's accessible name: "Ada, microphone off, camera off, speaking" (contract D.6). */
export function tileLabel(o: { name: string; you?: boolean; micOn: boolean; cameraOn: boolean; speaking?: boolean; sharing?: boolean }): string {
  const parts = [o.you ? `${o.name} (you)` : o.name, o.micOn ? "microphone on" : "microphone off", o.cameraOn ? "camera on" : "camera off"];
  if (o.sharing) parts.push("sharing their screen");
  if (o.speaking) parts.push("speaking");
  return parts.join(", ");
}

/** The three connection bars: how many are lit and the words for screen readers. */
export function qualityBars(q: string | null | undefined): { lit: 0 | 1 | 2 | 3; words: string } {
  switch (q) {
    case "excellent": return { lit: 3, words: CALL_WORDS.quality.excellent };
    case "good": return { lit: 2, words: CALL_WORDS.quality.good };
    case "poor": return { lit: 1, words: CALL_WORDS.quality.poor };
    case "lost": return { lit: 0, words: CALL_WORDS.quality.lost };
    default: return { lit: 0, words: CALL_WORDS.quality.unknown };
  }
}

/**
 * Whether Esc silences the ring (fix review, 10 October 2026: it was caught on the whole page, so closing a menu or a
 * dialog silenced the call too, with nothing on the card to say so). Always when pressed in the incoming card; anywhere
 * else only when nothing else is open (a dialog, a sheet, a menu, a popover), no field has the focus and nothing took
 * the key first. It never declines.
 */
export function escSilencesRing(o: { defaultPrevented: boolean; inCard: boolean; openElsewhere: boolean; editable: boolean }): boolean {
  if (o.inCard) return true;
  return !o.defaultPrevented && !o.openElsewhere && !o.editable;
}

/**
 * The incoming card's keyboard shortcut, Alt+Shift+A (Option+Shift+A on a Mac): it moves the focus to Accept, never
 * presses it (fix review, 10 October 2026: the card never takes the focus, so a keyboard or screen-reader user had to
 * Tab through the whole page within 30 seconds). Matched by the key's position (`code`), so the Mac's "Å" and other
 * layouts count.
 */
export function isRingShortcut(e: { altKey: boolean; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; code?: string; key?: string }): boolean {
  return e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && (e.code === "KeyA" || e.key === "A" || e.key === "a");
}

/** The quick-message counter shows from 240 characters of the 280 (contract D.4). */
export function messageCounter(text: string): string | null {
  const n = text.length;
  return n >= 240 ? `${n} of ${CALL_LIMITS.declineMessageMax}` : null;
}

/** The ring card's second line: "Call" / "Call in #Design", and the waiting line when already on a call. */
export function ringLines(r: { kind: "direct" | "group"; where: CallWhere; inAnotherCall: boolean }): string[] {
  const head = r.kind === "direct" || !r.where.name ? CALL_WORDS.incoming.direct : CALL_WORDS.incoming.group(r.where.name);
  return r.inAnotherCall ? [head, CALL_WORDS.incoming.waiting] : [head];
}
