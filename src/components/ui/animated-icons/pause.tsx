"use client";

// lucide-animated's "pause" (MIT, ./LICENSE), on lucide-react's drawing of Pause.
import { motion, type Variants } from "motion/react";
import { createAnimatedIcon } from "./adapter";

const press = (y: number[]): Variants => ({ normal: { y: 0 }, animate: { y, transition: { times: [0, 0.2, 0.5, 1], duration: 0.5 } } });

export const AnimatedPause = createAnimatedIcon({
  name: "pause",
  children: (
    <>
      <motion.rect x="14" y="3" width="5" height="18" rx="1" variants={press([0, 0, 2, 0])} />
      <motion.rect x="5" y="3" width="5" height="18" rx="1" variants={press([0, 2, 0, 0])} />
    </>
  ),
});
