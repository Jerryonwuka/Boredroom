import Link from "next/link";
import { UsersRound } from "lucide-react";
import { requireAdmin } from "@/server/admin/auth";
import { listUsers, type UserListFilter } from "@/server/admin/users";
import { PageHeader } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import { StatusDot } from "@/components/ui/status-dot";
import { PresenceDot } from "@/components/ui/presence";
import { Filters, Pager, CsvLink } from "@/components/admin/actions";
import { F, ORG_ROLE, filterCls, linkCls, subCls, words } from "@/components/admin/fields";
import { dateOnly } from "@/lib/format";
import { relativeTime, cn } from "@/lib/utils";
import type { Presence } from "@/lib/presence";

export const metadata = { title: "Users" };
const STATUSES = ["all", "active", "unverified", "invited", "suspended", "banned", "deleted"] as const;

export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin("user.view");
  const sp = await searchParams;
  const status = ((STATUSES as readonly string[]).includes(sp.status ?? "") ? sp.status : "all") as UserListFilter["status"];
  const r = await listUsers({ q: sp.q, status, org: sp.org, role: sp.role, page: Number(sp.page ?? 1) });
  const tabs = STATUSES.map((s) => ({ label: s === "all" ? "All" : s === "invited" ? "No workspace" : words(s), href: `/admin/users${s === "all" ? "" : `?status=${s}`}`, value: s }));
  return (
    <>
      <PageHeader title="Users" description="Everyone with a Boredroom account, whichever organisation they belong to." actions={<CsvLink href="/api/admin/export?kind=users" />}
        tabs={tabs} tabValue={status} tabParam="status" tabsLabel="Account status" />
      <Filters>
        <F label="Search"><input name="q" defaultValue={sp.q ?? ""} placeholder="Name, email, id" className={cn(filterCls, "w-56")} /></F>
        <F label="Role"><select name="role" defaultValue={sp.role ?? ""} className={filterCls}><option value="">Any role</option><option value="owner">Organisation owner</option><option value="hr">HR</option><option value="manager">Team lead</option><option value="employee">Staff</option></select></F>
        {status !== "all" ? <input type="hidden" name="status" value={status} /> : null}
        {sp.org ? <input type="hidden" name="org" value={sp.org} /> : null}
      </Filters>
      {r.rows.length === 0 ? <EmptyState icon={UsersRound} title="No users match" description="Change the filters or the search." /> : (
        <DataTable caption="Users">
          <thead><tr><th>Person</th><th>Organisations</th><th>Account</th><th>Now</th><th>Last seen</th><th>Created</th></tr></thead>
          <tbody>{r.rows.map((u) => (
            <tr key={u.auth_user_id}>
              <td>
                <span className="flex items-center gap-2"><PresenceDot presence={(u.presence as Presence) ?? "offline"} size={8} withRing={false} /><Link href={`/admin/users/${u.auth_user_id}`} className={linkCls}>{u.display_name}</Link>{u.is_admin ? <Badge size="sm">Admin</Badge> : null}</span>
                <span className={subCls}>{u.email}</span>
              </td>
              <td>{u.orgs?.length ? u.orgs.map((o) => <span key={o.id} className="block"><Link href={`/admin/organisations/${o.id}`} className={linkCls}>{o.name}</Link> <span className="text-meta font-normal text-secondary">{ORG_ROLE[o.role] ?? o.role}{o.plan ? `, ${o.plan}` : ""}</span></span>) : <span className="text-secondary">None</span>}</td>
              <td>{u.status !== "active" ? <Badge tone="danger">{words(u.status)}</Badge> : u.email_verified_at ? <Badge tone="success">Active</Badge> : <Badge tone="warning">Unverified</Badge>}</td>
              <td>{u.online ? <Badge><StatusDot tone="live" pulse={false} size={6} />Working</Badge> : u.clocked_in ? <Badge tone="info" dot>Clocked in</Badge> : <span className="text-secondary">Not working</span>}</td>
              <td className="text-secondary">{u.last_seen ? relativeTime(u.last_seen) : "Never"}</td>
              <td className="tabular-nums">{dateOnly(u.created_at)}</td>
            </tr>
          ))}</tbody>
        </DataTable>
      )}
      <Pager page={r.page} pageSize={r.pageSize} total={r.total} />
    </>
  );
}
