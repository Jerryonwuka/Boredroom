"use client";

// lucide-animated's "message-square" (MIT, ./LICENSE), on lucide-react's drawing of MessageSquare.
import { createAnimatedIcon } from "./adapter";

export const AnimatedMessageSquare = createAnimatedIcon({
  name: "message-square",
  variants: {
    normal: { scale: 1, rotate: 0 },
    animate: { scale: 1.05, rotate: [0, -7, 7, 0], transition: { rotate: { duration: 0.5, ease: "easeInOut" }, scale: { type: "spring", stiffness: 400, damping: 10 } } },
  },
  children: <path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" />,
});
