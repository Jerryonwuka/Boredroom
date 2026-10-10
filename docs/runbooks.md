# Runbooks

## Slow pages

Page time is almost all database round trips, not rendering (the dev log prints both: `next.js` is render, `application-code` is data). Every transaction costs one round trip to open (BEGIN plus the identity settings, sent as one statement), one per query, one to commit. Measure the round trip first:

```bash
node -e 'const{Client}=require("pg");const c=new Client({connectionString:process.env.DATABASE_URL});(async()=>{await c.connect();for(let i=0;i<3;i++){const t=Date.now();await c.query("select 1");console.log(Date.now()-t,"ms")}await c.end()})()'
```

Under 5 ms means the app and database share a region and pages should render in well under a second. Around 200 ms or more means they are far apart (for example a laptop in Lagos against Neon in US East): a page that makes ten round trips takes two seconds before any work happens. The fix for that is placement, not code: host the app in the database's region, or choose a Neon region near the people who use it. The code keeps round trips low (the shell is one statement, the dashboard two, the attendance board one), and `keepAlive` on the pool stops idle connections being dropped, which otherwise shows up as `read ETIMEDOUT` in the log and a slow reconnect on the next page.

## Backup and restore

Use the scripts: `pnpm db:dump` to back up, `pnpm db:restore "<url>" <file>` to restore anywhere (see "Backup, and moving the database to Neon" below for the full procedure and the version requirement for `pg_dump`).

Restoring a backup taken before the old recordings were deleted (phase 8) brings recording rows back: run "Deleting the old recordings" below again (the dry run, then `--confirm`) before migration 0055 is applied, or its guard refuses.

Restore drill status: `pnpm db:dump` → `pnpm db:restore` into a fresh database was verified on PostgreSQL 16 (18 September 2026): identical table, policy, trigger and function counts, and row-level security enforced on the copy. A production drill with real object storage is a launch prerequisite.

## Deleting the old recordings (phase 8)

Screen recording for tasks was taken out (owner decisions, 8 October 2026) and the existing recordings are deleted by the owner, with `db/scripts/delete-recordings.ts` (package script `db:delete-recordings`). It is the only thing that deletes recording data. It connects with `DATABASE_ADMIN_URL` (the database owner: the app role may not delete audit rows) and prints the host and the database's name only, never the connection string.

Where to run it: on the machine that serves the web app's files, with that machine's storage settings (`STORAGE_PROVIDER`, `STORAGE_LOCAL_DIR`; only the local provider exists today) and a `DATABASE_ADMIN_URL` for the database to clean. The script deletes the stored video files through the storage provider of the machine it runs on and sweeps `org/*/recordings/` under that machine's `STORAGE_LOCAL_DIR`. Run anywhere else, the rows are deleted and the real files stay behind on the other machine, with nothing pointing at them.

The order (contract A.9):

1. Merge phase 8 and apply migration 0054 (the lead).
2. Deploy the new web app AND the new worker everywhere (the Fly worker too). A worker from before phase 8 still reads `recordings` on every maintenance pass; after 0055 it would fail each one.
3. The owner runs the dry run and reads it:
   ```
   pnpm db:delete-recordings
   ```
   It changes nothing (`BEGIN READ ONLY`) and prints, per organisation and in total: recordings by state, chunks by state, the access log, privacy incidents, grants, capture exceptions, tombstones, work sessions linked to a capture exception, recording jobs by state, the notifications, session events and audit rows that only exist because of recording; the stored files the database knows (how many exist, bytes declared and found), orphan files and empty folders under `org/*/recordings/`; the storage provider and root it checked; local backups in `var/backups` that may still hold recording rows (listed, never touched). It starts with the database it reads ("Database: neondb, on host ep-…") and ends with the exact command to delete. When it says files the database knows were "not found here", they were either deleted already (retention deleted most recordings) or are kept on another machine: if another machine, run steps 3 and 4 there instead.
4. The owner runs that command, which names the database host AND the database (fix review, 10 October 2026: several databases can share one host, such as dev and test on localhost, or several on one Neon endpoint):
   ```
   pnpm db:delete-recordings --confirm=<host>/<database>
   ```
   The database is the one PostgreSQL says the connection reached (`current_database()`). A different host, another database on the same host, the host alone, or a bare `--confirm` is refused, so a pasted command cannot delete from another database. One transaction locks the recording tables, deletes the rows in foreign-key order, deletes the audit rows about recordings (add `--keep-audit` to keep them), and writes one `recordings.purged` audit row per organisation and one global row, with counts only. After the commit it deletes the stored files and the `org/*/recordings/` folders. Any failure before "The database part is done" rolls back whole; running it again is safe (a second run finds nothing and only sweeps folders). If the rows were already deleted from another machine, the same `--confirm=<host>/<database>` command run on the machine with the files sweeps its `org/*/recordings/` folders.
5. The lead moves `db/pending/0055_remove_screen_recording.sql` into `db/migrations/` and applies it (`pnpm db:migrate`). Its guard raises `RECORDINGS_REMAIN` if step 4 did not happen; it is safe to run twice.
6. Browsers clear the `boredroom-capture` buffer of unsent video on their next workspace page, by themselves.

Neon's point-in-time history keeps the deleted rows until its restore window passes; old dumps in `var/backups` keep them until deleted by hand.

## Calls: checking LiveKit

Calls use LiveKit Cloud (owner decision, 8 October 2026). `GET /api/health` reports `calls`: "LiveKit configured" or what is missing (never the values); calls are optional, so it never fails the health check.

- Rooms open now: from a scratch script with the server SDK, `new RoomServiceClient(httpsUrl, key, secret).listRooms()`. Every Boredroom room is named `call-<call id>`; the worker deletes a room when its call ends and sweeps leftovers every 10 minutes, so a room older than its call is a bug worth reporting.
- Calls in the database: `SELECT state, count(*) FROM calls GROUP BY state;` and live ones with `WHERE state <> 'ended'`.
- Minutes: the Control Center's overview and Usage pages show "Calls this month" and "Call minutes this month" (participant minutes, what LiveKit counts). LiveKit Cloud's free Build plan stops at 5,000 participant minutes a month (a hard stop until the 1st). Calls are on every plan: move to the Ship plan (from $50 a month) before launch, or as soon as the minutes approach the limit.

## Registering the LiveKit webhook in production

Optional but recommended: calls work without it (devices heartbeat and Boredroom compares each live room with who is in the call, at most every 15 seconds from the heartbeats and every minute from the worker; localhost cannot receive webhooks anyway). In production it ends an abandoned room's call a little sooner, and takes out at once anyone who comes back to a call they are no longer on (LiveKit cannot revoke a join token: someone who left, or was taken out of the channel, could reconnect with the token they held until it expires; Boredroom's tokens last 2 minutes; fix review, 10 October 2026).

1. LiveKit Cloud → the project → Settings → Webhooks → add `https://<host>/api/livekit/webhook`.
2. Choose the API key the server uses (`LIVEKIT_API_KEY`); its secret signs every delivery and the route refuses anything it cannot verify.
3. Only `room_finished`, `participant_joined`, `participant_left` and `participant_connection_aborted` are acted on; repeats are harmless. A `participant_joined` from someone without a place in the call (not `joined` in Boredroom) is taken out of the room at once.

## Call transcripts

When people on a call agree to Brenda's notes, each consenting person's own device sends the text of their own words (never audio). Only the people who were on the call can read those lines; owners, HR and team leads cannot. The `call.transcript_purge` worker job (hourly) deletes them 7 days after the recap; the recap stays. Check: `SELECT count(*) FROM call_transcript_lines l JOIN call_recaps r ON r.call_id = l.call_id WHERE r.created_at < now() - interval '7 days';` should be zero within the hour.

## Worker health

- Pending backlog: `SELECT type, count(*) FROM jobs WHERE state = 'pending' GROUP BY type;`
- Dead jobs: `SELECT id, type, last_error FROM jobs WHERE state = 'dead';` Fix the cause, then `UPDATE jobs SET state = 'pending', attempts = 0 WHERE id = '…';`
- A job locked for more than 15 minutes is automatically returned to `pending` by the worker.

## Stale sessions

- Sessions without heartbeats for longer than the policy's `stale_after_seconds` (default 90) are interrupted at the last heartbeat by the worker. Nothing after that instant is credited.
- The employee sees "Session interrupted" and can resume (new interval) and file a time correction for the gap. Managers see the correction in Reviews.

## Offboarding

People → Offboard. Effects: membership revoked (new requests and live channels denied), open session interrupted at its last confirmed boundary, sign-in sessions revoked if the person has no other active workspace, audit event written. Historical work is retained.

## Control Center (super admin)

The internal console lives at `/admin`. It is a separate area of the same app with its own role-based permissions, enforced on the server for every page and action, and every action is written to `platform_audit_events` with the admin, target, reason, before and after.

1. **First super admin.** Put the account's email in `PLATFORM_SUPER_ADMINS` (comma-separated) and restart. The first visit to `/admin` by that account creates its `platform_admins` row (recorded as `admin.bootstrap`). After that, Admins and permissions manages roles: super admin, operations, support, billing, marketing, technical, read-only.
2. **Paystack.** Set `PAYSTACK_SECRET_KEY` (and `PAYSTACK_PUBLIC_KEY`). In Paystack, Settings, API Keys and Webhooks, add `<APP_ORIGIN>/api/billing/paystack/webhook`. Organisation owners pay from Settings, Plan and billing; the callback verifies the reference with Paystack before anything is recorded; webhooks are verified with the HMAC and recorded once by event key, so redelivery is a no-op.
3. **Brevo.** Delivery already runs through the SMTP relay. `BREVO_API_KEY` (and optionally `BREVO_LIST_ID`) adds contact synchronisation with attributes (create them once in Brevo: FIRSTNAME, LASTNAME, ORGANIZATION, PLAN, SUBSCRIPTION_STATUS, SUBSCRIPTION_EXPIRY, SIGNUP_DATE, LAST_ACTIVITY, COUNTRY, STATUS, WAITLIST). Settings, Brevo shows whether the key works.
4. **Launch mode.** Waitlist and launch, Launch settings: WAITLIST (landing page shows the waitlist form, sign-up and organisation creation refuse, existing users unaffected), LIVE (registration open), MAINTENANCE (registration closed, app optionally closed to non-admins with a notice). Needs a reason and confirmation; audited; the public site follows within fifteen seconds (settings cache).
5. **Impersonation.** From a user or organisation page, "View as". The admin's session cookie is parked in `boredroom_admin_return`, a two-hour session for the target is issued and marked with the impersonation id, the app shows a banner, and "Return to admin" ends it. Administrators cannot be impersonated. Everything is in `admin_impersonations` and the audit log.
6. **Jobs.** The worker runs `platform.event` (automations and Brevo sync per event), `campaign.send` (batches of 40), `brevo.sync_contact`, and `automations.scheduled` once a day (expires lapsed subscriptions after the grace period, then runs account-age, inactivity and expiry-reminder automations). System, Jobs shows and retries them.
7. **Checks.** `pnpm smoke:admin` runs every Control Center read model and the safe write paths against the database.

## Sign in with Google

1. In Google Cloud Console, create an OAuth client of type "Web application" (APIs and Services, Credentials). Under "Authorised redirect URIs" add `<APP_ORIGIN>/api/auth/google/callback`, for example `http://localhost:3000/api/auth/google/callback` locally and the https address in production. Under "Authorised JavaScript origins" add the origin itself.
2. Put the client id and secret in `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` and restart the server. `pnpm run doctor` reports "Sign in with Google is on".
3. The buttons appear on the sign-in and sign-up pages. A person who signs up with Google gets an account with no password and a verified email; their Google picture becomes their avatar. Someone who already has a password account with the same address is linked, not duplicated, and can use either from then on. A Google-only account can add a password through "Forgot your password?".
4. Sessions, audit and rate limits are the same as for passwords; `audit_events` records `method: google`.

## Secret rotation

- `APP_SECRET` signs cookies indirectly (session tokens are random and hashed in the DB) and signs short-lived media/file URLs. Rotating it invalidates outstanding 60-second URLs only.
- Database passwords: rotate `boardroom_app` and update `DATABASE_URL`; the pool reconnects on restart.

## Backup, and moving the database to Neon (or any hosted PostgreSQL)

The database is plain PostgreSQL, so `pg_dump` and `pg_restore` are the tools. Scripts wrap them so the result is Boredroom-ready.

### The one-step move

With the local app running (`pnpm dev`) and the PostgreSQL client tools installed (see step 1 below for the version note):

```
pnpm db:move "<owner connection string from the Neon dashboard>" --write-env
```

This backs up the local database to `var/backups`, restores it into the target (switching a Neon `-pooler` host to the direct host for the restore), creates the restricted `boardroom_app` role with a generated password, re-applies its grants, saves the old `.env.local` beside it and rewrites `DATABASE_ADMIN_URL` and `DATABASE_URL`. Restart `pnpm dev` and the app runs on the new database; the local copy is untouched. Without `--write-env` the two lines are printed instead. Steps 1 to 3 below are the same thing done by hand.

### 1. Back up

```
pnpm db:dump
```

Writes `var/backups/boredroom-<timestamp>.dump` (custom format, no owner or grant statements, so it restores under any role). It needs the `pg_dump` client tool at least as new as the server. The quickstart database is PostgreSQL 18, so:

- macOS: `brew install postgresql@18`, then `export PATH="$(brew --prefix postgresql@18)/bin:$PATH"` in the same terminal.
- Ubuntu/Debian: add the PostgreSQL apt repository and `sudo apt install postgresql-client-18`.

The script checks the versions and tells you exactly what to install if they do not match. `pnpm db:dump --sql` writes plain SQL instead.

### 2. Prepare Neon

1. Create a Neon project and a database (any name).
2. Copy the connection string from the dashboard; it looks like `postgres://<owner>:<password>@<host>.neon.tech/<db>?sslmode=require`. Either host works: the scripts switch a `-pooler` host to the direct one for the restore.

### 3. Restore

```
pnpm db:restore "postgres://<owner>:<password>@<host>.neon.tech/<db>?sslmode=require" var/backups/boredroom-<timestamp>.dump
```

The script creates the extensions, creates the restricted `boardroom_app` role (with a generated password, or pass `--app-password`), restores the dump in one transaction, re-applies the app role's grants, and prints the two `.env.local` lines to use:

- `DATABASE_ADMIN_URL` = the Neon owner connection string (migrations, seeding, dumps).
- `DATABASE_URL` = the same host with user `boardroom_app` (the app; row-level security applies to this role).

Copy those into `.env.local`, run `pnpm doctor`, then `pnpm dev`. Re-running the restore refreshes the target from a newer backup.

### What is not in the dump

- Files (evidence, voice notes, pictures) live in `var/storage`, not in the database. Copy that folder to the new machine, or set `STORAGE_PROVIDER` to a private bucket and upload the files there, keeping the same keys.
- Local mail-sink files in `var/mail-outbox` (development only).

### Notes for Neon specifically

- Extensions used (`btree_gist`, `citext`, `pgcrypto`) are available on Neon.
- Row-level security, `LISTEN/NOTIFY` (live updates) and the job queue work unchanged.
- Neon's pooled connection string (`-pooler` host) is fine for `DATABASE_URL`; the scripts use the direct host for `DATABASE_ADMIN_URL` and for the restore.
- A connection string pasted into a chat, ticket or screenshot is a leaked password: reset it in the Neon dashboard afterwards and update `.env.local`.
- Neon scales to zero when idle; the first request after a pause takes a second or two.
- If `boardroom_app` already existed on Neon before the restore (created in the Neon console rather than by the restore script), Neon manages its password: a password set with `ALTER ROLE` works until the compute restarts after idling, then Neon re-applies the console password and the app fails with "password authentication failed for user 'boardroom_app'". Durable fix: set the role's password in the Neon dashboard (Roles), put it in both `DATABASE_URL` and `RESTORE_APP_PASSWORD` in `.env.local`, and never set it by SQL again. With `RESTORE_APP_PASSWORD` set, `pnpm db:restore` and `pnpm db:move` leave an existing role's password alone and only re-apply the grants. A role the script creates itself does not have this problem.


## Workspaces per plan

A person may own one workspace on Free, five on Pro and any number on Enterprise (`plans.max_workspaces`, migration 0022; NULL means unlimited). The allowance follows the best plan among the workspaces they already own, so upgrading any one of their workspaces lifts it. `createOrganisation` refuses past the limit with a 403 that names the plan and the next plan up; `/app` shows "n of N workspaces owned on <plan>" and hides "Create another workspace" when full; `/onboarding` shows the same notice instead of the form. Edit the limits per plan in the Control Center under Plans (Limits › Workspaces), and they appear on the pricing section of the home page at once.


## Payments end to end

1. **Keys.** Control Center, Settings, Paystack: paste the test public and secret keys, press Test test key, save. Paste the live pair when the account is approved, test it, then move the switch to Live. Secrets are stored encrypted in `platform_settings.payments` and shown by their last four characters. `PAYSTACK_SECRET_KEY` in the environment is only a fallback for servers with nothing stored.
2. **Paystack dashboard.** Settings, API Keys and Webhooks: add the webhook URL shown on that page for both test and live. The callback URL is set per checkout by the app.
3. **Buying.** The home page pricing section lists every active plan (Plans in the Control Center). A visitor picks a plan and signs up; a signed-in person lands on Settings, Plan and billing, with the plan marked. Pay with Paystack opens Paystack's page; the callback verifies the reference and records the payment; the webhook records it again idempotently. A success activates the subscription for the interval paid and notifies the owners in the bell and by email.
4. **What the plan unlocks.** `resolveEntitlements` (server/lib/entitlements.ts) merges the plan's features, the organisation's overrides and the global flags into `ctx.plan`. Exports, the assistant, voice notes and the audit page check it on the server (402 PLAN_REQUIRED) and in the UI (hidden from the nav, an upgrade notice on the page). Seats follow `max_users` (402 SEATS_FULL on invite and join). A lapsed paid plan falls back to Free's entitlements after the grace period; nothing is deleted.
5. **Reminders.** The daily worker job notifies owners and HR in-app 14, 7, 3 and 1 days before the period ends and the day after it ends; the automations engine sends the matching emails. Owners also see a banner in the app in the last week, after a failed payment, and while lapsed.
