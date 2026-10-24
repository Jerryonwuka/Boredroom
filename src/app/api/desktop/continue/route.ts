import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { route, parseBody, assertStrictSameOrigin, orgContextForToken } from "@/server/lib/api";
import { AppError } from "@/server/lib/errors";
import { SESSION_COOKIE } from "@/server/auth";
import { claimTicket, FROM_DESKTOP_COOKIE, fromDesktopCookieOptions } from "@/server/services/desktop-app";
import { beginConnect, stateCookie } from "@/server/connectors/oauth";
import { requireConnectors } from "@/server/connectors/connections";
import { wakeTag } from "@/server/lib/wake-tag";

const schema = z.object({ t: z.string().max(100) });

/**
 * The browser bridge's one press (owner request, 24 October 2026: Boredroom for Mac, option A; spec §7.1): strict
 * same-origin, `{ t }` → `{ url }` with the provider's consent started in THIS browser (its own state cookie) and
 * `boredroom_from_desktop` for the way back.
 *
 * Security review, 24 October 2026 (SEC-1, SEC-2, SEC-3): the browser must already be signed in as the ticket's person
 * (not impersonated, not Boredroom for Mac's window); claimTicket refuses anyone else before the ticket is used. This
 * route never signs a browser in and never sets a session cookie, on success or on failure.
 *
 * A fetch with JSON, then `location.assign(url)`, rather than the spec's form post and 303: the site's CSP has
 * `form-action 'self'`, which browsers also apply to a form's redirects, so a 303 to the provider would be blocked.
 */
export const POST = route(async (req) => {
  assertStrictSameOrigin(req);
  const body = await parseBody(req, schema, { maxBytes: 512 });
  wakeTag("link");
  const jar = await cookies();
  const claimed = await claimTicket(body.t, jar.get(SESSION_COOKIE)?.value);
  if (!claimed) throw new AppError(410, "TICKET_EXPIRED", "This link has expired. Start again from Boredroom.");
  const { payload } = claimed;
  const ctx = await orgContextForToken(payload.org, claimed.token);
  await requireConnectors(ctx);
  const started = await beginConnect(ctx, payload.provider, {
    kind: payload.kind, act: payload.act, purpose: payload.purpose, connectionId: payload.connectionId, returnTo: payload.returnTo,
  });
  const res = NextResponse.json({ url: started.url }, { headers: { "cache-control": "no-store" } });
  res.cookies.set(FROM_DESKTOP_COOKIE, "1", fromDesktopCookieOptions());
  // Appended last: NextResponse's cookie store rewrites the Set-Cookie headers it knows when it sets one.
  res.headers.append("set-cookie", stateCookie(started.state));
  return res;
});
