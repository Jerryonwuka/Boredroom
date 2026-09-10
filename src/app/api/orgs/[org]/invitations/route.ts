import { route, parseBody, orgContext, ok, requireRole } from "@/server/lib/api";
import { createInvitation, inviteSchema } from "@/server/services/orgs";

export const POST = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  requireRole(ctx, "owner", "hr");
  const body = await parseBody(req, inviteSchema);
  // Sending is an explicit administrator action; in development the sink captures the message.
  return ok(await createInvitation(ctx, body, { send: true }), 201);
});
