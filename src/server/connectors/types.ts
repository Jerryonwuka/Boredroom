/**
 * Connected apps: the contract every adapter implements (owner decisions, 22 October 2026: connectors). Framework-owned:
 * adapters import it and never edit it. Server-only.
 */
import type { ZodType } from "zod";

export const PROVIDER_IDS = ["google_calendar", "outlook_calendar", "slack", "teams", "notion", "linear", "jira", "github", "asana", "fake"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];
export type ConnectionKind = "workspace" | "personal";
export type Category = "calendar" | "chat" | "knowledge" | "work";
export type ItemKind = "event" | "issue" | "page";
export type ItemState = "open" | "in_progress" | "done" | "cancelled";
export type Risk = "private" | "shared" | "destructive";
export type SourceKind = "channel" | "team" | "project" | "repo" | "calendar" | "page";

export type ConnectorErrorCode =
  | "REAUTH_REQUIRED" | "REVOKED" | "RATE_LIMITED" | "FORBIDDEN" | "NOT_FOUND" | "PROVIDER_DOWN" | "BAD_RESPONSE"
  | "ADMIN_APPROVAL" | "NOT_ALLOWED" | "TOO_LARGE" | "CONFLICT" | "NOT_CONFIGURED";

/** Thrown by adapters and the HTTP client. `message` is for logs and is never shown; people see words from lib/connectors/words. */
export class ConnectorError extends Error {
  constructor(public readonly code: ConnectorErrorCode, message: string, public readonly retryAfterSeconds?: number) {
    super(message);
    this.name = "ConnectorError";
  }
}

/** One connection as an adapter sees it. Never holds a token. */
export type ConnectionRef = {
  id: string; organisationId: string; provider: ProviderId; kind: ConnectionKind;
  membershipId: string | null; connectedBy: string;
  externalAccountId: string; externalTenantId: string | null; accountLabel: string | null;
  scopes: string[]; settings: Record<string, unknown>; canRead: boolean; canAct: boolean;
};

export type HttpRequest = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Absolute https URL; its host must be in the adapter's `hosts` (SSRF guard). */
  url: string;
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  json?: unknown;
  form?: Record<string, string>;
  /** 'bearer' (default): the connection's access token. 'none': no auth. 'header': the caller set Authorization itself. */
  auth?: "bearer" | "none" | "header";
  /** Default 10 000 ms; at most 30 000. */
  timeoutMs?: number;
  /** Points against a shared budget (Jira's global pool); see `limits.budget`. */
  cost?: number;
  expect?: "json" | "text" | "none";
};
export type HttpResponse<T = unknown> = { status: number; headers: Headers; body: T };
/**
 * Bound to one connection: injects and refreshes the token (once on a 401), honours 429 and Retry-After (sets the
 * connection's backoff and throws RATE_LIMITED), caps responses at 5 MB, times out, and never logs a body or a token.
 */
export interface ProviderHttp {
  request<T = unknown>(req: HttpRequest): Promise<HttpResponse<T>>;
}

export type TokenSet = {
  accessToken: string; refreshToken: string | null; tokenType: string;
  expiresAt: Date | null; refreshExpiresAt: Date | null; scopes: string[] | null;
  /** Provider extras kept encrypted with the tokens (e.g. GitHub's verifying user token for an installation). */
  extra?: Record<string, string>;
  /** Non-secret facts from the token response (Slack team, Notion workspace, Microsoft tenant, id_token claims). */
  facts?: Record<string, unknown>;
};

export type AuthorizeContext = {
  kind: ConnectionKind; act: boolean; upgrade: boolean;
  redirectUri: string; state: string; nonce: string; codeChallenge: string | null;
};

export interface OAuthConfig {
  authorizeUrl: string | ((c: AuthorizeContext) => string);
  tokenUrl: string;
  clientId: () => string;
  clientSecret: () => string;
  /** How the client authenticates at the token endpoint. */
  clientAuth: "body" | "basic";
  tokenBody: "form" | "json";
  pkce: "S256" | "none";
  scopeSeparator: " " | ",";
  scopes(c: { kind: ConnectionKind; act: boolean }): string[];
  authorizeParams?(c: AuthorizeContext): Record<string, string>;
  /** The provider's token response (code exchange or refresh) as a TokenSet; throws ConnectorError on an error body. */
  parseToken(body: unknown, now: Date): TokenSet;
  refresh: "rotating" | "reusable" | "none";
}

/** Who and what was connected, from `identify`. Labels are container-level for workspace connections, never a person's email. */
export type AccountInfo = {
  externalAccountId: string;
  externalTenantId: string | null;
  accountLabel: string;
  /** The connecting person's own id in the app (personal connections; recorded in connector_identities). */
  identity?: { externalUserId: string; email?: string | null };
  scopes?: string[];
  settings?: Record<string, unknown>;
};

export type SourceInfo = { kind: SourceKind; externalId: string; label: string; members?: number | null; isPrivate?: boolean; archived?: boolean };

export type NormalisedItem = {
  kind: ItemKind;
  subtype?: "issue" | "pull_request" | "task" | "page" | "row";
  externalId: string;
  externalKey?: string | null;           // "ENG-12", "#123", "PROJ-7"
  url?: string | null;                   // https, a host in the adapter's `linkHosts`
  title: string;
  state?: ItemState | null;
  stateLabel?: string | null;            // the app's own words ("In review")
  priority?: 0 | 1 | 2 | 3 | 4 | null;   // 0 none, 1 urgent … 4 low (Linear's scale; others mapped)
  sourceExternalId?: string | null;      // which selected source it came from (workspace)
  containerLabel?: string | null;        // team, project or repository name
  assigneeExternalId?: string | null;
  assigneeLabel?: string | null;
  assigneeEmail?: string | null;         // never stored: the sink keeps a keyed digest only
  /** Every container the item is in (an Asana task in several projects); the sink picks a selected one (security fix, 22 October 2026). */
  sourceCandidates?: string[] | null;
  mine?: boolean;
  dueOn?: string | null;                 // YYYY-MM-DD
  dueAt?: string | null;                 // ISO
  startsAt?: string | null; endsAt?: string | null; allDay?: boolean | null;
  busy?: boolean | null;
  response?: "accepted" | "tentative" | "declined" | "needs_action" | "organiser" | null;
  online?: boolean | null;
  guests?: number | null;
  excerpt?: string | null;               // issue description start, page text (markdown)
  providerUpdatedAt?: string | null;
};

export type SyncSink = {
  upsert(items: NormalisedItem[]): Promise<void>;
  gone(kind: ItemKind, externalIds: string[]): Promise<void>;
  /** A windowed re-list: every item of `kind` in [from, to) that this run did not see is gone. */
  reconcileWindow(kind: ItemKind, from: Date, to: Date, seenExternalIds: string[]): Promise<void>;
  /** A full reconciliation of open items: every open item of `kind` not in `openExternalIds` is gone (or reassigned away). */
  reconcileOpen(kind: ItemKind, openExternalIds: string[]): Promise<void>;
};

export type StreamSpec = {
  name: string;                          // "events", "issues", "pages"
  kinds: ItemKind[];
  every: { workingMinutes: number; offMinutes: number };
  perRun: { pages: number; items: number; ms: number };
  /** How often to do a full reconciliation instead of "updated since" (minutes). */
  fullEveryMinutes: number;
};
export type SyncInput = {
  conn: ConnectionRef; http: ProviderHttp; stream: string; cursor: string | null; full: boolean;
  selected: SourceInfo[]; now: Date; timeZone: string; sink: SyncSink; deadline: number;
};
export type SyncResult = { cursor: string | null; more: boolean };

export type StoredItem = { id: string; externalId: string; externalKey: string | null; kind: ItemKind; title: string; url: string | null; state: ItemState | null; containerLabel: string | null; sourceExternalId: string | null; assigneeExternalId: string | null; startsAt: string | null; endsAt: string | null; guests: number | null; response: string | null };
export type StoredSource = { id: string; kind: SourceKind; externalId: string; label: string; members: number | null };
/** The person asking, for attribution ("Jo via Max") and readbacks. */
export type Actor = { membershipId: string; firstName: string; displayName: string; email: string | null; assistantName: string; timeZone: string };

export type Prepared = {
  risk: Risk;
  /** The card's title: "Post in #design on Slack". */
  summary: string;
  /** The exact words that will be sent, shown in full on the card. */
  detail?: string;
  /** Who receives what (lib/confirm-readback's Readback): server-built from validated input and resolved data. */
  readback: { to: string[]; what?: string };
  /** "the Boredroom app, signed “Jo via Max”" | "you (jo@acme.com)" | "Jerry Onwuka's Microsoft account". */
  appearsAs: string;
  /** For the Confirm card's "Still asking" line and act decisions. */
  place?: string;                         // "#design"
  people?: number | null;                 // channel members, when known
};
export type ActResult = { summary: string; href?: string | null; item?: NormalisedItem | null; undo?: { kind: string; data: Record<string, unknown> } | null };
export type ActInput<I> = { conn: ConnectionRef; http: ProviderHttp; actor: Actor; input: I; item: StoredItem | null; source: StoredSource | null; now: Date };

export interface ActionSpec<I = Record<string, unknown>> {
  /** "post", "create_issue", "comment", "set_state", "assign", "set_due", "block", "invite", "rsvp", "move", "cancel", "create_page", "append", "page_comment". */
  name: string;
  /** Which Brenda tool offers it (§9). */
  tool: "calendar_action" | "work_item_action" | "notion_action" | "post_to_channel";
  /** Validated again by the framework before prepare and before run (a Confirm press re-validates). */
  input: ZodType<I>;
  /** Connection kinds that may perform it (Jira and Asana: personal only; Slack and Teams: workspace only). */
  kinds: readonly ConnectionKind[];
  /** Builds the card (and refuses with a ConnectorError NOT_ALLOWED where it must). May read from the app. */
  prepare(c: ActInput<I>): Promise<Prepared>;
  run(c: ActInput<I>): Promise<ActResult>;
  /** Private actions only: take it back within the Undo window. */
  undo?(c: { conn: ConnectionRef; http: ProviderHttp; data: Record<string, unknown> }): Promise<void>;
}

/**
 * Which connections or items a verified webhook delivery concerns: by the connection's `external_tenant_id`, its
 * `external_account_id` (or a personal identity's external user id), or a registered hook. `externalId` + `kind`: refresh
 * that one item; without them: sync the connection's streams. `revoked`: the app says Boredroom was removed.
 */
// `at` (security fix, 22 October 2026): when the app says a removal happened; a connection made after it is left alone, so
// a replayed delivery can't disconnect it. A `webhook` route with `ours` matches only Boredroom's own hook id (which the
// hook's URL carries), never a provider's hook id, which can repeat across tenants; `matched` then must include the
// provider's id for that hook.
export type WebhookRoute =
  | { by: "tenant"; tenantId: string; externalId?: string; kind?: ItemKind; revoked?: boolean; at?: string }
  | { by: "account"; accountId: string; externalId?: string; kind?: ItemKind; revoked?: boolean; at?: string }
  | { by: "webhook"; webhookId: string; externalId?: string; kind?: ItemKind; ours?: boolean; matched?: string[] };

/** For an adapter's periodic obligation (Atlassian personal data reporting). Runs in the worker. */
export type MaintenanceInput = {
  /** The provider's live connections (all workspaces). */
  connections: ConnectionRef[];
  httpFor(conn: ConnectionRef): ProviderHttp;
  /** Every stored external user id of this provider (identities and item assignees), with when Boredroom last changed it and a connection on its site. */
  accounts(): Promise<{ externalUserId: string; tenantId: string | null; updatedAt: string; connectionId: string }[]>;
  /** Erase what Boredroom holds about one account (identity rows deleted, assignee id and label nulled on items). */
  eraseAccount(externalUserId: string): Promise<void>;
  now: Date;
};

export interface ProviderAdapter {
  id: ProviderId;
  category: Category;
  kinds: readonly ConnectionKind[];
  /** API hosts the HTTP client may call. */
  hosts: readonly string[];
  /** Hosts an item's `url` may point at (links shown to people). */
  linkHosts: readonly string[];
  /** Environment variables that must be set for the provider to be offered. */
  env: readonly string[];
  configured(env?: NodeJS.ProcessEnv): boolean;
  oauth: OAuthConfig;
  /** A custom first hop (GitHub installs the app before the person authorises); null: the standard authorize URL. */
  begin?(c: { kind: ConnectionKind; state: string }): { url: string } | null;
  /** After the code exchange: who and what was connected. Verify anything a redirect claimed (GitHub installation). */
  identify(c: { kind: ConnectionKind; http: ProviderHttp; tokens: TokenSet; pending: Record<string, unknown> }): Promise<AccountInfo>;
  /** Workspace tokens belong to the person who connected (Jira, Asana, Teams): they stop when that person leaves. */
  ownerBound: boolean;
  /** A workspace connection may act as the app (Slack bot, Linear app actor, GitHub App, Notion integration). */
  workspaceActs: boolean;
  sources?(c: { conn: ConnectionRef; http: ProviderHttp }): Promise<SourceInfo[]>;
  streams: readonly StreamSpec[];
  sync?(c: SyncInput): Promise<SyncResult>;
  fetchItem?(c: { conn: ConnectionRef; http: ProviderHttp; kind: ItemKind; externalId: string }): Promise<NormalisedItem | null>;
  /** Long text for read_app_item (Notion page markdown, an issue's description), at most `maxChars`. */
  fetchText?(c: { conn: ConnectionRef; http: ProviderHttp; kind: ItemKind; externalId: string; maxChars: number }): Promise<string | null>;
  /** Typed specs (`ActionSpec<{ channel: string; text: string }>`) fit here: methods are checked bivariantly. */
  actions: readonly ActionSpec[];
  /** Provider-specific error bodies (Slack `ok:false`, GraphQL `errors`, Notion `code`) as a ConnectorError, or null. */
  interpret?(res: HttpResponse<unknown>): ConnectorError | null;
  webhook?: {
    /** Verify a delivery on its raw bytes; `reply` short-circuits (Slack url_verification, Asana handshake). */
    verify(c: { raw: Uint8Array; headers: Headers; url: URL; secretFor(hookId: string): Promise<string | null>; saveSecret(hookId: string, secret: string): Promise<boolean> }):
      Promise<{ ok: true; deliveryId: string; reply?: Response } | { ok: false }>;
    /** `url`: the delivery's URL; `hookId`: Boredroom's hook id from its path (Asana). */
    route(c: { body: unknown; headers: Headers; url?: URL; hookId?: string }): WebhookRoute[];
  };
  /** Register webhooks for a new connection (Jira dynamic, Asana handshake); renew before `expiresAt`. */
  /** `selected`: the connection's selected sources (security fix, 22 October 2026: hooks only where the workspace chose). */
  registerWebhooks?(c: { conn: ConnectionRef; http: ProviderHttp; hookUrl(hookId: string): string; newHook(): Promise<string>; selected?: SourceInfo[] }): Promise<{ hookId: string; externalId: string; expiresAt: Date | null }[]>;
  renewWebhook?(c: { conn: ConnectionRef; http: ProviderHttp; externalId: string }): Promise<Date | null>;
  deleteWebhook?(c: { conn: ConnectionRef; http: ProviderHttp; externalId: string }): Promise<void>;
  revoke?(c: { conn: ConnectionRef; http: ProviderHttp; tokens: TokenSet }): Promise<void>;
  limits?: { budget?: { bucket: string; capPerHour: number }; spacingMs?: number };
  /** Periodic provider obligations (Atlassian personal data reporting). */
  maintenance?: readonly { name: string; everyHours: number; run(c: MaintenanceInput): Promise<void> }[];
}
