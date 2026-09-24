import { z } from "zod";
import { adminRoute, ok } from "@/server/admin/auth";
import { parseBody } from "@/server/lib/api";
import { forbidden } from "@/server/lib/errors";
import { previewCampaign, sendCampaignTest, launchCampaign, cancelCampaign } from "@/server/admin/marketing";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview") }),
  z.object({ action: z.literal("test"), to: z.string().trim().email() }),
  z.object({ action: z.literal("send"), scheduledAt: z.string().datetime({ offset: true }).nullable().optional(), confirm: z.literal(true) }),
  z.object({ action: z.literal("cancel") }),
]);

export const POST = adminRoute<{ id: string }>("marketing.view", async (req, { params, admin }) => {
  const body = await parseBody(req, schema);
  if (body.action === "preview") return ok(await previewCampaign(params.id));
  if (!admin.permissions.has("marketing.send")) throw forbidden("Your role does not include marketing.send.");
  if (body.action === "test") { await sendCampaignTest(admin, params.id, body.to); return ok({ ok: true }); }
  if (body.action === "send") { await launchCampaign(admin, params.id, body.scheduledAt ?? null); return ok({ ok: true }); }
  await cancelCampaign(admin, params.id);
  return ok({ ok: true });
});
