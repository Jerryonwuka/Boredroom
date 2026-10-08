"use client";

/**
 * Settings → Brenda → "Messages" (owner decision, 8 October 2026: personal assistants, phase 5). Owners and HR decide
 * whether people may ask their own assistant in a conversation: "@Max …" makes Max read the conversation's recent
 * messages and reply there, under its own name and who asked, keeping anything narrower than what everyone in the
 * conversation can see private to the person who asked. On by default. Mentioning people ("@Ben") is not affected: it
 * always highlights and notifies.
 *
 * One switch, saved the moment it moves (PATCH /mentions/settings `{ enabled }`): the choice shows at once and goes
 * back, with the reason, if the save fails; choices made in a burst are saved in order, the last one winning. Each
 * conversation's "Assistants can reply here" (its details pane) only narrows this. Before migration 0041 the switch is
 * disabled under an info alert (contract A.2). Not tied to the plan: without the AI the built-in helper still answers
 * what it knows (brief, point 7). The status badge reads On or Off; the card carries no orange (accent rules).
 */
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { SettingsSection, SettingsGroup, SettingsFooter, SettingsAlert } from "@/components/app/settings-forms";
import { api, isApiFailure } from "@/lib/api-client";
import { MENTION_WORDS } from "@/lib/mentions";

const OFFLINE = "Cannot reach the server. Nothing was changed.";

export function MentionSettings({ orgSlug, initial, canEdit }: { orgSlug: string; initial: { ready: boolean; enabled: boolean }; canEdit: boolean }) {
  const router = useRouter();
  const { ready } = initial;
  // What the server last confirmed (the page's value takes over when it brings a new one) and the choice on its way.
  const [saved, setSaved] = useState(initial.enabled);
  const [seen, setSeen] = useState(initial.enabled);
  const [target, setTarget] = useState<boolean | null>(null);
  if (seen !== initial.enabled) { setSeen(initial.enabled); setSaved(initial.enabled); setTarget(null); }
  const enabled = target ?? saved;
  const [save, setSave] = useState<{ state: "idle" | "saving" | "saved" | "error"; message?: string }>({ state: "idle" });
  const wanted = useRef<boolean | null>(null);
  const queue = useRef(Promise.resolve());

  const change = (value: boolean) => {
    if (!canEdit || !ready) return;
    wanted.current = value;
    setTarget(value);
    setSave({ state: "saving" });
    queue.current = queue.current.then(async () => {
      if (wanted.current !== value) return;
      try {
        const r = await api<{ ready: true; enabled: boolean }>(`/api/orgs/${orgSlug}/mentions/settings`, { method: "PATCH", body: { enabled: value }, retries: 0 });
        setSaved(r.enabled);
        if (wanted.current !== value) return;
        setTarget(null);
        setSave({ state: "saved" });
        router.refresh(); // the action log on the same page lists the change
      } catch (err) {
        if (wanted.current !== value) return;
        setTarget(null);
        // A refusal (4xx) and the server's "needs a database update" (503 NOT_READY) say why in words meant for the
        // person; any other fault, or no answer at all, says nothing was changed.
        const told = isApiFailure(err) && (err.error.status < 500 || err.error.code === "NOT_READY");
        setSave({ state: "error", message: told ? err.error.message : OFFLINE });
      }
    });
  };

  // Before 0041 nothing reads the switch, so it shows off (and disabled) until the update lands.
  const on = ready && enabled;
  return (
    <SettingsSection id="mentions" title={MENTION_WORDS.settingsTitle} action={<Badge tone={on ? "success" : "neutral"} dot>{on ? "On" : "Off"}</Badge>}>
      <SettingsGroup>
        {!ready ? <SettingsAlert tone="info">{MENTION_WORDS.notReady}</SettingsAlert> : null}
        <Switch className="px-5 py-4" checked={on} disabled={!canEdit || !ready} onChange={(e) => change(e.target.checked)}
          hint={MENTION_WORDS.settingsHint}>
          {MENTION_WORDS.settingsSwitch}
        </Switch>
        {save.state === "error" ? <SettingsAlert>{save.message}</SettingsAlert> : null}
        {/* The footer only says what happened, so it shows only then; its live region stays in place for screen readers. */}
        <SettingsFooter className={save.state === "saving" || save.state === "saved" ? undefined : "sr-only"}
          busy={save.state === "saving" ? "Saving…" : undefined} status={save.state === "saved" ? "Saved" : undefined} />
      </SettingsGroup>
    </SettingsSection>
  );
}
