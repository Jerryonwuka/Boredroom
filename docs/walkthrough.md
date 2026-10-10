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
11. **Calls** (phase 8; Chrome or Edge on localhost or HTTPS; needs migration 0054 and the three `LIVEKIT_*` settings) — as Ada, open Messages → the direct thread with Ben → Call. Ben, signed in on another browser and in the desktop notch, sees the incoming call for 30 seconds with Ada's assistant face; he presses Accept in the notch, which opens the call page in his browser. On the call, Ada turns on "Brenda takes notes": both see the banner and answer for themselves; each device writes down only its own person's words and sends text, never audio. Ada leaves; the call ends for both. A minute later the workspace assistant's recap arrives in the thread and in each person's notifications (summary, decisions, action items); an action item that names Ben waits in his Commitments until he accepts it. Call Ben again and let it ring out: after 30 seconds he has a missed call (bell, notch card, a line in the thread). Only Ada and Ben can open the call's transcript, and it is deleted 7 days after the recap.

12. **Organisation account and join code** — sign in as `owner@company-a.test`; the dashboard shows tasks done today, people, accounts connected now and total time today. People → Join code and link → Generate. Open the link in a private window: create a staff account, verify from `/dev/mail`, and you land in Company A as staff. Pause the code and the link stops working.
13. **Team lead board** — as the owner, People → Teams → create "Graphics", add Ben as team lead. Sign in as Ben: his landing page is the Graphics board, where he creates a task, assigns it to a teammate and removes it.

Automated coverage for the same journeys: `pnpm test` (integration) and `pnpm test:e2e` (browser).
