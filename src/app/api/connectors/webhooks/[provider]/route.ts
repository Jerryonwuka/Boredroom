import { providerFromSlug } from "@/server/connectors/registry";
import { handleWebhook } from "@/server/connectors/webhooks";

export const dynamic = "force-dynamic";

/**
 * Webhook deliveries (spec §7): verified on the raw bytes by the provider's adapter (401 with no body when they don't
 * verify), deduplicated, and used only to decide which connection looks again with Boredroom's own tokens.
 */
export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const provider = providerFromSlug((await params).provider);
  if (!provider) return new Response(null, { status: 404 });
  try { return await handleWebhook(provider, req); }
  catch (err) {
    console.warn(`[connectors] webhook failed: ${(err as { code?: string })?.code ?? "error"}`);
    return new Response(null, { status: 500 });
  }
}
