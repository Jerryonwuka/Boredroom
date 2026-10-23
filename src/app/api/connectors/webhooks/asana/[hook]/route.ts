import { handleWebhook } from "@/server/connectors/webhooks";

export const dynamic = "force-dynamic";

/** Asana's per-hook URL (spec §7): the X-Hook-Secret handshake (sealed, echoed) and then signed deliveries. */
export async function POST(req: Request, { params }: { params: Promise<{ hook: string }> }) {
  const { hook } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(hook)) return new Response(null, { status: 404 });
  try { return await handleWebhook("asana", req, hook); }
  catch (err) {
    console.warn(`[connectors] asana webhook failed: ${(err as { code?: string })?.code ?? "error"}`);
    return new Response(null, { status: 500 });
  }
}
