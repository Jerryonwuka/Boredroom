import { z } from "zod";
import { NextResponse } from "next/server";
import { route, parseBody } from "@/server/lib/api";
import { signIn, SESSION_COOKIE, sessionCookieOptions } from "@/server/auth";

const schema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200), next: z.string().optional() });

export const POST = route(async (req) => {
  const body = await parseBody(req, schema);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const { token, emailVerified } = await signIn({ email: body.email, password: body.password, ip, userAgent: req.headers.get("user-agent") ?? undefined });
  const safeNext = body.next && body.next.startsWith("/") && !body.next.startsWith("//") ? body.next : "/app";
  const res = NextResponse.json({ ok: true, next: emailVerified ? safeNext : "/verify/pending" });
  res.cookies.set(SESSION_COOKIE, token, await sessionCookieOptions());
  return res;
});
