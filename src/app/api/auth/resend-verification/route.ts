import { z } from "zod";
import { route, ok, parseBody, requireAuth } from "@/server/lib/api";
import { resendVerification } from "@/server/auth";
import { wakeTag } from "@/server/lib/wake-tag";

// An optional `{ next }` (owner request, 11 October 2026: the first-run welcome): the new link carries it too. No body
// still works.
const schema = z.object({ next: z.string().max(512).nullish() });

export const POST = route(async (req) => {
  wakeTag("auth"); // owner request, 23 October 2026: realtime plan, phase 0
  const user = await requireAuth();
  const { next } = await parseBody(req, schema, { maxBytes: 2048 });
  await resendVerification(user.email, next ?? null);
  return ok({ ok: true });
});
