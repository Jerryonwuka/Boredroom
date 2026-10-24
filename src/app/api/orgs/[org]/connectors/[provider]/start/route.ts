import { z } from "zod";
import { NextResponse } from "next/server";
import { route, orgContext, parseBody } from "@/server/lib/api";
import { notFound } from "@/server/lib/errors";
import { providerFromSlug } from "@/server/connectors/registry";
import { beginConnect, stateCookie } from "@/server/connectors/oauth";
import { requireConnectors } from "@/server/connectors/connections";
import { mintBrowserTicket } from "@/server/services/desktop-app";

const schema = z.object({
  kind: z.enum(["workspace", "personal"]),
  act: z.boolean().optional(),
  purpose: z.enum(["connect", "reconnect", "upgrade", "admin_consent"]).optional(),
  connectionId: z.string().uuid().optional(),
  returnTo: z.string().max(300).optional(),
  // Boredroom for Mac's window (owner request, 24 October 2026: option A): continue the consent in the person's browser.
  browser: z.boolean().optional(),
});

/**
 * Starts connecting an app (spec §5.1): `{ kind, act?, purpose?, connectionId?, returnTo? }` → `{ url }` and the state
 * cookie (HttpOnly, SameSite=Lax, Secure in production, path /api/connectors, 10 minutes). The browser then goes to
 * `url` with window.location.assign. Owners and HR for the workspace; each person for themselves (when the workspace
 * allows it); never while someone else is signed in as the person. 503 CONNECTORS_NOT_READY before 0061; 402 without
 * the plan; 429 more than once in 10 seconds.
 */
export const POST = route<{ org: string; provider: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  await requireConnectors(ctx);
  const provider = providerFromSlug(params.provider);
  if (!provider) throw notFound();
  const { browser, ...body } = await parseBody(req, schema, { maxBytes: 2048 });
  // The browser bridge (spec §7.1): a single-use ticket for the person's browser, no state cookie or state row yet (the
  // browser starts the consent with its own cookie). Never for Microsoft's admin consent. 503 without migration 0064;
  // 403 NOT_A_WINDOW_SESSION outside Boredroom for Mac's window.
  if (browser && body.purpose !== "admin_consent") return NextResponse.json(await mintBrowserTicket(ctx, { org: ctx.org.slug, provider, ...body, purpose: body.purpose }));
  const started = await beginConnect(ctx, provider, body);
  const res = NextResponse.json({ url: started.url });
  res.headers.append("set-cookie", stateCookie(started.state));
  return res;
});

// No Idempotency-Key replay here (22 October 2026): a replayed answer would carry a URL whose state the cookie no longer
// matches. A double press starts two states and only the one in the cookie completes; presses are spaced 10 seconds.
