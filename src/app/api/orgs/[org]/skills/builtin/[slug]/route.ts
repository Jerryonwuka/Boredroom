import { z } from "zod";
import { route, orgContext, parseBody, ok } from "@/server/lib/api";
import { setBuiltinSkill } from "@/server/skills/skills";

const schema = z.object({ enabled: z.boolean() });

/** Turns one of Brenda's starter skills off or on for the workspace. Owners and HR. */
export const PUT = route<{ org: string; slug: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const { enabled } = await parseBody(req, schema, { maxBytes: 128 });
  return ok(await setBuiltinSkill(ctx, z.string().regex(/^[a-z0-9-]{1,48}$/).parse(params.slug), enabled));
});
