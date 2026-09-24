import Link from "next/link";
import { requireAdmin } from "@/server/admin/auth";
import { dashboardMetrics } from "@/server/admin/ops";
import { paymentMetrics } from "@/server/admin/billing";
import { marketingMetrics } from "@/server/admin/marketing";
import { launchSettings } from "@/server/admin/settings";
import { PageHeader, Card, CardHeader, Ledger } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Badge } from "@/components/ui/badge";
import { bytes, num, money, dateOnly } from "@/lib/format";
import { formatDateTime } from "@/lib/utils";

export const metadata = { title: "Dashboard" };

export default async function AdminDashboard() {
  const admin = await requireAdmin("dashboard.view");
  const [m, pay, mk, launch] = await Promise.all([dashboardMetrics(), paymentMetrics(), marketingMetrics(), launchSettings(true)]);
  const alerts: { tone: "danger" | "warning" | "info"; text: string; href: string }[] = [];
  if (m.subs.failed) alerts.push({ tone: "danger", text: `${m.subs.failed} subscription${m.subs.failed === 1 ? "" : "s"} with a failed or overdue payment`, href: "/admin/billing/subscriptions?status=past_due" });
  if (m.alerts.failed_payments_7d) alerts.push({ tone: "danger", text: `${m.alerts.failed_payments_7d} failed payment${m.alerts.failed_payments_7d === 1 ? "" : "s"} in the last 7 days`, href: "/admin/billing/payments?status=failed" });
  if (m.subs.expiring) alerts.push({ tone: "warning", text: `${m.subs.expiring} subscription${m.subs.expiring === 1 ? "" : "s"} expiring within 14 days`, href: "/admin/billing/subscriptions?status=expiring&within=14" });
  if (m.subs.expired) alerts.push({ tone: "warning", text: `${m.subs.expired} expired subscription${m.subs.expired === 1 ? "" : "s"}`, href: "/admin/billing/subscriptions?status=expired" });
  if (m.alerts.failed_jobs) alerts.push({ tone: "danger", text: `${m.alerts.failed_jobs} failed background job${m.alerts.failed_jobs === 1 ? "" : "s"}`, href: "/admin/system?tab=jobs" });
  if (m.alerts.paystack_errors) alerts.push({ tone: "danger", text: `${m.alerts.paystack_errors} Paystack webhook${m.alerts.paystack_errors === 1 ? "" : "s"} failed to process`, href: "/admin/system?tab=errors" });
  if (m.alerts.brevo_errors) alerts.push({ tone: "warning", text: `${m.alerts.brevo_errors} contact${m.alerts.brevo_errors === 1 ? "" : "s"} failed to sync to Brevo`, href: "/admin/marketing/contacts" });
  if (m.alerts.storage_heavy) alerts.push({ tone: "warning", text: `${m.alerts.storage_heavy} organisation${m.alerts.storage_heavy === 1 ? "" : "s"} above 80% of their storage`, href: "/admin/usage?tab=storage" });
  if (m.platform.suspended_orgs) alerts.push({ tone: "info", text: `${m.platform.suspended_orgs} suspended organisation${m.platform.suspended_orgs === 1 ? "" : "s"}`, href: "/admin/moderation" });
  if (launch.mode !== "live") alerts.push({ tone: "info", text: `The platform is in ${launch.mode.toUpperCase()} mode`, href: "/admin/launch" });

  return (
    <>
      <PageHeader icon="eye-dashboard" title={<>Welcome, {admin.user.displayName.split(" ")[0]}.</>} description="Boredroom right now: who is on it, who is paying, what is moving, and what needs a hand." meta={<>Figures as of {formatDateTime(new Date())}, revenue in {pay.currency}</>} />

      {alerts.length ? (
        <Card className="mb-8">
          <CardHeader title={`Needs attention (${alerts.length})`} />
          <ul className="grid gap-2 md:grid-cols-2">{alerts.map((a) => <li key={a.text}><Link href={a.href} className="chip chip-link flex items-center gap-3 px-3 py-2 text-sm"><Badge tone={a.tone === "info" ? "info" : a.tone} dot>{a.tone === "danger" ? "Act" : a.tone === "warning" ? "Soon" : "Note"}</Badge><span>{a.text}</span></Link></li>)}</ul>
        </Card>
      ) : null}

      <div className="mb-8 grid gap-4 md:grid-cols-3">
        <StatCard label="Organisations" verdict={num(m.platform.orgs)} href="/admin/organisations" rows={[{ label: "Active", value: num(m.platform.active_orgs), tone: "success" }, { label: "New this week", value: num(m.platform.new_week), tone: "accent" }, { label: "New this month", value: num(m.platform.new_month), tone: "neutral" }, { label: "Suspended", value: num(m.platform.suspended_orgs), tone: "danger" }]} />
        <StatCard label="People" verdict={num(m.platform.users)} href="/admin/users" rows={[{ label: "Active in 30 days", value: num(m.platform.active_users), tone: "success" }, { label: "Working right now", value: num(m.platform.online), tone: "accent" }, { label: "Clocked in today", value: num(m.platform.clocked_in), tone: "info" }, { label: "Suspended", value: num(m.platform.suspended_users), tone: "danger" }]} />
        <StatCard label="Revenue this month" verdict={money(pay.month, pay.currency)} tone={pay.month ? "accent" : "default"} href="/admin/billing/payments" rows={[{ label: "Today", value: money(pay.today, pay.currency), tone: "accent" }, { label: "This year", value: money(pay.year, pay.currency), tone: "neutral" }, { label: "MRR", value: money(pay.mrr, pay.currency), tone: "success" }, { label: "ARR", value: money(pay.arr, pay.currency), tone: "success" }]} />
      </div>

      <div className="mb-8 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Subscriptions" action={<Link href="/admin/billing/subscriptions" className="text-sm text-fg-muted hover:text-fg">All</Link>} />
          <Ledger items={[{ label: "Free", value: num(m.subs.free) }, { label: "Trial", value: num(m.subs.trial) }, { label: "Paid", value: num(m.subs.paid), tone: "accent" }, { label: "Expiring soon", value: num(m.subs.expiring), tone: m.subs.expiring ? "danger" : "default" }]} />
          <p className="eyebrow mt-4">Expired {num(m.subs.expired)} · Cancelled {num(m.subs.cancelled)} · Payment failed {num(m.subs.failed)}</p>
        </Card>
        <Card>
          <CardHeader title="Payments" action={<Link href="/admin/billing/payments" className="text-sm text-fg-muted hover:text-fg">All</Link>} />
          <Ledger items={[{ label: "Successful", value: num(pay.success), tone: "accent" }, { label: "Failed", value: num(pay.failed), tone: pay.failed ? "danger" : "default" }, { label: "Pending", value: num(pay.pending) }, { label: "Refunded", value: num(pay.refunded) }]} />
          {pay.by_plan?.length ? <p className="eyebrow mt-4">By plan: {pay.by_plan.map((p) => `${p.plan} ${money(p.amount, pay.currency)}`).join(" · ")}</p> : null}
        </Card>
        <Card>
          <CardHeader title="Usage" action={<Link href="/admin/usage" className="text-sm text-fg-muted hover:text-fg">Detail</Link>} />
          <Ledger items={[{ label: "Tasks", value: num(m.usage.tasks), note: `${num(m.usage.tasks_done)} completed` }, { label: "Clock-ins", value: num(m.usage.clock_ins) }, { label: "Sessions", value: num(m.usage.heartbeats), note: `${num(m.usage.active_sessions)} open now` }, { label: "Storage", value: bytes(m.usage.storage), note: `${num(m.usage.videos)} recordings` }]} />
        </Card>
        <Card>
          <CardHeader title="Marketing" action={<Link href="/admin/marketing" className="text-sm text-fg-muted hover:text-fg">Detail</Link>} />
          <Ledger items={[{ label: "Contacts", value: num(mk.contacts) }, { label: "Waitlist", value: num(mk.waitlist), tone: "accent" }, { label: "Campaigns sent", value: num(mk.campaigns_sent) }, { label: "Emails sent", value: num(mk.emails_sent), note: mk.emails_failed ? `${num(mk.emails_failed)} failed` : undefined }]} />
        </Card>
      </div>

      <Card>
        <CardHeader title="Newest organisations" action={<Link href="/admin/organisations" className="text-sm text-fg-muted hover:text-fg">All organisations</Link>} />
        <ul className="divide-y divide-border-soft text-sm">{m.recentOrgs.map((o) => <li key={o.id} className="flex items-center justify-between gap-3 py-2"><Link href={`/admin/organisations/${o.id}`} className="font-medium hover:underline">{o.name}</Link><span className="text-fg-subtle">{o.owner_email ?? "no owner"} · {o.plan ?? "no plan"} · {dateOnly(o.created_at)}</span></li>)}</ul>
      </Card>
    </>
  );
}
