import { adminRoute, ok } from "@/server/admin/auth";
import { withSystem } from "@/server/db";
import { renderTemplate, type TemplateRow } from "@/server/admin/marketing";
import { notFound } from "@/server/lib/errors";

/** A rendered preview of a template with sample values. */
export const GET = adminRoute<{ id: string }>("marketing.view", async (_req, { params }) => {
  const t = await withSystem((db) => db.maybeOne<TemplateRow>(`SELECT * FROM email_templates WHERE id = $1`, [params.id]));
  if (!t) throw notFound("Template not found.");
  return ok(renderTemplate(t, { first_name: "Ada", organization_name: "Acme Ltd", plan_name: "Pro", subscription_expiry: "18 Oct 2026", renewal_amount: "₦15,000", payment_reference: "BR-SAMPLE", reason: "sample" }, "Preview from the Control Center."));
});
