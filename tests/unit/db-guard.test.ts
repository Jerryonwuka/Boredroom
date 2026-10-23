/**
 * The development guard (owner request, 23 October 2026: realtime plan, phase 0, item 1): `pnpm dev` refuses a database
 * that isn't on this machine unless BOREDROOM_DEV_REMOTE_DB=1, and then never starts the worker; the worker refuses one
 * whenever NODE_ENV isn't "production". The rules, then the two real entry points run as processes with made-up remote
 * URLs (".invalid" hosts: nothing is ever contacted, and both stop before any connection).
 */
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { devDatabaseGuard, isLocalDatabaseUrl, remoteDatabaseVars, workerDatabaseGuard } from "@/server/lib/db-guard";

const LOCAL = "postgres://boardroom_app:boardroom_app@localhost:54329/boardroom";
const REMOTE = "postgres://someone:not-a-real-password@ep-made-up-123.us-east-1.aws.invalid/neondb?sslmode=require";

describe("isLocalDatabaseUrl", () => {
  it.each([
    ["postgres://u:p@localhost:5432/db", true],
    ["postgresql://u:p@127.0.0.1/db", true],
    ["postgres://u:p@127.4.5.6:6000/db", true],
    ["postgres://u:p@[::1]:5432/db", true],
    ["postgres://u:p@db.localhost/db", true],
    ["postgres:///db?host=/var/run/postgresql", true],
    ["postgres://u:p@ep-x-pooler.us-east-1.aws.neon.tech/neondb", false],
    ["postgres://u:p@10.0.0.5/db", false],
    ["postgres://u:p@localhost/db?host=db.example.com", false],
    ["postgres://u:p@localhost.example.com/db", false],
    ["mysql://u:p@localhost/db", false],
    ["not a url", false],
  ])("%s → %s", (url, local) => {
    expect(isLocalDatabaseUrl(url)).toBe(local);
  });

  it("nothing configured counts as local (the process fails later with its own message)", () => {
    expect(isLocalDatabaseUrl(undefined)).toBe(true);
    expect(isLocalDatabaseUrl("")).toBe(true);
  });
});

describe("pnpm dev", () => {
  it("local databases: as before, the worker unless --no-worker", () => {
    expect(devDatabaseGuard({ DATABASE_URL: LOCAL, DATABASE_ADMIN_URL: LOCAL })).toEqual({ ok: true, remote: false, worker: true });
    expect(devDatabaseGuard({ DATABASE_URL: LOCAL }, { noWorker: true })).toEqual({ ok: true, remote: false, worker: false });
  });

  it("a remote DATABASE_URL, DATABASE_ADMIN_URL or DATABASE_LISTEN_URL is refused, naming the variable and the ways out", () => {
    for (const name of ["DATABASE_URL", "DATABASE_ADMIN_URL", "DATABASE_LISTEN_URL"]) {
      const g = devDatabaseGuard({ DATABASE_URL: LOCAL, [name]: REMOTE });
      expect(g.ok).toBe(false);
      if (g.ok) continue;
      expect(g.message).toContain(name);
      expect(g.message).toContain("pnpm quickstart");
      expect(g.message).toContain("localhost:54329");
      expect(g.message).toContain("BOREDROOM_DEV_REMOTE_DB=1");
      // Never the URL, the host or the password.
      expect(g.message).not.toContain("not-a-real-password");
      expect(g.message).not.toContain("ep-made-up");
    }
  });

  it("BOREDROOM_DEV_REMOTE_DB=1: the web app only, never the worker, even when asked for", () => {
    const g = devDatabaseGuard({ DATABASE_URL: REMOTE, DATABASE_ADMIN_URL: REMOTE, BOREDROOM_DEV_REMOTE_DB: "1" });
    expect(g).toMatchObject({ ok: true, remote: true, worker: false });
    if (g.ok && g.remote) expect(g.notice).toMatch(/web app only/);
    // Anything but "1" is no.
    expect(devDatabaseGuard({ DATABASE_URL: REMOTE, BOREDROOM_DEV_REMOTE_DB: "true" }).ok).toBe(false);
  });

  it("remoteDatabaseVars lists only the remote ones", () => {
    expect(remoteDatabaseVars({ DATABASE_URL: REMOTE, DATABASE_ADMIN_URL: LOCAL })).toEqual(["DATABASE_URL"]);
  });
});

describe("the worker", () => {
  it("production: any database (Fly sets NODE_ENV=production)", () => {
    expect(workerDatabaseGuard({ NODE_ENV: "production", DATABASE_URL: REMOTE })).toEqual({ ok: true });
  });

  it("not production: a remote DATABASE_URL is refused; a local one runs", () => {
    for (const NODE_ENV of [undefined, "development", ""]) {
      const g = workerDatabaseGuard({ NODE_ENV, DATABASE_URL: REMOTE });
      expect(g.ok).toBe(false);
      if (!g.ok) { expect(g.message).toContain("DATABASE_URL"); expect(g.message).toContain("pnpm quickstart"); expect(g.message).not.toContain("not-a-real-password"); }
    }
    expect(workerDatabaseGuard({ NODE_ENV: "development", DATABASE_URL: LOCAL })).toEqual({ ok: true });
  });

  it("under NODE_ENV=test it checks TEST_DATABASE_URL, the one it would use", () => {
    expect(workerDatabaseGuard({ NODE_ENV: "test", DATABASE_URL: REMOTE, TEST_DATABASE_URL: LOCAL })).toEqual({ ok: true });
    expect(workerDatabaseGuard({ NODE_ENV: "test", DATABASE_URL: LOCAL, TEST_DATABASE_URL: REMOTE }).ok).toBe(false);
  });
});

describe("the entry points, as processes", () => {
  const env = (over: Record<string, string>) => {
    const e: Record<string, string> = {};
    for (const k of ["PATH", "HOME", "TMPDIR", "SHELL", "USER"]) if (process.env[k]) e[k] = process.env[k]!;
    return { ...e, ...over } as NodeJS.ProcessEnv;
  };
  const run = (script: string, over: Record<string, string>) =>
    spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", script], { env: env(over), encoding: "utf8", timeout: 60_000 });

  it("pnpm dev (scripts/dev.ts) stops at once with the message, before starting anything", () => {
    const r = run("scripts/dev.ts", { DATABASE_URL: REMOTE, DATABASE_ADMIN_URL: REMOTE, NODE_ENV: "development", BOREDROOM_DEV_REMOTE_DB: "0" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("pnpm dev stopped");
    expect(r.stderr).toContain("BOREDROOM_DEV_REMOTE_DB=1");
    expect(r.stdout).not.toMatch(/Background worker started|Installing/);
  }, 60_000);

  it("the worker (worker/index.ts) refuses outside production, before its first query", () => {
    const r = run("worker/index.ts", { DATABASE_URL: REMOTE, NODE_ENV: "development" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("The worker stopped");
    expect(r.stdout).not.toContain("started; polling");
  }, 60_000);
});
