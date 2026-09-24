import Link from "next/link";
import { requireAdmin } from "@/server/admin/auth";
import { globalSearch } from "@/server/admin/ops";
import { PageHeader, Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import { money } from "@/lib/format";

export const metadata = { title: "Search" };

function Section({ title, items }: { title: string; items: { href: string; label: string; hint?: string }[] }) {
  if (items.length === 0) return null;
  return <Card><CardHeader title={`${title} (${items.length})`} className="mb-2" /><ul className="divide-y divide-border-soft text-sm">{items.map((i) => <li key={i.href} className="flex items-center justify-between gap-3 py-2"><Link href={i.href} className="font-medium hover:underline">{i.label}</Link>{i.hint ? <span className="text-xs text-fg-subtle">{i.hint}</span> : null}</li>)}</ul></Card>;
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireAdmin("dashboard.view");
  const { q = "" } = await searchParams;
  const r = await globalSearch(q);
  const total = r.users.length + r.organisations.length + r.payments.length + r.contacts.length + r.subscriptions.length + r.campaigns.length;
  return (
    <>
      <PageHeader title={q ? `Results for “${q}”` : "Search"} description="Users, organisations, payments, contacts, subscriptions and campaigns, by name, email, id or reference." meta={q ? `${total} result${total === 1 ? "" : "s"}` : undefined} />
      {q && total === 0 ? <EmptyState title="Nothing matches" description="Try part of a name, an email address, an organisation id or a Paystack reference." /> : null}
      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Users" items={r.users.map((u) => ({ href: `/admin/users/${u.id}`, label: u.display_name, hint: `${u.email}${u.status !== "active" ? ` · ${u.status}` : ""}` }))} />
        <Section title="Organisations" items={r.organisations.map((o) => ({ href: `/admin/organisations/${o.id}`, label: o.name, hint: `${o.slug}${o.status !== "active" ? ` · ${o.status}` : ""}` }))} />
        <Section title="Payments" items={r.payments.map((p) => ({ href: `/admin/billing/payments/${p.id}`, label: p.reference, hint: `${money(p.amount, p.currency)} · ${p.status}` }))} />
        <Section title="Contacts" items={r.contacts.map((c) => ({ href: `/admin/marketing/contacts?q=${encodeURIComponent(c.email)}`, label: [c.first_name, c.last_name].filter(Boolean).join(" ") || c.email, hint: `${c.email} · ${c.status}` }))} />
        <Section title="Subscriptions" items={r.subscriptions.map((s) => ({ href: `/admin/billing/subscriptions?q=${encodeURIComponent(s.org_name)}`, label: s.org_name, hint: `${s.status}${s.code ? ` · ${s.code}` : ""}` }))} />
        <Section title="Campaigns" items={r.campaigns.map((c) => ({ href: `/admin/marketing/campaigns/${c.id}`, label: c.name, hint: c.status }))} />
      </div>
      {!q ? <p className="mt-6 text-sm text-fg-muted">Type in the search box at the top. <Badge tone="neutral">Enter</Badge> opens the results.</p> : null}
    </>
  );
}
