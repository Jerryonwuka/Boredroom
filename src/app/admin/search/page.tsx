import Link from "next/link";
import { Search } from "lucide-react";
import { requireAdmin } from "@/server/admin/auth";
import { globalSearch } from "@/server/admin/ops";
import { PageHeader, Card, CardHeader } from "@/components/ui/card";
import { CountPill, Kbd } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { linkCls, subCls, words } from "@/components/admin/fields";
import { money } from "@/lib/format";

export const metadata = { title: "Search" };

function Section({ title, items }: { title: string; items: { href: string; label: string; hint?: string }[] }) {
  if (items.length === 0) return null;
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2">{title}<CountPill count={items.length} /></span>} size="sm" className="mb-3" />
      <ul className="grid gap-2.5">{items.map((i) => (
        <li key={i.href} className="min-w-0"><Link href={i.href} className={linkCls}>{i.label}</Link>{i.hint ? <span className={subCls}>{i.hint}</span> : null}</li>
      ))}</ul>
    </Card>
  );
}

/** The results page. Its own field (a GET form) works on any screen, the phone included, where the top bar has no search box. */
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireAdmin("dashboard.view");
  const { q = "" } = await searchParams;
  const r = await globalSearch(q);
  const total = r.users.length + r.organisations.length + r.payments.length + r.contacts.length + r.subscriptions.length + r.campaigns.length;
  return (
    <>
      <PageHeader title={q ? `Results for “${q}”` : "Search"} description="Users, organisations, payments, contacts, subscriptions and campaigns, by name, email, id or reference." meta={q ? `${total} result${total === 1 ? "" : "s"}` : undefined} />
      <form role="search" action="/admin/search" className="mb-6 flex max-w-xl gap-2">
        <label className="field field-lg field-adorned min-w-0 flex-1">
          <Search aria-hidden />
          <input name="q" type="text" enterKeyHint="search" defaultValue={q} placeholder="Name, email, id or reference" aria-label="Search the Control Center" autoComplete="off" spellCheck={false} />
        </label>
        <Button type="submit" variant="secondary" size="lg">Search</Button>
      </form>
      {q && total === 0 ? <EmptyState icon={Search} title="Nothing matches" description="Try part of a name, an email address, an organisation id or a Paystack reference." /> : null}
      <div className="grid gap-3 md:grid-cols-2">
        <Section title="Users" items={r.users.map((u) => ({ href: `/admin/users/${u.id}`, label: u.display_name, hint: `${u.email}${u.status !== "active" ? `, ${u.status}` : ""}` }))} />
        <Section title="Organisations" items={r.organisations.map((o) => ({ href: `/admin/organisations/${o.id}`, label: o.name, hint: `${o.slug}${o.status !== "active" ? `, ${o.status}` : ""}` }))} />
        <Section title="Payments" items={r.payments.map((p) => ({ href: `/admin/billing/payments/${p.id}`, label: p.reference, hint: `${money(p.amount, p.currency)}, ${p.status}` }))} />
        <Section title="Contacts" items={r.contacts.map((c) => ({ href: `/admin/marketing/contacts?q=${encodeURIComponent(c.email)}`, label: [c.first_name, c.last_name].filter(Boolean).join(" ") || c.email, hint: `${c.email}, ${c.status}` }))} />
        <Section title="Subscriptions" items={r.subscriptions.map((s) => ({ href: `/admin/billing/subscriptions?q=${encodeURIComponent(s.org_name)}`, label: s.org_name, hint: `${words(s.status)}${s.code ? `, ${s.code}` : ""}` }))} />
        <Section title="Campaigns" items={r.campaigns.map((c) => ({ href: `/admin/marketing/campaigns/${c.id}`, label: c.name, hint: words(c.status) }))} />
      </div>
      {!q ? <p className="mt-2 hidden text-sm font-normal text-secondary lg:block">On any Control Center page, <Kbd>⌘</Kbd> <Kbd>K</Kbd> (<Kbd>Ctrl</Kbd> <Kbd>K</Kbd> on Windows) puts the cursor in the top bar&apos;s search.</p> : null}
    </>
  );
}
