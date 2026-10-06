import { Check } from "lucide-react";
import { requireAdmin } from "@/server/admin/auth";
import { listAdmins } from "@/server/admin/ops";
import { ROLE_LABEL, ROLE_PERMISSIONS, ADMIN_ROLES } from "@/server/admin/permissions";
import { PageHeader, Card, CardHeader } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { SheetButton } from "@/components/admin/actions";
import { AdminCreateForm, AdminRowActions } from "@/components/admin/platform-forms";
import { subCls } from "@/components/admin/fields";
import { formatDateTime, relativeTime } from "@/lib/utils";

export const metadata = { title: "Admins and permissions" };

export default async function AdminsPage() {
  const admin = await requireAdmin("admin.view");
  const rows = await listAdmins();
  const superAdmin = admin.role === "super_admin";
  return (
    <>
      <PageHeader title="Admins and permissions" description="Who can open the Control Center and what each role may do. Roles are sets of permissions, enforced on the server for every page and action." meta="Bootstrap emails come from PLATFORM_SUPER_ADMINS on the server"
        actions={superAdmin ? (
          <SheetButton label="Add administrator" icon="plus" variant="accent" title="Add an administrator" description="The person needs a Boredroom account first; then pick their role.">
            <AdminCreateForm />
          </SheetButton>
        ) : null} />
      <DataTable caption="Administrators" className="mb-10">
        <thead><tr><th>Administrator</th><th>Role</th><th>Status</th><th>Sessions</th><th>Last sign-in</th><th>Added</th>{superAdmin ? <th><span className="sr-only">Actions</span></th> : null}</tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.id}>
            <td><span className="flex items-center gap-2 font-medium">{r.display_name}{r.mfa ? <Badge size="sm">MFA</Badge> : null}</span><span className={subCls}>{r.email}</span></td>
            <td>{ROLE_LABEL[r.role]}</td>
            <td>{r.status === "active" ? <Badge tone="success">Active</Badge> : <Badge tone="danger">Disabled</Badge>}</td>
            <td className="tabular-nums">{r.sessions}</td>
            <td className="text-secondary">{r.last_login_at ? relativeTime(r.last_login_at) : "Never"}</td>
            <td className="tabular-nums">{formatDateTime(r.created_at)}{r.created_by_email ? <span className={subCls}>by {r.created_by_email}</span> : null}</td>
            {superAdmin ? <td><AdminRowActions row={r} self={r.auth_user_id === admin.user.authUserId} /></td> : null}
          </tr>
        ))}</tbody>
      </DataTable>
      <Card>
        <CardHeader title="Permission matrix" description="What each role includes." />
        <DataTable caption="Permissions by role">
          <thead><tr><th>Permission</th>{ADMIN_ROLES.map((r) => <th key={r} className="text-center">{ROLE_LABEL[r].replace(" admin", "")}</th>)}</tr></thead>
          <tbody>{ROLE_PERMISSIONS.super_admin.map((p) => (
            <tr key={p}>
              <td className="font-mono text-xs">{p}</td>
              {ADMIN_ROLES.map((r) => <td key={r} className="text-center">{ROLE_PERMISSIONS[r].includes(p) ? <span role="img" aria-label="Included" className="inline-flex"><Check className="size-4 text-success" aria-hidden /></span> : <span role="img" aria-label="Not included" className="text-faint">·</span>}</td>)}
            </tr>
          ))}</tbody>
        </DataTable>
      </Card>
    </>
  );
}
