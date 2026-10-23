/**
 * Slack (calendars + chat group; owner decisions, 22 October 2026: connectors; spec §8.3, §7, §10). A workspace
 * connection made by an owner or HR: Boredroom's Slack app with a bot token and three bot scopes (`chat:write`,
 * `channels:read`, `groups:read`; no user scopes, no `chat:write.public`), so it posts only in channels someone invited it
 * to (`/invite @Boredroom`) and that the workspace then selected. It never reads messages (D12: Slack's limits for apps
 * outside its Marketplace) and never sends direct messages. Token rotation is on (12-hour tokens, rotating refresh
 * tokens). Enterprise Grid organisation-wide installs are refused. Events: `app_uninstalled` and `tokens_revoked`
 * disconnect it here too. Server-only.
 */
import { createHmac } from "node:crypto";
import { z } from "zod";
import { APP_READBACK } from "@/lib/connectors/words";
import { members as membersWords } from "@/lib/confirm-readback";
import { env, envAll } from "../env";
import { safeEqual } from "../crypto";
import { renderSlack, slackEscape } from "../posting/post";
import { ConnectorError, type ActInput, type ActionSpec, type HttpResponse, type ProviderAdapter, type SourceInfo, type TokenSet, type WebhookRoute } from "../types";

const API = "https://slack.com/api";
const ENV = ["SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET", "SLACK_SIGNING_SECRET"] as const;
export const SLACK_SCOPES = ["chat:write", "channels:read", "groups:read"] as const;
/** Slack's replay window for signed requests (5 minutes). */
export const SLACK_REPLAY_SECONDS = 300;
const SOURCE_PAGES = 5;

// ---- Tokens ----------------------------------------------------------------------------------------------------------

const REAUTH_ERRORS = new Set(["invalid_refresh_token", "invalid_grant", "token_revoked", "token_expired", "invalid_auth"]);

export function parseSlackToken(body: unknown, now: Date): TokenSet {
  const b = (body ?? {}) as Record<string, unknown>;
  if (b.ok !== true) {
    const e = typeof b.error === "string" ? b.error : "unknown";
    throw new ConnectorError(REAUTH_ERRORS.has(e) ? "REAUTH_REQUIRED" : "BAD_RESPONSE", `slack token error ${e.slice(0, 40)}`);
  }
  // One Slack workspace at a time, never a whole Enterprise Grid organisation (§5.2 `enterprise_install`).
  if (b.is_enterprise_install === true) throw new ConnectorError("NOT_ALLOWED", "enterprise_install: an organisation-wide install");
  if (typeof b.access_token !== "string" || !b.access_token) throw new ConnectorError("BAD_RESPONSE", "slack token missing");
  const team = (b.team ?? {}) as Record<string, unknown>;
  const enterprise = (b.enterprise ?? null) as Record<string, unknown> | null;
  return {
    accessToken: b.access_token,
    refreshToken: typeof b.refresh_token === "string" && b.refresh_token ? b.refresh_token : null,
    tokenType: typeof b.token_type === "string" ? b.token_type : "bot",
    expiresAt: typeof b.expires_in === "number" ? new Date(now.getTime() + b.expires_in * 1000) : null,
    refreshExpiresAt: null,
    scopes: typeof b.scope === "string" ? b.scope.split(",").map((s) => s.trim()).filter(Boolean) : null,
    facts: {
      teamId: typeof team.id === "string" ? team.id : null,
      teamName: typeof team.name === "string" ? team.name : null,
      botUserId: typeof b.bot_user_id === "string" ? b.bot_user_id : null,
      appId: typeof b.app_id === "string" ? b.app_id : null,
      enterpriseId: enterprise && typeof enterprise.id === "string" ? enterprise.id : null,
    },
  };
}

// ---- Errors ----------------------------------------------------------------------------------------------------------

/** Slack answers 200 with `ok: false`; the error code becomes a fixed code (§8.3). */
export function interpretSlack(res: HttpResponse<unknown>): ConnectorError | null {
  const b = res.body as { ok?: boolean; error?: string } | null;
  if (!b || typeof b !== "object" || b.ok !== false) return null;
  const e = typeof b.error === "string" ? b.error : "unknown";
  switch (e) {
    case "ratelimited":
    case "rate_limited":
      return new ConnectorError("RATE_LIMITED", "slack rate limited", 60);
    case "invalid_auth":
    case "token_expired":
    case "not_authed":
      return new ConnectorError("REAUTH_REQUIRED", `slack ${e}`);
    case "token_revoked":
    case "account_inactive":
    case "team_access_not_granted":
    case "app_uninstalled":
      return new ConnectorError("REVOKED", `slack ${e}`);
    case "not_in_channel":
    case "channel_not_found":
    case "is_archived":
    case "restricted_action":
    case "restricted_action_read_only_channel":
    case "restricted_action_thread_only_channel":
    case "restricted_action_non_threadable_channel":
    case "cannot_reply_to_message":
    case "ekm_access_denied":
      return new ConnectorError("NOT_ALLOWED", `slack ${e}`);
    case "missing_scope":
    case "no_permission":
      return new ConnectorError("FORBIDDEN", `slack ${e}`);
    case "msg_too_long":
      return new ConnectorError("TOO_LARGE", "slack msg_too_long");
    case "fatal_error":
    case "internal_error":
    case "service_unavailable":
    case "request_timeout":
      return new ConnectorError("PROVIDER_DOWN", `slack ${e}`);
    default:
      return new ConnectorError("BAD_RESPONSE", `slack ${e.slice(0, 40)}`);
  }
}

// ---- Posting ---------------------------------------------------------------------------------------------------------

const NeutralPostInput = z.object({
  heading: z.string().min(1).max(500),
  lines: z.array(z.string().max(2000)).max(60),
  link: z.object({ label: z.string().min(1).max(200), href: z.string().url().max(1000) }).optional(),
});
export const PostInput = z.object({ text: z.string().trim().min(1).max(3000), post: NeutralPostInput.optional() });
type PostIn = z.infer<typeof PostInput>;

/** The signature on Brenda's posts, exactly as the card shows it (§9.5: signed “Jo via Max”). */
export const slackSignature = (first: string, assistant: string) => `From ${first} via ${assistant}`;
/** The words Brenda's card shows, which are exactly what people in the channel read. */
const signed = (c: ActInput<PostIn>) => `${c.input.text}\n\n${slackSignature(c.actor.firstName, c.actor.assistantName)}`;

/**
 * What goes to chat.postMessage (§10.3): `&`, `<` and `>` escaped in every text, so nothing becomes `<!channel>`,
 * `<!here>`, a user mention or a link; `@here` and `@channel` stay plain words (no `link_names`, `parse: none`). Route
 * posts (digests, standups, reminders) are rendered from the neutral post, with Boredroom's one link.
 */
export function slackText(c: ActInput<PostIn>): string {
  return c.input.post ? renderSlack(c.input.post) : slackEscape(signed(c));
}

const needChannel = (c: ActInput<unknown>) => {
  if (!c.source || c.source.kind !== "channel" || !/^[CGD][A-Z0-9]{2,30}$/.test(c.source.externalId)) throw new ConnectorError("NOT_FOUND", "no channel");
  return c.source;
};

const post: ActionSpec<PostIn> = {
  name: "post", tool: "post_to_channel", kinds: ["workspace"], input: PostInput,
  async prepare(c) {
    const source = needChannel(c);
    const as = APP_READBACK.as.workspaceApp(c.actor.firstName, c.actor.assistantName);
    return {
      risk: "shared",
      summary: APP_READBACK.post.summary(source.label, "Slack"),
      detail: signed(c),
      readback: { to: [APP_READBACK.post.to(source.label, "Slack", membersWords(source.members))], what: APP_READBACK.post.what(as) },
      appearsAs: as, place: source.label, people: source.members,
    };
  },
  async run(c) {
    const source = needChannel(c);
    await c.http.request<{ ok: boolean; ts?: string }>({
      method: "POST", url: `${API}/chat.postMessage`,
      json: { channel: source.externalId, text: slackText(c), unfurl_links: false, unfurl_media: false, link_names: false, parse: "none" },
    });
    return { summary: `Posted in ${source.label} on Slack` };
  },
};

// ---- Webhooks --------------------------------------------------------------------------------------------------------

/** `v0=` + hex HMAC-SHA256 of `v0:<timestamp>:<raw body>` with the signing secret (Slack's request signing). */
export function slackSignatureOf(secret: string, timestamp: string, raw: Uint8Array): string {
  return `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:`).update(raw).digest("hex")}`;
}

type SlackEnvelope = { type?: string; challenge?: string; team_id?: string; event_id?: string; event?: { type?: string; tokens?: { bot?: string[]; oauth?: string[] } } };

function bodyOf(raw: Uint8Array): SlackEnvelope | null {
  try {
    const v = JSON.parse(new TextDecoder().decode(raw)) as unknown;
    return v && typeof v === "object" ? (v as SlackEnvelope) : null;
  } catch {
    return null;
  }
}

// ---- The adapter -----------------------------------------------------------------------------------------------------

type Conversation = { id: string; name?: string; is_member?: boolean; is_private?: boolean; is_archived?: boolean; num_members?: number };

export const adapter: ProviderAdapter = {
  id: "slack",
  category: "chat",
  kinds: ["workspace"],
  hosts: ["slack.com"],
  linkHosts: [],
  env: ENV,
  configured: (e) => envAll(ENV, e ?? process.env),
  oauth: {
    authorizeUrl: "https://slack.com/oauth/v2/authorize",
    tokenUrl: `${API}/oauth.v2.access`,
    clientId: () => env("SLACK_CLIENT_ID"),
    clientSecret: () => env("SLACK_CLIENT_SECRET"),
    clientAuth: "body",
    tokenBody: "form",
    // Slack's OAuth v2 documents no PKCE for server apps (spec §2); the state, cookie and secret carry the flow.
    pkce: "none",
    scopeSeparator: ",",
    // Posting is the only use, so the bot scopes are the same with or without "can make changes".
    scopes: () => [...SLACK_SCOPES],
    parseToken: parseSlackToken,
    refresh: "rotating",
  },
  async identify({ tokens }) {
    const f = tokens.facts ?? {};
    const teamId = typeof f.teamId === "string" && /^[TE][A-Z0-9]{2,30}$/.test(f.teamId) ? f.teamId : null;
    if (!teamId) throw new ConnectorError("BAD_RESPONSE", "slack: no team");
    const name = typeof f.teamName === "string" && f.teamName.trim() ? f.teamName.replace(/\s+/g, " ").trim().slice(0, 120) : "Slack workspace";
    return { externalAccountId: teamId, externalTenantId: teamId, accountLabel: `${name} (Slack)`, settings: { botUserId: typeof f.botUserId === "string" ? f.botUserId : null } };
  },
  ownerBound: false,
  workspaceActs: true,
  async sources({ http }) {
    const out: SourceInfo[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < SOURCE_PAGES; page++) {
      const r = await http.request<{ ok: boolean; channels?: Conversation[]; response_metadata?: { next_cursor?: string } }>({
        url: `${API}/conversations.list`,
        query: { types: "public_channel,private_channel", exclude_archived: true, limit: 200, cursor },
      });
      for (const ch of r.body.channels ?? []) {
        // Only channels Boredroom was invited to: without chat:write.public it can post nowhere else.
        if (!ch?.id || !ch.is_member) continue;
        out.push({ kind: "channel", externalId: ch.id, label: `#${(ch.name ?? ch.id).slice(0, 80)}`, members: typeof ch.num_members === "number" ? ch.num_members : null, isPrivate: !!ch.is_private, archived: !!ch.is_archived });
      }
      cursor = r.body.response_metadata?.next_cursor || undefined;
      if (!cursor) break;
    }
    return out;
  },
  streams: [],
  actions: [post],
  interpret: interpretSlack,
  webhook: {
    async verify({ raw, headers }) {
      const secret = env("SLACK_SIGNING_SECRET");
      const ts = headers.get("x-slack-request-timestamp") ?? "";
      const sig = headers.get("x-slack-signature") ?? "";
      if (!secret || !/^\d{9,11}$/.test(ts) || !sig.startsWith("v0=")) return { ok: false };
      if (Math.abs(Math.floor(Date.now() / 1000) - Number(ts)) > SLACK_REPLAY_SECONDS) return { ok: false };
      const want = slackSignatureOf(secret, ts, raw);
      if (!safeEqual(sig, want)) return { ok: false };
      const body = bodyOf(raw);
      if (body?.type === "url_verification" && typeof body.challenge === "string" && body.challenge.length <= 200) {
        return { ok: true, deliveryId: `slack-verify-${ts}`, reply: Response.json({ challenge: body.challenge }) };
      }
      const id = typeof body?.event_id === "string" && /^[A-Za-z0-9]{4,64}$/.test(body.event_id) ? body.event_id : `slack-${ts}-${want.slice(3, 27)}`;
      return { ok: true, deliveryId: id };
    },
    route({ body }): WebhookRoute[] {
      const b = (body ?? {}) as SlackEnvelope;
      if (b.type !== "event_callback" || typeof b.team_id !== "string" || !b.team_id) return [];
      const t = b.event?.type;
      // The workspace removed Boredroom, or revoked its bot token: disconnected here too (user tokens: Boredroom has none).
      if (t === "app_uninstalled") return [{ by: "tenant", tenantId: b.team_id, revoked: true }];
      if (t === "tokens_revoked" && Array.isArray(b.event?.tokens?.bot) && b.event.tokens.bot.length) return [{ by: "tenant", tenantId: b.team_id, revoked: true }];
      return [];
    },
  },
  async revoke({ http, tokens }) {
    // auth.revoke revokes the token it is called with: the stored one, sent as it is.
    await http.request({ method: "POST", url: `${API}/auth.revoke`, auth: "header", headers: { authorization: `Bearer ${tokens.accessToken}` }, form: {} });
  },
  // chat.postMessage allows about one message a second per channel (§2): Boredroom spaces its Slack calls.
  limits: { spacingMs: 1000 },
};
