import { route, orgContext, ok } from "@/server/lib/api";
import { connectorsReady, connectorsView, notReadyView } from "@/server/connectors/connections";

/**
 * Connected apps (owner decisions, 22 October 2026: connectors; spec §4.3): what the viewer may see. The catalogue
 * (providers without their variables: owners only, "Not set up yet"), the workspace's policies, its connections (owners
 * and HR: in full; everyone else: what each is for), the viewer's own personal connections (never anyone else's, never a
 * count; none while someone is signed in as them) and the channel routes. Before 0061: `{ ready: false }`, no error, so
 * the screens can say a database update is needed.
 */
export const GET = route<{ org: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  if (!(await connectorsReady())) return ok(notReadyView(ctx));
  if (!ctx.plan.features.CONNECTORS) return ok({ ...notReadyView(ctx), ready: true, enabled: false });
  return ok(await connectorsView(ctx));
});
