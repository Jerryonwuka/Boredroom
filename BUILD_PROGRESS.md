# Build progress

Living record of decisions, requirement coverage, test evidence and blockers for Boredroom (spec: `BOARDROOM_BUILD_SPEC.md`, v1.0). Updated at each milestone. Nothing here claims production readiness; see "Blockers and external prerequisites".

## Implementation decisions

| Topic | Decision | Why |
| --- | --- | --- |
| Product name | **Boredroom** (brand from the Figma landing page and repository). The spec file is kept under its original name `BOARDROOM_BUILD_SPEC.md`. | The design and repo use "Boredroom"; the spec uses "Boardroom". Brand wins in UI copy. Database role names keep the `boardroom_` prefix used in the spec. |
| Design | Dark surfaces, one orange accent `#FF6C02`, Cal Sans display + Manrope body, pill buttons, restrained glass tiles. Tokens live in `src/app/globals.css`. | The owner asked for the landing page's branding to guide the product. The spec's "light neutral background" was superseded by that instruction; contrast, 16 px body text, focus rings and text labels alongside colours are kept. |
| Stack | Next.js 16 + TypeScript + Tailwind 4, PostgreSQL 16 direct (`pg`), separate Node worker on a PostgreSQL job queue. | Spec-proposed stack; Supabase services are behind interfaces because no credentials exist in this environment. |
| Auth | Local email/password adapter with verification, recovery, server sessions, rate limits. | Supabase Auth cannot run here (no Docker/CLI). The adapter boundary and migration path are in `docs/providers.md`. MFA for owner/HR is a production gate (flag reserved). |
| Tenant isolation | RLS on all tenant tables evaluated for the restricted `boardroom_app` role; identity via `SET LOCAL app.user_id`; composite `(id, organisation_id)` FKs everywhere. | Meets "database enforces tenant isolation" and "reject linking rows across tenants even through privileged code". |
| Realtime | SSE over PostgreSQL `LISTEN/NOTIFY`, table triggers publish ids only; client refetches server components. | Supabase Realtime unavailable; same behaviour (committed change visible in seconds, reconnect = authoritative refetch). |
| Time model | `session_intervals` immutable; confirmed intervals in a `btree_gist` exclusion constraint per user; one open session per user via partial unique index; heartbeat recovery closes at last heartbeat and records the gap as `uncertain` on reconciliation. | Section 7 invariants 1–6. |
| Idempotency | `Idempotency-Key` header stored per user + route with request hash; version checks on sessions/tasks; retry of stop/switch returns the committed result. | Section 10 / A05. |
| Storage & media | Local filesystem adapter with server-generated tenant-prefixed keys; files served only through 60-second signed URLs as attachments; media through range-capable signed URLs that re-check restriction/deletion. | Section 13 / 11. |
| Media assembly | Concatenate chunks of one recorder instance and validate the container header; no transcoding (no ffmpeg in this environment). Each pause/interruption creates a new recorder instance = new segment; playback is per segment. | Section 11 items 4, 7, 9. Honest about capability; documented extension point. |
| Malware scanning | Adapter with `none` provider that keeps files quarantined; `SCAN_ALLOW_UNSCANNED=true` marks clean for local demos. | Section 13 requires a blocked/quarantine state when scanning is unavailable. |
| Manager visibility of team ("private records") | Managers see sessions, intervals, reports, adjustments only for members of teams they manage; HR/owner organisation-wide; tasks visible to assignee, reviewer, creator, managers and project members. | Section 4 table and A02. |
| Sole-owner submissions | Owner cannot review their own work; without another reviewer it stays in review and is excluded from approved exports. | Section 4. |

## Milestone status

| Milestone | Status | Evidence |
| --- | --- | --- |
| M0 Repository and foundation | Done | migrations, env validation via `.env.example`, seed, local mail sink, README, this file, `pnpm check` |
| M1 Identity and tenancy | Done | `tests/integration/tenancy.test.ts` (A01, A02, A03, A19, A23, role escalation) |
| M2 Work tracking vertical slice | Done | `tests/integration/sessions.test.ts` (A04–A08, switch, archive/reassignment rules); e2e core workflow |
| M3 Evidence and accountability | Done | `tests/integration/evidence-reports.test.ts` (A10–A13, A20, A21); `tests/unit/time.test.ts` (A09, CSV safety) |
| M4 Recording pilot | Done in code; browser permission dialogs verified manually only where noted below | `tests/integration/recording.test.ts` (A14–A18, A21 storage-key reuse, A22) |
| M5 Pilot hardening and handoff | Partial | runbooks, walkthrough, e2e A24 keyboard flow; load validation, restore drill with real storage and monitoring wiring are open |

## Acceptance test coverage

| ID | Where | Result |
| --- | --- | --- |
| A01 | tenancy.test.ts, e2e | pass |
| A02 | tenancy.test.ts, e2e | pass |
| A03 | tenancy.test.ts, e2e | pass |
| A04 | sessions.test.ts | pass |
| A05 | sessions.test.ts | pass |
| A06 | sessions.test.ts | pass |
| A07 | sessions.test.ts, e2e | pass |
| A08 | sessions.test.ts | pass |
| A09 | unit/time.test.ts | pass |
| A10 | evidence-reports.test.ts, e2e | pass |
| A11 | evidence-reports.test.ts | pass |
| A12 | evidence-reports.test.ts | pass |
| A13 | evidence-reports.test.ts | pass |
| A14 | recording.test.ts (policy/exception gates); browser dialog handled in `capture.tsx` | service pass; manual browser check pending (see below) |
| A15 | recording.test.ts | pass |
| A16 | recording.test.ts (partial manifest) + IndexedDB recovery in `capture.tsx` | service pass; tab-close recovery is best effort |
| A17 | recording.test.ts | pass |
| A18 | recording.test.ts | pass |
| A19 | tenancy.test.ts | pass |
| A20 | evidence-reports.test.ts, unit | pass |
| A21 | evidence-reports.test.ts, recording.test.ts | pass |
| A22 | recording.test.ts | pass |
| A23 | tenancy.test.ts | pass |
| A24 | e2e core-workflow (keyboard-reachable controls, labels, focus ring) | see e2e results |

## Tests run (10 September 2026, this environment)

| Command | Result |
| --- | --- |
| `pnpm lint` | clean (ESLint 9 with Next core-web-vitals, TypeScript and React compiler rules) |
| `pnpm typecheck` | clean |
| `pnpm test` (Vitest 4, PostgreSQL 16.13, restricted `boardroom_app` role) | 5 files, 30 tests passed: `tests/unit/time.test.ts`, `tests/integration/{tenancy,sessions,evidence-reports,recording}.test.ts` |
| `pnpm build` (Next.js 16.3.4) | succeeds; all workspace routes are dynamic (server-rendered per request) |
| `pnpm smoke` | every page read model executes for the seeded fixtures (15 checks) |
| `pnpm worker` | job loop runs against the seeded database; housekeeping job succeeded; reminder scheduling deduplicated |
| `pnpm test:e2e` (Playwright 1.63, Chromium 141 preinstalled, production build on port 3100) | see the final report in the session summary and CI |

Environment notes: no Docker daemon, no Supabase CLI, no ffmpeg; Figma and most external hosts are blocked by the network policy. Nothing was sent to a real mailbox and no external service was configured.

## Known limitations

- Browser screen-capture permission dialogs cannot be automated; the exception dialog, "Stop sharing" interruption, quota stop at 200 MB pending and IndexedDB recovery were implemented per spec but only the service side is covered by automated tests. A manual check on Chrome/Edge (localhost or HTTPS) is listed in `docs/walkthrough.md` step 12.
- No ffmpeg: assembled recordings are WebM containers concatenated from one recorder instance; no MP4 derivative or thumbnail.
- Email is only delivered to the local sink; SMTP provider must be implemented before production.
- MFA for owner/HR accounts is not implemented (production gate).
- Leave/holiday support deferred; `workday_exemptions` exist so completeness is not knowingly wrong, but there is no UI to create exemptions yet (SQL or a small admin action).
- Mobile: planning and review pages are responsive; recording is desktop-only by feature detection.
- Performance targets (p95 < 1 s under 50 users, dashboard < 5 s) are not measured here; the SSE/refresh design and indexes are in place.

## Blockers and external prerequisites (before a real pilot)

1. Supabase (or other) PostgreSQL project with separate dev/prod, backups and PITR.
2. Auth provider decision (keep local adapter with MFA, or Supabase Auth) and SMTP credentials for verification/recovery/invitations.
3. Private object storage bucket and lifecycle rules; malware scanning service.
4. Hosting for web and worker (HTTPS domain).
5. Error monitoring with PII scrubbing.
6. Approved monitoring notice and jurisdiction review; decisions on who may review recordings and resolve incidents.
