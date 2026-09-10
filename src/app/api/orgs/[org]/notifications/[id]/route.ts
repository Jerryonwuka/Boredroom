import { route, orgContext, ok } from "@/server/lib/api";
import { withUser } from "@/server/db";

export const PATCH = route<{ org: string; id: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  await withUser(ctx.user.profileId, (db) => db.query(`UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1 AND organisation_id = $2`, [params.id, ctx.org.id]));
  return ok({ ok: true });
});
