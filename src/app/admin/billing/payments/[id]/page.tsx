import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin, can } from "@/server/admin/auth";
import { paymentDetail } from "@/server/admin/billing";
import { AppError } from "@/server/lib/errors";
import { PageHeader, Card, CardHeader, Ledger } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AdminAction } from "@/components/admin/actions";
import { money } from "@/lib/format";
import { formatDateTime } from "@/lib/utils";
import { EmptyState } from "@/components/ui/states";

export const metadata = { title: "Transaction" };

export default async function PaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin("payment.view");
  const { id } = await params;
  let d: Awaited<ReturnType<typeof paymentDetail>>;
  try { d = await paymentDetail(id); } catch (err) { if (err instanceof AppError && err.status === 404) notFound(); throw err; }
  const t = d.tx;
  return (
    <>
      <PageHeader back={{ href: "/admin/billing/payments", label: "Payments" }} title={<span className="font-mono text-2xl">{t.reference}</span>}
        description={<>{money(t.amount, t.currency)} {t.status} {t.paid_at ? `on ${formatDateTime(t.paid_at)}` : `created ${formatDateTime(t.created_at)}`}{t.org_name ? <> for <Link href={`/admin/organisations/${t.organisation_id}?tab=billing`} className="underline">{t.org_name}</Link></> : null}.</>}
        meta={<>Paystack id {t.paystack_id ?? "—"} · Method {t.channel ?? "—"} · Gateway: {t.gateway_response ?? "—"}</>}
        actions={t.status === "success" && can(admin, "payment.refund") ? <AdminAction path={`/api/admin/payments/${t.id}`} body={{ action: "refund" }} reason danger confirm={{ title: "Mark this payment refunded?", description: "This records the refund in Boredroom. Issue the money back from the Paystack dashboard; the subscription is not changed automatically.", label: "Mark refunded" }}>Mark refunded</AdminAction> : null} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card><CardHeader title="Details" /><Ledger items={[{ label: "Customer", value: <span className="text-base">{t.customer_email ?? "—"}</span> }, { label: "Plan", value: <span className="text-base">{t.plan_name ?? "—"}{t.interval ? ` (${t.interval})` : ""}</span> }, { label: "Status", value: <Badge tone={t.status === "success" ? "success" : t.status === "failed" ? "danger" : "neutral"}>{t.status}</Badge> }, { label: "Subscription", value: <span className="text-base">{t.subscription_id ? <Link href={`/admin/billing/subscriptions?q=${encodeURIComponent(t.org_name ?? "")}`} className="underline">open</Link> : "—"}</span> }]} /></Card>
        <Card><CardHeader title="Webhook events" description="Each Paystack delivery for this reference, once." />{d.events.length === 0 ? <p className="text-sm text-fg-subtle">None received; this payment was verified from the checkout callback.</p> : <ul className="divide-y divide-border-soft text-sm">{d.events.map((e) => <li key={e.id} className="flex items-center justify-between gap-3 py-2"><span className="font-mono text-xs">{e.event}</span><span className="text-xs text-fg-subtle">{formatDateTime(e.received_at)} · {e.error ? <span className="text-danger">{e.error}</span> : e.processed_at ? "processed" : "pending"}</span></li>)}</ul>}</Card>
        <Card className="lg:col-span-2"><CardHeader title="Administrative actions" />{d.audit.length === 0 ? <EmptyState compact title="Nothing here yet" icon3d="box-doc-check" /> : <ul className="space-y-1 text-sm">{d.audit.map((a, i) => <li key={i}><span className="font-mono text-xs">{a.action}</span> · {a.admin_email} · {formatDateTime(a.occurred_at)}{a.reason ? <span className="text-fg-subtle"> · {a.reason}</span> : null}</li>)}</ul>}</Card>
        <Card className="lg:col-span-2"><CardHeader title="Gateway payload" /><pre className="max-h-96 overflow-auto rounded-[var(--radius-sm)] bg-inset p-3 text-xs text-fg-muted">{JSON.stringify(t.raw, null, 2)}</pre></Card>
      </div>
    </>
  );
}
