"use client";

/**
 * "How {name} works with you" (owner request, 11 October 2026: "choose settings"; contract 5.4; only when the plan includes
 * the assistant). Two choices, each saved the moment it is made, both opening on what the person has now:
 *
 * - Before acting: "Ask me before acting" (recommended) or "Act without asking", through the page's one act-mode store
 *   (act-mode-pill), so the box on her page shows the same at once. Locked by the workspace: only the first, checked; no AI
 *   connected: the second is disabled and says why; before migration 0045: one line instead. A refused save says the
 *   server's words in the step's live region and the choice goes back.
 * - When {name} speaks: "When I talk to {name}", Always or Never (PUT /brenda/assistant/speak, the Voice card's ordered
 *   saves: the last choice in a burst wins, a failure goes back with the server's words). Hidden where the workspace's
 *   plan has no voice. "Play a sample" plays her natural voice's sample (never the computer voice, 27 October 2026); "Choose a voice" opens the natural
 *   voices with their free preview clips (owner decision, 9 October 2026), unchanged from Settings.
 *
 * The step stays on screen until its saves have answered (review, 11 October 2026): Continue and Back wait for them (the
 * primary shows it is busy), the flow holds the rail and the browser's Back meanwhile (`onSaving`), and a refused save
 * keeps the person here with the server's words, instead of landing on the next step with the choice quietly undone.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Square, Volume2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Radio } from "@/components/ui/switch";
import { Segmented } from "@/components/ui/segmented";
import { StepFrame } from "@/components/app/welcome/step-frame";
import { NaturalVoicePicker, type NaturalVoiceChoice } from "@/components/app/assistant-natural-voice";
import type { ActModeControl } from "@/components/app/act-mode-pill";
import { useSpeech } from "@/hooks/use-assistant-speech";
import { speech } from "@/lib/assistant-speech/controller";
import { DEFAULT_NATURAL_VOICE_ID } from "@/lib/natural-voices";
import { api, isApiFailure } from "@/lib/api-client";
import { isAssistantSpeak, type AssistantSpeak } from "@/lib/assistant-look";
import type { ActMode } from "@/lib/act-mode";
import { WELCOME_WORDS } from "@/lib/welcome";
import { cn } from "@/lib/utils";

const H = WELCOME_WORDS.how;
const SAMPLE_ID = "welcome-sample";

export type StepHowProps = {
  orgSlug: string; org: string; name: string; first: string;
  stepLabel: string | null; note?: ReactNode; focusTitle: boolean;
  act: ActModeControl; aiConnected: boolean;
  /** The workspace's plan carries the voice (false: no "When {name} speaks"). */
  voiceOn: boolean;
  speak: AssistantSpeak; onSpeak: (s: AssistantSpeak) => void;
  natural: NaturalVoiceChoice; naturalReady: boolean;
  error: string | null; onError: (m: string | null) => void;
  onBack: () => void; onContinue: () => void;
  /** A choice was saved (her line and reaction). */
  onSaved: (what: { mode?: ActMode; speak?: AssistantSpeak }) => void;
  /** A choice is being saved (the flow holds the rail and the browser's Back). */
  onSaving: (saving: boolean) => void;
};

export function StepHow(p: StepHowProps) {
  const id = useId();
  const voice = useSpeech();
  const { state } = p.act;
  const [open, setOpen] = useState(p.natural.chosen !== null);
  const [saving, setSaving] = useState(false);

  // Saves in flight, and whether the last one was refused: Continue and Back wait for them (see above).
  const [pending, setPending] = useState(0);
  const [waiting, setWaiting] = useState(false);
  const failed = useRef(false);
  const modeSave = useRef<Promise<void>>(Promise.resolve());
  const mounted = useRef(true);
  const { onSaving } = p;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { onSaving(pending > 0); }, [pending, onSaving]);
  useEffect(() => () => onSaving(false), [onSaving]);
  const track = (work: Promise<void>) => { setPending((n) => n + 1); void work.finally(() => { if (mounted.current) setPending((n) => n - 1); }); };
  const settle = async (then: () => void) => {
    setWaiting(true);
    await Promise.all([modeSave.current, queue.current]);
    if (!mounted.current) return;
    setWaiting(false);
    // A refused save keeps the person here once, with its words; pressing again goes on with what is saved.
    if (failed.current) { failed.current = false; return; }
    then();
  };

  // When she speaks: the ordered saves of the Voice card (MyVoiceSettings).
  const wanted = useRef<AssistantSpeak | null>(null);
  const queue = useRef(Promise.resolve());
  const [target, setTarget] = useState<AssistantSpeak | null>(null);
  const shownSpeak = target ?? p.speak;
  const chooseSpeak = (v: AssistantSpeak) => {
    if (v === shownSpeak) return;
    wanted.current = v; setTarget(v); setSaving(true); p.onError(null); failed.current = false;
    queue.current = queue.current.then(async () => {
      if (wanted.current !== v) return;
      try {
        const r = await api<{ speak: AssistantSpeak }>(`/api/orgs/${p.orgSlug}/brenda/assistant/speak`, { method: "PUT", body: { speak: v }, retries: 0 });
        if (wanted.current !== v) return;
        p.onSpeak(r.speak); setTarget(null); setSaving(false); p.onSaved({ speak: r.speak });
      } catch (err) {
        if (wanted.current !== v) return;
        setTarget(null); setSaving(false);
        const told = isApiFailure(err) && (err.error.status < 500 || err.error.code === "NOT_READY");
        failed.current = true;
        if (mounted.current) p.onError(told ? err.error.message : WELCOME_WORDS.errors.offline);
      }
    });
    track(queue.current);
  };

  const chooseMode = (mode: ActMode) => {
    if (mode === state.mode) return;
    p.onError(null); failed.current = false;
    // No refresh after the save: the welcome keeps its own state, and its page sends a finished welcome home
    // (integration, 11 October 2026).
    const work = (async () => {
      const r = await p.act.set(mode, { quiet: true, refresh: false });
      if (r && !r.ok) { failed.current = true; if (mounted.current) p.onError(r.message); }
      else if (r?.ok && mounted.current) p.onSaved({ mode: r.state.effective });
    })();
    modeSave.current = work;
    track(work);
  };

  // A sample of her voice (the chosen natural voice, else the default; never the computer voice since the owner's
  // request, 27 October 2026); leaving the step stops it.
  const playing = voice.speaking && voice.id === SAMPLE_ID;
  useEffect(() => () => speech.stop(SAMPLE_ID), []);
  const sampleVoice = p.natural.chosen ?? DEFAULT_NATURAL_VOICE_ID;
  const sample = () => {
    if (playing) { speech.stop(); return; }
    speech.prime({ natural: true });
    speech.playSample(`/api/orgs/${encodeURIComponent(p.orgSlug)}/assistant/voice/samples/${sampleVoice}`, { id: SAMPLE_ID });
  };

  const notReady = !state.ready || state.locked === "not_ready";
  const lockedByWorkspace = state.locked === "workspace";
  const panelId = `${id}-voices`;

  return (
    <StepFrame stepLabel={p.stepLabel} title={H.title(p.name)} lede={H.lede} note={p.note} focusTitle={p.focusTitle} error={p.error}
      onSubmit={() => void settle(p.onContinue)} onBack={() => void settle(p.onBack)} primary={{ label: WELCOME_WORDS.buttons.continue, loading: waiting }}>
      <div className="grid gap-8">
        <fieldset className="min-w-0">
          <legend className="mb-3 p-0 text-sm font-medium text-foreground">{H.act.legend}</legend>
          {notReady ? (
            <p className="text-sm font-normal text-secondary">{H.act.notReady(p.name)}</p>
          ) : (
            <div className="grid gap-3.5">
              <Radio name="welcome-act" value="ask" checked={lockedByWorkspace || state.mode === "ask"} disabled={lockedByWorkspace} onChange={() => chooseMode("ask")} hint={H.act.askHint(p.name)}>
                <span className="inline-flex flex-wrap items-center gap-2">{H.act.ask}<Badge size="sm">{H.act.recommended}</Badge></span>
              </Radio>
              {lockedByWorkspace ? null : (
                <Radio name="welcome-act" value="auto" checked={state.mode === "auto"} disabled={!p.aiConnected} onChange={() => chooseMode("auto")}
                  hint={p.aiConnected ? H.act.autoHint(p.name) : H.act.needsAi(p.name)}>
                  {H.act.auto}
                </Radio>
              )}
              <p className="text-meta font-normal text-secondary">{lockedByWorkspace ? H.act.locked(p.org) : H.act.either(p.name)}</p>
            </div>
          )}
        </fieldset>

        {p.voiceOn ? (
          <div className="min-w-0">
            <p id={`${id}-speak`} className="mb-3 text-sm font-medium text-foreground">{H.voice.legend(p.name)}</p>
            <Segmented aria-label={H.voice.legend(p.name)} name="welcome-speak" value={shownSpeak}
              onChange={(v) => { if (isAssistantSpeak(v)) chooseSpeak(v); }}
              options={[{ value: "voice", label: H.voice.voice(p.name) }, { value: "always", label: H.voice.always }, { value: "never", label: H.voice.never }]}
              className="max-w-full flex-wrap" />
            <p className="mt-2 text-meta font-normal text-secondary">
              {H.voice.hint}
              <span aria-live="polite" className="ml-1">{saving || p.natural.busy ? H.saving : null}</span>
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              {!p.naturalReady ? (
                <p className="text-meta font-normal text-secondary">{H.voice.noVoice}</p>
              ) : (
                <Button size="sm" variant="secondary" onClick={sample} aria-label={playing ? H.voice.stop : H.voice.sampleLabel}>
                  {playing ? <><Square aria-hidden className="fill-current text-accent" />{H.voice.stop}</> : <><Volume2 aria-hidden />{H.voice.sample}</>}
                </Button>
              )}
              {p.naturalReady ? (
                <Button size="sm" variant="ghost" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((o) => !o)}>
                  {H.voice.choose}<ChevronDown aria-hidden className={cn("transition-transform duration-150", open && "rotate-180")} />
                </Button>
              ) : null}
            </div>
            {p.naturalReady ? (
              <div id={panelId} hidden={!open} className="@container mt-3 rounded-2xl border border-border">
                {open ? <NaturalVoicePicker orgSlug={p.orgSlug} name={p.name} choice={p.natural} /> : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </StepFrame>
  );
}
