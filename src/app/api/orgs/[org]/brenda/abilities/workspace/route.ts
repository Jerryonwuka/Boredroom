import { z } from "zod";
import { route, parseBody, orgContext, idempotent } from "@/server/lib/api";
import { saveWorkspaceAbility } from "@/server/services/abilities";
import type { AbilityKey } from "@/lib/abilities";

const bodySchema = z.object({ key: z.string().trim().min(1).max(40), offered: z.boolean() });

/**
 * Owners and HR choose whether the workspace offers one of Brenda's abilities (owner decisions, 8–9 October 2026: phase
 * 7c): `{ key, offered }` → `AbilitiesView`. 400 for a key with its own card ("Change this one in its own card below.");
 * 403 for anyone else; 503 before migration 0050. Audited (`brenda.ability_changed`) and logged.
 */
export const PATCH = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, bodySchema, { maxBytes: 1024 });
  return idempotent(req, ctx.user, "abilities.workspace", body, async () => ({
    status: 200, body: await saveWorkspaceAbility(ctx, { key: body.key as AbilityKey, offered: body.offered }),
  }));
});
