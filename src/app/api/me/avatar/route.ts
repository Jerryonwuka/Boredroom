import { route, requireAuth, ok, readCappedBytes } from "@/server/lib/api";
import { invalid } from "@/server/lib/errors";
import { withSystem } from "@/server/db";
import { rateLimitIn } from "@/server/auth";
import { setMyAvatar, removeMyAvatar } from "@/server/services/profile";
import { AVATAR_UPLOAD_MAX } from "@/lib/avatar-image";

/**
 * The person's own photo. The upload's body is read through a cap (the 2 MB image plus room for the form's own lines),
 * refused with a 413 before anything larger is buffered, and a person may change their photo 20 times an hour (review,
 * 11 October 2026: the first-run welcome sends every newcomer here, and the body used to be read whole, whatever its
 * size, before the 2 MB check).
 */
const FORM_OVERHEAD = 16 * 1024;
const TOO_LARGE = "Images must be 2 MB or smaller.";

export const POST = route(async (req) => {
  const user = await requireAuth();
  await withSystem((db) => rateLimitIn(db, `avatar:${user.profileId}`, 20, 3600, "Too many photo changes. Try again in an hour."));
  const body = await readCappedBytes(req, AVATAR_UPLOAD_MAX + FORM_OVERHEAD, TOO_LARGE);
  const form = await new Response(body as BodyInit, { headers: { "content-type": req.headers.get("content-type") ?? "" } }).formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw invalid("Choose an image.");
  const bytes = Buffer.from(await file.arrayBuffer());
  return ok(await setMyAvatar(user, { type: file.type, bytes }), 201);
});

export const DELETE = route(async () => {
  const user = await requireAuth();
  return ok(await removeMyAvatar(user));
});
