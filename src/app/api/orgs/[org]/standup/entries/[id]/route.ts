import { route, parseBody, orgContext, ok, idempotent } from "@/server/lib/api";
import { notFound } from "@/server/lib/errors";
import { STANDUP_BODY_MAX, editStandup, getStandupEntry, standupEditSchema } from "@/server/services/standup";
import { STANDUP_WORDS } from "@/lib/standup";

/** One of the person's standups (owner decisions, 8–9 October 2026: phase 7c): `StandupEntryView`; 404 otherwise. */
export const GET = route<{ org: string; id: string }>(async (_req, { params }) => {
  const v = await getStandupEntry(await orgContext(params.org), params.id);
  if (!v) throw notFound(STANDUP_WORDS.errors.notFound);
  return ok(v);
});

/**
 * The person's own words for one or more sections of a ready draft: `{ yesterday?, today?, blocked? }` (each at most
 * 1200 characters once cleaned) → `StandupEntryView`. 400 too long or all empty; 403 while someone else is signed in as
 * them; 404 not theirs; 409 STANDUP_CLOSED once it is not ready (or STANDUP_OFF); 503 before migration 0050.
 */
export const PATCH = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, standupEditSchema, { maxBytes: STANDUP_BODY_MAX * 3 });
  return idempotent(req, ctx.user, "standup.edit", { id: params.id, ...body }, async () => ({ status: 200, body: await editStandup(ctx, params.id, body) }));
});
