import Link from "next/link";
import { requireAdmin } from "@/server/admin/auth";
import { listPayments, paymentMetrics, paystackConfigured, type PaymentFilter } from "@/server/admin/billing";
import { PageHeader, Card, Ledger } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Alert } from "@/components/ui/states";
import { Filters, Pager, CsvLink } from "@/components/admin/actions";
import { F, inputCls } from "@/components/admin/fields";
import { money, dateOnly, num } from "@/lib/format";
import { DatePicker } from "@/components/ui/date-picker";

export const metadata = { title: "Payments" };

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin("payment.view");
  const sp = await searchParams;
  const status = (["all", "success", "failed", "refunded", "pending"].includes(sp.status ?? "") ? sp.status : "all") as PaymentFilter["status"];
  const [r, m] = await Promise.all([listPayments({ status, q: sp.q, from: sp.from, to: sp.to, org: sp.org, page: Number(sp.page ?? 1) }), paymentMetrics()]);
  const tabs = [["all", "All"], ["success", "Successful"], ["failed", "Failed"], ["refunded", "Refunded"], ["pending", "Pending"]].map(([v, l]) => ({ label: l, href: `/admin/billing/payments${v === "all" ? "" : `?status=${v}`}`, value: v }));
  return (
    <>
      <PageHeader icon="chart-ring" title="Payments" description="Every Paystack transaction, whichever way it ended. Revenue below counts successful payments only." meta={<>Currency {m.currency} · Paystack {paystackConfigured() ? "connected" : "not configured"}</>} actions={<CsvLink href="/api/admin/export?kind=payments" />} />
      {!paystackConfigured() ? <Alert tone="warning" className="mb-6">Paystack is not configured. Set PAYSTACK_SECRET_KEY and add the webhook URL under Settings, Paystack; until then no payment can be taken.</Alert> : null}
      <Card className="mb-6"><Ledger items={[{ label: "Today", value: money(m.today, m.currency) }, { label: "This month", value: money(m.month, m.currency), tone: "accent" }, { label: "This year", value: money(m.year, m.currency) }, { label: "MRR", value: money(m.mrr, m.currency) }]} />
        <p className="eyebrow mt-3">{num(m.success)} successful · {num(m.failed)} failed · {num(m.pending)} pending · {num(m.refunded)} refunded{m.by_plan?.length ? ` · by plan: ${m.by_plan.map((p) => `${p.plan} ${money(p.amount, m.currency)}`).join(", ")}` : ""}</p>
        {m.by_month?.length ? <ul className="mt-3 flex flex-wrap gap-2 text-xs">{m.by_month.map((x) => <li key={x.month} className="chip px-2.5 py-1"><span className="text-fg-subtle">{x.month}</span> <span className="tabular-nums">{money(x.amount, m.currency)}</span></li>)}</ul> : null}
      </Card>
      <Tabs tabs={tabs} value={status} param="status" className="mb-4" label="Payment status" />
      <Filters>
        <F label="Search"><input name="q" defaultValue={sp.q ?? ""} placeholder="Reference, email, organisation" className={`${inputCls} w-72`} /></F>
        <F label="From"><DatePicker name="from" defaultValue={sp.from ?? ""} size="sm" /></F>
        <F label="To"><DatePicker name="to" defaultValue={sp.to ?? ""} size="sm" /></F>
        {status !== "all" ? <input type="hidden" name="status" value={status} /> : null}
        {sp.org ? <input type="hidden" name="org" value={sp.org} /> : null}
      </Filters>
      {r.rows.length === 0 ? <EmptyState icon3d="chart-ring" title="No transactions match" description="Payments appear here as Paystack reports them." /> : (
        <DataTable caption="Transactions">
          <thead><tr><th>Date</th><th>Organisation</th><th>Customer</th><th>Plan</th><th>Amount</th><th>Status</th><th>Method</th><th>Reference</th></tr></thead>
          <tbody>{r.rows.map((p) => (
            <tr key={p.id}>
              <td className="text-sm">{dateOnly(p.paid_at ?? p.created_at)}</td>
              <td>{p.organisation_id ? <Link href={`/admin/organisations/${p.organisation_id}?tab=billing`} className="font-semibold hover:underline">{p.org_name}</Link> : "—"}</td>
              <td className="text-sm">{p.customer_email ?? "—"}</td>
              <td>{p.plan_name ?? "—"}{p.interval ? <span className="block text-xs text-fg-subtle">{p.interval}</span> : null}</td>
              <td className="tabular-nums">{money(p.amount, p.currency)}</td>
              <td><Badge tone={p.status === "success" ? "success" : p.status === "failed" ? "danger" : p.status === "refunded" ? "warning" : "neutral"}>{p.status}</Badge></td>
              <td className="text-sm">{p.channel ?? "—"}</td>
              <td><Link href={`/admin/billing/payments/${p.id}`} className="font-mono text-xs hover:underline">{p.reference}</Link></td>
            </tr>
          ))}</tbody>
        </DataTable>
      )}
      <Pager page={r.page} pageSize={r.pageSize} total={r.total} />
    </>
  );
}
