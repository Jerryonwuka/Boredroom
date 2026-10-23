/**
 * Connected apps, client-safe types (owner decisions, 22 October 2026: connectors). What the screens get from the API and
 * what each provider's entry (src/lib/connectors/providers/<id>.ts, owned by its adapter group) looks like. No secrets,
 * no tokens, never a personal connection's existence for anyone but its person.
 */

export const PROVIDER_IDS = ["google_calendar", "outlook_calendar", "slack", "teams", "notion", "linear", "jira", "github", "asana", "fake"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];
export type ConnectionKind = "workspace" | "personal";
export type Category = "calendar" | "chat" | "knowledge" | "work";
export type ItemKind = "event" | "issue" | "page";
export type ItemState = "open" | "in_progress" | "done" | "cancelled";
export type SourceKind = "channel" | "team" | "project" | "repo" | "calendar" | "page";
export type ConnectionStatus = "active" | "needs_reauth" | "paused" | "disconnecting";
export type RoutePurpose = "daily_digest" | "standup" | "reminders";

/** A provider's card copy and setup steps. Client-safe: variable names, never values. */
export type ProviderEntry = {
  id: ProviderId;
  slug: string;
  label: string;
  category: Category;
  kinds: ConnectionKind[];
  /** One line each, for the cards (§11). `{name}`: the person's assistant; `{workspace}`: the workspace's name. */
  workspace?: { what: string; sees: string[]; does: string[]; note?: string };
  personal?: { what: string; sees: string[]; does: string[]; actLabel: string; note?: string };
  /** For the "Not set up yet" card, owners only. No secrets: variable names, the redirect path and the console's name. */
  setup: { console: string; steps: string[]; env: string[]; redirectPath: string; webhookPath?: string; extraUrls?: { label: string; path: string }[] };
  /** Where a person removes Boredroom in the app itself, when the app has no revoke endpoint. */
  removeAt?: string;
};

export const PROVIDER_SLUGS: Record<ProviderId, string> = {
  google_calendar: "google-calendar",
  outlook_calendar: "outlook",
  slack: "slack",
  teams: "teams",
  notion: "notion",
  linear: "linear",
  jira: "jira",
  github: "github",
  asana: "asana",
  fake: "fake",
};

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  google_calendar: "Google Calendar",
  outlook_calendar: "Outlook Calendar",
  slack: "Slack",
  teams: "Microsoft Teams",
  notion: "Notion",
  linear: "Linear",
  jira: "Jira",
  github: "GitHub",
  asana: "Asana",
  fake: "Test app",
};

export const PROVIDER_CATEGORY: Record<ProviderId, Category> = {
  google_calendar: "calendar",
  outlook_calendar: "calendar",
  slack: "chat",
  teams: "chat",
  notion: "knowledge",
  linear: "work",
  jira: "work",
  github: "work",
  asana: "work",
  fake: "work",
};

export const PROVIDER_KINDS: Record<ProviderId, ConnectionKind[]> = {
  google_calendar: ["personal"],
  outlook_calendar: ["personal"],
  slack: ["workspace"],
  teams: ["workspace"],
  notion: ["workspace", "personal"],
  linear: ["workspace", "personal"],
  jira: ["workspace", "personal"],
  github: ["workspace", "personal"],
  asana: ["workspace", "personal"],
  fake: ["workspace", "personal"],
};

export function isProviderId(v: unknown): v is ProviderId {
  return typeof v === "string" && (PROVIDER_IDS as readonly string[]).includes(v);
}

export function providerFromSlug(slug: string): ProviderId | null {
  for (const id of PROVIDER_IDS) if (PROVIDER_SLUGS[id] === slug) return id;
  return null;
}

/**
 * The framework's placeholder entry (22 October 2026), replaced by each adapter group's own file. Plain name, kinds and
 * category; the copy says nothing it can't stand behind.
 */
export function stubEntry(id: ProviderId): ProviderEntry {
  const slug = PROVIDER_SLUGS[id];
  const label = PROVIDER_LABELS[id];
  const kinds = PROVIDER_KINDS[id];
  return {
    id,
    slug,
    label,
    category: PROVIDER_CATEGORY[id],
    kinds,
    ...(kinds.includes("workspace") ? { workspace: { what: `Bring ${label} into Boredroom for everyone.`, sees: [], does: [] } } : {}),
    ...(kinds.includes("personal") ? { personal: { what: `Connect your own ${label}.`, sees: [], does: [], actLabel: "{name} can make changes when you ask" } } : {}),
    setup: { console: label, steps: [], env: [], redirectPath: `/api/connectors/${slug}/callback` },
  };
}

// --- Views (what the API answers) ------------------------------------------------------------------------------------

export type ConnectionView = {
  id: string;
  provider: ProviderId;
  kind: ConnectionKind;
  status: ConnectionStatus;
  accountLabel: string | null;
  canRead: boolean;
  canAct: boolean;
  lastSyncAt: string | null;
  lastOkAt: string | null;
  /** A fixed code (CONNECTOR_WORDS.errors), never provider text. */
  errorCode: string | null;
  errorAt: string | null;
  backoffUntil: string | null;
  createdAt: string;
  /** Workspace connections, for owners and HR only: how many sources are selected. */
  selectedSources?: number;
  /** Non-secret settings the screens may show (e.g. GitHub's "waiting for approval"). */
  settings?: Record<string, unknown>;
  /** Whether acting would need more consent from the app (scopes not yet granted). */
  actScopesGranted?: boolean;
};

/** What everyone else sees of a workspace connection: what it's for, nothing about who connected it. */
export type WorkspaceConnectionSummary = {
  id: string;
  provider: ProviderId;
  status: ConnectionStatus;
  accountLabel: string | null;
  sources: number;
};

export type PolicyView = { provider: ProviderId; personalAllowed: boolean; brendaReads: boolean; brendaActs: boolean };

export type SourceView = {
  id: string;
  kind: SourceKind;
  label: string;
  selected: boolean;
  audienceTeamId: string | null;
  members: number | null;
  isPrivate: boolean | null;
  archived: boolean;
};

export type RouteView = {
  id: string;
  purpose: RoutePurpose;
  teamId: string | null;
  sourceId: string;
  sourceLabel: string;
  provider: ProviderId;
  enabled: boolean;
  enabledAt: string | null;
};

export type CatalogueCard = {
  entry: ProviderEntry;
  configured: boolean;
  /** Owners and HR only: the full redirect URL for the setup disclosure (no secret). */
  redirectUrl?: string;
  webhookUrl?: string;
  /** Owners and HR: other URLs a console asks for (GitHub's Setup URL), filled from APP_ORIGIN (fix, 22 October 2026). */
  extraUrls?: { label: string; url: string }[];
  googleTesting?: boolean;
};

export type ConnectorsView = {
  ready: boolean;
  /** The plan includes connected apps. */
  enabled: boolean;
  canManage: boolean;
  impersonating: boolean;
  catalogue: CatalogueCard[];
  policies: PolicyView[];
  /** Owners and HR: full views. */
  workspace: ConnectionView[];
  /** Everyone else: what the workspace's connections are for. */
  workspaceSummary: WorkspaceConnectionSummary[];
  /** The viewer's own personal connections (empty while impersonated). */
  personal: ConnectionView[];
  routes: RouteView[];
  teams: { id: string; name: string }[];
  assistantName: string;
  /** The workspace's assistant name (fix, 22 October 2026: the workspace cards say it, not "Brenda"). */
  workspaceAssistantName?: string;
};

export type DayEvent = {
  id: string;
  provider: ProviderId;
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  online: boolean;
  response: string | null;
  now: boolean;
};

export type DayItem = {
  id: string;
  provider: ProviderId;
  kind: ItemKind;
  subtype: string | null;
  externalKey: string | null;
  title: string;
  stateLabel: string | null;
  state: ItemState | null;
  dueOn: string | null;
  dueAt: string | null;
  url: string | null;
  containerLabel: string | null;
  visibility: ConnectionKind;
  hidden: boolean;
  linkedTask: { id: string; title: string } | null;
};

export type ConnectedDayView = {
  ready: boolean;
  enabled: boolean;
  date: string;
  /** Something feeds this person's day: their calendar or work apps, or the workspace's work apps with chosen sources. */
  connected: boolean;
  /** The person has a calendar connected (fix, 22 October 2026: otherwise the calendar column offers to connect one). */
  hasCalendar?: boolean;
  events: DayEvent[];
  items: DayItem[];
  hiddenCount: number;
  attention: { provider: ProviderId; kind: ConnectionKind }[];
  /** Staff and team leads may track items as to-dos. */
  canTrack: boolean;
  meeting: { active: boolean; until: string | null };
};
