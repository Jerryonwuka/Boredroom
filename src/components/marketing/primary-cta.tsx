import Link from "next/link";
import { heroButton } from "@/components/landing/hero";
import { WaitlistLink } from "@/components/landing/waitlist-link";
import { getLaunchState } from "@/components/marketing/launch";

/**
 * The page's main call to action, right for the launch mode (owner request, 17 October 2026: SEO analysis: every call to
 * action works in each mode, as the home page's do): signed in, Open your workspace; in waitlist mode, Join the waitlist
 * (to the form at the foot of the page, the admin's button words if set); in maintenance, Log in; otherwise Get started.
 * The white primary, as every landing button. `secondary` adds a second, outline link (e.g. to /pricing) after it.
 *
 *   <PageHero path="/features/ai-assistant"><PrimaryCta secondary={{ href: "/pricing", label: "See pricing" }} /></PageHero>
 */
export async function PrimaryCta({ secondary }: { secondary?: { href: string; label: string } }) {
  const { signedIn, waitlist, maintenance, copy } = await getLaunchState();
  return (
    <>
      {signedIn ? <Link href="/app" className={heroButton("primary")}>Open your workspace</Link>
        : waitlist ? <WaitlistLink className={heroButton("primary")}>{copy.cta || "Join the waitlist"}</WaitlistLink>
        : maintenance ? <Link href="/login" className={heroButton("primary")}>Log in</Link>
        : <Link href="/signup?intent=org" className={heroButton("primary")}>Get started</Link>}
      {secondary ? <Link href={secondary.href} className={heroButton("secondary")}>{secondary.label}</Link> : null}
    </>
  );
}
