/**
 * Notion's card copy and setup steps (knowledge group; owner decisions, 22 October 2026: connectors; spec §8.4, §11,
 * §14.4). Client-safe: variable names, never values. British English, sentence case. `{name}`: the person's assistant.
 */
import type { ProviderEntry } from "../types";

export const entry: ProviderEntry = {
  id: "notion",
  slug: "notion",
  label: "Notion",
  category: "knowledge",
  kinds: ["workspace", "personal"],
  workspace: {
    what: "Share your team's Notion pages, like policies and specs, so {name} can answer from them.",
    sees: ["The pages you share with Boredroom in Notion's picker, and the pages inside them", "Each page's title and text"],
    does: ["Add a page under a shared page, when someone confirms", "Add text to the end of a shared page, when someone confirms", "Comment on a shared page, when someone confirms"],
    note: "Everyone in the workspace (or the team you choose) can see the pages you pick here and ask {name} about them. What {name} adds appears from the Boredroom integration, signed with the person's name.",
  },
  personal: {
    what: "Connect your own Notion so {name} can answer from your pages.",
    sees: ["The pages you share with Boredroom in Notion's picker, and the pages inside them", "Each page's title and text"],
    does: ["Add a page, add text to the end of a page or comment, after you confirm"],
    actLabel: "{name} can make changes when you ask",
    note: "Only you see these pages in Boredroom. Changes appear in Notion from the Boredroom integration.",
  },
  setup: {
    // Fix, 22 October 2026: Notion's Developer portal and "connection" wording (developers.notion.com/docs/authorization).
    console: "Notion's Developer portal (app.notion.com/developers/connections)",
    steps: [
      "Create a new public connection named Boredroom, with installation scope “Any workspace” (it can't be changed after creation), and your company name, website, privacy policy, terms, support email and logo.",
      "Capabilities: Read content, Insert content and Insert comments; user information without email addresses. Leave Update content and Read comments off.",
      "OAuth configuration: add the redirect URL below.",
      "Configuration tab: copy the OAuth client ID and client secret into NOTION_CLIENT_ID and NOTION_CLIENT_SECRET.",
      "No webhooks are needed: Boredroom checks Notion every hour.",
    ],
    env: ["NOTION_CLIENT_ID", "NOTION_CLIENT_SECRET"],
    redirectPath: "/api/connectors/notion/callback",
  },
};
