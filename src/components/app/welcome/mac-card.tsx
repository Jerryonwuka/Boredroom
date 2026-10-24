"use client";

/**
 * Boredroom for Mac on "You're all set" (owner request, 11 October 2026: the first-run welcome, D15; contract 5.7). Offered
 * last, and only on a Mac (a desktop browser on macOS: an iPad says Macintosh too, but has touch points), read after
 * hydration so the server's page never guesses. "Get the Mac app" when the download is offered (DESKTOP_DOWNLOAD_URL, or
 * the releases default): to /download (24 October 2026), which has the first-open steps an app not yet signed by Apple
 * needs, with "Already have Boredroom for Mac? Link it with a code" under it; with the download off, the link alone.
 * Never in a replay (the flow leaves it out), and never inside Boredroom for Mac's own window: the person already has it
 * (owner request, 24 October 2026: option A).
 */
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { LazyFace } from "@/components/app/welcome/lazy-face";
import type { AssistantLook } from "@/lib/assistant-look";
import { useIsDesktopApp, useIsMac } from "@/lib/use-is-mac";
import { WELCOME_WORDS } from "@/lib/welcome";

const M = WELCOME_WORDS.mac;

export { useIsMac };

export function MacCard({ name, look, downloadUrl }: { name: string; look: AssistantLook; downloadUrl: string | null }) {
  const mac = useIsMac();
  const inApp = useIsDesktopApp();
  if (!mac || inApp) return null;
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
        {downloadUrl
          ? <p className="mt-1 text-meta font-normal text-secondary">{M.have} <Link href="/desktop/link" className="link-inline">{M.link}</Link></p>
          : <p className="mt-1 text-meta font-normal text-secondary">{M.have}</p>}
      </div>
      {downloadUrl ? (
        <Link href="/download" className={buttonVariants({ variant: "outline", size: "sm" })}>{M.get}</Link>
      ) : (
        <Link href="/desktop/link" className={buttonVariants({ variant: "outline", size: "sm" })}>{M.link}</Link>
      )}
    </section>
  );
}
