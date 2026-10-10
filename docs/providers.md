# External providers

Every external dependency sits behind an interface with a local adapter so the whole product runs and is tested without credentials. This page lists what a production deployment needs and where the adapter boundary is.

## Database (PostgreSQL / Supabase Postgres)

- Create a project; enable extensions `btree_gist`, `citext`, `pgcrypto`.
- Create the restricted role: `CREATE ROLE boardroom_app LOGIN PASSWORD '…' NOSUPERUSER NOBYPASSRLS;` Migration `0005_rls.sql` grants it table privileges.
- Set `DATABASE_ADMIN_URL` (migrations only, never in the web runtime) and `DATABASE_URL` (application role).
- Run `pnpm db:migrate` from CI or an operator machine. Keep development and production separate.
- Backups: enable point-in-time recovery; see `docs/runbooks.md` for the restore drill (and, for a backup from before phase 8, deleting the old recordings again).

## Authentication

Local adapter: `src/server/auth/index.ts` (email/password with scrypt, verification + recovery tokens, server-side sessions in `auth_sessions`). Rate limits are stored in `auth_rate_limits`.

Supabase Auth adapter (not implemented; documented path):
1. Keep `profiles.auth_user_id` as the join key to `auth.users.id`.
2. Replace `signUp/signIn/verifyEmail/requestPasswordRecovery/resetPassword/userFromSessionToken` with Supabase client calls; keep `getCurrentUser()` returning the same `CurrentUser` shape.
3. Configure redirect URLs (`/verify`, `/recover/reset`), email templates and SMTP in the Supabase dashboard.
4. Require MFA for owner/HR accounts before production (`auth_users.mfa_required` is reserved for this).

## Mail

Local: `MAIL_PROVIDER=sink` writes JSON files to `MAIL_SINK_DIR` (readable at `/dev/mail`). Nothing is delivered.

Verification, recovery and invitation messages all go through one interface (`src/server/lib/mail.ts`). Two real providers are built in: SMTP with Nodemailer (the default choice, set up below for Brevo) and Resend.

### SMTP with Brevo (`MAIL_PROVIDER=smtp`)

`SmtpMailProvider` sends through any SMTP relay with Nodemailer. For Brevo (formerly Sendinblue):

1. In Brevo, open **Senders & IP**. Add the sender address you will use as `MAIL_FROM` and confirm it from the verification email, or better, add and authenticate your domain (Brevo shows the DKIM and DMARC DNS records). Unauthenticated senders are delivered but land in spam more often.
2. Open **SMTP & API → SMTP** and create an **SMTP key**. Note the server (`smtp-relay.brevo.com`), the port (`587`) and the login, which is your Brevo account email unless the page shows a different one.
3. In `.env.local` (or the host's environment):
   ```
   MAIL_PROVIDER=smtp
   SMTP_URL=smtp://you%40yourdomain.com:xsmtpsib-…@smtp-relay.brevo.com:587
   MAIL_FROM="Boredroom <no-reply@yourdomain.com>"
   APP_ORIGIN=https://app.yourdomain.com
   ```
   The login and key live inside the URL, so URL-encode them: `@` becomes `%40`, `:` becomes `%3A`, `/` becomes `%2F`. Port 587 uses STARTTLS and the provider refuses to continue without it; `smtps://…:465` is also accepted. `APP_ORIGIN` matters because the links inside the emails are built from it.
4. Restart the app and run `pnpm run doctor` (the `mail` check reports the provider and any missing setting), then `pnpm mail:test you@example.com`: it logs in to the relay first, so a wrong key fails before anything is sent, then delivers one real message. `/dev/mail` is disabled once the provider is not `sink`.

Each message carries the header `X-Mailin-Tag` with its category (`verify_email`, `recover_password`, `invitation`, `test`), which Brevo shows as the tag in its transactional logs. Brevo's free plan caps daily sends (300 a day at the time of writing); verification and recovery mail is one message each, so that is plenty for a pilot.

### Resend (`MAIL_PROVIDER=resend`)

`ResendMailProvider` uses Resend's HTTP API with no SDK.

1. In the Resend dashboard, add your domain under Domains and create the DNS records it shows (SPF, DKIM, and the return-path CNAME). Wait for the domain to show "Verified". Resend only delivers from a verified domain; the free tier's `onboarding@resend.dev` sender can only reach your own account's address.
2. Create an API key (API Keys, "Sending access" is enough) and keep it with your secrets.
3. In `.env.local` (or the host's environment):
   ```
   MAIL_PROVIDER=resend
   RESEND_API_KEY=re_…
   MAIL_FROM="Boredroom <no-reply@yourdomain.com>"
   APP_ORIGIN=https://app.yourdomain.com
   ```
   `APP_ORIGIN` matters: the links inside verification, recovery and invitation emails are built from it.
4. Restart the app and run `pnpm run doctor` (the `mail` check reports the provider and any missing setting), then `pnpm mail:test you@example.com` to receive one real message. `/dev/mail` is disabled once the provider is not `sink`.

Each message carries a `category` tag (`verify_email`, `recover_password`, `invitation`, `test`) that shows in Resend's Emails view.

### Behaviour shared by both

Failures are explicit: a missing setting, a wrong key or an unverified sender makes the sign-up, recovery or invite request fail with the provider's own reason in the server log, rather than silently dropping the message. Sending happens inside the sign-up transaction, so a failed email rolls the sign-up back instead of leaving an account that can never be verified.

Another provider: implement `MailProvider.send` (and `verify` if it has a handshake) and add its name to `mail()` and `mailConfigProblem()` in `src/server/lib/mail.ts`.

## Object storage

Local: `STORAGE_PROVIDER=local` stores bytes under `STORAGE_LOCAL_DIR` (outside the web root). Keys are always server-generated and tenant-prefixed (`org/<id>/…`).

It holds evidence uploads, voice notes and pictures. Supabase private Storage: implement `StorageProvider` (`put/get/stream/size/delete/exists`) against a private bucket with the service-role key on the server only. Do not enable public access or CDN caching for the bucket; downloads always go through the app's signed 60-second URLs so deletion takes effect immediately. Set lifecycle rules so backups expire on a defined schedule.

## Malware scanning

`SCAN_PROVIDER=none` keeps uploaded files quarantined (`scan_status = pending`, downloads refused). For local demos set `SCAN_ALLOW_UNSCANNED=true` to mark them clean. For production implement `scanDeliverable` in `src/server/services/evidence.ts` against ClamAV or a scanning API and set `SCAN_PROVIDER=clamav`.

## Video calls: LiveKit Cloud

Calls (phase 8, owner decision, 8 October 2026) carry sound, video and screen share through LiveKit Cloud; ringing, missed calls, history and Brenda's notes are Boredroom's own. The only file that talks to LiveKit is `src/server/lib/livekit.ts`: it signs tokens locally and lists, inspects and deletes rooms. It never creates ingress, egress, SIP or recordings, and never configures webhooks.

- `LIVEKIT_URL`: the project's `wss://…livekit.cloud` address.
- `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`: from the project's Settings → Keys. Server only; never in the browser, never committed.
- Without the three, calls are off and every surface says so; `pnpm run doctor` and `/api/health` report it (never the values).
- HTTPS is needed for camera, microphone and screen share (`http://localhost` is the one exception browsers allow).
- What leaves the app: each call's sound and video go to LiveKit only to reach the people on that call; nothing is recorded or stored there (no egress, no recording). Brenda's notes are written on each consenting person's own device; only text reaches Boredroom's server, and no audio is sent to any speech service.
- Plan: the free Build plan stops at 5,000 participant minutes a month; see `docs/runbooks.md`, "Calls: checking LiveKit".
- The webhook (production, optional but recommended; fix review, 10 October 2026): LiveKit cannot revoke a join token, so Boredroom's last 2 minutes and anyone in a call's room without a place in the call is taken out. The heartbeats and the worker do it within seconds anyway; registering `https://<host>/api/livekit/webhook` (`docs/runbooks.md`, "Registering the LiveKit webhook in production") does it the moment they connect.

## Hosting

- Web: any Node 22 host. Set `APP_ORIGIN` to the public HTTPS origin (used for links and the same-origin check). Set a strong `APP_SECRET`.
- Worker: a separate long-running process with the same environment variables. Only one worker is needed for the pilot; more can run concurrently (jobs use `FOR UPDATE SKIP LOCKED`).
- HTTPS is required for calls: camera, microphone and screen share (`getUserMedia` and `getDisplayMedia` only work in secure contexts).

## Monitoring

Wire `console.error` output from the API wrapper (`[requestId]` prefixed) and the worker into your error reporter with PII scrubbing. Watch: job backlog (`jobs` where state = 'pending'), dead jobs, stale sessions (`work_sessions.state = 'interrupted'`), storage bytes, calls left live (`calls.state <> 'ended'` older than 4 hours), call minutes against the LiveKit plan, and call transcripts older than 7 days after their recap.
