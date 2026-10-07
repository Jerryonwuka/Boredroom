"use client";

// lucide-animated's "users-round" (MIT, ./LICENSE), on lucide-react's drawing of UsersRound.
import { motion } from "motion/react";
import { createAnimatedIcon } from "./adapter";

export const AnimatedUsersRound = createAnimatedIcon({
  name: "users-round",
  children: (
    <>
      <path d="M18 21a8 8 0 0 0-16 0" />
      <circle cx="10" cy="8" r="5" />
      <motion.path d="M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3" variants={{
        normal: { x: 0, opacity: 1, transition: { type: "spring", stiffness: 200, damping: 13 } },
        animate: { x: [-4, 0], opacity: [0, 1], transition: { delay: 0.1, type: "spring", stiffness: 200, damping: 13 } },
      }} />
    </>
  ),
});
