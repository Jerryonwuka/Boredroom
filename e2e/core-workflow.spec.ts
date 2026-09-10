import { test, expect } from "@playwright/test";
import { signIn, latestMailTo, PASSWORD } from "./helpers";

test.describe.configure({ mode: "serial" });

test("A24: employee plans, starts, pauses, stops and submits; manager reviews; report approved; CSV exported", async ({ page, browser }) => {
  // Ada: keyboard-reachable core flow.
  await signIn(page, "ada@company-a.test");
  await page.goto("/app/company-a/my-day");
  await expect(page.getByRole("heading", { name: /Good day/ })).toBeVisible();
  // Start the homepage task from the assigned list.
  const row = page.getByRole("listitem").filter({ hasText: "Homepage design" }).first();
  await row.getByRole("button", { name: "Start" }).click();
  await expect(page.getByText("Running", { exact: true })).toBeVisible();
  await expect(page.getByLabel(/Elapsed/)).toBeVisible();
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
  await expect(page.getByText("No session running")).toBeVisible();

  // Submit the homepage task with a Figma link.
  await page.goto("/app/company-a/projects");
  await page.getByRole("link", { name: "Website relaunch" }).click();
  await page.getByRole("link", { name: "Homepage design" }).click();
  await page.getByRole("button", { name: /Submit for review/ }).click();
  await page.getByLabel(/Progress note/).fill("Desktop and mobile layouts done");
  await page.getByRole("button", { name: "Add link" }).click();
  await page.getByLabel("Link URL").fill("https://www.figma.com/file/abc/homepage");
  await page.getByLabel("Link note").fill("Homepage v1");
  await page.getByRole("button", { name: "Submit for review", exact: true }).click();
  await expect(page.getByText("In review").first()).toBeVisible();
  await expect(page.getByText("Revision 1")).toBeVisible();

  // Daily report: submit.
  await page.goto("/app/company-a/timesheets");
  await page.getByLabel("Blockers").fill("Waiting on brand assets");
  await page.getByLabel("Next priorities").fill("Pricing page");
  await page.getByRole("button", { name: "Submit report" }).click();
  await expect(page.getByText("Report submitted for review.")).toBeVisible();

  // David reviews: changes requested, then approve after resubmission; approve the report.
  const ctx2 = await browser.newContext();
  const david = await ctx2.newPage();
  await signIn(david, "david@company-a.test");
  await david.goto("/app/company-a/reviews");
  await expect(david.getByText("Homepage design")).toBeVisible();
  await david.getByRole("link", { name: "Open task to review evidence" }).click();
  await david.getByLabel("Decision").selectOption("changes_requested");
  await david.getByLabel(/^Note/).fill("Add the mobile nav");
  await david.getByRole("button", { name: "Submit review" }).click();
  await expect(david.getByText("Changes requested").first()).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: /Submit for review \(revision 2\)/ }).click();
  await page.getByLabel(/Progress note/).fill("Mobile nav added");
  await page.getByRole("button", { name: "Add link" }).click();
  await page.getByLabel("Link URL").fill("https://www.figma.com/file/abc/homepage?v=2");
  await page.getByRole("button", { name: "Submit for review", exact: true }).click();
  await expect(page.getByText("Revision 2")).toBeVisible();

  await david.reload();
  await david.getByLabel("Decision").selectOption("approved");
  await david.getByRole("button", { name: "Submit review" }).click();
  await expect(david.getByText("Completed").first()).toBeVisible();
  // Both revisions preserved.
  await expect(david.getByText("Revision 1")).toBeVisible();
  await expect(david.getByText("Revision 2")).toBeVisible();

  // Team dashboard shows Ada; report approval.
  await david.goto("/app/company-a/team");
  await expect(david.getByRole("link", { name: "Ada Employee" })).toBeVisible();
  await david.goto("/app/company-a/reviews");
  const reportCard = david.locator("li").filter({ hasText: "Ada Employee ·" }).first();
  await reportCard.getByLabel("Decision").selectOption("approved");
  await reportCard.getByRole("button", { name: "Decide" }).click();
  await expect(reportCard).toBeHidden();

  // CSV export as HR.
  const ctx3 = await browser.newContext();
  const mary = await ctx3.newPage();
  await signIn(mary, "mary@company-a.test");
  const today = new Date().toISOString().slice(0, 10);
  const res = await mary.request.get(`/api/orgs/company-a/exports/timesheets?from=${today}&to=${today}`);
  expect(res.status()).toBe(200);
  const csv = await res.text();
  expect(csv.split("\n")[0]).toContain("approved_seconds");
  expect(csv).toContain("EMP-001");
  await ctx2.close(); await ctx3.close();
});

test("A01/A02 in the browser: Company B cannot see Company A, employee cannot open team view", async ({ page }) => {
  await signIn(page, "chidi@company-b.test");
  const res = await page.request.get("/api/orgs/company-a/sessions/current");
  expect(res.status()).toBe(404);
  await page.goto("/app/company-a/my-day");
  await expect(page.getByText("Workspace not found")).toBeVisible();
  await page.goto("/app/company-b/team");
  await expect(page.getByText("Permission denied")).toBeVisible();
});

test("A03 invitation lifecycle in the browser with the local mail sink", async ({ page, browser }) => {
  await signIn(page, "mary@company-a.test");
  await page.goto("/app/company-a/people");
  await page.getByRole("button", { name: "Invite someone" }).click();
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
  await np.waitForURL(/\/app\/company-a\/policy/);
  await expect(np.getByText("Welcome to Company A")).toBeVisible();
  await np.getByRole("checkbox").check();
  await np.getByRole("button", { name: "Acknowledge" }).click();
  await np.waitForURL(/my-day/);
  // Reuse is rejected.
  await np.goto(`/invite/${token}`);
  await expect(np.getByText("already been used")).toBeVisible();
  await nb.close();
});
