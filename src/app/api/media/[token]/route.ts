import { resolveMediaToken } from "@/server/services/recording";
import { storage } from "@/server/lib/storage";
import { getCurrentUser } from "@/server/auth";
import { withSystem } from "@/server/db";
import { Readable } from "node:stream";

/** Streams assembled recording media for a signed 60-second token, re-checking restriction/deletion at request time. */
export async function GET(req: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const user = await getCurrentUser();
  if (!user) return new Response("Sign in required", { status: 401 });
  const t = resolveMediaToken(token);
  if (!t) return new Response("Link expired", { status: 410 });
  const live = await withSystem((db) => db.maybeOne<{ ok: boolean }>(`SELECT (deleted_at IS NULL AND restricted_at IS NULL AND expires_at > now() AND upload_state = 'ready') AS ok FROM recordings WHERE id = $1`, [t.r]));
  if (!live?.ok) return new Response("Recording unavailable", { status: 410 });
  const size = await storage().size(t.k);
  if (size == null) return new Response("Not found", { status: 404 });
  const range = req.headers.get("range");
  const headers: Record<string, string> = { "Content-Type": t.m, "Accept-Ranges": "bytes", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline" };
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    const start = m && m[1] ? Number(m[1]) : 0;
    const end = m && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    const full = await storage().get(t.k);
    if (!full) return new Response("Not found", { status: 404 });
    headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
    headers["Content-Length"] = String(end - start + 1);
    return new Response(new Uint8Array(full.subarray(start, end + 1)), { status: 206, headers });
  }
  headers["Content-Length"] = String(size);
  const stream = storage().stream(t.k);
  if (!stream) return new Response("Not found", { status: 404 });
  return new Response(Readable.toWeb(stream) as ReadableStream, { headers });
}
