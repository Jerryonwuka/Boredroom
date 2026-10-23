# Microsoft: Outlook Calendar and Microsoft Teams

Calendars + chat group, owner decisions 22 October 2026 ("add connectors so teams can integrate their other apps").
Adapters: `src/server/connectors/adapters/outlook-calendar.ts`, `teams.ts` and the shared `microsoft.ts` (Microsoft
identity, Graph paging, times and errors); cards: `src/lib/connectors/providers/outlook-calendar.ts`, `teams.ts`; tests:
`tests/unit/connectors/outlook-calendar.test.ts`, `teams.test.ts` (fixtures in `tests/fixtures/connectors/microsoft/`).

## One app registration, two apps

| | Outlook Calendar | Microsoft Teams |
|---|---|---|
| Slug | `outlook` | `teams` |
| Who connects | each person, for themselves (private to them) | owners or HR, for the workspace |
| Accounts | work, school and personal Microsoft accounts (tenant `common`) | work and school only (tenant `organizations`) |
| Scopes | read: `openid profile email offline_access User.Read Calendars.ReadBasic`; make changes adds `Calendars.ReadWrite` | `openid profile email offline_access User.Read Team.ReadBasic.All Channel.ReadBasic.All ChannelMessage.Send` (posting is the only use, so asked for at connect) |
| Redirect URL | `<APP_ORIGIN>/api/connectors/outlook/callback` | `<APP_ORIGIN>/api/connectors/teams/callback` |

All delegated permissions; no application permissions. None of them needs admin consent by default, but an
organisation may restrict user consent: people then see "Your Microsoft 365 admin needs to approve Boredroom first."
with the admin consent link (`https://login.microsoftonline.com/organizations/v2.0/adminconsent?…`, valid 7 days).

## Environment variables

| Variable | |
|---|---|
| `MICROSOFT_CLIENT_ID` | The app registration's Application (client) ID |
| `MICROSOFT_CLIENT_SECRET` | A client secret's **Value** (at most 24 months: set a reminder to rotate it) |

## Setting it up (owner)

1. Microsoft Entra admin center › App registrations › **New registration**: name "Boredroom"; supported account types
   "Accounts in any organizational directory (any Microsoft Entra ID tenant – multitenant) and personal Microsoft
   accounts". Register it with a work account in Boredroom's own tenant (needed for publisher verification).
2. **Authentication** › platform **Web** › redirect URIs: both URLs above (and their `http://localhost:3000` equivalents
   for development).
3. **Certificates & secrets** › New client secret › copy the **Value** into `MICROSOFT_CLIENT_SECRET`; the Application
   (client) ID into `MICROSOFT_CLIENT_ID`.
4. **API permissions** › Microsoft Graph › **Delegated**: `openid`, `profile`, `email`, `offline_access`, `User.Read`,
   `Calendars.ReadBasic`, `Calendars.ReadWrite`, `Team.ReadBasic.All`, `Channel.ReadBasic.All`, `ChannelMessage.Send`.
5. **Branding & properties**: publisher domain (DNS-verified), home page, terms and privacy URLs.
6. **Publisher verification**: join the Microsoft AI Cloud Partner Program (free), complete its verification, add the
   Partner One ID on the Branding page. Without it, people in many organisations can't consent and need their admin.

## Outlook Calendar

- Kept per event (yesterday to 14 days ahead): subject, start, end, all-day, busy or free (`showAs` free and
  working elsewhere are free), the person's answer, online or not, how many guests (rooms and the person themself left
  out). Never bodies, locations or attendee names.
- Sync, stream `events`: every 10 minutes in the working window (60 otherwise), at most 5 pages of 100 and 15 seconds:
  `GET /me/calendarView?startDateTime&endDateTime&$select=…&$orderby=start/dateTime&$top=100` with
  `Prefer: outlook.timezone="UTC"`; `@odata.nextLink` is followed only on `graph.microsoft.com`; cancelled events are
  gone; the window is reconciled. All-day events are placed on their date in the person's zone.
- Brenda's actions (same risk classes and readbacks as Google Calendar):

| Action | Risk | Request |
|---|---|---|
| Block time | private (Undo) | `POST /me/events`, `sensitivity: private`, `showAs: busy`, no attendees |
| Move (no guests / guests) | private (Undo) / shared | `PATCH /me/events/{id}` (Outlook tells attendees itself) |
| Invite | shared | `POST /me/events` with attendees (Outlook sends the invitations) |
| Answer | shared | `POST /me/events/{id}/accept`, `/tentativelyAccept` or `/decline` with `{ comment, sendResponse: true }` |
| Cancel (organiser) | destructive | `POST /me/events/{id}/cancel` with the note; `DELETE` when nobody else is invited |

  Undo checks the event's `changeKey` first and refuses when it changed.
- Identity: `GET /me?$select=id,displayName,mail,userPrincipalName` (account `id`, label mail or UPN) and the tenant
  `tid` from the checked id_token.
- No revoke endpoint: disconnecting deletes Boredroom's tokens; the card tells the person to remove Boredroom at
  myapplications.microsoft.com (work or school) or account.live.com/consent/Manage (personal).

## Microsoft Teams

- Lists the channels of the teams the connecting person belongs to (`GET /me/joinedTeams`, then
  `GET /teams/{id}/channels` for up to 50 teams), labelled "Team › Channel"; member counts aren't available.
- Posts in selected channels (`POST /teams/{team}/channels/{channel}/messages`, `contentType: html`, every text
  HTML-escaped): Brenda's posts after the person confirms, and digests, standups and reminders an owner turned on.
- **No Teams bot in v1**: posts appear from the connecting person's own Microsoft account. Brenda's are signed
  "Posted by Boredroom for Jo", route posts "Posted by Boredroom", and every card names whose account it is. The token
  is that person's (`ownerBound`): when they leave, owners and HR are told Teams needs reconnecting (anyone in the same
  organisation can reconnect it: the connection is the tenant).
- The connection label is "<organisation> (Teams)" (or "Microsoft Teams (<domain>)" when the organisation can't be read).
  Personal Microsoft accounts are refused (they have no Teams channels).
- No fixed spacing between calls: Graph's 429 and Retry-After set the backoff.

## Shared behaviour

- Tokens: `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token` (form, client secret), PKCE S256,
  `response_mode=query`, `prompt=select_account`, `nonce`. Access tokens last 60 to 90 minutes; refresh tokens
  **rotate** (a new one each use, 90 days by default), stored every time. `invalid_grant` or `interaction_required` →
  "needs reconnecting"; `AADSTS65001` and friends → admin approval.
- Token answers spell Graph scopes with or without the `https://graph.microsoft.com/` prefix and often leave out the
  OpenID scopes and `offline_access`; Boredroom normalises them so "can make changes" is judged right.
- Graph errors: `InvalidAuthenticationToken` → one refresh then reconnect; `ErrorAccessDenied` → FORBIDDEN;
  `ErrorItemNotFound` → NOT_FOUND; 429, and 503 with Retry-After, → RATE_LIMITED with that backoff.
- Graph change notifications (subscriptions) are not in v1.
