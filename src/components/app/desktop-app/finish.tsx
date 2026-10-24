"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/input";
import { Alert } from "@/components/ui/states";
import { AuthHeading, AUTH_LINK } from "@/components/auth/auth-shell";
import { api, isApiFailure } from "@/lib/api-client";

type Workspace = { slug: string; name: string; assistant: string };
type Phase =
  | { at: "working" }
  | { at: "choose"; workspaces: Workspace[] }
  | { at: "done"; redirect: string }
  | { at: "noWorkspace" }
  | { at: "expired" }
  | { at: "refused"; message: string };

const OFFLINE = "Cannot reach the server. Check your connection and try again.";

/**
 * The last step of signing in Boredroom for Mac (owner request, 24 October 2026: option A; spec §6.3). Approving mints a
 * short single-use code for the app and opens `boredroom://auth?…`, which the app catches (in its window) or macOS hands
 * to it (from the browser, after its own "Open Boredroom?" prompt). Plain links only, never next/link: the pages around
 * this are route handlers the app watches.
 *
 * The approve runs at once only with `autoContinue` (the page decides: the person has just signed in in this flow, or,
 * in the window, the notch is already theirs). Otherwise the person presses: in the window "Sign {name} in your notch
 * in as …?", naming who it signs out (`replacing`); in a browser "Open Boredroom for Mac?" (security review,
 * 24 October 2026: SEC-3, a session someone else put in the window never relinks the notch silently).
 */
export function DesktopFinish({ inWindow, autoContinue, replacing, displayName, email, workspaces }: {
  inWindow: boolean; autoContinue: boolean; replacing: { displayName: string; email: string } | null; displayName: string; email: string; workspaces: Workspace[];
}) {
  const [phase, setPhase] = useState<Phase>(autoContinue ? { at: "working" } : { at: "choose", workspaces });
  const [org, setOrg] = useState(workspaces[0]?.slug ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = workspaces.find((w) => w.slug === org) ?? workspaces[0];
  const assistant = chosen?.assistant ?? "Brenda";

  const approve = useCallback(async (orgSlug?: string) => {
    setBusy(true); setError(null);
    try {
      const r = await api<{ redirect: string }>("/api/desktop/app/auth/approve", { method: "POST", body: orgSlug ? { orgSlug } : {}, retries: 0 });
      if (!r.redirect.startsWith("boredroom://auth?")) throw new Error("unexpected");
      setPhase({ at: "done", redirect: r.redirect });
      window.location.href = r.redirect;
    } catch (err) {
      if (!isApiFailure(err)) { setError(OFFLINE); return; }
      const { code, message, details } = err.error;
      if (code === "CHOOSE_WORKSPACE") {
        const list = Array.isArray(details?.workspaces) ? (details.workspaces as { slug: string; name: string }[]) : [];
        setPhase({ at: "choose", workspaces: list.map((w) => ({ ...w, assistant: workspaces.find((x) => x.slug === w.slug)?.assistant ?? "Brenda" })) });
      } else if (code === "NO_WORKSPACE") setPhase({ at: "noWorkspace" });
      else if (code === "REQUEST_EXPIRED") setPhase({ at: "expired" });
      // A full load on purpose (the app watches them): here and below.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      else if (code === "EMAIL_NOT_VERIFIED") window.location.assign("/verify/pending?next=/desktop/app/finish");
      else setPhase({ at: "refused", message });
    } finally { setBusy(false); }
  }, [workspaces]);

  // Once, after the first paint (a cleared timer when React runs the effect twice in development).
  useEffect(() => {
    if (!autoContinue) return;
    const t = setTimeout(() => { void approve(); }, 0);
    return () => clearTimeout(t);
  }, [autoContinue, approve]);

  if (phase.at === "expired") return <FinishExpired />;
  if (phase.at === "refused") {
    return (
      <>
        <AuthHeading title="Boredroom for Mac wasn't signed in" subtitle={phase.message} />
        <Link className={buttonVariants({ variant: "primary", size: "lg", className: "w-full" })} href="/app">Back to Boredroom</Link>
      </>
    );
  }
  if (phase.at === "noWorkspace") {
    return (
      <>
        <AuthHeading title="Set up your workspace first" subtitle="Boredroom for Mac signs in to a workspace. Create or join one, then come back here." />
        <div className="flex flex-col gap-3">
          <Link className={buttonVariants({ variant: "outline", size: "lg", className: "w-full" })} href="/app" target="_blank" rel="noopener">Set up a workspace</Link>
          <Button size="lg" className="w-full" loading={busy} onClick={() => approve()}>{busy ? "Checking…" : "Continue"}</Button>
        </div>
      </>
    );
  }
  if (phase.at === "done") {
    return inWindow ? (
      <AuthHeading title={`Signing in ${assistant} in your notch…`} subtitle="Boredroom opens in a moment." />
    ) : (
      <>
        <AuthHeading title="You're signed in" subtitle="You can close this tab. If Boredroom didn't open, open it again here." />
        <a className={buttonVariants({ variant: "primary", size: "lg", className: "w-full" })} href={phase.redirect}>Open Boredroom</a>
      </>
    );
  }
  const choosing = phase.at === "choose" ? phase.workspaces : workspaces;
  if (phase.at === "working") {
    return (
      <>
        <AuthHeading title={`Signing in ${assistant} in your notch…`} subtitle="This takes a moment." />
        {error ? <Alert tone="danger" action={<Button size="sm" variant="outline" onClick={() => approve()}>Try again</Button>}>{error}</Alert> : null}
      </>
    );
  }
  return (
    <>
      <AuthHeading
        title={inWindow ? `Sign ${assistant} in your notch in as ${displayName}?` : "Open Boredroom for Mac?"}
        subtitle={inWindow ? `${email}. ${choosing.length > 1 ? `Choose the workspace ${assistant} uses on this Mac.` : "You can change it later by signing in again."}` : `You're signing in to Boredroom for Mac as ${displayName} (${email}).`} />
      {inWindow && replacing ? (
        <Alert tone="warning">This signs {replacing.displayName || replacing.email}{replacing.displayName && replacing.email ? ` (${replacing.email})` : ""} out of {assistant} on this Mac.</Alert>
      ) : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void approve(choosing.length > 1 ? org : undefined); }}>
        {choosing.length > 1 ? (
          <Field label="Workspace" htmlFor="desktop-org">
            <Select id="desktop-org" value={org} onChange={(e) => setOrg(e.target.value)}>
              {choosing.map((w) => <option key={w.slug} value={w.slug}>{w.name}</option>)}
            </Select>
          </Field>
        ) : null}
        <Button type="submit" size="lg" className="w-full" loading={busy}>{busy ? "Opening…" : inWindow ? `Sign in ${assistant}` : "Open Boredroom"}</Button>
        {/* Not now: back to the dashboard; the app doesn't ask again while this window is open. */}
        {inWindow ? <Link className={buttonVariants({ variant: "outline", size: "lg", className: "w-full" })} href="/app">Not now</Link> : null}
      </form>
      <p className="text-center text-meta font-normal text-secondary">
        Not you? <button type="button" className={AUTH_LINK} onClick={async () => {
          try { await api("/api/auth/logout", { method: "POST", retries: 0 }); } catch { /* signing in again works either way */ }
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          window.location.assign("/login?next=/desktop/app/finish");
        }}>Use another account</button>
      </p>
    </>
  );
}

/** "This sign-in has expired": the request cookie is missing, or the request timed out or was used. */
export function FinishExpired() {
  return (
    <>
      <AuthHeading title="This sign-in has expired" subtitle="Go back to Boredroom and try again." />
      <a className={buttonVariants({ variant: "primary", size: "lg", className: "w-full" })} href="/desktop/app?next=%2Fapp">Continue</a>
    </>
  );
}
