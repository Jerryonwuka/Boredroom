"use client";

// lucide-animated's "sun" (MIT, ./LICENSE), on lucide-react's drawing of Sun.
import { motion, type Variants } from "motion/react";
import { createAnimatedIcon } from "./adapter";

// The rays, clockwise from the top, light up one after another.
const RAYS = ["M12 2v2", "m19.07 4.93-1.41 1.41", "M20 12h2", "m17.66 17.66 1.41 1.41", "M12 20v2", "m6.34 17.66-1.41 1.41", "M2 12h2", "m4.93 4.93 1.41 1.41"];
const RAY: Variants = { normal: { opacity: 1 }, animate: (i: number) => ({ opacity: [0, 1], transition: { delay: i * 0.1, duration: 0.3 } }) };

export const AnimatedSun = createAnimatedIcon({
  name: "sun",
  children: (
    <>
      <circle cx="12" cy="12" r="4" />
      {RAYS.map((d, i) => <motion.path key={d} d={d} custom={i + 1} variants={RAY} />)}
    </>
  ),
});
