"use client";

/**
 * Development gallery of Brenda's character: every state, and the passing expressions on request. v4: drawn as on her
 * home screen (monochrome; the accent only while she listens), on section and stat cards.
 *
 * Her reactions (owner request, 7 October 2026), played here without typing or a microphone: reading along as someone
 * types (the box below is a real one, wired as her box is, so typing in it works too), a paste, listening to a voice (a
 * made-up, speech-like level), thinking then pleased by a reply, celebrating something done, sad at an error and alert
 * while a Confirm waits. Every face and character on the page reads along at once: she is one person.
 *
 * Personal looks (owner decision, 7 October 2026: personal assistants): every colour, visor and eyes a person can choose
 * for their assistant, as faces at each size and as the glyph, side by side in dark and light, with every mood; and one
 * live character with pickers (also drawn in her home's orb, where only Brenda's white takes the orb's light).
 *
 * Her voice (owner decision, 7 October 2026: phase 2): "Her voice" makes her talk, to check her talking face in dark,
 * light and reduced motion. "Talk for 3 seconds" rehearses silently (the controller's syllable generator, so it works
 * in a browser with no voices); "Say a sentence" speaks with this device's own voice. Every face and character on the
 * page talks at once, as on any page: she is one person.
 */
import { useEffect, useRef, useState } from "react";
import { notFound } from "next/navigation";
import { BrendaCharacter, type BrendaCharacterHandle } from "@/components/app/brenda-character";
import { BrendaFace, type BrendaMood, type BrendaTone } from "@/components/app/brenda-face";
import { BrendaGlyph } from "@/components/app/brenda-glyph";
import { useReadAlong } from "@/components/app/brenda-chat";
import { AssistantScope } from "@/components/app/assistant-context";
import { useSpeech } from "@/hooks/use-assistant-speech";
import { speech } from "@/lib/assistant-speech/controller";
import { attention, STATES, type BrendaEmote, type BrendaState } from "@/lib/brenda-character/engine";
import {
  ASSISTANT_COLOURS, ASSISTANT_EYES, ASSISTANT_VISORS, DEFAULT_ASSISTANT_NAME, DEFAULT_LOOK, EYES, PALETTE, VISORS,
  type AssistantColour, type AssistantEyes, type AssistantLook, type AssistantVisor,
} from "@/lib/assistant-look";
import { Button } from "@/components/ui/button";
import { Select, Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";

const EMOTES: BrendaEmote[] = ["love", "wink", "proud", "surprised", "yawn", "happy", "pleased", "annoyed", "celebrate"];
const MOODS: BrendaMood[] = [null, "happy", "think", "listen", "alert", "sad"];

const SENTENCE = "Move my three o'clock with Josh to tomorrow morning and let him know why.";
const PARAGRAPH = "Notes from Monday: the launch moves to the 14th, Ada owns the checklist, David reviews the copy by Friday, and everyone clocks in before the stand-up.";

/** A made-up voice for the listening demo: syllables about four a second inside words, with pauses between them. */
const madeUpVoice = () => {
  const t = performance.now() / 1000;
  const syllables = Math.abs(Math.sin(t * Math.PI * 4.2));
  const words = Math.max(0, Math.sin(t * Math.PI * 0.9) + 0.35);
  return Math.min(1, syllables * words * 0.85);
};

/** What the demo shows: her state and her faces' mood for each reaction. */
type Demo = "idle" | "listening" | "thinking" | "pleased" | "celebrate" | "error" | "alert";
const DEMO: Record<Demo, { state: BrendaState; mood: BrendaMood; tone: BrendaTone }> = {
  idle: { state: "idle", mood: null, tone: null },
  listening: { state: "listening", mood: "listen", tone: "accent" },
  thinking: { state: "thinking", mood: "think", tone: "violet" },
  pleased: { state: "idle", mood: "happy", tone: null },
  celebrate: { state: "happy", mood: "happy", tone: "ok" },
  error: { state: "error", mood: "sad", tone: "bad" },
  alert: { state: "alert", mood: "alert", tone: "warn" },
};

export default function BrendaGallery() {
  if (process.env.NODE_ENV === "production") notFound();
  const hero = useRef<BrendaCharacterHandle>(null);
  const [state, setState] = useState<BrendaState>("idle");
  const [colour, setColour] = useState(false);
  const mono = (s: BrendaState) => !colour && s !== "listening" && "grayscale";
  return (
    <main className="mx-auto max-w-6xl space-y-10 px-5 py-10">
      <header>
        <h1 className="type-page-title">Brenda</h1>
        <p className="mt-1 text-sm font-normal text-secondary">Her character in every state. On her home screen she is monochrome; the accent shows only while she listens.</p>
      </header>
      <section className="card-section flex flex-wrap items-center gap-10">
        <BrendaCharacter ref={hero} state={state} size={170} interactive className={cn(mono(state))} />
        <div className="min-w-0 flex-1 space-y-4">
          <div className="flex flex-wrap gap-2">{(Object.keys(STATES) as BrendaState[]).map((s) => <Button key={s} size="md" variant={s === state ? "primary" : "secondary"} onClick={() => setState(s)}>{s}</Button>)}</div>
          <div className="flex flex-wrap gap-2">{EMOTES.map((e) => <Button key={e} size="md" variant="ghost" onClick={() => hero.current?.emote(e)}>{e}</Button>)}</div>
          <label className="flex items-center gap-2 text-sm font-medium text-secondary"><input type="checkbox" checked={colour} onChange={(e) => setColour(e.target.checked)} />Show the engine&apos;s own colours</label>
        </div>
      </section>
      <Reactions mono={mono} />
      <Voice />
      <PersonalLooks />
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {(Object.keys(STATES) as BrendaState[]).map((s) => (
          <div key={s} className="card-stat flex flex-col items-center gap-1"><BrendaCharacter state={s} size={84} className={cn(mono(s))} /><p className="text-sm font-medium text-secondary">{s}</p></div>
        ))}
      </section>
      <section>
        <h2 className="type-section-title mb-3.5">Her face</h2>
        <div className="flex flex-wrap items-end gap-6">
          {MOODS.map((m) => (
            <div key={m ?? "none"} className="flex flex-col items-center gap-2">
              <div className="flex items-end gap-3"><BrendaFace size="sm" mood={m} /><BrendaFace size="md" mood={m} /><BrendaFace size="lg" mood={m} interactive /></div>
              <p className="text-xs font-medium text-secondary">{m ?? "resting"}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

/**
 * Her reactions, on demand. The box is wired as her box is (`useReadAlong`); the Typing and Paste buttons put words in
 * it through the same input events a keyboard sends, so what you see is what typing to her does.
 */
function Reactions({ mono }: { mono: (s: BrendaState) => string | false }) {
  const character = useRef<BrendaCharacterHandle>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const readAlong = useReadAlong();
  const [demo, setDemo] = useState<Demo>("idle");
  const [timers] = useState(() => new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => () => { timers.forEach(clearTimeout); }, [timers]);
  const later = (ms: number, run: () => void) => { const t = setTimeout(() => { timers.delete(t); run(); }, ms); timers.add(t); };
  const stop = () => { timers.forEach(clearTimeout); timers.clear(); };
  const show = (next: Demo) => { stop(); setDemo(next); };
  const { state, mood, tone } = DEMO[demo];

  /** Words into the box at the caret, with the input event a keyboard or a paste sends. */
  const put = (el: HTMLTextAreaElement, words: string, inputType: string) => {
    el.setRangeText(words, el.selectionStart, el.selectionEnd, "end");
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType, data: inputType === "insertText" ? words : null }));
  };
  /** Types the sentence a character at a time, at a person's pace (a little longer after each word). */
  const typing = () => {
    show("idle");
    const el = field.current; if (!el) return;
    el.focus(); el.value = "";
    let at = 150;
    for (const ch of SENTENCE) {
      at += 50 + Math.random() * 80 + (ch === " " ? 70 : 0);
      later(at, () => put(el, ch, "insertText"));
    }
  };
  const paste = () => {
    show("idle");
    const el = field.current; if (!el) return;
    el.focus(); put(el, (el.value && !/\s$/.test(el.value) ? " " : "") + PARAGRAPH, "insertFromPaste");
  };
  /** Sent: she stops reading and thinks, then her reply pleases her for a moment. */
  const reply = () => {
    show("thinking");
    attention.release();
    if (field.current) field.current.value = "";
    later(1600, () => { setDemo("pleased"); character.current?.emote("pleased"); });
    later(3400, () => setDemo("idle"));
  };
  const done = () => { show("celebrate"); character.current?.emote("celebrate"); };
  const pick = (d: Demo) => (demo === d ? "primary" : "secondary");

  return (
    <section aria-labelledby="reactions-title" className="space-y-3.5">
      <div>
        <h2 id="reactions-title" className="type-section-title">Her reactions</h2>
        <p className="mt-1 text-sm font-normal text-secondary">What she does as you work with her. Type in the box, or play each one. With reduced motion each is a still pose.</p>
      </div>
      <div className="card-section grid items-center gap-8 md:grid-cols-[auto_minmax(0,1fr)]">
        <div className="flex flex-col items-center gap-4">
          <BrendaCharacter ref={character} state={state} size={120} interactive level={madeUpVoice} className={cn(mono(state))} />
          <div className="flex items-end gap-3">
            <BrendaFace size="sm" mood={mood} tone={tone} /><BrendaFace size="md" mood={mood} tone={tone} /><BrendaFace size="lg" mood={mood} tone={tone} />
          </div>
        </div>
        <div className="min-w-0 space-y-4">
          <div {...readAlong}>
            <Textarea ref={field} rows={3} aria-label="Type to Brenda" placeholder="Type here and she reads along…" className="resize-none py-2" />
          </div>
          <div role="group" aria-label="Typing" className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={typing}>Typing</Button>
            <Button size="sm" variant="secondary" onClick={paste}>A paste</Button>
            <Button size="sm" variant="secondary" onClick={reply}>Send, then her reply</Button>
          </div>
          <div role="group" aria-label="Her state" className="flex flex-wrap gap-2">
            <Button size="sm" variant={pick("listening")} aria-pressed={demo === "listening"} onClick={() => show(demo === "listening" ? "idle" : "listening")}>Listening to a voice</Button>
            <Button size="sm" variant={pick("celebrate")} aria-pressed={demo === "celebrate"} onClick={done}>Something done</Button>
            <Button size="sm" variant={pick("error")} aria-pressed={demo === "error"} onClick={() => show("error")}>An error</Button>
            <Button size="sm" variant={pick("alert")} aria-pressed={demo === "alert"} onClick={() => show("alert")}>Waiting for a Confirm</Button>
            <Button size="sm" variant="ghost" onClick={() => show("idle")}>Back to resting</Button>
          </div>
          <p className="text-meta font-normal text-secondary">
            {demo === "listening" ? "Listening: her head tilts, her eyes widen and her light rises with the voice."
              : demo === "thinking" ? "Thinking while she works on it."
              : demo === "pleased" ? "Pleased by her reply."
              : "Typing: her eyes go to the caret and follow it, a flick as each character arrives, a nod or a blink every few words; a moment after you stop, back to the pointer."}
          </p>
        </div>
      </div>
    </section>
  );
}

/** What "Say a sentence" says. */
const SENTENCE_SAID = "Hi, I'm Brenda. You have 3 tasks due today.";

/**
 * Her voice: her character and the three faces, made to talk. Rehearsing needs no voice at all; speaking needs one of
 * this device's own (the line under the buttons says whether there is one, and how many).
 */
function Voice() {
  const voice = useSpeech();
  const talking = voice.speaking && voice.id === "gallery";
  useEffect(() => () => speech.stop("gallery"), []);
  return (
    <section aria-labelledby="voice-title" className="space-y-3.5">
      <div>
        <h2 id="voice-title" className="type-section-title">Her voice</h2>
        <p className="mt-1 text-sm font-normal text-secondary">While she speaks, every face of hers on the page talks: her eyes squash and open with each syllable, she bobs a little and her glow brightens in her own colour. With reduced motion it is a still speaking pose.</p>
      </div>
      <div className="card-section grid items-center gap-8 md:grid-cols-[auto_minmax(0,1fr)]">
        <div className="flex flex-col items-center gap-4">
          <BrendaCharacter state="idle" size={120} interactive />
          <div className="flex items-end gap-3"><BrendaFace size="sm" /><BrendaFace size="md" /><BrendaFace size="lg" /></div>
        </div>
        <div className="min-w-0 space-y-4">
          <div role="group" aria-label="Her voice" className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => speech.rehearse(3000, "gallery")}>Talk for 3 seconds</Button>
            {voice.supported ? <Button size="sm" variant="secondary" onClick={() => { speech.prime(); speech.speak(SENTENCE_SAID, { id: "gallery", raw: true }); }}>Say a sentence</Button> : null}
            {talking ? <Button size="sm" variant="ghost" onClick={() => speech.stop()}>Stop</Button> : null}
          </div>
          <p className="text-meta font-normal text-secondary">
            Supported: <span className="font-medium text-foreground">{voice.supported === null ? "checking" : voice.supported ? "yes" : "no"}</span>, local voices: <span className="font-medium tabular-nums text-foreground">{voice.voices.length}</span>{talking ? ", talking now" : ""}.
          </p>
        </div>
      </div>
    </section>
  );
}

type FaceSize = "sm" | "md" | "lg";
const SIZES: FaceSize[] = ["sm", "md", "lg"];
const SIZE_LABEL: Record<FaceSize | "all", string> = { sm: "Small", md: "Medium", lg: "Large", all: "All three" };
const MOOD_LABEL = (m: BrendaMood) => (m ? m[0].toUpperCase() + m.slice(1) : "Resting");
const short = (label: string) => label.split(" ")[0];

/**
 * Personal looks: one live character with pickers, then every combination in both themes. The size and mood pickers
 * apply to the faces in the table, so each mood can be checked on each eye style and visor.
 */
function PersonalLooks() {
  const [look, setLook] = useState<AssistantLook>(DEFAULT_LOOK);
  const [state, setState] = useState<BrendaState>("idle");
  const [mood, setMood] = useState<BrendaMood>(null);
  const [size, setSize] = useState<FaceSize | "all">("md");
  const [px, setPx] = useState(120);
  const choose = (next: Partial<AssistantLook>) => setLook((l) => ({ ...l, ...next }));
  const profile = { name: DEFAULT_ASSISTANT_NAME, ...look };

  return (
    <section aria-labelledby="looks-title" className="space-y-3.5">
      <div>
        <h2 id="looks-title" className="type-section-title">Personal looks</h2>
        <p className="mt-1 text-sm font-normal text-secondary">Each person can choose their assistant&apos;s colour, visor and eyes. The visor stays black and the eyes white on every colour.</p>
      </div>
      <div className="card-section grid items-center gap-8 md:grid-cols-[auto_minmax(0,1fr)]">
        <div className="flex flex-col items-center gap-4">
          <BrendaCharacter state={state} size={px} interactive look={look} />
          <div className="flex items-end gap-3">{SIZES.map((z) => <BrendaFace key={z} size={z} mood={mood} look={look} />)}</div>
          <AssistantScope profile={profile}>
            <span data-icon-trigger className="flex items-center gap-3 text-secondary"><BrendaGlyph size={18} aria-hidden /><BrendaGlyph size={24} aria-hidden /></span>
          </AssistantScope>
          {/* Her home's orb (the home-panel exception, shown here only to check it): white blends into the orb's light,
              a chosen colour shows as chosen. */}
          <div className="brenda-orb" data-live={state === "listening" || undefined}>
            <BrendaCharacter state={state} size={72} look={look} label="In her home's orb" className={cn(state !== "listening" && "grayscale")} />
          </div>
        </div>
        <div className="min-w-0 space-y-4">
          <Picker label="Colour">
            <Segmented name="look-colour" aria-label="Colour" value={look.colour} onChange={(v) => choose({ colour: v as AssistantColour })}
              options={ASSISTANT_COLOURS.map((c) => ({ value: c, label: <><span aria-hidden className="size-3 shrink-0 rounded-full border border-border-input" style={{ background: PALETTE[c].face.mid }} />{PALETTE[c].label}</> }))} />
          </Picker>
          <Picker label="Visor">
            <Segmented name="look-visor" aria-label="Visor" value={look.visor} onChange={(v) => choose({ visor: v as AssistantVisor })}
              options={ASSISTANT_VISORS.map((v) => ({ value: v, label: VISORS[v].label }))} />
          </Picker>
          <Picker label="Eyes">
            <Segmented name="look-eyes" aria-label="Eyes" value={look.eyes} onChange={(v) => choose({ eyes: v as AssistantEyes })}
              options={ASSISTANT_EYES.map((e) => ({ value: e, label: EYES[e].label }))} />
          </Picker>
          <div className="flex flex-wrap gap-4">
            <label className="space-y-1.5">
              <span className="block text-sm font-medium text-foreground">State</span>
              <Select value={state} onChange={(e) => setState(e.target.value as BrendaState)} className="w-44">
                {(Object.keys(STATES) as BrendaState[]).map((k) => <option key={k} value={k}>{k}</option>)}
              </Select>
            </label>
            <Picker label="Size">
              <Segmented name="look-px" aria-label="Size" value={String(px)} onChange={(v) => setPx(Number(v))}
                options={[{ value: "64", label: "64, the dialog" }, { value: "72", label: "72, Settings and her home" }, { value: "120", label: "120" }]} />
            </Picker>
            <Button size="md" variant="ghost" className="self-end" onClick={() => setLook(DEFAULT_LOOK)}>Back to Brenda</Button>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-6">
        <Picker label="Face size">
          <Segmented name="looks-size" aria-label="Face size" value={size} onChange={(v) => setSize(v as FaceSize | "all")}
            options={(["sm", "md", "lg", "all"] as const).map((z) => ({ value: z, label: SIZE_LABEL[z] }))} />
        </Picker>
        <Picker label="Mood">
          <Segmented name="looks-mood" aria-label="Mood" value={mood ?? "none"} onChange={(v) => setMood(v === "none" ? null : (v as BrendaMood))}
            options={MOODS.map((m) => ({ value: m ?? "none", label: MOOD_LABEL(m) }))} />
        </Picker>
      </div>
      <div className="grid gap-3 2xl:grid-cols-2">
        {(["dark", "light"] as const).map((theme) => (
          <div key={theme} data-theme={theme} className="min-w-0 rounded-2xl border border-border bg-background p-5 text-foreground">
            <p className="mb-3 text-sm font-medium text-secondary">{theme === "dark" ? "Dark" : "Light"}</p>
            <LookTable size={size} mood={mood} theme={theme} />
          </div>
        ))}
      </div>
    </section>
  );
}

function Picker({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p aria-hidden className="text-sm font-medium text-foreground">{label}</p>
      {children}
    </div>
  );
}

/** Every colour (rows) by every visor and eyes (columns), as faces, then the glyph for each visor and eyes. */
function LookTable({ size, mood, theme }: { size: FaceSize | "all"; mood: BrendaMood; theme: "dark" | "light" }) {
  const sizes = size === "all" ? SIZES : [size];
  const combos = ASSISTANT_VISORS.flatMap((visor) => ASSISTANT_EYES.map((eyes) => ({ visor, eyes })));
  return (
    <div className="overflow-x-auto">
      <table className="border-collapse">
        <caption className="sr-only">Every colour, visor and eyes, {theme} theme</caption>
        <thead>
          <tr>
            <td />
            {ASSISTANT_VISORS.map((v) => <th key={v} scope="colgroup" colSpan={ASSISTANT_EYES.length} className="px-1 pb-1 text-center text-meta font-medium text-secondary">{VISORS[v].label}</th>)}
          </tr>
          <tr>
            <td />
            {combos.map(({ visor, eyes }) => <th key={visor + eyes} scope="col" className="px-1 pb-2 text-center text-meta font-normal text-subtle">{short(EYES[eyes].label)}</th>)}
          </tr>
        </thead>
        <tbody>
          {ASSISTANT_COLOURS.map((colour) => (
            <tr key={colour}>
              <th scope="row" className="whitespace-nowrap pr-3 text-left text-sm font-medium text-secondary">{PALETTE[colour].label}</th>
              {combos.map(({ visor, eyes }) => (
                <td key={visor + eyes} className="px-1.5 py-1.5 text-center">
                  <span className="inline-flex items-end gap-1">{sizes.map((z) => <BrendaFace key={z} size={z} mood={mood} look={{ colour, visor, eyes }} />)}</span>
                </td>
              ))}
            </tr>
          ))}
          <tr>
            <th scope="row" className="whitespace-nowrap pr-3 pt-2 text-left text-sm font-medium text-secondary">Glyph</th>
            {combos.map(({ visor, eyes }) => (
              <td key={visor + eyes} className="px-1.5 pt-2 text-center">
                <AssistantScope profile={{ name: DEFAULT_ASSISTANT_NAME, colour: "white", visor, eyes }}>
                  <span data-icon-trigger className="inline-flex text-secondary"><BrendaGlyph size={18} aria-hidden /></span>
                </AssistantScope>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
