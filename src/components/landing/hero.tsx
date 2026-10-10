import Link from "next/link";
import Image from "next/image";
import { ChevronRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { WaitlistLink } from "@/components/landing/waitlist-link";
import { HeroStage } from "@/components/landing/hero-stage";
import { FlipLine } from "@/components/landing/flip-words";
import { HERO_WORDS } from "@/components/landing/hero-assistants";
import { cn } from "@/lib/utils";

export type LandingCopy = { headline: string; subheadline: string; cta: string };

/** The faces in the pill above the Brendas; served from public/users (owner request, 10 October 2026: keep them). */
const USERS = [1, 2, 3, 4, 5].map((n) => `/users/user-${n}.jpg`);

/** The hero's buttons: the v4 lg button a little larger for the page (44px, 15px). */
export const heroButton = (variant: "primary" | "secondary" | "accent") => cn(buttonVariants({ variant, size: "lg" }), "h-11 px-5 text-[15px]");

/** Two lines on a laptop, so the headline stays the page's largest paint at every size (review fix, 10 October 2026: "No
 * status meetings, no productivity score" moved out; the fairness section says it). */
const LEAD = "Everyone gets their own Brenda. She knows their day and answers “any update?” from their real work, so leads stop chasing.";
/** Phones: two lines, for the same reason. */
const LEAD_SHORT = "Each person's Brenda answers “any update?” from their real work, so leads stop chasing.";

/**
 * The hero (owner request, 10 October 2026, after the owner's mock): Brenda in every colour floating over a backdrop in
 * the colour of the one in front (HeroStage, the carousel), the headline "Know what your team is {doing}" with the flip
 * the live site had (FlipLine), the line about each person's own Brenda, the call to action and "How it works", then
 * the carousel's controls. Replaces the v4 hero of 6 October (its unsupported "10k+" claim, and the product frame, which
 * now illustrates "How it works"); the pill with the faces stays.
 *
 * The pill: the five faces (three below 380px), then in waitlist mode, signed out, "Opening soon. Join the waitlist.";
 * in maintenance the admin's notice, as plain text; otherwise the newest thing built, calls with Brenda's notes (review
 * fix, 10 October 2026: signed in there is no waitlist form to go to). Its words wrap rather than being cut off on the
 * narrowest phones. In maintenance sign-ups are off, so the call to action is Log in. The call to action is the screen's one orange button only in waitlist mode, signed out
 * (joining the waitlist is the one thing to do); signed in, or when the app is open, it is the white primary. The
 * admin's copy (Control Center, landingSettings) replaces the headline, the lead and the button's words in waitlist
 * mode; an admin headline is plain text, with no flip.
 *
 * Server-rendered: the backdrop in coral, the pill, the headline ("team is doing"), the lead and the buttons paint with
 * the HTML and nothing waits for script; the Brendas arrive after hydration.
 */
export function Hero({ signedIn, waitlist = false, maintenance = false, notice = "", copy = { headline: "", subheadline: "", cta: "" } }: {
  signedIn: boolean; waitlist?: boolean; maintenance?: boolean;
  /** The admin's maintenance notice (launch.message); a default when empty. */
  notice?: string;
  copy?: LandingCopy;
}) {
  // The pill as the v4 hero drew it, faces and all (owner feedback, 10 October 2026: "keep the pill with the faces"),
  // with an honest line: never a user count.
  const pillClass = "lp-hero-pill inline-flex min-h-8 max-w-full items-center gap-2 rounded-full border border-border-input py-1 pl-1 pr-2.5 text-left text-meta font-medium text-secondary transition-colors duration-75 hover:border-border-input-hover hover:text-foreground";
  const joinable = waitlist && !signedIn;
  const pillBody = (
    <>
      <span className="flex shrink-0 -space-x-1.5" aria-hidden>
        {USERS.map((src, i) => <Image key={src} src={src} alt="" width={22} height={22} loading="eager" className={cn("relative size-[22px] rounded-full object-cover ring-2 ring-background", i >= 3 && "max-[379px]:hidden")} style={{ zIndex: USERS.length - i }} />)}
      </span>
      <span className="min-w-0">{joinable ? "Opening soon. Join the waitlist." : maintenance ? notice || "Boredroom is under maintenance. New sign-ups are paused." : "New: calls, with Brenda's notes"}</span>
      {maintenance && !joinable ? null : <ChevronRight className="size-3.5 shrink-0" aria-hidden />}
    </>
  );
  const pill = joinable ? <WaitlistLink className={pillClass}>{pillBody}</WaitlistLink>
    : maintenance ? <p className={cn(pillClass, "hover:border-border-input hover:text-secondary")}>{pillBody}</p>
    : <a href="#calls" className={pillClass}>{pillBody}</a>;
  const override = waitlist && copy.headline ? copy.headline : null;

  return (
    <HeroStage pill={pill}>
      <h1 id="hero-title" className="lp-display lp-hero-title mx-auto max-w-4xl">
        {override ?? (
          <>
            <span className="sr-only">Know what your team is doing</span>
            <span aria-hidden>Know what your<br /><FlipLine prefix="team is" words={HERO_WORDS} /></span>
          </>
        )}
      </h1>
      <p className="lp-lead mx-auto mt-4 max-w-[640px] sm:mt-5">
        {waitlist && copy.subheadline ? copy.subheadline : <><span className="sm:hidden">{LEAD_SHORT}</span><span className="max-sm:hidden">{LEAD}</span></>}
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3 sm:mt-8">
        {signedIn ? <Link href="/app" className={heroButton("primary")}>Open your workspace</Link>
          : waitlist ? <WaitlistLink className={heroButton("accent")}>{copy.cta || "Join the waitlist"}</WaitlistLink>
          : maintenance ? <Link href="/login" className={heroButton("primary")}>Log in</Link>
          : <Link href="/signup?intent=org" className={heroButton("primary")}>Get started</Link>}
        <a href="#how" className={heroButton("secondary")}>How it works</a>
      </div>
    </HeroStage>
  );
}
