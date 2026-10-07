"use client";

// Boredroom's own animation for lucide's MessagesSquare (lucide-animated has none), in the same idiom.
import { motion } from "motion/react";
import { createAnimatedIcon } from "./adapter";

// The front bubble wiggles, as message-square's does.
export const AnimatedMessagesSquare = createAnimatedIcon({
  name: "messages-square",
  children: (
    <>
      <motion.path d="M16 10a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 14.286V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"
        variants={{ normal: { rotate: 0 }, animate: { rotate: [0, -7, 7, 0], transition: { duration: 0.5, ease: "easeInOut" } } }} />
      <path d="M20 9a2 2 0 0 1 2 2v10.286a.71.71 0 0 1-1.212.502l-2.202-2.202A2 2 0 0 0 17.172 19H10a2 2 0 0 1-2-2v-1" />
    </>
  ),
});
