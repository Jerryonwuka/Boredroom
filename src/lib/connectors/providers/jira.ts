/**
 * Jira's card copy and setup steps (work group, owner decisions 22 October 2026: connectors; spec §8.6, §11, §14.6).
 * Client-safe: variable names, never values. `{name}`: the person's assistant.
 */
import type { ProviderEntry } from "../types";

export const entry: ProviderEntry = {
  id: "jira",
  slug: "jira",
  label: "Jira",
  category: "work",
  kinds: ["workspace", "personal"],
  workspace: {
    what: "Show the issues of the Jira projects you choose in Boredroom, for everyone you pick.",
    sees: ["Issues in the projects you choose: keys, titles, statuses, priorities, due dates and assignees"],
    does: ["Nothing from this connection: changes in Jira are made from each person's own Jira account"],
    note: "Changes are made from each person's own account. Boredroom reads with the account that connects Jira here, so it stops if that person leaves.",
  },
  personal: {
    what: "See the Jira issues assigned to you in My Day, and let {name} answer from them.",
    sees: ["Issues assigned to you on your Jira site: keys, titles, statuses, priorities, due dates and descriptions"],
    does: ["Create issues, comment, move issues along, assign them and set due dates as you, after you confirm"],
    actLabel: "{name} can make changes when you ask",
  },
  setup: {
    console: "Atlassian developer console (developer.atlassian.com › My apps)",
    steps: [
      "Create an OAuth 2.0 integration named “Boredroom”.",
      "Permissions › Jira API › Add, with the classic scopes read:jira-work, read:jira-user, write:jira-work and manage:jira-webhook.",
      "Authorization › OAuth 2.0 (3LO): add the callback URL below.",
      "Settings: copy the client ID and secret into ATLASSIAN_CLIENT_ID and ATLASSIAN_CLIENT_SECRET.",
      "Distribution › Sharing: enable it, fill in the vendor and privacy policy, and answer “Yes” to storing personal data (Boredroom reports the account ids it keeps every week).",
      "Atlassian's OAuth apps share 65,000 points an hour across all customers; Boredroom uses at most 50,000. Apply for Tier 2 once more than a couple of hundred people connect Jira.",
    ],
    env: ["ATLASSIAN_CLIENT_ID", "ATLASSIAN_CLIENT_SECRET"],
    redirectPath: "/api/connectors/jira/callback",
    webhookPath: "/api/connectors/webhooks/jira",
  },
  removeAt: "your Atlassian account settings (id.atlassian.com) › Connected apps",
};
