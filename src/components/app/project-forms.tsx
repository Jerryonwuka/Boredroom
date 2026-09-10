"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Select, Field } from "@/components/ui/input";
import { Alert } from "@/components/ui/states";
import { Badge } from "@/components/ui/badge";
import { api, isApiFailure } from "@/lib/api-client";

function useForm() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  async function submit<T>(fn: () => Promise<T>) {
    setPending(true); setError(null); setFieldErrors({});
    try { return await fn(); }
    catch (err) { if (isApiFailure(err)) { setError(err.error.message); setFieldErrors(err.error.fieldErrors ?? {}); } else setError("Cannot reach the server."); return null; }
    finally { setPending(false); }
  }
  return { pending, error, fieldErrors, submit };
}

export function NewProjectForm({ orgSlug, members }: { orgSlug: string; members: { id: string; display_name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { pending, error, fieldErrors, submit } = useForm();
  if (!open) return <Button onClick={() => setOpen(true)}>New project</Button>;
  return (
    <form className="tile grid w-full gap-3 p-4 md:w-[520px]" onSubmit={async (e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      const r = await submit(() => api<{ id: string }>(`/api/orgs/${orgSlug}/projects`, { method: "POST", body: { name: f.get("name"), description: f.get("description") || undefined, requiresDueDate: f.get("requiresDueDate") === "on", requiresEstimate: f.get("requiresEstimate") === "on", memberIds: f.getAll("memberIds") } }));
      if (r) router.push(`/app/${orgSlug}/projects/${r.id}`);
    }}>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Field label="Name" htmlFor="p-name" error={fieldErrors.name}><Input id="p-name" name="name" required maxLength={160} /></Field>
      <Field label="Description" htmlFor="p-desc" hint="optional"><Textarea id="p-desc" name="description" maxLength={4000} /></Field>
      <div className="flex gap-4 text-sm"><label className="flex items-center gap-2"><input type="checkbox" name="requiresDueDate" /> Tasks need a due date</label><label className="flex items-center gap-2"><input type="checkbox" name="requiresEstimate" /> Tasks need an estimate</label></div>
      <Field label="Members" htmlFor="p-members" hint="you are added as lead"><select id="p-members" name="memberIds" multiple className="w-full rounded-xl border border-border-strong bg-inset p-2 text-sm" size={Math.min(6, Math.max(2, members.length))}>{members.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}</select></Field>
      <div className="flex gap-2"><Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create project"}</Button><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button></div>
    </form>
  );
}

export function NewTaskForm({ orgSlug, projectId, members, self, canAssignOthers, requiresDueDate, requiresEstimate }: { orgSlug: string; projectId: string; members: { id: string; display_name: string }[]; self: string; canAssignOthers: boolean; requiresDueDate: boolean; requiresEstimate: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { pending, error, fieldErrors, submit } = useForm();
  if (!open) return <Button onClick={() => setOpen(true)}>New task</Button>;
  return (
    <form className="tile grid w-full gap-3 p-4 md:w-[640px]" onSubmit={async (e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      const r = await submit(() => api<{ id: string }>(`/api/orgs/${orgSlug}/tasks`, { method: "POST", body: {
        projectId, title: f.get("title"), expectedOutput: f.get("expectedOutput"), assigneeMembershipId: f.get("assigneeMembershipId") || self, reviewerMembershipId: f.get("reviewerMembershipId") || null,
        category: f.get("category"), priority: f.get("priority"), estimateMinutes: f.get("estimateMinutes") ? Number(f.get("estimateMinutes")) : null,
        dueAt: f.get("dueAt") ? new Date(String(f.get("dueAt"))).toISOString() : null, captureRequirement: f.get("captureRequirement") ?? "none", addToMyDay: false } }));
      if (r) { setOpen(false); router.push(`/app/${orgSlug}/tasks/${r.id}`); }
    }}>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Field label="Title" htmlFor="t-title" error={fieldErrors.title}><Input id="t-title" name="title" required maxLength={200} /></Field>
      <Field label="Expected output" htmlFor="t-out" hint="what the reviewer will accept" error={fieldErrors.expectedOutput}><Textarea id="t-out" name="expectedOutput" required maxLength={4000} /></Field>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Assignee" htmlFor="t-assignee" error={fieldErrors.assigneeMembershipId}><Select id="t-assignee" name="assigneeMembershipId" defaultValue={self} disabled={!canAssignOthers}>{members.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}</Select></Field>
        <Field label="Reviewer" htmlFor="t-reviewer" hint="must differ from assignee" error={fieldErrors.reviewerMembershipId}><Select id="t-reviewer" name="reviewerMembershipId" defaultValue=""><option value="">Choose later</option>{members.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}</Select></Field>
        <Field label="Category" htmlFor="t-cat"><Select id="t-cat" name="category" defaultValue="work"><option value="work">Work</option><option value="meeting">Meeting</option><option value="offline">Offline work</option><option value="admin">Admin</option></Select></Field>
        <Field label="Priority" htmlFor="t-pri"><Select id="t-pri" name="priority" defaultValue="normal"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></Select></Field>
        <Field label="Estimate (minutes)" htmlFor="t-est" hint={requiresEstimate ? "required" : "optional"} error={fieldErrors.estimateMinutes}><Input id="t-est" name="estimateMinutes" type="number" min={1} required={requiresEstimate} /></Field>
        <Field label="Due" htmlFor="t-due" hint={requiresDueDate ? "required" : "optional"} error={fieldErrors.dueAt}><Input id="t-due" name="dueAt" type="datetime-local" required={requiresDueDate} /></Field>
        {canAssignOthers ? <Field label="Screen capture" htmlFor="t-cap" hint="only applies if policy enables recording"><Select id="t-cap" name="captureRequirement" defaultValue="none"><option value="none">Not requested</option><option value="optional">Optional</option><option value="required">Required on this task</option></Select></Field> : null}
      </div>
      <div className="flex gap-2"><Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create task"}</Button><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button></div>
    </form>
  );
}

export function ArchiveProjectButton({ orgSlug, projectId }: { orgSlug: string; projectId: string }) {
  const router = useRouter();
  const { pending, error, submit } = useForm();
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="flex flex-col items-end gap-2">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {confirm ? <div className="flex gap-2"><Button variant="danger" size="sm" disabled={pending} onClick={async () => { const r = await submit(() => api(`/api/orgs/${orgSlug}/projects/${projectId}/archive`, { method: "POST" })); if (r) router.refresh(); }}>Confirm archive</Button><Button variant="ghost" size="sm" onClick={() => setConfirm(false)}>Cancel</Button></div>
        : <Button variant="subtle" size="sm" onClick={() => setConfirm(true)}>Archive project</Button>}
    </div>
  );
}

export function ProjectMembers({ orgSlug, projectId, members, allMembers, canManage }: { orgSlug: string; projectId: string; members: { membership_id: string; display_name: string; access_role: string }[]; allMembers: { id: string; display_name: string }[]; canManage: boolean }) {
  const router = useRouter();
  const { pending, error, submit } = useForm();
  const set = async (membershipId: string, accessRole: string) => { const r = await submit(() => api(`/api/orgs/${orgSlug}/projects/${projectId}/members`, { method: "POST", body: { membershipId, accessRole } })); if (r) router.refresh(); };
  const candidates = allMembers.filter((m) => !members.some((x) => x.membership_id === m.id));
  return (
    <div className="tile p-4">
      {error ? <Alert tone="danger" className="mb-3">{error}</Alert> : null}
      <ul className="divide-y divide-border">
        {members.map((m) => (
          <li key={m.membership_id} className="flex items-center justify-between py-2">
            <span>{m.display_name} <Badge className="ml-2">{m.access_role}</Badge></span>
            {canManage ? <div className="flex gap-1">
              <Select aria-label={`Access for ${m.display_name}`} className="h-9 w-40 py-1 text-sm" value={m.access_role} disabled={pending} onChange={(e) => set(m.membership_id, e.target.value)}><option value="lead">Lead</option><option value="contributor">Contributor</option><option value="viewer">Viewer</option></Select>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => set(m.membership_id, "remove")}>Remove</Button>
            </div> : null}
          </li>
        ))}
      </ul>
      {canManage && candidates.length ? (
        <form className="mt-3 flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); set(String(f.get("membershipId")), "contributor"); }}>
          <Field label="Add member" htmlFor="pm-add"><Select id="pm-add" name="membershipId">{candidates.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}</Select></Field>
          <Button type="submit" size="md" variant="outline" disabled={pending}>Add</Button>
        </form>
      ) : null}
    </div>
  );
}
