import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { AcceptInvitation, SignOutButton } from "@/components/auth/forms";
import { Alert } from "@/components/ui/states";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/server/auth";
import { previewInvitation } from "@/server/services/orgs";

export const metadata = { title: "Invitation" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [user, inv] = await Promise.all([getCurrentUser(), previewInvitation(token)]);
  const here = `/invite/${token}`;
  if (!inv) return <AuthShell title="Invitation not found"><Alert tone="danger">This invitation link is not valid. Ask your administrator to send a new one.</Alert></AuthShell>;
  if (inv.state !== "pending") {
    const text = { expired: "This invitation has expired.", revoked: "This invitation was revoked.", accepted: "This invitation has already been used." }[inv.state];
    return <AuthShell title="Invitation closed"><Alert tone="warning">{text} Ask your administrator at {inv.orgName} for a new one.</Alert></AuthShell>;
  }
  if (!user) {
    return (
      <AuthShell title={`Join ${inv.orgName}`} subtitle={`You were invited as ${inv.role}. Sign in or create an account with ${inv.email}.`}>
        <div className="grid gap-3">
          <Link href={`/signup?next=${encodeURIComponent(here)}`}><Button size="lg" className="w-full">Create account</Button></Link>
          <Link href={`/login?next=${encodeURIComponent(here)}`}><Button size="lg" variant="outline" className="w-full">Sign in</Button></Link>
        </div>
      </AuthShell>
    );
  }
  if (user.email.toLowerCase() !== inv.email.toLowerCase()) {
    return (
      <AuthShell title="Different email" footer={<SignOutButton />}>
        <Alert tone="warning">This invitation was sent to <strong>{inv.email}</strong>, but you are signed in as {user.email}. Sign out and use the invited address.</Alert>
      </AuthShell>
    );
  }
  if (!user.emailVerified) {
    return <AuthShell title="Verify your email first"><Alert tone="info">Confirm {user.email} from the verification message, then open this link again.</Alert><div className="mt-4"><Link href={`/verify/pending?next=${encodeURIComponent(here)}`}><Button className="w-full">Go to verification</Button></Link></div></AuthShell>;
  }
  return (
    <AuthShell title={`Join ${inv.orgName}`} subtitle={`You will join as ${inv.role} with the email ${inv.email}.`}>
      <AcceptInvitation token={token} orgName={inv.orgName} />
    </AuthShell>
  );
}
