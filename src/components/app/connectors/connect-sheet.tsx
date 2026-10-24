"use client";

/**
 * Connect an app for yourself (owner decisions, 22 October 2026: connectors; spec §11.3): what the person's assistant can
 * see there, "Let {name} make changes when you ask" (ticked by default, open question 4), and "Continue to {App}" (a white
 * primary, never orange), which starts the connection and sends the browser to the app.
 */
import { useState } from "react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/switch";
import { Alert } from "@/components/ui/states";
import { api, isApiFailure } from "@/lib/api-client";
import { CONNECTOR_WORDS } from "@/lib/connectors/words";
import { fillWords } from "@/lib/connectors/catalogue";
import { PROVIDER_LABELS, providerFromSlug, type ConnectionKind, type ProviderEntry } from "@/lib/connectors/types";
import { notify } from "@/components/ui/toast";
import { isDesktopApp } from "@/lib/desktop-app";

const OFFLINE = "Cannot reach the server. Check your connection and try again; nothing was changed.";

/**
 * Starts connecting and goes to the app (window.location.assign: a form post would meet CSP form-action 'self').
 *
 * In Boredroom for Mac's window (owner request, 24 October 2026: option A; spec §7.1) the consent runs in the person's
 * browser instead (Google and most providers refuse embedded web views): the start asks for a single-use ticket
 * (`browser: true`), the app opens it in the default browser, and this page says to finish there and refreshes when
 * the person comes back (focus or the page showing again). Microsoft's admin consent never takes the bridge (its URL is
 * copied to an admin).
 */
export async function startConnect(orgSlug: string, slug: string, body: { kind: ConnectionKind; act?: boolean; purpose?: "connect" | "reconnect" | "upgrade" | "admin_consent"; connectionId?: string; returnTo?: string }): Promise<string | null> {
  const bridge = isDesktopApp() && body.purpose !== "admin_consent";
  try {
    const r = await api<{ url: string }>(`/api/orgs/${orgSlug}/connectors/${slug}/start`, { method: "POST", body: bridge ? { ...body, browser: true } : body, retries: 0 });
    if (!bridge) { window.location.assign(r.url); return null; }
    window.open(r.url, "_blank", "noopener");
    const provider = providerFromSlug(slug);
    const app = provider ? PROVIDER_LABELS[provider] : "the app";
    notify(`Finish connecting ${app} in your browser`, { description: "This page updates when you come back.", duration: 12000 });
    refreshOnReturn();
    return null;
  } catch (err) {
    return isApiFailure(err) ? err.error.message : OFFLINE;
  }
}

/** The event the connectors' pages listen for to refetch after a consent finished in the browser. */
export const CONNECTOR_BRIDGE_RETURN = "boredroom:connector-return";
function refreshOnReturn() {
  const fire = () => {
    if (document.visibilityState !== "visible") return;
    window.removeEventListener("focus", fire);
    document.removeEventListener("visibilitychange", fire);
    window.dispatchEvent(new Event(CONNECTOR_BRIDGE_RETURN));
  };
  // After this tick: the browser opening takes the focus first.
  setTimeout(() => { window.addEventListener("focus", fire); document.addEventListener("visibilitychange", fire); }, 1000);
}

export function ConnectSheet({ orgSlug, entry, name, open, onClose, returnTo }: { orgSlug: string; entry: ProviderEntry; name: string; open: boolean; onClose: () => void; returnTo: string }) {
  // Read-only by default (fix, 22 October 2026: minimal scopes per use): permission to make changes is asked for only when
  // the person ticks it here, or later from the card's switch.
  const [act, setAct] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const W = CONNECTOR_WORDS.sheet;
  const p = entry.personal;
  async function go() {
    setBusy(true); setError(null);
    const e = await startConnect(orgSlug, entry.slug, { kind: "personal", act, returnTo });
    if (e) { setError(e); setBusy(false); }
    // In Boredroom for Mac the consent went to the browser and this page stays (owner request, 24 October 2026).
    else if (isDesktopApp()) { setBusy(false); onClose(); }
  }
  return (
    <Sheet size="sm" open={open} onClose={onClose} title={W.title(entry.label)} description={p ? fillWords(p.what, { name }) : undefined}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={go}>{W.continue(entry.label)}</Button></>}>
      <div className="space-y-5">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {p?.sees.length ? (
          <div>
            <p className="text-sm font-medium text-foreground">{CONNECTOR_WORDS.workspace.sees(name)}</p>
            <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm font-normal text-secondary">{p.sees.map((s) => <li key={s}>{fillWords(s, { name })}</li>)}</ul>
          </div>
        ) : null}
        {p?.does.length ? (
          <div>
            <p className="text-sm font-medium text-foreground">{CONNECTOR_WORDS.workspace.does(name)}</p>
            <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm font-normal text-secondary">{p.does.map((s) => <li key={s}>{fillWords(s, { name })}</li>)}</ul>
          </div>
        ) : null}
        <Checkbox checked={act} onChange={(e) => setAct(e.currentTarget.checked)} hint={W.letActHint(entry.label, name)}>{W.letAct(name)}</Checkbox>
        {p?.note ? <p className="text-meta font-normal text-secondary">{fillWords(p.note, { name })}</p> : null}
      </div>
    </Sheet>
  );
}
