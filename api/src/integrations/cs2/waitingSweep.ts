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

/**
 * At start: a ready match that still has a server was being handed to it
 * when the platform stopped (the assign waits at most 15 s). Nothing finishes
 * that hand-off, so the match sat on the server for good (t10-r1m4, 12 h
 * after a deploy, 2026-10-19). Take it back; the sweep allocates it again.
 */
export async function releaseInterruptedAssigns(): Promise<number> {
  const rows = await db.queryAsync<{ slug: string; server_id: string }>(
    `SELECT slug, server_id FROM matches
      WHERE status = 'ready' AND server_id IS NOT NULL AND server_id != ''`
  );
  if (rows.length === 0) return 0;
  const { unassignMatch } = await import('./fleet/driver');
  for (const row of rows) {
    await unassignMatch(row.server_id, row.slug, 'cancelled').catch(() => undefined);
    await db.runAsync("UPDATE matches SET server_id = NULL WHERE slug = ? AND status = 'ready'", [
      row.slug,
    ]);
    log.warn(
      `[ALLOCATION] ${row.slug}: its hand-off to ${row.server_id} was cut off by a restart; allocating it again`
    );
  }
  return rows.length;
}

export function startWaitingSweep(): void {
  if (timer) return;
  void releaseInterruptedAssigns().catch((error: unknown) =>
    log.warn('[ALLOCATION] could not release interrupted assignments', {
      error: (error as Error).message,
    })
  );
  timer = setInterval(() => void sweep(), SWEEP_MS);
  timer.unref?.();
}

export function stopWaitingSweep(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
