/**
 * The pretend provider's entry (framework, 22 October 2026): offered only with CONNECTORS_FAKE=1 outside production, to
 * try the screens, sync and Brenda without a real account. Owned by the framework.
 */
import type { ProviderEntry } from "../types";

export const entry: ProviderEntry = {
  id: "fake",
  slug: "fake",
  label: "Test app",
  category: "work",
  kinds: ["workspace", "personal"],
  workspace: {
    what: "A pretend app for trying connected apps on this development server.",
    sees: ["Pretend issues from one project", "One pretend channel, #test"],
    does: ["Pretend posts in #test", "Pretend changes to issues, when someone confirms"],
    note: "Development only. Nothing leaves this server.",
  },
  personal: {
    what: "A pretend calendar and tracker for trying your day and Brenda on this development server.",
    sees: ["Two pretend meetings today", "Two pretend issues assigned to you"],
    does: ["Private blocks on the pretend calendar", "Pretend changes to issues, when you confirm"],
    actLabel: "{name} can make changes when you ask",
    note: "Development only. Nothing leaves this server.",
  },
  setup: { console: "This server", steps: ["Set CONNECTORS_FAKE=1 in the environment (ignored in production)."], env: ["CONNECTORS_FAKE"], redirectPath: "/api/connectors/fake/callback" },
};
