import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, Users } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { SignupForm } from "@/components/auth/forms";
import { getCurrentUser } from "@/server/auth";

export const metadata = { title: "Create account" };

/**
 * Two account types. An organisation account creates a workspace; a staff account can only be
 * created on the way into an organisation (join code, join link or email invitation).
 */
export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string; intent?: string }> }) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  if (user) redirect(sp.next && sp.next.startsWith("/") ? sp.next : "/app");
  const joining = !!sp.next && (sp.next.startsWith("/join/") || sp.next.startsWith("/invite/"));
  const creatingOrg = sp.intent === "org";
  if (!joining && !creatingOrg) {
    return (
      <AuthShell title="How are you joining Boredroom?" subtitle="Organisations create workspaces. Staff join through their organisation's code or link." footer={<>Already have an account? <Link className="text-fg underline" href="/login">Sign in</Link></>}>
        <div className="grid gap-3">
          <Link href="/signup?intent=org" className="tile flex items-start gap-4 p-4 hover:border-border-strong"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent text-accent-fg"><Building2 className="h-5 w-5" aria-hidden /></span><span><span className="block font-semibold">Create an organisation account</span><span className="text-sm text-fg-muted">Set up your company, its teams and team leads, and hand out a join code.</span></span></Link>
          <Link href="/join" className="tile flex items-start gap-4 p-4 hover:border-border-strong"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-accent text-accent"><Users className="h-5 w-5" aria-hidden /></span><span><span className="block font-semibold">Join my organisation</span><span className="text-sm text-fg-muted">I have a code or link from my organisation.</span></span></Link>
        </div>
      </AuthShell>
    );
  }
  const next = creatingOrg ? "/onboarding" : sp.next;
  return (
    <AuthShell title={creatingOrg ? "Create your organisation account" : "Create your staff account"} subtitle={creatingOrg ? "You will be the owner of the workspace you create next." : "Your account will be linked to the organisation that gave you this link."} footer={<>Already have an account? <Link className="text-fg underline" href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"}>Sign in</Link></>}>
      <SignupForm next={next} />
    </AuthShell>
  );
}
