"use client";

/**
 * Settings → Your assistant → Your connections (everyone; owner decisions, 22 October 2026: connectors; spec §11.2). The
 * person's own calendar and work apps, private to them: owners and HR can't see them or whether anything is connected.
 * One card per app the workspace allows people to connect and Boredroom has set up. Then "From your workspace": one quiet
 * line per workspace connection. While someone else is signed in as the person: one line, and nothing else.
 */
import { Alert } from "@/components/ui/states";
import { SettingsSection } from "@/components/app/settings-forms";
import { CONNECTOR_WORDS } from "@/lib/connectors/words";
import { PROVIDER_LABELS, type ConnectorsView } from "@/lib/connectors/types";
import { PersonalConnectionCard } from "./connection-card";
import { useConnectorReturn } from "./connectors-settings";

const P = CONNECTOR_WORDS.personal;

export function YourConnections({ orgSlug, view, name, timeZone }: { orgSlug: string; view: ConnectorsView; name: string; timeZone: string }) {
  const returned = useConnectorReturn("connections");
  if (!view.ready || !view.enabled) return null;
  if (view.impersonating) {
    return <SettingsSection id="connections" title={P.title}><Alert tone="info">{P.impersonated}</Alert></SettingsSection>;
  }
  const allowed = (id: string) => view.policies.find((p) => p.provider === id)?.personalAllowed !== false;
  const cards = view.catalogue.filter((c) => c.configured && c.entry.kinds.includes("personal") && allowed(c.entry.id));
  const returnTo = `/app/${orgSlug}/settings?section=assistant`;
  return (
    <SettingsSection id="connections" title={P.title} description={P.description(name)}>
      {returned ? <Alert tone="danger" className="mb-4">{returned}</Alert> : null}
      {cards.length === 0 ? <p className="text-sm font-normal text-secondary">{P.nothingOffered}</p> : (
        <div className="space-y-4">
          {cards.map((c) => (
            <PersonalConnectionCard key={c.entry.id} orgSlug={orgSlug} card={c} name={name} timeZone={timeZone} returnTo={returnTo}
              connection={view.personal.find((p) => p.provider === c.entry.id) ?? null} />
          ))}
        </div>
      )}
      {view.workspaceSummary.length ? (
        <div className="mt-6">
          <p className="text-sm font-medium text-foreground">{P.fromWorkspace}</p>
          <ul className="mt-1.5 space-y-1 text-meta font-normal text-secondary">
            {view.workspaceSummary.map((w) => (
              <li key={w.id}>{PROVIDER_LABELS[w.provider]}{w.accountLabel ? ` (${w.accountLabel})` : ""}: {w.sources ? `${w.sources} ${w.sources === 1 ? "source" : "sources"} shared with Boredroom.` : "connected for the workspace."}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </SettingsSection>
  );
}
