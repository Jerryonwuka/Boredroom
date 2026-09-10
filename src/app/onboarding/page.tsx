import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth";
import { AuthShell } from "@/components/auth/auth-shell";
import { OnboardingForm } from "@/components/app/onboarding-form";

export const metadata = { title: "Create workspace" };

export default async function OnboardingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/onboarding");
  if (!user.emailVerified) redirect("/verify/pending?next=/onboarding");
  return (
    <AuthShell title="Create your workspace" subtitle="You will be its first owner. Time zone and schedule can be changed later in Settings.">
      <OnboardingForm />
    </AuthShell>
  );
}
