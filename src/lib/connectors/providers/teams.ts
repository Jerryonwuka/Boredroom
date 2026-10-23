/**
 * Microsoft Teams' entry (calendars + chat group; owner decisions, 22 October 2026: connectors; spec §8.2, §10, §11,
 * §14.2). Workspace only, made by an owner or HR: Boredroom posts in the channels the workspace chooses, from the
 * connecting person's own Microsoft account (no Teams bot in v1), signed "Posted by Boredroom". Client-safe.
 */
import type { ProviderEntry } from "../types";

export const entry: ProviderEntry = {
  id: "teams",
  slug: "teams",
  label: "Microsoft Teams",
  category: "chat",
  kinds: ["workspace"],
  workspace: {
    what: "Post {workspace}'s end-of-day digests, standups and reminders in the Teams channels you choose, and let people ask {name} to post there.",
    sees: [
      "The names of the teams and channels the person who connects Teams belongs to",
      "Never messages, chats or files",
    ],
    does: [
      "Posts digests, standups and reminders in the channels you turn on",
      "Posts someone's own words in a chosen channel, only after they confirm the exact words",
    ],
    note: "Posts appear from the Microsoft account of the person who connected Teams, signed “Posted by Boredroom”. If they leave, Teams needs reconnecting.",
  },
  setup: {
    console: "Microsoft Entra admin center",
    steps: [
      "Use the same multitenant app registration as Outlook Calendar (App registrations › New registration, if you haven't made it yet).",
      "Authentication › Web: add the redirect URL below.",
      "Certificates & secrets: the client secret's Value into MICROSOFT_CLIENT_SECRET, the Application (client) ID into MICROSOFT_CLIENT_ID.",
      "API permissions › Microsoft Graph › Delegated: openid, profile, email, offline_access, User.Read, Team.ReadBasic.All, Channel.ReadBasic.All and ChannelMessage.Send.",
      "Publisher verification (Microsoft AI Cloud Partner Program). Without it, an admin of each organisation approves Boredroom once (Boredroom shows them the link).",
    ],
    env: ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"],
    redirectPath: "/api/connectors/teams/callback",
  },
  removeAt: "myapplications.microsoft.com, or your Microsoft 365 admin in Enterprise applications",
};
