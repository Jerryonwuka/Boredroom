import { z } from "zod";
import { route, parseBody, orgContext, ok, idempotent } from "@/server/lib/api";
import { abilitiesView, savePersonalAbility } from "@/server/services/abilities";
import type { AbilityKey } from "@/lib/abilities";

/**
 * Brenda's abilities (owner decisions, 8–9 October 2026: phase 7c, the abilities catalogue): `AbilitiesView`, every card
 * with what it does, "Use when…", "Never…", its state for the person and its switches (the workspace's, the person's
 * own, and the existing switches surfaced with links to their cards). `ready: false` before migration 0050.
 */
export const GET = route<{ org: string }>(async (_req, { params }) => ok(await abilitiesView(await orgContext(params.org))));

const bodySchema = z.object({ key: z.string().trim().min(1).max(40), on: z.boolean() });

/**
 * The person switches one of their own abilities on or off: `{ key, on }` → `AbilitiesView`. 400 for a key that is not
 * switched here; 403 while someone else is signed in as them; 503 before migration 0050. Not audited.
 */
export const PATCH = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, bodySchema, { maxBytes: 1024 });
  return idempotent(req, ctx.user, "abilities.personal", body, async () => ({
    status: 200, body: await savePersonalAbility(ctx, { key: body.key as AbilityKey, on: body.on }),
  }));
});
