/**
 * A missed call's facts for the notch's card (owner decisions, 8 October 2026: phase 8, contract C.7): `call.missed` gets
 * `kind: "call"`, who called with their assistant's face, where, whether the call is still on (the card offers Join) and,
 * for a one-to-one call, who to call back. Read as the viewer: only someone the call rang (or who reads its
 * conversation) gets them. LiveKit is faked.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.LIVEKIT_URL = "wss://test.livekit.invalid";
process.env.LIVEKIT_API_KEY = "APItestkey";
process.env.LIVEKIT_API_SECRET = "test-secret-that-is-long-enough-000000000000";

import { adminQuery, resetTestDatabase } from "../helpers/db";
import { buildCompany, type CompanyFixture } from "@/server/services/fixtures";
import { withSystem, withUser } from "@/server/db";
import { issueSession } from "@/server/auth";
import { forget0054 } from "@/server/lib/schema-0054";
import { setLiveKitForTests } from "@/server/lib/livekit";
import { settleCall, startCall } from "@/server/services/calls";
import { openChannel } from "@/server/services/messaging";
import { forgetNoticeFacts, noticeFacts, type NoticeRow } from "@/server/services/notice-facts";
import type { OrgContext } from "@/server/lib/api";

let a: CompanyFixture;
let olu: OrgContext, david: OrgContext, ada: OrgContext, ben: OrgContext;

const unread = (c: OrgContext) => withUser(c.user.profileId, (db) => db.query<NoticeRow>(
  `SELECT id, type, title, body, href, resource_id, resource_type, deduplication_key, created_at FROM notifications
   WHERE recipient_membership_id = $1 AND read_at IS NULL AND type = 'call.missed' ORDER BY created_at DESC`, [c.membership.id]));

beforeAll(async () => {
  await resetTestDatabase();
  forget0054();
  forgetNoticeFacts();
  setLiveKitForTests({ listRooms: async () => [], listParticipants: async () => [], deleteRoom: async () => undefined, removeParticipant: async () => undefined });
  a = await buildCompany("a", { names: { owner: "Olu Owner", hr: "Mary HR", manager: "David Lead", employee: "Ada Obi", employee2: "Ben Okafor" } });
  olu = a.ownerCtx; david = a.managerCtx; ada = a.employeeCtx; ben = a.employee2Ctx;
  await adminQuery(`INSERT INTO assistant_profiles(membership_id, organisation_id, name, colour) VALUES ($1, $2, 'Max', 'orange')`, [ada.membership.id, olu.org.id]);
});
afterAll(() => { setLiveKitForTests(null); });

describe("a missed call's facts", () => {
  it("one-to-one, over: who called (with Max's face), no place, Call back", async () => {
    const s = await startCall(ada, { to: ben.membership.id });
    await settleCall(s.call.id, { now: new Date(Date.now() + 31_000) });
    const rows = await unread(ben);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: "Missed call from Ada Obi", resource_type: "call", resource_id: s.call.id, href: `/app/company-a/calls/${s.call.id}` });
    const f = (await noticeFacts(ben, rows)).get(rows[0].id);
    expect(f).toEqual({
      v: 1, kind: "call", callId: s.call.id, from: { membershipId: ada.membership.id, name: "Ada Obi", assistant: expect.objectContaining({ name: "Max", colour: "orange", face: expect.any(Object) }) },
      where: null, direct: true, at: expect.any(String), live: false, callBack: { membershipId: ada.membership.id },
    });
    // Someone the call is nothing to reads no facts from it (row-level security), whatever rows they are handed.
    expect((await noticeFacts(olu, rows)).size).toBe(0);
  });

  it("a group call still on: #Design, Join (no call back)", async () => {
    // Ada online (a session seen now), so David's call in #Design rings her; she lets it ring out.
    await withSystem((db) => issueSession(db, a.employee.authUserId, { method: "password" }));
    const design = await openChannel(david, a.teamId);
    const g = await startCall(david, { conversationId: design });
    await adminQuery(`UPDATE call_participants SET last_seen_at = now() + interval '5 minutes' WHERE call_id = $1 AND membership_id = $2`, [g.call.id, david.membership.id]);
    await settleCall(g.call.id, { now: new Date(Date.now() + 31_000) });
    const rows = await unread(ada);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Missed call from David Lead in #Design");
    const f = (await noticeFacts(ada, rows)).get(rows[0].id);
    expect(f).toMatchObject({ kind: "call", callId: g.call.id, from: { membershipId: david.membership.id }, where: "#Design", direct: false, live: true, callBack: null });
  });
});
