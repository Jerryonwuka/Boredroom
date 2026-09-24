import { adminRoute } from "@/server/admin/auth";
import { exportContacts } from "@/server/admin/marketing";
import { withSystem } from "@/server/db";
import { adminAudit } from "@/server/admin/auth";

const csv = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/** CSV of contacts matching the same filters as the list. */
export const GET = adminRoute("waitlist.export", async (req, { admin }) => {
  const u = new URL(req.url);
  const rows = await exportContacts({ q: u.searchParams.get("q") ?? undefined, status: u.searchParams.get("status") ?? undefined, waitlist: u.searchParams.get("waitlist") === "1" ? true : undefined, source: u.searchParams.get("source") ?? undefined, companySize: u.searchParams.get("companySize") ?? undefined, country: u.searchParams.get("country") ?? undefined, from: u.searchParams.get("from") ?? undefined, to: u.searchParams.get("to") ?? undefined });
  await withSystem((db) => adminAudit(db, admin, { action: "contacts.exported", targetType: "contact", metadata: { count: rows.length } }));
  const head = ["email", "first_name", "last_name", "company", "company_size", "role", "country", "source", "status", "waitlist", "joined"];
  const body = [head.join(","), ...rows.map((r) => [r.email, r.first_name, r.last_name, r.company, r.company_size, r.role_title, r.country, r.source, r.status, r.is_waitlist ? "yes" : "no", r.created_at].map(csv).join(","))].join("\n");
  return new Response(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="contacts-${new Date().toISOString().slice(0, 10)}.csv"` } });
});
