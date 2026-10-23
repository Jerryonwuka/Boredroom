import { z } from "zod";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { route, parseBody } from "@/server/lib/api";
import { signIn, SESSION_COOKIE, sessionCookieOptions, KNOWN_DEVICE_COOKIE, knownDeviceCookieOptions } from "@/server/auth";
import { safeNextPath } from "@/components/auth/next-path";
import { wakeTag } from "@/server/lib/wake-tag";

const schema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200), next: z.string().optional() });

export const POST = route(async (req) => {
  const body = await parseBody(req, schema);
  wakeTag("auth"); // owner request, 23 October 2026: realtime plan, phase 0 (no address, no email)
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  // A browser that signed in to this address before is not refused by the per-address lock (security audit, 23 October
  // 2026, verification V2), so nobody can keep the owner out from rotating addresses.
  const { token, emailVerified, knownDevice } = await signIn({ email: body.email, password: body.password, ip, userAgent: req.headers.get("user-agent") ?? undefined, knownDevice: (await cookies()).get(KNOWN_DEVICE_COOKIE)?.value ?? null });
  // Resolved the way a browser reads it, so "/\host" and "/<tab>/host" never come back as a place to go.
  const res = NextResponse.json({ ok: true, next: emailVerified ? safeNextPath(body.next) : "/verify/pending" });
  res.cookies.set(SESSION_COOKIE, token, await sessionCookieOptions());
  res.cookies.set(KNOWN_DEVICE_COOKIE, knownDevice, knownDeviceCookieOptions());
  return res;
});
