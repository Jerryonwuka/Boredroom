import { route, parseBody, orgContext, ok } from "@/server/lib/api";
import { setBrendaPrefs, settingsSchema } from "@/server/services/brenda";

/** The person's own switches: automatic clock-in and reminders, inside what the organisation allows. */
export const PATCH = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  return ok(await setBrendaPrefs(ctx, await parseBody(req, settingsSchema)));
});
