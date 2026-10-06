import Link from "next/link";
import { AuthShell, AUTH_LINK } from "@/components/auth/auth-shell";
import { AcceptInvitation, SignOutButton } from "@/components/auth/forms";
import { Alert } from "@/components/ui/states";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getCurrentUser } from "@/server/auth";
import { previewInvitation } from "@/server/services/orgs";

export const metadata = { title: "Invitation" };

/** The role an invitation carries, in the words the rest of the product uses for it. */
const AS_ROLE: Record<string, string> = { owner: "an organisation owner", hr: "an HR administrator", manager: "a team lead", employee: "staff" };
const full = (variant: "primary" | "outline" = "primary") => cn(buttonVariants({ variant, size: "lg" }), "w-full");

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [user, inv] = await Promise.all([getCurrentUser(), previewInvitation(token)]);
  const here = `/invite/${token}`;
  // A dead end still offers a way on: your workspaces when signed in, sign in otherwise.
  const away = user ? <Link className={AUTH_LINK} href="/app">Go to your workspaces</Link> : <Link className={AUTH_LINK} href="/login">Sign in</Link>;
  if (!inv) return <AuthShell title="Invitation not found" footer={away}><Alert tone="danger">This invitation link is not valid. Check you opened the whole link, or ask your administrator to send a new one.</Alert></AuthShell>;
  if (inv.state !== "pending") {
    const text = { expired: "This invitation has expired.", revoked: "This invitation was withdrawn.", accepted: "This invitation has already been used." }[inv.state];
    return <AuthShell title="Invitation closed" footer={away}><Alert tone="warning">{text} Ask your administrator at {inv.orgName} for a new one.</Alert></AuthShell>;
  }
  const as = AS_ROLE[inv.role] ?? "a member";
  if (!user) {
    return (
      <AuthShell title={`Join ${inv.orgName}`} subtitle={`You were invited as ${as}. Sign in or create an account with ${inv.email}.`}>
        <div className="grid gap-3">
          <Link href={`/signup?next=${encodeURIComponent(here)}`} className={full()}>Create account</Link>
          <Link href={`/login?next=${encodeURIComponent(here)}`} className={full("outline")}>Sign in</Link>
        </div>
      </AuthShell>
    );
  }
  // Signing out from here comes back to this invitation, ready for the invited address.
  const switchAccount = <SignOutButton to={`/login?next=${encodeURIComponent(here)}`} />;
  if (user.email.toLowerCase() !== inv.email.toLowerCase()) {
    return (
      <AuthShell title="Different email" footer={switchAccount}>
        <Alert tone="warning">This invitation was sent to <strong>{inv.email}</strong>, but you are signed in as {user.email}. Sign out, then sign in or create an account with the invited address.</Alert>
      </AuthShell>
    );
  }
  if (!user.emailVerified) {
    return (
      <AuthShell title="Confirm your email first" subtitle={`Confirm ${user.email} from the verification message, then come back to this link.`} footer={switchAccount}>
        <Link href={`/verify/pending?next=${encodeURIComponent(here)}`} className={full()}>Go to verification</Link>
      </AuthShell>
    );
  }
  return (
    <AuthShell title={`Join ${inv.orgName}`} subtitle={`You will join as ${as} with the email ${inv.email}.`} footer={switchAccount}>
      <AcceptInvitation token={token} orgName={inv.orgName} orgSlug={inv.orgSlug} />
    </AuthShell>
  );
}
