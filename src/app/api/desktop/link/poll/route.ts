import { route, parseBody, ok } from "@/server/lib/api";
import { requestMeta } from "@/server/auth";
import { pollLink, pollSchema } from "@/server/services/desktop";
import { wakeTag } from "@/server/lib/wake-tag";

/** The desktop app waits for approval; once approved it receives its session token, once. */
export const POST = route(async (req) => {
  const body = await parseBody(req, pollSchema);
  wakeTag("link"); // owner request, 23 October 2026: realtime plan, phase 0
  const meta = await requestMeta();
  return ok(await pollLink(body, { userAgent: meta.userAgent }));
});
