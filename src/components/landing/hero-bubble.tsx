/**
 * A hero Brenda's speech bubble (owner request, 10 October 2026: "when we click on each one, a word in a word bubble
 * floats up from them and then disappears"). Her short line from MOODS rises from her head, holds about 1.4 s and fades
 * as it floats on up (hero-bubble.module.css); it is drawn inside her slot in the carousel, so it never takes the pointer
 * and moves with her. Hidden from assistive technology: the stage's live region reads the same words (hero-stage.tsx).
 * `onDone` fires when its run ends, so the carousel can let it go.
 */
import type { CSSProperties } from "react";
import { PALETTE, type AssistantColour } from "@/lib/assistant-look";
import { MOODS } from "@/components/landing/hero-assistants";
import styles from "./hero-bubble.module.css";

export function HeroBubble({ colour, onDone }: { colour: AssistantColour; onDone: () => void }) {
  return (
    <span aria-hidden className={styles.bubble} style={{ "--bubble-tint": PALETTE[colour].sphere.mid } as CSSProperties}
      onAnimationEnd={(e) => { if (e.target === e.currentTarget) onDone(); }}>
      {MOODS[colour].says}
    </span>
  );
}
