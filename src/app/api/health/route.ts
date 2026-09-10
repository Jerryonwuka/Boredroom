import { NextResponse } from "next/server";
import { runHealthChecks } from "@/server/lib/health";

export const dynamic = "force-dynamic";

/** Configuration self-check (no secrets returned). Green means sign-up and sign-in can work. */
export async function GET() {
  const result = await runHealthChecks();
  return NextResponse.json(result, { status: result.ok ? 200 : 503 });
}
