/**
 * GitHub's card copy and setup steps (work group, owner decisions 22 October 2026: connectors; spec §5.3, §8.7, §11, §14.7).
 * Client-safe: variable names, never values. `{name}`: the person's assistant.
 */
import type { ProviderEntry } from "../types";

export const entry: ProviderEntry = {
  id: "github",
  slug: "github",
  label: "GitHub",
  category: "work",
  kinds: ["workspace", "personal"],
  workspace: {
    what: "Install Boredroom on your GitHub organisation and show the issues and pull requests of the repositories you choose. An owner of the GitHub organisation connects it.",
    sees: ["Issues and pull requests in the repositories you choose: titles, states, assignees and descriptions"],
    does: [
      "Create issues, comment, close or reopen issues and assign them, after the person confirms",
      "Changes appear as the Boredroom app, signed with the person's name. Pull requests are read only",
    ],
    note: "To remove Boredroom from GitHub as well: your organisation's Settings › GitHub Apps.",
  },
  personal: {
    what: "See the GitHub issues and pull requests assigned to you, or waiting for your review, in My Day.",
    sees: ["Issues and pull requests assigned to you, and pull requests waiting for your review, in repositories where Boredroom is installed"],
    does: ["Create issues, comment, close or reopen issues and assign them as you, after you confirm. Pull requests are read only"],
    actLabel: "{name} can make changes when you ask",
    note: "You'll see issues from repositories where your organisation installed Boredroom.",
  },
  setup: {
    console: "GitHub › Settings › Developer settings › GitHub Apps",
    steps: [
      "Create a GitHub App named “Boredroom” (an organisation's for production). Its URL name goes in GITHUB_APP_SLUG.",
      "Identifying and authorizing users: the callback URL below; turn on “Expire user authorization tokens”; leave “Request user authorization (OAuth) during installation” off.",
      "Post installation: the Setup URL below, with “Redirect on update” on.",
      "Webhook: active, the webhook URL below, and a random secret (openssl rand -hex 32) in GITHUB_APP_WEBHOOK_SECRET.",
      "Repository permissions: Issues read and write, Pull requests read only, Metadata read only. Organisation permissions: Members read only (Boredroom checks that whoever connects an organisation for a workspace is one of its owners). No account permissions. Subscribe to Issues and Pull request events.",
      "Where can it be installed: Any account. Then note the App ID (GITHUB_APP_ID) and Client ID (GITHUB_APP_CLIENT_ID), generate a client secret (GITHUB_APP_CLIENT_SECRET) and a private key (GITHUB_APP_PRIVATE_KEY: the .pem with \\n for line breaks, or base64 of the file).",
    ],
    env: ["GITHUB_APP_ID", "GITHUB_APP_SLUG", "GITHUB_APP_CLIENT_ID", "GITHUB_APP_CLIENT_SECRET", "GITHUB_APP_PRIVATE_KEY", "GITHUB_APP_WEBHOOK_SECRET"],
    redirectPath: "/api/connectors/github/callback",
    webhookPath: "/api/connectors/webhooks/github",
    extraUrls: [{ label: "Setup URL", path: "/api/connectors/github/setup" }],
  },
};
