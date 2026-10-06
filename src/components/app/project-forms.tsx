"use client";

/**
 * Projects, v4: a new project and a new task open as right-hand sheets (the page behind stays put), archiving is one
 * icon that asks first, and the members list is a card of rows with the access level beside each name.
 */
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, InputAdorned, Textarea, Select, Field } from "@/components/ui/input";
import { Alert, EmptyState } from "@/components/ui/states";
import { Badge, label } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/switch";
import { Sheet } from "@/components/ui/sheet";
import { api, isApiFailure } from "@/lib/api-client";
import { DatePicker } from "@/components/ui/date-picker";
import { DurationPicker } from "@/components/ui/duration-picker";
import { ConfirmButton, ConfirmDialog } from "@/components/ui/confirm";
import { Person } from "@/components/ui/person";

function useForm() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  async function submit<T>(fn: () => Promise<T>) {
    setPending(true); setError(null); setFieldErrors({});
    try { return await fn(); }
    catch (err) { if (isApiFailure(err)) { setError(err.error.message); setFieldErrors(err.error.fieldErrors ?? {}); } else setError("Cannot reach the server. Check your connection and try again."); return null; }
    finally { setPending(false); }
  }
  return { pending, error, fieldErrors, submit };
}

/** A new project opens as a sheet, like a new task: the page behind stays put, and the form never pushes the header about. */
export function NewProjectForm({ orgSlug, members }: { orgSlug: string; members: { id: string; display_name: string }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} aria-haspopup="dialog"><Plus aria-hidden />New project</Button>
      {open ? <NewProjectSheet orgSlug={orgSlug} members={members} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function NewProjectSheet({ orgSlug, members, onClose }: { orgSlug: string; members: { id: string; display_name: string }[]; onClose: () => void }) {
  const router = useRouter();
  const formId = useId();
  const { pending, error, fieldErrors, submit } = useForm();
  const [q, setQ] = useState("");
  const shown = members.filter((m) => m.display_name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Sheet open onClose={onClose} dismissible={false} title="New project" description="Tasks live inside projects. You are added as its lead."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form={formId} loading={pending}>{pending ? "Creating…" : "Create project"}</Button></>}>
      <form id={formId} className="grid gap-5" onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const r = await submit(() => api<{ id: string }>(`/api/orgs/${orgSlug}/projects`, { method: "POST", body: { name: f.get("name"), description: String(f.get("description") ?? "").trim() || undefined, requiresDueDate: f.get("requiresDueDate") === "on", requiresEstimate: f.get("requiresEstimate") === "on", memberIds: f.getAll("memberIds") } }));
        if (r) router.push(`/app/${orgSlug}/projects/${r.id}`);
      }}>
        {error && !fieldErrors.name && !fieldErrors.description ? <Alert tone="danger">{error}</Alert> : null}
        <Field label="Name" htmlFor="p-name" error={fieldErrors.name}><Input id="p-name" name="name" required maxLength={160} placeholder="e.g. Website relaunch" autoFocus /></Field>
        <Field label="Description" htmlFor="p-desc" hint="Optional" error={fieldErrors.description}><Textarea id="p-desc" name="description" maxLength={4000} className="min-h-20" /></Field>
        <fieldset className="grid gap-3">
          <legend className="mb-1.5 text-sm font-medium text-foreground">Every task in it needs</legend>
          <Checkbox name="requiresDueDate">A due date</Checkbox>
          <Checkbox name="requiresEstimate">An estimate</Checkbox>
        </fieldset>
        {members.length ? (
          <fieldset className="grid gap-2">
            <legend className="mb-1.5 text-sm font-medium text-foreground">Members <span className="font-normal text-secondary">Optional; add more later</span></legend>
            {members.length > 8 ? <InputAdorned value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a person" aria-label="Find a person" fieldSize="sm" prefix={<Search aria-hidden />} /> : null}
            {/* Every box stays in the form while the list is narrowed, so a search never drops someone already ticked. */}
            <ul className="prompt-scroll max-h-64 space-y-0.5 overflow-y-auto">
              {members.map((m) => (
                <li key={m.id} hidden={!shown.includes(m)}>
                  <label className="flex min-h-10 cursor-pointer items-center gap-3 rounded-lg px-2 text-sm font-medium transition-colors duration-75 hover:bg-fill-1">
                    <input type="checkbox" name="memberIds" value={m.id} />
                    <span className="truncate">{m.display_name}</span>
                  </label>
                </li>
              ))}
              {shown.length === 0 ? <li className="px-2 py-4 text-sm font-normal text-secondary">Nobody matches.</li> : null}
            </ul>
            {fieldErrors.memberIds ? <p role="alert" className="text-meta font-medium text-danger">{fieldErrors.memberIds[0]}</p> : null}
          </fieldset>
        ) : null}
      </form>
    </Sheet>
  );
}

export function NewTaskForm({ orgSlug, projectId, members, self, canAssignOthers, requiresDueDate, requiresEstimate }: { orgSlug: string; projectId: string; members: { id: string; display_name: string }[]; self: string; canAssignOthers: boolean; requiresDueDate: boolean; requiresEstimate: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} aria-haspopup="dialog"><Plus aria-hidden />New task</Button>
      {open ? <NewTaskSheet orgSlug={orgSlug} projectId={projectId} members={members} self={self} canAssignOthers={canAssignOthers} requiresDueDate={requiresDueDate} requiresEstimate={requiresEstimate} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function NewTaskSheet({ orgSlug, projectId, members, self, canAssignOthers, requiresDueDate, requiresEstimate, onClose }: { orgSlug: string; projectId: string; members: { id: string; display_name: string }[]; self: string; canAssignOthers: boolean; requiresDueDate: boolean; requiresEstimate: boolean; onClose: () => void }) {
  const router = useRouter();
  const formId = useId();
  const { pending, error, fieldErrors, submit } = useForm();
  const placed = ["title", "expectedOutput", "assigneeMembershipId", "reviewerMembershipId", "estimateMinutes", "dueAt"].some((k) => fieldErrors[k]?.length);
  return (
    <Sheet open onClose={onClose} dismissible={false} title="New task in this project" description="Say what a finished result looks like; the reviewer accepts against it."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form={formId} loading={pending}>{pending ? "Creating…" : "Create task"}</Button></>}>
      <form id={formId} className="grid gap-4" onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const r = await submit(() => api<{ id: string }>(`/api/orgs/${orgSlug}/tasks`, { method: "POST", body: {
          projectId, title: f.get("title"), expectedOutput: f.get("expectedOutput"), assigneeMembershipId: f.get("assigneeMembershipId") || self, reviewerMembershipId: f.get("reviewerMembershipId") || null,
          category: f.get("category"), priority: f.get("priority"), estimateMinutes: f.get("estimateMinutes") ? Number(f.get("estimateMinutes")) : null,
          dueAt: f.get("dueAt") ? new Date(String(f.get("dueAt"))).toISOString() : null, captureRequirement: f.get("captureRequirement") ?? "none", addToMyDay: false } }));
        if (r) { onClose(); router.refresh(); }
      }}>
        {error && !placed ? <Alert tone="danger">{error}</Alert> : null}
        <Field label="Title" htmlFor="t-title" error={fieldErrors.title}><Input id="t-title" name="title" required maxLength={200} autoFocus /></Field>
        <Field label="Expected output" htmlFor="t-out" hint="What the reviewer will accept" error={fieldErrors.expectedOutput}><Textarea id="t-out" name="expectedOutput" required maxLength={4000} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Assignee" htmlFor="t-assignee" hint={canAssignOthers ? undefined : "You"} error={fieldErrors.assigneeMembershipId}><Select id="t-assignee" name="assigneeMembershipId" defaultValue={self} disabled={!canAssignOthers}>{members.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}</Select></Field>
          <Field label="Reviewer" htmlFor="t-reviewer" hint="Not the assignee" error={fieldErrors.reviewerMembershipId}><Select id="t-reviewer" name="reviewerMembershipId" defaultValue=""><option value="">Choose later</option>{members.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}</Select></Field>
          <Field label="Category" htmlFor="t-cat"><Select id="t-cat" name="category" defaultValue="work"><option value="work">Work</option><option value="meeting">Meeting</option><option value="offline">Offline work</option><option value="admin">Admin</option></Select></Field>
          <Field label="Priority" htmlFor="t-pri"><Select id="t-pri" name="priority" defaultValue="normal"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></Select></Field>
          <Field label="Estimated time" htmlFor="t-est" hint={requiresEstimate ? "Required" : "Optional"} error={fieldErrors.estimateMinutes}><DurationPicker id="t-est" name="estimateMinutes" required={requiresEstimate} /></Field>
          <Field label="Due" htmlFor="t-due" hint={requiresDueDate ? "Required" : "Optional"} error={fieldErrors.dueAt}><DatePicker mode="datetime" id="t-due" name="dueAt" required={requiresDueDate} /></Field>
        </div>
        {canAssignOthers ? <Field label="Screen capture" htmlFor="t-cap" hint="Only applies if policy enables recording"><Select id="t-cap" name="captureRequirement" defaultValue="none"><option value="none">Not requested</option><option value="optional">Optional</option><option value="required">Required on this task</option></Select></Field> : null}
      </form>
    </Sheet>
  );
}

/** Archiving a project is one icon (owner decision, 26 September 2026) that asks first. */
export function ArchiveProjectButton({ orgSlug, projectId }: { orgSlug: string; projectId: string }) {
  const router = useRouter();
  const { pending, error, submit } = useForm();
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="flex flex-col items-end gap-2">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Button size="icon-sm" variant="secondary" aria-label="Archive project" aria-haspopup="dialog" disabled={pending} onClick={() => setConfirm(true)}><Archive aria-hidden /></Button>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} title="Archive this project?" description="No new work sessions can start on its tasks. Everything stays readable." confirmLabel="Archive project" onConfirm={async () => { const r = await submit(() => api(`/api/orgs/${orgSlug}/projects/${projectId}/archive`, { method: "POST" })); if (r) router.refresh(); }} />
    </div>
  );
}

const ACCESS: Record<string, string> = { lead: "Lead", contributor: "Contributor", viewer: "Viewer" };

export function ProjectMembers({ orgSlug, projectId, members, allMembers, canManage }: { orgSlug: string; projectId: string; members: { membership_id: string; display_name: string; access_role: string }[]; allMembers: { id: string; display_name: string }[]; canManage: boolean }) {
  const router = useRouter();
  const { pending, error, submit } = useForm();
  const ids = useId();
  const set = async (membershipId: string, accessRole: string) => { const r = await submit(() => api(`/api/orgs/${orgSlug}/projects/${projectId}/members`, { method: "POST", body: { membershipId, accessRole } })); if (r) router.refresh(); };
  const candidates = allMembers.filter((m) => !members.some((x) => x.membership_id === m.id));
  return (
    <Card>
      {error ? <Alert tone="danger" className="mb-3">{error}</Alert> : null}
      {members.length === 0 ? <EmptyState compact icon3d="people" title="Nobody on this project yet" description={canManage ? "Add the people who work on it below; they see its tasks." : "A project lead adds people here."} /> : (
        <ul className="-mx-2 space-y-0.5">
          {members.map((m) => (
            <li key={m.membership_id} className="flex min-h-14 flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-xl px-2 py-2">
              <span className="flex min-w-0 items-center gap-3"><Person orgSlug={orgSlug} membershipId={m.membership_id} name={m.display_name} size={32} />{canManage ? null : <Badge>{ACCESS[m.access_role] ?? label(m.access_role)}</Badge>}</span>
              {canManage ? <div className="flex items-center gap-1.5">
                <Select aria-label={`Access for ${m.display_name}`} fieldSize="sm" className="w-36" value={m.access_role} disabled={pending} onChange={(e) => set(m.membership_id, e.target.value)}><option value="lead">Lead</option><option value="contributor">Contributor</option><option value="viewer">Viewer</option></Select>
                <ConfirmButton size="sm" variant="ghost" disabled={pending} title={`Remove ${m.display_name} from this project?`} description="They leave the project's members. Tasks they hold, and everything they tracked, stay as they are." confirmLabel="Remove from project" onConfirm={() => set(m.membership_id, "remove")}>Remove</ConfirmButton>
              </div> : null}
            </li>
          ))}
        </ul>
      )}
      {canManage && candidates.length ? (
        <form className="mt-4 flex flex-wrap items-end gap-2 border-t border-border pt-4" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); void set(String(f.get("membershipId")), "contributor"); }}>
          <div className="min-w-0 flex-1 sm:max-w-xs"><Field label="Add a member" htmlFor={`${ids}-add`}><Select id={`${ids}-add`} name="membershipId">{candidates.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}</Select></Field></div>
          <Button type="submit" variant="secondary" loading={pending}>{pending ? "Adding…" : "Add"}</Button>
        </form>
      ) : null}
    </Card>
  );
}
