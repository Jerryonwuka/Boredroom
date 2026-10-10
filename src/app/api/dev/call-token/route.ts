import { randomBytes } from "node:crypto";
import { route, requireAuth, ok } from "@/server/lib/api";
import { AppError, notFound } from "@/server/lib/errors";
import { callToken, livekitConfigured } from "@/server/lib/livekit";
import { DEFAULT_ASSISTANT } from "@/lib/assistant-look";

/**
 * DEVELOPMENT ONLY (owner decisions, 8 October 2026: phase 8, calls; contract D.12): a LiveKit token for the call stage's
 * harness at /dev/calls, so the real engine, tiles and controls can be tried against LiveKit Cloud before migration 0054
 * is applied. 404 in production. Needs a signed-in person; the room is `dev-<12 hex>` (a fresh one, or the `room` query
 * when it has that shape, so a second tab or a scratch participant can join the same room); the identity is
 * `dev-<profile id>`. It touches no table and never logs the token (it is only in the response).
 */
const DEV_ROOM = /^dev-[0-9a-f]{12}$/;

export const GET = route(async (req) => {
  if (process.env.NODE_ENV === "production") throw notFound();
  const user = await requireAuth();
  if (!livekitConfigured()) throw new AppError(503, "CALLS_NOT_CONFIGURED", "Calls aren't set up on this server yet.");
  const asked = new URL(req.url).searchParams.get("room");
  const room = asked && DEV_ROOM.test(asked) ? asked : `dev-${randomBytes(6).toString("hex")}`;
  const identity = `dev-${user.profileId}`;
  const connection = await callToken({ room, identity, name: user.displayName, metadata: { v: 1, name: user.displayName, profileId: user.profileId, avatarKey: user.avatarKey ?? null, assistant: DEFAULT_ASSISTANT } });
  const res = ok({ room, connection, profileId: user.profileId, name: user.displayName, avatarKey: user.avatarKey ?? null });
  res.headers.set("Cache-Control", "no-store");
  return res;
});
