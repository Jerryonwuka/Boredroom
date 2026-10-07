"use client";

// lucide-animated's "chevron-down" (MIT, ./LICENSE), on lucide-react's drawing of ChevronDown.
import { motion } from "motion/react";
import { createAnimatedIcon } from "./adapter";

export const AnimatedChevronDown = createAnimatedIcon({
  name: "chevron-down",
  children: <motion.path d="m6 9 6 6 6-6" transition={{ times: [0, 0.4, 1], duration: 0.5 }} variants={{ normal: { y: 0 }, animate: { y: [0, 2, 0] } }} />,
});
