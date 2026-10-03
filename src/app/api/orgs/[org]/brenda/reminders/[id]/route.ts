import { route, orgContext, ok } from "@/server/lib/api";
import { cancelReminder } from "@/server/services/brenda";

export const DELETE = route<{ org: string; id: string }>(async (_req, { params }) => ok(await cancelReminder(await orgContext(params.org), params.id)));
