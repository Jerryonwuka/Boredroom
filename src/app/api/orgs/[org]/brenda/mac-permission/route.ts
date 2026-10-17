import { route, orgContext, ok, parseBody } from "@/server/lib/api";
import { macPermission, macPermissionSchema, saveMacPermission } from "@/server/services/front";

/**
 * The person's own "Check with me before every task" (Brenda and her helpers, build 1; owner's approved brief, 12 October
 * 2026, decision 9: "'Request is permission' is the default for everyone on their own Mac, with 'Check with me before
 * every task'; owners can't change it"; contract F.3, N.2). Off by default: the person's request is the go-ahead for
 * routine things, and she still asks before deleting, sending, paying or anything to do with security. On: she asks
 * "Do you want me to do this?" before everything, even opening an app.
 *
 * GET `{ ready, checkEveryTask, impersonated }`; PUT `{ checkEveryTask }`. The caller's own row only (owners and HR never
 * read or change anyone else's); refused while someone else is signed in as the person; 503 before 0060. The web's
 * settings card and the notch's settings card both use it.
 */
export const GET = route<{ org: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  return ok(await macPermission(ctx));
});

export const PUT = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, macPermissionSchema, { maxBytes: 1_024 });
  return ok(await saveMacPermission(ctx, body));
});
