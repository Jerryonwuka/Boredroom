/**
 * Boredroom worker: durable PostgreSQL job queue plus periodic maintenance.
 * Runs as a separate process (`pnpm worker`). Never handles HTTP requests.
 *
 * Outside production it runs only against a database on this machine (owner request, 23 October 2026: realtime plan,
 * phase 0; src/server/lib/db-guard.ts), and outside every working window it sleeps between passes (worker/night.ts).
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });
import { workerDatabaseGuard } from "../src/server/lib/db-guard";
import { hostname } from "node:os";
import { getPool, withWorker } from "../src/server/db";
import { createLoop } from "./loop";
import { createRunner } from "./runner";
import { loadNextDue, loadSchedules, recentlyActive, workerSettings } from "./night";

const WORKER_ID = `${hostname()}:${process.pid}`;
const SETTINGS = workerSettings(process.env);
let stopping = false;
let wakeUp: (() => void) | null = null;
const { runOne, maintenance } = createRunner(WORKER_ID);

/** A sleep the stop signals cut short (a night sleep can last an hour; Fly gives a stopping machine seconds). */
function sleep(ms: number): Promise<void> {
  if (stopping) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(() => { wakeUp = null; resolve(); }, ms);
    wakeUp = () => { clearTimeout(t); wakeUp = null; resolve(); };
  });
}

async function loop() {
  console.log(`[worker] ${WORKER_ID} started; polling every ${SETTINGS.pollMs}ms, maintenance every ${SETTINGS.maintenanceMs}ms, night sleeps up to ${Math.round(SETTINGS.nightMaxSleepMs / 60_000 * 100) / 100} min`);
  const worker = createLoop({
    settings: SETTINGS,
    now: () => Date.now(),
    sleep,
    stopping: () => stopping,
    runOne,
    maintenance,
    loadSchedules: () => withWorker(loadSchedules),
    recentlyActive: () => withWorker(recentlyActive),
    nextDue: () => withWorker(loadNextDue),
    log: (line) => console.log(line),
    error: (line, err) => console.error(line, err),
  });
  await worker.run();
  await getPool().end();
}

// A promise someone forgot to wait for must not end the worker (Node ends the process on an unhandled rejection by
// default): it is logged and the loop goes on (fix review, 9 October 2026: the local worker stopped mid-morning and no
// job ran after it, the 10:30 standup rollup among them).
process.on("unhandledRejection", (err) => { console.error("[worker] unhandled rejection (the loop goes on)", err); });
process.on("SIGINT", () => { stopping = true; wakeUp?.(); });
process.on("SIGTERM", () => { stopping = true; wakeUp?.(); });
// Nothing above touches the database; the guard decides before the first query.
const guard = workerDatabaseGuard(process.env);
if (!guard.ok) { console.error(guard.message); process.exit(1); }
loop();
