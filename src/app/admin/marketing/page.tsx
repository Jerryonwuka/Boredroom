import Link from "next/link";
import { ChevronRight, Contact, Mail, Megaphone, Send } from "lucide-react";
import { requireAdmin } from "@/server/admin/auth";
import { marketingMetrics, listCampaigns, brevoConfigured } from "@/server/admin/marketing";
import { PageHeader, Card, CardHeader } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { HairlineGrid, GridCell } from "@/components/ui/grid";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/states";
import { buttonVariants } from "@/components/ui/button";
import { MARKETING_TABS, linkCls, words } from "@/components/admin/fields";
import { num, dateOnly } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata = { title: "Marketing" };

const CAMPAIGN_TONE: Record<string, "success" | "danger" | "neutral" | "warning"> = { sent: "success", failed: "danger", scheduled: "warning" };

export default async function MarketingPage() {
  await requireAdmin("marketing.view");
  const [m, campaigns] = await Promise.all([marketingMetrics(), listCampaigns()]);
  const sections = [["/admin/marketing/contacts", "Contacts", "Every person we can write to: waitlist, product users, imports."], ["/admin/marketing/segments", "Segments", "Dynamic audiences from conditions."], ["/admin/marketing/campaigns", "Campaigns", "One-off sends to an audience, previewed and tested first."], ["/admin/marketing/automations", "Automations", "Lifecycle and billing emails that run themselves."], ["/admin/marketing/templates", "Templates", "The emails, with variables, by category."], ["/admin/launch", "Waitlist and launch", "Signups, conversion and the launch switch."]];
  return (
    <>
      <PageHeader title="Marketing" description="Contacts, segments, campaigns and automations, delivered through Brevo's relay on the Boredroom email design." meta={<>Brevo API {brevoConfigured() ? "connected for contact sync" : "not configured; sends still go through SMTP"}</>}
        tabs={MARKETING_TABS} tabsLabel="Marketing sections" />
      {!brevoConfigured() ? <Alert tone="info" className="mb-6">Contact synchronisation to Brevo lists is off until BREVO_API_KEY is set. Email delivery is unaffected.</Alert> : null}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Contacts" value={num(m.contacts)} icon={<Contact />} href="/admin/marketing/contacts" />
        <StatCard label="Waitlist" value={num(m.waitlist)} icon={<Megaphone />} hint={`${num(m.today)} today, ${num(m.week)} this week`} href="/admin/launch" />
        <StatCard label="Campaigns sent" value={num(m.campaigns_sent)} icon={<Send />} href="/admin/marketing/campaigns" />
        <StatCard label="Emails sent" value={num(m.emails_sent)} icon={<Mail />} tone={m.emails_failed ? "danger" : "default"} hint={m.emails_failed ? `${num(m.emails_failed)} failed` : "No failures"} href="/admin/communications" />
      </div>
      <Card className="mb-6">
        <CardHeader title="Waitlist funnel" description="Where every waitlist contact is now." />
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {[["Waiting", m.waiting], ["Invited", m.invited], ["Registered", m.registered], ["Activated", m.activated], ["Paid", m.paid], ["Unsubscribed", m.unsubscribed]].map(([label, value]) => (
            <div key={label} className="min-w-0 rounded-xl bg-fill-0 px-3 py-2.5">
              <dt className="type-metric-label">{label}</dt>
              <dd className="type-metric">{num(Number(value))}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <HairlineGrid className="mb-6">
        {sections.map(([href, t, d]) => <GridCell key={href} href={href} title={t}>{d}</GridCell>)}
      </HairlineGrid>
      <Card>
        <CardHeader title="Recent campaigns" action={<Link href="/admin/marketing/campaigns" className={cn(buttonVariants({ variant: "ghost", size: "xs" }), "-mr-2")}>All<ChevronRight aria-hidden /></Link>} />
        {campaigns.length === 0 ? <p className="text-sm font-normal text-secondary">No campaigns yet.</p> : (
          <DataTable caption="Recent campaigns">
            <thead><tr><th>Campaign</th><th>Status</th><th>Sent</th><th>Created</th></tr></thead>
            <tbody>{campaigns.slice(0, 6).map((c) => (
              <tr key={c.id}>
                <td><Link href={`/admin/marketing/campaigns/${c.id}`} className={linkCls}>{c.name}</Link></td>
                <td>{c.status === "sending" ? <Badge tone="accent" dot>Sending</Badge> : <Badge tone={CAMPAIGN_TONE[c.status] ?? "neutral"}>{words(c.status)}</Badge>}</td>
                <td className="tabular-nums">{c.sent ? num(c.sent) : <span className="text-secondary">None</span>}</td>
                <td className="tabular-nums">{dateOnly(c.created_at)}</td>
              </tr>
            ))}</tbody>
          </DataTable>
        )}
      </Card>
    </>
  );
}
