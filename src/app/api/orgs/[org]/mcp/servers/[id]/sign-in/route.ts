import { NextResponse } from "next/server";
import { route, orgContext, uuid } from "@/server/lib/api";
import { beginSignIn, mcpStateCookie } from "@/server/connectors/mcp/signin";

/**
 * Starts signing in to a workspace's MCP server (owner request, 4 November 2026: phase 1b): `{ url }` and the state
 * cookie (HttpOnly, SameSite=Lax, Secure in production, path /api/connectors/mcp, 10 minutes). The browser then goes to
 * `url` with window.location.assign. Owners and HR, never while signed in as someone else; 503 NOT_READY before 0069;
 * 402 without the plan; 429 more than once in 10 seconds. No Idempotency-Key replay: a replayed answer's state would not
 * match the cookie.
 */
export const POST = route<{ org: string; id: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  const started = await beginSignIn(ctx, uuid.parse(params.id));
  const res = NextResponse.json({ url: started.url });
  res.headers.append("set-cookie", mcpStateCookie(started.state));
  return res;
});
