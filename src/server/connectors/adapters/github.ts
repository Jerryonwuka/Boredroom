/**
 * GitHub adapter, a GitHub App (work group, owner decisions 22 October 2026: connectors; spec §2, §5.3, §7, §8.7, §9).
 *
 * - Workspace connections are an installation: start sends the owner to `github.com/apps/<slug>/installations/new`,
 *   GitHub's Setup URL brings them back with an `installation_id` (a claim only), then the user authorisation (PKCE
 *   S256) gives a user token that must list that installation (github-app.ts). The connection then works with
 *   installation tokens minted from the App's JWT (1 hour); the verifying user token is kept sealed in `extra`.
 *   `workspaceActs: true`: changes appear as `<slug>[bot]` with the "From Jo via Max" line the card shows.
 * - Personal connections are the person's own expiring user token (8 hours, refresh 6 months, rotating). They read the
 *   issues and pull requests assigned to the person (and pull requests waiting for their review) in repositories where
 *   the App is installed, and act as the person.
 * - Permissions are set on the App (Issues read and write, Pull requests read, Metadata read), not asked per flow, so
 *   `scopes` is empty. Pull requests are read-only; GitHub has no due dates (set_due is not offered).
 * - Who connects for a workspace (security fix, 22 October 2026): only an admin of the installation's account (the
 *   personal account itself, or an organisation owner). GitHub lists an installation to anyone with access to one of its
 *   repositories, while its token reaches all of them; the App therefore also needs "Members: read" (organisation), and
 *   the check runs again on every full sync and every read of the repository list (needs reconnecting when it fails).
 * - Webhooks: the App's own (`X-Hub-Signature-256`), for issues, pull requests, installations and revoked authorisations.
 *   Deliveries are de-duplicated on the signed body (security fix, 22 October 2026: GitHub's delivery header isn't
 *   signed, so a replayed delivery under a fresh header is still the same delivery); an installation's removal names its
 *   time, so a replay can't disconnect a later connection; a revoked authorisation only asks for a sync, which finds out
 *   with Boredroom's own token.
 * - Rate limits: a run stops when `x-ratelimit-remaining` drops under 100; secondary limits (403/429 with `retry-after`)
 *   back off.
 * Server-only.
 */
import { createHash, createHmac } from "node:crypto";
import { z } from "zod";
import { env, envAll } from "../env";
import { safeEqual } from "../crypto";
import { registerTokenMinter, tokenEndpoint } from "../tokens";
import { APP_READBACK } from "@/lib/connectors/words";
import {
  ConnectorError, type ActInput, type ActionSpec, type ConnectionRef, type HttpRequest, type HttpResponse, type NormalisedItem,
  type ProviderAdapter, type ProviderHttp, type SourceInfo, type TokenSet, type WebhookRoute,
} from "../types";
import { GITHUB_API, GITHUB_HEADERS, mintInstallationToken, stillAdministers, userAdministers, userInstallations, verifyInstallation } from "./github-app";

const ENV = ["GITHUB_APP_ID", "GITHUB_APP_SLUG", "GITHUB_APP_CLIENT_ID", "GITHUB_APP_CLIENT_SECRET", "GITHUB_APP_PRIVATE_KEY", "GITHUB_APP_WEBHOOK_SECRET"] as const;
const APP = "GitHub";
const PAGE_INC = 50;
const PAGE_OPEN = 100;
const OPEN_MAX = { personal: 500, workspace: 2000 } as const;
const OVERLAP_MS = 2 * 60_000;
const RECENT_AFTER_FULL_MS = 48 * 3600_000;
const REVIEW_EVERY_MS = 30 * 60_000;
const RATE_FLOOR = 100;
const BODY_MAX = 2000;
const MAX_REPOS = 50;
/** "owner/name"; neither part only dots (no "..", which a URL would resolve to another API path). */
const REPO = /^(?!\.+\/)[A-Za-z0-9_.-]{1,100}\/(?!\.+$)[A-Za-z0-9_.-]{1,100}$/;
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const ITEM_ID = /^((?!\.+\/)[A-Za-z0-9_.-]{1,100}\/(?!\.+#)[A-Za-z0-9_.-]{1,100})#(\d{1,10})$/;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const idOf = (v: unknown): string | null => (typeof v === "number" && Number.isFinite(v) ? String(v) : typeof v === "string" && /^\d{1,20}$/.test(v) ? v : null);
const plainName = (s: unknown) => String(s ?? "").replace(/[^\p{L}\p{N} .,'@_/-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 60);

async function refuse(words: string): Promise<never> {
  const { ActRefusal } = await import("../actions");
  throw new ActRefusal(words);
}

/** Every GitHub REST call: its media type and API version. */
const gh = <T = unknown>(http: ProviderHttp, req: HttpRequest): Promise<HttpResponse<T>> => http.request<T>({ ...req, headers: { ...GITHUB_HEADERS, ...(req.headers ?? {}) } });

/** "owner/repo#12" (owner and repository lower-cased: GitHub's names are case-insensitive) and its parts. */
export const itemIdOf = (fullName: string, n: number | string) => `${fullName.toLowerCase()}#${n}`;
export function parseItemId(id: string): { repo: string; number: string } | null {
  const m = ITEM_ID.exec(id);
  return m ? { repo: m[1], number: m[2] } : null;
}
const repoPath = (repo: string) => repo.split("/").map(encodeURIComponent).join("/");
const lowRateLeft = (h: Headers) => {
  const v = h.get("x-ratelimit-remaining");
  return v !== null && v !== "" && Number(v) < RATE_FLOOR;
};

// ---- Tokens -----------------------------------------------------------------------------------------------------------------

export function parseToken(body: unknown, now: Date): TokenSet {
  const b = rec(body);
  // GitHub answers token errors with 200 and an `error` (bad_verification_code, bad_refresh_token, incorrect_client_credentials).
  if (typeof b.error === "string") {
    throw new ConnectorError(b.error === "bad_refresh_token" || b.error === "bad_verification_code" || b.error === "unauthorized" ? "REAUTH_REQUIRED" : "BAD_RESPONSE", `github token error ${b.error.slice(0, 40)}`);
  }
  if (typeof b.access_token !== "string" || !b.access_token) throw new ConnectorError("BAD_RESPONSE", "github token missing");
  return {
    accessToken: b.access_token,
    refreshToken: typeof b.refresh_token === "string" && b.refresh_token ? b.refresh_token : null,
    tokenType: "bearer",
    expiresAt: typeof b.expires_in === "number" ? new Date(now.getTime() + b.expires_in * 1000) : null,
    refreshExpiresAt: typeof b.refresh_token_expires_in === "number" ? new Date(now.getTime() + b.refresh_token_expires_in * 1000) : null,
    scopes: typeof b.scope === "string" ? b.scope.split(/[\s,]+/).filter(Boolean) : null,
  };
}

/**
 * The working token (framework minter seam, 22 October 2026): a workspace connection's installation token is minted
 * from the App's JWT; a person's user token (and a workspace connection still waiting for approval) is refreshed with
 * its refresh token at GitHub's token endpoint.
 */
export async function mintGithubTokens(c: { conn: ConnectionRef; tokens: TokenSet; now: Date }): Promise<TokenSet> {
  if (c.conn.kind === "workspace" && c.conn.externalTenantId) {
    const inst = await mintInstallationToken(c.conn.externalTenantId, c.now, { fresh: true });
    return { accessToken: inst.token, refreshToken: null, tokenType: "bearer", expiresAt: inst.expiresAt, refreshExpiresAt: null, scopes: null, ...(c.tokens.extra ? { extra: c.tokens.extra } : {}) };
  }
  if (!c.tokens.refreshToken) throw new ConnectorError("REAUTH_REQUIRED", "no github refresh token");
  const res = await tokenEndpoint(adapter, { grant_type: "refresh_token", refresh_token: c.tokens.refreshToken });
  if (res.status >= 500) throw new ConnectorError("PROVIDER_DOWN", `github token endpoint answered ${res.status}`);
  if (res.status === 429) throw new ConnectorError("RATE_LIMITED", "github token endpoint rate limited", 60);
  if (res.status >= 400) throw new ConnectorError("REAUTH_REQUIRED", `github token endpoint refused (${res.status})`);
  const next = parseToken(res.body, c.now);
  return { ...next, refreshToken: next.refreshToken ?? c.tokens.refreshToken, ...(c.tokens.extra ? { extra: c.tokens.extra } : {}) };
}

// ---- Items ------------------------------------------------------------------------------------------------------------------

/** The repository's "owner/name" from an issue (the `repository` object, or the `repository_url`). */
function repoOf(r: Record<string, unknown>, fallback?: string): string | null {
  const full = str(rec(r.repository).full_name);
  if (full && REPO.test(full)) return full;
  const m = /\/repos\/([^/]+\/[^/]+)$/.exec(str(r.repository_url) ?? "");
  if (m && REPO.test(m[1])) return m[1];
  return fallback && REPO.test(fallback) ? fallback : null;
}

export function issueItem(conn: ConnectionRef, raw: unknown, o: { repo?: string; reviewRequested?: boolean } = {}): NormalisedItem | null {
  const r = rec(raw);
  const repo = repoOf(r, o.repo);
  const n = typeof r.number === "number" ? r.number : null;
  if (!repo || n === null) return null;
  const pr = r.pull_request !== undefined && r.pull_request !== null ? rec(r.pull_request) : null;
  const isPr = pr !== null || typeof r.merged_at !== "undefined" && "requested_reviewers" in r;
  const mergedAt = str(pr?.merged_at) ?? str(r.merged_at);
  const closed = r.state === "closed";
  const notPlanned = r.state_reason === "not_planned";
  const state = !closed ? "open" : mergedAt ? "done" : notPlanned ? "cancelled" : "done";
  const me = conn.externalAccountId;
  const assignees = [...arr(r.assignees), ...(r.assignee ? [r.assignee] : [])].map((a) => idOf(rec(a).id)).filter(Boolean);
  const reviewers = arr(r.requested_reviewers).map((a) => idOf(rec(a).id)).filter(Boolean);
  const reviewRequested = !!o.reviewRequested || (conn.kind === "personal" && reviewers.includes(me));
  const assignee = rec(r.assignee);
  const body = str(r.body);
  return {
    kind: "issue",
    subtype: isPr ? "pull_request" : "issue",
    externalId: itemIdOf(repo, n),
    externalKey: `${repo}#${n}`,
    url: str(r.html_url),
    title: str(r.title) ?? `${repo}#${n}`,
    state,
    stateLabel: !closed ? (isPr && reviewRequested && !assignees.includes(me) ? "Review requested" : r.draft === true ? "Draft" : "Open") : mergedAt ? "Merged" : notPlanned ? "Closed as not planned" : "Closed",
    priority: null,
    sourceExternalId: repo.toLowerCase(),
    containerLabel: repo,
    assigneeExternalId: idOf(assignee.id),
    assigneeLabel: str(assignee.login),
    mine: conn.kind === "personal" && (assignees.includes(me) || reviewRequested),
    excerpt: body ? body.slice(0, BODY_MAX) : null,
    providerUpdatedAt: str(r.updated_at),
  };
}

async function fetchIssue(conn: ConnectionRef, http: ProviderHttp, externalId: string): Promise<NormalisedItem | null> {
  const p = parseItemId(externalId);
  if (!p) return null;
  let r: HttpResponse<unknown>;
  try { r = await gh(http, { url: `${GITHUB_API}/repos/${repoPath(p.repo)}/issues/${p.number}` }); }
  catch (err) { if (err instanceof ConnectorError && err.code === "NOT_FOUND") return null; throw err; }
  const issue = rec(r.body);
  if (issue.pull_request && conn.kind === "personal") {
    // Who is asked to review is on the pull request, not the issue.
    const pr = rec((await gh(http, { url: `${GITHUB_API}/repos/${repoPath(p.repo)}/pulls/${p.number}` })).body);
    return issueItem(conn, { ...issue, requested_reviewers: pr.requested_reviewers ?? [] }, { repo: p.repo });
  }
  return issueItem(conn, issue, { repo: p.repo });
}

// ---- Sync -------------------------------------------------------------------------------------------------------------------

/** The chain's cursor: phase, unit (which list), page, watermark, newest change seen, and when review requests were last read. */
type Cursor = { ph: "open" | "inc"; i: number; w: string | null; pg: number | null; mx: string | null; rs: string | null };
export function readCursor(cursor: string | null, full: boolean, now: Date): Cursor {
  let c: Partial<Cursor> | null = null;
  try { c = cursor ? (JSON.parse(cursor) as Partial<Cursor>) : null; } catch { c = null; }
  const valid = c && (c.ph === "open" || c.ph === "inc");
  const rs = valid ? str(c!.rs) : null;
  if (valid && (c!.pg || c!.ph === "open" || (c!.i ?? 0) > 0)) {
    return { ph: c!.ph!, i: Math.max(0, Math.floor(Number(c!.i ?? 0)) || 0), w: str(c!.w), pg: typeof c!.pg === "number" && c!.pg > 0 ? c!.pg : null, mx: str(c!.mx), rs };
  }
  if (full) return { ph: "open", i: 0, w: null, pg: null, mx: null, rs };
  return { ph: "inc", i: 0, w: (valid ? str(c!.w) : null) ?? new Date(now.getTime() - 30 * 24 * 3600_000).toISOString(), pg: null, mx: null, rs };
}
const newer = (a: string | null, b: string | null) => (!a ? b : !b ? a : Date.parse(a) >= Date.parse(b) ? a : b);
const hasNext = (h: Headers) => /rel="next"/.test(h.get("link") ?? "");

type Unit = { kind: "assigned" } | { kind: "review" } | { kind: "repo"; repo: string };

/** What one phase lists, in order. */
export function unitsFor(conn: ConnectionRef, selected: SourceInfo[], cur: Cursor, now: Date): Unit[] {
  if (conn.kind === "personal") {
    const review = cur.ph === "open" || !cur.rs || now.getTime() - Date.parse(cur.rs) >= REVIEW_EVERY_MS;
    return [{ kind: "assigned" }, ...(review ? [{ kind: "review" } as Unit] : [])];
  }
  return selected.filter((s) => s.kind === "repo" && REPO.test(s.externalId)).slice(0, MAX_REPOS).map((s) => ({ kind: "repo", repo: s.externalId }));
}

function requestFor(unit: Unit, cur: Cursor): HttpRequest {
  const page = cur.pg ?? 1;
  const per = cur.ph === "open" ? PAGE_OPEN : PAGE_INC;
  if (unit.kind === "assigned") {
    return { url: `${GITHUB_API}/issues`, query: { filter: "assigned", state: cur.ph === "open" ? "open" : "all", sort: "updated", direction: "desc", per_page: per, page, ...(cur.ph === "inc" && cur.w ? { since: cur.w } : {}) } };
  }
  if (unit.kind === "review") return { url: `${GITHUB_API}/search/issues`, query: { q: "is:open is:pr review-requested:@me archived:false", per_page: 50, page } };
  return { url: `${GITHUB_API}/repos/${repoPath(unit.repo)}/issues`, query: { state: cur.ph === "open" ? "open" : "all", sort: "updated", direction: "desc", per_page: per, page, ...(cur.ph === "inc" && cur.w ? { since: cur.w } : {}) } };
}

// ---- Actions ----------------------------------------------------------------------------------------------------------------

const asWho = (c: ActInput<unknown>) => (c.conn.kind === "workspace" ? APP_READBACK.as.workspaceApp(c.actor.firstName, c.actor.assistantName) : APP_READBACK.as.yourAccount(c.conn.accountLabel));
/** The line under a workspace connection's words, exactly as the card shows it (§9.5; decision 22 October 2026: §9.5's
 * "signed" line, matching every other app, rather than §8.7's "From Jo via Boredroom:" prefix). */
export const signature = (c: ActInput<unknown>) => `From ${c.actor.firstName} via ${c.actor.assistantName}`;
const signed = (c: ActInput<unknown>, text: string | undefined) => (c.conn.kind === "workspace" ? (text ? `${text}\n\n${signature(c)}` : signature(c)) : text ?? "");

/** The issue an action names, read again from GitHub; pull requests are read-only from Boredroom. */
async function issueFor(c: ActInput<unknown>): Promise<{ repo: string; number: string; key: string; state: string; reason: string | null }> {
  if (!c.item) throw new ConnectorError("NOT_FOUND", "no item");
  const p = parseItemId(c.item.externalId);
  if (!p) throw new ConnectorError("NOT_FOUND", "not a github issue");
  const r = rec((await gh(c.http, { url: `${GITHUB_API}/repos/${repoPath(p.repo)}/issues/${p.number}` })).body);
  const key = c.item.externalKey ?? `${p.repo}#${p.number}`;
  if (r.pull_request) return refuse(`${key} is a pull request. Boredroom only reads pull requests: change it in GitHub itself.`);
  return { ...p, key, state: str(r.state) ?? "open", reason: str(r.state_reason) };
}

const createIssue: ActionSpec<{ title: string; text?: string }> = {
  name: "create_issue", tool: "work_item_action", kinds: ["workspace", "personal"],
  input: z.object({ title: z.string().trim().min(1).max(200), text: z.string().trim().max(4000).optional() }),
  async prepare(c) {
    if (!c.source || c.source.kind !== "repo" || !REPO.test(c.source.externalId)) throw new ConnectorError("NOT_FOUND", "no repository");
    const place = c.source.label;
    const body = signed(c, c.input.text);
    return {
      risk: "shared", summary: APP_READBACK.create_issue.summary(APP, place), ...(body ? { detail: body } : {}),
      readback: { to: [APP_READBACK.create_issue.to(place, APP)], what: APP_READBACK.create_issue.what(c.input.title, asWho(c)) }, appearsAs: asWho(c), place,
    };
  },
  async run(c) {
    if (!c.source || !REPO.test(c.source.externalId)) throw new ConnectorError("NOT_FOUND", "no repository");
    const body = signed(c, c.input.text);
    const r = await gh(c.http, { method: "POST", url: `${GITHUB_API}/repos/${repoPath(c.source.externalId)}/issues`, json: { title: c.input.title, ...(body ? { body } : {}) } });
    const item = issueItem(c.conn, r.body, { repo: c.source.externalId });
    return { summary: `Created ${item?.externalKey ?? "the issue"} “${c.input.title}” in GitHub`, href: item?.url ?? null, item };
  },
};

const comment: ActionSpec<{ text: string }> = {
  name: "comment", tool: "work_item_action", kinds: ["workspace", "personal"],
  input: z.object({ text: z.string().trim().min(1).max(4000) }),
  async prepare(c) {
    const i = await issueFor(c);
    return { risk: "shared", summary: APP_READBACK.comment.summary(i.key), detail: signed(c, c.input.text), readback: { to: [APP_READBACK.comment.to(i.key, APP)], what: APP_READBACK.comment.what(asWho(c)) }, appearsAs: asWho(c) };
  },
  async run(c) {
    const i = await issueFor(c);
    await gh(c.http, { method: "POST", url: `${GITHUB_API}/repos/${repoPath(i.repo)}/issues/${i.number}/comments`, json: { body: signed(c, c.input.text) } });
    return { summary: `Commented on ${i.key}` };
  },
};

type Want = "todo" | "in_progress" | "done" | "cancelled";
const STATE_BODY: Record<Exclude<Want, "in_progress">, { state: string; state_reason: string; label: string }> = {
  todo: { state: "open", state_reason: "reopened", label: "Open" },
  done: { state: "closed", state_reason: "completed", label: "Closed" },
  cancelled: { state: "closed", state_reason: "not_planned", label: "Closed as not planned" },
};
const currentLabel = (state: string, reason: string | null) => (state === "open" ? "Open" : reason === "not_planned" ? "Closed as not planned" : "Closed");

const setState: ActionSpec<{ state: Want }> = {
  name: "set_state", tool: "work_item_action", kinds: ["workspace", "personal"],
  input: z.object({ state: z.enum(["todo", "in_progress", "done", "cancelled"]) }),
  async prepare(c) {
    const i = await issueFor(c);
    if (c.input.state === "in_progress") return refuse("GitHub issues are only open or closed, so there's no “in progress” to move it to.");
    const to = STATE_BODY[c.input.state].label;
    return {
      risk: c.input.state === "cancelled" ? "destructive" : "shared", summary: APP_READBACK.set_state.summary(i.key, to),
      readback: { to: [APP_READBACK.set_state.to(i.key, APP)], what: APP_READBACK.set_state.what(i.key, currentLabel(i.state, i.reason), to) }, appearsAs: asWho(c),
    };
  },
  async run(c) {
    const i = await issueFor(c);
    if (c.input.state === "in_progress") return refuse("GitHub issues are only open or closed.");
    const { label, ...body } = STATE_BODY[c.input.state];
    const r = await gh(c.http, { method: "PATCH", url: `${GITHUB_API}/repos/${repoPath(i.repo)}/issues/${i.number}`, json: body });
    return { summary: `Moved ${i.key} to ${label}`, item: issueItem(c.conn, r.body, { repo: i.repo }) };
  },
};

/** "me" (a personal connection's own login) or a login GitHub says can be assigned in that repository. */
async function assigneeFor(c: ActInput<{ assignee: string }>, repo: string): Promise<{ login: string; name: string; me: boolean }> {
  const wanted = c.input.assignee.trim().replace(/^@/, "");
  if (wanted.toLowerCase() === "me") {
    const login = str(c.conn.settings?.login) ?? c.conn.accountLabel;
    if (c.conn.kind !== "personal" || !login || !LOGIN.test(login)) return refuse("Say your GitHub username, or connect your own GitHub in Settings › Your assistant › Your connections.");
    return { login, name: "you", me: true };
  }
  if (!LOGIN.test(wanted)) return refuse("Say their GitHub username (GitHub assigns by username, not by name or email).");
  try {
    await gh(c.http, { url: `${GITHUB_API}/repos/${repoPath(repo)}/assignees/${encodeURIComponent(wanted)}`, expect: "none" });
  } catch (err) {
    if (err instanceof ConnectorError && err.code === "NOT_FOUND") return refuse(`${plainName(wanted)} can't be assigned issues in ${plainName(repo)} on GitHub.`);
    throw err;
  }
  return { login: wanted, name: wanted, me: false };
}

const assign: ActionSpec<{ assignee: string }> = {
  name: "assign", tool: "work_item_action", kinds: ["workspace", "personal"],
  input: z.object({ assignee: z.string().trim().min(1).max(200) }),
  async prepare(c) {
    const i = await issueFor(c);
    const who = await assigneeFor(c, i.repo);
    return {
      risk: "shared", summary: APP_READBACK.assign.summary(i.key, who.name),
      readback: { to: [APP_READBACK.assign.toPerson(who.me ? "You" : who.name, APP), APP_READBACK.assign.to(i.key, APP)], what: APP_READBACK.assign.what(i.key, who.name) }, appearsAs: asWho(c),
    };
  },
  async run(c) {
    const i = await issueFor(c);
    const who = await assigneeFor(c, i.repo);
    const r = await gh(c.http, { method: "POST", url: `${GITHUB_API}/repos/${repoPath(i.repo)}/issues/${i.number}/assignees`, json: { assignees: [who.login] } });
    return { summary: `Assigned ${i.key} to ${who.name}`, item: issueItem(c.conn, r.body, { repo: i.repo }) };
  },
};

// ---- Webhooks ----------------------------------------------------------------------------------------------------------------------

export function verifyGithubSignature(raw: Uint8Array, header: string | null, secret: string): boolean {
  const m = /^sha256=([0-9a-f]{64})$/i.exec(header ?? "");
  if (!m || !secret) return false;
  return safeEqual(m[1].toLowerCase(), createHmac("sha256", secret).update(raw).digest("hex"));
}

export function routeGithub(event: string | null, body: unknown): WebhookRoute[] {
  const b = rec(body);
  const installation = idOf(rec(b.installation).id);
  const action = str(b.action);
  const repo = str(rec(b.repository).full_name);
  if (event === "installation") {
    if (!installation) return [];
    if (action === "deleted" || action === "suspend") {
      // When it happened, so a replay of an old delivery can't disconnect a connection made since (security fix, 22 October 2026).
      const inst = rec(b.installation);
      const at = str(inst.suspended_at) ?? str(inst.updated_at);
      return [{ by: "tenant", tenantId: installation, revoked: true, ...(at ? { at } : {}) }];
    }
    return action === "unsuspend" || action === "new_permissions_accepted" ? [{ by: "tenant", tenantId: installation }] : [];
  }
  if (event === "installation_repositories") return installation ? [{ by: "tenant", tenantId: installation }] : [];
  if (event === "github_app_authorization") {
    // No time in this event, so it only asks for a sync (security fix, 22 October 2026): Boredroom's own token then
    // finds out whether the authorisation is really gone (and the connection asks to be reconnected).
    const who = idOf(rec(b.sender).id);
    return action === "revoked" && who ? [{ by: "account", accountId: who }] : [];
  }
  if (event !== "issues" && event !== "pull_request") return [];
  const thing = rec(event === "issues" ? b.issue : b.pull_request);
  const n = typeof thing.number === "number" ? thing.number : null;
  if (!repo || !REPO.test(repo) || n === null) return [];
  const externalId = itemIdOf(repo, n);
  const out: WebhookRoute[] = [];
  if (installation) out.push({ by: "tenant", tenantId: installation, externalId, kind: "issue" });
  // People whose own day it concerns: assignees, requested reviewers, and whoever was just added or removed.
  const people = new Set<string>();
  for (const a of [...arr(thing.assignees), ...arr(thing.requested_reviewers), b.assignee, b.requested_reviewer]) {
    const id = idOf(rec(a).id);
    if (id) people.add(id);
  }
  for (const id of [...people].slice(0, 40)) out.push({ by: "account", accountId: id, externalId, kind: "issue" });
  return out;
}

/** A workspace connection whose connecting person no longer administers the installation's account must be reconnected. */
async function requireAdmin(conn: ConnectionRef, http: ProviderHttp): Promise<void> {
  if (!(await stillAdministers(http, conn.settings ?? {}))) throw new ConnectorError("REAUTH_REQUIRED", "the connecting person no longer administers the installation's account");
}

// ---- The adapter -------------------------------------------------------------------------------------------------------------------

export const adapter: ProviderAdapter = {
  id: "github",
  category: "work",
  kinds: ["workspace", "personal"],
  hosts: ["api.github.com", "github.com"],
  linkHosts: ["github.com"],
  env: ENV,
  configured: (e) => envAll(ENV, e ?? process.env),
  oauth: {
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    clientId: () => env("GITHUB_APP_CLIENT_ID"),
    clientSecret: () => env("GITHUB_APP_CLIENT_SECRET"),
    clientAuth: "body",
    tokenBody: "form",
    pkce: "S256",
    scopeSeparator: " ",
    // A GitHub App's permissions are set on the App, not asked for in the flow.
    scopes: () => [],
    authorizeParams: () => ({ allow_signup: "false" }),
    parseToken,
    refresh: "rotating",
  },
  begin({ kind, state }) {
    if (kind !== "workspace") return null;
    const slug = env("GITHUB_APP_SLUG");
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(slug)) throw new ConnectorError("NOT_CONFIGURED", "GITHUB_APP_SLUG is not a slug");
    return { url: `https://github.com/apps/${slug}/installations/new?state=${encodeURIComponent(state)}` };
  },
  async identify({ kind, http, tokens, pending }) {
    const me = rec((await gh(http, { url: `${GITHUB_API}/user` })).body);
    const userId = idOf(me.id);
    const login = str(me.login);
    if (!userId || !login) throw new ConnectorError("BAD_RESPONSE", "github user missing");
    if (kind === "personal") {
      return { externalAccountId: userId, externalTenantId: null, accountLabel: login, identity: { externalUserId: userId, email: null }, settings: { login }, scopes: [] };
    }
    const who = { id: userId, login };
    let inst = await verifyInstallation(http, pending.installationId);
    if (!inst && pending.installationId !== undefined) throw new ConnectorError("NOT_ALLOWED", "install_unverified: the person's token does not list that installation");
    if (!inst) {
      const all = await userInstallations(http);
      if (all.length === 1) inst = all[0];
      else if (pending.setupAction === "request" || !all.length) {
        // An organisation owner must approve the request first: the card says so ("Waiting for a GitHub organisation
        // owner to approve Boredroom.") and nothing is read until it is connected again after approval.
        return { externalAccountId: `waiting:${userId}`, externalTenantId: null, accountLabel: "GitHub (waiting for approval)", settings: { login, public: { waiting: true } }, scopes: [] };
      } else throw new ConnectorError("NOT_ALLOWED", "install_unverified: several installations and none claimed");
    }
    // Security fix, 22 October 2026: only an admin of the installation's account connects it for a workspace.
    if (!(await userAdministers(http, inst, who))) throw new ConnectorError("NOT_ALLOWED", "install_not_admin: the person doesn't administer the installation's account");
    // CONTRACT REQUEST (work group, 22 October 2026): identify can't return a replacement token set, so the verified
    // installation's token replaces the user token in place (completeConnect stores this same object). The user token
    // stays sealed in `extra`. A `tokens` field on AccountInfo would make this explicit.
    const minted = await mintInstallationToken(inst.id, new Date(), { fresh: true });
    tokens.extra = { ...(tokens.extra ?? {}), userToken: tokens.accessToken, ...(tokens.refreshToken ? { userRefreshToken: tokens.refreshToken } : {}) };
    tokens.accessToken = minted.token;
    tokens.refreshToken = null;
    tokens.expiresAt = minted.expiresAt;
    tokens.refreshExpiresAt = null;
    return {
      externalAccountId: `installation:${inst.id}`, externalTenantId: inst.id, accountLabel: `${inst.login} (GitHub)`,
      settings: { login, userId, accountType: inst.type, accountLogin: inst.login, accountId: inst.accountId }, scopes: [],
    };
  },
  ownerBound: false,
  workspaceActs: true,
  async sources({ conn, http }) {
    const out: SourceInfo[] = [];
    const add = (raw: unknown) => {
      const r = rec(raw);
      const full = str(r.full_name);
      if (full && REPO.test(full)) out.push({ kind: "repo", externalId: full.toLowerCase(), label: full, isPrivate: r.private === true, archived: r.archived === true });
    };
    if (conn.kind === "workspace") {
      if (!conn.externalTenantId) return [];
      await requireAdmin(conn, http);
      for (let page = 1; page <= 5; page++) {
        const r = rec((await gh(http, { url: `${GITHUB_API}/installation/repositories`, query: { per_page: 100, page } })).body);
        const list = arr(r.repositories);
        list.forEach(add);
        if (list.length < 100) break;
      }
      return out;
    }
    for (const inst of (await userInstallations(http)).slice(0, 5)) {
      for (let page = 1; page <= 2; page++) {
        const r = rec((await gh(http, { url: `${GITHUB_API}/user/installations/${inst.id}/repositories`, query: { per_page: 100, page } })).body);
        const list = arr(r.repositories);
        list.forEach(add);
        if (list.length < 100) break;
      }
    }
    return out;
  },
  streams: [
    { name: "issues", kinds: ["issue"], every: { workingMinutes: 15, offMinutes: 120 }, perRun: { pages: 10, items: 1000, ms: 15_000 }, fullEveryMinutes: 6 * 60 },
  ],
  async sync({ conn, http, cursor, full, now, sink, selected, deadline }) {
    if (conn.kind === "workspace" && !conn.externalTenantId) return { cursor: null, more: false }; // waiting for approval
    let cur = readCursor(cursor, full, now);
    const startedOpenHere = cur.ph === "open" && !cur.pg && cur.i === 0;
    // Each full reconciliation checks again that whoever connected still administers the installation's account.
    if (conn.kind === "workspace" && startedOpenHere) await requireAdmin(conn, http);
    const openIds: string[] = [];
    const openMax = OPEN_MAX[conn.kind];
    for (let pages = 0; ; pages++) {
      if (pages >= 10 || Date.now() >= deadline) return { cursor: JSON.stringify(cur), more: true };
      const units = unitsFor(conn, selected, cur, now);
      if (!units.length) return { cursor: null, more: false }; // a workspace with no repository selected
      if (cur.i >= units.length) cur.i = units.length - 1;
      const unit = units[cur.i];
      const r = await gh<unknown>(http, requestFor(unit, cur));
      const list = unit.kind === "review" ? arr(rec(r.body).items) : arr(r.body);
      const items = list.map((x) => issueItem(conn, x, { ...(unit.kind === "repo" ? { repo: unit.repo } : {}), reviewRequested: unit.kind === "review" }))
        .filter((x): x is NormalisedItem => !!x)
        .map((i) => (unit.kind === "assigned" ? { ...i, mine: true } : i));
      await sink.upsert(items);
      for (const i of items) {
        if (unit.kind !== "review") cur.mx = newer(cur.mx, i.providerUpdatedAt ?? null);
        if (cur.ph === "open" && openIds.length < openMax && i.state !== "done" && i.state !== "cancelled") openIds.push(i.externalId);
      }
      if (unit.kind === "review") cur.rs = now.toISOString();
      // Near the hour's limit: stop here and carry on from this place at the next scheduled run.
      const stop = lowRateLeft(r.headers);
      if (hasNext(r.headers) && list.length > 0 && (cur.pg ?? 1) < 100 && !(cur.ph === "open" && openIds.length >= openMax)) {
        cur.pg = (cur.pg ?? 1) + 1;
        if (stop) return { cursor: JSON.stringify(cur), more: false };
        continue;
      }
      cur.pg = null;
      if (cur.i + 1 < units.length) {
        cur.i++;
        if (stop) return { cursor: JSON.stringify(cur), more: false };
        continue;
      }
      cur.i = 0;
      if (cur.ph === "open") {
        if (startedOpenHere) await sink.reconcileOpen("issue", openIds);
        cur = { ph: "inc", i: 0, w: new Date(now.getTime() - RECENT_AFTER_FULL_MS).toISOString(), pg: null, mx: cur.mx, rs: cur.rs };
        if (stop) return { cursor: JSON.stringify(cur), more: false };
        continue;
      }
      const mx = cur.mx ? new Date(Date.parse(cur.mx) - OVERLAP_MS).toISOString() : null;
      return { cursor: JSON.stringify({ ph: "inc", i: 0, w: newer(cur.w, mx), pg: null, mx: null, rs: cur.rs }), more: false };
    }
  },
  async fetchItem({ conn, http, kind, externalId }) {
    if (kind !== "issue") return null;
    return fetchIssue(conn, http, externalId);
  },
  async fetchText({ http, kind, externalId, maxChars }) {
    const p = kind === "issue" ? parseItemId(externalId) : null;
    if (!p) return null;
    const r = rec((await gh(http, { url: `${GITHUB_API}/repos/${repoPath(p.repo)}/issues/${p.number}` })).body);
    const body = str(r.body);
    return body ? body.slice(0, Math.min(maxChars, BODY_MAX)) : null;
  },
  actions: [createIssue, comment, setState, assign],
  interpret(res) {
    if (res.status !== 403 && res.status !== 429) return null;
    const retry = res.headers.get("retry-after");
    const left = res.headers.get("x-ratelimit-remaining");
    if (!retry && left !== "0") return null;
    let seconds = retry && /^\d+$/.test(retry) ? Number(retry) : 60;
    const reset = Number(res.headers.get("x-ratelimit-reset"));
    if (!retry && Number.isFinite(reset) && reset > 0) seconds = Math.max(1, Math.ceil(reset - Date.now() / 1000));
    return new ConnectorError("RATE_LIMITED", "github rate limited", seconds);
  },
  webhook: {
    async verify({ raw, headers }) {
      if (!verifyGithubSignature(raw, headers.get("x-hub-signature-256"), env("GITHUB_APP_WEBHOOK_SECRET"))) return { ok: false };
      // The signed body, not the unsigned X-GitHub-Delivery header (security fix, 22 October 2026).
      return { ok: true, deliveryId: `body:${createHash("sha256").update(raw).digest("hex")}` };
    },
    route({ body, headers }) {
      return routeGithub(headers.get("x-github-event"), body);
    },
  },
  async revoke({ conn, http, tokens }) {
    // Installations are left for the organisation to remove (another workspace may use them; the card says where). A
    // workspace connection's verifying user token (sealed in `extra`) is revoked, though (security fix, 22 October 2026:
    // revoke on disconnect).
    // Decision 22 October 2026: revoke this one token (`/token`) rather than the whole grant (`/grant`, spec §8.7): the
    // grant is shared by every Boredroom workspace the same person connected GitHub in.
    const token = conn.kind === "personal" ? tokens.accessToken : tokens.extra?.userToken;
    if (!token) return;
    const basic = Buffer.from(`${env("GITHUB_APP_CLIENT_ID")}:${env("GITHUB_APP_CLIENT_SECRET")}`).toString("base64");
    await http.request({
      method: "DELETE", url: `${GITHUB_API}/applications/${encodeURIComponent(env("GITHUB_APP_CLIENT_ID"))}/token`, auth: "header",
      headers: { ...GITHUB_HEADERS, authorization: `Basic ${basic}` }, json: { access_token: token }, expect: "none",
    });
  },
};

registerTokenMinter("github", mintGithubTokens);
