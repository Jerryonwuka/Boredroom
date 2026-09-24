import { requireAdmin } from "@/server/admin/auth";
import { listAdmins } from "@/server/admin/ops";
import { ROLE_LABEL, ROLE_PERMISSIONS, ADMIN_ROLES } from "@/server/admin/permissions";
import { PageHeader, Card, CardHeader } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AdminCreateForm, AdminRowActions } from "@/components/admin/platform-forms";
import { formatDateTime, relativeTime } from "@/lib/utils";

export const metadata = { title: "Admins and permissions" };

export default async function AdminsPage() {
  const admin = await requireAdmin("admin.view");
  const rows = await listAdmins();
  const superAdmin = admin.role === "super_admin";
  return (
    <>
      <PageHeader icon="shield-check" title="Admins and permissions" description="Who can open the Control Center and what each role may do. Roles are sets of permissions, enforced on the server for every page and action." meta={<>Bootstrap emails come from PLATFORM_SUPER_ADMINS on the server</>} />
      <DataTable caption="Administrators" className="mb-6"><thead><tr><th>Administrator</th><th>Role</th><th>Status</th><th>Sessions</th><th>Last login</th><th>Added</th>{superAdmin ? <th></th> : null}</tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id}><td><span className="font-semibold">{r.display_name}</span><span className="block text-xs text-fg-subtle">{r.email}{r.mfa ? " · MFA" : ""}</span></td><td>{ROLE_LABEL[r.role]}</td><td>{r.status === "active" ? <Badge tone="success">active</Badge> : <Badge tone="danger">disabled</Badge>}</td><td className="tabular-nums">{r.sessions}</td><td className="text-sm text-fg-muted">{r.last_login_at ? relativeTime(r.last_login_at) : "never"}</td><td className="text-sm">{formatDateTime(r.created_at)}{r.created_by_email ? <span className="block text-xs text-fg-subtle">by {r.created_by_email}</span> : null}</td>{superAdmin ? <td><AdminRowActions row={r} self={r.auth_user_id === admin.user.authUserId} /></td> : null}</tr>)}</tbody>
      </DataTable>
      {superAdmin ? <Card className="mb-6"><CardHeader title="Add an administrator" description="The person needs a Boredroom account first; then pick their role." /><AdminCreateForm /></Card> : null}
      <Card><CardHeader title="Permission matrix" description="What each role includes." />
        <div className="overflow-x-auto"><table className="data text-xs"><thead><tr><th>Permission</th>{ADMIN_ROLES.map((r) => <th key={r}>{ROLE_LABEL[r].replace(" admin", "")}</th>)}</tr></thead><tbody>{ROLE_PERMISSIONS.super_admin.map((p) => <tr key={p}><td className="font-mono">{p}</td>{ADMIN_ROLES.map((r) => <td key={r} className="text-center">{ROLE_PERMISSIONS[r].includes(p) ? <span className="text-success">●</span> : <span className="text-fg-faint">·</span>}</td>)}</tr>)}</tbody></table></div>
      </Card>
    </>
  );
}
