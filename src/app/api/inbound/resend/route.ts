import { createHmac, timingSafeEqual } from "node:crypto";
import { ingestResend } from "@/server/admin/inbox";
import { wakeTag } from "@/server/lib/wake-tag";

/**
 * Resend inbound webhook. Paste this URL (…/api/inbound/resend) into Resend → Webhooks for the `inbox.email.received`
 * event, and set RESEND_INBOUND_SECRET to that webhook's signing secret (whsec_…) and RESEND_API_KEY so the body can
 * be fetched. Verified with Svix (the scheme Resend uses). We never throw to Resend on a parse error — we just 200 so
 * it is not redelivered forever; ingest is idempotent on the Resend email id.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function verify(secret: string, id: string, ts: string, sig: string, raw: string): boolean {
  try {
    const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
    const expected = createHmac("sha256", key).update(`${id}.${ts}.${raw}`).digest("base64");
    const exp = Buffer.from(expected);
    return sig.split(" ").some((part) => {
      const got = part.split(",")[1];
      if (!got) return false;
      const b = Buffer.from(got);
      return b.length === exp.length && timingSafeEqual(b, exp);
    });
  } catch { return false; }
}

export async function POST(req: Request) {
  const secret = process.env.RESEND_INBOUND_SECRET;
  if (!secret) return new Response("inbound not configured", { status: 503 });
  const id = req.headers.get("svix-id") ?? "", ts = req.headers.get("svix-timestamp") ?? "", sig = req.headers.get("svix-signature") ?? "";
  const raw = await req.text();
  if (!verify(secret, id, ts, sig, raw)) return new Response("bad signature", { status: 401 });
  // Verified with the environment's secret before any database work; the wake tag says what reached it (owner request,
  // 23 October 2026: realtime plan, phase 0).
  wakeTag("webhook:resend");
  try {
    const payload = JSON.parse(raw) as { type?: string; data?: Record<string, unknown> };
    await ingestResend(payload);
  } catch (err) {
    console.error("[inbound/resend]", (err as Error).message);
  }
  return new Response("ok", { status: 200 });
}
