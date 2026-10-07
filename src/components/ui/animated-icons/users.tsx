"use client";

// lucide-animated's "users" (MIT, ./LICENSE), on lucide-react's drawing of Users.
import { motion, type Variants } from "motion/react";
import { createAnimatedIcon } from "./adapter";

const BEHIND: Variants = {
  normal: { x: 0, transition: { type: "spring", stiffness: 200, damping: 13 } },
  animate: { x: [-6, 0], transition: { delay: 0.1, type: "spring", stiffness: 200, damping: 13 } },
};

export const AnimatedUsers = createAnimatedIcon({
  name: "users",
  children: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <motion.path d="M16 3.128a4 4 0 0 1 0 7.744" variants={BEHIND} />
      <motion.path d="M22 21v-2a4 4 0 0 0-3-3.87" variants={BEHIND} />
      <circle cx="9" cy="7" r="4" />
    </>
  ),
});
