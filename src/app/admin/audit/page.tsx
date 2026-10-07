import { ShieldCheck } from "lucide-react";
import { requireAdmin } from "@/server/admin/auth";
import { auditLog } from "@/server/admin/ops";
import { PageHeader } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/states";
import { DatePicker } from "@/components/ui/date-picker";
import { Filters, Pager, CsvLink } from "@/components/admin/actions";
import { F, filterCls, subCls } from "@/components/admin/fields";
import { formatDateTime, cn } from "@/lib/utils";
import { PageNote, PageNotes } from "@/components/ui/page-notes";

export const metadata = { title: "Audit log" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin("audit.view");
  const sp = await searchParams;
  const r = await auditLog({ q: sp.q, action: sp.action, admin: sp.admin, org: sp.org, from: sp.from, to: sp.to, page: Number(sp.page ?? 1) });
  return (
    <>
      <div>
        <PageHeader title="Audit log" description="Every administrative action, with who did it, to what, why, and what changed." actions={<CsvLink href="/api/admin/export?kind=audit" />} divider />
        <Filters>
          <F label="Search"><input name="q" defaultValue={sp.q ?? ""} placeholder="Target, action, reason" className={cn(filterCls, "w-56")} /></F>
          <F label="Area"><select name="action" defaultValue={sp.action ?? ""} className={filterCls}><option value="">Any</option>{r.actions.map((a) => <option key={a} value={a}>{a}</option>)}</select></F>
          <F label="Admin"><select name="admin" defaultValue={sp.admin ?? ""} className={filterCls}><option value="">Anyone</option>{r.admins.map((a) => <option key={a.id} value={a.id}>{a.email}</option>)}</select></F>
          <F label="From"><DatePicker name="from" defaultValue={sp.from ?? ""} size="xs" aria-label="From" /></F>
          <F label="To"><DatePicker name="to" defaultValue={sp.to ?? ""} size="xs" aria-label="To" /></F>
          {sp.org ? <input type="hidden" name="org" value={sp.org} /> : null}
        </Filters>
        {r.rows.length === 0 ? <EmptyState icon={ShieldCheck} title="No entries match" description="Change the filters or the dates." /> : (
          <DataTable caption="Audit log">
            <thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Target</th><th>Reason</th><th>Change</th></tr></thead>
            <tbody>{r.rows.map((a) => {
              const [day, time] = formatDateTime(a.occurred_at).split(", ");
              return (
                <tr key={a.id}>
                  <td className="nowrap tabular-nums">{day}{time ? <span className={subCls}>{time}</span> : null}</td>
                  <td className="nowrap">{a.admin_name ?? a.admin_email ?? "System"}{a.ip ? <span className={`${subCls} font-mono text-xs`}>{a.ip}</span> : null}</td>
                  <td className="nowrap font-mono text-xs">{a.action}</td>
                  <td className="nowrap">{a.target_label ?? a.target_id ?? <span className="text-secondary">None</span>}{a.org_name ? <span className={subCls}>{a.org_name}</span> : null}</td>
                  <td className="wrap max-w-[240px] text-secondary">{a.reason ?? "None given"}</td>
                  <td className="wrap max-w-[320px] text-meta text-secondary">
                    {a.before != null || a.after != null ? (
                      <details>
                        <summary className="cursor-pointer rounded-sm text-foreground decoration-accent underline-offset-[3px] hover:underline">Before and after</summary>
                        <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-fill-1 p-2 font-mono text-xs">{JSON.stringify({ before: a.before, after: a.after }, null, 1)}</pre>
                      </details>
                    ) : Object.keys(a.metadata ?? {}).length ? <span className="block max-w-[220px] truncate font-mono text-xs" title={JSON.stringify(a.metadata)}>{JSON.stringify(a.metadata)}</span> : "None"}
                  </td>
                </tr>
              );
            })}</tbody>
          </DataTable>
        )}
        <Pager page={r.page} pageSize={r.pageSize} total={r.total} />
      </div>
      <PageNotes>
        <PageNote>The log is append-only.</PageNote>
      </PageNotes>
    </>
  );
}
