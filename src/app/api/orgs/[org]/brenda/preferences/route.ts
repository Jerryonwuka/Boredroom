import { z } from "zod";
import { route, parseBody, orgContext, ok, idempotent } from "@/server/lib/api";
import { addPreference, listPreferences } from "@/server/services/preferences";

/**
 * "How I like things done" (owner decisions, 8–9 October 2026: phase 7c): `PreferenceList`, the person's own preferences
 * in their own words, oldest first (at most 16). Hidden while someone else is signed in as them; `ready: false` before
 * migration 0050. Only the person ever reads these.
 */
export const GET = route<{ org: string }>(async (_req, { params }) => ok(await listPreferences(await orgContext(params.org))));

const bodySchema = z.object({ body: z.string().max(2000) });

/**
 * Adds one: `{ body }` → `Preference` (201). 400 with the problem's words (empty, over 150 characters, a link, a
 * permission rather than a preference); 409 PREFERENCES_FULL at 16, PREFERENCE_EXISTS for the same words; 403 while
 * someone else is signed in as them; 503 before migration 0050.
 */
export const POST = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const b = await parseBody(req, bodySchema, { maxBytes: 4096 });
  return idempotent(req, ctx.user, "preferences.add", b, async () => ({ status: 201, body: await addPreference(ctx, b.body, "settings") }));
});
