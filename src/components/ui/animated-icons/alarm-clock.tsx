"use client";

// lucide-animated's "alarm-clock" (MIT, ./LICENSE), on lucide-react's drawing of AlarmClock.
import { motion, type Variants } from "motion/react";
import { createAnimatedIcon } from "./adapter";

const SPRING = { duration: 0.2, type: "spring", stiffness: 200, damping: 25 } as const;
// lucide-animated rings it forever while hovered; here it rings once (no loops) and stays lifted.
const BODY: Variants = {
  normal: { y: 0, x: 0, transition: SPRING },
  animate: { y: -1.5, x: [0, -1, 1, -1, 1, -1, 0], transition: { y: SPRING, x: { duration: 0.6, ease: "linear" } } },
};
const BELLS: Variants = {
  normal: { y: 0, x: 0, transition: SPRING },
  animate: { y: -2.5, x: [0, -2, 2, -2, 2, -2, 0], transition: { y: SPRING, x: { duration: 0.6, ease: "linear" } } },
};

export const AnimatedAlarmClock = createAnimatedIcon({
  name: "alarm-clock",
  overflow: true,
  children: (
    <>
      <motion.g variants={BODY}>
        <circle cx="12" cy="13" r="8" />
        <path d="M12 9v4l2 2" />
        <path d="M6.38 18.7 4 21" />
        <path d="M17.64 18.67 20 21" />
      </motion.g>
      <motion.g variants={BELLS}>
        <path d="M5 3 2 6" />
        <path d="m22 6-3-3" />
      </motion.g>
    </>
  ),
});
