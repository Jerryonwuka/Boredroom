import { orgContext, errorResponse } from "@/server/lib/api";
import { storage } from "@/server/lib/storage";
import { voiceFor } from "@/server/services/messaging";

/** Streams a voice note to someone in the conversation. Honours a single byte range, which Safari needs to play audio. */
export async function GET(req: Request, context: { params: Promise<{ org: string; message: string }> }) {
  const { org, message } = await context.params;
  let ctx;
  try { ctx = await orgContext(org); } catch (err) { return errorResponse(err, "voice"); }
  if (!/^[0-9a-f-]{36}$/i.test(message)) return new Response("Not found", { status: 404 });
  let file: { key: string; mime: string };
  try { file = await voiceFor(ctx, message); } catch { return new Response("Not found", { status: 404 }); }
  const bytes = await storage().get(file.key);
  if (!bytes) return new Response("Not found", { status: 404 });
  const headers: Record<string, string> = { "Content-Type": file.mime, "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" };
  const range = req.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
    if (start > end || start >= bytes.length) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${bytes.length}` } });
    const part = bytes.subarray(start, end + 1);
    return new Response(new Uint8Array(part), { status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${bytes.length}`, "Content-Length": String(part.length) } });
  }
  return new Response(new Uint8Array(bytes), { headers: { ...headers, "Content-Length": String(bytes.length) } });
}
