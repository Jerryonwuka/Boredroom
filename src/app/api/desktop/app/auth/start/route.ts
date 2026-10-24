import { route, parseBody, ok } from "@/server/lib/api";
import { requestMeta, requireDesktopBearer } from "@/server/auth";
import { authStartSchema, startAuthRequest } from "@/server/services/desktop-app";
import { wakeTag } from "@/server/lib/wake-tag";

/**
 * Boredroom for Mac starts a PKCE sign-in (owner request, 24 October 2026: option A): `{ challenge, state, via, intent?,
 * deviceName? }` → `{ startUrl, expiresIn }`. No sign-in; 30 an hour from one address (counted and committed first).
 *
 * Security review, 24 October 2026 (SEC-3): a linked app also sends its Bearer, so the finish page can name who the
 * notch is signed in as now and ask before replacing them. A missing, ended or non-desktop Bearer is simply ignored.
 */
export const POST = route(async (req) => {
  const body = await parseBody(req, authStartSchema, { maxBytes: 2048 });
  wakeTag("link");
  const meta = await requestMeta();
  const bearer = await requireDesktopBearer().catch(() => null);
  return ok(await startAuthRequest(body, { ip: meta.ip, replacingSessionId: bearer?.sessionId ?? null }));
});
