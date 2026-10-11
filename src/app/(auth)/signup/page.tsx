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
import { WELCOME_WORDS } from "@/lib/welcome";
import { getCurrentUser } from "@/server/auth";
import { registrationOpen } from "@/server/admin/settings";
import { previewInvitation, previewJoinCode } from "@/server/services/orgs";

export const metadata = { title: "Create account" };

/**
 * Two account types. An organisation account creates a workspace; a staff account can only be
 * created on the way into an organisation (join code, join link or email invitation).
 *
 * The first-run welcome (owner request, 11 October 2026): the joining target is read and named before the waitlist
 * check, so while Boredroom is on its waitlist a person with a pending invitation or an enabled join code can still
 * create their account (the server checks the address too, D9); founders still meet the waitlist. The founder's title
 * says what comes next ("about two minutes"); a joiner's says which organisation and as what. An invitation fixes the
 * address: the field is filled in and read-only, because only that address can accept it.
 */
export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string | string[]; intent?: string | string[] }> }) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  if (user) redirect(safeNextPath(sp.next));
  const target = joiningTarget(sp.next ? safeNextPath(sp.next) : null);
  const creatingOrg = [sp.intent].flat()[0] === "org";
  // Name the organisation the link leads to, and fill in the address an invitation was sent to.
  const [invitation, joinCode, open] = await Promise.all([
    target?.kind === "invite" ? previewInvitation(target.token) : null,
    target?.kind === "join" ? previewJoinCode(target.code) : null,
    registrationOpen(),
  ]);
  const pendingInvite = invitation?.state === "pending" ? invitation : null;
  const enabledCode = joinCode?.enabled ? joinCode : null;
  if (!open && (creatingOrg || (!pendingInvite && !enabledCode))) {
    return (
      <AuthShell title="Boredroom is not open yet" subtitle="We are letting people in from the waitlist. Leave your details and we will email you the moment it opens." footer={<>Already have an account? <Link className={AUTH_LINK} href="/login">Sign in</Link></>}>
        <Link href="/#waitlist" className={cn(buttonVariants({ size: "lg" }), "w-full")}>Join the waitlist</Link>
      </AuthShell>
    );
  }
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
  const orgName = pendingInvite?.orgName ?? enabledCode?.name ?? null;
  const role = pendingInvite?.role ?? enabledCode?.role ?? null;
  const title = creatingOrg ? "Start your workspace" : "Create your account";
  const subtitle = creatingOrg
    ? "You'll be its owner. After you confirm your email, setup takes about two minutes."
    : orgName && role
      ? `You'll join ${orgName} as ${WELCOME_WORDS.joinAs[role]} once you've confirmed your email.`
      : "Your account will be linked to the organisation that gave you this link.";
  return (
    <AuthShell title={title} subtitle={subtitle} footer={<>Already have an account? <Link className={AUTH_LINK} href={`/login?next=${encodeURIComponent(next)}`}>Sign in</Link></>}>
      <GoogleSignIn next={next} label="Sign up with Google" />
      <SignupForm next={next} email={pendingInvite?.email} lockEmail={!!pendingInvite} orgName={orgName} />
    </AuthShell>
  );
}
