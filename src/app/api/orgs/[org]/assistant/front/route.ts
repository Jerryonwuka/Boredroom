import { route, readCappedBytes, requireFeature } from "@/server/lib/api";
import { AppError } from "@/server/lib/errors";
import { ndjsonResponse } from "@/server/lib/ndjson";
import { macContext } from "@/server/lib/mac-context";
import { FRONT_LIMITS, FRONT_WORDS } from "@/lib/front";
import { frontBurst, frontGate, nonceHint, readFrontBody, routeFront } from "@/server/services/front";

/**
 * Brenda's front desk on the Mac (Brenda and her helpers, build 1; owner's approved brief, 12 October 2026: "Hold
 * Control+Command (or type in the notch). Common commands are recognised ON THE MAC with no AI call …; everything else
 * goes to a small fast model (claude-haiku-5-5) that picks the lane and, for front-lane work, the action"; contract B.4).
 *
 * Rust alone calls it, with the person's own request (Rust's transcript of their key hold, or words typed with a real
 * press), a nonce made when the words were captured, and what the Mac sees: which app is in front, which run, the names
 * of files and folders they pointed at, which switches are on. Never a picture: the router is text only. Permission rule
 * v2 (owner, 12 October 2026): "when you hold the keys and clearly ask for a routine task, the request is the permission,
 * and she does it. She still asks before anything destructive, anything sent, anything that costs money, or anything
 * sensitive."
 *
 * In this order: the plan; the one-trip Mac context (a desktop session, not impersonated, 0060, screen help and actions
 * available); not on a call; the burst limit; the body (at most 256 KB, checked whole); fresh (≤ 30 s); a nonce never
 * used; today's allowance; then one Haiku call, and the lane as lines (`application/x-ndjson`). The record, the usage rows
 * and the burst count are written after the answer. Logs say only `[front] CODE`.
 *
 * GET answers 204 once the session and the workspace check out: Rust calls it once at start, so `next dev` compiles this
 * route before the first request and the pool's connections are warm (contract K.5.4).
 */
export const maxDuration = 120;

export const POST = route<{ org: string }>(async (req, { params }) => {
  (await import("@/server/db")).warmPool();
  // The body's bytes are read first (capped as before) only so the request's nonce rides in the context's one round
  // trip (K.5's target, integration, 16 October 2026: the replay check was three more round trips of its own). Every
  // check still answers in the order above: a body that is too big or unreadable is refused where it was.
  const raw = await readCappedBytes(req, FRONT_LIMITS.bodyBytes, FRONT_WORDS.errors.tooLarge).catch((err: unknown) => ({ err }));
  const mc = await macContext(params.org, { nonce: raw instanceof Uint8Array ? nonceHint(raw) : null });
  requireFeature(mc.ctx, "AI_ASSISTANT");
  frontGate(mc);
  if (mc.onCall) throw new AppError(409, "LOOK_ON_CALL", "I don't work on your screen during a Boredroom call.");
  await frontBurst(mc);
  if (!(raw instanceof Uint8Array)) throw raw.err;
  const body = readFrontBody(raw);
  return ndjsonResponse((write) => routeFront(mc, body, write), { onError: streamError });
});

export const GET = route<{ org: string }>(async (_req, { params }) => {
  const mc = await macContext(params.org);
  requireFeature(mc.ctx, "AI_ASSISTANT");
  const { warmPool } = await import("@/server/db");
  warmPool();
  return new Response(null, { status: 204 });
});

/** An error after the stream started, as an `error` line: fixed words only, never anything from the request. */
function streamError(err: unknown): Record<string, unknown> {
  if (err instanceof AppError) return { status: err.status, code: err.code, message: err.message };
  console.error(`[front] FRONT_FAILED ${(err as { code?: string })?.code ?? "error"}`);
  return { status: 502, code: "AI_FAILED", message: FRONT_WORDS.errors.failed };
}
