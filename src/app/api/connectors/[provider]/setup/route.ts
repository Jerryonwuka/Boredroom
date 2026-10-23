import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser } from "@/server/auth";
import { providerFromSlug } from "@/server/connectors/registry";
import { STATE_COOKIE, clearStateCookie, continueInstall, stateCookie } from "@/server/connectors/oauth";
import { appOrigin } from "@/server/connectors/env";

export const dynamic = "force-dynamic";

/**
 * GitHub's Setup URL (spec §5.3): after the owner installs the app, GitHub sends them here. `installation_id` is kept as
 * a claim only (verified later with their own user token); then the user authorisation, with a new state and PKCE.
 * Every other provider: 404.
 */
export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: slug } = await params;
  const provider = providerFromSlug(slug);
  if (provider !== "github" && provider !== "fake") return new Response(null, { status: 404 });
  const url = new URL(req.url);
  const jar = await cookies();
  const user = await getCurrentUser().catch(() => null);
  const r = await continueInstall({ provider, query: url.searchParams, cookieState: jar.get(STATE_COOKIE)?.value ?? null, user }).catch(() => ({ location: "/app?connector_error=failed" } as { location: string; state?: string }));
  const res = NextResponse.redirect(r.location.startsWith("/") ? `${appOrigin()}${r.location}` : r.location, 302);
  res.headers.append("set-cookie", r.state ? stateCookie(r.state) : clearStateCookie());
  return res;
}
