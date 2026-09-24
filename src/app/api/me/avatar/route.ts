import { route, requireAuth, ok } from "@/server/lib/api";
import { invalid } from "@/server/lib/errors";
import { setMyAvatar, removeMyAvatar } from "@/server/services/profile";

export const POST = route(async (req) => {
  const user = await requireAuth();
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw invalid("Choose an image.");
  const bytes = Buffer.from(await file.arrayBuffer());
  return ok(await setMyAvatar(user, { type: file.type, bytes }), 201);
});

export const DELETE = route(async () => {
  const user = await requireAuth();
  return ok(await removeMyAvatar(user));
});
