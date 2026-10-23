/**
 * Outlook Calendar's entry (calendars + chat group; owner decisions, 22 October 2026: connectors; spec §8.2, §11, §14.2).
 * Personal only: each person's own calendar (Microsoft 365 work or school, or a personal Microsoft account), private to
 * them. Microsoft has no per-app revoke, so the card says where to remove Boredroom. Client-safe.
 */
import type { ProviderEntry } from "../types";

export const entry: ProviderEntry = {
  id: "outlook_calendar",
  slug: "outlook",
  label: "Outlook Calendar",
  category: "calendar",
  kinds: ["personal"],
  personal: {
    what: "Your own Outlook calendar (Microsoft 365 or a personal Microsoft account), so {name} can see your meetings, plan your day around them and stay quiet while you're in one.",
    sees: [
      "Your events from yesterday to two weeks ahead: titles, times, whether you're going and whether they're online",
      "How many guests an event has, but never who they are, its description or its location",
    ],
    does: [
      "Private blocks of your time, and moving your own events that have no guests, when you ask (you can undo them)",
      "Invitations, answers to invitations and moving meetings with guests, only after you confirm",
      "Cancelling a meeting you organise, with your note to the guests, only after you confirm",
    ],
    actLabel: "{name} can make changes when you ask",
    note: "Only you can see it here: your workspace's owners and HR can't. If Microsoft says your admin needs to approve Boredroom, Boredroom gives you a link for them.",
  },
  setup: {
    console: "Microsoft Entra admin center",
    steps: [
      "App registrations › New registration: name Boredroom; accounts in any organisational directory and personal Microsoft accounts (multitenant). One registration serves Outlook Calendar and Microsoft Teams.",
      "Authentication › Web: add the redirect URL below (and Microsoft Teams' one, if you use Teams).",
      "Certificates & secrets › New client secret: copy its Value into MICROSOFT_CLIENT_SECRET, and the Application (client) ID into MICROSOFT_CLIENT_ID. Note when the secret expires.",
      "API permissions › Microsoft Graph › Delegated: openid, profile, email, offline_access, User.Read, Calendars.ReadBasic and Calendars.ReadWrite. No application permissions.",
      "Branding & properties: Boredroom's verified publisher domain, home page, terms and privacy links.",
      "Publisher verification (Microsoft AI Cloud Partner Program), so people in other organisations can consent without their admin.",
    ],
    env: ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"],
    redirectPath: "/api/connectors/outlook/callback",
  },
  removeAt: "myapplications.microsoft.com (work or school) or account.live.com/consent/Manage (personal)",
};
