import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser } from "@/server/auth";
import { MCP_STATE_COOKIE, clearMcpStateCookie, completeSignIn } from "@/server/connectors/mcp/signin";
import { appOrigin } from "@/server/connectors/env";

export const dynamic = "force-dynamic";

/**
 * Where an MCP server's sign-in sends the browser back (owner request, 4 November 2026: phase 1b), a top-level GET so the
 * SameSite=Lax session and state cookies arrive. Answers 302 to the workspace's Connectors settings with
 * `?mcp_signed_in=<server id>` or `?mcp_error=<code>` (fixed codes only, never the server's words). This static route
 * takes /api/connectors/mcp/callback ahead of the connected apps' [provider] route. The state cookie is cleared in every
 * answer.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = appOrigin();
  const redirect = (location: string) => {
    const res = NextResponse.redirect(`${origin}${location.startsWith("/") ? location : "/app"}`, 302);
    res.headers.append("set-cookie", clearMcpStateCookie());
    return res;
  };
  const jar = await cookies();
  const user = await getCurrentUser().catch(() => null);
  try {
    const r = await completeSignIn({ query: url.searchParams, cookieState: jar.get(MCP_STATE_COOKIE)?.value ?? null, user });
    return redirect(r.location);
  } catch (err) {
    console.warn(`[mcp] sign-in callback failed: ${(err as { code?: string })?.code ?? "error"}`);
    return redirect("/app?mcp_error=failed");
  }
}
