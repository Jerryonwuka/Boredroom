import { z } from "zod";
import { adminRoute, ok } from "@/server/admin/auth";
import { parseBody } from "@/server/lib/api";
import { saveSegment, segmentSchema } from "@/server/admin/marketing";

export const POST = adminRoute("marketing.create", async (req, { admin }) => {
  const body = await parseBody(req, segmentSchema.extend({ id: z.string().uuid().nullable().optional() }));
  return ok(await saveSegment(admin, body.id ?? null, body), 201);
});
