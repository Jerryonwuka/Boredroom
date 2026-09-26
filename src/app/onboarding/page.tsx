import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth";
import { AuthShell } from "@/components/auth/auth-shell";
import Link from "next/link";
import { OnboardingForm } from "@/components/app/onboarding-form";
import { Alert } from "@/components/ui/states";
import { workspaceAllowance } from "@/server/services/workspace-limit";

export const metadata = { title: "Create workspace" };

export default async function OnboardingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/onboarding");
  if (!user.emailVerified) redirect("/verify/pending?next=/onboarding");
  const allowance = await workspaceAllowance(user.profileId);
  const full = allowance.limit !== null && allowance.used >= allowance.limit;
  return (
    <AuthShell title="Create your workspace" subtitle="You will be its first owner. Time zone and schedule can be changed later in Settings.">
      {full ? (
        <Alert tone="warning">Your {allowance.plan} plan allows {allowance.limit} workspace{allowance.limit === 1 ? "" : "s"} and you already own {allowance.used}.{allowance.nextPlan ? ` Move one of your workspaces to ${allowance.nextPlan} from its Settings page to own more.` : ""} <Link href="/app" className="underline">Back to your workspaces</Link></Alert>
      ) : <OnboardingForm />}
    </AuthShell>
  );
}
