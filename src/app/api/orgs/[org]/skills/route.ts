import { z } from "zod";
import { route, orgContext, parseBody, ok } from "@/server/lib/api";
import { addSkill, listSkills } from "@/server/skills/skills";

const file = z.object({ name: z.string().max(100), text: z.string().max(210_000) });
const schema = z.object({ skillMd: z.string().max(60_000), files: z.array(file).max(5).optional() });

/** The workspace's skills and Brenda's starter skills (owners and HR; owner decisions, 4 November 2026: phase 1). */
export const GET = route<{ org: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  return ok({ skills: await listSkills(ctx) });
});

/** Adds a skill from its SKILL.md and up to 5 files; on at once. */
export const POST = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  return ok(await addSkill(ctx, await parseBody(req, schema, { maxBytes: 300_000 })), 201);
});
