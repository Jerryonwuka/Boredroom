import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { route } from "@/server/lib/api";
import { signOut, SESSION_COOKIE } from "@/server/auth";

export const POST = route(async () => {
  const jar = await cookies();
  await signOut(jar.get(SESSION_COOKIE)?.value);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
});
