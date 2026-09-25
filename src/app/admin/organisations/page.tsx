import Link from "next/link";
import { requireAdmin } from "@/server/admin/auth";
import { listOrganisations, type OrgListFilter } from "@/server/admin/organisations";
import { PageHeader } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import { Filters, Pager, CsvLink } from "@/components/admin/actions";
import { F, inputCls } from "@/components/admin/fields";
import { bytes, dateOnly, num } from "@/lib/format";
import { relativeTime } from "@/lib/utils";

export const metadata = { title: "Organisations" };

const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "neutral" | "info"> = { active: "success", trial: "info", past_due: "warning", payment_failed: "danger", expired: "danger", cancelled: "neutral", suspended: "danger" };

export default async function OrganisationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin("organization.view");
  const sp = await searchParams;
  const status = (["all", "active", "trial", "expiring", "suspended", "archived"].includes(sp.status ?? "") ? sp.status : "all") as OrgListFilter["status"];
  const r = await listOrganisations({ q: sp.q, status, plan: sp.plan, page: Number(sp.page ?? 1), sort: (sp.sort as OrgListFilter["sort"]) ?? "created" });
  const tabs = ["all", "active", "trial", "expiring", "suspended", "archived"].map((s) => ({ label: s === "all" ? "All" : s[0].toUpperCase() + s.slice(1), href: `/admin/organisations${s === "all" ? "" : `?status=${s}`}`, value: s }));
  return (
    <>
      <PageHeader icon="desk" title="Organisations" description="Every tenant on Boredroom: who owns it, what it pays for, how much it uses." actions={<CsvLink href="/api/admin/export?kind=organisations" />} />
      <Tabs tabs={tabs} value={status} param="status" className="mb-4" label="Organisation status" />
      <Filters>
        <F label="Search"><input name="q" defaultValue={sp.q ?? ""} placeholder="Name, id, owner email" className={`${inputCls} w-64`} /></F>
        <F label="Plan"><select name="plan" defaultValue={sp.plan ?? ""} className={inputCls}><option value="">Any plan</option>{r.plans.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</select></F>
        <F label="Sort"><select name="sort" defaultValue={sp.sort ?? "created"} className={inputCls}><option value="created">Newest</option><option value="activity">Last activity</option><option value="users">Most people</option><option value="name">Name</option></select></F>
        {status !== "all" ? <input type="hidden" name="status" value={status} /> : null}
      </Filters>
      {r.rows.length === 0 ? <EmptyState icon3d="desk" title="No organisations match" description="Change the filters, or wait for the first sign-up." /> : (
        <DataTable caption="Organisations">
          <thead><tr><th>Organisation</th><th>Owner</th><th>People</th><th>Plan</th><th>Subscription</th><th>Created</th><th>Last activity</th><th>Storage</th></tr></thead>
          <tbody>{r.rows.map((o) => (
            <tr key={o.id}>
              <td><Link href={`/admin/organisations/${o.id}`} className="font-semibold hover:underline">{o.name}</Link><p className="text-xs text-fg-subtle">{o.slug}{o.status !== "active" ? <> · <Badge tone="danger">{o.status}</Badge></> : null}</p></td>
              <td><span className="block">{o.owner_name ?? "—"}</span><span className="text-xs text-fg-subtle">{o.owner_email ?? ""}</span></td>
              <td className="tabular-nums">{num(o.users)}</td>
              <td>{o.plan_name ?? "—"}</td>
              <td>{o.sub_status ? <Badge tone={STATUS_TONE[o.sub_status] ?? "neutral"}>{o.sub_status.replace("_", " ")}</Badge> : "—"}{o.period_end ? <p className="text-xs text-fg-subtle">until {dateOnly(o.period_end)}</p> : null}</td>
              <td className="text-sm">{dateOnly(o.created_at)}</td>
              <td className="text-sm text-fg-muted">{o.last_activity_at ? relativeTime(o.last_activity_at) : "never"}</td>
              <td className="tabular-nums">{bytes(o.storage_bytes)}</td>
            </tr>
          ))}</tbody>
        </DataTable>
      )}
      <Pager page={r.page} pageSize={r.pageSize} total={r.total} />
    </>
  );
}
