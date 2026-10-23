/**
 * Linear's card copy and setup steps (work group, owner decisions 22 October 2026: connectors; spec §8.5, §11, §14.5).
 * Client-safe: variable names, never values. `{name}`: the person's assistant.
 */
import type { ProviderEntry } from "../types";

export const entry: ProviderEntry = {
  id: "linear",
  slug: "linear",
  label: "Linear",
  category: "work",
  kinds: ["workspace", "personal"],
  workspace: {
    what: "Show the issues of the Linear teams you choose in Boredroom, for everyone you pick.",
    sees: ["Issues in the teams you choose: titles, states, priorities, due dates, assignees and descriptions"],
    does: [
      "Create issues, comment, and change an issue's state, assignee or due date, after the person confirms",
      "Changes appear as the Boredroom app, signed with the person's name",
    ],
    note: "If Linear says only an admin can add the app, ask an admin of your Linear workspace to connect it.",
  },
  personal: {
    what: "See the Linear issues assigned to you in My Day, and let {name} answer from them.",
    sees: ["Issues assigned to you: titles, states, priorities, due dates and descriptions"],
    does: ["Create issues, comment, and change state, assignee or due date as you, after you confirm"],
    actLabel: "{name} can make changes when you ask",
  },
  setup: {
    console: "Linear › Settings › API › OAuth applications",
    steps: [
      "In a dedicated Linear workspace (every admin there can see the app's secrets), open Settings › API › OAuth applications and create “Boredroom”.",
      "Add the callback URL below and make the application public, so other workspaces can install it.",
      "Add a webhook on the application: the webhook URL below, resource type Issues. Copy its signing secret into LINEAR_WEBHOOK_SECRET.",
      "Copy the client ID and secret into LINEAR_CLIENT_ID and LINEAR_CLIENT_SECRET. If Linear asks to enable the app actor for workspace installs, enable it.",
    ],
    env: ["LINEAR_CLIENT_ID", "LINEAR_CLIENT_SECRET", "LINEAR_WEBHOOK_SECRET"],
    redirectPath: "/api/connectors/linear/callback",
    webhookPath: "/api/connectors/webhooks/linear",
  },
};
