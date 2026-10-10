# Boredroom

Boredroom helps organisations understand what remote employees plan to do, what they report working on, what they deliver, and what their managers accept. Task planning, work sessions, evidence, confirmed time and review live in one workflow, and Brenda, an AI teammate, sends each team lead an end-of-day report of what the team did. Multiple isolated organisations are supported from the first release.

> Timers, heartbeats, mouse movement and logins are never treated as proof of productivity. Unlogged or uncertain work leads to a clarification request, not an automatic penalty.

The product specification is in [`BOARDROOM_BUILD_SPEC.md`](./BOARDROOM_BUILD_SPEC.md). Build status, decisions and evidence are tracked in [`BUILD_PROGRESS.md`](./BUILD_PROGRESS.md).

## Stack

| Layer | Choice |
| --- | --- |
| Web | Next.js 16 (App Router, TypeScript), Tailwind CSS 4, hand-written shadcn-style components, Manrope + Cal Sans (self-hosted via Fontsource) |
| Database | PostgreSQL 16 with SQL migrations, composite tenant foreign keys, row-level security, `btree_gist` exclusion constraint for non-overlapping intervals |
| Auth | Local email/password adapter (scrypt, verification, recovery, server sessions). Supabase Auth adapter path documented in `docs/providers.md` |
| Realtime | Server-sent events fed by PostgreSQL `LISTEN/NOTIFY` (`/api/orgs/:org/events`); reconnect triggers an authoritative refetch |
| Storage | Private object storage behind an interface; local filesystem adapter under `var/storage`; files served only through 60-second signed URLs |
| Mail | Interface with a local sink (`var/mail-outbox`, readable at `/dev/mail`) for development; SMTP via Nodemailer (`MAIL_PROVIDER=smtp`, set up for Brevo) or Resend (`MAIL_PROVIDER=resend`) for real delivery; `pnpm mail:test <address>` sends one test message |
| Worker | Separate Node process (`pnpm worker`) on a PostgreSQL durable job queue (`SKIP LOCKED`, bounded exponential backoff, dead-letter state) |
| Tests | Vitest unit + integration tests against a real PostgreSQL database using the restricted application role; Playwright end-to-end |

## Local setup

### Fastest: no PostgreSQL install needed

```bash
pnpm install
pnpm quickstart        # add --worker to also run the background worker
```

After the first run, `pnpm dev` also starts that database automatically, so either command works. `pnpm quickstart` starts a self-contained PostgreSQL (downloaded as a dev dependency, data in `var/pgdata`), writes `.env.local`, creates roles and databases, applies migrations, seeds the two demo companies, runs the health check and starts the web app on http://localhost:3000. Sign in with `ada@company-a.test` / `correct-horse-battery`.

### Using your own PostgreSQL 16

Requirements: Node 22, pnpm 10, PostgreSQL 16 with the `btree_gist`, `citext` and `pgcrypto` extensions.

```bash
pnpm install
pnpm first-run        # writes .env.local, creates roles/databases/extensions, migrates, seeds, runs pnpm doctor
pnpm dev              # web app on http://localhost:3000
pnpm worker           # in a second terminal: heartbeat recovery, reminders, routines, call sweeps, Brenda's call recaps
```

`pnpm first-run` connects to PostgreSQL as a superuser using `PG_SUPERUSER_URL` (default `postgres://postgres:postgres@localhost:5432/postgres`); set that variable if your local superuser or password differs. The manual equivalent is:

```bash
cp .env.example .env.local            # then set APP_SECRET (openssl rand -base64 32)
psql -U postgres <<'SQL'
CREATE ROLE boardroom_owner LOGIN PASSWORD 'boardroom_owner' SUPERUSER;
CREATE ROLE boardroom_app LOGIN PASSWORD 'boardroom_app' NOSUPERUSER NOBYPASSRLS;
CREATE DATABASE boardroom OWNER boardroom_owner;
CREATE DATABASE boardroom_test OWNER boardroom_owner;
SQL
for db in boardroom boardroom_test; do
  psql -U postgres -d $db -c "CREATE EXTENSION IF NOT EXISTS btree_gist; CREATE EXTENSION IF NOT EXISTS citext; CREATE EXTENSION IF NOT EXISTS pgcrypto;"
done
pnpm db:migrate && pnpm db:seed
```

`boardroom_owner` is only used by migrations and seeding. Every web and worker query runs as `boardroom_app`, which cannot bypass row-level security. Identity is bound per transaction with `SET LOCAL app.user_id`; the worker sets `app.role = 'worker'` and validates organisation relationships explicitly.

### Seeded accounts

| Workspace | Owner | HR | Manager | Employees |
| --- | --- | --- | --- | --- |
| `company-a` | owner@company-a.test | mary@company-a.test | david@company-a.test | ada@company-a.test, ben@company-a.test |
| `company-b` | owner@company-b.test | mary@company-b.test | david@company-b.test | ada@company-b.test, ben@company-b.test |

All passwords: `correct-horse-battery`. Company A has a "Website relaunch" project with a homepage design task (Figma-link deliverable expected) and a client meeting task assigned to Ada, reviewed by David.

### Where files live

Evidence uploads, voice notes and pictures are kept under `var/storage/org/<organisation>/…` (or the configured private bucket), never in the database. Copy that folder with a database backup. Calls are never stored anywhere (see Calls below).

### After `git pull`

Run `pnpm dev` as usual: it installs any packages a pull added and applies new database migrations before starting. If you start Next.js some other way and see "Module not found: Can't resolve …", run `pnpm install` first.

### If sign-up or sign-in shows "Something went wrong"

Run `pnpm doctor` in the project folder, or open `http://localhost:3000/api/health`. Both report whether the database is reachable as `boardroom_app`, whether all migrations are applied, and whether the storage and mail-sink directories are writable. In development the error banner also includes the underlying message. Typical fixes: start PostgreSQL, create the two roles, run `pnpm db:migrate`, or set `DATABASE_URL`/`APP_SECRET` in `.env.local`.

## Scripts

| Command | Purpose |
| --- | --- |
| `pnpm dev` / `pnpm build` / `pnpm start` | Next.js |
| `pnpm worker` | Background worker |
| `pnpm db:migrate`, `pnpm db:reset`, `pnpm db:seed`, `pnpm db:setup` | Database lifecycle (`--test` targets the test database) |
| `pnpm test` | Unit + integration tests (rebuilds `boardroom_test` per file) |
| `pnpm test:e2e` | Playwright end-to-end tests (starts a dev server on port 3100 against the test database) |
| `pnpm db:dump`, `pnpm db:restore`, `pnpm db:move "<url>" --write-env` | Back up, restore, or move the database to a hosted PostgreSQL such as Neon in one step (see `docs/runbooks.md`) |
| `pnpm lint`, `pnpm typecheck`, `pnpm check` | Static checks |

## Repository layout

```
db/migrations        SQL migrations (schema, constraints, RLS policies, grants)
db/scripts           migrate.ts, seed.ts
src/app              routes: (auth), onboarding, app/[workspace]/*, api/*
src/server/auth      local auth provider
src/server/db        pool + per-request RLS context (withUser / withSystem / withWorker)
src/server/lib       api wrapper (errors, idempotency, origin check), crypto, time, mail, storage
src/server/services  orgs, tasks, sessions, evidence, reports, calls, call-notes, views, fixtures
src/components       UI kit (ui/), app components (timer, calls, forms)
worker               job loop, handlers, scheduler
tests                unit + integration (Vitest); e2e (Playwright)
docs                 providers, runbooks, walkthrough
```

## Account types

- **Organisation account**: created at `/signup?intent=org`, then `/onboarding`. Owners and HR land on the organisation dashboard, create teams, appoint team leads and share the organisation's join code or link from People. Organisation accounts supervise only: they cannot hold tasks or run timers.
- **Staff account**: can only be created on the way into an organisation, via `/join` (code), `/join/[code]` (link) or `/invite/[token]` (email invitation). Team leads land on their team board; staff land on My Day, where a to-do is one line of text and Start is one click.

## The Workroom

Owners, HR and team leads open **Workroom** to see everyone who has clocked in today: status (Active, Paused, Off the clock, Not started), the task they are on with a live clock, an orange "On a call" badge while they are in a call (never which call), and today's totals. Click a person for every task and session of their day. Status is derived from timers only.

## Clocking in and out

Everyone, staff, team leads, owner and HR, clocks in and out from **Clock in** in the sidebar (staff also get a one-line prompt at the top of My Day until they have clocked in). The organisation sets the day in Settings under Working schedule and clocking: clock-in time, clock-out time, a grace period in minutes, all in the organisation's time zone. A clock-in after the start plus grace is recorded as late by the difference; leaving before the end is noted, not penalised. Clocking out is refused while a task timer runs. Owners, HR and team leads open **Attendance** for any day (a date picker and previous/next links) with tabs for Clocked in, Not clocked in and Clocked out, or switch to the Month view: a row per person, a green or amber dot per day, and totals for days in, late arrivals and missed working days. The dashboard lists only the people who have clocked in today; the list starts empty every day. Each person can browse their own past months on Clock in. The schedule in force at clock-in is stored on the record, so changing the schedule later never rewrites history.

## Tasks

**Tasks** in the sidebar is the assignment board. A team lead or an organisation account presses Add new task, writes what needs doing, picks someone on their team, themself, another team lead, or the owner or HR (work can be handed sideways or upwards), sets a priority, due date and estimate, and the person is notified. The lead's page lists every task on their teams with tabs for To do, Sent for check and Done, a person filter, and an "Ask for an update" link into Messages. Staff see "Your tasks": everything assigned to them, by their lead or by themselves; Start on a row starts the clock and opens My Day (or switches a running timer to that task). Organisation accounts see every task in the organisation; anything handed to them carries a Mark done button (they do not run timers), and Done goes back to the lead for a check.

## Messages

People in an organisation message each other from **Messages** in the sidebar: a direct thread with anyone (in your team or not), a channel per team, and an "Everyone" channel for the whole organisation. A message can point at a task: "Ask for an update" on a person's Workroom page, a task page or a People row opens the thread with the task attached and "How far with …?" ready to send. Threads update live over the existing event stream, the sidebar badge counts unread messages, and a direct message also lands in the recipient's notifications. Only the two people in a direct thread can read it (not the team lead, not the owner); team channels are readable by team members only; nothing crosses organisations. Senders can withdraw their own messages.

## Calls

Screen recording for tasks was taken out in phase 8 (owner decision, 8 October 2026) and replaced by calls: one-to-one in a direct thread, a group call from a named channel, and the team call from a team channel, on every plan. Anyone can call the people they can already message; owners, HR and team leads get no extra access to anyone's calls. One global safety cap holds for now: 50 people and 4 hours a call.

- **Video**: LiveKit Cloud (hosted). Set `LIVEKIT_URL` (the project's `wss://` address), `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` in `.env.local` (never commit values). Without them, or before migration 0054 is applied, every call button is hidden and the Calls page says why. Camera, microphone and screen share need `http://localhost:3000` or an HTTPS address.
- **Ringing and missed calls**: a call rings the other person (or, in a channel, the members who are online, not in quiet hours and not in another call) for 30 seconds on every open web page and in the desktop notch, then turns into a missed call: a notification, a notch card and a line in the thread. Devices in a call send a heartbeat every 15 seconds; the worker settles rings, dropped devices (45 seconds), the 4-hour cap and 15 minutes alone, and closes LiveKit rooms. No LiveKit webhooks are needed on localhost (a verified webhook route exists for production, see `docs/runbooks.md`).
- **Brenda's notes, with consent**: anyone on a call can turn on "Brenda takes notes"; everyone on the call sees it and answers for themselves ("Not me" keeps their words out). Each consenting person's own device writes down their own words (the browser's on-device speech recognition, or the app's on-device Whisper); no audio is sent anywhere or kept. After the call the workspace assistant writes a recap (summary, decisions, action items) from those lines only; it goes to everyone who was on the call, and to the thread. Action items become Commitments that each named person must accept. Only the people who were on the call can read its transcript, and the transcript is deleted 7 days after the recap (the recap stays).
- **Routes**: pages `/app/[workspace]/calls` (history and missed calls) and `/app/[workspace]/calls/[id]`; API `GET|POST /api/orgs/[org]/calls`, `calls/now`, `calls/live`, `calls/[id]`, `calls/[id]/join`, `accept`, `decline`, `leave`, `end`, `heartbeat`, `notes`, `consent`, `lines`, `recap`; `POST /api/livekit/webhook` (production, optional).

The old recordings are deleted by the owner with `pnpm db:delete-recordings` (a dry run by default); see `docs/runbooks.md`, "Deleting the old recordings (phase 8)".

## The to-do assistant

On My Day, **Assistant** turns a typed or dictated note ("finish the logo export by Friday, then ask Ada to update the brand deck") into proposed to-dos that the person reviews and confirms.

To run it on Claude, an organisation owner opens **Settings → AI assistant** and pastes an Anthropic API key (from console.anthropic.com). The key is tested with one request, stored encrypted, and never shown again; pick Claude Opus 5 (default) or Sonnet 5. Alternatively set `ANTHROPIC_API_KEY` in `.env.local` for the whole server. Without either, a built-in parser runs and the page says so.

Dictation uses the browser's speech recognition (Chrome, Edge, Safari) and needs the app open at `http://localhost:3000` or an `https://` address; the browser asks for the microphone the first time.

## Product routes

`/login`, `/signup`, `/join`, `/join/[code]`, `/recover`, `/verify`, `/invite/[token]`, `/onboarding`, `/app` (workspace picker), and under `/app/[workspace]`: `dashboard`, `my-day`, `workroom`, `workroom/[member]`, `teams/[id]`, `calls`, `calls/[id]`, `projects`, `projects/[id]`, `tasks/[id]`, `team` (activity), `reviews`, `timesheets`, `reports` (with period presets), `people` (tabs: teams, people, invitations), `policy`, `settings`, `notifications`, `audit`. `/dev/mail` shows the local mail sink in development.

## Security notes

- Tenant isolation is enforced by RLS on every tenant table and by composite `(id, organisation_id)` foreign keys, so even privileged server code cannot link rows across organisations.
- One open work session per user is a database constraint; confirmed intervals cannot overlap (exclusion constraint) and cannot be rewritten (trigger).
- Self-review and last-owner removal are rejected by triggers as well as service code.
- State-changing API calls accept `Idempotency-Key`; the same key with a different body is rejected.
- Uploads are validated by size, MIME and magic bytes, stored privately with server-generated keys, quarantined until scanned, and downloaded as attachments only.
- Calls are never recorded. LiveKit tokens are signed on the server for one room and one identity, last 2 minutes and cannot change their own metadata; who may join a call is exactly who may read its thread, and someone taken out of the thread is out of its live call at once. LiveKit cannot revoke a token, so anyone in a call's room without a place in the call is taken out (the webhook's `participant_joined`, the devices' heartbeats, the worker's sweep; fix review, 10 October 2026). A call's transcript is readable only by the people who were on it (and still read its thread) and is deleted 7 days after the recap.

See `docs/providers.md` for production provider setup and `docs/runbooks.md` for operations.
