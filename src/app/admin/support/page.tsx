import Link from "next/link";
import { Search } from "lucide-react";
import { requireAdmin, can } from "@/server/admin/auth";
import { impersonations } from "@/server/admin/ops";
import { listUsers } from "@/server/admin/users";
import { PageHeader, Card, CardHeader } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { ImpersonateButton } from "@/components/admin/impersonate";
import { linkCls, subCls, words } from "@/components/admin/fields";
import { formatDateTime, relativeTime } from "@/lib/utils";
import { PageNote, PageNotes } from "@/components/ui/page-notes";

export const metadata = { title: "Support" };

export default async function SupportPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const admin = await requireAdmin("support.view");
  const { q } = await searchParams;
  const [imps, found] = await Promise.all([impersonations(), q ? listUsers({ q, pageSize: 10 }) : null]);
  return (
    <>
      <div>
        <PageHeader title="Support" description="Find a person, see what they see, and fix what they are stuck on." divider />
        <Card className="mb-6">
          <CardHeader title="Find someone" />
          <form role="search" action="/admin/support" className="flex max-w-xl gap-2">
            <label className="field field-adorned min-w-0 flex-1">
              <Search aria-hidden />
              <input name="q" type="text" defaultValue={q ?? ""} placeholder="Name or email" aria-label="Name or email" autoComplete="off" spellCheck={false} />
            </label>
            <Button type="submit" variant="secondary">Find</Button>
          </form>
          {found ? (found.rows.length === 0 ? <p className="mt-4 text-sm font-normal text-secondary">Nobody matches “{q}”.</p> : (
            <ul className="mt-4 grid gap-1">{found.rows.map((u) => (
              <li key={u.auth_user_id} className="flex min-h-12 flex-wrap items-center justify-between gap-3 py-1">
                <span className="min-w-0"><Link href={`/admin/users/${u.auth_user_id}`} className={linkCls}>{u.display_name}</Link><span className={subCls}>{u.email}, {u.orgs?.map((o) => o.name).join(", ") || "no workspace"}</span></span>
                <span className="flex items-center gap-2">
                  {u.status !== "active" ? <Badge tone="danger">{words(u.status)}</Badge> : null}
                  {can(admin, "user.impersonate") && u.status === "active" && !u.is_admin ? <ImpersonateButton userId={u.auth_user_id} name={u.display_name} size="xs" /> : null}
                </span>
              </li>
            ))}</ul>
          )) : null}
        </Card>
        <Card>
          <CardHeader title="Impersonation history" description="Every time an administrator viewed Boredroom as someone else." />
          {imps.length === 0 ? <EmptyState compact icon={Search} tone="neutral" title="Nobody has been impersonated yet" /> : (
            <DataTable caption="Impersonations">
              <thead><tr><th>Admin</th><th>Viewed as</th><th>Reason</th><th>Started</th><th>Ended</th></tr></thead>
              <tbody>{imps.map((i) => (
                <tr key={i.id}>
                  <td>{i.admin_email}</td>
                  <td><span className="block font-medium">{i.target_name}</span><span className={subCls}>{i.target_email}</span></td>
                  <td className="wrap max-w-[280px] text-secondary">{i.reason}</td>
                  <td className="tabular-nums">{formatDateTime(i.started_at)}</td>
                  <td>{i.ended_at ? <span className="text-secondary">{relativeTime(i.ended_at)}</span> : <Badge tone="warning" dot>Open</Badge>}</td>
                </tr>
              ))}</tbody>
            </DataTable>
          )}
        </Card>
      </div>
      <PageNotes>
        <PageNote>Impersonation is recorded from start to finish.</PageNote>
      </PageNotes>
    </>
  );
}
