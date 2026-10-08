"use client";

/**
 * Settings → Your assistant → "Other people's assistants" (owner decision, 8 October 2026: personal assistants, phase 6:
 * assistants talk to each other). Two things only the person decides:
 *
 * - "Let people tag {name} in Messages" (`assistant_profiles.allow_thread_replies`, on by default): in a conversation
 *   with them, someone can write "@Ben's Brenda, where is the deck?" and the person's own assistant answers there, from
 *   their work or by asking them once, as for follow-ups, keeping anything not everyone there can see to the person who
 *   asked. Saved the moment it moves (PUT /assistant-items/preferences), as Messages' switch in Settings → Brenda: the
 *   choice shows at once and goes back, with the reason, if the save fails; a burst is saved in order, the last winning.
 * - "Muted assistants": the colleagues whose assistants the person stopped from bringing them new messages and requests
 *   (from a received card's menu). Each row has the colleague's assistant's face (quiet: it is not theirs), "Olu's Max"
 *   and "Unmute" (PUT /assistant-items/mutes `{ muted: false }`); the row goes once it is undone. Replies to the person's
 *   own messages were never stopped, and what was already delivered stays.
 *
 * Read-only while an administrator is signed in as the person (the server refuses too), and disabled under an info alert
 * before migration 0043. No orange of its own (accent rules): the switch is white when on.
 */
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Alert } from "@/components/ui/states";
import { SettingsSection, SettingsFooter, SettingsAlert, SETTINGS_GROUP } from "@/components/app/settings-forms";
import { AssistantFace } from "@/components/app/follow-up-exchange";
import { api, isApiFailure } from "@/lib/api-client";
import { ASSISTANT_ITEM_WORDS, assistantOf, firstName } from "@/lib/assistant-items";
import type { AssistantProfile } from "@/lib/assistant-look";
import { cn } from "@/lib/utils";

const W = ASSISTANT_ITEM_WORDS.settings;
const OFFLINE = "Cannot reach the server. Nothing was changed.";

export type MutedAssistant = { membershipId: string; name: string; assistant: AssistantProfile; mutedAt: string };

/** A refusal (4xx) and the server's "needs a database update" (503 NOT_READY) in their own words; anything else plainly. */
function failure(err: unknown): string {
  return isApiFailure(err) && (err.error.status < 500 || err.error.code === "NOT_READY") ? err.error.message : OFFLINE;
}

export function AssistantTalkSettings({ orgSlug, name, preferences, mutes, impersonated = false }: {
  orgSlug: string; name: string;
  preferences: { ready: boolean; allowThreadReplies: boolean };
  mutes: { ready: boolean; mutes: MutedAssistant[] };
  impersonated?: boolean;
}) {
  const router = useRouter();
  const ready = preferences.ready;
  const locked = impersonated || !ready;

  // The switch: what the server last confirmed (the page's value takes over when it brings a new one) and the choice on its way.
  const [saved, setSaved] = useState(preferences.allowThreadReplies);
  const [seen, setSeen] = useState(preferences.allowThreadReplies);
  const [target, setTarget] = useState<boolean | null>(null);
  if (seen !== preferences.allowThreadReplies) { setSeen(preferences.allowThreadReplies); setSaved(preferences.allowThreadReplies); setTarget(null); }
  const allow = target ?? saved;
  const [save, setSave] = useState<{ state: "idle" | "saving" | "saved" | "error"; message?: string }>({ state: "idle" });
  const wanted = useRef<boolean | null>(null);
  const queue = useRef(Promise.resolve());

  const change = (value: boolean) => {
    if (locked) return;
    wanted.current = value;
    setTarget(value);
    setSave({ state: "saving" });
    queue.current = queue.current.then(async () => {
      if (wanted.current !== value) return;
      try {
        const r = await api<{ allowThreadReplies: boolean }>(`/api/orgs/${orgSlug}/assistant-items/preferences`, { method: "PUT", body: { allowThreadReplies: value }, retries: 0 });
        setSaved(r.allowThreadReplies);
        if (wanted.current !== value) return;
        setTarget(null);
        setSave({ state: "saved" });
      } catch (err) {
        if (wanted.current !== value) return;
        setTarget(null);
        setSave({ state: "error", message: failure(err) });
      }
    });
  };

  // The muted list: the page's copy, less the rows unmuted here.
  const [unmuted, setUnmuted] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [muteError, setMuteError] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  const rows = mutes.mutes.filter((m) => !unmuted.includes(m.membershipId));

  async function unmute(m: MutedAssistant) {
    if (busy || locked) return;
    setBusy(m.membershipId); setMuteError(null); setSaid("");
    try {
      await api<{ muted: boolean }>(`/api/orgs/${orgSlug}/assistant-items/mutes`, { method: "PUT", body: { senderMembershipId: m.membershipId, muted: false }, retries: 1 });
      setUnmuted((cur) => [...cur, m.membershipId]);
      setSaid(`${assistantOf(firstName(m.name), m.assistant.name)} can reach you again.`);
      router.refresh();
    } catch (err) {
      setMuteError(failure(err));
    } finally {
      setBusy(null);
    }
  }

  const on = ready && allow;
  return (
    <SettingsSection id="assistant-talk" title={W.talkCard} description="What other people's assistants may do with yours">
      <div className={cn(SETTINGS_GROUP, "@container")}>
        {!ready ? <SettingsAlert tone="info">{W.notReady}</SettingsAlert> : null}
        <Switch className="px-5 py-4" checked={on} disabled={locked} onChange={(e) => change(e.target.checked)} hint={W.allowTagsHint(name)}>
          {W.allowTags(name)}
        </Switch>
        {save.state === "error" ? <SettingsAlert>{save.message}</SettingsAlert> : null}
        <div className="px-5 py-4">
          <p id="muted-assistants" className="text-sm font-medium text-foreground">{W.mutedTitle}</p>
          <p className="mt-0.5 text-meta font-normal text-secondary">Their new messages and requests don&apos;t reach you. Replies to your own messages still do.</p>
          {rows.length ? (
            <ul aria-labelledby="muted-assistants" className="mt-3 space-y-1">
              {rows.map((m) => {
                const label = assistantOf(firstName(m.name), m.assistant.name);
                return (
                  <li key={m.membershipId} className="flex min-h-10 items-center gap-2.5">
                    <AssistantFace profile={m.assistant} own={false} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{label}<span className="font-normal text-secondary">, {m.name}</span></span>
                    <Button variant="ghost" size="sm" loading={busy === m.membershipId} disabled={locked || !!busy} aria-label={`${W.unmute} ${label}`} onClick={() => void unmute(m)}>{W.unmute}</Button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-3 text-meta font-normal text-secondary">{W.mutedNone}</p>
          )}
          {muteError ? <Alert tone="danger" className="mt-3">{muteError}</Alert> : null}
          {impersonated ? <p className="mt-3 text-meta font-normal text-secondary">Only the person can change this. It stays as it is while you are signed in as them.</p> : null}
        </div>
        {/* The footer only says what happened, so it shows only then; its live region stays in place for screen readers. */}
        <SettingsFooter className={save.state === "saving" || save.state === "saved" || said ? undefined : "sr-only"}
          busy={save.state === "saving" ? "Saving…" : undefined} status={save.state === "saved" ? "Saved" : said || undefined} />
      </div>
    </SettingsSection>
  );
}
