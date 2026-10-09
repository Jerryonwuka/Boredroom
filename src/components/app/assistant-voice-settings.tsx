"use client";

/**
 * Settings → Your assistant → Voice (owner decision, 7 October 2026: her voice, phase 2). A card of its own under the
 * name and look, because it saves differently: each choice at once, not with a Save button.
 *
 * - When she speaks: three radios ("When I talk to Max", the default; "Always"; "Never"), saved to the person's
 *   assistant profile the moment one is chosen (PUT /brenda/assistant/speak), so the desktop app follows it too. The
 *   choice shows at once and goes back, with the reason, if the save fails; choices made in a burst are saved in order,
 *   the last one winning. An administrator signed in as the person sees them disabled (the server refuses too).
 * - Voice and speed belong to this browser on this computer (voices differ by computer; lib/assistant-speech/prefs):
 *   a select of the computer's own voices (Automatic first, naming the voice it uses; then the page language's voices;
 *   then the rest with their language) and Slower, Normal or Faster. Only on-device voices are ever listed or used:
 *   network voices send the words to a speech service. A browser with none says so here, in place of both rows; the
 *   When row stays, since it steers the desktop app too.
 * - "Play a sample" says "Hi, I'm Max." in the chosen voice and speed; while it plays it reads "Stop". Leaving the
 *   page stops it.
 * No orange of its own: the chosen radio's ring and the segmented dot are the primitives' (accent rules).
 *
 * Natural voice (owner decision, 9 October 2026: natural voice (ElevenLabs), contract F.2): the first row after When is
 * now the voice itself (assistant-natural-voice: Computer voice, the default, or one of the curated natural voices, each
 * with its sample; saved to the account; the privacy line under it; why the computer voice speaks instead when it does).
 * This browser's voice select becomes "Computer voice" (what speaks when the natural voice can't), and Speed applies to
 * both. The footer's sample stays the computer voice's.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Square, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Radio } from "@/components/ui/switch";
import { Select } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { SettingsSection, SettingsRow, SettingsFooter, SettingsAlert, SETTINGS_GROUP } from "@/components/app/settings-forms";
import { useAutoVoice, useSpeech, useVoicePrefs } from "@/hooks/use-assistant-speech";
import { pageLangs, speech } from "@/lib/assistant-speech/controller";
import { SPEEDS, type VoiceSpeed } from "@/lib/assistant-speech/prefs";
import type { LocalVoice } from "@/lib/assistant-speech/voices";
import { api, isApiFailure } from "@/lib/api-client";
import type { AssistantSpeak } from "@/lib/assistant-look";
import type { NaturalVoiceView } from "@/lib/natural-voices";
import { NATURAL_WORDS } from "@/lib/assistant-speech/natural-words";
import { NaturalVoicePicker, useNaturalVoiceChoice } from "@/components/app/assistant-natural-voice";
import { cn } from "@/lib/utils";

const OFFLINE = "Could not save. Check your connection and try again.";
const SAMPLE_ID = "sample";

/**
 * The language Automatic speaks (the controller's `pageLangs`: the browser's languages the page is written in, then the
 * page's own), and its name for the first group of voices, so the group and Automatic agree (a German browser on this
 * English page gets English voices first, as Automatic does; integration review, 7 October 2026).
 */
function pageLanguage(): { base: string; label: string } {
  const lang = (pageLangs()[0] || "en").replace(/_/g, "-");
  const base = lang.split("-")[0].toLowerCase();
  let label = "Your language's";
  try { label = new Intl.DisplayNames(["en"], { type: "language" }).of(base) ?? label; } catch { /* no DisplayNames: the plain words */ }
  return { base, label };
}
const baseOf = (lang: string) => lang.replace(/_/g, "-").split("-")[0].toLowerCase();
/** A voice of another language, with its language: Chrome's names already end in one ("Eddy (French (France))"). */
const withLang = (v: LocalVoice) => (!v.lang || /\)\s*$/.test(v.name) ? v.name : `${v.name} (${v.lang})`);

export function MyVoiceSettings({ orgSlug, name, speak, natural = null, impersonated = false }: {
  orgSlug: string; name: string; speak: AssistantSpeak;
  /** The person's natural voice, read with the page (null: the card reads it itself). */
  natural?: NaturalVoiceView | null;
  impersonated?: boolean;
}) {
  const router = useRouter();
  const id = useId();
  const whenHint = `${id}-when-hint`;
  const voice = useSpeech();
  const prefs = useVoicePrefs();
  const auto = useAutoVoice();
  // The card has one footer for both saves: each clears the other's "Saved" when it starts (fix review, 9 October 2026).
  const [status, setStatus] = useState<string | null>(null);
  const choice = useNaturalVoiceChoice(orgSlug, natural, impersonated, () => setStatus(null));
  // A natural voice is chosen: the computer voice is what speaks when it can't.
  const naturalChosen = choice.chosen !== null;

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

  // The sample, in the chosen voice and speed. Leaving the page stops it.
  const playing = voice.speaking && voice.id === SAMPLE_ID;
  useEffect(() => () => speech.stop(SAMPLE_ID), []);
  const sample = () => {
    if (playing) { speech.stop(); return; }
    speech.prime();
    speech.speak(`Hi, I'm ${name}.`, { id: SAMPLE_ID, raw: true, voiceURI: prefs.voiceURI, rate: SPEEDS[prefs.speed].rate });
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

        {/* Which voice (owner decision, 9 October 2026: natural voice): Computer voice or a natural one, saved to the account. */}
        <NaturalVoicePicker orgSlug={orgSlug} name={name} choice={choice} />

        {voice.supported === false ? (
          <>
            <SettingsRow label={NATURAL_WORDS.computer.label} align="text" sideBySideAt="container">
              <span className="text-secondary">
                {naturalChosen
                  ? <>This browser has no voices of its own, so when the natural voice isn&apos;t available {name} can&apos;t speak here. Try Safari, or Chrome or Edge with your computer&apos;s voices.</>
                  : <>This browser has no voices of its own, so {name} can&apos;t speak here in the computer voice. Choose a natural voice, or try Safari, or Chrome or Edge with your computer&apos;s voices.</>}
              </span>
            </SettingsRow>
            {/* The natural voice's speed (sent with each reply), where there is no computer voice to set it for. */}
            {naturalChosen ? (
              <SettingsRow label="Speed" labelId="assistant-voice-speed-label" sideBySideAt="container">
                <Segmented aria-label="Speed" name="assistant-voice-speed" value={prefs.speed} onChange={(v) => prefs.setSpeed(v as VoiceSpeed)}
                  options={(Object.keys(SPEEDS) as VoiceSpeed[]).map((s) => ({ value: s, label: SPEEDS[s].label }))} />
              </SettingsRow>
            ) : null}
          </>
        ) : (
          <>
            <SettingsRow label={NATURAL_WORDS.computer.label} hint={naturalChosen ? NATURAL_WORDS.computer.hintFallback : NATURAL_WORDS.computer.hint} htmlFor="assistant-voice" sideBySideAt="container">
              {voice.supported === null ? (
                <Select id="assistant-voice" disabled value="" onChange={() => undefined} className="sm:max-w-72"><option value="">Checking this computer&apos;s voices…</option></Select>
              ) : (
                <VoiceSelect voices={voice.voices} value={prefs.voiceURI} auto={auto} onChange={prefs.setVoiceURI} />
              )}
            </SettingsRow>
            {voice.supported || naturalChosen ? (
              <SettingsRow label="Speed" labelId="assistant-voice-speed-label" sideBySideAt="container">
                <Segmented aria-label="Speed" name="assistant-voice-speed" value={prefs.speed} onChange={(v) => prefs.setSpeed(v as VoiceSpeed)}
                  options={(Object.keys(SPEEDS) as VoiceSpeed[]).map((s) => ({ value: s, label: SPEEDS[s].label }))} />
              </SettingsRow>
            ) : null}
          </>
        )}

        {failure ? <SettingsAlert>{failure}</SettingsAlert> : null}
        {choice.failure ? <SettingsAlert>{choice.failure}</SettingsAlert> : null}
        {/* The browser took the sample but never started it (it can refuse speech without a recent press): said, not
            left as a Stop that quietly turns back (review, 7 October 2026). */}
        {voice.blocked === SAMPLE_ID && !playing ? <SettingsAlert tone="warning">{name} couldn&apos;t speak in this browser. Try again, or choose another voice.</SettingsAlert> : null}
        {/* Never "Saved" beside a failed save: the alerts above say what failed. */}
        <SettingsFooter status={failure || choice.failure ? undefined : choice.status ?? status ?? undefined} busy={busy || choice.busy ? "Saving…" : undefined}>
          {voice.supported ? (
            // The label says what a press does; it changes, so it is not also a pressed toggle (a toggle keeps its name).
            // Its name says whose sample it is, beside the natural voices' own (9 October 2026).
            <Button variant="secondary" size="md" onClick={sample} aria-label={playing ? "Stop the sample of the computer voice" : NATURAL_WORDS.computer.sample}>
              {playing ? <><Square className="fill-current" aria-hidden />Stop</> : <><Volume2 aria-hidden />Play a sample</>}
            </Button>
          ) : null}
        </SettingsFooter>
      </div>
    </SettingsSection>
  );
}

/**
 * This computer's own voices: Automatic first (naming the voice it picks for this page, once known), then the page
 * language's voices, then every other language's with its language beside the name. A remembered voice that has gone
 * from the computer reads as Automatic, which is what speaking uses then. Other props (the row's aria-describedby) go
 * to the select.
 */
function VoiceSelect({ voices, value, auto, onChange, ...rest }: Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange"> & {
  voices: readonly LocalVoice[]; value: string | null; auto: LocalVoice | null; onChange: (v: string | null) => void;
}) {
  const groups = useMemo(() => {
    const { base, label } = pageLanguage();
    return { label: `${label} voices`, mine: voices.filter((v) => baseOf(v.lang) === base), other: voices.filter((v) => baseOf(v.lang) !== base) };
  }, [voices]);
  const current = value && voices.some((v) => v.voiceURI === value) ? value : "";
  return (
    <Select {...rest} id="assistant-voice" value={current} onChange={(e) => onChange(e.target.value || null)} className="sm:max-w-72">
      <option value="">{auto ? `Automatic (${auto.name})` : "Automatic"}</option>
      {groups.mine.length ? <optgroup label={groups.label}>{groups.mine.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name}</option>)}</optgroup> : null}
      {groups.other.length ? <optgroup label="Other languages">{groups.other.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{withLang(v)}</option>)}</optgroup> : null}
    </Select>
  );
}
