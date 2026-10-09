import { z } from "zod";
import { route, parseBody, orgContext, ok, idempotent } from "@/server/lib/api";
import { deletePreference, updatePreference } from "@/server/services/preferences";

const bodySchema = z.object({ body: z.string().max(2000) });

/**
 * Changes one of the person's preferences (owner decisions, 8–9 October 2026: phase 7c): `{ body }` → `Preference`.
 * The same checks as adding; 404 when it is not theirs.
 */
export const PATCH = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const b = await parseBody(req, bodySchema, { maxBytes: 4096 });
  return idempotent(req, ctx.user, "preferences.edit", { id: params.id, ...b }, async () => ({ status: 200, body: await updatePreference(ctx, params.id, b.body) }));
});

/** Deletes one: `{ deleted: true }`. 404 when it is not theirs; 403 while someone else is signed in as them. */
export const DELETE = route<{ org: string; id: string }>(async (_req, { params }) => ok(await deletePreference(await orgContext(params.org), params.id)));
