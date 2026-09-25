import Link from "next/link";
import { requireAdmin, can } from "@/server/admin/auth";
import { impersonations } from "@/server/admin/ops";
import { listUsers } from "@/server/admin/users";
import { PageHeader, Card, CardHeader } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Filters } from "@/components/admin/actions";
import { F, inputCls } from "@/components/admin/fields";
import { ImpersonateButton } from "@/components/admin/impersonate";
import { formatDateTime, relativeTime } from "@/lib/utils";

export const metadata = { title: "Support" };

export default async function SupportPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const admin = await requireAdmin("support.view");
  const { q } = await searchParams;
  const [imps, found] = await Promise.all([impersonations(), q ? listUsers({ q, pageSize: 10 }) : null]);
  return (
    <>
      <PageHeader icon="person-laptop" title="Support" description="Find a person, see what they see, and fix what they are stuck on. Impersonation is recorded from start to finish." />
      <Card className="mb-6"><CardHeader title="Find someone" />
        <Filters><F label="Name or email"><input name="q" defaultValue={q ?? ""} className={`${inputCls} w-72`} /></F></Filters>
        {found ? (found.rows.length === 0 ? <p className="text-sm text-fg-subtle">Nobody matches.</p> : <ul className="divide-y divide-border-soft text-sm">{found.rows.map((u) => <li key={u.auth_user_id} className="flex flex-wrap items-center justify-between gap-3 py-2"><span><Link href={`/admin/users/${u.auth_user_id}`} className="font-medium hover:underline">{u.display_name}</Link> <span className="text-fg-subtle">{u.email} · {u.orgs?.map((o) => o.name).join(", ") || "no workspace"}</span></span><span className="flex items-center gap-2">{u.status !== "active" ? <Badge tone="danger">{u.status}</Badge> : null}{can(admin, "user.impersonate") && u.status === "active" && !u.is_admin ? <ImpersonateButton userId={u.auth_user_id} name={u.display_name} /> : null}</span></li>)}</ul>) : null}
      </Card>
      <Card><CardHeader title="Impersonation history" description="Every time an administrator viewed Boredroom as someone else." />
        {imps.length === 0 ? <p className="text-sm text-fg-subtle">None yet.</p> : <DataTable caption="Impersonations"><thead><tr><th>Admin</th><th>Viewed as</th><th>Reason</th><th>Started</th><th>Ended</th></tr></thead><tbody>{imps.map((i) => <tr key={i.id}><td className="text-sm">{i.admin_email}</td><td><span className="font-medium">{i.target_name}</span><span className="block text-xs text-fg-subtle">{i.target_email}</span></td><td className="text-sm text-fg-muted">{i.reason}</td><td className="text-sm">{formatDateTime(i.started_at)}</td><td className="text-sm">{i.ended_at ? relativeTime(i.ended_at) : <Badge tone="warning">open</Badge>}</td></tr>)}</tbody></DataTable>}
      </Card>
    </>
  );
}
