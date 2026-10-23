/**
 * Google Calendar's entry (calendars + chat group; owner decisions, 22 October 2026: connectors; spec §8.1, §11, §14.1).
 * Personal only: each person's own primary calendar, private to them. Client-safe: variable names, never values.
 */
import type { ProviderEntry } from "../types";

export const entry: ProviderEntry = {
  id: "google_calendar",
  slug: "google-calendar",
  label: "Google Calendar",
  category: "calendar",
  kinds: ["personal"],
  personal: {
    what: "Your own Google Calendar, so {name} can see your meetings, plan your day around them and stay quiet while you're in one.",
    sees: [
      "Your events from yesterday to two weeks ahead: titles, times, whether you're going and whether they're online",
      "How many guests an event has, but never who they are, its description or its location",
    ],
    does: [
      "Private blocks of your time, and moving your own events that have no guests, when you ask (you can undo them)",
      "Invitations, answers to invitations and moving meetings with guests, only after you confirm",
      "Cancelling a meeting you organise, only after you confirm",
    ],
    actLabel: "{name} can make changes when you ask",
    note: "Only your primary calendar. Only you can see it here: your workspace's owners and HR can't.",
  },
  setup: {
    console: "Google Cloud Console",
    steps: [
      "Create a Google Cloud project for Boredroom's connected apps (separate from Sign in with Google).",
      "APIs & Services › Library: enable the Google Calendar API.",
      "Google Auth Platform › Branding: app name Boredroom, support email, home page, privacy policy and terms on Boredroom's verified domain.",
      "Audience: External. Start in Testing with your test users and set GOOGLE_CALENDAR_APP_STATUS=testing (their connections need reconnecting every 7 days).",
      "Data Access: add openid, userinfo.email, calendar.events.owned.readonly and calendar.events.owned.",
      "Clients › Create client › Web application, with the redirect URL below as an authorised redirect URI.",
      "Copy the client ID and secret into the environment variables below.",
      "Before going beyond test users: submit the calendar scopes for verification, then publish the app and set GOOGLE_CALENDAR_APP_STATUS=production.",
    ],
    env: ["GOOGLE_CALENDAR_CLIENT_ID", "GOOGLE_CALENDAR_CLIENT_SECRET", "GOOGLE_CALENDAR_APP_STATUS"],
    redirectPath: "/api/connectors/google-calendar/callback",
  },
};
