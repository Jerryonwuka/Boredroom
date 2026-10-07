"use client";

/**
 * Development gallery of Brenda's character: every state, and the passing expressions on request. v4: drawn as on her
 * home screen (monochrome; the accent only while she listens), on section and stat cards.
 *
 * Her reactions (owner request, 7 October 2026), played here without typing or a microphone: reading along as someone
 * types (the box below is a real one, wired as her box is, so typing in it works too), a paste, listening to a voice (a
 * made-up, speech-like level), thinking then pleased by a reply, celebrating something done, sad at an error and alert
 * while a Confirm waits. Every face and character on the page reads along at once: she is one person.
 */
import { useEffect, useRef, useState } from "react";
import { notFound } from "next/navigation";
import { BrendaCharacter, type BrendaCharacterHandle } from "@/components/app/brenda-character";
import { BrendaFace, type BrendaMood, type BrendaTone } from "@/components/app/brenda-face";
import { useReadAlong } from "@/components/app/brenda-chat";
import { attention, STATES, type BrendaEmote, type BrendaState } from "@/lib/brenda-character/engine";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const EMOTES: BrendaEmote[] = ["love", "wink", "proud", "surprised", "yawn", "happy", "pleased", "annoyed", "celebrate"];
const MOODS: BrendaMood[] = [null, "happy", "think", "listen", "alert", "sad"];

const SENTENCE = "Move my three o'clock with Josh to tomorrow morning and let him know why.";
const PARAGRAPH = "Notes from Monday: the launch moves to the 14th, Ada owns the checklist, David reviews the copy by Friday, and everyone clocks in before the stand-up.";

/** A made-up voice for the listening demo: syllables about four a second inside words, with pauses between them. */
const speech = () => {
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
          <BrendaCharacter ref={character} state={state} size={120} interactive level={speech} className={cn(mono(state))} />
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
