"use client";

// Boredroom's own animation for lucide's ListTodo (lucide-animated has none), in the same idiom.
import { motion } from "motion/react";
import { createAnimatedIcon } from "./adapter";

// The box is pressed and the tick below is drawn again: a to-do done.
export const AnimatedListTodo = createAnimatedIcon({
  name: "list-todo",
  children: (
    <>
      <path d="M13 5h8" />
      <path d="M13 12h8" />
      <path d="M13 19h8" />
      <motion.path d="m3 17 2 2 4-4" variants={{ normal: { pathLength: 1, opacity: 1 }, animate: { pathLength: [0, 1], opacity: [0, 1], transition: { delay: 0.15, duration: 0.35, ease: "easeInOut" } } }} />
      <motion.rect x="3" y="4" width="6" height="6" rx="1" variants={{ normal: { scale: 1 }, animate: { scale: [1, 0.8, 1], transition: { duration: 0.3, ease: "easeInOut" } } }} />
    </>
  ),
});
