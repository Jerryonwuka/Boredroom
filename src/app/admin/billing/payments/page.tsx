import Link from "next/link";
import { Wallet } from "lucide-react";
import { requireAdmin } from "@/server/admin/auth";
import { listPayments, paymentMetrics, paystackConfigured, type PaymentFilter } from "@/server/admin/billing";
import { PageHeader, Ledger } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Alert } from "@/components/ui/states";
import { DatePicker } from "@/components/ui/date-picker";
import { Filters, Pager, CsvLink } from "@/components/admin/actions";
import { F, filterCls, linkCls, subCls, words } from "@/components/admin/fields";
import { money, dateOnly, num } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata = { title: "Payments" };
const TONE = (s: string) => (s === "success" ? "success" : s === "failed" ? "danger" : s === "refunded" ? "warning" : "neutral") as "success" | "danger" | "warning" | "neutral";

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin("payment.view");
  const sp = await searchParams;
  const status = (["all", "success", "failed", "refunded", "pending"].includes(sp.status ?? "") ? sp.status : "all") as PaymentFilter["status"];
  const [r, m, configured] = await Promise.all([listPayments({ status, q: sp.q, from: sp.from, to: sp.to, org: sp.org, page: Number(sp.page ?? 1) }), paymentMetrics(), paystackConfigured()]);
  const tabs = [["all", "All"], ["success", "Successful"], ["failed", "Failed"], ["refunded", "Refunded"], ["pending", "Pending"]].map(([v, l]) => ({ label: l, href: `/admin/billing/payments${v === "all" ? "" : `?status=${v}`}`, value: v }));
  return (
    <>
      <PageHeader title="Payments" description="Every Paystack transaction, whichever way it ended. Revenue below counts successful payments only." meta={<>Currency {m.currency}, Paystack {configured ? "connected" : "not configured"}</>} actions={<CsvLink href="/api/admin/export?kind=payments" />} divider />
      {!configured ? <Alert tone="warning" className="mb-6">Paystack is not configured. Set PAYSTACK_SECRET_KEY and add the webhook URL under Settings, Paystack; until then no payment can be taken.</Alert> : null}
      <Ledger items={[{ label: "Today", value: money(m.today, m.currency) }, { label: "This month", value: money(m.month, m.currency) }, { label: "This year", value: money(m.year, m.currency) }, { label: "MRR", value: money(m.mrr, m.currency) }]} />
      <p className="mt-3 text-meta font-normal text-secondary"><span className="tabular-nums">{num(m.success)}</span> successful, <span className="tabular-nums">{num(m.failed)}</span> failed, <span className="tabular-nums">{num(m.pending)}</span> pending, <span className="tabular-nums">{num(m.refunded)}</span> refunded.{m.by_plan?.length ? ` By plan: ${m.by_plan.map((p) => `${p.plan} ${money(p.amount, m.currency)}`).join(", ")}.` : ""}</p>
      {m.by_month?.length ? (
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Revenue by month">{m.by_month.map((x) => (
          <li key={x.month} className="inline-flex items-center gap-2 rounded-lg bg-fill-0 px-2 py-1 text-xs"><span className="text-subtle">{x.month}</span><span className="tabular-nums text-foreground">{money(x.amount, m.currency)}</span></li>
        ))}</ul>
      ) : null}
      <Tabs className="mt-8" tabs={tabs} value={status} param="status" label="Payment status" />
      <Filters className="mt-4">
        <F label="Search"><input name="q" defaultValue={sp.q ?? ""} placeholder="Reference, email, organisation" className={cn(filterCls, "w-60")} /></F>
        <F label="From"><DatePicker name="from" defaultValue={sp.from ?? ""} size="xs" aria-label="From" /></F>
        <F label="To"><DatePicker name="to" defaultValue={sp.to ?? ""} size="xs" aria-label="To" /></F>
        {status !== "all" ? <input type="hidden" name="status" value={status} /> : null}
        {sp.org ? <input type="hidden" name="org" value={sp.org} /> : null}
      </Filters>
      {r.rows.length === 0 ? <EmptyState icon={Wallet} title="No transactions match" description="Payments appear here as Paystack reports them." /> : (
        <DataTable caption="Transactions">
          <thead><tr><th>Date</th><th>Organisation</th><th>Customer</th><th>Plan</th><th>Amount</th><th>Status</th><th>Method</th><th>Reference</th></tr></thead>
          <tbody>{r.rows.map((p) => (
            <tr key={p.id}>
              <td className="tabular-nums">{dateOnly(p.paid_at ?? p.created_at)}</td>
              <td>{p.organisation_id ? <Link href={`/admin/organisations/${p.organisation_id}?tab=billing`} className={linkCls}>{p.org_name}</Link> : <span className="text-secondary">None</span>}</td>
              <td>{p.customer_email ?? <span className="text-secondary">Unknown</span>}</td>
              <td>{p.plan_name ?? <span className="text-secondary">None</span>}{p.interval ? <span className={subCls}>{words(p.interval)}</span> : null}</td>
              <td className="tabular-nums">{money(p.amount, p.currency)}</td>
              <td><Badge tone={TONE(p.status)}>{words(p.status)}</Badge></td>
              <td>{p.channel ? words(p.channel) : <span className="text-secondary">Unknown</span>}</td>
              <td><Link href={`/admin/billing/payments/${p.id}`} className={cn(linkCls, "font-mono text-xs")}>{p.reference}</Link></td>
            </tr>
          ))}</tbody>
        </DataTable>
      )}
      <Pager page={r.page} pageSize={r.pageSize} total={r.total} />
    </>
  );
}
