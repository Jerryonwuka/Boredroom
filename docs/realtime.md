# Letting the database sleep (realtime plan)

Neon's Free plan gives 100 compute-hours a month, and a compute stops counting only after **5 minutes with no query**.
Until 22 October 2026 something always queried production within 5 minutes, day and night, and the allowance ran out.
The plan (approved 23 October 2026) first makes polling quiet (phases 0–2), then adds push from the Fly machine
(phases 3–6). This page records what each phase changed in the code, how to check it, and how to undo it.

## Phase 0: restore and stop the worst (owner request, 23 October 2026)

### 1. Development never touches production

- `pnpm dev` (`scripts/dev.ts`) refuses to start when `DATABASE_URL`, `DATABASE_ADMIN_URL` or `DATABASE_LISTEN_URL`
  points at a database that isn't on this machine. The message says how to move to the local database:
  `pnpm quickstart` the first time (PostgreSQL in `./var/pgdata` on port 54329, `scripts/local-pg.ts`), or point
  `.env.local` at `localhost:54329/boardroom` and keep the hosted lines in a note outside the repository.
- `BOREDROOM_DEV_REMOTE_DB=1 pnpm dev` runs the web app against the remote database anyway, **never with the worker**.
  Every page left open keeps that database awake; close them when you finish.
- The worker (`worker/index.ts`) refuses a database that isn't on this machine whenever `NODE_ENV` isn't `production`.
  Fly sets `NODE_ENV=production` in `Dockerfile.worker`, so production is unaffected. A laptop's `pnpm worker` against
  Neon stops with the same instructions.
- "On this machine": `localhost`, `127.x.x.x`, `::1`, `*.localhost`, or a Unix socket. The rules are in
  `src/server/lib/db-guard.ts` and never print a URL.

### 2. The live-updates listener closes when nobody listens

`src/server/lib/notify-bus.ts` holds one `LISTEN` connection per process for the event stream. It now closes that
connection when the last subscriber leaves, re-opens a dropped connection only while there are subscribers, and stops
its retry loop as soon as they have all gone. Before, a connection Neon closed while suspending was re-opened for
nobody, which woke Neon again. The event stream route (`src/app/api/orgs/[org]/events/route.ts`) listens for the
browser leaving before it subscribes and checks again once the subscribe returns, so a tab closed while the
connection is still opening (seconds after a Neon suspend) leaves no subscriber behind (fix review, 23 October 2026).

### 3. Quiet heartbeats (migration 0062, in `db/pending`)

A running timer's heartbeat (every 30 seconds) updated `work_sessions`, whose trigger refreshed every visible page in the
organisation. `db/pending/0062_quiet_heartbeats.sql` splits the trigger: a notification on insert, and on update only
when `state` or `version` changes (start, pause, resume, stop, interruption). It waits in `db/pending` until the owner's
go-ahead; nothing in the code depends on it. To apply: move it into `db/migrations` and run the usual migration.
To undo: re-create the old trigger (`CREATE TRIGGER work_sessions_notify AFTER INSERT OR UPDATE ON work_sessions FOR
EACH ROW EXECUTE FUNCTION notify_org_change();` after dropping both new ones).

### 4. Worker night mode (a bridge until phase 1)

The worker (`worker/loop.ts`, `worker/night.ts`, `worker/runner.ts`) works out the **widest working window** across
active organisations and their people's own schedules: start − 90 minutes to end + 60 minutes on each schedule's working
days; the whole day is outside on other days.

- **Inside a window:** as before. A job claim every `WORKER_POLL_INTERVAL_MS` (2 s), the maintenance block every
  `WORKER_MAINTENANCE_MS` (15 s).
- **Outside every window, nobody active:** one claim-and-maintenance pass, then a sleep until the earliest of the next
  pending job's `next_run_at`, the next unsent reminder's `remind_at`, the next routine run or quiet-hours hold, the next
  follow-up deadline or mention Confirm running out, the next window start, and `WORKER_NIGHT_MAX_SLEEP_MIN` (60). That
  is at most one pass an hour with nothing due. Only times still ahead count, so one row left past due never hides a
  later one; something that came due in the last 10 minutes and is still waiting after a pass brings the next pass 30
  seconds later (anything older waits for the hourly pass, so a row that never clears can't keep Neon awake). Each
  night pass queues Brenda's reminder tick under a key of its own, so a pass that woke for a reminder sends it (fix
  review, 23 October 2026).
- **Outside every window, someone active** (a session seen in the last 10 minutes when a pass runs): the day cadence,
  because the database is awake for them anyway.
- **Outside every window, always:** Brenda's tick sends due reminders only (no nudges), and the LiveKit room listing and
  `connector.sweep` aren't queued. The hourly safety nets still run, in the pass.
- Every night pass logs why it woke and when it wakes next, for example
  `[worker] night pass (max): ran 9 job(s); next at 2026-10-24T03:00:00.000Z (max)`. No ids, no addresses.
- A stop signal cuts a night sleep short, so a deploy never waits an hour.

Known cost of the bridge (stated plainly after the fix review, 23 October 2026): nothing wakes a sleeping worker. Activity
is checked only at a pass, so someone who starts using Boredroom during a night sleep is noticed at the next pass, up
to `WORKER_NIGHT_MAX_SLEEP_MIN` later; until then every job the app queues for them waits too (a call recap, a ring's
timeout, a connector post, a mention's reply, a deliverable scan, voice history). A ring's timeout also settles when
it is read, so a caller isn't left ringing. The call sweep's time-based closes (alone for 15 minutes, the 4-hour cap)
run at the passes. Phase 1 replaces this with wake-ups from the app. If the wait is too long before then, lower
`WORKER_NIGHT_MAX_SLEEP_MIN` (each night wake keeps Neon running for about 5 minutes, so 15 costs about four times
the compute of 60).

| Setting | Default | What it does |
|---|---|---|
| `WORKER_POLL_INTERVAL_MS` | 2000 | The job claim's cadence inside a window |
| `WORKER_MAINTENANCE_MS` | 15000 | The maintenance block's cadence inside a window (hard-coded before 23 October 2026) |
| `WORKER_NIGHT_MAX_SLEEP_MIN` | 60 | The longest night sleep, in minutes (decimals allowed) |

To undo night mode without a deploy of older code: set `WORKER_NIGHT_MAX_SLEEP_MIN` to a small value (for example
`0.05`, three seconds), which brings back near-day cadence outside the windows.

### 5. Webhooks verify before the database

- Connected apps (`src/server/connectors/webhooks.ts`): the signature is checked before any database work. Slack,
  GitHub, Linear and Jira have their secrets in the environment and never touch the database for a delivery that
  doesn't verify. Asana's secret is per hook and stored: its delivery's shape (a 64-hex signature, a body) is checked
  first, and only a well-formed one looks the secret up.
- Paystack: the signature's shape and a JSON body with an `event` first, then `PAYSTACK_SECRET_KEY`, and only then the
  keys stored in the Control Center (which need the database).
- Resend inbound and LiveKit already verified with environment secrets first.
- The `schema0061Ready` guards are gone: 0061 is applied wherever this code runs. A database without it (one restored
  to before it) is still handled: a query that fails for want of its tables is noted (`src/server/lib/schema-0061.ts`)
  and the old fallbacks hold for ten minutes at a time ("Connected apps need a database update first.", 503
  `CONNECTORS_NOT_READY`, no "From your apps", a webhook answered 200 and dropped).

Check: an unsigned delivery to any webhook route answers 401 and sends no query (`tests/unit/webhooks-verify-first.test.ts`).

### 6. Wake tags

Public routes and webhook routes log one word when a request is about to reach the database, so Vercel's logs tell bots
from people and say what woke Neon at night:

| Tag | Routes |
|---|---|
| `[wake] auth` | `/api/auth/*` (sign-in, sign-up, verify, resend, recover, reset, sign-out and status with a session, Google's callback) |
| `[wake] waitlist` | `/api/waitlist` |
| `[wake] invite` | `/api/invitations/accept` |
| `[wake] join` | `/api/join/accept` |
| `[wake] link` | `/api/desktop/link`, `/link/poll`, `/link/approve` |
| `[wake] webhook:<provider>` | connector webhooks, `webhook:paystack`, `webhook:resend`, `webhook:livekit` |

Only the tag is logged: never an address, an id, an email, a token or a body. A request refused by its own checks
before the database (a malformed body, a bad signature) logs nothing.

### Go/no-go after phase 0

- Production answers; `SELECT locked_by, max(locked_at) FROM jobs GROUP BY 1` shows one worker host (Fly).
- With 0062 applied, a running timer no longer refreshes pages every 30 seconds.
- An unsigned webhook gets 401 with no database query.
- At night the worker logs at most one pass an hour (`[worker] night pass …`).

### The owner's steps for phase 0

Section 7 of the plan; in short: bring Neon back (Launch, or wait for the reset), move `.env.local` to the local
database, `fly scale count 1 -a boredroom-worker`, Vercel firewall rate limits on `/api/auth/*`, `/api/waitlist*`,
`/api/invitations/*`, `/api/join/*` and `/api/desktop/link*`, and make sure no uptime monitor calls `/api/health`.

**The Vercel firewall rules** (fix review, 23 October 2026). Vercel › the project › Firewall › Configure › New rule; each
one "Rate limit", fixed window of 60 seconds, keyed on the IP address, follow-up action "Too many requests (429)". Put
them in this order (the first match wins). Two paths are polled by the app itself, so they get a higher limit: the
"check your inbox" page asks `/api/auth/status` every 5 seconds (12 a minute per tab), and the Mac app asks
`/api/desktop/link/poll` every 3 seconds while it links (20 a minute).

| # | Rule name | If the request path… | Limit per IP per 60 s |
|---|---|---|---|
| 1 | Polled auth and link | equals `/api/auth/status`, or equals `/api/desktop/link/poll` | 60 |
| 2 | Sign-in and accounts | starts with `/api/auth/` | 20 |
| 3 | Waitlist | starts with `/api/waitlist` | 5 |
| 4 | Invitations and joins | starts with `/api/invitations/`, or starts with `/api/join/` | 10 |
| 5 | Mac linking | starts with `/api/desktop/link` | 10 |

Rule 2 doesn't catch the paths of rule 1 because rule 1 comes first; if your plan evaluates rate limits independently,
add "and the path does not equal `/api/auth/status`" to rule 2 and "does not equal `/api/desktop/link/poll`" to rule 5.
Bot protection: turn it on in **Log** mode first. Before switching it to challenge, add a "Bypass" rule above it for the
paths machines call, which can't answer a challenge: `/api/connectors/webhooks/`, `/api/billing/paystack/webhook`,
`/api/inbound/resend`, `/api/livekit/webhook`, and `/api/desktop/` (the Mac app). Check which rule types your Vercel plan
includes; on a plan with a single rate-limit rule, keep rule 2 (sign-in is what bots try most).
