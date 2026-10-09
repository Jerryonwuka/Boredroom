/**
 * Before migration 0053 (owner decision, 9 October 2026: natural voice (ElevenLabs), contract C.2): the code ships before
 * the database update (a deploy, the running dev server), so nobody has a natural voice and nothing throws: the views say
 * `ready: false` / `not_ready`, replies carry no speech offer, the speech route answers 409 `not_ready`, saving a voice
 * and connecting or removing a key answer 503 NOT_READY (without asking ElevenLabs anything), and the chat still answers.
 * Then 0053 is applied twice by hand: no error, and natural voices work. The test schema is built from every migration
 * before 0053.
 *
 * ElevenLabs is mocked (setElevenLabsFetchForTests) and the key is made up. Local test database only. No model.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const reqState = vi.hoisted(() => ({ cookie: null as string | null }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "boredroom_session" && reqState.cookie ? { name, value: reqState.cookie } : undefined) }),
  headers: async () => new Headers(),
}));

import { adminQuery, adminUrl } from "../helpers/db";
import { buildCompany, type CompanyFixture, type FixtureUser } from "@/server/services/fixtures";
import { withSystem, withUser } from "@/server/db";
import { issueSession } from "@/server/auth";
import { forget0053, schema0053Ready } from "@/server/lib/schema-0053";
import { setElevenLabsFetchForTests } from "@/server/services/elevenlabs";
import {
  clearVoiceKey, naturalVoiceView, readMyNaturalVoice, resetNaturalVoiceForTests, saveMyNaturalVoice, setVoiceKey, signSpeechToken,
  speechOffer, voiceConnectionStatus,
} from "@/server/services/natural-voice";
import { POST as speechPOST } from "@/app/api/orgs/[org]/assistant/speech/route";
import { GET as voiceGET, PUT as voicePUT } from "@/app/api/orgs/[org]/assistant/voice/route";
import { GET as keyGET, POST as keyPOST, DELETE as keyDELETE } from "@/app/api/orgs/[org]/settings/voice/route";
import { POST as chatPOST } from "@/app/api/orgs/[org]/assistant/chat/route";
import type { OrgContext } from "@/server/lib/api";

delete process.env.ANTHROPIC_API_KEY;
const savedEnvKey = process.env.ELEVENLABS_API_KEY;
const ENV_KEY = "sk_test_boredroom_env_key_0000000000000002";
process.env.ELEVENLABS_API_KEY = ENV_KEY;
const LILY = "pFZP5JQG7iQjIQuC4Bku";
const MIGRATION = join(process.cwd(), "db", "migrations", "0053_natural_voice.sql");
const NOT_READY = { status: 503, code: "NOT_READY", message: "Natural voices need a database update first. Try again later." };

const elCalls: string[] = [];
setElevenLabsFetchForTests((async (input: RequestInfo | URL) => {
  const url = String(input);
  elCalls.push(url);
  if (url.endsWith("/v1/user/subscription")) {
    return new Response(JSON.stringify({ tier: "starter", character_count: 0, character_limit: 1_000_000, next_character_count_reset_unix: Math.floor(Date.now() / 1000) + 20 * 86_400 }), { status: 200 });
  }
  if (url.includes("/v1/text-to-speech/")) return new Response(new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 1]), { status: 200 });
  throw new TypeError(`unexpected ElevenLabs request in a test: ${url}`);
}) as typeof fetch);

let a: CompanyFixture;
let owner: OrgContext, ada: OrgContext;
const sessions = new Map<string, string>();
const ORG = { org: "company-a" };

function as(u: FixtureUser) { reqState.cookie = sessions.get(u.email) ?? null; }
type Handler<P> = (req: Request, ctx: { params: Promise<P> }) => Promise<Response>;
async function call<P>(handler: Handler<P>, method: string, path: string, params: P, body?: unknown): Promise<Response> {
  const init: RequestInit = { method, headers: body !== undefined ? { "content-type": "application/json" } : {} };
  if (body !== undefined) init.body = JSON.stringify(body);
  return handler(new Request(`http://localhost:3000${path}`, init), { params: Promise.resolve(params) });
}

/** As resetTestDatabase, but stopping before 0053. */
async function schemaBefore0053() {
  const c = new Client({ connectionString: adminUrl() });
  await c.connect();
  try {
    await c.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT USAGE ON SCHEMA public TO PUBLIC;");
    await c.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    const dir = join(process.cwd(), "db", "migrations");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql") && f < "0053").sort()) {
      await c.query("BEGIN");
      await c.query(readFileSync(join(dir, file), "utf8"));
      await c.query("INSERT INTO schema_migrations(name) VALUES ($1)", [file]);
      await c.query("COMMIT");
    }
  } finally { await c.end(); }
  await adminQuery("UPDATE plans SET max_users = NULL WHERE code = 'free'");
}

/** The migration's SQL as the runner applies it: one file, one transaction. */
async function apply0053() {
  const c = new Client({ connectionString: adminUrl() });
  await c.connect();
  try {
    await c.query("BEGIN");
    await c.query(readFileSync(MIGRATION, "utf8"));
    await c.query("COMMIT");
  } catch (err) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally { await c.end(); }
}

beforeAll(async () => {
  await schemaBefore0053();
  forget0053();
  resetNaturalVoiceForTests();
  expect(await adminQuery("SELECT to_regclass('public.voice_usage_daily') IS NULL AS missing")).toEqual([{ missing: true }]);
  a = await buildCompany("a", { names: { owner: "Grace Owner", hr: "Mary HR", manager: "David Lead", employee: "Ada Obi", employee2: "Ben Okafor" } });
  owner = a.ownerCtx; ada = a.employeeCtx;
  await adminQuery(`UPDATE organisations SET feature_overrides = COALESCE(feature_overrides, '{}'::jsonb) || '{"AI_ASSISTANT": true}'::jsonb WHERE id = $1`, [owner.org.id]);
  for (const c of [owner, ada]) c.plan.features.AI_ASSISTANT = true;
  for (const u of [a.owner, a.employee]) sessions.set(u.email, await withSystem((db) => issueSession(db, u.authUserId, { method: "password" })));
});

afterAll(() => {
  setElevenLabsFetchForTests(null);
  if (savedEnvKey === undefined) delete process.env.ELEVENLABS_API_KEY; else process.env.ELEVENLABS_API_KEY = savedEnvKey;
});

describe("before 0053, nobody has a natural voice and nothing throws", () => {
  it("the readiness check says not yet", async () => {
    expect(await withUser(ada.user.profileId, (db) => schema0053Ready(db))).toBe(false);
    expect(await withUser(ada.user.profileId, (db) => readMyNaturalVoice(db, ada.membership.id))).toBeNull();
  });

  it("the person's view: ready false, not_ready, the eight voices still listed", async () => {
    const v = await naturalVoiceView(ada);
    expect(v).toMatchObject({ ready: false, chosen: null, available: false, reason: "not_ready", usedToday: 0, personDailyLimit: 2000 });
    expect(v.voices).toHaveLength(8);
    as(a.employee);
    const r = await call(voiceGET, "GET", "/api/orgs/company-a/assistant/voice", ORG);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ready: false, reason: "not_ready" });
  });

  it("the owners' status: ready false, the source from the server's key only", async () => {
    expect(await voiceConnectionStatus(owner)).toEqual({
      ready: false, source: "environment", hint: null, connectedAt: null, month: null, monthError: null, low: false,
      workspaceMonth: 0, today: { used: 0, share: 0 }, sharedFull: false, historyBlocked: false, historyLeft: 0, personDailyLimit: 2000,
    });
    delete process.env.ELEVENLABS_API_KEY;
    expect((await voiceConnectionStatus(owner)).source).toBe("none");
    process.env.ELEVENLABS_API_KEY = ENV_KEY;
    as(a.owner);
    const r = await call(keyGET, "GET", "/api/orgs/company-a/settings/voice", ORG);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ready: false, source: "environment" });
  });

  it("choosing a voice and connecting or removing a key answer 503, without asking ElevenLabs", async () => {
    await expect(saveMyNaturalVoice(ada, { voiceId: LILY })).rejects.toMatchObject(NOT_READY);
    await expect(setVoiceKey(owner, { apiKey: "sk_test_workspace_org_key_000000000000abcd" })).rejects.toMatchObject(NOT_READY);
    await expect(clearVoiceKey(owner)).rejects.toMatchObject(NOT_READY);
    as(a.employee);
    const put = await call(voicePUT, "PUT", "/api/orgs/company-a/assistant/voice", ORG, { voiceId: LILY });
    expect(put.status).toBe(503);
    expect(await put.json()).toMatchObject({ code: "NOT_READY", message: NOT_READY.message });
    as(a.owner);
    expect((await call(keyPOST, "POST", "/api/orgs/company-a/settings/voice", ORG, { apiKey: "sk_test_workspace_org_key_000000000000abcd" })).status).toBe(503);
    expect((await call(keyDELETE, "DELETE", "/api/orgs/company-a/settings/voice", ORG)).status).toBe(503);
    expect(elCalls).toEqual([]);
  });

  it("replies carry no offer; the chat still answers", async () => {
    expect(await speechOffer(ada, "Hello there.")).toBeNull();
    as(a.employee);
    const r = await call(chatPOST, "POST", "/api/orgs/company-a/assistant/chat", ORG, { messages: [{ role: "user", content: "What can you do?" }] });
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(typeof b.reply).toBe("string");
    expect(b.speech).toBeNull();
  });

  it("the speech route answers 409 not_ready, even for a genuine token", async () => {
    as(a.employee);
    const text = "Hello there.";
    const r = await call(speechPOST, "POST", "/api/orgs/company-a/assistant/speech", ORG, { token: signSpeechToken(ada, text), text });
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ code: "VOICE_UNAVAILABLE", details: { reason: "not_ready" } });
    expect(elCalls).toEqual([]);
  });
});

describe("then 0053 is applied (twice, by hand)", () => {
  it("applies cleanly twice, one of each object", async () => {
    await apply0053();
    await apply0053();
    expect(await adminQuery(`SELECT count(*)::int AS n FROM pg_policies WHERE tablename IN ('organisation_voice_secrets', 'voice_usage_daily')`)).toEqual([{ n: 4 }]);
    expect(await adminQuery(`SELECT count(*)::int AS n FROM pg_constraint WHERE conname = 'assistant_profiles_natural_voice_check'`)).toEqual([{ n: 1 }]);
    expect(await adminQuery(`SELECT count(*)::int AS n FROM pg_indexes WHERE tablename = 'voice_usage_daily'`)).toEqual([{ n: 3 }]);
  });

  it("natural voices work once the readiness cache is forgotten (as within 30 seconds in a running server)", async () => {
    forget0053();
    expect(await withUser(ada.user.profileId, (db) => schema0053Ready(db))).toBe(true);
    const v = await saveMyNaturalVoice(ada, { voiceId: LILY });
    expect(v).toMatchObject({ ready: true, chosen: LILY, available: true, reason: null });
    const offer = await speechOffer(ada, "Hello there.");
    expect(offer).toMatchObject({ path: "/api/orgs/company-a/assistant/speech", text: "Hello there." });
    as(a.employee);
    const r = await call(speechPOST, "POST", offer!.path, ORG, { token: offer!.token, text: offer!.text, as: "base64" });
    expect(r.status).toBe(200);
    expect((await r.json()).characters).toBe(12);
    expect(await adminQuery(`SELECT characters FROM voice_usage_daily WHERE membership_id = $1`, [ada.membership.id])).toEqual([{ characters: 12 }]);
  });
});
