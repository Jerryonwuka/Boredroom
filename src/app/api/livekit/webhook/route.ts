import { after } from "next/server";
import { route, ok } from "@/server/lib/api";
import { AppError, tooLarge } from "@/server/lib/errors";
import { verifyLiveKitWebhook } from "@/server/lib/livekit";
import { handleLiveKitWebhook } from "@/server/services/calls";
import { schema0054Ready } from "@/server/lib/schema-0054";
import { withSystem } from "@/server/db";

export const dynamic = "force-dynamic";

const MAX_BODY = 64 * 1024;
const ROOM = /^call-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * LiveKit Cloud's webhooks (owner decisions, 8 October 2026: phase 8, calls; D15: production only). Calls work without
 * them: devices heartbeat and Boredroom reconciles LiveKit's rooms (from heartbeats every 15 s, and the worker), and
 * localhost cannot receive webhooks. Recommended in production (fix review, 10 October 2026): `participant_joined` takes
 * out at once anyone who comes back to a call they are no longer on with a token they kept. The owner registers
 * `https://<host>/api/livekit/webhook` in LiveKit Cloud (Settings, Webhooks); the API key's secret signs each one.
 *
 * The raw body (at most 64 KiB) is verified first: the Authorization header must be a token signed with our secret whose
 * sha256 is this body's (401 BAD_SIGNATURE otherwise). A room that is not one of ours (`call-<uuid>`), or a database
 * before migration 0054: 200 `{ ignored: true }`. Otherwise 200 `{ ok: true }` at once, and the event is handled after the
 * answer (services/calls `handleLiveKitWebhook`: a finished room ends its call, a participant leaving settles it, one
 * joining without a place on the call is taken out).
 * Duplicates are harmless. Never logs the body or the Authorization header.
 */
export const POST = route(async (req) => {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) throw tooLarge();
  const body = await req.text();
  if (body.length > MAX_BODY) throw tooLarge();
  let e: Awaited<ReturnType<typeof verifyLiveKitWebhook>>;
  try {
    e = await verifyLiveKitWebhook(body, req.headers.get("authorization"));
  } catch {
    throw new AppError(401, "BAD_SIGNATURE", "This webhook's signature is not valid.");
  }
  if (!e.room || !ROOM.test(e.room)) return ok({ ignored: true });
  if (!(await withSystem((db) => schema0054Ready(db)))) return ok({ ignored: true });
  const event = { event: e.event, room: e.room, identity: e.identity };
  const run = () => handleLiveKitWebhook(event).catch((err) => console.warn(`[calls] webhook ${e.event}: ${(err as Error)?.message?.slice(0, 160) ?? "failed"}`));
  try { after(run); } catch { void run(); }
  return ok({ ok: true });
});
