import { route, parseBody, orgContext, ok, requireRole } from "@/server/lib/api";
import { brendaOverview, setBrendaSettings, orgSettingsSchema } from "@/server/services/brenda";

/** What the organisation allows Brenda to do, and the recent action log (owners and HR). */
export const GET = route<{ org: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  return ok(await brendaOverview(ctx));
});

/** Automatic clock-in, reminders and the daily team report (on or off, the local time it goes out, whole organisation). */
export const PATCH = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  requireRole(ctx, "owner", "hr");
  return ok(await setBrendaSettings(ctx, await parseBody(req, orgSettingsSchema)));
});
