# Asana

Work group, owner decisions 22 October 2026 (connectors). Adapter: `src/server/connectors/adapters/asana.ts`; card copy:
`src/lib/connectors/providers/asana.ts`; tests: `tests/unit/connectors/asana.test.ts`.

## Setting it up

1. Asana developer console (app.asana.com/0/my-apps) › **Create new app** › "Boredroom".
2. **OAuth** › redirect URL `<APP_ORIGIN>/api/connectors/asana/callback`; permission scopes: choose **specific scopes** (not
   Full permissions): `openid`, `email`, `profile`, `users:read`, `workspaces:read`, `projects:read`, `tasks:read`,
   `tasks:write`, `stories:write`, `webhooks:read`, `webhooks:write`, `webhooks:delete`.
3. **Manage distribution** › **Any workspace**; fill the listing details (enterprise admins use them to allow the app).
4. Copy the client ID and secret into `ASANA_CLIENT_ID` and `ASANA_CLIENT_SECRET`.

| Variable | What |
|---|---|
| `ASANA_CLIENT_ID` | The app's client ID |
| `ASANA_CLIENT_SECRET` | Its client secret |

Webhooks need no variable: Boredroom registers its own, at `<APP_ORIGIN>/api/connectors/webhooks/asana/<hook id>`.

## How it connects

- Authorisation code with PKCE (S256); space-separated scopes, always the full set (Asana's re-requests are not additive).
  Reading: `openid email profile users:read workspaces:read projects:read tasks:read webhooks:read webhooks:write
  webhooks:delete`; acting adds `tasks:write stories:write`.
- Access tokens last an hour; the refresh token is long-lived and reusable. Disconnecting revokes at
  `POST https://app.asana.com/-/oauth_revoke` with the refresh token.
- Workspace connection: the owner's first Asana workspace (named on the card when there were several), account and tenant
  that workspace. Personal connection: the person's Asana user, tenant their first workspace; up to 5 workspaces are read.
- `ownerBound`: a workspace connection reads with the owner's account and needs reconnecting if they leave.

## What Boredroom reads

- Sources: projects of the workspace (`GET /projects`, at most 5 pages).
- Tasks (`GET /tasks`): personal `assignee=me&workspace=…` per workspace; workspace `project=…` per selected project (the
  item's source is that project). Changes since the watermark use `modified_since` and `completed_since` (so a task
  finished since shows as done); the daily reconciliation reads the open set (`completed_since=now`). Name, completed,
  due date or time, link, assignee, the first project, notes (first 2,000 characters).
- Every 15 minutes in working hours (2 hours otherwise). 429 and `Retry-After` back off; 402 (a paid Asana feature) is
  "not allowed".

## What Brenda can do

Only through the person's **own** Asana connection (workspace connections never act, D10). All shared, so always Confirm:
create a task in a project (or their My Tasks), comment (a story), mark it completed or not completed (Asana has no "in
progress" or "cancelled": Brenda says so), assign ("me", an email Asana knows, or one exact name from the workspace's
typeahead; otherwise the names it suggests), set or clear the due date.

## Webhooks

For workspace connections, one hook per **selected** project (at most 20; security fix, 22 October 2026), registered
again whenever the workspace's selection changes, with Boredroom's hooks on projects no longer selected removed; projects
that already have a live hook to Boredroom keep it. A task with no project, or only unselected ones, is never stored for
the workspace; a task in several selected projects keeps the one it is stored under. `POST /webhooks` makes Asana send the `X-Hook-Secret` handshake to the hook's own URL;
Boredroom seals that secret into the pending hook (once) and echoes it. Deliveries are checked with `X-Hook-Signature`
(hex HMAC-SHA256 of the raw body). Task events refresh those tasks; heartbeats keep the hook alive and sync. Asana
delivers at most once, so the regular sync carries on. Hooks silent for a day are made again; hooks are deleted on
disconnect.

## Known gaps

- CONTRACT REQUEST in `asana.ts`: `webhook.route` sees only the body, so the hook id is handed over from `verify` by the
  body's digest (30 seconds, in the process). Passing the hook id to `route` would remove that.
- CONTRACT REQUEST: `registerWebhooks` doesn't know the selected projects, so hooks cover the first 20 projects at
  connect; later selections rely on the 15-minute sync.
- A task in several projects is attributed to the project it was listed from; refreshing it from a webhook uses its first
  project, which may be one nobody selected (then the next sync updates it).
- A person with several Asana workspaces acts on workspace items only in their first one (the tenant).
