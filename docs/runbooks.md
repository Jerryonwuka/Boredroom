# Runbooks

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

## Secret rotation

- `APP_SECRET` signs cookies indirectly (session tokens are random and hashed in the DB) and signs short-lived media/file URLs. Rotating it invalidates outstanding 60-second URLs only.
- Database passwords: rotate `boardroom_app` and update `DATABASE_URL`; the pool reconnects on restart.

## Incident: sensitive footage flagged

1. The employee flags a recording; ordinary reviewer playback is denied immediately (`restricted_at`).
2. A privacy administrator (an explicit `privacy_admin` grant) opens Reviews → Privacy incidents and chooses Delete or Release with a note. Both are audited.
3. Deletion runs through the same worker job as retention.

## Backup, and moving the database to Neon (or any hosted PostgreSQL)

The database is plain PostgreSQL, so `pg_dump` and `pg_restore` are the tools. Two scripts wrap them so the result is Boredroom-ready.

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
2. Copy the connection string from the dashboard; it looks like `postgres://<owner>:<password>@<host>.neon.tech/<db>?sslmode=require`. Use the direct (non-pooled) host for the restore.

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
- Neon's pooled connection string (`-pooler` host) is fine for `DATABASE_URL`; use the direct host for `DATABASE_ADMIN_URL` and for the restore.
- Neon scales to zero when idle; the first request after a pause takes a second or two.
