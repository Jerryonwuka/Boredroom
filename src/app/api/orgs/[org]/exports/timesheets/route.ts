import { z } from "zod";
import { route, parseQuery, orgContext } from "@/server/lib/api";
import { exportTimesheetsCsv } from "@/server/services/reports";

const schema = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), membershipId: z.string().uuid().optional() });

export const GET = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const q = parseQuery(req, schema);
  const { csv } = await exportTimesheetsCsv(ctx, { from: q.from, to: q.to, membershipId: q.membershipId ?? null });
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="timesheets-${ctx.org.slug}-${q.from}-${q.to}.csv"`, "Cache-Control": "private, no-store" } });
});
