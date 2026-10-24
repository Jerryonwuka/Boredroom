import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/server/auth";
import { previewTicket } from "@/server/services/desktop-app";
import { AuthShell } from "@/components/auth/auth-shell";
import { Alert } from "@/components/ui/states";
import { ContinueToApp, SignInToContinue } from "@/components/app/desktop-app/continue";

export const dynamic = "force-dynamic";
export const metadata = { title: "Connect an app to Boredroom", referrer: "no-referrer" as const, robots: { index: false } };

/**
 * The browser bridge (owner request, 24 October 2026: Boredroom for Mac, option A; spec §7.1): connecting an app from
 * Boredroom for Mac's window continues here, in the person's browser, because Google and most providers refuse
 * embedded web views. Read only: opening the page uses nothing (mail scanners and link previews open links); the press
 * does. It names the account and the workspace.
 *
 * Security review, 24 October 2026 (SEC-1, SEC-3): the page never signs a browser in. Only a browser already signed in
 * as the ticket's person gets the Continue button; a browser with no session is sent to sign in as that person (and
 * back here), one signed in as someone else is told whose link it is, and Boredroom for Mac's own window and an
 * impersonation session are refused.
 */
export default async function DesktopContinuePage({ searchParams }: { searchParams: Promise<{ t?: string | string[] }> }) {
  const sp = await searchParams;
  const t = [sp.t].flat()[0] ?? "";
  const view = await previewTicket(t, (await cookies()).get(SESSION_COOKIE)?.value);
  if (!view) return <AuthShell title="This link has expired" subtitle="Start again from Boredroom."><span hidden /></AuthShell>;
  const here = `/desktop/continue?t=${encodeURIComponent(t)}`;
  const title = `Connect ${view.app} to Boredroom`;
  const subtitle = `For the workspace ${view.workspaceName}, as ${view.displayName} (${view.email}). You started this from Boredroom for Mac.`;
  if (view.browser === "window") {
    return <AuthShell title="Open this link in your browser" subtitle={`Connecting ${view.app} continues in your default browser, not in Boredroom for Mac.`}><span hidden /></AuthShell>;
  }
  if (view.browser === "impersonated") {
    return <AuthShell title={title} subtitle={subtitle}><Alert tone="warning">Only {view.email} can connect their own apps. It can&apos;t be done while you are signed in as them.</Alert></AuthShell>;
  }
  if (view.browser === "none" || view.browser === "other") {
    return (
      <AuthShell title={title} subtitle={subtitle}>
        {view.browser === "other" ? <Alert tone="warning">This link is for {view.email}. This browser is signed in to Boredroom as {view.otherEmail}.</Alert> : null}
        <SignInToContinue next={here} email={view.email} signOutFirst={view.browser === "other"} />
      </AuthShell>
    );
  }
  return (
    <AuthShell title={title} subtitle={subtitle}>
      <ContinueToApp ticket={t} app={view.app} />
    </AuthShell>
  );
}
