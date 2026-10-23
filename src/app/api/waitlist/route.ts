import { route, parseBody, ok } from "@/server/lib/api";
import { joinWaitlist, waitlistSchema } from "@/server/admin/launch";
import { launchSettings } from "@/server/admin/settings";
import { forbidden } from "@/server/lib/errors";
import { wakeTag } from "@/server/lib/wake-tag";

/** The public waitlist form. Open while the platform is in waitlist mode, or in live mode when the waitlist stays open. */
export const POST = route(async (req) => {
  wakeTag("waitlist"); // owner request, 23 October 2026: realtime plan, phase 0
  const l = await launchSettings();
  if (!(l.mode === "waitlist" || l.waitlist_open)) throw forbidden("The waitlist is closed; Boredroom is open. Create your account instead.");
  const body = await parseBody(req, waitlistSchema);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  return ok(await joinWaitlist(body, ip), 201);
});
