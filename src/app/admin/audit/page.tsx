import { requireAdmin } from "@/server/admin/auth";
import { auditLog } from "@/server/admin/ops";
import { PageHeader } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/states";
import { Filters, Pager, CsvLink } from "@/components/admin/actions";
import { F, inputCls } from "@/components/admin/fields";
import { formatDateTime } from "@/lib/utils";

export const metadata = { title: "Audit log" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin("audit.view");
  const sp = await searchParams;
  const r = await auditLog({ q: sp.q, action: sp.action, admin: sp.admin, org: sp.org, from: sp.from, to: sp.to, page: Number(sp.page ?? 1) });
  return (
    <>
      <PageHeader icon="shield-check" title="Audit log" description="Every administrative action, with who did it, to what, why, and what changed. Append-only." actions={<CsvLink href="/api/admin/export?kind=audit" />} />
      <Filters>
        <F label="Search"><input name="q" defaultValue={sp.q ?? ""} placeholder="Target, action, reason" className={`${inputCls} w-64`} /></F>
        <F label="Area"><select name="action" defaultValue={sp.action ?? ""} className={inputCls}><option value="">Any</option>{r.actions.map((a) => <option key={a} value={a}>{a}</option>)}</select></F>
        <F label="Admin"><select name="admin" defaultValue={sp.admin ?? ""} className={inputCls}><option value="">Anyone</option>{r.admins.map((a) => <option key={a.id} value={a.id}>{a.email}</option>)}</select></F>
        <F label="From"><input name="from" type="date" defaultValue={sp.from ?? ""} className={inputCls} /></F>
        <F label="To"><input name="to" type="date" defaultValue={sp.to ?? ""} className={inputCls} /></F>
        {sp.org ? <input type="hidden" name="org" value={sp.org} /> : null}
      </Filters>
      {r.rows.length === 0 ? <EmptyState icon3d="shield-check" title="No entries match" /> : (
        <DataTable caption="Audit log"><thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Target</th><th>Reason</th><th>Change</th></tr></thead>
          <tbody>{r.rows.map((a) => <tr key={a.id}><td className="text-sm">{formatDateTime(a.occurred_at)}</td><td className="text-sm">{a.admin_name ?? a.admin_email ?? "system"}{a.ip ? <span className="block text-xs text-fg-subtle">{a.ip}</span> : null}</td><td className="font-mono text-xs">{a.action}</td><td className="text-sm">{a.target_label ?? a.target_id ?? "—"}{a.org_name ? <span className="block text-xs text-fg-subtle">{a.org_name}</span> : null}</td><td className="max-w-[240px] text-sm text-fg-muted">{a.reason ?? "—"}</td><td className="max-w-[320px] break-all text-xs text-fg-subtle">{a.before != null || a.after != null ? <details><summary className="cursor-pointer">before / after</summary><pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap">{JSON.stringify({ before: a.before, after: a.after }, null, 1)}</pre></details> : Object.keys(a.metadata ?? {}).length ? <span className="block max-w-full truncate">{JSON.stringify(a.metadata)}</span> : "—"}</td></tr>)}</tbody>
        </DataTable>
      )}
      <Pager page={r.page} pageSize={r.pageSize} total={r.total} />
    </>
  );
}
