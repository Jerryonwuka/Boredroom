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
import { cookies } from "next/headers";
import { DESKTOP_AUTH_COOKIE, readRequestCookie } from "@/server/services/desktop-app";
import { inDesktopApp } from "@/server/lib/desktop-app";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[]; reset?: string | string[]; google?: string | string[] }> }) {
  const sp = await searchParams;
  // Boredroom for Mac (owner request, 24 October 2026: option A): a sign-in that started from the app (its request cookie
  // is valid) goes back to finishing it, also when a failed Google attempt came back here without `next`.
  const jar = await cookies();
  const next = sp.next ? safeNextPath(sp.next) : readRequestCookie(jar.get(DESKTOP_AUTH_COOKIE)?.value) ? "/desktop/app/finish" : undefined;
  const inApp = await inDesktopApp();
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
      {/* In Boredroom for Mac's window: the app catches this link and signs in in the browser, where saved passwords and
          passkeys work. A plain link, never next/link (the app watches the full load). */}
      {inApp ? (
        <p className="text-center text-meta font-normal text-secondary">
          <a className={AUTH_LINK} href={`/desktop/app/browser?next=${encodeURIComponent(next ?? "/app")}`}>Sign in with your browser</a>
          <span className="mt-1 block">Uses your saved passwords and passkeys.</span>
        </p>
      ) : null}
    </AuthShell>
  );
}
