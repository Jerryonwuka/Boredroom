/**
 * The worker's loop, with its clock, sleep and database steps passed in, so night mode is tested with a fake clock
 * (owner request, 23 October 2026: realtime plan, phase 0, item 4; worker/night.ts says why).
 *
 * By day (inside some active organisation's working window): as before, a job claim every WORKER_POLL_INTERVAL_MS and the
 * maintenance block every WORKER_MAINTENANCE_MS. Outside every window: "quiet" maintenance (no nudges, no LiveKit room
 * listing, no connector.sweep), and, unless someone was active in the last 10 minutes, one pass and then a sleep until
 * the next due time (nightWake). Every night pass logs why it woke and when it wakes next; no ids, no addresses.
 * Activity is checked at each pass only, and nothing wakes a night sleep early but a stop signal: work queued by the
 * app during a night sleep waits for the next pass, up to WORKER_NIGHT_MAX_SLEEP_MIN (fix review, 23 October 2026;
 * phase 1 adds the wake-ups).
 */
import { insideWorkingWindow, nextWindowStart, nightWake, SCHEDULE_TTL_MS, type NextDue, type ScheduleRow, type Wake, type WorkerSettings } from "./night";

export type LoopDeps = {
  settings: WorkerSettings;
  now(): number;
  /** Resolves after `ms`, or at once when the loop is told to stop. */
  sleep(ms: number): Promise<void>;
  stopping(): boolean;
  runOne(): Promise<boolean>;
  maintenance(o: { quiet: boolean; night?: boolean }): Promise<void>;
  loadSchedules(): Promise<ScheduleRow[]>;
  recentlyActive(): Promise<boolean>;
  nextDue(): Promise<NextDue>;
  log(line: string): void;
  error(line: string, err: unknown): void;
};

export type Mode = "day" | "quiet" | "night";
export type TickResult = { mode: Mode; ran: number; maintenance: boolean; sleptMs: number; wake?: Wake };

/** Jobs a pass may run before it lets the loop come round again (day as before; a night pass drains more). */
const DAY_CAP = 50;
const NIGHT_CAP = 500;

export function createLoop(deps: LoopDeps) {
  const s = deps.settings;
  let lastMaintenance = -Infinity;
  let rows: ScheduleRow[] | null = null;
  let rowsAt = -Infinity;
  let mode: Mode = "day";
  let woke: Wake["reason"] | "start" = "start";

  async function sleep(ms: number): Promise<number> {
    const ms2 = Math.max(0, Math.round(ms));
    await deps.sleep(ms2);
    return ms2;
  }

  /** One round: maintenance when it is due (at every night pass), the claim loop, then the right sleep. */
  async function tick(): Promise<TickResult> {
    const start = deps.now();
    let maintained = false;
    if (mode === "night" || start - lastMaintenance >= s.maintenanceMs) {
      lastMaintenance = start;
      if (!rows || mode !== "day" || start - rowsAt >= SCHEDULE_TTL_MS) { rows = await deps.loadSchedules(); rowsAt = start; }
      const inside = insideWorkingWindow(rows, new Date(start));
      const next: Mode = inside ? "day" : (await deps.recentlyActive()) ? "quiet" : "night";
      if (next !== mode) deps.log(`[worker] ${next === "day" ? "inside a working window: day cadence" : next === "quiet" ? "outside every working window, someone active: day cadence, quiet maintenance" : "outside every working window, nobody active: night mode"}`);
      mode = next;
      await deps.maintenance({ quiet: mode !== "day", night: mode === "night" });
      maintained = true;
    }
    let ran = 0;
    const cap = mode === "night" ? NIGHT_CAP : DAY_CAP;
    while (!deps.stopping() && (await deps.runOne())) { ran++; if (ran >= cap) break; }
    if (mode === "night") {
      const backlog = ran >= cap;
      const due = backlog ? null : await deps.nextDue();
      const now = deps.now();
      const wake = nightWake(now, { due, windowStart: nextWindowStart(rows ?? [], new Date(now)), maxSleepMs: s.nightMaxSleepMs, backlog });
      deps.log(`[worker] night pass (${woke}): ran ${ran} job(s); next at ${wake.at.toISOString()} (${wake.reason})`);
      woke = wake.reason;
      const sleptMs = await sleep(wake.at.getTime() - now);
      return { mode, ran, maintenance: maintained, sleptMs, wake };
    }
    woke = "start";
    const sleptMs = ran === 0 ? await sleep(s.pollMs) : 0;
    return { mode, ran, maintenance: maintained, sleptMs };
  }

  /** After an error: the poll interval by day; a minute (or the night cap, if shorter) outside the window. */
  async function afterError(err: unknown): Promise<void> {
    deps.error("[worker] loop error", err);
    await sleep(mode === "day" ? s.pollMs : Math.min(60_000, s.nightMaxSleepMs));
  }

  async function run(): Promise<void> {
    while (!deps.stopping()) {
      try { await tick(); } catch (err) { await afterError(err); }
    }
  }

  return { tick, run, afterError, mode: () => mode };
}
