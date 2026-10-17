import { route, ok, readCappedBytes, requireFeature } from "@/server/lib/api";
import { AppError } from "@/server/lib/errors";
import { macContext } from "@/server/lib/mac-context";
import { FRONT_LIMITS, FRONT_WORDS } from "@/lib/front";
import { frontFail, recordBodySchema, recordFront } from "@/server/services/front";

/**
 * The record of requests Brenda for Mac handled itself (Brenda and her helpers, build 1; owner's approved brief, 12
 * October 2026: "the person's request is the record (exact words, key-press/typed origin, time, nonce) = the
 * authorisation"; contract E.3). Matched commands run on the Mac without waiting for the server ("Mac-local routine
 * actions don't wait for the server"); Rust sends their records afterwards from an outbox. Upserted by the person and the
 * nonce; the database refuses a record that ran something without being routine and asked for, or the person's yes.
 *
 * Rust alone calls it: a desktop session, not impersonated; before 0060 `{saved: 0, ready: false}`. The person alone
 * reads these rows (Activity › On your Mac), for 30 days. Logs say only `[front] CODE`.
 */
export const POST = route<{ org: string }>(async (req, { params }) => {
  const mc = await macContext(params.org);
  requireFeature(mc.ctx, "AI_ASSISTANT");
  if (!mc.desktop) throw frontFail(403, "FRONT_DESKTOP_ONLY", FRONT_WORDS.errors.desktopOnly);
  if (mc.ctx.user.impersonation) throw frontFail(403, "FRONT_IMPERSONATED", FRONT_WORDS.errors.impersonated);
  if (!mc.ready0060) return ok({ saved: 0, ready: false });
  const raw = await readCappedBytes(req, FRONT_LIMITS.recordBytes, FRONT_WORDS.errors.tooLarge);
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder().decode(raw)); } catch { throw new AppError(422, "FRONT_INVALID", FRONT_WORDS.errors.invalid); } finally { raw.fill(0); }
  const body = recordBodySchema.safeParse(parsed);
  if (!body.success) throw new AppError(422, "FRONT_INVALID", FRONT_WORDS.errors.invalid);
  return ok(await recordFront(mc, body.data));
});
