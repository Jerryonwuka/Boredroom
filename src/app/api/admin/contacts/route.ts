import { z } from "zod";
import { adminRoute, ok } from "@/server/admin/auth";
import { parseBody } from "@/server/lib/api";
import { withSystem } from "@/server/db";
import { contactSchema, upsertContact } from "@/server/admin/marketing";
import { adminAudit } from "@/server/admin/auth";

/** Adds one contact, or imports many (email per line, optionally "email, first, last, company"). */
export const POST = adminRoute("marketing.create", async (req, { admin }) => {
  const body = await parseBody(req, z.union([contactSchema, z.object({ import: z.string().max(200_000), source: z.string().trim().max(60).default("import"), isWaitlist: z.boolean().default(false) })]));
  return withSystem(async (db) => {
    if ("import" in body) {
      let n = 0;
      for (const line of body.import.split(/\r?\n/)) {
        const [email, first, last, company] = line.split(",").map((s) => s.trim());
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
        await upsertContact(db, { email: email.toLowerCase(), firstName: first || null, lastName: last || null, company: company || null, source: body.source, isWaitlist: body.isWaitlist });
        n++;
      }
      await adminAudit(db, admin, { action: "contacts.imported", targetType: "contact", metadata: { count: n, source: body.source } });
      return ok({ imported: n }, 201);
    }
    const r = await upsertContact(db, body);
    await adminAudit(db, admin, { action: r.created ? "contact.created" : "contact.updated", targetType: "contact", targetId: r.id, targetLabel: body.email });
    return ok(r, 201);
  });
});
