/**
 * The notch's teammates on a call (owner decisions, 8 October 2026: phase 8, contract C.10): `desktopState`'s `team[]`
 * says who is on a call now (`onCall`; never which call), as the lead's notch reads it; ringing is not in the 20-second
 * state (the notch polls /calls/now). The person card says it too (`memberCard`'s `on_call`, integration patch P2,
 * 10 October 2026). LiveKit is faked.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.LIVEKIT_URL = "wss://test.livekit.invalid";
process.env.LIVEKIT_API_KEY = "APItestkey";
process.env.LIVEKIT_API_SECRET = "test-secret-that-is-long-enough-000000000000";

import { resetTestDatabase } from "../helpers/db";
import { buildCompany, type CompanyFixture } from "@/server/services/fixtures";
import { forget0054 } from "@/server/lib/schema-0054";
import { setLiveKitForTests } from "@/server/lib/livekit";
import { joinCall, leaveCall, startCall } from "@/server/services/calls";
import { desktopState } from "@/server/services/desktop";
import { memberCard } from "@/server/services/workspace";

let a: CompanyFixture;

beforeAll(async () => {
  await resetTestDatabase();
  forget0054();
  setLiveKitForTests({ listRooms: async () => [], listParticipants: async () => [], deleteRoom: async () => undefined, removeParticipant: async () => undefined });
  a = await buildCompany("a");
});
afterAll(() => { setLiveKitForTests(null); });

describe("the notch's teammates", () => {
  it("say who is on a call, and stop when it ends", async () => {
    const david = a.managerCtx, ada = a.employeeCtx, ben = a.employee2Ctx;
    const before = await desktopState(david, { opener: false });
    expect(before.team.length).toBeGreaterThanOrEqual(2);
    expect(before.team.every((m) => m.onCall === false)).toBe(true);
    const s = await startCall(ada, { to: ben.membership.id });
    // Ringing is not "on a call" for Ben yet; Ada (joined, waiting) is.
    const ringing = await desktopState(david, { opener: false });
    expect(ringing.team.find((m) => m.id === ada.membership.id)?.onCall).toBe(true);
    expect(ringing.team.find((m) => m.id === ben.membership.id)?.onCall).toBe(false);
    expect(Object.keys(ringing)).not.toContain("calls");
    await joinCall(ben, s.call.id);
    const during = await desktopState(david, { opener: false });
    expect(during.team.filter((m) => m.onCall).map((m) => m.id).sort()).toEqual([ada.membership.id, ben.membership.id].sort());
    await leaveCall(ben, s.call.id);
    const after = await desktopState(david, { opener: false });
    expect(after.team.every((m) => m.onCall === false)).toBe(true);
  });

  it("the person card says On a call while someone is in one (who, never which call), for anyone who opens it", async () => {
    const olu = a.ownerCtx, ada = a.employeeCtx, ben = a.employee2Ctx;
    expect((await memberCard(olu, ada.membership.id)).on_call).toBe(false);
    const s = await startCall(ada, { to: ben.membership.id });
    expect((await memberCard(olu, ada.membership.id)).on_call).toBe(true);
    // Rung, not in it yet.
    expect((await memberCard(olu, ben.membership.id)).on_call).toBe(false);
    await joinCall(ben, s.call.id);
    const seenByBen = await memberCard(ben, ada.membership.id);
    expect(seenByBen.on_call).toBe(true);
    expect(JSON.stringify(seenByBen)).not.toContain(s.call.id);
    await leaveCall(ada, s.call.id);
    expect((await memberCard(olu, ada.membership.id)).on_call).toBe(false);
    expect((await memberCard(olu, ben.membership.id)).on_call).toBe(false);
  });
});
