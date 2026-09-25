import Link from "next/link";
import { requireAdmin } from "@/server/admin/auth";
import { listUsers, type UserListFilter } from "@/server/admin/users";
import { PageHeader } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import { Filters, Pager, CsvLink } from "@/components/admin/actions";
import { F, inputCls } from "@/components/admin/fields";
import { PresenceDot } from "@/components/ui/presence";
import { dateOnly } from "@/lib/format";
import { relativeTime } from "@/lib/utils";
import type { Presence } from "@/lib/presence";

export const metadata = { title: "Users" };

export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin("user.view");
  const sp = await searchParams;
  const status = (["all", "active", "unverified", "invited", "suspended", "banned", "deleted"].includes(sp.status ?? "") ? sp.status : "all") as UserListFilter["status"];
  const r = await listUsers({ q: sp.q, status, org: sp.org, role: sp.role, page: Number(sp.page ?? 1) });
  const tabs = ["all", "active", "unverified", "invited", "suspended", "banned", "deleted"].map((s) => ({ label: s === "all" ? "All" : s === "invited" ? "No workspace" : s[0].toUpperCase() + s.slice(1), href: `/admin/users${s === "all" ? "" : `?status=${s}`}`, value: s }));
  return (
    <>
      <PageHeader icon="people" title="Users" description="Everyone with a Boredroom account, whichever organisation they belong to." actions={<CsvLink href="/api/admin/export?kind=users" />} />
      <Tabs tabs={tabs} value={status} param="status" className="mb-4" label="Account status" />
      <Filters>
        <F label="Search"><input name="q" defaultValue={sp.q ?? ""} placeholder="Name, email, id" className={`${inputCls} w-64`} /></F>
        <F label="Role"><select name="role" defaultValue={sp.role ?? ""} className={inputCls}><option value="">Any role</option><option value="owner">Organisation owner</option><option value="hr">HR</option><option value="manager">Team lead</option><option value="employee">Staff</option></select></F>
        {status !== "all" ? <input type="hidden" name="status" value={status} /> : null}
        {sp.org ? <input type="hidden" name="org" value={sp.org} /> : null}
      </Filters>
      {r.rows.length === 0 ? <EmptyState icon3d="people" title="No users match" /> : (
        <DataTable caption="Users">
          <thead><tr><th>Person</th><th>Organisations</th><th>Account</th><th>Now</th><th>Last seen</th><th>Created</th></tr></thead>
          <tbody>{r.rows.map((u) => (
            <tr key={u.auth_user_id}>
              <td><Link href={`/admin/users/${u.auth_user_id}`} className="flex items-center gap-2 font-semibold hover:underline"><PresenceDot presence={(u.presence as Presence) ?? "offline"} size={8} withRing={false} />{u.display_name}</Link><p className="text-xs text-fg-subtle">{u.email}{u.is_admin ? " · admin" : ""}</p></td>
              <td className="text-sm">{u.orgs?.length ? u.orgs.map((o) => <span key={o.id} className="block"><Link href={`/admin/organisations/${o.id}`} className="hover:underline">{o.name}</Link> <span className="text-fg-subtle">{o.role}{o.plan ? `, ${o.plan}` : ""}</span></span>) : <span className="text-fg-subtle">none</span>}</td>
              <td>{u.status !== "active" ? <Badge tone="danger">{u.status}</Badge> : u.email_verified_at ? <Badge tone="success">active</Badge> : <Badge tone="warning">unverified</Badge>}</td>
              <td className="text-sm">{u.online ? <Badge tone="success" dot>working</Badge> : u.clocked_in ? <Badge tone="info" dot>clocked in</Badge> : <span className="text-fg-subtle">—</span>}</td>
              <td className="text-sm text-fg-muted">{u.last_seen ? relativeTime(u.last_seen) : "never"}</td>
              <td className="text-sm">{dateOnly(u.created_at)}</td>
            </tr>
          ))}</tbody>
        </DataTable>
      )}
      <Pager page={r.page} pageSize={r.pageSize} total={r.total} />
    </>
  );
}
