"use client";

/**
 * Settings → Brenda → "Acting without asking" (owner decision, 8 October 2026: "there should be a setting where we can
 * bypass the permission, you can toggle it on and off, just like the way it is on Claude Code"; owners and HR keep the
 * last word for the workspace). Each person chooses in Settings → Your assistant → Permissions whether their own
 * assistant asks before acting or acts at once on what they ask for in their own chat (with Undo for 10 minutes). This
 * switch lets them choose (on by default); off, everyone's assistant asks, whatever they chose, and their choice comes
 * back when it is on again. Whatever it says, messages to everyone or a whole team, invitations and anything after
 * reading other people's words always ask (the safety floors, services/act-decision).
 *
 * One switch, saved the moment it moves (PATCH /brenda/act-mode/workspace `{ allowed }`), as "Notes from the team": the
 * choice shows at once and goes back, with the reason, if the save fails; choices made in a burst are saved in order,
 * the last one winning; the page refreshes so Brenda's log lists the change and everyone's box shows the new state on
 * their next page. The status badge reads On or Off. Everyone else reads it. Before migration 0045 it is disabled under
 * an info alert. No orange of its own (accent rules): the switch is white when on.
 */
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { SettingsSection, SettingsGroup, SettingsFooter, SettingsAlert } from "@/components/app/settings-forms";
import { api, isApiFailure } from "@/lib/api-client";
import { ACT_WORDS } from "@/lib/act-mode";

const W = ACT_WORDS.workspace;
const OFFLINE = "Cannot reach the server. Nothing was changed.";

export function ActModeWorkspaceSettings({ orgSlug, initial, canEdit }: { orgSlug: string; initial: { ready: boolean; allowed: boolean }; canEdit: boolean }) {
  const router = useRouter();
  const { ready } = initial;
  // What the server last confirmed (the page's value takes over when it brings a new one) and the choice on its way.
  const [saved, setSaved] = useState(initial.allowed);
  const [seen, setSeen] = useState(initial.allowed);
  const [target, setTarget] = useState<boolean | null>(null);
  if (seen !== initial.allowed) { setSeen(initial.allowed); setSaved(initial.allowed); setTarget(null); }
  const allowed = target ?? saved;
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
        const r = await api<{ ready: true; allowed: boolean }>(`/api/orgs/${orgSlug}/brenda/act-mode/workspace`, { method: "PATCH", body: { allowed: value }, retries: 0 });
        setSaved(r.allowed);
        if (wanted.current !== value) return;
        setTarget(null);
        setSave({ state: "saved" });
        router.refresh(); // Brenda's log on the same page lists the change; the person's own box shows the new state
      } catch (err) {
        if (wanted.current !== value) return;
        setTarget(null);
        // A refusal (4xx) and the server's "needs a database update" (503 NOT_READY) in their own words; anything else plainly.
        const told = isApiFailure(err) && (err.error.status < 500 || err.error.code === "NOT_READY");
        setSave({ state: "error", message: told ? err.error.message : OFFLINE });
      }
    });
  };

  const on = ready && allowed;
  return (
    <SettingsSection id="act-mode" title={W.section} description={W.description} action={<Badge tone={on ? "success" : "neutral"} dot>{on ? W.on : W.off}</Badge>}>
      <SettingsGroup>
        {!ready ? <SettingsAlert tone="info">{W.notReady}</SettingsAlert> : null}
        {/* Why it cannot be changed here, when it cannot, follows the hint (one row, so no hairline splits them). */}
        <Switch className="px-5 py-4" checked={on} disabled={locked} onChange={(e) => change(e.target.checked)}
          hint={<>{W.hint}{ready && !canEdit ? ` ${ACT_WORDS.errors.settingsForbidden}` : ""}</>}>
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
