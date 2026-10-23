/**
 * Connected apps: environment (owner decisions, 22 October 2026: connectors). Provider client ids and secrets come from
 * the environment only (documented in .env.example; never written anywhere else, never shown). Server-only.
 */
import type { ProviderId } from "./types";
import { PROVIDER_SLUGS } from "@/lib/connectors/types";

/** One variable, trimmed; "" when unset. */
export function env(name: string, source: NodeJS.ProcessEnv = process.env): string {
  return (source[name] ?? "").trim();
}

/** True when every variable is set (non-empty). */
export function envAll(names: readonly string[], source: NodeJS.ProcessEnv = process.env): boolean {
  return names.every((n) => env(n, source).length > 0);
}

/** Boredroom's public origin, without a trailing slash. */
export function appOrigin(source: NodeJS.ProcessEnv = process.env): string {
  return (env("APP_ORIGIN", source) || "http://localhost:3000").replace(/\/+$/, "");
}

/** The fixed redirect (callback) URL registered in each provider's console. */
export function redirectUri(slug: string, source: NodeJS.ProcessEnv = process.env): string {
  return `${appOrigin(source)}/api/connectors/${slug}/callback`;
}

export function redirectUriFor(id: ProviderId, source: NodeJS.ProcessEnv = process.env): string {
  return redirectUri(PROVIDER_SLUGS[id], source);
}

/** Where a provider delivers webhooks. Asana's carry the hook id in the path. */
export function webhookUrl(slug: string, hookId?: string, source: NodeJS.ProcessEnv = process.env): string {
  return `${appOrigin(source)}/api/connectors/webhooks/${slug}${hookId ? `/${hookId}` : ""}`;
}

/**
 * A registered hook's own URL (security fix, 22 October 2026): Asana's carries Boredroom's hook id in the path, Jira's in
 * `?hook=` (Jira's own webhook ids are small numbers per site, so routing by them alone reached other tenants).
 */
export function hookUrlFor(provider: ProviderId, hookId: string, source: NodeJS.ProcessEnv = process.env): string {
  const slug = PROVIDER_SLUGS[provider];
  if (provider === "asana") return webhookUrl(slug, hookId, source);
  if (provider === "jira") return `${webhookUrl(slug, undefined, source)}?hook=${encodeURIComponent(hookId)}`;
  return webhookUrl(slug, undefined, source);
}

/** The fake provider is offered only with CONNECTORS_FAKE=1 outside production. */
export function fakeEnabled(source: NodeJS.ProcessEnv = process.env): boolean {
  return env("CONNECTORS_FAKE", source) === "1" && source.NODE_ENV !== "production";
}

/** Google's app is still in "Testing" (refresh tokens last 7 days): the cards say so. */
export function googleTesting(source: NodeJS.ProcessEnv = process.env): boolean {
  return env("GOOGLE_CALENDAR_APP_STATUS", source).toLowerCase() === "testing";
}
