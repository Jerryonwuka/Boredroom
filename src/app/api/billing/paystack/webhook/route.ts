import { verifyPaystackSignature, processPaystackEvent } from "@/server/admin/billing";

export const dynamic = "force-dynamic";

/** Paystack posts events here. The signature is checked against the raw body; a bad one gets 401 and nothing is stored. */
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyPaystackSignature(raw, req.headers.get("x-paystack-signature"))) return new Response("Invalid signature", { status: 401 });
  let event: { event: string; data: Record<string, unknown> };
  try { event = JSON.parse(raw); } catch { return new Response("Bad JSON", { status: 400 }); }
  try { const r = await processPaystackEvent(event, event); return Response.json({ ok: true, duplicate: r.duplicate }); }
  catch (err) { console.error("[paystack webhook]", (err as Error).message); return Response.json({ ok: false }, { status: 500 }); }
}
