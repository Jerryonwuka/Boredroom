/**
 * Boredroom worker: durable PostgreSQL job queue plus periodic maintenance.
 * Runs as a separate process (`pnpm worker`). Never handles HTTP requests.
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });
import { hostname } from "node:os";
import { getPool, withWorker } from "../src/server/db";
import { interruptStaleSessions } from "../src/server/services/sessions";
import { handlers } from "./handlers";
import { scheduleMaintenance } from "./schedule";

const WORKER_ID = `${hostname()}:${process.pid}`;
const POLL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 2000);
let stopping = false;

async function runOne(): Promise<boolean> {
  const job = await withWorker((db) => db.maybeOne<{ id: string; type: string; payload: Record<string, unknown>; attempts: number; max_attempts: number }>(
    `UPDATE jobs SET state = 'running', locked_at = now(), locked_by = $1, attempts = attempts + 1
     WHERE id = (SELECT id FROM jobs WHERE state = 'pending' AND next_run_at <= now() ORDER BY next_run_at FOR UPDATE SKIP LOCKED LIMIT 1)
     RETURNING id, type, payload, attempts, max_attempts`, [WORKER_ID]));
  if (!job) return false;
  const handler = handlers[job.type];
  try {
    if (!handler) throw new Error(`no handler for job type ${job.type}`);
    await handler(job.payload, { jobId: job.id, attempt: job.attempts });
    await withWorker((db) => db.query(`UPDATE jobs SET state = 'succeeded', finished_at = now(), locked_at = NULL, locked_by = NULL WHERE id = $1`, [job.id]));
  } catch (err) {
    const message = (err as Error).message?.slice(0, 2000) ?? String(err);
    const dead = job.attempts >= job.max_attempts || !handler;
    // Bounded exponential backoff: 5s, 10s, 20s ... capped at 1 hour.
    const delaySeconds = Math.min(3600, 5 * 2 ** Math.max(0, job.attempts - 1));
    await withWorker((db) => db.query(
      `UPDATE jobs SET state = $2, last_error = $3, locked_at = NULL, locked_by = NULL, next_run_at = now() + make_interval(secs => $4), finished_at = CASE WHEN $2 = 'dead' THEN now() END WHERE id = $1`,
      [job.id, dead ? "dead" : "pending", message, delaySeconds]));
    console.error(`[worker] job ${job.type} ${job.id} attempt ${job.attempts} failed: ${message}${dead ? " (dead)" : ""}`);
  }
  return true;
}

async function loop() {
  console.log(`[worker] ${WORKER_ID} started; polling every ${POLL_MS}ms`);
  let lastMaintenance = 0;
  while (!stopping) {
    try {
      const now = Date.now();
      if (now - lastMaintenance > 15000) {
        lastMaintenance = now;
        const n = await interruptStaleSessions();
        if (n) console.log(`[worker] interrupted ${n} stale session(s)`);
        await scheduleMaintenance();
        await withWorker((db) => db.query(`UPDATE jobs SET state = 'pending', locked_at = NULL, locked_by = NULL WHERE state = 'running' AND locked_at < now() - interval '15 minutes'`));
      }
      let ran = 0;
      while (await runOne()) { ran++; if (ran > 50) break; }
      if (ran === 0) await new Promise((r) => setTimeout(r, POLL_MS));
    } catch (err) {
      console.error("[worker] loop error", err);
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }
  await getPool().end();
}

process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });
loop();
