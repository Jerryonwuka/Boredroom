import { orgContext } from "@/server/lib/api";
import { errorResponse } from "@/server/lib/api";
import { subscribe } from "@/server/lib/notify-bus";

export const dynamic = "force-dynamic";

/**
 * Server-sent events fed by PostgreSQL LISTEN/NOTIFY. Only members can subscribe; payloads carry ids, not content.
 * Uses the process-wide listener (no pooled connection per stream) and tears down when the browser disconnects.
 */
export async function GET(req: Request, context: { params: Promise<{ org: string }> }) {
  const { org } = await context.params;
  let ctx;
  try { ctx = await orgContext(org); } catch (err) { return errorResponse(err, "sse"); }
  const channel = `org_${ctx.org.id.replace(/-/g, "")}`;
  const encoder = new TextEncoder();
  let keepalive: ReturnType<typeof setInterval> | null = null;
  let unsubscribe: (() => Promise<void>) | null = null;
  let done = false;
  const cleanup = async () => {
    if (done) return;
    done = true;
    if (keepalive) clearInterval(keepalive);
    if (unsubscribe) await unsubscribe();
  };
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const close = () => { try { controller.close(); } catch { /* already closed */ } };
      const send = (s: string) => { try { controller.enqueue(encoder.encode(s)); } catch { void cleanup(); } };
      // Next does not always call cancel() when the browser goes away; the request signal is the reliable hook. It is
      // listened to before the subscribe, and checked again after it (fix review, 23 October 2026: realtime plan,
      // phase 0): a browser that left while the LISTEN connection was still opening, which takes seconds after a Neon
      // suspend, used to leave its subscriber behind, so the connection never closed and kept reconnecting, waking Neon.
      req.signal.addEventListener("abort", () => { void cleanup(); close(); }, { once: true });
      if (req.signal.aborted) { await cleanup(); close(); return; }
      let un: () => Promise<void>;
      try { un = await subscribe(channel, (payload) => send(`data: ${payload}\n\n`)); }
      catch (err) {
        if (!done) send(`event: error\ndata: ${JSON.stringify({ message: (err as Error).message })}\n\n`);
        close();
        return;
      }
      if (done || req.signal.aborted) { done = true; await un(); close(); return; }
      unsubscribe = un;
      send(`: connected\n\n`);
      keepalive = setInterval(() => send(`: keepalive\n\n`), 25000);
    },
    async cancel() { await cleanup(); },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
}
