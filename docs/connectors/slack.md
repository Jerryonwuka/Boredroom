# Slack

Calendars + chat group, owner decisions 22 October 2026 ("add connectors so teams can integrate their other apps").
Adapter: `src/server/connectors/adapters/slack.ts`; card: `src/lib/connectors/providers/slack.ts`; tests:
`tests/unit/connectors/slack.test.ts` (fixtures in `tests/fixtures/connectors/slack/`).

## What it does

- **Workspace only**, connected by an owner or HR in Settings › Connectors. Slug `slack`.
- Lists the channels Boredroom's bot is a member of (public and private) so owners and HR can select them.
- Posts in selected channels: end-of-day digests, standup rollups, people's own standups and standup reminders (routes
  an owner turned on), and someone's own words when they ask Brenda and confirm the exact text.
- Brenda's posts appear as the Boredroom app, signed “From Jo via Max”. Route posts are unsigned (the bot is Boredroom).
- Never: reading messages (Slack's limits for apps outside the Marketplace), direct messages, posting where it wasn't
  invited (no `chat:write.public`), Enterprise Grid organisation-wide installs.

## Scopes (bot token only)

| Scope | Why |
|---|---|
| `chat:write` | Post in channels Boredroom is in |
| `channels:read` | List public channels it is in (names, member counts) |
| `groups:read` | List private channels it was invited to |

No user scopes. The same scopes are asked for with or without "can make changes" (posting is the only use).

## Environment variables

| Variable | Where |
|---|---|
| `SLACK_CLIENT_ID` | Basic Information › App Credentials › Client ID |
| `SLACK_CLIENT_SECRET` | Basic Information › App Credentials › Client Secret |
| `SLACK_SIGNING_SECRET` | Basic Information › App Credentials › Signing Secret (verifies events) |

All three must be set for Slack to be offered. Never paste them anywhere but the environment.

## Setting it up (owner)

1. api.slack.com/apps › **Create New App** › **From a manifest**: paste `docs/connectors/slack-manifest.yaml` with
   `https://boredroom.cc` replaced by Boredroom's `APP_ORIGIN` (Slack requires https; for local work use a tunnel or
   `CONNECTORS_FAKE=1`).
2. **OAuth & Permissions**: redirect URL `<APP_ORIGIN>/api/connectors/slack/callback`; bot scopes `chat:write`,
   `channels:read`, `groups:read`; no user scopes. **Token rotation: on** (the manifest sets
   `settings.token_rotation_enabled`; it can't be undone).
3. **Event Subscriptions**: on; Request URL `<APP_ORIGIN>/api/connectors/webhooks/slack`. Slack checks it at once, so
   Boredroom must already be running there with `SLACK_SIGNING_SECRET` set. App events: `app_uninstalled`,
   `tokens_revoked`.
4. **Basic Information**: copy the three credentials into the variables above; display name and icon "Boredroom".
5. **Manage Distribution**: complete the checklist and **Activate Public Distribution** so other companies' workspaces
   can add it. A Marketplace listing is optional (only needed if Boredroom ever reads channel history).

In each workspace: connect Slack in Settings › Connectors, then in Slack type `/invite @Boredroom` in each channel
Boredroom should post in, press **Check now**, select the channels, and choose them under "Where Boredroom posts".

## How it works

- OAuth v2 (`https://slack.com/oauth/v2/authorize`, `https://slack.com/api/oauth.v2.access`), form body with the client
  secret, comma-separated scopes, no PKCE (Slack documents none), `state` bound to the person, workspace and browser.
- Token rotation: access tokens last 12 hours; the refresh token rotates (`grant_type=refresh_token`); the worker
  refreshes ahead of expiry. `invalid_refresh_token` marks the connection "needs reconnecting".
- Identity: the team id from the token answer is both the account and the tenant; the label is "<team name> (Slack)".
  `is_enterprise_install: true` is refused ("Boredroom can be added to one Slack workspace at a time…").
- Sources: `conversations.list?types=public_channel,private_channel&exclude_archived=true&limit=200`, at most 5 pages,
  only `is_member` channels; label `#name`, members `num_members`.
- Posting: `chat.postMessage` with `unfurl_links: false`, `unfurl_media: false`, `link_names: false`, `parse: none`;
  `&`, `<` and `>` escaped in every text (so `<!channel>`, `<@U…>` or a link can't be smuggled in; `@here` stays a plain
  word). Calls are spaced one a second (Slack allows about one message a second per channel).
- Errors (Slack answers 200 with `ok: false`): `not_in_channel`, `channel_not_found`, `is_archived`, `restricted_action…`
  → NOT_ALLOWED (a route turns off and owners and HR are told once); `ratelimited` or 429 → RATE_LIMITED with
  Retry-After; `invalid_auth`, `token_expired` → one refresh, then reconnect; `token_revoked`, `account_inactive` → REVOKED.
- Events: `X-Slack-Signature` = `v0=` + hex HMAC-SHA256 of `v0:<timestamp>:<raw body>` with the signing secret,
  constant-time compare, timestamp within 5 minutes; `url_verification` is answered with its challenge only after the
  signature checks; `app_uninstalled` and `tokens_revoked` (bot tokens) disconnect the workspace's Slack connection.
  Deliveries are deduplicated by `event_id`.
- Disconnect: `auth.revoke` with the stored token (best effort; an already-expired token can't be revoked, so remove the
  app in Slack's own Manage apps if needed).
