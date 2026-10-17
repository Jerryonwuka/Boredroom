"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { MOODS } from "@/components/landing/hero-assistants";
import { onIdle, useMotionPaused, usePrefersReducedMotion } from "@/components/landing/hero-stage";
import type { AssistantColour } from "@/lib/assistant-look";
import { cn } from "@/lib/utils";

/** Her canvas, loaded after paint (the hero's picture never waits for it). */
const Character = dynamic(() => import("@/components/app/brenda-character").then((m) => m.BrendaCharacter), { ssr: false });

/**
 * One Brenda perched on a hero picture (owner feedback, 17 October 2026: pages v2: "the hero Brendas"), as the home
 * hero draws them: her own visor and eyes, the mood the home carousel gives her colour (MOODS), her own light, quiet
 * and not interactive. Mounted at the first idle moment into a box reserved at `size`, so nothing shifts; still under
 * reduced motion and while the page's motion is paused. Decorative: `aria-hidden` (the picture's description covers her).
 */
export function HeroBrenda({ colour = "teal", size = 120, className }: { colour?: AssistantColour; size?: number; className?: string }) {
  const [ready, setReady] = useState(false);
  const reduced = usePrefersReducedMotion();
  const paused = useMotionPaused();
  useEffect(() => onIdle(() => setReady(true)), []);
  const mood = MOODS[colour];
  return (
    <div aria-hidden className={cn("pointer-events-none", className)} style={{ width: size, height: size }}>
      {ready ? (
        <Character size={size} look={{ colour, visor: "bean", eyes: "pill" }} state={mood.state} face={mood.face ?? null}
          glow="own-always" quiet interactive={false} still={reduced || paused} />
      ) : null}
    </div>
  );
}
