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

## Owner feedback round 1 (11 September 2026)

| Ask | Done |
| --- | --- |
| Two account types: organisation accounts create workspaces; staff can only join through the organisation | Sign-up now offers "Create an organisation account" or "Join my organisation". A staff account can only be created from a join link, join code or email invitation (`/join`, `/join/[code]`, `/invite/[token]`). |
| Organisation gives out a link or unique code | Each organisation has a join code (e.g. `K7QM-3XNA`) and link `/join/<code>`; owners/HR generate, pause, rotate it and choose the role (staff or team lead) and team new joiners land in. Rotation invalidates the old code immediately. Never grants owner/HR. |
| Organisation dashboard: tasks done, people, accounts connected, total time today, who is working | `/app/[workspace]/dashboard` for owners/HR (their landing page): tiles, "working right now" table, teams overview, recently completed. |
| Organisation creates teams and puts leads in charge; leads assign tasks to their people | Every team gets a working project; team leads (managers of a team) get a **team board** (`/app/[workspace]/teams/[id]`) to create, assign, reassign and remove tasks for their members. Making someone a team lead raises them to the team-lead role. Leads land on their board after sign-in. |
| Role names | UI now says Organisation owner, HR administrator, Team lead, Staff (database roles unchanged: owner, hr, manager, employee). |

Tests: `tests/integration/join-codes.test.ts` (code lifecycle, role and team placement, RLS rejection of self-insert, team board and lead permissions, dashboard counts).

## Owner feedback round 2 (11 September 2026)

| Ask | Done |
| --- | --- |
| Organisation account is for management only: no tasks or timers of its own | Owners/HR cannot be assigned tasks (service check on create and reassign), cannot start timers, cannot add to-dos, and are redirected from My Day to the dashboard. Their menu is Dashboard, People and teams, Activity, Reviews, Records, Reports, Projects, Notifications, Policy, Settings, Audit. |
| Easier navigation | Every page except the role's home has a back link (uses browser history inside the app, otherwise a sensible fallback). Menus are trimmed per role: staff see only My Day, My timesheet, Notifications, Policy; team leads see their boards, My Day, Activity, Reviews, Timesheets, Reports, Projects. |
| Staff flow as simple as possible | My Day: one text box ("What do you need to do?") creates a to-do with Enter; the team's working project, expected output and reviewer (their team lead) are filled in automatically and the to-do is planned for today. Sections: Today's plan, From your team lead, Your to-dos, Done today. Start/Stop on every row. Submitting for review no longer requires choosing a reviewer (defaults to the team lead, then HR/owner). Staff with no team get a personal to-do project automatically. |

Tests: `tests/integration/join-codes.test.ts` (quick to-dos, personal projects), `tenancy` and `evidence-reports` updated for management-only organisation accounts.

## Owner feedback round 3 (12 September 2026)

| Ask | Done |
| --- | --- |
| People page as tabs: Teams / People / Invitations; click a team to open it and add people | `/people?tab=teams|people|invitations`. Teams tab: team cards (members, lead) and "Add new team", which creates the team and opens its page where people are added and the lead chosen. People tab: "Add new person" (email invitation), the join code and link, and everyone in the organisation. Invitations tab: all invitations with state, revoke. |
| Take out "Records" | Removed from the organisation menu. Timesheets, corrections and CSV export are reached from Reports ("Timesheets, corrections and CSV export" button), from the dashboard's "Total time today" tile and from any person's name on a team page. Team leads and staff keep their Timesheets / My timesheet item because that is where they submit and correct their own day. |
| Calendar / monthly tracking | No monthly reset (records are permanent and versioned). Reports gained period presets: This week, Last 14 days, This month, Last month, Last 90 days, plus custom dates. |
| Screen recording "not working" | Cause: new organisations start with recording *off*, and even when on, sessions on ordinary tasks were created with capture mode "none", so the timer never showed a recording button. Now: with recording "On" in Settings → Monitoring policy, every session of a member who acknowledged the notice is allowed to record; the timer shows **Record screen** (and **Stop recording**) while a timer runs. Nothing records unless the person presses it; the browser asks which screen or window to share; the red indicator shows while recording. Members who have not acknowledged the notice see a link to it instead of the button. Tasks marked "recording required" still gate at Start as before. Settings copy explains the three modes. |
| Team leads add to-dos with description, deadline and assignee from their own list | My Day quick-add has "Details" (description, deadline) and, for team leads, a "For" selector listing everyone on the teams they lead. The assignee gets a `task.assigned` notification and sees the item under "From your team lead". The lead is the reviewer of what they hand out. |
| Completed tasks still showed Start | Today's plan now excludes completed and removed tasks. Every open row has **Start** and **Done**. Done on an own to-do completes it immediately; Done on a task from a lead sends it for the lead's check ("Waiting for check") and it shows Completed when approved. The stop dialog has a "Done — mark the task completed" outcome that does the same in one step. Completed items appear under "Done today", then "Past tasks" (collapsible), with **Clear past tasks** that hides them from that person's list only (`tasks.cleared_at`; nothing is deleted, organisation views and reports are unchanged). |
| AI assistant: say or type what you are working on, it adds and arranges the to-dos; leads can name who does what | "Assistant" on My Day: type or dictate a note (dictation uses the browser's built-in speech recognition in Chrome/Edge/Safari; no audio is uploaded), press "Suggest to-dos", review the proposed titles, deadlines and assignees, then "Add N to-dos". Two engines: Claude (`@anthropic-ai/sdk`, model `claude-opus-5`, structured output) when `ANTHROPIC_API_KEY` is set; otherwise a built-in parser (sentence splitting, dates like "by Friday", "tomorrow", "3pm", estimates like "2 hours", and name matching against the lead's team). The response states which engine ran, and the UI says so. Proposals are never created silently: creation goes through the normal to-do endpoint after the person confirms, so notifications and reviewers are the same as manual entry. |

Tests: `tests/integration/round3.test.ts` (lead hand-outs and notification, Done for own and lead-assigned tasks, past tasks and clearing, stop-with-done, optional recording on every session once acknowledged, assistant proposals), `tests/unit/assistant.test.ts` (built-in parser). Migration `0012_done_and_past_tasks.sql`.

Not verified here: the Claude engine was implemented from the SDK documentation but could not be exercised in this environment (no API key). The built-in parser is what ran in the tests. Browser dictation and screen-share dialogs need a manual check in Chrome or Edge.

### Round 3 follow-up (13 September 2026): "still cannot record", "cannot access mic", "the AI looks like a demo"

| Finding | Change |
| --- | --- |
| Recording was off because every organisation started with the policy `disabled`, and the only way to change it was the full policy form. | New organisations start with recording **on** (`optional`, each person's choice); the default notice text says so. Settings has a one-click **Turn screen recording on/off** switch (`setRecordingMode`, publishes a policy version that changes only the mode). My Day shows a banner when recording is off for the organisation or when the person has not yet acknowledged the notice, with a link to the notice. When the browser cannot record, the timer now says why (for example "not a secure address: open http://localhost:3000 instead of 192.168…"). |
| Dictation said it could not access the microphone. Causes seen in the wild: the app opened on a LAN address (not a secure context), the mic blocked in the browser or the OS, or a browser without speech recognition. | The Dictate button first asks for the microphone through the browser's own prompt, then explains precisely what to fix (address, site permission, OS permission, no microphone, offline speech service). Dictation remains the browser's speech recognition: the Claude API has no audio input, and no other provider was added. |
| The assistant "looked like a demo" because no API key was configured, so the built-in parser answered. | Owners connect an Anthropic API key in Settings → AI assistant. The key is tested with one real request before it is stored, encrypted with APP_SECRET in `organisation_secrets` (RLS: owners and the server only), never displayed again, and can be replaced or removed. Model selectable (Opus 5 default, Sonnet 5). The server's `ANTHROPIC_API_KEY` remains a fallback. The assistant prompt was rewritten and now also returns a short reply to the person (what it set up, assumptions); the panel shows a clear "AI not connected" notice until a key exists. Migration `0013_assistant_secrets.sql`. |

Still not verified in this environment: a real Claude round-trip (no key available here). The connection test in Settings is the check: it makes one request and shows Claude's reply.

**"The page isn't loading" on a staff sign-in (13 September 2026).** Root cause: every open live-updates stream (`/api/orgs/[org]/events`, one per open tab) borrowed a connection from the ten-connection database pool for its `LISTEN`, and in dev mode Next did not always call the stream's `cancel()` when the browser navigated away. After enough page views the pool was exhausted and every server page waited forever. Reproduced with twelve open streams (page never loaded); fixed by one shared listener connection per process (`src/server/lib/notify-bus.ts`), tearing streams down on the request's abort signal, and a pool that reports "all database connections are busy" after 10 s instead of hanging. Verified: thirty open streams, pages load in under a second, idle connections fall back to one.

## Design pass from the UI Skills registry (15 September 2026)

The owner asked for the skills on ui-skills.com to be applied. The site is blocked from this environment, so the registry was taken from its npm package (`ui-skills@0.2.4`) and 156 of the 181 listed skill files were downloaded from their GitHub sources (25 are 404 or off-GitHub). The ones that govern a dark SaaS tool were applied: `baseline-ui`, `interface-design`, `fixing-accessibility`, `fixing-motion-performance`, Anthropic `frontend-design`, Vercel Web Interface Guidelines, `beautiful-shadows`. Framework-specific skills (Vue, Nuxt, Three.js, SwiftUI, Remotion, React Native) do not apply.

What changed (`docs/design-system.md` records the decisions; `.claude/skills/boredroom-ui/SKILL.md` makes them the rule for future UI work):

- Tokens: surface elevation scale on one hue, three border strengths, four text tiers, radius scale, fixed z-index scale, motion tokens (custom ease-out, 120/180 ms), depth strategy fixed to borders + one ring (no drop shadows, no gradient wash on tiles). Sidebar shares the canvas colour.
- Typography: 1.25 type scale, `text-wrap: balance` on headings and `pretty` on body, tabular numbers everywhere numbers change, quieter table headers (no all-caps), calmer overline tracking.
- Components: pill buttons get press feedback and named transitions; icon buttons are 40×40; inputs darker than surroundings with hover; `Field` links errors to controls (`aria-describedby`, `aria-invalid`); toggles carry `aria-expanded`/`aria-controls`; the one live row uses an accent edge (`tile-active`) instead of a glow.
- New `ConfirmDialog`/`ConfirmButton` on the native `<dialog>` replaces every `window.confirm` (archive task, publish policy, turn recording off, disconnect AI, rotate join code): focus trapped, Escape closes, specific action labels.
- Loading skeleton for workspace pages; `h-dvh` instead of `h-screen`; the recording indicator respects safe-area insets; `prefers-reduced-motion` handled globally; empty states name a next action.

Verified: lint, typecheck, 47 Vitest tests, 3 Playwright tests; screenshots at 1360px and 400px widths.

## Owner feedback round 4 (16 September 2026): tracking recordings, simpler staff page

| Ask | Done |
| --- | --- |
| See every screen recording from the organisation and from each team; from a team, open a task, see who worked on it and watch the recording | New **Recordings** page (`/recordings`, in the menu for owners, HR and team leads): every recording the viewer may watch, newest first, with person, team, task, time, length, size, status and a **Watch** button (shared player, 60-second links, every play logged). Filters by team and person. Team boards show the team's latest recordings and a Recordings column on each task ("worked by" = the assignee; the task page lists every session, who ran it and its footage). The organisation dashboard has a "Recent recordings" panel. |
| Supervisors should just be able to watch | Owner decision recorded here: team leads may watch recordings of the people on their teams and organisation accounts may watch any recording, without an explicit grant (`0014_supervisor_recording_access.sql`). Grants remain for anyone else. Playback is still logged and audited, flagged footage stays locked, and a person can always watch their own. This departs from the spec's "company role alone grants no playback"; the monitoring notice should say who can watch before a real pilot. |
| Staff page: one simple "to-do for today" card | My Day is now one card: "Your to-dos for today". Type a to-do and press Enter (or dictate to the assistant; leads can hand one to a team member). Each row has a pencil to edit the title, due date and time and estimate. A row shows **Start** until it is finished; with recording on, Start asks "Start" or "Start and record screen". A started row shows **Done**; the running row shows Done, which stops the timer and hands the work over in one step. **Done sends the work to the person who checks it** (the task's reviewer, else the team lead, else the organisation account); the row then reads "Sent for check" with no Start, and "Completed" once approved. The separate "Today's plan / From your team lead / Your to-dos" sections, the ordering arrows and the full task form are gone from this page. |

Tests: `recording.test.ts` (lead and HR play without a grant, colleague denied and logged, list visibility), `round3.test.ts` (Done sends for check; stop-with-Done). 47 Vitest tests, 3 Playwright tests.

## Owner feedback round 5 (16 September 2026): the Workroom

| Ask | Done |
| --- | --- |
| A "Workroom" in the left bar showing everyone who clocked in today and is working: name, department, status, a live indicator when they are recording, the task and the time on it; click a person for their whole day | New **Workroom** (`/workroom`, menu item for owners, HR and team leads; the old Activity page redirects to it). A card per person: name, teams, Staff/Team lead, status (Active, Paused, Off the clock, Not started today), a pulsing **LIVE** badge while their screen is recording, the task they are on with a ticking clock and the start time, and a footer with time today, tasks worked, done and sent for check, recordings today. Filters by team; people who have not started are hidden until "Show everyone". Cards refresh live through the existing event stream. |
| Click through to one person | `/workroom/[member]`: what they are on now (ticking), time today, task and recording counts; every task they touched, planned or finished today with time per task, sessions and recordings; each session with its length, times, outcome and note; today's recordings with Watch. |
| "Clocked in" | There is no separate clock-in. Status is derived from timers only and the page says so: Active = running timer with a live heartbeat; Paused = paused, interrupted, or no heartbeat for the stale period; Off the clock = worked today, nothing running; Not started = no session today. |

Scope: team leads see the people on their teams, organisation accounts see everyone who holds tasks; staff have no Workroom (their day is My Day). Test: `tests/integration/workroom.test.ts`.

## Design pass with the frontend-design skill (18 September 2026)

Plan reviewed against the skill's list of generated-design tells. The landing page pins the palette and type (black, one ember accent, Cal Sans and Manrope, pills), so those stayed. Everything the brief left free and that read as a template default changed: tracked-caps category eyebrows above titles, the grid of identical stat boxes, middle-dot meta strings, the arrow on "Open team", the monospace clock, and the one-word gradient in the greeting. Signature: the clock, in the display face, always the hero of My Day (today's total when idle, "Not on the clock") with an estimate hairline; the dashboard opens with who is working and shows its figures as one ledger line. `docs/design-system.md` records the rules. 48 Vitest and 3 Playwright tests pass.

## Polish pass towards Supabase and Framer (18 September 2026)

The owner asked for a more modern, polished feel like the Supabase dashboard and framer.com, with subtle micro-animations, using their library where sensible but keeping our colours. Added `motion` (the library behind Framer) behind a small set of primitives in `src/components/ui/motion.tsx`; the palette and type are unchanged. What moves now: one staggered rise per page load; the sidebar's active pill and the People tabs' underline slide between items; to-dos slide out when done and the list closes the gap; notices, the assistant and the edit panels expand and collapse; the clock crossfades between running and idle; dialogs scale in from 98%; cards lift 1px on hover; inputs take an accent ring on focus. All durations are 120–250ms, transform and opacity only, and `prefers-reduced-motion` switches movement off. Supabase-style details also landed: a denser 240px sidebar with soft borders, the stat ledger as an auto-fit row, and the recording-access copy now says who can already watch (owner, HR, team lead). `docs/design-system.md` has a Motion section. 48 Vitest and 3 Playwright tests pass; lint and typecheck clean.

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
| A24 | e2e core-workflow (keyboard-reachable controls, labels, focus ring) | pass |

## Tests run (latest: 18 September 2026, this environment)

| Command | Result |
| --- | --- |
| `pnpm lint` | clean (ESLint 9 with Next core-web-vitals, TypeScript and React compiler rules) |
| `pnpm typecheck` | clean |
| `pnpm test` (Vitest 4, embedded PostgreSQL 18, restricted `boardroom_app` role) | 9 files, 48 tests passed (18 September 2026): `tests/unit/{time,assistant}.test.ts`, `tests/integration/{tenancy,sessions,evidence-reports,recording,join-codes,round3}.test.ts` |
| `pnpm build` (Next.js 16.3.4) | succeeds; all workspace routes are dynamic (server-rendered per request) |
| `pnpm smoke` | every page read model executes for the seeded fixtures (15 checks) |
| `pnpm worker` | job loop runs against the seeded database; housekeeping job succeeded; reminder scheduling deduplicated |
| `pnpm test:e2e` (Playwright 1.63, Chromium 141 preinstalled, production build on port 3100) | 3 passed: A24 core workflow (plan, start, reload, pause/resume, switch, stop, submit, changes requested, resubmit, approve, report approval, CSV export), A01/A02 browser isolation, A03 invitation lifecycle through the mail sink |

Environment notes: no Docker daemon, no Supabase CLI, no ffmpeg; Figma and most external hosts are blocked by the network policy. Nothing was sent to a real mailbox and no external service was configured.

## Known limitations

- Browser screen-capture permission dialogs cannot be automated; the exception dialog, "Stop sharing" interruption, quota stop at 200 MB pending and IndexedDB recovery were implemented per spec but only the service side is covered by automated tests. A manual check on Chrome/Edge (localhost or HTTPS) is listed in `docs/walkthrough.md` step 12.
- No ffmpeg: assembled recordings are WebM containers concatenated from one recorder instance; no MP4 derivative or thumbnail.
- Email is only delivered to the local sink; SMTP provider must be implemented before production.
- MFA for owner/HR accounts is not implemented (production gate).
- Leave/holiday support deferred; `workday_exemptions` exist so completeness is not knowingly wrong, but there is no UI to create exemptions yet (SQL or a small admin action).
- Mobile: planning and review pages are responsive; recording is desktop-only by feature detection.
- The to-do assistant runs on Claude only after an owner connects an Anthropic API key (Settings → AI assistant) or the server sets `ANTHROPIC_API_KEY`; without either the built-in parser runs and the page says so. Dictation depends on the browser (Chrome, Edge, Safari) and a secure address (localhost or HTTPS); Firefox users type.
- Performance targets (p95 < 1 s under 50 users, dashboard < 5 s) are not measured here; the SSE/refresh design and indexes are in place.

## Blockers and external prerequisites (before a real pilot)

1. Supabase (or other) PostgreSQL project with separate dev/prod, backups and PITR.
2. Auth provider decision (keep local adapter with MFA, or Supabase Auth) and SMTP credentials for verification/recovery/invitations.
3. Private object storage bucket and lifecycle rules; malware scanning service.
4. Hosting for web and worker (HTTPS domain).
5. Error monitoring with PII scrubbing.
6. Approved monitoring notice and jurisdiction review; decisions on who may review recordings and resolve incidents.
