import { route, parseBody, ok } from "@/server/lib/api";
import { requestMeta } from "@/server/auth";
import { startLink, startSchema } from "@/server/services/desktop";
import { wakeTag } from "@/server/lib/wake-tag";

/** The desktop app asks for a link code. No sign-in yet; rate limited by address. */
export const POST = route(async (req) => {
  const body = await parseBody(req, startSchema);
  wakeTag("link"); // owner request, 23 October 2026: realtime plan, phase 0
  const meta = await requestMeta();
  return ok(await startLink(body, { ip: meta.ip, origin: process.env.APP_ORIGIN ?? new URL(req.url).origin }));
});
