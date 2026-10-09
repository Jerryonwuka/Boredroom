"use client";

/**
 * Settings → Brenda → Commitments in group chats (owner decision, 8 October 2026: phase 7b, "Brenda keeps the loops
 * closed", workspace commitments; contract H.6): the organisation's master switch, OFF until the owner or HR turns it on.
 *
 * - "Track commitments in group chats": the workspace's assistant notices promises and agreed asks in channels, team
 *   chats and Everyone (never direct messages), marks them "Noted" and asks each person to accept them onto their own
 *   to-dos. Each tracked conversation says so in one line, and whoever runs a conversation can turn it off there.
 *   Turning it on starts from now: nothing said before is read for it.
 * - "Post gentle follow-ups in the thread" (OFF): when a commitment is 2 working days overdue with no progress, the
 *   workspace's assistant also posts a short nudge where it was made; off, only the people involved are told, privately.
 *   Disabled while tracking is off.
 *
 * As the other workspace switches here (routines-workspace-settings): each switch is saved the moment it moves (PATCH
 * /commitments/settings with just that switch), shows at once and goes back with the server's reason if the save fails;
 * changes made in a burst are saved in order, the last one winning; the page refreshes so Brenda's log lists the change.
 * The status badge reads On or Off. The owner and HR change it; anyone else reads it with why. Before migration 0048 it
 * is disabled under "This needs a database update first." No orange of its own: a switch is white when on. Product text:
 * the workspace assistant's name (`workspaceName`), which may still be "Brenda".
 */
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { SettingsAlert, SettingsFooter, SettingsGroup, SettingsSection } from "@/components/app/settings-forms";
import { api, isApiFailure } from "@/lib/api-client";
import { LOOP_WORDS, type CommitmentSettings } from "@/lib/commitments";

const S = LOOP_WORDS.settings;
const OFFLINE = "Cannot reach the server. Nothing was changed.";
type Key = "track" | "threadFollowUps";

export function CommitmentsSettings({ orgSlug, initial, canEdit, workspaceName }: { orgSlug: string; initial: CommitmentSettings; canEdit: boolean; workspaceName: string }) {
  const router = useRouter();
  const { ready } = initial;
  // What the server last confirmed (the page's copy takes over when it brings a new one) and the choices on their way.
  const [saved, setSaved] = useState({ track: initial.track, threadFollowUps: initial.threadFollowUps });
  const [seen, setSeen] = useState(initial);
  const [target, setTarget] = useState<Partial<Record<Key, boolean>>>({});
  if (seen !== initial && (seen.track !== initial.track || seen.threadFollowUps !== initial.threadFollowUps)) {
    setSeen(initial); setSaved({ track: initial.track, threadFollowUps: initial.threadFollowUps }); setTarget({});
  }
  const value = (k: Key) => target[k] ?? saved[k];
  const [save, setSave] = useState<{ state: "idle" | "saving" | "saved" | "error"; message?: string }>({ state: "idle" });
  const wanted = useRef<Partial<Record<Key, boolean>>>({});
  const queue = useRef(Promise.resolve());
  const locked = !canEdit || !ready;

  const change = (k: Key, v: boolean) => {
    if (locked) return;
    wanted.current = { ...wanted.current, [k]: v };
    setTarget((cur) => ({ ...cur, [k]: v }));
    setSave({ state: "saving" });
    queue.current = queue.current.then(async () => {
      if (wanted.current[k] !== v) return;
      try {
        const r = await api<CommitmentSettings>(`/api/orgs/${orgSlug}/commitments/settings`, { method: "PATCH", body: { [k]: v }, retries: 0 });
        setSaved({ track: r.track, threadFollowUps: r.threadFollowUps });
        if (wanted.current[k] !== v) return;
        setTarget((cur) => { const n = { ...cur }; delete n[k]; return n; });
        setSave({ state: "saved" });
        router.refresh(); // Brenda's log on the same page lists the change
      } catch (err) {
        if (wanted.current[k] !== v) return;
        setTarget((cur) => { const n = { ...cur }; delete n[k]; return n; });
        const told = isApiFailure(err) && (err.error.status < 500 || err.error.code === "NOT_READY");
        setSave({ state: "error", message: told ? err.error.message : OFFLINE });
      }
    });
  };

  // Before 0048 everyone reads the defaults (both off), and the badge says so.
  const track = ready ? value("track") : false;
  const followUps = ready ? value("threadFollowUps") : false;
  const readOnly = ready && !canEdit ? ` ${S.forbidden}` : "";
  return (
    <SettingsSection id="commitments" title={S.card} action={<Badge tone="neutral" dot>{track ? S.badge.on : S.badge.off}</Badge>}>
      <SettingsGroup>
        {!ready ? <SettingsAlert tone="info">{S.notReady}</SettingsAlert> : null}
        <Switch className="px-5 py-4" checked={track} disabled={locked} onChange={(e) => change("track", e.target.checked)}
          hint={<>{S.trackHint(workspaceName)}{readOnly}</>}>
          {S.track}
        </Switch>
        <Switch className="px-5 py-4" checked={followUps} disabled={locked || !track} onChange={(e) => change("threadFollowUps", e.target.checked)}
          hint={<>{S.threadFollowUpsHint(workspaceName)}{ready && !track ? " Turn on tracking first." : ""}</>}>
          {S.threadFollowUps}
        </Switch>
        {save.state === "error" ? <SettingsAlert>{save.message}</SettingsAlert> : null}
        {/* The footer only says what happened, so it shows only then; its live region stays in place for screen readers. */}
        <SettingsFooter className={save.state === "saving" || save.state === "saved" ? undefined : "sr-only"}
          busy={save.state === "saving" ? "Saving…" : undefined} status={save.state === "saved" ? "Saved" : undefined} />
      </SettingsGroup>
    </SettingsSection>
  );
}
