import Link from "next/link";
import { requireAdmin } from "@/server/admin/auth";
import { dashboardMetrics, activityByDay } from "@/server/admin/ops";
import { paymentMetrics } from "@/server/admin/billing";
import { marketingMetrics, waitlistByDay } from "@/server/admin/marketing";
import { launchSettings } from "@/server/admin/settings";
import { PageHeader, Card, CardHeader } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { AreaChart, BarChart, Donut, SegmentBar } from "@/components/ui/charts";
import { Badge } from "@/components/ui/badge";
import { bytes, num, money, dateOnly } from "@/lib/format";
import { formatDateTime } from "@/lib/utils";

export const metadata = { title: "Dashboard" };

export default async function AdminDashboard() {
  const admin = await requireAdmin("dashboard.view");
  const [m, pay, mk, launch, activity, signups] = await Promise.all([dashboardMetrics(), paymentMetrics(), marketingMetrics(), launchSettings(true), activityByDay(30), waitlistByDay(30)]);
  // Twelve months ending now, with zero for months that had no payment, so the bars keep their place.
  const months = Array.from({ length: 12 }, (_, i) => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - (11 - i)); const key = d.toISOString().slice(0, 7); return { key, label: d.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }), amount: Number(pay.by_month?.find((x) => x.month === key)?.amount ?? 0) }; });
  const dayLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
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
          <CardHeader title="Subscriptions" description="Every organisation by what it pays." action={<Link href="/admin/billing/subscriptions" className="text-sm text-fg-muted hover:text-fg">All</Link>} />
          <Donut title="Subscriptions by kind" items={[{ label: "Free", value: m.subs.free, tone: "info" }, { label: "Trial", value: m.subs.trial, tone: "warning" }, { label: "Paid", value: m.subs.paid, tone: "accent" }]} format={num} centre={{ value: num(m.subs.free + m.subs.trial + m.subs.paid), label: "live" }} />
          <SegmentBar className="mt-5" title="Subscriptions needing attention" items={[{ label: "Expiring in 14 days", value: m.subs.expiring, tone: "warning" }, { label: "Payment failed", value: m.subs.failed, tone: "danger" }, { label: "Expired", value: m.subs.expired, tone: "neutral" }, { label: "Cancelled", value: m.subs.cancelled, tone: "neutral" }]} format={num} />
        </Card>
        <Card>
          <CardHeader title="Revenue" description="Successful payments by month, last 12 months." action={<Link href="/admin/billing/payments" className="text-sm text-fg-muted hover:text-fg">All</Link>} />
          <BarChart title="Revenue by month" labels={months.map((x) => x.label)} values={months.map((x) => x.amount)} format={(n) => money(n, pay.currency)} empty="No payments yet." />
          <SegmentBar className="mt-4" title="Payments by outcome" items={[{ label: "Successful", value: pay.success, tone: "success" }, { label: "Pending", value: pay.pending, tone: "info" }, { label: "Failed", value: pay.failed, tone: "danger" }, { label: "Refunded", value: pay.refunded, tone: "neutral" }]} format={num} />
        </Card>
        <Card>
          <CardHeader title="Activity" description="What happened on the platform each day, last 30 days." action={<Link href="/admin/usage" className="text-sm text-fg-muted hover:text-fg">Detail</Link>} />
          <AreaChart title="Daily activity" labels={activity.map((d) => dayLabel(d.day))} series={[{ label: "Sessions", values: activity.map((d) => d.sessions), tone: "accent" }, { label: "Clock-ins", values: activity.map((d) => d.clock_ins), tone: "info" }, { label: "Tasks completed", values: activity.map((d) => d.tasks_completed), tone: "success" }]} format={num} />
          <p className="eyebrow mt-4">{num(m.usage.tasks)} tasks open · {num(m.usage.active_sessions)} sessions open now · {bytes(m.usage.storage)} stored in {num(m.usage.videos)} recordings</p>
        </Card>
        <Card>
          <CardHeader title="Waitlist" description="Sign-ups per day and where every contact is in the funnel." action={<Link href="/admin/marketing" className="text-sm text-fg-muted hover:text-fg">Detail</Link>} />
          <AreaChart title="Waitlist sign-ups" labels={signups.map((d) => dayLabel(d.day))} series={[{ label: "Sign-ups", values: signups.map((d) => d.signups), tone: "accent" }]} format={num} empty="No sign-ups in the last 30 days." />
          <SegmentBar className="mt-4" title="Waitlist funnel" items={[{ label: "Waiting", value: mk.waiting, tone: "neutral" }, { label: "Invited", value: mk.invited, tone: "info" }, { label: "Registered", value: mk.registered - mk.activated, tone: "success" }, { label: "Activated", value: mk.activated - mk.paid, tone: "accent" }, { label: "Paid", value: mk.paid, tone: "warning" }]} format={num} />
          <p className="eyebrow mt-4">{num(mk.contacts)} contacts · {num(mk.campaigns_sent)} campaigns sent · {num(mk.emails_sent)} emails sent{mk.emails_failed ? ` · ${num(mk.emails_failed)} failed` : ""}</p>
        </Card>
      </div>

      <Card>
        <CardHeader title="Newest organisations" action={<Link href="/admin/organisations" className="text-sm text-fg-muted hover:text-fg">All organisations</Link>} />
        <ul className="divide-y divide-border-soft text-sm">{m.recentOrgs.map((o) => <li key={o.id} className="flex items-center justify-between gap-3 py-2"><Link href={`/admin/organisations/${o.id}`} className="font-medium hover:underline">{o.name}</Link><span className="text-fg-subtle">{o.owner_email ?? "no owner"} · {o.plan ?? "no plan"} · {dateOnly(o.created_at)}</span></li>)}</ul>
      </Card>
    </>
  );
}
