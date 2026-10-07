"use client";

// lucide-animated's "play" (MIT, ./LICENSE), on lucide-react's drawing of Play.
import { motion } from "motion/react";
import { createAnimatedIcon } from "./adapter";

export const AnimatedPlay = createAnimatedIcon({
  name: "play",
  children: (
    <motion.path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"
      variants={{ normal: { x: 0, rotate: 0 }, animate: { x: [0, -1, 2, 0], rotate: [0, -10, 0, 0], transition: { duration: 0.5, times: [0, 0.2, 0.5, 1] } } }} />
  ),
});
