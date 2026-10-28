import { z } from "zod";
import { route, parseBody, orgContext, ok } from "@/server/lib/api";
import { forgetAllLearned, listLearned, setLearning } from "@/server/services/learning";

/**
 * "What Brenda has learned" (owner decision, 28 October 2026): `LearnedList`, the habits the person's assistant learned
 * from how they use it (the most confident first, at most 12) and their switch "Learn from how I use Brenda". Only the
 * person ever reads these; hidden while someone else is signed in as them; `ready: false` before migration 0067.
 */
export const GET = route<{ org: string }>(async (_req, { params }) => ok(await listLearned(await orgContext(params.org))));

/** The switch: `{ enabled }` → `LearnedList`. Off deletes the signals kept so far. 403 impersonated; 503 before 0067. */
export const PATCH = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const b = await parseBody(req, z.object({ enabled: z.boolean() }), { maxBytes: 1024 });
  return ok(await setLearning(ctx, b.enabled));
});

/** "Forget everything": every habit and signal goes, and learning starts again from now → `LearnedList`. */
export const DELETE = route<{ org: string }>(async (_req, { params }) => ok(await forgetAllLearned(await orgContext(params.org))));
