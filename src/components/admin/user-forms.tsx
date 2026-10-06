"use client";

import { JsonForm } from "@/components/admin/actions";
import { Labelled, inputCls } from "@/components/admin/fields";

/** Changes a person's role in one of their organisations. Lives here so the page (a server component) passes data, not a function. */
export function ChangeRoleForm({ path, memberships }: { path: string; memberships: { id: string; org_name: string; role: string }[] }) {
  return (
    <JsonForm path={path} transform={(d) => ({ action: "change_role", membershipId: String(d.membershipId), role: String(d.role), reason: String(d.reason) })} submitLabel="Change role">
      <Labelled label="Organisation"><select name="membershipId" className={inputCls} required>{memberships.map((m) => <option key={m.id} value={m.id}>{m.org_name} ({m.role})</option>)}</select></Labelled>
      <Labelled label="New role"><select name="role" className={inputCls}><option value="employee">Staff</option><option value="manager">Team lead</option><option value="hr">HR administrator</option><option value="owner">Organisation owner</option></select></Labelled>
      <Labelled label="Reason" hint="written to the audit trail"><input name="reason" className={inputCls} required minLength={3} /></Labelled>
    </JsonForm>
  );
}
