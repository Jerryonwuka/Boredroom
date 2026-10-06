import Link from "next/link";
import { CircleCheck } from "lucide-react";
import { requireAdmin } from "@/server/admin/auth";
import { listOrganisations } from "@/server/admin/organisations";
import { listUsers } from "@/server/admin/users";
import { PageHeader, Card, CardHeader } from "@/components/ui/card";
import { Badge, CountPill } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import { linkCls, subCls } from "@/components/admin/fields";
import { dateOnly } from "@/lib/format";

export const metadata = { title: "Moderation" };

/** One list of moderated things in a card: a title with its count, rows of a link and a quiet line. */
function List({ title, total, empty, items }: { title: string; total: number; empty: string; items: { key: string; href: string; label: string; meta?: React.ReactNode; trailing?: React.ReactNode }[] }) {
  return (
    <Card className="self-start">
      <CardHeader title={<span className="flex items-center gap-2">{title}<CountPill count={total} /></span>} size="sm" className="mb-3" />
      {items.length === 0 ? <EmptyState compact icon={CircleCheck} tone="neutral" title={empty} /> : (
        <ul className="grid gap-2.5">{items.map((it) => (
          <li key={it.key} className="flex min-w-0 items-center justify-between gap-3">
            <span className="min-w-0"><Link href={it.href} className={linkCls}>{it.label}</Link>{it.meta ? <span className={subCls}>{it.meta}</span> : null}</span>
            {it.trailing}
          </li>
        ))}</ul>
      )}
    </Card>
  );
}

export default async function ModerationPage() {
  await requireAdmin("moderation.view");
  const [orgs, archived, suspended, banned] = await Promise.all([listOrganisations({ status: "suspended", pageSize: 50 }), listOrganisations({ status: "archived", pageSize: 50 }), listUsers({ status: "suspended", pageSize: 50 }), listUsers({ status: "banned", pageSize: 50 })]);
  return (
    <>
      <PageHeader title="Moderation" description="Organisations and people currently suspended, banned or archived. Actions are taken from the organisation or user page, each with a reason." divider />
      <div className="grid gap-3 lg:grid-cols-2">
        <List title="Suspended organisations" total={orgs.total} empty="No suspended organisations" items={orgs.rows.map((o) => ({ key: o.id, href: `/admin/organisations/${o.id}?tab=security`, label: o.name, meta: o.suspended_at ? `Since ${dateOnly(o.suspended_at)}` : undefined }))} />
        <List title="Archived organisations" total={archived.total} empty="No archived organisations" items={archived.rows.map((o) => ({ key: o.id, href: `/admin/organisations/${o.id}`, label: o.name, meta: o.archived_at ? `Archived ${dateOnly(o.archived_at)}` : undefined }))} />
        <List title="Suspended users" total={suspended.total} empty="No suspended users" items={suspended.rows.map((u) => ({ key: u.auth_user_id, href: `/admin/users/${u.auth_user_id}`, label: u.display_name, meta: u.email }))} />
        <List title="Banned users" total={banned.total} empty="No banned users" items={banned.rows.map((u) => ({ key: u.auth_user_id, href: `/admin/users/${u.auth_user_id}`, label: u.display_name, meta: u.email, trailing: <Badge tone="danger">Banned</Badge> }))} />
      </div>
    </>
  );
}
