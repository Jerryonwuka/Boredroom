"use client";

/**
 * Settings → Connectors (owners and HR; owner decisions, 22 October 2026: connectors; spec §11.1). "Connected apps", then
 * one group per category in order (Calendars, Chat, Knowledge, Work). Calendars have no workspace connection: each is a
 * row "Let people connect {App}" (each person's calendar stays private to them). Every other app is a workspace card.
 * Coming back from an app: "?connected=" says so in a toast, "?connector_error=" in an alert with fixed words.
 */
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Switch } from "@/components/ui/switch";
import { Alert } from "@/components/ui/states";
import { successToast } from "@/components/ui/toast";
import { SettingsGroup, SettingsRow, SettingsSection } from "@/components/app/settings-forms";
import { api, isApiFailure } from "@/lib/api-client";
import { ADMIN_CONSENT_DONE, CONNECTOR_WORDS, CONNECT_FAILURE, isConnectFailure } from "@/lib/connectors/words";
import { CATEGORY_ORDER } from "@/lib/connectors/catalogue";
import { PROVIDER_LABELS, providerFromSlug, type ConnectorsView, type PolicyView } from "@/lib/connectors/types";
import { SetupSteps, StatusBadge, WorkspaceConnectionCard } from "./connection-card";
import { CONNECTOR_BRIDGE_RETURN } from "./connect-sheet";

const W = CONNECTOR_WORDS.workspace;

/**
 * The "?connected=" toast and the "?connector_error=" words, once, then the address is cleaned. With `anchor`, the page
 * scrolls back to that section (integration fix, 22 October 2026: returning from the app to Your assistant landed at the
 * top of a long page, far from the card that just connected).
 */
export function useConnectorReturn(anchor?: string): string | null {
  const params = useSearchParams();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const connected = params.get("connected");
    const failed = params.get("connector_error");
    const notice = params.get("connector_notice");
    if (!connected && !failed && !notice) return;
    const app = connected ? providerFromSlug(connected) : null;
    if (app) successToast(CONNECTOR_WORDS.sheet.connected(PROVIDER_LABELS[app]));
    if (notice === "admin_consent") successToast(ADMIN_CONSENT_DONE);
    const failedApp = providerFromSlug(params.get("connector_app") ?? "");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (failed && isConnectFailure(failed)) setError(CONNECT_FAILURE[failed](failedApp ? PROVIDER_LABELS[failedApp] : "the app"));
    const url = new URL(window.location.href);
    for (const k of ["connected", "connector_error", "connector_notice", "connector_app"]) url.searchParams.delete(k);
    router.replace(`${url.pathname}${url.search}${url.hash}`, { scroll: false });
    // After the router has settled its own scroll for the return (a frame is too early).
    if (anchor) setTimeout(() => document.getElementById(anchor)?.scrollIntoView({ block: "start" }), 300);
  }, [params, router, anchor]);
  // A consent finished in the browser (Boredroom for Mac, owner request, 24 October 2026): refetch when the person is back.
  useEffect(() => {
    const again = () => router.refresh();
    window.addEventListener(CONNECTOR_BRIDGE_RETURN, again);
    return () => window.removeEventListener(CONNECTOR_BRIDGE_RETURN, again);
  }, [router]);
  return error;
}

export function ConnectorsSettings({ orgSlug, view, timeZone, assistantName, isOwner = false }: { orgSlug: string; view: ConnectorsView; timeZone: string; assistantName?: string; isOwner?: boolean }) {
  const name = assistantName ?? view.workspaceAssistantName ?? "Brenda";
  const returned = useConnectorReturn();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const policy = (id: PolicyView["provider"]) => view.policies.find((p) => p.provider === id) ?? { provider: id, personalAllowed: true, brendaReads: true, brendaActs: true };
  const returnTo = `/app/${orgSlug}/settings?section=connectors`;
  if (!view.ready) return <SettingsSection id="connectors" title={W.title} description={W.description}><Alert tone="info">{W.notReady}</Alert></SettingsSection>;
  async function setPersonalAllowed(slug: string, on: boolean) {
    setError(null);
    try { await api(`/api/orgs/${orgSlug}/connectors/policies/${slug}`, { method: "PUT", body: { personalAllowed: on } }); router.refresh(); }
    catch (err) { setError(isApiFailure(err) ? err.error.message : "Cannot reach the server. Check your connection and try again; nothing was changed."); }
  }
  return (
    <div className="space-y-10">
      <SettingsSection id="connectors" title={W.title} description={W.description}>
        {returned || error ? <Alert tone="danger" className="mb-4">{returned ?? error}</Alert> : null}
        {view.catalogue.length === 0 ? <p className="text-sm font-normal text-secondary">{isOwner ? W.nothingConfigured : CONNECTOR_WORDS.personal.nothingOffered}</p> : null}
      </SettingsSection>
      {CATEGORY_ORDER.map((cat) => {
        const cards = view.catalogue.filter((c) => c.entry.category === cat);
        if (!cards.length) return null;
        if (cat === "calendar") {
          return (
            <SettingsSection key={cat} id={`connectors-${cat}`} title={W.groups[cat]}>
              <SettingsGroup>
                {cards.map((c) => (
                  // Not set up on this server (fix, 22 October 2026): the badge and the steps instead of a greyed switch
                  // that looked switched on.
                  <SettingsRow key={c.entry.id} label={W.letPeople(c.entry.label)} hint={c.configured ? W.calendarHint : W.notSetUp(c.entry.label)} labelId={`cal-${c.entry.slug}`}>
                    {c.configured
                      ? <Switch aria-labelledby={`cal-${c.entry.slug}`} checked={policy(c.entry.id).personalAllowed} onChange={(e) => setPersonalAllowed(c.entry.slug, e.currentTarget.checked)} />
                      : <div className="min-w-0"><StatusBadge c={null} configured={false} /><SetupSteps card={c} /></div>}
                  </SettingsRow>
                ))}
              </SettingsGroup>
            </SettingsSection>
          );
        }
        return (
          <SettingsSection key={cat} id={`connectors-${cat}`} title={W.groups[cat]}>
            <div className="space-y-4">
              {cards.filter((c) => c.entry.kinds.includes("workspace")).map((c) => (
                <WorkspaceConnectionCard key={c.entry.id} orgSlug={orgSlug} card={c} connection={view.workspace.find((w) => w.provider === c.entry.id) ?? null}
                  policy={policy(c.entry.id)} teams={view.teams} routes={view.routes} timeZone={timeZone} returnTo={returnTo} assistantName={name} />
              ))}
            </div>
          </SettingsSection>
        );
      })}
    </div>
  );
}
