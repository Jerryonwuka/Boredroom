import { orgContext } from "@/server/lib/api";
import { getPool } from "@/server/db";
import { errorResponse } from "@/server/lib/api";

export const dynamic = "force-dynamic";

/** Server-sent events fed by PostgreSQL LISTEN/NOTIFY. Only members can subscribe; payloads carry ids, not content. */
export async function GET(_req: Request, context: { params: Promise<{ org: string }> }) {
  const { org } = await context.params;
  let ctx;
  try { ctx = await orgContext(org); } catch (err) { return errorResponse(err, "sse"); }
  const channel = `org_${ctx.org.id.replace(/-/g, "")}`;
  const client = await getPool().connect();
  const encoder = new TextEncoder();
  let keepalive: ReturnType<typeof setInterval> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (s: string) => { try { controller.enqueue(encoder.encode(s)); } catch { /* closed */ } };
      client.on("notification", (msg) => { if (msg.channel === channel) send(`data: ${msg.payload}\n\n`); });
      await client.query(`LISTEN "${channel}"`);
      send(`: connected\n\n`);
      keepalive = setInterval(() => send(`: keepalive\n\n`), 25000);
    },
    async cancel() {
      if (keepalive) clearInterval(keepalive);
      try { await client.query(`UNLISTEN "${channel}"`); } catch { /* ignore */ }
      client.release();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
}
