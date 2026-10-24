import { route, parseBody } from "@/server/lib/api";
import { NextResponse } from "next/server";
import { requestMeta } from "@/server/auth";
import { redeemAuthCode, tokenSchema } from "@/server/services/desktop-app";
import { wakeTag } from "@/server/lib/wake-tag";

/**
 * Boredroom for Mac redeems its sign-in code with the PKCE verifier (owner request, 24 October 2026: option A):
 * `{ code, verifier }` → the desktop session, in pollLink's shape plus `userDigest`. 400 CODE_INVALID for any bad code.
 */
export const POST = route(async (req) => {
  const body = await parseBody(req, tokenSchema, { maxBytes: 1024 });
  wakeTag("link");
  const meta = await requestMeta();
  return NextResponse.json(await redeemAuthCode(body, { ip: meta.ip, userAgent: meta.userAgent }), { headers: { "cache-control": "no-store" } });
});
