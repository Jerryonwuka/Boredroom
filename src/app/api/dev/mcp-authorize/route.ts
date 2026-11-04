import { NextResponse } from "next/server";
import { notFound } from "@/server/lib/errors";
import { route } from "@/server/lib/api";
import { devOAuthFakeMcp } from "@/server/connectors/mcp/fake";

/**
 * DEVELOPMENT ONLY (owner request, 4 November 2026: phase 1b): the sign-in page of the development fake that signs in
 * (https://mcp-oauth.fake.test/mcp, with MCP_FAKE=1). It approves at once, after the same checks a real server makes
 * (the client, the redirect, PKCE S256, the resource), and sends the browser back to Boredroom's callback. 404 in
 * production and without MCP_FAKE=1.
 */
export const GET = route(async (req) => {
  if (process.env.NODE_ENV === "production") throw notFound();
  const fake = devOAuthFakeMcp();
  if (!fake) throw notFound();
  const deny = new URL(req.url).searchParams.get("deny") === "1";
  return NextResponse.redirect(fake.approve(req.url, { deny }).redirect, 302);
});
