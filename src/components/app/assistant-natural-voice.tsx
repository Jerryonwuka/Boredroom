"use client";

/**
 * Settings → Your assistant → Voice → the voice itself (owner decision, 9 October 2026: natural voice (ElevenLabs),
 * contract F.2). The first row after "When {name} speaks" in MyVoiceSettings (assistant-voice-settings):
 *
 * - A radio group, "{name}'s voice": **Computer voice** first (the default; built into this computer, the words stay on
 *   it), then the eight curated ElevenLabs voices (lib/natural-voices), each with its one-line description and a ghost
 *   "Play a sample" button on the right that becomes Stop (the orange square, live and now) while it plays. A sample is
 *   the voice's own preview, through our server, so it costs no characters; it plays through the one voice on the page,
 *   so her faces follow it and leaving the page stops it.
 * - Choosing saves at once to the person's assistant profile (PUT /assistant/voice), so the desktop app uses it too: the
 *   same ordered saves as the When radios (the last choice in a burst wins; a failure puts the choice back and says why),
 *   with "Saved" in the card's footer. An administrator signed in as the person sees it disabled (the server refuses too).
 * - Always under the group, the privacy line: the words the assistant says are sent to ElevenLabs, and ElevenLabs keeps
 *   them in the key's account history until Boredroom deletes them (review, 9 October 2026).
 * - Without any key (neither the workspace's nor Boredroom's), the samples could never play: their buttons are left out
 *   and one line says when they will play (review, 9 October 2026).
 * - When a natural voice is chosen but the computer voice speaks instead (the caps, the allowance, no key, ElevenLabs not
 *   answering), an info alert says why in plain words (assistant-speech/natural-words). Before migration 0053 the radios
 *   are disabled under an info alert. If the page could not read the choice, the card reads it itself.
 *
 * `useNaturalVoiceChoice` holds the saved choice for the card, so MyVoiceSettings can word the computer voice's rows and
 * the footer from it.
 */
import { useEffect, useId, useRef, useState } from "react";
import { Square, Volume2 } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { Radio } from "@/components/ui/switch";
import { SettingsAlert } from "@/components/app/settings-forms";
import { useSpeech } from "@/hooks/use-assistant-speech";
import { speech } from "@/lib/assistant-speech/controller";
import { NATURAL_WORDS, naturalVoiceNote } from "@/lib/assistant-speech/natural-words";
import { NATURAL_VOICES, type NaturalVoice, type NaturalVoiceView } from "@/lib/natural-voices";
import { api, isApiFailure } from "@/lib/api-client";

const OFFLINE = "Could not save. Check your connection and try again.";
/** A natural sample's utterance id; leaving the page stops every one of them (a prefix). */
const SAMPLE_PREFIX = "natural-sample:";
const sampleId = (voiceId: string) => `${SAMPLE_PREFIX}${voiceId}`;
const samplePath = (orgSlug: string, voiceId: string) => `/api/orgs/${encodeURIComponent(orgSlug)}/assistant/voice/samples/${voiceId}`;

export type NaturalVoiceChoice = {
  /** What the server last said (null while it is read, or when it could not be). */
  view: NaturalVoiceView | null;
  /** The voice shown as chosen (the one on its way to being saved, else the saved one); null is Computer voice. */
  chosen: string | null;
  choose(voiceId: string | null): void;
  /** No choosing: signed in as the person, before 0053, or nothing read yet. */
  locked: boolean;
  busy: boolean;
  status: string | null;
  failure: string | null;
  /** Clears "Saved" (the card's other save started: the card has one footer). */
  clearStatus(): void;
  /** The page and the card's own read both failed. */
  unreadable: boolean;
};

/**
 * The person's natural voice for the Voice card: read with the page (or by the card), saved at once, in order.
 * `onSaveStart` clears the card's other save's "Saved", since both share the card's one footer (fix review, 9 October 2026).
 */
export function useNaturalVoiceChoice(orgSlug: string, initial: NaturalVoiceView | null, impersonated: boolean, onSaveStart?: () => void): NaturalVoiceChoice {
  const [view, setView] = useState<NaturalVoiceView | null>(initial);
  // The page's value takes over when it brings a new one (a refresh).
  const [seen, setSeen] = useState(initial);
  const [target, setTarget] = useState<string | null | undefined>(undefined);
  if (seen !== initial) { setSeen(initial); if (initial) { setView(initial); setTarget(undefined); } }
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [unreadable, setUnreadable] = useState(false);
  // A failed read on the page: the card reads it itself.
  const missing = !view;
  useEffect(() => {
    if (!missing) return;
    let gone = false;
    api<NaturalVoiceView>(`/api/orgs/${encodeURIComponent(orgSlug)}/assistant/voice`).then(
      (v) => { if (!gone) { setView(v); setUnreadable(false); } },
      () => { if (!gone) setUnreadable(true); },
    );
    return () => { gone = true; };
  }, [missing, orgSlug]);

  const chosen = target !== undefined ? target : view?.chosen ?? null;
  const locked = impersonated || !view || !view.ready;
  // One save at a time, in the order chosen; a choice overtaken before its turn is not sent.
  const wanted = useRef<string | null | undefined>(undefined);
  const queue = useRef(Promise.resolve());
  const choose = (voiceId: string | null) => {
    if (locked || voiceId === chosen) return;
    wanted.current = voiceId;
    setTarget(voiceId); setBusy(true); setStatus(null); setFailure(null);
    onSaveStart?.();
    queue.current = queue.current.then(async () => {
      if (wanted.current !== voiceId) return;
      try {
        const r = await api<NaturalVoiceView>(`/api/orgs/${encodeURIComponent(orgSlug)}/assistant/voice`, { method: "PUT", body: { voiceId }, retries: 0 });
        setView(r);
        if (wanted.current !== voiceId) return;
        setTarget(undefined); setBusy(false); setStatus("Saved");
      } catch (err) {
        if (wanted.current !== voiceId) return;
        setTarget(undefined); setBusy(false);
        // A refusal (4xx) says why in words meant for the person, and so does "needs a database update" (503 NOT_READY,
        // before 0053); any other fault or no answer at all is "Could not save" (as the When radios).
        const told = isApiFailure(err) && (err.error.status < 500 || err.error.code === "NOT_READY");
        setFailure(told ? err.error.message : OFFLINE);
      }
    });
  };
  return { view, chosen, choose, locked, busy, status, failure, clearStatus: () => setStatus(null), unreadable };
}

/** The Voice row: Computer voice or one of the natural voices, with samples, the privacy line and why-not notes. */
export function NaturalVoicePicker({ orgSlug, name, choice }: { orgSlug: string; name: string; choice: NaturalVoiceChoice }) {
  const id = useId();
  const hintId = `${id}-hint`;
  const voice = useSpeech();
  const { view, chosen, locked } = choice;
  const voices: readonly NaturalVoice[] = view?.voices?.length ? view.voices : NATURAL_VOICES;
  // An older answer without the field: offered, as before.
  const samplesOn = view?.samples !== false;
  const [unplayable, setUnplayable] = useState(false);

  // Leaving the page stops a sample still playing.
  useEffect(() => () => speech.stop(SAMPLE_PREFIX), []);
  const playing = (v: NaturalVoice) => voice.speaking && voice.id === sampleId(v.id);
  const sample = (v: NaturalVoice) => {
    if (playing(v)) { speech.stop(); return; }
    setUnplayable(false);
    speech.prime({ natural: true }); // inside the press, so Safari lets the sample (and later replies) play
    if (!speech.playSample(samplePath(orgSlug, v.id), { id: sampleId(v.id) })) setUnplayable(true);
  };
  const failedSample = voices.find((v) => voice.blocked === sampleId(v.id) && !playing(v)) ?? null;

  // Why the computer voice speaks although a natural voice is chosen: the server's view, or (when that says it is
  // available) what this page just saw happen to a reply.
  const saved = view?.chosen ?? null;
  const reason = !view || !saved || chosen !== saved ? null : view.available ? voice.naturalFailed : view.reason;
  const note = reason ? naturalVoiceNote(reason, name, view?.resetAt ?? null) : null;

  return (
    <>
      {view && !view.ready ? <SettingsAlert tone="info">{NATURAL_WORDS.picker.notReady(name)}</SettingsAlert> : null}
      {!view && choice.unreadable ? <SettingsAlert tone="warning">{NATURAL_WORDS.picker.unreadable}</SettingsAlert> : null}
      {/* A settings row as a fieldset, as the When row: the legend names the group, the same words stand for the eye. */}
      <fieldset aria-describedby={hintId} className="grid min-w-0 gap-x-8 gap-y-3 px-5 py-4 @2xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] @2xl:items-start">
        <legend className="sr-only">{NATURAL_WORDS.picker.legend(name)}</legend>
        <div className="min-w-0">
          <p aria-hidden className="text-sm font-medium text-foreground">{NATURAL_WORDS.picker.label}</p>
          <p id={hintId} className="mt-0.5 text-meta font-normal text-secondary">{NATURAL_WORDS.picker.hint}</p>
        </div>
        <div className="grid min-w-0 gap-3">
          <Radio name="assistant-natural-voice" value="" checked={chosen === null} disabled={locked} onChange={() => choice.choose(null)} hint={NATURAL_WORDS.picker.computerHint}>
            {NATURAL_WORDS.picker.computer}
          </Radio>
          {voices.map((v) => {
            const on = playing(v);
            return (
              <div key={v.id} className="flex min-w-0 items-start justify-between gap-3">
                <Radio name="assistant-natural-voice" value={v.id} checked={chosen === v.id} disabled={locked} onChange={() => choice.choose(v.id)} hint={v.description} className="min-w-0 flex-1">
                  {v.name}
                </Radio>
                {/* Its name says what a press does; it changes, so it is not also a pressed toggle (as the footer's sample). */}
                {samplesOn ? (
                  <IconButton size="sm" aria-label={on ? NATURAL_WORDS.picker.stop(v.name) : NATURAL_WORDS.picker.play(v.name)} onClick={() => sample(v)} className="-my-1">
                    {on ? <Square className="fill-current text-accent" aria-hidden /> : <Volume2 aria-hidden />}
                  </IconButton>
                ) : null}
              </div>
            );
          })}
          {/* Owner decision, 9 October 2026 (privacy): always shown, whatever is chosen. */}
          {samplesOn ? null : <p className="text-meta font-normal text-secondary">{NATURAL_WORDS.picker.noSamples}</p>}
          <p className="text-meta font-normal text-secondary">{NATURAL_WORDS.privacy} {NATURAL_WORDS.privacyHistory}</p>
        </div>
      </fieldset>
      {note ? <SettingsAlert tone="info">{note}</SettingsAlert> : null}
      {failedSample ? <SettingsAlert tone="warning">{NATURAL_WORDS.picker.sampleFailed(failedSample.name)}</SettingsAlert> : null}
      {unplayable && !failedSample ? <SettingsAlert tone="warning">{NATURAL_WORDS.picker.sampleUnplayable}</SettingsAlert> : null}
    </>
  );
}
