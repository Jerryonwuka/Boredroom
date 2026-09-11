"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Alert } from "@/components/ui/states";
import { api, isApiFailure } from "@/lib/api-client";

function useAction() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run<T>(fn: () => Promise<T>) {
    setPending(true); setError(null);
    try { const r = await fn(); router.refresh(); return r; }
    catch (err) { setError(isApiFailure(err) ? err.error.message : "Cannot reach the server."); return null; }
    finally { setPending(false); }
  }
  return { pending, error, run };
}

/** Team lead controls on a task row: reassign within the team, or remove (archive). */
export function TeamTaskActions({ orgSlug, task, members }: { orgSlug: string; task: { id: string; version: number; status: string; assigneeId: string }; members: { id: string; display_name: string }[] }) {
  const { pending, error, run } = useAction();
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="flex flex-col items-end gap-1">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className="flex items-center gap-1">
        <Select aria-label="Reassign" className="h-9 w-40 py-1 text-sm" value={task.assigneeId} disabled={pending || task.status === "completed"} onChange={(e) => run(() => api(`/api/orgs/${orgSlug}/tasks/${task.id}`, { method: "PATCH", body: { expectedVersion: task.version, assigneeMembershipId: e.target.value } }))}>
          {members.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
        </Select>
        {confirm ? <><Button size="sm" variant="danger" disabled={pending} onClick={() => run(() => api(`/api/orgs/${orgSlug}/tasks/${task.id}`, { method: "PATCH", body: { expectedVersion: task.version, archive: true } }))}>Confirm</Button><Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>Keep</Button></>
          : <Button size="sm" variant="ghost" disabled={pending || task.status === "in_progress"} title={task.status === "in_progress" ? "Stop the running session first" : "Remove this task (history is kept)"} onClick={() => setConfirm(true)}>Remove</Button>}
      </div>
    </div>
  );
}

/** Organisation account controls: make/unmake lead, remove from team, add a person to the team. */
export function TeamMemberActions({ orgSlug, teamId, membershipId, isManager, addCandidates }: { orgSlug: string; teamId: string; membershipId?: string; isManager?: boolean; addCandidates?: { id: string; display_name: string }[] }) {
  const { pending, error, run } = useAction();
  const set = (body: Record<string, unknown>) => run(() => api(`/api/orgs/${orgSlug}/teams/${teamId}/members`, { method: "POST", body }));
  if (addCandidates) {
    return (
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); set({ membershipId: f.get("membershipId"), isManager: f.get("isManager") === "on" }); }}>
        {error ? <Alert tone="danger" className="w-full">{error}</Alert> : null}
        <label className="text-sm"><span className="block text-xs text-fg-subtle">Add to team</span><Select name="membershipId" className="h-10 w-56 py-1 text-sm">{addCandidates.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}</Select></label>
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="isManager" /> as team lead</label>
        <Button type="submit" size="sm" variant="outline" disabled={pending}>Add</Button>
      </form>
    );
  }
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {error ? <span className="text-xs text-danger">{error}</span> : null}
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => set({ membershipId, isManager: !isManager })}>{isManager ? "Make staff" : "Make lead"}</Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => set({ membershipId, isManager: false, remove: true })}>Remove</Button>
    </div>
  );
}
