import { route, parseBody, requireAuth, ok } from "@/server/lib/api";
import { setMyPresence, presenceSchema } from "@/server/services/profile";

/** The person's own work status (active, away, do not disturb, offline). */
export const PATCH = route(async (req) => {
  const user = await requireAuth();
  const body = await parseBody(req, presenceSchema);
  return ok(await setMyPresence(user, body.presence));
});
