/**
 * The manual-report timeout sweeper (3.0 phase D, PR D3).
 *
 * One interval for the whole instance, every 60 seconds: it asks
 * `sweepTimeouts` for every report whose confirmation deadline has passed and
 * acts on it (auto-confirm, or escalate to an admin).
 *
 * A sweep rather than a timer per report, for two reasons. A deadline is
 * typically hours away, so a `setTimeout` per report would be a process-local
 * promise that a restart silently loses; and a deadline that passed while the
 * API was down still has to be acted on, which only a sweep does. The cost is
 * that an action can be up to a minute late, which for a deadline measured in
 * hours is nothing.
 *
 * The interval is unref'd, so it never holds the process open on shutdown, and
 * overlapping runs are impossible: a sweep that is still going skips the next
 * tick rather than stacking.
 */

import { log } from '../../utils/logger';
import { sweepTimeouts } from './reports';

/** Deadlines are hours apart; a minute of lag is not worth a tighter loop. */
export const SWEEP_INTERVAL_MS = 60_000;

let timer: NodeJS.Timeout | null = null;
let running = false;

/** One sweep, with its own error handling: the loop must never die on a bad row. */
export async function sweepOnce(): Promise<void> {
  if (running) {
    log.debug('[manual-report] Skipping a sweep: the last one is still going');
    return;
  }
  running = true;
  try {
    const summary = await sweepTimeouts();
    const acted = summary.autoConfirmed.length + summary.escalated.length;
    if (acted > 0) {
      log.info(
        `[manual-report] Timeout sweep: ${summary.autoConfirmed.length} auto-confirmed, ${summary.escalated.length} escalated`,
        summary
      );
    }
  } catch (err) {
    log.error('[manual-report] Timeout sweep failed', { error: (err as Error).message });
  } finally {
    running = false;
  }
}

export const reportSweeper = {
  /** Start sweeping. Safe to call twice; the second call does nothing. */
  start(intervalMs: number = SWEEP_INTERVAL_MS): void {
    if (timer) return;
    timer = setInterval(() => {
      void sweepOnce();
    }, intervalMs);
    // Never the reason the process stays alive.
    timer.unref?.();
    log.info(`[manual-report] Timeout sweeper started (every ${Math.round(intervalMs / 1000)}s)`);
  },

  /** Stop sweeping. Safe to call when it was never started. */
  stop(): void {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
    log.info('[manual-report] Timeout sweeper stopped');
  },

  /** Whether the interval is running (tests, and the health view later). */
  isRunning(): boolean {
    return timer !== null;
  },

  sweepOnce,
};
