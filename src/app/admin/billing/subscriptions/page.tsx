import Link from "next/link";
import { CreditCard } from "lucide-react";
import { cn } from "@/lib/utils";
import { requireAdmin, can } from "@/server/admin/auth";
import { listSubscriptions, expiryBuckets, type SubscriptionFilter } from "@/server/admin/billing";
import { PageHeader, Ledger } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import { Filters, Pager, CsvLink, EditSheet } from "@/components/admin/actions";
import { F, filterCls, linkCls, subCls, words } from "@/components/admin/fields";
import { SubscriptionEditForm } from "@/components/admin/billing-forms";
import { money, dateOnly, num } from "@/lib/format";
import { PageNote, PageNotes } from "@/components/ui/page-notes";

export const metadata = { title: "Subscriptions" };
const TONE: Record<string, "success" | "warning" | "danger" | "neutral" | "info"> = { active: "success", trial: "info", past_due: "warning", payment_failed: "danger", expired: "danger", cancelled: "neutral", suspended: "danger" };

export default async function SubscriptionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const admin = await requireAdmin("subscription.view");
  const sp = await searchParams;
  const status = (["all", "active", "trial", "expiring", "expired", "cancelled", "past_due"].includes(sp.status ?? "") ? sp.status : "all") as SubscriptionFilter["status"];
  const within = Number(sp.within ?? 30) || 30;
  const [r, b] = await Promise.all([listSubscriptions({ status, within, q: sp.q, page: Number(sp.page ?? 1) }), expiryBuckets()]);
  const tabs = [["all", "All"], ["active", "Active"], ["trial", "Trials"], ["expiring", "Expiring"], ["past_due", "Payment failed"], ["expired", "Expired"], ["cancelled", "Cancelled"]].map(([v, l]) => ({ label: l, href: `/admin/billing/subscriptions${v === "all" ? "" : `?status=${v}`}`, value: v }));
  const edit = can(admin, "subscription.edit");
  return (
    <>
      <div>
        <PageHeader title="Subscriptions" description="Every organisation's plan and where it stands." actions={<CsvLink href="/api/admin/export?kind=subscriptions" />} divider />
        <Ledger items={[{ label: "Expiring today", value: num(b.today), tone: b.today ? "danger" : "default" }, { label: "Tomorrow", value: num(b.tomorrow), tone: b.tomorrow ? "danger" : "default" }, { label: "Within 7 days", value: num(b.d7), href: "/admin/billing/subscriptions?status=expiring&within=7" }, { label: "Within 30 days", value: num(b.d30), href: "/admin/billing/subscriptions?status=expiring&within=30" }]} />
        <p className="mt-3 text-meta font-normal text-secondary">Within 3 days <span className="tabular-nums">{num(b.d3)}</span>, within 14 days <span className="tabular-nums">{num(b.d14)}</span>, already expired <span className="tabular-nums">{num(b.expired)}</span>.</p>
        <Tabs className="mt-8" tabs={tabs} value={status} param="status" label="Subscription status" />
        <Filters className="mt-4">
          <F label="Search"><input name="q" defaultValue={sp.q ?? ""} placeholder="Organisation, owner email, Paystack code" className={cn(filterCls, "w-64")} /></F>
          {status === "expiring" ? <F label="Within days"><select name="within" defaultValue={String(within)} className={filterCls}>{[1, 3, 7, 14, 30].map((d) => <option key={d} value={d}>{d}</option>)}</select></F> : null}
          {status !== "all" ? <input type="hidden" name="status" value={status} /> : null}
        </Filters>
        {r.rows.length === 0 ? <EmptyState icon={CreditCard} title="No subscriptions match" description="Change the tab or the search." /> : (
          <DataTable caption="Subscriptions">
            <thead><tr><th>Organisation</th><th>Owner</th><th>Plan</th><th>Amount</th><th>Status</th><th>Ends</th><th>Auto-renew</th><th>Last payment</th>{edit ? <th><span className="sr-only">Actions</span></th> : null}</tr></thead>
            <tbody>{r.rows.map((s) => (
              <tr key={s.id}>
                <td><Link href={`/admin/organisations/${s.organisation_id}?tab=billing`} className={linkCls}>{s.org_name}</Link></td>
                <td>{s.owner_name ?? <span className="text-secondary">No owner</span>}{s.owner_email ? <span className={subCls}>{s.owner_email}</span> : null}</td>
                <td>{s.plan_name}<span className={subCls}>{words(s.billing_interval)}</span></td>
                <td className="tabular-nums">{money(s.amount, s.currency)}</td>
                <td><Badge tone={TONE[s.status] ?? "neutral"}>{words(s.status)}</Badge>{s.payment_status === "failed" ? <span className="block text-meta text-danger">Last payment failed</span> : null}</td>
                <td className="tabular-nums">{s.current_period_end ? dateOnly(s.current_period_end) : <span className="text-secondary">Not set</span>}</td>
                <td>{s.auto_renew ? "On" : <span className="text-secondary">Off</span>}</td>
                <td className="text-secondary">{s.last_payment_at ? dateOnly(s.last_payment_at) : "None"}</td>
                {edit ? <td className="text-right"><EditSheet title={`Edit ${s.org_name}'s subscription`}><SubscriptionEditForm id={s.id} current={{ status: s.status, periodEnd: s.current_period_end, autoRenew: s.auto_renew, notes: null }} /></EditSheet></td> : null}
              </tr>
            ))}</tbody>
          </DataTable>
        )}
        <Pager page={r.page} pageSize={r.pageSize} total={r.total} />
      </div>
      <PageNotes>
        <PageNote>The expiry buckets feed the reminder automations.</PageNote>
      </PageNotes>
    </>
  );
}
