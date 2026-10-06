import { z } from "zod";
import { NextResponse } from "next/server";
import { route, parseBody } from "@/server/lib/api";
import { signIn, SESSION_COOKIE, sessionCookieOptions } from "@/server/auth";
import { safeNextPath } from "@/components/auth/next-path";

const schema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200), next: z.string().optional() });

export const POST = route(async (req) => {
  const body = await parseBody(req, schema);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const { token, emailVerified } = await signIn({ email: body.email, password: body.password, ip, userAgent: req.headers.get("user-agent") ?? undefined });
  // Resolved the way a browser reads it, so "/\host" and "/<tab>/host" never come back as a place to go.
  const res = NextResponse.json({ ok: true, next: emailVerified ? safeNextPath(body.next) : "/verify/pending" });
  res.cookies.set(SESSION_COOKIE, token, await sessionCookieOptions());
  return res;
});
