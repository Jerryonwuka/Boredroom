import { route, parseBody, requireAuth, ok } from "@/server/lib/api";
import { myProfile, updateMyProfile, profileSchema } from "@/server/services/profile";

export const GET = route(async () => {
  const user = await requireAuth();
  return ok(await myProfile(user));
});

export const PATCH = route(async (req) => {
  const user = await requireAuth();
  const body = await parseBody(req, profileSchema);
  return ok(await updateMyProfile(user, body));
});
