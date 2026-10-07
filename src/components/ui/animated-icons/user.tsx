"use client";

// lucide-animated's "user" (MIT, ./LICENSE), on lucide-react's drawing of User.
import { motion } from "motion/react";
import { createAnimatedIcon } from "./adapter";

export const AnimatedUser = createAnimatedIcon({
  name: "user",
  children: (
    <>
      <motion.path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" transition={{ delay: 0.2, duration: 0.4 }}
        variants={{ normal: { pathLength: 1, opacity: 1, pathOffset: 0 }, animate: { pathLength: [0, 1], opacity: [0, 1], pathOffset: [1, 0] } }} />
      <motion.circle cx="12" cy="7" r="4" variants={{ normal: { pathLength: 1, pathOffset: 0, scale: 1 }, animate: { pathLength: [0, 1], pathOffset: [1, 0], scale: [0.5, 1] } }} />
    </>
  ),
});
