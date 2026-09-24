import { Readable } from "node:stream";
import { getCurrentUser } from "@/server/auth";
import { storage } from "@/server/lib/storage";
import { avatarFor } from "@/server/services/profile";

/** Serves a profile picture to a signed-in viewer who shares an organisation with its owner. Cached briefly; the URL changes with the image. */
export async function GET(_req: Request, context: { params: Promise<{ profileId: string }> }) {
  const { profileId } = await context.params;
  const user = await getCurrentUser();
  if (!user) return new Response("Sign in required", { status: 401 });
  if (!/^[0-9a-f-]{36}$/i.test(profileId)) return new Response("Not found", { status: 404 });
  let file: { key: string; mime: string };
  try { file = await avatarFor(user, profileId); } catch { return new Response("Not found", { status: 404 }); }
  const stream = storage().stream(file.key);
  if (!stream) return new Response("Not found", { status: 404 });
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    headers: { "Content-Type": file.mime, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" },
  });
}
