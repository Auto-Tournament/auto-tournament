/**
 * A safety net under allocation: every SWEEP_MS, ready matches still without
 * a server get another try (scheduler.tryImmediateAllocation). Allocation is
 * otherwise driven by events (a veto finished, a series ended, a server came
 * back) and a per-match poll; when one of those was missed, a match waited
 * for a server forever (2026-10-12 bracket test: the final, after a failed
 * early attempt stopped its poll).
 */
import { db } from '../../config/database';
import { log } from '../../utils/logger';

const SWEEP_MS = 15_000;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

/** Ready matches without a server, in a running tournament or standalone. */
async function waitingCount(): Promise<number> {
  const row = await db.queryOneAsync<{ n: number | string }>(
    `SELECT COUNT(*) AS n FROM matches m
       LEFT JOIN tournament t ON t.id = m.tournament_id
      WHERE m.status = 'ready'
        AND (m.server_id IS NULL OR m.server_id = '')
        AND (m.tournament_id IS NULL OR t.status = 'in_progress')`
  );
  return Number(row?.n ?? 0);
}

async function sweep(): Promise<void> {
  if (running) return;
  running = true;
  try {
    if ((await waitingCount()) === 0) return;
    const { scheduler } = await import('../../core/scheduler');
    await scheduler.tryImmediateAllocation();
  } catch (error) {
    log.debug('[ALLOCATION] waiting-match sweep failed', { error: (error as Error).message });
  } finally {
    running = false;
  }
}

export function startWaitingSweep(): void {
  if (timer) return;
  timer = setInterval(() => void sweep(), SWEEP_MS);
  timer.unref?.();
}

export function stopWaitingSweep(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
