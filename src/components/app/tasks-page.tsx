"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Play, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea, Field } from "@/components/ui/input";
import { Alert } from "@/components/ui/states";
import { Expand, Presence } from "@/components/ui/motion";
import { api, isApiFailure } from "@/lib/api-client";

type Person = { id: string; display_name: string; team_name: string | null; group: "team" | "organisation" };

/** A team lead creates a task and hands it to someone on their team (or keeps it). The assignee is notified. */
export function NewAssignedTask({ orgSlug, people, self, selfName }: { orgSlug: string; people: Person[]; self: string; selfName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [done, setDone] = useState<string | null>(null);
  const others = people.filter((p) => p.id !== self);
  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => { setOpen((o) => !o); setDone(null); }} aria-expanded={open} aria-controls="new-task-form"><Plus className="size-4" aria-hidden />{open ? "Close" : "New task"}</Button>
        <Presence show={!!done && !open}><p className="text-sm text-success">{done}</p></Presence>
      </div>
      <Expand show={open} id="new-task-form">
        <form className="tile mt-3 grid gap-3 p-4 md:grid-cols-2" onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const f = new FormData(form);
          setPending(true); setError(null); setFieldErrors({});
          try {
            const assignee = String(f.get("assigneeMembershipId") || self);
            await api(`/api/orgs/${orgSlug}/todos`, { method: "POST", body: {
              title: f.get("title"), description: String(f.get("description") ?? "").trim() || null, assigneeMembershipId: assignee,
              dueAt: f.get("dueAt") ? new Date(String(f.get("dueAt"))).toISOString() : null,
              estimateMinutes: f.get("estimateMinutes") ? Number(f.get("estimateMinutes")) : null, priority: f.get("priority") ?? "normal" } });
            const who = assignee === self ? "you" : (people.find((p) => p.id === assignee)?.display_name ?? "them");
            setDone(`Task created and assigned to ${who}.${assignee === self ? "" : " They have been notified."}`);
            form.reset(); setOpen(false); router.refresh();
          } catch (err) {
            if (isApiFailure(err)) { setError(err.error.message); setFieldErrors(err.error.fieldErrors ?? {}); } else setError("Cannot reach the server.");
          } finally { setPending(false); }
        }}>
          {error ? <Alert tone="danger" className="md:col-span-2">{error}</Alert> : null}
          <div className="md:col-span-2"><Field label="What needs doing" htmlFor="nt-title" error={fieldErrors.title}><Input id="nt-title" name="title" required maxLength={200} placeholder="e.g. Redo the homepage banner" autoFocus /></Field></div>
          <div className="md:col-span-2"><Field label="Details" htmlFor="nt-desc" hint="optional: what a finished result looks like" error={fieldErrors.description}><Textarea id="nt-desc" name="description" maxLength={4000} className="min-h-20" /></Field></div>
          <Field label="Assign to" htmlFor="nt-who" error={fieldErrors.assigneeMembershipId}>
            <Select id="nt-who" name="assigneeMembershipId" defaultValue={others.find((p) => p.group === "team")?.id ?? self}>
              <optgroup label="Your team">
                {others.filter((p) => p.group === "team").map((p) => <option key={p.id} value={p.id}>{p.display_name}{p.team_name ? ` (${p.team_name})` : ""}</option>)}
                <option value={self}>{selfName} (me)</option>
              </optgroup>
              {others.some((p) => p.group === "organisation") ? <optgroup label="Others in the organisation">{others.filter((p) => p.group === "organisation").map((p) => <option key={p.id} value={p.id}>{p.display_name}{p.team_name ? ` (${p.team_name})` : ""}</option>)}</optgroup> : null}
            </Select>
          </Field>
          <Field label="Priority" htmlFor="nt-pri"><Select id="nt-pri" name="priority" defaultValue="normal"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></Select></Field>
          <Field label="Due" htmlFor="nt-due" hint="optional" error={fieldErrors.dueAt}><Input id="nt-due" name="dueAt" type="datetime-local" /></Field>
          <Field label="Estimate (minutes)" htmlFor="nt-est" hint="optional" error={fieldErrors.estimateMinutes}><Input id="nt-est" name="estimateMinutes" type="number" min={1} /></Field>
          <div className="flex gap-2 md:col-span-2"><Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create and assign"}</Button><Button variant="ghost" type="button" onClick={() => setOpen(false)}>Cancel</Button></div>
        </form>
      </Expand>
    </div>
  );
}

/** Organisation accounts do not run timers; they finish a task handed to them with one press. */
export function MarkDone({ orgSlug, taskId }: { orgSlug: string; taskId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" variant="outline" disabled={pending} onClick={async () => { setPending(true); setError(null); try { await api(`/api/orgs/${orgSlug}/tasks/${taskId}/complete`, { method: "POST", body: { note: "" } }); router.refresh(); } catch (err) { setError(isApiFailure(err) ? err.error.message : "Cannot reach the server."); } finally { setPending(false); } }}>{pending ? "Saving…" : "Mark done"}</Button>
      {error ? <p role="alert" className="max-w-xs text-right text-xs text-danger">{error}</p> : null}
    </div>
  );
}

/** Staff pick a task up: the timer starts on it and My Day opens with the clock running. */
export function PickUpTask({ orgSlug, taskId, running, anyRunning }: { orgSlug: string; taskId: string; running: boolean; anyRunning: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (running) return <Link href={`/app/${orgSlug}/my-day`} className="text-sm underline">Open the clock</Link>;
  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" disabled={pending} title={anyRunning ? "Your timer is on another task; this will switch it here" : undefined} onClick={async () => {
        setPending(true); setError(null);
        try {
          if (anyRunning) {
            const cur = await api<{ session: { id: string; version: number } | null }>(`/api/orgs/${orgSlug}/sessions/current`);
            if (cur.session) await api(`/api/orgs/${orgSlug}/sessions/${cur.session.id}/switch`, { method: "POST", body: { expectedVersion: cur.session.version, nextTaskId: taskId, captureMode: "none" } });
            else await api(`/api/orgs/${orgSlug}/sessions/start`, { method: "POST", body: { taskId, captureMode: "none" } });
          } else {
            await api(`/api/orgs/${orgSlug}/sessions/start`, { method: "POST", body: { taskId, captureMode: "none" } });
          }
          router.push(`/app/${orgSlug}/my-day`);
        } catch (err) { setError(isApiFailure(err) ? err.error.message : "Cannot reach the server."); setPending(false); }
      }}><Play className="size-3.5" aria-hidden />{pending ? "Starting…" : anyRunning ? "Switch to this" : "Start"}</Button>
      {error ? <p role="alert" className="max-w-xs text-right text-xs text-danger">{error}</p> : null}
    </div>
  );
}
