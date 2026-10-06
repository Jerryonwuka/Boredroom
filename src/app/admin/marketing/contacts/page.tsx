import { Contact } from "lucide-react";
import { requireAdmin, can } from "@/server/admin/auth";
import { listContacts } from "@/server/admin/marketing";
import { PageHeader } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import { DatePicker } from "@/components/ui/date-picker";
import { Filters, Pager, CsvLink, AdminAction, SheetButton } from "@/components/admin/actions";
import { F, MARKETING_TABS, filterCls, subCls, words } from "@/components/admin/fields";
import { ContactImportForm } from "@/components/admin/marketing-forms";
import { dateOnly } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata = { title: "Contacts" };
const TONE: Record<string, "success" | "warning" | "danger" | "neutral" | "info"> = { waiting: "warning", invited: "info", registered: "neutral", activated: "success", trial: "info", paid: "success", unsubscribed: "danger" };

export default async function ContactsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const admin = await requireAdmin("marketing.view");
  const sp = await searchParams;
  const r = await listContacts({ q: sp.q, status: sp.status, waitlist: sp.waitlist === "1" ? true : undefined, source: sp.source, companySize: sp.companySize, country: sp.country, from: sp.from, to: sp.to, page: Number(sp.page ?? 1) });
  const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]).toString();
  const edit = can(admin, "waitlist.edit");
  return (
    <>
      <PageHeader title="Contacts" description="Product users, marketing contacts and the waitlist, one record each, traceable from first signup to paid."
        actions={<>
          {can(admin, "waitlist.export") ? <CsvLink href={`/api/admin/contacts/export?${qs}`} /> : null}
          {can(admin, "marketing.create") ? <SheetButton label="Import contacts" icon="upload" variant="accent" title="Import contacts" description="Paste a list. Existing contacts are updated, never duplicated."><ContactImportForm /></SheetButton> : null}
        </>}
        tabs={MARKETING_TABS} tabsLabel="Marketing sections" />
      <Filters>
        <F label="Search"><input name="q" defaultValue={sp.q ?? ""} placeholder="Email, name, company" className={cn(filterCls, "w-56")} /></F>
        <F label="Status"><select name="status" defaultValue={sp.status ?? ""} className={filterCls}><option value="">Any</option>{["waiting", "invited", "registered", "activated", "trial", "paid", "unsubscribed"].map((s) => <option key={s} value={s}>{words(s)}</option>)}</select></F>
        <F label="Waitlist"><select name="waitlist" defaultValue={sp.waitlist ?? ""} className={filterCls}><option value="">Everyone</option><option value="1">Waitlist only</option></select></F>
        <F label="Company size"><input name="companySize" defaultValue={sp.companySize ?? ""} className={cn(filterCls, "w-24")} /></F>
        <F label="Country"><input name="country" defaultValue={sp.country ?? ""} className={cn(filterCls, "w-24")} /></F>
        <F label="From"><DatePicker name="from" defaultValue={sp.from ?? ""} size="xs" aria-label="From" /></F>
        <F label="To"><DatePicker name="to" defaultValue={sp.to ?? ""} size="xs" aria-label="To" /></F>
      </Filters>
      {r.rows.length === 0 ? <EmptyState icon={Contact} title="No contacts match" description="Change the filters, or import a list." /> : (
        <DataTable caption="Contacts">
          <thead><tr><th>Contact</th><th>Company</th><th>Source</th><th>Status</th><th>Brevo</th><th>Joined</th>{edit ? <th><span className="sr-only">Actions</span></th> : null}</tr></thead>
          <tbody>{r.rows.map((c) => (
            <tr key={c.id}>
              <td><span className="block font-medium">{[c.first_name, c.last_name].filter(Boolean).join(" ") || "No name"}</span><span className={subCls}>{c.email}</span></td>
              <td>{c.company ?? <span className="text-secondary">None</span>}{c.company_size ? <span className={subCls}>{c.company_size}{c.role_title ? `, ${c.role_title}` : ""}</span> : null}</td>
              <td><span className="inline-flex items-center gap-1.5">{c.source}{c.is_waitlist ? <Badge size="sm" tone="warning">Waitlist</Badge> : null}</span></td>
              <td><Badge tone={TONE[c.status] ?? "neutral"}>{words(c.status)}</Badge></td>
              <td className="text-meta">{c.brevo_error ? <span className="text-danger" title={c.brevo_error}>Failed</span> : c.brevo_synced_at ? <span className="text-secondary">Synced {dateOnly(c.brevo_synced_at)}</span> : <span className="text-secondary">Not synced</span>}</td>
              <td className="tabular-nums">{dateOnly(c.created_at)}</td>
              {edit ? <td className="text-right"><span className="inline-flex gap-1">
                {c.status === "waiting" ? <AdminAction path={`/api/admin/contacts/${c.id}`} method="PATCH" body={{ status: "invited" }} size="xs">Invite</AdminAction> : null}
                {c.status !== "unsubscribed" ? <AdminAction path={`/api/admin/contacts/${c.id}`} method="PATCH" body={{ status: "unsubscribed" }} variant="ghost" size="xs">Unsubscribe</AdminAction> : <AdminAction path={`/api/admin/contacts/${c.id}`} method="PATCH" body={{ status: "waiting" }} variant="ghost" size="xs">Resubscribe</AdminAction>}
              </span></td> : null}
            </tr>
          ))}</tbody>
        </DataTable>
      )}
      <Pager page={r.page} pageSize={r.pageSize} total={r.total} />
    </>
  );
}
