import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";

export const PASSWORD = "correct-horse-battery";

export async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/app/);
}

export function latestMailTo(to: string): { subject: string; text: string } | null {
  const dir = "./var/e2e-mail";
  let files: string[] = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort().reverse(); } catch { return null; }
  for (const f of files) {
    const m = JSON.parse(readFileSync(join(dir, f), "utf8"));
    if (m.to === to) return m;
  }
  return null;
}
