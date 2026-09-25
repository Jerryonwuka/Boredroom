import { requireAdmin, can } from "@/server/admin/auth";
import { listContacts } from "@/server/admin/marketing";
import { PageHeader, Card, CardHeader } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import { Filters, Pager, CsvLink, AdminAction } from "@/components/admin/actions";
import { F, inputCls } from "@/components/admin/fields";
import { ContactImportForm } from "@/components/admin/marketing-forms";
import { dateOnly } from "@/lib/format";
import { DatePicker } from "@/components/ui/date-picker";

export const metadata = { title: "Contacts" };
const TONE: Record<string, "success" | "warning" | "danger" | "neutral" | "info" | "accent"> = { waiting: "warning", invited: "info", registered: "accent", activated: "success", trial: "info", paid: "success", unsubscribed: "danger" };

export default async function ContactsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const admin = await requireAdmin("marketing.view");
  const sp = await searchParams;
  const r = await listContacts({ q: sp.q, status: sp.status, waitlist: sp.waitlist === "1" ? true : undefined, source: sp.source, companySize: sp.companySize, country: sp.country, from: sp.from, to: sp.to, page: Number(sp.page ?? 1) });
  const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]).toString();
  return (
    <>
      <PageHeader icon="people" title="Contacts" description="Product users, marketing contacts and the waitlist, one record each, traceable from first signup to paid." actions={can(admin, "waitlist.export") ? <CsvLink href={`/api/admin/contacts/export?${qs}`} /> : null} />
      <Filters>
        <F label="Search"><input name="q" defaultValue={sp.q ?? ""} placeholder="Email, name, company" className={`${inputCls} w-64`} /></F>
        <F label="Status"><select name="status" defaultValue={sp.status ?? ""} className={inputCls}><option value="">Any</option>{["waiting", "invited", "registered", "activated", "trial", "paid", "unsubscribed"].map((s) => <option key={s} value={s}>{s}</option>)}</select></F>
        <F label="Waitlist"><select name="waitlist" defaultValue={sp.waitlist ?? ""} className={inputCls}><option value="">Everyone</option><option value="1">Waitlist only</option></select></F>
        <F label="Company size"><input name="companySize" defaultValue={sp.companySize ?? ""} className={`${inputCls} w-28`} /></F>
        <F label="Country"><input name="country" defaultValue={sp.country ?? ""} className={`${inputCls} w-28`} /></F>
        <F label="From"><DatePicker name="from" defaultValue={sp.from ?? ""} size="sm" /></F>
        <F label="To"><DatePicker name="to" defaultValue={sp.to ?? ""} size="sm" /></F>
      </Filters>
      {r.rows.length === 0 ? <EmptyState icon3d="people" title="No contacts match" /> : (
        <DataTable caption="Contacts">
          <thead><tr><th>Contact</th><th>Company</th><th>Source</th><th>Status</th><th>Brevo</th><th>Joined</th>{can(admin, "waitlist.edit") ? <th></th> : null}</tr></thead>
          <tbody>{r.rows.map((c) => (
            <tr key={c.id}>
              <td><span className="block font-medium">{[c.first_name, c.last_name].filter(Boolean).join(" ") || "—"}</span><span className="text-xs text-fg-subtle">{c.email}</span></td>
              <td className="text-sm">{c.company ?? "—"}{c.company_size ? <span className="block text-xs text-fg-subtle">{c.company_size} · {c.role_title ?? ""}</span> : null}</td>
              <td className="text-sm">{c.source}{c.is_waitlist ? <Badge tone="warning" className="ml-1">waitlist</Badge> : null}</td>
              <td><Badge tone={TONE[c.status] ?? "neutral"}>{c.status}</Badge></td>
              <td className="text-xs text-fg-subtle">{c.brevo_error ? <span className="text-danger" title={c.brevo_error}>failed</span> : c.brevo_synced_at ? `synced ${dateOnly(c.brevo_synced_at)}` : "—"}</td>
              <td className="text-sm">{dateOnly(c.created_at)}</td>
              {can(admin, "waitlist.edit") ? <td className="text-right"><span className="inline-flex gap-1">{c.status === "waiting" ? <AdminAction path={`/api/admin/contacts/${c.id}`} method="PATCH" body={{ status: "invited" }}>Invite</AdminAction> : null}{c.status !== "unsubscribed" ? <AdminAction path={`/api/admin/contacts/${c.id}`} method="PATCH" body={{ status: "unsubscribed" }} variant="ghost">Unsubscribe</AdminAction> : <AdminAction path={`/api/admin/contacts/${c.id}`} method="PATCH" body={{ status: "waiting" }} variant="ghost">Resubscribe</AdminAction>}</span></td> : null}
            </tr>
          ))}</tbody>
        </DataTable>
      )}
      <Pager page={r.page} pageSize={r.pageSize} total={r.total} />
      {can(admin, "marketing.create") ? <Card className="mt-6"><CardHeader title="Import contacts" description="Paste a list. Existing contacts are updated, never duplicated." /><ContactImportForm /></Card> : null}
    </>
  );
}
