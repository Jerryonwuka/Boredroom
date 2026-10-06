import Link from "next/link";
import { Building2 } from "lucide-react";
import { requireAdmin } from "@/server/admin/auth";
import { listOrganisations, type OrgListFilter } from "@/server/admin/organisations";
import { PageHeader } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import { Filters, Pager, CsvLink } from "@/components/admin/actions";
import { F, filterCls, linkCls, subCls, words } from "@/components/admin/fields";
import { bytes, dateOnly, num } from "@/lib/format";
import { relativeTime, cn } from "@/lib/utils";

export const metadata = { title: "Organisations" };

const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "neutral" | "info"> = { active: "success", trial: "info", past_due: "warning", payment_failed: "danger", expired: "danger", cancelled: "neutral", suspended: "danger" };
const STATUSES = ["all", "active", "trial", "expiring", "suspended", "archived"] as const;

export default async function OrganisationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin("organization.view");
  const sp = await searchParams;
  const status = ((STATUSES as readonly string[]).includes(sp.status ?? "") ? sp.status : "all") as OrgListFilter["status"];
  const r = await listOrganisations({ q: sp.q, status, plan: sp.plan, page: Number(sp.page ?? 1), sort: (sp.sort as OrgListFilter["sort"]) ?? "created" });
  const tabs = STATUSES.map((s) => ({ label: s === "all" ? "All" : words(s), href: `/admin/organisations${s === "all" ? "" : `?status=${s}`}`, value: s }));
  return (
    <>
      <PageHeader title="Organisations" description="Every tenant on Boredroom: who owns it, what it pays for, how much it uses." actions={<CsvLink href="/api/admin/export?kind=organisations" />}
        tabs={tabs} tabValue={status} tabParam="status" tabsLabel="Organisation status" />
      <Filters>
        <F label="Search"><input name="q" defaultValue={sp.q ?? ""} placeholder="Name, id, owner email" className={cn(filterCls, "w-56")} /></F>
        <F label="Plan"><select name="plan" defaultValue={sp.plan ?? ""} className={filterCls}><option value="">Any plan</option>{r.plans.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</select></F>
        <F label="Sort"><select name="sort" defaultValue={sp.sort ?? "created"} className={filterCls}><option value="created">Newest</option><option value="activity">Last activity</option><option value="users">Most people</option><option value="name">Name</option></select></F>
        {status !== "all" ? <input type="hidden" name="status" value={status} /> : null}
      </Filters>
      {r.rows.length === 0 ? <EmptyState icon={Building2} title="No organisations match" description="Change the filters, or wait for the first sign-up." /> : (
        <DataTable caption="Organisations">
          <thead><tr><th>Organisation</th><th>Owner</th><th>People</th><th>Plan</th><th>Subscription</th><th>Created</th><th>Last activity</th><th>Storage</th></tr></thead>
          <tbody>{r.rows.map((o) => (
            <tr key={o.id}>
              <td>
                <span className="flex items-center gap-2"><Link href={`/admin/organisations/${o.id}`} className={linkCls}>{o.name}</Link>{o.status !== "active" ? <Badge tone="danger">{words(o.status)}</Badge> : null}</span>
                <span className={`${subCls} font-mono text-xs`}>{o.slug}</span>
              </td>
              <td>{o.owner_name ?? <span className="text-secondary">No owner</span>}{o.owner_email ? <span className={subCls}>{o.owner_email}</span> : null}</td>
              <td className="tabular-nums">{num(o.users)}</td>
              <td>{o.plan_name ?? <span className="text-secondary">None</span>}</td>
              <td>{o.sub_status ? <Badge tone={STATUS_TONE[o.sub_status] ?? "neutral"}>{words(o.sub_status)}</Badge> : <span className="text-secondary">None</span>}{o.period_end ? <span className={subCls}>until {dateOnly(o.period_end)}</span> : null}</td>
              <td className="tabular-nums">{dateOnly(o.created_at)}</td>
              <td className="text-secondary">{o.last_activity_at ? relativeTime(o.last_activity_at) : "Never"}</td>
              <td className="tabular-nums">{bytes(o.storage_bytes)}</td>
            </tr>
          ))}</tbody>
        </DataTable>
      )}
      <Pager page={r.page} pageSize={r.pageSize} total={r.total} />
    </>
  );
}
