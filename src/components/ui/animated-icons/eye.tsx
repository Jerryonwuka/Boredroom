"use client";

// lucide-animated's "eye" (MIT, ./LICENSE), on lucide-react's drawing of Eye.
import { motion } from "motion/react";
import { createAnimatedIcon } from "./adapter";

const BLINK = { duration: 0.4, ease: "easeInOut" } as const;

export const AnimatedEye = createAnimatedIcon({
  name: "eye",
  children: (
    <>
      <motion.path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" transition={BLINK}
        variants={{ normal: { scaleY: 1, opacity: 1 }, animate: { scaleY: [1, 0.1, 1], opacity: [1, 0.3, 1] } }} />
      <motion.circle cx="12" cy="12" r="3" transition={BLINK} variants={{ normal: { scale: 1, opacity: 1 }, animate: { scale: [1, 0.3, 1], opacity: [1, 0.3, 1] } }} />
    </>
  ),
});
