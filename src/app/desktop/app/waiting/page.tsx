import { safeNextPath } from "@/components/auth/next-path";
import { AuthShell } from "@/components/auth/auth-shell";
import { buttonVariants } from "@/components/ui/button";
import { Alert } from "@/components/ui/states";

export const dynamic = "force-dynamic";
export const metadata = { title: "Finish signing in in your browser", referrer: "no-referrer" as const, robots: { index: false } };

/**
 * Boredroom for Mac's window while the person signs in in their browser (owner request, 24 October 2026: option A; spec
 * §6.3): Google and password managers work there, not in the app's own window. Plain links only (never next/link):
 * the app watches these full loads. `error=link`: the browser came back but the notch could not be signed in.
 */
export default async function DesktopWaitingPage({ searchParams }: { searchParams: Promise<{ next?: string | string[]; error?: string | string[] }> }) {
  const sp = await searchParams;
  const next = safeNextPath(sp.next, "/app");
  const failed = [sp.error].flat()[0] === "link";
  return (
    <AuthShell title="Finish signing in in your browser" subtitle="We opened your browser. Sign in there and you'll come straight back. Google doesn't allow signing in inside apps' own windows, so Boredroom uses your browser for it.">
      {failed ? <Alert tone="danger">Couldn&apos;t sign in your notch. Try again.</Alert> : null}
      <div className="flex flex-col gap-3">
        <a className={buttonVariants({ variant: "primary", size: "lg", className: "w-full" })} href={`/desktop/app/browser?next=${encodeURIComponent(next)}`}>Open my browser again</a>
        <a className={buttonVariants({ variant: "outline", size: "lg", className: "w-full" })} href={`/desktop/app?next=${encodeURIComponent(next)}`}>Sign in here instead</a>
      </div>
    </AuthShell>
  );
}
