import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser, SESSION_COOKIE } from "@/server/auth";
import { DESKTOP_AUTH_COOKIE, finishView } from "@/server/services/desktop-app";
import { inDesktopApp } from "@/server/lib/desktop-app";
import { AuthShell } from "@/components/auth/auth-shell";
import { DesktopFinish, FinishExpired } from "@/components/app/desktop-app/finish";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in Boredroom for Mac", referrer: "no-referrer" as const, robots: { index: false } };

/**
 * The last step of Boredroom for Mac's sign-in (owner request, 24 October 2026: option A; spec §6.3). Needs a session
 * and the request cookie the start link set.
 *
 * Security review, 24 October 2026 (SEC-3): it approves without a press only when the person has just signed in in
 * this flow (`fresh`; in a browser also with one workspace), or, in the app's window, when the notch is already signed
 * in as this same person. Otherwise it asks and names the account, and in the window also who the notch is signed in
 * as now, because approving signs them out on this Mac.
 */
export default async function DesktopFinishPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/desktop/app/finish");
  if (!user.emailVerified) redirect("/verify/pending?next=/desktop/app/finish");
  const jar = await cookies();
  const [view, inApp] = await Promise.all([finishView(jar.get(SESSION_COOKIE)?.value, jar.get(DESKTOP_AUTH_COOKIE)?.value), inDesktopApp()]);
  return (
    <AuthShell>
      {view.state === "expired" ? <FinishExpired /> : (
        <DesktopFinish
          inWindow={view.via === "window" && inApp}
          autoContinue={view.via === "window" && inApp ? view.fresh || view.sameAsNotch : view.fresh && view.workspaces.length === 1}
          replacing={view.via === "window" && inApp ? view.replacing : null}
          displayName={user.displayName} email={user.email} workspaces={view.workspaces} />
      )}
    </AuthShell>
  );
}
