import Link from "next/link";
import { requireAdmin, can } from "@/server/admin/auth";
import { listSubscriptions, expiryBuckets, type SubscriptionFilter } from "@/server/admin/billing";
import { PageHeader, Ledger, Card } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import { Filters, Pager, CsvLink } from "@/components/admin/actions";
import { F, inputCls } from "@/components/admin/fields";
import { SubscriptionEditForm } from "@/components/admin/billing-forms";
import { money, dateOnly, num } from "@/lib/format";

export const metadata = { title: "Subscriptions" };
const TONE: Record<string, "success" | "warning" | "danger" | "neutral" | "info"> = { active: "success", trial: "info", past_due: "warning", payment_failed: "danger", expired: "danger", cancelled: "neutral", suspended: "danger" };

export default async function SubscriptionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const admin = await requireAdmin("subscription.view");
  const sp = await searchParams;
  const status = (["all", "active", "trial", "expiring", "expired", "cancelled", "past_due"].includes(sp.status ?? "") ? sp.status : "all") as SubscriptionFilter["status"];
  const within = Number(sp.within ?? 30) || 30;
  const [r, b] = await Promise.all([listSubscriptions({ status, within, q: sp.q, page: Number(sp.page ?? 1) }), expiryBuckets()]);
  const tabs = [["all", "All"], ["active", "Active"], ["trial", "Trials"], ["expiring", "Expiring"], ["past_due", "Payment failed"], ["expired", "Expired"], ["cancelled", "Cancelled"]].map(([v, l]) => ({ label: l, href: `/admin/billing/subscriptions${v === "all" ? "" : `?status=${v}`}`, value: v }));
  return (
    <>
      <PageHeader icon="calendar-clock" title="Subscriptions" description="Every organisation's plan and where it stands. The expiry buckets feed the reminder automations." actions={<CsvLink href="/api/admin/export?kind=subscriptions" />} />
      <Card className="mb-6"><Ledger items={[{ label: "Expiring today", value: num(b.today), tone: b.today ? "danger" : "default" }, { label: "Tomorrow", value: num(b.tomorrow), tone: b.tomorrow ? "danger" : "default" }, { label: "Within 7 days", value: num(b.d7), tone: b.d7 ? "accent" : "default" }, { label: "Within 30 days", value: num(b.d30) }]} /><p className="eyebrow mt-3">Within 3 days {num(b.d3)} · within 14 days {num(b.d14)} · already expired {num(b.expired)}</p></Card>
      <Tabs tabs={tabs} value={status} param="status" className="mb-4" label="Subscription status" />
      <Filters>
        <F label="Search"><input name="q" defaultValue={sp.q ?? ""} placeholder="Organisation, owner email, Paystack code" className={`${inputCls} w-72`} /></F>
        {status === "expiring" ? <F label="Within days"><select name="within" defaultValue={String(within)} className={inputCls}>{[1, 3, 7, 14, 30].map((d) => <option key={d} value={d}>{d}</option>)}</select></F> : null}
        {status !== "all" ? <input type="hidden" name="status" value={status} /> : null}
      </Filters>
      {r.rows.length === 0 ? <EmptyState icon3d="calendar-clock" title="No subscriptions match" /> : (
        <DataTable caption="Subscriptions">
          <thead><tr><th>Organisation</th><th>Owner</th><th>Plan</th><th>Amount</th><th>Status</th><th>Ends</th><th>Auto-renew</th><th>Last payment</th>{can(admin, "subscription.edit") ? <th></th> : null}</tr></thead>
          <tbody>{r.rows.map((s) => (
            <tr key={s.id}>
              <td><Link href={`/admin/organisations/${s.organisation_id}?tab=billing`} className="font-semibold hover:underline">{s.org_name}</Link></td>
              <td className="text-sm"><span className="block">{s.owner_name ?? "—"}</span><span className="text-xs text-fg-subtle">{s.owner_email ?? ""}</span></td>
              <td>{s.plan_name}<span className="block text-xs text-fg-subtle">{s.billing_interval}</span></td>
              <td className="tabular-nums">{money(s.amount, s.currency)}</td>
              <td><Badge tone={TONE[s.status] ?? "neutral"}>{s.status.replace("_", " ")}</Badge>{s.payment_status === "failed" ? <span className="block text-xs text-danger">last payment failed</span> : null}</td>
              <td className="text-sm">{s.current_period_end ? dateOnly(s.current_period_end) : "—"}</td>
              <td className="text-sm">{s.auto_renew ? "On" : "Off"}</td>
              <td className="text-sm text-fg-muted">{s.last_payment_at ? dateOnly(s.last_payment_at) : "none"}</td>
              {can(admin, "subscription.edit") ? <td><details><summary className="cursor-pointer text-sm text-fg-muted">Edit</summary><div className="mt-2 w-[28rem] max-w-[70vw]"><SubscriptionEditForm id={s.id} current={{ status: s.status, periodEnd: s.current_period_end, autoRenew: s.auto_renew, notes: null }} /></div></details></td> : null}
            </tr>
          ))}</tbody>
        </DataTable>
      )}
      <Pager page={r.page} pageSize={r.pageSize} total={r.total} />
    </>
  );
}
