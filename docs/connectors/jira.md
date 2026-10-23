# Jira (Atlassian Cloud)

Work group, owner decisions 22 October 2026 (connectors). Adapter: `src/server/connectors/adapters/jira.ts` and
`atlassian.ts` (Atlassian Document Format, personal data reporting); card copy: `src/lib/connectors/providers/jira.ts`;
tests: `tests/unit/connectors/jira.test.ts`.

## Setting it up

1. developer.atlassian.com/console/myapps › **Create** › OAuth 2.0 integration › "Boredroom".
2. **Permissions** › Jira API › Add › classic scopes `read:jira-work`, `read:jira-user`, `write:jira-work`,
   `manage:jira-webhook`. (`offline_access` is asked for at sign-in.)
3. **Authorization** › OAuth 2.0 (3LO) › callback URL `<APP_ORIGIN>/api/connectors/jira/callback`.
4. **Settings**: copy the client ID and secret into `ATLASSIAN_CLIENT_ID` and `ATLASSIAN_CLIENT_SECRET`.
5. **Distribution** › Sharing: enable; vendor name, privacy policy URL; "Does your app store personal data?" **Yes**.
6. Know the limit: since 2 March 2026 every OAuth app shares one 65,000-points-an-hour pool across all customers (Tier 1).
   Boredroom budgets 50,000 of it. Apply for Tier 2 once more than a couple of hundred people connect Jira.

| Variable | What |
|---|---|
| `ATLASSIAN_CLIENT_ID` | The 3LO app's client ID |
| `ATLASSIAN_CLIENT_SECRET` | Its secret; it also signs Jira's webhook tokens |

## How it connects

- `https://auth.atlassian.com/authorize` with `audience=api.atlassian.com` and `prompt=consent`; no PKCE (not documented
  for 3LO); the token endpoint takes JSON. Refresh tokens rotate (`offline_access`) and expire after 90 days unused.
- Scopes: `read:jira-work read:jira-user manage:jira-webhook offline_access`; acting adds `write:jira-work`.
- The site: the first accessible resource with Jira scopes (`no_site` when there is none). Tenant = its cloud id; the card
  names the site when the account has several. Personal account = the Atlassian account id.
- No revoke endpoint: disconnecting deletes Boredroom's tokens and the card says where to remove the app (your Atlassian
  account settings › Connected apps).
- `ownerBound`: a workspace connection reads with the owner's account and needs reconnecting if they leave.

## What Boredroom reads

- Sources: projects (`/rest/api/3/project/search`, at most 4 pages), by id, labelled "Website (WEB)".
- Issues (`POST /rest/api/3/search/jql`, `nextPageToken`): personal `assignee = currentUser()`, workspace
  `project in (<selected ids>)`. "Updated since" uses JQL's relative minutes (`updated >= "-90m"`), which don't depend on
  the Jira user's time zone. Status category `new` open, `indeterminate` in progress, `done` done (a cancel-like status
  name, such as "Won't Do", cancelled). Priorities Highest 1, High 2, Medium 3, Low and Lowest 4. Links
  `https://<site>.atlassian.net/browse/<KEY>`.
- Descriptions only for `read_app_item` (ADF flattened to plain text, links left out).
- Every 30 minutes in working hours (2 hours otherwise); daily, the open set (`statusCategory != Done`, at most 500
  personal or 2,000 workspace).

## Budget

Every request spends points from the shared `jira:global` bucket (50,000 an hour, in the database): a search spends
1 + its page size, anything else 1. A 429 with `RateLimit-Reason` naming the global quota pauses every Jira sync to the
top of the hour (in the process, and the shared bucket is marked spent).

## What Brenda can do

Only through the person's **own** Jira connection (workspace connections never act, D10). All shared, so always Confirm:
create an issue (a Task, or the project's first non-sub-task type), comment (ADF paragraphs), move it (the first transition
to the wanted status category; "cancelled" only to a cancel-like status, destructive), assign ("me", or one assignable
person by email or exact display name; otherwise the names Jira suggests), set or clear the due date.

## Webhooks

Dynamic webhooks (`POST /rest/api/3/webhook`), registered at connect: personal `assignee = "<accountId>"`, workspace
`project in (...)` for the projects the account can see then (at most 100; the sink drops unselected projects). Events
`jira:issue_created`, `jira:issue_updated`, `jira:issue_deleted`. Deliveries carry a JWT (HS256, the client secret) whose
signature and expiry are checked. Each registration's URL carries Boredroom's own hook id (`?hook=<uuid>`), which alone
routes a delivery, with `matchedWebhookIds` as a cross-check (security fix, 22 October 2026: Jira's webhook ids are small
numbers per site, so routing by them reached other customers' connections and spent the shared points budget). Renewed 5 days before their 30 days; deleted on
disconnect.

## Personal data reporting

The `report_accounts` maintenance (weekly): every stored Atlassian account id (identities and item assignees) is reported
in batches of 90 to `POST https://api.atlassian.com/app/report-accounts/` with when Boredroom last changed it. A `closed`
account is erased (identity rows deleted, assignee id and label nulled). `Cycle-Period` is honoured (read as seconds; a
number under 1,000 as hours). A 429 stops the cycle; the next one reports again.

## Known gaps

- A workspace webhook doesn't follow later project selections (the 30-minute sync covers them); see the CONTRACT REQUEST
  in `asana.ts` for passing selections to `registerWebhooks`.
- The global pause lives in the worker's memory plus the shared bucket for the current hour; it isn't carried over a
  restart.
- The `Cycle-Period` unit couldn't be re-read from Atlassian's guide on 22 October 2026; both readings are accepted.
