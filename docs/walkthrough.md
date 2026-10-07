# Demonstration walkthrough (Company A)

Prerequisites: `pnpm db:setup`, `pnpm dev`, `pnpm worker` running. Password for every account: `correct-horse-battery`. Mail lands in `/dev/mail`.

1. **Staff plans and works** — sign in as `ada@company-a.test`. Open To-dos (in the sidebar, under Work), press + beside "Your to-dos for today", type a to-do and press Enter; it lands on the To do tab, planned for today. Tasks from David say "From David Manager" under their titles; Homepage design, due in three days, waits on the Upcoming tab. Open it and press Start; the timer shows at the top of To-dos and of My Day. Reload the page: the same session and elapsed time come back from the server (A07).
2. **Pause / resume** — Pause, wait, Resume. Time only accrues while running (A06).
3. **Switch** — Switch task → Client kickoff meeting. The previous session closes and the new one opens in one transaction.
4. **Stop with a note** — Stop → note "Agreed scope" → Continue later.
5. **Evidence** — open Homepage design → Submit for review → add the Figma link → Submit. The task moves to In review; David gets a notification.
6. **Review** — sign in as `david@company-a.test` (second browser). Reviews → open the task → Request changes with a note. Ada resubmits (revision 2). David approves; the task completes and both revisions with both decisions are preserved (A10).
7. **Confirmed time** — as Ada, Timesheets shows the day's confirmed time per task, straight from the timer. Staff write no daily report (owner decision, 6 October 2026); Brenda sends each team lead an end-of-day report of what the team did.
8. **Correction** — as Ada, Timesheets → Request a time correction (replace an interval with a longer one, reason). The day's time stays as it was until David approves it under Reviews → Time corrections; then the replaced interval is superseded and the new one counts (A12).
9. **Export** — sign in as `mary@company-a.test`, Timesheets → Export CSV. Each day's rows add up to that day's confirmed time on Timesheets; a correction counts once approved; text is formula-safe (A20).
10. **Isolation** — sign in as `ada@company-b.test`; `/app/company-a/...` is not found; API calls with Company A ids return 404 (A01).
11. **Recording pilot** (Chrome/Edge on localhost or HTTPS) — as the owner, Settings → publish a policy with recording "Required on designated tasks". Nobody signs it in advance: each member agrees to it the first time a session records their screen, and can read it, and whether they agreed, on their profile under Recording and privacy. As David, edit Homepage design → Screen capture: Required. As Ada, Start → the browser asks which screen/window to share; decline once to see the exception route (A14). Accept: the red indicator shows chunks uploading; press "Stop sharing" in the browser to see an interrupted segment recorded honestly (A16); Resume creates a new segment. Playback: Ada can play her own segment; David cannot until the owner grants team access in Settings (A17). Ada flags the segment as sensitive → David is denied; the owner (granted privacy administrator) deletes it → chunks and media are gone, tombstone kept (A18).

12. **Organisation account and join code** — sign in as `owner@company-a.test`; the dashboard shows tasks done today, people, accounts connected now and total time today. People → Join code and link → Generate. Open the link in a private window: create a staff account, verify from `/dev/mail`, and you land in Company A as staff. Pause the code and the link stops working.
13. **Team lead board** — as the owner, People → Teams → create "Graphics", add Ben as team lead. Sign in as Ben: his landing page is the Graphics board, where he creates a task, assigns it to a teammate and removes it.

Automated coverage for the same journeys: `pnpm test` (integration) and `pnpm test:e2e` (browser).
