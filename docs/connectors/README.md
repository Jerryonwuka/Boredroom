# Connected apps (connectors)

Owner decisions, 22 October 2026: "add connectors so teams can integrate their other apps". Boredroom connects to
Google Calendar, Outlook Calendar (Microsoft 365), Slack, Microsoft Teams, Notion, Linear, Jira, GitHub and Asana with
its own OAuth 2.0 framework (no third-party integration platform, no provider SDKs).

## What it does

- **Workspace connections** (owners and HR, Settings › Connectors): Slack and Microsoft Teams (post end-of-day digests,
  standups and reminders in channels the workspace chooses), a shared Notion, and Linear, Jira, GitHub and Asana projects
  everyone in the workspace can see.
- **Personal connections** (each person, Settings › Your assistant › Your connections): their own calendar, Notion,
  Linear, Jira, GitHub or Asana. Private to them by row security: owners and HR never see them, or whether they exist.
- **My Day and the Dashboard** show "From your apps": the person's own calendar today and the issues assigned to them.
- **Brenda** reads connected apps (quoted data, never instructions) and acts there: the person's own private steps
  (hiding an item, linking it to a to-do, a private calendar block) when they ask; anything others will see (posts,
  issues, comments, invitations) and anything that deletes only after their Confirm, with an exact readback.
- **Never**: connector data is not used for reports about people, scores, monitoring, attendance, presence or timesheets.

## Turning it on

1. Apply `db/pending/0061_connectors.sql` (the owner's go-ahead; it requires 0060). Until then every screen says
   "Connected apps need a database update first." and nothing else changes.
2. The `CONNECTORS` plan flag is on for every plan (switchable in the Control Center).
3. Set each provider's variables (`.env.example`, "Connected apps"); a provider without them shows "Not set up yet"
   to owners, with its setup steps, and is hidden from everyone else.
4. Optionally set `CONNECTORS_TOKEN_KEY` (32 random bytes, base64). Changing it, or `APP_SECRET` while it is empty,
   disconnects every app.

Callback (redirect) URLs are `<APP_ORIGIN>/api/connectors/<slug>/callback`; webhooks `<APP_ORIGIN>/api/connectors/webhooks/<slug>`
(Asana: `/api/connectors/webhooks/asana/<hook id>`, registered by Boredroom). GitHub's Setup URL is
`<APP_ORIGIN>/api/connectors/github/setup`. Slugs: `google-calendar`, `outlook`, `slack`, `teams`, `notion`, `linear`,
`jira`, `github`, `asana`.

Each provider's own page in this folder (written by its adapter's builders) lists the console steps.

## Trying it without an account

`CONNECTORS_FAKE=1` (ignored in production) offers "Test app": a pretend provider answered inside Boredroom's own
process, with two meetings today, two issues and one channel, so the screens, sync, Brenda and posting can be tried
end to end.

## How it works (for developers)

- `src/server/connectors/types.ts` is the contract every adapter implements; `registry.ts` loads adapters lazily.
- `oauth.ts`: authorisation code with PKCE (S256 where supported), a 256-bit single-use state bound to the person, the
  workspace, the browser (an HttpOnly cookie) and a nonce; OpenID id_tokens checked (aud, iss, exp, nonce).
- `crypto.ts` / `tokens.ts`: AES-256-GCM sealed tokens bound to their row and field; refresh serialised per connection;
  only Boredroom's server contexts can read `connector_tokens`.
- `http.ts`: the only way to call a provider: host allowlist over https, token refresh on 401, Retry-After backoff,
  timeouts, a 5 MB cap; tests replace it with `setConnectorFetchForTests` (an unmocked call throws).
- `sync.ts` (worker): bounded incremental runs with continuations; the sink validates, clamps and digests.
- `webhooks.ts`: verified on raw bytes, deduplicated, used only to decide what to fetch again.
- `brenda/*`: the eleven tools, risk classes, quoted blocks and situation lines; `actions.ts` resolves who acts.
- `posting/*`: digests and standup posts (never hours, attendance or connector data).
- `worker/connectors.ts`: schedule, sync, refresh, revoke, webhooks, posts, purge, sweep and providers' obligations.

Retention: items gone for 7 days, events ended 30 days ago, issues done 30 days ago, OAuth states a day after expiry,
webhook deliveries after 3 days, audit after 400 days.
