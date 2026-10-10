import { after } from "next/server";
import { route, orgContextTx, ok } from "@/server/lib/api";
import { requestMeta } from "@/server/auth";
import { callsNowIn, noteDesktopRinger, ringerNetworkOf, settleCall } from "@/server/services/calls";

export const dynamic = "force-dynamic";

/**
 * What is ringing for the person now and the call they are in (owner decisions, 8 October 2026: phase 8, calls):
 * `CallsNow`, for the web's incoming-call overlay and "On a call" dock and for the notch, which polls it every few seconds
 * through its existing `api` command (`pollMs` says how often: 2 s while ringing, 4 s otherwise, 60 s while calls are
 * unavailable). One transaction (orgContextTx); no rate limit. Rings past their 30 seconds are settled after the answer
 * (C.6), so a lost ring-timeout job never leaves a call ringing. Before migration 0054, or without LiveKit:
 * `{ ready, available: false, ringing: [], active: null, pollMs: 60000, ringsOnDesktop: false }`.
 *
 * One ringer (fix review, 10 October 2026): the notch adds `?ring=1` while it can ring aloud (its sounds on, not in quiet
 * hours) and `?ring=0` otherwise; from a desktop session that is remembered for 20 seconds against a keyed digest of the
 * network it polls from (never the address). `ringsOnDesktop` tells a browser on the same network to show the incoming
 * card without its own ring. A browser's `ring` is ignored.
 */
export const GET = route<{ org: string }>(async (req, { params }) => {
  const ring = new URL(req.url).searchParams.get("ring");
  const network = ringerNetworkOf((await requestMeta()).ip);
  const { expiredRings, ...now } = await orgContextTx(params.org, async (ctx, db) => {
    if (ring === "1" || ring === "0") await noteDesktopRinger(db, ctx, { network, rings: ring === "1" });
    return callsNowIn(db, ctx, { network });
  });
  if (expiredRings.length) {
    const run = async () => {
      for (const id of expiredRings) {
        await settleCall(id).catch((err) => console.warn(`[calls] settling an expired ring: ${(err as Error)?.message ?? String(err)}`));
      }
    };
    try { after(run); } catch { void run(); }
  }
  return ok(now);
});
