# Demonstration walkthrough (Company A)

Prerequisites: `pnpm db:setup`, `pnpm dev`, `pnpm worker` running. Password for every account: `correct-horse-battery`. Mail lands in `/dev/mail`.

1. **Employee plans and works** — sign in as `ada@company-a.test`. On My Day, add "Homepage design" and "Client kickoff meeting" to today's priorities. Press Start on Homepage design. Reload the page: the same session and elapsed time come back from the server (A07).
2. **Pause / resume** — Pause, wait, Resume. Time only accrues while running (A06).
3. **Switch** — Switch task → Client kickoff meeting. The previous session closes and the new one opens in one transaction.
4. **Stop with a note** — Stop → note "Agreed scope" → Continue later.
5. **Evidence** — open Homepage design → Submit for review → add the Figma link → Submit. The task moves to In review; David gets a notification.
6. **Review** — sign in as `david@company-a.test` (second browser). Reviews → open the task → Request changes with a note. Ada resubmits (revision 2). David approves; the task completes and both revisions with both decisions are preserved (A10).
7. **Daily report** — as Ada, Timesheets → Submit report (blockers, next priorities). Submission is refused while a session is open.
8. **Report approval** — as David, Reviews → Daily reports → Approve.
9. **Correction** — as Ada, Timesheets → Request a time correction (replace an interval with a longer one, reason). A new report version appears; version 1 stays approved until David approves the correction, then it becomes superseded (A12).
10. **Export** — sign in as `mary@company-a.test`, Timesheets → Export CSV. Totals match the approved snapshots; text is formula-safe (A20).
11. **Isolation** — sign in as `ada@company-b.test`; `/app/company-a/...` is not found; API calls with Company A ids return 404 (A01).
12. **Recording pilot** (Chrome/Edge on localhost or HTTPS) — as the owner, Settings → publish a policy with recording "Required on designated tasks". Every member acknowledges it on the Policy page. As David, edit Homepage design → Screen capture: Required. As Ada, Start → the browser asks which screen/window to share; decline once to see the exception route (A14). Accept: the red indicator shows chunks uploading; press "Stop sharing" in the browser to see an interrupted segment recorded honestly (A16); Resume creates a new segment. Playback: Ada can play her own segment; David cannot until the owner grants team access in Settings (A17). Ada flags the segment as sensitive → David is denied; the owner (granted privacy administrator) deletes it → chunks and media are gone, tombstone kept (A18).

13. **Organisation account and join code** — sign in as `owner@company-a.test`; the dashboard shows tasks done today, people, accounts connected now and total time today. People → Join code and link → Generate. Open the link in a private window: create a staff account, verify from `/dev/mail`, and you land in Company A as staff. Pause the code and the link stops working.
14. **Team lead board** — as the owner, People → Teams → create "Graphics", add Ben as team lead. Sign in as Ben: his landing page is the Graphics board, where he creates a task, assigns it to a teammate and removes it.

Automated coverage for the same journeys: `pnpm test` (integration) and `pnpm test:e2e` (browser).
