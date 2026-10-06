import Link from "next/link";
import { Lock } from "lucide-react";
import { FEATURE_LABELS } from "@/lib/plans";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ToolSquare } from "@/components/ui/tool-tile";

/** "Screen recording" reads as "screen recording" mid-sentence; "AI assistant" and "API access" keep their capitals. */
const midSentence = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

/**
 * What a member sees on a module their plan does not include (owner decision, 25 September 2026: modules follow
 * the plan). Owners get the button to the plan page; everyone else is told who to ask. Nothing about the module is
 * hidden or deleted; it waits behind the plan.
 * v4: an empty state, centred, with no card: a lock in the tool square, a neutral badge naming the plan that has it,
 * the page title (display 24/30), one line of why, and the upgrade in the accent (the screen's one orange action).
 */
export function UpgradeGate({ feature, orgSlug, planName, upgradeTo, isOwner, lapsed }: { feature: string; orgSlug: string; planName: string | null; upgradeTo: string | null; isOwner: boolean; lapsed?: boolean }) {
  const what = FEATURE_LABELS[feature] ?? feature.replace(/_/g, " ").toLowerCase();
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-2 pb-12 pt-16 text-center">
      <ToolSquare size={48}><Lock aria-hidden /></ToolSquare>
      <Badge className="mt-6">{upgradeTo ? `Part of ${upgradeTo}` : "Not on this plan"}</Badge>
      {/* The gate stands in for the whole page, so its title is the page's heading. */}
      <h1 className="type-page-title mt-3">The {planName ?? "current"} plan does not include {midSentence(what)}</h1>
      <p className="mt-2 text-balance text-sm font-normal text-secondary">{lapsed ? "The paid plan has ended, so this module is paused. Everything it recorded is kept and comes back the moment the plan renews." : upgradeTo ? `Move this workspace to ${upgradeTo} and ${midSentence(what)} switches on at once, with nothing to set up.` : "Ask the platform team about a plan that includes it."}</p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        {isOwner ? <Link href={`/app/${orgSlug}/settings?section=billing&billing=1#billing`} className={buttonVariants({ variant: "accent" })}>{lapsed ? "Renew the plan" : upgradeTo ? `See ${upgradeTo}` : "See plans"}</Link> : null}
        <Link href={`/app/${orgSlug}/home`} className={buttonVariants({ variant: "secondary" })}>Back to Brenda</Link>
      </div>
      {isOwner ? null : <p className="mt-4 text-meta font-normal text-secondary">Ask the organisation owner to change the plan.</p>}
    </div>
  );
}
