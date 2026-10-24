import { NextResponse } from "next/server";
import { route, parseBody, assertStrictSameOrigin } from "@/server/lib/api";
import { invalid } from "@/server/lib/errors";
import { requestMeta, SESSION_COOKIE, sessionCookieOptions } from "@/server/auth";
import { redeemHandoff, redeemSchema } from "@/server/services/desktop-app";
import { wakeTag } from "@/server/lib/wake-tag";

/**
 * Boredroom for Mac's window redeems its handoff code (owner request, 24 October 2026: option A): strict same-origin, a
 * JSON body only, `{ code }` → `{ next }` and the normal session cookie, whose Max-Age never passes the new session's
 * end (which never passes the desktop session's).
 */
export const POST = route(async (req) => {
  assertStrictSameOrigin(req);
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) throw invalid("Send JSON.");
  const body = await parseBody(req, redeemSchema, { maxBytes: 512 });
  wakeTag("auth");
  const meta = await requestMeta();
  const out = await redeemHandoff(body, { ip: meta.ip, userAgent: meta.userAgent });
  const res = NextResponse.json({ next: out.next }, { headers: { "cache-control": "no-store" } });
  const maxAge = Math.max(0, Math.floor((new Date(out.expiresAt).getTime() - Date.now()) / 1000));
  res.cookies.set(SESSION_COOKIE, out.token, { ...(await sessionCookieOptions()), maxAge });
  return res;
});
