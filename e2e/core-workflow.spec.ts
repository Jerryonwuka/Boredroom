import { test, expect } from "@playwright/test";
import { signIn, latestMailTo, PASSWORD } from "./helpers";

test.describe.configure({ mode: "serial" });

test("A24: employee plans, starts, pauses, stops and submits; manager reviews; CSV exported", async ({ page, browser }) => {
  // Ada: keyboard-reachable core flow.
  await signIn(page, "ada@company-a.test");
  await page.goto("/app/company-a/my-day");
  await expect(page.getByRole("heading", { name: /Welcome, Ada/ })).toBeVisible();
  // Start the homepage task from the assigned list.
  const row = page.getByRole("listitem").filter({ hasText: "Homepage design" }).first();
  await row.getByRole("button", { name: "Start", exact: true }).click();
  // With recording on, Start asks whether to record the screen; start without recording.
  const plain = row.getByRole("button", { name: "Start", exact: true });
  if (await row.getByRole("button", { name: "Start and record screen" }).isVisible().catch(() => false)) await plain.click();
  await expect(page.getByText("Running", { exact: true })).toBeVisible();
  await expect(page.getByLabel(/Elapsed/)).toBeVisible();
  // The display counter is rebuilt from server state and advances while running.
  await expect(page.getByLabel(/Elapsed/)).not.toHaveText("00:00:00", { timeout: 15000 });
  // Reload preserves the same session (A07).
  await page.reload();
  await expect(page.getByText("Running", { exact: true })).toBeVisible();
  // Pause / resume via keyboard focus + Enter.
  await page.getByRole("button", { name: "Pause" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Paused", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Resume" }).click();
  await expect(page.getByText("Running", { exact: true })).toBeVisible();
  // Switch to the meeting task.
  await page.getByRole("button", { name: "Switch task" }).click();
  await page.getByLabel("Next task").selectOption({ label: "Client kickoff meeting — Website relaunch" });
  await page.getByRole("button", { name: "Switch", exact: true }).click();
  await expect(page.locator("section[aria-labelledby=timer-heading]")).toContainText("Client kickoff meeting");
  // Stop with a note.
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.getByLabel(/Progress note/).fill("Agreed scope with client");
  await page.getByRole("button", { name: "Stop session" }).click();
  // My Day shows no idle clock (owner decision, 5 October 2026): the timer card goes once the session stops.
  await expect(page.locator("section[aria-labelledby=timer-heading]")).toHaveCount(0);

  // Submit the homepage task with a Figma link.
  await page.goto("/app/company-a/projects");
  await page.getByRole("link", { name: "Website relaunch" }).click();
  await page.getByRole("link", { name: "Homepage design" }).click();
  await page.waitForURL(/\/tasks\//);
  const taskUrl = page.url();
  await page.getByRole("button", { name: /Submit for review/ }).click();
  await page.getByLabel(/Progress note/).fill("Desktop and mobile layouts done");
  await page.getByRole("button", { name: "Add link" }).click();
  await page.getByLabel("Link URL").fill("https://www.figma.com/file/abc/homepage");
  await page.getByLabel("Link note").fill("Homepage v1");
  await page.getByRole("button", { name: "Submit for review", exact: true }).click();
  await expect(page.getByText("In review").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Revision 1", exact: true })).toBeVisible();

  // No daily report to submit (owner decision, 6 October 2026): the timesheet shows the confirmed time as it is.
  await page.goto("/app/company-a/timesheets");
  await expect(page.getByText("Confirmed time", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit report" })).toHaveCount(0);

  // David reviews: changes requested, then approve after resubmission.
  const ctx2 = await browser.newContext();
  const david = await ctx2.newPage();
  await signIn(david, "david@company-a.test");
  await david.goto("/app/company-a/reviews");
  await expect(david.getByText("Homepage design")).toBeVisible();
  await david.getByRole("link", { name: "Open task to review evidence" }).click();
  await david.waitForURL(/\/tasks\//);
  await expect(david.getByRole("heading", { name: "Review revision 1" })).toBeVisible();
  await david.getByLabel("Decision").selectOption("changes_requested");
  await david.getByLabel(/^Note/).fill("Add the mobile nav");
  await david.getByRole("button", { name: "Submit review" }).click();
  await expect(david.getByRole("heading", { name: "Review revision 1" })).toBeHidden();
  await expect(david.getByText("Changes requested").first()).toBeVisible();

  await page.goto(taskUrl);
  await page.getByRole("button", { name: /Submit for review \(revision 2\)/ }).click();
  await page.getByLabel(/Progress note/).fill("Mobile nav added");
  await page.getByRole("button", { name: "Add link" }).click();
  await page.getByLabel("Link URL").fill("https://www.figma.com/file/abc/homepage?v=2");
  await page.getByRole("button", { name: "Submit for review", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Revision 2", exact: true })).toBeVisible();

  await david.reload();
  await expect(david.getByRole("heading", { name: "Review revision 2" })).toBeVisible();
  await david.getByLabel("Decision").selectOption("approved");
  await david.getByRole("button", { name: "Submit review" }).click();
  await expect(david.getByRole("heading", { name: "Review revision 2" })).toBeHidden();
  await expect(david.getByRole("button", { name: "Reopen completed task" })).toBeVisible();
  // Both revisions preserved.
  await expect(david.getByRole("heading", { name: "Revision 1", exact: true })).toBeVisible();
  await expect(david.getByRole("heading", { name: "Revision 2", exact: true })).toBeVisible();

  // Team dashboard shows Ada.
  await david.goto("/app/company-a/team");
  await expect(david.getByRole("link", { name: "Ada Employee" })).toBeVisible();

  // CSV export as HR: confirmed time, with no report to approve first.
  const ctx3 = await browser.newContext();
  const mary = await ctx3.newPage();
  await signIn(mary, "mary@company-a.test");
  const today = new Date().toISOString().slice(0, 10);
  const res = await mary.request.get(`/api/orgs/company-a/exports/timesheets?from=${today}&to=${today}`);
  expect(res.status()).toBe(200);
  const csv = await res.text();
  expect(csv.split("\n")[0]).toContain("confirmed_seconds");
  expect(csv).toContain("EMP-001");
  await ctx2.close(); await ctx3.close();
});

test("A01/A02 in the browser: Company B cannot see Company A, employee cannot open team view", async ({ page }) => {
  await signIn(page, "ada@company-b.test");
  const res = await page.request.get("/api/orgs/company-a/sessions/current");
  expect(res.status()).toBe(404);
  await page.goto("/app/company-a/my-day");
  await expect(page.getByText("Workspace not found")).toBeVisible();
  await page.goto("/app/company-b/team");
  await expect(page.getByText("Permission denied")).toBeVisible();
});

test("A03 invitation lifecycle in the browser with the local mail sink", async ({ page, browser }) => {
  await signIn(page, "mary@company-a.test");
  await page.goto("/app/company-a/people?tab=people");
  await page.getByRole("button", { name: "Add new person" }).click();
  await page.getByLabel("Email").fill("newbie@company-a.test");
  await page.getByRole("button", { name: "Invite", exact: true }).click();
  await expect(page.getByText("Invitation sent to newbie@company-a.test")).toBeVisible();
  const mail = latestMailTo("newbie@company-a.test");
  expect(mail).not.toBeNull();
  const link = /https?:\/\/\S+\/invite\/\S+/.exec(mail!.text)![0];
  const token = link.split("/invite/")[1];
  // Wrong account cannot accept.
  const other = await browser.newContext();
  const op = await other.newPage();
  await signIn(op, "ben@company-a.test");
  await op.goto(`/invite/${token}`);
  await expect(op.getByText("Different email")).toBeVisible();
  await other.close();
  // New account signs up, verifies via the sink, accepts.
  const nb = await browser.newContext();
  const np = await nb.newPage();
  await np.goto(`/invite/${token}`);
  await np.getByRole("button", { name: "Create account" }).click();
  await np.getByLabel("Your name").fill("New Bie");
  await np.getByLabel("Work email").fill("newbie@company-a.test");
  await np.getByLabel("Password").fill(PASSWORD);
  await np.getByRole("button", { name: "Create account" }).click();
  await np.waitForURL(/verify\/pending/);
  const verifyMail = latestMailTo("newbie@company-a.test");
  const verifyToken = /token=(\S+)/.exec(verifyMail!.text)![1];
  await np.goto(`/verify?token=${verifyToken}`);
  await np.getByRole("button", { name: "Confirm my email" }).click();
  await np.goto(`/invite/${token}`);
  await np.getByRole("button", { name: /Join Company A/ }).click();
  // No policy sign-off any more (owner decision, 5 October 2026): joining lands on Brenda's page.
  await np.waitForURL(/\/app\/company-a\/home/);
  // Reuse is rejected.
  await np.goto(`/invite/${token}`);
  await expect(np.getByText("already been used")).toBeVisible();
  await nb.close();
});

test("Messages: Ada asks David for an update across the organisation; David sees the unread badge and the message", async ({ page }) => {
  await signIn(page, "ada@company-a.test");
  await page.goto("/app/company-a/messages");
  await expect(page.getByRole("heading", { name: "Messages" })).toBeVisible();
  await page.getByRole("button", { name: "New message" }).click();
  await page.getByLabel("Search people").fill("David");
  await page.getByRole("button", { name: /David Manager/ }).click();
  await expect(page.getByRole("heading", { name: "David Manager" })).toBeVisible();
  await page.getByRole("textbox", { name: "Message" }).fill("Hi David, how far with the homepage review?");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Hi David, how far with the homepage review?")).toBeVisible();
  await expect(page.getByText("You", { exact: true })).toBeVisible();

  await page.context().clearCookies();
  await signIn(page, "david@company-a.test");
  await page.goto("/app/company-a/my-day");
  const nav = page.getByRole("navigation", { name: "Workspace" });
  await expect(nav.getByRole("link", { name: /Messages/ })).toContainText("1");
  await nav.getByRole("link", { name: /Messages/ }).click();
  await page.getByRole("link", { name: /Ada Employee/ }).first().click();
  await expect(page.getByText("Hi David, how far with the homepage review?")).toBeVisible();
  await expect(nav.getByRole("link", { name: /Messages/ })).not.toContainText("1");
});

test("Tasks: David creates a task from the Tasks page and assigns it to Ada; Ada sees it under her tasks and starts it", async ({ page }) => {
  await page.context().clearCookies();
  await signIn(page, "david@company-a.test");
  await page.goto("/app/company-a/tasks");
  await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();
  await page.getByRole("button", { name: "Add new task" }).click();
  await page.getByLabel("What needs doing").fill("Update the pricing table");
  await page.getByLabel("Details").fill("Use the new tiers from finance.");
  await page.getByLabel("Assign to").selectOption({ label: "Ada Employee (Design)" });
  await page.getByLabel("Priority").selectOption("high");
  await page.getByRole("button", { name: "Create and assign" }).click();
  await expect(page.getByText("Task created and assigned to Ada Employee.")).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: "Update the pricing table" });
  await expect(row).toContainText("Ada Employee");
  await expect(row).toContainText("High");

  await page.context().clearCookies();
  await signIn(page, "ada@company-a.test");
  await page.goto("/app/company-a/tasks");
  await expect(page.getByRole("heading", { name: "Your tasks" })).toBeVisible();
  const mine = page.getByRole("row").filter({ hasText: "Update the pricing table" });
  await expect(mine).toContainText("from David Manager");
  await mine.getByRole("button", { name: "Start" }).click();
  await page.waitForURL(/my-day/);
  await expect(page.getByText("Running", { exact: true })).toBeVisible();
  await expect(page.getByText("Update the pricing table").first()).toBeVisible();
  // Leave the clock stopped for any test that follows.
  await page.getByRole("button", { name: "Stop" }).click();
  const dialog = page.getByRole("dialog");
  if (await dialog.isVisible().catch(() => false)) await dialog.getByRole("button", { name: /Stop/ }).click();
});

test("Dictation: Ada says her to-dos into My Day's new row, the words survive the browser ending a session, and Brenda drafts them", async ({ page }) => {
  // Headless Chromium has no speech service, so a small fake stands in for window.SpeechRecognition.
  await page.addInitScript(() => {
    class FakeRecognition {
      lang = ""; continuous = false; interimResults = false;
      onresult: ((e: unknown) => void) | null = null; onend: (() => void) | null = null; onerror: ((e: unknown) => void) | null = null;
      static sessions = 0;
      start() {
        FakeRecognition.sessions++;
        const mk = (phrases: [string, boolean][]) => ({ resultIndex: 0, results: phrases.map(([transcript, isFinal]) => Object.assign([{ transcript }], { isFinal })) });
        if (FakeRecognition.sessions === 1) {
          setTimeout(() => this.onresult?.(mk([["finish the logo export by", false]])), 50);
          setTimeout(() => this.onresult?.(mk([["finish the logo export by Friday.", true]])), 120);
          setTimeout(() => this.onend?.(), 200); // Chrome ends after silence
        } else {
          setTimeout(() => this.onresult?.(mk([["reply to the client email tomorrow.", true]])), 80);
        }
      }
      stop() { setTimeout(() => this.onend?.(), 10); }
    }
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecognition;
    Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: async () => ({ getTracks: () => [] }) } });
  });
  await page.context().clearCookies();
  await signIn(page, "ada@company-a.test");
  await page.goto("/app/company-a/my-day");
  // "+" opens a new row in the list (owner decision, 5 October 2026); Dictate shows the voice card.
  await page.getByRole("button", { name: "Add a to-do" }).first().click();
  await page.getByRole("button", { name: "Dictate" }).click();
  await expect(page.getByText(/Listening…/)).toBeVisible();
  await expect(page.getByText(/finish the logo export by Friday\. reply to the client email tomorrow\./)).toBeVisible({ timeout: 5000 });
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.getByLabel("To-do 1", { exact: true })).toHaveValue(/logo export/i, { timeout: 15000 });
});

test("Tasks: a team lead hands a task up to the owner, who marks it done from the Tasks page", async ({ page }) => {
  await page.context().clearCookies();
  await signIn(page, "david@company-a.test");
  await page.goto("/app/company-a/tasks");
  await page.getByRole("button", { name: "Add new task" }).click();
  await page.getByLabel("What needs doing").fill("Approve the Q4 design budget");
  await page.getByLabel("Assign to").selectOption({ label: "Olu Owner (Organisation owner)" });
  await page.getByRole("button", { name: "Create and assign" }).click();
  await expect(page.getByText("Task created and assigned to Olu Owner.")).toBeVisible();

  await page.context().clearCookies();
  await signIn(page, "owner@company-a.test");
  await page.goto("/app/company-a/tasks");
  const row = page.getByRole("row").filter({ hasText: "Approve the Q4 design budget" });
  await expect(row).toContainText("You");
  await row.getByRole("button", { name: "Mark done" }).click();
  await expect(row).toBeHidden();
  await page.goto("/app/company-a/tasks?status=check");
  await expect(page.getByRole("row").filter({ hasText: "Approve the Q4 design budget" })).toContainText("Sent for check");
});

test("Tasks: the owner adds a task from the Tasks page and assigns it to Ben", async ({ page }) => {
  await page.context().clearCookies();
  await signIn(page, "owner@company-a.test");
  await page.goto("/app/company-a/tasks");
  await page.getByRole("button", { name: "Add new task" }).click();
  await page.getByLabel("What needs doing").fill("Prepare the board pack");
  await page.getByLabel("Assign to").selectOption({ label: "Ben Employee (Design)" });
  await page.getByRole("button", { name: "Create and assign" }).click();
  await expect(page.getByText("Task created and assigned to Ben Employee.")).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "Prepare the board pack" })).toContainText("Ben Employee");
});

test("Clocking: Ada clocks in on the Clock in page, sees her status, and the owner sees her under Clocked in", async ({ page }) => {
  await page.context().clearCookies();
  await signIn(page, "ada@company-a.test");
  // Clocking in has its own page; My Day no longer carries it (owner decision, 5 October 2026).
  await page.goto("/app/company-a/clock");
  await page.getByRole("button", { name: /^Clock in/ }).first().click();
  await expect(page.getByRole("button", { name: /^Clock in/ })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Your clock" })).toBeVisible();
  await expect(page.getByText(/Clocked in \d\d:\d\d/)).toBeVisible();
  await expect(page.getByText(/On time|Late by/).first()).toBeVisible();

  await page.context().clearCookies();
  await signIn(page, "owner@company-a.test");
  await page.goto("/app/company-a/attendance");
  await expect(page.getByRole("heading", { name: "Attendance" })).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: "Ada Employee" });
  await expect(row).toContainText("Clocked in");
  await page.getByRole("link", { name: /Not clocked in/ }).click();
  await expect(page.getByRole("row").filter({ hasText: "Ben Employee" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "Ada Employee" })).toHaveCount(0);
  // The organisation account supervises and does not clock in: its Clock in page leads to Attendance.
  await page.goto("/app/company-a/clock");
  await page.waitForURL(/\/app\/company-a\/attendance/);
});
