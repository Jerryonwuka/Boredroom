"use client";

/**
 * Development gallery of Brenda's character: every state, and the passing expressions on request. v4: drawn as on her
 * home screen (monochrome; the accent only while she listens), on section and stat cards.
 */
import { useRef, useState } from "react";
import { notFound } from "next/navigation";
import { BrendaCharacter, type BrendaCharacterHandle } from "@/components/app/brenda-character";
import { BrendaFace, type BrendaMood } from "@/components/app/brenda-face";
import { STATES, type BrendaEmote, type BrendaState } from "@/lib/brenda-character/engine";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const EMOTES: BrendaEmote[] = ["love", "wink", "proud", "surprised", "yawn", "happy", "annoyed", "celebrate"];
const MOODS: BrendaMood[] = [null, "happy", "think", "listen", "alert", "sad"];

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
