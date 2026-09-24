import Link from "next/link";
import { requireAdmin } from "@/server/admin/auth";
import { marketingMetrics, listCampaigns, brevoConfigured } from "@/server/admin/marketing";
import { PageHeader, Card, CardHeader, Ledger } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/states";
import { num, dateOnly } from "@/lib/format";

export const metadata = { title: "Marketing" };

export default async function MarketingPage() {
  await requireAdmin("marketing.view");
  const [m, campaigns] = await Promise.all([marketingMetrics(), listCampaigns()]);
  const links = [["/admin/marketing/contacts", "Contacts", "Every person we can write to: waitlist, product users, imports."], ["/admin/marketing/segments", "Segments", "Dynamic audiences from conditions."], ["/admin/marketing/campaigns", "Campaigns", "One-off sends to an audience, previewed and tested first."], ["/admin/marketing/automations", "Automations", "Lifecycle and billing emails that run themselves."], ["/admin/marketing/templates", "Templates", "The emails, with variables, by category."], ["/admin/launch", "Waitlist and launch", "Signups, conversion and the launch switch."]];
  return (
    <>
      <PageHeader icon="chat" title="Marketing" description="Contacts, segments, campaigns and automations, delivered through Brevo's relay on the Boredroom email design." meta={<>Brevo API {brevoConfigured() ? "connected for contact sync" : "not configured; sends still go through SMTP"}</>} />
      {!brevoConfigured() ? <Alert tone="info" className="mb-6">Contact synchronisation to Brevo lists is off until BREVO_API_KEY is set. Email delivery is unaffected.</Alert> : null}
      <Card className="mb-6"><Ledger items={[{ label: "Contacts", value: num(m.contacts) }, { label: "Waitlist", value: num(m.waitlist), tone: "accent", note: `${num(m.today)} today, ${num(m.week)} this week` }, { label: "Campaigns sent", value: num(m.campaigns_sent) }, { label: "Emails sent", value: num(m.emails_sent), note: m.emails_failed ? `${num(m.emails_failed)} failed` : "no failures", tone: m.emails_failed ? "danger" : "default" }]} /><p className="eyebrow mt-3">Waitlist funnel: waiting {num(m.waiting)} · invited {num(m.invited)} · registered {num(m.registered)} · activated {num(m.activated)} · paid {num(m.paid)} · unsubscribed {num(m.unsubscribed)}</p></Card>
      <div className="mb-6 grid gap-4 md:grid-cols-3">{links.map(([href, t, d]) => <Link key={href} href={href} className="tile tile-link p-4"><p className="font-semibold">{t}</p><p className="mt-1 text-sm text-fg-muted">{d}</p></Link>)}</div>
      <Card><CardHeader title="Recent campaigns" action={<Link href="/admin/marketing/campaigns" className="text-sm text-fg-muted hover:text-fg">All</Link>} />
        {campaigns.length === 0 ? <p className="text-sm text-fg-subtle">No campaigns yet.</p> : <ul className="divide-y divide-border-soft text-sm">{campaigns.slice(0, 6).map((c) => <li key={c.id} className="flex items-center justify-between gap-3 py-2"><Link href={`/admin/marketing/campaigns/${c.id}`} className="font-medium hover:underline">{c.name}</Link><span className="flex items-center gap-2 text-xs text-fg-subtle"><Badge tone={c.status === "sent" ? "success" : c.status === "sending" ? "info" : c.status === "failed" ? "danger" : "neutral"}>{c.status}</Badge>{c.sent ? `${num(c.sent)} sent` : ""} · {dateOnly(c.created_at)}</span></li>)}</ul>}
      </Card>
    </>
  );
}
