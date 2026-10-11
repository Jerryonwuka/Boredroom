"use client";

/**
 * Brenda for Mac on "You're all set" (owner request, 11 October 2026: the first-run welcome, D15; contract 5.7). Offered
 * last, and only on a Mac (a desktop browser on macOS: an iPad says Macintosh too, but has touch points), read after
 * hydration so the server's page never guesses. "Get the Mac app" when the download address is set (DESKTOP_DOWNLOAD_URL),
 * else, for someone who already has it, "Link it" (/desktop/link). Never in a replay (the flow leaves it out).
 */
import { useSyncExternalStore } from "react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { LazyFace } from "@/components/app/welcome/lazy-face";
import type { AssistantLook } from "@/lib/assistant-look";
import { WELCOME_WORDS } from "@/lib/welcome";

const M = WELCOME_WORDS.mac;
const noop = () => () => undefined;
const isMac = () => /Macintosh|Mac OS X/.test(navigator.userAgent) && navigator.maxTouchPoints < 2;

/** A desktop Mac (after hydration; false on the server). */
export function useIsMac(): boolean {
  return useSyncExternalStore(noop, isMac, () => false);
}

export function MacCard({ name, look, downloadUrl }: { name: string; look: AssistantLook; downloadUrl: string | null }) {
  const mac = useIsMac();
  if (!mac) return null;
  return (
    <section aria-labelledby="welcome-mac-title" className="mt-8 flex flex-wrap items-start gap-x-4 gap-y-3 border-t border-border pt-6">
      {/* A screen's top edge with the notch, her face in it. */}
      <span aria-hidden className="relative grid size-10 shrink-0 justify-items-center overflow-hidden rounded-xl border border-border bg-fill-0">
        <span className="grid h-[22px] w-8 place-items-center rounded-b-[9px] bg-black">
          <LazyFace size="sm" look={look} quiet />
        </span>
      </span>
      <div className="min-w-0 flex-1 basis-56">
        <h2 id="welcome-mac-title" className="text-sm font-semibold text-foreground">{M.title}</h2>
        <p className="text-sm font-normal text-secondary">{M.line(name)}</p>
        {downloadUrl ? null : <p className="mt-1 text-meta font-normal text-secondary">{M.have}</p>}
      </div>
      {downloadUrl ? (
        <a href={downloadUrl} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline", size: "sm" })}>{M.get}</a>
      ) : (
        <Link href="/desktop/link" className={buttonVariants({ variant: "outline", size: "sm" })}>{M.link}</Link>
      )}
    </section>
  );
}
