/**
 * LiveKit's webhooks (owner decisions, 8 October 2026: phase 8, D15, contract C.5): payloads signed as LiveKit signs them
 * (a token from the API key and secret carrying the body's sha256), with a made-up project's key and secret. Before
 * migration 0054 a verified webhook is ignored; a bad signature, a changed body or none at all is refused (401); a room
 * that is not one of ours is ignored; `room_finished` ends a live call ('empty') and marks its room closed;
 * `participant_left` only settles (heartbeats decide); `participant_joined` takes out at once anyone without a place in
 * the call (someone who left and came back with the token they kept, someone never on it), keeps whoever is in it, and
 * deletes the room of an ended call again (fix review, 10 October 2026: LiveKit cannot revoke a join token). LiveKit
 * itself is faked.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const KEY = "APItestkey";
const SECRET = "test-secret-that-is-long-enough-000000000000";
process.env.LIVEKIT_URL = "wss://test.livekit.invalid";
process.env.LIVEKIT_API_KEY = KEY;
process.env.LIVEKIT_API_SECRET = SECRET;

import { AccessToken } from "livekit-server-sdk";
import { adminQuery, adminUrl } from "../helpers/db";
import { buildCompany, type CompanyFixture } from "@/server/services/fixtures";
import { forget0054 } from "@/server/lib/schema-0054";
import { setLiveKitForTests } from "@/server/lib/livekit";
import { joinCall, leaveCall, startCall } from "@/server/services/calls";
import { openChannel } from "@/server/services/messaging";
import { POST as webhookPOST } from "@/app/api/livekit/webhook/route";

let a: CompanyFixture;
// LiveKit, faked: what was asked of it.
const lk = { removed: [] as { room: string; identity: string }[], deleted: [] as string[] };

async function signed(body: string, secret = SECRET): Promise<string> {
  const at = new AccessToken(KEY, secret);
  at.sha256 = createHash("sha256").update(body).digest("base64");
  return at.toJwt();
}
function event(name: string, room: string, identity?: string): string {
  return JSON.stringify({
    event: name, id: `EV_${Math.random().toString(36).slice(2)}`, createdAt: String(Math.floor(Date.now() / 1000)),
    room: { sid: "RM_test", name: room, numParticipants: 0 },
    ...(identity ? { participant: { sid: "PA_test", identity, name: "Someone", state: "DISCONNECTED" } } : {}),
  });
}
async function post(body: string, authorization: string | null): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/webhook+json" };
  if (authorization !== null) headers.authorization = authorization;
  return webhookPOST(new Request("http://localhost:3000/api/livekit/webhook", { method: "POST", headers, body }), { params: Promise.resolve({}) });
}
async function until(check: () => Promise<boolean>, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await check()) return true; await new Promise((r) => setTimeout(r, 50)); }
  return check();
}

async function migrate(upTo: string | null, only?: string) {
  const c = new Client({ connectionString: adminUrl() });
  await c.connect();
  try {
    if (!only) await c.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT USAGE ON SCHEMA public TO PUBLIC;");
    const dir = join(process.cwd(), "db", "migrations");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql") && (only ? f.startsWith(only) : f < upTo!)).sort()) {
      await c.query("BEGIN"); await c.query(readFileSync(join(dir, file), "utf8")); await c.query("COMMIT");
    }
  } finally { await c.end(); }
}

beforeAll(async () => {
  await migrate("0054");
  await adminQuery("UPDATE plans SET max_users = NULL WHERE code = 'free'");
  forget0054();
  setLiveKitForTests({
    listRooms: async () => [], listParticipants: async () => [],
    deleteRoom: async (room) => { lk.deleted.push(room); },
    removeParticipant: async (room, identity) => { lk.removed.push({ room, identity }); },
  });
  a = await buildCompany("a");
});
afterAll(() => { setLiveKitForTests(null); });

describe("LiveKit's webhook", () => {
  it("before 0054 a verified webhook is ignored", async () => {
    const body = event("room_finished", "call-11111111-1111-4111-8111-111111111111");
    const r = await post(body, await signed(body));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ignored: true });
  });

  it("a bad signature, a changed body or no signature at all is refused", async () => {
    await migrate(null, "0054");
    forget0054();
    const body = event("room_finished", "call-11111111-1111-4111-8111-111111111111");
    for (const [b, auth] of [[body, await signed(body, "another-secret-that-is-long-enough-0000000")], [`${body} `, await signed(body)], [body, null], [body, "Bearer nonsense"]] as const) {
      const r = await post(b, auth);
      expect(r.status).toBe(401);
      expect(await r.json()).toMatchObject({ code: "BAD_SIGNATURE" });
    }
  });

  it("a room that is not one of ours is ignored", async () => {
    for (const room of ["boredroom-research-abc", "call-123", "call_11111111-1111-4111-8111-111111111111"]) {
      const body = event("room_finished", room);
      expect(await (await post(body, await signed(body))).json()).toEqual({ ignored: true });
    }
  });

  it("room_finished ends a live call as empty and marks its room closed; participant_left only settles", async () => {
    const s = await startCall(a.employeeCtx, { to: a.employee2Ctx.membership.id });
    await joinCall(a.employee2Ctx, s.call.id);
    const left = event("participant_left", s.call.room, a.employee2Ctx.membership.id);
    expect(await (await post(left, await signed(left))).json()).toEqual({ ok: true });
    await new Promise((r) => setTimeout(r, 300));
    expect((await adminQuery<{ state: string }>(`SELECT state FROM calls WHERE id = $1`, [s.call.id]))[0].state).toBe("active");

    const finished = event("room_finished", s.call.room);
    const r = await post(finished, await signed(finished));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(await until(async () => (await adminQuery<{ room_closed_at: string | null }>(`SELECT room_closed_at FROM calls WHERE id = $1`, [s.call.id]))[0].room_closed_at !== null)).toBe(true);
    expect((await adminQuery(`SELECT state, end_reason FROM calls WHERE id = $1`, [s.call.id]))[0]).toEqual({ state: "ended", end_reason: "empty" });
    // Once more (LiveKit retries): nothing changes.
    const again = await post(finished, await signed(finished));
    expect(again.status).toBe(200);
    await new Promise((r) => setTimeout(r, 200));
    expect((await adminQuery(`SELECT end_reason FROM calls WHERE id = $1`, [s.call.id]))[0]).toEqual({ end_reason: "empty" });
    expect(await adminQuery(`SELECT body FROM messages WHERE call_id = $1`, [s.call.id])).toEqual([{ body: "Call, under a minute" }]);
  });

  it("participant_joined takes out at once anyone without a place in the call, keeps whoever is in it, and deletes an ended call's room again", async () => {
    const ada = a.employeeCtx, ben = a.employee2Ctx, david = a.managerCtx, olu = a.ownerCtx;
    const joined = async (room: string, identity: string) => {
      const body = event("participant_joined", room, identity);
      expect(await (await post(body, await signed(body))).json()).toEqual({ ok: true });
    };
    // A team call in #Design: David starts it, Ada joins, then leaves; it goes on with David.
    const design = await openChannel(david, a.teamId);
    const s = await startCall(david, { conversationId: design });
    await joinCall(ada, s.call.id);
    await leaveCall(ada, s.call.id);
    lk.removed = []; lk.deleted = [];
    // David is in it: kept.
    await joined(s.call.room, david.membership.id);
    await new Promise((r) => setTimeout(r, 300));
    expect(lk.removed).toEqual([]);
    // Ada comes back to the room with the token she kept: out at once (no heartbeat, no sweep needed).
    await joined(s.call.room, ada.membership.id);
    expect(await until(async () => lk.removed.some((x) => x.identity === ada.membership.id))).toBe(true);
    expect(lk.removed).toEqual([{ room: s.call.room, identity: ada.membership.id }]);
    // Someone never on it (the owner, who does not read #Design), or not a member id at all: out too.
    lk.removed = [];
    await joined(s.call.room, olu.membership.id);
    await joined(s.call.room, "not-a-membership");
    expect(await until(async () => lk.removed.length === 2)).toBe(true);
    expect(lk.removed.map((x) => x.identity).sort()).toEqual([olu.membership.id, "not-a-membership"].sort());
    expect((await adminQuery<{ state: string }>(`SELECT state FROM calls WHERE id = $1`, [s.call.id]))[0].state).toBe("active");
    // Someone the channel no longer has, though their row still says joined (no settle ran yet): the webhook settles
    // first, so they are out too.
    await joinCall(ben, s.call.id);
    await adminQuery(`DELETE FROM team_members WHERE team_id = $1 AND membership_id = $2`, [a.teamId, ben.membership.id]);
    lk.removed = [];
    await joined(s.call.room, ben.membership.id);
    expect(await until(async () => lk.removed.some((x) => x.identity === ben.membership.id))).toBe(true);
    expect((await adminQuery<{ state: string }>(`SELECT state FROM call_participants WHERE call_id = $1 AND membership_id = $2`, [s.call.id, ben.membership.id]))[0].state).toBe("left");
    await adminQuery(`INSERT INTO team_members(team_id, organisation_id, membership_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [a.teamId, olu.org.id, ben.membership.id]);
    // The call ends; a device that reconnects to its room brings the room back: it is deleted again.
    await leaveCall(david, s.call.id);
    expect((await adminQuery<{ state: string }>(`SELECT state FROM calls WHERE id = $1`, [s.call.id]))[0].state).toBe("ended");
    lk.deleted = []; lk.removed = [];
    await joined(s.call.room, david.membership.id);
    expect(await until(async () => lk.deleted.includes(s.call.room))).toBe(true);
    // A room that is ours by name but not a call this database knows: left alone (another copy of Boredroom may own it).
    lk.deleted = []; lk.removed = [];
    await joined("call-22222222-2222-4222-8222-222222222222", david.membership.id);
    await new Promise((r) => setTimeout(r, 300));
    expect(lk.removed).toEqual([]);
    expect(lk.deleted).toEqual([]);
  });
});
