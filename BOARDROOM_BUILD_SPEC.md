# Boardroom — Product and Engineering Build Specification

Version: 1.0 · 10 September 2026  
Audience: Claude Code and the engineer responsible for implementation  
Status: Build brief, not implemented software. Defaults below are proposed implementation decisions, not validated customer requirements.

## 1. How to use this document

Place this file in the root of the intended application repository. Open that repository in Claude Code and use this starter instruction:

> Read BOARDROOM_BUILD_SPEC.md completely. Treat it as the product specification. Inspect the existing repository and its instructions before changing anything. Build Boardroom in the milestone order in section 15. Start with a working vertical slice of authentication, organisation membership, task creation, a persistent work session, and a manager dashboard. Implement real persistence and authorisation, not a mock-only interface. Continue through the core milestones and the recording pilot while prerequisites are available. Validate each milestone against section 16 before advancing. Use the proposed defaults rather than repeatedly asking about routine choices. Track decisions, completed requirements, test evidence, and external blockers in BUILD_PROGRESS.md. Do not silently omit requirements, fabricate integrations, claim unrun tests passed, or call the product production-ready. If credentials are missing, complete local implementation and runnable tests with explicit local adapters; list exact setup steps for the real provider. Do not send real invitations, spend money, or publish to production without the owner's authorisation. Finish with setup instructions, verified functionality, remaining blockers, and a short demonstration walkthrough.

The starter instruction authorises implementation in the user's chosen repository when the user gives it to Claude Code. This document itself is a handoff, not an instruction to deploy anything now.

## 2. Product definition

Boardroom helps organisations understand what remote employees plan to do, what they report working on, what they deliver, and what their managers accept. Link task planning, work sessions, evidence, daily reports, and review into one workflow.

Primary customer: an organisation with approximately 10–100 staff. Initial planning scenario: 50 staff, including 25 remote staff. Support multiple isolated customer organisations from the first release.

Product promise: Know what your team is working on, what is blocked, and what has actually been delivered.

Success means an employee can plan and log work without duplicate administration, a manager can see current reported activity and resolve exceptions, and HR can inspect approved records with their history intact.

Never represent a timer, connection heartbeat, recording, mouse movement, or login as proof of productivity. Unlogged or uncertain work requires clarification, not an automatic employment penalty.

## 3. Scope and proposed defaults

### Core release

- Organisation onboarding, individual authentication, invitations, teams, roles, and membership revocation.
- Projects, tasks, expected deliverables, priorities, deadlines, and individual task ownership.
- My Day planning; start, pause, resume, switch, and stop work sessions.
- Live reported-activity dashboard with last-sync timestamps.
- Deliverable submission and manager review.
- Daily reports, time correction requests, approvals, and CSV export.
- Notifications, versioned policies, role enforcement, private attachments, and audit events.

### Recording pilot, included after the core release

- Explicit browser screen/window capture; no microphone or audio.
- Optional capture or capture required on designated tasks, governed by policy.
- Visible controls, recoverable uploads, private playback, access logs, and retention deletion.
- Unsupported browsers and capture failures receive explicit handling and an exception route.

### Deferred; document extension points without building placeholder screens

Electron desktop companion, offline automatic time tracking, mobile recording, billing, payroll integrations, HR-system integrations, SSO/SCIM, AI summaries, recognition programmes, and advanced analytics.

Exclude covert recording, keylogging, live manager screen watching, automatic salary deductions, and AI employment rankings.

### Defaults

| Decision | Initial default |
| --- | --- |
| Company time zone | Africa/Lagos, editable during onboarding; store timestamps in UTC |
| Working schedule | Monday–Friday; 09:00–17:00; editable and informational, not an automatic pay rule |
| Recording | Disabled until organisation policy is configured and activated |
| Recording retention | 7 days after session end; selectable 1–30 days in the pilot |
| Capture audio | Disabled |
| Heartbeat | Every 30 seconds; status becomes stale after 90 seconds |
| Reminder | One reminder 30 minutes before scheduled day end; no penalty |
| Invitations | Email-bound, single-use, expire after 72 hours |
| Attachments | PDF, PNG, JPEG, WebP, TXT; maximum 20 MB; private storage |
| Authentication | Individual email/password with verification and recovery; MFA required for owner/HR accounts before production |
| Task owner | One accountable employee per task; split collaborative work into separate tasks |
| Billing | No live payment collection in the pilot |

These values must live in configuration or policy records, not scattered UI constants. No legal compliance claim is implied by a seven-day retention setting.

## 4. Identity and permissions

The organisation identifier locates a workspace. The employee identifier is unique within that organisation. Neither is a credential. Use immutable internal UUIDs, individual authentication, and active membership checks.

A user can belong to multiple organisations. Workspace switching changes the authorised context. Never trust a client-supplied organisation ID without checking membership. Enforce one open work session per user globally so switching workspaces cannot create simultaneous timers.

| Capability | Owner | HR administrator | Team manager | Employee |
| --- | --- | --- | --- | --- |
| Organisation configuration | Yes | Operational settings | No | No |
| Grant owner/HR roles | Yes | No | No | No |
| Invite employees and assign teams | Yes | Yes | No | No |
| View organisation time summaries | Yes | Yes | Own team | Own records |
| Create and assign tasks | Yes | If project-authorised | Own team/projects | Self within permitted projects |
| Start or stop an employee timer | Own timer only | Own timer only | Own timer only | Own timer only |
| Review task deliverables | If designated reviewer | If designated reviewer | Assigned review scope | No self-approval |
| Approve reports/corrections | Other members, authorised scope | Other members, authorised scope | Own team, excluding self | No |
| Read recording content | Explicit grant only | Explicit grant only | Explicit grant only | Own available footage |
| View audit history | Organisation | Operational scope | Own team review actions | Own record history |

Recording-review grants are additive permissions with organisation/team scope and an auditable grantor. Owner grants these permissions; every grant is recorded. Company role alone grants no recording playback. New grants do not bypass restricted-incident rules.

Never allow self-approval. For a sole owner, own submissions remain explicitly unreviewed unless another authorised reviewer exists; exclude them from approved-only exports. Prevent removal of the last active owner.

Revocation immediately removes authorisation to new requests and live channels. Short-lived media URLs expire within 60 seconds; the interface must disclose that already downloaded content cannot be revoked.

## 5. User journeys

### 5.1 Organisation onboarding

Create and verify account → create workspace → configure time zone and schedule → define teams and managers → configure policy → invite employees → show setup checklist.

In development, deliver invitations to a local mail sink. In production, send only after the administrator explicitly clicks Invite. Show pending, accepted, expired, and revoked invitations. Accepting must verify the signed-in email matches the invitation. Reject role escalation through edited invitation payloads.

### 5.2 Employee joins

Accept invitation → authenticate/verify email → receive membership and employee ID → view monitoring policy and acknowledge its current version → open My Day.

Policy acknowledgement records what the employee was shown; do not describe the checkbox as establishing every necessary legal basis. Material changes require a new version and acknowledgement before new capture sessions.

### 5.3 Daily planning

Show assigned, overdue, blocked, and unfinished work. Employee selects daily priorities or creates a task. Required fields: title, project, expected output. Due date and effort estimate are optional unless the project policy requires them. Reviewer is required before submission for review.

Reuse task metadata across sessions. Do not require rewriting a task when resuming. My Day order is employee-specific and independent of project priority.

### 5.4 Work session

Start opens a session for an eligible task. If another session is open, offer Resume or Switch. A switch closes the previous session and creates the new one in a single database transaction.

For required capture, request source selection before the recorded session begins. If permission is denied, offer retry or an exception request. An exception may track provisional time clearly marked as pending review; it must not claim recording occurred.

Show task name, elapsed confirmed time, estimated effort, sync status, capture status, Pause, Switch, and Stop. Reaching the estimate prompts a progress update; it never stops work or implies poor performance.

Pause closes the current timed interval and stops capture. Resume opens a new interval and requests capture permission again if needed. Stop closes the interval/session, stops capture, and asks for a short progress note and optional evidence. Task choices: continue later, blocked, ready for review.

Switching between required-capture tasks must obtain the next permission before committing the switch. A denied prompt leaves the old session unchanged unless the employee explicitly stops it. Handle stale UI and permission delays by validating the current session version at commit time.

### 5.5 Deliverable review

Employee submits a task revision with evidence → designated reviewer receives notification → reviewer approves, requests changes, or asks a question. Approval completes the task. Changes requested return it to active work. Preserve each submitted revision and its review; never overwrite approved evidence silently.

Evidence can be an uploaded file or an HTTPS link with notes. Do not automatically fetch arbitrary submitted URLs. One employee can attach multiple evidence items. Record who submitted them and when.

### 5.6 Daily report and correction

Generate a report for the organisation-local calendar day from session intervals and notes. Employee adds blockers/next priorities, inspects missing or uncertain entries, and submits. Reject submission while an unresolved open session overlaps that day.

Reports have draft, submitted, changes_requested, and approved states. Submission creates a versioned snapshot. Corrections to submitted/approved time create a new proposed report version and require fresh approval; the old approved version remains in history and is marked superseded only when the replacement is approved.

Correction requests contain original interval references, proposed start/end, reason, and evidence if available. Manager accepts or rejects with notes. Validate chronology and no overlaps across the employee's work sessions, including other organisations; return a generic overlap conflict without leaking another organisation's details.

### 5.7 Manager and HR

Manager lands on team status and an attention queue: blocked tasks, submitted work, overdue commitments, recording exceptions, missing reports, and correction requests. Filter by team, employee, project, date, and state.

HR inspects approved records and exports CSV with organisation, employee ID, local work date, project, task, approved duration, reviewer, approval timestamp, and report version. CSV totals must reconcile with approved report snapshots. Neutralise spreadsheet formula injection in user-provided text.

## 6. Screens and interface behaviour

| Route | Contents and principal actions |
| --- | --- |
| /login, /recover, /invite/[token] | Sign in, recovery, secure invitation acceptance |
| /onboarding | Workspace and policy setup checklist |
| /app/[workspace]/my-day | Prioritised task list, current timer, daily submission |
| /app/[workspace]/projects | Project list; archive and permitted creation |
| /app/[workspace]/projects/[id] | Task list/board, assignees, deadlines, filters |
| /app/[workspace]/tasks/[id] | Expected output, sessions, evidence versions, discussion, review |
| /app/[workspace]/team | Reported activity, last sync, blockers, workload |
| /app/[workspace]/reviews | Task submissions, reports, corrections, capture exceptions |
| /app/[workspace]/timesheets | Own records or authorised team records; corrections and export |
| /app/[workspace]/reports | Delivery, time allocation, blockers, logging completeness |
| /app/[workspace]/people | Members, pending invitations, teams, role changes, offboarding |
| /app/[workspace]/settings | Policies, schedule, retention, grants, organisation details |
| /app/[workspace]/audit | Filtered access and change history |

Use a clean, restrained interface: light neutral background, generous spacing, readable sans-serif text, one accent colour, and clear tables. Use 16px primary body text, keyboard access, visible focus, and text labels alongside state colours. Mobile supports planning and review; recording support is feature-detected and desktop-focused.

Every screen needs loading, empty, error, permission-denied, and offline states where applicable. No invented statistics, decorative productivity scores, fake live statuses, or enabled buttons that do nothing. Show explicit last-sync timestamps. Charts are secondary to clear tables.

## 7. State model and timing invariants

Task states: todo → in_progress → in_review → completed. in_progress may enter blocked; blocked may return to in_progress. in_review may return to in_progress on changes requested. Authorised reopening of completed work requires a reason. Archived tasks cannot start sessions.

Session states: running, paused, interrupted, stopped. running → paused/stopped/interrupted; paused → running/stopped; interrupted → running/stopped after reconciliation. A session owns zero or more immutable timed intervals. Resume starts a new interval; it does not rewrite the previous interval's end.

Recording states: requesting, recording, interrupted, uploading, processing, ready, failed, restricted, deleting, deleted. Keep capture state separate from upload state in the implementation; upload can continue after capture ends.

Key rules:

1. A database-enforced unique open-session constraint plus per-user transaction lock prevents concurrent starts across devices. A paused/interrupted session still occupies the open-session slot.
2. Time equals the sum of accepted interval durations, not time since page load. Browser display counters are estimates rebuilt from authoritative state.
3. Heartbeats run every 30 seconds while connected. After 90 seconds without one, show connection lost. A worker closes the confirmed interval at the last acknowledged heartbeat and flags later elapsed time as uncertain. Reconnect never auto-credits the gap; offer correction and resume.
4. Online endpoints use server timestamps. Client timestamps for recovery are proposed evidence, never authoritative approved time.
5. Stop/switch is idempotent. An expected version prevents concurrent stale updates. Retry returns the committed result.
6. Intervals never overlap for a user. Breaks do not count. Meetings and offline work are explicit task categories/corrections, not inferred inactivity.
7. UTC storage plus IANA time zones determines local-day allocation, including overnight intervals and daylight-saving transitions. Split durations at local midnight for reporting without modifying original intervals.
8. Changing an organisation time zone applies prospectively; preserve submitted report time-zone snapshots.
9. Reassignment does not transfer historical session ownership. Block reassignment while a session is open or require the employee to close it first.
10. Archive projects/tasks and revoke memberships; do not cascade-delete historical approved work.

## 8. Data model

Use PostgreSQL migrations, UUID keys, timestamptz timestamps, constrained enums/checks, indexes, and explicit foreign keys. Every tenant-owned table includes organisation_id. Composite foreign keys or equivalent constraints must reject linking rows across tenants even through privileged server code.

| Entity | Required fields beyond ID and timestamps |
| --- | --- |
| organisations | name, slug unique, timezone, status, current_policy_id |
| profiles | auth_user_id unique, display_name; no passwords |
| memberships | organisation_id, user_id, employee_code, role, status; unique organisation/user and organisation/employee_code |
| teams / team_members | organisation_id, name; team_id, membership_id, manager flag |
| invitations | organisation_id, email, role, token_hash, expires_at, accepted_at, revoked_at, invited_by |
| schedules | organisation_id, membership_id nullable, timezone, working_days, start_local, end_local, effective_from |
| projects / project_members | organisation_id, name, status; project_id, membership_id, access role |
| tasks | project_id, assignee_membership_id, reviewer_membership_id, title, expected_output, category, priority, estimate_minutes nullable, due_at nullable, status, capture_requirement, version |
| daily_plan_items | membership_id, local_date, task_id, position |
| work_sessions | user_id, membership_id, task_id, state, started_at, ended_at, last_heartbeat_at, version, policy_version_id |
| session_intervals | session_id, started_at, ended_at, confirmation_status, source |
| session_events | session_id, actor_id, event_type, occurred_at, request_id, metadata |
| task_submissions / deliverables | task_id, revision, submitted_by, note; submission_id, kind, storage_key or URL, MIME, size, scan_status |
| reviews | submission_id, reviewer_id, decision, note, reviewed_at |
| daily_reports / report_versions | membership_id, local_date; report_id, version, timezone_snapshot, status, interval/evidence snapshot, totals, submitted_at, approved_by |
| time_adjustments | membership_id, affected report/version, original interval IDs, proposed intervals, reason, status, reviewer_id |
| policies / acknowledgements | version, recording_mode, retention_days, notice_text, effective_at; membership_id, policy_id, acknowledged_at |
| recording_grants | grantee_membership_id, scope_type, scope_id, granted_by, revoked_at |
| recordings / recording_chunks | session_id, policy_id, source_type, capture/upload states, expires_at; recording_id, sequence, checksum, size, storage_key |
| capture_exceptions | session_id or task_id, membership_id, reason, status, reviewer, decision_note |
| privacy_incidents | recording_id, reporter_id, reason, restricted_at, disposition, resolved_by |
| notifications | recipient_membership_id, type, resource_id, read_at, deduplication_key |
| audit_events | actor_id, action, subject_type, subject_id, occurred_at, minimal before/after metadata |
| jobs / idempotency_keys | job type, payload reference, attempts, next_run_at, state; actor, route, key, request_hash, response, expires_at |

Recordings and attachments live in private object storage. Store metadata/references in PostgreSQL. Index tenant/date queries, assignee/status queries, open sessions, pending jobs, and retention deadlines. Define constraints in migrations, not only application validation.

## 9. Architecture and service boundaries

Proposed stack: Next.js with TypeScript; Tailwind CSS and shadcn/ui; Supabase Auth, PostgreSQL, Realtime, and private Storage; a separate Node.js worker backed initially by a PostgreSQL durable job queue. Use one package manager and lockfile. Resolve compatible supported versions at implementation time and document them.

The web service handles UI, authenticated commands, reads, and short-lived upload/playback authorisation. The database enforces tenant isolation and transactional work rules. Realtime delivers authorised changes; reconnect triggers an authoritative refetch. The worker handles upload assembly, media validation/transcoding where required, reports, reminders, recovery, and retention deletion. Do not run long video work inside web request handlers.

Keep media storage and mail behind interfaces for local development. Use a local mail sink, local test accounts, and reproducible database migrations/seed data. No service-role key, storage secret, or mail credential can enter browser bundles. Ordinary user operations use scoped identity; privileged workers explicitly validate organisation relationships.

Suggested repository areas: app routes; features/tasks, sessions, reviews, recording; shared UI; server/auth and authorisation; database migrations and policies; worker/jobs; tests; docs. Claude Code may adapt this structure to an existing repository without changing product behaviour.

## 10. API contracts

Use authenticated, validated endpoints or equivalent server actions. REST names below define behaviour, not a mandatory routing library. Use ISO-8601 timestamps and integer seconds for durations. Paginate lists. Return consistent {code, message, fieldErrors?, requestId} errors without internal stack traces.

| Method and endpoint | Contract |
| --- | --- |
| POST /api/organisations | Create workspace and first owner atomically |
| POST /api/orgs/:org/invitations | Validate role grant, email, duplicate membership; create expiring invite |
| POST /api/invitations/accept | Email-bound token, one-time membership creation |
| POST /api/orgs/:org/tasks | Validate project access, assignee and reviewer scope |
| PATCH /api/orgs/:org/tasks/:task | Expected version; authorised changes and transition validation |
| POST /api/orgs/:org/sessions/start | taskId, capture mode/exception reference; return session and serverNow |
| POST /api/orgs/:org/sessions/:id/heartbeat | Session ownership, expected open state; update confirmed timestamp |
| POST /api/orgs/:org/sessions/:id/pause,resume,stop | Separate actions; expectedVersion; note where relevant |
| POST /api/orgs/:org/sessions/:id/switch | nextTaskId, expectedVersion; transactional close/start |
| POST /api/orgs/:org/tasks/:task/submissions | Immutable evidence revision; transition to in_review |
| POST /api/orgs/:org/submissions/:id/review | Decision and note; reviewer scope and no self-review |
| POST /api/orgs/:org/reports/:id/submit,review | Separate actions; snapshot/version validation |
| POST /api/orgs/:org/time-adjustments | Proposed intervals and reason; no silent overwrite |
| POST /api/orgs/:org/time-adjustments/:id/review | Validate overlap and atomically apply approved ledger changes |
| POST /api/orgs/:org/recordings | Authorise session, policy, limits; allocate server-owned storage prefix |
| POST /api/orgs/:org/recordings/:id/chunks/authorise | sequence, checksum, size; issue limited upload target |
| POST /api/orgs/:org/recordings/:id/finalise | Validate manifest completeness; enqueue idempotent assembly |
| POST /api/orgs/:org/recordings/:id/playback | Verify ownership/grant, restriction and expiry; audit access; short-lived URL |
| GET /api/orgs/:org/team-status | Scoped last-reported activity and staleness |
| GET /api/orgs/:org/exports/timesheets | Approved versioned records only, permission checked |

Use 401 unauthenticated, 403 known forbidden operations, 404 inaccessible resource identifiers, 409 state/version conflicts, 422 invalid input, and 429 rate limits. State-changing requests require idempotency keys where retries could duplicate work. Same key with a different request body must fail. Use CSRF protection appropriate to cookie-based authentication.

## 11. Recording pipeline and exceptions

Browser capture must be initiated by an employee action over HTTPS. Feature-detect capture and supported recording MIME types. The browser selects the surface; a UI preference for a window is not a guarantee. Show selected surface information where available. Never claim that Boardroom can inspect unshared screens or prove continuous attention.

1. Employee sees policy and selects Start recording.
2. Request video only; explicitly disable audio. Display a persistent red recording indicator with Stop/Pause controls.
3. Capture with a proposed target of 720p, 5 fps, approximately 0.5–1 Mbps. These are requested settings, not guaranteed file sizes; measure actual output during the pilot.
4. Emit small chunks approximately every 10 seconds. They may be parts of one media container, not independently playable files. Keep order and recorder-instance identity in the manifest.
5. Persist pending chunks in IndexedDB where supported, upload with bounded concurrency/retry, and retain until server acknowledgement. Warn at 100 MB pending; at 200 MB stop capture, mark interruption, and offer retry/exception. Catch browser quota errors earlier if needed. Local recovery is best effort, never a guarantee across cleared browser storage.
6. Server validates session ownership, size, sequence, checksum, and content type. Reject duplicates with conflicting checksums. Use server-generated storage keys, not arbitrary paths from the client.
7. Finalisation requires a complete manifest or explicitly marks the recording partial. Worker assembles segments correctly, validates media, and creates supported playback output if necessary. Ready requires successful validation; an uploaded blob alone is not success.
8. On browser Stop sharing, permission revocation, or capture failure, close the capture segment and flag the gap. Keep the timer state separate. Required-capture gaps create an exception; they do not erase elapsed work.
9. Resume after pause or lost capture requires a new prompt/recorder instance. Store separate segments and playback them through a session manifest rather than naively concatenating incompatible streams.
10. At expires_at, immediately deny playback; worker deletes raw chunks, assembled media, and derivatives, retries failures, and keeps minimal deletion audit metadata. Storage/CDN configuration must not preserve public copies. Define backup expiry separately before production.

If an employee flags sensitive footage, immediately restrict ordinary reviewer playback. A narrowly authorised privacy administrator resolves the incident through recorded deletion or release decisions. Employees cannot silently replace recordings; retention and incident deletion remain auditable. Do not log sensitive footage contents or signed URLs.

Show upload progress and warn before leaving with pending media, but do not promise the browser will keep uploading after closure. A crash may leave partial evidence. Recording quota exhaustion must surface clearly and offer an exception, not silently disable required recording.

## 12. Reports and metrics

Use transparent measures, without a single composite employee score:

- Approved tracked time: sum of approved accepted intervals in the selected local-date range.
- Delivery count: tasks approved in the selected period; label the approval-date basis.
- On-time delivery: approved tasks whose accepted submission arrived by their due date divided by approved tasks with a due date. Exclude undated tasks and show numerator/denominator.
- Estimate variance: accepted task time minus estimated task time; exclude missing estimates and avoid judging roles by one threshold.
- Blockers: open blockers and elapsed wall-clock age, clearly labelled as elapsed rather than labour hours.
- Report completeness: submitted expected workday reports divided by expected workdays under the saved schedule. Leave/holiday support is deferred; allow authorised day exemptions so completeness is not knowingly wrong.
- Capture coverage: recorded interval overlap divided by confirmed tracked interval duration for recording-required sessions. Pending media makes coverage provisional. Never label this productivity.

Display metrics at employee, team, and project scopes according to permissions. Keep approved and provisional data visibly separate. No ranking by longest hours. Rewards remain a later manager-reviewed feature.

## 13. Security, operational readiness, and external setup

Apply row-level security to tenant tables and authorise storage and realtime subscriptions. Test using actual ordinary user tokens, not just a privileged test client. Audit permission grants, invitations, reviews, corrections, recording access, policy changes, offboarding, and deletion. Application clients cannot update/delete audit events.

Validate upload MIME/signatures and sizes, use safe filenames and download disposition, quarantine files until the configured malware scan completes, and never render arbitrary HTML/SVG uploads. Permit metadata-only link evidence without fetching it. Rate-limit authentication-sensitive and upload-authorisation endpoints. Use HTTPS, secure cookies, CSP, private buckets, and secret rotation procedures.

External setup checklist for the implementer:

- Supabase project/region; development and production separation; migration and backup process.
- Auth redirect URLs, verification/recovery email templates, and SMTP credentials.
- Web hosting and separate worker execution environment with media-processing support.
- Private storage buckets, byte limits, lifecycle/backups, and access policies.
- Malware scanning adapter and a blocked/quarantine state if unavailable.
- Monitoring/error reporting with personal data and secrets scrubbed.
- Domain and TLS; production MFA configuration; retention and incident contacts.
- Approved monitoring notice, jurisdiction-specific employment/data review, and customer agreements before a real employee pilot.

Provide .env.example with names and purpose, never real values. Generate backup/restore and retention runbooks. A restored backup must reapply deletion tombstones before making expired/restricted footage accessible. Missing production services are launch blockers, not reasons to fabricate success.

## 14. Notifications and proposed reliability targets

Use in-app notifications for assignment, review requests, changes requested, blocker updates, report reminders, and correction decisions. Email is optional for review/reminder events and must be configurable. Deduplicate scheduled jobs; do not remind repeatedly because a worker retries.

Initial engineering targets, to verify rather than advertise as guarantees:

- Under a pilot load of 50 simultaneous users, p95 ordinary task/session API response under 1 second in the deployment region, excluding media uploads.
- Connected manager dashboard reflects a committed session change within 5 seconds under test conditions.
- No lost committed session start/stop events during repeated-request or refresh tests.
- Worker retries failed jobs with bounded exponential backoff and an inspectable failed-job queue.
- Monitor job backlog, upload failures, storage bytes, stale sessions, API errors, and retention deletion lag.
- Database backup and restore drill completed before production; define approved RPO/RTO then, rather than inventing contractual guarantees.

## 15. Implementation milestones

### M0 — Repository and foundation

Inspect existing instructions and code. Record implementation decisions. Scaffold only missing structure; install compatible dependencies, set up environment validation, migrations, local mail, seed scripts, and CI checks. Deliver README and BUILD_PROGRESS.md. Do not overwrite unrelated user work.

### M1 — Identity and tenancy

Implement authentication, onboarding, invitation lifecycle, roles, project/team scope, RLS, and offboarding. Seed two organisations with owner, HR, manager, and employee fixtures. Gate: cross-tenant API, database, storage, and subscription tests pass.

### M2 — Work tracking vertical slice

Implement tasks, My Day, interval-based sessions, heartbeat recovery, switch transaction, and live team dashboard. Gate: employee work appears in the correct manager view, reload preserves state, and concurrent starts cannot overlap.

### M3 — Evidence and accountability

Implement private deliverables, submission revisions, reviews, daily report snapshots, time adjustments, notifications, and CSV exports. Gate: approved report totals reconcile after an audited correction; self-approval is rejected.

### M4 — Recording pilot

Implement policy activation/acknowledgement, capture controls, segmented uploads, media worker, playback authorisation, exceptions, incident restriction, quota handling, and deletion. Gate: permission denial, interruption, partial upload, resume, and retention tests pass on declared supported browsers.

### M5 — Pilot hardening and handoff

Complete accessibility checks, realistic workload validation, security tests, operational runbooks, error monitoring, and restore verification. Provide a scripted walkthrough and known limitations. Keep production publication a separate authorised action.

### Later milestones

Desktop capture/offline recovery, billing/storage plans, external integrations, optional AI summaries, and role-specific recognition. Do not implement them before the pilot identifies concrete needs.

At each milestone update requirement coverage, migration notes, tests run, failures, and next steps. Never mark a milestone complete if its essential provider integration is only a stub.

## 16. Acceptance tests and definition of done

| ID | Scenario | Required result |
| --- | --- | --- |
| A01 | Employee uses organisation A token with organisation B task ID | Request and direct database access denied; no existence leak |
| A02 | Manager requests another team's private records | Denied by server and RLS, not just hidden UI |
| A03 | Invitation reused, expired, revoked, or accepted by another email | Membership not created |
| A04 | Start clicked in two tabs/devices simultaneously | Exactly one open session; loser gets recoverable conflict |
| A05 | Retry start/stop/switch after network timeout | Same committed result, no duplicate interval |
| A06 | Work 10 minutes, pause 5, resume 10 | 20 tracked minutes, no break time credited |
| A07 | Refresh during a running session | Same session and authoritative elapsed duration restored |
| A08 | Heartbeats disappear and employee later reconnects | Stale status, interval ends at last heartbeat, gap requires reconciliation |
| A09 | Session crosses local midnight or DST boundary | Correct local-date allocation, no duplicated seconds |
| A10 | Reviewer requests changes, then approves next evidence revision | Both revisions/reviews preserved; task completes only on approval |
| A11 | Employee or manager attempts self-approval | Rejected, including owner fallback path |
| A12 | Approved report gets a time correction | New version requires approval; historical approved snapshot retained |
| A13 | Proposed correction overlaps another session | Rejected without revealing another organisation's task details |
| A14 | Capture denied, unsupported, or stopped through browser UI | Clear status and exception path; no fabricated recording |
| A15 | Upload fails, is retried, then resumes out of order | Ordered manifest validates; no duplicate/conflicting chunks accepted |
| A16 | Tab closes before upload finalisation | Partial/pending state remains honest; recover available chunks only |
| A17 | HR without recording grant requests playback | Denied; explicit scoped reviewer succeeds with audit event |
| A18 | Sensitive recording flagged or retention expires | New playback denied immediately; deletion covers chunks and derivatives |
| A19 | Employee is offboarded with an active session | Access revoked, session interrupted at confirmed boundary, historical work retained |
| A20 | CSV export compared with approved report versions | Exact duration reconciliation; unapproved time excluded; text formula-safe |
| A21 | User submits malicious file or storage key for another tenant | Rejected or quarantined; cannot replace another tenant's evidence |
| A22 | Duplicate reminder/deletion jobs execute | No repeated notifications or inconsistent deletion state |
| A23 | Owner tries removing last owner | Rejected with clear recovery instruction |
| A24 | Keyboard-only employee completes core daily workflow | Controls reachable, labels/focus clear, errors understandable |

Use unit tests for interval maths and state rules, database/integration tests for isolation/transactions, and Playwright for meaningful end-to-end workflows. Use manual browser/OS recording checks where automation cannot exercise permission dialogs faithfully. Report tested browser versions and actual results. No tests that merely assert mocked success.

Definition of done: a new developer can follow README, configure local services, apply migrations, seed two organisations, run tests, and demonstrate the entire employee-to-manager cycle with persistent data. External blockers and unsupported environments are documented. Production readiness additionally requires the operational and policy gates in section 13.

## 17. Pilot demonstration and founder validation

Seed fictional Company A and Company B, with Ada as employee, David as manager, and Mary as HR in Company A. Create a homepage design task with an expected Figma-link deliverable and a separate client-meeting task. Demonstrate start, pause, switch, stop, evidence submission, changes requested, resubmission, daily report approval, and corrected report export. Demonstrate Company B isolation and one interrupted recording session separately.

Run the initial pilot with 5–10 invited staff for two weeks before expanding to all 50. Review: time needed to log work, submission completion, unresolved exceptions, manager review effort, recording upload volume, and whether the dashboard helps remove blockers. These are validation questions, not claimed results.

Founder decisions before production: hosting region and spend limit; exact employee monitoring notice; who may review recordings and resolve sensitive-capture incidents; schedule/leave rules; how approved records inform existing HR processes; whether recording is truly needed for each pilot role. The implementation can proceed with the defaults above while these decisions are resolved.

## 18. Technical reference starting points

Verify current documentation and compatibility while implementing:

- Browser capture and permission model: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia
- Browser recording: https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder
- Supabase row-level security: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase private storage: https://supabase.com/docs/guides/storage/security/access-control
- Electron desktop capture for a later release: https://www.electronjs.org/docs/latest/api/desktop-capturer

These references guide technical implementation; they do not replace the acceptance criteria, testing, or a production policy review.
