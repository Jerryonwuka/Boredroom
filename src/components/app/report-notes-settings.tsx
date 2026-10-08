"use client";

/**
 * Settings → Brenda → "Notes from the team" (owner decision, 8 October 2026: personal assistants, phase 6). Owners and HR
 * decide whether people may add a note to today's end-of-day team report through their own assistant ("Tell Brenda to
 * put this in today's team report: the client moved the deadline to Friday"). A note goes in the report's "Notes from
 * the team" section, from the person ("From Olu via Max: …"), read only by the people who receive the report; each
 * person may add three a day and withdraw one until the report is written. On by default.
 *
 * One switch, saved the moment it moves (PATCH /assistant-items/settings `{ enabled }`), as Messages' switch above it:
 * the choice shows at once and goes back, with the reason, if the save fails; choices made in a burst are saved in
 * order, the last one winning; the page refreshes so Brenda's log lists the change. The status badge reads On, Off or
 * "Needs the daily report" (the switch is disabled while the report is off). Everyone else reads it. Before migration
 * 0043 it is disabled under an info alert. No orange of its own (accent rules).
 */
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { SettingsSection, SettingsGroup, SettingsFooter, SettingsAlert } from "@/components/app/settings-forms";
import { api, isApiFailure } from "@/lib/api-client";
import { ASSISTANT_ITEM_WORDS } from "@/lib/assistant-items";

const W = ASSISTANT_ITEM_WORDS.settings;
const OFFLINE = "Cannot reach the server. Nothing was changed.";

export function ReportNotesSettings({ orgSlug, initial, reportEnabled, canEdit }: {
  orgSlug: string; initial: { ready: boolean; enabled: boolean };
  /** The end-of-day team report is on (Daily team report, above). */ reportEnabled: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const { ready } = initial;
  const [saved, setSaved] = useState(initial.enabled);
  const [seen, setSeen] = useState(initial.enabled);
  const [target, setTarget] = useState<boolean | null>(null);
  if (seen !== initial.enabled) { setSeen(initial.enabled); setSaved(initial.enabled); setTarget(null); }
  const enabled = target ?? saved;
  const [save, setSave] = useState<{ state: "idle" | "saving" | "saved" | "error"; message?: string }>({ state: "idle" });
  const wanted = useRef<boolean | null>(null);
  const queue = useRef(Promise.resolve());
  const locked = !canEdit || !ready || !reportEnabled;

  const change = (value: boolean) => {
    if (locked) return;
    wanted.current = value;
    setTarget(value);
    setSave({ state: "saving" });
    queue.current = queue.current.then(async () => {
      if (wanted.current !== value) return;
      try {
        const r = await api<{ ready: true; enabled: boolean }>(`/api/orgs/${orgSlug}/assistant-items/settings`, { method: "PATCH", body: { enabled: value }, retries: 0 });
        setSaved(r.enabled);
        if (wanted.current !== value) return;
        setTarget(null);
        setSave({ state: "saved" });
        router.refresh(); // Brenda's log on the same page lists the change
      } catch (err) {
        if (wanted.current !== value) return;
        setTarget(null);
        const told = isApiFailure(err) && (err.error.status < 500 || err.error.code === "NOT_READY");
        setSave({ state: "error", message: told ? err.error.message : OFFLINE });
      }
    });
  };

  const on = ready && enabled;
  const badge = !reportEnabled ? { tone: "neutral" as const, label: W.notesBadge.needsReport } : on ? { tone: "success" as const, label: W.notesBadge.on } : { tone: "neutral" as const, label: W.notesBadge.off };
  return (
    <SettingsSection id="report-notes" title={W.notesCard} action={<Badge tone={badge.tone} dot>{badge.label}</Badge>}>
      <SettingsGroup>
        {!ready ? <SettingsAlert tone="info">{W.notReady}</SettingsAlert> : null}
        {/* Why it cannot be changed here, when it cannot, follows the hint (one row, so no hairline splits them). */}
        <Switch className="px-5 py-4" checked={on && reportEnabled} disabled={locked} onChange={(e) => change(e.target.checked)}
          hint={<>{W.notesHint}{ready && !reportEnabled ? " Switch on the daily team report first: notes go in it." : ready && !canEdit ? " Only the organisation owner or HR can change this." : ""}</>}>
          {W.notesSwitch}
        </Switch>
        {save.state === "error" ? <SettingsAlert>{save.message}</SettingsAlert> : null}
        {/* The footer only says what happened, so it shows only then; its live region stays in place for screen readers. */}
        <SettingsFooter className={save.state === "saving" || save.state === "saved" ? undefined : "sr-only"}
          busy={save.state === "saving" ? "Saving…" : undefined} status={save.state === "saved" ? "Saved" : undefined} />
      </SettingsGroup>
    </SettingsSection>
  );
}
