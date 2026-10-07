"use client";

// lucide-animated's "chevron-left" (MIT, ./LICENSE), on lucide-react's drawing of ChevronLeft.
import { motion } from "motion/react";
import { createAnimatedIcon } from "./adapter";

export const AnimatedChevronLeft = createAnimatedIcon({
  name: "chevron-left",
  children: <motion.path d="m15 18-6-6 6-6" transition={{ times: [0, 0.4, 1], duration: 0.5 }} variants={{ normal: { x: 0 }, animate: { x: [0, -2, 0] } }} />,
});
