import { z } from "zod";
import { route, parseBody, orgContext, ok } from "@/server/lib/api";
import { listMutes, setMute } from "@/server/services/assistant-items";

/**
 * Muted assistants (owner decision, 8 October 2026: personal assistants, phase 6): the colleagues whose assistants the
 * person stopped, `{ ready, mutes: { membershipId, name, assistant, mutedAt }[] }`. The person's own; before migration
 * 0043 `ready: false`.
 */
export const GET = route<{ org: string }>(async (_req, { params }) => ok(await listMutes(await orgContext(params.org))));

const bodySchema = z.object({
  senderMembershipId: z.string().uuid({ error: "Pick whose assistant." }),
  muted: z.boolean({ error: "Say whether to stop their items." }),
});

/**
 * `{ senderMembershipId, muted }`: stop (or allow again) new messages and requests from that colleague's assistant, and
 * their tags of the person's assistant in Messages. Refused (403) while someone else is signed in as the person; 503
 * before migration 0043.
 */
export const PUT = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, bodySchema, { maxBytes: 4096 });
  return ok(await setMute(ctx, body.senderMembershipId, body.muted));
});
