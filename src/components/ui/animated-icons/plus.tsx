"use client";

// lucide-animated's "plus" (MIT, ./LICENSE), on lucide-react's drawing of Plus.
import { createAnimatedIcon } from "./adapter";

export const AnimatedPlus = createAnimatedIcon({
  name: "plus",
  variants: { normal: { rotate: 0 }, animate: { rotate: 180 } },
  transition: { type: "spring", stiffness: 100, damping: 15 },
  children: (
    <>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </>
  ),
});
