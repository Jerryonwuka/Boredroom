import { route, orgContext, ok } from "@/server/lib/api";
import { uploadDeliverableFile } from "@/server/services/evidence";
import { invalid } from "@/server/lib/errors";

export const POST = route<{ org: string; task: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw invalid("Attach a file.");
  const bytes = Buffer.from(await file.arrayBuffer());
  return ok(await uploadDeliverableFile(ctx, params.task, { name: file.name, type: file.type, bytes }), 201);
});
