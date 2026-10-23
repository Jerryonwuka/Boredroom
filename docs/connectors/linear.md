# Linear

Work group, owner decisions 22 October 2026 (connectors). Adapter: `src/server/connectors/adapters/linear.ts`; card copy:
`src/lib/connectors/providers/linear.ts`; tests: `tests/unit/connectors/linear.test.ts`.

## Setting it up

1. Create (or use) a dedicated Linear workspace, for example "Boredroom Apps". Every admin there can see the app's secrets.
2. Settings › API › **OAuth applications** › New: name "Boredroom", developer, URL, callback URL
   `<APP_ORIGIN>/api/connectors/linear/callback`. Make it **public** so other workspaces can install it.
3. **Webhooks** on the application: URL `<APP_ORIGIN>/api/connectors/webhooks/linear`, resource type **Issues**. Copy the
   signing secret into `LINEAR_WEBHOOK_SECRET`.
4. Copy the client ID and secret into `LINEAR_CLIENT_ID` and `LINEAR_CLIENT_SECRET`. If Linear asks to enable the app actor for
   workspace installs, enable it.

| Variable | What |
|---|---|
| `LINEAR_CLIENT_ID` | The OAuth application's client ID |
| `LINEAR_CLIENT_SECRET` | Its client secret |
| `LINEAR_WEBHOOK_SECRET` | The application webhook's signing secret |

All three must be set, or the card says "Not set up yet" to owners and is hidden from everyone else.

## How it connects

- Authorisation code with PKCE (S256), `prompt=consent`, comma-separated scopes. Workspace connections install the app
  actor (`actor=app`); personal ones act as the person.
- Scopes: reading asks only `read`. "Can make changes" adds `issues:create`, `comments:create` and `write` (Linear has no
  narrower scope for changing state, assignee or due date).
- Access tokens last 24 hours; refresh tokens rotate. Disconnecting revokes at `POST https://api.linear.app/oauth/revoke`.
- Workspace connection: account and tenant are the Linear organisation, labelled "Acme (Linear)". Personal connection: the
  person's Linear user, labelled with their email, tenant the organisation (so their own connection acts on the workspace's
  items as them).

## What Boredroom reads

- Sources: teams (`teams(first: 100)`), labelled "Web (WEB)".
- Issues: personal `viewer.assignedIssues`; workspace `issues` in the selected teams. Fields: identifier, title, URL,
  priority (Linear's 0 to 4 scale as it is), due date, state (`completed` done, `canceled` cancelled, `started` in progress,
  anything else open), team, assignee, description (first 2,000 characters).
- Every 15 minutes in working hours (2 hours otherwise): changes since the last watermark (2 minutes' overlap). Every 6
  hours: the open set, reconciled when it was read in one run, then the last 48 hours of changes.

## What Brenda can do

All of it is shared, so it always waits for Confirm: create an issue, comment, change state (the team's first workflow
state of that type; cancelling is destructive), assign ("me", or one active user by email or exact name; several matches
are listed), set or clear the due date. Workspace connections act as the Boredroom app with `createAsUser: "Jo (via
Boredroom)"` and the line "From Jo via Max" under the words; personal connections act as the person.

## Webhooks and limits

- `Linear-Signature` is checked (hex HMAC-SHA256 of the raw body) and `webhookTimestamp` must be within 60 seconds;
  `Linear-Delivery` deduplicates. `Issue` events refresh that one issue for every connection in the organisation; an
  `OAuthApp` `revoked` event disconnects the organisation's connections.
- `RATELIMITED` (HTTP 400, GraphQL errors) backs the connection off until Linear's reset header; `AUTHENTICATION_ERROR`
  refreshes the token once.

## Known gaps

- The open-set reconciliation only runs when the open set fits one run (up to 1,000 issues); bigger sets rely on the
  "updated since" sync and Linear's webhook.
- If Linear refuses `actor=app` for someone who isn't an admin, the connection fails with the generic words; the card's
  note asks them to have a Linear admin connect it.
