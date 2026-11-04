import { z } from "zod";
import { route, orgContext, parseBody, ok, uuid } from "@/server/lib/api";
import { removeSkill, updateSkill } from "@/server/skills/skills";

const file = z.object({ name: z.string().max(100), text: z.string().max(210_000) });
const schema = z.object({ enabled: z.boolean().optional(), skillMd: z.string().max(60_000).optional(), files: z.array(file).max(5).optional() });

/** Turns one of the workspace's skills on or off, or replaces its SKILL.md and files. Owners and HR. */
export const PATCH = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  return ok(await updateSkill(ctx, uuid.parse(params.id), await parseBody(req, schema, { maxBytes: 300_000 })));
});

/** Removes one of the workspace's skills. Owners and HR. */
export const DELETE = route<{ org: string; id: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  return ok(await removeSkill(ctx, uuid.parse(params.id)));
});
