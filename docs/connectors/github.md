# GitHub (a GitHub App)

Work group, owner decisions 22 October 2026 (connectors). Adapter: `src/server/connectors/adapters/github.ts` and
`github-app.ts` (App JWT, installation tokens, installation verification); card copy:
`src/lib/connectors/providers/github.ts`; tests: `tests/unit/connectors/github.test.ts`.

## Setting it up

1. GitHub › Settings (an organisation's for production) › Developer settings › **GitHub Apps** › New: name "Boredroom"
   (its URL slug goes in `GITHUB_APP_SLUG`), homepage URL.
2. **Identifying and authorizing users**: callback URL `<APP_ORIGIN>/api/connectors/github/callback`; **Expire user
   authorization tokens**: on; **Request user authorization (OAuth) during installation**: off.
3. **Post installation**: Setup URL `<APP_ORIGIN>/api/connectors/github/setup` (the card shows it filled in); **Redirect on
   update**: on.
4. **Webhook**: active; URL `<APP_ORIGIN>/api/connectors/webhooks/github`; a random secret (`openssl rand -hex 32`) in
   `GITHUB_APP_WEBHOOK_SECRET`.
5. **Permissions** › Repository: Issues **Read and write**, Pull requests **Read-only**, Metadata **Read-only**.
   Organisation: **Members Read-only** (security fix, 22 October 2026: Boredroom checks that whoever connects an
   organisation for a workspace is one of its owners). No account permissions. **Subscribe to events**: Issues, Pull
   request.
6. Where can it be installed: **Any account**. Create.
7. Note the App ID (`GITHUB_APP_ID`) and Client ID (`GITHUB_APP_CLIENT_ID`); generate a client secret
   (`GITHUB_APP_CLIENT_SECRET`) and a private key (`GITHUB_APP_PRIVATE_KEY`: the .pem with `\n` for line breaks, or base64
   of the file).

| Variable | What |
|---|---|
| `GITHUB_APP_ID` | The App ID (the JWT's `iss`) |
| `GITHUB_APP_SLUG` | The App's URL name (`github.com/apps/<slug>`) |
| `GITHUB_APP_CLIENT_ID` | The App's client ID (user authorisation) |
| `GITHUB_APP_CLIENT_SECRET` | Its client secret |
| `GITHUB_APP_PRIVATE_KEY` | The App's private key (PEM with `\n`, or base64) |
| `GITHUB_APP_WEBHOOK_SECRET` | The App webhook's secret |

## How it connects

- **Workspace (installation).** Start sends the owner to `github.com/apps/<slug>/installations/new`. GitHub's Setup URL
  brings them back with `installation_id`, kept as a claim only; then the user authorisation (PKCE S256). Boredroom
  accepts the installation only when the person's own user token lists it (`GET /user/installations`; otherwise
  `install_unverified`). The connection then works with installation tokens (1 hour) minted from the App's JWT (RS256,
  `iat` 60 s back, `exp` 9 minutes, `node:crypto`), registered with the framework's token minter. The verifying user token
  is kept sealed in `extra`. Account `installation:<id>`, tenant the installation id, label "acme (GitHub)".
- **Waiting for approval.** With `setup_action=request` (an organisation owner must approve), the connection is stored as
  waiting (`settings.public.waiting`), reads nothing, and the card says so.
- **Personal.** The person's expiring user token (8 hours; refresh token 6 months, rotating). Items come only from
  repositories where the App is installed (the card says so). Account the GitHub user id, label the login, no tenant.
- No OAuth scopes: a GitHub App's permissions are set on the App.
- Disconnecting a personal connection revokes that one token (`DELETE /applications/{client_id}/token`, Basic client auth).
  Decision 22 October 2026: not the whole grant (`/grant`), which every Boredroom workspace the person connected shares.
  Installations are left for the organisation to remove (another workspace may use them).

## What Boredroom reads

- Sources: the installation's repositories (`GET /installation/repositories`, at most 5 pages), id the lower-cased
  `owner/name`, label as GitHub shows it; at most 50 selected are read.
- Personal: `GET /issues?filter=assigned` (issues and pull requests assigned to the person) and, at most every 30 minutes,
  `GET /search/issues?q=is:open is:pr review-requested:@me` ("Review requested").
- Workspace: `GET /repos/{owner}/{repo}/issues?state=all&since=…` per selected repository.
- Item id `owner/repo#n` (lower-cased), key `owner/Repo#n`. Open is open; closed as not planned is cancelled; any other
  closed issue, and a merged pull request, is done. Body: the first 2,000 characters. No priorities, no due dates.
- Every 15 minutes in working hours (2 hours otherwise), every 6 hours the open set. A run stops when
  `x-ratelimit-remaining` drops under 100 and carries on from there next time; secondary limits (403/429 with
  `retry-after`, or `x-ratelimit-remaining: 0`) back the connection off.

## What Brenda can do

Issues only; pull requests are read only. All shared, so always Confirm: create an issue in a repository, comment, close
(completed: shared; not planned: destructive) or reopen, assign ("me" for a personal connection, or a login GitHub says can
be assigned in that repository). No "in progress" and no due dates in GitHub: Brenda says so. Workspace connections act as
`<slug>[bot]` with the line "From Jo via Max" under the words (decision 22 October 2026: §9.5's signed line, like every
other app, rather than a "From Jo via Boredroom:" prefix); personal connections act as the person.

## Webhooks

`X-Hub-Signature-256` over the raw body; the signed body's SHA-256 deduplicates (security fix, 22 October 2026: the
`X-GitHub-Delivery` header isn't signed). `issues` and `pull_request` refresh that item
for the installation and for the people it concerns (assignees, requested reviewers, whoever was just added or removed);
`installation` deleted or suspended disconnects the installation's connection, unless that connection was made after the
event (its `suspended_at`/`updated_at`), so a replay changes nothing; `installation_repositories` syncs;
`github_app_authorization` revoked only queues a sync of the person's connection, which then finds out with its own token
(and asks to be reconnected).

Who may connect for a workspace (security fix, 22 October 2026): GitHub lists an installation under
`GET /user/installations` for anyone with explicit access to any one of its repositories, while an installation token
reaches all of them. So `identify` also requires the person to administer the installation's account: for an
organisation `GET /user/memberships/orgs/{org}` must answer `role: admin, state: active`; a personal account must be
their own (`install_not_admin` otherwise). Every full sync and every read of the repository list checks it again with the
installation token (`GET /orgs/{org}/memberships/{login}`); when it fails the connection needs reconnecting. Disconnecting a
workspace revokes the verifying user token kept in `extra` (`DELETE /applications/{client_id}/token`); the installation
itself stays for the organisation to remove.

## Known gaps

- "Finish connecting" a waiting installation: once approved, the owner disconnects the waiting card and connects again
  (a reconnect must keep the same account, and the waiting card has none yet). CONTRACT REQUEST in `github.ts`: let
  `identify` return a replacement token set (today the installation token replaces the user token in place).
- Open-set reconciliation only when the whole open set fits one run.
- A renamed or transferred repository's items get new ids (the old ones age out).
