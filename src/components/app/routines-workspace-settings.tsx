"use client";

/**
 * Settings → Brenda → Routines (owner decision, 8 October 2026: phase 7a, "Brenda keeps the loops closed"; contract
 * J.6): "Only leads can schedule routines that chase other people" (on by default). Everyone can schedule routines about
 * themselves; a routine that chases other people (asking their assistants about stalled tasks) needs lead rights while
 * this is on: team leads for the teams they lead, the owner and HR for any team. Off, anyone may name a team, and each
 * person's own follow-up rules still decide at every run. A routine that loses its rights pauses at its next run and its
 * owner is told.
 *
 * As "Acting without asking": one switch, saved the moment it moves (PATCH /brenda/routines/workspace
 * `{ chaseLeadsOnly }`); the choice shows at once and goes back, with the reason, if the save fails; choices made in a
 * burst are saved in order, the last one winning; the page refreshes so Brenda's log lists the change. The status badge
 * reads "Leads only" or "Anyone". Owners and HR change it; anyone else reads it. Before migration 0046 it is disabled
 * under "This needs a database update first." No orange of its own: the switch is white when on.
 */
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { SettingsAlert, SettingsFooter, SettingsGroup, SettingsSection } from "@/components/app/settings-forms";
import { api, isApiFailure } from "@/lib/api-client";
import { ROUTINE_WORDS } from "@/lib/routines";

const W = ROUTINE_WORDS.workspace;
const OFFLINE = "Cannot reach the server. Nothing was changed.";

export function RoutinesWorkspaceSettings({ orgSlug, initial, canEdit }: { orgSlug: string; initial: { ready: boolean; chaseLeadsOnly: boolean }; canEdit: boolean }) {
  const router = useRouter();
  const { ready } = initial;
  // What the server last confirmed (the page's value takes over when it brings a new one) and the choice on its way.
  const [saved, setSaved] = useState(initial.chaseLeadsOnly);
  const [seen, setSeen] = useState(initial.chaseLeadsOnly);
  const [target, setTarget] = useState<boolean | null>(null);
  if (seen !== initial.chaseLeadsOnly) { setSeen(initial.chaseLeadsOnly); setSaved(initial.chaseLeadsOnly); setTarget(null); }
  const leadsOnly = target ?? saved;
  const [save, setSave] = useState<{ state: "idle" | "saving" | "saved" | "error"; message?: string }>({ state: "idle" });
  const wanted = useRef<boolean | null>(null);
  const queue = useRef(Promise.resolve());
  const locked = !canEdit || !ready;

  const change = (value: boolean) => {
    if (locked) return;
    wanted.current = value;
    setTarget(value);
    setSave({ state: "saving" });
    queue.current = queue.current.then(async () => {
      if (wanted.current !== value) return;
      try {
        const r = await api<{ ready: boolean; chaseLeadsOnly: boolean }>(`/api/orgs/${orgSlug}/brenda/routines/workspace`, { method: "PATCH", body: { chaseLeadsOnly: value }, retries: 0 });
        setSaved(r.chaseLeadsOnly);
        if (wanted.current !== value) return;
        setTarget(null);
        setSave({ state: "saved" });
        router.refresh(); // Brenda's log on the same page lists the change
      } catch (err) {
        if (wanted.current !== value) return;
        setTarget(null);
        // A refusal (4xx) and the server's "needs a database update" (503 NOT_READY) in their own words; anything else plainly.
        const told = isApiFailure(err) && (err.error.status < 500 || err.error.code === "NOT_READY");
        setSave({ state: "error", message: told ? err.error.message : OFFLINE });
      }
    });
  };

  // Before 0046 everyone reads the default (on), and the badge says so.
  const on = ready ? leadsOnly : true;
  return (
    <SettingsSection id="routines" title={W.section} description={W.description} action={<Badge tone="neutral" dot>{on ? W.leadsOnly : W.anyone}</Badge>}>
      <SettingsGroup>
        {!ready ? <SettingsAlert tone="info">{W.notReady}</SettingsAlert> : null}
        <Switch className="px-5 py-4" checked={on} disabled={locked} onChange={(e) => change(e.target.checked)}
          hint={<>{W.hint}{ready && !canEdit ? ` ${ROUTINE_WORDS.errors.settingsForbidden}` : ""}</>}>
          {W.switch}
        </Switch>
        {save.state === "error" ? <SettingsAlert>{save.message}</SettingsAlert> : null}
        {/* The footer only says what happened, so it shows only then; its live region stays in place for screen readers. */}
        <SettingsFooter className={save.state === "saving" || save.state === "saved" ? undefined : "sr-only"}
          busy={save.state === "saving" ? "Saving…" : undefined} status={save.state === "saved" ? "Saved" : undefined} />
      </SettingsGroup>
    </SettingsSection>
  );
}
