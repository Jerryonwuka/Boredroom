import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { heroButton, type LandingCopy } from "@/components/landing/hero";
import { WaitlistForm } from "@/components/landing/waitlist-form";
import { WRAP } from "@/components/landing/parts";

/**
 * The closing call to action, at the foot of the home page and of every public page (owner request, 17 October 2026:
 * SEO analysis: one close for the whole site, so the nav's "Join the waitlist" always has the form to go to). Moved here
 * from the home page unchanged: in waitlist mode (owner decision, 25 September 2026) copy on the left and the waitlist
 * form on the right, signed in too, so the hero pill's link always reaches it (owner request, 10 October 2026); the admin's
 * landing copy replaces the headline, the line and the button's words. Otherwise the headline and the launch-aware
 * buttons: Open your workspace signed in, Log in in maintenance, else Get started and Join with a code. White buttons
 * only (the landing's buttons are all white).
 */
export function ClosingCta({ waitlist, maintenance, signedIn, copy, sourceFromPath = false }: {
  waitlist: boolean; maintenance: boolean; signedIn: boolean; copy: LandingCopy;
  /** Store the page's path as the waitlist entry's source (the public pages); the home page keeps "landing". */
  sourceFromPath?: boolean;
}) {
  return (
    <section aria-labelledby="close-title" className="pt-8 sm:pt-12">
      <div className={WRAP}>
        <div className="lp-reveal rounded-[22px] border border-border bg-fill-0 px-5 py-12 sm:rounded-[28px] sm:px-12 sm:py-20">
          {waitlist ? (
            <div className="grid items-center gap-10 md:grid-cols-[1.05fr_0.95fr] md:gap-14">
              <div className="min-w-0">
                <h2 id="close-title" className="lp-h2 lg:text-[56px] lg:leading-[60px]">{copy.headline || <>Know what your<br className="max-sm:hidden" /> remote team is doing</>}</h2>
                <p className="lp-sub mt-5 max-w-lg">{copy.subheadline || "Boredroom is opening soon. Leave your details and you get one email the morning it opens, with a code for your team."}</p>
                <Badge size="lg" dot className="mt-6">Opening soon</Badge>
              </div>
              <div className="w-full min-w-0 rounded-[20px] border border-border bg-background p-5 shadow-chart sm:p-6 md:max-w-md md:justify-self-end">
                <WaitlistForm cta={copy.cta || "Join the waitlist"} sourceFromPath={sourceFromPath} />
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl text-center">
              <h2 id="close-title" className="lp-display">Know what your<br className="max-sm:hidden" /> remote team is doing</h2>
              <p className="lp-lead mx-auto mt-6 max-w-xl">Create a workspace, share one code, and everyone meets their own Brenda the first time they come in.</p>
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                {signedIn ? <Link href="/app" className={heroButton("primary")}>Open your workspace</Link>
                  : maintenance ? <Link href="/login" className={heroButton("primary")}>Log in</Link>
                  : <Link href="/signup?intent=org" className={heroButton("primary")}>Get started</Link>}
                {maintenance && !signedIn ? null : <Link href="/join" className={heroButton("secondary")}>Join with a code</Link>}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
