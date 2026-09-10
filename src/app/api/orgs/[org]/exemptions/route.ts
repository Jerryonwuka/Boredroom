import { z } from "zod";
import { route, parseBody, orgContext, ok } from "@/server/lib/api";
import { withUser } from "@/server/db";
import { forbidden } from "@/server/lib/errors";
import { audit } from "@/server/services/common";

const schema = z.object({ membershipId: z.string().uuid(), localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reason: z.string().trim().min(1).max(500) });

/** Authorised workday exemption (leave, holiday) so report completeness is not knowingly wrong. */
export const POST = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, schema);
  await withUser(ctx.user.profileId, async (db) => {
    const scope = await db.one<{ v: boolean }>(`SELECT (app_has_role($1, 'owner', 'hr') OR app_manages($1, $2)) AS v`, [ctx.org.id, body.membershipId]);
    if (!scope.v) throw forbidden("Only HR, owners or the member's manager can add an exemption.");
    await db.query(`INSERT INTO workday_exemptions(organisation_id, membership_id, local_date, reason, created_by) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (membership_id, local_date) DO UPDATE SET reason = EXCLUDED.reason`, [ctx.org.id, body.membershipId, body.localDate, body.reason, ctx.membership.id]);
    await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "exemption.set", subjectType: "workday_exemption", subjectMembershipId: body.membershipId, metadata: { localDate: body.localDate, reason: body.reason } });
  });
  return ok({ ok: true }, 201);
});
