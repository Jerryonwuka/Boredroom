import { NextResponse } from "next/server";
import { route, parseBody } from "@/server/lib/api";
import { requireDesktopBearer } from "@/server/auth";
import { handoffSchema, mintHandoff } from "@/server/services/desktop-app";

/**
 * A linked Boredroom for Mac asks for a handoff code for its own window (owner request, 24 October 2026: option A):
 * `Authorization: Bearer` of a desktop session only (cookies are ignored), `{ next? }` → `{ code, expiresIn: 60,
 * userDigest }`. The app hands the code to its window by script, never in a URL.
 */
export const POST = route(async (req) => {
  const bearer = await requireDesktopBearer();
  const body = await parseBody(req, handoffSchema, { maxBytes: 4096 });
  return NextResponse.json(await mintHandoff(bearer, body), { headers: { "cache-control": "no-store" } });
});
