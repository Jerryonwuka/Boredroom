# Runbooks

## Slow pages

Page time is almost all database round trips, not rendering (the dev log prints both: `next.js` is render, `application-code` is data). Every transaction costs one round trip to open (BEGIN plus the identity settings, sent as one statement), one per query, one to commit. Measure the round trip first:

```bash
node -e 'const{Client}=require("pg");const c=new Client({connectionString:process.env.DATABASE_URL});(async()=>{await c.connect();for(let i=0;i<3;i++){const t=Date.now();await c.query("select 1");console.log(Date.now()-t,"ms")}await c.end()})()'
```

Under 5 ms means the app and database share a region and pages should render in well under a second. Around 200 ms or more means they are far apart (for example a laptop in Lagos against Neon in US East): a page that makes ten round trips takes two seconds before any work happens. The fix for that is placement, not code: host the app in the database's region, or choose a Neon region near the people who use it. The code keeps round trips low (the shell is one statement, the dashboard two, the attendance board one), and `keepAlive` on the pool stops idle connections being dropped, which otherwise shows up as `read ETIMEDOUT` in the log and a slow reconnect on the next page.

## Backup and restore

Use the scripts: `pnpm db:dump` to back up, `pnpm db:restore "<url>" <file>` to restore anywhere (see "Backup, and moving the database to Neon" below for the full procedure and the version requirement for `pg_dump`).

After restoring a backup that is older than the live data, re-apply deletion tombstones before opening access: media whose recording rows have `deleted_at` set, or whose ids appear in `deletion_tombstones`, must be deleted again from the restored object store. Run:
```sql
SELECT subject_id, storage_keys FROM deletion_tombstones;
SELECT id FROM recordings WHERE deleted_at IS NOT NULL OR restricted_at IS NOT NULL OR expires_at < now();
```
and delete every listed key from storage. Only then point the application at the restored database.

Restore drill status: `pnpm db:dump` → `pnpm db:restore` into a fresh database was verified on PostgreSQL 16 (18 September 2026): identical table, policy, trigger and function counts, and row-level security enforced on the copy. A production drill with real object storage is a launch prerequisite.

## Retention

- The worker enqueues `recording.retention_delete` for each recording whose `expires_at` has passed (deduplicated per recording).
- The handler deletes chunks, assembled media and derivatives, marks chunks `deleted`, writes a `deletion_tombstones` row and sets `upload_state = 'deleted'`. It is idempotent; re-running it is safe.
- Playback is refused at `expires_at` even before the worker runs (`authorisePlayback` and `/api/media/[token]` check live state).
- Lag check: `SELECT count(*) FROM recordings WHERE expires_at < now() AND deleted_at IS NULL;` should be zero within minutes of expiry when the worker is healthy.

## Worker health

- Pending backlog: `SELECT type, count(*) FROM jobs WHERE state = 'pending' GROUP BY type;`
- Dead jobs: `SELECT id, type, last_error FROM jobs WHERE state = 'dead';` Fix the cause, then `UPDATE jobs SET state = 'pending', attempts = 0 WHERE id = '…';`
- A job locked for more than 15 minutes is automatically returned to `pending` by the worker.

## Stale sessions

- Sessions without heartbeats for longer than the policy's `stale_after_seconds` (default 90) are interrupted at the last heartbeat by the worker. Nothing after that instant is credited.
- The employee sees "Session interrupted" and can resume (new interval) and file a time correction for the gap. Managers see the correction in Reviews.

## Offboarding

People → Offboard. Effects: membership revoked (new requests and live channels denied), open session interrupted at its last confirmed boundary, recording grants revoked, sign-in sessions revoked if the person has no other active workspace, audit event written. Historical work is retained.

## Sign in with Google

1. In Google Cloud Console, create an OAuth client of type "Web application" (APIs and Services, Credentials). Under "Authorised redirect URIs" add `<APP_ORIGIN>/api/auth/google/callback`, for example `http://localhost:3000/api/auth/google/callback` locally and the https address in production. Under "Authorised JavaScript origins" add the origin itself.
2. Put the client id and secret in `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` and restart the server. `pnpm run doctor` reports "Sign in with Google is on".
3. The buttons appear on the sign-in and sign-up pages. A person who signs up with Google gets an account with no password and a verified email; their Google picture becomes their avatar. Someone who already has a password account with the same address is linked, not duplicated, and can use either from then on. A Google-only account can add a password through "Forgot your password?".
4. Sessions, audit and rate limits are the same as for passwords; `audit_events` records `method: google`.

## Secret rotation

- `APP_SECRET` signs cookies indirectly (session tokens are random and hashed in the DB) and signs short-lived media/file URLs. Rotating it invalidates outstanding 60-second URLs only.
- Database passwords: rotate `boardroom_app` and update `DATABASE_URL`; the pool reconnects on restart.

## Incident: sensitive footage flagged

1. The employee flags a recording; ordinary reviewer playback is denied immediately (`restricted_at`).
2. A privacy administrator (an explicit `privacy_admin` grant) opens Reviews → Privacy incidents and chooses Delete or Release with a note. Both are audited.
3. Deletion runs through the same worker job as retention.

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

- Recording video files live in `var/storage`, not in the database. Copy that folder to the new machine, or set `STORAGE_PROVIDER` to a private bucket and upload the files there, keeping the same keys.
- Local mail-sink files in `var/mail-outbox` (development only).

### Notes for Neon specifically

- Extensions used (`btree_gist`, `citext`, `pgcrypto`) are available on Neon.
- Row-level security, `LISTEN/NOTIFY` (live updates) and the job queue work unchanged.
- Neon's pooled connection string (`-pooler` host) is fine for `DATABASE_URL`; the scripts use the direct host for `DATABASE_ADMIN_URL` and for the restore.
- A connection string pasted into a chat, ticket or screenshot is a leaked password: reset it in the Neon dashboard afterwards and update `.env.local`.
- Neon scales to zero when idle; the first request after a pause takes a second or two.
- If `boardroom_app` already existed on Neon before the restore (created in the Neon console rather than by the restore script), Neon manages its password: a password set with `ALTER ROLE` works until the compute restarts after idling, then Neon re-applies the console password and the app fails with "password authentication failed for user 'boardroom_app'". Durable fix: set the role's password in the Neon dashboard (Roles), put it in both `DATABASE_URL` and `RESTORE_APP_PASSWORD` in `.env.local`, and never set it by SQL again. With `RESTORE_APP_PASSWORD` set, `pnpm db:restore` and `pnpm db:move` leave an existing role's password alone and only re-apply the grants. A role the script creates itself does not have this problem.
