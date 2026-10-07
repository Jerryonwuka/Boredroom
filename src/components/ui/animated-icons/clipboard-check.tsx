"use client";

// lucide-animated's "clipboard-check" (MIT, ./LICENSE), on lucide-react's drawing of ClipboardCheck.
import { motion, type Variants } from "motion/react";
import { createAnimatedIcon } from "./adapter";

// lucide-animated rests with the tick hidden; here it rests drawn, as lucide's icon is, and redraws on hover.
const TICK: Variants = {
  normal: { pathLength: 1, opacity: 1, transition: { duration: 0.3 } },
  animate: { pathLength: [0, 1], opacity: [0, 1], transition: { pathLength: { duration: 0.3, ease: "easeInOut" }, opacity: { duration: 0.3, ease: "easeInOut" } } },
};

export const AnimatedClipboardCheck = createAnimatedIcon({
  name: "clipboard-check",
  children: (
    <>
      <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <motion.path d="m9 14 2 2 4-4" variants={TICK} />
    </>
  ),
});
