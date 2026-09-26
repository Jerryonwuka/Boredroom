import Link from "next/link";
import { Lock } from "lucide-react";
import { FEATURE_LABELS } from "@/lib/plans";
import { Button } from "@/components/ui/button";

/**
 * What a member sees on a module their plan does not include (owner decision, 25 September 2026: modules follow
 * the plan). Owners get the button to the plan page; everyone else is told who to ask. Nothing about the module is
 * hidden or deleted; it waits behind the plan.
 */
export function UpgradeGate({ feature, orgSlug, planName, upgradeTo, isOwner, lapsed }: { feature: string; orgSlug: string; planName: string | null; upgradeTo: string | null; isOwner: boolean; lapsed?: boolean }) {
  const what = FEATURE_LABELS[feature] ?? feature.replace(/_/g, " ").toLowerCase();
  return (
    <div className="tile mx-auto mt-8 max-w-xl p-8 text-center">
      <span className="icon-tile mx-auto mb-5 size-14 rounded-2xl"><Lock className="size-6 text-accent" aria-hidden /></span>
      <p className="eyebrow eyebrow-accent">{upgradeTo ? `Part of ${upgradeTo}` : "Not on this plan"}</p>
      <h2 className="mt-2 font-display text-2xl">{what} is not on the {planName ?? "current"} plan</h2>
      <p className="mt-3 text-fg-muted">{lapsed ? "The paid plan has ended, so this module is paused. Everything it recorded is kept and comes back the moment the plan renews." : upgradeTo ? `Move this workspace to ${upgradeTo} and ${what.toLowerCase()} switches on at once, with nothing to set up.` : "Ask the platform team about a plan that includes it."}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {isOwner ? <Link href={`/app/${orgSlug}/settings?billing=1#billing`}><Button>{lapsed ? "Renew the plan" : upgradeTo ? `See ${upgradeTo}` : "See plans"}</Button></Link> : <p className="text-sm text-fg-subtle">Ask the organisation owner to change the plan.</p>}
        <Link href={`/app/${orgSlug}`}><Button variant="ghost">Back</Button></Link>
      </div>
    </div>
  );
}
