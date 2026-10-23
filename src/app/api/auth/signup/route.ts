import { z } from "zod";
import { NextResponse } from "next/server";
import { route, parseBody } from "@/server/lib/api";
import { signUp, signIn, SESSION_COOKIE, sessionCookieOptions } from "@/server/auth";
import { wakeTag } from "@/server/lib/wake-tag";

// `next` (owner request, 11 October 2026: the first-run welcome): where the person was going. While registration is
// closed it lets in someone joining by invitation or join code, and the verification link carries it (server/auth).
const schema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(10).max(200), displayName: z.string().trim().min(1).max(120), next: z.string().max(512).optional() });

export const POST = route(async (req) => {
  const body = await parseBody(req, schema);
  wakeTag("auth"); // owner request, 23 October 2026: realtime plan, phase 0
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  await signUp({ ...body, ip });
  const { token } = await signIn({ email: body.email, password: body.password, ip, userAgent: req.headers.get("user-agent") ?? undefined });
  const res = NextResponse.json({ ok: true, next: "/verify/pending" }, { status: 201 });
  res.cookies.set(SESSION_COOKIE, token, await sessionCookieOptions());
  return res;
});
