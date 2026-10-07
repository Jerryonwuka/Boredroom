"use client";

// lucide-animated's "calendar-check" (MIT, ./LICENSE), on lucide-react's drawing of CalendarCheck.
import { motion, type Variants } from "motion/react";
import { createAnimatedIcon } from "./adapter";

const CHECK: Variants = {
  normal: { pathLength: 1, opacity: 1, transition: { duration: 0.3 } },
  animate: { pathLength: [0, 1], opacity: [0, 1], transition: { pathLength: { duration: 0.4, ease: "easeInOut" }, opacity: { duration: 0.4, ease: "easeInOut" } } },
};

export const AnimatedCalendarCheck = createAnimatedIcon({
  name: "calendar-check",
  children: (
    <>
      <path d="M8 2v3" />
      <path d="M16 2v3" />
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18" />
      <motion.path d="m9 15 2 2 4-4" variants={CHECK} />
    </>
  ),
});
