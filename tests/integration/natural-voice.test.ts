/**
 * Natural voice (owner decision, 9 October 2026: natural voice (ElevenLabs), contract H). Through the real route
 * handlers, signed in by a session cookie (and once by the notch's desktop token), on the throwaway test database with
 * migration 0053 applied: the tables' row security, the workspace's key (owners and HR, tested, stored encrypted), the
 * person's choice, the speech offer on a chat reply, the speech route (the token, no cap of Boredroom's since the owner's
 * request of 12 October 2026, every ElevenLabs failure with its refund, the breaker, base64 for the notch, concurrent
 * requests) and the cached samples.
 *
 * ElevenLabs is ALWAYS mocked (setElevenLabsFetchForTests): text-to-speech costs the owner's allowance. The keys here
 * are made up; the real ELEVENLABS_API_KEY that tests/setup.ts loads is replaced before anything runs. No model either.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const reqState = vi.hoisted(() => ({ cookie: null as string | null, bearer: null as string | null }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "boredroom_session" && reqState.cookie ? { name, value: reqState.cookie } : undefined) }),
  headers: async () => new Headers(reqState.bearer ? { authorization: `Bearer ${reqState.bearer}` } : {}),
}));

import pg from "pg";
import { adminQuery, appQueryAs, resetTestDatabase } from "../helpers/db";
import { buildCompany, type CompanyFixture, type FixtureUser } from "@/server/services/fixtures";
import { withSystem } from "@/server/db";
import { issueSession } from "@/server/auth";
import { startLink, approveLink, pollLink } from "@/server/services/desktop";
import { signPayload } from "@/server/lib/crypto";
import { todayLocal } from "@/server/lib/time";
import { forget0053 } from "@/server/lib/schema-0053";
import { ElevenLabsError, setElevenLabsFetchForTests } from "@/server/services/elevenlabs";
import {
  HISTORY_JOB, NO_LIMIT, forgetSpoken, naturalSpeech, naturalVoiceView, resetNaturalVoiceForTests, runHistoryForgetJob, saveMyNaturalVoice,
  speechOffer, voiceConnectionStatus,
} from "@/server/services/natural-voice";
import { speechText, type SpeechOffer } from "@/lib/natural-voices";
import { POST as speechPOST } from "@/app/api/orgs/[org]/assistant/speech/route";
import { GET as voiceGET, PUT as voicePUT } from "@/app/api/orgs/[org]/assistant/voice/route";
import { GET as sampleGET } from "@/app/api/orgs/[org]/assistant/voice/samples/[voiceId]/route";
import { GET as keyGET, POST as keyPOST, DELETE as keyDELETE } from "@/app/api/orgs/[org]/settings/voice/route";
import { POST as chatPOST } from "@/app/api/orgs/[org]/assistant/chat/route";
import type { OrgContext } from "@/server/lib/api";

delete process.env.ANTHROPIC_API_KEY;
const savedEnvKey = process.env.ELEVENLABS_API_KEY;
const ENV_KEY = "sk_test_boredroom_env_key_0000000000000001";
const ORG_KEY = "sk_test_workspace_org_key_000000000000wxyz";
const BAD_KEY = "sk_test_rejected_key_0000000000000000000";
const NOPERM_KEY = "sk_test_no_permission_key_00000000000000";
const DOWN_KEY = "sk_test_unreachable_key_000000000000000";
process.env.ELEVENLABS_API_KEY = ENV_KEY;

const LILY = "pFZP5JQG7iQjIQuC4Bku";
const GEORGE = "JBFqnCBsd6RMkjVDRZzb";
const PREVIEW = "https://storage.googleapis.com/eleven-public-prod/premade/voices/test/preview.mp3";
const AUDIO_A = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0, 0, 0, 0, 0, 1]);
const AUDIO_B = new Uint8Array([0xff, 0xfb, 0x90, 0x64, 9, 9, 9, 9]);
const SAMPLE = new Uint8Array([0x49, 0x44, 0x33, 0x03, 7, 7, 7, 7, 7, 7, 7, 7]);

// ---- ElevenLabs, mocked ---------------------------------------------------------------------------------------------------

type ElCall = { url: string; method: string; key: string | null; body: Record<string, unknown> | null };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const REQUEST_ID = "req-0a1b2c3d";
const audio = (headers: Record<string, string> = { "request-id": REQUEST_ID }) => new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(AUDIO_A); c.enqueue(AUDIO_B); c.close(); } }), { status: 200, headers: { "content-type": "audio/mpeg", ...headers } });
const in30Days = () => Math.floor(Date.now() / 1000) + 30 * 86_400 - 3600;

const el = {
  calls: [] as ElCall[],
  sub: { used: 0, limit: 1_000_000 },
  tts: (() => audio()) as (init?: RequestInit) => Response | Promise<Response>,
  /** The subscription's answer, delayed (to abort a request while the caps are read). */
  subDelayMs: 0,
  /** The subscription's reset (unix seconds); null: in 30 days. */
  resetUnix: null as number | null,
  /** The key's History as GET /v1/history lists it, and what DELETE /v1/history/{id} answers. */
  history: [] as Record<string, unknown>[],
  historyDelete: (() => json(200, { status: "ok" })) as (id: string) => Response | Promise<Response>,
};

function resetEl() {
  el.calls = [];
  el.sub = { used: 0, limit: 1_000_000 };
  el.tts = () => audio();
  el.subDelayMs = 0;
  el.resetUnix = null;
  el.history = [];
  el.historyDelete = () => json(200, { status: "ok" });
}

const historyCalls = () => el.calls.filter((c) => c.url.includes("/v1/history"));
const deletesOf = () => el.calls.filter((c) => c.method === "DELETE").map((c) => c.url.split("/").pop());
const historyJobs = () => adminQuery<{ state: string; payload: Record<string, unknown>; last_error: string | null; next_run_at: string }>(
  `SELECT state, payload, last_error, next_run_at FROM jobs WHERE type = $1 ORDER BY created_at`, [HISTORY_JOB]);
/** Waits (real time) until `check` passes, or fails with its last error. */
async function until(check: () => unknown | Promise<unknown>, ms = 3_000) {
  const end = Date.now() + ms;
  for (;;) {
    try { await check(); return; } catch (err) { if (Date.now() > end) throw err; }
    await new Promise((r) => setTimeout(r, 20));
  }
}

const ttsCalls = () => el.calls.filter((c) => c.url.includes("/v1/text-to-speech/"));
const subCalls = () => el.calls.filter((c) => c.url.endsWith("/v1/user/subscription"));

setElevenLabsFetchForTests((async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const key = new Headers(init?.headers).get("xi-api-key");
  el.calls.push({ url, method: init?.method ?? "GET", key, body: init?.body ? JSON.parse(String(init.body)) : null });
  if (url.endsWith("/v1/user/subscription")) {
    if (el.subDelayMs) await new Promise((r) => setTimeout(r, el.subDelayMs));
    if (key === BAD_KEY) return json(401, { detail: { status: "invalid_api_key", message: "Invalid API key" } });
    if (key === NOPERM_KEY) return json(401, { detail: { status: "missing_permissions", message: "missing user_read" } });
    if (key === DOWN_KEY) return new Response("down", { status: 503 });
    return json(200, { tier: "starter", character_count: el.sub.used, character_limit: el.sub.limit, next_character_count_reset_unix: el.resetUnix ?? in30Days(), status: "active" });
  }
  if (/\/v1\/voices\/[A-Za-z0-9]+$/.test(url)) return json(200, { voice_id: url.split("/").pop(), preview_url: PREVIEW });
  if (url === PREVIEW) return new Response(SAMPLE, { status: 200, headers: { "content-type": "text/plain" } });
  if (url.includes("/v1/text-to-speech/")) {
    // As fetch does: an already-aborted signal is never sent.
    if (init?.signal?.aborted) throw new DOMException("This operation was aborted", "AbortError");
    return el.tts(init);
  }
  if (url.startsWith("https://api.elevenlabs.io/v1/history?")) return json(200, { history: el.history, has_more: false });
  if (url.startsWith("https://api.elevenlabs.io/v1/history/") && init?.method === "DELETE") return el.historyDelete(url.split("/").pop()!);
  throw new TypeError(`unexpected ElevenLabs request in a test: ${url}`);
}) as typeof fetch);

// ---- Calling the routes as a signed-in person -------------------------------------------------------------------------------

let a: CompanyFixture;
let owner: OrgContext, hr: OrgContext, ada: OrgContext, ben: OrgContext;
const sessions = new Map<string, string>();

async function sessionFor(u: FixtureUser): Promise<string> {
  const token = await withSystem((db) => issueSession(db, u.authUserId, { method: "password", userAgent: "vitest" }));
  sessions.set(u.email, token);
  return token;
}

function as(u: FixtureUser) { reqState.cookie = sessions.get(u.email) ?? null; reqState.bearer = null; }

type Handler<P> = (req: Request, ctx: { params: Promise<P> }) => Promise<Response>;
async function call<P>(handler: Handler<P>, method: string, path: string, params: P, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
  const init: RequestInit = { method, headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers } };
  if (body !== undefined) init.body = JSON.stringify(body);
  return handler(new Request(`http://localhost:3000${path}`, init), { params: Promise.resolve(params) });
}

const ORG = { org: "company-a" };
const speak = (offer: SpeechOffer, extra: Record<string, unknown> = {}) => call(speechPOST, "POST", offer.path, ORG, { token: offer.token, text: offer.text, ...extra });

async function offerFor(ctx: OrgContext, words: string): Promise<SpeechOffer> {
  const o = await speechOffer(ctx, words);
  expect(o).not.toBeNull();
  return o!;
}

async function usageOf(ctx: OrgContext) {
  return adminQuery<{ characters: number; utterances: number; key_source: string }>(
    `SELECT characters, utterances, key_source FROM voice_usage_daily WHERE membership_id = $1 ORDER BY key_source`, [ctx.membership.id]);
}

async function setUsage(ctx: OrgContext, characters: number, source: "environment" | "organisation" = "environment") {
  await adminQuery(
    `INSERT INTO voice_usage_daily(organisation_id, membership_id, day, key_source, characters, utterances) VALUES ($1, $2, $3::date, $4, $5, 1)
     ON CONFLICT (membership_id, day, key_source) DO UPDATE SET characters = EXCLUDED.characters`,
    [ctx.org.id, ctx.membership.id, todayLocal(ctx.org.timezone), source, characters]);
}

/**
 * A workspace key stored before the owner's request (27 October 2026: no workspace keys), while the table is still there
 * (db/pending/0065 drops it); nothing may read it. False once the table is gone.
 */
async function storeOldWorkspaceKey(apiKey = ORG_KEY): Promise<boolean> {
  const [t] = await adminQuery<{ ok: boolean }>(`SELECT to_regclass('public.organisation_voice_secrets') IS NOT NULL AS ok`);
  if (!t.ok) return false;
  await adminQuery(`INSERT INTO organisation_voice_secrets(organisation_id, key_enc, key_hint) VALUES ($1, $2, '…wxyz')
    ON CONFLICT (organisation_id) DO UPDATE SET key_enc = EXCLUDED.key_enc`, [owner.org.id, (await import("@/server/lib/crypto")).encryptSecret(apiKey)]);
  return true;
}

async function bodyOf(r: Response) { return r.json() as Promise<{ code?: string; message?: string; details?: { reason?: string }; fieldErrors?: Record<string, string[]> } & Record<string, unknown>>; }

beforeAll(async () => {
  await resetTestDatabase();
  forget0053();
  a = await buildCompany("a", { names: { owner: "Grace Owner", hr: "Mary HR", manager: "David Lead", employee: "Ada Obi", employee2: "Ben Okafor" } });
  owner = a.ownerCtx; hr = a.hrCtx; ada = a.employeeCtx; ben = a.employee2Ctx;
  // The assistant is in the plan (speech offers need it), as the other assistant tests set it.
  await adminQuery(`UPDATE organisations SET feature_overrides = COALESCE(feature_overrides, '{}'::jsonb) || '{"AI_ASSISTANT": true}'::jsonb WHERE id = $1`, [owner.org.id]);
  for (const c of [owner, hr, ada, ben]) c.plan.features.AI_ASSISTANT = true;
  for (const u of [a.owner, a.hr, a.manager, a.employee, a.employee2]) await sessionFor(u);
});

beforeEach(async () => {
  resetNaturalVoiceForTests();
  resetEl();
  process.env.ELEVENLABS_API_KEY = ENV_KEY;
  reqState.cookie = null; reqState.bearer = null;
  await adminQuery(`DELETE FROM auth_rate_limits`);
  await adminQuery(`DELETE FROM voice_usage_daily`);
  await adminQuery(`DO $$ BEGIN IF to_regclass('public.organisation_voice_secrets') IS NOT NULL THEN DELETE FROM organisation_voice_secrets; END IF; END $$`);
  await adminQuery(`DELETE FROM jobs WHERE type = $1`, [HISTORY_JOB]);
  await adminQuery(`UPDATE brenda_settings SET abilities_off = '{}' WHERE organisation_id = $1`, [owner.org.id]);
});

afterAll(() => {
  setElevenLabsFetchForTests(null);
  if (savedEnvKey === undefined) delete process.env.ELEVENLABS_API_KEY; else process.env.ELEVENLABS_API_KEY = savedEnvKey;
});

// ---- Row security ---------------------------------------------------------------------------------------------------------

describe("the tables' row security", () => {
  it("usage: the person reads their own rows, owners and HR the workspace's, a colleague none", async () => {
    await setUsage(ada, 120);
    await setUsage(ben, 80);
    const read = (u: OrgContext) => appQueryAs(u.user.profileId, `SELECT membership_id, characters FROM voice_usage_daily ORDER BY characters`);
    expect((await read(ada)).map((r) => r.membership_id)).toEqual([ada.membership.id]);
    expect((await read(ben)).map((r) => r.membership_id)).toEqual([ben.membership.id]);
    expect((await read(owner)).map((r) => r.characters)).toEqual([80, 120]);
    expect((await read(hr)).map((r) => r.characters)).toEqual([80, 120]);
    expect(await read(a.managerCtx)).toEqual([]);
  });

  it("usage: the app role cannot insert, change or delete counters, even its own", async () => {
    await setUsage(ada, 120);
    const today = todayLocal(ada.org.timezone);
    await expect(appQueryAs(ada.user.profileId, `INSERT INTO voice_usage_daily(organisation_id, membership_id, day, key_source, characters) VALUES ($1, $2, $3::date, 'organisation', 0)`,
      [ada.org.id, ada.membership.id, today])).rejects.toMatchObject({ code: "42501" });
    expect(await appQueryAs(ada.user.profileId, `UPDATE voice_usage_daily SET characters = 0 WHERE membership_id = $1 RETURNING characters`, [ada.membership.id])).toEqual([]);
    expect(await appQueryAs(owner.user.profileId, `UPDATE voice_usage_daily SET characters = 0 WHERE membership_id = $1 RETURNING characters`, [ada.membership.id])).toEqual([]);
    await expect(appQueryAs(owner.user.profileId, `DELETE FROM voice_usage_daily WHERE membership_id = $1`, [ada.membership.id])).rejects.toMatchObject({ code: "42501" });
    expect((await usageOf(ada))[0].characters).toBe(120);
  });

  it("the chosen voice's format is checked by the database too", async () => {
    await expect(adminQuery(`INSERT INTO assistant_profiles(membership_id, organisation_id, natural_voice) VALUES ($1, $2, '../v1/x')
      ON CONFLICT (membership_id) DO UPDATE SET natural_voice = '../v1/x'`, [ben.membership.id, ben.org.id])).rejects.toMatchObject({ code: "23514" });
  });
});

// ---- The workspace's key (Settings → Brenda → Natural voice) ---------------------------------------------------------------

describe("Boredroom's key, for every workspace (owner request, 27 October 2026: no workspace keys)", () => {
  const path = "/api/orgs/company-a/settings/voice";

  it("employees and managers may not see the status; nobody can add or remove a key any more (410), nothing is stored or asked", async () => {
    for (const u of [a.employee, a.manager]) {
      as(u);
      expect((await call(keyGET, "GET", path, ORG)).status).toBe(403);
    }
    for (const u of [a.owner, a.hr, a.employee]) {
      as(u);
      const r = await call(keyPOST, "POST", path, ORG, { apiKey: ORG_KEY });
      expect(r.status).toBe(410);
      expect(await bodyOf(r)).toMatchObject({ code: "KEYS_REMOVED" });
      expect((await call(keyDELETE, "DELETE", path, ORG)).status).toBe(410);
    }
    expect(await adminQuery(`SELECT 1 FROM audit_events WHERE action IN ('voice.connected', 'voice.disconnected')`)).toEqual([]);
    expect(el.calls).toEqual([]);
  });

  it("on Boredroom's key: only this workspace's own counters and its day, never the key's (every workspace's) month", async () => {
    el.sub = { used: 1234, limit: 38_373 };
    as(a.owner);
    const r = await call(keyGET, "GET", path, ORG);
    expect(r.status).toBe(200);
    const s = await bodyOf(r);
    expect(s).toMatchObject({ ready: true, source: "environment", hint: null, connectedAt: null, month: null, monthError: null, low: false, workspaceMonth: 0, sharedFull: false, historyBlocked: false, historyLeft: 0 });
    // No daily share and no limit per person since the owner's request (12 October 2026: "remove the limit for ElevenLabs
    // voice"); the fields stay at 0 for older pages.
    expect(s.today).toEqual({ used: 0, share: NO_LIMIT });
    expect(s.personDailyLimit).toBe(NO_LIMIT);
    for (const leak of ["1234", "38373"]) expect(JSON.stringify(s)).not.toContain(leak);
    expect(JSON.stringify(s)).not.toContain(ENV_KEY);
    expect(subCalls().map((c) => c.key)).toEqual([ENV_KEY]);
  });

  it("a key the workspace stored before is never read: status, samples and speech all use Boredroom's key", async () => {
    await storeOldWorkspaceKey();
    expect(await voiceConnectionStatus(owner)).toMatchObject({ ready: true, source: "environment", hint: null, connectedAt: null, month: null });
    await saveMyNaturalVoice(ada, { voiceId: LILY });
    as(a.employee);
    const offer = await offerFor(ada, "Your to-do is saved.");
    const said = await speak(offer);
    expect(said.status).toBe(200);
    await said.arrayBuffer();
    expect(ttsCalls().map((c) => c.key)).toEqual([ENV_KEY]);
    expect(await usageOf(ada)).toEqual([{ characters: offer.text.length, utterances: 1, key_source: "environment" }]);
    expect(el.calls.some((c) => c.key === ORG_KEY)).toBe(false);
    // The workspace's characters today and this month, old workspace-key rows included.
    await setUsage(ben, 500, "organisation");
    expect(await voiceConnectionStatus(hr)).toMatchObject({ today: { used: offer.text.length + 500, share: NO_LIMIT }, workspaceMonth: offer.text.length + 500 });
  });

  it("with no key anywhere: none, and nobody's assistant gets an offer", async () => {
    delete process.env.ELEVENLABS_API_KEY;
    expect(await voiceConnectionStatus(owner)).toMatchObject({ ready: true, source: "none", month: null, monthError: null, today: { used: 0, share: 0 } });
    await saveMyNaturalVoice(ada, { voiceId: LILY });
    expect(await speechOffer(ada, "Hello.")).toBeNull();
    expect(await naturalVoiceView(ada)).toMatchObject({ chosen: LILY, available: false, reason: "no_key", samples: false });
    expect(el.calls).toEqual([]);
  });

  it("a rejected Boredroom key reads as upstream", async () => {
    process.env.ELEVENLABS_API_KEY = BAD_KEY;
    await saveMyNaturalVoice(ada, { voiceId: LILY });
    expect(await voiceConnectionStatus(owner)).toMatchObject({ source: "environment", monthError: "upstream" });
    expect(await naturalVoiceView(ada)).toMatchObject({ available: false, reason: "upstream" });
  });
});

// ---- The person's choice ----------------------------------------------------------------------------------------------------

describe("the person's own voice", () => {
  const path = "/api/orgs/company-a/assistant/voice";

  it("starts as the computer voice; any member reads the view", async () => {
    as(a.employee2);
    const r = await call(voiceGET, "GET", path, ORG);
    expect(r.status).toBe(200);
    const v = await bodyOf(r);
    expect(v).toMatchObject({ ready: true, chosen: null, available: false, reason: null, usedToday: 0, personDailyLimit: NO_LIMIT, samples: true });
    expect((v.voices as unknown[]).length).toBe(8);
  });

  it("saves a catalogue voice or null, and refuses anything else", async () => {
    as(a.employee);
    const bad = await call(voicePUT, "PUT", path, ORG, { voiceId: "EXAVITQu4vr4xnSDxMaL" });
    expect(bad.status).toBe(422);
    expect((await call(voicePUT, "PUT", path, ORG, {})).status).toBe(422);
    const ok = await call(voicePUT, "PUT", path, ORG, { voiceId: GEORGE });
    expect(ok.status).toBe(200);
    expect(await bodyOf(ok)).toMatchObject({ ready: true, chosen: GEORGE, available: true, reason: null });
    expect(await adminQuery(`SELECT natural_voice FROM assistant_profiles WHERE membership_id = $1`, [ada.membership.id])).toEqual([{ natural_voice: GEORGE }]);
    const back = await call(voicePUT, "PUT", path, ORG, { voiceId: null });
    expect(await bodyOf(back)).toMatchObject({ chosen: null, available: false, reason: null });
  });

  it("a person with no profile row yet gets one, setup still not done", async () => {
    await adminQuery(`DELETE FROM assistant_profiles WHERE membership_id = $1`, [ben.membership.id]);
    await saveMyNaturalVoice(ben, { voiceId: LILY });
    expect(await adminQuery(`SELECT natural_voice, setup_done_at FROM assistant_profiles WHERE membership_id = $1`, [ben.membership.id])).toEqual([{ natural_voice: LILY, setup_done_at: null }]);
  });

  it("is refused while someone else is signed in as them", async () => {
    const imp = { ...ada, user: { ...ada.user, impersonation: { id: "00000000-0000-4000-8000-0000000000ab", adminEmail: "support@boredroom.test" } } };
    await expect(saveMyNaturalVoice(imp, { voiceId: LILY })).rejects.toMatchObject({ status: 403, code: "FORBIDDEN", message: "Only the person can change their assistant. It stays as it is while someone else is signed in as them." });
  });

  it("Voice switched off for the workspace: no offer, the view says voice_off, the route refuses", async () => {
    await saveMyNaturalVoice(ada, { voiceId: LILY });
    const offer = await offerFor(ada, "Hello there.");
    await adminQuery(`INSERT INTO brenda_settings(organisation_id, abilities_off) VALUES ($1, '{voice}') ON CONFLICT (organisation_id) DO UPDATE SET abilities_off = '{voice}'`, [owner.org.id]);
    expect(await speechOffer(ada, "Hello there.")).toBeNull();
    expect(await naturalVoiceView(ada)).toMatchObject({ reason: "voice_off", available: false });
    as(a.employee);
    const r = await speak(offer);
    expect(r.status).toBe(409);
    expect((await bodyOf(r)).details?.reason).toBe("voice_off");
    expect(ttsCalls()).toEqual([]);
  });
});

// ---- The offer on a chat reply ---------------------------------------------------------------------------------------------

describe("the chat reply's speech offer", () => {
  const path = "/api/orgs/company-a/assistant/chat";
  const ask = { messages: [{ role: "user", content: "What can you do?" }] };

  it("is null with the computer voice, and carries the spoken words with a token for a chosen voice", async () => {
    await saveMyNaturalVoice(ada, { voiceId: null });
    as(a.employee);
    const plain = await call(chatPOST, "POST", path, ORG, ask);
    expect(plain.status).toBe(200);
    const p = await bodyOf(plain);
    expect(typeof p.spoken).toBe("string");
    expect(p.speech).toBeNull();

    await saveMyNaturalVoice(ada, { voiceId: LILY });
    el.calls = []; // the saved view read the subscription (free)
    const r = await call(chatPOST, "POST", path, ORG, ask);
    const b = await bodyOf(r);
    const speech = b.speech as SpeechOffer;
    expect(speech).toMatchObject({ path: "/api/orgs/company-a/assistant/speech" });
    expect(speech.text).toBe(speechText(String(b.spoken)));
    expect(speech.text.length).toBeGreaterThan(0);
    // No ElevenLabs call to make an offer.
    expect(el.calls).toEqual([]);
    // And the words can be said.
    const said = await speak(speech);
    expect(said.status).toBe(200);
    await said.arrayBuffer();
  });

  it("is null without the assistant in the plan", async () => {
    await saveMyNaturalVoice(ada, { voiceId: LILY });
    expect(await speechOffer({ ...ada, plan: { ...ada.plan, features: { ...ada.plan.features, AI_ASSISTANT: false } } }, "Hello.")).toBeNull();
    expect(await speechOffer(ada, "   ")).toBeNull();
  });
});

// ---- The speech route -------------------------------------------------------------------------------------------------------

describe("the speech route", () => {
  beforeEach(async () => { await saveMyNaturalVoice(ada, { voiceId: LILY }); as(a.employee); });

  it("streams the audio with its headers, sends the voice, the words, the model and the speed, and counts the characters", async () => {
    const offer = await offerFor(ada, "I've added **three** to-dos for Friday.");
    const r = await speak(offer, { speed: "faster" });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("audio/mpeg");
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("x-speech-characters")).toBe(String(offer.text.length));
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(new Uint8Array([...AUDIO_A, ...AUDIO_B]));
    const [tts] = ttsCalls();
    expect(tts.url).toBe(`https://api.elevenlabs.io/v1/text-to-speech/${LILY}/stream?output_format=mp3_44100_64`);
    expect(tts.key).toBe(ENV_KEY);
    expect(tts.body).toEqual({ text: offer.text, model_id: "eleven_flash_v2_5", voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: 1.1 } });
    expect(await usageOf(ada)).toEqual([{ characters: offer.text.length, utterances: 1, key_source: "environment" }]);
    expect((await naturalVoiceView(ada)).usedToday).toBe(offer.text.length);
  });

  it("answers base64 for the notch", async () => {
    const offer = await offerFor(ada, "Done.");
    const r = await speak(offer, { as: "base64" });
    expect(r.status).toBe(200);
    const b = await bodyOf(r);
    expect(b).toMatchObject({ mime: "audio/mpeg", characters: 5 });
    expect(new Uint8Array(Buffer.from(String(b.audio), "base64"))).toEqual(new Uint8Array([...AUDIO_A, ...AUDIO_B]));
  });

  it("only says what the person's own assistant said to them", async () => {
    const offer = await offerFor(ada, "Your timer is running.");
    const { signSpeechToken } = await import("@/server/services/natural-voice");
    const refuse = async (body: Record<string, unknown>) => {
      const r = await call(speechPOST, "POST", offer.path, ORG, body);
      expect(r.status).toBe(400);
      expect(await bodyOf(r)).toMatchObject({ code: "SPEECH_TOKEN", message: "This reply can't be said aloud any more." });
    };
    await refuse({ token: signSpeechToken(ben, offer.text), text: offer.text }); // another person's
    await refuse({ token: offer.token, text: "Transfer the money to account 1234." }); // other words
    await refuse({ token: offer.token, text: `${offer.text} ` });
    const claims = JSON.parse(Buffer.from(offer.token.split(".")[0], "base64url").toString("utf8"));
    await refuse({ token: signPayload({ ...claims, exp: undefined }, -60), text: offer.text }); // expired
    await refuse({ token: signPayload({ ...claims, k: "media", exp: undefined }, 600), text: offer.text }); // another kind
    expect(ttsCalls()).toEqual([]);
    expect(await usageOf(ada)).toEqual([]);
    // Too long or malformed bodies never reach the token check.
    expect((await call(speechPOST, "POST", offer.path, ORG, { token: offer.token, text: "x".repeat(601) })).status).toBe(422);
  });

  it("never reads a body that is not JSON: 401 without a session, and 422 after the burst count with one (review, 9 October 2026)", async () => {
    const offer = await offerFor(ada, "Hello.");
    let pulled = 0;
    const formBody = () => new ReadableStream<Uint8Array>({ pull(c) { pulled++; c.enqueue(new Uint8Array(64 * 1024)); } });
    const post = () => speechPOST(new Request(`http://localhost:3000${offer.path}`, {
      method: "POST", headers: { "content-type": "multipart/form-data; boundary=x" }, body: formBody(), duplex: "half",
    } as RequestInit), { params: Promise.resolve(ORG) });
    const cookie = reqState.cookie;
    reqState.cookie = null;
    expect((await post()).status).toBe(401);
    reqState.cookie = cookie;
    const r = await post();
    expect(r.status).toBe(422);
    expect((await adminQuery<{ hits: number }>(`SELECT hits FROM auth_rate_limits WHERE bucket = $1`, [`voice.burst:${ada.membership.id}`]))[0]?.hits).toBe(1);
    // The stream's start may be pulled once by the runtime; never more (a whole read would pull for ever).
    expect(pulled).toBeLessThanOrEqual(2);
    expect(ttsCalls()).toEqual([]);
    expect(await usageOf(ada)).toEqual([]);
  });

  it("refuses without a session (and a workspace the person is not in)", async () => {
    const offer = await offerFor(ada, "Hello.");
    reqState.cookie = null;
    expect((await speak(offer)).status).toBe(401);
    as(a.employee);
    expect((await call(speechPOST, "POST", "/api/orgs/company-b/assistant/speech", { org: "company-b" }, { token: offer.token, text: offer.text })).status).toBe(404);
  });

  const words = "This sentence is a little over forty characters.";
  async function expect409(reason: string) {
    const offer = await offerFor(ada, words);
    const r = await speak(offer);
    expect(r.status).toBe(409);
    const b = await bodyOf(r);
    expect(b.code).toBe("VOICE_UNAVAILABLE");
    expect(b.details?.reason).toBe(reason);
    expect(ttsCalls()).toEqual([]);
  }

  // No limit of Boredroom's (owner request, 12 October 2026: "remove the limit for ElevenLabs voice"; the computer voice
  // used to take over after about six replies). Only ElevenLabs' own refusal for credits stops the natural voice.
  it("no cap is ever applied: a person, a workspace and the key far past every old limit are still said, and counted", async () => {
    // 50,000 characters today for Ada (five times the old person cap), 30,000 for Ben (three times the old workspace cap),
    // and the key 99% used this month (the old stop was 10% left): all still said.
    el.sub = { used: 99_000, limit: 100_000 };
    resetNaturalVoiceForTests();
    await setUsage(ada, 50_000);
    await setUsage(ben, 30_000);
    expect(await naturalVoiceView(ada)).toMatchObject({ available: true, reason: null, personDailyLimit: NO_LIMIT, usedToday: 50_000 });
    const r = await speak(await offerFor(ada, words));
    expect(r.status).toBe(200);
    await r.arrayBuffer();
    expect(ttsCalls()).toHaveLength(1);
    expect((await usageOf(ada))[0].characters).toBe(50_000 + words.length);
    const status = await voiceConnectionStatus(owner);
    expect(status).toMatchObject({ low: false, sharedFull: false, personDailyLimit: NO_LIMIT, today: { used: 80_000 + words.length, share: NO_LIMIT } });
  });

  it("a second workspace on Boredroom's key never takes this one's voice away (no shared day any more)", async () => {
    const b = await buildCompany("b");
    try {
      await adminQuery(`UPDATE organisations SET feature_overrides = COALESCE(feature_overrides, '{}'::jsonb) || '{"AI_ASSISTANT": true}'::jsonb WHERE id = $1`, [b.ownerCtx.org.id]);
      b.employeeCtx.plan.features.AI_ASSISTANT = true;
      await saveMyNaturalVoice(b.employeeCtx, { voiceId: LILY });
      await setUsage(b.employeeCtx, 100_000);
      const theirs = await speechOffer(b.employeeCtx, words);
      const said = await naturalSpeech(b.employeeCtx, { token: theirs!.token, text: theirs!.text, speed: "normal", as: "stream" }, new AbortController().signal);
      await new Response(said.stream).arrayBuffer();
      const mine = await speak(await offerFor(ada, "Done."));
      expect(mine.status).toBe(200);
      await mine.arrayBuffer();
      expect(await naturalVoiceView(ada)).toMatchObject({ available: true, reason: null });
    } finally {
      await adminQuery(`DELETE FROM voice_usage_daily`);
    }
  });

  it("ElevenLabs' own refusal for credits (quota) is the only stop: allowance_low, held, then said again once the breaker lets go", async () => {
    el.tts = () => json(401, { detail: { status: "quota_exceeded" } });
    const first = await speak(await offerFor(ada, words));
    expect(first.status).toBe(502);
    expect((await bodyOf(first)).details?.reason).toBe("allowance_low");
    el.tts = () => audio();
    el.calls = [];
    await expect409("allowance_low");
    expect(await naturalVoiceView(ada)).toMatchObject({ available: false, reason: "allowance_low" });
    // The breaker forgets it (a new plan, or the reset): the natural voice is back, with no cap of Boredroom's.
    resetNaturalVoiceForTests();
    const back = await speak(await offerFor(ada, words));
    expect(back.status).toBe(200);
    await back.arrayBuffer();
  });

  it("409 no_voice when the person has gone back to the computer voice", async () => {
    const offer = await offerFor(ada, "Hello.");
    await saveMyNaturalVoice(ada, { voiceId: null });
    const r = await speak(offer);
    expect(r.status).toBe(409);
    expect((await bodyOf(r)).details?.reason).toBe("no_voice");
  });

  it("402 when the plan no longer has the assistant (a token from before still says nothing)", async () => {
    const offer = await offerFor(ada, "Hello.");
    await adminQuery(`UPDATE organisations SET feature_overrides = feature_overrides || '{"AI_ASSISTANT": false}'::jsonb WHERE id = $1`, [owner.org.id]);
    try {
      const r = await speak(offer);
      expect(r.status).toBe(402);
      expect(ttsCalls()).toEqual([]);
      expect(await usageOf(ada)).toEqual([]);
    } finally {
      await adminQuery(`UPDATE organisations SET feature_overrides = feature_overrides || '{"AI_ASSISTANT": true}'::jsonb WHERE id = $1`, [owner.org.id]);
    }
  });

  it("429 past 60 a minute (the burst limit guards abuse, not use)", async () => {
    await adminQuery(`INSERT INTO auth_rate_limits(bucket, window_start, hits) VALUES ($1, to_timestamp(floor(extract(epoch from now()) / 60) * 60), 60)`, [`voice.burst:${ada.membership.id}`]);
    const offer = await offerFor(ada, "Hello.");
    const r = await speak(offer);
    expect(r.status).toBe(429);
    expect((await bodyOf(r)).message).toBe("That's a lot to say in one minute. Wait a moment, then try again.");
  });

  it.each([
    ["a rejected Boredroom key (401)", () => json(401, { detail: { status: "invalid_api_key" } }), "upstream", "upstream"],
    ["a used-up allowance (401 quota_exceeded)", () => json(401, { detail: { status: "quota_exceeded" } }), "allowance_low", "allowance_low"],
    ["a server error (500)", () => new Response("oops", { status: 500 }), "upstream", "upstream"],
    ["a timeout", () => { throw new ElevenLabsError("timeout"); }, "upstream", "upstream"],
    ["the network", () => { throw new TypeError("fetch failed"); }, "upstream", "upstream"],
  ])("502 on %s: the characters are given back and the breaker holds", async (_label, answer, reason, heldAs) => {
    el.tts = answer as () => Response;
    const offer = await offerFor(ada, words);
    const r = await speak(offer);
    expect(r.status).toBe(502);
    const b = await bodyOf(r);
    // ElevenLabs' own refusal for credits says so (owner request, 12 October 2026: the only stop there is).
    const message = reason === "allowance_low"
      ? "The ElevenLabs plan has run out of credits for this month, so the computer voice is used until it resets or the plan is upgraded."
      : "ElevenLabs didn't answer, so the computer voice is used.";
    expect(b).toMatchObject({ code: "VOICE_UNAVAILABLE", message, details: { reason } });
    expect(await usageOf(ada)).toEqual([{ characters: 0, utterances: 0, key_source: "environment" }]);
    // At once, without asking ElevenLabs again.
    el.tts = () => audio();
    const again = await speak(offer);
    expect(again.status).toBe(409);
    expect((await bodyOf(again)).details?.reason).toBe(heldAs);
    expect(ttsCalls()).toHaveLength(1);
    expect(await naturalVoiceView(ada)).toMatchObject({ available: false, reason: heldAs });
  });

  it("busy (429) on Boredroom's key: 502 and refunded, but never held for every workspace (anyone could cause it)", async () => {
    el.tts = () => json(429, { detail: { status: "too_many_concurrent_requests" } });
    const offer = await offerFor(ada, words);
    const r = await speak(offer);
    expect(r.status).toBe(502);
    expect((await bodyOf(r)).details?.reason).toBe("upstream");
    expect(await usageOf(ada)).toEqual([{ characters: 0, utterances: 0, key_source: "environment" }]);
    el.tts = () => audio();
    const again = await speak(offer);
    expect(again.status).toBe(200);
    await again.arrayBuffer();
    expect(ttsCalls()).toHaveLength(2);
    expect(await naturalVoiceView(ada)).toMatchObject({ available: true, reason: null });
  });

  it("concurrent requests are all said and all counted (no cap to cross since the owner's request, 12 October 2026)", async () => {
    const long = `${"Here is a sentence of plain words to say. ".repeat(7)}End.`.trim(); // about 300 characters
    const offer = await offerFor(ada, long);
    const n = offer.text.length;
    const before = 9_000; // the old person cap was 10,000: these ten would have crossed it
    await setUsage(ada, before);
    const results = await Promise.all(Array.from({ length: 10 }, () => speak(offer)));
    for (const r of results) { expect(r.status).toBe(200); await r.arrayBuffer(); }
    const [u] = await usageOf(ada);
    expect(u.characters).toBe(before + 10 * n);
    expect(ttsCalls()).toHaveLength(10);
  });

  it("works from the notch with its desktop token (bearer), base64", async () => {
    const link = await startLink({ deviceName: "Ada's Mac" }, { ip: "127.0.0.77", origin: "http://localhost:3000" });
    await approveLink(ada.user, { userCode: link.userCode, orgSlug: "company-a" });
    const polled = await pollLink({ deviceCode: link.deviceCode }, { userAgent: "Brenda desktop" });
    const token = (polled as { token: string }).token;
    reqState.cookie = null;
    reqState.bearer = token;
    const offer = await offerFor(ada, "Your timer is running.");
    const r = await speak(offer, { as: "base64" });
    expect(r.status).toBe(200);
    expect((await bodyOf(r)).characters).toBe(offer.text.length);
    // The same desktop token cannot have someone else's words said.
    const { signSpeechToken } = await import("@/server/services/natural-voice");
    const other = await call(speechPOST, "POST", offer.path, ORG, { token: signSpeechToken(ben, offer.text), text: offer.text, as: "base64" });
    expect(other.status).toBe(400);
  });
});

const WORDS = "This sentence is a little over forty characters.";

// ---- What ElevenLabs keeps: the key's History (fix review, 9 October 2026) --------------------------------------------------

describe("deleting what was said from the key's ElevenLabs History", () => {
  beforeEach(async () => { await saveMyNaturalVoice(ada, { voiceId: LILY }); as(a.employee); });
  const envKey = () => ({ apiKey: ENV_KEY, source: "environment" as const, keyRef: "env" });
  const orgKey = (apiKey = ORG_KEY) => ({ apiKey, source: "organisation" as const, keyRef: `org:${owner.org.id}` });

  it("by the request's own id once it has been said (2 s after), never another item with the same words; the job goes", async () => {
    const offer = await offerFor(ada, "Your to-do is saved.");
    el.history = [
      // The key holder typed the same words into ElevenLabs with the same voice, after ours (newest first).
      { history_item_id: "holderplay1", request_id: "reqHolder77", voice_id: LILY, text: offer.text, model_id: "eleven_flash_v2_5" },
      { history_item_id: "nullreq0001", request_id: null, voice_id: LILY, text: offer.text, model_id: "eleven_flash_v2_5" },
      { history_item_id: "thisutterance1", request_id: REQUEST_ID, voice_id: LILY, text: offer.text, model_id: "eleven_flash_v2_5" },
    ];
    const r = await speak(offer);
    expect(r.status).toBe(200);
    await r.arrayBuffer();
    // Queued at once, ids only (never the words), for the worker after the in-process tries.
    await until(async () => expect(await historyJobs()).toHaveLength(1));
    const [job] = await historyJobs();
    expect(job.payload).toEqual({ organisationId: owner.org.id, keyRef: "env", keyHash: expect.stringMatching(/^[0-9a-f]{16}$/), historyItemId: null, requestId: REQUEST_ID, voiceId: LILY, sinceUnix: expect.any(Number) });
    expect(JSON.stringify(job.payload)).not.toContain(offer.text);
    expect(JSON.stringify(job.payload)).not.toContain(ENV_KEY);
    await new Promise((done) => setTimeout(done, 2_300)); // the first try, 2 s after the stream is over
    const list = el.calls.find((c) => c.url.startsWith("https://api.elevenlabs.io/v1/history?"))!;
    expect(list.key).toBe(ENV_KEY);
    expect(new URL(list.url).searchParams.get("voice_id")).toBe(LILY);
    expect(deletesOf()).toEqual(["thisutterance1"]);
    await until(async () => expect(await historyJobs()).toEqual([]));
    expect((await voiceConnectionStatus(owner)).historyBlocked).toBe(false);
  }, 10_000);

  it("by ElevenLabs' history-item-id when the answer gives one (no listing at all)", async () => {
    el.tts = () => audio({ "history-item-id": "HISTitem0042", "request-id": REQUEST_ID });
    const r = await speak(await offerFor(ada, "Done."), { as: "base64" });
    expect(r.status).toBe(200);
    await new Promise((done) => setTimeout(done, 2_300));
    expect(el.calls.filter((c) => c.url.includes("/v1/history?"))).toEqual([]);
    expect(deletesOf()).toEqual(["HISTitem0042"]);
  }, 10_000);

  it("with neither id nothing is deleted at all, whatever the words (Boredroom's key: Boredroom's to see, never a workspace's)", async () => {
    el.history = [{ history_item_id: "holderplay1", request_id: "reqHolder77", voice_id: LILY, text: "Done.", model_id: "eleven_flash_v2_5" }];
    el.tts = () => audio({});
    const r = await speak(await offerFor(ada, "Done."));
    expect(r.status).toBe(200);
    await r.arrayBuffer();
    await until(async () => expect((await historyJobs()).map((j) => [j.state, j.last_error])).toEqual([["failed", "voice history: no id"]]));
    await new Promise((done) => setTimeout(done, 100));
    expect(historyCalls()).toEqual([]);
    as(a.owner);
    expect((await voiceConnectionStatus(owner)).historyLeft).toBe(0);
    expect((await voiceConnectionStatus(hr)).historyLeft).toBe(0);
  });

  it("a lost DELETE answer is retried on the same id only, never another item; the worker's job then finds it gone", async () => {
    el.history = [
      { history_item_id: "thisutterance1", request_id: REQUEST_ID, voice_id: LILY, text: "Done.", model_id: "eleven_flash_v2_5" },
      { history_item_id: "olderdone0001", request_id: null, voice_id: LILY, text: "Done.", model_id: null },
    ];
    let deleted = false;
    el.historyDelete = (id) => {
      if (id === "thisutterance1" && !deleted) { deleted = true; el.history = el.history.filter((i) => i.history_item_id !== id); throw new TypeError("socket hang up"); }
      return json(400, { detail: { status: "invalid_id" } });
    };
    forgetSpoken(owner.org.id, envKey(), { historyItemId: null, requestId: REQUEST_ID, voiceId: LILY, sinceUnix: 0 }, [0, 0, 0]);
    await until(() => expect(deletesOf()).toHaveLength(3));
    expect(deletesOf()).toEqual(["thisutterance1", "thisutterance1", "thisutterance1"]);
    // The job now carries the id it found, and the worker deletes only that one.
    const [job] = await historyJobs();
    expect(job).toMatchObject({ state: "pending", payload: { historyItemId: "thisutterance1", requestId: REQUEST_ID } });
    el.calls = [];
    await runHistoryForgetJob(job.payload);
    expect(deletesOf()).toEqual(["thisutterance1"]);
    expect(historyCalls().filter((c) => c.method === "GET")).toEqual([]);
  });

  it("survives a restart: the worker's job deletes it by its ids alone, with Boredroom's key", async () => {
    // No in-process tries at all (the process went away before the first).
    forgetSpoken(owner.org.id, envKey(), { historyItemId: "HISTitem0077", requestId: null, voiceId: LILY, sinceUnix: 0 }, []);
    await until(async () => expect(await historyJobs()).toHaveLength(1));
    const [job] = await historyJobs();
    expect(job.state).toBe("pending");
    expect(new Date(job.next_run_at).getTime()).toBeGreaterThan(Date.now() + 150_000); // after the in-process tries
    expect(historyCalls()).toEqual([]);
    el.calls = [];
    await runHistoryForgetJob(job.payload);
    expect(el.calls.map((c) => [c.method, c.url.split("/").pop(), c.key])).toEqual([["DELETE", "HISTitem0077", ENV_KEY]]);
    // Boredroom's key replaced since: the new key cannot reach the old account, so nothing is asked.
    el.calls = [];
    process.env.ELEVENLABS_API_KEY = "sk_test_another_env_key_0000000000000000";
    await runHistoryForgetJob(job.payload);
    expect(el.calls).toEqual([]);
  });

  it("a job queued for a workspace's own key before the owner's request (27 October 2026) ends without reading any stored key", async () => {
    await storeOldWorkspaceKey();
    forgetSpoken(owner.org.id, orgKey(), { historyItemId: "HISTitem0078", requestId: null, voiceId: LILY, sinceUnix: 0 }, []);
    await until(async () => expect(await historyJobs()).toHaveLength(1));
    const [job] = await historyJobs();
    el.calls = [];
    await runHistoryForgetJob(job.payload);
    expect(el.calls).toEqual([]);
  });

  it("ElevenLabs failing: the job throws (the worker retries it) with words that carry no ids, key or text; a rejected key is counted", async () => {
    el.historyDelete = () => new Response("down", { status: 503 });
    const payload = { organisationId: owner.org.id, keyRef: "env", keyHash: "x", historyItemId: "HISTitem0099", requestId: null, voiceId: LILY, sinceUnix: 0 };
    const { createHash } = await import("node:crypto");
    payload.keyHash = createHash("sha256").update(ENV_KEY).digest("hex").slice(0, 16);
    await expect(runHistoryForgetJob(payload)).rejects.toThrow(/^voice history: upstream$/);
    el.historyDelete = () => json(401, { detail: { status: "invalid_api_key" } });
    await runHistoryForgetJob(payload);
    expect((await historyJobs()).map((j) => [j.state, j.last_error])).toEqual([["failed", "voice history: key refused"]]);
  });

  it("a revoked old key's answer never blocks the key that replaced it (fix review, 9 October 2026)", async () => {
    el.historyDelete = () => json(401, { detail: { status: "invalid_api_key" } });
    forgetSpoken(owner.org.id, orgKey("sk_test_old_revoked_key_000000000000000"), { historyItemId: "HISTold00001", requestId: null, voiceId: LILY, sinceUnix: 0 }, [0, 0, 0]);
    await until(() => expect(deletesOf()).toEqual(["HISTold00001"]));
    await new Promise((done) => setTimeout(done, 50));
    expect(deletesOf()).toHaveLength(1); // a rejected key stops the tries
    expect((await voiceConnectionStatus(owner)).historyBlocked).toBe(false);
    el.historyDelete = () => json(200, { status: "ok" });
    el.calls = [];
    forgetSpoken(owner.org.id, orgKey(), { historyItemId: "HISTnew00001", requestId: null, voiceId: LILY, sinceUnix: 0 }, [0]);
    await until(() => expect(deletesOf()).toEqual(["HISTnew00001"]));
  });

  it("Boredroom's key without History access is never a workspace's warning (Boredroom's log instead)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      el.historyDelete = () => json(401, { detail: { status: "missing_permissions" } });
      forgetSpoken(owner.org.id, envKey(), { historyItemId: "HISTenv00001", requestId: null, voiceId: LILY, sinceUnix: 0 }, [0]);
      await until(() => expect(warn).toHaveBeenCalledWith(expect.stringMatching(/Boredroom's ElevenLabs key has no History access/)));
      expect(await voiceConnectionStatus(owner)).toMatchObject({ source: "environment", historyBlocked: false, historyLeft: 0 });
      for (const c of warn.mock.calls) expect(String(c[0])).not.toContain(ENV_KEY);
    } finally { warn.mockRestore(); }
  });

  it("stopped while ElevenLabs is still answering: the answer's ids are waited for, the audio is cancelled and the item deleted (not refunded: it was made)", async () => {
    const ctl = new AbortController();
    let release!: () => void;
    el.tts = () => new Promise<Response>((done) => { release = () => done(audio({ "history-item-id": "HISTstop0001" })); });
    const offer = await offerFor(ada, WORDS);
    const p = naturalSpeech(ada, { token: offer.token, text: offer.text, speed: "normal", as: "stream" }, ctl.signal).then(() => null, (e) => e);
    await until(() => expect(ttsCalls()).toHaveLength(1));
    ctl.abort();
    release();
    expect(await p).toMatchObject({ status: 502, code: "VOICE_UNAVAILABLE" });
    expect(await usageOf(ada)).toEqual([{ characters: offer.text.length, utterances: 1, key_source: "environment" }]);
    await new Promise((done) => setTimeout(done, 2_300));
    expect(deletesOf()).toEqual(["HISTstop0001"]);
  }, 10_000);
});

describe("a request the person left before it reached ElevenLabs (fix review, 9 October 2026)", () => {
  beforeEach(async () => { await saveMyNaturalVoice(ada, { voiceId: LILY }); as(a.employee); });

  it("already gone: nothing reserved, nothing sent", async () => {
    const ctl = new AbortController();
    ctl.abort();
    const offer = await offerFor(ada, WORDS);
    await expect(naturalSpeech(ada, { token: offer.token, text: offer.text, speed: "normal", as: "stream" }, ctl.signal)).rejects.toMatchObject({ status: 502 });
    expect(ttsCalls()).toEqual([]);
    expect(await usageOf(ada)).toEqual([]);
  });

  it("gone while it was being counted: given back, nothing sent", async () => {
    // Nothing waits for the subscription any more (no caps: owner request, 12 October 2026), so the request is gone just
    // after it starts, before ElevenLabs is asked.
    const ctl = new AbortController();
    const offer = await offerFor(ada, WORDS);
    const p = naturalSpeech(ada, { token: offer.token, text: offer.text, speed: "normal", as: "stream" }, ctl.signal).then(() => null, (e) => e);
    queueMicrotask(() => ctl.abort());
    expect(await p).toMatchObject({ status: 502 });
    expect(ttsCalls()).toEqual([]);
    expect((await usageOf(ada)).map((u) => u.characters)).not.toContain(offer.text.length);
    expect((await usageOf(ada)).reduce((n, u) => n + u.characters, 0)).toBe(0);
  });

  it("ElevenLabs answered an error just as the person left: given back (not billed)", async () => {
    const ctl = new AbortController();
    el.tts = () => { ctl.abort(); return new Response("oops", { status: 500 }); };
    const offer = await offerFor(ada, WORDS);
    await expect(naturalSpeech(ada, { token: offer.token, text: offer.text, speed: "normal", as: "stream" }, ctl.signal)).rejects.toMatchObject({ status: 502 });
    expect(await usageOf(ada)).toEqual([{ characters: 0, utterances: 0, key_source: "environment" }]);
  });
});

describe("the subscription cache across the workspace's midnight (fix review, 9 October 2026)", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("a new day's count starts from nothing (no share to work out any more)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-07T22:55:00Z"));
    el.sub = { used: 32_000, limit: 38_373 };
    el.resetUnix = Math.floor(Date.parse("2026-11-09T07:47:00Z") / 1000);
    await setUsage(ada, 3000);
    const before = await voiceConnectionStatus(owner);
    expect(before.today).toEqual({ used: 3000, share: NO_LIMIT });
    // Boredroom's key: its month is every workspace's, never shown to one.
    expect(before.month).toBeNull();
    expect(subCalls()).toHaveLength(1);
    // 00:03 on 8 November in Lagos: a new day, so today's count starts from nothing; the month is ElevenLabs' own figure.
    vi.setSystemTime(new Date("2026-11-07T23:03:00Z"));
    const after = await voiceConnectionStatus(owner);
    expect(after.today).toEqual({ used: 0, share: NO_LIMIT });
    expect(after.workspaceMonth).toBe(3000);
  });
});

// ---- A slow link (review, 9 October 2026: the natural voice's latency over a phone's hotspot) -------------------------------

/**
 * Counts the statements the app's pool sends while `fn` runs (each is one round trip to the database: BEGIN with its
 * settings is one, a batch with its COMMIT is one). Only the pool's connections: adminQuery is not called meanwhile.
 */
async function roundTrips<T>(fn: () => Promise<T>): Promise<{ result: T; sql: string[] }> {
  const sql: string[] = [];
  const orig = pg.Client.prototype.query;
  pg.Client.prototype.query = function (this: pg.Client, ...args: unknown[]) {
    const text = typeof args[0] === "string" ? args[0] : (args[0] as { text?: string } | null)?.text ?? "";
    sql.push(text.replace(/\s+/g, " ").trim());
    return (orig as (...a: unknown[]) => unknown).apply(this, args);
  } as typeof orig;
  try { return { result: await fn(), sql }; } finally { pg.Client.prototype.query = orig; }
}

describe("the speech route on a slow link (review, 9 October 2026)", () => {
  beforeEach(async () => { await saveMyNaturalVoice(ada, { voiceId: LILY }); as(a.employee); });
  afterEach(() => { vi.useRealTimers(); });
  const burstHits = async () => (await adminQuery<{ hits: number }>(`SELECT hits FROM auth_rate_limits WHERE bucket = $1`, [`voice.burst:${ada.membership.id}`]))[0]?.hits ?? 0;

  it("warm, four round trips from the request to ElevenLabs: BEGIN, the session with the membership and plan, the person's reads with the burst limit, the count with its COMMIT", async () => {
    const offer = await offerFor(ada, WORDS);
    const first = await speak(offer); // the schema flags and the subscription, once
    await first.arrayBuffer();
    await until(async () => expect(await historyJobs()).toHaveLength(1)); // its History job, queued after the stream
    const { result: r, sql } = await roundTrips(() => speak(offer));
    expect(r.status).toBe(200);
    expect(sql).toHaveLength(4);
    expect(sql[0]).toMatch(/^BEGIN; SELECT set_config\('app.role', 'system', true\)$/);
    expect(sql[1]).toMatch(/auth_sessions/);
    expect(sql[2]).toMatch(/INSERT INTO auth_rate_limits/);
    // No caps since the owner's request (12 October 2026): no lock and no reservation, one upsert with the COMMIT.
    expect(sql[3]).toMatch(/^INSERT INTO voice_usage_daily/);
    expect(sql[3]).toMatch(/; COMMIT$/);
    await r.arrayBuffer();
    expect(await usageOf(ada)).toEqual([{ characters: 2 * offer.text.length, utterances: 2, key_source: "environment" }]);
    expect(await burstHits()).toBe(2);
  });

  it("the burst limit still counts a bad token or a malformed body, never a 402, and a 429 counts nothing more", async () => {
    const offer = await offerFor(ada, WORDS);
    expect((await call(speechPOST, "POST", offer.path, ORG, { token: `${offer.token}x`, text: offer.text })).status).toBe(400);
    expect((await call(speechPOST, "POST", offer.path, ORG, { token: offer.token })).status).toBe(422);
    expect(await burstHits()).toBe(2);
    await adminQuery(`UPDATE organisations SET feature_overrides = feature_overrides || '{"AI_ASSISTANT": false}'::jsonb WHERE id = $1`, [owner.org.id]);
    try {
      expect((await speak(offer)).status).toBe(402);
    } finally {
      await adminQuery(`UPDATE organisations SET feature_overrides = feature_overrides || '{"AI_ASSISTANT": true}'::jsonb WHERE id = $1`, [owner.org.id]);
    }
    expect(await burstHits()).toBe(2);
    await adminQuery(`UPDATE auth_rate_limits SET hits = 60 WHERE bucket = $1`, [`voice.burst:${ada.membership.id}`]);
    expect((await speak(offer)).status).toBe(429);
    expect(await burstHits()).toBe(60);
    expect(ttsCalls()).toEqual([]);
    expect(await usageOf(ada)).toEqual([]);
  });

  // No caps since the owner's request (12 October 2026): neither the reply's offer nor the Listen reads the key's
  // subscription, so a slow ElevenLabs account page never delays the natural voice.
  it("a slow subscription never delays the Listen: speaking never reads it", async () => {
    resetNaturalVoiceForTests();
    el.subDelayMs = 2_000;
    const offer = await offerFor(ada, WORDS);
    const started = performance.now();
    const r = await speak(offer);
    expect(r.status).toBe(200);
    expect(performance.now() - started).toBeLessThan(1_500);
    await r.arrayBuffer();
    expect(subCalls()).toEqual([]);
    expect(ttsCalls()).toHaveLength(1);
  }, 10_000);

  it("a token signed without a reply (a process restarted between reply and Listen): one transaction, no lock, counted", async () => {
    resetNaturalVoiceForTests();
    const { signSpeechToken } = await import("@/server/services/natural-voice");
    const offer: SpeechOffer = { path: "/api/orgs/company-a/assistant/speech", token: signSpeechToken(ada, WORDS), text: WORDS };
    const { result: r, sql } = await roundTrips(() => speak(offer));
    expect(r.status).toBe(200);
    await r.arrayBuffer();
    expect(sql.filter((q) => /^BEGIN/.test(q))).toHaveLength(1);
    expect(sql.filter((q) => /pg_advisory_xact_lock/.test(q))).toHaveLength(0);
    expect(await usageOf(ada)).toEqual([{ characters: offer.text.length, utterances: 1, key_source: "environment" }]);
    expect(await burstHits()).toBe(1);
  });

  it("orgContext is one statement in one transaction (three round trips), with the same plan as before", async () => {
    as(a.employee);
    const { result: r, sql } = await roundTrips(() => call(voiceGET, "GET", "/api/orgs/company-a/assistant/voice", ORG));
    expect(r.status).toBe(200);
    // orgContext: BEGIN, the statement, COMMIT; the view: BEGIN, its reads, COMMIT (the subscription is held).
    expect(sql.filter((q) => /^BEGIN/.test(q))).toHaveLength(2);
    expect(sql.filter((q) => /^COMMIT/.test(q))).toHaveLength(2);
    expect(sql.filter((q) => /platform_settings/.test(q) && !/auth_sessions/.test(q))).toEqual([]);
    expect(sql.length).toBeLessThanOrEqual(6);
  });
});

// ---- Samples ----------------------------------------------------------------------------------------------------------------

describe("voice samples", () => {
  const path = (id: string) => `/api/orgs/company-a/assistant/voice/samples/${id}`;

  it("answers the preview MP3 as our own audio, cached: the second time makes no request", async () => {
    as(a.employee2);
    const r = await call(sampleGET, "GET", path(LILY), { org: "company-a", voiceId: LILY });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("audio/mpeg");
    expect(r.headers.get("cache-control")).toBe("private, max-age=86400");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(SAMPLE);
    expect(el.calls.map((c) => [c.url, c.key])).toEqual([[`https://api.elevenlabs.io/v1/voices/${LILY}`, ENV_KEY], [PREVIEW, null]]);
    el.calls = [];
    const again = await call(sampleGET, "GET", path(LILY), { org: "company-a", voiceId: LILY });
    expect(new Uint8Array(await again.arrayBuffer())).toEqual(SAMPLE);
    expect(el.calls).toEqual([]);
    // Safari asks for a range.
    const part = await call(sampleGET, "GET", path(LILY), { org: "company-a", voiceId: LILY }, undefined, { range: "bytes=0-1" });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe(`bytes 0-1/${SAMPLE.length}`);
    expect(ttsCalls()).toEqual([]);
  });

  it("404s a voice that is not offered, and 409s with no key", async () => {
    as(a.employee2);
    expect((await call(sampleGET, "GET", path("EXAVITQu4vr4xnSDxMaL"), { org: "company-a", voiceId: "EXAVITQu4vr4xnSDxMaL" })).status).toBe(404);
    expect((await call(sampleGET, "GET", path("..%2Fuser"), { org: "company-a", voiceId: "../user" })).status).toBe(404);
    delete process.env.ELEVENLABS_API_KEY;
    const r = await call(sampleGET, "GET", path(GEORGE), { org: "company-a", voiceId: GEORGE });
    expect(r.status).toBe(409);
    expect((await bodyOf(r)).details?.reason).toBe("no_key");
    expect(el.calls).toEqual([]);
  });

  it("needs a session", async () => {
    reqState.cookie = null;
    expect((await call(sampleGET, "GET", path(LILY), { org: "company-a", voiceId: LILY })).status).toBe(401);
  });
});
