import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, Users } from "lucide-react";
import { AuthShell, AUTH_LINK } from "@/components/auth/auth-shell";
import { EntryRow } from "@/components/auth/entry-row";
import { SignupForm } from "@/components/auth/forms";
import { GoogleSignIn } from "@/components/auth/google-button";
import { joiningTarget, safeNextPath } from "@/components/auth/next-path";
import { buttonVariants } from "@/components/ui/button";
import { ToolSquare } from "@/components/ui/tool-tile";
import { cn } from "@/lib/utils";
import { getCurrentUser } from "@/server/auth";
import { registrationOpen } from "@/server/admin/settings";
import { previewInvitation, previewJoinCode } from "@/server/services/orgs";

export const metadata = { title: "Create account" };

/**
 * Two account types. An organisation account creates a workspace; a staff account can only be
 * created on the way into an organisation (join code, join link or email invitation).
 */
export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string | string[]; intent?: string | string[] }> }) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  if (user) redirect(safeNextPath(sp.next));
  if (!(await registrationOpen())) {
    return (
      <AuthShell title="Boredroom is not open yet" subtitle="We are letting people in from the waitlist. Leave your details and we will email you the moment it opens." footer={<>Already have an account? <Link className={AUTH_LINK} href="/login">Sign in</Link></>}>
        <Link href="/#waitlist" className={cn(buttonVariants({ size: "lg" }), "w-full")}>Join the waitlist</Link>
      </AuthShell>
    );
  }
  const target = joiningTarget(sp.next ? safeNextPath(sp.next) : null);
  const creatingOrg = [sp.intent].flat()[0] === "org";
  if (!target && !creatingOrg) {
    return (
      <AuthShell title="How are you joining Boredroom?" subtitle="Organisations create workspaces. Staff join through their organisation's code or link." footer={<>Already have an account? <Link className={AUTH_LINK} href="/login">Sign in</Link></>}>
        <ul aria-label="Account types" className="flex flex-col gap-2">
          <li><EntryRow href="/signup?intent=org" leading={<ToolSquare><Building2 /></ToolSquare>} title="Create an organisation account" subtitle="Set up your company, its teams and team leads, and hand out a join code." /></li>
          <li><EntryRow href="/join" leading={<ToolSquare><Users /></ToolSquare>} title="Join my organisation" subtitle="I have a code or link from my organisation." /></li>
        </ul>
      </AuthShell>
    );
  }
  const next = creatingOrg ? "/onboarding" : safeNextPath(sp.next);
  // Name the organisation the link leads to, and fill in the address an invitation was sent to.
  const [invitation, joinCode] = await Promise.all([
    target?.kind === "invite" ? previewInvitation(target.token) : null,
    target?.kind === "join" ? previewJoinCode(target.code) : null,
  ]);
  const orgName = invitation?.state === "pending" ? invitation.orgName : joinCode?.enabled ? joinCode.name : null;
  return (
    <AuthShell title={creatingOrg ? "Create your organisation account" : "Create your staff account"} subtitle={creatingOrg ? "You will be the owner of the workspace you create next." : orgName ? `You will join ${orgName} once you have confirmed your email.` : "Your account will be linked to the organisation that gave you this link."} footer={<>Already have an account? <Link className={AUTH_LINK} href={`/login?next=${encodeURIComponent(next)}`}>Sign in</Link></>}>
      <GoogleSignIn next={next} label="Sign up with Google" />
      <SignupForm next={next} email={invitation?.state === "pending" ? invitation.email : undefined} />
    </AuthShell>
  );
}
