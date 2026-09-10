import { z } from "zod";
import { NextResponse } from "next/server";
import { route, parseBody } from "@/server/lib/api";
import { signUp, signIn, SESSION_COOKIE, sessionCookieOptions } from "@/server/auth";

const schema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(10).max(200), displayName: z.string().trim().min(1).max(120) });

export const POST = route(async (req) => {
  const body = await parseBody(req, schema);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  await signUp({ ...body, ip });
  const { token } = await signIn({ email: body.email, password: body.password, ip, userAgent: req.headers.get("user-agent") ?? undefined });
  const res = NextResponse.json({ ok: true, next: "/verify/pending" }, { status: 201 });
  res.cookies.set(SESSION_COOKIE, token, await sessionCookieOptions());
  return res;
});
