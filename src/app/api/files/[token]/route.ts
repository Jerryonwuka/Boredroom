import { resolveFileToken } from "@/server/services/evidence";
import { storage } from "@/server/lib/storage";
import { getCurrentUser } from "@/server/auth";
import { Readable } from "node:stream";

/** Serves a private file for a signed, 60-second token. Always as an attachment; never rendered inline. */
export async function GET(_req: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const user = await getCurrentUser();
  if (!user) return new Response("Sign in required", { status: 401 });
  const f = resolveFileToken(token);
  if (!f) return new Response("Link expired", { status: 410 });
  const stream = storage().stream(f.key);
  if (!stream) return new Response("Not found", { status: 404 });
  const safeName = f.name.replace(/[^\w.-]+/g, "_");
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${safeName}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
