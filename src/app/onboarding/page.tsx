import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth";
import { AuthShell, AUTH_LINK } from "@/components/auth/auth-shell";
import { OnboardingForm } from "@/components/app/onboarding-form";
import { Alert } from "@/components/ui/states";
import { registrationOpen } from "@/server/admin/settings";
import { workspaceAllowance } from "@/server/services/workspace-limit";

export const metadata = { title: "Create workspace" };

/**
 * Creating a workspace. A calm two-step form (the form draws its own heading with the step count); when a new
 * workspace cannot be created (the waitlist, or the plan's limit) the page says so instead of showing the form.
 */
export default async function OnboardingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/onboarding");
  if (!user.emailVerified) redirect("/verify/pending?next=/onboarding");
  const [allowance, open] = await Promise.all([workspaceAllowance(user.profileId), registrationOpen()]);
  const full = allowance.limit !== null && allowance.used >= allowance.limit;
  const back = <Link className={AUTH_LINK} href="/app?switch=1">Back to your workspaces</Link>;
  // Said instead of the form, not after it: creating a workspace is refused while Boredroom is on its waitlist.
  if (!open) {
    return (
      <AuthShell title="Create your workspace" subtitle="You will be its first owner." footer={back}>
        <Alert tone="info" title="New workspaces are not open yet">Boredroom is letting organisations in from the waitlist, so a new workspace cannot be created yet. To join an existing organisation, <Link className={AUTH_LINK} href="/join">enter its code</Link>.</Alert>
      </AuthShell>
    );
  }
  if (full) {
    return (
      <AuthShell title="Create your workspace" subtitle="You will be its first owner." footer={back}>
        <Alert tone="warning">Your {allowance.plan} plan allows {allowance.limit} workspace{allowance.limit === 1 ? "" : "s"} and you already own {allowance.used}.{allowance.nextPlan ? ` Move one of your workspaces to ${allowance.nextPlan} from its Settings page to own more.` : ""}</Alert>
      </AuthShell>
    );
  }
  return (
    <AuthShell footer={back}>
      <OnboardingForm />
    </AuthShell>
  );
}
