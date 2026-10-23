import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { route } from "@/server/lib/api";
import { signOut, SESSION_COOKIE } from "@/server/auth";
import { wakeTag } from "@/server/lib/wake-tag";

export const POST = route(async () => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) wakeTag("auth"); // owner request, 23 October 2026: realtime plan, phase 0 (no cookie, no database)
  await signOut(token);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
});
