# Runbooks

## Backup and restore

1. Take a logical backup: `pg_dump --format=custom "$DATABASE_ADMIN_URL" > boredroom-$(date +%F).dump`.
2. Restore into a fresh database: `pg_restore --no-owner --role=boardroom_owner -d "$RESTORE_URL" boredroom.dump`.
3. Re-apply deletion tombstones before opening access: media whose recording rows have `deleted_at` set, or whose ids appear in `deletion_tombstones`, must be deleted again from the restored object store. Run:
   ```sql
   SELECT subject_id, storage_keys FROM deletion_tombstones;
   SELECT id FROM recordings WHERE deleted_at IS NOT NULL OR restricted_at IS NOT NULL OR expires_at < now();
   ```
   and delete every listed key from storage. Only then point the application at the restored database.
4. Verify: `pnpm db:migrate` reports "up to date"; a sample user can sign in; `SELECT count(*) FROM audit_events` matches the backup.

Restore drill status: performed locally against the seeded development database (dump → restore into `boardroom_test` → tombstone query). A production drill with real object storage is a launch prerequisite.

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
