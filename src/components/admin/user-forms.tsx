"use client";

import { JsonForm } from "@/components/admin/actions";
import { inputCls } from "@/components/admin/fields";

/** Changes a person's role in one of their organisations. Lives here so the page (a server component) passes data, not a function. */
export function ChangeRoleForm({ path, memberships }: { path: string; memberships: { id: string; org_name: string; role: string }[] }) {
  return (
    <JsonForm path={path} transform={(d) => ({ action: "change_role", membershipId: String(d.membershipId), role: String(d.role), reason: String(d.reason) })} submitLabel="Change role">
      <label className="grid gap-1.5 text-sm font-medium text-fg-muted"><span>Organisation</span><select name="membershipId" className={inputCls} required>{memberships.map((m) => <option key={m.id} value={m.id}>{m.org_name} ({m.role})</option>)}</select></label>
      <label className="grid gap-1.5 text-sm font-medium text-fg-muted"><span>New role</span><select name="role" className={inputCls}><option value="employee">Staff</option><option value="manager">Team lead</option><option value="hr">HR administrator</option><option value="owner">Organisation owner</option></select></label>
      <label className="grid gap-1.5 text-sm font-medium text-fg-muted"><span>Reason</span><input name="reason" className={inputCls} required minLength={3} /></label>
    </JsonForm>
  );
}
