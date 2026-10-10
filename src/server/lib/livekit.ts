/**
 * LiveKit Cloud, the video service for calls (owner decision 3, 8 October 2026: phase 8, "LiveKit Cloud (hosted)"). The
 * only file that imports `livekit-server-sdk`. What it may do: sign join tokens locally (no network), list, inspect and
 * delete rooms, remove a participant, and verify LiveKit's webhooks. What it never does: ingress, egress, SIP, recording,
 * agents, or any change to the project's configuration (webhooks are registered by the owner in LiveKit Cloud's dashboard).
 * Nothing here ever logs a token, the API key or its secret.
 *
 * Configuration: LIVEKIT_URL (the project's wss:// address), LIVEKIT_API_KEY and LIVEKIT_API_SECRET. Without all three
 * calls are off and every surface says so (callsAvailability in services/calls). Tests never reach LiveKit: under
 * NODE_ENV=test every gateway method throws unless a fake was set with setLiveKitForTests.
 */
import { AccessToken, RoomConfiguration, RoomServiceClient, TrackSource, WebhookReceiver } from "livekit-server-sdk";
import { CALL_LIMITS, type CallConnection, type CallTokenMetadata } from "@/lib/calls";

export type LiveKitRoom = { name: string; numParticipants: number; createdAt: number | null };
export type LiveKitParticipant = { identity: string; joinedAt: number | null };
export interface LiveKitGateway {
  listRooms(names?: string[]): Promise<LiveKitRoom[]>;
  listParticipants(room: string): Promise<LiveKitParticipant[]>;
  /** A room that is already gone is not an error. */
  deleteRoom(room: string): Promise<void>;
  /**
   * Someone already gone is not an error. It does NOT revoke their token: LiveKit lets a removed participant join again
   * with the token they hold (fix review, 10 October 2026, checked on LiveKit Cloud), and hands every device it connects
   * a fresh one. So Boredroom takes out anyone in a call's room without a `joined` row whenever it sees them: the
   * webhook's participant_joined (production), a device's heartbeat (at most every 15 s a call) and the sweep (every
   * minute); and its own tokens last 2 minutes.
   */
  removeParticipant(room: string, identity: string): Promise<void>;
}

type Secrets = { wss: string; https: string; key: string; secret: string };

function secrets(): Secrets | null {
  const url = (process.env.LIVEKIT_URL ?? "").trim();
  const key = (process.env.LIVEKIT_API_KEY ?? "").trim();
  const secret = (process.env.LIVEKIT_API_SECRET ?? "").trim();
  if (!/^wss:\/\/[^\s/]+/i.test(url) || !key || !secret) return null;
  const wss = url.replace(/\/+$/, "");
  return { wss, https: wss.replace(/^wss:/i, "https:"), key, secret };
}

/** LIVEKIT_URL starts with wss:// and both secrets are set. */
export function livekitConfigured(): boolean {
  return secrets() !== null;
}

/** The project's two addresses (the browser connects to `wss`; the room service is called on `https`). */
export function livekitUrls(): { wss: string; https: string } | null {
  const s = secrets();
  return s ? { wss: s.wss, https: s.https } : null;
}

let fake: LiveKitGateway | null = null;
let client: { gateway: LiveKitGateway; signature: string } | null = null;

/** Tests: a fake gateway (null puts the real one back). */
export function setLiveKitForTests(f: LiveKitGateway | null): void {
  fake = f;
}

/**
 * Whether `livekit()` can reach a room service now: the test fake, or (outside tests) a configured project. The worker
 * asks before deleting rooms or removing people, so a server whose calls were switched off does not retry for ever.
 */
export function livekitGatewayReady(): boolean {
  if (fake) return true;
  return process.env.NODE_ENV !== "test" && livekitConfigured();
}

const toNumber = (v: unknown): number | null => {
  if (typeof v === "bigint") return v > BigInt(0) ? Number(v) : null;
  if (typeof v === "number") return v > 0 ? v : null;
  return null;
};

/** LiveKit's "not found" (a room or a participant already gone). */
function isGone(err: unknown): boolean {
  const e = err as { status?: number; code?: string } | null;
  return e?.status === 404 || e?.code === "not_found";
}

const offInTests: LiveKitGateway = {
  listRooms: () => Promise.reject(new Error("LiveKit is off in tests")),
  listParticipants: () => Promise.reject(new Error("LiveKit is off in tests")),
  deleteRoom: () => Promise.reject(new Error("LiveKit is off in tests")),
  removeParticipant: () => Promise.reject(new Error("LiveKit is off in tests")),
};

/** The room service (RoomServiceClient on the https form); the test fake when set. Throws when calls are not configured. */
export function livekit(): LiveKitGateway {
  if (fake) return fake;
  if (process.env.NODE_ENV === "test") return offInTests;
  const s = secrets();
  if (!s) throw new Error("LiveKit is not configured");
  const signature = `${s.https}|${s.key}`;
  if (client?.signature === signature) return client.gateway;
  const svc = new RoomServiceClient(s.https, s.key, s.secret, { requestTimeout: 10 });
  const gateway: LiveKitGateway = {
    async listRooms(names) {
      const rooms = await svc.listRooms(names && names.length ? names : undefined);
      return rooms.map((r) => ({ name: r.name, numParticipants: r.numParticipants, createdAt: toNumber(r.creationTimeMs) ?? (toNumber(r.creationTime) !== null ? (toNumber(r.creationTime) as number) * 1000 : null) }));
    },
    async listParticipants(room) {
      try {
        const people = await svc.listParticipants(room);
        return people.map((p) => ({ identity: p.identity, joinedAt: toNumber(p.joinedAtMs) ?? (toNumber(p.joinedAt) !== null ? (toNumber(p.joinedAt) as number) * 1000 : null) }));
      } catch (err) {
        if (isGone(err)) return [];
        throw err;
      }
    },
    async deleteRoom(room) {
      try {
        await svc.deleteRoom(room);
      } catch (err) {
        if (!isGone(err)) throw err;
      }
    },
    async removeParticipant(room, identity) {
      try {
        await svc.removeParticipant(room, identity);
      } catch (err) {
        if (!isGone(err)) throw err;
      }
    },
  };
  client = { gateway, signature };
  return gateway;
}

/**
 * A join token for one person and one room (signed locally, no network), valid 2 minutes: identity = their membership
 * id, the name and metadata the tiles draw until the call view arrives. Grants: join that room only, publish microphone, camera and screen
 * share (with its sound), subscribe, send data; never create, administer or list rooms, record, act as an agent, hide, or
 * change their own metadata. The room's own settings travel in the token (LiveKit creates the room on the first join):
 * empty for 5 minutes or 20 seconds after the last person leaves, it closes. LiveKit does not enforce maxParticipants
 * reliably: the cap of 50 is app_call_join's.
 */
export async function callToken(o: { room: string; identity: string; name: string; metadata: CallTokenMetadata }): Promise<CallConnection> {
  const s = secrets();
  if (!s) throw new Error("LiveKit is not configured");
  const at = new AccessToken(s.key, s.secret, { identity: o.identity, name: o.name, ttl: CALL_LIMITS.tokenTtl, metadata: JSON.stringify(o.metadata) });
  at.addGrant({
    roomJoin: true,
    room: o.room,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    canPublishSources: [TrackSource.MICROPHONE, TrackSource.CAMERA, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO],
    canUpdateOwnMetadata: false,
  });
  at.roomConfig = new RoomConfiguration({ name: o.room, emptyTimeout: 300, departureTimeout: 20, maxParticipants: CALL_LIMITS.maxParticipants });
  const token = await at.toJwt();
  // tokenTtl is "2m" (fix review, 10 October 2026); the token's own exp is the same instant (give or take the signing
  // millisecond). The device connects at once, and LiveKit refreshes the token of a connected device itself.
  const expiresAt = new Date(Date.now() + CALL_LIMITS.tokenTtlMs).toISOString();
  return { url: s.wss, token, identity: o.identity, expiresAt };
}

/** Deletes a room; true when it is gone (deleted now or already). Logs "[calls] …" on failure and never throws. */
export async function deleteRoomQuietly(room: string): Promise<boolean> {
  try {
    await livekit().deleteRoom(room);
    return true;
  } catch (err) {
    console.warn(`[calls] could not delete the LiveKit room ${room}: ${err instanceof Error ? err.message.slice(0, 160) : "unknown error"}`);
    return false;
  }
}

/**
 * A webhook from LiveKit, verified: the Authorization header is a token signed with the API secret whose sha256 claim
 * is the body's. Throws on a bad or missing signature, a changed body, or calls not being configured.
 */
export async function verifyLiveKitWebhook(rawBody: string, authorization: string | null): Promise<{ id: string; event: string; room: string | null; identity: string | null; createdAt: number | null }> {
  const s = secrets();
  if (!s) throw new Error("LiveKit is not configured");
  if (!authorization) throw new Error("authorization header is empty");
  const e = await new WebhookReceiver(s.key, s.secret).receive(rawBody, authorization);
  const created = toNumber(e.createdAt);
  return { id: e.id, event: e.event, room: e.room?.name || null, identity: e.participant?.identity || null, createdAt: created === null ? null : created * 1000 };
}
