import { route, orgContext, ok, parseBody } from "@/server/lib/api";
import { myScreenHelp, saveMyScreenHelp, screenHelpMinePutSchema } from "@/server/services/screen-help";

/**
 * Settings › Your assistant's screen help card, and the notch's "Never look at {App}" (owner decisions, 11 October 2026:
 * screen help on Brenda for Mac; contract 0.11, D.5). The person's own never-look list and "Turn off on my Macs" (a time
 * their Macs obey on the next poll), in assistant_private (theirs alone: owners, HR and leads never read it). PUT refuses
 * while someone else is signed in as them (403); before 0057 it answers 503 NOT_READY.
 *
 * Phase 3 (owner report, 12 October 2026: "when I turned this setting on, I stopped seeing my Brenda"; contract A.5, 0b.2,
 * 0b.3): GET also gives what each of the person's Macs last reported (which abilities are on, for them alone; nothing
 * while someone else is signed in as them), and PUT takes `setup: true` ("Set up on my Mac": their Macs open the setup
 * card at their next poll, which asks before turning anything on; 503 before migration 0059). "Turn off on my Macs" also
 * clears a pending Set up.
 */
export const GET = route<{ org: string }>(async (_req, { params }) => {
  return ok(await myScreenHelp(await orgContext(params.org)));
});

export const PUT = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, screenHelpMinePutSchema, { maxBytes: 64_000 });
  return ok(await saveMyScreenHelp(ctx, body));
});
