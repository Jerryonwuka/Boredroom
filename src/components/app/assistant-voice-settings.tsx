"use client";

/**
 * Settings → Your assistant → Voice (owner decision, 7 October 2026: her voice, phase 2). A card of its own under the
 * name and look, because it saves differently: each choice at once, not with a Save button.
 *
 * - When she speaks: three radios ("When I talk to Max", the default; "Always"; "Never"), saved to the person's
 *   assistant profile the moment one is chosen (PUT /brenda/assistant/speak), so the desktop app follows it too. The
 *   choice shows at once and goes back, with the reason, if the save fails; choices made in a burst are saved in order,
 *   the last one winning. An administrator signed in as the person sees them disabled (the server refuses too).
 * - Speed belongs to this browser (lib/assistant-speech/prefs): Slower, Normal or Faster, sent with each reply.
 * No orange of its own: the chosen radio's ring and the segmented dot are the primitives' (accent rules).
 *
 * Natural voice (owner decision, 9 October 2026, contract F.2; owner request, 27 October 2026: "everything ElevenLabs,
 * no local voice at all"): the row after When is the voice itself (assistant-natural-voice: one of the curated natural
 * voices, each with its sample; Alice until the person picks another; saved to the account; the privacy line under it;
 * why she is quiet when she is). There is no computer voice to choose, sample or fall back on any more.
 */
import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Radio } from "@/components/ui/switch";
import { Segmented } from "@/components/ui/segmented";
import { SettingsSection, SettingsRow, SettingsFooter, SettingsAlert, SETTINGS_GROUP } from "@/components/app/settings-forms";
import { useVoicePrefs } from "@/hooks/use-assistant-speech";
import { SPEEDS, type VoiceSpeed } from "@/lib/assistant-speech/prefs";
import { api, isApiFailure } from "@/lib/api-client";
import type { AssistantSpeak } from "@/lib/assistant-look";
import type { NaturalVoiceView } from "@/lib/natural-voices";
import { NATURAL_WORDS } from "@/lib/assistant-speech/natural-words";
import { NaturalVoicePicker, useNaturalVoiceChoice } from "@/components/app/assistant-natural-voice";
import { cn } from "@/lib/utils";

const OFFLINE = "Could not save. Check your connection and try again.";
export function MyVoiceSettings({ orgSlug, name, speak, natural = null, impersonated = false }: {
  orgSlug: string; name: string; speak: AssistantSpeak;
  /** The person's natural voice, read with the page (null: the card reads it itself). */
  natural?: NaturalVoiceView | null;
  impersonated?: boolean;
}) {
  const router = useRouter();
  const id = useId();
  const whenHint = `${id}-when-hint`;
  const prefs = useVoicePrefs();
  // The card has one footer for both saves: each clears the other's "Saved" when it starts (fix review, 9 October 2026).
  const [status, setStatus] = useState<string | null>(null);
  const choice = useNaturalVoiceChoice(orgSlug, natural, impersonated, () => setStatus(null));
  // When she speaks: what the server last confirmed (the page's value takes over when it brings a new one) and the
  // choice on its way, shown at once.
  const [saved, setSaved] = useState(speak);
  const [seen, setSeen] = useState(speak);
  const [target, setTarget] = useState<AssistantSpeak | null>(null);
  if (seen !== speak) { setSeen(speak); setSaved(speak); setTarget(null); }
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const chosen = target ?? saved;
  // One save at a time, in the order chosen; a choice overtaken before its turn is not sent.
  const wanted = useRef<AssistantSpeak | null>(null);
  const queue = useRef(Promise.resolve());

  const choose = (v: AssistantSpeak) => {
    if (impersonated || v === chosen) return;
    wanted.current = v;
    setTarget(v); setBusy(true); setStatus(null); setFailure(null);
    choice.clearStatus();
    queue.current = queue.current.then(async () => {
      if (wanted.current !== v) return;
      try {
        const r = await api<{ speak: AssistantSpeak }>(`/api/orgs/${orgSlug}/brenda/assistant/speak`, { method: "PUT", body: { speak: v }, retries: 0 });
        setSaved(r.speak);
        if (wanted.current !== v) return;
        setTarget(null); setBusy(false); setStatus("Saved");
        router.refresh(); // her chats here and in the drawer read the choice from the page
      } catch (err) {
        if (wanted.current !== v) return;
        setTarget(null); setBusy(false);
        // A refusal (4xx) says why in words meant for the person, and so does the server's "needs a database update"
        // (503 NOT_READY, before migration 0036; integration review, 7 October 2026); any other fault (5xx) or no answer
        // at all is "Could not save".
        const told = isApiFailure(err) && (err.error.status < 500 || err.error.code === "NOT_READY");
        setFailure(told ? err.error.message : OFFLINE);
      }
    });
  };

  const options: { value: AssistantSpeak; label: string; hint: string }[] = [
    { value: "voice", label: `When I talk to ${name}`, hint: "Replies to what you dictate here or say in the desktop app." },
    { value: "always", label: "Always", hint: "Every reply, typed or spoken." },
    { value: "never", label: "Never", hint: "Press Listen on a reply to hear it." },
  ];

  return (
    <SettingsSection id="voice" title="Voice" description={NATURAL_WORDS.section(name)}>
      <div className={cn(SETTINGS_GROUP, "@container")}>
        {/* A settings row as a fieldset: the legend names the group for screen readers, the same words stand in the
            label column for the eye (as the assistant editor's groups). */}
        <fieldset aria-describedby={whenHint} className="grid min-w-0 gap-x-8 gap-y-3 px-5 py-4 @2xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] @2xl:items-start">
          <legend className="sr-only">When {name} speaks</legend>
          <div className="min-w-0">
            <p aria-hidden className="text-sm font-medium text-foreground">When {name} speaks</p>
            <p id={whenHint} className="mt-0.5 text-meta font-normal text-secondary">Saved to your account, so the desktop app follows it too.</p>
          </div>
          <div className="grid min-w-0 gap-3">
            {options.map((o) => (
              <Radio key={o.value} name="assistant-speak" value={o.value} checked={chosen === o.value} disabled={impersonated} onChange={() => choose(o.value)} hint={o.hint}>
                {o.label}
              </Radio>
            ))}
            {impersonated ? <p className="text-meta font-normal text-secondary">Only the person can change this. It stays as it is while you are signed in as them.</p> : null}
          </div>
        </fieldset>

        {/* Which voice (owner decision, 9 October 2026: natural voice), saved to the account: one of the natural voices. */}
        <NaturalVoicePicker orgSlug={orgSlug} name={name} choice={choice} />

        {/* Her ElevenLabs voice's speed (sent with each reply). There is no computer voice to choose any more (owner request,
            27 October 2026: "everything ElevenLabs, no local voice at all"). */}
        <SettingsRow label="Speed" hint={NATURAL_WORDS.speed.hint} labelId="assistant-voice-speed-label" sideBySideAt="container">
          <Segmented aria-label="Speed" name="assistant-voice-speed" value={prefs.speed} onChange={(v) => prefs.setSpeed(v as VoiceSpeed)}
            options={(Object.keys(SPEEDS) as VoiceSpeed[]).map((s) => ({ value: s, label: SPEEDS[s].label }))} />
        </SettingsRow>

        {failure ? <SettingsAlert>{failure}</SettingsAlert> : null}
        {choice.failure ? <SettingsAlert>{choice.failure}</SettingsAlert> : null}
        {/* Never "Saved" beside a failed save: the alerts above say what failed. */}
        <SettingsFooter status={failure || choice.failure ? undefined : choice.status ?? status ?? undefined} busy={busy || choice.busy ? "Saving…" : undefined} />
      </div>
    </SettingsSection>
  );
}
