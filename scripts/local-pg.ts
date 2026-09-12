/** Shared helpers for the self-contained local PostgreSQL used by quickstart and dev. */
import { existsSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { Client } from "pg";

export const LOCAL_PG_PORT = Number(process.env.LOCAL_PG_PORT ?? 54329);
export const DATA_DIR = "./var/pgdata";
export const SUPER = { user: "postgres", password: "postgres" };
export const superUrl = (db: string) => `postgres://${SUPER.user}:${SUPER.password}@localhost:${LOCAL_PG_PORT}/${db}`;

export async function canConnect(url: string): Promise<boolean> {
  const c = new Client({ connectionString: url });
  try { await c.connect(); await c.end(); return true; } catch { return false; }
}

export async function waitFor(url: string, tries = 60) {
  for (let i = 0; i < tries; i++) { if (await canConnect(url)) return; await new Promise((r) => setTimeout(r, 500)); }
  throw new Error("PostgreSQL did not start in time");
}

/** Starts (initialising if needed) the embedded PostgreSQL. Returns a stop function. */
export async function startLocalPostgres(): Promise<() => Promise<void>> {
  mkdirSync(DATA_DIR, { recursive: true });
  if (process.getuid?.() === 0) { try { execSync(`chown -R postgres:postgres ${DATA_DIR}`, { stdio: "ignore" }); } catch { /* not on this platform */ } }
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  const pg = new EmbeddedPostgres({ databaseDir: DATA_DIR, user: SUPER.user, password: SUPER.password, port: LOCAL_PG_PORT, persistent: true, onLog: () => undefined, onError: (m) => console.error(String(m)) });
  if (!existsSync(`${DATA_DIR}/PG_VERSION`)) { console.log("Initialising local PostgreSQL data directory…"); await pg.initialise(); }
  console.log(`Starting local PostgreSQL on port ${LOCAL_PG_PORT}…`);
  await pg.start();
  await waitFor(superUrl("postgres"));
  return async () => { await pg.stop().catch(() => undefined); };
}

/** True when .env.local points at the embedded database (so dev should start it). */
export function usesLocalPostgres(): boolean {
  const url = process.env.DATABASE_URL ?? "";
  try { return new URL(url).port === String(LOCAL_PG_PORT); } catch { return false; }
}
