import Link from "next/link";
import { requireAdmin } from "@/server/admin/auth";
import { listOrganisations } from "@/server/admin/organisations";
import { listUsers } from "@/server/admin/users";
import { PageHeader, Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { dateOnly } from "@/lib/format";

export const metadata = { title: "Moderation" };

export default async function ModerationPage() {
  await requireAdmin("moderation.view");
  const [orgs, archived, suspended, banned] = await Promise.all([listOrganisations({ status: "suspended", pageSize: 50 }), listOrganisations({ status: "archived", pageSize: 50 }), listUsers({ status: "suspended", pageSize: 50 }), listUsers({ status: "banned", pageSize: 50 })]);
  return (
    <>
      <PageHeader icon="shield-check" title="Moderation" description="Organisations and people currently suspended, banned or archived. Actions are taken from the organisation or user page, each with a reason." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card><CardHeader title={`Suspended organisations (${orgs.total})`} />{orgs.rows.length === 0 ? <p className="text-sm text-fg-subtle">None.</p> : <ul className="divide-y divide-border-soft text-sm">{orgs.rows.map((o) => <li key={o.id} className="flex items-center justify-between gap-3 py-2"><Link href={`/admin/organisations/${o.id}?tab=security`} className="font-medium hover:underline">{o.name}</Link><span className="text-xs text-fg-subtle">since {dateOnly(o.suspended_at)}</span></li>)}</ul>}</Card>
        <Card><CardHeader title={`Archived organisations (${archived.total})`} />{archived.rows.length === 0 ? <p className="text-sm text-fg-subtle">None.</p> : <ul className="divide-y divide-border-soft text-sm">{archived.rows.map((o) => <li key={o.id} className="flex items-center justify-between gap-3 py-2"><Link href={`/admin/organisations/${o.id}`} className="font-medium hover:underline">{o.name}</Link><span className="text-xs text-fg-subtle">{dateOnly(o.archived_at)}</span></li>)}</ul>}</Card>
        <Card><CardHeader title={`Suspended users (${suspended.total})`} />{suspended.rows.length === 0 ? <p className="text-sm text-fg-subtle">None.</p> : <ul className="divide-y divide-border-soft text-sm">{suspended.rows.map((u) => <li key={u.auth_user_id} className="flex items-center justify-between gap-3 py-2"><Link href={`/admin/users/${u.auth_user_id}`} className="font-medium hover:underline">{u.display_name}</Link><span className="text-xs text-fg-subtle">{u.email}</span></li>)}</ul>}</Card>
        <Card><CardHeader title={`Banned users (${banned.total})`} />{banned.rows.length === 0 ? <p className="text-sm text-fg-subtle">None.</p> : <ul className="divide-y divide-border-soft text-sm">{banned.rows.map((u) => <li key={u.auth_user_id} className="flex items-center justify-between gap-3 py-2"><Link href={`/admin/users/${u.auth_user_id}`} className="font-medium hover:underline">{u.display_name}</Link><Badge tone="danger">banned</Badge></li>)}</ul>}</Card>
      </div>
    </>
  );
}
