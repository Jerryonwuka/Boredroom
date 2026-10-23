/**
 * Microsoft Teams (calendars + chat group; owner decisions, 22 October 2026: connectors; spec §8.2, §10). A workspace
 * connection made by an owner or HR in their organisation's Microsoft 365 tenant (work and school accounts only). It
 * lists the channels of the teams that person belongs to, and posts in the channels the workspace selected: Brenda's
 * posts after a Confirm, and the end-of-day digests, standups and reminders an owner turned on. No reading of messages,
 * no chats, no Teams bot in v1 (D12): posts appear from the connecting person's own Microsoft account, signed
 * "Posted by Boredroom for Jo", and every card says so (D10, open question 2). The token is that person's, so the
 * connection needs reconnecting when they leave (`ownerBound`). Server-only.
 */
import { z } from "zod";
import { APP_READBACK } from "@/lib/connectors/words";
import { members as membersWords } from "@/lib/confirm-readback";
import { htmlEscape, renderTeams } from "../posting/post";
import { GRAPH, GRAPH_HOST, LOGIN_HOST, MSA_TENANT, MS_ENV, graphMe, graphPages, interpretGraph, msConfigured, msOAuth, tenantOf } from "./microsoft";
import { ConnectorError, type ActInput, type ActionSpec, type ConnectionRef, type ProviderAdapter, type SourceInfo } from "../types";

/** Acting (posting) is the only use, so it is asked for at connect, with or without "can make changes". */
export const TEAMS_SCOPES = ["openid", "profile", "email", "offline_access", "User.Read", "Team.ReadBasic.All", "Channel.ReadBasic.All", "ChannelMessage.Send"] as const;
export const TEAMS_MAX_TEAMS = 50;

/** A channel's source id: "<team id>|<channel id>" (channel ids carry ':' and '@', never '|'). */
export const channelSourceId = (teamId: string, channelId: string) => `${teamId}|${channelId}`;
export function splitChannelSourceId(id: string): { teamId: string; channelId: string } | null {
  const at = id.indexOf("|");
  if (at <= 0 || at === id.length - 1) return null;
  return { teamId: id.slice(0, at), channelId: id.slice(at + 1) };
}

/** Whose Microsoft account posts appear from (the connecting person's display name, kept at connect). */
export function postsAs(conn: ConnectionRef): string {
  const n = conn.settings?.postsAs;
  return typeof n === "string" && n.trim() ? n.trim() : "the account that connected Teams";
}

/** The signature appended to Brenda's posts, exactly as the card shows it (§9.5). */
export const teamsSignature = (first: string) => `Posted by Boredroom for ${first}`;
/** Route posts (digests, standups, reminders) are the workspace's own: signed without a person. */
export const TEAMS_ROUTE_SIGNATURE = "Posted by Boredroom";

const NeutralPostInput = z.object({
  heading: z.string().min(1).max(500),
  lines: z.array(z.string().max(2000)).max(60),
  link: z.object({ label: z.string().min(1).max(200), href: z.string().url().max(1000) }).optional(),
});
export const PostInput = z.object({ text: z.string().trim().min(1).max(3000), post: NeutralPostInput.optional() });
type PostIn = z.infer<typeof PostInput>;

/** The plain words Brenda's card shows and the post carries: the person's text and the signature. */
const signed = (c: ActInput<PostIn>) => `${c.input.text}\n\n${teamsSignature(c.actor.firstName)}`;

/** The message body (§10.3): every text HTML-escaped; line breaks kept. */
export function teamsContent(c: ActInput<PostIn>): string {
  if (c.input.post) return `${renderTeams(c.input.post)}<p><em>${htmlEscape(TEAMS_ROUTE_SIGNATURE)}</em></p>`;
  return signed(c).split(/\n{2,}/).map((p) => `<p>${htmlEscape(p).replace(/\n/g, "<br>")}</p>`).join("");
}

const needChannel = (c: ActInput<unknown>) => {
  const ids = c.source && c.source.kind === "channel" ? splitChannelSourceId(c.source.externalId) : null;
  if (!c.source || !ids) throw new ConnectorError("NOT_FOUND", "no channel");
  return { source: c.source, ...ids };
};

const post: ActionSpec<PostIn> = {
  name: "post", tool: "post_to_channel", kinds: ["workspace"], input: PostInput,
  async prepare(c) {
    const { source } = needChannel(c);
    const as = APP_READBACK.as.teams(postsAs(c.conn), c.actor.firstName);
    return {
      risk: "shared",
      summary: APP_READBACK.post.summary(source.label, "Microsoft Teams"),
      detail: signed(c),
      readback: { to: [APP_READBACK.post.to(source.label, "Microsoft Teams", membersWords(source.members))], what: APP_READBACK.post.what(as) },
      appearsAs: as, place: source.label, people: source.members,
    };
  },
  async run(c) {
    const { source, teamId, channelId } = needChannel(c);
    const r = await c.http.request<{ id?: string; webUrl?: string }>({
      method: "POST", url: `${GRAPH}/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages`,
      json: { body: { contentType: "html", content: teamsContent(c) } },
    });
    const href = typeof r.body?.webUrl === "string" && /^https:\/\/teams\.microsoft\.com\//.test(r.body.webUrl) ? r.body.webUrl : null;
    return { summary: `Posted in ${source.label} on Microsoft Teams`, href };
  },
};

type Team = { id: string; displayName?: string | null; isArchived?: boolean | null };
type Channel = { id: string; displayName?: string | null; membershipType?: string | null; isArchived?: boolean | null };

const clean = (s: string | null | undefined, fallback: string) => ((s ?? "").replace(/\s+/g, " ").trim() || fallback).slice(0, 90);

export const adapter: ProviderAdapter = {
  id: "teams",
  category: "chat",
  kinds: ["workspace"],
  hosts: [GRAPH_HOST, LOGIN_HOST],
  linkHosts: ["teams.microsoft.com"],
  env: MS_ENV,
  configured: msConfigured,
  oauth: msOAuth("organizations", () => [...TEAMS_SCOPES]),
  async identify({ http, tokens }) {
    const me = await graphMe(http);
    const tid = tenantOf(tokens.facts);
    if (!tid) throw new ConnectorError("BAD_RESPONSE", "teams: no tenant");
    if (tid === MSA_TENANT) throw new ConnectorError("NOT_ALLOWED", "failed: a personal Microsoft account has no Teams channels");
    let org: string | null = null;
    try {
      const o = await http.request<{ value?: { displayName?: string | null }[] }>({ url: `${GRAPH}/organization`, query: { $select: "displayName" } });
      org = (o.body?.value?.[0]?.displayName ?? "").trim() || null;
    } catch (err) {
      if (!(err instanceof ConnectorError) || (err.code !== "FORBIDDEN" && err.code !== "NOT_FOUND")) throw err;
    }
    const domain = (me.userPrincipalName ?? me.mail ?? "").split("@")[1] ?? "";
    const label = org ? `${clean(org, "Microsoft 365")} (Teams)` : `Microsoft Teams${domain ? ` (${domain.slice(0, 80)})` : ""}`;
    // The tenant is the connection (another owner may reconnect it after this person leaves); the person's name is kept
    // so every card can say whose account the posts appear from.
    const name = clean(me.displayName, (me.mail ?? me.userPrincipalName ?? "").split("@")[0] || "the connecting person");
    return { externalAccountId: tid, externalTenantId: tid, accountLabel: label, settings: { postsAs: name, public: { postsAs: name } } };
  },
  ownerBound: true,
  workspaceActs: true,
  async sources({ http }) {
    const teams = await graphPages<Team>(http, `${GRAPH}/me/joinedTeams`, { query: { $select: "id,displayName" }, maxPages: 3, maxItems: TEAMS_MAX_TEAMS });
    const out: SourceInfo[] = [];
    for (const t of teams.items.slice(0, TEAMS_MAX_TEAMS)) {
      if (!t?.id) continue;
      let channels: Channel[];
      try {
        channels = (await graphPages<Channel>(http, `${GRAPH}/teams/${encodeURIComponent(t.id)}/channels`, { query: { $select: "id,displayName,membershipType" }, maxPages: 2 })).items;
      } catch (err) {
        // One team Boredroom can't read doesn't hide the others.
        if (err instanceof ConnectorError && (err.code === "FORBIDDEN" || err.code === "NOT_FOUND")) continue;
        throw err;
      }
      for (const ch of channels) {
        if (!ch?.id) continue;
        out.push({
          kind: "channel", externalId: channelSourceId(t.id, ch.id), label: `${clean(t.displayName, "Team")} › ${clean(ch.displayName, "Channel")}`,
          members: null, isPrivate: !!ch.membershipType && ch.membershipType !== "standard", archived: !!(t.isArchived || ch.isArchived),
        });
      }
    }
    return out;
  },
  streams: [],
  actions: [post],
  interpret: interpretGraph,
  // No fixed spacing (owner decisions, 22 October 2026): listing channels makes one call per team, and Graph says when to
  // slow down (429 with Retry-After, honoured by the HTTP client).
  // No revoke: Microsoft has no per-app endpoint. Disconnecting deletes the tokens; the card says where to remove the app.
};
