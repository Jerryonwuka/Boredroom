"use client";

// lucide-animated's "calendar-days" (MIT, ./LICENSE), on lucide-react's drawing of CalendarDays.
import { motion, type Variants } from "motion/react";
import { createAnimatedIcon } from "./adapter";

const DOTS = ["M8 13h.01", "M12 13h.01", "M16 13h.01", "M8 17h.01", "M12 17h.01", "M16 17h.01"];
const DOT: Variants = {
  normal: { opacity: 1, transition: { duration: 0.2 } },
  animate: (i: number) => ({ opacity: [1, 0.3, 1], transition: { delay: i * 0.1, duration: 0.4, times: [0, 0.5, 1] } }),
};

export const AnimatedCalendarDays = createAnimatedIcon({
  name: "calendar-days",
  children: (
    <>
      <path d="M8 2v3" />
      <path d="M16 2v3" />
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18" />
      {DOTS.map((d, i) => <motion.path key={d} d={d} custom={i} variants={DOT} />)}
    </>
  ),
});
