/**
 * Asana's card copy and setup steps (work group, owner decisions 22 October 2026: connectors; spec §8.8, §11, §14.8).
 * Client-safe: variable names, never values. `{name}`: the person's assistant.
 */
import type { ProviderEntry } from "../types";

export const entry: ProviderEntry = {
  id: "asana",
  slug: "asana",
  label: "Asana",
  category: "work",
  kinds: ["workspace", "personal"],
  workspace: {
    what: "Show the tasks of the Asana projects you choose in Boredroom, for everyone you pick.",
    sees: ["Tasks in the projects you choose: names, whether they're done, due dates, assignees and notes"],
    does: ["Nothing from this connection: changes in Asana are made from each person's own Asana account"],
    note: "Changes are made from each person's own account. Boredroom reads with the account that connects Asana here, so it stops if that person leaves.",
  },
  personal: {
    what: "See the Asana tasks assigned to you in My Day, and let {name} answer from them.",
    sees: ["Tasks assigned to you: names, whether they're done, due dates and notes"],
    does: ["Create tasks, comment, complete them, assign them and set due dates as you, after you confirm"],
    actLabel: "{name} can make changes when you ask",
  },
  setup: {
    console: "Asana developer console (app.asana.com/0/my-apps)",
    steps: [
      "Create a new app named “Boredroom”.",
      "OAuth: add the redirect URL below, and choose specific scopes (not Full permissions): openid, email, profile, users:read, workspaces:read, projects:read, tasks:read, tasks:write, stories:write, webhooks:read, webhooks:write and webhooks:delete.",
      "Manage distribution: Any workspace, with the listing details (enterprise admins use them to allow the app).",
      "Copy the client ID and secret into ASANA_CLIENT_ID and ASANA_CLIENT_SECRET. Boredroom registers its own webhooks on the projects it reads.",
    ],
    env: ["ASANA_CLIENT_ID", "ASANA_CLIENT_SECRET"],
    redirectPath: "/api/connectors/asana/callback",
  },
};
