import { route, parseBody, orgContext, ok } from "@/server/lib/api";
import { createReminder, listReminders, reminderSchema } from "@/server/services/brenda";

export const GET = route<{ org: string }>(async (_req, { params }) => ok({ reminders: await listReminders(await orgContext(params.org)) }));

export const POST = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  return ok(await createReminder(ctx, await parseBody(req, reminderSchema)));
});
