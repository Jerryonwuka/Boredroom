# Notion

Owner decisions, 22 October 2026 (connectors): Notion pages (policies, specs) become knowledge Brenda reads, and Brenda can
add a page, add text to the end of a page or comment on a page, always after the person confirms. Adapter:
`src/server/connectors/adapters/notion.ts` (with `notion-blocks.ts`); card copy: `src/lib/connectors/providers/notion.ts`;
tests: `tests/unit/connectors/notion.test.ts` with fixtures in `tests/fixtures/connectors/notion/`.

## Setting it up (the owner)

1. Go to Notion's Developer portal (app.notion.com/developers/connections) and create a new **public connection**
   with installation scope **Any workspace** (Notion doesn't let you change this after creation; fix, 22 October 2026:
   Notion now calls these connections). Name it "Boredroom", then fill in the company name, website, privacy policy,
   terms, support email and logo.
2. **Capabilities**: turn on Read content, Insert content and Insert comments, and set user information to "without email
   addresses". Leave Update content and Read comments off.
3. **OAuth configuration**: add the redirect URI `<APP_ORIGIN>/api/connectors/notion/callback`.
4. From the connection's **Configuration** tab, copy the OAuth client ID and secret into `NOTION_CLIENT_ID` and `NOTION_CLIENT_SECRET` (`.env.example`, "Connected
   apps"). Don't put them in any other file. Restart Boredroom.
5. Notion doesn't need webhooks: Boredroom checks Notion every hour. Notion only needs a security review to list the
   integration in its Marketplace.

Until both variables are set, owners see the card as "Not set up yet", with these steps, and everyone else doesn't see it.

## Who connects, and what people see

- **Workspace connection** (owners and HR, Settings › Connectors). The owner picks pages in Notion's own picker. The
  source list then shows the top of what they shared: top-level pages, and databases as "Name (database)". Owners and HR
  choose which of these Boredroom reads, and who sees them: everyone, or one team. A page counts as part of a source when
  that source is its topmost ancestor the connection can open. Pages outside the chosen sources are never stored. To
  change pages, use "Change pages", which reconnects through Notion's picker.
- **Personal connection** (each person, Settings › Your assistant › Your connections). Every page the person shared is
  theirs alone in Boredroom (row security), and owners and HR can't see that they connected Notion.
- Pages never appear in My Day. They're knowledge for Brenda: `find_in_apps` and `read_app_item`, as quoted data that's
  never treated as instructions. Notion text never counts towards reports, scores or attendance.

## OAuth

| | |
|---|---|
| Authorise | `https://api.notion.com/v1/oauth/authorize` with `owner=user` (no `scope` parameter, no PKCE) |
| Token | `https://api.notion.com/v1/oauth/token`, JSON body, HTTP Basic client authentication |
| Scopes | None. Capabilities are set once on the integration. Boredroom enforces "{name} can make changes" itself, so turning it on needs no new consent. |
| Refresh | `refresh_token` grant; the response has a new pair, so it's treated as rotating. `expires_in` isn't documented, so a 401 refreshes once and then the connection needs reconnecting. |
| Revoke | `POST /v1/oauth/revoke` `{ token }` with Basic client authentication, on disconnect (best effort) |
| Account | Workspace: the Notion `workspace_id` (label `workspace_name`). Personal: `workspace_id:owner.user.id` (label "Ada Obi in Acme"; identity `owner.user.id`, no email). |

**Decision (knowledge group, 22 October 2026).** The connection's account id is the Notion workspace (or the workspace
plus the person), not `bot_id`. That way "Change pages", which reconnects, always matches the connection it's
reconnecting. Notion doesn't promise that a new authorisation keeps the same `bot_id`.

Every API call sends `Notion-Version: 2026-03-11`. That version renamed `archived` to `in_trash`, and appending blocks now
takes a `position` object.

## Syncing (`pages` stream)

- It runs hourly. Each run makes at most 10 search requests and fetches at most 50 pages' text, in about 15 seconds,
  with requests spaced 350 ms apart (Notion allows about 3 a second per connection). If more work is left, the cursor
  saves where the run stopped, and the framework queues a continuation.
- **The pass.** `POST /v1/search` filters to pages, sorted by last edited (newest first), 50 per request, with
  `filter_properties=title`. The pass stops at the first page edited before the watermark. The watermark is the newest
  edit of the last finished pass, less 2 minutes, because Notion rounds edit times to the minute. For each changed page:
  - **Trashed or archived:** the page is gone.
  - **Workspace connections:** the page must sit under a chosen source; otherwise it's gone. Finding the page's root
    walks up its parents. Search answers supply most of them; any other parent costs one remembered call per object.
    Pages inside columns or toggles go through `GET /v1/blocks/{id}`.
  - **Markdown:** `GET /v1/pages/{id}/markdown` is kept as the excerpt, at most 20,000 characters. Placeholders for
    blocks Boredroom can't see become "[…]". Signed file links (temporary S3 URLs) are dropped, and images keep only
    their alt text.
- **Reconciliation:** weekly (and on every full run), ids only. Search lists at most 10 requests of 100. Every page
  missing from a complete listing leaves Boredroom (deleted, trashed or unshared). An incomplete listing never
  reconciles.
- **Full runs:** on connecting, whenever the chosen sources change, and monthly. These fetch every page's text again
  (at most 500 pages per connection).
- **Partial results:** search can answer partial objects (only `object` and `id`). Those are read in full before they're
  judged.
- **`read_app_item`:** returns a page's later parts from `GET /v1/pages/{id}/markdown`, cut at the asked length.

## What Brenda can do (`notion_action`)

All three are **shared**: there's always a Confirm card, in every mode, and none can be undone. Each card shows exactly
what will be sent. Text can be up to 6,000 characters: paragraphs, "- " bullets and "[ ] " to-dos (`notion-blocks.ts`;
2,000 characters per rich text item, at most 100 blocks). Anything past 100 blocks is folded into the last paragraph,
so no words are lost.

| Action | Request | Card |
|---|---|---|
| `create_page` | `POST /v1/pages` (`parent.page_id`, title, children) | Add a Notion page under “Specs” · Everyone who can see “Specs” in Notion · A new page “{title}”, added {as} |
| `append` | `PATCH /v1/blocks/{page}/children` with `position: { type: "end" }` | Add to “Login spec” in Notion · Everyone who can see “Login spec” in Notion · These lines at the end of the page, added {as} |
| `page_comment` | `POST /v1/comments` (`parent.page_id`, rich text) | Comment on “Login spec” in Notion · Everyone who can see “Login spec” in Notion · Your comment, added {as} |

`{as}` depends on the connection:

- **Workspace:** "by the Boredroom app, signed “Jo via Max”". The text ends with the line "From Jo via Max", exactly as
  the card shows it.
- **Personal:** "by the Boredroom integration in your Notion". There's no signature.

A page created through the workspace connection takes its parent's source, and with it the parent's audience.

Brenda never deletes, moves, shares, changes permissions or invites in Notion.

## Errors

Notion's error bodies (`{ object: "error", status, code, message }`) become fixed codes, and the message is never kept:

| Notion code | Fixed code |
|---|---|
| `rate_limited`, `service_overload` (429, 529) | `RATE_LIMITED`, using Retry-After or `additional_data.retry_after` |
| `public_api_request_blocked` (429) | `FORBIDDEN` (don't retry) |
| `unauthorized` | `REAUTH_REQUIRED` (after one refresh) |
| `restricted_resource` | `FORBIDDEN` |
| `object_not_found` | `NOT_FOUND` |
| `conflict_error` | `CONFLICT` |
| `validation_error`, `invalid_request` | `NOT_ALLOWED` |
| `invalid_json`, `invalid_request_url`, `missing_version` | `BAD_RESPONSE` |

## Not in v1

- Notion webhooks.
- Reading comments.
- Updating or deleting content.
- Google Drive.
- Data sources' row properties beyond the title.
