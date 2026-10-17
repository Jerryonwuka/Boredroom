import { route, orgContext, ok, requireFeature } from "@/server/lib/api";
import { ACT_LIMITS } from "@/lib/act";
import { fileSchema, fileTask, readActBody } from "@/server/services/act";

/**
 * A file job the person asked for and said yes to (owner request and permission rule, 12 October 2026: "help you work on
 * a file and it does that in the background while you're still working"; contract D.9). Rust alone calls it, with the
 * one file the person said yes to (its text, or the PDF or picture itself). The answer is the new file's contents for the
 * Mac to save next to the original (never over it), or a private Boredroom document. Nothing from the file or the output
 * is stored or logged. A plan's file job (phase 3, 12 October 2026) carries its step's index `i` and runs only when it is
 * the plan's current step.
 */
export const maxDuration = 300;

export const POST = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  requireFeature(ctx, "AI_ASSISTANT");
  const body = await readActBody(req, fileSchema, ACT_LIMITS.bodyBytes);
  return ok(await fileTask(ctx, params.id, body));
});
