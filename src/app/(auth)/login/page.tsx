import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell, AUTH_LINK } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/forms";
import { GoogleSignIn } from "@/components/auth/google-button";
import { joiningTarget, safeNextPath } from "@/components/auth/next-path";
import { Alert } from "@/components/ui/states";
import { getCurrentUser } from "@/server/auth";
import { googleFailureText } from "@/server/auth/google";
import { previewInvitation } from "@/server/services/orgs";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[]; reset?: string | string[]; google?: string | string[] }> }) {
  const sp = await searchParams;
  const next = sp.next ? safeNextPath(sp.next) : undefined;
  // The Google callback sends a fixed code; the words are ours, so a crafted link cannot put its own text here.
  const google = googleFailureText([sp.google].flat()[0]);
  const user = await getCurrentUser();
  if (user) redirect(next ?? "/app");
  // From an email invitation: the address it was sent to is the one to sign in with.
  const target = joiningTarget(next);
  const invitation = target?.kind === "invite" ? await previewInvitation(target.token) : null;
  return (
    <AuthShell title="Welcome back" subtitle={invitation?.state === "pending" ? `Sign in with ${invitation.email} to join ${invitation.orgName}.` : "Sign in to see what your team is working on."} footer={<>New here? <Link className={AUTH_LINK} href={next ? `/signup?next=${encodeURIComponent(next)}` : "/signup"}>Create an account</Link></>}>
      {sp.reset ? <Alert tone="success">Your password was changed. Sign in with the new one.</Alert> : null}
      {google ? <Alert tone="danger" title="Google sign-in did not finish">{google}</Alert> : null}
      <GoogleSignIn next={next} />
      <LoginForm next={next} email={invitation?.state === "pending" ? invitation.email : undefined} />
    </AuthShell>
  );
}
