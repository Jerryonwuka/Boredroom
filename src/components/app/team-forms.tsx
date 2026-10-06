"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Ellipsis, UserMinus, UserRoundCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { Field, Select } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/switch";
import { Alert } from "@/components/ui/states";
import { api, isApiFailure } from "@/lib/api-client";

function useAction() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run<T>(fn: () => Promise<T>) {
    setPending(true); setError(null);
    try { const r = await fn(); router.refresh(); return r; }
    catch (err) { setError(isApiFailure(err) ? err.error.message : "Cannot reach the server. Check your connection and try again."); return null; }
    finally { setPending(false); }
  }
  return { pending, error, run };
}

/**
 * Organisation account controls (v4): on a member's card, a ghost "…" that opens a menu (make lead or staff, remove
 * from the team, which asks first); with `addCandidates`, the form that adds a person to the team.
 */
export function TeamMemberActions({ orgSlug, teamId, membershipId, name, isManager, addCandidates }: { orgSlug: string; teamId: string; membershipId?: string; name?: string; isManager?: boolean; addCandidates?: { id: string; display_name: string }[] }) {
  const { pending, error, run } = useAction();
  const [confirm, setConfirm] = useState(false);
  const ids = useId();
  const set = (body: Record<string, unknown>) => run(() => api(`/api/orgs/${orgSlug}/teams/${teamId}/members`, { method: "POST", body }));
  if (addCandidates) {
    return (
      <form className="flex flex-wrap items-end gap-x-4 gap-y-3" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); void set({ membershipId: f.get("membershipId"), isManager: f.get("isManager") === "on" }); }}>
        {error ? <Alert tone="danger" className="w-full">{error}</Alert> : null}
        <div className="min-w-0 flex-1 sm:max-w-xs"><Field label="Add to team" htmlFor={`${ids}-add`}><Select id={`${ids}-add`} name="membershipId">{addCandidates.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}</Select></Field></div>
        <Checkbox name="isManager" className="min-h-9 items-center">As team lead</Checkbox>
        <Button type="submit" variant="secondary" loading={pending}>{pending ? "Adding…" : "Add"}</Button>
      </form>
    );
  }
  const who = name ?? "this person";
  return (
    <div className="flex flex-col items-end gap-1">
      <Menu align="end" label={`Actions for ${who}`} trigger={<IconButton aria-label={`Actions for ${who}`} disabled={pending}><Ellipsis aria-hidden /></IconButton>}>
        <MenuItem icon={<UserRoundCog />} onSelect={() => void set({ membershipId, isManager: !isManager })}>{isManager ? "Make staff" : "Make team lead"}</MenuItem>
        <MenuSeparator />
        <MenuItem icon={<UserMinus />} tone="danger" onSelect={() => setConfirm(true)}>Remove from team</MenuItem>
      </Menu>
      {pending ? <p role="status" className="text-meta text-secondary">Saving…</p> : null}
      {error ? <p role="alert" className="max-w-xs text-right text-meta font-medium text-danger">{error}</p> : null}
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} title={`Remove ${who} from the team?`} description="They leave this team and its board. Tasks they hold stay theirs, and their history is kept." confirmLabel="Remove from team" onConfirm={() => set({ membershipId, isManager: false, remove: true })} />
    </div>
  );
}
