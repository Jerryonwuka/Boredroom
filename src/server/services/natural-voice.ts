/**
 * Natural voice (owner decision, 9 October 2026: natural voice (ElevenLabs), "use your recommendations"). Each person may
 * pick one of eight ElevenLabs voices for their own assistant (lib/natural-voices); the default stays the computer's own
 * voice. This file is the server's whole side of it:
 *
 * - Keys (contract B): the workspace's own ElevenLabs key first (entered by owners or HR in Settings, tested with one free
 *   request, stored encrypted in `organisation_voice_secrets`), else Boredroom's key (`ELEVENLABS_API_KEY`), exactly as
 *   the Claude key works (services/assistant `resolveAssistant`).
 * - The person's choice (B.4): `assistant_profiles.natural_voice`, saved as the person.
 * - Caps (C.3): characters are counted per person per day (the organisation's day) per key in `voice_usage_daily`. A
 *   person may say PERSON_DAILY_CHARS a day; a key's daily share is what is left of its monthly allowance (credits,
 *   turned into characters: TTS_CREDITS_PER_CHARACTER) divided by the days left (GET /v1/user/subscription, cached for 10
 *   minutes and never across the day's end, C.4); a workspace on Boredroom's key gets a slice of it
 *   (BOREDROOM_KEY_WORKSPACE_FRACTION, at most BOREDROOM_KEY_WORKSPACE_DAILY_MAX), so one workspace can never use up
 *   every other's day (review, 9 October 2026). A cap is reached once the day's count meets it: the utterance that
 *   crosses it is said whole (at most SPEECH_MAX_CHARS over), so a reply is never refused for being longer than what is
 *   left, and "used today's natural voice" is always true (fix review, 9 October 2026). Under 10% of the allowance left,
 *   nobody's natural voice is used.
 * - A failure breaker (C.5): a rejected key, a used-up allowance or ElevenLabs being down is remembered for a while, so
 *   the speech route answers at once and the assistant speaks with the computer voice.
 * - The speech token (D): a reply carries `speech: { path, token, text }` only when its person has a natural voice; the
 *   token is signed, bound to the person, the workspace and a hash of exactly those words, so the speech route only ever
 *   says what the person's own assistant said to them, never arbitrary text.
 * - The speech route's work (E.1) and the free voice samples (E.2), cached in this process.
 * - ElevenLabs' History (review, 9 October 2026): ElevenLabs keeps every generation, words and audio, in the History of
 *   the account that owns the key, where its holder (a workspace's owner or HR, or Boredroom) could read what everyone's
 *   assistant said. Once an utterance's stream is over, it is deleted from there (`forgetSpoken`), only ever by an id
 *   ElevenLabs gave for that request: a few quick tries in this process, and a job in the database (ids only, never the
 *   words) that the worker runs if those did not succeed, so a restart loses nothing. What cannot be deleted (no id, no
 *   History access for a day, ElevenLabs failing) is counted for the workspace's owners and HR (fix review, 9 October
 *   2026).
 *
 * Before migration 0053 (server/lib/schema-0053) nobody has a natural voice (`not_ready`), replies carry no offer, the
 * speech route answers 409 and saves answer 503 NOT_READY; nothing throws.
 *
 * Never logged and never stored: the key (encrypted at rest only), the words, the token, the audio. Errors from here are
 * AppErrors with fixed words, so `errorResponse` never logs a raw error carrying any of them.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { batchIn, getPool, withSystem, withUser, type Db } from "@/server/db";
import type { OrgContext } from "@/server/lib/api";
import { AppError, forbidden, invalid, notFound, rateLimited } from "@/server/lib/errors";
import { decryptSecret, encryptSecret, signPayload, verifyPayload } from "@/server/lib/crypto";
import { SCHEMA_0053_CHECK, forget0053, isMissingSchema, noteSchema0053, retryWithout0053, schema0053Known, schema0053Ready } from "@/server/lib/schema-0053";
import { SCHEMA_0050_CHECK, forget0050, noteSchema0050, schema0050Known } from "@/server/lib/schema-0050";
import { todayLocal } from "@/server/lib/time";
import { audit } from "@/server/services/common";
import {
  ElevenLabsError, TTS_CREDITS_PER_CHARACTER, deleteHistoryItem, fetchPreview, findHistoryItem, getSubscription, getVoicePreviewUrl, isAbort,
  streamSpeech, type ElevenLabsErrorKind, type SpeechRef, type Subscription,
} from "@/server/services/elevenlabs";
import {
  NATURAL_VOICES, SPEECH_MAX_CHARS, SPEECH_SPEEDS, isNaturalVoiceId, speechText,
  type NaturalVoiceReason, type NaturalVoiceView, type SpeechOffer, type VoiceConnectionStatus,
} from "@/lib/natural-voices";

export { speechText };

// ---- Caps (contract C.3) ------------------------------------------------------------------------------------------------

/** Per person per organisation-local day: about two minutes of speech. */
export const PERSON_DAILY_CHARS = 2000;
/** Per workspace per day while it uses Boredroom's key (its slice of the key's share may be smaller). */
export const BOREDROOM_KEY_WORKSPACE_DAILY_MAX = 2000;
/**
 * A workspace on Boredroom's key gets this much of the key's daily share, so at least four workspaces each have a
 * whole slice and one person cannot use up every workspace's day (review, 9 October 2026; on the Starter plan, about
 * 600 characters a day of Flash: a workspace that needs more adds its own key).
 */
export const BOREDROOM_KEY_WORKSPACE_FRACTION = 0.25;
/** Under 10% of the month's allowance left: nobody's natural voice is used until it resets. */
export const LOW_ALLOWANCE = 0.1;
/** The most audio one utterance may stream (600 characters of Flash MP3 at 64 kbps is far smaller). */
export const AUDIO_MAX_BYTES = 2_000_000;
export const AUDIO_MAX_MS = 60_000;

const DAY_MS = 86_400_000;
const NOT_READY_WORDS = "Natural voices need a database update first. Try again later.";
const IMPERSONATED = "Only the person can change their assistant. It stays as it is while someone else is signed in as them.";

/** Days until the allowance resets, at least 1; without a reset date, days to the end of the UTC month. */
export function daysLeft(resetAt: string | null, now = new Date()): number {
  const reset = resetAt ? Date.parse(resetAt) : NaN;
  const end = Number.isFinite(reset) ? reset : Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  return Math.max(1, Math.ceil((end - now.getTime()) / DAY_MS));
}

/**
 * Today's share of a key, in characters: what was left when the subscription was read (credits, as characters of
 * TTS_MODEL), plus the characters we had already counted today at that moment (so the share does not shrink through the
 * day as the 10-minute-old subscription catches up), over the days left. The subscription counts credits, not
 * characters (fix review, 9 October 2026): both sides of every comparison here are characters.
 */
export function dailyShare(s: { used: number; limit: number; resetAt: string | null; keyTodayAtFetch: number }, now = new Date()): number {
  const remaining = Math.max(0, s.limit - s.used) / TTS_CREDITS_PER_CHARACTER;
  return Math.max(0, Math.floor((remaining + Math.max(0, s.keyTodayAtFetch)) / daysLeft(s.resetAt, now)));
}

/** Under 10% of the allowance left (a key with no allowance at all is low too). */
export function allowanceLow(s: { used: number; limit: number }): boolean {
  if (!(s.limit > 0)) return true;
  return s.limit - s.used < s.limit * LOW_ALLOWANCE;
}

/** The workspace's cap today: its own key's share, or on Boredroom's key its slice of the key's share (at most BOREDROOM_KEY_WORKSPACE_DAILY_MAX). */
export function workspaceCap(source: VoiceKeySource, share: number): number {
  return source === "environment" ? Math.min(Math.floor(Math.max(0, share) * BOREDROOM_KEY_WORKSPACE_FRACTION), BOREDROOM_KEY_WORKSPACE_DAILY_MAX) : share;
}

export type UsageTotals = { personToday: number; workspaceToday: number; keyToday: number };

/**
 * Why one more utterance is refused today (null: allowed). A cap is reached once the day's count meets it; the utterance
 * that crosses it is said whole, so the most a day can go over is one utterance (SPEECH_MAX_CHARS), and a reply is never
 * refused for being longer than what is left of a slice (a whole slice can be smaller than one reply: fix review, 9
 * October 2026). So a refusal's words ("used today's natural voice") are always true, and Settings' view, which asks the
 * same question, never says available while the next reply would be refused for a cap. On Boredroom's key the key's
 * whole share, used up by every workspace together, is `shared_cap`, so a workspace is never told it used what others
 * did; on a workspace's own key the key's share is the workspace's cap.
 */
export function reservationProblem(t: UsageTotals & { low: boolean; share: number; source: VoiceKeySource }): NaturalVoiceReason | null {
  if (t.low) return "allowance_low";
  if (t.personToday >= PERSON_DAILY_CHARS) return "person_cap";
  if (t.workspaceToday >= workspaceCap(t.source, t.share)) return "workspace_cap";
  if (t.keyToday >= t.share) return t.source === "environment" ? "shared_cap" : "workspace_cap";
  return null;
}

/** What `naturalVoiceView` weighs, in the order of contract C.5. */
export type ReasonInput = {
  ready: boolean; voiceOff: boolean; chosen: string | null; key: boolean; held: NaturalVoiceReason | null;
  subscription: "ok" | "upstream" | "key_rejected"; low: boolean; personFull: boolean; workspaceFull: boolean;
  /** Boredroom's key only: the key's share for today is used up by every workspace together. */
  sharedFull?: boolean;
};

/** The first reason that applies (C.5); null with no voice chosen (nothing to explain) or when the natural voice is available. */
export function naturalVoiceReason(i: ReasonInput): NaturalVoiceReason | null {
  if (!i.ready) return "not_ready";
  if (i.voiceOff) return "voice_off";
  if (!i.chosen) return null;
  if (!i.key) return "no_key";
  if (i.held) return i.held;
  if (i.subscription !== "ok") return i.subscription;
  if (i.low) return "allowance_low";
  if (i.personFull) return "person_cap";
  if (i.workspaceFull) return "workspace_cap";
  if (i.sharedFull) return "shared_cap";
  return null;
}

// ---- Keys (contract B.2) ------------------------------------------------------------------------------------------------

export type VoiceKeySource = "organisation" | "environment";
/** `keyRef` names the key for the caches and the lock ("env" or "org:<orgId>"), never the key itself. */
export type VoiceKey = { apiKey: string; source: VoiceKeySource; keyRef: string };

const envKey = () => process.env.ELEVENLABS_API_KEY?.trim() || null;
const keyHashOf = (apiKey: string) => createHash("sha256").update(apiKey).digest("hex").slice(0, 16);

/** Reads that tolerate a database without 0053 (null then). */
async function read0053<T>(fn: () => Promise<T | null>): Promise<T | null> {
  try {
    return await retryWithout0053(fn);
  } catch (err) {
    if (!isMissingSchema(err)) throw err;
    forget0053();
    return null;
  }
}

/** The workspace's own key (before 0053: none), else Boredroom's, else null (`no_key`). */
export async function resolveVoiceKey(orgId: string): Promise<VoiceKey | null> {
  const enc = await read0053(() => withSystem(async (db) => {
    if (!(await schema0053Ready(db))) return null;
    const r = await db.maybeOne<{ key_enc: string }>(`SELECT key_enc FROM organisation_voice_secrets WHERE organisation_id = $1`, [orgId]);
    return r?.key_enc ?? null;
  }));
  return keyOf(orgId, enc);
}

/** The key from the workspace's stored (encrypted) key, if any, else Boredroom's, else null. */
function keyOf(orgId: string, enc: string | null): VoiceKey | null {
  const own = enc ? decryptSecret(enc) : null;
  if (own) return { apiKey: own, source: "organisation", keyRef: `org:${orgId}` };
  const env = envKey();
  return env ? { apiKey: env, source: "environment", keyRef: "env" } : null;
}

// ---- Subscription cache (C.4) and the failure breaker (C.5), in this process -----------------------------------------------

/**
 * `stamp`: the day `keyTodayAtFetch` was counted in (subStamp). An entry from another day, or from before the key's
 * reset, is not served as fresh: its count is yesterday's, and would swell today's share (fix review, 9 October 2026).
 */
type SubEntry = Subscription & { fetchedAt: number; keyTodayAtFetch: number; keyHash: string; stamp: string };
type SubResult = { ok: true; sub: SubEntry } | { ok: false; reason: "upstream" | "key_rejected" };
type Held = { reason: "key_rejected" | "allowance_low" | "upstream"; until: number };

const FRESH_MS = 10 * 60_000;
const STALE_MS = 60 * 60_000;
const HOLD_LONG_MS = 10 * 60_000;
const HOLD_SHORT_MS = 60_000;
const RECENT_MS = 15 * 60_000;

const subs = new Map<string, SubEntry>();
/**
 * Keys ElevenLabs would not let us delete History items with (no History access), until this time; by keyRef and the
 * key's hash, so an old key's answer never blocks the key that replaced it (fix review, 9 October 2026).
 */
const historyBlocked = new Map<string, number>();
/** Deletions waiting for their next try (cleared by the tests). */
const historyTimers = new Set<ReturnType<typeof setTimeout>>();
const subFlights = new Map<string, Promise<SubEntry>>();
const held = new Map<string, Held>();
const lastFailure = new Map<string, number>();

/** Remembers a failure: a rejected key or a used-up allowance for 10 minutes, ElevenLabs being down for a minute. */
function trip(key: VoiceKey, kind: ElevenLabsErrorKind | "other"): void {
  const now = Date.now();
  if (kind === "bad_request") return; // our request, not ElevenLabs' state
  // Too many at once on Boredroom's key is one moment's crowding, and anyone can cause it (a reply's token replayed in
  // parallel): it never holds every workspace's natural voice (review, 9 October 2026). On a workspace's own key it does.
  if (kind === "busy" && key.source === "environment") return;
  if (kind === "quota") { held.set(key.keyRef, { reason: "allowance_low", until: now + HOLD_LONG_MS }); return; }
  if (kind === "key_rejected" || kind === "missing_permissions") {
    // People cannot fix Boredroom's key: for them it is ElevenLabs not answering.
    held.set(key.keyRef, { reason: key.source === "organisation" ? "key_rejected" : "upstream", until: now + HOLD_LONG_MS });
    return;
  }
  held.set(key.keyRef, { reason: "upstream", until: now + HOLD_SHORT_MS });
  lastFailure.set(key.keyRef, now);
}

function heldReason(keyRef: string, now = Date.now()): Held["reason"] | null {
  const h = held.get(keyRef);
  if (!h) return null;
  if (h.until > now) return h.reason;
  held.delete(keyRef);
  return null;
}

/** For Settings only: ElevenLabs failed in the last 15 minutes, so the person's assistant may just have used the computer voice. */
function recentlyFailed(keyRef: string, now = Date.now()): boolean {
  const at = lastFailure.get(keyRef);
  return at !== undefined && now - at < RECENT_MS;
}

/** A replaced or removed key starts afresh. */
function forgetKey(keyRef: string): void {
  subs.delete(keyRef);
  held.delete(keyRef);
  lastFailure.delete(keyRef);
  for (const k of [...historyBlocked.keys()]) if (k.startsWith(`${keyRef}:`)) historyBlocked.delete(k);
}

/** Clears every cache and the breaker (tests only). */
export function resetNaturalVoiceForTests(): void {
  subs.clear();
  subFlights.clear();
  held.clear();
  lastFailure.clear();
  samples.clear();
  sampleFlights.clear();
  historyBlocked.clear();
  for (const t of historyTimers) clearTimeout(t);
  historyTimers.clear();
}

const rejectedReason = (key: VoiceKey, kind: ElevenLabsErrorKind | "other"): "upstream" | "key_rejected" =>
  key.source === "organisation" && (kind === "key_rejected" || kind === "missing_permissions") ? "key_rejected" : "upstream";

/**
 * The day a key's count belongs to, for the subscription cache: a workspace's own key counts in the workspace's day;
 * Boredroom's key counts each workspace in its own day, so its stamp is the UTC quarter-hour (every time zone's midnight
 * falls on one), and an entry never outlives a workspace's midnight.
 */
function subStamp(key: VoiceKey, timeZone: string, now = Date.now()): string {
  return key.source === "organisation" ? todayLocal(timeZone) : `q${Math.floor(now / 900_000)}`;
}

/** subStamp as of `at`, with the workspace's day `today` read at the same moment (both before the totals they go with). */
const stampAt = (key: VoiceKey, today: string, at: number) => (key.source === "organisation" ? today : `q${Math.floor(at / 900_000)}`);

/** An entry counted in this day, from before nothing reset since. */
const sameDay = (e: SubEntry, stamp: string, now: number) => e.stamp === stamp && !(e.resetAt && Date.parse(e.resetAt) <= now);
/** A stale entry served while ElevenLabs does not answer: from another day, without that day's count. */
const servedStale = (e: SubEntry, stamp: string, now: number): SubEntry => (sameDay(e, stamp, now) ? e : { ...e, keyTodayAtFetch: 0 });

/**
 * The key's subscription without waiting, or null when it must be read first. Fresh for 10 minutes within the same day
 * (subStamp) and before the reset. While the breaker holds a rejected key or an outage, nothing is asked, and a stale one
 * is served for up to an hour (without another day's count).
 *
 * Stale while revalidating (review, 9 October 2026: the natural voice's latency on a slow link, where reading it took
 * 1.7–1.9 s at every process start, every 10 minutes and, on Boredroom's key, every UTC quarter-hour): an entry for this
 * key up to an hour old, from before the key's reset, is served at once and read again in the background. One from
 * another day (subStamp) is served without that day's count (`keyTodayAtFetch: 0`, servedStale): it only makes the share
 * smaller, so it errs safe. Its allowance figures are at most one request older than before; every cap is still reserved
 * under the key's lock before ElevenLabs is asked, and ElevenLabs refuses what the allowance does not cover. With no entry
 * at all (a new process, a new key), after the reset or over an hour old, the caller waits for the read (subscriptionFor).
 *
 * `keyToday`: the characters counted on the key today, read before the request (the count must not include what is
 * reserved after the subscription was read, or the share would grow by it).
 */
function subscriptionNow(key: VoiceKey, stamp: string, keyToday: number | (() => Promise<number>)): SubResult | null {
  const now = Date.now();
  const hash = keyHashOf(key.apiKey);
  const hit = subs.get(key.keyRef);
  const mine = hit && hit.keyHash === hash ? hit : null;
  if (mine && now - mine.fetchedAt < FRESH_MS && sameDay(mine, stamp, now)) return { ok: true, sub: mine };
  const hold = heldReason(key.keyRef, now);
  if (hold === "upstream" || hold === "key_rejected") {
    if (mine && now - mine.fetchedAt < STALE_MS) return { ok: true, sub: servedStale(mine, stamp, now) };
    return { ok: false, reason: hold };
  }
  if (mine && now - mine.fetchedAt < STALE_MS && !(mine.resetAt && Date.parse(mine.resetAt) <= now)) {
    void readSubscription(key, hash, stamp, keyToday).catch(() => undefined);
    return { ok: true, sub: servedStale(mine, stamp, now) };
  }
  return null;
}

/**
 * Reads the key's subscription (concurrent reads of the same key, day and key share one request) and keeps it. A
 * failure trips the breaker, whoever waits for it (a request, or nobody: a background read).
 */
function readSubscription(key: VoiceKey, hash: string, stamp: string, keyToday: number | (() => Promise<number>)): Promise<SubEntry> {
  const flightKey = `${key.keyRef}:${hash}:${stamp}`;
  let flight = subFlights.get(flightKey);
  if (!flight) {
    flight = (async () => {
      const today = typeof keyToday === "number" ? keyToday : await keyToday();
      let s: Subscription;
      try {
        s = await getSubscription(key.apiKey);
      } catch (err) {
        const kind = err instanceof ElevenLabsError ? err.kind : "other";
        trip(key, kind === "quota" ? "upstream" : kind);
        throw err;
      }
      const entry: SubEntry = { ...s, fetchedAt: Date.now(), keyTodayAtFetch: today, keyHash: hash, stamp };
      subs.set(key.keyRef, entry);
      return entry;
    })().finally(() => subFlights.delete(flightKey));
    subFlights.set(flightKey, flight);
  }
  return flight;
}

/** The key's subscription: at once when subscriptionNow has it, else after reading it (a stale one while ElevenLabs does not answer). */
async function subscriptionFor(key: VoiceKey, stamp: string, keyToday: number | (() => Promise<number>)): Promise<SubResult> {
  return subscriptionNow(key, stamp, keyToday) ?? subscriptionOf(key, stamp, readSubscription(key, keyHashOf(key.apiKey), stamp, keyToday));
}

/** A read of the key's subscription (`flight`, from readSubscription), as subscriptionFor answers it. */
async function subscriptionOf(key: VoiceKey, stamp: string, flight: Promise<SubEntry>): Promise<SubResult> {
  const now = Date.now();
  const hit = subs.get(key.keyRef);
  const mine = hit && hit.keyHash === keyHashOf(key.apiKey) ? hit : null;
  try {
    return { ok: true, sub: await flight };
  } catch (err) {
    const kind = err instanceof ElevenLabsError ? err.kind : "other";
    if (mine && now - mine.fetchedAt < STALE_MS) return { ok: true, sub: servedStale(mine, stamp, now) };
    return { ok: false, reason: rejectedReason(key, kind) };
  }
}

/**
 * Reads the key's subscription ahead of a Listen when there is none to serve yet (a reply just carried an offer: review,
 * 9 October 2026), so the speech route rarely waits for ElevenLabs before its own request. Free (GET), never throws.
 */
function warmSubscription(key: VoiceKey, stamp: string, keyToday: number): void {
  if (subscriptionNow(key, stamp, keyToday)) return; // fresh, stale and being read again, or held
  void readSubscription(key, keyHashOf(key.apiKey), stamp, keyToday).catch(() => undefined);
}

// ---- Counting (C.3) -----------------------------------------------------------------------------------------------------

/** Characters said on this key today: the workspace's own key in the workspace's day; Boredroom's across every workspace, each in its own day. */
async function keyTodayIn(db: Db, key: VoiceKey, orgId: string, today: string): Promise<number> {
  if (key.source === "organisation") {
    const r = await db.one<{ n: number }>(
      `SELECT COALESCE(sum(characters), 0)::bigint AS n FROM voice_usage_daily WHERE organisation_id = $1 AND key_source = 'organisation' AND day = $2::date`, [orgId, today]);
    return Number(r.n);
  }
  const r = await db.one<{ n: number }>(
    `SELECT COALESCE(sum(u.characters), 0)::bigint AS n
       FROM voice_usage_daily u JOIN organisations o ON o.id = u.organisation_id
      WHERE u.key_source = 'environment' AND u.day BETWEEN current_date - 1 AND current_date + 1
        AND u.day = (now() AT TIME ZONE o.timezone)::date`);
  return Number(r.n);
}

async function totalsIn(db: Db, ctx: OrgContext, key: VoiceKey, today: string): Promise<UsageTotals> {
  const r = await db.one<{ person: number; workspace: number }>(
    `SELECT (SELECT COALESCE(sum(characters), 0)::bigint FROM voice_usage_daily WHERE membership_id = $1 AND day = $3::date) AS person,
            (SELECT COALESCE(sum(characters), 0)::bigint FROM voice_usage_daily WHERE organisation_id = $2 AND day = $3::date AND key_source = $4) AS workspace`,
    [ctx.membership.id, ctx.org.id, today, key.source]);
  const workspace = Number(r.workspace);
  return { personToday: Number(r.person), workspaceToday: workspace, keyToday: key.source === "organisation" ? workspace : await keyTodayIn(db, key, ctx.org.id, today) };
}

type KeyState =
  | { ok: true; sub: SubEntry; low: boolean; share: number; cap: number; totals: UsageTotals }
  | { ok: false; reason: "upstream" | "key_rejected"; totals: UsageTotals };

/** Today's totals (read here unless the caller read them already), the key's subscription, its share and whether the allowance is low. */
async function keyState(ctx: OrgContext, key: VoiceKey, read?: { totals: UsageTotals; stamp: string }): Promise<KeyState> {
  const today = todayLocal(ctx.org.timezone);
  // The stamp before the totals: a midnight in between makes the next read fetch again, never the other way round.
  const stamp = read?.stamp ?? subStamp(key, ctx.org.timezone);
  const totals = read?.totals ?? await withSystem((db) => totalsIn(db, ctx, key, today));
  return stateOf(key, totals, await subscriptionFor(key, stamp, totals.keyToday));
}

function stateOf(key: VoiceKey, totals: UsageTotals, s: SubResult): KeyState {
  if (!s.ok) return { ok: false, reason: s.reason, totals };
  const share = dailyShare(s.sub);
  return { ok: true, sub: s.sub, low: allowanceLow(s.sub), share, cap: workspaceCap(key.source, share), totals };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** The key's lock, as reserve always named it (`voice:` and the keyRef: "env" or "org:<uuid>"). */
const LOCK_RE = /^voice:(env|org:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
/** A value checked against `re` (or a whole number, at least 0), quoted for a statement sent without parameters. */
function inline(v: string | number, re?: RegExp): string {
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v) || v < 0) throw new Error("voice: not a whole number");
    return String(v);
  }
  if (!re || !re.test(v)) throw new Error("voice: unexpected value");
  return `'${v}'`;
}

/**
 * The reservation as statements for ONE round trip (batchIn): the key's lock, then one statement that reads the day's
 * totals, which (under READ COMMITTED) are as of a moment after the lock was granted, so every reservation that held the
 * lock before is counted, and inserts the characters only while every cap still has room (reservationProblem's rule:
 * a cap is reached once the day's count meets it). Its row: the totals, and whether it reserved. The lock is a statement
 * of its own on purpose: in the same statement as the totals, they could miss a reservation committed while it waited.
 * Every value is checked before it is inlined (no parameters in a multi-statement query).
 */
function reserveStatements(ctx: OrgContext, key: VoiceKey, n: number, day: string, limits: { share: number }): string[] {
  const org = inline(ctx.org.id, UUID_RE), member = inline(ctx.membership.id, UUID_RE), d = `${inline(day, DAY_RE)}::date`;
  const source = key.source === "organisation" ? "'organisation'" : "'environment'";
  const keyToday = key.source === "organisation"
    ? `(SELECT COALESCE(sum(characters), 0)::bigint FROM voice_usage_daily WHERE organisation_id = ${org} AND key_source = 'organisation' AND day = ${d})`
    : `(SELECT COALESCE(sum(u.characters), 0)::bigint FROM voice_usage_daily u JOIN organisations o ON o.id = u.organisation_id
         WHERE u.key_source = 'environment' AND u.day BETWEEN current_date - 1 AND current_date + 1 AND u.day = (now() AT TIME ZONE o.timezone)::date)`;
  return [
    `SELECT pg_advisory_xact_lock(hashtext(${inline(`voice:${key.keyRef}`, LOCK_RE)}))`,
    `WITH t AS (
       SELECT (SELECT COALESCE(sum(characters), 0)::bigint FROM voice_usage_daily WHERE membership_id = ${member} AND day = ${d}) AS person,
              (SELECT COALESCE(sum(characters), 0)::bigint FROM voice_usage_daily WHERE organisation_id = ${org} AND day = ${d} AND key_source = ${source}) AS workspace,
              ${keyToday} AS key_today
     ), ins AS (
       INSERT INTO voice_usage_daily(organisation_id, membership_id, day, key_source, characters, utterances, updated_at)
       SELECT ${org}::uuid, ${member}::uuid, ${d}, ${source}, ${inline(n)}, 1, now() FROM t
        WHERE t.person < ${inline(PERSON_DAILY_CHARS)} AND t.workspace < ${inline(workspaceCap(key.source, limits.share))} AND t.key_today < ${inline(limits.share)}
       ON CONFLICT (membership_id, day, key_source) DO UPDATE
         SET characters = voice_usage_daily.characters + EXCLUDED.characters, utterances = voice_usage_daily.utterances + 1, updated_at = now()
       RETURNING 1
     )
     SELECT t.person, t.workspace, t.key_today, (SELECT count(*) FROM ins)::int AS reserved FROM t`,
  ];
}

type Reservation = { ok: true; day: string } | { ok: false; reason: NaturalVoiceReason };

/**
 * Reserves `n` characters inside the caller's transaction: the key's lock, the day's totals and the insert in ONE round
 * trip, and with `commit` the COMMIT in it too (so concurrent requests, several tabs and the notch, never pass a cap
 * together: they wait for the lock, and read the totals once it is theirs). Or says why not.
 */
async function reserveIn(db: Db, ctx: OrgContext, key: VoiceKey, n: number, limits: { low: boolean; share: number }, opts: { commit: boolean }): Promise<Reservation> {
  if (limits.low) return { ok: false, reason: "allowance_low" };
  const day = todayLocal(ctx.org.timezone);
  const [, rows] = await batchIn(db, reserveStatements(ctx, key, n, day, limits), { commit: opts.commit });
  const r = rows[0] as { person: number; workspace: number; key_today: number; reserved: number };
  if (Number(r.reserved) > 0) return { ok: true, day };
  const totals = { personToday: Number(r.person), workspaceToday: Number(r.workspace), keyToday: Number(r.key_today) };
  return { ok: false, reason: reservationProblem({ ...totals, ...limits, source: key.source }) ?? "workspace_cap" };
}

/**
 * Reserves `n` characters for one utterance, or says why not: one system transaction holding the key's lock, so
 * concurrent requests (several tabs, the notch) never pass a cap together. Two round trips: BEGIN, then the lock, the
 * check-and-insert and the COMMIT together (reserveIn).
 */
export async function reserve(ctx: OrgContext, key: VoiceKey, n: number, limits: { low: boolean; share: number }): Promise<Reservation> {
  return withSystem((db) => reserveIn(db, ctx, key, n, limits, { commit: true }));
}

/** Gives a reservation back when ElevenLabs answered with an error before any audio (it bills only audio it made). */
export async function refund(ctx: OrgContext, source: VoiceKeySource, n: number, day: string): Promise<void> {
  await withSystem((db) => db.query(
    `UPDATE voice_usage_daily SET characters = greatest(0, characters - $4), utterances = greatest(0, utterances - 1), updated_at = now()
      WHERE membership_id = $1 AND day = $2::date AND key_source = $3`,
    [ctx.membership.id, day, source, n]));
}

// ---- The person's own voice (B.4) -----------------------------------------------------------------------------------------

/**
 * What the speech route, a reply's offer and Settings need, read in ONE statement (review, 9 October 2026: the natural
 * voice's latency on a slow link, where the speech route's separate transactions for the burst limit, the person's
 * choice, the key and the totals were 13 round trips, about 3.5 s): the person's choice, whether the workspace switched
 * Voice off, the workspace's stored key, and today's counts for either key. With `burst`, the same statement counts the
 * request against the person's burst limit (`hits`, as rateLimitIn counts it). These totals are only advisory: the caps
 * are decided again under the key's lock when the characters are reserved (reserveIn). `ready`: false before 0053, and
 * then nothing but the burst limit is read.
 */
type VoiceReads = {
  ready: boolean; hits: number | null; chosen: string | null; voiceOff: boolean; keyEnc: string | null;
  personToday: number; orgToday: number; envToday: number; envKeyToday: number;
};

/** 0053 and 0050, from the cache or in one query (instead of one each) the first time in a process. */
async function voiceSchemasIn(db: Db): Promise<{ v53: boolean; v50: boolean }> {
  const k53 = schema0053Known(), k50 = schema0050Known();
  if (k53 !== null && k50 !== null) return { v53: k53, v50: k50 };
  const r = await db.one<{ v53: boolean; v50: boolean }>(`SELECT ${k53 === null ? SCHEMA_0053_CHECK : String(k53)} AS v53, ${k50 === null ? SCHEMA_0050_CHECK : String(k50)} AS v50`);
  return { v53: k53 ?? noteSchema0053(r.v53), v50: k50 ?? noteSchema0050(r.v50) };
}

async function voiceReadsIn(db: Db, ctx: OrgContext, today: string, burst: { bucket: string; windowSeconds: number } | null): Promise<VoiceReads> {
  const { v53, v50 } = await voiceSchemasIn(db);
  const rl = burst
    ? `WITH rl AS (
         INSERT INTO auth_rate_limits(bucket, window_start, hits)
         VALUES ($${v53 ? 4 : 1}, to_timestamp(floor(extract(epoch from now()) / $${v53 ? 5 : 2}) * $${v53 ? 5 : 2}), 1)
         ON CONFLICT (bucket, window_start) DO UPDATE SET hits = auth_rate_limits.hits + 1
         RETURNING hits)
       `
    : "";
  const hits = burst ? "(SELECT hits FROM rl)" : "NULL::int";
  const none: VoiceReads = { ready: false, hits: null, chosen: null, voiceOff: false, keyEnc: null, personToday: 0, orgToday: 0, envToday: 0, envKeyToday: 0 };
  if (!v53) {
    if (!burst) return none;
    const r = await db.one<{ hits: number }>(`${rl}SELECT ${hits} AS hits`, [burst.bucket, burst.windowSeconds]);
    return { ...none, hits: Number(r.hits) };
  }
  // Before 0050 the workspace cannot switch Voice off.
  const off = v50 ? "b.abilities_off" : "NULL::text[] AS abilities_off";
  const r = await db.one<{ hits: number | null; natural_voice: string | null; abilities_off: string[] | null; key_enc: string | null; person_today: number; org_today: number; env_today: number; env_key_today: number }>(
    `${rl}SELECT ${hits} AS hits, p.natural_voice, ${off}, s.key_enc,
            (SELECT COALESCE(sum(u.characters), 0)::bigint FROM voice_usage_daily u WHERE u.membership_id = $1 AND u.day = $3::date) AS person_today,
            (SELECT COALESCE(sum(u.characters), 0)::bigint FROM voice_usage_daily u WHERE u.organisation_id = $2 AND u.day = $3::date AND u.key_source = 'organisation') AS org_today,
            (SELECT COALESCE(sum(u.characters), 0)::bigint FROM voice_usage_daily u WHERE u.organisation_id = $2 AND u.day = $3::date AND u.key_source = 'environment') AS env_today,
            (SELECT COALESCE(sum(u.characters), 0)::bigint FROM voice_usage_daily u JOIN organisations o ON o.id = u.organisation_id
              WHERE u.key_source = 'environment' AND u.day BETWEEN current_date - 1 AND current_date + 1 AND u.day = (now() AT TIME ZONE o.timezone)::date) AS env_key_today
       FROM (SELECT 1) one
       LEFT JOIN assistant_profiles p ON p.membership_id = $1
       LEFT JOIN brenda_settings b ON b.organisation_id = $2
       LEFT JOIN organisation_voice_secrets s ON s.organisation_id = $2`,
    [ctx.membership.id, ctx.org.id, today, ...(burst ? [burst.bucket, burst.windowSeconds] : [])]);
  return {
    ready: true,
    hits: r.hits === null ? null : Number(r.hits),
    chosen: isNaturalVoiceId(r.natural_voice) ? r.natural_voice : null,
    voiceOff: Array.isArray(r.abilities_off) && r.abilities_off.includes("voice"),
    keyEnc: r.key_enc,
    personToday: Number(r.person_today), orgToday: Number(r.org_today), envToday: Number(r.env_today), envKeyToday: Number(r.env_key_today),
  };
}

/** The day's totals for `key` from those reads (as totalsIn reads them). */
const totalsOf = (r: VoiceReads, key: VoiceKey): UsageTotals => key.source === "organisation"
  ? { personToday: r.personToday, workspaceToday: r.orgToday, keyToday: r.orgToday }
  : { personToday: r.personToday, workspaceToday: r.envToday, keyToday: r.envKeyToday };

/**
 * Runs `fn` once more when 0053's or 0050's objects were missing although the cache said they were there (a database
 * restored to before them while the process runs): the transaction rolled back whole, both caches are forgotten, and the
 * second run asks again (and takes the fallback path). Missing again: before 0053, as read0053 answers.
 */
export async function retryVoiceSchemas<T>(fn: () => Promise<T>, missing: () => T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isMissingSchema(err)) throw err;
    forget0053();
    forget0050();
  }
  try {
    return await fn();
  } catch (err) {
    if (!isMissingSchema(err)) throw err;
    forget0053();
    forget0050();
    return missing();
  }
}

/** The person's reads in a transaction of their own (Settings, a reply's offer). Null before 0053. */
async function personReads(ctx: OrgContext, today: string): Promise<VoiceReads | null> {
  const r = await retryVoiceSchemas(() => withSystem((db) => voiceReadsIn(db, ctx, today, null)), () => null);
  return r?.ready ? r : null;
}

/** The person's chosen voice inside a caller's transaction (null: "Computer voice", or before 0053). */
export async function readMyNaturalVoice(db: Db, membershipId: string): Promise<string | null> {
  if (!(await schema0053Ready(db))) return null;
  const r = await db.maybeOne<{ natural_voice: string | null }>(`SELECT natural_voice FROM assistant_profiles WHERE membership_id = $1`, [membershipId]);
  return isNaturalVoiceId(r?.natural_voice) ? r.natural_voice : null;
}

const NOT_READY_VIEW: NaturalVoiceView = {
  ready: false, chosen: null, available: false, reason: "not_ready", resetAt: null, usedToday: 0, personDailyLimit: PERSON_DAILY_CHARS, samples: !!envKey(), voices: NATURAL_VOICES,
};

/**
 * Settings → Your assistant → Voice: the choice, whether it would be used right now, and if not why. One transaction for
 * the reads (personReads) instead of three (review, 9 October 2026); the subscription as subscriptionFor serves it.
 */
export async function naturalVoiceView(ctx: OrgContext): Promise<NaturalVoiceView> {
  const today = todayLocal(ctx.org.timezone);
  const at = Date.now(); // the stamp before the totals (keyState's rule)
  const p = await personReads(ctx, today);
  if (!p) return { ...NOT_READY_VIEW, samples: !!envKey() };
  const view: NaturalVoiceView = { ready: true, chosen: p.chosen, available: false, reason: null, resetAt: null, usedToday: p.personToday, personDailyLimit: PERSON_DAILY_CHARS, samples: !!p.keyEnc || !!envKey(), voices: NATURAL_VOICES };
  const early = naturalVoiceReason({ ready: true, voiceOff: p.voiceOff, chosen: p.chosen, key: true, held: null, subscription: "ok", low: false, personFull: false, workspaceFull: false });
  if (early || !p.chosen) return { ...view, reason: early };
  const key = keyOf(ctx.org.id, p.keyEnc);
  const hold = key ? heldReason(key.keyRef) ?? (recentlyFailed(key.keyRef) ? "upstream" : null) : null;
  const st = key && !hold ? await keyState(ctx, key, { totals: totalsOf(p, key), stamp: stampAt(key, today, at) }) : null;
  const reason = naturalVoiceReason({
    ready: true, voiceOff: false, chosen: p.chosen, key: !!key, held: hold,
    subscription: st && !st.ok ? st.reason : "ok",
    low: !!st?.ok && st.low,
    personFull: p.personToday >= PERSON_DAILY_CHARS,
    workspaceFull: !!st?.ok && (st.totals.workspaceToday >= st.cap || (key?.source === "organisation" && st.totals.keyToday >= st.share)),
    sharedFull: !!st?.ok && key?.source === "environment" && st.totals.keyToday >= st.share,
  });
  // Boredroom's key's reset date is Boredroom's billing, not the workspace's: not shown (review, 9 October 2026).
  return { ...view, available: reason === null, reason, resetAt: st?.ok && key?.source === "organisation" ? st.sub.resetAt : null };
}

/** What Settings → Your assistant → Voice sends: a voice from the catalogue, or null for "Computer voice". */
export const naturalVoiceSchema = z.object({
  voiceId: z.union([z.null(), z.string().refine(isNaturalVoiceId, { message: "Pick one of the voices shown." })], { error: "Pick one of the voices shown." }),
});
export type NaturalVoiceInput = z.infer<typeof naturalVoiceSchema>;
export const NATURAL_VOICE_BODY_MAX = 1024;

/**
 * Saves the person's choice, as the person (a row with the look as it is and setup still not done when they have none,
 * as saveMySpeak). Refused while someone else is signed in as them; 503 before 0053. Not logged: a personal preference.
 */
export async function saveMyNaturalVoice(ctx: OrgContext, input: NaturalVoiceInput): Promise<NaturalVoiceView> {
  if (ctx.user.impersonation) throw forbidden(IMPERSONATED);
  const voiceId = input.voiceId === null ? null : isNaturalVoiceId(input.voiceId) ? input.voiceId : null;
  if (input.voiceId !== null && !voiceId) throw invalid("Pick one of the voices shown.", { voiceId: ["Pick one of the voices shown."] });
  await retryWithout0053(() => withUser(ctx.user.profileId, async (db) => {
    if (!(await schema0053Ready(db))) throw notReady();
    await db.query(
      `INSERT INTO assistant_profiles(membership_id, organisation_id, natural_voice, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (membership_id) DO UPDATE SET natural_voice = $3, updated_at = now()`,
      [ctx.membership.id, ctx.org.id, voiceId]);
  }));
  return naturalVoiceView(ctx);
}

const notReady = () => new AppError(503, "NOT_READY", NOT_READY_WORDS);

// ---- The workspace's key (B.3), owners and HR -----------------------------------------------------------------------------

const canManage = (ctx: OrgContext) => ctx.membership.role === "owner" || ctx.membership.role === "hr";
function requireManager(ctx: OrgContext) {
  if (!canManage(ctx)) throw forbidden("Only the organisation owner or HR can manage natural voices.");
}

export const voiceKeySchema = z.object({
  apiKey: z.string({ error: "Paste the ElevenLabs API key." }).trim()
    .min(20, { message: "That's too short to be an ElevenLabs API key." })
    .max(200, { message: "That's too long to be an ElevenLabs API key." }),
});
export type VoiceKeyInput = z.infer<typeof voiceKeySchema>;
export const VOICE_KEY_BODY_MAX = 2048;

/** Settings → Brenda → Natural voice: which key is in use, this month's usage on it, and the workspace's day. */
export async function voiceConnectionStatus(ctx: OrgContext): Promise<VoiceConnectionStatus> {
  requireManager(ctx);
  const env = envKey();
  const empty: VoiceConnectionStatus = {
    ready: false, source: env ? "environment" : "none", hint: null, connectedAt: null, month: null, monthError: null, low: false,
    workspaceMonth: 0, today: { used: 0, share: 0 }, sharedFull: false, historyBlocked: false, historyLeft: 0, personDailyLimit: PERSON_DAILY_CHARS,
  };
  const today = todayLocal(ctx.org.timezone);
  const at = Date.now(); // the stamp before the totals (keyState's rule)
  // Today's totals for either key come with the row (review, 9 October 2026: one transaction instead of two).
  const row = await read0053(() => withSystem(async (db) => {
    if (!(await schema0053Ready(db))) return null;
    return db.one<{ key_enc: string | null; key_hint: string | null; connected_at: string | null; month_chars: number; org_today: number; env_today: number; env_key_today: number }>(
      `SELECT s.key_enc, s.key_hint, s.connected_at,
              (SELECT COALESCE(sum(u.characters), 0)::bigint FROM voice_usage_daily u WHERE u.organisation_id = $1 AND u.day BETWEEN $2::date AND $3::date) AS month_chars,
              (SELECT COALESCE(sum(u.characters), 0)::bigint FROM voice_usage_daily u WHERE u.organisation_id = $1 AND u.day = $3::date AND u.key_source = 'organisation') AS org_today,
              (SELECT COALESCE(sum(u.characters), 0)::bigint FROM voice_usage_daily u WHERE u.organisation_id = $1 AND u.day = $3::date AND u.key_source = 'environment') AS env_today,
              (SELECT COALESCE(sum(u.characters), 0)::bigint FROM voice_usage_daily u JOIN organisations o ON o.id = u.organisation_id
                WHERE u.key_source = 'environment' AND u.day BETWEEN current_date - 1 AND current_date + 1 AND u.day = (now() AT TIME ZONE o.timezone)::date) AS env_key_today
         FROM (SELECT 1) one LEFT JOIN organisation_voice_secrets s ON s.organisation_id = $1`,
      [ctx.org.id, `${today.slice(0, 8)}01`, today]);
  }));
  if (!row) return empty;
  const own = row.key_enc ? decryptSecret(row.key_enc) : null;
  const key: VoiceKey | null = own ? { apiKey: own, source: "organisation", keyRef: `org:${ctx.org.id}` } : env ? { apiKey: env, source: "environment", keyRef: "env" } : null;
  const base: VoiceConnectionStatus = {
    ...empty, ready: true,
    source: key?.source ?? "none",
    hint: own ? row.key_hint : null,
    connectedAt: own ? row.connected_at : null,
    workspaceMonth: Number(row.month_chars),
  };
  if (!key) return base;
  // History: only the workspace's own key is the workspace's to fix. Boredroom's key is Boredroom's (its log), never a
  // workspace's warning (fix review, 9 October 2026).
  let blocked = false;
  let historyLeft = 0;
  if (key.source === "organisation") {
    const hash = keyHashOf(key.apiKey);
    const h = await historyStateOf(ctx.org.id, hash).catch(() => ({ blocked: false, left: 0 }));
    blocked = historyBlockedNow(blockKeyOf(key.keyRef, hash)) || h.blocked;
    historyLeft = h.left;
  }
  const totals: UsageTotals = key.source === "organisation"
    ? { personToday: 0, workspaceToday: Number(row.org_today), keyToday: Number(row.org_today) }
    : { personToday: 0, workspaceToday: Number(row.env_today), keyToday: Number(row.env_key_today) };
  const st = await keyState(ctx, key, { totals, stamp: stampAt(key, today, at) });
  if (!st.ok) return { ...base, monthError: st.reason, today: { used: st.totals.workspaceToday, share: 0 }, historyBlocked: blocked, historyLeft };
  // On Boredroom's key the subscription is every workspace's together (and Boredroom's plan): never shown to one of them,
  // only this workspace's own counters, its slice, and whether the key is low or today's whole share is gone (review,
  // 9 October 2026).
  const shared = key.source === "environment";
  return {
    ...base,
    month: shared ? null : { used: st.sub.used, limit: st.sub.limit, resetAt: st.sub.resetAt },
    low: st.low,
    today: { used: st.totals.workspaceToday, share: st.cap },
    sharedFull: shared && st.totals.keyToday >= st.share,
    // Nobody can say more than the workspace's day, whatever the per-person limit.
    personDailyLimit: Math.min(PERSON_DAILY_CHARS, st.cap),
    historyBlocked: blocked,
    historyLeft,
  };
}

/** Why a key was refused, in words people can act on (contract B.3). Never ElevenLabs' own words or the key. */
function keyRefusal(err: unknown): AppError {
  const kind = err instanceof ElevenLabsError ? err.kind : "network";
  const words =
    kind === "key_rejected" ? "ElevenLabs didn't accept this key. Copy it again from your ElevenLabs profile, under API keys."
    : kind === "missing_permissions" ? "This key can't read its usage. In ElevenLabs, give the key access to Text to Speech, Voices (read) and User (read), then try again."
    : kind === "quota" ? "ElevenLabs says this key has no characters left this month. Try again after it resets, or use another key."
    : "Couldn't reach ElevenLabs. Try again in a moment.";
  return invalid(words, { apiKey: [words] });
}

/**
 * Connects the workspace's own ElevenLabs key: tested with ONE free request (GET /v1/user/subscription, which must work
 * for the caps), then stored encrypted. Owners and HR (owner decision: "entered by owners/HR"). Audited with the hint only.
 */
export async function setVoiceKey(ctx: OrgContext, input: VoiceKeyInput, verify: (apiKey: string) => Promise<Subscription> = (k) => getSubscription(k)): Promise<VoiceConnectionStatus> {
  requireManager(ctx);
  if (!(await withSystem((db) => schema0053Ready(db)))) throw notReady();
  let sub: Subscription;
  try { sub = await verify(input.apiKey); } catch (err) { throw keyRefusal(err); }
  const hint = `…${input.apiKey.slice(-4)}`;
  const keyRef = `org:${ctx.org.id}`;
  const today = todayLocal(ctx.org.timezone);
  const keyToday = await retryWithout0053(() => withSystem(async (db) => {
    if (!(await schema0053Ready(db))) throw notReady();
    await db.query(
      `INSERT INTO organisation_voice_secrets(organisation_id, key_enc, key_hint, connected_at, updated_by, updated_at)
       VALUES ($1, $2, $3, now(), $4, now())
       ON CONFLICT (organisation_id) DO UPDATE SET key_enc = EXCLUDED.key_enc, key_hint = EXCLUDED.key_hint, connected_at = now(), updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [ctx.org.id, encryptSecret(input.apiKey), hint, ctx.membership.id]);
    await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "voice.connected", subjectType: "organisation", subjectId: ctx.org.id, metadata: { hint } });
    return keyTodayIn(db, { apiKey: input.apiKey, source: "organisation", keyRef }, ctx.org.id, today);
  }));
  forgetKey(keyRef);
  // The test's answer is this key's subscription: no second request for the status below.
  subs.set(keyRef, { ...sub, fetchedAt: Date.now(), keyTodayAtFetch: keyToday, keyHash: keyHashOf(input.apiKey), stamp: today });
  return voiceConnectionStatus(ctx);
}

/** Removes the workspace's key: Boredroom's key is used again within a daily share, or the computer voice without one. */
export async function clearVoiceKey(ctx: OrgContext): Promise<VoiceConnectionStatus> {
  requireManager(ctx);
  await retryWithout0053(() => withSystem(async (db) => {
    if (!(await schema0053Ready(db))) throw notReady();
    const gone = await db.query(`DELETE FROM organisation_voice_secrets WHERE organisation_id = $1 RETURNING organisation_id`, [ctx.org.id]);
    if (gone.length) await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "voice.disconnected", subjectType: "organisation", subjectId: ctx.org.id });
  }));
  forgetKey(`org:${ctx.org.id}`);
  return voiceConnectionStatus(ctx);
}

// ---- The speech token (D.1) ------------------------------------------------------------------------------------------------

/** 30 minutes, so Listen works for a while after the reply. */
export const SPEECH_TOKEN_TTL_S = 1800;
const TOKEN_WORDS = "This reply can't be said aloud any more.";
const textHash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

type SpeechClaims = { k: string; v: number; u: string; o: string; m: string; h: string; n: number };

/** Signs exactly these words (already `speechText`) for this person in this workspace. */
export function signSpeechToken(ctx: Pick<OrgContext, "user" | "org" | "membership">, text: string): string {
  return signPayload({ k: "speech", v: 1, u: ctx.user.profileId, o: ctx.org.id, m: ctx.membership.id, h: textHash(text), n: text.length }, SPEECH_TOKEN_TTL_S);
}

/**
 * Refuses (400 SPEECH_TOKEN) a token that is not a speech token, not this person's in this workspace, expired, or for
 * other words; the same words whatever the cause, so nothing hints whether it was someone else's.
 */
export function verifySpeechToken(ctx: Pick<OrgContext, "user" | "org" | "membership">, token: string, text: string): void {
  const c = typeof token === "string" ? verifyPayload<SpeechClaims>(token) : null;
  const ok = !!c && c.k === "speech" && c.v === 1
    && c.u === ctx.user.profileId && c.o === ctx.org.id && c.m === ctx.membership.id
    && typeof text === "string" && text === speechText(text) && c.n === text.length && c.h === textHash(text);
  if (!ok) throw new AppError(400, "SPEECH_TOKEN", TOKEN_WORDS);
}

// ---- The offer a reply carries (D.2) ---------------------------------------------------------------------------------------

/**
 * `{ path, token, text }` when this reply's words may be said in the person's natural voice: they chose one, Voice is on
 * for the workspace, the plan has the assistant, 0053 is applied and a key exists (no ElevenLabs call and no cap check
 * here: the speech route checks those). Null otherwise, and on any error: it never fails a reply.
 */
export async function speechOffer(ctx: OrgContext, spoken: string | null | undefined): Promise<SpeechOffer | null> {
  return speechOfferFor(ctx)(spoken);
}

/**
 * True when the pool holds a second idle connection, so a read started now beside the caller's own work takes a
 * connection nobody else is about to need. With one, both would want it: the action would wait for a NEW connection
 * (about 2 s on a phone's hotspot), which costs more than the read it saves (review, 9 October 2026).
 */
function spareConnection(): boolean {
  try {
    const pool = getPool();
    return pool.idleCount >= 2 && pool.waitingCount === 0;
  } catch {
    return false;
  }
}

/**
 * speechOffer in two halves (review, 9 October 2026: the natural voice's latency on a slow link): call this BEFORE the
 * reply is made, so the person's voice settings are read while the model works (they took about 0.9 s after it, on
 * every reply), then the function it gives with the reply's words. Once it knows the person has a natural voice and a
 * key, it also reads the key's subscription (free) when none is held yet, so the Listen that may follow does not wait
 * for ElevenLabs before its own request. Never throws, and an unused half costs only its read.
 *
 * The read starts at once only when the pool has a connection to spare (spareConnection); otherwise it starts with the
 * second half, after the action, as before the review: with one idle connection (a quiet process, a new one, the
 * notch's one request at a time) the action then keeps that connection instead of opening a new one (review, 9 October
 * 2026: about 0.8 to 1.2 s more on every Confirm, Undo or proposal, and 1.9 s before the chat's first step).
 */
export function speechOfferFor(ctx: OrgContext): (spoken: string | null | undefined) => Promise<SpeechOffer | null> {
  let reading: Promise<VoiceReads | null> | null = null;
  const read = () => (reading ??= readForOffer(ctx));
  if (spareConnection()) void read();
  return async (spoken) => {
    try {
      const text = speechText(spoken ?? "");
      if (!text) return null;
      if (!(await read())) return null;
      return { path: `/api/orgs/${encodeURIComponent(ctx.org.slug)}/assistant/speech`, token: signSpeechToken(ctx, text), text };
    } catch {
      return null;
    }
  };
}

/** speechOfferFor's read: the person's voice reads, and the subscription warmed; null when no offer is due. Never throws. */
function readForOffer(ctx: OrgContext): Promise<VoiceReads | null> {
  return (async () => {
    if (!ctx.plan?.features?.AI_ASSISTANT) return null;
    const today = todayLocal(ctx.org.timezone);
    const at = Date.now();
    const p = await personReads(ctx, today);
    if (!p || !p.chosen || p.voiceOff) return null;
    const key = keyOf(ctx.org.id, p.keyEnc);
    if (!key) return null;
    if (!heldReason(key.keyRef)) warmSubscription(key, stampAt(key, today, at), totalsOf(p, key).keyToday);
    return p;
  })().catch(() => null);
}

// ---- Speech (E.1) ----------------------------------------------------------------------------------------------------------

export const speechSchema = z.object({
  token: z.string().min(10).max(4000),
  text: z.string().min(1).max(SPEECH_MAX_CHARS),
  speed: z.enum(["slower", "normal", "faster"]).default("normal"),
  as: z.enum(["stream", "base64"]).default("stream"),
});
export type SpeechInput = z.infer<typeof speechSchema>;
export const SPEECH_BODY_MAX = 8192;
export const SPEECH_BURST = { requests: 30, windowSeconds: 60 } as const;
export const SPEECH_BURST_MESSAGE = "That's a lot to say in one minute. Wait a moment, then try again.";

/** What a 409 says for each reason; the client reads `details.reason` and speaks with the computer voice. */
const UNAVAILABLE_WORDS: Record<NaturalVoiceReason, string> = {
  not_ready: "Natural voices need a database update first, so the computer voice is used.",
  no_voice: "No natural voice is chosen, so the computer voice is used.",
  voice_off: "Voice is switched off for this workspace.",
  no_key: "Natural voices aren't set up for this workspace yet, so the computer voice is used.",
  key_rejected: "ElevenLabs refused the workspace's key, so the computer voice is used.",
  person_cap: "You've used today's natural voice, so the computer voice is used until tomorrow.",
  workspace_cap: "Your workspace has used today's natural voice, so the computer voice is used until tomorrow.",
  shared_cap: "Today's shared natural voice allowance is used up, so the computer voice is used until tomorrow.",
  allowance_low: "This month's natural voice allowance is nearly used up, so the computer voice is used.",
  upstream: "ElevenLabs didn't answer, so the computer voice is used.",
};
const UPSTREAM_WORDS = "ElevenLabs didn't answer, so the computer voice is used.";

export const voiceUnavailable = (reason: NaturalVoiceReason) => new AppError(409, "VOICE_UNAVAILABLE", UNAVAILABLE_WORDS[reason], { details: { reason } });
const voiceFailed = (reason: "upstream" | "key_rejected" | "allowance_low") => new AppError(502, "VOICE_UNAVAILABLE", UPSTREAM_WORDS, { details: { reason } });

/** Errors the audio stream once it passes 2 MB or 60 seconds; the upstream request is cancelled with it. */
function guarded(src: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  let bytes = 0;
  const started = Date.now();
  return src.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytes += chunk.byteLength;
      if (bytes > AUDIO_MAX_BYTES || Date.now() - started > AUDIO_MAX_MS) { controller.error(new ElevenLabsError("upstream")); return; }
      controller.enqueue(chunk);
    },
  }));
}

/**
 * What the speech route's transaction decided (prepareSpeechIn), acted on once it is committed: a refusal (answered
 * then, so the burst limit's count stays), the characters reserved, or a reservation still to make once the key's
 * subscription is read (there was none to serve: the read is never made while the transaction, or the key's lock, waits).
 */
export type SpeechPrepared =
  | { kind: "refused"; err: unknown }
  | { kind: "reserved"; key: VoiceKey; voiceId: string; text: string; speed: SpeechInput["speed"]; day: string }
  | { kind: "subscription"; key: VoiceKey; voiceId: string; text: string; speed: SpeechInput["speed"]; stamp: string; totals: UsageTotals; flight: Promise<SubEntry> };

/**
 * The speech route's checks and reservation inside the caller's transaction (orgContextTx: the same one as the session
 * and the membership), in the order of E.1: with `burst`, the request is counted against the person's burst limit (a
 * 429 is thrown, so it rolls back as rateLimitIn's did); then the body, the token, the person still there, 0053, a voice
 * chosen, Voice on, a key, the breaker, the allowance; then the characters are reserved under the key's lock with the
 * transaction's COMMIT (one round trip: reserveIn). Everything else is returned, never thrown, so the count is kept.
 * About 4 round trips from BEGIN to the reservation's COMMIT, where it was 26 (review, 9 October 2026: the natural
 * voice's latency on a slow link). Nothing is sent to ElevenLabs before the reservation is committed.
 */
export async function prepareSpeechIn(db: Db, ctx: OrgContext, body: SpeechInput | Promise<SpeechInput>, signal: AbortSignal, opts: { burst: boolean }): Promise<SpeechPrepared> {
  const today = todayLocal(ctx.org.timezone);
  const at = Date.now(); // the stamp before the totals (keyState's rule)
  const reads = await voiceReadsIn(db, ctx, today, opts.burst ? { bucket: `voice.burst:${ctx.membership.id}`, windowSeconds: SPEECH_BURST.windowSeconds } : null);
  if (opts.burst && (reads.hits ?? 0) > SPEECH_BURST.requests) throw rateLimited(SPEECH_BURST_MESSAGE);
  const refused = (err: unknown): SpeechPrepared => ({ kind: "refused", err });
  let b: SpeechInput;
  try {
    b = await body;
    verifySpeechToken(ctx, b.token, b.text);
  } catch (err) { return refused(err); }
  // Gone already (Stop, typing, the drawer closed): nothing is reserved or sent.
  if (signal.aborted) return refused(voiceFailed("upstream"));
  if (!reads.ready) return refused(voiceUnavailable("not_ready"));
  if (!reads.chosen) return refused(voiceUnavailable("no_voice"));
  if (reads.voiceOff) return refused(voiceUnavailable("voice_off"));
  const key = keyOf(ctx.org.id, reads.keyEnc);
  if (!key) return refused(voiceUnavailable("no_key"));
  const hold = heldReason(key.keyRef);
  if (hold) return refused(voiceUnavailable(hold));
  const totals = totalsOf(reads, key);
  const stamp = stampAt(key, today, at);
  const base = { key, voiceId: reads.chosen, text: b.text, speed: b.speed };
  const s = subscriptionNow(key, stamp, totals.keyToday);
  if (!s) {
    // None to serve: its read (free) starts now, while this transaction commits; speakPrepared waits for this one.
    const flight = readSubscription(key, keyHashOf(key.apiKey), stamp, totals.keyToday);
    flight.catch(() => undefined);
    return { kind: "subscription", ...base, stamp, totals, flight };
  }
  const st = stateOf(key, totals, s);
  if (!st.ok) return refused(voiceUnavailable(st.reason));
  if (st.low) return refused(voiceUnavailable("allowance_low"));
  const r = await reserveIn(db, ctx, key, b.text.length, { low: st.low, share: st.share }, { commit: true });
  if (!r.ok) return refused(voiceUnavailable(r.reason));
  return { kind: "reserved", ...base, day: r.day };
}

/**
 * The words of one reply in the person's natural voice, as an MP3 stream, in a transaction of its own (no burst limit:
 * the route counts it). Every refusal is a 409 VOICE_UNAVAILABLE with its reason; an ElevenLabs failure gives the
 * reservation back, trips the breaker and is a 502.
 */
export async function naturalSpeech(ctx: OrgContext, body: SpeechInput, signal: AbortSignal): Promise<{ stream: ReadableStream<Uint8Array>; characters: number }> {
  verifySpeechToken(ctx, body.token, body.text);
  // Gone already (Stop, typing, the drawer closed): nothing is read, reserved or sent.
  if (signal.aborted) throw voiceFailed("upstream");
  const prepared = await retryVoiceSchemas(
    () => withSystem((db) => prepareSpeechIn(db, ctx, body, signal, { burst: false })),
    (): SpeechPrepared => ({ kind: "refused", err: voiceUnavailable("not_ready") }));
  return speakPrepared(ctx, prepared, signal);
}

/**
 * The rest, once the transaction is committed: the reservation still to make (its subscription read first, then the
 * reservation in its own transaction: BEGIN, then the lock, the check-and-insert and COMMIT together), then ElevenLabs.
 */
export async function speakPrepared(ctx: OrgContext, prepared: SpeechPrepared, signal: AbortSignal): Promise<{ stream: ReadableStream<Uint8Array>; characters: number }> {
  if (prepared.kind === "refused") throw prepared.err;
  const { key, voiceId, text } = prepared;
  const n = text.length;
  let day: string;
  if (prepared.kind === "subscription") {
    const st = stateOf(key, prepared.totals, await subscriptionOf(key, prepared.stamp, prepared.flight));
    if (!st.ok) throw voiceUnavailable(st.reason);
    if (st.low) throw voiceUnavailable("allowance_low");
    // Gone while the subscription was read: nothing is reserved or sent.
    if (signal.aborted) throw voiceFailed("upstream");
    const r = await reserve(ctx, key, n, { low: st.low, share: st.share });
    if (!r.ok) throw voiceUnavailable(r.reason);
    day = r.day;
  } else {
    day = prepared.day;
  }
  // Gone while the caps were checked: nothing was sent, so nothing was billed (fix review, 9 October 2026).
  if (signal.aborted) {
    await refund(ctx, key.source, n, day).catch(() => undefined);
    throw voiceFailed("upstream");
  }
  let stream: ReadableStream<Uint8Array>;
  const sinceUnix = Math.floor(Date.now() / 1000) - 60;
  const forget = (ref: SpeechRef) => forgetSpoken(ctx.org.id, key, { ...ref, voiceId, sinceUnix });
  try {
    // From here the request is sent (streamSpeech never looks at `signal` before sending it).
    stream = await streamSpeech({
      apiKey: key.apiKey, voiceId, text, speed: SPEECH_SPEEDS[prepared.speed], signal,
      // Said, or stopped (even before its first byte): deleted from the key's ElevenLabs History by ElevenLabs' ids for it.
      onEnd: forget,
    });
  } catch (err) {
    // The person stopped (or went away) once ElevenLabs had answered with audio: billed, so not refunded; its ids came
    // with the answer, so it is deleted from History (onEnd ran).
    if (isAbort(err)) throw voiceFailed("upstream");
    // ElevenLabs answered with an error, or not at all: given back, whether or not the person is still there.
    await refund(ctx, key.source, n, day).catch(() => undefined);
    const kind = err instanceof ElevenLabsError ? err.kind : "other";
    // No answer within 10 seconds: ElevenLabs may still have made (and kept) it, and there is no id to delete it by.
    if (kind === "timeout") forget({ historyItemId: null, requestId: null });
    trip(key, kind);
    throw voiceFailed(kind === "quota" ? "allowance_low" : rejectedReason(key, kind));
  }
  // ElevenLabs answered with audio: Settings stops saying it didn't answer just now.
  lastFailure.delete(key.keyRef);
  return { stream: guarded(stream), characters: n };
}

// ---- ElevenLabs' History (review, 9 October 2026; fix review, 9 October 2026) -------------------------------------------------

/** When to try deleting an utterance from the key's History in this process, after its stream is over (it may take a moment to appear). */
export const HISTORY_TRIES_MS = [2_000, 15_000, 90_000] as const;
/** The job that does it if those did not (a restart, ElevenLabs failing): run by the worker after the tries are over. */
export const HISTORY_JOB = "voice.history_forget";
export const HISTORY_JOB_DELAY_MS = 180_000;
/** A key without History access is not asked again in this process for this long; its jobs wait as long between tries. */
export const HISTORY_BLOCKED_MS = 10 * 60_000;
/** ...for a day at most, then what it held is counted as not deleted. */
export const HISTORY_BLOCKED_ROUNDS = 144;
/** Utterances not deleted are counted for owners and HR over this many days. */
const HISTORY_LEFT_DAYS = 30;
/** `last_error` of a job that could not delete its utterance (counted in Settings); never the words. */
const HISTORY_LEFT_PREFIX = "voice history: ";

/**
 * One utterance to delete from a key's History: ElevenLabs' ids for it, which key (its keyRef and hash, never the key)
 * and whose workspace. Never the words: an item is only ever deleted by an id ElevenLabs gave for that very request.
 */
export type HistoryForget = {
  organisationId: string; keyRef: string; keyHash: string;
  historyItemId: string | null; requestId: string | null; voiceId: string; sinceUnix: number;
  /** How many times the key had no History access (the job then waits HISTORY_BLOCKED_MS). */
  blockedRounds?: number;
};

const blockKeyOf = (keyRef: string, keyHash: string) => `${keyRef}:${keyHash}`;

function historyBlockedNow(blockKey: string, now = Date.now()): boolean {
  const until = historyBlocked.get(blockKey);
  if (until === undefined) return false;
  if (until > now) return true;
  historyBlocked.delete(blockKey);
  return false;
}

/** The key had no History access: not asked again here for a while. Boredroom's own key is Boredroom's to fix (the log), never a workspace's. */
function blockHistory(keyRef: string, keyHash: string): void {
  const k = blockKeyOf(keyRef, keyHash);
  if (keyRef === "env" && !historyBlockedNow(k)) console.warn("[voice] Boredroom's ElevenLabs key has no History access: what assistants say stays in its History until it is given History (read and write) access.");
  historyBlocked.set(k, Date.now() + HISTORY_BLOCKED_MS);
}

/** ElevenLabs' id for the item, from the answer's header or found by the request's own id; null when there is none (yet). */
async function historyIdOf(apiKey: string, p: HistoryForget): Promise<string | null> {
  if (p.historyItemId) return p.historyItemId;
  if (!p.requestId) return null;
  return findHistoryItem(apiKey, { voiceId: p.voiceId, requestId: p.requestId, sinceUnix: p.sinceUnix });
}

/** Queues the job (deduplicated by the ids); its id, or null when it was there already or could not be queued. */
async function queueHistoryJob(p: HistoryForget, delayMs: number): Promise<string | null> {
  const r = await withSystem((db) => db.maybeOne<{ id: string }>(
    `INSERT INTO jobs(type, payload, dedup_key, next_run_at) VALUES ($1, $2, $3, now() + make_interval(secs => $4))
     ON CONFLICT (dedup_key) DO NOTHING RETURNING id`,
    [HISTORY_JOB, JSON.stringify(p), `voice.history:${p.keyHash}:${p.historyItemId ?? p.requestId}${p.blockedRounds ? `:b${p.blockedRounds}` : ""}`, Math.max(0, delayMs) / 1000]));
  return r?.id ?? null;
}

/** Counts one utterance as not deleted, for the workspace's owners and HR (a finished job row; ids only). */
async function recordUndeleted(p: HistoryForget, why: string): Promise<void> {
  await withSystem((db) => db.query(
    `INSERT INTO jobs(type, payload, state, last_error, finished_at) VALUES ($1, $2, 'failed', $3, now())`,
    [HISTORY_JOB, JSON.stringify(p), `${HISTORY_LEFT_PREFIX}${why}`]));
}

/**
 * Deletes one utterance from the key's ElevenLabs History (free requests), ONLY by an id ElevenLabs gave for that very
 * request: its `history-item-id`, else the item whose `request_id` is the request's `request-id`. Never by its words,
 * which could be the key holder's own generation (fix review, 9 October 2026); the words are not even kept for it. With
 * neither id there is nothing safe to delete: it is counted as not deleted, for owners and HR.
 *
 * A job is queued first (ids only), so a restart, a deploy or ElevenLabs failing for a while loses nothing: the worker
 * runs it after HISTORY_JOB_DELAY_MS (runHistoryForgetJob). Meanwhile this process tries at `tries`; when one deletes
 * the item, the job is removed. A key without History access stops the tries here (the job keeps waiting for access);
 * a rejected key stops them too (the key was revoked or replaced: the job checks which). Never throws.
 */
export function forgetSpoken(orgId: string, key: VoiceKey, ref: SpeechRef & { voiceId: string; sinceUnix: number }, tries: readonly number[] = HISTORY_TRIES_MS, jobDelayMs = HISTORY_JOB_DELAY_MS): void {
  const p: HistoryForget = {
    organisationId: orgId, keyRef: key.keyRef, keyHash: keyHashOf(key.apiKey),
    historyItemId: ref.historyItemId, requestId: ref.requestId, voiceId: ref.voiceId, sinceUnix: Math.floor(ref.sinceUnix),
  };
  if (!p.historyItemId && !p.requestId) { void recordUndeleted(p, "no id").catch(() => undefined); return; }
  const job = queueHistoryJob(p, jobDelayMs).catch(() => null);
  const blockKey = blockKeyOf(p.keyRef, p.keyHash);
  let attempt = 0;
  const next = () => {
    if (attempt >= tries.length || historyBlockedNow(blockKey)) return;
    const t = setTimeout(() => { historyTimers.delete(t); void once(); }, tries[attempt++]);
    (t as { unref?: () => void }).unref?.();
    historyTimers.add(t);
  };
  const once = async () => {
    try {
      const found = await historyIdOf(key.apiKey, p);
      if (!found) return next();
      if (!p.historyItemId) {
        // Found by its request id: the job deletes this id too, never another (a lost answer then a second listing).
        p.historyItemId = found;
        const id = await job;
        if (id) await withSystem((db) => db.query(`UPDATE jobs SET payload = payload || jsonb_build_object('historyItemId', $2::text) WHERE id = $1 AND state = 'pending'`, [id, found])).catch(() => undefined);
      }
      if ((await deleteHistoryItem(key.apiKey, found)) === "missing") return next();
      const id = await job;
      if (id) await withSystem((db) => db.query(`DELETE FROM jobs WHERE id = $1 AND state = 'pending'`, [id])).catch(() => undefined);
    } catch (err) {
      const kind = err instanceof ElevenLabsError ? err.kind : "other";
      if (kind === "missing_permissions") { blockHistory(p.keyRef, p.keyHash); return; }
      if (kind === "key_rejected") return;
      next();
    }
  };
  next();
}

/** A job's payload as HistoryForget, or null when it is not one (a hand-made row, an older shape). */
function historyForgetOf(raw: Record<string, unknown>): HistoryForget | null {
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const organisationId = str(raw.organisationId), keyRef = str(raw.keyRef), keyHash = str(raw.keyHash), voiceId = str(raw.voiceId);
  const sinceUnix = Number(raw.sinceUnix);
  if (!organisationId || !keyRef || !keyHash || !isNaturalVoiceId(voiceId) || !Number.isFinite(sinceUnix)) return null;
  const historyItemId = str(raw.historyItemId), requestId = str(raw.requestId);
  if (!historyItemId && !requestId) return null;
  const rounds = Number(raw.blockedRounds);
  return { organisationId, keyRef, keyHash, historyItemId, requestId, voiceId, sinceUnix, ...(rounds > 0 ? { blockedRounds: Math.floor(rounds) } : {}) };
}

/** The key a keyRef names now (Boredroom's, or the workspace's own), or null. */
async function apiKeyOf(keyRef: string): Promise<string | null> {
  if (keyRef === "env") return envKey();
  const orgId = /^org:([0-9a-f-]{36})$/i.exec(keyRef)?.[1];
  if (!orgId) return null;
  const enc = await read0053(() => withSystem(async (db) => {
    if (!(await schema0053Ready(db))) return null;
    const r = await db.maybeOne<{ key_enc: string }>(`SELECT key_enc FROM organisation_voice_secrets WHERE organisation_id = $1`, [orgId]);
    return r?.key_enc ?? null;
  }));
  return enc ? decryptSecret(enc) : null;
}

/**
 * The worker's job (voice.history_forget): deletes one utterance by its ids (the in-process tries did not). Deleted, or
 * already gone, or not to be found: done. The key replaced or removed since: done (the new key cannot reach the old
 * account). No History access: tried again every HISTORY_BLOCKED_MS for a day (a new job), then counted. A rejected key:
 * counted. ElevenLabs failing: thrown, so the worker tries again with its backoff, and counts it (`dead`) after its last
 * attempt. Every error's words start "voice history: " and never carry the ids' words, the key or the text.
 */
export async function runHistoryForgetJob(raw: Record<string, unknown>): Promise<void> {
  const p = historyForgetOf(raw);
  if (!p) return;
  const apiKey = await apiKeyOf(p.keyRef);
  if (!apiKey || keyHashOf(apiKey) !== p.keyHash) return;
  try {
    const id = await historyIdOf(apiKey, p);
    if (id) await deleteHistoryItem(apiKey, id);
  } catch (err) {
    const kind = err instanceof ElevenLabsError ? err.kind : "other";
    if (kind === "missing_permissions") {
      if (p.keyRef === "env") console.warn("[voice] Boredroom's ElevenLabs key has no History access: what assistants say stays in its History until it is given History (read and write) access.");
      const rounds = (p.blockedRounds ?? 0) + 1;
      if (rounds > HISTORY_BLOCKED_ROUNDS) { await recordUndeleted(p, "no History access"); return; }
      await queueHistoryJob({ ...p, blockedRounds: rounds }, HISTORY_BLOCKED_MS);
      return;
    }
    if (kind === "key_rejected") { await recordUndeleted(p, "key refused"); return; }
    throw new Error(`${HISTORY_LEFT_PREFIX}${kind}`);
  }
}

/**
 * For Settings: whether this key (by its hash) is waiting for History access (a job re-queued for it), and how many
 * utterances on it could not be deleted in the last 30 days. Zero and false before anything was queued.
 */
async function historyStateOf(orgId: string, keyHash: string): Promise<{ blocked: boolean; left: number }> {
  const r = await withSystem((db) => db.one<{ blocked: boolean | null; left: number }>(
    `SELECT bool_or(state IN ('pending', 'running') AND payload ? 'blockedRounds') AS blocked,
            count(*) FILTER (WHERE state IN ('failed', 'dead') AND last_error LIKE $3 AND created_at > now() - make_interval(days => $4))::int AS left
       FROM jobs WHERE type = $5 AND payload->>'organisationId' = $1 AND payload->>'keyHash' = $2`,
    [orgId, keyHash, `${HISTORY_LEFT_PREFIX}%`, HISTORY_LEFT_DAYS, HISTORY_JOB]));
  return { blocked: !!r.blocked, left: Number(r.left) || 0 };
}

/** The whole utterance (the notch's `as: "base64"`: its bridge returns JSON only), at most 2 MB. */
export async function collectAudio(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > AUDIO_MAX_BYTES) { await reader.cancel().catch(() => undefined); throw voiceFailed("upstream"); }
      chunks.push(value);
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw voiceFailed("upstream");
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  return all;
}

// ---- Samples (E.2) ---------------------------------------------------------------------------------------------------------

const SAMPLE_TTL_MS = 24 * 60 * 60_000;
const samples = new Map<string, { bytes: Uint8Array; url: string; at: number }>();
const sampleFlights = new Map<string, Promise<Uint8Array>>();

/**
 * A voice's sample: its public preview MP3 (no characters), looked up with the workspace's key or Boredroom's (free),
 * fetched by this server and kept here for a day, so the browser never talks to ElevenLabs or Google.
 */
export async function voiceSample(ctx: OrgContext, voiceId: string): Promise<Uint8Array> {
  if (!isNaturalVoiceId(voiceId)) throw notFound("That voice isn't one of the voices offered.");
  const hit = samples.get(voiceId);
  if (hit && Date.now() - hit.at < SAMPLE_TTL_MS) return hit.bytes;
  let flight = sampleFlights.get(voiceId);
  if (!flight) {
    const key = await resolveVoiceKey(ctx.org.id);
    if (!key) throw voiceUnavailable("no_key");
    flight = (async () => {
      try {
        const url = await getVoicePreviewUrl(key.apiKey, voiceId);
        const bytes = await fetchPreview(url);
        samples.set(voiceId, { bytes, url, at: Date.now() });
        return bytes;
      } catch {
        throw new AppError(502, "VOICE_UNAVAILABLE", "Couldn't get the sample from ElevenLabs. Try again in a moment.", { details: { reason: "upstream" } });
      }
    })().finally(() => sampleFlights.delete(voiceId));
    sampleFlights.set(voiceId, flight);
  }
  return flight;
}
