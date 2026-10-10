import { after } from "next/server";
import { route, orgContext, ok } from "@/server/lib/api";
import { callHeartbeat, reconcileCallSoon } from "@/server/services/calls";

/**
 * The person's device is still in the call (owner decisions, 8 October 2026: phase 8, calls): sent every 15 seconds while
 * connected (and while a call accepted from the notch waits for Join). `{ state: "ok" | "left" | "ended" }`: "left" and
 * "ended" tell the device to disconnect ("left" also when the person no longer reads the call's conversation; they are
 * taken out of LiveKit's room too). A device silent for 45 seconds has left (D5). No settle and no view here: it is the
 * cheapest step there is. After an "ok", LiveKit's room is compared with who is in the call, at most every 15 seconds a
 * call, so a token kept after leaving stops working within seconds (fix review, 10 October 2026). 404; 403 while someone
 * else is signed in as the person; 503 before migration 0054 or without LiveKit.
 */
export const POST = route<{ org: string; id: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  const r = await callHeartbeat(ctx, params.id);
  if (r.state === "ok") {
    const run = () => reconcileCallSoon(params.id).then(() => undefined);
    try { after(run); } catch { void run(); }
  }
  return ok(r);
});
