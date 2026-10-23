/**
 * Connected apps: the adapter registry (owner decisions, 22 October 2026: connectors). Adapters are loaded lazily (one
 * dynamic import each), so a route that needs Slack never loads GitHub's JWT code. Server-only.
 *
 * Each `adapters/<id>.ts` exports `adapter: ProviderAdapter`. The framework wrote every file as a stub
 * (`stubAdapter("<id>")`, never configured) on 22 October 2026; each adapter group then owns and replaces its files.
 */
import { PROVIDER_IDS, ConnectorError, type ProviderAdapter, type ProviderId } from "./types";
import { PROVIDER_CATEGORY, PROVIDER_KINDS, PROVIDER_SLUGS, providerFromSlug as slugToProvider } from "@/lib/connectors/types";

export { PROVIDER_IDS };

export const ADAPTERS: Record<ProviderId, () => Promise<ProviderAdapter>> = {
  google_calendar: () => import("./adapters/google-calendar").then((m) => m.adapter),
  outlook_calendar: () => import("./adapters/outlook-calendar").then((m) => m.adapter),
  slack: () => import("./adapters/slack").then((m) => m.adapter),
  teams: () => import("./adapters/teams").then((m) => m.adapter),
  notion: () => import("./adapters/notion").then((m) => m.adapter),
  linear: () => import("./adapters/linear").then((m) => m.adapter),
  jira: () => import("./adapters/jira").then((m) => m.adapter),
  github: () => import("./adapters/github").then((m) => m.adapter),
  asana: () => import("./adapters/asana").then((m) => m.adapter),
  fake: () => import("./adapters/fake").then((m) => m.adapter),
};

/** Test seam: replace one adapter (or null to restore). Tests only. */
const overrides = new Map<ProviderId, ProviderAdapter>();
export function setAdapterForTests(id: ProviderId, adapter: ProviderAdapter | null): void {
  if (adapter) overrides.set(id, adapter);
  else overrides.delete(id);
}

export async function adapterFor(id: ProviderId): Promise<ProviderAdapter> {
  const o = overrides.get(id);
  if (o) return o;
  const load = ADAPTERS[id];
  if (!load) throw new ConnectorError("NOT_CONFIGURED", `unknown provider ${String(id)}`);
  return load();
}

export function providerFromSlug(slug: string): ProviderId | null {
  return slugToProvider(slug);
}

export function slugOf(id: ProviderId): string {
  return PROVIDER_SLUGS[id];
}

/** Every provider whose environment is set (and, for the fake, outside production with CONNECTORS_FAKE=1). */
export async function configuredProviders(env: NodeJS.ProcessEnv = process.env): Promise<ProviderId[]> {
  const out: ProviderId[] = [];
  for (const id of PROVIDER_IDS) {
    try {
      const a = await adapterFor(id);
      if (a.configured(env)) out.push(id);
    } catch {
      // A broken adapter file is "not set up" rather than a broken settings page.
    }
  }
  return out;
}

/** The placeholder every adapter file starts as (framework, 22 October 2026). Never configured, offers nothing. */
export function stubAdapter(id: ProviderId): ProviderAdapter {
  const notYet = () => {
    throw new ConnectorError("NOT_CONFIGURED", `${id} adapter is not built yet`);
  };
  return {
    id,
    category: PROVIDER_CATEGORY[id],
    kinds: PROVIDER_KINDS[id],
    hosts: [],
    linkHosts: [],
    env: [],
    configured: () => false,
    oauth: {
      authorizeUrl: "https://invalid.example/authorize",
      tokenUrl: "https://invalid.example/token",
      clientId: () => "",
      clientSecret: () => "",
      clientAuth: "body",
      tokenBody: "form",
      pkce: "none",
      scopeSeparator: " ",
      scopes: () => [],
      parseToken: notYet,
      refresh: "none",
    },
    identify: async () => notYet(),
    ownerBound: false,
    workspaceActs: false,
    streams: [],
    actions: [],
  };
}
