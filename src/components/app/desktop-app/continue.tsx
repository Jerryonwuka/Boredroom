"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/states";
import { api, isApiFailure } from "@/lib/api-client";

/**
 * The one press on the browser bridge's page (owner request, 24 October 2026: Boredroom for Mac, option A; spec §7.1):
 * posts the ticket, then goes to the provider's consent, which the server started in this browser with its own state
 * cookie. A fetch and `location.assign` (the site's CSP allows forms to post only to itself, redirects included).
 */
export function ContinueToApp({ ticket, app }: { ticket: string; app: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-4">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Button size="lg" className="w-full" loading={busy} onClick={async () => {
        setBusy(true); setError(null);
        try {
          const r = await api<{ url: string }>("/api/desktop/continue", { method: "POST", body: { t: ticket }, retries: 0 });
          window.location.assign(r.url);
        } catch (err) {
          setError(isApiFailure(err) ? err.error.message : "Cannot reach the server. Check your connection and try again.");
          setBusy(false);
        }
      }}>{busy ? "Opening…" : `Continue to ${app}`}</Button>
      <p className="text-center text-meta font-normal text-secondary">Didn&apos;t start this? Close this tab; nothing happens.</p>
    </div>
  );
}

/**
 * The browser bridge for a browser that isn't signed in as the link's person (security review, 24 October 2026:
 * SEC-1): signing in here, as that person, then back to the Continue page. With `signOutFirst` the other account is
 * signed out of this browser first (the person chose to). Nothing is signed in by the link itself.
 */
export function SignInToContinue({ next, email, signOutFirst }: { next: string; email: string; signOutFirst: boolean }) {
  const [busy, setBusy] = useState(false);
  const login = `/login?next=${encodeURIComponent(next)}`;
  return (
    <div className="flex flex-col gap-4">
      <Button size="lg" className="w-full" loading={busy} onClick={async () => {
        setBusy(true);
        if (signOutFirst) {
          try { await api("/api/auth/logout", { method: "POST", retries: 0 }); } catch { /* the sign-in page shows who is signed in */ }
        }
        // A full load: the sign-in page reads the session afresh.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign(login);
      }}>{busy ? "Opening…" : signOutFirst ? `Sign out and sign in as ${email}` : `Sign in as ${email}`}</Button>
      <p className="text-center text-meta font-normal text-secondary">Didn&apos;t start this? Close this tab; nothing happens.</p>
    </div>
  );
}
