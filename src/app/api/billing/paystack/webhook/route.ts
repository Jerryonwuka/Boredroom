import { verifyPaystackSignature, processPaystackEvent } from "@/server/admin/billing";
import { wakeTagOnce } from "@/server/lib/wake-tag";

export const dynamic = "force-dynamic";

/**
 * Paystack posts events here. The signature is checked against the raw body; a bad one gets 401 and nothing is stored.
 * Junk is refused before the database (verifyPaystackSignature); the wake tag `webhook:paystack` is logged when a
 * delivery reaches it (owner request, 23 October 2026: realtime plan, phase 0).
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const touch = wakeTagOnce("webhook:paystack");
  if (!(await verifyPaystackSignature(raw, req.headers.get("x-paystack-signature"), touch))) return new Response("Invalid signature", { status: 401 });
  let event: { event: string; data: Record<string, unknown> };
  try { event = JSON.parse(raw); } catch { return new Response("Bad JSON", { status: 400 }); }
  touch();
  try { const r = await processPaystackEvent(event, event); return Response.json({ ok: true, duplicate: r.duplicate }); }
  catch (err) { console.error("[paystack webhook]", (err as Error).message); return Response.json({ ok: false }, { status: 500 }); }
}
