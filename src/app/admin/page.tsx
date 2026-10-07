import Link from "next/link";
import { Building2, ChevronRight, UsersRound, Wallet } from "lucide-react";
import { AnimatedChevronRight } from "@/components/ui/animated-icons";
import { requireAdmin } from "@/server/admin/auth";
import { dashboardMetrics, activityByDay } from "@/server/admin/ops";
import { paymentMetrics } from "@/server/admin/billing";
import { marketingMetrics, waitlistByDay } from "@/server/admin/marketing";
import { launchSettings } from "@/server/admin/settings";
import { PageHeader, Card, CardHeader } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { AnalyticsCard } from "@/components/ui/analytics-card";
import { AreaChart, BarChart, Donut, SegmentBar } from "@/components/ui/charts";
import { Badge, CountPill } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/table";
import { buttonVariants } from "@/components/ui/button";
import { linkCls, subCls } from "@/components/admin/fields";
import { bytes, num, money, dateOnly } from "@/lib/format";
import { cn, formatDateTime } from "@/lib/utils";

// The layout's title template applies to the pages below it, not to this page beside it.
export const metadata = { title: { absolute: "Dashboard · Control Center" } };

const ALERT = { danger: { tone: "danger", word: "Act" }, warning: { tone: "warning", word: "Soon" }, info: { tone: "info", word: "Note" } } as const;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The Control Center's home, v4: what needs a hand first, three stat cards, an analytics card whose metric strip
 * switches between revenue, activity and the waitlist (the chosen metric underlined in orange, its chart's highlight
 * in orange), then subscriptions and the newest organisations. Orange appears only where the accent rules put it.
 */
export default async function AdminDashboard() {
  const admin = await requireAdmin("dashboard.view");
  const [m, pay, mk, launch, activity, signups] = await Promise.all([dashboardMetrics(), paymentMetrics(), marketingMetrics(), launchSettings(true), activityByDay(30), waitlistByDay(30)]);
  // Twelve months ending now, with zero for months that had no payment, so the bars keep their place.
  const months = Array.from({ length: 12 }, (_, i) => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - (11 - i)); const key = d.toISOString().slice(0, 7); return { key, label: d.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }), amount: Number(pay.by_month?.find((x) => x.month === key)?.amount ?? 0) }; });
  const dayLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  const alerts: { tone: keyof typeof ALERT; text: string; href: string }[] = [];
  if (m.subs.failed) alerts.push({ tone: "danger", text: `${plural(m.subs.failed, "subscription")} with a failed or overdue payment`, href: "/admin/billing/subscriptions?status=past_due" });
  if (m.alerts.failed_payments_7d) alerts.push({ tone: "danger", text: `${plural(m.alerts.failed_payments_7d, "failed payment")} in the last 7 days`, href: "/admin/billing/payments?status=failed" });
  if (m.subs.expiring) alerts.push({ tone: "warning", text: `${plural(m.subs.expiring, "subscription")} expiring within 14 days`, href: "/admin/billing/subscriptions?status=expiring&within=14" });
  if (m.subs.expired) alerts.push({ tone: "warning", text: `${plural(m.subs.expired, "expired subscription")}`, href: "/admin/billing/subscriptions?status=expired" });
  if (m.alerts.failed_jobs) alerts.push({ tone: "danger", text: `${plural(m.alerts.failed_jobs, "failed background job")}`, href: "/admin/system?tab=jobs" });
  if (m.alerts.paystack_errors) alerts.push({ tone: "danger", text: `${plural(m.alerts.paystack_errors, "Paystack webhook")} failed to process`, href: "/admin/system?tab=errors" });
  if (m.alerts.brevo_errors) alerts.push({ tone: "warning", text: `${plural(m.alerts.brevo_errors, "contact")} failed to sync to Brevo`, href: "/admin/marketing/contacts" });
  if (m.alerts.storage_heavy) alerts.push({ tone: "warning", text: `${plural(m.alerts.storage_heavy, "organisation")} above 80% of their storage`, href: "/admin/usage?tab=storage" });
  if (m.platform.suspended_orgs) alerts.push({ tone: "info", text: `${plural(m.platform.suspended_orgs, "suspended organisation")}`, href: "/admin/moderation" });
  if (launch.mode !== "live") alerts.push({ tone: "info", text: `The platform is in ${launch.mode === "waitlist" ? "waitlist" : "maintenance"} mode`, href: "/admin/launch" });

  const revenue12 = months.reduce((a, x) => a + x.amount, 0);
  const sessions30 = activity.reduce((a, d) => a + Number(d.sessions), 0);
  const signups30 = signups.reduce((a, d) => a + Number(d.signups), 0);
  const funnel = [
    { label: "Waiting", value: mk.waiting },
    { label: "Invited", value: mk.invited },
    { label: "Registered", value: mk.registered },
    { label: "Activated", value: mk.activated },
    { label: "Paid", value: mk.paid },
  ];
  const more = (href: string, label: string) => <Link href={href} className={cn(buttonVariants({ variant: "ghost", size: "xs" }), "-mr-2")}>{label}<AnimatedChevronRight aria-hidden /></Link>;

  return (
    <>
      <PageHeader title="Dashboard" description={<>Welcome, {admin.user.displayName.split(" ")[0]}. Boredroom right now: who is on it, who is paying, what is moving, and what needs a hand.</>} meta={<>Figures as of {formatDateTime(new Date())}, revenue in {pay.currency}</>} />

      {alerts.length ? (
        <Card className="mb-6">
          <CardHeader title={<span className="flex items-center gap-2">Needs attention<CountPill count={alerts.length} tone="attention" /></span>} className="mb-2" />
          <ul className="grid gap-x-6 md:grid-cols-2">
            {alerts.map((a) => (
              <li key={a.text}>
                <Link href={a.href} className="-mx-2 flex min-h-10 items-center gap-3 rounded-[10px] px-2 py-1.5 text-sm transition-colors duration-75 hover:bg-fill-1">
                  <Badge tone={ALERT[a.tone].tone} dot className="w-16">{ALERT[a.tone].word}</Badge>
                  <span className="min-w-0 flex-1 font-normal text-foreground">{a.text}</span>
                  <ChevronRight className="size-4 shrink-0 text-secondary" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="mb-6 grid gap-3 md:grid-cols-3">
        <StatCard label="Organisations" value={num(m.platform.orgs)} href="/admin/organisations" icon={<Building2 />}
          rows={[{ label: "Active", value: num(m.platform.active_orgs), tone: "success" }, { label: "New this week", value: num(m.platform.new_week) }, { label: "New this month", value: num(m.platform.new_month) }, { label: "Suspended", value: num(m.platform.suspended_orgs), tone: m.platform.suspended_orgs ? "danger" : "neutral" }]} />
        <StatCard label="People" value={num(m.platform.users)} href="/admin/users" icon={<UsersRound />}
          rows={[{ label: "Active in 30 days", value: num(m.platform.active_users), tone: "success" }, { label: "Working right now", value: num(m.platform.online), tone: m.platform.online ? "accent" : "neutral" }, { label: "Clocked in today", value: num(m.platform.clocked_in) }, { label: "Suspended", value: num(m.platform.suspended_users), tone: m.platform.suspended_users ? "danger" : "neutral" }]} />
        <StatCard label="Revenue this month" value={money(pay.month, pay.currency)} href="/admin/billing/payments" icon={<Wallet />}
          rows={[{ label: "Today", value: money(pay.today, pay.currency) }, { label: "This year", value: money(pay.year, pay.currency) }, { label: "MRR", value: money(pay.mrr, pay.currency) }, { label: "ARR", value: money(pay.arr, pay.currency) }]} />
      </div>

      <AnalyticsCard className="mb-6" label="Platform trends" metrics={[
        {
          key: "revenue", label: "Revenue", value: money(revenue12, pay.currency), hint: "Last 12 months",
          content: (
            <>
              <BarChart title="Revenue by month, last 12 months" labels={months.map((x) => x.label)} values={months.map((x) => x.amount)} format={(n) => money(n, pay.currency)} empty="No payments yet." />
              <div className="mt-5 flex flex-wrap items-end justify-between gap-3">
                <SegmentBar className="min-w-0 flex-1" title="Payments by outcome" items={[{ label: "Successful", value: pay.success, tone: "success" }, { label: "Pending", value: pay.pending, tone: "neutral" }, { label: "Failed", value: pay.failed, tone: "danger" }, { label: "Refunded", value: pay.refunded, tone: "subtle" }]} format={num} />
                {more("/admin/billing/payments", "All payments")}
              </div>
            </>
          ),
        },
        {
          key: "activity", label: "Sessions", value: num(sessions30), hint: "Last 30 days",
          content: (
            <>
              <AreaChart title="Daily activity, last 30 days" labels={activity.map((d) => dayLabel(d.day))} series={[{ label: "Sessions", values: activity.map((d) => d.sessions) }, { label: "Clock-ins", values: activity.map((d) => d.clock_ins) }, { label: "Tasks completed", values: activity.map((d) => d.tasks_completed) }]} format={num} />
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-meta font-normal text-secondary"><span className="tabular-nums">{num(m.usage.tasks)}</span> tasks open, <span className="tabular-nums">{num(m.usage.active_sessions)}</span> sessions open now, {bytes(m.usage.storage)} stored in <span className="tabular-nums">{num(m.usage.videos)}</span> recordings</p>
                {more("/admin/usage", "Usage and activity")}
              </div>
            </>
          ),
        },
        {
          key: "waitlist", label: "Waitlist sign-ups", value: num(signups30), hint: "Last 30 days",
          content: (
            <>
              <AreaChart title="Waitlist sign-ups per day, last 30 days" labels={signups.map((d) => dayLabel(d.day))} series={[{ label: "Sign-ups", values: signups.map((d) => d.signups) }]} format={num} empty="No sign-ups in the last 30 days." />
              <h3 className="mt-5 text-sm font-semibold text-foreground">Waitlist funnel</h3>
              <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
                {funnel.map((f) => (
                  <div key={f.label} className="min-w-0 rounded-xl bg-fill-0 px-3 py-2.5">
                    <dt className="type-metric-label">{f.label}</dt>
                    <dd className="type-metric">{num(f.value)}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-meta font-normal text-secondary"><span className="tabular-nums">{num(mk.contacts)}</span> contacts, <span className="tabular-nums">{num(mk.campaigns_sent)}</span> campaigns sent, <span className="tabular-nums">{num(mk.emails_sent)}</span> emails sent{mk.emails_failed ? <>, <span className="tabular-nums text-danger">{num(mk.emails_failed)}</span> failed</> : null}</p>
                {more("/admin/marketing", "Marketing")}
              </div>
            </>
          ),
        },
      ]} />

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader title="Subscriptions" description="Every organisation by what it pays." action={more("/admin/billing/subscriptions", "All")} />
          <Donut title="Subscriptions by kind" items={[{ label: "Free", value: m.subs.free, tone: "subtle" }, { label: "Trial", value: m.subs.trial, tone: "neutral" }, { label: "Paid", value: m.subs.paid, tone: "success" }]} format={num} centre={{ value: num(m.subs.free + m.subs.trial + m.subs.paid), label: "live" }} />
          <SegmentBar className="mt-5" title="Subscriptions needing attention" items={[{ label: "Expiring in 14 days", value: m.subs.expiring, tone: "warning" }, { label: "Payment failed", value: m.subs.failed, tone: "danger" }, { label: "Expired", value: m.subs.expired, tone: "neutral" }, { label: "Cancelled", value: m.subs.cancelled, tone: "subtle" }]} format={num} />
        </Card>
        <Card>
          <CardHeader title="Newest organisations" action={more("/admin/organisations", "All organisations")} />
          {m.recentOrgs.length === 0 ? <p className="text-sm font-normal text-secondary">No organisations yet.</p> : (
            <DataTable caption="Newest organisations">
              <thead><tr><th>Organisation</th><th>Plan</th><th>Created</th></tr></thead>
              <tbody>{m.recentOrgs.map((o) => (
                <tr key={o.id}>
                  <td><Link href={`/admin/organisations/${o.id}`} className={linkCls}>{o.name}</Link><span className={subCls}>{o.owner_email ?? "No owner"}</span></td>
                  <td>{o.plan ?? <span className="text-secondary">No plan</span>}</td>
                  <td className="tabular-nums">{dateOnly(o.created_at)}</td>
                </tr>
              ))}</tbody>
            </DataTable>
          )}
        </Card>
      </div>
    </>
  );
}
