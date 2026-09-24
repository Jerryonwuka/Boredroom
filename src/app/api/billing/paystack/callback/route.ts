import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { verifyAndRecord } from "@/server/admin/billing";
import { withSystem } from "@/server/db";

export const dynamic = "force-dynamic";

/** Paystack sends the browser back here after checkout. The reference is verified with Paystack before anything is recorded. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = process.env.APP_ORIGIN ?? url.origin;
  const reference = url.searchParams.get("reference") ?? url.searchParams.get("trxref");
  const user = await getCurrentUser();
  if (!reference) return NextResponse.redirect(`${origin}/app`);
  let slug: string | null = null;
  try {
    const r = await verifyAndRecord(reference);
    if (r.organisationId) slug = (await withSystem((db) => db.maybeOne<{ slug: string }>(`SELECT slug FROM organisations WHERE id = $1`, [r.organisationId])))?.slug ?? null;
    return NextResponse.redirect(`${origin}${slug ? `/app/${slug}/settings?billing=${r.status}` : "/app"}`);
  } catch (err) {
    console.error("[paystack callback]", (err as Error).message);
    return NextResponse.redirect(`${origin}${user ? "/app" : "/login"}?billing=error`);
  }
}
