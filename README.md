# Boredroom

Boredroom helps organisations understand what remote employees plan to do, what they report working on, what they deliver, and what their managers accept. Task planning, work sessions, evidence, daily reports and review live in one workflow. Multiple isolated organisations are supported from the first release.

> Timers, heartbeats, recordings, mouse movement and logins are never treated as proof of productivity. Unlogged or uncertain work leads to a clarification request, not an automatic penalty.

The product specification is in [`BOARDROOM_BUILD_SPEC.md`](./BOARDROOM_BUILD_SPEC.md). Build status, decisions and evidence are tracked in [`BUILD_PROGRESS.md`](./BUILD_PROGRESS.md).

## Stack

| Layer | Choice |
| --- | --- |
| Web | Next.js 16 (App Router, TypeScript), Tailwind CSS 4, hand-written shadcn-style components, Manrope + Cal Sans (self-hosted via Fontsource) |
| Database | PostgreSQL 16 with SQL migrations, composite tenant foreign keys, row-level security, `btree_gist` exclusion constraint for non-overlapping intervals |
| Auth | Local email/password adapter (scrypt, verification, recovery, server sessions). Supabase Auth adapter path documented in `docs/providers.md` |
| Realtime | Server-sent events fed by PostgreSQL `LISTEN/NOTIFY` (`/api/orgs/:org/events`); reconnect triggers an authoritative refetch |
| Storage | Private object storage behind an interface; local filesystem adapter under `var/storage`; files served only through 60-second signed URLs |
| Mail | Interface with a local sink (`var/mail-outbox`, readable at `/dev/mail`) |
| Worker | Separate Node process (`pnpm worker`) on a PostgreSQL durable job queue (`SKIP LOCKED`, bounded exponential backoff, dead-letter state) |
| Tests | Vitest unit + integration tests against a real PostgreSQL database using the restricted application role; Playwright end-to-end |

## Local setup

Requirements: Node 22, pnpm 10, PostgreSQL 16 with the `btree_gist`, `citext` and `pgcrypto` extensions.

```bash
pnpm install
pnpm first-run        # writes .env.local, creates roles/databases/extensions, migrates, seeds, runs pnpm doctor
pnpm dev              # web app on http://localhost:3000
pnpm worker           # in a second terminal: heartbeat recovery, reminders, media assembly, retention deletion
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
| `pnpm lint`, `pnpm typecheck`, `pnpm check` | Static checks |

## Repository layout

```
db/migrations        SQL migrations (schema, constraints, RLS policies, grants)
db/scripts           migrate.ts, seed.ts
src/app              routes: (auth), onboarding, app/[workspace]/*, api/*
src/server/auth      local auth provider
src/server/db        pool + per-request RLS context (withUser / withSystem / withWorker)
src/server/lib       api wrapper (errors, idempotency, origin check), crypto, time, mail, storage
src/server/services  orgs, tasks, sessions, evidence, reports, recording, views, fixtures
src/components       UI kit (ui/), app components (timer, capture client, forms)
worker               job loop, handlers, scheduler
tests                unit + integration (Vitest); e2e (Playwright)
docs                 providers, runbooks, walkthrough
```

## Product routes

`/login`, `/signup`, `/recover`, `/verify`, `/invite/[token]`, `/onboarding`, `/app` (workspace picker), and under `/app/[workspace]`: `my-day`, `projects`, `projects/[id]`, `tasks/[id]`, `team`, `reviews`, `timesheets`, `reports`, `people`, `policy`, `settings`, `notifications`, `audit`. `/dev/mail` shows the local mail sink in development.

## Security notes

- Tenant isolation is enforced by RLS on every tenant table and by composite `(id, organisation_id)` foreign keys, so even privileged server code cannot link rows across organisations.
- One open work session per user is a database constraint; confirmed intervals cannot overlap (exclusion constraint) and cannot be rewritten (trigger).
- Self-review and last-owner removal are rejected by triggers as well as service code.
- State-changing API calls accept `Idempotency-Key`; the same key with a different body is rejected.
- Uploads are validated by size, MIME and magic bytes, stored privately with server-generated keys, quarantined until scanned, and downloaded as attachments only.
- Recording playback needs an explicit, audited grant; short-lived URLs expire in 60 seconds; retention deletion is a worker job with tombstones.

See `docs/providers.md` for production provider setup and `docs/runbooks.md` for operations.
