"use client";

/**
 * Pause for the landing page's moving strips (WCAG 2.2.2: anything that moves for more than five seconds needs a way to
 * stop it). Hover already pauses a strip; this button pauses them all, for keyboard and touch too, by setting
 * <html data-motion="paused"> (globals.css §6). Pressing it again lets them move. Reduced motion stops them anyway.
 * A plain action button whose name says what it will do (review fix, 10 October 2026: with aria-pressed as well, the
 * changing name and the pressed state contradicted each other).
 */
import { useSyncExternalStore } from "react";
import { Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";

const subscribe = (cb: () => void) => {
  const o = new MutationObserver(cb);
  o.observe(document.documentElement, { attributes: true, attributeFilter: ["data-motion"] });
  return () => o.disconnect();
};
const read = () => document.documentElement.dataset.motion === "paused";

export function PauseMotion({ className }: { className?: string }) {
  const paused = useSyncExternalStore(subscribe, read, () => false);
  const toggle = () => { if (paused) delete document.documentElement.dataset.motion; else document.documentElement.dataset.motion = "paused"; };
  return (
    <button type="button" onClick={toggle} aria-label={paused ? "Play the moving examples" : "Pause the moving examples"}
      className={cn("inline-flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-secondary transition-colors duration-75 hover:bg-fill-1 hover:text-foreground motion-reduce:hidden [&_svg]:size-3.5", className)}>
      {paused ? <Play aria-hidden /> : <Pause aria-hidden />}{paused ? "Play" : "Pause"}
    </button>
  );
}
