import { route, parseBody, ok } from "@/server/lib/api";
import { requestMeta } from "@/server/auth";
import { pollLink, pollSchema } from "@/server/services/desktop";

/** The desktop app waits for approval; once approved it receives its session token, once. */
export const POST = route(async (req) => {
  const body = await parseBody(req, pollSchema);
  const meta = await requestMeta();
  return ok(await pollLink(body, { userAgent: meta.userAgent }));
});
