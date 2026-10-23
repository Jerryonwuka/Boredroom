/**
 * The worker's job runner and maintenance block, apart from the process (worker/index.ts) so the night-mode tests run
 * the real ones (owner request, 23 October 2026: realtime plan, phase 0). Unchanged in what they do.
 */
import { withWorker } from "../src/server/db";
import { interruptStaleSessions } from "../src/server/services/sessions";
import { handlers } from "./handlers";
import { claimKilledJobs, scheduleMaintenance, type ClaimedJob } from "./schedule";
import { scheduleControlCenter } from "./control-center";

export function createRunner(WORKER_ID: string) {
  /** Claims the next pending job and runs it; false when there is none. */
  async function runOne(): Promise<boolean> {
    const job = await withWorker((db) => db.maybeOne<ClaimedJob>(
      `UPDATE jobs SET state = 'running', locked_at = now(), locked_by = $1, attempts = attempts + 1
       WHERE id = (SELECT id FROM jobs WHERE state = 'pending' AND next_run_at <= now() ORDER BY next_run_at FOR UPDATE SKIP LOCKED LIMIT 1)
       RETURNING id, type, payload, attempts, max_attempts`, [WORKER_ID]));
    if (!job) return false;
    await execute(job);
    return true;
  }

  /** Runs a job this worker holds ('running', locked by it) and records how it went. */
  async function execute(job: ClaimedJob): Promise<void> {
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
  }

  /**
   * Jobs an older worker on the same database killed because it does not know them ("no handler for job type …"):
   * claimed under this worker's name and run here, where that worker never takes them again (claimKilledJobs).
   */
  async function runKilledJobs(): Promise<void> {
    const jobs = await claimKilledJobs(WORKER_ID, Object.keys(handlers));
    for (const job of jobs) await execute(job);
    if (jobs.length) console.warn(`[worker] ran ${jobs.length} job(s) an older worker could not run: deploy the worker everywhere`);
  }

  /**
   * The maintenance block (WORKER_MAINTENANCE_MS, 15 s by day; once per pass by night). `quiet` outside every working
   * window: no nudges, no LiveKit room listing, no connector.sweep (worker/night.ts). `night`: a night pass, whose
   * Brenda tick gets a key of its own (worker/control-center.ts).
   */
  async function maintenance({ quiet, night = false }: { quiet: boolean; night?: boolean }): Promise<void> {
    const n = await interruptStaleSessions();
    if (n) console.log(`[worker] interrupted ${n} stale session(s)`);
    await scheduleMaintenance({ quiet });
    await scheduleControlCenter({ quiet, night }).catch((err) => console.error("[worker] control center schedule", (err as Error).message));
    await withWorker((db) => db.query(`UPDATE jobs SET state = 'pending', locked_at = NULL, locked_by = NULL WHERE state = 'running' AND locked_at < now() - interval '15 minutes'`));
    await runKilledJobs().catch((err) => console.error("[worker] jobs an older worker killed", (err as Error).message));
  }

  return { runOne, maintenance };
}
