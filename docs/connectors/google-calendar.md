# Google Calendar

Calendars + chat group, owner decisions 22 October 2026 ("add connectors so teams can integrate their other apps").
Adapter: `src/server/connectors/adapters/google-calendar.ts` (also the calendar actions both calendars share); card:
`src/lib/connectors/providers/google-calendar.ts`; tests: `tests/unit/connectors/google-calendar.test.ts` (fixtures in
`tests/fixtures/connectors/google-calendar/`).

## What it does

- **Personal only**: each person connects their own primary calendar in Settings › Your assistant › Your connections.
  It is private to them: owners, HR and team leads can't see it, or whether it exists. Slug `google-calendar`.
- Their events (yesterday to 14 days ahead) appear on My Day; Brenda plans around them and stays quiet in meetings.
- Kept per event: title, start, end, all-day, busy or free, their own answer, online or not, how many guests. Never the
  description, location, attendee names or addresses. Working-location entries and birthdays are skipped.
- Nothing from a calendar feeds reports, scores, presence, attendance or timesheets.

## What Brenda can do (when "can make changes" is on)

| Action | Risk | How |
|---|---|---|
| Block time | private: happens when asked, Undo for 10 minutes | `POST …/events?sendUpdates=none`, `visibility: private`, `transparency: opaque` |
| Move an event without guests | private (Undo) | `PATCH …/events/{id}?sendUpdates=none` |
| Move an event with guests | shared: Confirm | `PATCH …/events/{id}?sendUpdates=all` |
| Invite people | shared: Confirm | `POST …/events?sendUpdates=all` with `attendees` |
| Answer an invitation | shared: Confirm | the person's own attendee entry's `responseStatus` (and note), `sendUpdates=all` |
| Cancel an event they organise | destructive: Confirm, "can't be undone" | `DELETE …/events/{id}?sendUpdates=all` (none without guests) |

Only events the person organises can be moved or cancelled. Google sends no note with a cancellation: the card says so.
Undo refuses when the block was edited or removed since (`updated` checked first).

## Scopes

| | Scopes |
|---|---|
| Read | `openid`, `email`, `https://www.googleapis.com/auth/calendar.events.owned.readonly` |
| Make changes (adds) | `https://www.googleapis.com/auth/calendar.events.owned` |

Authorise parameters: `access_type=offline`, `include_granted_scopes=true`, `prompt=consent`, `nonce`, PKCE S256 (Google
still wants the client secret from web clients). Google may grant some scopes and not others: "can make changes" turns
on only when the token answer's `scope` includes the acting one. If the console's Data Access picker doesn't offer the
"owned" pair, use `calendar.events.readonly` and `calendar.events` and change `GOOGLE_SCOPES` in the adapter.

## Environment variables

| Variable | |
|---|---|
| `GOOGLE_CALENDAR_CLIENT_ID` | The OAuth client's ID |
| `GOOGLE_CALENDAR_CLIENT_SECRET` | Its secret |
| `GOOGLE_CALENDAR_APP_STATUS` | `testing` while the Google app is in Testing (cards say people reconnect weekly), else `production` |

## Setting it up (owner)

1. Google Cloud Console › new project "Boredroom Connectors" (separate from Sign in with Google, so the calendar review
   never touches sign-in).
2. APIs & Services › Library › enable **Google Calendar API**.
3. Google Auth Platform › **Branding**: app name "Boredroom", support email, home page, privacy policy and terms on the same
   domain, authorised domain (verified in Google Search Console).
4. **Audience**: External, publishing status **Testing** to begin with; add test users (at most 100; their connections
   need reconnecting every 7 days). Set `GOOGLE_CALENDAR_APP_STATUS=testing`.
5. **Data Access**: `openid`, `.../auth/userinfo.email`, `.../auth/calendar.events.owned.readonly`,
   `.../auth/calendar.events.owned`.
6. **Clients** › Create client › Web application › Authorised redirect URIs:
   `<APP_ORIGIN>/api/connectors/google-calendar/callback` (and `http://localhost:3000/api/connectors/google-calendar/callback`
   for development).
7. Copy the client ID and secret into the variables above.
8. Before going beyond test users: submit for sensitive-scope verification with a justification per scope ("show each
   person's own meetings in their day; add private focus blocks and answer invitations only when they ask") and an
   unlisted demo video. Then publish "In production" and set `GOOGLE_CALENDAR_APP_STATUS=production`.

## How it works

- Tokens: `https://oauth2.googleapis.com/token` (form, secret in the body); ~1-hour access tokens; the refresh token is
  reusable (kept when a refresh doesn't send a new one). `invalid_grant` → "needs reconnecting". Refresh tokens stop
  after 7 days while the app is in Testing, after 6 months unused, and the 101st for one account and client kills the
  oldest.
- Identity: the id_token (checked by the framework: aud, iss, exp, nonce) gives `sub` (the account) and `email` (the
  label); without one, `GET https://www.googleapis.com/oauth2/v3/userinfo`.
- Sync, stream `events`: every 10 minutes in the person's working window (60 otherwise), at most 3 pages of 250 and 15
  seconds: `GET /calendar/v3/calendars/primary/events?timeMin&timeMax&singleEvents=true&orderBy=startTime&maxResults=250&fields=…`
  with a `fields` mask that leaves out descriptions, locations and attendee details. Cancelled events are gone; the
  window is reconciled (anything not seen is gone). Cut short, only the part before the last start seen is reconciled.
- Errors: 403 `rateLimitExceeded`, `userRateLimitExceeded`, `quotaExceeded` → RATE_LIMITED (60 s backoff),
  `dailyLimitExceeded` → an hour; 429 with Retry-After; `forbiddenForNonOrganizer` → NOT_ALLOWED.
- Disconnect: `POST https://oauth2.googleapis.com/revoke` with the refresh token.
- Push notifications (watch channels) are not in v1.
