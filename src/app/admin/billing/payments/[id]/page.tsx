import Link from "next/link";
import { notFound } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { requireAdmin, can } from "@/server/admin/auth";
import { paymentDetail } from "@/server/admin/billing";
import { AppError } from "@/server/lib/errors";
import { PageHeader, Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import { AdminAction } from "@/components/admin/actions";
import { Facts, linkCls, subCls, words } from "@/components/admin/fields";
import { money } from "@/lib/format";
import { formatDateTime } from "@/lib/utils";

export const metadata = { title: "Transaction" };
const TONE = (s: string) => (s === "success" ? "success" : s === "failed" ? "danger" : s === "refunded" ? "warning" : "neutral") as "success" | "danger" | "warning" | "neutral";

export default async function PaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin("payment.view");
  const { id } = await params;
  let d: Awaited<ReturnType<typeof paymentDetail>>;
  try { d = await paymentDetail(id); } catch (err) { if (err instanceof AppError && err.status === 404) notFound(); throw err; }
  const t = d.tx;
  return (
    <>
      <PageHeader back={{ href: "/admin/billing/payments", label: "Payments" }} title={<span className="font-mono text-xl">{t.reference}</span>}
        description={<>{money(t.amount, t.currency)} {t.status} {t.paid_at ? `on ${formatDateTime(t.paid_at)}` : `created ${formatDateTime(t.created_at)}`}{t.org_name ? <> for <Link href={`/admin/organisations/${t.organisation_id}?tab=billing`} className="link-inline">{t.org_name}</Link></> : null}.</>}
        meta={<>Paystack id {t.paystack_id ?? "none"}, method {t.channel ?? "unknown"}, gateway: {t.gateway_response ?? "no response recorded"}</>}
        actions={t.status === "success" && can(admin, "payment.refund") ? <AdminAction path={`/api/admin/payments/${t.id}`} body={{ action: "refund" }} reason danger confirm={{ title: "Mark this payment refunded?", description: "This records the refund in Boredroom. Issue the money back from the Paystack dashboard; the subscription is not changed automatically.", label: "Mark refunded" }}>Mark refunded</AdminAction> : null} divider />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="self-start">
          <CardHeader title="Details" />
          <Facts items={[
            { label: "Amount", value: <span className="tabular-nums text-foreground">{money(t.amount, t.currency)}</span> },
            { label: "Status", value: <Badge tone={TONE(t.status)}>{words(t.status)}</Badge> },
            { label: "Customer", value: t.customer_email ?? "Unknown" },
            { label: "Plan", value: <>{t.plan_name ?? "None"}{t.interval ? ` (${t.interval})` : ""}</> },
            { label: "Subscription", value: t.subscription_id ? <Link href={`/admin/billing/subscriptions?q=${encodeURIComponent(t.org_name ?? "")}`} className={linkCls}>Open</Link> : "None" },
          ]} />
        </Card>
        <Card className="self-start">
          <CardHeader title="Webhook events" description="Each Paystack delivery for this reference, once." />
          {d.events.length === 0 ? <p className="text-sm font-normal text-secondary">None received; this payment was verified from the checkout callback.</p> : (
            <ul className="grid gap-2.5">{d.events.map((e) => (
              <li key={e.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <span className="min-w-0"><span className="block truncate font-mono text-xs text-foreground">{e.event}</span><span className={subCls}>{formatDateTime(e.received_at)}</span></span>
                {e.error ? <Badge tone="danger" dot>{e.error}</Badge> : e.processed_at ? <Badge tone="success">Processed</Badge> : <Badge>Pending</Badge>}
              </li>
            ))}</ul>
          )}
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Administrative actions" />
          {d.audit.length === 0 ? <EmptyState compact icon={ShieldCheck} title="Nothing here yet" /> : (
            <ul className="grid gap-2.5">{d.audit.map((a, i) => (
              <li key={i} className="min-w-0">
                <p className="font-mono text-xs text-foreground">{a.action}</p>
                <p className={subCls}>{a.admin_email}, {formatDateTime(a.occurred_at)}{a.reason ? `. ${a.reason}` : ""}</p>
              </li>
            ))}</ul>
          )}
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Gateway payload" />
          <pre className="type-code max-h-96 overflow-auto rounded-xl bg-fill-0 p-4 text-secondary">{JSON.stringify(t.raw, null, 2)}</pre>
        </Card>
      </div>
    </>
  );
}
