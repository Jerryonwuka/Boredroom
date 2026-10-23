/**
 * Connected apps: the catalogue (owner decisions, 22 October 2026: connectors). One entry per provider, each owned by its
 * adapter group in src/lib/connectors/providers/<id>.ts, in the order the screens show them. Client-safe.
 */
import type { ProviderEntry, ProviderId, Category } from "./types";
import { entry as googleCalendar } from "./providers/google-calendar";
import { entry as outlookCalendar } from "./providers/outlook-calendar";
import { entry as slack } from "./providers/slack";
import { entry as teams } from "./providers/teams";
import { entry as notion } from "./providers/notion";
import { entry as linear } from "./providers/linear";
import { entry as jira } from "./providers/jira";
import { entry as github } from "./providers/github";
import { entry as asana } from "./providers/asana";
import { entry as fake } from "./providers/fake";

export const CATALOGUE: readonly ProviderEntry[] = [googleCalendar, outlookCalendar, slack, teams, notion, linear, jira, github, asana, fake];

const BY_ID = new Map<ProviderId, ProviderEntry>(CATALOGUE.map((e) => [e.id, e]));

export function entryOf(id: ProviderId): ProviderEntry {
  const e = BY_ID.get(id);
  if (!e) throw new Error(`no catalogue entry for ${id}`);
  return e;
}

export const CATEGORY_ORDER: readonly Category[] = ["calendar", "chat", "knowledge", "work"];

/** `{name}` and `{workspace}` filled in an entry's line. */
export function fillWords(s: string, o: { name: string; workspace?: string }): string {
  return s.replace(/\{name\}/g, o.name).replace(/\{workspace\}/g, o.workspace ?? "your workspace");
}
