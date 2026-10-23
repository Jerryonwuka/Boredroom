import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser } from "@/server/auth";
import { providerFromSlug } from "@/server/connectors/registry";
import { STATE_COOKIE, clearStateCookie, completeConnect } from "@/server/connectors/oauth";
import { appOrigin } from "@/server/connectors/env";

export const dynamic = "force-dynamic";

/**
 * Where every provider sends the browser back (spec §5.2), a top-level GET so the SameSite=Lax session and state cookies
 * arrive. Answers 302 to the page the person started from, with `?connected=<slug>` or `?connector_error=<code>` (fixed
 * codes only, never the provider's words). The state cookie is cleared in every answer.
 */
export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: slug } = await params;
  const url = new URL(req.url);
  const origin = appOrigin();
  const provider = providerFromSlug(slug);
  const redirect = (location: string) => {
    const res = NextResponse.redirect(`${origin}${location.startsWith("/") ? location : "/app"}`, 302);
    res.headers.append("set-cookie", clearStateCookie());
    return res;
  };
  if (!provider) return redirect("/app?connector_error=failed");
  const jar = await cookies();
  const user = await getCurrentUser().catch(() => null);
  try {
    const r = await completeConnect({ provider, query: url.searchParams, cookieState: jar.get(STATE_COOKIE)?.value ?? null, user });
    return redirect(r.location);
  } catch (err) {
    console.warn(`[connectors] callback failed: ${(err as { code?: string })?.code ?? "error"}`);
    return redirect("/app?connector_error=failed");
  }
}
