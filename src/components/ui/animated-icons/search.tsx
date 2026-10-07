"use client";

// lucide-animated's "search" (MIT, ./LICENSE), on lucide-react's drawing of Search.
import { createAnimatedIcon } from "./adapter";

export const AnimatedSearch = createAnimatedIcon({
  name: "search",
  variants: { normal: { x: 0, y: 0 }, animate: { x: [0, 0, -3, 0], y: [0, -4, 0, 0] } },
  transition: { duration: 1, bounce: 0.3 },
  children: (
    <>
      <path d="m21 21-4.34-4.34" />
      <circle cx="11" cy="11" r="8" />
    </>
  ),
});
