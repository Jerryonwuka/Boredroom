# External providers

Every external dependency sits behind an interface with a local adapter so the whole product runs and is tested without credentials. This page lists what a production deployment needs and where the adapter boundary is.

## Database (PostgreSQL / Supabase Postgres)

- Create a project; enable extensions `btree_gist`, `citext`, `pgcrypto`.
- Create the restricted role: `CREATE ROLE boardroom_app LOGIN PASSWORD '…' NOSUPERUSER NOBYPASSRLS;` Migration `0005_rls.sql` grants it table privileges.
- Set `DATABASE_ADMIN_URL` (migrations only, never in the web runtime) and `DATABASE_URL` (application role).
- Run `pnpm db:migrate` from CI or an operator machine. Keep development and production separate.
- Backups: enable point-in-time recovery; see `docs/runbooks.md` for the restore drill and tombstone re-application.

## Authentication

Local adapter: `src/server/auth/index.ts` (email/password with scrypt, verification + recovery tokens, server-side sessions in `auth_sessions`). Rate limits are stored in `auth_rate_limits`.

Supabase Auth adapter (not implemented; documented path):
1. Keep `profiles.auth_user_id` as the join key to `auth.users.id`.
2. Replace `signUp/signIn/verifyEmail/requestPasswordRecovery/resetPassword/userFromSessionToken` with Supabase client calls; keep `getCurrentUser()` returning the same `CurrentUser` shape.
3. Configure redirect URLs (`/verify`, `/recover/reset`), email templates and SMTP in the Supabase dashboard.
4. Require MFA for owner/HR accounts before production (`auth_users.mfa_required` is reserved for this).

## Mail

Local: `MAIL_PROVIDER=sink` writes JSON files to `MAIL_SINK_DIR` (readable at `/dev/mail`).

Production: implement `MailProvider.send` in `src/server/lib/mail.ts` for your SMTP/API provider and set `MAIL_PROVIDER=smtp`, `SMTP_URL`, `MAIL_FROM`. Invitation, verification and recovery messages already go through this interface; nothing is sent unless an administrator clicks Invite.

## Object storage

Local: `STORAGE_PROVIDER=local` stores bytes under `STORAGE_LOCAL_DIR` (outside the web root). Keys are always server-generated and tenant-prefixed (`org/<id>/…`).

Supabase private Storage: implement `StorageProvider` (`put/get/stream/size/delete/exists/concat`) against a private bucket with the service-role key on the server only. Do not enable public access or CDN caching for the bucket; playback and downloads always go through the app's signed 60-second URLs so restriction and deletion take effect immediately. Set lifecycle rules so backups of media expire on a defined schedule.

## Malware scanning

`SCAN_PROVIDER=none` keeps uploaded files quarantined (`scan_status = pending`, downloads refused). For local demos set `SCAN_ALLOW_UNSCANNED=true` to mark them clean. For production implement `scanDeliverable` in `src/server/services/evidence.ts` against ClamAV or a scanning API and set `SCAN_PROVIDER=clamav`.

## Media processing

The worker assembles chunked WebM/MP4 recordings by concatenating chunks from one recorder instance and validating the container header. No transcoding is performed; browsers play the assembled WebM directly. If you need MP4 derivatives, add an ffmpeg step in `assembleRecording` (worker environment must ship ffmpeg).

## Hosting

- Web: any Node 22 host. Set `APP_ORIGIN` to the public HTTPS origin (used for links and the same-origin check). Set a strong `APP_SECRET`.
- Worker: a separate long-running process with the same environment variables. Only one worker is needed for the pilot; more can run concurrently (jobs use `FOR UPDATE SKIP LOCKED`).
- HTTPS is required for screen capture (`getDisplayMedia` only works in secure contexts).

## Monitoring

Wire `console.error` output from the API wrapper (`[requestId]` prefixed) and the worker into your error reporter with PII scrubbing. Watch: job backlog (`jobs` where state = 'pending'), dead jobs, upload failures (`recordings.upload_state = 'failed'`), stale sessions (`work_sessions.state = 'interrupted'`), storage bytes, retention lag (`recordings.expires_at < now() AND deleted_at IS NULL`).
