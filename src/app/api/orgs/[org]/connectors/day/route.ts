import { route, orgContext, ok } from "@/server/lib/api";
import { connectedDay } from "@/server/connectors/items";

/**
 * The viewer's own day from their apps (spec §11.4): their calendar events and the issues assigned to them. Only ever
 * their own, whatever their role. `?date=YYYY-MM-DD`. Before 0061 or without the plan: `{ ready | enabled: false }`.
 */
export const GET = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const date = new URL(req.url).searchParams.get("date");
  return ok(await connectedDay(ctx, date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null));
});
