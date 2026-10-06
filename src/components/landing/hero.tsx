import Link from "next/link";
import Image from "next/image";
import { ChevronRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { WaitlistLink } from "@/components/landing/waitlist-link";
import { HeroFrame } from "@/components/landing/hero-frame";
import { WRAP } from "@/components/landing/parts";
import { cn } from "@/lib/utils";

export type LandingCopy = { headline: string; subheadline: string; cta: string };

/** The faces in the trust pill above the headline; served from public/users. */
const USERS = [1, 2, 3, 4, 5].map((n) => `/users/user-${n}.jpg`);

/** The hero's buttons: the v4 lg button a little larger for the page (44px, 15px). */
export const heroButton = (variant: "primary" | "secondary" | "accent") => cn(buttonVariants({ variant, size: "lg" }), "h-11 px-5 text-[15px]");

/**
 * The hero, v4 (owner request, 6 October 2026): a quiet pill, the display headline (Geist 400, 40 → 72px, tight, white),
 * the 18/28 line under it, the call to action and an outline "How it works", then the product itself (HeroFrame).
 * The call to action is the screen's one orange button only in waitlist mode (joining the waitlist is the one thing to
 * do); signed in, or when the app is open, it is the white primary. In waitlist mode the form lives in the closing
 * section (#waitlist) and the hero points there. Server-rendered: the copy paints with the HTML, nothing waits for JS.
 */
export function Hero({ signedIn, waitlist = false, copy = { headline: "", subheadline: "", cta: "" } }: { signedIn: boolean; waitlist?: boolean; copy?: LandingCopy }) {
  const pill = "inline-flex h-8 max-w-full items-center gap-2 rounded-full border border-border-input bg-background py-1 pl-1 pr-2.5 text-meta font-medium text-secondary transition-colors duration-75 hover:border-border-input-hover hover:text-foreground";
  const pillBody = (
    <>
      <span className="flex shrink-0 -space-x-1.5" aria-hidden>
        {USERS.map((src, i) => <Image key={src} src={src} alt="" width={22} height={22} loading="eager" className="relative size-[22px] rounded-full object-cover ring-2 ring-background" style={{ zIndex: USERS.length - i }} />)}
      </span>
      <span className="truncate">{waitlist ? "Opening soon. Join the waitlist." : <>Trusted by <strong className="font-semibold text-foreground">10k+</strong> users.</>}</span>
      <ChevronRight className="size-3.5 shrink-0" aria-hidden />
    </>
  );
  return (
    <section aria-labelledby="hero-title" className="pt-14 sm:pt-20 lg:pt-24">
      <div className={cn(WRAP, "text-center")}>
        {waitlist ? <WaitlistLink className={pill}>{pillBody}</WaitlistLink> : <Link href="/signup?intent=org" className={pill}>{pillBody}</Link>}
        <h1 id="hero-title" className="lp-display mx-auto mt-6 max-w-4xl">
          {waitlist && copy.headline ? copy.headline : <>Know what your<br className="max-sm:hidden" /> team is doing</>}
        </h1>
        <p className="lp-lead mx-auto mt-5 max-w-[640px]">
          {waitlist && copy.subheadline ? copy.subheadline : "What people plan, the time they put in, what they deliver and what their lead accepts, in one place, live. Without check-in calls, and without a productivity score."}
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          {signedIn ? <Link href="/app" className={heroButton("primary")}>Open your workspace</Link>
            : waitlist ? <WaitlistLink className={heroButton("accent")}>{copy.cta || "Join the waitlist"}</WaitlistLink>
            : <Link href="/signup?intent=org" className={heroButton("primary")}>Get started</Link>}
          <a href="#how" className={heroButton("secondary")}>How it works</a>
        </div>
      </div>
      <div className={cn(WRAP, "mt-14 sm:mt-16")}>
        <HeroFrame />
      </div>
    </section>
  );
}
