/**
 * Slack's entry (calendars + chat group; owner decisions, 22 October 2026: connectors; spec §8.3, §10, §11, §14.3).
 * Workspace only, made by an owner or HR: Boredroom's Slack app posts in the channels it was invited to and the workspace
 * chose. It never reads messages and never sends direct messages. Client-safe: variable names, never values.
 */
import type { ProviderEntry } from "../types";

export const entry: ProviderEntry = {
  id: "slack",
  slug: "slack",
  label: "Slack",
  category: "chat",
  kinds: ["workspace"],
  workspace: {
    what: "Post {workspace}'s end-of-day digests, standups and reminders in the Slack channels you choose, and let people ask {name} to post there.",
    sees: [
      "The names and member counts of the channels Boredroom was invited to",
      "Never messages, direct messages or files",
    ],
    does: [
      "Posts digests, standups and reminders in the channels you turn on",
      "Posts someone's own words in a chosen channel as the Boredroom app, signed with their name, only after they confirm the exact words",
    ],
    note: "Boredroom posts only in channels it's in: in Slack, type /invite @Boredroom in the channel, then Check now.",
  },
  setup: {
    console: "Slack API (api.slack.com/apps)",
    steps: [
      "Create New App › From a manifest: paste docs/connectors/slack-manifest.yaml with your address in it (or from scratch, named Boredroom).",
      "OAuth & Permissions: the redirect URL below; bot token scopes chat:write, channels:read and groups:read; no user scopes.",
      "OAuth & Permissions › Advanced token security: check that token rotation is on (the manifest turns it on; it can't be turned off later).",
      "Event Subscriptions: on, with the webhook URL below as the Request URL (Boredroom must already be running there with SLACK_SIGNING_SECRET set); subscribe to the app events app_uninstalled and tokens_revoked.",
      "Basic Information › App Credentials: copy the Client ID, Client Secret and Signing Secret into the environment variables below.",
      "Manage Distribution: complete the checklist and activate public distribution, so other companies' workspaces can add Boredroom.",
    ],
    env: ["SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET", "SLACK_SIGNING_SECRET"],
    redirectPath: "/api/connectors/slack/callback",
    webhookPath: "/api/connectors/webhooks/slack",
  },
};
